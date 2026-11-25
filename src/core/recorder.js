/**
 * recorder.js — 実行トレースの記録器（言語非依存の共通コア）
 *
 * 評価器が各 AST ノードの評価を record() で包むと、enter/exit の TraceEvent を trace 配列に記録する。
 * 各イベントには、その時点のコールスタックと変数のスナップショット（env / frameEnvs / globalBlockVars）が付く。
 * これがオムニシエント・デバッグ（全状態を配列に記録し、ステップ操作を配列の添字の移動に還元する）の基盤。
 *
 * 言語ごとに差し替えられるもの（constructor の options）：
 * - clone:     値のクローン関数 (val, seen) => clone。既定は deepClone（core/clone.js）
 * - formatLog: captureLog() の引数 1 個を文字列にする関数 (value, index) => string。既定は String
 * - echo:      captureLog() / write() の出力をホストの console にも出すか。既定は false
 *
 * 派生クラスは eventExtras() を上書きすると、TraceEvent に言語固有のフィールドを足せる（JS の domSnapshot など）。
 */
import { ReturnSignal, ThrowSignal } from './signals.js';
import { deepClone } from './clone.js';

const defaultClone = (v, seen) => deepClone(v, seen);

class Recorder {
  /**
   * @param {number} [maxSteps=0]  記録するイベント数の上限（0 = 無制限）
   * @param {{ clone?: Function, formatLog?: Function, echo?: boolean }} [options]
   */
  constructor(maxSteps = 0, options = {}) {
    this.trace = [];          // TraceEvent[]
    this.callStack = [];      // Frame[]  { name, loc, args }
    this.consoleLogs = [];    // ConsoleLog[]  { atIndex, level, text, eol? }
    this.frameEnvStack = [];  // Scope[]  各アクティブフレームの callEnv（push 順 = 外→内）
    this.callSiteEnvs = [];   // Scope[]  各フレームを呼び出した地点の環境（frameEnvStack と同じ順）
    this.curEnv = null;       // Scope    いま評価しているノードの環境
    this.maxSteps = maxSteps;
    this.clone = options.clone ?? defaultClone;
    this.formatLog = options.formatLog ?? String;
    this.echo = options.echo ?? false;
  }

  /**
   * 1 行分の出力を記録する（JS の console.log など）。
   * atIndex は次に push される TraceEvent のインデックス。
   * @param {string} level  'log' | 'warn' | 'error' | 'info' | 'debug'
   * @param {any[]} args
   */
  captureLog(level, args) {
    const text = args.map((a, i) => this.formatLog(a, i)).join(' ');
    this.consoleLogs.push({ atIndex: this.trace.length, level, text });
    if (this.echo) {
      if (level === 'error' || level === 'warn') console[level](text);
      else console.log(text);
    }
  }

  /**
   * 改行を含みうる出力の断片を記録する（Python の print(x, end=' ') など）。
   * 改行ごとに区切り、行の終わりまでの断片は eol: true、行の途中で終わる断片は eol: false として記録する。
   * 1 行 1 件にまとめたいときは joinConsoleLines() を使う。
   * @param {string} text
   * @param {string} [level='log']
   */
  write(text, level = 'log') {
    if (text === '') return;
    const parts = String(text).split('\n');
    const atIndex = this.trace.length;
    parts.forEach((part, i) => {
      const eol = i < parts.length - 1;
      if (part === '' && !eol) return; // 改行で終わる場合の末尾の空の断片
      this.consoleLogs.push({ atIndex, level, text: part, eol });
    });
    if (this.echo && typeof process !== 'undefined' && process.stdout?.write) process.stdout.write(text);
  }

  /** 関数呼び出しのフレームを積む。呼び出した地点の環境（curEnv）もいっしょに覚える。 */
  pushFrame(frame, callEnv) {
    this.callStack.push(frame);
    this.frameEnvStack.push(callEnv);
    this.callSiteEnvs.push(this.curEnv);
  }

  popFrame() {
    this.callStack.pop();
    this.frameEnvStack.pop();
    this.callSiteEnvs.pop();
  }

  /**
   * 各アクティブフレームの変数を現時点でスナップショットする（外→内の順）。
   * 呼び出し元のフレームは、次のフレームを呼び出した地点から見える変数を含む。
   * 最も内側のフレームは、いま評価している環境 env から見える変数を含む。
   */
  snapshotFrames(env, seen) {
    return this.frameEnvStack.map((callEnv, i) => callEnv.snapshotFrom(this.callSiteEnvs[i + 1] ?? env, seen, this.clone));
  }

  /** 関数の呼び出し中に、グローバルのブロック（for の本体など）の変数をスナップショットする。 */
  snapshotGlobalBlocks(seen) {
    return this.callSiteEnvs[0]?.snapshotBlocks(seen, this.clone) ?? {};
  }

  /**
   * 1 つの TraceEvent に記録する変数のスナップショットをまとめて作る。
   * クローンの対応表を共有するので、同じ配列やオブジェクトを指す変数は、どのフレームでも同じクローンを指す。
   */
  snapshotVars(env, seen = new WeakMap()) {
    return {
      env:             env.snapshot(seen, this.clone),
      frameEnvs:       this.snapshotFrames(env, seen),
      globalBlockVars: this.snapshotGlobalBlocks(seen),
    };
  }

  /** 派生クラスが TraceEvent に足すフィールド（既定はなし） */
  eventExtras() {
    return {};
  }

  /**
   * enter/exit のペアを記録し、matchIdx で相互リンクする。fn() の戻り値を返す。
   * @param {{type: string, loc?: object, end?: object}} node
   */
  record(node, env, depth, callDepth, fn) {
    if (this.maxSteps > 0 && this.trace.length >= this.maxSteps) {
      throw new RangeError(`[MaxSteps] 実行が最大ステップ数 ${this.maxSteps.toLocaleString()} を超えたため停止しました`);
    }
    const prevEnv = this.curEnv;
    this.curEnv = env;

    const enterIdx = this.trace.length;
    this.trace.push({
      phase: 'enter',
      nodeType: node.type,
      loc: node.loc || { line: 0, column: 0 },
      end: node.end || null,
      depth,
      callDepth,
      callStack: this.callStack.map(f => ({ ...f })),
      ...this.snapshotVars(env),
      ...this.eventExtras(),
      value: undefined,
      matchIdx: -1,
    });

    const rawValue = fn();
    this.curEnv = prevEnv;

    // ReturnSignal / ThrowSignal を unwrap: trace には実際の値を記録し、
    // シグナル本体はそのまま return して制御フロー伝播に使う
    let traceValue = rawValue;
    if (rawValue instanceof ReturnSignal || rawValue instanceof ThrowSignal) {
      traceValue = rawValue.value;
    }

    // exit 時点で再スナップショットする（ローカル変数が更新されている可能性があるため）。
    // 値も同じ対応表で複製する：配列・オブジェクトの値を参照のまま残すと、あとで中身が変わったとき、
    // 過去のイベントの値まで変わって見える（ADR-017）。同じ配列を指す変数とは、同じ複製を指す
    const seen = new WeakMap();
    const exitIdx = this.trace.length;
    this.trace.push({
      phase: 'exit',
      nodeType: node.type,
      loc: node.loc || { line: 0, column: 0 },
      end: node.end || null,
      depth,
      callDepth,
      callStack: this.callStack.map(f => ({ ...f })),
      ...this.snapshotVars(env, seen),
      ...this.eventExtras(),
      value: this.clone(traceValue, seen),
      matchIdx: enterIdx,
    });
    this.trace[enterIdx].matchIdx = exitIdx;

    return rawValue;
  }
}

/**
 * consoleLogs（write() の断片を含む）を 1 行 1 件にまとめる。
 * 各行の atIndex は、その行の最後の断片が出力された位置（行が完成した位置）。
 * eol を持たないエントリ（captureLog() の出力）は 1 件で 1 行。
 * 最後の行が改行で終わっていない場合も 1 行として返す。
 * @param {Array<{atIndex:number, level:string, text:string, eol?:boolean}>} logs
 * @returns {Array<{atIndex:number, level:string, text:string}>}
 */
function joinConsoleLines(logs) {
  const out = [];
  let pending = null;
  for (const log of logs) {
    if (log.eol === undefined) {
      if (pending) { out.push(pending); pending = null; }
      out.push({ atIndex: log.atIndex, level: log.level, text: log.text });
      continue;
    }
    if (!pending) pending = { atIndex: log.atIndex, level: log.level, text: '' };
    pending.text += log.text;
    pending.atIndex = log.atIndex;
    if (log.eol) { out.push(pending); pending = null; }
  }
  if (pending) out.push(pending);
  return out;
}

export { Recorder, joinConsoleLines };

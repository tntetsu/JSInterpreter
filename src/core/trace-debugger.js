/**
 * trace-debugger.js — トレース配列に対するステップ実行 API（言語非依存の共通コア）
 *
 * 設計：スナップショット配列方式（オムニシエント・デバッグ）
 *   1. 言語ごとの評価器がプログラムを最後まで実行し、Recorder で全ノードの enter/exit を trace 配列に記録する。
 *   2. TraceDebugger はその trace を受け取るだけで、ステップ操作は trace 配列の cursor 操作に還元される。
 *
 * 言語ごとの違いは「どの nodeType が何の役割か」だけで、派生クラスの static nodeCategories で与える
 * （humanStep の停止点の計算に使う）。JS の値は JSDebugger.nodeCategories（interpreter/debugger.js）。
 *
 * TraceEvent:
 *   phase:     'enter' | 'exit'
 *   nodeType:  string            — AST ノード型
 *   loc:       {line, column}    — ソース位置
 *   end:       {line, column}|null
 *   depth:     number            — AST ネスト深さ（Program=0, 子=1…）
 *   callDepth: number            — 関数呼び出し深さ
 *   callStack: Frame[]           — コールスタックのスナップショット
 *   env / frameEnvs / globalBlockVars — 変数のスナップショット（Recorder.snapshotVars）
 *   value?:    any               — phase==='exit' のときの評価結果
 *   matchIdx:  number            — 対応する exit/enter のインデックス
 */

/**
 * @typedef {Object} NodeCategories  humanStep の停止点の計算に使う、役割ごとの nodeType の一覧
 * @property {string[]} stopOnExit  exit で必ず止まる（代入・宣言・return・throw など）
 * @property {string[]} call        関数呼び出し式。ユーザー定義関数のとき enter・本体の最初の文・exit で止まる
 * @property {string[]} block       文の並び（関数本体の最初の文を探すため・ループの条件式から除くため）
 * @property {string[]} branch      条件分岐。直後の子（条件式）の exit で止まる
 * @property {string[]} condLoop    条件ループ（while 等）。直下の子のうち block 以外の exit（毎回の条件式）で止まる
 * @property {string[]} forLoop     C 形式の for。直下の子のうち block・forInit 以外の exit（条件式・更新式）で止まる
 * @property {string[]} forInit     forLoop の初期化部（停止点から除く）
 * @property {string[]} exprStmt    式文。中に他の停止点がなければ exit で止まる。exit がない（失敗した）ときは enter で止まる
 */

/** @type {NodeCategories} */
const EMPTY_CATEGORIES = Object.freeze({
  stopOnExit: [], call: [], block: [], branch: [], condLoop: [], forLoop: [], forInit: [], exprStmt: [],
});

/**
 * 実行時エラー（maxSteps 超過を含む）が発生したときに、言語ごとのデバッガーが throw する例外。
 * エラー発生直前までの部分トレースを保持するため、呼び出し側がエラー前の実行状態を表示できる。
 *
 * maxSteps 超過エラー（[MaxSteps] プレフィックス）はプレフィックスを除去する。
 * スタックオーバーフローのメッセージはホストの JS エンジンごとに違うので、ここでそろえる。
 */
class ExecutionError extends Error {
  constructor(cause, source, trace, ast, consoleLogs) {
    const rawMsg = cause?.message ?? String(cause);
    super(cause instanceof RangeError && /call stack|too much recursion/i.test(rawMsg)
      ? '関数の呼び出しが深くなりすぎたため停止しました（再帰が止まっていない可能性があります）'
      : rawMsg.replace(/^\[MaxSteps\]\s*/, ''));
    this.name             = 'ExecutionError';
    this.cause            = cause;
    this.partialSource    = source;
    this.partialTrace     = trace;
    this.partialAst       = ast;
    this.partialConsoleLogs = consoleLogs;
  }
}

/**
 * 実行が途中で止まったトレースを整理する：末尾の閉じていない enter（matchIdx === -1）を除去し、
 * 残った外側のコンテナ（Program 等）の matchIdx を trace.length に揃える。trace をその場で変更して返す。
 * @param {Object[]} trace
 */
function finalizePartialTrace(trace) {
  let tail = trace.length - 1;
  while (tail >= 0 && trace[tail].matchIdx === -1) tail--;
  trace.length = tail + 1;
  for (const ev of trace) {
    if (ev.matchIdx === -1) ev.matchIdx = trace.length;
  }
  return trace;
}

class TraceDebugger {
  /** 派生クラスで上書きする。@type {NodeCategories} */
  static nodeCategories = EMPTY_CATEGORIES;

  /**
   * @param {{ source: string, trace: Object[], ast?: Object|null, consoleLogs?: Object[], maxSteps?: number }} init
   */
  constructor(init) {
    this._init(init);
  }

  _init({ source, trace, ast = null, consoleLogs = [], maxSteps = 0 }) {
    this.source      = source;
    this.maxSteps    = maxSteps;
    this.ast         = ast;          // 解析済み AST（制御フロービュー用）
    this.trace       = trace;        // TraceEvent[]
    this.consoleLogs = consoleLogs;  // ConsoleLog[]
    this.cursor      = 0;            // 現在位置（0 始まり）
  }

  /**
   * 事前計算済みトレースからインスタンスを生成する（評価器をバイパス）。
   * 呼び出したクラスのインスタンスを返す（JSDebugger.fromTrace() なら JSDebugger）。
   * ExecutionError をキャッチした側が部分トレースを閲覧可能にするために使う。
   */
  static fromTrace(source, trace, ast, consoleLogs) {
    const inst = Object.create(this.prototype);
    inst._init({ source, trace, ast, consoleLogs, maxSteps: 0 });
    return inst;
  }

  /** humanStep の停止点の計算に使うノード分類（クラスの static nodeCategories） */
  get nodeCategories() {
    return this.constructor.nodeCategories ?? EMPTY_CATEGORIES;
  }

  // ─── 状態参照 ────────────────────────────────────────────────────────────────

  /** 実行が完了しているか */
  isDone() {
    return this.cursor >= this.trace.length;
  }

  /** 現在の TraceEvent を返す（done の場合は null） */
  getCurrentEvent() {
    return this.isDone() ? null : this.trace[this.cursor];
  }

  /** 現在のコールスタック */
  getCallStack() {
    const ev = this.getCurrentEvent();
    return ev ? ev.callStack.slice() : [];
  }

  /**
   * 現在のスコープ変数を返す。
   * @param {'local'|'all'} [scope='local']
   *   'local' → 最内スコープのみ
   *   'all'   → スコープチェーン全体（フラット化、上書きなし）
   */
  getVariables(scope = 'local') {
    const ev = this.getCurrentEvent();
    if (!ev) return {};
    if (scope === 'local') {
      return { ...(ev.env[0] || {}) };
    }
    const result = {};
    for (let i = ev.env.length - 1; i >= 0; i--) {
      Object.assign(result, ev.env[i]);
    }
    return result;
  }

  /**
   * 現在の cursor までに出力されたコンソールログを返す。
   * @returns {{ atIndex: number, level: string, text: string, eol?: boolean }[]}
   */
  getConsoleOutput() {
    return this.consoleLogs.filter(log => log.atIndex <= this.cursor);
  }

  /** 最後の exit イベントの value（プログラム完了後） */
  getResult() {
    if (this.trace.length === 0) return undefined;
    const last = this.trace[this.trace.length - 1];
    return last.phase === 'exit' ? last.value : undefined;
  }

  // ─── ステップ操作 ────────────────────────────────────────────────────────────

  /** stepIn — 次のイベントへ（深さ問わず） */
  stepIn() {
    if (!this.isDone()) this.cursor++;
    return this._result();
  }

  /**
   * stepOver — 現在ノードの評価をまとめてスキップ
   * - 現在が enter(N) → N に対応する exit(N) へジャンプ
   * - 現在が exit    → cursor++（stepIn と同じ）
   */
  stepOver() {
    if (this.isDone()) return this._result();
    const ev = this.getCurrentEvent();
    if (ev.phase === 'enter') {
      this.cursor = ev.matchIdx;
    } else {
      this.cursor++;
    }
    return this._result();
  }

  /**
   * stepOut — 現在の関数呼び出しを抜ける
   * - callDepth < currentCallDepth になる最初の exit へジャンプ
   * - callDepth === 0（トップレベル）の場合は末尾へ
   */
  stepOut() {
    if (this.isDone()) return this._result();
    const currentCallDepth = this.getCurrentEvent().callDepth;
    if (currentCallDepth === 0) {
      this.cursor = this.trace.length;
      return this._result();
    }
    for (let i = this.cursor + 1; i < this.trace.length; i++) {
      const ev = this.trace[i];
      if (ev.phase === 'exit' && ev.callDepth < currentCallDepth) {
        this.cursor = i;
        return this._result();
      }
    }
    this.cursor = this.trace.length;
    return this._result();
  }

  /** stepBack — 1ステップ前に戻る（常に O(1)）。cursor === 0 の場合は no-op。 */
  stepBack() {
    if (this.cursor > 0) this.cursor--;
    return this._result();
  }

  /**
   * continue — ブレークポイントまたは末尾まで実行
   * @param {Array<{line:number, column?:number}>} [breakpoints=[]]
   */
  continue(breakpoints = []) {
    if (this.isDone()) return this._result();
    for (let i = this.cursor + 1; i < this.trace.length; i++) {
      const ev = this.trace[i];
      if (ev.phase === 'enter' && breakpoints.some(bp => bp.line === ev.loc.line && (bp.column === undefined || bp.column === ev.loc.column))) {
        this.cursor = i;
        return this._result();
      }
    }
    this.cursor = this.trace.length;
    return this._result();
  }

  // ─── ヒューマンステップ ──────────────────────────────────────────────────────

  /**
   * 「意味のある変化点」インデックスの集合を遅延計算する。nodeCategories の役割ごとに：
   *
   *   ① stopOnExit の exit
   *   ② call（ユーザー定義関数のみ。callDepth の増加で判定）
   *      (A) enter — 関数を呼ぼうとしている瞬間
   *      (B) 関数本体の最初の文の enter — 関数に入った直後
   *      (C) exit  — 関数が返った瞬間（戻り値確定）
   *   ③ branch：直後の子（条件式）の exit（1 回のみ）
   *   ④ condLoop：直下の子のうち block 以外の exit（毎回の条件式）
   *   ⑤ forLoop：直下の子のうち block・forInit 以外の exit（条件式・更新式）
   *   ⑥ exprStmt：中に他の停止点がない式文の exit
   *   ⑥b exprStmt：失敗した（正しい exit がない）式文の enter
   *
   * @returns {Set<number>}
   */
  _getHumanIndices() {
    if (this._humanIndices) return this._humanIndices;

    const cat = this.nodeCategories;
    const STOP_ON_EXIT = new Set(cat.stopOnExit);
    const CALL         = new Set(cat.call);
    const BLOCK        = new Set(cat.block);
    const BRANCH       = new Set(cat.branch);
    const COND_LOOP    = new Set(cat.condLoop);
    const FOR_LOOP     = new Set(cat.forLoop);
    const FOR_INIT     = new Set(cat.forInit);
    const EXPR_STMT    = new Set(cat.exprStmt);

    const set   = new Set();
    const trace = this.trace;

    // call ごとの追跡スタック
    //   baseCallDepth: 呼び出し時点の callDepth / enterIdx: enter のトレースインデックス
    //   state: 0=未入場 1=入場済み(最初の文待ち) 2=最初の文追加済み / innerDepth: block.depth+1（−1 は未確定）
    const callStack = [];

    for (let i = 0; i < trace.length; i++) {
      const ev = trace[i];

      // ① 無条件に対象の exit
      if (ev.phase === 'exit' && STOP_ON_EXIT.has(ev.nodeType)) {
        set.add(i);
      }

      // ② call
      if (ev.phase === 'enter' && CALL.has(ev.nodeType)) {
        callStack.push({ baseCallDepth: ev.callDepth, enterIdx: i, state: 0, innerDepth: -1 });
      }

      if (callStack.length > 0) {
        const top = callStack[callStack.length - 1];
        if (ev.callDepth > top.baseCallDepth) {
          // 関数本体に入った
          if (top.state === 0) {
            top.state = 1;
            set.add(top.enterIdx);   // (A)
          }
          // (B) 関数本体の最初の文を探す
          if (top.state === 1 && ev.phase === 'enter') {
            if (BLOCK.has(ev.nodeType) && top.innerDepth < 0) {
              top.innerDepth = ev.depth + 1;   // ブロック本体：次の depth+1 のノードが最初の文
            } else if (top.innerDepth < 0) {
              set.add(i);                      // 式本体の関数（ブロックなし）：このノードが本体
              top.state = 2;
            } else if (ev.depth === top.innerDepth) {
              set.add(i);                      // ブロック直下の最初の文
              top.state = 2;
            }
          }
        }
      }

      if (ev.phase === 'exit' && CALL.has(ev.nodeType)) {
        const info = callStack.pop();
        if (info && info.state > 0) set.add(i);   // (C)
      }

      // ③ branch：enter の直後が条件式の enter なので、その matchIdx が条件式 exit
      if (ev.phase === 'enter' && BRANCH.has(ev.nodeType)) {
        if (i + 1 < trace.length && trace[i + 1].phase === 'enter') {
          set.add(trace[i + 1].matchIdx);
        }
      }

      // ④ condLoop：ループ範囲内の depth+1 の exit で block 以外が条件式
      if (ev.phase === 'enter' && COND_LOOP.has(ev.nodeType)) {
        const loopDepth = ev.depth;
        for (let j = i + 1; j < ev.matchIdx; j++) {
          const inner = trace[j];
          if (inner.phase === 'exit' && inner.depth === loopDepth + 1 && !BLOCK.has(inner.nodeType)) {
            set.add(j);
          }
        }
      }

      // ⑤ forLoop：テスト式・更新式 exit（初期化部・本体以外）
      if (ev.phase === 'enter' && FOR_LOOP.has(ev.nodeType)) {
        const forDepth = ev.depth;
        for (let j = i + 1; j < ev.matchIdx; j++) {
          const inner = trace[j];
          if (inner.phase === 'exit' && inner.depth === forDepth + 1 &&
              !FOR_INIT.has(inner.nodeType) && !BLOCK.has(inner.nodeType)) {
            set.add(j);
          }
        }
      }
    }

    // ⑥ exprStmt：中に既存の停止点が存在しない式文の exit を追加する（二重停止を防ぐ）
    for (let i = 0; i < trace.length; i++) {
      const ev = trace[i];
      if (ev.phase === 'exit' && EXPR_STMT.has(ev.nodeType)) {
        const enterIdx = ev.matchIdx;
        if (enterIdx < 0 || enterIdx >= trace.length) continue;
        let hasInner = false;
        for (let j = enterIdx + 1; j < i; j++) {
          if (set.has(j)) { hasInner = true; break; }
        }
        if (!hasInner) set.add(i);
      }
    }

    // ⑥b 失敗した exprStmt（対応する exit が存在しない）の enter を停止点にする
    for (let i = 0; i < trace.length; i++) {
      const ev = trace[i];
      if (ev.phase === 'enter' && EXPR_STMT.has(ev.nodeType)) {
        const m = ev.matchIdx;
        const hasProperExit = m >= 0
          && m < trace.length
          && trace[m].phase === 'exit'
          && trace[m].nodeType === ev.nodeType
          && trace[m].matchIdx === i;
        if (!hasProperExit) set.add(i);
      }
    }

    this._humanIndices = set;
    return set;
  }

  /** ソースコードの指定行を返す（1 始まり、前後の空白を除く） */
  getSourceLine(line) {
    if (!this._sourceLines) {
      this._sourceLines = this.source.split('\n');
    }
    return (this._sourceLines[line - 1] || '').trim();
  }

  /** humanStep — 次の「意味のある変化点」まで進む */
  humanStep() {
    if (this.isDone()) return this._result();
    const humanSet = this._getHumanIndices();
    for (let i = this.cursor + 1; i < this.trace.length; i++) {
      if (humanSet.has(i)) {
        this.cursor = i;
        return this._result();
      }
    }
    this.cursor = this.trace.length;
    return this._result();
  }

  /** humanStepBack — 直前の「意味のある変化点」に戻る。cursor === 0 の場合は no-op。 */
  humanStepBack() {
    if (this.cursor === 0) return this._result();
    const humanSet = this._getHumanIndices();
    for (let i = this.cursor - 1; i >= 0; i--) {
      if (humanSet.has(i)) {
        this.cursor = i;
        return this._result();
      }
    }
    this.cursor = 0;
    return this._result();
  }

  /** @returns {{ done: boolean, event: Object|null }} */
  _result() {
    return {
      done:  this.isDone(),
      event: this.getCurrentEvent(),
    };
  }
}

export { TraceDebugger, ExecutionError, finalizePartialTrace, EMPTY_CATEGORIES };

import { parse }       from '../parser/parser.js';
import { evaluate, createGlobalEnv, Recorder } from './interpreter.js';

/**
 * JSDebugger — ステップ実行 API
 *
 * 設計：スナップショット配列方式（オムニシェント・デバッグ）
 *
 * 1. コンストラクターでプログラムを最後まで実行し、
 *    全ノードの enter/exit イベントを trace 配列に記録する。
 * 2. ステップ操作は trace 配列の cursor 操作に還元される。
 *
 * TraceEvent:
 *   phase:     'enter' | 'exit'
 *   nodeType:  string            — AST ノード型
 *   loc:       {line, column}    — ソース位置
 *   depth:     number            — ASTネスト深さ（Program=0, 子=1…）
 *   callDepth: number            — 関数呼び出し深さ
 *   callStack: Frame[]           — コールスタックのスナップショット
 *   env:       EnvSnapshot       — 変数状態（スコープチェーンの各フレーム）
 *   value?:    any               — phase==='exit' のときの評価結果
 *   matchIdx:  number            — 対応する exit/enter のインデックス
 *
 * ステップ操作：
 *   stepIn    : cursor++（次のイベントへ、深さ問わず）
 *   stepOver  : 現在が enter → matchIdx へジャンプ（子をスキップ）
 *               現在が exit  → cursor++
 *   stepOut   : callDepth < currentCallDepth になる次の exit へジャンプ
 *               callDepth が 0 のときはプログラム末尾へ
 *   stepBack  : cursor--（常に O(1)）
 */
class JSDebugger {
  /**
   * @param {string} source  実行するソースコード
   * @param {Object} [options]
   * @param {number} [options.maxSteps=100_000]  最大ステップ数
   */
  constructor(source, options = {}) {
    this.source   = source;
    this.maxSteps = options.maxSteps ?? 100_000;

    // ── フェーズ1：記録 ────────────────────────────────────────────────────
    const ast      = parse(source);
    const recorder = new Recorder();
    const env      = createGlobalEnv(recorder);   // console を横取り

    evaluate(ast, env, recorder, 0, 0);

    this.ast         = ast;                   // 解析済み AST（制御フロービュー用）
    this.trace       = recorder.trace;        // TraceEvent[]
    this.consoleLogs = recorder.consoleLogs;  // ConsoleLog[]
    this.cursor = 0;                          // 現在位置（0 始まり）
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
   * atIndex <= cursor のエントリのみを返すことで、ステップに応じて
   * 出力が積み上がる様子を再現できる。
   * @returns {{ atIndex: number, level: string, text: string }[]}
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

  /**
   * stepIn — 次のイベントへ（深さ問わず）
   * @returns {StepResult}
   */
  stepIn() {
    if (!this.isDone()) this.cursor++;
    return this._result();
  }

  /**
   * stepOver — 現在ノードの評価をまとめてスキップ
   * - 現在が enter(N) → N に対応する exit(N) へジャンプ
   * - 現在が exit    → cursor++（stepIn と同じ）
   * @returns {StepResult}
   */
  stepOver() {
    if (this.isDone()) return this._result();

    const ev = this.getCurrentEvent();
    if (ev.phase === 'enter') {
      // matchIdx が exit イベントを指している
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
   * @returns {StepResult}
   */
  stepOut() {
    if (this.isDone()) return this._result();

    const currentCallDepth = this.getCurrentEvent().callDepth;

    if (currentCallDepth === 0) {
      // トップレベル：末尾へ
      this.cursor = this.trace.length;
      return this._result();
    }

    // callDepth が減る exit イベントを探す
    for (let i = this.cursor + 1; i < this.trace.length; i++) {
      const ev = this.trace[i];
      if (ev.phase === 'exit' && ev.callDepth < currentCallDepth) {
        this.cursor = i;
        return this._result();
      }
    }

    // 見つからなければ末尾へ
    this.cursor = this.trace.length;
    return this._result();
  }

  /**
   * stepBack — 1ステップ前に戻る（常に O(1)）
   * cursor === 0 の場合は no-op。
   * @returns {StepResult}
   */
  stepBack() {
    if (this.cursor > 0) this.cursor--;
    return this._result();
  }

  /**
   * continue — ブレークポイントまたは末尾まで実行
   * @param {Array<{line:number, column?:number}>} [breakpoints=[]]
   * @returns {StepResult}
   */
  continue(breakpoints = []) {
    if (this.isDone()) return this._result();

    const start = this.cursor + 1;
    for (let i = start; i < this.trace.length; i++) {
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
   * 「意味のある変化点」インデックスの集合を遅延計算する。
   *
   * 対象イベント:
   *   - exit: VariableDeclaration / AssignmentExpression / UpdateExpression
   *   - exit: ReturnStatement / ThrowStatement
   *   - enter: CallExpression（ユーザー定義関数のみ）           ← 呼び出し直前
   *   - enter: 関数本体の最初のステートメント                   ← 関数に入った直後
   *   - exit:  CallExpression（ユーザー定義関数のみ）           ← 関数が返った直後
   *   - exit: IfStatement / ConditionalExpression の条件式（true/false 確定時）
   *   - exit: WhileStatement / DoWhileStatement の条件式（ループごと）
   *   - exit: ForStatement のテスト式（init/body 以外の depth+1 exit）
   *
   * @returns {Set<number>}
   */
  _getHumanIndices() {
    if (this._humanIndices) return this._humanIndices;

    const set   = new Set();
    const trace = this.trace;

    // 無条件に対象となる exit ノード型
    const ALWAYS_EXIT = new Set([
      'VariableDeclaration',
      'AssignmentExpression',
      'UpdateExpression',
      'ReturnStatement',
      'ThrowStatement',
    ]);

    // CallExpression ごとの追跡スタック
    // {
    //   baseCallDepth: number,   // CallExpression 時点の callDepth
    //   enterIdx:      number,   // enter CallExpression のトレースインデックス
    //   state:         0|1|2,    // 0=未入場 1=入場済み(最初stmt待ち) 2=最初stmt追加済み
    //   innerDepth:    number,   // BlockStatement.depth+1（−1 は未確定）
    // }
    const callStack = [];

    for (let i = 0; i < trace.length; i++) {
      const ev = trace[i];

      // ① 無条件に対象の exit
      if (ev.phase === 'exit' && ALWAYS_EXIT.has(ev.nodeType)) {
        set.add(i);
      }

      // ② CallExpression：ユーザー定義関数呼び出しのみ（callDepth 増加で判定）
      //
      //   humanStep で止まる3点：
      //     (A) enter CallExpression  — 関数を呼ぼうとしている瞬間
      //     (B) 関数本体の最初のステートメント enter — 関数に入った直後
      //     (C) exit  CallExpression  — 関数が返った瞬間（戻り値確定）
      if (ev.phase === 'enter' && ev.nodeType === 'CallExpression') {
        callStack.push({
          baseCallDepth: ev.callDepth,
          enterIdx:      i,
          state:         0,
          innerDepth:    -1,
        });
      }

      if (callStack.length > 0) {
        const top = callStack[callStack.length - 1];

        if (ev.callDepth > top.baseCallDepth) {
          // 関数本体に入った
          if (top.state === 0) {
            top.state = 1;
            set.add(top.enterIdx);   // (A) enter CallExpression を追加
          }

          // (B) 関数本体の最初のステートメントを探す
          if (top.state === 1 && ev.phase === 'enter') {
            if (ev.nodeType === 'BlockStatement' && top.innerDepth < 0) {
              // ブロック本体：次の depth+1 のノードが最初のステートメント
              top.innerDepth = ev.depth + 1;
            } else if (top.innerDepth < 0) {
              // 式本体のアロー関数（BlockStatement なし）：このノードが本体
              set.add(i);
              top.state = 2;
            } else if (ev.depth === top.innerDepth) {
              // BlockStatement の直下の最初のステートメント
              set.add(i);
              top.state = 2;
            }
          }
        }
      }

      if (ev.phase === 'exit' && ev.nodeType === 'CallExpression') {
        const info = callStack.pop();
        if (info && info.state > 0) set.add(i);   // (C) exit CallExpression を追加
      }

      // ③ IfStatement / ConditionalExpression：条件式 exit（1回のみ）
      //    enter の直後が条件式の enter なので、そのmatchIdx が条件式 exit
      if (ev.phase === 'enter' &&
          (ev.nodeType === 'IfStatement' || ev.nodeType === 'ConditionalExpression')) {
        if (i + 1 < trace.length && trace[i + 1].phase === 'enter') {
          set.add(trace[i + 1].matchIdx);
        }
      }

      // ④ WhileStatement / DoWhileStatement：繰り返し条件 exit
      //    ループ範囲内の depth+1 の exit で BlockStatement 以外が条件式
      if (ev.phase === 'enter' &&
          (ev.nodeType === 'WhileStatement' || ev.nodeType === 'DoWhileStatement')) {
        const loopDepth = ev.depth;
        const endIdx    = ev.matchIdx;
        for (let j = i + 1; j < endIdx; j++) {
          const inner = trace[j];
          if (inner.phase === 'exit' &&
              inner.depth === loopDepth + 1 &&
              inner.nodeType !== 'BlockStatement') {
            set.add(j);
          }
        }
      }

      // ⑤ ForStatement：テスト式 exit（init=VariableDeclaration, body=BlockStatement 以外）
      if (ev.phase === 'enter' && ev.nodeType === 'ForStatement') {
        const forDepth = ev.depth;
        const endIdx   = ev.matchIdx;
        for (let j = i + 1; j < endIdx; j++) {
          const inner = trace[j];
          if (inner.phase === 'exit' &&
              inner.depth === forDepth + 1 &&
              inner.nodeType !== 'VariableDeclaration' &&
              inner.nodeType !== 'BlockStatement') {
            set.add(j);
          }
        }
      }
    }

    this._humanIndices = set;
    return set;
  }

  /**
   * ソースコードの指定行を返す（1 始まり）。
   * @param {number} line
   * @returns {string}
   */
  getSourceLine(line) {
    if (!this._sourceLines) {
      this._sourceLines = this.source.split('\n');
    }
    return (this._sourceLines[line - 1] || '').trim();
  }

  /**
   * humanStep — 次の「意味のある変化点」まで進む
   *
   * リテラル・識別子・演算子の中間評価など、人間が紙でトレースしないような
   * 細粒度のイベントをスキップする。
   * @returns {StepResult}
   */
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

  /**
   * humanStepBack — 直前の「意味のある変化点」に戻る
   * cursor === 0 の場合は no-op。
   * @returns {StepResult}
   */
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

  // ─── 内部ヘルパー ────────────────────────────────────────────────────────────

  /**
   * @returns {StepResult}
   *   done:      boolean
   *   event:     TraceEvent | null
   */
  _result() {
    return {
      done:  this.isDone(),
      event: this.getCurrentEvent(),
    };
  }
}

export { JSDebugger };

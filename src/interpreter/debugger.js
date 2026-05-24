'use strict';

const { parse }       = require('../parser/parser');
const { evaluate, createGlobalEnv, Recorder } = require('./interpreter');

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
    const env      = createGlobalEnv();
    const recorder = new Recorder();

    evaluate(ast, env, recorder, 0, 0);

    this.trace  = recorder.trace;  // TraceEvent[]
    this.cursor = 0;               // 現在位置（0 始まり）
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

module.exports = { JSDebugger };

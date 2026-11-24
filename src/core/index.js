/**
 * core — 言語非依存の共通コア
 *
 * 言語ごとの評価器（JS は src/interpreter/、Python は PyVisualizer）がこれらを使ってトレースを作り、
 * TraceDebugger の派生クラスでステップ実行 API を提供する。詳細は docs/detailed-design.md「共通コア」節。
 *
 *   import { Recorder, TraceDebugger, Scope, ... } from 'js-interpreter/core';
 */
export { ReturnSignal, BreakSignal, ContinueSignal, ThrowSignal } from './signals.js';
export { deepClone, createCloner } from './clone.js';
export { Scope, snapshotChain } from './scope.js';
export { Recorder, joinConsoleLines } from './recorder.js';
export { TraceDebugger, ExecutionError, finalizePartialTrace, EMPTY_CATEGORIES } from './trace-debugger.js';

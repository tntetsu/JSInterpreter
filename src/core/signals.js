/**
 * signals.js — 制御フローのシグナル（言語非依存の共通コア）
 *
 * return / break / continue / throw は例外ではなく、これらのインスタンスを評価結果として返して伝播させる。
 * Recorder は ReturnSignal / ThrowSignal を unwrap して TraceEvent の value に実際の値を記録する。
 */
class ReturnSignal   { constructor(v) { this.value = v; } }
class BreakSignal    {}
class ContinueSignal {}
class ThrowSignal    { constructor(v) { this.value = v; } }

export { ReturnSignal, BreakSignal, ContinueSignal, ThrowSignal };

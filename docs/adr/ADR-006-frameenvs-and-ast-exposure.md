# ADR-006: frameEnvsの記録とAST公開（lexical scope対応）

- **決定日**: 2026-06-04
- **作成日**: 2026-08-10（JSVisualizer側の履歴と突き合わせて事後的に作成）
- **ステータス**: 承認済み

## 背景・課題

利用側のJSVisualizerで、lexical scoping（静的スコープ）に関する問題が
発覚した。相互再帰・純粋再帰のケースで、外側フレームの変数がenvチェーン
に含まれず、コールスタック表示が不正確になる問題があった（詳細は
[JSVisualizer ADR-011](../../../JSVisualizer/docs/adr/ADR-011-frameenvs-lexical-scope.md)）。
また同時期に、制御フロービューをASTベースの構造的フローチャートに刷新する
作業（[JSVisualizer ADR-018](../../../JSVisualizer/docs/adr/ADR-018-controlflow-ast-refactor.md)）
が進んでおり、JSDebuggerがASTそのものを公開する必要が生じた。

## 決定

- 各アクティブフレームの`callEnv`スナップショット（`frameEnvs`）を
  `TraceEvent`に追加する（コミット`3e38ca5`、2026-06-04 09:04）。
- `JSDebugger`にASTを`this.ast`として公開する（コミット`ec01f6f`、
  2026-06-04 13:45）。

## 根拠

利用側（JSVisualizer）の要求に応じて、インタープリター側のトレース
イベントが持つ情報を拡張した。lexical scopeの正確な表現とASTベースの
可視化は、いずれもJSVisualizer側の可視化機能の精度向上に必要だった。

## 一次資料についての注記

本ADRの対応するセッションログはJSInterpreter側に残っていない。決定日が
JSVisualizer側のADR-011・ADR-018と完全に一致することから、利用側の要求に
応じてJSInterpreter側を修正したものと推測される。確度は「git ログ・
コミットメッセージ・姉妹プロジェクトのADRとの日付一致」に基づくもので、
[ADR-001](ADR-001-omniscient-debugging.md)〜[005](ADR-005-codetrace-line-linked-table.md)
（セッションログで一言一句確認済み）より確度が低い。

# ADR-007: エラー分類の統一とtry-catchホスト例外変換

- **決定日**: 2026-06-15
- **作成日**: 2026-08-10（JSVisualizer側の履歴と突き合わせて事後的に作成）
- **ステータス**: 承認済み

## 背景・課題

利用側のJSVisualizerで、エラーハンドリングの見直しが行われた
（[JSVisualizer ADR-020](../../../JSVisualizer/docs/adr/ADR-020-try-catch-host-exception.md)）。
インタープリターは制御フローに「シグナルオブジェクト」パターンを採用
しており、`throw`文は`ThrowSignal`を戻り値として返す設計になっていたが、
インタープリター内部の評価中に発生する**ホスト例外**（実際のJS例外）が
`ThrowSignal`に変換されず、ユーザーコードの`catch`で捕捉できない問題が
あった。また、`maxSteps`超過エラーを独立した`MaxStepsError`として分類
していたが、これは「一種の実行時エラー」として扱う方が自然だった。

## 決定

- `try-catch`におけるホスト例外を`ThrowSignal`に変換する（コミット
  `dd466f5`、2026-06-15 19:13）。
- `MaxStepsError`を廃止し、`ExecutionError`に統一する（コミット
  `488277e`、2026-06-15 18:10）。
- `tryブロック`失敗時のトレースイベント保持ロジックを複数回にわたり
  改善（`21404d6`, `6101341`, `09e0271`、いずれも2026-06-15）。
- `humanStep`にネイティブ関数呼び出し等を停止点として追加（rule⑥、
  コミット`2bbaa49`）。

## 一次資料についての注記

本ADRの対応するセッションログはJSInterpreter側に残っていない。決定日が
JSVisualizer側のADR-020と完全に一致することから、利用側の要求・発見に
応じてJSInterpreter側を修正したものと推測される。確度は
[ADR-006](ADR-006-frameenvs-and-ast-exposure.md)と同様の注記を参照。

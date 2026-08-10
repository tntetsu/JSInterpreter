# ADR-009: ReturnSignal/ThrowSignalのunwrapと分割代入サポート

- **決定日**: 2026-05-26
- **作成日**: 2026-08-10（JSVisualizer側の履歴と突き合わせて事後的に作成）
- **ステータス**: 承認済み

## 背景・課題

利用側のJSVisualizerで、`humanStep`の停止タイミングを「値が確定してから
記録する」ように統一する修正が行われた（`VariableDeclaration` /
`ReturnStatement` / `ThrowStatement`の停止をenterからexitに統一、
コミット`5abd6b8`、2026-05-26 18:49）。この修正が機能するためには、
インタープリター側のtraceが`ReturnSignal`/`ThrowSignal`を内部表現の
ままではなく、実際の値としてunwrapして記録する必要があった。

## 決定

- `trace`の`ReturnSignal`/`ThrowSignal`をunwrapして実際の値を記録する
  よう修正（コミット`42e4873`、2026-05-26 18:41 — JSVisualizer側の修正
  （18:49）の8分前）。
- `assignTo`で配列・オブジェクトの分割代入をサポート（コミット
  `26d5c7f`、2026-05-26 19:14）。

## 一次資料についての注記

`42e4873`はJSVisualizer側の`5abd6b8`（8分後）と強く相関しており、
利用側の要求に応じた修正である可能性が高い。一方`26d5c7f`（分割代入
サポート）については、対応するJSVisualizer側の直接的な言及が見つから
ず、確度は低い（同時間帯の作業の一部として記録した）。対応するセッション
ログはJSInterpreter側に残っていない。

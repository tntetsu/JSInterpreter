# ADR-011: CallExpressionのレシーバー二重評価とゲスト関数のネイティブ呼び出し修正

- **決定日**: 2026-08-05
- **作成日**: 2026-08-10（JSVisualizer側の履歴と突き合わせて事後的に作成）
- **ステータス**: 承認済み

## 背景・課題

利用側のJSVisualizerで、マージソート・Sort objects系のサンプルプログラム
が動作しない不具合が発覚した。原因は`CallExpression`評価時の**レシーバー
二重評価**と、**ゲスト関数のネイティブ呼び出し未対応**の2点だった
（JSVisualizer CLAUDE.md、コミット`0ac8364`、2026-08-05）。

## 決定

`CallExpression`のレシーバー二重評価とゲスト関数の未対応ネイティブ呼び
出しを修正する（コミット`1455431`、2026-08-05 11:54）。

## 学び

このバグは、サンプルプログラムを**実際に動かしてみて初めて発覚した**
不具合であり、`agentic-coding-notes`の`03-failure-cases.md`「Case 5」
にも同種の事例として記録されている。JSVisualizer側で問題を発見し、
依存先であるJSInterpreter側を修正するという構図は、
[ADR-006](ADR-006-frameenvs-and-ast-exposure.md)〜[009](ADR-009-signal-unwrap-and-destructuring.md)
と共通するパターンである。

## 一次資料についての注記

対応するセッションログはJSInterpreter側に残っていない。JSVisualizer側の
CLAUDE.mdの記述（同日、原因の詳細まで一致）から再構成した。

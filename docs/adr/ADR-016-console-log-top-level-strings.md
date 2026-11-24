# ADR-016: console.log の 2 番目以降の文字列の引数に引用符が付く不具合を直す

## ステータス

提案（2026-11-24）。修正は作業ブランチ `fix/console-log-args` にある。master へのマージと JSVisualizer の公開版への反映の時期は未定（下の「判断が必要なこと」）。

## コンテキスト

`console.log(1, "a")` の出力が、Node.js やブラウザの `1 a` ではなく `1 'a'` になる。最上位の引数のうち、2 番目以降の文字列に引用符が付く。

[ADR-015](ADR-015-shared-core.md)（共通コアの切り出し）で、master と作業ブランチのトレースを比べたときに見つかった。ADR-015 は「挙動を変えない」方針なので、この挙動はそのまま残している。

### 原因

2026-06-04 のコミット `6def082`（「console.log で配列・オブジェクト内の文字列にシングルクォートを付与」）で、`formatLogArg(v)` に `depth` 引数を足し、`depth > 0` の文字列に引用符を付けるようにした。しかし呼び出し側の `Recorder.captureLog` の `args.map(formatLogArg)` は直していない。`Array.prototype.map` はコールバックに `(要素, 添字, 配列)` を渡すので、引数の添字が `depth` として渡る。その結果、2 番目以降の引数は `depth ≥ 1` として整形される。

影響は、最上位の文字列の引数に引用符が付くことだけである。配列・オブジェクトの中の値はもともと `depth + 1` で整形されるので、表示は変わらない。

この挙動は詳細設計書 §5.9 の仕様（「`depth === 0`（最上位の引数）の文字列はクォートなし」「Node.js 互換」）に反する。意図したものではない。

### 影響の範囲

JSVisualizer の組み込みサンプル・記事の題材、examples、BhvVisualizer の授業の演習（`its/exercices/` の 24 ファイル）など計 194 プログラムを、修正の前後で実行して比べた（PyVisualizer の `scripts/compare-js-core.mjs`）。コンソールの出力が変わるのは、授業の教材では 1 つだけだった。

- **ソフトウェア基礎論 第11回 課題3「挿入ソートのログ出力順」**（`session-11-exercise.json` の 3 番目のコード）
  - コード：`console.log('insert', tmp, 'at', k);`
  - 現在の JSVisualizer の表示：`insert 2 'at' 0`
  - 修正後（Node.js と同じ）：`insert 2 at 0`
  - Moodle の解答欄は完全一致の短答式で、正答は `insert 2 at 0`（BhvVisualizer `its/moodle-quiz/session-11.txt`）。**JSVisualizer のコンソールの表示をそのまま書き写すと不正解になる**
  - 同じ課題の `console.log('shift', data[k - 1])` は、2 番目の引数が数値なので影響を受けない

## 決定

`captureLog` で、最上位の引数を常に `depth = 0` で整形する（`args.map(a => formatLogArg(a))`）。`console.log`・`console.warn`・`console.error`・`console.info`・`console.debug` のすべてに効く。

テスト 3 件を追加した（`debugger.test.js` の「console.log の出力」）。修正を外すと 3 件とも失敗し、修正後は全 269 件が通る。

## 判断が必要なこと

### 1. 反映の時期

修正は 1 行だが、学生の画面（コンソールの表示）が変わる。JSInterpreter・JSVisualizer への変更は学期後（2027年2月以降）にマージする方針がある（PyVisualizer の計画書 6 節）。ただしこの方針は、共通コアの切り出しなどのリファクタリングについて決めたもの。学期中の不具合の修正は、これまでも BhvVisualizer の評価計画 3.9 節に記録したうえで公開してきた。

| 選択肢 | 内容 | 第11回 課題3への影響 |
|---|---|---|
| A. 第11回の前に反映する | master にマージし、JSVisualizer を再ビルドして公開する。評価計画 3.9 節の表に記録する | 学生が見る表示と正答が一致する |
| B. 学期後に反映する | 学期中は今の表示のまま | 表示を書き写した学生が不正解になる。採点の見直しや、レビュー欄での説明が必要になる |

**推奨は A**（第11回がまだなら）。変わるのはコンソールの表示だけで、ログの形式・ビュー・トレースは変わらない（194 プログラムの比較で、コンソール以外の差はない）。ほかの回の教材の表示も変わらない。

第11回が既に終わっている場合は、Moodle の回答に `'at'` を含むものがないかを確かめ、あれば採点を見直す。その場合も、今後のために反映はする（A と同じ手順）。

### 2. 共通コアの作業ブランチへの取り込み

`feature/interp-core`（ADR-015）は、master の今の挙動を保つため、JS の Recorder で `formatLogArg` を添字つきで呼んでいる。この修正を master にマージしたら、作業ブランチを master に追従させ、JS の Recorder を `formatLog: (v) => formatLogArg(v)` に直し、ADR-015 の該当の記述を更新する。

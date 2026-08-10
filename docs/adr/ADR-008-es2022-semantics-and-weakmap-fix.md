# ADR-008: var/let/constのES2022準拠と、seen WeakMap共有バグの修正

- **決定日**: 2026-06-16
- **作成日**: 2026-08-10（JSVisualizer側の履歴と突き合わせて事後的に作成）
- **ステータス**: 承認済み

## 背景・課題

利用側のJSVisualizerで、`var`・`let`・`const`がすべて同じ挙動
（ブロックスコープ・巻き上げなし）になっており、ES2022仕様に準拠して
いないことが発覚した（[JSVisualizer ADR-023](../../../JSVisualizer/docs/adr/ADR-023-var-let-const-semantics.md)）。

また、[ADR-001](ADR-001-omniscient-debugging.md)〜[002](ADR-002-deep-clone-snapshot.md)
で導入したスナップショット機構（`WeakMap`によるオブジェクト同一性追跡、
JSVisualizer側では[ADR-019](../../../JSVisualizer/docs/adr/ADR-019-weakmap-object-identity.md)）
に、前提条件のバグが見つかった: `Environment.snapshot()`が各変数の
`deepClone()`を**別々の`seen` WeakMap**で呼んでいたため、同一オブジェクト
（例: グローバル変数と関数引数が同じリストノードを指す場合）が
**別クローンとして生成されてしまう**問題があった。

## 決定

- `var`/`let`/`const`のスコープセマンティクスをES2022仕様に準拠させる
  （コミット`5bac215`、2026-06-16 16:29）。
- `snapshot()`と`snapshotOwn()`の`seen` WeakMapをスコープチェーン全体
  （または各フレーム内）で共有するよう修正する（コミット`cf89d3e`、
  2026-06-16 15:37、`src/interpreter/environment.js`）。

## 根拠

JSVisualizer ADR-019のフォローアップ修正節に、この修正の詳細な原因分析
と対応箇所（`../JSInterpreter/src/interpreter/environment.js`）が明記
されている。「WeakMap追跡は機能的には正しいが、前提条件に問題があった」
という、利用側で発見されたバグをJSInterpreter側で修正した典型例である。

## 一次資料についての注記

本ADRの対応するセッションログはJSInterpreter側に残っていない。決定日が
JSVisualizer側のADR-023・ADR-019フォローアップ修正と完全に一致し、かつ
ADR-019側にJSInterpreterの修正箇所が明記されていることから、確度は
比較的高い（ただし実際の対話ログではなく、姉妹プロジェクトの記述からの
再構成である点は変わらない）。

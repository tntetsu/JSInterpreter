# ADR-010: VirtualDOMサポートの追加（WebJSVisualiser向け拡張）

- **決定日**: 2026-06-12
- **作成日**: 2026-08-10（WebJSVisualiser側の履歴と突き合わせて事後的に作成）
- **ステータス**: 承認済み

## 背景・課題

新規プロジェクトWebJSVisualiser（DOM操作のビジュアル化、JSInterpreterを
共通基盤として利用）の開発にあたり、`document.createElement()`や
`element.textContent = '...'`のようなDOM操作をインタープリター内の変数
環境で動作させる必要が生じた。

WebJSVisualiser側では、既存のDOM実装（jsdom等）ではなく、プレーンJS
オブジェクトによる自前のVirtualDOM実装が選ばれた
（[WebJSVisualiser ADR-003](../../../WebJSVisualiser/docs/decisions/003-virtual-dom-design.md)）。
その理由として「インタープリターの`deepClone`と完全互換」（本プロジェクト
の[ADR-002](ADR-002-deep-clone-snapshot.md)参照）が明記されている——
既存のDOM実装は内部に循環参照が多く、オムニシエントデバッグのスナップ
ショット機構と相性が悪いと判断された。

## 決定

- `options.dom=true`で有効化するVirtualDOMサポートを追加（コミット
  `eeaa5a6`、2026-06-12 17:06）。
- HTMLページ入力モード（`options.initialBodyHTML`）を追加（コミット
  `5532b29`、2026-06-12 18:08）。

## 根拠

WebJSVisualiser側の設計判断（ADR-002のdeepClone機構と互換性を持つ
VirtualDOM）を実現するため、JSInterpreter本体にDOM操作対応を追加した。
JSInterpreterが「共通基盤（コア）」、WebJSVisualiserが「対象固有の
UI・DOM機能」という役割分担
（[WebJSVisualiser ADR-002](../../../WebJSVisualiser/docs/decisions/002-separate-project.md)）
が、この時点で実際に機能していたことを示す実例である。

## 一次資料についての注記

対応するセッションログはJSInterpreter側に残っていない。WebJSVisualiser
側のADR-002・ADR-003の記述内容とコミット日時の一致から再構成した。

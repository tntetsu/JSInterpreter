# JSInterpreter

[![CI](https://github.com/tntetsu/JSInterpreter/actions/workflows/ci.yml/badge.svg)](https://github.com/tntetsu/JSInterpreter/actions/workflows/ci.yml)

> 🌐 [English version (main)](README.md)

JavaScript で書かれた JavaScript インタープリターです。ES6+ 構文をサポートし、**式単位のステップ実行 API**（ステップイン・ステップオーバー・ステップアウト・ステップバック）を提供します。

## 特徴

- **式単位のステップ実行** — 文単位ではなく、すべての AST ノードの評価を個別のステップとして扱います
- **ステップバック（逆方向実行）** — 全評価ステップをスナップショット配列として記録するため、O(1) で過去の状態に戻れます。環境のディープクローンにより、オブジェクト・配列の内部変更も正確に復元されます
- **async/await のサポート** — 同期シミュレーションにより、ネイティブ I/O を含まない非同期コードをステップ実行できます
- **ヒューマンフレンドリーステップ** — `h`/`H` コマンドで中間式をスキップし、代入・条件・ループ・関数呼び出しなど「意味のある変化点」だけを追跡できます
- **プログラム的 API** — `JSDebugger` クラスを使えば、IDE・外部ツールへの組み込みが可能です
- **対話型デバッガー** — CLI から直接ステップ実行できます
- **Web デバッガー UI** — ブラウザ上のビジュアルデバッガー。ソース行ハイライト・変数パネル・コールスタックパネルを提供します
- **ES6+ 対応** — アロー関数・クラス・分割代入・テンプレートリテラルなど主要な構文をサポート

## インストール

```bash
git clone https://github.com/tntetsu/JSInterpreter.git
cd JSInterpreter
npm install
```

## 使い方

### REPL（対話型実行）

```bash
node src/index.js
```

```
JS インタープリター REPL  （終了: .exit または Ctrl+D）
> 1 + 2 * 3
7
> const greet = name => `Hello, ${name}!`
> greet("world")
"Hello, world!"
```

### ファイル実行

```bash
node src/index.js examples/fibonacci.js
```

### 対話型デバッガー

```bash
node src/index.js --debug examples/fibonacci.js
```

```
────────────────────────────────────────────────────────────
JS デバッガー起動  コマンド: n=stepIn  v=stepOver  o=stepOut  b=stepBack
                           p=変数表示  stack=スタック  c=continue  q=終了
────────────────────────────────────────────────────────────
[▶ enter] Program                   line 1:0  (depth=0, callDepth=0)
(debug) > n
[▶ enter] FunctionDeclaration       line 1:0  (depth=1, callDepth=0)
(debug) > c 5
[▶ enter] BinaryExpression          line 5:10  (depth=4, callDepth=1)
(debug) > p
  n = 5
(debug) > v
[◀ exit ] BinaryExpression          line 5:10 → true  (depth=4, callDepth=1)
```

#### デバッガーコマンド

| コマンド | 操作 |
|---------|------|
| `n` または Enter | ステップイン（次のイベントへ） |
| `v` | ステップオーバー（現在ノードをまとめてスキップ） |
| `o` | ステップアウト（現在の関数から抜ける） |
| `b` | ステップバック（1つ前へ戻る） |
| `h` | **ヒューマンステップ**（次の意味のある変化点へ） |
| `H` | **ヒューマンステップバック** |
| `p` | 全変数を表示 |
| `p <変数名>` | 指定変数を表示 |
| `stack` | コールスタックを表示 |
| `c` | 末尾まで実行（continue） |
| `q` | 終了 |

`h` コマンドは AST の生のイベントの代わりに、簡潔な1行サマリーを表示します:

```
[条件  ] line   6  if (arr[j] > arr[j + 1]) {   →  true
[代入  ] line   8  arr[j] = arr[j + 1];           →  1
[更新  ] line   5  for (let j = 0; ...)           →  0
```

### Web デバッガー UI

```bash
# ブラウザ向けバンドルをビルド（初回、またはソース変更後）
npm run build:web

# 開発サーバーを起動（ソース変更時に自動リビルド）
npm run dev:web
# → http://localhost:8000 をブラウザで開く
```

Web UI は2カラムレイアウトです：

| パネル | 内容 |
|-------|------|
| **Source**（左） | 編集モード: コードエディター／デバッグモード: 現在行をハイライト表示、評価中の部分式を黄色でハイライト |
| **Controls**（右上） | Step In / Step Over / Step Out / Step Back / Human Step / Human Back / Continue |
| **Current Step**（右） | phase・nodeType・行:列・depth・callDepth・評価値 |
| **Variables**（右） | 全スコープをマージして表示（内側優先・組み込みグローバル除外）、「スコープ別」チェックでフレームごとの表示に切り替え |
| **Call Stack**（右） | 呼び出しフレームの一覧（関数名・位置・引数の実際の値を表示、例: `fib(5)`） |
| **Console**（右） | `console.log/warn/error` の出力（現在ステップまでの分のみ表示、ステップバック時に遡る） |

#### インライントレース表

Run 後に **`📊 Trace`** ボタン（またはキー `t`）を押すと、ソースコードと行を揃えたインライントレース表が表示されます：

- 各**ソース行の右側**に変数の列と条件式の列が並ぶ（変数は青、条件式は紫）
- **各行を最後に実行した時点の値**が表示され、ステップを進めるたびにリアルタイム更新
- **値が変化したセルがフラッシュ**（変数: 黄、条件式: 紫）してアニメーション
- テーブルは横スクロール可能で、行番号列は固定

```
 #  │ ソースコード               │ arr         │ n │ i │ j │ i<n-1 │ arr[j]>arr[j+1]
────┼────────────────────────────┼─────────────┼───┼───┼───┼───────┼─────────────────
  3 │   const n = arr.length;    │ [5,3,8,1,2] │ 5 │   │   │       │
▶ 4 │   for (let i = 0; …        │ [5,3,8,1,2] │ 5 │ 0 │   │ true  │
  5 │     for (let j = 0; …      │ [5,3,8,1,2] │ 5 │ 0 │ 0 │       │ true
  6 │     if (arr[j] > …         │ [3,5,8,1,2] │ 5 │ 0 │ 0 │       │ false
```

キーボードショートカット（デバッグ中のみ有効、CLI デバッガーと共通）：

| キー | 操作 |
|------|------|
| `n` / Enter | ステップイン |
| `v` | ステップオーバー |
| `o` | ステップアウト |
| `b` | ステップバック |
| `h` | ヒューマンステップ |
| `H` | ヒューマンステップバック |
| `c` | Continue |
| `r` | Reset |
| `t` | トレース表のON/OFF |

ドロップダウンから5種類のサンプルプログラム（フィボナッチ・階乗・バブルソート・クロージャ・クラス）を選択できます。

## プログラム的 API

```javascript
import { JSDebugger } from './src/interpreter/debugger.js';

const dbg = new JSDebugger(`
  function fib(n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
  }
  fib(5);
`);

// ステップイン
const { event, done } = dbg.stepIn();
console.log(event.nodeType, event.phase, event.loc);

// ステップオーバー（子ノードをまとめてスキップ）
dbg.stepOver();

// ステップアウト（現在の関数を抜ける）
dbg.stepOut();

// ステップバック（O(1) で1つ前へ）
dbg.stepBack();

// ブレークポイント実行
dbg.continue([{ line: 3 }]);

// 現在の変数を取得
const vars = dbg.getVariables('all');

// コールスタックを取得
const stack = dbg.getCallStack();
```

### TraceEvent の構造

各ステップは以下の情報を持ちます。

```javascript
{
  phase:     'enter' | 'exit',  // 評価開始 or 評価完了
  nodeType:  'BinaryExpression',
  loc:       { line: 3, column: 5 },
  depth:     2,                 // AST ネスト深さ
  callDepth: 1,                 // 関数呼び出し深さ
  callStack: [{ name: 'fib', loc: { line: 6, column: 0 } }],
  env:       [{ n: 5 }, { fib: [Function] }],  // スコープチェーンのディープクローン
  value:     6,                 // phase === 'exit' のときの評価結果
}
```

### ステップ実行の例

`let x = 1 + 2 * 3;` は以下の 12 ステップに分解されます。

| cursor | phase | nodeType | value |
|--------|-------|----------|-------|
| 0 | enter | VariableDeclaration | — |
| 1 | enter | BinaryExpression(+) | — |
| 2 | enter | Literal | — |
| 3 | exit | Literal | `1` |
| 4 | enter | BinaryExpression(*) | — |
| 5 | enter | Literal | — |
| 6 | exit | Literal | `2` |
| 7 | enter | Literal | — |
| 8 | exit | Literal | `3` |
| 9 | exit | BinaryExpression(*) | `6` |
| 10 | exit | BinaryExpression(+) | `7` |
| 11 | exit | VariableDeclaration | — |

## 対応構文

| カテゴリ | 構文 |
|---------|------|
| 変数 | `let` `const` `var`、分割代入（オブジェクト・配列）、デフォルト値 |
| 関数 | 関数宣言・式・アロー関数・**async 関数**、レスト引数、デフォルト引数、クロージャ、再帰 |
| 非同期 | `async function`、`async () =>`、`await`、`Promise.resolve/reject/all/allSettled/race/any`、`new Promise(executor)` |
| 制御フロー | `if/else`、`while`、`do...while`、`for`、`for...of`、`for...in`、`break/continue`、`return` |
| 例外 | `throw`、`try/catch/finally` |
| クラス | `class`、`constructor`、継承（`extends/super`）、`static`、ゲッター・セッター |
| 演算子 | 算術・比較・論理・ビット・代入・三項・`typeof`・`instanceof`・`in`・`??`・`?.` |
| リテラル | 数値（16進・8進・2進・セパレーター）、テンプレートリテラル（ネスト補間）、`null`・`true`・`false` |
| その他 | スプレッド/レスト（`...`）、短縮プロパティ、計算プロパティ名 |

## アーキテクチャ

```
source
  │
  ▼
Lexer          ソーステキスト → Token[]
  │            (src/lexer/lexer.js)
  ▼
Parser         Token[] → AST（各ノードに loc 付き）
  │            (src/parser/parser.js)
  ▼
evaluate()     AST → ランタイム値 ＋ Recorder へ全イベントを記録
  │            (src/interpreter/interpreter.js)
  ▼
JSDebugger     trace[] のインデックス操作でステップ制御
               (src/interpreter/debugger.js)

src/errors.js  共通エラークラス（LexError, ParseError, RuntimeError）
               全パイプラインステージからインポート — 循環依存を解消
```

コードベースは **ES Modules**（package.json の `"type": "module"`）を採用し、全ファイルで `import`/`export` 構文を使用します。

実行は2フェーズに分かれます。

1. **記録フェーズ** — コンストラクターでプログラムを最後まで実行し、全評価イベントを `trace` 配列に保存
2. **ナビゲーションフェーズ** — `stepIn/stepOver/stepOut/stepBack` は `trace[cursor]` のインデックス操作に還元される（再実行なし）

## 開発

```bash
# 全テストを実行
npm test

# 単一テストファイル
npx jest src/interpreter/debugger.test.js

# ウォッチモード
npm run test:watch
```

テストは 4 ファイル・187 件です。

## 既知の制限・未実装機能

### デバッガー固有の制限

| 制約 | 内容 |
|------|------|
| 無限ループ | プログラムが終了しない場合、記録フェーズが止まらない。`options.maxSteps`（デフォルト: 100,000 ステップ）で上限設定可 |
| ステップバックの精度 | オブジェクト・配列はディープクローンで記録されるため内部変更も正確に再現される。ただし `Map`・`Set`・`Error` 等のネイティブオブジェクトは参照保持のため変更履歴が不正確になる場合がある |

### 未対応の構文

| 構文 | 状況 | 回避策 |
|------|------|--------|
| 正規表現リテラル | `/pattern/` 構文は字句解析エラー | `new RegExp('pattern')` は使用可 |
| `switch` 文 | 未実装 | `if/else if` で代替 |
| ラベル付き文 | `label:` 構文は未実装 | — |
| `with` 文 | 未実装（非推奨構文） | — |
| `function*` / `yield` | ジェネレーター構文は解析できるが実行不可 | — |
| タグ付きテンプレートリテラル | `` tag`...` `` は未実装 | 通常のテンプレートリテラルは使用可 |
| `for await...of` | 未実装 | — |

### ランタイムの制限

| 制限 | 内容 |
|------|------|
| ネイティブ async I/O | `async/await` は同期的にシミュレーションするため、`fetch`・`setTimeout` など本物の非同期 I/O は動作しない |
| ネイティブメソッドへの JSFunction 渡し | `[1,2,3].map(x => x*2)` のような、ネイティブ配列/オブジェクトメソッドにインタープリター内関数を渡す呼び出しは動作しない（コールバックが JSFunction オブジェクトになるため） |
| `arguments` オブジェクト | 関数内の `arguments` は未定義。レスト引数（`...args`）で代替 |
| `WeakRef` / `Proxy` / `Reflect` | グローバルに未登録（必要に応じて追加可能） |
| モジュール | `import/export` は構文解析のみ（ファイル読み込み・モジュール解決は行わない） |

## ドキュメント

- [機能仕様書](docs/functional-specification.ja.md)
- [詳細設計書](docs/detailed-design.ja.md)

## ライセンス

MIT

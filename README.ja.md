# JSInterpreter

[![CI](https://github.com/tntetsu/JSInterpreter/actions/workflows/ci.yml/badge.svg)](https://github.com/tntetsu/JSInterpreter/actions/workflows/ci.yml)

> 🌐 [English version (main)](README.md)

JavaScript で書かれた JavaScript インタープリターです。ES6+ 構文をサポートし、**式単位のステップ実行 API**（ステップイン・ステップオーバー・ステップアウト・ステップバック）を提供します。

## 特徴

- **式単位のステップ実行** — 文単位ではなく、すべての AST ノードの評価を個別のステップとして扱います
- **ステップバック（逆方向実行）** — 全評価ステップをスナップショット配列として記録するため、O(1) で過去の状態に戻れます。環境のディープクローンにより、オブジェクト・配列の内部変更も正確に復元されます
- **async/await のサポート** — 同期シミュレーションにより、ネイティブ I/O を含まない非同期コードをステップ実行できます
- **プログラム的 API** — `JSDebugger` クラスを使えば、IDE・外部ツールへの組み込みが可能です
- **対話型デバッガー** — CLI から直接ステップ実行できます
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
| `p` | 全変数を表示 |
| `p <変数名>` | 指定変数を表示 |
| `stack` | コールスタックを表示 |
| `c` | 末尾まで実行（continue） |
| `q` | 終了 |

## プログラム的 API

```javascript
const { JSDebugger } = require('./src/interpreter/debugger');

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
```

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

テストは 4 ファイル・173 件です。

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

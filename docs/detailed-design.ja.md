# 詳細設計書

**プロジェクト名**: JSInterpreter  
**バージョン**: 1.1.0  
**作成日**: 2026-05-24  
**最終更新**: 2026-05-24  
**対象読者**: 実装者・コードレビュアー

> 🌐 [English version](detailed-design.md)

---

## 1. システム構成

### 1.1 パイプライン概観

```
ソースコード（string）
      │
      ▼
 ┌──────────┐
 │  Lexer   │  src/lexer/lexer.js
 └──────────┘
      │ Token[]
      ▼
 ┌──────────┐
 │  Parser  │  src/parser/parser.js
 └──────────┘
      │ AST（Program ノード）
      ▼
 ┌─────────────────────────────────┐
 │  evaluate(node, env, recorder)  │  src/interpreter/interpreter.js
 │                                 │
 │  recorder が null → 通常実行     │
 │  recorder が Recorder → 記録実行 │
 └─────────────────────────────────┘
      │ TraceEvent[]（記録実行時）
      ▼
 ┌────────────┐
 │ JSDebugger │  src/interpreter/debugger.js
 │  cursor 操作 │  ステップ実行 API
 └────────────┘
```

### 1.2 ディレクトリ構成

```
src/
├── errors.js             LexError, ParseError, RuntimeError  （共通 — 循環依存を解消）
├── lexer/
│   ├── lexer.js          Lexer, Token, TokenType
│   └── lexer.test.js
├── parser/
│   ├── parser.js         Parser, parse()
│   └── parser.test.js
├── interpreter/
│   ├── environment.js    Environment, deepClone
│   ├── interpreter.js    evaluate(), run(), record(), Recorder
│   ├── interpreter.test.js
│   ├── debugger.js       JSDebugger
│   └── debugger.test.js
├── index.js              エントリポイント（CLI）
web/
├── index.html            HTML レイアウト — エディターパネル + デバッグパネル
├── style.css             ダークテーマ（Catppuccin Mocha）
├── app.js                UI ロジック — interpreter.bundle.js を import
└── interpreter.bundle.js esbuild バンドル（gitignore 済み、npm run build:web でビルド）
```

コードベースは **ES Modules**（`package.json` に `"type": "module"`）を採用し、全ファイルで `import`/`export` 構文を使用します。Jest は `node --experimental-vm-modules` で実行します。

---

## 2. Lexer（字句解析器）

**ファイル**: `src/lexer/lexer.js`

### 2.1 クラス・型定義

#### `Token`

```
Token {
  type:             string        // TokenType の値
  lexeme:           string        // トークンの文字列値（処理済み）
  line:             number        // 行番号（1 始まり）
  column:           number        // 列番号（1 始まり）
  wasNewlineBefore: boolean       // 直前に改行があったか（ASI 判定用）
  endColumn:        number        // トークン末尾の列番号（1 始まり、inclusive）
}
```

`lexeme` は生のソーステキストではなく処理済みの値を持つ。  
例：`"hello\nworld"` の STRING トークンの `lexeme` は `"hello\nworld"`（改行文字を含む実際の値）。

`endColumn` はソース上のトークン末尾位置を表す（文字列リテラルの場合は閉じクォートを含む）。  
計算式: `column + (this.current - this.start) - 1`（`lexeme.length` ではなくソース長を使用）。  
パーサーが `endLoc()` を通じて AST ノードの `end` フィールドを生成するために使用される。

#### `TokenType`

主なトークン型（抜粋）:

| カテゴリ | トークン型 |
|---------|-----------|
| リテラル | `NUMBER`, `STRING`, `TEMPLATE_NO_SUB`, `TEMPLATE_HEAD`, `TEMPLATE_MIDDLE`, `TEMPLATE_TAIL`, `TRUE`, `FALSE`, `NULL` |
| 識別子 | `IDENTIFIER` |
| キーワード | `LET`, `CONST`, `VAR`, `FUNCTION`, `RETURN`, `IF`, `ELSE`, `WHILE`, `FOR`, `CLASS`, `ASYNC`, `AWAIT`, ... |
| 演算子 | `PLUS`, `MINUS`, `STAR`, `SLASH`, `EQ`, `EQ_EQ_EQ`, `ARROW`, `DOT_DOT_DOT`, `QUESTION_QUESTION`, `QUESTION_DOT`, ... |
| 区切り | `LPAREN`, `RPAREN`, `LBRACE`, `RBRACE`, `COMMA`, `SEMICOLON`, `COLON`, `DOT`, ... |
| 終端 | `EOF` |

**注意**: `async` は `ASYNC` トークン型を持つが、識別子としても使用可能（文脈依存キーワード）。パーサーの `checkIdentifierName()` により識別子位置では `ASYNC` トークンも受け付ける。

#### `LexError`

```
LexError extends Error {
  line:   number
  column: number
}
```

### 2.2 Lexer クラス

#### 主なフィールド

```
source:        string      // スキャン対象のソースコード
tokens:        Token[]     // 生成済みトークン列
start:         number      // 現在トークンの開始インデックス
current:       number      // 現在のスキャン位置
line:          number      // 現在の行番号
lineStart:     number      // 現在行の開始インデックス（列番号計算用）
hadNewline:    boolean     // 前のトークン以降に改行があったか
templateStack: Array       // テンプレートリテラルのネスト管理
```

`column` は `start - lineStart + 1` で算出する（プロパティアクセサ）。

#### 主なメソッド

```
tokenize()       → Token[]        // トークン列全体を生成
scanToken()                       // 1トークンをスキャン
scanString(quote)                 // 文字列リテラル
scanTemplate()                    // テンプレートリテラル（先頭）
scanTemplateContinuation()        // テンプレートリテラル（式の後）
scanNumber()                      // 数値リテラル
scanIdentifier()                  // 識別子またはキーワード
```

### 2.3 テンプレートリテラルの字句解析

テンプレートリテラルは `${}` 補間を含むため、**ステートフルな字句解析**が必要。

```
`A${expr1}B${expr2}C`
 ↓
TEMPLATE_HEAD("A")  expr1のトークン列  TEMPLATE_MIDDLE("B")  expr2のトークン列  TEMPLATE_TAIL("C")

`hello`
 ↓
TEMPLATE_NO_SUB("hello")
```

**実装機構**: `templateStack` 配列でネストを管理する。

1. `` ` `` を発見 → `scanTemplate()` を呼び出す
2. `${` を発見 → TEMPLATE_HEAD を emit し `templateStack` に `{ braceDepth: 0 }` を push、通常字句解析モードへ
3. `{` を発見し `templateStack` が非空 → `templateStack.top.braceDepth++`（内部オブジェクトの `{` を追跡）
4. `}` を発見し `templateStack` が非空かつ `braceDepth === 0` → `templateStack` を pop し `scanTemplateContinuation()` へ
5. `}` を発見し `braceDepth > 0` → `braceDepth--` して RBRACE を emit（通常の `}` として扱う）

### 2.4 数値リテラルの解析

| 形式 | 例 | 処理 |
|------|-----|------|
| 10進数 | `42`, `3.14`, `1e3` | 直接 `Number()` |
| 16進数 | `0xFF` | `parseInt(raw, 16)` |
| 8進数 | `0o17` | `parseInt(raw, 8)` |
| 2進数 | `0b1010` | `parseInt(raw, 2)` |
| 数値セパレーター | `1_000_000` | `_` を除去してから変換 |

`lexeme` には `Number(raw)` の文字列表現（`String(Number(raw))`）を格納する。

---

## 3. Parser（構文解析器）

**ファイル**: `src/parser/parser.js`

### 3.1 概要

単一パスの**再帰下降パーサー**。各文法規則が1つのメソッドに対応する。  
入力として `Token[]` を受け取り、出力として AST（`Program` ノード）を返す。

#### `ParseError`

```
ParseError extends Error {
  line:   number
  column: number
}
```

### 3.2 AST ノードの共通フォーマット

すべての AST ノードは以下を持つ:

```js
{
  type: string,          // ノード型（例: 'BinaryExpression'）
  loc:  { line: number, column: number },  // ノード開始位置（1 始まり）
  end:  { line: number, column: number } | null,  // ノード終端位置（式ノードのみ）
  // + ノード型ごとの固有フィールド
}
```

`end` は式（Expression）ノードに付与され、文（Statement）ノードでは `null`。  
パーサーは `endLoc()` メソッドで直前のトークンの `endColumn` を参照して `end` を計算する。  
`Recorder.record()` がこれを `TraceEvent.end` にコピーし、Web UI の部分式ハイライトに使用される。

### 3.3 主要な AST ノード型

#### 文（Statement）

| ノード型 | 主なフィールド |
|---------|--------------|
| `Program` | `body: Statement[]` |
| `BlockStatement` | `body: Statement[]` |
| `VariableDeclaration` | `kind: 'let'\|'const'\|'var'`, `declarations: VariableDeclarator[]` |
| `VariableDeclarator` | `id: Pattern`, `init: Expression\|null` |
| `FunctionDeclaration` | `id: Identifier`, `params: Pattern[]`, `body: BlockStatement`, `generator: boolean`, `async: boolean` |
| `ClassDeclaration` | `id: Identifier\|null`, `superClass: Expression\|null`, `body: ClassBody` |
| `ReturnStatement` | `argument: Expression\|null` |
| `IfStatement` | `test: Expression`, `consequent: Statement`, `alternate: Statement\|null` |
| `WhileStatement` | `test: Expression`, `body: Statement` |
| `DoWhileStatement` | `body: Statement`, `test: Expression` |
| `ForStatement` | `init`, `test`, `update`, `body` |
| `ForOfStatement` | `left`, `right: Expression`, `body` |
| `ForInStatement` | `left`, `right: Expression`, `body` |
| `BreakStatement` | — |
| `ContinueStatement` | — |
| `ThrowStatement` | `argument: Expression` |
| `TryStatement` | `block`, `handler: CatchClause\|null`, `finalizer: BlockStatement\|null` |
| `ExpressionStatement` | `expression: Expression` |

#### 式（Expression）

| ノード型 | 主なフィールド |
|---------|--------------|
| `Literal` | `value: number\|string\|boolean\|null` |
| `TemplateLiteral` | `quasis: TemplateElement[]`, `expressions: Expression[]` |
| `Identifier` | `name: string` |
| `BinaryExpression` | `operator: string`, `left: Expression`, `right: Expression` |
| `LogicalExpression` | `operator: '&&'\|'\|\|'\|'??'`, `left`, `right` |
| `UnaryExpression` | `operator: string`, `prefix: boolean`, `argument: Expression` |
| `UpdateExpression` | `operator: '++'\|'--'`, `prefix: boolean`, `argument: Expression` |
| `AssignmentExpression` | `operator: string`, `left: Expression`, `right: Expression` |
| `ConditionalExpression` | `test`, `consequent`, `alternate` |
| `CallExpression` | `callee: Expression`, `arguments: (Expression\|SpreadElement)[]` |
| `NewExpression` | `callee: Expression`, `arguments: (Expression\|SpreadElement)[]` |
| `MemberExpression` | `object: Expression`, `property: Expression`, `computed: boolean` |
| `ObjectExpression` | `properties: (Property\|SpreadElement)[]` |
| `ArrayExpression` | `elements: (Expression\|SpreadElement\|null)[]` |
| `FunctionExpression` | `id`, `params`, `body`, `generator`, `async: boolean` |
| `ArrowFunctionExpression` | `params`, `body`, `expression: boolean`, `async: boolean` |
| `AwaitExpression` | `argument: Expression` |
| `ClassExpression` | `id`, `superClass`, `body` |
| `SequenceExpression` | `expressions: Expression[]` |

#### パターン（Pattern）

| ノード型 | 主なフィールド |
|---------|--------------|
| `Identifier` | `name: string` |
| `ObjectPattern` | `properties: (ObjectProperty\|RestElement)[]` |
| `ArrayPattern` | `elements: (Pattern\|null)[]` |
| `AssignmentPattern` | `left: Pattern`, `right: Expression`（デフォルト値） |
| `RestElement` | `argument: Pattern` |

### 3.4 演算子の優先順位（高 → 低）

```
1.  単項演算子: !, -, +, ~, typeof, void, delete
2.  await（単項、AwaitExpression として生成）
3.  前置 ++/--
4.  後置 ++/--
5.  new / 関数呼び出し / メンバーアクセス
6.  累乗: **（右結合）
7.  乗除: *, /, %
8.  加減: +, -
9.  シフト: <<, >>, >>>
10. 関係: <, >, <=, >=, instanceof, in
11. 等価: ==, !=, ===, !==
12. ビット AND: &
13. ビット XOR: ^
14. ビット OR: |
15. 論理 AND: &&
16. 論理 OR: ||
17. null 合体: ??
18. 条件（三項）: ? :
19. 代入: =, +=, -= ...（右結合）
20. カンマ: ,
```

`await` は `UnaryExpression` ではなく独立した `AwaitExpression` ノードとして生成される（`parseUnary` から分岐）。

### 3.5 アロー関数の解析

アロー関数は `(` から始まる式と区別が難しいため、**バックトラッキング**を用いる。

```
parseParenOrArrow():
  1. 現在位置を保存
  2. アロー関数パラメーターとして解析を試みる（tryParseArrowParams）
  3. 直後に => があれば → ArrowFunctionExpression
  4. 失敗 or => なし → 位置を復元し、通常の括弧式として解析
```

単一パラメーターの場合（`x => ...`）は `parsePrimary` で先読みにより直接処理。

**async アロー関数**:

```
parseAssignment():
  ASYNC トークンを発見し、次が識別子 または '(' の場合:
    → async x => ... または async (params) => ... として処理
    → ArrowFunctionExpression { async: true, ... }
```

### 3.6 自動セミコロン挿入（ASI）

`consumeSemicolon()` で以下の条件を満たせばセミコロンを省略可能とする:

1. 次のトークンが `;` → 消費する
2. 次のトークンの `wasNewlineBefore === true` → 暗黙セミコロン
3. 次のトークンが `}` または EOF → 暗黙セミコロン

---

## 4. Environment（スコープチェーン）

**ファイル**: `src/interpreter/environment.js`

### 4.1 データ構造

```
Environment {
  bindings: Map<string, any>   // 変数名 → 値
  parent:   Environment | null // 外側スコープ
}
```

スコープチェーンは単方向連結リストとして構成される。

```
グローバル環境（parent: null）
    ↑
関数スコープ（parent: グローバル）
    ↑
ブロックスコープ（parent: 関数）  ← 現在
```

### 4.2 メソッド

| メソッド | 説明 | 計算量 |
|--------|------|--------|
| `define(name, value)` | 現在スコープに変数を定義 | O(1) |
| `get(name, loc)` | チェーンを上方向に探索して値を返す | O(深さ) |
| `set(name, value, loc)` | チェーンを上方向に探索して代入 | O(深さ) |
| `snapshot()` | スコープチェーン全体をディープクローンで返す | O(スコープ数 × 変数数) |

### 4.3 snapshot の形式と deepClone

```js
// [最内スコープ, ..., グローバルスコープ] の配列
[
  { x: 10, y: 20 },          // ローカル変数
  { add: [Function], ... },   // 外側スコープ
  { console: ..., Math: ... } // グローバル
]
```

各バインディングは `deepClone()` によりディープクローンされる。クローン戦略:

| 値の種別 | クローン方法 |
|---------|------------|
| プリミティブ（number, string, boolean, symbol, bigint） | そのまま返す |
| `null` / `undefined` | そのまま返す |
| `JSFunction` / `JSClass`（`__type__` マーカー付き） | 参照を保持（定義後に変更されない不変構造体） |
| 配列 | 要素を再帰的にクローン |
| プレーンオブジェクト・`JSPromise`・`__instance__` | 列挙可能な固有プロパティを再帰的にクローン |
| ネイティブ組み込みオブジェクト（`Math`, `console`, `Map` 等） | 参照を保持（プロトタイプ検査で判定） |
| 循環参照 | `WeakMap` で検出し同一参照を返す（無限ループを防ぐ） |

**ネイティブオブジェクトの判定**: `Object.getPrototypeOf(val) !== Object.prototype && !('__type__' in val)` の場合はネイティブとみなす。

---

## 5. Interpreter（評価器）

**ファイル**: `src/interpreter/interpreter.js`

### 5.1 エントリポイント関数

```js
// 通常実行（記録なし）
run(source: string): any

// 記録実行（デバッグ用）
record(source: string): { trace: TraceEvent[], result: any }

// 評価コア（直接呼び出し可能）
evaluate(node, env, recorder?, depth?, callDepth?): any
```

### 5.2 evaluate の実装構造

```
evaluate(node, env, recorder, depth, callDepth):
  if recorder が null:
    → _eval(node, env, null, depth, callDepth)
  else:
    → recorder.record(node, env, depth, callDepth,
        () => _eval(node, env, recorder, depth, callDepth))
```

`recorder.record` が enter/exit の記録と `matchIdx` のリンクを担う。  
`_eval` は `switch (node.type)` で各ノード型を処理する。

子ノードを評価する際は必ず `depth + 1` を渡すことで深さを追跡する:
```js
const d = depth + 1;  // _eval の先頭で計算
evaluate(node.child, env, recorder, d, callDepth);
```

### 5.3 制御フロー用シグナル

通常の値ではなく特殊なオブジェクトを返すことで制御フローを実装する。

```
ReturnSignal  { value: any }       // return 文
BreakSignal   {}                   // break 文
ContinueSignal {}                  // continue 文
ThrowSignal   { value: any }       // throw 文 / ネイティブ例外
```

シグナルはループ・関数呼び出しの境界で検査・消費される:

```js
// ループ内
const result = evaluate(body, env, recorder, d, callDepth);
if (result instanceof BreakSignal)    break;
if (result instanceof ContinueSignal) continue;
if (result instanceof ReturnSignal || result instanceof ThrowSignal) return result;
```

**ThrowSignal の伝播**: `VariableDeclaration` の初期化式や `ReturnStatement` の返り値式がシグナルを返した場合、即座に上位へ伝播させる:
```js
const val = evaluate(decl.init, env, recorder, d, callDepth);
if (val instanceof ThrowSignal) return val;
```

### 5.4 関数呼び出し

```
callFunction(callee, args, thisValue, recorder, depth, callDepth, loc):
  if typeof callee === 'function':
    → ネイティブ関数：callee.apply(thisValue, args)

  if callee.__type__ === 'JSFunction':
    1. callEnv = new Environment(callee.closure)
    2. thisValue があれば callEnv.define('this', thisValue)
    3. パラメーターをバインド（bindParams）
    4. recorder.callStack に push
    5. body を evaluate(depth, callDepth+1) で評価
    6. recorder.callStack から pop
    7. async 処理（下記参照）
```

**async 関数の戻り値ラッピング**:

```js
// 式本体アロー関数（expression: true）の場合
if (callee.expression) {
  if (result instanceof ThrowSignal) {
    return callee.async ? makeRejectedPromise(result.value) : result;
  }
  const retVal = result instanceof ReturnSignal ? result.value : result;
  return callee.async ? makeFulfilledPromise(retVal) : retVal;
}

// ブロック本体の場合
if (result instanceof ReturnSignal) {
  return callee.async ? makeFulfilledPromise(result.value) : result.value;
}
if (result instanceof ThrowSignal) {
  return callee.async ? makeRejectedPromise(result.value) : result;
}
return callee.async ? makeFulfilledPromise(undefined) : undefined;
```

**関数呼び出し深さの継承**:

```
CallExpression を評価する _eval は:
  → callFunction(..., d, callDepth, ...)  ← 外側の callDepth をそのまま渡す

callFunction の中で:
  bodyCallDepth = callDepth + 1           ← 関数ボディは +1
  evaluate(body, callEnv, recorder, depth, bodyCallDepth)
```

### 5.5 関数オブジェクトの表現

ユーザー定義関数は `__type__: 'JSFunction'` を持つプレーンオブジェクト:

```js
{
  __type__:   'JSFunction',
  name:       string,           // 関数名 or '<anonymous>' or '<arrow>'
  params:     Pattern[],        // AST の引数パターン列
  body:       BlockStatement | Expression,
  expression: boolean,          // アロー関数の式本体かどうか
  async:      boolean,          // async 関数かどうか（v1.1.0 追加）
  closure:    Environment,      // 定義時の環境（クロージャ）
}
```

### 5.6 クラスの表現

```js
{
  __type__:      'JSClass',
  name:          string,
  superClass:    JSClass | null,
  constructor:   JSFunction | null,
  methods:       { [name]: JSFunction },
  staticMethods: { [name]: JSFunction },
  env:           Environment,   // クラス定義時の環境
}
```

インスタンスは `{ __type__: '__instance__', __class__: JSClass, ...プロパティ }` のプレーンオブジェクト。  
メソッドは `Object.defineProperty` を使ったゲッターとして遅延バインドされる（`this` の正確な参照のため）。

### 5.7 JSPromise 型（v1.1.0 追加）

async/await の同期シミュレーションのために導入した内部型:

```js
// 成功状態
{ __type__: 'JSPromise', status: 'fulfilled', value: any }

// 失敗状態
{ __type__: 'JSPromise', status: 'rejected', reason: any }
```

**ヘルパー関数**:

```js
makeFulfilledPromise(value)  // fulfilled な JSPromise を生成
makeRejectedPromise(reason)  // rejected な JSPromise を生成
resolveJSPromise(val)        // JSPromise を解決し { ok, value/reason } を返す
```

**`AwaitExpression` の評価**:

```js
case 'AwaitExpression': {
  const val = evaluate(node.argument, env, recorder, d, callDepth);
  if (val instanceof ThrowSignal) return val;
  // ネイティブ Promise は非対応
  if (val && typeof val.then === 'function' && val.__type__ !== 'JSPromise') {
    return new ThrowSignal(new RuntimeError('ネイティブ Promise の await は未対応'));
  }
  const resolved = resolveJSPromise(val);
  if (resolved.ok) return resolved.value;
  return new ThrowSignal(resolved.reason);
}
```

**`new Promise(executor)` の処理**: `callNew` 内で `__isJSPromiseConstructor` フラグを検出し、`createJSPromiseFromExecutor()` に委譲:

```js
function createJSPromiseFromExecutor(executor, recorder, depth, callDepth, loc) {
  let status = 'pending', value, reason;
  const resolve = v => { if (status === 'pending') { status = 'fulfilled'; value = v; } };
  const reject  = r => { if (status === 'pending') { status = 'rejected';  reason = r; } };
  // executor を同期実行（JSFunction の場合は callFunction 経由）
  // ...
  return { __type__: 'JSPromise', status, value, reason };
}
```

### 5.8 組み込みグローバル

`createGlobalEnv()` が返す環境に以下を定義:

```
undefined, NaN, Infinity
Math, JSON, Date
parseInt, parseFloat, isNaN, isFinite
Number, String, Boolean, Array, Object, Symbol
JSPromiseConstructor（Promise として登録、__isJSPromiseConstructor: true）
Map, Set, WeakMap, WeakSet
Error, TypeError, RangeError, RegExp
console
```

**注意**: ネイティブの `Promise` は `JSPromiseConstructor` に置き換えられる。`JSPromiseConstructor` は `Promise.resolve`, `Promise.reject`, `Promise.all`, `Promise.allSettled`, `Promise.race`, `Promise.any` の各静的メソッドを実装し、`new Promise(executor)` も同期的に処理する。

---

## 6. Recorder（記録器）

**ファイル**: `src/interpreter/interpreter.js`（`Recorder` クラス）

### 6.1 TraceEvent の構造

```ts
interface TraceEvent {
  phase:     'enter' | 'exit'
  nodeType:  string                    // AST ノード型
  loc:       { line: number, column: number }   // ノード開始位置
  end:       { line: number, column: number } | null  // ノード終端位置（式のみ）
  depth:     number                    // Program=0 を起点とする AST ネスト深さ
  callDepth: number                    // 関数呼び出し深さ（0 = トップレベル）
  callStack: Frame[]                   // コールスタックのスナップショット
  env:       Array<Record<string,any>> // 環境のディープクローンスナップショット
  value?:    any                       // exit のみ：評価結果
  matchIdx:  number                    // 対応する exit/enter のインデックス
}

interface Frame {
  name: string                         // 関数名
  loc:  { line: number, column: number }
  args: any[]                          // 呼び出し時の引数値（ディープクローン済み）
}
```

### 6.2 matchIdx のリンク

```
trace = [ ..., ev_enter(i), ..., ev_exit(j), ... ]
         ev_enter.matchIdx = j
         ev_exit.matchIdx  = i
```

記録時に `enterIdx` を保存し、`fn()` 完了後に `exitIdx` が確定したタイミングで双方向にリンクする。

```js
record(node, env, depth, callDepth, fn) {
  const enterIdx = this.trace.length;
  this.trace.push({ phase: 'enter', ..., matchIdx: -1 });

  const value = fn();   // 子ノードの記録もここで行われる

  const exitIdx = this.trace.length;
  this.trace.push({ phase: 'exit', ..., value, matchIdx: enterIdx });
  this.trace[enterIdx].matchIdx = exitIdx;   // 後付けリンク

  return value;
}
```

### 6.3 depth と callDepth の関係

```
プログラム: let x = f();

trace:
  [0] enter Program       depth=0  callDepth=0
  [1] enter ExprStmt      depth=1  callDepth=0
  [2] enter VarDecl       depth=2  callDepth=0
  [3] enter CallExpr      depth=3  callDepth=0
  [4] enter Identifier(f) depth=4  callDepth=0
  [5] exit  Identifier(f) depth=4  callDepth=0
  [6] enter BlockStmt (f の本体)  depth=4  callDepth=1  ← callDepth が増加
  [7] enter ReturnStmt    depth=5  callDepth=1
  ...
  [N] exit  CallExpr      depth=3  callDepth=0  ← callDepth が元に戻る
```

`depth` はルートからの絶対的な深さ、`callDepth` は関数境界をまたぐ回数を表す。

---

## 7. JSDebugger（ステップ実行 API）

**ファイル**: `src/interpreter/debugger.js`

### 7.1 内部状態

```
JSDebugger {
  source:   string        // 元のソースコード
  maxSteps: number        // 最大記録ステップ数
  trace:    TraceEvent[]  // 全評価イベントの配列（イミュータブル）
  cursor:   number        // 現在位置（0 〜 trace.length）
}
```

`cursor === trace.length` のとき `isDone() === true`。

### 7.2 ステップ操作のアルゴリズム

#### stepIn

```
cursor !== trace.length の場合：cursor++
```

#### stepOver

```
ev = trace[cursor]
if ev.phase === 'enter':
  cursor = ev.matchIdx       // exit(N) へジャンプ
else:
  cursor++                   // exit の場合は単純に進む
```

`matchIdx` が事前計算済みのため O(1)。

#### stepOut

```
currentCallDepth = trace[cursor].callDepth
if currentCallDepth === 0:
  cursor = trace.length      // トップレベルは末尾へ
  return

for i = cursor+1 to trace.length-1:
  if trace[i].phase === 'exit' && trace[i].callDepth < currentCallDepth:
    cursor = i
    return

cursor = trace.length        // 見つからなければ末尾へ
```

最悪 O(n)（n = 残りイベント数）。実際は関数の呼び出し-返却の間に収まるため小さい。

#### stepBack

```
if cursor > 0: cursor--
```

O(1)。スナップショット配列方式の最大の利点。  
環境のディープクローンにより、オブジェクト・配列の内部変更も正確に復元される。

### 7.3 フェーズ1とフェーズ2の分離

```
コンストラクター（フェーズ1：記録）:
  source → parse → AST
  evaluate(AST, globalEnv, recorder, 0, 0)
  this.trace = recorder.trace  // 全イベントを確定

ステップ操作（フェーズ2：ナビゲーション）:
  trace の cursor 操作のみ
  再実行なし・再評価なし
```

### 7.4 getVariables の実装

```
getVariables(scope):
  ev = trace[cursor]
  if ev === null: return {}

  if scope === 'local':
    return { ...ev.env[0] }           // 最内スコープ

  if scope === 'all':
    result = {}
    for i from env.length-1 to 0:    // グローバルから内側へ上書き
      Object.assign(result, ev.env[i])
    return result
```

### 7.5 ヒューマンフレンドリーステップ（F-12）

#### _getHumanIndices() — 事前計算

初回呼び出し時に 1 パスで計算し、`Set<number>` として `this._humanIndices` にキャッシュする。計算量 O(n)。

```
インデックス i のイベントごとに:

  ① ALWAYS_EXIT ノード型（VariableDeclaration, AssignmentExpression,
     UpdateExpression, ReturnStatement, ThrowStatement）:
       phase === 'exit' なら i を set に追加

  ② CallExpression — ユーザー定義関数のみ（3 点停止）:
       スタックエントリ: { baseCallDepth, enterIdx, state, innerDepth }
         state 0: CallExpression enter を確認、callDepth 増加を待機中
         state 1: callDepth 増加を検出済み、関数本体の最初の文を探索中
         state 2: 最初の文の enter を追加済み

       (A) enter CallExpression 時: エントリをスタックに push（state=0）
       callDepth > baseCallDepth になった時:
         state 0 → 1 へ遷移: enter CallExpression インデックス(enterIdx)を set に追加
         state 1 かつ phase=enter:
           nodeType が BlockStatement → innerDepth = ev.depth + 1 を記録
           innerDepth が未確定（式本体アロー関数）→ i を set に追加、state 2 へ
           ev.depth === innerDepth → i を set に追加（最初の文）、state 2 へ
       (C) exit CallExpression 時: state > 0 なら i を set に追加
       （ネイティブ関数は callDepth が増えないためスキップ）

  ③ IfStatement / ConditionalExpression の条件テスト（1回）:
       enter 時: trace[i+1].matchIdx を set に追加
       （trace[i+1] = テスト式の enter、matchIdx = テスト式の exit）

  ④ WhileStatement / DoWhileStatement の条件テスト（毎イテレーション）:
       enter 時: i+1 から matchIdx まで走査。
       depth+1 かつ nodeType !== 'BlockStatement' の exit をすべて追加。

  ⑤ ForStatement のテスト式（毎イテレーション）:
       enter 時: i+1 から matchIdx まで走査。
       depth+1 かつ nodeType ∉ {'VariableDeclaration', 'BlockStatement'} の
       exit をすべて追加。
```

#### humanStep()

```
humanSet = _getHumanIndices()
for i = cursor+1 to trace.length-1:
  if humanSet.has(i): cursor = i; return
cursor = trace.length   // 残りに human イベントがない → done
```

#### humanStepBack()

```
humanSet = _getHumanIndices()
for i = cursor-1 downto 0:
  if humanSet.has(i): cursor = i; return
// 見つからなければ no-op（cursor 変化なし）
```

どちらも最悪 O(n)。human イベントが密な実用プログラムでは平均 O(1) に近い。

#### getSourceLine(line)

`this.source` を `'\n'` で分割（初回のみ、`this._sourceLines` にキャッシュ）し、`_sourceLines[line - 1]` を trim して返す。CLI の `showHuman()` で使用。

#### CLI 表示（showHuman）

```
[ラベル] line NNN  <ソース行（45文字パディング）>  →  値
```

| ラベル | 対象 |
|--------|------|
| `宣言` | VariableDeclaration |
| `代入` | AssignmentExpression |
| `更新` | UpdateExpression |
| `return` | ReturnStatement |
| `throw` | ThrowStatement |
| `呼出` | CallExpression（ユーザー定義関数） |
| `条件` | 条件式 exit |

値の表示: `AssignmentExpression`・`UpdateExpression`・`CallExpression`・条件式のみ。  
`VariableDeclaration`・`ReturnStatement`・`ThrowStatement` は値を非表示（ソース行が自明なため）。

### 7.7 continue のブレークポイント照合

```
for i = cursor+1 to trace.length-1:
  ev = trace[i]
  if ev.phase === 'enter' &&
     breakpoints.some(bp => bp.line === ev.loc.line &&
                            (bp.column === undefined || bp.column === ev.loc.column)):
    cursor = i
    return
cursor = trace.length   // ヒットなし → 末尾へ
```

---

## 8. エントリポイント

**ファイル**: `src/index.js`

### 8.1 起動モード判定

```
argv の解析:
  --debug または -d が含まれる  → runDebugger(source)
  非オプション引数がある        → runFile(filePath)
  それ以外                     → runREPL()
```

### 8.2 対話型デバッガーの実装

```
runDebugger(source):
  1. JSDebugger を生成
  2. readline.createInterface でインターフェース作成
  3. コマンドループ（'line' イベント）:
     'n'/'Enter' → dbg.stepIn()
     'v'         → dbg.stepOver()
     'o'         → dbg.stepOut()
     'b'         → dbg.stepBack()
     'p'         → getVariables('all') を表示
     'p <name>'  → 指定変数を表示
     'stack'     → getCallStack() を表示
     'c'         → dbg.continue()
     'q'         → process.exit(0)
  4. 各操作後に showCurrent() で現在イベントを表示
```

### 8.3 REPL の環境共有

REPL は単一の `Environment` インスタンスを保持し、セッション全体で変数・関数を維持する。

```js
const replEnv = createGlobalEnv();  // 一度だけ生成
// 各行入力ごとに:
const ast = parse(line);
evaluate(ast, replEnv, null, 0, 0);  // 同じ replEnv を再利用
```

### 8.4 JSPromise の表示形式

```js
// formatValue() での JSPromise 表示
if (val && val.__type__ === 'JSPromise') {
  if (val.status === 'fulfilled') return `Promise { ${formatValue(val.value)} }`;
  if (val.status === 'rejected')  return `Promise { <rejected> ${val.reason} }`;
  return 'Promise { <pending> }';
}
```

---

## 9. CodeTrace — 実行可視化ツール

**ファイル**: `web/index.html`, `web/style.css`, `web/app.js`

### 9.1 ビルドプロセス

```
src/interpreter/debugger.js
  + src/interpreter/interpreter.js
  + src/interpreter/environment.js
  + src/parser/parser.js
  + src/lexer/lexer.js
  + src/errors.js
        │
        │  esbuild --bundle --format=esm
        ▼
web/interpreter.bundle.js   （約 99 KB、ESM 形式、gitignore 済み）
        │
        │  import { JSDebugger }
        ▼
web/app.js  （UI ロジック）
```

```bash
npm run build:web   # 単発ビルド
npm run dev:web     # ウォッチ + 内蔵 HTTP サーバー（localhost:8000）
```

`createGlobalEnv()` はブラウザ互換のグローバル（`Math`・`JSON`・`console`・`Promise`・`Map`・`Set` 等）のみを登録するため、Node.js シムは不要です。

### 9.2 UI ステートマシン

```
┌─────────────────────────────────────────────────────┐
│ 編集モード                                          │
│   <textarea> 表示、source-display 非表示            │
│   [▶ Run] 表示、[⟳ Reset] / [📊 Trace] 非表示     │
│   ステップボタンすべて無効                          │
│              │                                      │
│              │ [▶ Run] クリック                     │
│              │   new JSDebugger(source)             │
│              │   buildCondEventMap() 呼び出し       │
│              ▼                                      │
│ デバッグモード                                      │
│   source-display 表示（現在行ハイライト）           │
│   [⟳ Reset] / [📊 Trace] 表示、[▶ Run] 非表示     │
│   ステップボタン有効；cursor > 0 のとき Back 有効   │
│              │ ◀─── [📊 Trace] / キー 't'          │
│              │       traceEnabled をトグル          │
│              │       source-display に .trace-on    │
│              │       クラスを付け外し               │
│              │                                      │
│              │ [⟳ Reset] クリック または キー 'r'  │
│              └──────────────────────────────────────┘
```

### 9.3 パネル構成

| パネル | DOM 要素 | 更新関数 |
|--------|----------|----------|
| ソース表示 | `#source-lines` | `renderSource(source, line, event)` |
| 現在のステップ | `#current-event` | `renderCurrentEvent(event)` |
| 変数 | `#variables` | `renderVariables(event)` |
| コールスタック | `#callstack` | `renderCallStack(event)` |
| コンソール出力 | `#console-output` | `renderConsole(event)` |
| ステップカウンター | `#step-counter` | `updateUI()` |

5 つの描画関数はすべて `updateUI()` 内でまとめて呼び出される。`updateUI()` は各ステップ操作後と「スコープ別」チェックボックス変更時に実行される。

#### renderSource の式ハイライト

現在のイベントが式ノードで `event.end` が存在し、`event.loc.line === event.end.line`（同一行）の場合:

```js
const s = event.loc.column - 1;    // 0-based 開始位置
const e = event.end.column;        // 0-based 終端位置（exclusive）
// ソース行を3分割して中央を <span class="src-expr"> で囲む
```

#### renderVariables の表示モード

- **デフォルト（スコープ別チェックなし）**: スコープチェーンを内側から走査し、すべての変数を1つの Map にマージ（内側優先）。`BUILTIN_NAMES`（23個の組み込みグローバル名）に含まれる変数と内部マーカー（`__type__` 等）をフィルタリング。ユーザー定義変数のみを表示。
- **スコープ別（チェックあり）**: フレームごとにスコープを区分して表示（組み込みグローバルも含む）。

#### renderCallStack の引数表示

各フレームの `f.args` から最大3個を `formatValue()` で変換し `(arg1, arg2, ...)` 形式で関数名に追記。4個以上の場合は `…` を付加。

### 9.4 formatValue

`formatValue(v, depth)` はランタイム値を CSS クラス付き HTML に変換する：

| CSS クラス | 対象型 |
|------------|--------|
| `.v-num` | number |
| `.v-str` | string（JSON エスケープ済み） |
| `.v-bool` | boolean |
| `.v-null` / `.v-undef` | null / undefined |
| `.v-fn` | JSFunction・JSClass・ネイティブ関数 |
| `.v-arr` | 配列（depth 1 まで展開、それ以降は `Array(n)`） |
| `.v-obj` | プレーンオブジェクト・JSPromise・`__instance__` |

深さガード：depth ≥ 2 でオブジェクト/配列を `{…}` / `Array(n)` に折りたたみ、出力が無制限に増大しないようにする。

### 9.5 キーボードショートカット

`document.activeElement !== sourceEditor` かつ `dbg !== null` のときのみ有効：

| キー | メソッド |
|------|----------|
| `n` / Enter | `dbg.stepIn()` |
| `v` | `dbg.stepOver()` |
| `o` | `dbg.stepOut()` |
| `b` | `dbg.stepBack()` |
| `h`（Shift なし） | `dbg.humanStep()` |
| `H`（Shift+h） | `dbg.humanStepBack()` |
| `c` | `dbg.continue()` |
| `r` | `resetDebugger()` |
| `t` | `traceEnabled` トグル → `updateUI()` |

### 9.6 インライントレース表

#### 概要

`traceEnabled === true` のとき、`renderSource()` はソース行 `<div>` の末尾に変数セルと条件セルを追加し、`#source-display` に `.trace-on` クラスを付加してテーブルレイアウト（`display: table`）に切り替える。

#### 事前計算: `buildCondEventMap()`

`startDebugger()` 実行時に1回だけ呼び出される。`dbg._getHumanIndices()` で取得した human-step インデックス集合を走査し、次の条件をすべて満たすイベントを**条件式イベント**と判定する：

1. `ev.phase === 'exit'`
2. `ev.nodeType` が `ALWAYS_EXIT`（VariableDeclaration / AssignmentExpression / UpdateExpression / ReturnStatement / ThrowStatement）のいずれでもない
3. `ev.nodeType !== 'CallExpression'`

条件式テキストは `extractCondText(source, ev.loc, ev.end)` で `ev.loc`/`ev.end` の列情報からソース文字列を直接スライスして取得する。結果は `condEventMap: Map<traceIndex, condText>` に格納される。

#### ステップごとの状態更新: `buildTraceData(cursor)`

`updateUI()` から呼ばれ、`trace[0..cursor]` を1パスで走査して次を返す：

| 戻り値 | 型 | 内容 |
|--------|-----|------|
| `lineStates` | `Map<line, {vars, conds}>` | 各行の最終スナップショット |
| `varNames` | `string[]` | 登場順の変数名リスト |
| `condTexts` | `string[]` | 登場順の条件式テキストリスト |
| `changedVars` | `Set<string>` | `cursor-1` → `cursor` で値が変化した変数名、条件は `'cond:' + condText` |

変数スナップショットは `getMergedVars(event)` で取得する（`renderVariables` のデフォルト表示と同ロジック）。値の比較は `JSON.stringify` で行い、循環参照は catch して add する。

#### HTML 構造（トレース表ON時）

```html
<!-- ヘッダー行 -->
<div class="src-line src-trace-hdr">
  <span class="src-num"></span>
  <span class="src-text"></span>
  <span class="trace-vsep"></span>
  <span class="trace-cell-hd">n</span>         <!-- 変数 -->
  <span class="trace-cell-hd trace-cond-hd">i &lt; n-1</span>  <!-- 条件式 -->
  ...
</div>

<!-- 各ソース行 -->
<div class="src-line [active]" data-line="N">
  <span class="src-num">N</span>
  <span class="src-text">...</span>
  <span class="trace-vsep"></span>
  <span class="trace-cell [flash]">5</span>
  <span class="trace-cell cond-cell [flash]">true</span>
  ...
</div>
```

#### CSS アーキテクチャ

- `.source-display.trace-on` → `overflow-x: auto`、`#source-lines` を `display: table`
- `.src-num` → `position: sticky; left: 0` で横スクロール時も固定表示
- `.src-trace-hdr` → `position: sticky; top: 0` で縦スクロール時も固定表示
- `.trace-cell.flash` → `@keyframes trace-flash`（黄色 → 透明、0.9 s）
- `.trace-cell.cond-cell.flash` → `@keyframes trace-flash-cond`（紫 → 透明、0.9 s）

---

## 10. テスト設計

### 9.1 テスト配置

| テストファイル | 対象 | テスト数 |
|-------------|------|---------|
| `src/lexer/lexer.test.js` | Lexer | 45 |
| `src/parser/parser.test.js` | Parser | 42 |
| `src/interpreter/interpreter.test.js` | Interpreter・Recorder | 52 |
| `src/interpreter/debugger.test.js` | JSDebugger | 48 |

**合計: 187テスト**

### 9.2 デバッガーテストの方針

| テスト対象 | 検証内容 |
|----------|---------|
| trace 構造 | enter/exit の数が一致、matchIdx が相互リンク、value・env が正確 |
| stepIn | cursor が 1 進む、done 時に停止、子ノードに入れる |
| stepOver | enter → exit へ O(1) でジャンプ、関数呼び出しを一括スキップ |
| stepOut | callDepth が下がる exit へジャンプ、トップレベルでは末尾へ |
| stepBack | cursor が 1 戻る、cursor=0 では no-op、過去の env が参照できる |
| stepBack（ディープクローン） | オブジェクト・配列の内部変更が正確に復元される |
| getVariables | local/all の切り替え、関数ローカル変数の可視性 |
| getCallStack | トップレベルでは空、ネスト関数でフレームが積まれる |
| continue | ブレークポイントなしで末尾まで、行指定で正確に停止 |
| async/await | async 関数の JSPromise 返却、await による同期解決 |
| humanStep | VariableDeclaration/AssignmentExpression/UpdateExpression が対象、Literal/Identifier/BinaryExpression はスキップ |
| humanStep（条件） | if/while/for の条件 exit が true/false の値とともに捕捉、ループの全イテレーション対象 |
| humanStep（呼び出し） | ユーザー定義関数の enter CallExpression・関数本体最初の文・exit CallExpression の3点で停止；ネイティブ関数（Math.floor 等）はスキップ |
| humanStepBack | 直前の human イベントへ戻る、cursor=0 では no-op |
| getSourceLine | 指定行番号のソーステキストが返る |

---

## 11. 拡張ポイント

| 機能 | 拡張箇所 |
|------|---------|
| 正規表現リテラル | Lexer の `scanToken()` に `/pattern/flags` の処理を追加 |
| `switch` 文 | Parser に `parseSwitchStatement()`、_eval に `SwitchStatement` ケースを追加 |
| モジュール解決 | `import` 文の評価時に外部ファイルを `parse()` して評価する loader を追加 |
| 条件付きブレークポイント | `continue()` の引数に `condition: string` を追加し、評価して判定 |
| ウォッチ式 | `JSDebugger` に `watch(expr: string)` を追加し、各ステップで評価した値を追記 |
| ジェネレーター | `function*` / `yield` の実行サポートを interpreter に追加 |

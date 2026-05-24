# 詳細設計書

**プロジェクト名**: JSInterpreter  
**バージョン**: 1.0.0  
**作成日**: 2026-05-24  
**対象読者**: 実装者・コードレビュアー

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
├── lexer/
│   ├── lexer.js          Lexer, Token, TokenType, LexError
│   └── lexer.test.js
├── parser/
│   ├── parser.js         Parser, ParseError, parse()
│   └── parser.test.js
├── interpreter/
│   ├── environment.js    Environment
│   ├── interpreter.js    evaluate(), run(), record(), Recorder, RuntimeError
│   ├── interpreter.test.js
│   ├── debugger.js       JSDebugger
│   └── debugger.test.js
└── index.js              エントリポイント
```

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
}
```

`lexeme` は生のソーステキストではなく処理済みの値を持つ。  
例：`"hello\nworld"` の STRING トークンの `lexeme` は `"hello\nworld"`（改行文字を含む実際の値）。

#### `TokenType`

主なトークン型（抜粋）:

| カテゴリ | トークン型 |
|---------|-----------|
| リテラル | `NUMBER`, `STRING`, `TEMPLATE_NO_SUB`, `TEMPLATE_HEAD`, `TEMPLATE_MIDDLE`, `TEMPLATE_TAIL`, `TRUE`, `FALSE`, `NULL` |
| 識別子 | `IDENTIFIER` |
| キーワード | `LET`, `CONST`, `VAR`, `FUNCTION`, `RETURN`, `IF`, `ELSE`, `WHILE`, `FOR`, `CLASS`, ... |
| 演算子 | `PLUS`, `MINUS`, `STAR`, `SLASH`, `EQ`, `EQ_EQ_EQ`, `ARROW`, `DOT_DOT_DOT`, `QUESTION_QUESTION`, `QUESTION_DOT`, ... |
| 区切り | `LPAREN`, `RPAREN`, `LBRACE`, `RBRACE`, `COMMA`, `SEMICOLON`, `COLON`, `DOT`, ... |
| 終端 | `EOF` |

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
  loc:  { line: number, column: number },  // ソース位置（1 始まり）
  // + ノード型ごとの固有フィールド
}
```

### 3.3 主要な AST ノード型

#### 文（Statement）

| ノード型 | 主なフィールド |
|---------|--------------|
| `Program` | `body: Statement[]` |
| `BlockStatement` | `body: Statement[]` |
| `VariableDeclaration` | `kind: 'let'\|'const'\|'var'`, `declarations: VariableDeclarator[]` |
| `VariableDeclarator` | `id: Pattern`, `init: Expression\|null` |
| `FunctionDeclaration` | `id: Identifier`, `params: Pattern[]`, `body: BlockStatement`, `generator: boolean` |
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
| `FunctionExpression` | `id`, `params`, `body`, `generator` |
| `ArrowFunctionExpression` | `params`, `body`, `expression: boolean` |
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
1.  単項演算子: !, -, +, ~, typeof, void, delete, await
2.  前置 ++/--
3.  後置 ++/--
4.  new / 関数呼び出し / メンバーアクセス
5.  累乗: **（右結合）
6.  乗除: *, /, %
7.  加減: +, -
8.  シフト: <<, >>, >>>
9.  関係: <, >, <=, >=, instanceof, in
10. 等価: ==, !=, ===, !==
11. ビット AND: &
12. ビット XOR: ^
13. ビット OR: |
14. 論理 AND: &&
15. 論理 OR: ||
16. null 合体: ??
17. 条件（三項）: ? :
18. 代入: =, +=, -= ...（右結合）
19. カンマ: ,
```

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
| `snapshot()` | スコープチェーン全体をシャロークローンで返す | O(スコープ数 × 変数数) |

### 4.3 snapshot の形式

```js
// [最内スコープ, ..., グローバルスコープ] の配列
[
  { x: 10, y: 20 },          // ローカル変数
  { add: [Function], ... },   // 外側スコープ
  { console: ..., Math: ... } // グローバル
]
```

**制約**: 値はシャロークローン。オブジェクトは参照コピーのため、後の変更が過去のスナップショットに影響する場合がある。

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
    7. ReturnSignal があれば value を返す
    8. 式本体（expression: true）なら直接返す
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

### 5.7 組み込みグローバル

`createGlobalEnv()` が返す環境に以下を定義:

```
undefined, NaN, Infinity
Math, JSON, Date
parseInt, parseFloat, isNaN, isFinite
Number, String, Boolean, Array, Object, Symbol
Promise, Map, Set, WeakMap, WeakSet
Error, TypeError, RangeError, RegExp
console
```

---

## 6. Recorder（記録器）

**ファイル**: `src/interpreter/interpreter.js`（`Recorder` クラス）

### 6.1 TraceEvent の構造

```ts
interface TraceEvent {
  phase:     'enter' | 'exit'
  nodeType:  string                    // AST ノード型
  loc:       { line: number, column: number }
  depth:     number                    // Program=0 を起点とする AST ネスト深さ
  callDepth: number                    // 関数呼び出し深さ（0 = トップレベル）
  callStack: Frame[]                   // コールスタックのスナップショット
  env:       Array<Record<string,any>> // 環境のスナップショット
  value?:    any                       // exit のみ：評価結果
  matchIdx:  number                    // 対応する exit/enter のインデックス
}

interface Frame {
  name: string                         // 関数名
  loc:  { line: number, column: number }
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

### 7.5 continue のブレークポイント照合

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

---

## 9. テスト設計

### 9.1 テスト配置

| テストファイル | 対象 |
|-------------|------|
| `src/lexer/lexer.test.js` | Lexer（45テスト） |
| `src/parser/parser.test.js` | Parser（34テスト） |
| `src/interpreter/interpreter.test.js` | Interpreter・Recorder（36テスト） |
| `src/interpreter/debugger.test.js` | JSDebugger（31テスト） |

**合計: 146テスト**

### 9.2 デバッガーテストの方針

| テスト対象 | 検証内容 |
|----------|---------|
| trace 構造 | enter/exit の数が一致、matchIdx が相互リンク、value・env が正確 |
| stepIn | cursor が 1 進む、done 時に停止、子ノードに入れる |
| stepOver | enter → exit へ O(1) でジャンプ、関数呼び出しを一括スキップ |
| stepOut | callDepth が下がる exit へジャンプ、トップレベルでは末尾へ |
| stepBack | cursor が 1 戻る、cursor=0 では no-op、過去の env が参照できる |
| getVariables | local/all の切り替え、関数ローカル変数の可視性 |
| getCallStack | トップレベルでは空、ネスト関数でフレームが積まれる |
| continue | ブレークポイントなしで末尾まで、行指定で正確に停止 |

---

## 10. 拡張ポイント

| 機能 | 拡張箇所 |
|------|---------|
| 正規表現リテラル | Lexer の `scanToken()` に `/pattern/flags` の処理を追加 |
| async/await | `callFunction` に非同期処理のシミュレーションを追加、TraceEvent に `async` フラグ |
| モジュール解決 | `import` 文の評価時に外部ファイルを `parse()` して評価する loader を追加 |
| オブジェクトの深いスナップショット | `Environment.snapshot()` に structuredClone を使用（パフォーマンストレードオフ） |
| 条件付きブレークポイント | `continue()` の引数に `condition: string` を追加し、評価して判定 |
| ウォッチ式 | `JSDebugger` に `watch(expr: string)` を追加し、各ステップで評価した値を追記 |

# Detailed Design

**Project**: JSInterpreter  
**Version**: 1.1.0  
**Created**: 2026-05-24  
**Updated**: 2026-05-24  
**Audience**: Implementers, code reviewers

> 🌐 [日本語版](detailed-design.ja.md)

---

## 1. System Architecture

### 1.1 Pipeline Overview

```
Source code (string)
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
      │ AST (Program node)
      ▼
 ┌─────────────────────────────────┐
 │  evaluate(node, env, recorder)  │  src/interpreter/interpreter.js
 │                                 │
 │  recorder = null  → plain run   │
 │  recorder = Recorder → record   │
 └─────────────────────────────────┘
      │ TraceEvent[] (when recording)
      ▼
 ┌────────────┐
 │ JSDebugger │  src/interpreter/debugger.js
 │  cursor ops │  Step execution API
 └────────────┘
```

### 1.2 Directory Layout

```
src/
├── lexer/
│   ├── lexer.js          Lexer, Token, TokenType, LexError
│   └── lexer.test.js
├── parser/
│   ├── parser.js         Parser, ParseError, parse()
│   └── parser.test.js
├── interpreter/
│   ├── environment.js    Environment, deepClone
│   ├── interpreter.js    evaluate(), run(), record(), Recorder, RuntimeError
│   ├── interpreter.test.js
│   ├── debugger.js       JSDebugger
│   └── debugger.test.js
└── index.js              Entry point
```

---

## 2. Lexer

**File**: `src/lexer/lexer.js`

### 2.1 Types

#### `Token`

```
Token {
  type:             string        // TokenType value
  lexeme:           string        // Processed token value
  line:             number        // Line number (1-based)
  column:           number        // Column number (1-based)
  wasNewlineBefore: boolean       // Whether a newline preceded this token (for ASI)
}
```

`lexeme` holds the processed value, not the raw source text.  
Example: the STRING token for `"hello\nworld"` has `lexeme = "hello\nworld"` (actual newline character).

#### `TokenType`

Key token types (excerpt):

| Category | Token types |
|----------|-------------|
| Literals | `NUMBER`, `STRING`, `TEMPLATE_NO_SUB`, `TEMPLATE_HEAD`, `TEMPLATE_MIDDLE`, `TEMPLATE_TAIL`, `TRUE`, `FALSE`, `NULL` |
| Identifier | `IDENTIFIER` |
| Keywords | `LET`, `CONST`, `VAR`, `FUNCTION`, `RETURN`, `IF`, `ELSE`, `WHILE`, `FOR`, `CLASS`, `ASYNC`, `AWAIT`, ... |
| Operators | `PLUS`, `MINUS`, `STAR`, `SLASH`, `EQ`, `EQ_EQ_EQ`, `ARROW`, `DOT_DOT_DOT`, `QUESTION_QUESTION`, `QUESTION_DOT`, ... |
| Delimiters | `LPAREN`, `RPAREN`, `LBRACE`, `RBRACE`, `COMMA`, `SEMICOLON`, `COLON`, `DOT`, ... |
| End | `EOF` |

**Note**: `async` has its own `ASYNC` token type but can also serve as an identifier (context-dependent keyword). The parser's `checkIdentifierName()` accepts `ASYNC` tokens in identifier positions.

#### `LexError`

```
LexError extends Error {
  line:   number
  column: number
}
```

### 2.2 Lexer Class

#### Key Fields

```
source:        string      // Source code being scanned
tokens:        Token[]     // Generated token list
start:         number      // Start index of current token
current:       number      // Current scan position
line:          number      // Current line number
lineStart:     number      // Start index of current line (for column calculation)
hadNewline:    boolean     // Whether a newline occurred since last token
templateStack: Array       // Nesting state for template literals
```

`column` is computed as `start - lineStart + 1` (property accessor).

#### Key Methods

```
tokenize()       → Token[]        // Generate the full token list
scanToken()                       // Scan one token
scanString(quote)                 // String literal
scanTemplate()                    // Template literal (head)
scanTemplateContinuation()        // Template literal (after expression)
scanNumber()                      // Numeric literal
scanIdentifier()                  // Identifier or keyword
```

### 2.3 Template Literal Lexing

Template literals containing `${}` interpolation require **stateful lexing**.

```
`A${expr1}B${expr2}C`
 ↓
TEMPLATE_HEAD("A")  <tokens for expr1>  TEMPLATE_MIDDLE("B")  <tokens for expr2>  TEMPLATE_TAIL("C")

`hello`
 ↓
TEMPLATE_NO_SUB("hello")
```

**Mechanism**: A `templateStack` array tracks nesting.

1. Encounter `` ` `` → call `scanTemplate()`
2. Encounter `${` → emit TEMPLATE_HEAD, push `{ braceDepth: 0 }` onto `templateStack`, resume normal lexing
3. Encounter `{` while `templateStack` is non-empty → `templateStack.top.braceDepth++` (tracks nested `{` inside interpolation)
4. Encounter `}` while `templateStack` is non-empty and `braceDepth === 0` → pop `templateStack`, call `scanTemplateContinuation()`
5. Encounter `}` while `braceDepth > 0` → `braceDepth--`, emit RBRACE (treat as normal `}`)

### 2.4 Numeric Literal Parsing

| Form | Example | Processing |
|------|---------|------------|
| Decimal | `42`, `3.14`, `1e3` | Direct `Number()` |
| Hexadecimal | `0xFF` | `parseInt(raw, 16)` |
| Octal | `0o17` | `parseInt(raw, 8)` |
| Binary | `0b1010` | `parseInt(raw, 2)` |
| Numeric separator | `1_000_000` | Strip `_`, then convert |

`lexeme` stores `String(Number(raw))` — the string representation of the parsed number.

---

## 3. Parser

**File**: `src/parser/parser.js`

### 3.1 Overview

A single-pass **recursive descent parser**. Each grammar rule corresponds to one method.  
Input: `Token[]`. Output: AST (`Program` node).

#### `ParseError`

```
ParseError extends Error {
  line:   number
  column: number
}
```

### 3.2 Common AST Node Format

Every AST node has:

```js
{
  type: string,          // Node type (e.g. 'BinaryExpression')
  loc:  { line: number, column: number },  // Source position (1-based)
  // + node-type-specific fields
}
```

### 3.3 Key AST Node Types

#### Statements

| Node type | Key fields |
|-----------|-----------|
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

#### Expressions

| Node type | Key fields |
|-----------|-----------|
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

#### Patterns

| Node type | Key fields |
|-----------|-----------|
| `Identifier` | `name: string` |
| `ObjectPattern` | `properties: (ObjectProperty\|RestElement)[]` |
| `ArrayPattern` | `elements: (Pattern\|null)[]` |
| `AssignmentPattern` | `left: Pattern`, `right: Expression` (default value) |
| `RestElement` | `argument: Pattern` |

### 3.4 Operator Precedence (high → low)

```
1.  Unary: !, -, +, ~, typeof, void, delete
2.  await (produces AwaitExpression, not UnaryExpression)
3.  Prefix ++/--
4.  Postfix ++/--
5.  new / call / member access
6.  Exponentiation: ** (right-associative)
7.  Multiplicative: *, /, %
8.  Additive: +, -
9.  Shift: <<, >>, >>>
10. Relational: <, >, <=, >=, instanceof, in
11. Equality: ==, !=, ===, !==
12. Bitwise AND: &
13. Bitwise XOR: ^
14. Bitwise OR: |
15. Logical AND: &&
16. Logical OR: ||
17. Nullish coalescing: ??
18. Conditional (ternary): ? :
19. Assignment: =, +=, -= ... (right-associative)
20. Comma: ,
```

`await` is parsed as a separate `AwaitExpression` node (branched from `parseUnary`), not as `UnaryExpression`.

### 3.5 Arrow Function Parsing

Arrow functions starting with `(` are ambiguous with parenthesized expressions, so **backtracking** is used.

```
parseParenOrArrow():
  1. Save current position
  2. Attempt to parse as arrow function params (tryParseArrowParams)
  3. If followed by => → produce ArrowFunctionExpression
  4. On failure or no => → restore position and parse as parenthesized expression
```

Single-parameter form (`x => ...`) is handled directly in `parsePrimary` via lookahead.

**Async arrow functions**:

```
parseAssignment():
  On ASYNC token, if next is identifier or '(':
    → parse as: async x => ...  or  async (params) => ...
    → ArrowFunctionExpression { async: true, ... }
```

### 3.6 Automatic Semicolon Insertion (ASI)

`consumeSemicolon()` allows omitting the semicolon when:

1. Next token is `;` → consume it
2. Next token has `wasNewlineBefore === true` → implicit semicolon
3. Next token is `}` or `EOF` → implicit semicolon

---

## 4. Environment (Scope Chain)

**File**: `src/interpreter/environment.js`

### 4.1 Data Structure

```
Environment {
  bindings: Map<string, any>   // Variable name → value
  parent:   Environment | null // Enclosing scope
}
```

The scope chain is a singly-linked list:

```
Global environment (parent: null)
    ↑
Function scope (parent: global)
    ↑
Block scope (parent: function)  ← current
```

### 4.2 Methods

| Method | Description | Complexity |
|--------|-------------|------------|
| `define(name, value)` | Define a variable in the current scope | O(1) |
| `get(name, loc)` | Walk the chain upward to find a value | O(depth) |
| `set(name, value, loc)` | Walk the chain upward to assign a value | O(depth) |
| `snapshot()` | Return a deep-cloned snapshot of the full scope chain | O(scopes × bindings) |

### 4.3 Snapshot Format and Deep Clone

```js
// Array ordered [innermost scope, ..., global scope]
[
  { x: 10, y: 20 },          // Local variables
  { add: [Function], ... },   // Outer scope
  { console: ..., Math: ... } // Global
]
```

Each binding is deep-cloned by `deepClone()`. Cloning strategy:

| Value kind | Clone approach |
|------------|---------------|
| Primitives (number, string, boolean, symbol, bigint) | Return as-is |
| `null` / `undefined` | Return as-is |
| `JSFunction` / `JSClass` (with `__type__` marker) | Keep reference (immutable after creation) |
| Arrays | Recursively clone elements |
| Plain objects / `JSPromise` / `__instance__` | Recursively clone own enumerable properties |
| Native built-ins (`Math`, `console`, `Map`, etc.) | Keep reference (detected via prototype check) |
| Circular references | Detected via `WeakMap`; return the existing clone |

**Native object detection**: A value whose `Object.getPrototypeOf(val) !== Object.prototype` and that lacks `__type__` is treated as a native built-in and kept by reference.

---

## 5. Interpreter (Evaluator)

**File**: `src/interpreter/interpreter.js`

### 5.1 Entry Points

```js
// Plain execution (no recording)
run(source: string): any

// Recording execution (for debugging)
record(source: string): { trace: TraceEvent[], result: any }

// Core evaluator (callable directly)
evaluate(node, env, recorder?, depth?, callDepth?): any
```

### 5.2 evaluate Structure

```
evaluate(node, env, recorder, depth, callDepth):
  if recorder is null:
    → _eval(node, env, null, depth, callDepth)
  else:
    → recorder.record(node, env, depth, callDepth,
        () => _eval(node, env, recorder, depth, callDepth))
```

`recorder.record` handles enter/exit event recording and `matchIdx` linking.  
`_eval` dispatches on `node.type` via a `switch` statement.

Child nodes are always evaluated with `depth + 1`:
```js
const d = depth + 1;  // computed at start of _eval
evaluate(node.child, env, recorder, d, callDepth);
```

### 5.3 Control Flow Signals

Control flow is implemented by returning special objects instead of normal values:

```
ReturnSignal  { value: any }       // return statement
BreakSignal   {}                   // break statement
ContinueSignal {}                  // continue statement
ThrowSignal   { value: any }       // throw statement / native exception
```

Signals are checked and consumed at loop/function boundaries:

```js
const result = evaluate(body, env, recorder, d, callDepth);
if (result instanceof BreakSignal)    break;
if (result instanceof ContinueSignal) continue;
if (result instanceof ReturnSignal || result instanceof ThrowSignal) return result;
```

**ThrowSignal propagation**: When a `VariableDeclaration` initializer or a `ReturnStatement` value expression returns a `ThrowSignal`, it is immediately propagated upward:

```js
const val = evaluate(decl.init, env, recorder, d, callDepth);
if (val instanceof ThrowSignal) return val;
```

### 5.4 Function Calls

```
callFunction(callee, args, thisValue, recorder, depth, callDepth, loc):
  if typeof callee === 'function':
    → Native function: callee.apply(thisValue, args)

  if callee.__type__ === 'JSFunction':
    1. callEnv = new Environment(callee.closure)
    2. If thisValue, define 'this' in callEnv
    3. Bind parameters (bindParams)
    4. Push frame onto recorder.callStack
    5. evaluate body with (depth, callDepth+1)
    6. Pop frame from recorder.callStack
    7. Wrap result for async (see below)
```

**Async return value wrapping**:

```js
// Expression-body arrow function (expression: true)
if (callee.expression) {
  if (result instanceof ThrowSignal) {
    return callee.async ? makeRejectedPromise(result.value) : result;
  }
  const retVal = result instanceof ReturnSignal ? result.value : result;
  return callee.async ? makeFulfilledPromise(retVal) : retVal;
}

// Block body
if (result instanceof ReturnSignal) {
  return callee.async ? makeFulfilledPromise(result.value) : result.value;
}
if (result instanceof ThrowSignal) {
  return callee.async ? makeRejectedPromise(result.value) : result;
}
return callee.async ? makeFulfilledPromise(undefined) : undefined;
```

**Call depth inheritance**:

```
_eval evaluating CallExpression:
  → callFunction(..., d, callDepth, ...)   // pass outer callDepth as-is

Inside callFunction:
  bodyCallDepth = callDepth + 1            // function body gets +1
  evaluate(body, callEnv, recorder, depth, bodyCallDepth)
```

### 5.5 Function Object Representation

User-defined functions are plain objects with `__type__: 'JSFunction'`:

```js
{
  __type__:   'JSFunction',
  name:       string,           // Function name, '<anonymous>', or '<arrow>'
  params:     Pattern[],        // AST parameter patterns
  body:       BlockStatement | Expression,
  expression: boolean,          // Whether this is an arrow expression body
  async:      boolean,          // Whether this is an async function (v1.1.0)
  closure:    Environment,      // Captured environment at definition time
}
```

### 5.6 Class Representation

```js
{
  __type__:      'JSClass',
  name:          string,
  superClass:    JSClass | null,
  constructor:   JSFunction | null,
  methods:       { [name]: JSFunction },
  staticMethods: { [name]: JSFunction },
  env:           Environment,   // Environment at class definition
}
```

Instances are plain objects: `{ __type__: '__instance__', __class__: JSClass, ...properties }`.  
Methods are lazily bound as non-enumerable getters via `Object.defineProperty` (for accurate `this` binding).

### 5.7 JSPromise Type (v1.1.0)

An internal type introduced for synchronous async/await simulation:

```js
// Fulfilled state
{ __type__: 'JSPromise', status: 'fulfilled', value: any }

// Rejected state
{ __type__: 'JSPromise', status: 'rejected', reason: any }
```

**Helper functions**:

```js
makeFulfilledPromise(value)  // Create a fulfilled JSPromise
makeRejectedPromise(reason)  // Create a rejected JSPromise
resolveJSPromise(val)        // Resolve a JSPromise; returns { ok, value/reason }
```

**`AwaitExpression` evaluation**:

```js
case 'AwaitExpression': {
  const val = evaluate(node.argument, env, recorder, d, callDepth);
  if (val instanceof ThrowSignal) return val;
  // Native Promise is not supported
  if (val && typeof val.then === 'function' && val.__type__ !== 'JSPromise') {
    return new ThrowSignal(new RuntimeError('Native Promise await is not supported'));
  }
  const resolved = resolveJSPromise(val);
  if (resolved.ok) return resolved.value;
  return new ThrowSignal(resolved.reason);
}
```

**`new Promise(executor)` handling**: `callNew` detects the `__isJSPromiseConstructor` flag and delegates to `createJSPromiseFromExecutor()`:

```js
function createJSPromiseFromExecutor(executor, recorder, depth, callDepth, loc) {
  let status = 'pending', value, reason;
  const resolve = v => { if (status === 'pending') { status = 'fulfilled'; value = v; } };
  const reject  = r => { if (status === 'pending') { status = 'rejected';  reason = r; } };
  // Run executor synchronously (JSFunction: via callFunction; native fn: direct call)
  // ...
  return { __type__: 'JSPromise', status, value, reason };
}
```

### 5.8 Built-in Globals

`createGlobalEnv()` defines the following in the global environment:

```
undefined, NaN, Infinity
Math, JSON, Date
parseInt, parseFloat, isNaN, isFinite
Number, String, Boolean, Array, Object, Symbol
JSPromiseConstructor (registered as Promise, __isJSPromiseConstructor: true)
Map, Set, WeakMap, WeakSet
Error, TypeError, RangeError, RegExp
console
```

**Note**: The native `Promise` is replaced by `JSPromiseConstructor`, which implements `Promise.resolve`, `Promise.reject`, `Promise.all`, `Promise.allSettled`, `Promise.race`, `Promise.any`, and `new Promise(executor)` — all synchronously.

---

## 6. Recorder

**File**: `src/interpreter/interpreter.js` (`Recorder` class)

### 6.1 TraceEvent Structure

```ts
interface TraceEvent {
  phase:     'enter' | 'exit'
  nodeType:  string                    // AST node type
  loc:       { line: number, column: number }
  depth:     number                    // AST nesting depth (Program = 0)
  callDepth: number                    // Function call depth (0 = top level)
  callStack: Frame[]                   // Snapshot of the call stack
  env:       Array<Record<string,any>> // Deep-cloned environment snapshot
  value?:    any                       // exit only: evaluation result
  matchIdx:  number                    // Index of the matching exit/enter event
}

interface Frame {
  name: string                         // Function name
  loc:  { line: number, column: number }
}
```

### 6.2 matchIdx Linking

```
trace = [ ..., ev_enter(i), ..., ev_exit(j), ... ]
         ev_enter.matchIdx = j
         ev_exit.matchIdx  = i
```

The `enterIdx` is saved when the enter event is pushed, then once the exit index is known the link is established in both directions.

```js
record(node, env, depth, callDepth, fn) {
  const enterIdx = this.trace.length;
  this.trace.push({ phase: 'enter', ..., matchIdx: -1 });

  const value = fn();   // child node recording happens here

  const exitIdx = this.trace.length;
  this.trace.push({ phase: 'exit', ..., value, matchIdx: enterIdx });
  this.trace[enterIdx].matchIdx = exitIdx;   // back-patch

  return value;
}
```

### 6.3 depth vs. callDepth

```
Program: let x = f();

trace:
  [0] enter Program       depth=0  callDepth=0
  [1] enter ExprStmt      depth=1  callDepth=0
  [2] enter VarDecl       depth=2  callDepth=0
  [3] enter CallExpr      depth=3  callDepth=0
  [4] enter Identifier(f) depth=4  callDepth=0
  [5] exit  Identifier(f) depth=4  callDepth=0
  [6] enter BlockStmt (body of f)  depth=4  callDepth=1  ← callDepth increases
  [7] enter ReturnStmt    depth=5  callDepth=1
  ...
  [N] exit  CallExpr      depth=3  callDepth=0  ← callDepth returns to 0
```

`depth` is the absolute nesting depth from the root; `callDepth` counts how many function boundaries have been crossed.

---

## 7. JSDebugger (Step Execution API)

**File**: `src/interpreter/debugger.js`

### 7.1 Internal State

```
JSDebugger {
  source:   string        // Original source code
  maxSteps: number        // Maximum recorded steps
  trace:    TraceEvent[]  // All evaluation events (immutable after construction)
  cursor:   number        // Current position (0 … trace.length)
}
```

`isDone() === true` when `cursor === trace.length`.

### 7.2 Step Operation Algorithms

#### stepIn

```
if cursor !== trace.length: cursor++
```

#### stepOver

```
ev = trace[cursor]
if ev.phase === 'enter':
  cursor = ev.matchIdx       // jump to exit(N)
else:
  cursor++                   // exit: advance normally
```

O(1) because `matchIdx` is pre-computed.

#### stepOut

```
currentCallDepth = trace[cursor].callDepth
if currentCallDepth === 0:
  cursor = trace.length      // at top level, jump to end
  return

for i = cursor+1 to trace.length-1:
  if trace[i].phase === 'exit' && trace[i].callDepth < currentCallDepth:
    cursor = i
    return

cursor = trace.length        // not found → jump to end
```

Worst case O(n); in practice bounded by the span of the current function call.

#### stepBack

```
if cursor > 0: cursor--
```

O(1) — the primary advantage of the snapshot array approach.  
Deep-cloned environments ensure that object and array mutations are accurately restored.

### 7.3 Phase 1 / Phase 2 Separation

```
Constructor (Phase 1 — Recording):
  source → parse → AST
  evaluate(AST, globalEnv, recorder, 0, 0)
  this.trace = recorder.trace  // all events finalized

Step operations (Phase 2 — Navigation):
  Pure index manipulation on trace
  No re-execution or re-evaluation
```

### 7.4 getVariables Implementation

```
getVariables(scope):
  ev = trace[cursor]
  if ev === null: return {}

  if scope === 'local':
    return { ...ev.env[0] }           // innermost scope only

  if scope === 'all':
    result = {}
    for i from env.length-1 to 0:    // global → inner (inner wins)
      Object.assign(result, ev.env[i])
    return result
```

### 7.5 continue Breakpoint Matching

```
for i = cursor+1 to trace.length-1:
  ev = trace[i]
  if ev.phase === 'enter' &&
     breakpoints.some(bp => bp.line === ev.loc.line &&
                            (bp.column === undefined || bp.column === ev.loc.column)):
    cursor = i
    return
cursor = trace.length   // no match → jump to end
```

---

## 8. Entry Point

**File**: `src/index.js`

### 8.1 Launch Mode Detection

```
Parse argv:
  Contains --debug or -d    → runDebugger(source)
  Non-option argument       → runFile(filePath)
  Otherwise                 → runREPL()
```

### 8.2 Interactive Debugger

```
runDebugger(source):
  1. Construct JSDebugger
  2. Create readline interface
  3. Command loop (on 'line' event):
     'n' / Enter → dbg.stepIn()
     'v'         → dbg.stepOver()
     'o'         → dbg.stepOut()
     'b'         → dbg.stepBack()
     'p'         → display getVariables('all')
     'p <name>'  → display named variable
     'stack'     → display getCallStack()
     'c'         → dbg.continue()
     'q'         → process.exit(0)
  4. After each operation, call showCurrent() to display the current event
```

### 8.3 REPL Environment Sharing

The REPL maintains a single `Environment` instance across the entire session:

```js
const replEnv = createGlobalEnv();  // created once
// On each line input:
const ast = parse(line);
evaluate(ast, replEnv, null, 0, 0);  // reuse the same replEnv
```

### 8.4 JSPromise Display Format

```js
// formatValue() for JSPromise values
if (val && val.__type__ === 'JSPromise') {
  if (val.status === 'fulfilled') return `Promise { ${formatValue(val.value)} }`;
  if (val.status === 'rejected')  return `Promise { <rejected> ${val.reason} }`;
  return 'Promise { <pending> }';
}
```

---

## 9. Test Design

### 9.1 Test File Layout

| Test file | Subject | Count |
|-----------|---------|-------|
| `src/lexer/lexer.test.js` | Lexer | 45 |
| `src/parser/parser.test.js` | Parser | 42 |
| `src/interpreter/interpreter.test.js` | Interpreter / Recorder | 50 |
| `src/interpreter/debugger.test.js` | JSDebugger | 36 |

**Total: 173 tests**

### 9.2 Debugger Test Policy

| Target | What is verified |
|--------|-----------------|
| trace structure | enter/exit count matches, matchIdx cross-linked, value/env correct |
| stepIn | cursor advances by 1, stops at done, enters child nodes |
| stepOver | enter → exit in O(1), skips function body entirely |
| stepOut | jumps to exit where callDepth drops, goes to end at top level |
| stepBack | cursor retreats by 1, no-op at cursor=0, past env is accessible |
| stepBack (deep clone) | object/array mutations are accurately restored |
| getVariables | local vs. all, function-local variable visibility |
| getCallStack | empty at top level, frames accumulate in nested calls |
| continue | runs to end without breakpoints, stops at correct line |
| async/await | async functions return JSPromise, await resolves synchronously |

---

## 10. Extension Points

| Feature | Where to extend |
|---------|----------------|
| Regex literals | Add `/pattern/flags` handling to `scanToken()` in Lexer |
| `switch` statement | Add `parseSwitchStatement()` to Parser; add `SwitchStatement` case to `_eval` |
| Module resolution | Add a loader to `import` evaluation that reads and `parse()`s external files |
| Conditional breakpoints | Add `condition: string` to `continue()` argument and evaluate to decide whether to stop |
| Watch expressions | Add `watch(expr: string)` to `JSDebugger` and append evaluated values at each step |
| Generators | Add `function*` / `yield` execution support to interpreter |

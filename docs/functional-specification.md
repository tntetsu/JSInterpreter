# Functional Specification

**Project**: JSInterpreter  
**Version**: 1.1.0  
**Created**: 2026-05-24  
**Updated**: 2026-05-24  
**Audience**: Product owners, developers, testers

> 🌐 [日本語版](functional-specification.ja.md)

---

## 1. Overview

JSInterpreter is a JavaScript interpreter written in JavaScript. Its primary goal is to execute modern ES6+ syntax (including async/await) and provide an **expression-level step-execution API** — step-in, step-over, step-out, and step-back.

### 1.1 Background and Purpose

Conventional debuggers target bytecode or JIT-compiled code, making it difficult to visualize the JavaScript evaluation process at the expression level. This system interprets source code as an AST and **records every evaluation step as a snapshot array**, enabling step execution and reverse execution (step-back) at arbitrary granularity.

### 1.2 System Position

```
User (developer / learner)
    │
    ├─── Programmatic API (JSDebugger class)
    │        ↑ External tools · test code · IDE integration
    │
    └─── Interactive REPL Debugger (CLI)
             ↑ Operated directly from the terminal
```

---

## 2. Feature List

| ID   | Feature | Priority |
|------|---------|----------|
| F-01 | Execute JavaScript source code | Required |
| F-02 | Step-in | Required |
| F-03 | Step-over | Required |
| F-04 | Step-out | Required |
| F-05 | Step-back | Required |
| F-06 | Variable inspection | Required |
| F-07 | Call-stack inspection | Required |
| F-08 | Breakpoint execution | Required |
| F-09 | Interactive REPL debugger | Required |
| F-10 | File execution mode | Required |
| F-11 | Plain REPL (non-debug) | Required |
| F-12 | Human-friendly step | Required |
| F-13 | Web Debugger UI | Required |

---

## 3. Supported JavaScript Syntax

### 3.1 Variable Declarations

- `let`, `const`, `var`
- Multiple declarations (`let a = 1, b = 2`)
- Object destructuring (`let { x, y } = obj`)
- Array destructuring (`let [a, b] = arr`)
- Default values in destructuring (`let { x = 0 } = obj`)

### 3.2 Expressions

| Category | Content |
|----------|---------|
| Literals | Numbers (integer, float, hex, octal, binary, numeric separators), strings (escape sequences), booleans, null |
| Template literals | Backtick strings, `${expr}` interpolation (nestable) |
| Arithmetic | `+` `-` `*` `/` `%` `**` |
| Comparison | `==` `!=` `===` `!==` `<` `>` `<=` `>=` |
| Logical | `&&` `\|\|` `!` `??` (nullish coalescing) |
| Bitwise | `&` `\|` `^` `~` `<<` `>>` `>>>` |
| Assignment | `=` `+=` `-=` `*=` `/=` `%=` `**=` `&&=` `\|\|=` `??=` |
| Increment | `++` `--` (prefix and postfix) |
| Ternary | `condition ? truthy : falsy` |
| Unary | `typeof`, `void`, `delete` |
| Binary | `instanceof`, `in` |
| Optional chaining | `?.` (optional access and call) |
| Spread / Rest | `...` |
| Await | `await expr` (inside async functions) |

### 3.3 Functions

- Function declarations (`function f(a, b) { ... }`)
- Function expressions (`const f = function() { ... }`)
- Arrow functions (`x => x * 2`, `(a, b) => a + b`, block body)
- **Async functions** (`async function f() { ... }`, `async () => ...`, `async x => ...`)
- Rest parameters (`...args`)
- Default parameters (`x = 0`)
- Closures (captures the scope at definition time)
- Recursive calls

### 3.4 Control Flow

- `if` / `else if` / `else`
- `while` loop
- `do...while` loop
- `for` loop (init, test, update)
- `for...of` (iterables)
- `for...in` (enumerable properties)
- `break` / `continue`
- `return` (with or without value)
- `throw` / `try` / `catch` / `finally`

### 3.5 Classes

- `class` declarations and expressions
- `constructor`
- Method definitions (regular and async)
- `extends` (inheritance) and `super`
- `new` expressions
- Static methods (`static`)
- Getters and setters (`get` / `set`)

### 3.6 Objects and Arrays

- Object literals (`{ key: value }`)
- Shorthand properties (`{ x }`)
- Computed property names (`{ [expr]: value }`)
- Spread (`{ ...obj }`)
- Array literals (`[1, 2, 3]`)
- Spread (`[...arr]`)
- Property access (`obj.key`, `obj[expr]`)

### 3.7 async/await (Synchronous Simulation)

async/await is simulated synchronously. Code that does not involve native I/O is fully supported.

| Syntax | Behavior |
|--------|---------|
| `async function f() { ... }` | Call result returned as a `JSPromise` object |
| `async () => expr` | Same as above |
| `await expr` | Synchronously resolves a `JSPromise` and returns its value |
| `Promise.resolve(val)` | Returns an immediately fulfilled `JSPromise` |
| `Promise.reject(reason)` | Returns an immediately rejected `JSPromise` |
| `Promise.all/allSettled/race/any([...])` | Synchronously resolved results |
| `new Promise((resolve, reject) => { ... })` | Runs executor synchronously, returns `JSPromise` |

**Limitation**: Does not work with real async I/O such as `fetch` or `setTimeout`.

### 3.8 Other

- `import` / `export` (parsed only; no runtime module loading)
- `debugger` statement (ignored)
- Line comments (`//`) and block comments (`/* */`)
- Automatic Semicolon Insertion (ASI)

---

## 4. Step Execution (F-02 – F-05)

### 4.1 Granularity

Step execution operates at the **expression (node) level**. Each AST node produces an `enter` event (evaluation starts) and an `exit` event (evaluation completes).

#### Example: steps for `let x = 1 + 2 * 3;`

| Step | Phase | Node type | Value |
|------|-------|-----------|-------|
| 0 | enter | VariableDeclaration | — |
| 1 | enter | BinaryExpression(+) | — |
| 2 | enter | Literal | — |
| 3 | exit  | Literal | `1` |
| 4 | enter | BinaryExpression(*) | — |
| 5 | enter | Literal | — |
| 6 | exit  | Literal | `2` |
| 7 | enter | Literal | — |
| 8 | exit  | Literal | `3` |
| 9 | exit  | BinaryExpression(*) | `6` |
| 10 | exit | BinaryExpression(+) | `7` |
| 11 | exit | VariableDeclaration | — |

### 4.2 Step-in (F-02)

**Action**: Advance one event.  
**Function calls**: Enters the body of the callee.  
**Phase**: Advances regardless of enter/exit.  
**Boundary**: Stops at the last event (`done = true`).

### 4.3 Step-over (F-03)

**Action**: Skip the current node's children and land on its exit event.  
- Current is `enter(N)` → jump to matching `exit(N)` (children already evaluated)  
- Current is `exit` → advance one step (same as step-in)

**Example**: Stepping over `enter(CallExpression)` skips the function body and lands on `exit(CallExpression)`, where the return value is available.

### 4.4 Step-out (F-04)

**Action**: Exit the current function call and return to the caller.  
- Jump to the first `exit` event where `callDepth` drops below the current level  
- If `callDepth === 0` (top level), jump to the end of the program

### 4.5 Step-back (F-05)

**Action**: Go back one event. Always O(1).  
**Accuracy**: Environment snapshots are deep-cloned, so mutations inside objects and arrays are accurately restored.  
**Boundary**: No-op when `cursor === 0`.  
**Caveat**: Native objects (`Map`, `Set`, `Error` instances, etc.) are stored by reference, so their mutation history may be inaccurate.

---

## 5. State Inspection (F-06 – F-08)

### 5.1 Variable Inspection (F-06)

| Option | Description |
|--------|-------------|
| `'local'` | Innermost scope only |
| `'all'`   | Full scope chain, flattened (outer variables included) |

### 5.2 Call-Stack Inspection (F-07)

Returns the call stack at the current step. Each frame contains:
- Function name (`<anonymous>` or `<arrow>` for unnamed functions)
- Call site (line number, column number)

### 5.3 Breakpoint Execution (F-08)

Runs until the first `enter` event matching the specified line (and optional column). Without breakpoints, runs to the end of the program.

---

## 5a. Human-Friendly Step (F-12)

### 5a.1 Motivation

Expression-level stepping (F-02 – F-05) exposes every AST node evaluation event. For a single statement like `let x = 1 + 2 * 3`, this generates 12 events. While this granularity is precise, it produces too much noise for a human tracing through an algorithm on paper.

F-12 provides a **"meaningful change point"** granularity that matches how a human would annotate code when tracing manually.

### 5a.2 Surfaced Events

Only `exit`-phase events for the following node types are surfaced:

| Label | Node type | Description |
|-------|-----------|-------------|
| 宣言 (Declare) | `VariableDeclaration` | `let`/`const`/`var` declaration completed |
| 代入 (Assign) | `AssignmentExpression` | Assignment or compound-assignment completed |
| 更新 (Update) | `UpdateExpression` | `i++`, `--j`, etc. |
| return | `ReturnStatement` | `return` executed |
| throw | `ThrowStatement` | `throw` executed |
| 呼出 (Call) | `CallExpression` | **User-defined function** call completed (detected by `callDepth` increase) |
| 条件 (Condition) | condition test expression | `true`/`false` decision point of `if`, `while`, `do...while`, `for`, `? :` |

**Native function calls** (e.g. `Math.floor()`, `arr.push()`) do **not** increase `callDepth` and are therefore skipped.

### 5a.3 Condition Test Detection

| Parent node | Detection method |
|-------------|-----------------|
| `IfStatement` | The exit of `trace[enterIdx + 1]` (the first child = test, evaluated once) |
| `ConditionalExpression` | Same as `IfStatement` |
| `WhileStatement` | All exits at `depth + 1` inside the loop range that are not `BlockStatement` (captured every iteration) |
| `DoWhileStatement` | Same as `WhileStatement` |
| `ForStatement` | All exits at `depth + 1` that are not `VariableDeclaration` (init) or `BlockStatement` (body) |

### 5a.4 Step Count Comparison

For `bubbleSort([3, 1, 2])`:

| Mode | Steps |
|------|-------|
| Expression-level (stepIn) | ~400 |
| Statement-level | ~50 |
| **Human-friendly (F-12)** | **~20** |

### 5a.5 Display Format

```
[宣言  ] line   3  for (let i = 0; i < n - 1; i++) {
[条件  ] line   3  for (let i = 0; i < n - 1; i++) {   →  true
[条件  ] line   6  if (arr[j] > arr[j + 1]) {           →  true
[宣言  ] line   7  const tmp = arr[j];
[代入  ] line   8  arr[j] = arr[j + 1];                 →  1
[代入  ] line   9  arr[j + 1] = tmp;                    →  3
[更新  ] line   5  for (let j = 0; j < n-1-i; j++) {   →  0
```

Each line shows: `[label] line NNN  <source line padded to 45 chars>  →  value`

The value is displayed for AssignmentExpression, UpdateExpression, CallExpression, and condition tests. VariableDeclaration, ReturnStatement, and ThrowStatement do not display a value (the source line is self-explanatory).

---

## 6. Execution Modes (F-09 – F-11)

### 6.1 Interactive Debugger (F-09)

```
Launch: node src/index.js --debug <file.js>
```

| Command | Action |
|---------|--------|
| `n` or Enter | Step-in |
| `v` | Step-over |
| `o` | Step-out |
| `b` | Step-back |
| `h` | Human-friendly step (F-12) |
| `H` | Human-friendly step-back (F-12) |
| `p` | Print all variables |
| `p <name>` | Print named variable |
| `stack` | Print call stack |
| `c` | Continue to end (or next breakpoint) |
| `q` | Quit |

Expression-level display format (`n`/`v`/`o`/`b`):
```
[▶ enter] BinaryExpression        line 3:5   (depth=2, callDepth=0)
[◀ exit ] BinaryExpression        line 3:5 → 7  (depth=2, callDepth=0)
```

Human-friendly display format (`h`/`H`):
```
[条件  ] line   3  for (let i = 0; i < n - 1; i++) {   →  true
[代入  ] line   8  arr[j] = arr[j + 1];                 →  1
```

### 6.2 File Execution Mode (F-10)

```
Launch: node src/index.js <file.js>
```

Executes a JavaScript file without debugging. Output from `console.log` goes to stdout. Errors are printed to stderr without a stack trace.

### 6.3 Plain REPL (F-11)

```
Launch: node src/index.js
```

Interactively evaluates expressions and statements, maintaining environment state across inputs. Exit with `.exit` or Ctrl+D.

### 6.4 Web Debugger UI (F-13)

```
Build:  npm run build:web
Launch: npm run dev:web   → http://localhost:8000
```

A browser-based visual debugger. The interpreter core is bundled into `web/interpreter.bundle.js` by esbuild; no server-side runtime is required during debugging.

**Layout:**

```
┌──────────────────────────┬────────────────────────┐
│  Source (left 55%)       │  Controls (right 45%)  │
│                          ├────────────────────────┤
│  Edit mode: <textarea>   │  Current Step          │
│  Debug mode: highlighted ├────────────────────────┤
│  source lines            │  Variables             │
│                          ├────────────────────────┤
│  [step N / total]        │  Call Stack            │
└──────────────────────────┴────────────────────────┘
```

**Controls and keyboard shortcuts:**

| Button | Key | Action |
|--------|-----|--------|
| Step In | `n` / Enter | stepIn() |
| Step Over | `v` | stepOver() |
| Step Out | `o` | stepOut() |
| Step Back | `b` | stepBack() |
| Human Step | `h` | humanStep() |
| Human Back | `H` | humanStepBack() |
| Continue | `c` | continue() |
| Reset | `r` | Return to edit mode |

**Current Step card** shows: phase (enter/exit), nodeType, line:col, depth, callDepth, and evaluated value (exit events only).

**Variables card**: local scope by default; "全スコープ" checkbox expands to the full scope chain, filtered to exclude internal function/class objects.

**Example programs** (dropdown): fibonacci, factorial, bubble sort, closure, class.

---

## 7. Error Handling

| Error type | Trigger | Message format |
|-----------|---------|----------------|
| `LexError` | Lexing | `[Lexer] line:col: message` |
| `ParseError` | Parsing | `[Parser] line:col: message` |
| `RuntimeError` | Evaluation | `[Runtime] line:col: message` |

All errors are printed as human-readable messages **without** a stack trace.

---

## 8. Constraints and Known Limitations

### Debugger-Specific

| Constraint | Detail |
|-----------|--------|
| Infinite loops | Recording phase does not terminate. Use `maxSteps` option (default: 100,000) to cap. |
| Step-back accuracy | Native objects (`Map`, `Set`, etc.) are stored by reference; their mutation history may be inaccurate. |

### Unsupported Syntax

| Syntax | Status |
|--------|--------|
| Regular expression literals | `/pattern/` causes a lex error (`RegExp` constructor works) |
| `switch` statement | Not implemented |
| Labeled statements | Not implemented |
| `with` statement | Not implemented (deprecated syntax) |
| `function*` / `yield` | Parsed but not executable |
| Tagged template literals | Not implemented |
| `for await...of` | Not implemented |

### Runtime Limitations

| Limitation | Detail |
|-----------|--------|
| Native async I/O | `fetch`, `setTimeout`, etc. do not work |
| JSFunction as native callback | `[1,2,3].map(x => x*2)` does not work |
| `arguments` object | Not supported; use rest parameters (`...args`) |
| Module system | `import/export` is parse-only; no file loading |

---

## 9. Test Requirements

All features are covered by unit tests. Test files are co-located with their source files. Explicit `expect(result).toBe(...)` assertions are used; snapshot tests are not.

**Test breakdown (185 total):**

| File | Count |
|------|-------|
| `src/lexer/lexer.test.js` | 45 |
| `src/parser/parser.test.js` | 42 |
| `src/interpreter/interpreter.test.js` | 50 |
| `src/interpreter/debugger.test.js` | 48 |

# JSInterpreter

[![CI](https://github.com/tntetsu/JSInterpreter/actions/workflows/ci.yml/badge.svg)](https://github.com/tntetsu/JSInterpreter/actions/workflows/ci.yml)

> 🌐 [日本語版](README.ja.md)

A JavaScript interpreter written in JavaScript. Supports ES6+ syntax including async/await and provides an **expression-level step execution API** — step-in, step-over, step-out, and step-back.

## Features

- **Expression-level stepping** — every AST node evaluation is a separate step, not just statements
- **Step-back (reverse execution)** — all evaluation events are recorded as a snapshot array, allowing O(1) reverse steps; deep-cloned environments accurately restore object and array mutations
- **async/await support** — synchronous simulation lets you step through async code that doesn't involve real I/O
- **Human-friendly step** — `h`/`H` commands skip intermediate sub-expressions and surface only meaningful change points (assignments, conditions, loop iterations, function calls)
- **Programmatic API** — embed `JSDebugger` into IDE integrations or external tools
- **Interactive CLI debugger** — step through code directly in the terminal
- **Web Debugger UI** — browser-based visual debugger with source highlighting, variables panel, and call stack panel
- **ES6+ syntax** — arrow functions, classes, destructuring, template literals, and more

## Installation

```bash
git clone https://github.com/tntetsu/JSInterpreter.git
cd JSInterpreter
npm install
```

## Usage

### REPL (Interactive evaluation)

```bash
node src/index.js
```

```
JS Interpreter REPL  (exit: .exit or Ctrl+D)
> 1 + 2 * 3
7
> const greet = name => `Hello, ${name}!`
> greet("world")
"Hello, world!"
```

### File execution

```bash
node src/index.js examples/fibonacci.js
```

### Interactive debugger

```bash
node src/index.js --debug examples/fibonacci.js
```

```
────────────────────────────────────────────────────────────
JS Debugger started  commands: n=stepIn  v=stepOver  o=stepOut  b=stepBack
                               p=variables  stack=callstack  c=continue  q=quit
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

#### Debugger commands

| Command | Action |
|---------|--------|
| `n` or Enter | Step-in (advance to next event) |
| `v` | Step-over (skip current node's children) |
| `o` | Step-out (exit current function) |
| `b` | Step-back (go back one event) |
| `h` | **Human-friendly step** (skip to next meaningful change point) |
| `H` | **Human-friendly step-back** |
| `p` | Print all variables |
| `p <name>` | Print named variable |
| `stack` | Print call stack |
| `c` | Continue to end (or next breakpoint) |
| `q` | Quit |

The `h` command shows a compact one-line summary instead of the raw AST event:

```
[条件  ] line   6  if (arr[j] > arr[j + 1]) {   →  true
[代入  ] line   8  arr[j] = arr[j + 1];           →  1
[更新  ] line   5  for (let j = 0; ...)           →  0
```

### Web Debugger UI

```bash
# Build the browser bundle (once, or after changing interpreter source)
npm run build:web

# Start dev server — rebuilds automatically on source change
npm run dev:web
# → Open http://localhost:8000
```

The web UI is a two-panel layout:

| Panel | Content |
|-------|---------|
| **Source** (left) | Code editor in edit mode; line-highlighted view in debug mode; the active sub-expression is highlighted in yellow |
| **Controls** (right, top) | Step In / Step Over / Step Out / Step Back / Human Step / Human Back / Continue |
| **Current Step** (right) | phase, nodeType, line:col, depth, callDepth, evaluated value |
| **Variables** (right) | All user-defined variables merged (inner scope wins, built-in globals excluded); toggle "スコープ別" for frame-by-frame view |
| **Call Stack** (right) | Call frames with function name, call site, and argument values (e.g. `fib(5)`) |
| **Console** (right) | `console.log/warn/error` output up to the current step (rolls back with step-back) |

#### Inline Trace Table

Press **`📊 Trace`** (or key `t`) after clicking Run to open an inline trace table aligned with the source code:

- Each **source line** grows extra columns to the right — one column per variable, plus one column per condition expression (`if`/`while`/`for` tests).
- The **last recorded value** for each variable at each line is shown; cells update live as you step.
- **Changed cells flash** yellow (variables) or purple (conditions) on the step that caused the change.
- The table scrolls horizontally; the line-number column stays fixed.

```
 #  │ source                    │ arr         │ n │ i │ j │ i<n-1 │ arr[j]>arr[j+1]
────┼───────────────────────────┼─────────────┼───┼───┼───┼───────┼─────────────────
  3 │   const n = arr.length;   │ [5,3,8,1,2] │ 5 │   │   │       │
▶ 4 │   for (let i = 0; …       │ [5,3,8,1,2] │ 5 │ 0 │   │ true  │
  5 │     for (let j = 0; …     │ [5,3,8,1,2] │ 5 │ 0 │ 0 │       │ true
  6 │     if (arr[j] > …        │ [3,5,8,1,2] │ 5 │ 0 │ 0 │       │ false
```

Keyboard shortcuts (same as CLI, active while in debug mode):

| Key | Action |
|-----|--------|
| `n` / Enter | Step-in |
| `v` | Step-over |
| `o` | Step-out |
| `b` | Step-back |
| `h` | Human step |
| `H` | Human step-back |
| `c` | Continue |
| `r` | Reset |
| `t` | Toggle trace table |

Five built-in example programs are available from a dropdown (fibonacci, factorial, bubble sort, closure, class).

## Programmatic API

```javascript
import { JSDebugger } from './src/interpreter/debugger.js';

const dbg = new JSDebugger(`
  function fib(n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
  }
  fib(5);
`);

// Step-in
const { event, done } = dbg.stepIn();
console.log(event.nodeType, event.phase, event.loc);

// Step-over (skip children of current node)
dbg.stepOver();

// Step-out (exit current function)
dbg.stepOut();

// Step-back (O(1), always)
dbg.stepBack();

// Run to breakpoint
dbg.continue([{ line: 3 }]);

// Inspect variables
const vars = dbg.getVariables('all');

// Inspect call stack
const stack = dbg.getCallStack();
```

### TraceEvent structure

Each step carries:

```javascript
{
  phase:     'enter' | 'exit',  // evaluation start or completion
  nodeType:  'BinaryExpression',
  loc:       { line: 3, column: 5 },
  depth:     2,                 // AST nesting depth
  callDepth: 1,                 // function call depth
  callStack: [{ name: 'fib', loc: { line: 6, column: 0 } }],
  env:       [{ n: 5 }, { fib: [Function] }],  // deep-cloned scope chain snapshot
  value:     6,                 // evaluation result (exit events only)
}
```

### Step-by-step example

`let x = 1 + 2 * 3;` decomposes into 12 steps:

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

## Supported Syntax

| Category | Syntax |
|----------|--------|
| Variables | `let` `const` `var`, destructuring (object/array), default values |
| Functions | Declarations, expressions, arrow functions, **async functions**, rest params, default params, closures, recursion |
| Async | `async function`, `async () =>`, `await`, `Promise.resolve/reject/all/allSettled/race/any`, `new Promise(executor)` |
| Control flow | `if/else`, `while`, `do...while`, `for`, `for...of`, `for...in`, `break/continue`, `return` |
| Exceptions | `throw`, `try/catch/finally` |
| Classes | `class`, `constructor`, inheritance (`extends/super`), `static`, getters/setters |
| Operators | Arithmetic, comparison, logical, bitwise, assignment, ternary, `typeof`, `instanceof`, `in`, `??`, `?.` |
| Literals | Numbers (hex/octal/binary/separator), template literals (nested interpolation), `null`/`true`/`false` |
| Other | Spread/rest (`...`), shorthand properties, computed property names |

## Architecture

```
source
  │
  ▼
Lexer          source text → Token[]
  │            (src/lexer/lexer.js)
  ▼
Parser         Token[] → AST (nodes include loc)
  │            (src/parser/parser.js)
  ▼
evaluate()     AST → runtime values + records all events in Recorder
  │            (src/interpreter/interpreter.js)
  ▼
JSDebugger     step control via index manipulation on trace[]
               (src/interpreter/debugger.js)

src/errors.js  shared error classes (LexError, ParseError, RuntimeError)
               imported by all pipeline stages — breaks circular dependencies
```

The codebase uses **ES Modules** (`"type": "module"` in package.json). All files use `import`/`export` syntax.

Execution is split into two phases:

1. **Recording phase** — the constructor runs the entire program and stores every evaluation event in a `trace` array
2. **Navigation phase** — `stepIn/stepOver/stepOut/stepBack` reduce to pure index operations on `trace[cursor]` (no re-execution)

## Development

```bash
# Run all tests
npm test

# Run a single test file
npx jest src/interpreter/debugger.test.js

# Watch mode
npm run test:watch
```

187 tests across 4 files.

## Known Limitations

### Debugger-specific

| Constraint | Detail |
|-----------|--------|
| Infinite loops | The recording phase does not terminate. Use `options.maxSteps` (default: 100,000) to cap execution. |
| Step-back accuracy | Plain objects and arrays are deep-cloned, so mutations are accurately restored. However, native objects (`Map`, `Set`, `Error` instances, etc.) are stored by reference, so their mutation history may be inaccurate. |

### Unsupported syntax

| Syntax | Status | Workaround |
|--------|--------|------------|
| Regex literals | `/pattern/` causes a lex error | `new RegExp('pattern')` works |
| `switch` statement | Not implemented | Use `if/else if` |
| Labeled statements | Not implemented | — |
| `with` statement | Not implemented (deprecated) | — |
| `function*` / `yield` | Parseable but not executable | — |
| Tagged template literals | Not implemented | Plain template literals work |
| `for await...of` | Not implemented | — |

### Runtime limitations

| Limitation | Detail |
|-----------|--------|
| Native async I/O | `async/await` is simulated synchronously; `fetch`, `setTimeout`, etc. do not work |
| JSFunction as native callback | `[1,2,3].map(x => x*2)` does not work — native methods receive a JSFunction object, not a callable |
| `arguments` object | Not supported inside functions; use rest parameters (`...args`) instead |
| `WeakRef` / `Proxy` / `Reflect` | Not registered as globals (can be added if needed) |
| Module system | `import/export` is parse-only; no file loading or module resolution |

## Documentation

- [Functional Specification](docs/functional-specification.md)
- [Detailed Design](docs/detailed-design.md)

## License

MIT  
Copyright (c) 2026 tanaka. Portions generated with AI assistance.

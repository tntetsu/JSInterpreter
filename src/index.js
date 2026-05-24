#!/usr/bin/env node
'use strict';

const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

const { LexError }    = require('./lexer/lexer');
const { ParseError }  = require('./parser/parser');
const { RuntimeError, run } = require('./interpreter/interpreter');
const { JSDebugger }  = require('./interpreter/debugger');

// ─── 共通ユーティリティ ────────────────────────────────────────────────────────

function printError(e) {
  if (e instanceof LexError || e instanceof ParseError || e instanceof RuntimeError) {
    console.error(e.message);
  } else {
    console.error(e instanceof Error ? e.message : String(e));
  }
}

// ─── 対話型デバッガー ──────────────────────────────────────────────────────────

async function runDebugger(source) {
  let dbg;
  try {
    dbg = new JSDebugger(source);
  } catch (e) {
    printError(e);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: '(debug) > ',
  });

  function showCurrent() {
    if (dbg.isDone()) {
      console.log('[完了] プログラムが終了しました。');
      return;
    }
    const ev = dbg.getCurrentEvent();
    const phaseStr = ev.phase === 'enter' ? '▶ enter' : '◀ exit ';
    const valStr   = ev.phase === 'exit' && ev.value !== undefined
      ? ` → ${JSON.stringify(ev.value)}`
      : '';
    console.log(
      `[${phaseStr}] ${ev.nodeType.padEnd(24)} line ${ev.loc.line}:${ev.loc.column}${valStr}` +
      `  (depth=${ev.depth}, callDepth=${ev.callDepth})`
    );
  }

  function showVars() {
    const vars = dbg.getVariables('all');
    const entries = Object.entries(vars);
    if (entries.length === 0) {
      console.log('  (変数なし)');
    } else {
      for (const [k, v] of entries) {
        if (k.startsWith('__')) continue;
        console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
    }
  }

  function showStack() {
    const stack = dbg.getCallStack();
    if (stack.length === 0) {
      console.log('  <top level>');
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        const f = stack[i];
        console.log(`  ${i + 1}: ${f.name}  (line ${f.loc.line}:${f.loc.column})`);
      }
    }
  }

  console.log('─'.repeat(60));
  console.log('JS デバッガー起動  コマンド: n=stepIn  v=stepOver  o=stepOut  b=stepBack');
  console.log('                           p=変数表示  stack=スタック  c=continue  q=終了');
  console.log('─'.repeat(60));
  showCurrent();

  rl.prompt();

  rl.on('line', (line) => {
    const cmd = line.trim();

    switch (cmd) {
      case 'n': case '':
        dbg.stepIn();
        showCurrent();
        break;

      case 'v':
        dbg.stepOver();
        showCurrent();
        break;

      case 'o':
        dbg.stepOut();
        showCurrent();
        break;

      case 'b':
        dbg.stepBack();
        showCurrent();
        break;

      case 'p':
        showVars();
        break;

      case 'stack':
        showStack();
        break;

      case 'c':
        dbg.continue();
        showCurrent();
        break;

      case 'q':
        console.log('終了します。');
        rl.close();
        process.exit(0);
        return;

      default:
        if (cmd.startsWith('p ')) {
          // p <varname>
          const varName = cmd.slice(2).trim();
          const vars = dbg.getVariables('all');
          if (varName in vars) {
            console.log(`  ${varName} = ${JSON.stringify(vars[varName])}`);
          } else {
            console.log(`  '${varName}' は現在のスコープに存在しません`);
          }
        } else if (cmd) {
          console.log(`  不明なコマンド: '${cmd}'  (n/v/o/b/p/stack/c/q)`);
        }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// ─── 通常のファイル実行 ────────────────────────────────────────────────────────

function runFile(filePath) {
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`ファイルを読み込めません: ${filePath}`);
    process.exit(1);
  }
  try {
    const result = run(source);
    if (result !== undefined) {
      // ファイル実行時は最終値を表示しない（REPLと差別化）
    }
  } catch (e) {
    printError(e);
    process.exit(1);
  }
}

// ─── REPL ─────────────────────────────────────────────────────────────────────

async function runREPL() {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  console.log('JS インタープリター REPL  （終了: .exit または Ctrl+D）');

  // グローバル環境を維持
  const { createGlobalEnv, evaluate } = require('./interpreter/interpreter');
  const { parse } = require('./parser/parser');
  const replEnv = createGlobalEnv();

  rl.prompt();

  rl.on('line', (line) => {
    const src = line.trim();
    if (!src) { rl.prompt(); return; }
    if (src === '.exit') { process.exit(0); }

    try {
      const ast = parse(src);
      const result = evaluate(ast, replEnv, null, 0, 0);
      if (result !== undefined && result !== null) {
        const { ReturnSignal } = require('./interpreter/interpreter');
        if (!(result instanceof ReturnSignal)) {
          console.log(formatValue(result));
        }
      }
    } catch (e) {
      printError(e);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nさようなら！');
    process.exit(0);
  });
}

function formatValue(val) {
  if (typeof val === 'string') return JSON.stringify(val);
  if (val && val.__type__ === 'JSFunction') return `[Function: ${val.name}]`;
  if (val && val.__type__ === 'JSClass')   return `[class ${val.name}]`;
  if (val && val.__type__ === '__instance__') return `[instance of ${val.__class__?.name}]`;
  try { return JSON.stringify(val); } catch { return String(val); }
}

// ─── エントリポイント ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--debug') || args.includes('-d')) {
  // デバッグモード: node src/index.js --debug <file.js>
  const fileArg = args.find(a => !a.startsWith('-'));
  if (!fileArg) {
    console.error('使用法: node src/index.js --debug <file.js>');
    process.exit(1);
  }
  let source;
  try {
    source = fs.readFileSync(fileArg, 'utf8');
  } catch (e) {
    console.error(`ファイルを読み込めません: ${fileArg}`);
    process.exit(1);
  }
  runDebugger(source);
} else if (args.length > 0 && !args[0].startsWith('-')) {
  // ファイル実行モード: node src/index.js <file.js>
  runFile(args[0]);
} else {
  // REPL モード: node src/index.js
  runREPL();
}

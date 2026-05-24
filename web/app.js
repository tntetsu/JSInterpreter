/**
 * app.js — CodeTrace UI
 *
 * interpreter.bundle.js (esbuild でビルド済み) を import して
 * JSDebugger API を呼び出す。
 */

import { JSDebugger } from './interpreter.bundle.js';

// ──────────────────────────────────────────────────────────────────────────────
// サンプルコード
// ──────────────────────────────────────────────────────────────────────────────

const EXAMPLES = {
  fibonacci: `\
function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
fib(5);`,

  factorial: `\
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
factorial(6);`,

  'bubble-sort': `\
function bubbleSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        const tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
      }
    }
  }
  return arr;
}
bubbleSort([5, 3, 8, 1, 2]);`,

  closure: `\
function makeCounter(start) {
  let count = start ?? 0;
  return function increment() {
    count += 1;
    return count;
  };
}
const counter = makeCounter(10);
counter();
counter();
counter();`,

  class: `\
class Animal {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return this.name + ' makes a sound.';
  }
}

class Dog extends Animal {
  speak() {
    return this.name + ' barks.';
  }
}

const d = new Dog('Rex');
d.speak();`,
};

// ──────────────────────────────────────────────────────────────────────────────
// 組み込みグローバル名（デフォルト表示では除外する）
// createGlobalEnv() で定義される名前と一致させる
// ──────────────────────────────────────────────────────────────────────────────

const BUILTIN_NAMES = new Set([
  'undefined', 'NaN', 'Infinity',
  'Math', 'JSON', 'Date',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'Symbol',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Error', 'TypeError', 'RangeError', 'RegExp',
  'console',
]);

// ──────────────────────────────────────────────────────────────────────────────
// DOM 参照
// ──────────────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const sourceEditor   = $('source-editor');
const editorArea     = $('editor-area');
const sourceDisplay  = $('source-display');
const sourceLines    = $('source-lines');
const stepCounter    = $('step-counter');
const currentEventEl = $('current-event');
const variablesEl    = $('variables');
const callstackEl    = $('callstack');
const consoleEl      = $('console-output');
const consoleCount   = $('console-count');
const btnRun         = $('btn-run');
const btnReset       = $('btn-reset');
const exampleSelect  = $('example-select');
const scopeAllCb     = $('scope-all');

// ──────────────────────────────────────────────────────────────────────────────
// 初期化
// ──────────────────────────────────────────────────────────────────────────────

sourceEditor.value = EXAMPLES.fibonacci;

exampleSelect.addEventListener('change', () => {
  const key = exampleSelect.value;
  if (key && EXAMPLES[key]) {
    sourceEditor.value = EXAMPLES[key];
    exampleSelect.value = '';   // 選択を即リセット（再選択可能に）
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// トレース表: 状態変数
// ──────────────────────────────────────────────────────────────────────────────

let traceEnabled  = false;    // トレース表のON/OFF
let condEventMap  = new Map(); // traceIndex → 条件式テキスト（startDebugger時に1回構築）

// ──────────────────────────────────────────────────────────────────────────────
// 値フォーマット
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 値を HTML 文字列に変換する（型ごとに色付け）
 * @param {*} v
 * @param {number} [depth=0]  再帰の深さ（配列・オブジェクトの省略判定に使用）
 */
function formatValue(v, depth = 0) {
  if (v === undefined) return '<span class="v-undef">undefined</span>';
  if (v === null)      return '<span class="v-null">null</span>';
  if (typeof v === 'boolean') return `<span class="v-bool">${v}</span>`;
  if (typeof v === 'number')  return `<span class="v-num">${v}</span>`;
  if (typeof v === 'string')  return `<span class="v-str">${esc(JSON.stringify(v))}</span>`;
  if (typeof v === 'function') return '<span class="v-fn">[Function]</span>';
  if (typeof v !== 'object')  return esc(String(v));

  // インタープリター内部型
  if (v.__type__ === 'JSFunction')   return '<span class="v-fn">[Function]</span>';
  if (v.__type__ === 'JSClass')      return '<span class="v-fn">[Class]</span>';
  if (v.__type__ === 'JSPromise')    return `<span class="v-obj">Promise(${esc(v.status)})</span>`;
  if (v.__type__ === '__instance__') return `<span class="v-obj">[${esc(v.__class__ || 'Object')}]</span>`;

  if (Array.isArray(v)) {
    if (depth >= 2 || v.length > 10) return `<span class="v-arr">Array(${v.length})</span>`;
    const items = v.slice(0, 10).map(x => formatValue(x, depth + 1)).join(', ');
    return `<span class="v-arr">[${items}]</span>`;
  }

  const keys = Object.keys(v).filter(k => !k.startsWith('__'));
  if (depth >= 2 || keys.length > 6) return `<span class="v-obj">{…}</span>`;
  const pairs = keys.slice(0, 6)
    .map(k => `${esc(k)}: ${formatValue(v[k], depth + 1)}`).join(', ');
  return `<span class="v-obj">{${pairs}}</span>`;
}

/** 内部型（関数・クラス）か判定 */
function isInternal(v) {
  return typeof v === 'object' && v !== null &&
    (v.__type__ === 'JSFunction' || v.__type__ === 'JSClass');
}

/** HTML エスケープ */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────────────────────
// トレース表: ヘルパー関数
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ソース位置 (loc/end) から条件式テキストを切り出す
 * loc.column / end.column は 1-based（renderSource と同仕様）
 */
function extractCondText(source, loc, end) {
  if (!end) return null;
  const lines = source.split('\n');
  if (loc.line === end.line) {
    return (lines[loc.line - 1] || '').slice(loc.column - 1, end.column).trim();
  }
  const parts = [];
  for (let l = loc.line; l <= end.line; l++) {
    const s = lines[l - 1] || '';
    if      (l === loc.line) parts.push(s.slice(loc.column - 1));
    else if (l === end.line) parts.push(s.slice(0, end.column));
    else                     parts.push(s);
  }
  return parts.join(' ').trim();
}

/**
 * トレース全体を1回スキャンして condEventMap を構築する。
 * Human-step の条件式 exit イベント（if/while/for の条件部）を対象とする。
 */
function buildCondEventMap() {
  condEventMap = new Map();
  if (!dbg) return;

  const ALWAYS_EXIT = new Set([
    'VariableDeclaration', 'AssignmentExpression', 'UpdateExpression',
    'ReturnStatement', 'ThrowStatement',
  ]);
  const humanIndices = dbg._getHumanIndices();

  for (const i of humanIndices) {
    const ev = dbg.trace[i];
    if (ev.phase !== 'exit')              continue;
    if (ALWAYS_EXIT.has(ev.nodeType))     continue;
    if (ev.nodeType === 'CallExpression') continue;

    const text = extractCondText(dbg.source, ev.loc, ev.end);
    if (text) condEventMap.set(i, text);
  }
}

/**
 * イベントのスコープチェーンからユーザー変数をフラットに取り出す
 * (renderVariables のデフォルト表示と同じロジック)
 */
function getMergedVars(event) {
  if (!event?.env) return {};
  const frames    = event.env;
  const globalIdx = frames.length - 1;
  const result    = {};
  for (let fi = 0; fi < frames.length; fi++) {
    const frame    = frames[fi];
    const isGlobal = fi === globalIdx;
    for (const k of Object.keys(frame)) {
      if (k in result)          continue;
      if (isInternal(frame[k])) continue;
      if (isGlobal && BUILTIN_NAMES.has(k)) continue;
      result[k] = frame[k];
    }
  }
  return result;
}

/**
 * trace[0..cursor] をスキャンしてトレース表のデータを返す。
 *
 * 戻り値:
 *   lineStates : Map<lineNum, { vars, conds }>
 *                各行を最後に実行した時点の変数・条件値
 *   varNames   : string[]   — 見つかった変数名（登場順）
 *   condTexts  : string[]   — 見つかった条件式テキスト（登場順）
 *   changedVars: Set<string>— cursor 直前→cursor で変化した変数名
 *                             条件は 'cond:' + condText のキー
 */
function buildTraceData(cursor) {
  const lineStates = new Map();
  const varNames   = [];
  const condTexts  = [];
  const changedVars = new Set();

  let prevVars = null;

  for (let c = 0; c <= cursor && c < dbg.trace.length; c++) {
    const ev   = dbg.trace[c];
    const line = ev.loc.line;

    if (!lineStates.has(line)) lineStates.set(line, { vars: {}, conds: {} });
    const ls = lineStates.get(line);

    // 変数スナップショットを更新
    const vars = getMergedVars(ev);
    for (const k of Object.keys(vars)) {
      if (!varNames.includes(k)) varNames.push(k);
    }
    ls.vars = vars;

    // 条件式の値を更新
    if (ev.phase === 'exit') {
      const condText = condEventMap.get(c);
      if (condText) {
        if (!condTexts.includes(condText)) condTexts.push(condText);
        ls.conds[condText] = ev.value;
      }
    }

    // cursor 直前との差分を記録（フラッシュアニメーション用）
    if (c === cursor) {
      if (prevVars !== null) {
        for (const k of varNames) {
          try {
            if (JSON.stringify(prevVars[k]) !== JSON.stringify(vars[k])) {
              changedVars.add(k);
            }
          } catch { changedVars.add(k); }
        }
      }
      const condText = condEventMap.get(c);
      if (condText) changedVars.add('cond:' + condText);
    }

    if (c === cursor - 1) prevVars = vars;
  }

  return { lineStates, varNames, condTexts, changedVars };
}

// ──────────────────────────────────────────────────────────────────────────────
// UI 描画
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ソースコード表示（currentLine の行をハイライト）
 * traceEnabled 時は各行の右側に変数・条件式の列を追加する。
 */
function renderSource(source, currentLine, event) {
  const lines = source.split('\n');

  // 式ハイライト：同一行で end が存在する場合のみ
  const exprStart = (event?.end && event.loc.line === event.end.line)
    ? event.loc.column : null;
  const exprEnd = exprStart !== null ? event.end.column : null;

  // ── トレース表データ ────────────────────────────────────────────
  let traceData = null;
  if (traceEnabled && dbg) {
    traceData = buildTraceData(dbg.cursor);
  }
  const { lineStates, varNames, condTexts, changedVars } = traceData ?? {};
  const allCols = traceEnabled
    ? [...(varNames ?? []), ...(condTexts ?? [])]
    : [];
  const nVars = varNames?.length ?? 0;

  // ── テーブルモード切替 ─────────────────────────────────────────
  if (traceEnabled) {
    sourceDisplay.classList.add('trace-on');
  } else {
    sourceDisplay.classList.remove('trace-on');
  }

  let html = '';

  // ── ヘッダー行（列名） ─────────────────────────────────────────
  if (traceEnabled && allCols.length > 0) {
    html += `<div class="src-line src-trace-hdr">` +
      `<span class="src-num"></span>` +
      `<span class="src-text"></span>` +
      `<span class="trace-vsep"></span>` +
      allCols.map((col, ci) => {
        const isCond = ci >= nVars;
        const label  = col.length > 14 ? col.slice(0, 13) + '…' : col;
        const cls    = isCond ? 'trace-cell-hd trace-cond-hd' : 'trace-cell-hd';
        return `<span class="${cls}" title="${esc(col)}">${esc(label)}</span>`;
      }).join('') +
      `</div>`;
  }

  // ── ソース行 ───────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const num     = i + 1;
    const active  = num === currentLine;
    const lineStr = lines[i];

    // 式ハイライト
    let textHtml;
    if (active && exprStart !== null) {
      const s      = exprStart - 1;
      const e      = exprEnd;
      const before = esc(lineStr.slice(0, s));
      const expr   = esc(lineStr.slice(s, e));
      const after  = esc(lineStr.slice(e));
      textHtml = `<span class="src-text">${before}<span class="src-expr">${expr || ' '}</span>${after}</span>`;
    } else {
      textHtml = `<span class="src-text">${esc(lineStr) || ' '}</span>`;
    }

    // トレース列
    let tracePart = '';
    if (traceEnabled && allCols.length > 0) {
      const ls = lineStates?.get(num) ?? { vars: {}, conds: {} };
      tracePart = `<span class="trace-vsep"></span>` +
        allCols.map((col, ci) => {
          const isCond   = ci >= nVars;
          const changed  = isCond
            ? (active && changedVars?.has('cond:' + col))
            : (active && changedVars?.has(col));
          const val      = isCond
            ? (col in ls.conds ? ls.conds[col] : undefined)
            : (col in ls.vars  ? ls.vars[col]  : undefined);
          const valHtml  = val !== undefined
            ? formatValue(val)
            : `<span class="trace-empty">—</span>`;
          const cls = `trace-cell${isCond ? ' cond-cell' : ''}${changed ? ' flash' : ''}`;
          return `<span class="${cls}">${valHtml}</span>`;
        }).join('');
    }

    html += `<div class="src-line${active ? ' active' : ''}" data-line="${num}">` +
      `<span class="src-num">${num}</span>` +
      textHtml +
      tracePart +
      `</div>`;
  }

  sourceLines.innerHTML = html;

  if (currentLine > 0) {
    const el = sourceLines.querySelector(`.src-line[data-line="${currentLine}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/** 現在のイベント情報を描画 */
function renderCurrentEvent(event) {
  if (!event) {
    if (dbg?.isDone()) {
      currentEventEl.innerHTML = '<div class="done-badge">✓ 実行完了</div>';
    } else {
      currentEventEl.innerHTML = '<p class="placeholder">▶ Run を押してデバッグを開始</p>';
    }
    return;
  }

  const isEnter  = event.phase === 'enter';
  const hasValue = event.phase === 'exit' && event.value !== undefined;

  currentEventEl.innerHTML =
    `<div class="ev-phase ${isEnter ? 'ev-enter' : 'ev-exit'}">` +
      `${isEnter ? '▶ enter' : '◀ exit'}` +
    `</div>` +
    `<div class="ev-type">${esc(event.nodeType)}</div>` +
    `<div class="ev-meta">` +
      `<span>line ${event.loc.line} : col ${event.loc.column}</span>` +
      `<span>depth ${event.depth}</span>` +
      `<span>callDepth ${event.callDepth}</span>` +
    `</div>` +
    (hasValue
      ? `<div class="ev-value">` +
          `<div class="ev-value-label">VALUE</div>` +
          `${formatValue(event.value)}` +
        `</div>`
      : '');
}

/** 変数パネルを描画 */
function renderVariables(event) {
  if (!event?.env) {
    variablesEl.innerHTML = '<p class="placeholder">—</p>';
    return;
  }

  const frames     = event.env;
  const globalIdx  = frames.length - 1;
  const showByScope = scopeAllCb.checked;

  let html = '';

  if (showByScope) {
    // ── スコープ別表示（チェック時）────────────────────────────────────────
    // 全フレームをスコープラベル付きで表示（組み込みも含む）
    frames.forEach((frame, fi) => {
      const keys = Object.keys(frame).filter(k => !isInternal(frame[k]));
      if (keys.length === 0) return;

      const label = fi === 0
        ? 'Local'
        : fi === globalIdx
          ? 'Global'
          : `Outer ${fi}`;
      html += `<div class="scope-label">${label}</div>`;

      for (const k of keys) {
        html +=
          `<div class="var-row">` +
            `<span class="var-name">${esc(k)}</span>` +
            `<span class="var-value">${formatValue(frame[k])}</span>` +
          `</div>`;
      }
    });

  } else {
    // ── デフォルト表示（チェックなし）─────────────────────────────────────
    // 全スコープをマージ（内側優先）し、組み込みグローバルを除外する。
    // 表示対象:
    //   ① ユーザー定義の変数（関数・クラス以外）— 全スコープから
    //   ② グローバルスコープの組み込み名は除外
    //      （Math, console, Array … は通常変更されないため非表示）
    const merged = new Map();   // key → value（内側スコープが優先）

    for (let fi = 0; fi < frames.length; fi++) {
      const frame    = frames[fi];
      const isGlobal = fi === globalIdx;

      for (const k of Object.keys(frame)) {
        if (merged.has(k))         continue;   // 内側スコープ優先
        if (isInternal(frame[k])) continue;   // 関数・クラス定義は除外
        if (isGlobal && BUILTIN_NAMES.has(k)) continue;  // 組み込みは除外
        merged.set(k, frame[k]);
      }
    }

    for (const [k, v] of merged) {
      html +=
        `<div class="var-row">` +
          `<span class="var-name">${esc(k)}</span>` +
          `<span class="var-value">${formatValue(v)}</span>` +
        `</div>`;
    }
  }

  variablesEl.innerHTML = html || '<p class="placeholder">—</p>';
}

/** コールスタックを描画（引数値を含む） */
function renderCallStack(event) {
  if (!event) {
    callstackEl.innerHTML = '<p class="placeholder">—</p>';
    return;
  }

  const frames = [...(event.callStack ?? [])].reverse();
  let html = frames.map(f => {
    // 引数を最大 3 件フォーマット（それ以上は "…" で省略）
    let argsHtml = '';
    if (f.args && f.args.length > 0) {
      const parts = f.args.slice(0, 3).map(a => formatValue(a, 0));
      if (f.args.length > 3) parts.push('<span class="v-muted">…</span>');
      argsHtml = parts.join(', ');
    }
    return `<div class="stack-frame">` +
      `<span class="frame-name">${esc(f.name || '<anonymous>')}` +
        `<span class="frame-args">(${argsHtml})</span>` +
      `</span>` +
      `<span class="frame-loc">line ${f.loc.line}</span>` +
    `</div>`;
  }).join('');
  html += `<div class="stack-frame stack-top"><span class="frame-name">&lt;top&gt;</span></div>`;

  callstackEl.innerHTML = html;
}

/** コンソール出力パネルを描画 */
function renderConsole() {
  if (!dbg) {
    consoleEl.innerHTML   = '<p class="placeholder">—</p>';
    consoleCount.textContent = '';
    return;
  }

  const logs = dbg.getConsoleOutput();

  if (logs.length === 0) {
    consoleEl.innerHTML      = '<p class="placeholder">—</p>';
    consoleCount.textContent = '';
    return;
  }

  const BADGE = { log: 'log', warn: 'warn', error: 'err', info: 'info', debug: 'dbg' };

  consoleEl.innerHTML = logs.map(log =>
    `<div class="console-line console-${esc(log.level)}">` +
      `<span class="console-badge">${BADGE[log.level] ?? log.level}</span>` +
      `<span class="console-text">${esc(log.text)}</span>` +
    `</div>`
  ).join('');

  consoleCount.textContent = `${logs.length} 行`;

  // 最新行にスクロール
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/** すべてのパネルを最新状態に更新 */
function updateUI() {
  if (!dbg) return;

  const event  = dbg.getCurrentEvent();
  const done   = dbg.isDone();
  const cursor = dbg.cursor;
  const total  = dbg.trace.length;

  renderSource(dbg.source, event ? event.loc.line : 0, event);
  renderCurrentEvent(event);
  renderVariables(event);
  renderCallStack(event);
  renderConsole();

  stepCounter.textContent = done
    ? `完了（全 ${total} ステップ）`
    : `step ${cursor + 1} / ${total}`;

  // ボタンの enable / disable
  const canBack = cursor > 0;
  $('btn-step-in').disabled       = done;
  $('btn-step-over').disabled     = done;
  $('btn-step-out').disabled      = done;
  $('btn-step-back').disabled     = !canBack;
  $('btn-human-step').disabled    = done;
  $('btn-human-back').disabled    = !canBack;
  $('btn-continue').disabled      = done;
}

// ──────────────────────────────────────────────────────────────────────────────
// デバッガーのライフサイクル
// ──────────────────────────────────────────────────────────────────────────────

let dbg = null;

/** デバッグ開始 */
function startDebugger() {
  const source = sourceEditor.value;
  if (!source.trim()) return;

  try {
    dbg = new JSDebugger(source);
  } catch (e) {
    currentEventEl.innerHTML =
      `<div class="error-card">${esc(e.message)}</div>`;
    return;
  }

  // 条件式マップを1回だけ構築
  buildCondEventMap();

  // エディター → ソース表示に切り替え
  editorArea.classList.add('hidden');
  sourceDisplay.classList.remove('hidden');
  btnRun.classList.add('hidden');
  btnReset.classList.remove('hidden');
  $('btn-trace').classList.remove('hidden');

  updateUI();
}

/** デバッグ終了・エディターに戻る */
function resetDebugger() {
  dbg = null;

  // トレース状態をリセット
  traceEnabled = false;
  condEventMap = new Map();
  sourceDisplay.classList.remove('trace-on');
  const btnTrace = $('btn-trace');
  btnTrace.classList.add('hidden');
  btnTrace.classList.remove('active');

  editorArea.classList.remove('hidden');
  sourceDisplay.classList.add('hidden');
  btnRun.classList.remove('hidden');
  btnReset.classList.add('hidden');

  stepCounter.textContent      = '';
  currentEventEl.innerHTML     = '<p class="placeholder">▶ Run を押してデバッグを開始</p>';
  variablesEl.innerHTML        = '<p class="placeholder">—</p>';
  callstackEl.innerHTML        = '<p class="placeholder">—</p>';
  consoleEl.innerHTML          = '<p class="placeholder">—</p>';
  consoleCount.textContent     = '';

  for (const id of [
    'btn-step-in','btn-step-over','btn-step-out','btn-step-back',
    'btn-human-step','btn-human-back','btn-continue',
  ]) {
    $(id).disabled = true;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// イベントリスナー
// ──────────────────────────────────────────────────────────────────────────────

btnRun.addEventListener('click', startDebugger);
btnReset.addEventListener('click', resetDebugger);

$('btn-trace').addEventListener('click', () => {
  traceEnabled = !traceEnabled;
  $('btn-trace').classList.toggle('active', traceEnabled);
  updateUI();
});

$('btn-step-in').addEventListener('click',    () => { dbg?.stepIn();         updateUI(); });
$('btn-step-over').addEventListener('click',  () => { dbg?.stepOver();       updateUI(); });
$('btn-step-out').addEventListener('click',   () => { dbg?.stepOut();        updateUI(); });
$('btn-step-back').addEventListener('click',  () => { dbg?.stepBack();       updateUI(); });
$('btn-human-step').addEventListener('click', () => { dbg?.humanStep();      updateUI(); });
$('btn-human-back').addEventListener('click', () => { dbg?.humanStepBack();  updateUI(); });
$('btn-continue').addEventListener('click',   () => { dbg?.continue();       updateUI(); });

scopeAllCb.addEventListener('change', updateUI);

// キーボードショートカット（エディター外かつデバッグ中のみ）
document.addEventListener('keydown', e => {
  if (!dbg) return;
  if (e.target === sourceEditor) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case 'n':
    case 'Enter':
      e.preventDefault(); dbg.stepIn();        updateUI(); break;
    case 'v':
      e.preventDefault(); dbg.stepOver();      updateUI(); break;
    case 'o':
      e.preventDefault(); dbg.stepOut();       updateUI(); break;
    case 'b':
      e.preventDefault(); dbg.stepBack();      updateUI(); break;
    case 'h':
      if (!e.shiftKey) { e.preventDefault(); dbg.humanStep();     updateUI(); }
      break;
    case 'H':
      e.preventDefault(); dbg.humanStepBack(); updateUI(); break;
    case 'c':
      e.preventDefault(); dbg.continue();      updateUI(); break;
    case 'r':
      e.preventDefault(); resetDebugger(); break;
    case 't':
      e.preventDefault();
      traceEnabled = !traceEnabled;
      $('btn-trace').classList.toggle('active', traceEnabled);
      updateUI();
      break;
  }
});

// Tab キーでインデント挿入（エディター内）
sourceEditor.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = sourceEditor.selectionStart;
    const end   = sourceEditor.selectionEnd;
    sourceEditor.value =
      sourceEditor.value.slice(0, start) + '  ' + sourceEditor.value.slice(end);
    sourceEditor.selectionStart = sourceEditor.selectionEnd = start + 2;
  }
});

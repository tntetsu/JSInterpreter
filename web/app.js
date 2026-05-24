/**
 * app.js — JSInterpreter Web Debugger UI
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
// UI 描画
// ──────────────────────────────────────────────────────────────────────────────

/** ソースコード表示（currentLine の行をハイライト） */
function renderSource(source, currentLine) {
  const lines = source.split('\n');
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const num    = i + 1;
    const active = num === currentLine;
    html += `<div class="src-line${active ? ' active' : ''}" data-line="${num}">` +
      `<span class="src-num">${num}</span>` +
      `<span class="src-text">${esc(lines[i]) || ' '}</span>` +
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

  const showAll = scopeAllCb.checked;
  const frames  = showAll ? event.env : [event.env[0]].filter(Boolean);

  let html = '';
  frames.forEach((frame, fi) => {
    const keys = Object.keys(frame).filter(k => !isInternal(frame[k]));
    if (keys.length === 0) return;

    if (showAll) {
      const label = fi === 0
        ? 'Local'
        : fi === event.env.length - 1
          ? 'Global'
          : `Outer ${fi}`;
      html += `<div class="scope-label">${label}</div>`;
    }

    for (const k of keys) {
      html +=
        `<div class="var-row">` +
          `<span class="var-name">${esc(k)}</span>` +
          `<span class="var-value">${formatValue(frame[k])}</span>` +
        `</div>`;
    }
  });

  variablesEl.innerHTML = html || '<p class="placeholder">—</p>';
}

/** コールスタックを描画 */
function renderCallStack(event) {
  if (!event) {
    callstackEl.innerHTML = '<p class="placeholder">—</p>';
    return;
  }

  const frames = [...(event.callStack ?? [])].reverse();
  let html = frames.map(f =>
    `<div class="stack-frame">` +
      `<span class="frame-name">${esc(f.name || '<anonymous>')}</span>` +
      `<span class="frame-loc">line ${f.loc.line}</span>` +
    `</div>`
  ).join('');
  html += `<div class="stack-frame stack-top"><span class="frame-name">&lt;top&gt;</span></div>`;

  callstackEl.innerHTML = html;
}

/** すべてのパネルを最新状態に更新 */
function updateUI() {
  if (!dbg) return;

  const event  = dbg.getCurrentEvent();
  const done   = dbg.isDone();
  const cursor = dbg.cursor;
  const total  = dbg.trace.length;

  renderSource(dbg.source, event ? event.loc.line : 0);
  renderCurrentEvent(event);
  renderVariables(event);
  renderCallStack(event);

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

  // エディター → ソース表示に切り替え
  editorArea.classList.add('hidden');
  sourceDisplay.classList.remove('hidden');
  btnRun.classList.add('hidden');
  btnReset.classList.remove('hidden');

  updateUI();
}

/** デバッグ終了・エディターに戻る */
function resetDebugger() {
  dbg = null;

  editorArea.classList.remove('hidden');
  sourceDisplay.classList.add('hidden');
  btnRun.classList.remove('hidden');
  btnReset.classList.add('hidden');

  stepCounter.textContent      = '';
  currentEventEl.innerHTML     = '<p class="placeholder">▶ Run を押してデバッグを開始</p>';
  variablesEl.innerHTML        = '<p class="placeholder">—</p>';
  callstackEl.innerHTML        = '<p class="placeholder">—</p>';

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

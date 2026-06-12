import { createVirtualDocument, makeVNode, makeTextNode, serializeVNode, makeVEvent, _resetVnodeCounter } from './virtual-dom.js';
import { JSDebugger } from './debugger.js';

beforeEach(() => {
  _resetVnodeCounter();
});

// ── VirtualNode 基本 ──────────────────────────────────────────────────────────

test('T-01: createElement は __type__ と __vnode_id__ を持つ', () => {
  const doc = createVirtualDocument();
  const el  = doc.createElement('div');
  expect(el.__type__).toBe('VNode');
  expect(el.nodeType).toBe(1);
  expect(el.tagName).toBe('DIV');
  expect(typeof el.__vnode_id__).toBe('number');
});

test('T-02: __vnode_id__ は生成ごとに一意', () => {
  const doc = createVirtualDocument();
  const a = doc.createElement('div');
  const b = doc.createElement('span');
  expect(a.__vnode_id__).not.toBe(b.__vnode_id__);
});

test('T-03: createTextNode は nodeType=3 のノードを返す', () => {
  const doc = createVirtualDocument();
  const t = doc.createTextNode('hello');
  expect(t.__type__).toBe('VNode');
  expect(t.nodeType).toBe(3);
  expect(t._text).toBe('hello');
});

// ── appendChild / removeChild ─────────────────────────────────────────────────

test('T-04: appendChild は _children に追加して _parent を設定する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  doc.body.appendChild(div);
  expect(doc.body._children).toContain(div);
  expect(div._parent).toBe(doc.body);
});

test('T-05: removeChild は _children から削除して _parent を null にする', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  doc.body.appendChild(div);
  doc.body.removeChild(div);
  expect(doc.body._children).not.toContain(div);
  expect(div._parent).toBeNull();
});

test('T-06: appendChild は既に別の親に属する子を移動させる', () => {
  const doc = createVirtualDocument();
  const p1 = doc.createElement('div');
  const p2 = doc.createElement('div');
  const child = doc.createElement('span');
  p1.appendChild(child);
  p2.appendChild(child);
  expect(p1._children).not.toContain(child);
  expect(p2._children).toContain(child);
  expect(child._parent).toBe(p2);
});

// ── insertBefore ─────────────────────────────────────────────────────────────

test('T-07: insertBefore は refNode の前に挿入する', () => {
  const doc = createVirtualDocument();
  const a = doc.createElement('div');
  const b = doc.createElement('div');
  const c = doc.createElement('div');
  doc.body.appendChild(a);
  doc.body.appendChild(c);
  doc.body.insertBefore(b, c);
  expect(doc.body._children[0]).toBe(a);
  expect(doc.body._children[1]).toBe(b);
  expect(doc.body._children[2]).toBe(c);
});

// ── getElementById / querySelector ───────────────────────────────────────────

test('T-08: getElementById は id が一致する要素を返す', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.id = 'output';
  doc.body.appendChild(div);
  expect(doc.getElementById('output')).toBe(div);
});

test('T-09: getElementById は存在しない id に null を返す', () => {
  const doc = createVirtualDocument();
  expect(doc.getElementById('nothing')).toBeNull();
});

test('T-10: querySelector #id で要素を取得できる', () => {
  const doc = createVirtualDocument();
  const el = doc.createElement('p');
  el.id = 'msg';
  doc.body.appendChild(el);
  expect(doc.querySelector('#msg')).toBe(el);
});

test('T-11: querySelector .class で要素を取得できる', () => {
  const doc = createVirtualDocument();
  const el = doc.createElement('span');
  el.className = 'highlight active';
  doc.body.appendChild(el);
  expect(doc.querySelector('.highlight')).toBe(el);
  expect(doc.querySelector('.active')).toBe(el);
});

test('T-12: querySelector タグ名で要素を取得できる', () => {
  const doc = createVirtualDocument();
  const el = doc.createElement('h1');
  doc.body.appendChild(el);
  expect(doc.querySelector('h1')).toBe(el);
});

// ── textContent ───────────────────────────────────────────────────────────────

test('T-13: textContent setter は _children をテキストノード 1 つに置換する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.textContent = 'Hello';
  expect(div._children.length).toBe(1);
  expect(div._children[0].nodeType).toBe(3);
  expect(div._children[0]._text).toBe('Hello');
});

test('T-14: textContent getter は子孫テキストを連結して返す', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  const p = doc.createElement('p');
  p.textContent = 'world';
  div.appendChild(doc.createTextNode('hello '));
  div.appendChild(p);
  expect(div.textContent).toBe('hello world');
});

test('T-15: textContent に空文字を設定すると _children が空になる', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.textContent = 'foo';
  div.textContent = '';
  expect(div._children.length).toBe(0);
});

// ── innerHTML ─────────────────────────────────────────────────────────────────

test('T-16: innerHTML getter はシリアライズ HTML を返す', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.textContent = 'hi';
  expect(div.innerHTML).toBe('hi');
});

test('T-17: innerHTML setter はシンプルなタグを解析する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.innerHTML = '<span>text</span>';
  expect(div._children.length).toBe(1);
  expect(div._children[0].tagName).toBe('SPAN');
  expect(div._children[0].textContent).toBe('text');
});

test('T-18: innerHTML setter は id/class 属性を解析する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.innerHTML = '<p id="msg" class="box">hello</p>';
  const p = div._children[0];
  expect(p.tagName).toBe('P');
  expect(p.id).toBe('msg');
  expect(p.className).toBe('box');
  expect(p.textContent).toBe('hello');
});

test('T-19: innerHTML setter はネストしたタグを解析する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.innerHTML = '<ul><li>a</li><li>b</li></ul>';
  const ul = div._children[0];
  expect(ul.tagName).toBe('UL');
  expect(ul._children.length).toBe(2);
  expect(ul._children[0].textContent).toBe('a');
  expect(ul._children[1].textContent).toBe('b');
});

test('T-20: innerHTML setter は自己完結タグを解析する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.innerHTML = 'before<br>after';
  expect(div._children.length).toBe(3);
  expect(div._children[1].tagName).toBe('BR');
});

// ── setAttribute / getAttribute ───────────────────────────────────────────────

test('T-21: setAttribute / getAttribute が動作する', () => {
  const doc = createVirtualDocument();
  const a = doc.createElement('a');
  a.setAttribute('href', 'https://example.com');
  expect(a.getAttribute('href')).toBe('https://example.com');
});

test('T-22: setAttribute の id / class は対応するプロパティも更新する', () => {
  const doc = createVirtualDocument();
  const el = doc.createElement('div');
  el.setAttribute('id', 'box');
  el.setAttribute('class', 'highlight');
  expect(el.id).toBe('box');
  expect(el.className).toBe('highlight');
});

test('T-23: removeAttribute は属性を削除する', () => {
  const doc = createVirtualDocument();
  const el = doc.createElement('div');
  el.setAttribute('data-x', '1');
  el.removeAttribute('data-x');
  expect(el.getAttribute('data-x')).toBeNull();
});

// ── style ────────────────────────────────────────────────────────────────────

test('T-24: style プロパティへの直接代入が動作する', () => {
  const doc = createVirtualDocument();
  const el  = doc.createElement('div');
  el.style.color = 'red';
  el.style.fontSize = '16px';
  expect(el.style.color).toBe('red');
  expect(el.style.fontSize).toBe('16px');
});

// ── serializeVNode ────────────────────────────────────────────────────────────

test('T-25: serializeVNode はプレーンオブジェクトを返す', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.id = 'test';
  div.textContent = 'hello';
  doc.body.appendChild(div);
  const snap = serializeVNode(doc.body);
  expect(snap.tagName).toBe('BODY');
  expect(snap.children.length).toBe(1);
  expect(snap.children[0].tagName).toBe('DIV');
  expect(snap.children[0].id).toBe('test');
  expect(snap.children[0].__vnode_id__).toBe(div.__vnode_id__);
});

test('T-26: serializeVNode はテキストノードを含む', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.textContent = 'hi';
  const snap = serializeVNode(div);
  expect(snap.children[0].nodeType).toBe(3);
  expect(snap.children[0].text).toBe('hi');
});

// ── JSDebugger DOM モード ─────────────────────────────────────────────────────

test('T-27: dom:true で document が利用できる', () => {
  const dbg = new JSDebugger(`
    const div = document.createElement('div');
    div.textContent = 'hello';
    document.body.appendChild(div);
  `, { dom: true });
  expect(dbg.trace.length).toBeGreaterThan(0);
  // エラーなく実行完了
});

test('T-28: dom:false のとき domSnapshot は null', () => {
  const dbg = new JSDebugger('const x = 1;');
  expect(dbg.trace[0].domSnapshot).toBeNull();
});

test('T-29: dom:true のとき各 TraceEvent に domSnapshot が含まれる', () => {
  const dbg = new JSDebugger('const x = 1;', { dom: true });
  for (const ev of dbg.trace) {
    expect(ev.domSnapshot).not.toBeUndefined();
  }
});

test('T-30: appendChild 後の domSnapshot に要素が含まれる', () => {
  const dbg = new JSDebugger(`
    const div = document.createElement('div');
    div.id = 'target';
    document.body.appendChild(div);
  `, { dom: true });

  // appendChild の exit イベントを探す（body に子が追加された後）
  const lastSnap = dbg.trace[dbg.trace.length - 1].domSnapshot;
  expect(lastSnap).not.toBeNull();
  expect(lastSnap.children.length).toBeGreaterThan(0);
  expect(lastSnap.children[0].id).toBe('target');
});

test('T-31: domSnapshot はステップごとに変化を反映する', () => {
  const dbg = new JSDebugger(`
    const div = document.createElement('div');
    document.body.appendChild(div);
  `, { dom: true });

  const snapshots = dbg.trace.map(e => e.domSnapshot.children.length);
  // 最初は 0（appendChild 前）、最後は 1（appendChild 後）が存在するはず
  expect(snapshots[0]).toBe(0);
  expect(snapshots[snapshots.length - 1]).toBe(1);
});

test('T-32: getElementById は JSDebugger 経由で動作する', () => {
  const dbg = new JSDebugger(`
    const el = document.createElement('p');
    el.id = 'out';
    document.body.appendChild(el);
    const found = document.getElementById('out');
    const ok = (found !== null);
  `, { dom: true });
  // エラーなく実行完了し、ok=true が env に存在する
  const lastEnv = dbg.trace[dbg.trace.length - 1].env;
  const flat = {};
  for (const frame of lastEnv) Object.assign(flat, frame);
  expect(flat.ok).toBe(true);
});

// ── Phase 5: イベントシステム ─────────────────────────────────────────────────

function getLastEnvFlat(dbg) {
  const flat = {};
  for (const frame of dbg.trace[dbg.trace.length - 1].env) {
    Object.assign(flat, frame);
  }
  return flat;
}

test('T-33: addEventListener はリスナーを _listeners に格納する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  const fn = () => {};
  div.addEventListener('click', fn);
  expect(div._listeners['click']).toContain(fn);
});

test('T-34: removeEventListener はリスナーを削除する', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  const fn = () => {};
  div.addEventListener('click', fn);
  div.removeEventListener('click', fn);
  expect(div._listeners['click'] ?? []).not.toContain(fn);
});

test('T-35: dispatchEvent はリスナーを呼び出す', () => {
  const dbg = new JSDebugger(`
    let called = false;
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.addEventListener('click', function() { called = true; });
    div.dispatchEvent(new Event('click'));
  `, { dom: true });
  expect(getLastEnvFlat(dbg).called).toBe(true);
});

test('T-36: dispatchEvent は親ノードにバブリングする', () => {
  const dbg = new JSDebugger(`
    let parentCalled = false;
    const child = document.createElement('span');
    const parent = document.createElement('div');
    parent.appendChild(child);
    document.body.appendChild(parent);
    parent.addEventListener('click', function() { parentCalled = true; });
    child.dispatchEvent(new Event('click'));
  `, { dom: true });
  expect(getLastEnvFlat(dbg).parentCalled).toBe(true);
});

test('T-37: stopPropagation でバブリングを止められる', () => {
  const dbg = new JSDebugger(`
    let parentCalled = false;
    const child = document.createElement('span');
    const parent = document.createElement('div');
    parent.appendChild(child);
    document.body.appendChild(parent);
    child.addEventListener('click', function(e) { e.stopPropagation(); });
    parent.addEventListener('click', function() { parentCalled = true; });
    child.dispatchEvent(new Event('click'));
  `, { dom: true });
  expect(getLastEnvFlat(dbg).parentCalled).toBe(false);
});

test('T-38: bubbles:false のイベントはバブリングしない', () => {
  const dbg = new JSDebugger(`
    let parentCalled = false;
    const child = document.createElement('span');
    const parent = document.createElement('div');
    parent.appendChild(child);
    document.body.appendChild(parent);
    parent.addEventListener('custom', function() { parentCalled = true; });
    child.dispatchEvent(new Event('custom', { bubbles: false }));
  `, { dom: true });
  expect(getLastEnvFlat(dbg).parentCalled).toBe(false);
});

test('T-39: イベントハンドラの実行がトレースに記録される', () => {
  const dbg = new JSDebugger(`
    let count = 0;
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.addEventListener('click', function() { count++; });
    btn.dispatchEvent(new Event('click'));
    btn.dispatchEvent(new Event('click'));
  `, { dom: true });
  expect(getLastEnvFlat(dbg).count).toBe(2);
});

test('T-40: new MouseEvent で clientX/Y を持つイベントを生成できる', () => {
  const dbg = new JSDebugger(`
    const e = new MouseEvent('click', { clientX: 10, clientY: 20 });
    const ok = e.type === 'click' && e.clientX === 10 && e.clientY === 20;
  `, { dom: true });
  expect(getLastEnvFlat(dbg).ok).toBe(true);
});

test('T-41: makeVEvent で VEvent オブジェクトを生成できる', () => {
  const ev = makeVEvent('focus', { bubbles: false, cancelable: false });
  expect(ev.__type__).toBe('VEvent');
  expect(ev.type).toBe('focus');
  expect(ev.bubbles).toBe(false);
  expect(ev.cancelable).toBe(false);
  expect(typeof ev.stopPropagation).toBe('function');
  expect(typeof ev.preventDefault).toBe('function');
});

test('T-42: document.addEventListener でドキュメントレベルのイベントを受け取れる', () => {
  const dbg = new JSDebugger(`
    let docCalled = false;
    document.addEventListener('click', function() { docCalled = true; });
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.dispatchEvent(new Event('click'));
  `, { dom: true });
  expect(getLastEnvFlat(dbg).docCalled).toBe(true);
});

test('T-43: parentNode / parentElement が正しく返る', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  const span = doc.createElement('span');
  div.appendChild(span);
  expect(span.parentNode).toBe(div);
  expect(span.parentElement).toBe(div);
  expect(div.parentNode).toBeNull();
});

// ── Phase 7: classList / closest / matches / 複合セレクタ ──────────────────

test('T-44: classList.add でクラスを追加できる', () => {
  const doc = createVirtualDocument();
  const li = doc.createElement('li');
  li.classList.add('active');
  expect(li.className).toBe('active');
  li.classList.add('done');
  expect(li.className).toBe('active done');
  li.classList.add('active');  // 重複追加なし
  expect(li.className).toBe('active done');
});

test('T-45: classList.remove でクラスを削除できる', () => {
  const doc = createVirtualDocument();
  const li = doc.createElement('li');
  li.className = 'active done';
  li.classList.remove('done');
  expect(li.className).toBe('active');
});

test('T-46: classList.toggle でクラスを切り替えられる', () => {
  const doc = createVirtualDocument();
  const li = doc.createElement('li');
  expect(li.classList.toggle('done')).toBe(true);
  expect(li.className).toBe('done');
  expect(li.classList.toggle('done')).toBe(false);
  expect(li.className).toBe('');
});

test('T-47: classList.contains でクラスの有無を確認できる', () => {
  const doc = createVirtualDocument();
  const li = doc.createElement('li');
  li.className = 'foo bar';
  expect(li.classList.contains('foo')).toBe(true);
  expect(li.classList.contains('baz')).toBe(false);
});

test('T-48: closest() は親チェーンを辿って一致するノードを返す', () => {
  const doc = createVirtualDocument();
  const ul  = doc.createElement('ul');
  const li  = doc.createElement('li');
  const span = doc.createElement('span');
  ul.appendChild(li);
  li.appendChild(span);
  doc.body.appendChild(ul);
  expect(span.closest('li')).toBe(li);
  expect(span.closest('ul')).toBe(ul);
  expect(span.closest('div')).toBeNull();
});

test('T-49: matches() はセレクタに一致するか検査する', () => {
  const doc = createVirtualDocument();
  const li = doc.createElement('li');
  li.className = 'done';
  li.id = 'item1';
  expect(li.matches('li')).toBe(true);
  expect(li.matches('.done')).toBe(true);
  expect(li.matches('li.done')).toBe(true);
  expect(li.matches('li#item1')).toBe(true);
  expect(li.matches('.other')).toBe(false);
  expect(li.matches('div')).toBe(false);
});

test('T-50: classList.toggle が JSDebugger でトレースされる', () => {
  const dbg = new JSDebugger(`
    const li = document.createElement('li');
    li.className = 'item';
    document.body.appendChild(li);
    li.classList.toggle('done');
    li.classList.toggle('done');
    li.classList.toggle('done');
    const hasDone = li.classList.contains('done');
  `, { dom: true });
  expect(getLastEnvFlat(dbg).hasDone).toBe(true);
});

test('T-51: serializeVNode に value プロパティが含まれる', () => {
  const doc = createVirtualDocument();
  const input = doc.createElement('input');
  input.value = 'hello';
  doc.body.appendChild(input);
  const snap = serializeVNode(doc.body);
  expect(snap.children[0].value).toBe('hello');
});

test('T-52: input.value が JSDebugger + イベントシーケンスで更新される', () => {
  const dbg = new JSDebugger(`
    const input = document.getElementById('name');
    let captured = '';
    input.addEventListener('input', function(e) {
      captured = input.value;
    });
  `, {
    dom: true,
    initialBodyHTML: '<input id="name">',
    events: [{ type: 'input', target: '#name', value: 'Alice' }],
  });
  expect(getLastEnvFlat(dbg).captured).toBe('Alice');
});

test('T-53: querySelector で複合セレクタ（tag.class）が使える', () => {
  const doc = createVirtualDocument();
  const div = doc.createElement('div');
  div.className = 'box active';
  doc.body.appendChild(div);
  expect(doc.querySelector('div.active')).toBe(div);
  expect(doc.querySelector('div.other')).toBeNull();
});

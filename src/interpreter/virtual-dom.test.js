import { createVirtualDocument, makeVNode, makeTextNode, serializeVNode, _resetVnodeCounter } from './virtual-dom.js';
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

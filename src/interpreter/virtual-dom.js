/**
 * virtual-dom.js — VirtualDOM（DOM API の軽量実装）
 *
 * JSDebugger の { dom: true } オプション時に createGlobalEnv 後に
 * document / window を env に登録するために使う。
 *
 * 設計方針:
 *  - VNode はプレーンオブジェクト（__type__: 'VNode'）
 *  - textContent / innerHTML は Object.defineProperty で getter/setter を実装
 *    → interpreter の assignTo が obj[key] = val を実行するため setter が呼ばれる
 *  - _parent / _doc は enumerable: false → deepClone に含まれず循環参照が起きない
 *  - _listeners は enumerable: false → deepClone・serializeVNode に含まれない
 *  - __vnode_id__ は生成時に単調増加カウンタで付与（削除後も再利用しない）
 */

// ── グローバルカウンタ ────────────────────────────────────────────────────────

let _vnodeCounter = 0;

/** テスト用にカウンタをリセットする（本番コードでは使わない） */
export function _resetVnodeCounter() { _vnodeCounter = 0; }

// ── イベントオブジェクト ───────────────────────────────────────────────────────

/**
 * VEvent を生成する。Event / MouseEvent 等コンストラクタの実体。
 * @param {string} type
 * @param {{ bubbles?: boolean, cancelable?: boolean }} [opts]
 */
export function makeVEvent(type, opts = {}) {
  const bubbles    = opts.bubbles    !== false;
  const cancelable = opts.cancelable !== false;
  const ev = {
    __type__:      'VEvent',
    type:          String(type ?? ''),
    bubbles,
    cancelable,
    target:        null,
    currentTarget: null,
    _defaultPrevented:  false,
    _stopped:           false,
    _stoppedImmediate:  false,
  };
  ev.preventDefault = function() {
    if (ev.cancelable) ev._defaultPrevented = true;
  };
  ev.stopPropagation = function() {
    ev._stopped = true;
  };
  ev.stopImmediatePropagation = function() {
    ev._stopped = true;
    ev._stoppedImmediate = true;
  };
  return ev;
}

// ── テキストノード ────────────────────────────────────────────────────────────

function makeTextNode(text) {
  const node = {
    __type__: 'VNode',
    __vnode_id__: ++_vnodeCounter,
    nodeType: 3,
    _text: String(text ?? ''),
  };

  Object.defineProperty(node, '_parent', {
    value: null, writable: true, enumerable: false, configurable: true,
  });

  Object.defineProperty(node, 'textContent', {
    get() { return node._text; },
    set(v) { node._text = String(v ?? ''); },
    enumerable: true, configurable: true,
  });

  Object.defineProperty(node, 'nodeValue', {
    get() { return node._text; },
    set(v) { node._text = String(v ?? ''); },
    enumerable: true, configurable: true,
  });

  return node;
}

// ── 要素ノード ────────────────────────────────────────────────────────────────

function makeVNode(tagName, doc) {
  const node = {
    __type__: 'VNode',
    __vnode_id__: ++_vnodeCounter,
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    style: {},
    _attributes: {},
    _children: [],
  };

  Object.defineProperty(node, '_parent', {
    value: null, writable: true, enumerable: false, configurable: true,
  });
  Object.defineProperty(node, '_doc', {
    value: doc, writable: true, enumerable: false, configurable: true,
  });

  // ── textContent getter/setter ──────────────────────────────────────────────

  Object.defineProperty(node, 'textContent', {
    get() { return gatherText(node._children); },
    set(v) {
      const s = String(v ?? '');
      node._children = [];
      if (s !== '') {
        const t = makeTextNode(s);
        t._parent = node;
        node._children.push(t);
      }
    },
    enumerable: true, configurable: true,
  });

  // ── innerHTML getter/setter ────────────────────────────────────────────────

  Object.defineProperty(node, 'innerHTML', {
    get() { return serializeHTML(node._children); },
    set(v) {
      const parsed = parseHTMLFragment(String(v ?? ''), node._doc);
      for (const child of parsed) child._parent = node;
      node._children = parsed;
    },
    enumerable: true, configurable: true,
  });

  // ── children（読み取り専用の getter） ─────────────────────────────────────

  Object.defineProperty(node, 'children', {
    get() { return node._children.filter(c => c.nodeType === 1); },
    enumerable: true, configurable: true,
  });

  Object.defineProperty(node, 'childNodes', {
    get() { return node._children.slice(); },
    enumerable: true, configurable: true,
  });

  // ── parentNode / parentElement ─────────────────────────────────────────────

  Object.defineProperty(node, 'parentNode', {
    get() { return node._parent; },
    enumerable: true, configurable: true,
  });

  Object.defineProperty(node, 'parentElement', {
    get() {
      return (node._parent && node._parent.nodeType === 1) ? node._parent : null;
    },
    enumerable: true, configurable: true,
  });

  // ── DOM 操作メソッド ───────────────────────────────────────────────────────

  node.appendChild = function(child) {
    if (!child || typeof child !== 'object') return child;
    if (child._parent) {
      const siblings = child._parent._children;
      const i = siblings.indexOf(child);
      if (i !== -1) siblings.splice(i, 1);
    }
    child._parent = node;
    node._children.push(child);
    return child;
  };

  node.removeChild = function(child) {
    const i = node._children.indexOf(child);
    if (i === -1) return child;
    node._children.splice(i, 1);
    child._parent = null;
    return child;
  };

  node.insertBefore = function(newNode, refNode) {
    if (!newNode) return newNode;
    if (!refNode) return node.appendChild(newNode);
    const i = node._children.indexOf(refNode);
    if (i === -1) return node.appendChild(newNode);
    if (newNode._parent) {
      const siblings = newNode._parent._children;
      const j = siblings.indexOf(newNode);
      if (j !== -1) siblings.splice(j, 1);
    }
    newNode._parent = node;
    node._children.splice(i, 0, newNode);
    return newNode;
  };

  node.setAttribute = function(name, value) {
    const k = String(name);
    node._attributes[k] = String(value ?? '');
    if (k === 'id')    node.id        = node._attributes[k];
    if (k === 'class') node.className = node._attributes[k];
  };

  node.getAttribute = function(name) {
    const k = String(name);
    if (k === 'id')    return node.id;
    if (k === 'class') return node.className;
    return Object.prototype.hasOwnProperty.call(node._attributes, k)
      ? node._attributes[k]
      : null;
  };

  node.removeAttribute = function(name) {
    const k = String(name);
    delete node._attributes[k];
    if (k === 'id')    node.id = '';
    if (k === 'class') node.className = '';
  };

  node.querySelector = function(selector) {
    return queryOne(node, selector);
  };

  node.querySelectorAll = function(selector) {
    const result = [];
    queryAll(node, selector, result);
    return result;
  };

  node.cloneNode = function(deep) {
    return cloneVNode(node, deep);
  };

  // ── classList ─────────────────────────────────────────────────────────────

  Object.defineProperty(node, 'classList', {
    get() {
      const getClasses = () =>
        node.className ? node.className.split(/\s+/).filter(Boolean) : [];
      return {
        __type__: 'DOMTokenList',
        add(...names) {
          const cls = getClasses();
          for (const n of names) if (!cls.includes(n)) cls.push(n);
          node.className = cls.join(' ');
        },
        remove(...names) {
          let cls = getClasses();
          for (const n of names) cls = cls.filter(c => c !== n);
          node.className = cls.join(' ');
        },
        toggle(name, force) {
          const cls = getClasses();
          const has = cls.includes(name);
          if (force === true || (force === undefined && !has)) {
            if (!has) cls.push(name);
            node.className = cls.join(' ');
            return true;
          }
          node.className = cls.filter(c => c !== name).join(' ');
          return false;
        },
        contains(name) { return getClasses().includes(name); },
        replace(oldName, newName) {
          const cls = getClasses();
          const i = cls.indexOf(oldName);
          if (i !== -1) { cls[i] = newName; node.className = cls.join(' '); return true; }
          return false;
        },
        get length() { return getClasses().length; },
        item(i) { return getClasses()[i] ?? null; },
        toString() { return node.className; },
      };
    },
    enumerable: false,
    configurable: true,
  });

  // ── closest / matches ──────────────────────────────────────────────────────

  node.closest = function(selector) {
    let n = node;
    while (n && n.nodeType === 1) {
      if (matchesSelector(n, selector)) return n;
      n = n._parent ?? null;
    }
    return null;
  };

  node.matches = function(selector) {
    return matchesSelector(node, selector);
  };

  // ── イベントリスナー ───────────────────────────────────────────────────────

  Object.defineProperty(node, '_listeners', {
    value: Object.create(null),
    writable: false,
    enumerable: false,
    configurable: true,
  });

  node.addEventListener = function(type, fn) {
    if (fn == null) return;
    const t = String(type);
    if (!node._listeners[t]) node._listeners[t] = [];
    if (!node._listeners[t].includes(fn)) node._listeners[t].push(fn);
  };

  node.removeEventListener = function(type, fn) {
    const t = String(type);
    if (!node._listeners[t]) return;
    node._listeners[t] = node._listeners[t].filter(f => f !== fn);
  };

  node.dispatchEvent = function(event) {
    if (!event) return true;
    const rec = node._doc?._recorder ?? null;
    const cfn = node._doc?._callFn   ?? null;
    return dispatchEventOnNode(node, event, rec, cfn);
  };

  return node;
}

// ── テキスト収集 ──────────────────────────────────────────────────────────────

function gatherText(children) {
  let s = '';
  for (const c of children) {
    if (c.nodeType === 3) s += c._text;
    else if (c.nodeType === 1) s += gatherText(c._children);
  }
  return s;
}

// ── HTML シリアライザ ─────────────────────────────────────────────────────────

const VOID_TAGS = new Set([
  'AREA','BASE','BR','COL','EMBED','HR','IMG','INPUT',
  'LINK','META','PARAM','SOURCE','TRACK','WBR',
]);

function serializeHTML(children) {
  return children.map(c => {
    if (c.nodeType === 3) return escapeHTML(c._text);
    const tag = c.tagName.toLowerCase();
    const attrs = buildAttrStr(c);
    if (VOID_TAGS.has(c.tagName)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${serializeHTML(c._children)}</${tag}>`;
  }).join('');
}

function buildAttrStr(node) {
  let s = '';
  if (node.id)        s += ` id="${escAttr(node.id)}"`;
  if (node.className) s += ` class="${escAttr(node.className)}"`;
  const styleStr = Object.entries(node.style)
    .map(([k, v]) => `${camelToKebab(k)}:${v}`)
    .join(';');
  if (styleStr) s += ` style="${escAttr(styleStr)}"`;
  for (const [k, v] of Object.entries(node._attributes)) {
    if (k !== 'id' && k !== 'class' && k !== 'style') {
      s += ` ${escAttr(k)}="${escAttr(v)}"`;
    }
  }
  return s;
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function camelToKebab(s) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// ── 最小 HTML パーサー ────────────────────────────────────────────────────────

/**
 * HTML 文字列を VNode の配列に変換する（innerHTML setter 用）。
 *
 * 対応サブセット:
 *   - 開始タグ（属性 id / class / style / その他クォート属性）
 *   - 終了タグ
 *   - 自己完結タグ（VOID_TAGS）
 *   - テキストノード
 *
 * 非対応: HTML エンティティ、コメント、スクリプト/スタイルタグ内の特殊処理
 */
function parseHTMLFragment(html, doc) {
  const root = [];
  const stack = [{ _children: root }];  // ダミールート

  // トークナイザ（正規表現ベースの簡易実装）
  const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\s*\/?>/g;
  let lastIndex = 0;

  let m;
  while ((m = TAG_RE.exec(html)) !== null) {
    // タグ前のテキスト
    if (m.index > lastIndex) {
      const text = html.slice(lastIndex, m.index);
      if (text) {
        const t = makeTextNode(text);
        stack[stack.length - 1]._children.push(t);
      }
    }
    lastIndex = TAG_RE.lastIndex;

    const full     = m[0];
    const tagName  = m[1].toUpperCase();
    const attrStr  = m[2] || '';
    const isClose  = full.startsWith('</');
    const isSelfClose = full.endsWith('/>') || VOID_TAGS.has(tagName);

    if (isClose) {
      // 対応する開始タグを探してスタックを巻き戻す
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tagName) {
          stack.length = i;
          break;
        }
      }
    } else {
      const el = makeVNode(tagName, doc);
      parseAttrs(attrStr, el);
      stack[stack.length - 1]._children.push(el);
      if (!isSelfClose) stack.push(el);
    }
  }

  // 末尾テキスト
  if (lastIndex < html.length) {
    const text = html.slice(lastIndex);
    if (text) stack[stack.length - 1]._children.push(makeTextNode(text));
  }

  return root;
}

function parseAttrs(attrStr, node) {
  // 属性パターン: name="value" / name='value' / name=value / name（ブール属性）
  const ATTR_RE = /([a-zA-Z][a-zA-Z0-9\-_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m;
  while ((m = ATTR_RE.exec(attrStr)) !== null) {
    const name  = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (name === 'id')    node.id        = value;
    else if (name === 'class') node.className = value;
    else if (name === 'style') parseInlineStyle(value, node.style);
    else                  node._attributes[name] = value;
  }
}

function parseInlineStyle(styleStr, styleObj) {
  for (const decl of styleStr.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    const val  = decl.slice(colon + 1).trim();
    if (prop) styleObj[kebabToCamel(prop)] = val;
  }
}

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ── クローン ──────────────────────────────────────────────────────────────────

function cloneVNode(node, deep) {
  if (node.nodeType === 3) {
    return makeTextNode(node._text);
  }
  const clone = makeVNode(node.tagName, node._doc);
  clone.id        = node.id;
  clone.className = node.className;
  Object.assign(clone.style, node.style);
  Object.assign(clone._attributes, node._attributes);
  if (deep) {
    for (const child of node._children) {
      const cc = cloneVNode(child, true);
      cc._parent = clone;
      clone._children.push(cc);
    }
  }
  return clone;
}

// ── イベントディスパッチ ──────────────────────────────────────────────────────

/**
 * target からバブリングチェーンを辿ってリスナーを呼び出す。
 * callFn が null の場合（テスト等）は何もしない。
 */
function dispatchEventOnNode(target, event, recorder, callFn) {
  if (!event || !callFn) return true;

  const type    = String(event.type ?? '');
  const bubbles = event.bubbles !== false;

  event.target            = target;
  event._stopped          = false;
  event._stoppedImmediate = false;
  event._defaultPrevented = false;

  // バブリングチェーン: target → parent 列 → document → window
  const chain = [];
  let n = target;
  while (n) {
    chain.push(n);
    n = n._parent ?? null;
  }
  const doc = target._doc ?? null;
  if (doc) chain.push(doc);
  const win = doc?._window ?? null;
  if (win) chain.push(win);

  for (let i = 0; i < chain.length; i++) {
    if (i > 0 && !bubbles) break;
    if (event._stopped) break;

    const current = chain[i];
    event.currentTarget = current;

    const listeners = current._listeners?.[type];
    if (listeners && listeners.length > 0) {
      for (const fn of [...listeners]) {
        if (event._stoppedImmediate) break;
        const callDepth = recorder ? recorder.callStack.length : 0;
        callFn(fn, [event], current, recorder, 0, callDepth,
               { line: 0, column: 0 });
      }
    }
  }

  return !event._defaultPrevented;
}

// ── querySelector / querySelectorAll ─────────────────────────────────────────

/**
 * 単純セレクタ（スペースなし・結合子なし）に対応:
 *   tag              tagName 一致
 *   #id              id 一致
 *   .class           className に含まれる
 *   tag.class        tag かつ class（複合）
 *   tag#id           tag かつ id（複合）
 *   .cls1.cls2       複数クラス（すべて含む）
 *   tag.cls1.cls2    tag かつ複数クラス
 */
function matchesSelector(node, selector) {
  if (node.nodeType !== 1) return false;
  const s = selector.trim();

  // タグ部分（先頭の英字列）と修飾子部分（.class / #id）に分割
  const tagMatch = s.match(/^[a-zA-Z][a-zA-Z0-9]*/);
  const tagPart  = tagMatch ? tagMatch[0] : '';
  const rest     = s.slice(tagPart.length);

  if (tagPart && node.tagName !== tagPart.toUpperCase()) return false;

  const modifiers = rest.match(/[.#][^.#]*/g) ?? [];
  for (const mod of modifiers) {
    if (mod.startsWith('#')) {
      if (node.id !== mod.slice(1)) return false;
    } else if (mod.startsWith('.')) {
      if (!node.className.split(/\s+/).includes(mod.slice(1))) return false;
    }
  }

  return true;
}

function queryOne(root, selector) {
  for (const child of root._children ?? []) {
    if (matchesSelector(child, selector)) return child;
    const found = queryOne(child, selector);
    if (found) return found;
  }
  return null;
}

function queryAll(root, selector, result) {
  for (const child of root._children ?? []) {
    if (matchesSelector(child, selector)) result.push(child);
    queryAll(child, selector, result);
  }
}

// ── VirtualDocument ───────────────────────────────────────────────────────────

/**
 * VirtualDocument を生成する。
 * @param {object|null} recorder  Recorder インスタンス（DOM モード時に渡す）
 * @param {Function|null} callFn  interpreter.js の callFunction（イベント発火用）
 */
function createVirtualDocument(recorder = null, callFn = null) {
  // HTML > HEAD / BODY の最小ツリーを初期化
  const htmlEl = makeVNode('HTML', null);
  const headEl = makeVNode('HEAD', null);
  const bodyEl = makeVNode('BODY', null);
  headEl._parent = htmlEl;
  bodyEl._parent = htmlEl;
  htmlEl._children = [headEl, bodyEl];

  const doc = {
    __type__: 'VDocument',
    documentElement: htmlEl,
    head: headEl,
    body: bodyEl,
  };

  // _recorder / _callFn / _window / _listeners は非列挙（スナップショット・deepClone に含めない）
  Object.defineProperty(doc, '_recorder', {
    value: recorder, writable: true, enumerable: false, configurable: true,
  });
  Object.defineProperty(doc, '_callFn', {
    value: callFn, writable: true, enumerable: false, configurable: true,
  });
  Object.defineProperty(doc, '_window', {
    value: null, writable: true, enumerable: false, configurable: true,
  });
  Object.defineProperty(doc, '_listeners', {
    value: Object.create(null), writable: false, enumerable: false, configurable: true,
  });

  // _doc の後付け設定
  htmlEl._doc = doc;
  headEl._doc = doc;
  bodyEl._doc = doc;

  doc.createElement = function(tagName) {
    return makeVNode(String(tagName), doc);
  };

  doc.createTextNode = function(text) {
    return makeTextNode(text);
  };

  doc.getElementById = function(id) {
    return queryOne(doc.body, '#' + id);
  };

  doc.querySelector = function(selector) {
    return queryOne(doc.body, selector);
  };

  doc.querySelectorAll = function(selector) {
    const result = [];
    queryAll(doc.body, selector, result);
    return result;
  };

  doc.snapshot = function() {
    return serializeVNode(doc.body);
  };

  doc.parseAndSetBody = function(htmlString) {
    doc.body.innerHTML = String(htmlString ?? '');
  };

  // ── document レベルのイベントリスナー ──────────────────────────────────────

  doc.addEventListener = function(type, fn) {
    if (fn == null) return;
    const t = String(type);
    if (!doc._listeners[t]) doc._listeners[t] = [];
    if (!doc._listeners[t].includes(fn)) doc._listeners[t].push(fn);
  };

  doc.removeEventListener = function(type, fn) {
    const t = String(type);
    if (!doc._listeners[t]) return;
    doc._listeners[t] = doc._listeners[t].filter(f => f !== fn);
  };

  doc.dispatchEvent = function(event) {
    if (!event) return true;
    return dispatchEventOnNode(doc, event, doc._recorder, doc._callFn);
  };

  return doc;
}

// ── スナップショット（domSnapshot 用） ────────────────────────────────────────

function serializeVNode(node) {
  if (!node) return null;
  if (node.nodeType === 3) {
    return { nodeType: 3, __vnode_id__: node.__vnode_id__, text: node._text };
  }
  const snap = {
    nodeType: 1,
    __vnode_id__: node.__vnode_id__,
    tagName: node.tagName,
    id: node.id,
    className: node.className,
    style: { ...node.style },
    attributes: { ...node._attributes },
    children: node._children.map(serializeVNode).filter(Boolean),
  };
  // フォーム要素の動的プロパティ（JS から直接セットされた場合）
  if (typeof node.value   === 'string')  snap.value   = node.value;
  if (typeof node.checked === 'boolean') snap.checked = node.checked;
  return snap;
}

// ── イベントシーケンス スケルトン生成 ──────────────────────────────────────────

/**
 * VirtualDocument を走査してリスナー登録済み要素を収集し、
 * イベントシーケンスのスケルトン配列を生成する。
 * @param {object} vdom VirtualDocument
 * @returns {Array<{type:string, target:string, description:string}>}
 */
export function generateEventSequenceSkeleton(vdom) {
  if (!vdom) return [];
  const entries = [];

  function selectorFor(node) {
    if (node.id) return `#${node.id}`;
    const tag = node.tagName.toLowerCase();
    const cls = node.className ? node.className.split(/\s+/).filter(Boolean) : [];
    if (cls.length) return `${tag}.${cls[0]}`;
    return tag;
  }

  function shortLabel(node) {
    const text = gatherText(node._children || []).trim().slice(0, 15);
    if (text)       return `「${text}」`;
    const ph = node._attributes?.placeholder ?? '';
    if (ph)         return `「${ph}」`;
    if (node.id)    return `#${node.id}`;
    const tag = node.tagName.toLowerCase();
    const cls = node.className ? node.className.split(/\s+/).filter(Boolean) : [];
    if (cls.length) return `<${tag}.${cls[0]}>`;
    return `<${tag}>`;
  }

  function descriptionFor(type, node) {
    const label = shortLabel(node);
    switch (type) {
      case 'click':
      case 'mousedown': {
        const t  = node.tagName;
        const it = node._attributes?.type ?? '';
        if (t === 'BUTTON' || (t === 'INPUT' && it === 'submit'))
          return `${label}ボタンを左クリック`;
        if (t === 'A') return `${label}リンクをクリック`;
        return `${label}を左クリック`;
      }
      case 'dblclick':   return `${label}をダブルクリック`;
      case 'input':      return `${label}に文字列を入力（"value" に入力値を記入）`;
      case 'change':     return `${label}の値を変更（"value" に変更後の値を記入）`;
      case 'keydown':    return `${label}でキーを打鍵（"key" を "Enter"/"Tab"/"Escape" 等に変更）`;
      case 'keyup':      return `${label}でキーアップ（"key" を記入）`;
      case 'keypress':   return `${label}でキープレス（"key" を記入）`;
      case 'mouseover':
      case 'mouseenter': return `${label}をホバー`;
      case 'mouseout':
      case 'mouseleave': return `${label}からマウスアウト`;
      case 'focus':      return `${label}にフォーカス`;
      case 'blur':       return `${label}のフォーカスアウト`;
      case 'submit':     return `${label}フォームを送信`;
      default:           return `${label}で ${type} イベントを発火`;
    }
  }

  function extraFields(type) {
    if (type === 'input' || type === 'change') return { value: '' };
    if (type === 'keydown' || type === 'keyup' || type === 'keypress') return { key: 'Enter' };
    return {};
  }

  function walk(node) {
    if (!node || node.nodeType !== 1) return;
    if (node._listeners) {
      for (const type of Object.keys(node._listeners)) {
        if (node._listeners[type]?.length > 0) {
          entries.push({
            type,
            target: selectorFor(node),
            ...extraFields(type),
            description: descriptionFor(type, node),
          });
        }
      }
    }
    for (const child of (node._children ?? [])) walk(child);
  }

  if (vdom.body) walk(vdom.body);

  if (vdom._listeners) {
    for (const type of Object.keys(vdom._listeners)) {
      if (vdom._listeners[type]?.length > 0) {
        entries.push({
          type,
          target: 'document',
          description: `document の ${type} イベント`,
        });
      }
    }
  }

  return entries;
}

export { createVirtualDocument, makeVNode, makeTextNode, serializeVNode };

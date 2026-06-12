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
 *  - __vnode_id__ は生成時に単調増加カウンタで付与（削除後も再利用しない）
 */

// ── グローバルカウンタ ────────────────────────────────────────────────────────

let _vnodeCounter = 0;

/** テスト用にカウンタをリセットする（本番コードでは使わない） */
export function _resetVnodeCounter() { _vnodeCounter = 0; }

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

  // ── メソッド ───────────────────────────────────────────────────────────────

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

// ── querySelector / querySelectorAll ─────────────────────────────────────────

/**
 * 単純なセレクタのみ対応:
 *   #id    → id 属性一致
 *   .cls   → className に含まれる
 *   tag    → tagName 一致（大文字小文字不問）
 */
function matchesSelector(node, selector) {
  if (node.nodeType !== 1) return false;
  const s = selector.trim();
  if (s.startsWith('#')) return node.id === s.slice(1);
  if (s.startsWith('.')) return node.className.split(/\s+/).includes(s.slice(1));
  return node.tagName === s.toUpperCase();
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

function createVirtualDocument() {
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

  return doc;
}

// ── スナップショット（domSnapshot 用） ────────────────────────────────────────

function serializeVNode(node) {
  if (!node) return null;
  if (node.nodeType === 3) {
    return { nodeType: 3, __vnode_id__: node.__vnode_id__, text: node._text };
  }
  return {
    nodeType: 1,
    __vnode_id__: node.__vnode_id__,
    tagName: node.tagName,
    id: node.id,
    className: node.className,
    style: { ...node.style },
    attributes: { ...node._attributes },
    children: node._children.map(serializeVNode).filter(Boolean),
  };
}

export { createVirtualDocument, makeVNode, makeTextNode, serializeVNode };

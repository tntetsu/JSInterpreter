/**
 * scope.js — スコープの基底クラス（言語非依存の共通コア）
 *
 * 変数の束縛（bindings）と外側のスコープへのリンク（parent）、およびスナップショットだけを持つ。
 * 変数の参照・代入の規則（JS の const・TDZ、Python の LEGB など）は持たず、言語ごとの評価器が
 * 派生クラスや bindings の直接操作で実装する。Recorder はこのクラスのメソッドでスナップショットを作る。
 *
 * スナップショットのメソッドは clone（値のクローン関数）を受け取る。省略時は既定の deepClone。
 */
import { deepClone } from './clone.js';

const defaultClone = (v, seen) => deepClone(v, seen);

/**
 * 内→外の順のスコープの列を、内側の同名の変数を優先して 1 つのオブジェクトにまとめる。
 * @param {Scope[]} chain
 * @param {WeakMap} seen  クローン済みの値の対応表
 * @param {Function} [clone]
 * @returns {Object}
 */
function snapshotChain(chain, seen, clone = defaultClone) {
  const frame = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [k, v] of chain[i].bindings) frame[k] = clone(v, seen);
  }
  return frame;
}

class Scope {
  /**
   * @param {Scope|null} parent 外側スコープ（グローバルは null）
   * @param {string} kind スコープの種別（JS: 'block'|'function'|'global'）
   */
  constructor(parent = null, kind = 'block') {
    this.bindings = new Map(); // name → value
    this.parent = parent;
    this.kind = kind;
  }

  /** このスコープに変数を定義する（既にあれば上書き） */
  define(name, value) {
    this.bindings.set(name, value);
  }

  /**
   * このスコープ自身のバインディングだけをクローンして返す（親チェーンをたどらない）。
   * @returns {Object} { name: value }
   */
  snapshotOwn(seen = new WeakMap(), clone = defaultClone) {
    const frame = {};
    for (const [k, v] of this.bindings) frame[k] = clone(v, seen);
    return frame;
  }

  /**
   * inner からこのスコープまでの各スコープのバインディングを 1 つにまとめて返す（内側の同名の変数を優先）。
   * inner がこのスコープの内側にないときは、このスコープだけを返す。呼び出し元フレームの変数の記録に使う。
   */
  snapshotFrom(inner, seen = new WeakMap(), clone = defaultClone) {
    const chain = [];
    for (let e = inner; e; e = e.parent) {
      chain.push(e);
      if (e === this) return snapshotChain(chain, seen, clone);
    }
    return this.snapshotOwn(seen, clone);
  }

  /**
   * このスコープからグローバルスコープの手前までのバインディングを 1 つにまとめて返す。
   * グローバルのブロック（for の本体など）から関数を呼んだとき、そのブロックの変数の記録に使う。
   */
  snapshotBlocks(seen = new WeakMap(), clone = defaultClone) {
    const chain = [];
    for (let e = this; e && e.parent; e = e.parent) chain.push(e);
    return snapshotChain(chain, seen, clone);
  }

  /**
   * スコープチェーン全体のスナップショット。seen をチェーン全体で共有するので、同じ値を指す変数は
   * 同じクローンを指す（オブジェクトの同一性の保持）。
   * @returns {Array<Object>} [localScope, ..., globalScope]
   */
  snapshot(seen = new WeakMap(), clone = defaultClone) {
    const frames = [];
    for (let cur = this; cur; cur = cur.parent) frames.push(cur.snapshotOwn(seen, clone));
    return frames;
  }
}

export { Scope, snapshotChain };

import { RuntimeError } from '../errors.js';

/** let/const 宣言前のアクセスを検出するための TDZ センチネル値 */
const TDZ_SENTINEL = Symbol('TDZ');

/**
 * deepClone — デバッガースナップショット用のディープクローン
 *
 * 方針：
 * - プリミティブ（number, string, boolean, symbol, bigint）: そのまま返す
 * - null / undefined: そのまま返す
 * - JSFunction / JSClass: 不変なので参照を保持
 * - 配列: 要素を再帰的にクローン
 * - プレーンオブジェクト・JSPromise・__instance__: プロパティを再帰的にクローン
 * - ネイティブ組み込みオブジェクト（Math, console, Map 等）: 参照を保持
 * - 循環参照: WeakMap で検出し同一参照を返す（無限ループを防ぐ）
 *
 * @param {any}     val  クローン対象の値
 * @param {WeakMap} seen 循環参照検出マップ（再帰呼び出し用）
 * @returns {any} ディープクローンされた値
 */
function deepClone(val, seen = new WeakMap()) {
  // プリミティブ・null・undefined はそのまま
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val; // number, string, boolean, symbol, bigint

  // 循環参照の検出 → 既存クローンを返す
  if (seen.has(val)) return seen.get(val);

  // ── インタープリター内の不変構造体 ──────────────────────────────────────────
  // JSFunction・JSClass は定義後に変更されないため参照保持で十分
  if (val.__type__ === 'JSFunction' || val.__type__ === 'JSClass') return val;

  // ── 配列 ────────────────────────────────────────────────────────────────────
  if (Array.isArray(val)) {
    const clone = [];
    seen.set(val, clone);
    for (const item of val) clone.push(deepClone(item, seen));
    return clone;
  }

  // ── ネイティブ組み込みオブジェクト ──────────────────────────────────────────
  // Object.prototype でも null でもないプロトタイプを持ち、
  // かつ __type__ マーカーがない場合はネイティブオブジェクトとみなして参照保持
  // （Math, JSON, console, Date, Map, Set, Error インスタンス 等）
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null && !('__type__' in val)) {
    return val;
  }

  // ── プレーンオブジェクト・JSPromise・__instance__ ────────────────────────────
  // enumerable な独自プロパティだけを再帰的にクローンする。
  // __instance__ のメソッドは非 enumerable な getter として定義されているため
  // Object.keys() には現れず、コピーしない（スナップショットにはデータのみ必要）。
  const clone = {};
  seen.set(val, clone);
  for (const key of Object.keys(val)) {
    clone[key] = deepClone(val[key], seen);
  }
  return clone;
}

/**
 * 内→外の順のスコープの列を、内側の同名の変数を優先して 1 つのオブジェクトにまとめる。
 * @param {Environment[]} chain
 * @param {WeakMap} seen  クローン済みの値の対応表
 * @returns {Object}
 */
function snapshotChain(chain, seen) {
  const frame = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [k, v] of chain[i].bindings) frame[k] = deepClone(v, seen);
  }
  return frame;
}

/**
 * Environment — スコープチェーン
 *
 * 各 Environment インスタンスは 1 つのスコープを表し、
 * parent ポインターで外側スコープへのチェーンを構成する。
 */
class Environment {
  /**
   * @param {Environment|null} parent 外側スコープ（グローバルは null）
   * @param {'block'|'function'|'global'} kind スコープの種別
   */
  constructor(parent = null, kind = 'block') {
    this.bindings = new Map(); // name → value
    this.immutables = new Set(); // const として宣言された変数名
    this.parent = parent;
    this.kind = kind;
  }

  /**
   * 変数を const としてマークする。以降の set() で TypeError を投げる。
   */
  markConst(name) {
    this.immutables.add(name);
  }

  /**
   * var 宣言のバインド先となる最近傍の関数スコープ（または global スコープ）を返す。
   * block スコープを飛び越えて function/global スコープへ到達する。
   */
  getFunctionScope() {
    let env = this;
    while (env.parent && env.kind === 'block') {
      env = env.parent;
    }
    return env;
  }

  /**
   * このスコープに新しい変数を定義する。
   * @param {string} name
   * @param {*} value
   */
  define(name, value) {
    this.bindings.set(name, value);
  }

  /**
   * チェーンをたどって変数の値を取得する。
   * @param {string} name
   * @param {{line,column}} [loc] エラー位置（任意）
   */
  get(name, loc) {
    if (this.bindings.has(name)) {
      const v = this.bindings.get(name);
      if (v === TDZ_SENTINEL) {
        throw new RuntimeError(`変数 '${name}' は初期化前にはアクセスできません`, loc || { line: 0, column: 0 });
      }
      return v;
    }
    if (this.parent) return this.parent.get(name, loc);
    throw new RuntimeError(`未定義の変数: '${name}'`, loc || { line: 0, column: 0 });
  }

  /**
   * チェーンをたどって変数に値を代入する。
   * @param {string} name
   * @param {*} value
   * @param {{line,column}} [loc]
   */
  set(name, value, loc) {
    if (this.bindings.has(name)) {
      if (this.immutables.has(name)) {
        throw new RuntimeError(`代入できません: '${name}' は const です`, loc || { line: 0, column: 0 });
      }
      this.bindings.set(name, value);
      return value;
    }
    if (this.parent) return this.parent.set(name, value, loc);
    throw new RuntimeError(`未定義の変数への代入: '${name}'`, loc || { line: 0, column: 0 });
  }

  /**
   * このスコープ自身のバインディングだけをディープクローンして返す（親チェーンをたどらない）。
   * 呼び出した地点の環境がこのスコープの内側にないときの代わりに使う。
   * @returns {Object} { name: value } のプレーンオブジェクト
   */
  snapshotOwn(seen = new WeakMap()) {
    const frame = {};
    for (const [k, v] of this.bindings) {
      frame[k] = deepClone(v, seen);
    }
    return frame;
  }

  /**
   * inner からこのスコープまでの各スコープのバインディングを 1 つにまとめて返す（内側の同名の変数を優先）。
   * 呼び出し元フレームの変数の記録に使う。関数の引数（このスコープ）に加えて、呼び出した地点から見える
   * 関数本体やブロックの let/const も含める。inner がこのスコープの内側にないときは、このスコープだけを返す。
   * @param {Environment} inner
   * @param {WeakMap} [seen]  同じ値を同じクローンにするための対応表（複数のスナップショットで共有する）
   * @returns {Object} { name: value } のプレーンオブジェクト
   */
  snapshotFrom(inner, seen = new WeakMap()) {
    const chain = [];
    for (let e = inner; e; e = e.parent) {
      chain.push(e);
      if (e === this) return snapshotChain(chain, seen);
    }
    return this.snapshotOwn(seen);
  }

  /**
   * このスコープからグローバルスコープの手前までのバインディングを 1 つにまとめて返す（内側の同名の変数を優先）。
   * グローバルのブロック（for の本体など）から関数を呼んだとき、そのブロックの変数の記録に使う。
   * @param {WeakMap} [seen]  同じ値を同じクローンにするための対応表（複数のスナップショットで共有する）
   * @returns {Object} { name: value } のプレーンオブジェクト
   */
  snapshotBlocks(seen = new WeakMap()) {
    const chain = [];
    for (let e = this; e && e.parent; e = e.parent) chain.push(e);
    return snapshotChain(chain, seen);
  }

  /**
   * スコープチェーン全体のディープクローンを返す。
   * デバッグ用のスナップショットとして使用する。
   *
   * オブジェクト・配列の内部状態を再帰的にコピーするため、
   * stepBack 時にオブジェクトの変更履歴が正確に反映される。
   *
   * seen WeakMap をスコープチェーン全体で共有することで、
   * 同じ元オブジェクトが複数の変数から参照される場合に
   * 同一のクローンが再利用される（オブジェクト同一性の保持）。
   *
   * @returns {Array<Object>} [localScope, ..., globalScope] の順の配列
   */
  snapshot(seen = new WeakMap()) {
    const frames = [];
    let cur = this;
    while (cur) {
      const frame = {};
      for (const [k, v] of cur.bindings) {
        frame[k] = deepClone(v, seen);
      }
      frames.push(frame);
      cur = cur.parent;
    }
    return frames;
  }
}

export { Environment, deepClone, TDZ_SENTINEL };

'use strict';

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
 * Environment — スコープチェーン
 *
 * 各 Environment インスタンスは 1 つのスコープを表し、
 * parent ポインターで外側スコープへのチェーンを構成する。
 */
class Environment {
  /**
   * @param {Environment|null} parent 外側スコープ（グローバルは null）
   */
  constructor(parent = null) {
    this.bindings = new Map(); // name → value
    this.parent = parent;
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
    if (this.bindings.has(name)) return this.bindings.get(name);
    if (this.parent) return this.parent.get(name, loc);
    const { RuntimeError } = require('./interpreter');
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
      this.bindings.set(name, value);
      return value;
    }
    if (this.parent) return this.parent.set(name, value, loc);
    const { RuntimeError } = require('./interpreter');
    throw new RuntimeError(`未定義の変数への代入: '${name}'`, loc || { line: 0, column: 0 });
  }

  /**
   * スコープチェーン全体のディープクローンを返す。
   * デバッグ用のスナップショットとして使用する。
   *
   * オブジェクト・配列の内部状態を再帰的にコピーするため、
   * stepBack 時にオブジェクトの変更履歴が正確に反映される。
   *
   * @returns {Array<Object>} [localScope, ..., globalScope] の順の配列
   */
  snapshot() {
    const frames = [];
    let cur = this;
    while (cur) {
      const frame = {};
      for (const [k, v] of cur.bindings) {
        frame[k] = deepClone(v);
      }
      frames.push(frame);
      cur = cur.parent;
    }
    return frames;
  }
}

module.exports = { Environment, deepClone };

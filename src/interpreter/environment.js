'use strict';

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
    const pos = loc ? `${loc.line}:${loc.column}` : '?';
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
   * スコープチェーン全体のシャロークローンを返す。
   * デバッグ用のスナップショットとして使用する。
   *
   * 注意: オブジェクト値は参照コピーのため、後から変更されると
   *       スナップショットの値も変わる場合がある（既知の制限）。
   *
   * @returns {Array<Object>} [localScope, ..., globalScope] の順の配列
   */
  snapshot() {
    const frames = [];
    let cur = this;
    while (cur) {
      frames.push(Object.fromEntries(cur.bindings));
      cur = cur.parent;
    }
    return frames;
  }
}

module.exports = { Environment };

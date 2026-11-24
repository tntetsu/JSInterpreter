import { RuntimeError } from '../errors.js';
import { Scope } from '../core/scope.js';
import { deepClone } from '../core/clone.js';

/** let/const 宣言前のアクセスを検出するための TDZ センチネル値 */
const TDZ_SENTINEL = Symbol('TDZ');

// deepClone は共通コア（src/core/clone.js）に移した。既存の import 先を保つため再 export する。

/**
 * Environment — JS のスコープチェーン
 *
 * 共通コアの Scope（bindings・parent・kind・スナップショット）に、JS の規則を加える：
 * const（immutables）、var の巻き上げ先（getFunctionScope）、TDZ と未定義変数のエラー（get/set）。
 */
class Environment extends Scope {
  /**
   * @param {Environment|null} parent 外側スコープ（グローバルは null）
   * @param {'block'|'function'|'global'} kind スコープの種別
   */
  constructor(parent = null, kind = 'block') {
    super(parent, kind);
    this.immutables = new Set(); // const として宣言された変数名
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
}

export { Environment, deepClone, TDZ_SENTINEL };

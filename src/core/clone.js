/**
 * clone.js — スナップショット用のディープクローン（言語非依存の共通コア）
 *
 * 方針：
 * - プリミティブ（number, string, boolean, symbol, bigint）・null・undefined: そのまま返す
 * - `__type__` が 'JSFunction' / 'JSClass' の値: 不変なので参照を保持
 * - 配列: 要素を再帰的にクローン
 * - プレーンオブジェクト（および `__type__` を持つオブジェクト）: 列挙可能な独自プロパティを再帰的にクローン
 * - それ以外のオブジェクト（ネイティブ組み込み、言語ごとの不変な値のクラスなど）: 参照を保持
 * - 循環参照: WeakMap で検出し同一参照を返す
 *
 * 言語ごとに独自の可変な値（例：Python の tuple の印付き配列や dict のクラス）を持つ場合は、
 * hook を渡す。hook(val, clone, seen) が undefined 以外を返したらそれをクローンとして使う。
 * clone(x) は子要素を（同じ hook・同じ seen で）クローンする関数。循環参照に備え、hook は
 * 子要素をクローンする前に seen.set(val, 新しいクローン) を行うこと。
 */

/**
 * @param {any}      val   クローン対象の値
 * @param {WeakMap}  [seen] 循環参照検出マップ（再帰呼び出し・複数スナップショットでの共有用）
 * @param {Function|null} [hook] 言語ごとのクローン方法
 * @returns {any}
 */
function deepClone(val, seen = new WeakMap(), hook = null) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;

  if (seen.has(val)) return seen.get(val);

  if (hook) {
    const r = hook(val, (x) => deepClone(x, seen, hook), seen);
    if (r !== undefined) return r;
  }

  if (val.__type__ === 'JSFunction' || val.__type__ === 'JSClass') return val;

  if (Array.isArray(val)) {
    const clone = [];
    seen.set(val, clone);
    for (const item of val) clone.push(deepClone(item, seen, hook));
    return clone;
  }

  // Object.prototype でも null でもないプロトタイプを持ち、__type__ マーカーがない場合は
  // ネイティブオブジェクト（または言語ごとの不変な値）とみなして参照保持
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null && !('__type__' in val)) {
    return val;
  }

  // __instance__ のメソッドは非 enumerable な getter として定義されているため Object.keys() には現れない
  const clone = {};
  seen.set(val, clone);
  for (const key of Object.keys(val)) {
    clone[key] = deepClone(val[key], seen, hook);
  }
  return clone;
}

/**
 * hook を固定したクローン関数を作る。Recorder・Scope のスナップショットに渡す。
 * @param {Function|null} hook
 * @returns {(val: any, seen?: WeakMap) => any}
 */
function createCloner(hook = null) {
  return (val, seen = new WeakMap()) => deepClone(val, seen, hook);
}

export { deepClone, createCloner };

// 二分探索（バイナリサーチ）
// ソート済みの配列を前提とし、中央値との比較で探索範囲を半分に絞る
// 時間計算量: O(log n)

function binarySearch(arr, target) {
  let lo = 0;
  let hi = arr.length - 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);

    if (arr[mid] === target) {
      return mid;       // 一致 → インデックスを返す
    } else if (arr[mid] < target) {
      lo = mid + 1;     // 中央値より大きい → 右半分へ
    } else {
      hi = mid - 1;     // 中央値より小さい → 左半分へ
    }
  }

  return -1;  // 見つからなかった
}

// 再帰版
function binarySearchRec(arr, target, lo, hi) {
  if (lo > hi) return -1;

  const mid = Math.floor((lo + hi) / 2);

  if (arr[mid] === target) return mid;
  if (arr[mid] < target)  return binarySearchRec(arr, target, mid + 1, hi);
  return binarySearchRec(arr, target, lo, mid - 1);
}

const sorted = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

console.log("=== 二分探索 ===");
console.log("配列（ソート済み）: " + sorted);

const targets = [7, 1, 19, 6, 13];
for (let i = 0; i < targets.length; i++) {
  const target = targets[i];
  const idx = binarySearch(sorted, target);
  if (idx !== -1) {
    console.log(target + " -> インデックス " + idx + " で発見");
  } else {
    console.log(target + " -> 見つからなかった");
  }
}

console.log("--- 再帰版 ---");
const idx = binarySearchRec(sorted, 11, 0, sorted.length - 1);
console.log("11 -> インデックス " + idx);

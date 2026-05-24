// バブルソート
// 隣り合う要素を比較・交換しながら、大きい値を末尾へ「浮かび上がらせる」
// 時間計算量: O(n²)　空間計算量: O(1)（in-place）

function bubbleSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n - 1; i++) {
    // 各パスで最大値が末尾 n-1-i の位置に確定する
    let swapped = false;
    for (let j = 0; j < n - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        // 隣同士を交換
        const tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
        swapped = true;
      }
    }
    // 1パスで交換がなければ整列済み → 早期終了
    if (!swapped) break;
  }
}

function arrayToString(arr) {
  let s = "[";
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) s = s + ", ";
    s = s + arr[i];
  }
  return s + "]";
}

const data = [64, 34, 25, 12, 22, 11, 90];

console.log("=== バブルソート ===");
console.log("ソート前: " + arrayToString(data));
bubbleSort(data);
console.log("ソート後: " + arrayToString(data));

// 別のケース: すでに整列済み（早期終了の確認用）
const sorted = [1, 2, 3, 4, 5];
console.log("整列済み: " + arrayToString(sorted));
bubbleSort(sorted);
console.log("処理後:   " + arrayToString(sorted));

// クイックソート
// ピボットを選んで配列を「ピボット以下」と「ピボット超」に分割し、再帰的にソートする
// 時間計算量: 平均 O(n log n)、最悪 O(n²)　空間計算量: O(log n)（再帰スタック）

// ピボットとして末尾要素を選び、lo〜hi の範囲を in-place で分割する
// 戻り値: ピボットの確定インデックス
function partition(arr, lo, hi) {
  const pivot = arr[hi];
  let i = lo - 1;  // 「ピボット以下」の末尾インデックス

  for (let j = lo; j < hi; j++) {
    if (arr[j] <= pivot) {
      i++;
      // arr[i] と arr[j] を交換
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  // ピボットを正しい位置 (i+1) に移動
  const tmp = arr[i + 1];
  arr[i + 1] = arr[hi];
  arr[hi] = tmp;

  return i + 1;
}

function quickSort(arr, lo, hi) {
  if (lo < hi) {
    const p = partition(arr, lo, hi);
    quickSort(arr, lo, p - 1);   // ピボット左側を再帰的にソート
    quickSort(arr, p + 1, hi);   // ピボット右側を再帰的にソート
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

const data = [10, 7, 8, 9, 1, 5];

console.log("=== クイックソート ===");
console.log("ソート前: " + arrayToString(data));
quickSort(data, 0, data.length - 1);
console.log("ソート後: " + arrayToString(data));

// 逆順のケース（最悪ケースに近い）
const reversed = [9, 8, 7, 6, 5, 4, 3, 2, 1];
console.log("逆順:     " + arrayToString(reversed));
quickSort(reversed, 0, reversed.length - 1);
console.log("ソート後: " + arrayToString(reversed));

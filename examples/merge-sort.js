// マージソート
// 配列を半分に分割し、再帰的にソートしてからマージする（分割統治法）
// 時間計算量: O(n log n)（最良・平均・最悪すべて）
// 空間計算量: O(n)（マージ用の一時配列）

// 2つの整列済み配列をマージして1つの整列済み配列を返す
function merge(left, right) {
  const result = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) {
      result.push(left[i]);
      i++;
    } else {
      result.push(right[j]);
      j++;
    }
  }

  // 残った要素を末尾に追加
  while (i < left.length) {
    result.push(left[i]);
    i++;
  }
  while (j < right.length) {
    result.push(right[j]);
    j++;
  }

  return result;
}

function mergeSort(arr) {
  if (arr.length <= 1) return arr;

  const mid = Math.floor(arr.length / 2);
  const left  = mergeSort(arr.slice(0, mid));   // 左半分を再帰的にソート
  const right = mergeSort(arr.slice(mid));       // 右半分を再帰的にソート

  return merge(left, right);
}

function arrayToString(arr) {
  let s = "[";
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) s = s + ", ";
    s = s + arr[i];
  }
  return s + "]";
}

const data = [38, 27, 43, 3, 9, 82, 10];

console.log("=== マージソート ===");
console.log("ソート前: " + arrayToString(data));
const sorted = mergeSort(data);
console.log("ソート後: " + arrayToString(sorted));

// 重複要素を含むケース
const data2 = [5, 1, 3, 5, 2, 3, 1];
console.log("重複あり: " + arrayToString(data2));
console.log("ソート後: " + arrayToString(mergeSort(data2)));

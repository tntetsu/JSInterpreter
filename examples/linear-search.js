// 線形探索（リニアサーチ）
// 配列を先頭から順に調べ、目標値と一致する最初のインデックスを返す
// 時間計算量: O(n)

function linearSearch(arr, target) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === target) {
      return i;  // 見つかったインデックスを返す
    }
  }
  return -1;  // 見つからなかった場合は -1
}

const numbers = [5, 3, 8, 1, 9, 2, 7, 4, 6];

console.log("=== 線形探索 ===");
console.log("配列: " + numbers);

const targets = [1, 7, 9, 10];
for (let i = 0; i < targets.length; i++) {
  const target = targets[i];
  const idx = linearSearch(numbers, target);
  if (idx !== -1) {
    console.log(target + " -> インデックス " + idx + " で発見");
  } else {
    console.log(target + " -> 見つからなかった");
  }
}

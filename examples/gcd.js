// ユークリッドの互除法（最大公約数）
// gcd(a, b) = gcd(b, a mod b) を再帰的に適用する
// 時間計算量: O(log(min(a, b)))

// 再帰版
function gcd(a, b) {
  if (b === 0) return a;
  return gcd(b, a % b);
}

// 反復版
function gcdIter(a, b) {
  while (b !== 0) {
    const tmp = b;
    b = a % b;
    a = tmp;
  }
  return a;
}

// 最小公倍数（lcm）は gcd を使って計算できる
function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

console.log("=== ユークリッドの互除法 ===");

const pairs = [
  [48, 18],
  [100, 75],
  [17, 5],
  [270, 192],
];

for (let i = 0; i < pairs.length; i++) {
  const a = pairs[i][0];
  const b = pairs[i][1];
  console.log("gcd(" + a + ", " + b + ") = " + gcd(a, b));
  console.log("lcm(" + a + ", " + b + ") = " + lcm(a, b));
}

console.log("--- 反復版 ---");
console.log("gcdIter(270, 192) = " + gcdIter(270, 192));

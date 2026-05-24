// フィボナッチ数列
// 再帰版と反復版の2通りを実装する

// 再帰版（小さい n に適している）
function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

// 反復版（メモリ効率がよく大きい n にも対応）
function fibIter(n) {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const tmp = a + b;
    a = b;
    b = tmp;
  }
  return b;
}

console.log("=== フィボナッチ数列（再帰） ===");
for (let i = 0; i <= 10; i++) {
  console.log("fib(" + i + ") = " + fib(i));
}

console.log("=== フィボナッチ数列（反復） ===");
console.log("fibIter(20) = " + fibIter(20));
console.log("fibIter(30) = " + fibIter(30));

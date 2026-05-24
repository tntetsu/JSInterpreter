'use strict';

const { run, record } = require('./interpreter');

describe('Interpreter', () => {
  // ── 算術・リテラル ────────────────────────────────────────────────────────────
  describe('基本演算', () => {
    test('数値演算', () => {
      expect(run('1 + 2;')).toBe(3);
      expect(run('10 - 3;')).toBe(7);
      expect(run('4 * 5;')).toBe(20);
      expect(run('10 / 4;')).toBe(2.5);
      expect(run('10 % 3;')).toBe(1);
      expect(run('2 ** 10;')).toBe(1024);
    });

    test('文字列連結', () => {
      expect(run('"hello" + " " + "world";')).toBe('hello world');
    });

    test('比較演算', () => {
      expect(run('1 < 2;')).toBe(true);
      expect(run('2 > 3;')).toBe(false);
      expect(run('1 === 1;')).toBe(true);
      expect(run('"a" !== "b";')).toBe(true);
    });

    test('論理演算', () => {
      expect(run('true && false;')).toBe(false);
      expect(run('true || false;')).toBe(true);
      expect(run('!true;')).toBe(false);
    });

    test('null 合体演算子', () => {
      expect(run('null ?? "default";')).toBe('default');
      expect(run('0 ?? "default";')).toBe(0);
    });
  });

  // ── 変数 ─────────────────────────────────────────────────────────────────────
  describe('変数', () => {
    test('let 宣言と参照', () => {
      expect(run('let x = 42; x;')).toBe(42);
    });

    test('代入', () => {
      expect(run('let x = 1; x = 5; x;')).toBe(5);
    });

    test('複合代入', () => {
      expect(run('let x = 10; x += 5; x;')).toBe(15);
      expect(run('let x = 10; x -= 3; x;')).toBe(7);
    });

    test('インクリメント・デクリメント', () => {
      expect(run('let x = 5; x++; x;')).toBe(6);
      expect(run('let x = 5; ++x;')).toBe(6);
      expect(run('let x = 5; x--;')).toBe(5); // 後置は元の値を返す
    });
  });

  // ── 関数 ─────────────────────────────────────────────────────────────────────
  describe('関数', () => {
    test('関数宣言と呼び出し', () => {
      expect(run('function add(a, b) { return a + b; } add(1, 2);')).toBe(3);
    });

    test('アロー関数', () => {
      expect(run('const f = x => x * 2; f(5);')).toBe(10);
    });

    test('アロー関数（複数引数）', () => {
      expect(run('const add = (a, b) => a + b; add(3, 4);')).toBe(7);
    });

    test('クロージャ', () => {
      expect(run(`
        function counter() {
          let n = 0;
          return () => ++n;
        }
        const c = counter();
        c(); c(); c();
      `)).toBe(3);
    });

    test('再帰', () => {
      expect(run(`
        function fib(n) {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        fib(10);
      `)).toBe(55);
    });

    test('レスト引数', () => {
      expect(run(`
        function sum(...args) {
          let total = 0;
          for (const x of args) total += x;
          return total;
        }
        sum(1, 2, 3, 4, 5);
      `)).toBe(15);
    });

    test('デフォルト引数', () => {
      expect(run(`
        function greet(name = "world") { return "hello " + name; }
        greet();
      `)).toBe('hello world');
    });
  });

  // ── 制御フロー ────────────────────────────────────────────────────────────────
  describe('制御フロー', () => {
    test('if-else', () => {
      expect(run('if (true) 1; else 2;')).toBe(1);
      expect(run('if (false) 1; else 2;')).toBe(2);
    });

    test('while ループ', () => {
      expect(run(`
        let sum = 0;
        let i = 1;
        while (i <= 10) { sum += i; i++; }
        sum;
      `)).toBe(55);
    });

    test('for ループ', () => {
      expect(run(`
        let sum = 0;
        for (let i = 1; i <= 10; i++) sum += i;
        sum;
      `)).toBe(55);
    });

    test('for...of', () => {
      expect(run(`
        let sum = 0;
        for (const x of [1, 2, 3, 4, 5]) sum += x;
        sum;
      `)).toBe(15);
    });

    test('三項演算子', () => {
      expect(run('5 > 3 ? "yes" : "no";')).toBe('yes');
    });
  });

  // ── オブジェクト・配列 ────────────────────────────────────────────────────────
  describe('オブジェクト・配列', () => {
    test('オブジェクトの生成と参照', () => {
      expect(run('const obj = { a: 1, b: 2 }; obj.a + obj.b;')).toBe(3);
    });

    test('配列の生成と参照', () => {
      expect(run('const arr = [10, 20, 30]; arr[1];')).toBe(20);
    });

    test('スプレッド演算子（配列）', () => {
      expect(run('const a = [1,2,3]; const b = [...a, 4]; b.length;')).toBe(4);
    });

    test('オブジェクト分割代入', () => {
      expect(run('const { a, b } = { a: 1, b: 2 }; a + b;')).toBe(3);
    });

    test('配列分割代入', () => {
      expect(run('const [x, y] = [10, 20]; x + y;')).toBe(30);
    });
  });

  // ── テンプレートリテラル ──────────────────────────────────────────────────────
  describe('テンプレートリテラル', () => {
    test('補間あり', () => {
      expect(run('const name = "world"; `hello ${name}!`;')).toBe('hello world!');
    });

    test('式の評価', () => {
      expect(run('`${1 + 2}`;')).toBe('3');
    });
  });

  // ── クラス ────────────────────────────────────────────────────────────────────
  describe('クラス', () => {
    test('基本的なクラス', () => {
      expect(run(`
        class Point {
          constructor(x, y) {
            this.x = x;
            this.y = y;
          }
          sum() { return this.x + this.y; }
        }
        const p = new Point(3, 4);
        p.sum();
      `)).toBe(7);
    });
  });

  // ── try-catch ─────────────────────────────────────────────────────────────────
  describe('try-catch', () => {
    test('エラーのキャッチ', () => {
      expect(run(`
        let result;
        try {
          throw "error!";
        } catch (e) {
          result = e;
        }
        result;
      `)).toBe('error!');
    });
  });

  // ── typeof ────────────────────────────────────────────────────────────────────
  describe('typeof', () => {
    test('typeof 演算子', () => {
      expect(run('typeof 42;')).toBe('number');
      expect(run('typeof "str";')).toBe('string');
      expect(run('typeof true;')).toBe('boolean');
      expect(run('typeof undefined;')).toBe('undefined');
    });
  });

  // ── record（トレース）────────────────────────────────────────────────────────
  describe('record（トレース）', () => {
    test('トレースが生成される', () => {
      const { trace } = record('let x = 1 + 2;');
      expect(trace.length).toBeGreaterThan(0);
    });

    test('enter/exit のペアが揃っている', () => {
      const { trace } = record('1 + 2;');
      const enters = trace.filter(e => e.phase === 'enter');
      const exits  = trace.filter(e => e.phase === 'exit');
      expect(enters.length).toBe(exits.length);
    });

    test('matchIdx がリンクされている', () => {
      const { trace } = record('1;');
      for (const event of trace) {
        expect(event.matchIdx).toBeGreaterThanOrEqual(0);
        expect(trace[event.matchIdx].matchIdx).toBe(trace.indexOf(event));
      }
    });

    test('exit イベントに value が入る', () => {
      const { trace } = record('42;');
      const literalExit = trace.find(e => e.phase === 'exit' && e.nodeType === 'Literal');
      expect(literalExit.value).toBe(42);
    });

    test('env スナップショットが記録される', () => {
      const { trace } = record('let x = 5;');
      // VariableDeclaration の exit 後は x が存在するはず
      const vdExit = trace.find(e => e.phase === 'exit' && e.nodeType === 'VariableDeclaration');
      expect(vdExit.env[0]).toHaveProperty('x', 5);
    });
  });

  // ── async/await ──────────────────────────────────────────────────────────────
  describe('async/await', () => {
    test('async 関数は fulfilled JSPromise を返す', () => {
      const result = run('async function f() { return 42; } f();');
      expect(result.__type__).toBe('JSPromise');
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(42);
    });

    test('async アロー関数（式本体）', () => {
      const result = run('const f = async x => x * 2; f(5);');
      expect(result.__type__).toBe('JSPromise');
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(10);
    });

    test('async アロー関数（括弧あり・複数引数）', () => {
      const result = run('const f = async (a, b) => a + b; f(3, 4);');
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(7);
    });

    test('async アロー関数（引数なし）', () => {
      const result = run('const f = async () => 99; f();');
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(99);
    });

    test('async 関数内の throw は rejected JSPromise', () => {
      const result = run('async function f() { throw new Error("oops"); } f();');
      expect(result.__type__).toBe('JSPromise');
      expect(result.status).toBe('rejected');
      expect(result.reason.message).toBe('oops');
    });

    test('await で JSPromise を同期解決する', () => {
      const result = run(`
        async function f() {
          const x = await Promise.resolve(10);
          return x * 2;
        }
        f();
      `);
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(20);
    });

    test('await rejected Promise は catch できる', () => {
      const result = run(`
        async function f() {
          try {
            await Promise.reject(new Error('fail'));
          } catch (e) {
            return 'caught: ' + e.message;
          }
        }
        f();
      `);
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe('caught: fail');
    });

    test('async/await チェーン', () => {
      const result = run(`
        async function a() { return 1; }
        async function b() { return await a() + 1; }
        async function c() { return await b() + 1; }
        c();
      `);
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(3);
    });

    test('Promise.resolve() で JSPromise を作る', () => {
      const result = run('Promise.resolve(42);');
      expect(result.__type__).toBe('JSPromise');
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(42);
    });

    test('Promise.reject() で rejected JSPromise を作る', () => {
      const result = run('Promise.reject("error");');
      expect(result.__type__).toBe('JSPromise');
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('error');
    });

    test('new Promise(executor) で JSPromise を作る', () => {
      const result = run('new Promise((resolve) => { resolve(42); });');
      expect(result.__type__).toBe('JSPromise');
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(42);
    });

    test('new Promise で reject する', () => {
      const result = run('new Promise((_, reject) => { reject("nope"); });');
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('nope');
    });

    test('Promise.all で複数の Promise を解決する', () => {
      const result = run(`
        Promise.all([Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]);
      `);
      expect(result.status).toBe('fulfilled');
      expect(result.value).toEqual([1, 2, 3]);
    });

    test('Promise.all でひとつでも reject されると rejected', () => {
      const result = run(`
        Promise.all([Promise.resolve(1), Promise.reject('bad'), Promise.resolve(3)]);
      `);
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('bad');
    });

    test('Promise.allSettled は全 Promise の結果を返す', () => {
      const result = run(`
        Promise.allSettled([Promise.resolve(1), Promise.reject('bad')]);
      `);
      expect(result.status).toBe('fulfilled');
      expect(result.value[0]).toEqual({ status: 'fulfilled', value: 1 });
      expect(result.value[1]).toEqual({ status: 'rejected', reason: 'bad' });
    });

    test('await 平値はそのまま返る', () => {
      const result = run('async function f() { return await 42; } f();');
      expect(result.status).toBe('fulfilled');
      expect(result.value).toBe(42);
    });
  });
});

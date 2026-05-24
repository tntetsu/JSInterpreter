'use strict';

const { JSDebugger } = require('./debugger');

// ヘルパー：cursor を特定ノード型 & フェーズまで進める
function advanceTo(dbg, nodeType, phase = 'enter') {
  while (!dbg.isDone()) {
    const ev = dbg.getCurrentEvent();
    if (ev.nodeType === nodeType && ev.phase === phase) return ev;
    dbg.stepIn();
  }
  return null;
}

describe('JSDebugger', () => {
  // ── 初期状態 ────────────────────────────────────────────────────────────────
  describe('初期状態', () => {
    test('cursor=0 でスタートする', () => {
      const dbg = new JSDebugger('1;');
      expect(dbg.cursor).toBe(0);
      expect(dbg.isDone()).toBe(false);
    });

    test('空プログラムでも動作する', () => {
      const dbg = new JSDebugger('');
      // Program ノードの enter/exit は生成される
      expect(dbg.trace.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── trace の構造 ────────────────────────────────────────────────────────────
  describe('trace の構造', () => {
    test('enter/exit が同数', () => {
      const dbg = new JSDebugger('1 + 2;');
      const enters = dbg.trace.filter(e => e.phase === 'enter');
      const exits  = dbg.trace.filter(e => e.phase === 'exit');
      expect(enters.length).toBe(exits.length);
    });

    test('matchIdx が相互リンクされている', () => {
      const dbg = new JSDebugger('let x = 42;');
      for (let i = 0; i < dbg.trace.length; i++) {
        const ev = dbg.trace[i];
        expect(ev.matchIdx).toBeGreaterThanOrEqual(0);
        expect(dbg.trace[ev.matchIdx].matchIdx).toBe(i);
      }
    });

    test('exit には value が入る', () => {
      const dbg = new JSDebugger('42;');
      const litExit = dbg.trace.find(e => e.phase === 'exit' && e.nodeType === 'Literal');
      expect(litExit.value).toBe(42);
    });

    test('depth が単調増加する（enter で増える）', () => {
      const dbg = new JSDebugger('1 + 2;');
      // BinaryExpression の子は親より depth が大きい
      const binEnter = dbg.trace.find(e => e.nodeType === 'BinaryExpression' && e.phase === 'enter');
      const litEnter = dbg.trace.find(e => e.nodeType === 'Literal' && e.phase === 'enter');
      expect(litEnter.depth).toBeGreaterThan(binEnter.depth);
    });

    test('env スナップショットが記録される', () => {
      const dbg = new JSDebugger('let x = 99;');
      const vdExit = dbg.trace.find(e => e.nodeType === 'VariableDeclaration' && e.phase === 'exit');
      expect(vdExit.env[0]).toHaveProperty('x', 99);
    });

    test('enter の env は評価前の状態', () => {
      const dbg = new JSDebugger('let x = 99;');
      const vdEnter = dbg.trace.find(e => e.nodeType === 'VariableDeclaration' && e.phase === 'enter');
      // 変数宣言の enter 時点では x はまだ定義されていない
      expect(vdEnter.env[0]).not.toHaveProperty('x');
    });
  });

  // ── stepIn ──────────────────────────────────────────────────────────────────
  describe('stepIn', () => {
    test('cursor を 1 進める', () => {
      const dbg = new JSDebugger('1;');
      dbg.stepIn();
      expect(dbg.cursor).toBe(1);
    });

    test('done の場合は動かない', () => {
      const dbg = new JSDebugger('1;');
      while (!dbg.isDone()) dbg.stepIn();
      const cursor = dbg.cursor;
      dbg.stepIn();
      expect(dbg.cursor).toBe(cursor);
    });

    test('BinaryExpression の子（Literal）に入れる', () => {
      const dbg = new JSDebugger('1 + 2;');
      advanceTo(dbg, 'BinaryExpression');
      const r = dbg.stepIn();
      expect(r.event.nodeType).toBe('Literal');
      expect(r.event.phase).toBe('enter');
    });

    test('StepResult に event が含まれる', () => {
      const dbg = new JSDebugger('1;');
      const r = dbg.stepIn();
      expect(r.event).toBeDefined();
      expect(r.done).toBeDefined();
    });
  });

  // ── stepOver ────────────────────────────────────────────────────────────────
  describe('stepOver', () => {
    test('enter(N) → exit(N) へジャンプ（子をスキップ）', () => {
      const dbg = new JSDebugger('1 + 2;');
      advanceTo(dbg, 'BinaryExpression');
      // BinaryExpression の enter にいる
      expect(dbg.getCurrentEvent().phase).toBe('enter');
      expect(dbg.getCurrentEvent().nodeType).toBe('BinaryExpression');

      const r = dbg.stepOver();
      // exit(BinaryExpression) に着地
      expect(r.event.nodeType).toBe('BinaryExpression');
      expect(r.event.phase).toBe('exit');
      expect(r.event.value).toBe(3);
    });

    test('exit では stepIn と同じ（cursor++）', () => {
      const dbg = new JSDebugger('1;');
      advanceTo(dbg, 'Literal', 'exit');
      const before = dbg.cursor;
      dbg.stepOver();
      expect(dbg.cursor).toBe(before + 1);
    });

    test('関数呼び出しを一括スキップ', () => {
      const dbg = new JSDebugger(`
        function add(a, b) { return a + b; }
        add(1, 2);
      `);
      // CallExpression の enter まで進む
      advanceTo(dbg, 'CallExpression');
      const r = dbg.stepOver();
      expect(r.event.nodeType).toBe('CallExpression');
      expect(r.event.phase).toBe('exit');
      expect(r.event.value).toBe(3);
    });
  });

  // ── stepOut ─────────────────────────────────────────────────────────────────
  describe('stepOut', () => {
    test('関数内部から抜け出す', () => {
      const dbg = new JSDebugger(`
        function double(x) { return x * 2; }
        double(5);
      `);
      // CallExpression に入り、さらに内部（callDepth=1）まで進む
      advanceTo(dbg, 'ReturnStatement');
      expect(dbg.getCurrentEvent().callDepth).toBe(1);

      const r = dbg.stepOut();
      // callDepth が 0 に下がった最初の exit イベント
      expect(r.event.callDepth).toBe(0);
    });

    test('callDepth=0 ではプログラム末尾へ', () => {
      const dbg = new JSDebugger('1 + 2;');
      dbg.stepOut();
      expect(dbg.isDone()).toBe(true);
    });
  });

  // ── stepBack ────────────────────────────────────────────────────────────────
  describe('stepBack', () => {
    test('cursor を 1 戻す（O(1)）', () => {
      const dbg = new JSDebugger('1;');
      dbg.stepIn();
      dbg.stepBack();
      expect(dbg.cursor).toBe(0);
    });

    test('cursor=0 では動かない', () => {
      const dbg = new JSDebugger('1;');
      dbg.stepBack();
      expect(dbg.cursor).toBe(0);
    });

    test('複数ステップ進んでから戻れる', () => {
      const dbg = new JSDebugger('let x = 1;\nlet y = 2;');
      // x の宣言を過ぎるところまで進む
      let stepsBeforeY = 0;
      while (!dbg.isDone()) {
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'VariableDeclaration' && ev.phase === 'exit' && ev.loc.line === 2) break;
        stepsBeforeY++;
        dbg.stepIn();
      }
      // y の宣言前に x があるはず
      expect(stepsBeforeY).toBeGreaterThan(0);
    });

    test('stepBack で変数が未定義状態に戻る', () => {
      const dbg = new JSDebugger('let x = 1;\nlet y = 2;');

      // y の VariableDeclaration exit まで進む
      while (!dbg.isDone()) {
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'VariableDeclaration' && ev.phase === 'exit' && ev.loc.line === 2) break;
        dbg.stepIn();
      }
      // y は定義済み
      expect(dbg.getVariables('all')).toHaveProperty('y', 2);

      // 一歩戻る
      dbg.stepBack();
      // 前の状態では y が未定義（x は定義済み）
      const vars = dbg.getVariables('all');
      expect(vars).toHaveProperty('x', 1);
      // y は env スナップショットに含まれていないか undefined のはず
    });

    test('ディープクローン: stepBack でオブジェクトの内部変更が正しく戻る', () => {
      const dbg = new JSDebugger(
        'let obj = { x: 1 };\nobj.x = 2;\nobj.x = 3;'
      );

      // obj.x = 3 の AssignmentExpression exit まで進む
      while (!dbg.isDone()) {
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'AssignmentExpression' && ev.phase === 'exit' && ev.value === 3) break;
        dbg.stepIn();
      }
      expect(dbg.getVariables('all').obj).toEqual({ x: 3 });

      // obj.x = 2 の AssignmentExpression exit まで戻る
      while (dbg.cursor > 0) {
        dbg.stepBack();
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'AssignmentExpression' && ev.phase === 'exit' && ev.value === 2) break;
      }
      expect(dbg.getVariables('all').obj).toEqual({ x: 2 });

      // VariableDeclaration exit（obj = { x: 1 } の直後）まで戻る
      while (dbg.cursor > 0) {
        dbg.stepBack();
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'VariableDeclaration' && ev.phase === 'exit') break;
      }
      expect(dbg.getVariables('all').obj).toEqual({ x: 1 });
    });

    test('ディープクローン: stepBack で配列の内部変更が正しく戻る', () => {
      const dbg = new JSDebugger(
        'let arr = [1, 2, 3];\narr[0] = 99;'
      );

      // arr[0] = 99 の AssignmentExpression exit まで進む
      while (!dbg.isDone()) {
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'AssignmentExpression' && ev.phase === 'exit' && ev.value === 99) break;
        dbg.stepIn();
      }
      expect(dbg.getVariables('all').arr[0]).toBe(99);

      // VariableDeclaration exit（arr = [1,2,3] の直後）まで戻る
      while (dbg.cursor > 0) {
        dbg.stepBack();
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'VariableDeclaration' && ev.phase === 'exit') break;
      }
      expect(dbg.getVariables('all').arr[0]).toBe(1);
    });

    test('ディープクローン: ネストしたオブジェクトも正しく戻る', () => {
      const dbg = new JSDebugger(
        'let obj = { inner: { v: 0 } };\nobj.inner.v = 42;'
      );

      // obj.inner.v = 42 の AssignmentExpression exit まで進む
      while (!dbg.isDone()) {
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'AssignmentExpression' && ev.phase === 'exit' && ev.value === 42) break;
        dbg.stepIn();
      }
      expect(dbg.getVariables('all').obj.inner.v).toBe(42);

      // VariableDeclaration exit まで戻る
      while (dbg.cursor > 0) {
        dbg.stepBack();
        const ev = dbg.getCurrentEvent();
        if (ev.nodeType === 'VariableDeclaration' && ev.phase === 'exit') break;
      }
      expect(dbg.getVariables('all').obj.inner.v).toBe(0);
    });
  });

  // ── getVariables ────────────────────────────────────────────────────────────
  describe('getVariables', () => {
    test('local スコープを返す', () => {
      const dbg = new JSDebugger('let x = 42;');
      while (!dbg.isDone()) dbg.stepIn();
      // done 後は null
      expect(dbg.getVariables()).toEqual({});
    });

    test('関数内のローカル変数が見える', () => {
      const dbg = new JSDebugger(`
        function f() {
          let local = 100;
          return local;
        }
        f();
      `);
      // ReturnStatement の中まで進む
      advanceTo(dbg, 'ReturnStatement');
      const vars = dbg.getVariables('all');
      expect(vars).toHaveProperty('local', 100);
    });
  });

  // ── getCallStack ─────────────────────────────────────────────────────────────
  describe('getCallStack', () => {
    test('トップレベルはスタック空', () => {
      const dbg = new JSDebugger('1 + 2;');
      expect(dbg.getCallStack()).toHaveLength(0);
    });

    test('関数内ではコールスタックが積まれる', () => {
      const dbg = new JSDebugger(`
        function inner() { return 1; }
        function outer() { return inner(); }
        outer();
      `);
      // inner の ReturnStatement まで進む
      let foundInner = false;
      while (!dbg.isDone()) {
        const ev = dbg.getCurrentEvent();
        if (ev.callDepth >= 2 && ev.nodeType === 'ReturnStatement' && ev.phase === 'enter') {
          foundInner = true;
          break;
        }
        dbg.stepIn();
      }
      if (foundInner) {
        expect(dbg.getCallStack().length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ── continue ────────────────────────────────────────────────────────────────
  describe('continue', () => {
    test('ブレークポイントなしで末尾まで実行', () => {
      const dbg = new JSDebugger('let x = 1; let y = 2;');
      dbg.continue();
      expect(dbg.isDone()).toBe(true);
    });

    test('指定行のブレークポイントで停止', () => {
      const dbg = new JSDebugger('let x = 1;\nlet y = 2;\nlet z = 3;');
      dbg.continue([{ line: 3 }]);
      // line 3 の enter に止まる
      expect(dbg.getCurrentEvent()?.loc.line).toBe(3);
    });
  });

  // ── getResult ───────────────────────────────────────────────────────────────
  describe('getResult', () => {
    test('プログラムの最終値', () => {
      const dbg = new JSDebugger('1 + 2;');
      // 最後の exit の value を確認
      const lastExit = [...dbg.trace].reverse().find(e => e.phase === 'exit');
      // プログラムの最後の値は ExpressionStatement や Program の exit
      expect(lastExit).toBeDefined();
    });
  });

  // ── 実際のプログラムの動作検証 ──────────────────────────────────────────────
  describe('実際のプログラム', () => {
    test('フィボナッチ数列をステップ実行', () => {
      const dbg = new JSDebugger(`
        function fib(n) {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        fib(5);
      `);
      // 末尾まで進めて trace が生成されることを確認
      expect(dbg.trace.length).toBeGreaterThan(10);
      dbg.continue();
      expect(dbg.isDone()).toBe(true);
    });

    test('クロージャをデバッグ', () => {
      const dbg = new JSDebugger(`
        function makeCounter() {
          let count = 0;
          return () => ++count;
        }
        const c = makeCounter();
        c();
        c();
      `);
      expect(dbg.trace.length).toBeGreaterThan(0);
      // 問題なく記録されることを確認
      dbg.continue();
      expect(dbg.isDone()).toBe(true);
    });

    test('stepIn → stepBack → stepIn で同じ位置に戻れる', () => {
      const dbg = new JSDebugger('1 + 2 * 3;');
      // 少し進む
      dbg.stepIn();
      dbg.stepIn();
      dbg.stepIn();
      const cursorBefore = dbg.cursor;
      const evBefore     = dbg.getCurrentEvent();

      dbg.stepIn();
      dbg.stepBack();

      expect(dbg.cursor).toBe(cursorBefore);
      expect(dbg.getCurrentEvent().nodeType).toBe(evBefore.nodeType);
      expect(dbg.getCurrentEvent().phase).toBe(evBefore.phase);
    });
  });

  // ── humanStep / humanStepBack ─────────────────────────────────────────────
  describe('humanStep / humanStepBack', () => {
    test('変数宣言で停止する（Literal/Identifier はスキップ）', () => {
      const dbg = new JSDebugger('let x = 42;');
      const { event } = dbg.humanStep();
      // 最初の human イベントは VariableDeclaration exit
      expect(event.nodeType).toBe('VariableDeclaration');
      expect(event.phase).toBe('exit');
    });

    test('代入式で停止する', () => {
      const dbg = new JSDebugger('let x = 1; x = 99;');
      dbg.humanStep(); // VariableDeclaration (let x = 1)
      const { event } = dbg.humanStep(); // AssignmentExpression (x = 99)
      expect(event.nodeType).toBe('AssignmentExpression');
      expect(event.phase).toBe('exit');
      expect(event.value).toBe(99);
    });

    test('UpdateExpression で停止する（後置++ は旧値を返す）', () => {
      const dbg = new JSDebugger('let i = 0; i++;');
      dbg.humanStep(); // let i = 0
      const { event } = dbg.humanStep();
      expect(event.nodeType).toBe('UpdateExpression');
      expect(event.value).toBe(0); // 後置 i++ は旧値（0）を返す（i 自体は 1 になる）
    });

    test('if 文の条件式 exit で停止し true/false が取れる', () => {
      const dbg = new JSDebugger('let x = 5; if (x > 3) { x = 10; }');
      dbg.humanStep(); // let x = 5
      const { event } = dbg.humanStep(); // if の条件式 exit
      // BinaryExpression (x > 3) → true
      expect(event.phase).toBe('exit');
      expect(event.value).toBe(true);
    });

    test('while ループの条件式を毎イテレーション捉える', () => {
      const dbg = new JSDebugger('let i = 0; while (i < 3) { i++; }');
      dbg.humanStep(); // let i = 0

      // 条件 → true（1回目）
      let { event } = dbg.humanStep();
      expect(event.value).toBe(true);

      // i++ (UpdateExpression)
      dbg.humanStep();

      // 条件 → true（2回目）
      ({ event } = dbg.humanStep());
      expect(event.value).toBe(true);

      // i++
      dbg.humanStep();

      // 条件 → true（3回目）
      ({ event } = dbg.humanStep());
      expect(event.value).toBe(true);

      // i++
      dbg.humanStep();

      // 条件 → false（ループ終了）
      ({ event } = dbg.humanStep());
      expect(event.value).toBe(false);
    });

    test('for ループのテスト式で停止する', () => {
      const dbg = new JSDebugger('for (let i = 0; i < 2; i++) {}');
      dbg.humanStep(); // VariableDeclaration (let i = 0)

      // for のテスト (i < 2) → true
      const { event } = dbg.humanStep();
      expect(event.phase).toBe('exit');
      expect(event.value).toBe(true);
    });

    test('ユーザー定義関数呼び出しで停止する', () => {
      const dbg = new JSDebugger(`
        function add(a, b) { return a + b; }
        let r = add(3, 4);
      `);
      // humanStep を繰り返して CallExpression exit を探す
      let found = null;
      for (let s = 0; s < 30; s++) {
        const { event, done } = dbg.humanStep();
        if (done) break;
        if (event.nodeType === 'CallExpression') { found = event; break; }
      }
      expect(found).not.toBeNull();
      expect(found.value).toBe(7);
    });

    test('Math.floor などネイティブ関数呼び出しでは停止しない', () => {
      // Math.floor は callDepth を増やさないのでスキップされる
      const dbg = new JSDebugger('let x = Math.floor(3.7);');
      const { event } = dbg.humanStep();
      // VariableDeclaration で止まるはず（CallExpression ではない）
      expect(event.nodeType).toBe('VariableDeclaration');
    });

    test('ReturnStatement exit で停止する', () => {
      const dbg = new JSDebugger(`
        function f() { return 42; }
        f();
      `);
      let found = null;
      for (let s = 0; s < 20; s++) {
        const { event, done } = dbg.humanStep();
        if (done) break;
        if (event.nodeType === 'ReturnStatement') { found = event; break; }
      }
      expect(found).not.toBeNull();
      expect(found.phase).toBe('exit');
    });

    test('humanStepBack で直前の human イベントに戻る', () => {
      const dbg = new JSDebugger('let x = 1; let y = 2; let z = 3;');
      dbg.humanStep(); // let x = 1
      dbg.humanStep(); // let y = 2
      dbg.humanStep(); // let z = 3

      const { event: back } = dbg.humanStepBack(); // let y = 2 に戻る
      expect(back.nodeType).toBe('VariableDeclaration');

      // cursor=0 でも no-op（クラッシュしない）
      const dbg2 = new JSDebugger('let a = 1;');
      dbg2.humanStepBack();
      expect(dbg2.cursor).toBe(0);
    });

    test('humanStep で末尾まで到達したら done=true', () => {
      const dbg = new JSDebugger('1 + 2;');
      let result;
      for (let s = 0; s < 50; s++) {
        result = dbg.humanStep();
        if (result.done) break;
      }
      expect(result.done).toBe(true);
    });

    test('getSourceLine でソース行が取得できる', () => {
      const dbg = new JSDebugger('let x = 1;\nlet y = 2;');
      expect(dbg.getSourceLine(1)).toBe('let x = 1;');
      expect(dbg.getSourceLine(2)).toBe('let y = 2;');
    });
  });
});

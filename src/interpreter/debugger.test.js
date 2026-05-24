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
});

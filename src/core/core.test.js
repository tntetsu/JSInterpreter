/**
 * core.test.js — 言語非依存の共通コア（src/core/）のテスト
 *
 * JS の評価器を使わず、小さな「別の言語の評価器」をテストの中で組み立てて、
 * 他の言語（PyVisualizer の Python など）から共通コアを使う場合を確かめる。
 */
import {
  ReturnSignal, Recorder, Scope, TraceDebugger, ExecutionError,
  deepClone, createCloner, joinConsoleLines, finalizePartialTrace, EMPTY_CATEGORIES,
} from './index.js';

// ── テスト用の小さな言語 ────────────────────────────────────────────────────
// ノード: Program{body} / Assign{name, value} / Lit{value} / Loop{name, items, body} / Print{text, eol}
// Loop は各回の変数への代入を LoopBinding ノードとして記録する。
const L = (line) => ({ line, column: 1 });
function evaluate(node, env, rec, depth = 0) {
  return rec.record(node, env, depth, 0, () => {
    switch (node.type) {
      case 'Program': { let r; for (const s of node.body) r = evaluate(s, env, rec, depth + 1); return r; }
      case 'Assign': { const v = evaluate(node.value, env, rec, depth + 1); env.define(node.name, v); return v; }
      case 'Lit': return node.value;
      case 'Loop':
        for (const item of node.items) {
          rec.record({ type: 'LoopBinding', loc: node.loc }, env, depth + 1, 0, () => { env.define(node.name, item); return item; });
          for (const s of node.body) evaluate(s, env, rec, depth + 1);
        }
        return undefined;
      case 'Print': rec.write(node.text); return null;
      case 'Return': return new ReturnSignal(42);
    }
    throw new Error(`unknown ${node.type}`);
  });
}
const program = {
  type: 'Program', loc: L(1), body: [
    { type: 'Assign', name: 'total', value: { type: 'Lit', value: 0, loc: L(1) }, loc: L(1) },
    { type: 'Loop', name: 'i', items: [1, 2], loc: L(2), body: [
      { type: 'Assign', name: 'total', value: { type: 'Lit', value: 5, loc: L(3) }, loc: L(3) },
      { type: 'Print', text: 'x ', loc: L(4) },
    ] },
    { type: 'Print', text: '\nend\n', loc: L(5) },
  ],
};

class MiniDebugger extends TraceDebugger {
  static nodeCategories = { ...EMPTY_CATEGORIES, stopOnExit: ['Assign', 'LoopBinding'] };
  constructor(source) {
    const rec = new Recorder(0);
    evaluate(program, new Scope(null, 'global'), rec);
    super({ source, trace: rec.trace, consoleLogs: rec.consoleLogs, ast: program });
  }
}

describe('Recorder + Scope（別の言語の評価器から使う）', () => {
  test('enter/exit を matchIdx で対にし、変数のスナップショットを付ける', () => {
    const dbg = new MiniDebugger('src');
    const t = dbg.trace;
    expect(t[0]).toMatchObject({ phase: 'enter', nodeType: 'Program', matchIdx: t.length - 1 });
    const lastAssign = t.filter(e => e.phase === 'exit' && e.nodeType === 'Assign').pop();
    expect(lastAssign.env).toEqual([{ total: 5, i: 2 }]);
    expect(lastAssign.value).toBe(5);
    expect(t.every(e => !('domSnapshot' in e))).toBe(true);  // JS 固有のフィールドは付かない
  });

  test('ReturnSignal を unwrap して value に記録する', () => {
    const rec = new Recorder(0);
    const r = evaluate({ type: 'Return', loc: L(1) }, new Scope(), rec);
    expect(r).toBeInstanceOf(ReturnSignal);
    expect(rec.trace[1].value).toBe(42);
  });

  test('maxSteps を超えると [MaxSteps] の RangeError', () => {
    const rec = new Recorder(3);
    expect(() => evaluate(program, new Scope(), rec)).toThrow(/\[MaxSteps\]/);
  });

  test('eventExtras() で TraceEvent にフィールドを足せる', () => {
    class R extends Recorder { eventExtras() { return { extra: this.trace.length }; } }
    const rec = new R(0);
    evaluate({ type: 'Lit', value: 1, loc: L(1) }, new Scope(), rec);
    expect(rec.trace.map(e => e.extra)).toEqual([0, 1]);
  });

  test('captureLog は formatLog(value, index) で整形し、既定では端末に出さない', () => {
    const rec = new Recorder(0, { formatLog: (v, i) => `${i}:${v}` });
    const orig = console.log;
    let called = false;
    console.log = () => { called = true; };
    try { rec.captureLog('log', ['a', 'b']); } finally { console.log = orig; }
    expect(called).toBe(false);
    expect(rec.consoleLogs).toEqual([{ atIndex: 0, level: 'log', text: '0:a 1:b' }]);
  });
});

describe('出力の断片（write）', () => {
  test('改行で区切り、行の途中の断片は eol: false', () => {
    const dbg = new MiniDebugger('src');
    expect(dbg.consoleLogs.map(l => [l.text, l.eol])).toEqual([
      ['x ', false], ['x ', false], ['', true], ['end', true],
    ]);
  });

  test('joinConsoleLines は 1 行 1 件にまとめる（atIndex は行が完成した位置）', () => {
    const dbg = new MiniDebugger('src');
    const lines = joinConsoleLines(dbg.consoleLogs);
    expect(lines.map(l => l.text)).toEqual(['x x ', 'end']);
    expect(lines[0].atIndex).toBe(dbg.consoleLogs[2].atIndex);
  });

  test('captureLog の行と混在してもよく、最後の改行のない行も 1 行になる', () => {
    const logs = [
      { atIndex: 0, level: 'log', text: 'a' },
      { atIndex: 1, level: 'log', text: 'b', eol: false },
      { atIndex: 2, level: 'log', text: 'c', eol: false },
    ];
    expect(joinConsoleLines(logs)).toEqual([
      { atIndex: 0, level: 'log', text: 'a' },
      { atIndex: 2, level: 'log', text: 'bc' },
    ]);
  });
});

describe('TraceDebugger', () => {
  test('nodeCategories の stopOnExit で humanStep が止まる（ループ変数への代入を含む）', () => {
    const dbg = new MiniDebugger('src');
    const stops = [];
    while (!dbg.humanStep().done) stops.push(dbg.getCurrentEvent().nodeType);
    expect(stops).toEqual(['Assign', 'LoopBinding', 'Assign', 'LoopBinding', 'Assign']);
  });

  test('既定の nodeCategories（空）では止まる点がない', () => {
    const dbg = TraceDebugger.fromTrace('src', new MiniDebugger('src').trace, null, []);
    expect(dbg._getHumanIndices().size).toBe(0);
  });

  test('fromTrace は呼び出したクラスのインスタンスを返す', () => {
    const base = new MiniDebugger('src');
    const dbg = MiniDebugger.fromTrace('src', base.trace, base.ast, base.consoleLogs);
    expect(dbg).toBeInstanceOf(MiniDebugger);
    expect(dbg.cursor).toBe(0);
    expect(dbg.nodeCategories.stopOnExit).toContain('LoopBinding');
  });

  test('ステップ操作（stepIn / stepOver / stepBack / stepOut）', () => {
    const dbg = new MiniDebugger('src');
    dbg.stepIn();
    expect(dbg.getCurrentEvent()).toMatchObject({ phase: 'enter', nodeType: 'Assign' });
    dbg.stepOver();
    expect(dbg.getCurrentEvent()).toMatchObject({ phase: 'exit', nodeType: 'Assign' });
    dbg.stepBack();   // exit Assign(4) → exit Lit(3)
    expect(dbg.getCurrentEvent()).toMatchObject({ phase: 'exit', nodeType: 'Lit' });
    dbg.stepOut();
    expect(dbg.isDone()).toBe(true);
  });
});

describe('finalizePartialTrace / ExecutionError', () => {
  test('閉じていない enter を除き、外側の matchIdx を末尾にそろえる', () => {
    const tr = [
      { phase: 'enter', matchIdx: -1 },
      { phase: 'enter', matchIdx: 2 }, { phase: 'exit', matchIdx: 1 },
      { phase: 'enter', matchIdx: -1 },
    ];
    finalizePartialTrace(tr);
    expect(tr.length).toBe(3);
    expect(tr[0].matchIdx).toBe(3);
  });

  test('スタックオーバーフローのメッセージをそろえ、[MaxSteps] を除く', () => {
    expect(new ExecutionError(new RangeError('Maximum call stack size exceeded')).message).toMatch(/深くなりすぎた/);
    expect(new ExecutionError(new RangeError('[MaxSteps] 上限')).message).toBe('上限');
    const e = new ExecutionError(new Error('x'), 's', [1], { a: 1 }, [2]);
    expect([e.partialSource, e.partialTrace, e.partialAst, e.partialConsoleLogs]).toEqual(['s', [1], { a: 1 }, [2]]);
  });
});

describe('deepClone の hook', () => {
  test('hook で言語ごとの値の印を保ったままクローンできる', () => {
    const tuple = Object.freeze(Object.defineProperty([1, [2]], '__tuple__', { value: true }));
    const hook = (v, clone, seen) => {
      if (!Array.isArray(v) || !v.__tuple__) return undefined;
      const c = [];
      seen.set(v, c);
      v.forEach(x => c.push(clone(x)));
      Object.defineProperty(c, '__tuple__', { value: true });
      return Object.freeze(c);
    };
    const c = createCloner(hook)({ t: tuple });
    expect(c.t).not.toBe(tuple);
    expect(c.t.__tuple__).toBe(true);
    expect(c.t[1]).not.toBe(tuple[1]);
    expect(deepClone({ t: tuple }).t.__tuple__).toBeUndefined();   // hook なしでは印が落ちる
  });

  test('Recorder の clone オプションがスナップショットに使われる', () => {
    const rec = new Recorder(0, { clone: (v) => (typeof v === 'number' ? v * 10 : v) });
    const env = new Scope();
    env.define('x', 1);
    rec.record({ type: 'Lit', loc: L(1) }, env, 0, 0, () => 1);
    expect(rec.trace[0].env).toEqual([{ x: 10 }]);
  });

  test('循環参照と JSFunction は従来どおり', () => {
    const a = [1]; a.push(a);
    const c = deepClone(a);
    expect(c[1]).toBe(c);
    const fn = { __type__: 'JSFunction', name: 'f' };
    expect(deepClone({ fn }).fn).toBe(fn);
  });
});

describe('Scope のスナップショット', () => {
  test('snapshot は内→外、snapshotFrom は inner からこのスコープまでをまとめる', () => {
    const g = new Scope(null, 'global'); g.define('a', 1);
    const f = new Scope(g, 'function'); f.define('b', 2);
    const blk = new Scope(f, 'block'); blk.define('b', 3);
    expect(blk.snapshot()).toEqual([{ b: 3 }, { b: 2 }, { a: 1 }]);
    expect(f.snapshotFrom(blk)).toEqual({ b: 3 });
    expect(f.snapshotFrom(g)).toEqual({ b: 2 });
    expect(blk.snapshotBlocks()).toEqual({ b: 3 });
  });
});

describe('イベントの値はその時点の値（ADR-017）', () => {
  test('配列の値は、exit の時点の中身で複製される（あとで変えても過去のイベントは変わらない）', () => {
    const rec = new Recorder();
    const env = new Scope(null, 'global');
    const arr = [1];
    rec.record({ type: 'Ref', loc: L(1) }, env, 0, 0, () => arr);
    arr.push(2);
    expect(rec.trace[1].value).toEqual([1]);
  });

  test('同じ時点の変数と同じ配列なら、スナップショットでも同じ複製を指す', () => {
    const rec = new Recorder();
    const env = new Scope(null, 'global');
    const arr = [1, 2];
    env.define('a', arr);
    rec.record({ type: 'Ref', loc: L(1) }, env, 0, 0, () => arr);
    expect(rec.trace[1].value).toBe(rec.trace[1].env[0].a);
  });

  test('言語ごとのクローン（hook）で複製する', () => {
    const marked = (xs) => Object.defineProperty([...xs], '__mark', { value: 'm', enumerable: false });
    const hook = (v, clone, seen) => {
      if (!Array.isArray(v) || !v.__mark) return undefined;
      const c = marked([]); seen.set(v, c); for (const x of v) c.push(clone(x)); return c;
    };
    const rec = new Recorder(0, { clone: createCloner(hook) });
    rec.record({ type: 'Ref', loc: L(1) }, new Scope(null, 'global'), 0, 0, () => marked([3]));
    expect(rec.trace[1].value.__mark).toBe('m');
  });
});

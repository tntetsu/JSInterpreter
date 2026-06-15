import { Environment, deepClone } from './environment.js';
import { RuntimeError } from '../errors.js';
import { parse } from '../parser/parser.js';

// ─── 制御フロー用シグナル ──────────────────────────────────────────────────────

class ReturnSignal  { constructor(v) { this.value = v; } }
class BreakSignal   {}
class ContinueSignal{}
class ThrowSignal   { constructor(v) { this.value = v; } }

// ─── Recorder ─────────────────────────────────────────────────────────────────

/**
 * Recorder — 評価イベントを trace 配列に記録する。
 * null の場合は通常実行（記録なし）。
 */
/**
 * console.log 等の引数をプレーンな文字列に変換する。
 * depth=0 の文字列はクォートなし（console.log の標準動作）。
 * 配列・オブジェクト内の文字列はシングルクォート付き（Node.js と同様）。
 */
function formatLogArg(v, depth = 0) {
  if (v === null)      return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return depth === 0 ? v : `'${v}'`;
  if (typeof v !== 'object') return String(v);
  if (v.__type__ === 'JSFunction') return '[Function (anonymous)]';
  if (v.__type__ === 'JSClass')    return '[class]';
  if (v.__type__ === 'JSPromise')  {
    if (v.status === 'fulfilled') return `Promise { ${formatLogArg(v.value, 1)} }`;
    if (v.status === 'rejected')  return `Promise { <rejected> ${formatLogArg(v.reason, 1)} }`;
    return 'Promise { <pending> }';
  }
  if (Array.isArray(v)) return '[ ' + v.map(x => formatLogArg(x, depth + 1)).join(', ') + ' ]';
  const keys = Object.keys(v).filter(k => !k.startsWith('__'));
  return '{ ' + keys.map(k => `${k}: ${formatLogArg(v[k], depth + 1)}`).join(', ') + ' }';
}

class Recorder {
  constructor(maxSteps = 0) {
    this.trace = [];          // TraceEvent[]
    this.callStack = [];      // Frame[]  { name, loc, args }
    this.consoleLogs = [];    // { atIndex: number, level: string, text: string }
    this.frameEnvStack = [];  // Environment[]  各アクティブフレームの callEnv（push 順 = 外→内）
    this.vdom = null;         // VirtualDocument | null（DOM モード時に JSDebugger がセット）
    this.maxSteps = maxSteps; // 0 = 無制限
  }

  /**
   * console.log 等を横取りして consoleLogs に追記する。
   * CLI 出力も維持するため、ネイティブ console にも転送する。
   * @param {'log'|'warn'|'error'|'info'|'debug'} level
   * @param {any[]} args
   */
  captureLog(level, args) {
    const text = args.map(formatLogArg).join(' ');
    // 記録：次に push される TraceEvent のインデックスを atIndex とする
    this.consoleLogs.push({ atIndex: this.trace.length, level, text });
    // CLI モードでもターミナルに出力する
    if (level === 'error' || level === 'warn') {
      console[level](text);
    } else {
      console.log(text);
    }
  }

  /**
   * enter/exit のペアを記録し、matchIdx で相互リンクする。
   * fn() の戻り値を返す。
   */
  record(node, env, depth, callDepth, fn) {
    if (this.maxSteps > 0 && this.trace.length >= this.maxSteps) {
      throw new RangeError('[MaxSteps] 最大ステップ数を超えました');
    }
    // 各アクティブフレームの callEnv を現時点でスナップショット（外→内の順）
    const frameEnvs = this.frameEnvStack.map(e => e.snapshotOwn());

    const enterIdx = this.trace.length;
    this.trace.push({
      phase: 'enter',
      nodeType: node.type,
      loc: node.loc || { line: 0, column: 0 },
      end: node.end || null,
      depth,
      callDepth,
      callStack: this.callStack.map(f => ({ ...f })),
      env: env.snapshot(),
      frameEnvs,
      domSnapshot: this.vdom ? this.vdom.snapshot() : null,
      value: undefined,
      matchIdx: -1,
    });

    const rawValue = fn();

    // ReturnSignal / ThrowSignal を unwrap: trace には実際の値を記録し、
    // シグナル本体はそのまま return して制御フロー伝播に使う
    let traceValue = rawValue;
    if (rawValue instanceof ReturnSignal || rawValue instanceof ThrowSignal) {
      traceValue = rawValue.value;
    }

    // exit 時点で再スナップショット（ローカル変数が更新されている可能性があるため）
    const exitFrameEnvs = this.frameEnvStack.map(e => e.snapshotOwn());

    const exitIdx = this.trace.length;
    this.trace.push({
      phase: 'exit',
      nodeType: node.type,
      loc: node.loc || { line: 0, column: 0 },
      end: node.end || null,
      depth,
      callDepth,
      callStack: this.callStack.map(f => ({ ...f })),
      env: env.snapshot(),
      frameEnvs: exitFrameEnvs,
      domSnapshot: this.vdom ? this.vdom.snapshot() : null,
      value: traceValue,
      matchIdx: enterIdx,
    });
    this.trace[enterIdx].matchIdx = exitIdx;

    return rawValue;
  }
}

// ─── JSPromise（async/await の同期シミュレーション）────────────────────────────

function makeFulfilledPromise(value) {
  return { __type__: 'JSPromise', status: 'fulfilled', value };
}

function makeRejectedPromise(reason) {
  return { __type__: 'JSPromise', status: 'rejected', reason };
}

/**
 * JSPromise または平値を同期的に解決する。
 * @returns {{ ok: boolean, value?: any, reason?: any }}
 */
function resolveJSPromise(val) {
  if (val && val.__type__ === 'JSPromise') {
    if (val.status === 'fulfilled') return { ok: true, value: val.value };
    if (val.status === 'rejected')  return { ok: false, reason: val.reason };
    return { ok: false, reason: new Error('Promise は保留中です（非同期 I/O は未対応）') };
  }
  // 非 Promise 値は解決済みとして扱う（await 42 → 42）
  return { ok: true, value: val };
}

/**
 * executor（JSFunction または native function）を同期的に呼び出して JSPromise を作る。
 */
function createJSPromiseFromExecutor(executor, recorder, depth, callDepth, loc) {
  if (!executor) return makeFulfilledPromise(undefined);

  let status = 'pending';
  let resolvedValue;
  let rejectedReason;

  const resolve = (val) => {
    if (status !== 'pending') return;
    if (val && val.__type__ === 'JSPromise') {
      status    = val.status;
      resolvedValue  = val.value;
      rejectedReason = val.reason;
    } else {
      status = 'fulfilled';
      resolvedValue = val;
    }
  };

  const reject = (r) => {
    if (status !== 'pending') return;
    status = 'rejected';
    rejectedReason = r;
  };

  const result = callFunction(executor, [resolve, reject], undefined, recorder, depth, callDepth, loc);

  // executor が例外を投げた場合（ThrowSignal）
  if (result instanceof ThrowSignal && status === 'pending') {
    return makeRejectedPromise(result.value);
  }

  return { __type__: 'JSPromise', status, value: resolvedValue, reason: rejectedReason };
}

// ─── 組み込みグローバル ────────────────────────────────────────────────────────

function createGlobalEnv(recorder = null) {
  const env = new Environment(null);

  env.define('undefined', undefined);
  env.define('NaN', NaN);
  env.define('Infinity', Infinity);
  env.define('Math', Math);
  env.define('JSON', JSON);
  env.define('Date', Date);
  env.define('parseInt', parseInt);
  env.define('parseFloat', parseFloat);
  env.define('isNaN', isNaN);
  env.define('isFinite', isFinite);
  env.define('Number', Number);
  env.define('String', String);
  env.define('Boolean', Boolean);
  env.define('Array', Array);
  env.define('Object', Object);
  env.define('Symbol', Symbol);
  // カスタム Promise（同期的 JSPromise を返す）
  const JSPromiseConstructor = function __JSPromiseConstructor__() {};
  JSPromiseConstructor.__isJSPromiseConstructor = true;
  JSPromiseConstructor.resolve = (val) => {
    if (val && val.__type__ === 'JSPromise') return val;
    return makeFulfilledPromise(val);
  };
  JSPromiseConstructor.reject = (reason) => makeRejectedPromise(reason);
  JSPromiseConstructor.all = (promises) => {
    const arr = Array.isArray(promises) ? promises : [...(promises || [])];
    const values = [];
    for (const p of arr) {
      const r = resolveJSPromise(p);
      if (!r.ok) return makeRejectedPromise(r.reason);
      values.push(r.value);
    }
    return makeFulfilledPromise(values);
  };
  JSPromiseConstructor.allSettled = (promises) => {
    const arr = Array.isArray(promises) ? promises : [...(promises || [])];
    return makeFulfilledPromise(arr.map(p => {
      const r = resolveJSPromise(p);
      return r.ok ? { status: 'fulfilled', value: r.value } : { status: 'rejected', reason: r.reason };
    }));
  };
  JSPromiseConstructor.race = (promises) => {
    const arr = Array.isArray(promises) ? promises : [...(promises || [])];
    for (const p of arr) {
      const r = resolveJSPromise(p);
      return r.ok ? makeFulfilledPromise(r.value) : makeRejectedPromise(r.reason);
    }
    return { __type__: 'JSPromise', status: 'pending' };
  };
  JSPromiseConstructor.any = (promises) => {
    const arr = Array.isArray(promises) ? promises : [...(promises || [])];
    const reasons = [];
    for (const p of arr) {
      const r = resolveJSPromise(p);
      if (r.ok) return makeFulfilledPromise(r.value);
      reasons.push(r.reason);
    }
    return makeRejectedPromise(new AggregateError(reasons, 'All promises were rejected'));
  };
  env.define('Promise', JSPromiseConstructor);
  env.define('Map', Map);
  env.define('Set', Set);
  env.define('WeakMap', WeakMap);
  env.define('WeakSet', WeakSet);
  env.define('Error', Error);
  env.define('TypeError', TypeError);
  env.define('RangeError', RangeError);
  env.define('RegExp', RegExp);
  // recorder が渡されたときは console 出力を横取りして consoleLogs に蓄積する
  const cap = (level, args) => recorder
    ? recorder.captureLog(level, args)
    : console[level](...args);
  env.define('console', {
    log:   (...args) => cap('log',   args),
    warn:  (...args) => cap('warn',  args),
    error: (...args) => cap('error', args),
    info:  (...args) => cap('info',  args),
    debug: (...args) => cap('debug', args),
  });

  return env;
}

// ─── メイン評価関数 ────────────────────────────────────────────────────────────

/**
 * @param {Object} node      AST ノード
 * @param {Environment} env  現在の環境
 * @param {Recorder|null} recorder  記録器（null = 通常実行）
 * @param {number} depth     ASTネスト深さ
 * @param {number} callDepth 関数呼び出し深さ
 */
function evaluate(node, env, recorder = null, depth = 0, callDepth = 0) {
  if (!node) return undefined;

  // recorder がある場合、このノードの enter/exit を記録
  if (recorder) {
    return recorder.record(node, env, depth, callDepth, () =>
      _eval(node, env, recorder, depth, callDepth)
    );
  }
  return _eval(node, env, null, depth, callDepth);
}

function _eval(node, env, recorder, depth, callDepth) {
  const d = depth + 1; // 子ノードの深さ

  switch (node.type) {

    // ── プログラム ────────────────────────────────────────────────────────────
    case 'Program': {
      let result;
      for (const stmt of node.body) {
        result = evaluate(stmt, env, recorder, d, callDepth);
        if (result instanceof ReturnSignal) return result;
        if (result instanceof BreakSignal)  return result;
        if (result instanceof ContinueSignal) return result;
        if (result instanceof ThrowSignal) return result;
      }
      return result;
    }

    // ── ブロック ──────────────────────────────────────────────────────────────
    case 'BlockStatement': {
      const blockEnv = new Environment(env);
      let result;
      for (const stmt of node.body) {
        result = evaluate(stmt, blockEnv, recorder, d, callDepth);
        if (result instanceof ReturnSignal)   return result;
        if (result instanceof BreakSignal)    return result;
        if (result instanceof ContinueSignal) return result;
        if (result instanceof ThrowSignal)    return result;
      }
      return result;
    }

    // ── 変数宣言 ──────────────────────────────────────────────────────────────
    case 'VariableDeclaration': {
      for (const decl of node.declarations) {
        const val = decl.init ? evaluate(decl.init, env, recorder, d, callDepth) : undefined;
        if (val instanceof ThrowSignal) return val;
        bindPattern(decl.id, val, env, recorder, d, callDepth);
      }
      return undefined;
    }

    // ── 関数宣言 ──────────────────────────────────────────────────────────────
    case 'FunctionDeclaration': {
      const fn = makeFunction(node, env, node.id?.name || '<anonymous>');
      if (node.id) env.define(node.id.name, fn);
      return undefined;
    }

    // ── クラス宣言 ────────────────────────────────────────────────────────────
    case 'ClassDeclaration': {
      const cls = makeClass(node, env, recorder, d, callDepth);
      if (node.id) env.define(node.id.name, cls);
      return undefined;
    }

    // ── return ────────────────────────────────────────────────────────────────
    case 'ReturnStatement': {
      const val = node.argument ? evaluate(node.argument, env, recorder, d, callDepth) : undefined;
      if (val instanceof ThrowSignal) return val; // throw を ReturnSignal で包まない
      return new ReturnSignal(val);
    }

    // ── throw ─────────────────────────────────────────────────────────────────
    case 'ThrowStatement': {
      const val = evaluate(node.argument, env, recorder, d, callDepth);
      return new ThrowSignal(val);
    }

    // ── try-catch-finally ─────────────────────────────────────────────────────
    case 'TryStatement': {
      let result = evaluate(node.block, env, recorder, d, callDepth);
      if (result instanceof ThrowSignal && node.handler) {
        const catchEnv = new Environment(env);
        if (node.handler.param) bindPattern(node.handler.param, result.value, catchEnv, recorder, d, callDepth);
        result = evaluate(node.handler.body, catchEnv, recorder, d, callDepth);
      }
      if (node.finalizer) {
        const finResult = evaluate(node.finalizer, env, recorder, d, callDepth);
        if (finResult instanceof ReturnSignal || finResult instanceof ThrowSignal) return finResult;
      }
      return result;
    }

    // ── if ────────────────────────────────────────────────────────────────────
    case 'IfStatement': {
      const cond = evaluate(node.test, env, recorder, d, callDepth);
      if (isTruthy(cond)) return evaluate(node.consequent, env, recorder, d, callDepth);
      if (node.alternate) return evaluate(node.alternate, env, recorder, d, callDepth);
      return undefined;
    }

    // ── while ─────────────────────────────────────────────────────────────────
    case 'WhileStatement': {
      while (isTruthy(evaluate(node.test, env, recorder, d, callDepth))) {
        const result = evaluate(node.body, env, recorder, d, callDepth);
        if (result instanceof BreakSignal)    break;
        if (result instanceof ContinueSignal) continue;
        if (result instanceof ReturnSignal || result instanceof ThrowSignal) return result;
      }
      return undefined;
    }

    // ── do-while ──────────────────────────────────────────────────────────────
    case 'DoWhileStatement': {
      do {
        const result = evaluate(node.body, env, recorder, d, callDepth);
        if (result instanceof BreakSignal)    break;
        if (result instanceof ContinueSignal) continue;
        if (result instanceof ReturnSignal || result instanceof ThrowSignal) return result;
      } while (isTruthy(evaluate(node.test, env, recorder, d, callDepth)));
      return undefined;
    }

    // ── for ───────────────────────────────────────────────────────────────────
    case 'ForStatement': {
      const forEnv = new Environment(env);
      if (node.init) evaluate(node.init, forEnv, recorder, d, callDepth);
      while (!node.test || isTruthy(evaluate(node.test, forEnv, recorder, d, callDepth))) {
        const result = evaluate(node.body, forEnv, recorder, d, callDepth);
        if (result instanceof BreakSignal)    break;
        if (result instanceof ReturnSignal || result instanceof ThrowSignal) return result;
        if (node.update) evaluate(node.update, forEnv, recorder, d, callDepth);
      }
      return undefined;
    }

    // ── for...of ──────────────────────────────────────────────────────────────
    case 'ForOfStatement': {
      const iter = evaluate(node.right, env, recorder, d, callDepth);
      for (const item of iter) {
        const loopEnv = new Environment(env);
        bindForLeft(node.left, item, loopEnv, recorder, d, callDepth);
        const result = evaluate(node.body, loopEnv, recorder, d, callDepth);
        if (result instanceof BreakSignal)    break;
        if (result instanceof ContinueSignal) continue;
        if (result instanceof ReturnSignal || result instanceof ThrowSignal) return result;
      }
      return undefined;
    }

    // ── for...in ──────────────────────────────────────────────────────────────
    case 'ForInStatement': {
      const obj = evaluate(node.right, env, recorder, d, callDepth);
      for (const key in obj) {
        const loopEnv = new Environment(env);
        bindForLeft(node.left, key, loopEnv, recorder, d, callDepth);
        const result = evaluate(node.body, loopEnv, recorder, d, callDepth);
        if (result instanceof BreakSignal)    break;
        if (result instanceof ContinueSignal) continue;
        if (result instanceof ReturnSignal || result instanceof ThrowSignal) return result;
      }
      return undefined;
    }

    // ── break / continue ──────────────────────────────────────────────────────
    case 'BreakStatement':    return new BreakSignal();
    case 'ContinueStatement': return new ContinueSignal();

    // ── 式文 ──────────────────────────────────────────────────────────────────
    case 'ExpressionStatement':
      return evaluate(node.expression, env, recorder, d, callDepth);

    // ── 空文 ──────────────────────────────────────────────────────────────────
    case 'EmptyStatement': return undefined;
    case 'DebuggerStatement': return undefined;

    // ── import/export（静的解析のみ）────────────────────────────────────────────
    case 'ImportDeclaration':         return undefined;
    case 'ExportDefaultDeclaration':  return evaluate(node.declaration, env, recorder, d, callDepth);
    case 'ExportNamedDeclaration':    return evaluate(node.declaration, env, recorder, d, callDepth);

    // ── リテラル ──────────────────────────────────────────────────────────────
    case 'Literal': return node.value;

    // ── テンプレートリテラル ──────────────────────────────────────────────────
    case 'TemplateLiteral': {
      let result = '';
      for (let i = 0; i < node.quasis.length; i++) {
        result += node.quasis[i].value;
        if (i < node.expressions.length) {
          result += jsToString(evaluate(node.expressions[i], env, recorder, d, callDepth));
        }
      }
      return result;
    }

    // ── 識別子 ────────────────────────────────────────────────────────────────
    case 'Identifier':
      return env.get(node.name, node.loc);

    // ── this ──────────────────────────────────────────────────────────────────
    case 'ThisExpression':
      try { return env.get('this', node.loc); } catch { return undefined; }

    // ── Super ─────────────────────────────────────────────────────────────────
    case 'Super':
      return env.get('__super__', node.loc);

    // ── 二項演算式 ────────────────────────────────────────────────────────────
    case 'BinaryExpression': {
      const l = evaluate(node.left, env, recorder, d, callDepth);
      const r = evaluate(node.right, env, recorder, d, callDepth);
      return applyBinary(node.operator, l, r, node.loc);
    }

    // ── 論理演算式（短絡評価）────────────────────────────────────────────────
    case 'LogicalExpression': {
      const l = evaluate(node.left, env, recorder, d, callDepth);
      if (node.operator === '&&') return isTruthy(l) ? evaluate(node.right, env, recorder, d, callDepth) : l;
      if (node.operator === '||') return isTruthy(l) ? l : evaluate(node.right, env, recorder, d, callDepth);
      if (node.operator === '??') return (l !== null && l !== undefined) ? l : evaluate(node.right, env, recorder, d, callDepth);
      throw new RuntimeError(`不明な論理演算子: ${node.operator}`, node.loc);
    }

    // ── 単項演算式 ────────────────────────────────────────────────────────────
    case 'UnaryExpression': {
      if (node.operator === 'typeof') {
        try { return typeof evaluate(node.argument, env, recorder, d, callDepth); }
        catch { return 'undefined'; }
      }
      if (node.operator === 'delete') {
        if (node.argument.type === 'MemberExpression') {
          const obj = evaluate(node.argument.object, env, recorder, d, callDepth);
          const key = node.argument.computed
            ? evaluate(node.argument.property, env, recorder, d, callDepth)
            : node.argument.property.name;
          return delete obj[key];
        }
        return true;
      }
      const val = evaluate(node.argument, env, recorder, d, callDepth);
      switch (node.operator) {
        case '!':    return !val;
        case '-':    return -val;
        case '+':    return +val;
        case '~':    return ~val;
        case 'void': return undefined;
        default: throw new RuntimeError(`不明な単項演算子: ${node.operator}`, node.loc);
      }
    }

    // ── 更新演算式（++/--）────────────────────────────────────────────────────
    case 'UpdateExpression': {
      const old = evaluate(node.argument, env, recorder, d, callDepth);
      const updated = node.operator === '++' ? old + 1 : old - 1;
      assignTo(node.argument, updated, env, recorder, d, callDepth);
      return node.prefix ? updated : old;
    }

    // ── 条件式（三項演算子）──────────────────────────────────────────────────
    case 'ConditionalExpression': {
      const test = evaluate(node.test, env, recorder, d, callDepth);
      return isTruthy(test)
        ? evaluate(node.consequent, env, recorder, d, callDepth)
        : evaluate(node.alternate, env, recorder, d, callDepth);
    }

    // ── 代入式 ────────────────────────────────────────────────────────────────
    case 'AssignmentExpression': {
      if (node.operator === '=') {
        const val = evaluate(node.right, env, recorder, d, callDepth);
        assignTo(node.left, val, env, recorder, d, callDepth);
        return val;
      }
      const cur = evaluate(node.left, env, recorder, d, callDepth);
      const rhs = evaluate(node.right, env, recorder, d, callDepth);
      const op  = node.operator.slice(0, -1);
      let result;
      if (op === '&&') result = isTruthy(cur) ? rhs : cur;
      else if (op === '||') result = isTruthy(cur) ? cur : rhs;
      else if (op === '??') result = (cur !== null && cur !== undefined) ? cur : rhs;
      else result = applyBinary(op, cur, rhs, node.loc);
      assignTo(node.left, result, env, recorder, d, callDepth);
      return result;
    }

    // ── シーケンス式 ──────────────────────────────────────────────────────────
    case 'SequenceExpression': {
      let result;
      for (const expr of node.expressions) result = evaluate(expr, env, recorder, d, callDepth);
      return result;
    }

    // ── 関数式 ────────────────────────────────────────────────────────────────
    case 'FunctionExpression':
      return makeFunction(node, env, node.id?.name || '<anonymous>');

    // ── アロー関数式 ──────────────────────────────────────────────────────────
    case 'ArrowFunctionExpression':
      return makeFunction(node, env, '<arrow>');

    // ── クラス式 ──────────────────────────────────────────────────────────────
    case 'ClassExpression':
      return makeClass(node, env, recorder, d, callDepth);

    // ── 関数呼び出し ──────────────────────────────────────────────────────────
    case 'CallExpression':
    case 'OptionalCallExpression': {
      // super() を new 呼び出しとして処理（継承コンストラクター呼び出し）
      if (node.callee.type === 'Super') {
        const superClass = env.get('__super__', node.loc);
        const args = [];
        for (const arg of node.arguments) {
          if (arg.type === 'SpreadElement') {
            args.push(...toArray(evaluate(arg.argument, env, recorder, d, callDepth)));
          } else {
            args.push(evaluate(arg, env, recorder, d, callDepth));
          }
        }
        const thisObj = env.get('this', node.loc);
        // 親クラスのコンストラクターを this に対して実行する
        if (superClass && superClass.__type__ === 'JSClass' && superClass.constructor) {
          const ctorEnv = new Environment(superClass.env);
          ctorEnv.define('this', thisObj);
          if (superClass.superClass && superClass.superClass.__type__ === 'JSClass') {
            ctorEnv.define('__super__', superClass.superClass);
          }
          bindParams(superClass.constructor.params, args, ctorEnv, recorder, d, callDepth);
          const result = evaluate(superClass.constructor.body, ctorEnv, recorder, d, callDepth);
          if (result instanceof ThrowSignal) return result;
        }
        return thisObj;
      }

      const callee = evaluate(node.callee, env, recorder, d, callDepth);
      if (callee === undefined || callee === null) {
        if (node.type === 'OptionalCallExpression') return undefined;
        throw new RuntimeError(`呼び出し不能な値: ${jsToString(callee)}`, node.loc);
      }

      const args = [];
      for (const arg of node.arguments) {
        if (arg.type === 'SpreadElement') {
          args.push(...toArray(evaluate(arg.argument, env, recorder, d, callDepth)));
        } else {
          args.push(evaluate(arg, env, recorder, d, callDepth));
        }
      }

      // thisValue の決定
      let thisValue = undefined;
      if (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression') {
        thisValue = evaluate(node.callee.object, env, recorder, d, callDepth);
      }

      return callFunction(callee, args, thisValue, recorder, d, callDepth, node.loc);
    }

    // ── new 式 ────────────────────────────────────────────────────────────────
    case 'NewExpression': {
      const ctor = evaluate(node.callee, env, recorder, d, callDepth);
      const args = [];
      for (const arg of node.arguments) {
        if (arg.type === 'SpreadElement') {
          args.push(...toArray(evaluate(arg.argument, env, recorder, d, callDepth)));
        } else {
          args.push(evaluate(arg, env, recorder, d, callDepth));
        }
      }
      return callNew(ctor, args, recorder, d, callDepth, node.loc);
    }

    // ── メンバーアクセス ──────────────────────────────────────────────────────
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const obj = evaluate(node.object, env, recorder, d, callDepth);
      if ((obj === null || obj === undefined) && node.type === 'OptionalMemberExpression') return undefined;
      if (obj === null || obj === undefined) throw new RuntimeError(`null/undefined のプロパティアクセス`, node.loc);
      const key = node.computed
        ? evaluate(node.property, env, recorder, d, callDepth)
        : node.property.name;
      const val = obj[key];
      return typeof val === 'function' ? val.bind(obj) : val;
    }

    // ── オブジェクトリテラル ──────────────────────────────────────────────────
    case 'ObjectExpression': {
      const obj = {};
      for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') {
          Object.assign(obj, evaluate(prop.argument, env, recorder, d, callDepth));
          continue;
        }
        const key = prop.computed
          ? evaluate(prop.key, env, recorder, d, callDepth)
          : (prop.key.type === 'Literal' ? prop.key.value : prop.key.name);
        const val = evaluate(prop.value, env, recorder, d, callDepth);
        if (prop.kind === 'get') {
          Object.defineProperty(obj, key, { get: val, configurable: true, enumerable: true });
        } else if (prop.kind === 'set') {
          Object.defineProperty(obj, key, { set: val, configurable: true, enumerable: true });
        } else {
          obj[key] = val;
        }
      }
      return obj;
    }

    // ── 配列リテラル ──────────────────────────────────────────────────────────
    case 'ArrayExpression': {
      const arr = [];
      for (const elem of node.elements) {
        if (!elem) { arr.push(undefined); continue; }
        if (elem.type === 'SpreadElement') {
          arr.push(...toArray(evaluate(elem.argument, env, recorder, d, callDepth)));
        } else {
          arr.push(evaluate(elem, env, recorder, d, callDepth));
        }
      }
      return arr;
    }

    // ── await 式 ──────────────────────────────────────────────────────────────
    case 'AwaitExpression': {
      const val = evaluate(node.argument, env, recorder, d, callDepth);
      if (val instanceof ThrowSignal) return val;
      // ネイティブ Promise は同期解決不可
      if (val && typeof val === 'object' && typeof val.then === 'function' && val.__type__ !== 'JSPromise') {
        return new ThrowSignal(new RuntimeError('ネイティブ Promise の await は未対応（同期実行のみサポート）', node.loc));
      }
      const resolved = resolveJSPromise(val);
      if (resolved.ok) return resolved.value;
      return new ThrowSignal(resolved.reason);
    }

    default:
      throw new RuntimeError(`未対応のノード型: ${node.type}`, node.loc);
  }
}

// ─── ヘルパー ──────────────────────────────────────────────────────────────────

function isTruthy(val) { return Boolean(val); }

function jsToString(val) {
  if (val === null)      return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'object') {
    try { return JSON.stringify(val); } catch { return '[object Object]'; }
  }
  return String(val);
}

function toArray(val) {
  if (Array.isArray(val)) return val;
  if (val && typeof val[Symbol.iterator] === 'function') return [...val];
  return [val];
}

function applyBinary(op, l, r, loc) {
  switch (op) {
    case '+':   return l + r;
    case '-':   return l - r;
    case '*':   return l * r;
    case '/':   return l / r;
    case '%':   return l % r;
    case '**':  return l ** r;
    case '==':  return l == r;  // eslint-disable-line eqeqeq
    case '!=':  return l != r;  // eslint-disable-line eqeqeq
    case '===': return l === r;
    case '!==': return l !== r;
    case '<':   return l < r;
    case '>':   return l > r;
    case '<=':  return l <= r;
    case '>=':  return l >= r;
    case '&':   return l & r;
    case '|':   return l | r;
    case '^':   return l ^ r;
    case '<<':  return l << r;
    case '>>':  return l >> r;
    case '>>>': return l >>> r;
    case 'instanceof': return l instanceof r;
    case 'in':         return l in r;
    default: throw new RuntimeError(`不明な演算子: ${op}`, loc);
  }
}

// ─── 代入先への書き込み ────────────────────────────────────────────────────────

function assignTo(node, value, env, recorder, depth, callDepth) {
  if (node.type === 'Identifier') {
    env.set(node.name, value, node.loc);
    return;
  }
  if (node.type === 'MemberExpression') {
    const obj = evaluate(node.object, env, recorder, depth, callDepth);
    const key = node.computed
      ? evaluate(node.property, env, recorder, depth, callDepth)
      : node.property.name;
    obj[key] = value;
    return;
  }
  // ── 配列分割代入: [a, b] = rhs  （パーサーは左辺を ArrayExpression で表現） ──
  if (node.type === 'ArrayExpression') {
    const arr = value ?? [];
    for (let i = 0; i < node.elements.length; i++) {
      const elem = node.elements[i];
      if (!elem) continue;
      if (elem.type === 'SpreadElement') {
        assignTo(elem.argument, arr.slice(i), env, recorder, depth, callDepth);
        break;
      }
      assignTo(elem, arr[i], env, recorder, depth, callDepth);
    }
    return;
  }
  // ── オブジェクト分割代入: ({x, y} = rhs) （左辺は ObjectExpression） ─────────
  if (node.type === 'ObjectExpression') {
    const obj = value ?? {};
    for (const prop of node.properties) {
      if (prop.type === 'SpreadElement') {
        assignTo(prop.argument, { ...obj }, env, recorder, depth, callDepth);
        continue;
      }
      const key = prop.computed
        ? evaluate(prop.key, env, recorder, depth, callDepth)
        : (prop.key.type === 'Literal' ? prop.key.value : prop.key.name);
      assignTo(prop.value, obj[key], env, recorder, depth, callDepth);
    }
    return;
  }
  throw new RuntimeError('代入先が不正です', node.loc);
}

// ─── パターンバインディング ────────────────────────────────────────────────────

function bindPattern(pattern, value, env, recorder, depth, callDepth) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      env.define(pattern.name, value);
      break;

    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          const used = pattern.properties.filter(p => p !== prop).map(p =>
            p.key.type === 'Literal' ? p.key.value : p.key.name
          );
          const rest = Object.fromEntries(Object.entries(value || {}).filter(([k]) => !used.includes(k)));
          bindPattern(prop.argument, rest, env, recorder, depth, callDepth);
        } else {
          const key = prop.key.type === 'Literal' ? prop.key.value : prop.key.name;
          let val = (value || {})[key];
          bindPattern(
            prop.value.type === 'AssignmentPattern' ? prop.value : prop.value,
            prop.value.type === 'AssignmentPattern' ? (val !== undefined ? val : evaluate(prop.value.right, env, recorder, depth, callDepth)) : val,
            env, recorder, depth, callDepth
          );
        }
      }
      break;

    case 'ArrayPattern':
      for (let i = 0; i < pattern.elements.length; i++) {
        const elem = pattern.elements[i];
        if (!elem) continue;
        if (elem.type === 'RestElement') {
          bindPattern(elem.argument, (value || []).slice(i), env, recorder, depth, callDepth);
        } else {
          const val = (value || [])[i];
          bindPattern(
            elem.type === 'AssignmentPattern' ? elem.left : elem,
            elem.type === 'AssignmentPattern' ? (val !== undefined ? val : evaluate(elem.right, env, recorder, depth, callDepth)) : val,
            env, recorder, depth, callDepth
          );
        }
      }
      break;

    case 'AssignmentPattern': {
      const actual = value !== undefined ? value : evaluate(pattern.right, env, recorder, depth, callDepth);
      bindPattern(pattern.left, actual, env, recorder, depth, callDepth);
      break;
    }

    default:
      throw new RuntimeError(`未対応のパターン型: ${pattern.type}`, pattern.loc);
  }
}

// ─── for 初期化のバインド ──────────────────────────────────────────────────────

function bindForLeft(left, value, env, recorder, depth, callDepth) {
  if (left.type === 'VariableDeclaration') {
    const decl = left.declarations[0];
    bindPattern(decl.id, value, env, recorder, depth, callDepth);
  } else {
    assignTo(left, value, env, recorder, depth, callDepth);
  }
}

// ─── 関数オブジェクト ──────────────────────────────────────────────────────────

/**
 * AST ノードから関数オブジェクトを作成する。
 */
function makeFunction(node, closureEnv, name) {
  return {
    __type__: 'JSFunction',
    name,
    params: node.params,
    body: node.body,
    expression: node.expression || false,
    async: node.async || false,
    closure: closureEnv,
  };
}

/**
 * 関数を呼び出す。
 */
function callFunction(callee, args, thisValue, recorder, depth, callDepth, loc) {
  if (typeof callee === 'function') {
    try { return callee.apply(thisValue, args); }
    catch (e) { return new ThrowSignal(e); }
  }
  if (callee && callee.__type__ === 'JSFunction') {
    const callEnv = new Environment(callee.closure);
    if (thisValue !== undefined) callEnv.define('this', thisValue);
    // パラメーターバインド
    bindParams(callee.params, args, callEnv, recorder, depth, callDepth);

    // コールスタックに追加（呼び出し時の引数値をディープクローンして記録）
    // args に配列・オブジェクトが含まれる場合、関数内で書き換えられても
    // スナップショット時点の値を表示できるようにする
    if (recorder) {
      recorder.callStack.push({
        name: callee.name || '<anonymous>',
        loc:  loc || { line: 0, column: 0 },
        args: args.map(a => deepClone(a)),
      });
      // このフレームの callEnv を frameEnvStack に登録（スコープ表示用）
      recorder.frameEnvStack.push(callEnv);
    }

    // 関数ボディは呼び出し深さを +1 して評価する
    const bodyCallDepth = callDepth + 1;
    let result;
    if (callee.expression) {
      // アロー関数（式本体）
      result = evaluate(callee.body, callEnv, recorder, depth, bodyCallDepth);
    } else {
      result = evaluate(callee.body, callEnv, recorder, depth, bodyCallDepth);
    }

    if (recorder) {
      recorder.callStack.pop();
      recorder.frameEnvStack.pop();
    }

    // 式本体のアロー関数（expression: true）は評価値を直接返す
    if (callee.expression) {
      if (result instanceof ThrowSignal) {
        return callee.async ? makeRejectedPromise(result.value) : result;
      }
      const retVal = result instanceof ReturnSignal ? result.value : result;
      return callee.async ? makeFulfilledPromise(retVal) : retVal;
    }
    if (result instanceof ReturnSignal) {
      return callee.async ? makeFulfilledPromise(result.value) : result.value;
    }
    if (result instanceof ThrowSignal) {
      return callee.async ? makeRejectedPromise(result.value) : result;
    }
    return callee.async ? makeFulfilledPromise(undefined) : undefined;
  }
  if (callee && callee.__type__ === 'JSClass') {
    throw new RuntimeError('クラスは new で呼び出してください', loc);
  }
  throw new RuntimeError(`呼び出し不能な値です`, loc);
}

/**
 * new 呼び出し。
 */
function callNew(ctor, args, recorder, depth, callDepth, loc) {
  // JSPromise コンストラクタの特別処理
  if (ctor && ctor.__isJSPromiseConstructor) {
    return createJSPromiseFromExecutor(args[0], recorder, depth, callDepth, loc);
  }
  if (typeof ctor === 'function') {
    try {
      const instance = new ctor(...args);
      return instance;
    } catch (e) {
      return new ThrowSignal(e);
    }
  }
  if (ctor && ctor.__type__ === 'JSClass') {
    return newInstance(ctor, args, recorder, depth, callDepth, loc);
  }
  throw new RuntimeError('new の対象が関数またはクラスではありません', loc);
}

// ─── クラス ────────────────────────────────────────────────────────────────────

function makeClass(node, env, recorder, depth, callDepth) {
  const superClass = node.superClass ? evaluate(node.superClass, env, recorder, depth, callDepth) : null;
  const methods = {};
  const staticMethods = {};
  let constructor = null;

  for (const member of node.body.body) {
    const keyName = member.key.type === 'Literal' ? String(member.key.value) : member.key.name;
    const fn = makeFunction(member.value, env, keyName);
    if (member.kind === 'constructor') {
      constructor = fn;
    } else if (member.static) {
      staticMethods[keyName] = fn;
    } else {
      methods[keyName] = fn;
    }
  }

  const cls = {
    __type__: 'JSClass',
    name: node.id?.name || '<anonymous>',
    superClass,
    constructor,
    methods,
    staticMethods,
    env,
  };

  // 静的メソッドをクラスオブジェクトに付加
  for (const [k, fn] of Object.entries(staticMethods)) {
    cls[k] = (...args) => callFunction(fn, args, cls, recorder, depth, callDepth, node.loc);
  }

  return cls;
}

function newInstance(cls, args, recorder, depth, callDepth, loc) {
  const instance = { __type__: '__instance__', __class__: cls };

  // プロトタイプチェーンのメソッドを設定
  let cur = cls;
  while (cur) {
    for (const [k, fn] of Object.entries(cur.methods || {})) {
      if (!(k in instance)) {
        const capturedFn = fn;
        Object.defineProperty(instance, k, {
          get() { return (...a) => callFunction(capturedFn, a, instance, recorder, depth, callDepth, loc); },
          configurable: true, enumerable: false,
        });
      }
    }
    cur = cur.superClass && cur.superClass.__type__ === 'JSClass' ? cur.superClass : null;
  }

  // コンストラクター実行
  if (cls.constructor) {
    const ctorEnv = new Environment(cls.env);
    ctorEnv.define('this', instance);

    // super() のサポート
    if (cls.superClass && cls.superClass.__type__ === 'JSClass') {
      ctorEnv.define('__super__', cls.superClass);
      ctorEnv.define('super', new Proxy({}, {
        get(_, prop) {
          if (prop === Symbol.toPrimitive) return undefined;
          const method = cls.superClass.methods[prop];
          if (method) return (...a) => callFunction(method, a, instance, recorder, depth, callDepth, loc);
          return undefined;
        },
        apply(_, __, superArgs) {
          return callNew(cls.superClass, superArgs, recorder, depth, callDepth, loc);
        },
      }));
    }

    bindParams(cls.constructor.params, args, ctorEnv, recorder, depth, callDepth);
    if (recorder) {
      recorder.callStack.push({ name: cls.name, loc: loc || { line: 0, column: 0 }, args: args.map(a => deepClone(a)) });
      recorder.frameEnvStack.push(ctorEnv);
    }
    const result = evaluate(cls.constructor.body, ctorEnv, recorder, depth, callDepth);
    if (recorder) {
      recorder.callStack.pop();
      recorder.frameEnvStack.pop();
    }
    if (result instanceof ThrowSignal) return result;
  } else if (cls.superClass && cls.superClass.__type__ === 'JSClass') {
    // 暗黙のコンストラクターで super を呼ぶ
    newInstance(cls.superClass, args, recorder, depth, callDepth, loc);
  }

  return instance;
}

function bindParams(params, args, env, recorder, depth, callDepth) {
  let argIdx = 0;
  for (const param of params) {
    if (param.type === 'RestElement') {
      bindPattern(param.argument, args.slice(argIdx), env, recorder, depth, callDepth);
      break;
    }
    bindPattern(param, args[argIdx++], env, recorder, depth, callDepth);
  }
  // arguments オブジェクトは省略
}

// ─── プログラム実行のエントリ ──────────────────────────────────────────────────

/**
 * ソースコードを実行して最終値を返す（通常モード）。
 */
function run(source) {
  const ast = parse(source);
  const env = createGlobalEnv();
  const result = evaluate(ast, env, null, 0, 0);
  if (result instanceof ReturnSignal) return result.value;
  if (result instanceof ThrowSignal)  throw result.value;
  return result;
}

/**
 * ソースコードを実行してトレースを返す（デバッグモード）。
 */
function record(source) {
  const ast = parse(source);
  const recorder = new Recorder();
  const env = createGlobalEnv(recorder);   // console を横取り
  const result = evaluate(ast, env, recorder, 0, 0);
  return { trace: recorder.trace, consoleLogs: recorder.consoleLogs, result };
}

export {
  evaluate, run, record,
  Recorder, RuntimeError,
  ReturnSignal, BreakSignal, ContinueSignal, ThrowSignal,
  createGlobalEnv, makeFunction, callFunction,
};

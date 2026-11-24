import { parse }       from '../parser/parser.js';
import { evaluate, createGlobalEnv, Recorder, callFunction } from './interpreter.js';
import { TraceDebugger, ExecutionError, finalizePartialTrace } from '../core/trace-debugger.js';
import { createVirtualDocument, makeVEvent, generateEventSequenceSkeleton } from './virtual-dom.js';

// ── イベントシーケンス処理 ───────────────────────────────────────────────────

/**
 * EventDef ひとつを処理して対応する VEvent を生成し、target に dispatchEvent する。
 * @param {object} def  { type, target, value?, key?, clientX?, ... }
 * @param {object} vdom VirtualDocument
 */
function fireEventDef(def, vdom) {
  const target = vdom.querySelector(String(def.target ?? ''));
  if (!target) return;

  const type = String(def.type ?? '');

  // input / change 系: ハンドラ呼び出し前に value をセット
  if ((type === 'input' || type === 'change') && def.value !== undefined) {
    target.value = String(def.value);
  }

  const ev = makeVEvent(type, { bubbles: true });

  if (type === 'click' || type === 'mousedown' || type === 'mouseup'
      || type === 'mouseover' || type === 'mouseout' || type === 'mouseenter'
      || type === 'mouseleave') {
    ev.__type__ = 'VMouseEvent';
    ev.clientX  = def.clientX ?? 0;
    ev.clientY  = def.clientY ?? 0;
    ev.button   = def.button  ?? 0;
    ev.buttons  = def.buttons ?? 0;
  } else if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
    ev.__type__  = 'VKeyboardEvent';
    ev.key       = def.key      ?? '';
    ev.code      = def.code     ?? '';
    ev.keyCode   = def.keyCode  ?? 0;
    ev.altKey    = def.altKey   ?? false;
    ev.ctrlKey   = def.ctrlKey  ?? false;
    ev.shiftKey  = def.shiftKey ?? false;
    ev.metaKey   = def.metaKey  ?? false;
  } else if (type === 'input' || type === 'change') {
    ev.__type__  = 'VInputEvent';
    ev.data      = def.value    ?? null;
    ev.inputType = def.inputType ?? '';
  }

  // recorder / callFunction は _doc から取得されるのでここでは不要
  target.dispatchEvent(ev);
}

// ExecutionError は共通コア（src/core/trace-debugger.js）に移した。既存の import 先を保つため再 export する。

/**
 * JS のノード型の役割（humanStep の停止点の計算に使う。TraceDebugger._getHumanIndices 参照）
 * @type {import('../core/trace-debugger.js').NodeCategories}
 */
const JS_NODE_CATEGORIES = Object.freeze({
  stopOnExit: ['VariableDeclaration', 'AssignmentExpression', 'UpdateExpression', 'ReturnStatement', 'ThrowStatement'],
  call:       ['CallExpression'],
  block:      ['BlockStatement'],
  branch:     ['IfStatement', 'ConditionalExpression'],
  condLoop:   ['WhileStatement', 'DoWhileStatement'],
  forLoop:    ['ForStatement'],
  forInit:    ['VariableDeclaration'],
  exprStmt:   ['ExpressionStatement'],
});

/**
 * JSDebugger — ステップ実行 API
 *
 * 設計：スナップショット配列方式（オムニシェント・デバッグ）
 *
 * 1. コンストラクターでプログラムを最後まで実行し、
 *    全ノードの enter/exit イベントを trace 配列に記録する。
 * 2. ステップ操作は trace 配列の cursor 操作に還元される。
 *
 * TraceEvent:
 *   phase:     'enter' | 'exit'
 *   nodeType:  string            — AST ノード型
 *   loc:       {line, column}    — ソース位置
 *   depth:     number            — ASTネスト深さ（Program=0, 子=1…）
 *   callDepth: number            — 関数呼び出し深さ
 *   callStack: Frame[]           — コールスタックのスナップショット
 *   env:       EnvSnapshot       — 変数状態（スコープチェーンの各フレーム）
 *   value?:    any               — phase==='exit' のときの評価結果
 *   matchIdx:  number            — 対応する exit/enter のインデックス
 *
 * ステップ操作：
 *   stepIn    : cursor++（次のイベントへ、深さ問わず）
 *   stepOver  : 現在が enter → matchIdx へジャンプ（子をスキップ）
 *               現在が exit  → cursor++
 *   stepOut   : callDepth < currentCallDepth になる次の exit へジャンプ
 *               callDepth が 0 のときはプログラム末尾へ
 *   stepBack  : cursor--（常に O(1)）
 */
class JSDebugger extends TraceDebugger {
  static nodeCategories = JS_NODE_CATEGORIES;

  /**
   * @param {string} source  実行するソースコード
   * @param {Object} [options]
   * @param {number} [options.maxSteps=100_000]  最大ステップ数
   * @param {boolean} [options.dom=false]        DOM モード（VirtualDOM を有効化）
   */
  constructor(source, options = {}) {
    const maxSteps = options.maxSteps ?? 100_000;

    // ── フェーズ1：記録 ────────────────────────────────────────────────────
    const ast      = parse(source);
    const recorder = new Recorder(maxSteps);
    const env      = createGlobalEnv(recorder);   // console を横取り

    if (options.dom) {
      const vdom = createVirtualDocument(recorder, callFunction);
      recorder.vdom = vdom;
      env.define('document', vdom);

      // window オブジェクト（addEventListener/dispatchEvent 付き）
      const winListeners = Object.create(null);
      const vwindow = { document: vdom, __type__: 'VWindow' };
      Object.defineProperty(vwindow, '_listeners', {
        value: winListeners, writable: false, enumerable: false, configurable: true,
      });
      vwindow.addEventListener = function(type, fn) {
        if (fn == null) return;
        const t = String(type);
        if (!winListeners[t]) winListeners[t] = [];
        if (!winListeners[t].includes(fn)) winListeners[t].push(fn);
      };
      vwindow.removeEventListener = function(type, fn) {
        const t = String(type);
        if (!winListeners[t]) return;
        winListeners[t] = winListeners[t].filter(f => f !== fn);
      };
      vwindow.dispatchEvent = function(event) {
        if (!event) return true;
        event.target = vwindow;
        const listeners = winListeners[String(event.type ?? '')] ?? [];
        for (const fn of [...listeners]) {
          callFunction(fn, [event], vwindow, recorder, 0,
                       recorder.callStack.length, { line: 0, column: 0 });
        }
        return !event._defaultPrevented;
      };
      vdom._window = vwindow;
      env.define('window', vwindow);

      // DOM イベントコンストラクタ
      env.define('Event', function(type, opts) {
        return makeVEvent(String(type ?? ''), opts ?? {});
      });
      env.define('MouseEvent', function(type, opts) {
        const ev = makeVEvent(String(type ?? ''), { bubbles: true, ...opts });
        ev.__type__ = 'VMouseEvent';
        ev.clientX  = opts?.clientX  ?? 0;
        ev.clientY  = opts?.clientY  ?? 0;
        ev.button   = opts?.button   ?? 0;
        ev.buttons  = opts?.buttons  ?? 0;
        return ev;
      });
      env.define('KeyboardEvent', function(type, opts) {
        const ev = makeVEvent(String(type ?? ''), opts ?? {});
        ev.__type__  = 'VKeyboardEvent';
        ev.key       = opts?.key       ?? '';
        ev.code      = opts?.code      ?? '';
        ev.keyCode   = opts?.keyCode   ?? 0;
        ev.altKey    = opts?.altKey    ?? false;
        ev.ctrlKey   = opts?.ctrlKey   ?? false;
        ev.shiftKey  = opts?.shiftKey  ?? false;
        ev.metaKey   = opts?.metaKey   ?? false;
        return ev;
      });
      env.define('InputEvent', function(type, opts) {
        const ev = makeVEvent(String(type ?? ''), opts ?? {});
        ev.__type__  = 'VInputEvent';
        ev.data      = opts?.data      ?? null;
        ev.inputType = opts?.inputType ?? '';
        return ev;
      });

      if (options.initialBodyHTML) {
        vdom.parseAndSetBody(String(options.initialBodyHTML));
      }
    }

    try {
      evaluate(ast, env, recorder, 0, 0);
    } catch (err) {
      // 末尾の未完了 enter を除去し、外側コンテナ（Program 等）の matchIdx を trace.length に揃える
      const tr = finalizePartialTrace(recorder.trace);
      throw new ExecutionError(err, source, tr, ast, recorder.consoleLogs);
    }

    // イベントシーケンスを初期 JS 実行後に順番に同期発火する
    if (options.dom && Array.isArray(options.events) && options.events.length > 0) {
      const vdom = recorder.vdom;
      for (const def of options.events) {
        fireEventDef(def, vdom);
      }
    }

    super({ source, trace: recorder.trace, ast, consoleLogs: recorder.consoleLogs, maxSteps });
    this._vdom = options.dom ? recorder.vdom : null;
  }

  _init(init) {
    super._init(init);
    this._vdom = null;
  }

  /**
   * DOM モード時、初期 JS 実行後の VirtualDOM からリスナー登録済み要素を走査し、
   * イベントシーケンスのスケルトン配列を返す。
   * @returns {Array<{type:string,target:string,description:string}>}
   */
  getEventSequenceSkeleton() {
    if (!this._vdom) return [];
    return generateEventSequenceSkeleton(this._vdom);
  }
}

export { JSDebugger, ExecutionError };

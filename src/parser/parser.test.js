'use strict';

const { parse, ParseError } = require('./parser');

describe('Parser', () => {
  // ── 基本的なリテラル ──────────────────────────────────────────────────────────
  describe('リテラル', () => {
    test('数値リテラル', () => {
      const ast = parse('42;');
      expect(ast.body[0].type).toBe('ExpressionStatement');
      expect(ast.body[0].expression.type).toBe('Literal');
      expect(ast.body[0].expression.value).toBe(42);
    });

    test('文字列リテラル', () => {
      const ast = parse('"hello";');
      expect(ast.body[0].expression.value).toBe('hello');
    });

    test('真偽値', () => {
      expect(parse('true;').body[0].expression.value).toBe(true);
      expect(parse('false;').body[0].expression.value).toBe(false);
    });

    test('null', () => {
      expect(parse('null;').body[0].expression.value).toBe(null);
    });

    test('テンプレートリテラル（補間なし）', () => {
      const ast = parse('`hello`;');
      expect(ast.body[0].expression.type).toBe('TemplateLiteral');
      expect(ast.body[0].expression.quasis[0].value).toBe('hello');
    });

    test('テンプレートリテラル（補間あり）', () => {
      const ast = parse('`hello ${name}!`;');
      const tmpl = ast.body[0].expression;
      expect(tmpl.type).toBe('TemplateLiteral');
      expect(tmpl.quasis.length).toBe(2);
      expect(tmpl.expressions.length).toBe(1);
      expect(tmpl.expressions[0].name).toBe('name');
    });
  });

  // ── 変数宣言 ──────────────────────────────────────────────────────────────────
  describe('変数宣言', () => {
    test('let 宣言', () => {
      const ast = parse('let x = 1;');
      const decl = ast.body[0];
      expect(decl.type).toBe('VariableDeclaration');
      expect(decl.kind).toBe('let');
      expect(decl.declarations[0].id.name).toBe('x');
      expect(decl.declarations[0].init.value).toBe(1);
    });

    test('const 宣言', () => {
      const ast = parse('const PI = 3.14;');
      expect(ast.body[0].kind).toBe('const');
    });

    test('複数宣言', () => {
      const ast = parse('let a = 1, b = 2;');
      expect(ast.body[0].declarations.length).toBe(2);
    });

    test('オブジェクト分割代入', () => {
      const ast = parse('let { x, y } = obj;');
      expect(ast.body[0].declarations[0].id.type).toBe('ObjectPattern');
    });

    test('配列分割代入', () => {
      const ast = parse('let [a, b] = arr;');
      expect(ast.body[0].declarations[0].id.type).toBe('ArrayPattern');
    });
  });

  // ── 二項演算式 ────────────────────────────────────────────────────────────────
  describe('二項演算式', () => {
    test('加算', () => {
      const ast = parse('1 + 2;');
      const expr = ast.body[0].expression;
      expect(expr.type).toBe('BinaryExpression');
      expect(expr.operator).toBe('+');
      expect(expr.left.value).toBe(1);
      expect(expr.right.value).toBe(2);
    });

    test('優先順位', () => {
      const ast = parse('1 + 2 * 3;');
      const expr = ast.body[0].expression;
      expect(expr.operator).toBe('+');
      expect(expr.right.operator).toBe('*');
    });

    test('累乗（右結合）', () => {
      const ast = parse('2 ** 3 ** 2;');
      const expr = ast.body[0].expression;
      expect(expr.operator).toBe('**');
      expect(expr.right.operator).toBe('**'); // 右結合
    });
  });

  // ── 関数 ──────────────────────────────────────────────────────────────────────
  describe('関数', () => {
    test('関数宣言', () => {
      const ast = parse('function add(a, b) { return a + b; }');
      const fn = ast.body[0];
      expect(fn.type).toBe('FunctionDeclaration');
      expect(fn.id.name).toBe('add');
      expect(fn.params.length).toBe(2);
    });

    test('アロー関数（単一パラメーター）', () => {
      const ast = parse('const f = x => x * 2;');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.type).toBe('ArrowFunctionExpression');
      expect(fn.params[0].name).toBe('x');
      expect(fn.expression).toBe(true);
    });

    test('アロー関数（複数パラメーター）', () => {
      const ast = parse('const f = (a, b) => a + b;');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.params.length).toBe(2);
    });

    test('アロー関数（ブロック本体）', () => {
      const ast = parse('const f = (x) => { return x; };');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.body.type).toBe('BlockStatement');
      expect(fn.expression).toBe(false);
    });

    test('アロー関数（引数なし）', () => {
      const ast = parse('const f = () => 42;');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.params.length).toBe(0);
    });

    test('レスト引数', () => {
      const ast = parse('function f(a, ...rest) {}');
      const fn = ast.body[0];
      expect(fn.params[1].type).toBe('RestElement');
    });

    test('デフォルト引数', () => {
      const ast = parse('function f(x = 0) {}');
      expect(ast.body[0].params[0].type).toBe('AssignmentPattern');
    });
  });

  // ── 制御フロー ────────────────────────────────────────────────────────────────
  describe('制御フロー', () => {
    test('if 文', () => {
      const ast = parse('if (x > 0) { return 1; }');
      const stmt = ast.body[0];
      expect(stmt.type).toBe('IfStatement');
      expect(stmt.alternate).toBeNull();
    });

    test('if-else 文', () => {
      const ast = parse('if (x) { } else { }');
      expect(ast.body[0].alternate).not.toBeNull();
    });

    test('while 文', () => {
      const ast = parse('while (x > 0) { x--; }');
      expect(ast.body[0].type).toBe('WhileStatement');
    });

    test('for 文', () => {
      const ast = parse('for (let i = 0; i < 10; i++) {}');
      expect(ast.body[0].type).toBe('ForStatement');
    });

    test('for...of 文', () => {
      const ast = parse('for (const x of arr) {}');
      expect(ast.body[0].type).toBe('ForOfStatement');
    });
  });

  // ── クラス ────────────────────────────────────────────────────────────────────
  describe('クラス', () => {
    test('クラス宣言', () => {
      const ast = parse('class Foo { constructor(x) { this.x = x; } }');
      const cls = ast.body[0];
      expect(cls.type).toBe('ClassDeclaration');
      expect(cls.id.name).toBe('Foo');
    });

    test('extends', () => {
      const ast = parse('class Bar extends Foo {}');
      expect(ast.body[0].superClass.name).toBe('Foo');
    });
  });

  // ── loc 情報 ──────────────────────────────────────────────────────────────────
  describe('loc 情報', () => {
    test('ノードに loc が付く', () => {
      const ast = parse('let x = 1;');
      expect(ast.body[0].loc).toBeDefined();
      expect(ast.body[0].loc.line).toBe(1);
    });

    test('複数行の loc', () => {
      const ast = parse('let x = 1;\nlet y = 2;');
      expect(ast.body[1].loc.line).toBe(2);
    });
  });

  // ── オブジェクト・配列 ────────────────────────────────────────────────────────
  describe('オブジェクト・配列', () => {
    test('オブジェクトリテラル', () => {
      const ast = parse('({ a: 1, b: 2 });');
      const obj = ast.body[0].expression;
      expect(obj.type).toBe('ObjectExpression');
      expect(obj.properties.length).toBe(2);
    });

    test('配列リテラル', () => {
      const ast = parse('[1, 2, 3];');
      const arr = ast.body[0].expression;
      expect(arr.type).toBe('ArrayExpression');
      expect(arr.elements.length).toBe(3);
    });

    test('スプレッド', () => {
      const ast = parse('[...a, ...b];');
      expect(ast.body[0].expression.elements[0].type).toBe('SpreadElement');
    });
  });

  // ── エラー ────────────────────────────────────────────────────────────────────
  describe('エラー処理', () => {
    test('不正な構文', () => {
      expect(() => parse('let ;')).toThrow(ParseError);
    });
  });

  // ── async/await ──────────────────────────────────────────────────────────────
  describe('async/await', () => {
    test('async function 宣言をパースする', () => {
      const ast = parse('async function f() { return 1; }');
      expect(ast.body[0].type).toBe('FunctionDeclaration');
      expect(ast.body[0].async).toBe(true);
      expect(ast.body[0].id.name).toBe('f');
    });

    test('async 関数式をパースする', () => {
      const ast = parse('const f = async function() { return 1; };');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.type).toBe('FunctionExpression');
      expect(fn.async).toBe(true);
    });

    test('async アロー関数（単一引数）をパースする', () => {
      const ast = parse('const f = async x => x + 1;');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.type).toBe('ArrowFunctionExpression');
      expect(fn.async).toBe(true);
      expect(fn.params[0].name).toBe('x');
    });

    test('async アロー関数（括弧あり複数引数）をパースする', () => {
      const ast = parse('const f = async (x, y) => x + y;');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.async).toBe(true);
      expect(fn.params.length).toBe(2);
    });

    test('async アロー関数（引数なし）をパースする', () => {
      const ast = parse('const f = async () => 42;');
      const fn = ast.body[0].declarations[0].init;
      expect(fn.async).toBe(true);
      expect(fn.params.length).toBe(0);
    });

    test('await 式を AwaitExpression ノードとしてパースする', () => {
      const ast = parse('async function f() { await somePromise; }');
      const body = ast.body[0].body.body;
      expect(body[0].expression.type).toBe('AwaitExpression');
      expect(body[0].expression.argument.name).toBe('somePromise');
    });

    test('await 式（代入）をパースする', () => {
      const ast = parse('async function f() { const x = await Promise.resolve(1); }');
      const decl = ast.body[0].body.body[0].declarations[0];
      expect(decl.init.type).toBe('AwaitExpression');
    });

    test('async クラスメソッドをパースする', () => {
      const ast = parse('class C { async method() { return 1; } }');
      const method = ast.body[0].body.body[0];
      expect(method.value.async).toBe(true);
      expect(method.key.name).toBe('method');
    });
  });
});

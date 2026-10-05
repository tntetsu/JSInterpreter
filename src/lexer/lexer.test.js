import { Lexer, TokenType, LexError } from './lexer.js';

function lex(src) {
  return new Lexer(src).tokenize();
}

function types(src) {
  return lex(src).map(t => t.type);
}

function lexemes(src) {
  return lex(src).map(t => t.lexeme);
}

describe('Lexer', () => {
  // ── 数値 ──────────────────────────────────────────────────────────────────────
  describe('数値リテラル', () => {
    test('整数', () => {
      const [tok] = lex('42');
      expect(tok.type).toBe(TokenType.NUMBER);
      expect(tok.lexeme).toBe('42');
    });

    test('浮動小数点', () => {
      const [tok] = lex('3.14');
      expect(tok.type).toBe(TokenType.NUMBER);
      expect(tok.lexeme).toBe('3.14');
    });

    test('16進数', () => {
      const [tok] = lex('0xFF');
      expect(tok.type).toBe(TokenType.NUMBER);
      expect(Number(tok.lexeme)).toBe(255);
    });

    test('2進数', () => {
      const [tok] = lex('0b1010');
      expect(Number(tok.lexeme)).toBe(10);
    });

    test('8進数', () => {
      const [tok] = lex('0o17');
      expect(Number(tok.lexeme)).toBe(15);
    });

    test('0 始まりの数値（010・08）は strict モードと同じく構文エラー', () => {
      expect(() => lex('010')).toThrow(/\[Lexer\] 1:1: 0 で始まる8進数リテラル/);
      expect(() => lex('x = 08')).toThrow(/\[Lexer\] 1:5: 0 で始まる10進数リテラル/);
      expect(Number(lex('0')[0].lexeme)).toBe(0);
      expect(Number(lex('0.5')[0].lexeme)).toBe(0.5);
    });

    test('16進数・8進数・2進数の数値セパレーター', () => {
      expect(Number(lex('0x1f_ff')[0].lexeme)).toBe(0x1fff);
      expect(Number(lex('0o1_7')[0].lexeme)).toBe(15);
      expect(Number(lex('0b1010_1010')[0].lexeme)).toBe(170);
    });

    test('接頭辞の後に数字がない・不正な数字は構文エラー', () => {
      expect(() => lex('0x')).toThrow(/不正な数値リテラル/);
      expect(() => lex('0o9')).toThrow(/不正な数値リテラル/);
      expect(() => lex('0b12')).toThrow(/不正な数値リテラル/);
    });

    test('先頭が小数点の数値（.5）', () => {
      expect(Number(lex('.5')[0].lexeme)).toBe(0.5);
      expect(Number(lex('.5e2')[0].lexeme)).toBe(50);
      const toks = lex('a ? .5 : 1');
      expect(toks[1].type).toBe(TokenType.QUESTION);
      expect(Number(toks[2].lexeme)).toBe(0.5);
      expect(lex('a.b')[1].type).toBe(TokenType.DOT);
    });

    test('8進数エスケープ（\\01・\\7）は構文エラー、\\0 は使える', () => {
      expect(() => lex("'\\01'")).toThrow(/\[Lexer\] 1:2: 8進数エスケープシーケンス/);
      expect(() => lex("'\\7'")).toThrow(/8進数エスケープシーケンス/);
      expect(lex("'a\\0b'")[0].lexeme).toBe('a\0b');
    });

    test('数値セパレーター', () => {
      const [tok] = lex('1_000_000');
      expect(Number(tok.lexeme)).toBe(1000000);
    });

    test('指数表記', () => {
      const [tok] = lex('1e3');
      expect(Number(tok.lexeme)).toBe(1000);
    });
  });

  // ── 文字列 ────────────────────────────────────────────────────────────────────
  describe('文字列リテラル', () => {
    test('ダブルクォート', () => {
      const [tok] = lex('"hello"');
      expect(tok.type).toBe(TokenType.STRING);
      expect(tok.lexeme).toBe('hello');
    });

    test('シングルクォート', () => {
      const [tok] = lex("'world'");
      expect(tok.type).toBe(TokenType.STRING);
      expect(tok.lexeme).toBe('world');
    });

    test('エスケープシーケンス', () => {
      const [tok] = lex('"a\\nb\\tc"');
      expect(tok.lexeme).toBe('a\nb\tc');
    });

    test('unicode エスケープ', () => {
      const [tok] = lex('"\\u0041"');
      expect(tok.lexeme).toBe('A');
    });

    test('閉じていない文字列はエラー', () => {
      expect(() => lex('"hello')).toThrow(LexError);
    });
  });

  // ── テンプレートリテラル ──────────────────────────────────────────────────────
  describe('テンプレートリテラル', () => {
    test('補間なし', () => {
      const tokens = lex('`hello`');
      expect(tokens[0].type).toBe(TokenType.TEMPLATE_NO_SUB);
      expect(tokens[0].lexeme).toBe('hello');
    });

    test('エスケープシーケンス', () => {
      const tokens = lex('`a\\nb`');
      expect(tokens[0].lexeme).toBe('a\nb');
    });

    test('補間あり', () => {
      // `hello ${name}!`
      const tokens = lex('`hello ${name}!`');
      expect(tokens[0].type).toBe(TokenType.TEMPLATE_HEAD);
      expect(tokens[0].lexeme).toBe('hello ');
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].lexeme).toBe('name');
      expect(tokens[2].type).toBe(TokenType.TEMPLATE_TAIL);
      expect(tokens[2].lexeme).toBe('!');
    });

    test('複数補間', () => {
      const tokens = lex('`${a} + ${b}`');
      expect(tokens[0].type).toBe(TokenType.TEMPLATE_HEAD);
      expect(tokens[0].lexeme).toBe('');
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER); // a
      expect(tokens[2].type).toBe(TokenType.TEMPLATE_MIDDLE);
      expect(tokens[2].lexeme).toBe(' + ');
      expect(tokens[3].type).toBe(TokenType.IDENTIFIER); // b
      expect(tokens[4].type).toBe(TokenType.TEMPLATE_TAIL);
      expect(tokens[4].lexeme).toBe('');
    });

    test('補間内にオブジェクトリテラル', () => {
      const tokens = lex('`${{}}`');
      // TEMPLATE_HEAD, LBRACE, RBRACE, TEMPLATE_TAIL
      expect(tokens[0].type).toBe(TokenType.TEMPLATE_HEAD);
      expect(tokens[1].type).toBe(TokenType.LBRACE);
      expect(tokens[2].type).toBe(TokenType.RBRACE);
      expect(tokens[3].type).toBe(TokenType.TEMPLATE_TAIL);
    });
  });

  // ── キーワード ────────────────────────────────────────────────────────────────
  describe('キーワード', () => {
    test.each([
      ['let', TokenType.LET],
      ['const', TokenType.CONST],
      ['var', TokenType.VAR],
      ['function', TokenType.FUNCTION],
      ['return', TokenType.RETURN],
      ['if', TokenType.IF],
      ['else', TokenType.ELSE],
      ['while', TokenType.WHILE],
      ['for', TokenType.FOR],
      ['class', TokenType.CLASS],
      ['true', TokenType.TRUE],
      ['false', TokenType.FALSE],
      ['null', TokenType.NULL],
    ])('%s は %s', (kw, ty) => {
      expect(lex(kw)[0].type).toBe(ty);
    });
  });

  // ── 演算子 ────────────────────────────────────────────────────────────────────
  describe('演算子', () => {
    test.each([
      ['===', TokenType.EQ_EQ_EQ],
      ['!==', TokenType.BANG_EQ_EQ],
      ['=>', TokenType.ARROW],
      ['...', TokenType.DOT_DOT_DOT],
      ['??', TokenType.QUESTION_QUESTION],
      ['?.', TokenType.QUESTION_DOT],
      ['**', TokenType.STAR_STAR],
      ['&&=', TokenType.AND_AND_EQ],
      ['||=', TokenType.OR_OR_EQ],
    ])('%s', (src, ty) => {
      expect(lex(src)[0].type).toBe(ty);
    });
  });

  // ── コメント ──────────────────────────────────────────────────────────────────
  describe('コメント', () => {
    test('行コメントはスキップ', () => {
      const toks = lex('1 // comment\n2');
      expect(toks.map(t => t.type)).toEqual([TokenType.NUMBER, TokenType.NUMBER, TokenType.EOF]);
    });

    test('ブロックコメントはスキップ', () => {
      const toks = lex('1 /* a\nb */ 2');
      expect(toks.map(t => t.type)).toEqual([TokenType.NUMBER, TokenType.NUMBER, TokenType.EOF]);
    });
  });

  // ── 行番号・列番号 ────────────────────────────────────────────────────────────
  describe('位置情報', () => {
    test('行番号', () => {
      const toks = lex('1\n2');
      expect(toks[0].line).toBe(1);
      expect(toks[1].line).toBe(2);
    });

    test('列番号', () => {
      const toks = lex('  42');
      expect(toks[0].column).toBe(3);
    });

    test('wasNewlineBefore', () => {
      const toks = lex('a\nb');
      expect(toks[0].wasNewlineBefore).toBe(false);
      expect(toks[1].wasNewlineBefore).toBe(true);
    });
  });

  // ── エラー ────────────────────────────────────────────────────────────────────
  describe('エラー処理', () => {
    test('不明な文字', () => {
      expect(() => lex('@')).toThrow(LexError);
    });
  });
});

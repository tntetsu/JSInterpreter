'use strict';

const { Lexer, TokenType } = require('../lexer/lexer');

// ─── エラー ────────────────────────────────────────────────────────────────────

class ParseError extends Error {
  constructor(message, line, column) {
    super(`[Parser] ${line}:${column}: ${message}`);
    this.name = 'ParseError';
    this.line = line;
    this.column = column;
  }
}

// ─── Parser ────────────────────────────────────────────────────────────────────

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
  }

  // ─── ユーティリティ ──────────────────────────────────────────────────────────

  peek()     { return this.tokens[this.current]; }
  previous() { return this.tokens[this.current - 1]; }
  isAtEnd()  { return this.peek().type === TokenType.EOF; }

  check(type) {
    return !this.isAtEnd() && this.peek().type === type;
  }

  checkAny(...types) {
    return types.some(t => this.check(t));
  }

  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  match(...types) {
    for (const t of types) {
      if (this.check(t)) { this.advance(); return true; }
    }
    return false;
  }

  consume(type, msg) {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    throw new ParseError(msg || `'${type}' を期待しましたが '${tok.lexeme}' がありました`, tok.line, tok.column);
  }

  // セミコロン消費（ASI 対応）
  consumeSemicolon() {
    if (this.match(TokenType.SEMICOLON)) return;
    const cur = this.peek();
    if (cur.wasNewlineBefore || cur.type === TokenType.RBRACE || cur.type === TokenType.EOF) return;
    throw new ParseError(`';' を期待しましたが '${cur.lexeme}' がありました`, cur.line, cur.column);
  }

  loc(token) {
    return { line: token.line, column: token.column };
  }

  // 現在位置の loc（次のトークン）
  currentLoc() { return this.loc(this.peek()); }

  // ─── トップレベル ────────────────────────────────────────────────────────────

  parse() {
    const startLoc = this.currentLoc();
    const body = [];
    while (!this.isAtEnd()) {
      body.push(this.parseStatement());
    }
    return { type: 'Program', body, loc: startLoc };
  }

  // ─── 文（Statement）────────────────────────────────────────────────────────

  parseStatement() {
    const tok = this.peek();

    if (this.match(TokenType.LET, TokenType.CONST, TokenType.VAR)) {
      return this.parseVariableDeclaration(this.previous());
    }
    if (this.match(TokenType.FUNCTION)) {
      return this.parseFunctionDeclaration(this.previous());
    }
    if (this.match(TokenType.CLASS)) {
      return this.parseClassDeclaration(this.previous());
    }
    if (this.match(TokenType.RETURN)) {
      return this.parseReturn(this.previous());
    }
    if (this.match(TokenType.IF)) {
      return this.parseIf(this.previous());
    }
    if (this.match(TokenType.WHILE)) {
      return this.parseWhile(this.previous());
    }
    if (this.match(TokenType.DO)) {
      return this.parseDoWhile(this.previous());
    }
    if (this.match(TokenType.FOR)) {
      return this.parseFor(this.previous());
    }
    if (this.match(TokenType.BREAK)) {
      const l = this.loc(this.previous());
      this.consumeSemicolon();
      return { type: 'BreakStatement', loc: l };
    }
    if (this.match(TokenType.CONTINUE)) {
      const l = this.loc(this.previous());
      this.consumeSemicolon();
      return { type: 'ContinueStatement', loc: l };
    }
    if (this.match(TokenType.THROW)) {
      return this.parseThrow(this.previous());
    }
    if (this.match(TokenType.TRY)) {
      return this.parseTry(this.previous());
    }
    if (this.match(TokenType.IMPORT)) {
      return this.parseImport(this.previous());
    }
    if (this.match(TokenType.EXPORT)) {
      return this.parseExport(this.previous());
    }
    if (this.match(TokenType.DEBUGGER)) {
      const l = this.loc(this.previous());
      this.consumeSemicolon();
      return { type: 'DebuggerStatement', loc: l };
    }
    if (this.check(TokenType.LBRACE)) {
      return this.parseBlock();
    }
    if (this.match(TokenType.SEMICOLON)) {
      return { type: 'EmptyStatement', loc: this.loc(this.previous()) };
    }

    return this.parseExpressionStatement();
  }

  parseVariableDeclaration(keyword) {
    const loc = this.loc(keyword);
    const kind = keyword.lexeme;
    const declarations = [];

    do {
      const id = this.parsePattern();
      let init = null;
      if (this.match(TokenType.EQ)) {
        init = this.parseAssignment();
      }
      declarations.push({ type: 'VariableDeclarator', id, init, loc: id.loc });
    } while (this.match(TokenType.COMMA));

    this.consumeSemicolon();
    return { type: 'VariableDeclaration', kind, declarations, loc };
  }

  parseFunctionDeclaration(funcToken) {
    const loc = this.loc(funcToken);
    const isAsync = false; // async は後で対応
    const isStar  = this.match(TokenType.STAR);
    let name = null;
    if (this.checkIdentifierName()) {
      name = this.parseIdentifierNode();
    }
    const { params, body } = this.parseFunctionParamsBody();
    return { type: 'FunctionDeclaration', id: name, params, body, generator: isStar, async: isAsync, loc };
  }

  parseClassDeclaration(classToken) {
    const loc = this.loc(classToken);
    let id = null;
    if (this.checkIdentifierName()) id = this.parseIdentifierNode();
    let superClass = null;
    if (this.match(TokenType.EXTENDS)) superClass = this.parseLeftHandSide();
    const body = this.parseClassBody();
    return { type: 'ClassDeclaration', id, superClass, body, loc };
  }

  parseReturn(token) {
    const loc = this.loc(token);
    let arg = null;
    if (!this.check(TokenType.SEMICOLON) && !this.peek().wasNewlineBefore &&
        !this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      arg = this.parseAssignment();
    }
    this.consumeSemicolon();
    return { type: 'ReturnStatement', argument: arg, loc };
  }

  parseIf(token) {
    const loc = this.loc(token);
    this.consume(TokenType.LPAREN, "'(' を期待");
    const test = this.parseExpression();
    this.consume(TokenType.RPAREN, "')' を期待");
    const consequent = this.parseStatement();
    let alternate = null;
    if (this.match(TokenType.ELSE)) {
      alternate = this.parseStatement();
    }
    return { type: 'IfStatement', test, consequent, alternate, loc };
  }

  parseWhile(token) {
    const loc = this.loc(token);
    this.consume(TokenType.LPAREN, "'(' を期待");
    const test = this.parseExpression();
    this.consume(TokenType.RPAREN, "')' を期待");
    const body = this.parseStatement();
    return { type: 'WhileStatement', test, body, loc };
  }

  parseDoWhile(token) {
    const loc = this.loc(token);
    const body = this.parseStatement();
    this.consume(TokenType.WHILE, "'while' を期待");
    this.consume(TokenType.LPAREN, "'(' を期待");
    const test = this.parseExpression();
    this.consume(TokenType.RPAREN, "')' を期待");
    this.consumeSemicolon();
    return { type: 'DoWhileStatement', body, test, loc };
  }

  parseFor(token) {
    const loc = this.loc(token);
    this.consume(TokenType.LPAREN, "'(' を期待");

    // for (let x of/in expr)
    if (this.checkAny(TokenType.LET, TokenType.CONST, TokenType.VAR)) {
      const kwTok = this.advance();
      const kind = kwTok.lexeme;
      const pat = this.parsePattern();
      if (this.match(TokenType.OF)) {
        const right = this.parseAssignment();
        this.consume(TokenType.RPAREN, "')' を期待");
        const body = this.parseStatement();
        const decl = { type: 'VariableDeclaration', kind, declarations: [{ type: 'VariableDeclarator', id: pat, init: null, loc: pat.loc }], loc: this.loc(kwTok) };
        return { type: 'ForOfStatement', left: decl, right, body, loc };
      }
      if (this.match(TokenType.IN)) {
        const right = this.parseExpression();
        this.consume(TokenType.RPAREN, "')' を期待");
        const body = this.parseStatement();
        const decl = { type: 'VariableDeclaration', kind, declarations: [{ type: 'VariableDeclarator', id: pat, init: null, loc: pat.loc }], loc: this.loc(kwTok) };
        return { type: 'ForInStatement', left: decl, right, body, loc };
      }
      // 通常の for 初期化部へ
      let init = null;
      const decls = [{ type: 'VariableDeclarator', id: pat, init: this.match(TokenType.EQ) ? this.parseAssignment() : null, loc: pat.loc }];
      while (this.match(TokenType.COMMA)) {
        const p2 = this.parsePattern();
        decls.push({ type: 'VariableDeclarator', id: p2, init: this.match(TokenType.EQ) ? this.parseAssignment() : null, loc: p2.loc });
      }
      init = { type: 'VariableDeclaration', kind, declarations: decls, loc: this.loc(kwTok) };
      this.consume(TokenType.SEMICOLON, "';' を期待");
      const test = this.check(TokenType.SEMICOLON) ? null : this.parseExpression();
      this.consume(TokenType.SEMICOLON, "';' を期待");
      const update = this.check(TokenType.RPAREN) ? null : this.parseExpression();
      this.consume(TokenType.RPAREN, "')' を期待");
      const body = this.parseStatement();
      return { type: 'ForStatement', init, test, update, body, loc };
    }

    // for (expr of/in/; ...)
    let init = null;
    if (!this.check(TokenType.SEMICOLON)) {
      init = this.parseExpression();
      if (this.match(TokenType.OF)) {
        const right = this.parseAssignment();
        this.consume(TokenType.RPAREN, "')' を期待");
        const body = this.parseStatement();
        return { type: 'ForOfStatement', left: init, right, body, loc };
      }
      if (this.match(TokenType.IN)) {
        const right = this.parseExpression();
        this.consume(TokenType.RPAREN, "')' を期待");
        const body = this.parseStatement();
        return { type: 'ForInStatement', left: init, right, body, loc };
      }
    }
    this.consume(TokenType.SEMICOLON, "';' を期待");
    const test = this.check(TokenType.SEMICOLON) ? null : this.parseExpression();
    this.consume(TokenType.SEMICOLON, "';' を期待");
    const update = this.check(TokenType.RPAREN) ? null : this.parseExpression();
    this.consume(TokenType.RPAREN, "')' を期待");
    const body = this.parseStatement();
    return { type: 'ForStatement', init, test, update, body, loc };
  }

  parseThrow(token) {
    const loc = this.loc(token);
    if (this.peek().wasNewlineBefore) throw new ParseError('throw 直後に改行は使えません', token.line, token.column);
    const arg = this.parseAssignment();
    this.consumeSemicolon();
    return { type: 'ThrowStatement', argument: arg, loc };
  }

  parseTry(token) {
    const loc = this.loc(token);
    const block = this.parseBlock();
    let handler = null;
    if (this.match(TokenType.CATCH)) {
      const catchLoc = this.loc(this.previous());
      let param = null;
      if (this.match(TokenType.LPAREN)) {
        param = this.parsePattern();
        this.consume(TokenType.RPAREN, "')' を期待");
      }
      const catchBody = this.parseBlock();
      handler = { type: 'CatchClause', param, body: catchBody, loc: catchLoc };
    }
    let finalizer = null;
    if (this.match(TokenType.FINALLY)) {
      finalizer = this.parseBlock();
    }
    if (!handler && !finalizer) throw new ParseError('catch か finally が必要です', token.line, token.column);
    return { type: 'TryStatement', block, handler, finalizer, loc };
  }

  parseImport(token) {
    // 静的解析のみ：残り行を読み飛ばす
    const loc = this.loc(token);
    while (!this.isAtEnd() && !this.check(TokenType.SEMICOLON) && !this.peek().wasNewlineBefore) this.advance();
    this.match(TokenType.SEMICOLON);
    return { type: 'ImportDeclaration', loc };
  }

  parseExport(token) {
    const loc = this.loc(token);
    if (this.match(TokenType.DEFAULT)) {
      const decl = this.parseStatement();
      return { type: 'ExportDefaultDeclaration', declaration: decl, loc };
    }
    const decl = this.parseStatement();
    return { type: 'ExportNamedDeclaration', declaration: decl, loc };
  }

  parseBlock() {
    const brace = this.consume(TokenType.LBRACE, "'{' を期待");
    const loc = this.loc(brace);
    const body = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      body.push(this.parseStatement());
    }
    this.consume(TokenType.RBRACE, "'}' を期待");
    return { type: 'BlockStatement', body, loc };
  }

  parseExpressionStatement() {
    const loc = this.currentLoc();
    const expr = this.parseExpression();
    this.consumeSemicolon();
    return { type: 'ExpressionStatement', expression: expr, loc };
  }

  // ─── クラス本体 ──────────────────────────────────────────────────────────────

  parseClassBody() {
    const brace = this.consume(TokenType.LBRACE, "'{' を期待");
    const loc = this.loc(brace);
    const body = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      body.push(this.parseClassMember());
    }
    this.consume(TokenType.RBRACE, "'}' を期待");
    return { type: 'ClassBody', body, loc };
  }

  parseClassMember() {
    const loc = this.currentLoc();
    let isStatic = false;
    if (this.check(TokenType.STATIC)) {
      const next = this.tokens[this.current + 1];
      if (next && next.type !== TokenType.LPAREN) {
        this.advance();
        isStatic = true;
      }
    }

    // constructor / method / getter / setter
    let kind = 'method';
    if (this.checkLexeme('get') && this.tokens[this.current + 1]?.type !== TokenType.LPAREN) {
      this.advance(); kind = 'get';
    } else if (this.checkLexeme('set') && this.tokens[this.current + 1]?.type !== TokenType.LPAREN) {
      this.advance(); kind = 'set';
    }

    const isStar = this.match(TokenType.STAR);
    const computed = this.match(TokenType.LBRACKET);
    let key;
    if (computed) {
      key = this.parseAssignment();
      this.consume(TokenType.RBRACKET, "']' を期待");
    } else {
      key = this.parsePropertyKey();
    }
    if (!computed && key.type === 'Identifier' && key.name === 'constructor') kind = 'constructor';

    const { params, body } = this.parseFunctionParamsBody();
    return { type: 'MethodDefinition', key, value: { type: 'FunctionExpression', params, body, generator: isStar, async: false, loc }, kind, static: isStatic, computed, loc };
  }

  // ─── パターン（分割代入・パラメーター）──────────────────────────────────────

  parsePattern() {
    if (this.match(TokenType.LBRACE)) return this.parseObjectPattern();
    if (this.match(TokenType.LBRACKET)) return this.parseArrayPattern();
    return this.parseIdentifierNode();
  }

  parseObjectPattern() {
    const loc = this.loc(this.previous());
    const props = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      if (this.match(TokenType.DOT_DOT_DOT)) {
        const arg = this.parseIdentifierNode();
        props.push({ type: 'RestElement', argument: arg, loc: arg.loc });
        break;
      }
      const key = this.parsePropertyKey();
      let value = key;
      if (this.match(TokenType.COLON)) value = this.parsePattern();
      let defaultVal = null;
      if (this.match(TokenType.EQ)) defaultVal = this.parseAssignment();
      const node = defaultVal
        ? { type: 'AssignmentPattern', left: value, right: defaultVal, loc: value.loc }
        : value;
      props.push({ type: 'ObjectProperty', key, value: node, shorthand: key === value, loc: key.loc });
      if (!this.check(TokenType.RBRACE)) this.consume(TokenType.COMMA, "',' を期待");
    }
    this.consume(TokenType.RBRACE, "'}' を期待");
    return { type: 'ObjectPattern', properties: props, loc };
  }

  parseArrayPattern() {
    const loc = this.loc(this.previous());
    const elems = [];
    while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
      if (this.match(TokenType.COMMA)) { elems.push(null); continue; }
      if (this.match(TokenType.DOT_DOT_DOT)) {
        const arg = this.parsePattern();
        elems.push({ type: 'RestElement', argument: arg, loc: arg.loc });
        break;
      }
      const elem = this.parsePattern();
      if (this.match(TokenType.EQ)) {
        const def = this.parseAssignment();
        elems.push({ type: 'AssignmentPattern', left: elem, right: def, loc: elem.loc });
      } else {
        elems.push(elem);
      }
      if (!this.check(TokenType.RBRACKET)) this.consume(TokenType.COMMA, "',' を期待");
    }
    this.consume(TokenType.RBRACKET, "']' を期待");
    return { type: 'ArrayPattern', elements: elems, loc };
  }

  // ─── 関数パラメーター・本体 ──────────────────────────────────────────────────

  parseFunctionParamsBody() {
    this.consume(TokenType.LPAREN, "'(' を期待");
    const params = [];
    while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
      if (this.match(TokenType.DOT_DOT_DOT)) {
        const arg = this.parsePattern();
        params.push({ type: 'RestElement', argument: arg, loc: arg.loc });
        break;
      }
      const p = this.parsePattern();
      if (this.match(TokenType.EQ)) {
        const def = this.parseAssignment();
        params.push({ type: 'AssignmentPattern', left: p, right: def, loc: p.loc });
      } else {
        params.push(p);
      }
      if (!this.check(TokenType.RPAREN)) this.consume(TokenType.COMMA, "',' を期待");
    }
    this.consume(TokenType.RPAREN, "')' を期待");
    const body = this.parseBlock();
    return { params, body };
  }

  // ─── 式（Expression）───────────────────────────────────────────────────────

  parseExpression() {
    const loc = this.currentLoc();
    const expr = this.parseAssignment();
    if (this.match(TokenType.COMMA)) {
      const exprs = [expr];
      do { exprs.push(this.parseAssignment()); } while (this.match(TokenType.COMMA));
      return { type: 'SequenceExpression', expressions: exprs, loc };
    }
    return expr;
  }

  parseAssignment() {
    // async アロー関数チェック
    if (this.check(TokenType.ASYNC) && this.tokens[this.current + 1]?.type === TokenType.IDENTIFIER) {
      const saved = this.current;
      this.advance(); // async
      const paramTok = this.advance(); // identifier
      if (this.check(TokenType.ARROW)) {
        this.advance(); // =>
        const param = { type: 'Identifier', name: paramTok.lexeme, loc: this.loc(paramTok) };
        const body = this.check(TokenType.LBRACE) ? this.parseBlock() : this.parseAssignment();
        return { type: 'ArrowFunctionExpression', params: [param], body, expression: body.type !== 'BlockStatement', async: true, loc: this.loc(this.tokens[saved]) };
      }
      this.current = saved;
    }

    const loc = this.currentLoc();
    const expr = this.parseConditional();

    const assignOps = [
      TokenType.EQ, TokenType.PLUS_EQ, TokenType.MINUS_EQ,
      TokenType.STAR_EQ, TokenType.SLASH_EQ, TokenType.PERCENT_EQ,
      TokenType.STAR_STAR_EQ, TokenType.AND_AND_EQ, TokenType.OR_OR_EQ,
      TokenType.QUESTION_QUESTION_EQ, TokenType.AMP_EQ, TokenType.PIPE_EQ,
      TokenType.CARET_EQ, TokenType.LT_LT_EQ, TokenType.GT_GT_EQ, TokenType.GT_GT_GT_EQ,
    ];

    for (const op of assignOps) {
      if (this.match(op)) {
        const operator = this.previous().lexeme; // 右辺パース前に演算子を保存
        const right = this.parseAssignment();
        return { type: 'AssignmentExpression', operator, left: expr, right, loc };
      }
    }

    return expr;
  }

  parseConditional() {
    const loc = this.currentLoc();
    const expr = this.parseNullishCoalescing();
    if (this.match(TokenType.QUESTION)) {
      const consequent = this.parseAssignment();
      this.consume(TokenType.COLON, "':' を期待");
      const alternate = this.parseAssignment();
      return { type: 'ConditionalExpression', test: expr, consequent, alternate, loc };
    }
    return expr;
  }

  parseNullishCoalescing() {
    return this.parseBinaryLeft(
      () => this.parseLogicalOr(),
      [TokenType.QUESTION_QUESTION],
      'LogicalExpression'
    );
  }

  parseLogicalOr() {
    return this.parseBinaryLeft(
      () => this.parseLogicalAnd(),
      [TokenType.OR_OR],
      'LogicalExpression'
    );
  }

  parseLogicalAnd() {
    return this.parseBinaryLeft(
      () => this.parseBitwiseOr(),
      [TokenType.AND_AND],
      'LogicalExpression'
    );
  }

  parseBitwiseOr() {
    return this.parseBinaryLeft(() => this.parseBitwiseXor(), [TokenType.PIPE]);
  }

  parseBitwiseXor() {
    return this.parseBinaryLeft(() => this.parseBitwiseAnd(), [TokenType.CARET]);
  }

  parseBitwiseAnd() {
    return this.parseBinaryLeft(() => this.parseEquality(), [TokenType.AMP]);
  }

  parseEquality() {
    return this.parseBinaryLeft(
      () => this.parseRelational(),
      [TokenType.EQ_EQ, TokenType.BANG_EQ, TokenType.EQ_EQ_EQ, TokenType.BANG_EQ_EQ]
    );
  }

  parseRelational() {
    return this.parseBinaryLeft(
      () => this.parseShift(),
      [TokenType.LT, TokenType.GT, TokenType.LT_EQ, TokenType.GT_EQ, TokenType.INSTANCEOF, TokenType.IN]
    );
  }

  parseShift() {
    return this.parseBinaryLeft(
      () => this.parseAdditive(),
      [TokenType.LT_LT, TokenType.GT_GT, TokenType.GT_GT_GT]
    );
  }

  parseAdditive() {
    return this.parseBinaryLeft(
      () => this.parseMultiplicative(),
      [TokenType.PLUS, TokenType.MINUS]
    );
  }

  parseMultiplicative() {
    return this.parseBinaryLeft(
      () => this.parseExponentiation(),
      [TokenType.STAR, TokenType.SLASH, TokenType.PERCENT]
    );
  }

  parseExponentiation() {
    const loc = this.currentLoc();
    const left = this.parseUnary();
    if (this.match(TokenType.STAR_STAR)) {
      const right = this.parseExponentiation(); // 右結合
      return { type: 'BinaryExpression', operator: '**', left, right, loc };
    }
    return left;
  }

  parseBinaryLeft(next, ops, nodeType = 'BinaryExpression') {
    const loc = this.currentLoc();
    let left = next();
    while (this.match(...ops)) {
      const op = this.previous().lexeme;
      const right = next();
      left = { type: nodeType, operator: op, left, right, loc };
    }
    return left;
  }

  parseUnary() {
    const tok = this.peek();
    const unaryOps = [TokenType.BANG, TokenType.MINUS, TokenType.PLUS, TokenType.TILDE];
    const wordOps  = [TokenType.TYPEOF, TokenType.VOID, TokenType.DELETE, TokenType.AWAIT];

    if (this.match(...unaryOps, ...wordOps)) {
      const op = this.previous().lexeme;
      const arg = this.parseUnary();
      return { type: 'UnaryExpression', operator: op, prefix: true, argument: arg, loc: this.loc(tok) };
    }

    // 前置 ++/--
    if (this.match(TokenType.PLUS_PLUS, TokenType.MINUS_MINUS)) {
      const op = this.previous().lexeme;
      const arg = this.parseUnary();
      return { type: 'UpdateExpression', operator: op, prefix: true, argument: arg, loc: this.loc(tok) };
    }

    return this.parsePostfix();
  }

  parsePostfix() {
    const loc = this.currentLoc();
    let expr = this.parseCallMember();

    if (!this.peek().wasNewlineBefore) {
      if (this.match(TokenType.PLUS_PLUS, TokenType.MINUS_MINUS)) {
        return { type: 'UpdateExpression', operator: this.previous().lexeme, prefix: false, argument: expr, loc };
      }
    }
    return expr;
  }

  parseCallMember() {
    const loc = this.currentLoc();
    let expr = this.parseNew();

    while (true) {
      if (this.match(TokenType.LPAREN)) {
        const { args, spread } = this.parseArguments();
        expr = { type: 'CallExpression', callee: expr, arguments: args, loc };
      } else if (this.match(TokenType.DOT)) {
        const prop = this.parseIdentifierOrKeyword();
        expr = { type: 'MemberExpression', object: expr, property: prop, computed: false, loc };
      } else if (this.match(TokenType.LBRACKET)) {
        const prop = this.parseExpression();
        this.consume(TokenType.RBRACKET, "']' を期待");
        expr = { type: 'MemberExpression', object: expr, property: prop, computed: true, loc };
      } else if (this.match(TokenType.QUESTION_DOT)) {
        if (this.check(TokenType.LPAREN)) {
          this.advance();
          const { args } = this.parseArguments();
          expr = { type: 'OptionalCallExpression', callee: expr, arguments: args, loc };
        } else if (this.match(TokenType.LBRACKET)) {
          const prop = this.parseExpression();
          this.consume(TokenType.RBRACKET, "']' を期待");
          expr = { type: 'OptionalMemberExpression', object: expr, property: prop, computed: true, loc };
        } else {
          const prop = this.parseIdentifierOrKeyword();
          expr = { type: 'OptionalMemberExpression', object: expr, property: prop, computed: false, loc };
        }
      } else {
        break;
      }
    }

    return expr;
  }

  parseArguments() {
    const args = [];
    while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
      if (this.match(TokenType.DOT_DOT_DOT)) {
        const arg = this.parseAssignment();
        args.push({ type: 'SpreadElement', argument: arg, loc: arg.loc });
      } else {
        args.push(this.parseAssignment());
      }
      if (!this.check(TokenType.RPAREN)) this.consume(TokenType.COMMA, "',' を期待");
    }
    this.consume(TokenType.RPAREN, "')' を期待");
    return { args };
  }

  parseNew() {
    const loc = this.currentLoc();
    if (this.match(TokenType.NEW)) {
      const callee = this.parseNew(); // new new Foo() を正しく処理
      let args = [];
      if (this.match(TokenType.LPAREN)) {
        ({ args } = this.parseArguments());
      }
      return { type: 'NewExpression', callee, arguments: args, loc };
    }
    return this.parsePrimary();
  }

  parseLeftHandSide() {
    return this.parseCallMember();
  }

  // ─── プライマリ式 ────────────────────────────────────────────────────────────

  parsePrimary() {
    const tok = this.peek();
    const loc = this.loc(tok);

    if (this.match(TokenType.NUMBER)) {
      return { type: 'Literal', value: Number(this.previous().lexeme), raw: this.previous().lexeme, loc };
    }
    if (this.match(TokenType.STRING)) {
      return { type: 'Literal', value: this.previous().lexeme, raw: JSON.stringify(this.previous().lexeme), loc };
    }
    if (this.match(TokenType.TRUE))  return { type: 'Literal', value: true,  loc };
    if (this.match(TokenType.FALSE)) return { type: 'Literal', value: false, loc };
    if (this.match(TokenType.NULL))  return { type: 'Literal', value: null,  loc };

    if (this.match(TokenType.TEMPLATE_NO_SUB)) {
      return { type: 'TemplateLiteral', quasis: [{ type: 'TemplateElement', value: this.previous().lexeme, tail: true }], expressions: [], loc };
    }
    if (this.match(TokenType.TEMPLATE_HEAD)) {
      return this.parseTemplateLiteralTail(loc, this.previous().lexeme);
    }

    if (this.match(TokenType.THIS))  return { type: 'ThisExpression', loc };
    if (this.match(TokenType.SUPER)) return { type: 'Super', loc };

    if (this.match(TokenType.FUNCTION)) {
      return this.parseFunctionExpression(this.previous());
    }
    if (this.match(TokenType.CLASS)) {
      return this.parseClassExpression(this.previous());
    }

    if (this.check(TokenType.LBRACE)) {
      return this.parseObjectExpression();
    }
    if (this.match(TokenType.LBRACKET)) {
      return this.parseArrayExpression(this.previous());
    }

    if (this.match(TokenType.LPAREN)) {
      return this.parseParenOrArrow(this.previous());
    }

    // アロー（単一パラメーター）: x =>
    if (this.check(TokenType.IDENTIFIER) && this.tokens[this.current + 1]?.type === TokenType.ARROW) {
      const paramTok = this.advance();
      this.advance(); // =>
      const param = { type: 'Identifier', name: paramTok.lexeme, loc: this.loc(paramTok) };
      const body = this.check(TokenType.LBRACE) ? this.parseBlock() : this.parseAssignment();
      return { type: 'ArrowFunctionExpression', params: [param], body, expression: body.type !== 'BlockStatement', async: false, loc };
    }

    if (this.checkIdentifierName()) {
      return this.parseIdentifierNode();
    }

    throw new ParseError(`予期しないトークン: '${tok.lexeme}'`, tok.line, tok.column);
  }

  parseTemplateLiteralTail(loc, headStr) {
    const quasis = [{ type: 'TemplateElement', value: headStr, tail: false }];
    const expressions = [];

    while (true) {
      const expr = this.parseAssignment();
      expressions.push(expr);
      if (this.check(TokenType.TEMPLATE_MIDDLE)) {
        this.advance();
        quasis.push({ type: 'TemplateElement', value: this.previous().lexeme, tail: false });
      } else if (this.check(TokenType.TEMPLATE_TAIL)) {
        this.advance();
        quasis.push({ type: 'TemplateElement', value: this.previous().lexeme, tail: true });
        break;
      } else {
        throw new ParseError('テンプレートリテラルが閉じられていません', loc.line, loc.column);
      }
    }

    return { type: 'TemplateLiteral', quasis, expressions, loc };
  }

  parseFunctionExpression(funcToken) {
    const loc = this.loc(funcToken);
    const isStar = this.match(TokenType.STAR);
    let id = null;
    if (this.checkIdentifierName()) id = this.parseIdentifierNode();
    const { params, body } = this.parseFunctionParamsBody();
    return { type: 'FunctionExpression', id, params, body, generator: isStar, async: false, loc };
  }

  parseClassExpression(classToken) {
    const loc = this.loc(classToken);
    let id = null;
    if (this.checkIdentifierName()) id = this.parseIdentifierNode();
    let superClass = null;
    if (this.match(TokenType.EXTENDS)) superClass = this.parseLeftHandSide();
    const body = this.parseClassBody();
    return { type: 'ClassExpression', id, superClass, body, loc };
  }

  parseObjectExpression() {
    const brace = this.consume(TokenType.LBRACE, "'{' を期待");
    const loc = this.loc(brace);
    const properties = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      if (this.match(TokenType.DOT_DOT_DOT)) {
        const arg = this.parseAssignment();
        properties.push({ type: 'SpreadElement', argument: arg, loc: arg.loc });
        if (!this.check(TokenType.RBRACE)) this.consume(TokenType.COMMA, "',' を期待");
        continue;
      }

      const propLoc = this.currentLoc();
      let kind = 'init';
      let computed = false;

      // getter / setter
      if (this.checkLexeme('get') && !this.isCommaOrBrace()) {
        this.advance(); kind = 'get';
      } else if (this.checkLexeme('set') && !this.isCommaOrBrace()) {
        this.advance(); kind = 'set';
      }

      const isMethod = this.match(TokenType.STAR);
      computed = this.match(TokenType.LBRACKET);

      let key;
      if (computed) {
        key = this.parseAssignment();
        this.consume(TokenType.RBRACKET, "']' を期待");
      } else {
        key = this.parsePropertyKey();
      }

      let value;
      let shorthand = false;

      if (kind !== 'init' || isMethod || this.check(TokenType.LPAREN)) {
        // メソッド定義
        const { params, body } = this.parseFunctionParamsBody();
        value = { type: 'FunctionExpression', params, body, generator: isMethod, async: false, loc: propLoc };
      } else if (this.match(TokenType.COLON)) {
        value = this.parseAssignment();
      } else if (this.match(TokenType.EQ)) {
        // 短縮形 { x = default }
        const def = this.parseAssignment();
        value = { type: 'AssignmentPattern', left: key, right: def, loc: key.loc };
        shorthand = true;
      } else {
        // 短縮形 { x }
        shorthand = true;
        value = { ...key };
      }

      properties.push({ type: 'Property', key, value, kind, shorthand, computed, loc: propLoc });
      if (!this.check(TokenType.RBRACE)) this.consume(TokenType.COMMA, "',' を期待");
    }

    this.consume(TokenType.RBRACE, "'}' を期待");
    return { type: 'ObjectExpression', properties, loc };
  }

  isCommaOrBrace() {
    const next = this.tokens[this.current + 1];
    return next && (next.type === TokenType.COMMA || next.type === TokenType.RBRACE || next.type === TokenType.COLON);
  }

  parseArrayExpression(bracket) {
    const loc = this.loc(bracket);
    const elements = [];
    while (!this.check(TokenType.RBRACKET) && !this.isAtEnd()) {
      if (this.match(TokenType.COMMA)) { elements.push(null); continue; }
      if (this.match(TokenType.DOT_DOT_DOT)) {
        const arg = this.parseAssignment();
        elements.push({ type: 'SpreadElement', argument: arg, loc: arg.loc });
      } else {
        elements.push(this.parseAssignment());
      }
      if (!this.check(TokenType.RBRACKET)) this.consume(TokenType.COMMA, "',' を期待");
    }
    this.consume(TokenType.RBRACKET, "']' を期待");
    return { type: 'ArrayExpression', elements, loc };
  }

  // 括弧式またはアロー関数
  parseParenOrArrow(lparen) {
    const loc = this.loc(lparen);

    // 空の引数リスト: () =>
    if (this.check(TokenType.RPAREN) && this.tokens[this.current + 1]?.type === TokenType.ARROW) {
      this.advance(); this.advance(); // ) =>
      const body = this.check(TokenType.LBRACE) ? this.parseBlock() : this.parseAssignment();
      return { type: 'ArrowFunctionExpression', params: [], body, expression: body.type !== 'BlockStatement', async: false, loc };
    }

    // 引数リストを先読みしてアロー関数かどうか判定
    const saved = this.current;
    try {
      const params = this.tryParseArrowParams();
      if (this.check(TokenType.ARROW)) {
        this.advance(); // =>
        const body = this.check(TokenType.LBRACE) ? this.parseBlock() : this.parseAssignment();
        return { type: 'ArrowFunctionExpression', params, body, expression: body.type !== 'BlockStatement', async: false, loc };
      }
    } catch {}
    this.current = saved;

    // 普通の括弧式
    const expr = this.parseExpression();
    this.consume(TokenType.RPAREN, "')' を期待");
    return expr;
  }

  tryParseArrowParams() {
    const params = [];
    while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
      if (this.match(TokenType.DOT_DOT_DOT)) {
        const arg = this.parsePattern();
        params.push({ type: 'RestElement', argument: arg, loc: arg.loc });
        break;
      }
      const p = this.parsePattern();
      if (this.match(TokenType.EQ)) {
        const def = this.parseAssignment();
        params.push({ type: 'AssignmentPattern', left: p, right: def, loc: p.loc });
      } else {
        params.push(p);
      }
      if (!this.check(TokenType.RPAREN)) this.consume(TokenType.COMMA, "',' を期待");
    }
    this.consume(TokenType.RPAREN, "')' を期待");
    return params;
  }

  // ─── ヘルパー ─────────────────────────────────────────────────────────────────

  parsePropertyKey() {
    const tok = this.peek();
    if (this.match(TokenType.STRING)) {
      return { type: 'Literal', value: this.previous().lexeme, loc: this.loc(this.previous()) };
    }
    if (this.match(TokenType.NUMBER)) {
      return { type: 'Literal', value: Number(this.previous().lexeme), loc: this.loc(this.previous()) };
    }
    return this.parseIdentifierOrKeyword();
  }

  parseIdentifierNode() {
    const tok = this.consume(TokenType.IDENTIFIER, '識別子を期待');
    return { type: 'Identifier', name: tok.lexeme, loc: this.loc(tok) };
  }

  parseIdentifierOrKeyword() {
    // どのトークンでも識別子として扱う
    const tok = this.advance();
    return { type: 'Identifier', name: tok.lexeme, loc: this.loc(tok) };
  }

  checkIdentifierName() {
    return this.check(TokenType.IDENTIFIER) ||
      [TokenType.LET, TokenType.CONST, TokenType.VAR, TokenType.STATIC,
       TokenType.ASYNC, TokenType.OF, TokenType.FROM, TokenType.GET, TokenType.SET,
       TokenType.YIELD, TokenType.AWAIT].includes(this.peek().type);
  }

  checkLexeme(str) {
    return this.peek().lexeme === str;
  }
}

// ─── parse ヘルパー ────────────────────────────────────────────────────────────

function parse(source) {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

module.exports = { Parser, ParseError, parse };

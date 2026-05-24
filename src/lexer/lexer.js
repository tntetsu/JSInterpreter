import { LexError } from '../errors.js';

// ─── TokenType ─────────────────────────────────────────────────────────────────

const TokenType = Object.freeze({
  // リテラル
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  TEMPLATE_NO_SUB: 'TEMPLATE_NO_SUB', // `hello`
  TEMPLATE_HEAD:   'TEMPLATE_HEAD',   // `hello ${
  TEMPLATE_MIDDLE: 'TEMPLATE_MIDDLE', // } world ${
  TEMPLATE_TAIL:   'TEMPLATE_TAIL',   // } end`
  TRUE: 'TRUE', FALSE: 'FALSE', NULL: 'NULL',

  // 識別子
  IDENTIFIER: 'IDENTIFIER',

  // キーワード
  LET: 'LET', CONST: 'CONST', VAR: 'VAR',
  FUNCTION: 'FUNCTION', RETURN: 'RETURN',
  IF: 'IF', ELSE: 'ELSE',
  WHILE: 'WHILE', DO: 'DO',
  FOR: 'FOR', OF: 'OF', IN: 'IN',
  BREAK: 'BREAK', CONTINUE: 'CONTINUE',
  NEW: 'NEW',
  CLASS: 'CLASS', EXTENDS: 'EXTENDS', SUPER: 'SUPER',
  THIS: 'THIS',
  TYPEOF: 'TYPEOF', INSTANCEOF: 'INSTANCEOF', VOID: 'VOID', DELETE: 'DELETE',
  THROW: 'THROW', TRY: 'TRY', CATCH: 'CATCH', FINALLY: 'FINALLY',
  IMPORT: 'IMPORT', EXPORT: 'EXPORT', DEFAULT: 'DEFAULT',
  STATIC: 'STATIC', ASYNC: 'ASYNC', AWAIT: 'AWAIT', YIELD: 'YIELD',
  DEBUGGER: 'DEBUGGER',

  // 算術演算子
  PLUS: 'PLUS', MINUS: 'MINUS', STAR: 'STAR', SLASH: 'SLASH', PERCENT: 'PERCENT',
  STAR_STAR: 'STAR_STAR',

  // 代入演算子
  EQ: 'EQ',
  PLUS_EQ: 'PLUS_EQ', MINUS_EQ: 'MINUS_EQ', STAR_EQ: 'STAR_EQ',
  SLASH_EQ: 'SLASH_EQ', PERCENT_EQ: 'PERCENT_EQ', STAR_STAR_EQ: 'STAR_STAR_EQ',
  AND_AND_EQ: 'AND_AND_EQ', OR_OR_EQ: 'OR_OR_EQ', QUESTION_QUESTION_EQ: 'QUESTION_QUESTION_EQ',
  AMP_EQ: 'AMP_EQ', PIPE_EQ: 'PIPE_EQ', CARET_EQ: 'CARET_EQ',
  LT_LT_EQ: 'LT_LT_EQ', GT_GT_EQ: 'GT_GT_EQ', GT_GT_GT_EQ: 'GT_GT_GT_EQ',

  // 比較・論理演算子
  EQ_EQ: 'EQ_EQ', EQ_EQ_EQ: 'EQ_EQ_EQ',
  BANG: 'BANG', BANG_EQ: 'BANG_EQ', BANG_EQ_EQ: 'BANG_EQ_EQ',
  LT: 'LT', LT_EQ: 'LT_EQ', GT: 'GT', GT_EQ: 'GT_EQ',
  AND_AND: 'AND_AND', OR_OR: 'OR_OR', QUESTION_QUESTION: 'QUESTION_QUESTION',
  PLUS_PLUS: 'PLUS_PLUS', MINUS_MINUS: 'MINUS_MINUS',

  // ビット演算子
  TILDE: 'TILDE', AMP: 'AMP', PIPE: 'PIPE', CARET: 'CARET',
  LT_LT: 'LT_LT', GT_GT: 'GT_GT', GT_GT_GT: 'GT_GT_GT',

  // その他の演算子
  ARROW: 'ARROW', DOT_DOT_DOT: 'DOT_DOT_DOT',

  // 区切り文字
  LPAREN: 'LPAREN', RPAREN: 'RPAREN',
  LBRACE: 'LBRACE', RBRACE: 'RBRACE',
  LBRACKET: 'LBRACKET', RBRACKET: 'RBRACKET',
  COMMA: 'COMMA', SEMICOLON: 'SEMICOLON', COLON: 'COLON',
  DOT: 'DOT', QUESTION: 'QUESTION', QUESTION_DOT: 'QUESTION_DOT',

  EOF: 'EOF',
});

// ─── キーワードマップ ────────────────────────────────────────────────────────────

const KEYWORDS = Object.freeze({
  let: TokenType.LET,
  const: TokenType.CONST,
  var: TokenType.VAR,
  function: TokenType.FUNCTION,
  return: TokenType.RETURN,
  if: TokenType.IF,
  else: TokenType.ELSE,
  while: TokenType.WHILE,
  do: TokenType.DO,
  for: TokenType.FOR,
  of: TokenType.OF,
  in: TokenType.IN,
  break: TokenType.BREAK,
  continue: TokenType.CONTINUE,
  new: TokenType.NEW,
  class: TokenType.CLASS,
  extends: TokenType.EXTENDS,
  super: TokenType.SUPER,
  this: TokenType.THIS,
  typeof: TokenType.TYPEOF,
  instanceof: TokenType.INSTANCEOF,
  void: TokenType.VOID,
  delete: TokenType.DELETE,
  throw: TokenType.THROW,
  try: TokenType.TRY,
  catch: TokenType.CATCH,
  finally: TokenType.FINALLY,
  import: TokenType.IMPORT,
  export: TokenType.EXPORT,
  default: TokenType.DEFAULT,
  static: TokenType.STATIC,
  async: TokenType.ASYNC,
  await: TokenType.AWAIT,
  yield: TokenType.YIELD,
  debugger: TokenType.DEBUGGER,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  null: TokenType.NULL,
});

// ─── Token ─────────────────────────────────────────────────────────────────────

class Token {
  /**
   * @param {string} type        TokenType の値
   * @param {string} lexeme      トークンの文字列値
   * @param {number} line        行番号（1 始まり）
   * @param {number} column      列番号（1 始まり）
   * @param {boolean} wasNewlineBefore  直前に改行があったか（ASI 判定用）
   * @param {number} [endColumn]  トークン末尾の列番号（1 始まり、含む）
   */
  constructor(type, lexeme, line, column, wasNewlineBefore = false, endColumn = null) {
    this.type = type;
    this.lexeme = lexeme;
    this.line = line;
    this.column = column;
    this.wasNewlineBefore = wasNewlineBefore;
    // endColumn: ソース上でのトークン末尾列（1-based, inclusive）
    this.endColumn = endColumn !== null ? endColumn : column + (lexeme.length > 0 ? lexeme.length - 1 : 0);
  }

  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.lexeme)}, ${this.line}:${this.column})`;
  }
}

// ─── Lexer ─────────────────────────────────────────────────────────────────────

class Lexer {
  constructor(source) {
    this.source = source;
    this.tokens = [];
    this.start = 0;
    this.current = 0;
    this.line = 1;
    this.lineStart = 0;
    this.hadNewline = false;        // 前のトークン以降に改行があったか
    this.templateStack = [];        // テンプレートリテラルのネスト管理
  }

  /** 1 始まりの現在の列番号 */
  get column() { return this.start - this.lineStart + 1; }

  tokenize() {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.scanToken();
    }
    const eofCol = this.current - this.lineStart + 1;
    this.tokens.push(new Token(TokenType.EOF, '', this.line, eofCol, this.hadNewline, eofCol));
    return this.tokens;
  }

  isAtEnd() { return this.current >= this.source.length; }
  peek()    { return this.isAtEnd() ? '\0' : this.source[this.current]; }
  peekNext(){ return (this.current + 1 >= this.source.length) ? '\0' : this.source[this.current + 1]; }

  advance() {
    return this.source[this.current++];
  }

  match(expected) {
    if (this.isAtEnd() || this.source[this.current] !== expected) return false;
    this.current++;
    return true;
  }

  addToken(type, value) {
    const lexeme = (value !== undefined) ? String(value) : this.source.slice(this.start, this.current);
    // ソース上の実際の長さ（エスケープ展開済み文字列でも正確な末尾位置を得る）
    const endColumn = this.column + (this.current - this.start) - 1;
    this.tokens.push(new Token(type, lexeme, this.line, this.column, this.hadNewline, endColumn));
    this.hadNewline = false;
  }

  // ─── メインスキャン ──────────────────────────────────────────────────────────

  scanToken() {
    const c = this.advance();
    switch (c) {
      // 単純な区切り文字
      case '(': this.addToken(TokenType.LPAREN); break;
      case ')': this.addToken(TokenType.RPAREN); break;
      case '[': this.addToken(TokenType.LBRACKET); break;
      case ']': this.addToken(TokenType.RBRACKET); break;
      case ',': this.addToken(TokenType.COMMA); break;
      case ';': this.addToken(TokenType.SEMICOLON); break;
      case ':': this.addToken(TokenType.COLON); break;
      case '~': this.addToken(TokenType.TILDE); break;

      case '{':
        if (this.templateStack.length > 0) {
          this.templateStack[this.templateStack.length - 1].braceDepth++;
        }
        this.addToken(TokenType.LBRACE);
        break;

      case '}':
        if (this.templateStack.length > 0) {
          const state = this.templateStack[this.templateStack.length - 1];
          if (state.braceDepth === 0) {
            // テンプレートの式 `}` → テンプレート再開
            this.templateStack.pop();
            this.scanTemplateContinuation();
            return;
          } else {
            state.braceDepth--;
          }
        }
        this.addToken(TokenType.RBRACE);
        break;

      case '^': this.addToken(this.match('=') ? TokenType.CARET_EQ : TokenType.CARET); break;

      case '|':
        if (this.match('|')) this.addToken(this.match('=') ? TokenType.OR_OR_EQ : TokenType.OR_OR);
        else                 this.addToken(this.match('=') ? TokenType.PIPE_EQ : TokenType.PIPE);
        break;

      case '&':
        if (this.match('&')) this.addToken(this.match('=') ? TokenType.AND_AND_EQ : TokenType.AND_AND);
        else                 this.addToken(this.match('=') ? TokenType.AMP_EQ : TokenType.AMP);
        break;

      case '?':
        if (this.match('?')) {
          this.addToken(this.match('=') ? TokenType.QUESTION_QUESTION_EQ : TokenType.QUESTION_QUESTION);
        } else if (this.peek() === '.' && !this.isDigit(this.peekNext())) {
          this.advance();
          this.addToken(TokenType.QUESTION_DOT);
        } else {
          this.addToken(TokenType.QUESTION);
        }
        break;

      case '.':
        if (this.peek() === '.' && this.peekNext() === '.') {
          this.advance(); this.advance();
          this.addToken(TokenType.DOT_DOT_DOT);
        } else {
          this.addToken(TokenType.DOT);
        }
        break;

      case '+':
        if      (this.match('+')) this.addToken(TokenType.PLUS_PLUS);
        else if (this.match('=')) this.addToken(TokenType.PLUS_EQ);
        else                      this.addToken(TokenType.PLUS);
        break;

      case '-':
        if      (this.match('-')) this.addToken(TokenType.MINUS_MINUS);
        else if (this.match('=')) this.addToken(TokenType.MINUS_EQ);
        else                      this.addToken(TokenType.MINUS);
        break;

      case '*':
        if (this.match('*')) {
          this.addToken(this.match('=') ? TokenType.STAR_STAR_EQ : TokenType.STAR_STAR);
        } else {
          this.addToken(this.match('=') ? TokenType.STAR_EQ : TokenType.STAR);
        }
        break;

      case '/':
        if      (this.match('/')) { this.lineComment(); }
        else if (this.match('*')) { this.blockComment(); }
        else                      { this.addToken(this.match('=') ? TokenType.SLASH_EQ : TokenType.SLASH); }
        break;

      case '%': this.addToken(this.match('=') ? TokenType.PERCENT_EQ : TokenType.PERCENT); break;

      case '=':
        if      (this.match('>')) this.addToken(TokenType.ARROW);
        else if (this.match('=')) this.addToken(this.match('=') ? TokenType.EQ_EQ_EQ : TokenType.EQ_EQ);
        else                      this.addToken(TokenType.EQ);
        break;

      case '!':
        if (this.match('=')) this.addToken(this.match('=') ? TokenType.BANG_EQ_EQ : TokenType.BANG_EQ);
        else                 this.addToken(TokenType.BANG);
        break;

      case '<':
        if (this.match('<')) this.addToken(this.match('=') ? TokenType.LT_LT_EQ : TokenType.LT_LT);
        else                 this.addToken(this.match('=') ? TokenType.LT_EQ : TokenType.LT);
        break;

      case '>':
        if (this.match('>')) {
          if (this.match('>')) this.addToken(this.match('=') ? TokenType.GT_GT_GT_EQ : TokenType.GT_GT_GT);
          else                 this.addToken(this.match('=') ? TokenType.GT_GT_EQ : TokenType.GT_GT);
        } else {
          this.addToken(this.match('=') ? TokenType.GT_EQ : TokenType.GT);
        }
        break;

      case '"':
      case "'": this.scanString(c); break;

      case '`': this.scanTemplate(); break;

      // 空白
      case '\n':
        this.line++;
        this.lineStart = this.current;
        this.hadNewline = true;
        break;
      case '\r': if (this.peek() === '\n') { this.advance(); } this.line++; this.lineStart = this.current; this.hadNewline = true; break;
      case ' ':
      case '\t':
        break;

      default:
        if      (this.isDigit(c)) { this.current--; this.start = this.current; this.current++; this.scanNumber(); }
        else if (this.isAlpha(c)) this.scanIdentifier();
        else throw new LexError(`予期しない文字: ${JSON.stringify(c)}`, this.line, this.column);
    }
  }

  // ─── コメント ────────────────────────────────────────────────────────────────

  lineComment() {
    while (!this.isAtEnd() && this.peek() !== '\n') this.advance();
  }

  blockComment() {
    while (!this.isAtEnd()) {
      if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance(); this.advance();
        return;
      }
      if (this.peek() === '\n') { this.line++; this.lineStart = this.current + 1; this.hadNewline = true; }
      this.advance();
    }
    throw new LexError('ブロックコメントが閉じられていません', this.line, this.column);
  }

  // ─── 文字列リテラル ──────────────────────────────────────────────────────────

  scanString(quote) {
    let str = '';
    while (!this.isAtEnd() && this.peek() !== quote) {
      if (this.peek() === '\n') throw new LexError('文字列リテラルが閉じられていません', this.line, this.column);
      str += this.readStringChar(quote);
    }
    if (this.isAtEnd()) throw new LexError('文字列リテラルが閉じられていません', this.line, this.column);
    this.advance(); // 閉じ引用符
    this.addToken(TokenType.STRING, str);
  }

  readStringChar(quote) {
    if (this.peek() !== '\\') return this.advance();
    this.advance(); // バックスラッシュ
    const esc = this.advance();
    switch (esc) {
      case 'n':  return '\n';
      case 't':  return '\t';
      case 'r':  return '\r';
      case '\\': return '\\';
      case "'":  return "'";
      case '"':  return '"';
      case '`':  return '`';
      case '0':  return '\0';
      case 'b':  return '\b';
      case 'f':  return '\f';
      case 'v':  return '\v';
      case 'u':  return this.scanUnicodeEscape();
      case 'x':  return this.scanHexEscape(2);
      default:   return esc;
    }
  }

  scanUnicodeEscape() {
    if (this.peek() === '{') {
      this.advance(); // {
      let code = '';
      while (!this.isAtEnd() && this.peek() !== '}') code += this.advance();
      if (this.isAtEnd()) throw new LexError('unicode エスケープが閉じられていません', this.line, this.column);
      this.advance(); // }
      return String.fromCodePoint(parseInt(code, 16));
    }
    return this.scanHexEscape(4);
  }

  scanHexEscape(len) {
    let code = '';
    for (let i = 0; i < len; i++) {
      if (this.isAtEnd()) throw new LexError('無効なエスケープシーケンス', this.line, this.column);
      code += this.advance();
    }
    return String.fromCharCode(parseInt(code, 16));
  }

  // ─── テンプレートリテラル ────────────────────────────────────────────────────

  scanTemplate() {
    // `` ` `` を消費した直後に呼ばれる
    const tokLine = this.line;
    const tokCol  = this.column;
    let str = '';

    while (!this.isAtEnd()) {
      if (this.peek() === '`') {
        this.advance(); // 閉じバッククォート
        const tok = new Token(TokenType.TEMPLATE_NO_SUB, str, tokLine, tokCol, this.hadNewline);
        this.hadNewline = false;
        this.tokens.push(tok);
        return;
      }
      if (this.peek() === '$' && this.peekNext() === '{') {
        this.advance(); this.advance(); // `${`
        const tok = new Token(TokenType.TEMPLATE_HEAD, str, tokLine, tokCol, this.hadNewline);
        this.hadNewline = false;
        this.tokens.push(tok);
        this.templateStack.push({ braceDepth: 0 });
        return;
      }
      str += this.readTemplateChar();
    }
    throw new LexError('テンプレートリテラルが閉じられていません', this.line, this.column);
  }

  scanTemplateContinuation() {
    // `}` でテンプレートが再開された後に呼ばれる
    const tokLine = this.line;
    const tokCol  = this.current - this.lineStart + 1;
    let str = '';

    while (!this.isAtEnd()) {
      if (this.peek() === '`') {
        this.advance();
        const tok = new Token(TokenType.TEMPLATE_TAIL, str, tokLine, tokCol, false);
        this.tokens.push(tok);
        return;
      }
      if (this.peek() === '$' && this.peekNext() === '{') {
        this.advance(); this.advance();
        const tok = new Token(TokenType.TEMPLATE_MIDDLE, str, tokLine, tokCol, false);
        this.tokens.push(tok);
        this.templateStack.push({ braceDepth: 0 });
        return;
      }
      str += this.readTemplateChar();
    }
    throw new LexError('テンプレートリテラルが閉じられていません', this.line, this.column);
  }

  readTemplateChar() {
    if (this.peek() === '\\') {
      this.advance();
      const esc = this.advance();
      switch (esc) {
        case 'n':  return '\n';
        case 't':  return '\t';
        case 'r':  return '\r';
        case '\\': return '\\';
        case '`':  return '`';
        case '$':  return '$';
        case 'u':  return this.scanUnicodeEscape();
        default:   return esc;
      }
    }
    if (this.peek() === '\n') {
      this.line++;
      this.lineStart = this.current + 1;
    } else if (this.peek() === '\r') {
      if (this.peekNext() === '\n') this.current++;
      this.line++;
      this.lineStart = this.current + 1;
    }
    return this.advance();
  }

  // ─── 数値リテラル ────────────────────────────────────────────────────────────

  scanNumber() {
    const s = this.source[this.start];
    const next = this.peek();

    // 0x / 0o / 0b
    if (s === '0') {
      if (next === 'x' || next === 'X') { this.advance(); while (this.isHexDigit(this.peek())) this.advance(); }
      else if (next === 'o' || next === 'O') { this.advance(); while (this.isOctalDigit(this.peek())) this.advance(); }
      else if (next === 'b' || next === 'B') { this.advance(); while (this.peek() === '0' || this.peek() === '1') this.advance(); }
      else this.scanDecimal();
    } else {
      this.scanDecimal();
    }

    // 数値セパレーター除去してパース
    const raw = this.source.slice(this.start, this.current).replace(/_/g, '');
    this.addToken(TokenType.NUMBER, String(Number(raw)));
  }

  scanDecimal() {
    while (this.isDigit(this.peek()) || this.peek() === '_') this.advance();
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      this.advance(); // '.'
      while (this.isDigit(this.peek()) || this.peek() === '_') this.advance();
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') this.advance();
      while (this.isDigit(this.peek())) this.advance();
    }
  }

  // ─── 識別子・キーワード ──────────────────────────────────────────────────────

  scanIdentifier() {
    while (this.isAlphaNumeric(this.peek())) this.advance();
    const text = this.source.slice(this.start, this.current);
    this.addToken(KEYWORDS[text] ?? TokenType.IDENTIFIER, text);
  }

  // ─── 文字判定ユーティリティ ──────────────────────────────────────────────────

  isDigit(c)      { return c >= '0' && c <= '9'; }
  isHexDigit(c)   { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
  isOctalDigit(c) { return c >= '0' && c <= '7'; }
  isAlpha(c)      { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$'; }
  isAlphaNumeric(c){ return this.isAlpha(c) || this.isDigit(c); }
}

export { Lexer, Token, TokenType, LexError };

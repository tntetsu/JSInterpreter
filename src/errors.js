// ─── 共通エラークラス ──────────────────────────────────────────────────────────
// lexer.js / parser.js / interpreter.js / environment.js から参照される。
// 循環依存を断ち切るため独立モジュールとして定義する。

export class LexError extends Error {
  constructor(message, line, column) {
    super(`[Lexer] ${line}:${column}: ${message}`);
    this.name   = 'LexError';
    this.line   = line;
    this.column = column;
  }
}

export class ParseError extends Error {
  constructor(message, line, column) {
    super(`[Parser] ${line}:${column}: ${message}`);
    this.name   = 'ParseError';
    this.line   = line;
    this.column = column;
  }
}

export class RuntimeError extends Error {
  constructor(message, loc) {
    super(`[Runtime] ${loc ? `${loc.line}:${loc.column}: ` : ''}${message}`);
    this.name = 'RuntimeError';
    this.loc  = loc || null;
  }
}

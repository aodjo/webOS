/**
 * $(( … )) arithmetic expansion: integer math like zsh, with a small Pratt parser (no eval).
 * Supports + - * / % ** << >> & | ^ ~ ! && || == != < <= > >= ?: , parentheses, numbers
 * (decimal, 0x hex, base#value) and variables (unset or non-numeric → 0).
 */

/** Error raised for malformed arithmetic expressions and division by zero; its message is zsh's wording. */
export class ArithError extends Error {}

/** Lexer token: a number literal, a variable name, or an operator / parenthesis. */
type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

const OPS = ['**', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '&', '|', '^', '~', '!', '(', ')', '?', ':', ',']; /** Operator spellings; two-character ones come first so the lexer's first match is the longest. */

/**
 * Tokenize an arithmetic expression.
 *
 * Skips whitespace and recognizes numbers (`0x` hex, `base#digits` parsed with parseInt in
 * that base, plain decimal), identifiers (`[A-Za-z_][A-Za-z0-9_]*`) and the operators in
 * OPS, trying them in OPS order so the longest operator wins.
 *
 * @param {string} src - The expression text between `$((` and `))`.
 * @returns {Tok[]} The tokens in source order.
 * @throws {ArithError} When a number yields NaN (an unsupported base, or no digit valid in
 *   that base) or a character is not part of any token.
 *
 * @example
 * lex('x + 0x10'); // [{ t: 'id', v: 'x' }, { t: 'op', v: '+' }, { t: 'num', v: 16 }]
 */
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    const rest = src.slice(i);
    if ((m = /^0[xX][0-9a-fA-F]+|^\d+#[0-9a-zA-Z]+|^\d+/.exec(rest))) {
      const text = m[0];
      let v: number;
      if (text.includes('#')) {
        const [base, digits] = text.split('#');
        v = parseInt(digits, Number(base));
      } else v = Number(text);
      if (Number.isNaN(v)) throw new ArithError(`bad math expression: ${text}`);
      out.push({ t: 'num', v });
      i += text.length;
      continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (!op) throw new ArithError(`bad math expression: illegal character: ${ch}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

const BINARY: Record<string, [prec: number, right: boolean]> = {
  ',': [1, false],
  '||': [3, false],
  '&&': [4, false],
  '|': [5, false],
  '^': [6, false],
  '&': [7, false],
  '==': [8, false],
  '!=': [8, false],
  '<': [9, false],
  '<=': [9, false],
  '>': [9, false],
  '>=': [9, false],
  '<<': [10, false],
  '>>': [10, false],
  '+': [11, false],
  '-': [11, false],
  '*': [12, false],
  '/': [12, false],
  '%': [12, false],
  '**': [14, true],
}; /** Binary operators → [precedence, right-associative]; level 2 is the ?: ternary and 13 the unary prefix operators (handled in evaluate). */

/**
 * Evaluate a `$(( … ))` expression to an integer.
 *
 * Tokenizes `src` and runs a Pratt parser that evaluates while parsing. Variables are read
 * through `getVar`; unset, empty or non-numeric values count as 0 and numeric ones are
 * truncated to integers. Unary `- + ! ~` bind tighter than `* / %` but looser than `**`, so
 * `-2 ** 2` is -4. Both operands of `&&`, `||` and both branches of `?:` are always
 * evaluated, so an error in an unused operand (e.g. division by zero) still throws. The whole
 * input must be consumed.
 *
 * @param {string} src - The expression text.
 * @param {(name: string) => string | undefined} getVar - Looks up a shell variable's value.
 * @returns {number} The integer result.
 * @throws {ArithError} On lexing errors, a missing operand, `)` or `:`, leftover tokens, an
 *   unknown operator, or division / modulo by zero.
 *
 * @example
 * evaluate('x * 2 + 1', (name) => (name === 'x' ? '20' : undefined)); // 41
 * evaluate('16#ff >> 4', () => undefined); // 15
 */
export function evaluate(src: string, getVar: (name: string) => string | undefined): number {
  const toks = lex(src);
  let pos = 0;
  /**
   * Look at the current token without consuming it.
   *
   * Reads the token at the shared `pos` cursor; callers advance `pos` themselves once they
   * accept the token.
   *
   * @returns {Tok | undefined} The token at `pos`, or undefined at the end of input.
   *
   * @example
   * if (peek()?.v !== ')') throw new ArithError("bad math expression: ')' expected");
   */
  const peek = () => toks[pos];
  /**
   * Read a variable as an integer.
   *
   * Unset, blank or non-numeric values yield 0; numeric values are trimmed and truncated
   * toward zero.
   *
   * @param {string} name - Variable name.
   * @returns {number} The integer value.
   *
   * @example
   * varValue('COLUMNS'); // 80
   */
  const varValue = (name: string): number => {
    const raw = (getVar(name) ?? '').trim();
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : Math.trunc(n);
  };

  /**
   * Parse and evaluate an expression at or above a precedence level.
   *
   * Reads a prefix operand, then repeatedly folds in binary operators from BINARY whose
   * precedence is ≥ `minPrec`, recursing with `prec + 1` for left-associative operators and
   * `prec` for right-associative ones. The ternary `?:` is accepted when `minPrec` ≤ 2: the
   * middle operand is parsed as a full expression (commas allowed) and the else branch at
   * level 2, which makes nested ternaries right-associative.
   *
   * @param {number} minPrec - Minimum operator precedence to consume.
   * @returns {number} The value of the parsed sub-expression.
   * @throws {ArithError} When `:` is missing after a `?` branch, or from prefix() / apply().
   *
   * @example
   * const result = parse(1);
   */
  const parse = (minPrec: number): number => {
    let left = prefix();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== 'op') break;
      if (tok.v === '?' && minPrec <= 2) {
        pos++;
        const a = parse(1);
        if (peek()?.v !== ':') throw new ArithError("bad math expression: ':' expected");
        pos++;
        const b = parse(2);
        left = left ? a : b;
        continue;
      }
      const info = BINARY[tok.v];
      if (!info || info[0] < minPrec) break;
      pos++;
      const right = parse(info[1] ? info[0] : info[0] + 1);
      left = apply(tok.v, left, right);
    }
    return left;
  };

  /**
   * Parse and evaluate one operand.
   *
   * Handles number literals, variables, parenthesized sub-expressions and the unary
   * operators `-`, `+`, `!` (logical not, yielding 0 or 1) and `~` (bitwise not), whose
   * operand is parsed at precedence 13.
   *
   * @returns {number} The operand's value.
   * @throws {ArithError} At the end of input, when `)` is missing, or when the token cannot
   *   start an operand.
   *
   * @example
   * let left = prefix();
   */
  const prefix = (): number => {
    const tok = peek();
    if (!tok) throw new ArithError('bad math expression: operand expected at end of string');
    pos++;
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'id') return varValue(tok.v);
    switch (tok.v) {
      case '(': {
        const v = parse(1);
        if (peek()?.v !== ')') throw new ArithError("bad math expression: ')' expected");
        pos++;
        return v;
      }
      case '-':
        return -parse(13);
      case '+':
        return parse(13);
      case '!':
        return parse(13) ? 0 : 1;
      case '~':
        return ~parse(13);
    }
    throw new ArithError(`bad math expression: operand expected at \`${tok.v}'`);
  };

  const result = parse(1);
  if (pos < toks.length) throw new ArithError(`bad math expression: operator expected at \`${toks.slice(pos).map((x) => x.v).join(' ')}'`);
  return result;
}

/**
 * Apply a binary operator to two integer operands.
 *
 * Comparisons and logical operators return 1 or 0. `,` returns the right operand. Bitwise
 * and shift operators use JavaScript's 32-bit integer semantics. `/` truncates toward zero
 * and `%` keeps the sign of the dividend. `**` with a negative exponent yields 0; otherwise
 * the power is truncated to an integer.
 *
 * @param {string} op - Operator spelling from BINARY.
 * @param {number} a - Left operand.
 * @param {number} b - Right operand.
 * @returns {number} The result.
 * @throws {ArithError} On division or modulo by zero, or an unknown operator.
 *
 * @example
 * apply('/', 7, 2);  // 3
 * apply('<=', 1, 2); // 1
 */
function apply(op: string, a: number, b: number): number {
  switch (op) {
    case ',':
      return b;
    case '||':
      return a || b ? 1 : 0;
    case '&&':
      return a && b ? 1 : 0;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '&':
      return a & b;
    case '==':
      return a === b ? 1 : 0;
    case '!=':
      return a !== b ? 1 : 0;
    case '<':
      return a < b ? 1 : 0;
    case '<=':
      return a <= b ? 1 : 0;
    case '>':
      return a > b ? 1 : 0;
    case '>=':
      return a >= b ? 1 : 0;
    case '<<':
      return a << b;
    case '>>':
      return a >> b;
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
    case '%':
      if (b === 0) throw new ArithError('division by zero');
      return op === '/' ? Math.trunc(a / b) : a % b;
    case '**':
      return b < 0 ? 0 : Math.trunc(a ** b);
  }
  throw new ArithError(`bad math expression: ${op}`);
}

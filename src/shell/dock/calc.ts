/**
 * Spotlight's calculator and unit converter.
 *
 * A small recursive-descent parser (no eval) supporting + − × ÷ % ^ !, parentheses, decimals,
 * scientific notation, implicit multiplication ("2pi", "3(4+5)"), the functions
 * sqrt/cbrt/sin/cos/tan/asin/acos/atan/log/ln/exp/abs/round/floor/ceil and the constants pi/π/e/tau.
 */

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
}; /** Single-argument functions callable by name in an expression (`log` is base 10, `ln` is natural). */

const CONSTS: Record<string, number> = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2 }; /** Named constants an expression may reference. */

/** A lexical token: a number literal, an identifier (function or constant name) or an operator/parenthesis. */
type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

/** Raised by the tokenizer and parser for any malformed expression. */
class ParseError extends Error {}

/**
 * Splits an expression string into tokens.
 *
 * Typographic operators are normalized first (× ✕ · → *, ÷ → /, − – → -, ** → ^). Whitespace is
 * skipped; numbers may be decimals or use scientific notation; identifiers are lowercased letter
 * runs or "π"; the single-character operators are + - * / % ^ ( ) !.
 *
 * @param {string} src - The raw expression typed by the user.
 * @returns {Token[]} The tokens in source order.
 * @throws {ParseError} When a character cannot start any token.
 *
 * @example
 * tokenize('2 × pi');
 * // [{ t: 'num', v: 2 }, { t: 'op', v: '*' }, { t: 'id', v: 'pi' }]
 */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const s = src
    .replace(/[×✕·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      out.push({ t: 'num', v: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^([a-z]+|π)/i.exec(s.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ('+-*/%^()!'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new ParseError(`Unexpected “${ch}”`);
  }
  return out;
}

/**
 * Recursive-descent evaluator over a token list.
 *
 * Grammar, from lowest to highest precedence: expr (+ -), term (* / % and implicit
 * multiplication), unary (leading + -), power (right-associative ^), postfix (! and percent %),
 * primary (number, parenthesized expression, function call, constant).
 */
class Parser {
  private i = 0;
  /** Number of operators / function calls seen (a bare number is not "math"). */
  ops = 0;

  /**
   * Creates a parser positioned at the first token.
   *
   * Stores the token list as a read-only field; the read position and the operator count both
   * start at zero and are never reset, so each instance is meant for a single `parse()` call.
   *
   * @param {Token[]} tokens - Tokens produced by `tokenize`.
   * @returns {Parser} The new parser.
   *
   * @example
   * const p = new Parser(tokenize('1 + 2'));
   */
  constructor(private readonly tokens: Token[]) {}

  /**
   * Parses and evaluates the whole token list.
   *
   * Counts operators into `ops` as a side effect, so callers can tell a bare number from an
   * actual calculation after parsing.
   *
   * @returns {number} The value of the expression (may be NaN or ±Infinity).
   * @throws {ParseError} When the input is empty, malformed, or has tokens left over.
   *
   * @example
   * new Parser(tokenize('(2+3)*4')).parse(); // 20
   */
  parse(): number {
    if (!this.tokens.length) throw new ParseError('empty');
    const v = this.expr();
    if (this.i < this.tokens.length) throw new ParseError('trailing input');
    return v;
  }

  /**
   * Returns the current token without consuming it.
   *
   * Reads the token at the current position and leaves the position unchanged.
   *
   * @returns {Token | undefined} The next token, or undefined at the end of input.
   *
   * @example
   * const t = this.peek();
   * if (t?.t === 'num') console.log(t.v);
   */
  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  /**
   * Tests whether the current token is the given operator.
   *
   * Only operator tokens match; numbers and identifiers never do. The position is not advanced.
   *
   * @param {string} v - Operator character to look for, e.g. "+" or "(".
   * @returns {boolean} True when the next token is that operator.
   *
   * @example
   * if (this.isOp('^')) this.i++;
   */
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'op' && t.v === v;
  }

  /**
   * Tests whether the next token can start an operand.
   *
   * Lets `term` detect implicit multiplication ("2pi") and lets `postfix` tell a percent sign
   * ("50%") from the modulo operator ("7 % 3").
   *
   * @returns {boolean} True for a number, an identifier or an opening parenthesis.
   *
   * @example
   * if (this.startsOperand()) v *= this.unary();
   */
  private startsOperand(): boolean {
    const t = this.peek();
    return !!t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '('));
  }

  /**
   * Parses a sum or difference of terms (left-associative).
   *
   * Reads a term, then folds every following "+ term" or "- term" into the running value from left
   * to right, counting each operator in `ops`.
   *
   * @returns {number} The evaluated value.
   * @throws {ParseError} When an operand is malformed.
   *
   * @example
   * const v = this.expr(); // "1 - 2 + 3" → 2
   */
  private expr(): number {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.i++] as { v: string }).v;
      const r = this.term();
      this.ops++;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  /**
   * Parses a product, quotient or modulo chain (left-associative).
   *
   * When an operand directly follows another without an operator ("2pi", "3(1+2)",
   * "(1+2)(3+4)") the two are multiplied implicitly.
   *
   * @returns {number} The evaluated value.
   * @throws {ParseError} When an operand is malformed.
   *
   * @example
   * const v = this.term(); // "3(4+5)" → 27
   */
  private term(): number {
    let v = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
        const op = (this.tokens[this.i++] as { v: string }).v;
        const r = this.unary();
        this.ops++;
        v = op === '*' ? v * r : op === '/' ? v / r : v % r;
      } else if (this.startsOperand()) {
        const r = this.unary();
        this.ops++;
        v *= r;
      } else return v;
    }
  }

  /**
   * Parses any number of leading sign operators followed by a power expression.
   *
   * Each leading "-" negates the rest of the operand recursively and each leading "+" is skipped,
   * so the sign binds looser than ^ but tighter than * and /. Signs are not counted in `ops`.
   *
   * @returns {number} The evaluated value.
   * @throws {ParseError} When the operand is malformed.
   *
   * @example
   * const v = this.unary(); // "--3" → 3
   */
  private unary(): number {
    if (this.isOp('-')) {
      this.i++;
      return -this.unary();
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  /**
   * Parses exponentiation.
   *
   * The exponent is parsed with `unary`, which makes ^ right-associative and lets it take a
   * signed exponent, while a minus sign on its left applies to the whole power:
   * -2^2 = -4 and 2^-1 = 0.5.
   *
   * @returns {number} The evaluated value.
   * @throws {ParseError} When the base or exponent is malformed.
   *
   * @example
   * const v = this.power(); // "2^3^2" → 512
   */
  private power(): number {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.i++;
      this.ops++;
      return Math.pow(base, this.unary());
    }
    return base;
  }

  /**
   * Parses a primary followed by postfix factorial (!) and percent (%) operators.
   *
   * A % counts as percent (divide by 100) only when no operand follows it; otherwise the parser
   * rewinds so `term` reads it as modulo ("50%" vs "7 % 3").
   *
   * @returns {number} The evaluated value.
   * @throws {ParseError} When the primary is malformed.
   *
   * @example
   * const v = this.postfix(); // "5!" → 120, "50%" → 0.5
   */
  private postfix(): number {
    let v = this.primary();
    for (;;) {
      if (this.isOp('!')) {
        this.i++;
        this.ops++;
        v = factorial(v);
      } else if (this.isOp('%')) {
        const save = this.i;
        this.i++;
        if (this.startsOperand()) {
          this.i = save;
          return v;
        }
        this.ops++;
        v /= 100;
      } else return v;
    }
  }

  /**
   * Parses a number, a parenthesized expression, a function call or a named constant.
   *
   * A function's argument is a postfix expression, so "sqrt 16", "sqrt(16)" and "sin pi" all
   * work without parentheses.
   *
   * @returns {number} The evaluated value.
   * @throws {ParseError} At the end of input, on a missing ")", or on an unknown identifier.
   *
   * @example
   * const v = this.primary(); // "sqrt(16)" → 4
   */
  private primary(): number {
    const t = this.peek();
    if (!t) throw new ParseError('unexpected end');
    if (t.t === 'num') {
      this.i++;
      return t.v;
    }
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const v = this.expr();
      if (!this.isOp(')')) throw new ParseError('missing )');
      this.i++;
      return v;
    }
    if (t.t === 'id') {
      this.i++;
      if (t.v in FUNCS) {
        this.ops++;
        return FUNCS[t.v](this.postfix());
      }
      if (t.v in CONSTS) return CONSTS[t.v];
      throw new ParseError(`Unknown “${t.v}”`);
    }
    throw new ParseError('unexpected token');
  }
}

/**
 * Computes n! for a non-negative integer.
 *
 * Inputs that are not integers, are negative, or exceed 170 (where the result overflows a double)
 * yield NaN.
 *
 * @param {number} n - The operand.
 * @returns {number} n factorial, or NaN when undefined/unrepresentable.
 *
 * @example
 * factorial(5); // 120
 */
function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

/**
 * Evaluates an arithmetic expression.
 *
 * Tokenizes and parses the source with the recursive-descent parser; no `eval` is used.
 *
 * @param {string} src - Expression such as "2^10" or "sqrt(2) * pi".
 * @returns {number} The numeric result (may be NaN or ±Infinity).
 * @throws {ParseError} On syntax errors or unknown identifiers.
 *
 * @example
 * evaluate('(2+3)*4'); // 20
 */
export function evaluate(src: string): number {
  return new Parser(tokenize(src)).parse();
}

/** A successful calculator result. */
export interface CalcResult {
  value: number;
  /** Display form, e.g. "1,234.5". */
  display: string;
  /** Plain form copied to the clipboard, e.g. "1234.5". */
  plain: string;
}

/**
 * Evaluates a Spotlight query as math, if it looks like math.
 *
 * A leading "=" is ignored. The query must contain a digit or a constant name, must contain at
 * least one operator or function call (a bare number is not a calculation) unless it is exactly a
 * named constant like "pi", and must evaluate to a finite number. Parse errors are swallowed.
 *
 * @param {string} query - The raw search text.
 * @returns {CalcResult | null} The value with display and plain forms, or null when the query is
 *   not a valid calculation.
 *
 * @example
 * calculate('1200 + 34.5'); // { value: 1234.5, display: '1,234.5', plain: '1234.5' }
 * calculate('42');          // null
 */
export function calculate(query: string): CalcResult | null {
  const q = query.trim().replace(/^=/, '').trim();
  if (!q || !/[\dπ]|pi|tau/i.test(q)) return null;
  try {
    const p = new Parser(tokenize(q));
    const value = p.parse();
    const isConst = /^(pi|π|tau)$/i.test(q);
    if (!p.ops && !isConst) return null;
    if (!Number.isFinite(value)) return null;
    return { value, display: formatNumber(value), plain: plainNumber(value) };
  } catch {
    return null;
  }
}

/**
 * Formats a number for copying: no grouping separators, 12 significant digits.
 *
 * Negative zero becomes "0". Magnitudes of 1e21 and above or below 1e-9 use exponential notation
 * with 10 fraction digits and trailing zeros trimmed; other values are rounded to 12 significant
 * digits.
 *
 * @param {number} v - The value to format.
 * @returns {string} The plain textual form.
 *
 * @example
 * plainNumber(0.1 + 0.2); // "0.3"
 */
export function plainNumber(v: number): string {
  if (Object.is(v, -0)) v = 0;
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e21 || abs < 1e-9)) return v.toExponential(10).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(12)));
}

/**
 * Formats a number for display with en-US digit grouping.
 *
 * Rounds to 12 significant digits and at most 10 fraction digits. Negative zero becomes "0".
 * Magnitudes of 1e15 and above or below 1e-9 use exponential notation with trailing zeros trimmed.
 *
 * @param {number} v - The value to format.
 * @returns {string} The display form.
 *
 * @example
 * formatNumber(1234.5); // "1,234.5"
 */
export function formatNumber(v: number): string {
  if (Object.is(v, -0)) v = 0;
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return v.toExponential(8).replace(/\.?0+e/, 'e');
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 }).format(Number(v.toPrecision(12)));
}

/* ───────────────────────── Unit conversion ───────────────────────── */

/** Physical dimension a unit measures; only units of the same dimension convert into each other. */
type Dim = 'length' | 'mass' | 'temp' | 'data';

/** A convertible unit. */
interface Unit {
  dim: Dim;
  /** Symbol shown in results, e.g. "km" or "°C". */
  symbol: string;
  /** Multiplier to the base unit (m, g, byte). Temperatures use toBase/fromBase. */
  factor: number;
  /** Lowercase spellings accepted in a query. */
  names: string[];
}

const UNITS: Unit[] = [
  { dim: 'length', symbol: 'mm', factor: 0.001, names: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'] },
  { dim: 'length', symbol: 'cm', factor: 0.01, names: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'] },
  { dim: 'length', symbol: 'm', factor: 1, names: ['m', 'meter', 'meters', 'metre', 'metres'] },
  { dim: 'length', symbol: 'km', factor: 1000, names: ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'] },
  { dim: 'length', symbol: 'in', factor: 0.0254, names: ['in', 'inch', 'inches', '"'] },
  { dim: 'length', symbol: 'ft', factor: 0.3048, names: ['ft', 'foot', 'feet', "'"] },
  { dim: 'length', symbol: 'yd', factor: 0.9144, names: ['yd', 'yard', 'yards'] },
  { dim: 'length', symbol: 'mi', factor: 1609.344, names: ['mi', 'mile', 'miles'] },
  { dim: 'mass', symbol: 'mg', factor: 0.001, names: ['mg', 'milligram', 'milligrams'] },
  { dim: 'mass', symbol: 'g', factor: 1, names: ['g', 'gram', 'grams'] },
  { dim: 'mass', symbol: 'kg', factor: 1000, names: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'] },
  { dim: 'mass', symbol: 'oz', factor: 28.349523125, names: ['oz', 'ounce', 'ounces'] },
  { dim: 'mass', symbol: 'lb', factor: 453.59237, names: ['lb', 'lbs', 'pound', 'pounds'] },
  { dim: 'temp', symbol: '°C', factor: 1, names: ['c', '°c', 'celsius', 'degc'] },
  { dim: 'temp', symbol: '°F', factor: 1, names: ['f', '°f', 'fahrenheit', 'degf'] },
  { dim: 'temp', symbol: 'K', factor: 1, names: ['k', 'kelvin'] },
  { dim: 'data', symbol: 'B', factor: 1, names: ['b', 'byte', 'bytes'] },
  { dim: 'data', symbol: 'KB', factor: 1e3, names: ['kb', 'kilobyte', 'kilobytes'] },
  { dim: 'data', symbol: 'MB', factor: 1e6, names: ['mb', 'megabyte', 'megabytes'] },
  { dim: 'data', symbol: 'GB', factor: 1e9, names: ['gb', 'gigabyte', 'gigabytes'] },
  { dim: 'data', symbol: 'TB', factor: 1e12, names: ['tb', 'terabyte', 'terabytes'] },
]; /** Every supported unit; data units are decimal (1 KB = 1000 bytes). */

const DEFAULT_TARGET: Record<string, string> = {
  mm: 'in',
  cm: 'in',
  m: 'ft',
  km: 'mi',
  in: 'cm',
  ft: 'm',
  yd: 'm',
  mi: 'km',
  mg: 'g',
  g: 'oz',
  kg: 'lb',
  oz: 'g',
  lb: 'kg',
  '°C': '°F',
  '°F': '°C',
  K: '°C',
  B: 'KB',
  KB: 'MB',
  MB: 'GB',
  GB: 'MB',
  TB: 'GB',
}; /** Target unit symbol used when the query names only a source unit ("10 km" → mi). */

/**
 * Looks up a unit by any of its accepted spellings.
 *
 * Searches UNITS for the first unit whose `names` list contains the normalized text.
 *
 * @param {string} name - Unit text from the query; trimmed and compared case-insensitively.
 * @returns {Unit | undefined} The matching unit, or undefined when unknown.
 *
 * @example
 * findUnit('Miles')?.symbol; // "mi"
 */
function findUnit(name: string): Unit | undefined {
  const n = name.trim().toLowerCase();
  return UNITS.find((u) => u.names.includes(n));
}

/**
 * Converts a value in unit `u` to its dimension's base unit.
 *
 * Linear units multiply by `factor`; temperatures convert to degrees Celsius.
 *
 * @param {Unit} u - The source unit.
 * @param {number} v - The amount in that unit.
 * @returns {number} The amount in m, g, bytes or °C.
 *
 * @example
 * toBase(findUnit('km')!, 2); // 2000
 */
function toBase(u: Unit, v: number): number {
  if (u.dim !== 'temp') return v * u.factor;
  if (u.symbol === '°F') return ((v - 32) * 5) / 9;
  if (u.symbol === 'K') return v - 273.15;
  return v;
}

/**
 * Converts a value from its dimension's base unit into unit `u`.
 *
 * Linear units divide by `factor`; temperatures convert from degrees Celsius.
 *
 * @param {Unit} u - The target unit.
 * @param {number} v - The amount in m, g, bytes or °C.
 * @returns {number} The amount in `u`.
 *
 * @example
 * fromBase(findUnit('f')!, 100); // 212
 */
function fromBase(u: Unit, v: number): number {
  if (u.dim !== 'temp') return v / u.factor;
  if (u.symbol === '°F') return (v * 9) / 5 + 32;
  if (u.symbol === 'K') return v + 273.15;
  return v;
}

/** A successful unit conversion. */
export interface Conversion {
  /** Formatted source amount with its unit, e.g. "10 km". */
  from: string;
  /** Formatted converted amount with its unit, e.g. "6.21371 mi". */
  to: string;
  /** Unrounded converted value. */
  value: number;
  /** Converted number for display (6 significant digits). */
  display: string;
  /** Converted number for the clipboard (10 significant digits). */
  plain: string;
}

/**
 * Parses and performs a unit conversion query.
 *
 * Accepts "<amount> <unit> [to|in|as|into|->|→|= <unit>]", e.g. "10 km to mi", "72f in c",
 * "5 lb" or "3 ft = cm". Without a target unit the default from DEFAULT_TARGET is used. Units of
 * different dimensions, identical units and non-finite results are rejected. Temperatures are
 * formatted without a space before the symbol ("72°F").
 *
 * @param {string} query - The raw search text.
 * @returns {Conversion | null} The conversion, or null when the query is not a conversion.
 *
 * @example
 * convert('10 km to mi')?.to; // "6.21371 mi"
 */
export function convert(query: string): Conversion | null {
  const m = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*([a-z°"']+)\s*(?:(?:to|in|as|into|->|→|=)\s*([a-z°"']+))?\s*$/i.exec(query);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const src = findUnit(m[2]);
  if (!src) return null;
  const dst = m[3] ? findUnit(m[3]) : UNITS.find((u) => u.symbol === DEFAULT_TARGET[src.symbol]);
  if (!dst || dst.dim !== src.dim || dst === src) return null;
  const value = fromBase(dst, toBase(src, amount));
  if (!Number.isFinite(value)) return null;
  /**
   * Appends a unit symbol to a formatted number.
   *
   * Temperature symbols are attached directly; other symbols are separated by a space.
   *
   * @param {string} v - The formatted number.
   * @param {Unit} u - The unit whose symbol is appended.
   * @returns {string} The number with its unit, e.g. "10 km" or "72°F".
   *
   * @example
   * fmtUnit('10', findUnit('km')!); // "10 km"
   */
  const fmtUnit = (v: string, u: Unit) => (u.dim === 'temp' ? `${v}${u.symbol}` : `${v} ${u.symbol}`);
  return {
    from: fmtUnit(formatNumber(amount), src),
    to: fmtUnit(formatNumber(Number(value.toPrecision(6))), dst),
    value,
    display: formatNumber(Number(value.toPrecision(6))),
    plain: plainNumber(Number(value.toPrecision(10))),
  };
}

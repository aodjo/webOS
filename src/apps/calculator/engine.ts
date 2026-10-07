/**
 * Calculator engine — a pure reducer modelled on the macOS / iOS calculator.
 *
 * Operator precedence is respected (2 + 3 × 4 = 14) by keeping the pending expression as a
 * token list per parenthesis level and reducing it whenever an operator of lower or equal
 * precedence arrives. Repeated "=" repeats the last operation, "%" follows the macOS rules
 * (x% of the left operand for + and −, x/100 otherwise), and "C" clears only the current entry.
 */

/**
 * Binary operators: the four arithmetic operators, x^y ('pow'), y^x ('ypow'), the y-th root
 * of x ('root'), the base-y logarithm of x ('logy') and scientific notation x × 10^y ('ee').
 */
export type BinOp = '+' | '-' | '*' | '/' | 'pow' | 'ypow' | 'root' | 'logy' | 'ee';
/** Unary scientific functions applied to the displayed value. */
export type UnaryFn =
  | 'sq'
  | 'cube'
  | 'exp'
  | 'pow10'
  | 'pow2'
  | 'inv'
  | 'sqrt'
  | 'cbrt'
  | 'ln'
  | 'log10'
  | 'log2'
  | 'fact'
  | 'sin'
  | 'cos'
  | 'tan'
  | 'asin'
  | 'acos'
  | 'atan'
  | 'sinh'
  | 'cosh'
  | 'tanh'
  | 'asinh'
  | 'acosh'
  | 'atanh';
/** Angle unit used by the trigonometric functions. */
export type Angle = 'deg' | 'rad';

/** One input to the reducer (a key press, a paste, or a menu command). */
export type CalcAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'op'; op: BinOp }
  | { type: 'equals' }
  | { type: 'percent' }
  | { type: 'negate' }
  /** The AC/C key: clears the entry first, everything on the second press. */
  | { type: 'clear' }
  | { type: 'allClear' }
  | { type: 'backspace' }
  | { type: 'paste'; value: number }
  | { type: 'fn'; fn: UnaryFn }
  /** Constants. `value` is passed in for Rand so the reducer stays pure. */
  | { type: 'const'; value: number }
  | { type: 'paren'; open: boolean }
  | { type: 'memory'; op: 'mc' | 'm+' | 'm-' | 'mr' }
  | { type: 'angle' };

/** An element of a pending expression: an operand or a binary operator. */
type Token = number | BinOp;

/** Complete calculator state, including the pending expression and display bookkeeping. */
export interface CalcState {
  /** Text being typed (digits as entered), or null when showing a computed value. */
  entry: string | null;
  /** Current numeric value (result, or parsed `entry`). */
  value: number;
  /** One token list per open parenthesis level: [n, op, n, op, …]. */
  frames: Token[][];
  /** The last input was an operator (a new operator replaces it). */
  awaitingOperand: boolean;
  /** Something was entered since the last operator → the clear key reads "C". */
  touched: boolean;
  /** The operation and operand that a repeated "=" re-applies. */
  lastOp: { op: BinOp; operand: number } | null;
  /** The display shows "Error"; a new number or a clear starts over. */
  error: boolean;
  /** Memory register, or null when empty. */
  memory: number | null;
  angle: Angle;
  /** Expression typed so far (shown above the result). */
  tape: string;
  /** The last completed calculation, e.g. "2+3×4". */
  history: string;
  /** The current value is a just-closed "( … )" group that is already on the tape. */
  closed: boolean;
}

export const initialState: CalcState = {
  entry: null,
  value: 0,
  frames: [[]],
  awaitingOperand: false,
  touched: false,
  lastOp: null,
  error: false,
  memory: null,
  angle: 'deg',
  tape: '',
  history: '',
  closed: false,
}; /** State of a freshly opened calculator: 0 on the display, nothing pending, degrees mode. */

export const MAX_DIGITS = 15; /** Maximum digits that can be typed into one number. */

const PREC: Record<BinOp, number> = { '+': 1, '-': 1, '*': 2, '/': 2, pow: 3, ypow: 3, root: 3, logy: 3, ee: 4 }; /** Binding strength of each operator; higher binds tighter. */
const RIGHT_ASSOC = new Set<BinOp>(['pow', 'ypow', 'root']); /** Right-associative operators, so 2^3^2 evaluates as 2^(3^2). */

export const OP_SYMBOL: Record<BinOp, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
  pow: '^',
  ypow: '^ʸ',
  root: '√',
  logy: ' log ',
  ee: 'E',
}; /** How each operator is written on the expression line. */

/* ───────────────────────── Math ───────────────────────── */

/**
 * Applies a binary operator to two operands.
 *
 * Undefined results come back as NaN so the reducer can turn them into an error:
 * division by zero, a zeroth root, and logarithms with a non-positive argument or an
 * invalid base. 'root' computes the b-th root of a, and odd integer roots of negative
 * numbers return the real (negative) root instead of NaN.
 *
 * @param {number} a - Left operand.
 * @param {BinOp} op - Operator to apply.
 * @param {number} b - Right operand.
 * @returns {number} The result, or NaN when it is undefined.
 *
 * @example
 * applyBinary(2, 'pow', 10); // 1024
 * applyBinary(-27, 'root', 3); // -3
 */
function applyBinary(a: number, op: BinOp, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? NaN : a / b;
    case 'pow':
      return a ** b;
    case 'ypow':
      return b ** a;
    case 'root':
      if (b === 0) return NaN;
      if (a < 0 && Number.isInteger(b) && Math.abs(b) % 2 === 1) return -((-a) ** (1 / b));
      return a ** (1 / b);
    case 'logy':
      return b <= 0 || b === 1 || a <= 0 ? NaN : Math.log(a) / Math.log(b);
    case 'ee':
      return a * 10 ** b;
  }
}

/**
 * Computes n! for a non-negative integer.
 *
 * Returns NaN for negative or fractional input and for n > 170, whose factorial
 * overflows a double.
 *
 * @param {number} n - The integer to take the factorial of.
 * @returns {number} n!, or NaN when undefined or too large.
 *
 * @example
 * factorial(5); // 120
 * factorial(2.5); // NaN
 */
function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n) || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Applies a scientific function to a value.
 *
 * Trigonometric functions take and return degrees when `angle` is 'deg'. Results of
 * sin, cos and tan within 1e-12 of zero are snapped to exactly 0 so values such as
 * sin 180° display as 0. tan at odd multiples of 90° (in degrees mode) and every
 * out-of-domain input (division by zero in 1/x, negative square roots, logarithms of
 * non-positive numbers, |x| > 1 for asin/acos, …) return NaN.
 *
 * @param {number} v - The value to transform.
 * @param {UnaryFn} fn - The function to apply.
 * @param {Angle} angle - Angle unit for trigonometric functions.
 * @returns {number} The result, or NaN when it is undefined.
 *
 * @example
 * applyUnary(30, 'sin', 'deg'); // 0.5 (approximately)
 * applyUnary(-4, 'sqrt', 'deg'); // NaN
 */
function applyUnary(v: number, fn: UnaryFn, angle: Angle): number {
  /**
   * Converts an angle in the current unit to radians.
   *
   * Multiplies by π/180 in degrees mode and returns the value unchanged in radians mode.
   *
   * @param {number} x - Angle in the current unit.
   * @returns {number} The angle in radians.
   *
   * @example
   * toRad(180); // Math.PI in degrees mode
   */
  const toRad = (x: number) => (angle === 'deg' ? (x * Math.PI) / 180 : x);
  /**
   * Converts an angle in radians to the current unit.
   *
   * Multiplies by 180/π in degrees mode and returns the value unchanged in radians mode.
   *
   * @param {number} x - Angle in radians.
   * @returns {number} The angle in the current unit.
   *
   * @example
   * fromRad(Math.PI); // 180 in degrees mode
   */
  const fromRad = (x: number) => (angle === 'deg' ? (x * 180) / Math.PI : x);
  /**
   * Rounds floating-point noise around zero to exactly zero.
   *
   * Any value whose magnitude is below 1e-12 becomes 0; other values pass through.
   *
   * @param {number} x - A trigonometric result.
   * @returns {number} The value, or 0 when it is negligibly small.
   *
   * @example
   * snap(1.22e-16); // 0
   */
  const snap = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
  switch (fn) {
    case 'sq':
      return v * v;
    case 'cube':
      return v * v * v;
    case 'exp':
      return Math.exp(v);
    case 'pow10':
      return 10 ** v;
    case 'pow2':
      return 2 ** v;
    case 'inv':
      return v === 0 ? NaN : 1 / v;
    case 'sqrt':
      return v < 0 ? NaN : Math.sqrt(v);
    case 'cbrt':
      return Math.cbrt(v);
    case 'ln':
      return v <= 0 ? NaN : Math.log(v);
    case 'log10':
      return v <= 0 ? NaN : Math.log10(v);
    case 'log2':
      return v <= 0 ? NaN : Math.log2(v);
    case 'fact':
      return factorial(v);
    case 'sin':
      return snap(Math.sin(toRad(v)));
    case 'cos':
      return snap(Math.cos(toRad(v)));
    case 'tan': {
      if (angle === 'deg' && Math.abs(v % 180) === 90) return NaN;
      return snap(Math.tan(toRad(v)));
    }
    case 'asin':
      return Math.abs(v) > 1 ? NaN : fromRad(Math.asin(v));
    case 'acos':
      return Math.abs(v) > 1 ? NaN : fromRad(Math.acos(v));
    case 'atan':
      return fromRad(Math.atan(v));
    case 'sinh':
      return Math.sinh(v);
    case 'cosh':
      return Math.cosh(v);
    case 'tanh':
      return Math.tanh(v);
    case 'asinh':
      return Math.asinh(v);
    case 'acosh':
      return v < 1 ? NaN : Math.acosh(v);
    case 'atanh':
      return Math.abs(v) >= 1 ? NaN : Math.atanh(v);
  }
}

/**
 * Collapses the tail of a token list as far as operator precedence allows.
 *
 * `list` alternates operands and operators and ends with an operand. While at least one
 * operation remains, the last operator is applied to its two operands, unless it binds
 * less tightly than `incoming` (or equally tightly when `incoming` is right-associative),
 * in which case it must wait. With `incoming` null the list collapses to a single value.
 * The input list is not mutated.
 *
 * @param {Token[]} list - Pending tokens, e.g. [2, '+', 3, '*', 4].
 * @param {BinOp | null} incoming - The operator about to be appended, or null to evaluate fully.
 * @returns {Token[]} The reduced token list, still ending with an operand.
 *
 * @example
 * reduce([2, '+', 3, '*', 4], '+'); // [14]
 * reduce([2, '+', 3], '*'); // [2, '+', 3]
 */
function reduce(list: Token[], incoming: BinOp | null): Token[] {
  const out = [...list];
  while (out.length >= 3) {
    const top = out[out.length - 2] as BinOp;
    if (incoming) {
      const pi = PREC[incoming];
      const pt = PREC[top];
      if (pt < pi || (pt === pi && RIGHT_ASSOC.has(incoming))) break;
    }
    const b = out.pop() as number;
    out.pop();
    const a = out.pop() as number;
    out.push(applyBinary(a, top, b));
  }
  return out;
}

/* ───────────────────────── Formatting ───────────────────────── */

/**
 * Inserts thousands separators into a plain number string.
 *
 * Groups only the integer part, keeps the sign and fractional part as they are, and
 * returns exponential notation unchanged.
 *
 * @param {string} text - A number as plain text, e.g. "-1234.5".
 * @returns {string} The text with commas between groups of three digits.
 *
 * @example
 * groupDigits('-1234567.891'); // "-1,234,567.891"
 * groupDigits('1e21'); // "1e21"
 */
export function groupDigits(text: string): string {
  if (/e/i.test(text)) return text;
  const neg = text.startsWith('-');
  const body = neg ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot);
  return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
}

/**
 * Formats a number in compact exponential notation.
 *
 * Uses `toExponential(digits)`, strips trailing zeros (and a dangling decimal point)
 * from the mantissa, and drops the "+" sign from the exponent.
 *
 * @param {number} n - The number to format.
 * @param {number} digits - Maximum digits after the mantissa's decimal point.
 * @returns {string} Text such as "1.5e-12" or "1e21".
 *
 * @example
 * trimExponential(1e21, 8); // "1e21"
 * trimExponential(1.5e-12, 8); // "1.5e-12"
 */
function trimExponential(n: number, digits: number): string {
  const [mant, exp] = n.toExponential(digits).split('e');
  const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant;
  return `${m}e${exp.replace('+', '')}`;
}

/**
 * Formats a computed value for display.
 *
 * Integers below 10^15 are shown exactly. Other values are rounded to 12 significant
 * digits, which hides binary floating-point noise such as 0.1 + 0.2. Magnitudes of
 * 10^15 and above or below 10^-6 use exponential notation with up to 8 fractional
 * mantissa digits. Non-finite values become "Error". The result is raw text without
 * digit grouping.
 *
 * @param {number} n - The value to format.
 * @returns {string} The display text.
 *
 * @example
 * formatNumber(0.1 + 0.2); // "0.3"
 * formatNumber(1e21); // "1e21"
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return 'Error';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) return trimExponential(n, 8);
  if (Number.isInteger(n)) return String(n);
  const clean = parseFloat(n.toPrecision(12));
  if (Math.abs(clean) < 1e-6) return trimExponential(clean, 8);
  if (Number.isInteger(clean) && Math.abs(clean) >= 1e15) return trimExponential(clean, 8);
  return String(clean);
}

/* ───────────────────────── Helpers ───────────────────────── */

/**
 * Returns the token list of the innermost open parenthesis level.
 *
 * At the top level (no open parenthesis) this is the only frame.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {Token[]} The innermost frame.
 *
 * @example
 * currentFrame(initialState); // []
 */
const currentFrame = (s: CalcState) => s.frames[s.frames.length - 1];

/**
 * Replaces the innermost frame.
 *
 * Returns a new frame stack whose outer frames are those of `s` and whose last frame
 * is `frame`.
 *
 * @param {CalcState} s - Calculator state.
 * @param {Token[]} frame - The new innermost frame.
 * @returns {Token[][]} The updated frame stack.
 *
 * @example
 * const frames = withFrame(s, [2, '+']);
 */
function withFrame(s: CalcState, frame: Token[]): Token[][] {
  return [...s.frames.slice(0, -1), frame];
}

/**
 * Puts the calculator into its error state.
 *
 * Discards the pending expression, entry, repeat operation and tape and sets the value
 * to NaN. Memory, angle unit and history are kept.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {CalcState} The error state.
 *
 * @example
 * fail(s).error; // true
 */
function fail(s: CalcState): CalcState {
  return { ...s, error: true, entry: null, value: NaN, frames: [[]], awaitingOperand: false, touched: false, lastOp: null, tape: '', closed: false };
}

/**
 * Counts the digits in a typed entry.
 *
 * Ignores the sign and decimal point.
 *
 * @param {string} entry - Entry text, e.g. "-12.5".
 * @returns {number} Number of digit characters.
 *
 * @example
 * countDigits('-12.5'); // 3
 */
function countDigits(entry: string): number {
  return entry.replace(/[^0-9]/g, '').length;
}

/**
 * Returns the ungrouped text for the current value.
 *
 * While typing this is the entry exactly as typed (e.g. "12." or "-0"); otherwise it is
 * the formatted computed value.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {string} The display text without digit grouping.
 *
 * @example
 * shown(initialState); // "0"
 */
const shown = (s: CalcState) => s.entry ?? formatNumber(s.value);

/**
 * Tells whether nothing is pending and nothing has been typed.
 *
 * True when the display shows a finished result (or 0) with no entry, no pending
 * operator, no open parenthesis and no edits since the result.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {boolean} Whether the next input starts a new calculation.
 *
 * @example
 * isFresh(initialState); // true
 */
const isFresh = (s: CalcState) => s.entry === null && !s.awaitingOperand && !s.touched && s.frames.length === 1 && currentFrame(s).length === 0;

/**
 * Removes the trailing "( … )" group from the tape.
 *
 * Scans backwards counting parentheses and cuts the tape just before the "(" that
 * matches the final ")". Returns the tape unchanged when no matching group is found.
 *
 * @param {string} tape - Expression text ending with a closed group.
 * @returns {string} The tape without that group.
 *
 * @example
 * stripGroup('2×(3+(1+1))'); // "2×"
 */
function stripGroup(tape: string): string {
  let depth = 0;
  for (let i = tape.length - 1; i >= 0; i--) {
    if (tape[i] === ')') depth++;
    else if (tape[i] === '(' && --depth === 0) return tape.slice(0, i);
  }
  return tape;
}

/**
 * Drops the "closed group" marker before the current value is replaced.
 *
 * When the current value is a just-closed "( … )" group, that group is already written
 * on the tape; this removes it from the tape and clears the marker. Otherwise the state
 * is returned unchanged.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {CalcState} The state without a closed group.
 *
 * @example
 * const next = unclose(s);
 */
function unclose(s: CalcState): CalcState {
  return s.closed ? { ...s, closed: false, tape: stripGroup(s.tape) } : s;
}

/**
 * Commits a computed value as the current value.
 *
 * Ends typing (clears the entry), marks the state as touched and drops a just-closed
 * group from the tape. A non-finite value puts the calculator into the error state.
 *
 * @param {CalcState} s - Calculator state.
 * @param {number} value - The new current value.
 * @returns {CalcState} The updated state, or the error state.
 *
 * @example
 * setValue(s, Math.PI).value; // 3.141592653589793
 */
function setValue(s: CalcState, value: number): CalcState {
  if (!Number.isFinite(value)) return fail(s);
  return { ...unclose(s), value, entry: null, awaitingOperand: false, touched: true };
}

/**
 * Appends a binary operator to the pending expression.
 *
 * If the previous input was also an operator, that operator is replaced ("2 + ×" becomes
 * "2 ×") and its symbol is removed from the tape. Otherwise the current value is appended
 * to the innermost frame and written to the tape (unless it is a closed group already
 * there). The frame is then reduced against the new operator's precedence, and the last
 * operand of the reduced list becomes the displayed intermediate result. A non-finite
 * intermediate result puts the calculator into the error state.
 *
 * @param {CalcState} s - Calculator state.
 * @param {BinOp} op - The operator that was pressed.
 * @returns {CalcState} The state awaiting the next operand, or the error state.
 *
 * @example
 * const s = pushOperator(calculate(initialState, { type: 'digit', digit: '2' }), '+');
 * console.log(s.tape); // "2+"
 */
function pushOperator(s: CalcState, op: BinOp): CalcState {
  const frame = currentFrame(s);
  let list: Token[];
  let tape = s.tape;
  if (s.awaitingOperand && frame.length) {
    list = frame.slice(0, -1);
    tape = tape.slice(0, tape.length - OP_SYMBOL[frame[frame.length - 1] as BinOp].length);
  } else {
    list = [...frame, s.value];
    if (!s.closed) tape += groupDigits(shown(s));
  }
  const reduced = reduce(list, op);
  const value = reduced[reduced.length - 1] as number;
  if (!Number.isFinite(value)) return fail(s);
  return {
    ...s,
    frames: withFrame(s, [...reduced, op]),
    value,
    entry: null,
    awaitingOperand: true,
    touched: false,
    closed: false,
    tape: tape + OP_SYMBOL[op],
  };
}

/* ───────────────────────── Reducer ───────────────────────── */

/**
 * Applies one input to the calculator state (the reducer).
 *
 * Pure: returns a new state and never mutates `state`. Notable rules:
 * - In the error state only a new number (digit, decimal, constant, paste, memory recall)
 *   or a clear starts over; "mc" and the angle toggle still apply, other inputs are
 *   ignored. Memory and angle unit survive the restart.
 * - Typing a new number after a result starts a new calculation but keeps the repeat
 *   operation, so "2 + 3 = 7 =" gives 10. Entries are limited to `MAX_DIGITS` digits.
 * - Backspace edits only a number being typed.
 * - "%" right after "a +" or "a −" gives x% of a ("200 + 10 %" → 20); otherwise x / 100.
 * - "=" evaluates every frame, closing open parentheses. The innermost pending operator
 *   and the current value are stored as the repeat operation; with nothing pending, "="
 *   re-applies that operation to the current value.
 * - The clear key acts as "C" (clear the entry, and the pending operator becomes
 *   replaceable again) when something was entered, and as "AC" otherwise.
 * - "(" after a number means multiplication ("5 (" → "5 × ("). ")" without an open
 *   parenthesis is ignored.
 * - Any non-finite result switches to the error state.
 *
 * @param {CalcState} state - Current state.
 * @param {CalcAction} action - The input to apply.
 * @returns {CalcState} The next state.
 *
 * @example
 * const keys: CalcAction[] = [{ type: 'digit', digit: '2' }, { type: 'op', op: '+' }, { type: 'digit', digit: '3' }, { type: 'equals' }];
 * const s = keys.reduce(calculate, initialState);
 * console.log(displayText(s)); // "5"
 */
export function calculate(state: CalcState, action: CalcAction): CalcState {
  let s = state;
  if (s.error) {
    const restart = { ...initialState, memory: s.memory, angle: s.angle };
    switch (action.type) {
      case 'digit':
      case 'decimal':
      case 'const':
      case 'paste':
        s = restart;
        break;
      case 'memory':
        if (action.op === 'mc') return { ...s, memory: null };
        if (action.op !== 'mr' || s.memory === null) return s;
        s = restart;
        break;
      case 'clear':
      case 'allClear':
        return restart;
      case 'angle':
        return { ...s, angle: s.angle === 'deg' ? 'rad' : 'deg' };
      default:
        return s;
    }
  }

  switch (action.type) {
    case 'digit': {
      const d = action.digit;
      if (!/^[0-9]$/.test(d)) return s;
      if (s.entry === null) {
        const next = unclose(s);
        return { ...next, entry: d, value: Number(d), awaitingOperand: false, touched: true, history: isFresh(s) ? '' : s.history };
      }
      if (countDigits(s.entry) >= MAX_DIGITS) return s;
      const entry = s.entry === '0' ? d : s.entry === '-0' ? `-${d}` : s.entry + d;
      return { ...s, entry, value: Number(entry), touched: true };
    }

    case 'decimal': {
      if (s.entry === null) return { ...unclose(s), entry: '0.', value: 0, awaitingOperand: false, touched: true, history: isFresh(s) ? '' : s.history };
      if (s.entry.includes('.') || countDigits(s.entry) >= MAX_DIGITS) return s;
      return { ...s, entry: s.entry + '.', touched: true };
    }

    case 'backspace': {
      if (s.entry === null) return s;
      let entry = s.entry.slice(0, -1);
      if (entry === '' || entry === '-') entry = '0';
      return { ...s, entry, value: Number(entry) };
    }

    case 'negate': {
      if (s.entry !== null) {
        const entry = s.entry.startsWith('-') ? s.entry.slice(1) : `-${s.entry}`;
        return { ...s, entry, value: Number(entry), touched: true };
      }
      if (s.awaitingOperand) return { ...s, entry: '-0', value: -0, awaitingOperand: false, touched: true };
      return { ...unclose(s), value: -s.value, touched: true };
    }

    case 'percent': {
      const frame = currentFrame(s);
      const pending = frame.length ? (frame[frame.length - 1] as BinOp) : null;
      const v = (pending === '+' || pending === '-') && frame.length >= 2 ? ((frame[frame.length - 2] as number) * s.value) / 100 : s.value / 100;
      return setValue(s, v);
    }

    case 'op':
      return pushOperator(s, action.op);

    case 'equals': {
      const hasPending = s.frames.some((f) => f.length > 0);
      if (!hasPending) {
        if (!s.lastOp) return { ...s, entry: null, touched: false };
        const r = applyBinary(s.value, s.lastOp.op, s.lastOp.operand);
        if (!Number.isFinite(r)) return fail(s);
        const history = groupDigits(shown(s)) + OP_SYMBOL[s.lastOp.op] + groupDigits(formatNumber(s.lastOp.operand));
        return { ...s, value: r, entry: null, awaitingOperand: false, touched: false, history, tape: '' };
      }
      const inner = currentFrame(s);
      const lastOp = inner.length ? { op: inner[inner.length - 1] as BinOp, operand: s.value } : null;
      let cur = s.value;
      for (let i = s.frames.length - 1; i >= 0; i--) cur = reduce([...s.frames[i], cur], null)[0] as number;
      if (!Number.isFinite(cur)) return fail(s);
      const history = s.tape + (s.closed ? '' : groupDigits(shown(s))) + ')'.repeat(s.frames.length - 1);
      return { ...s, value: cur, entry: null, frames: [[]], awaitingOperand: false, touched: false, lastOp, history, tape: '', closed: false };
    }

    case 'clear': {
      if (!s.touched) return { ...initialState, memory: s.memory, angle: s.angle };
      return { ...unclose(s), entry: null, value: 0, touched: false, awaitingOperand: currentFrame(s).length > 0 };
    }

    case 'allClear':
      return { ...initialState, memory: s.memory, angle: s.angle };

    case 'paste':
      return Number.isFinite(action.value) ? setValue(s, action.value) : s;

    case 'fn':
      return setValue(s, applyUnary(s.value, action.fn, s.angle));

    case 'const':
      return setValue(s, action.value);

    case 'paren': {
      if (action.open) {
        if (isFresh(s) || s.awaitingOperand) {
          const tape = isFresh(s) ? '' : s.tape;
          return { ...s, frames: [...s.frames, []], entry: null, awaitingOperand: true, touched: false, tape: tape + '(' };
        }
        const withMul = pushOperator(s, '*');
        if (withMul.error) return withMul;
        return { ...withMul, frames: [...withMul.frames, []], tape: withMul.tape + '(' };
      }
      if (s.frames.length === 1) return s;
      const reduced = reduce([...currentFrame(s), s.value], null);
      const value = reduced[0] as number;
      if (!Number.isFinite(value)) return fail(s);
      const tape = s.tape + (s.closed ? '' : groupDigits(shown(s))) + ')';
      return { ...s, frames: s.frames.slice(0, -1), value, entry: null, awaitingOperand: false, touched: true, tape, closed: true };
    }

    case 'memory': {
      switch (action.op) {
        case 'mc':
          return { ...s, memory: null };
        case 'm+':
          return { ...s, memory: (s.memory ?? 0) + s.value, entry: null };
        case 'm-':
          return { ...s, memory: (s.memory ?? 0) - s.value, entry: null };
        case 'mr':
          return s.memory === null ? s : setValue(s, s.memory);
      }
      return s;
    }

    case 'angle':
      return { ...s, angle: s.angle === 'deg' ? 'rad' : 'deg' };
  }
}

/* ───────────────────────── Selectors ───────────────────────── */

/**
 * Returns the main display text.
 *
 * The current value (as typed or formatted) with thousands separators, or null while
 * the calculator is in the error state so the caller can show a localized "Error".
 *
 * @param {CalcState} s - Calculator state.
 * @returns {string | null} The grouped display text, or null on error.
 *
 * @example
 * displayText(calculate(initialState, { type: 'paste', value: 1234 })); // "1,234"
 */
export function displayText(s: CalcState): string | null {
  if (s.error) return null;
  return groupDigits(shown(s));
}

/**
 * Returns the small expression line shown above the result.
 *
 * While an expression is pending this is the tape, followed by the current value unless
 * the last input was an operator or a closed group. After "=" it shows the completed
 * calculation until a new number is typed. It is empty in the error state.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {string} The expression text (may be empty).
 *
 * @example
 * expressionText(s); // e.g. "2+3×4"
 */
export function expressionText(s: CalcState): string {
  if (s.error) return '';
  if (s.tape) return s.awaitingOperand || s.closed ? s.tape : s.tape + groupDigits(shown(s));
  return s.entry === null ? s.history : '';
}

/**
 * Returns the label of the clear key.
 *
 * "C" when something was entered since the last operator (and there is no error),
 * otherwise "AC".
 *
 * @param {CalcState} s - Calculator state.
 * @returns {'AC' | 'C'} The clear key's label.
 *
 * @example
 * clearLabel(initialState); // "AC"
 */
export const clearLabel = (s: CalcState): 'AC' | 'C' => (s.touched && !s.error ? 'C' : 'AC');

/**
 * Returns the operator key shown in its selected (inverted) state.
 *
 * That is the pending operator while the calculator waits for its right operand;
 * null once a number is being entered or nothing is pending.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {BinOp | null} The highlighted operator, or null.
 *
 * @example
 * highlightedOp(calculate(s, { type: 'op', op: '*' })); // "*"
 */
export function highlightedOp(s: CalcState): BinOp | null {
  if (!s.awaitingOperand) return null;
  const f = currentFrame(s);
  return f.length ? (f[f.length - 1] as BinOp) : null;
}

/**
 * Returns the raw value for the clipboard.
 *
 * The entry as typed or the formatted value, without digit grouping; empty in the
 * error state.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {string} Text to copy (may be empty).
 *
 * @example
 * clipboardText(calculate(initialState, { type: 'paste', value: 1234.5 })); // "1234.5"
 */
export function clipboardText(s: CalcState): string {
  if (s.error) return '';
  return s.entry ?? formatNumber(s.value);
}

/**
 * Parses pasted text into a number.
 *
 * Trims the text, removes commas, whitespace and underscores, and turns the Unicode
 * minus sign into "-". Accepts plain decimals and exponential notation; anything else,
 * or a non-finite result, yields null.
 *
 * @param {string} text - Clipboard text.
 * @returns {number | null} The parsed number, or null when the text is not a number.
 *
 * @example
 * parsePasted('1,234.5'); // 1234.5
 * parsePasted(' -3e4 '); // -30000
 * parsePasted('abc'); // null
 */
export function parsePasted(text: string): number | null {
  const cleaned = text.trim().replace(/[,\s_]/g, '').replace(/−/g, '-');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns how many parentheses are currently open.
 *
 * Every open parenthesis adds one frame on top of the top-level frame.
 *
 * @param {CalcState} s - Calculator state.
 * @returns {number} The number of unclosed "(".
 *
 * @example
 * openParens(calculate(initialState, { type: 'paren', open: true })); // 1
 */
export const openParens = (s: CalcState) => s.frames.length - 1;

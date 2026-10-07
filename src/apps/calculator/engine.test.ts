import { describe, expect, it } from 'vitest';
import {
  calculate,
  clearLabel,
  clipboardText,
  displayText,
  expressionText,
  formatNumber,
  groupDigits,
  highlightedOp,
  initialState,
  parsePasted,
  type BinOp,
  type CalcAction,
  type CalcState,
} from './engine';

/**
 * Feeds a key sequence to the calculator reducer.
 *
 * Each character becomes one action: digits, ".", "+", "-", "*", "/", "^" (power), "=",
 * "%", "n" (±), "c" (the clear key), "<" (backspace), "(" and ")". The actions are applied
 * in order starting from `from`.
 *
 * @param {string} keys - Key sequence such as "2+3*4=".
 * @param {CalcState} [from=initialState] - State to start from.
 * @returns {CalcState} The state after the last key.
 * @throws {Error} When the sequence contains an unknown key character.
 *
 * @example
 * const s = press('2+3*4=');
 * console.log(displayText(s)); // "14"
 */
function press(keys: string, from: CalcState = initialState): CalcState {
  let s = from;
  for (const k of keys) {
    let a: CalcAction;
    if (/[0-9]/.test(k)) a = { type: 'digit', digit: k };
    else if (k === '.') a = { type: 'decimal' };
    else if ('+-*/'.includes(k)) a = { type: 'op', op: k as BinOp };
    else if (k === '^') a = { type: 'op', op: 'pow' };
    else if (k === '=') a = { type: 'equals' };
    else if (k === '%') a = { type: 'percent' };
    else if (k === 'n') a = { type: 'negate' };
    else if (k === 'c') a = { type: 'clear' };
    else if (k === '<') a = { type: 'backspace' };
    else if (k === '(') a = { type: 'paren', open: true };
    else if (k === ')') a = { type: 'paren', open: false };
    else throw new Error(`unknown key ${k}`);
    s = calculate(s, a);
  }
  return s;
}

/**
 * Returns the display text after a key sequence.
 *
 * Runs the keys through `press` and formats the resulting state with `displayText`.
 *
 * @param {string} keys - Key sequence such as "2+3*4=".
 * @param {CalcState} [from] - State to start from (the initial state when omitted).
 * @returns {string | null} The grouped display text, or null in the error state.
 * @throws {Error} When the sequence contains an unknown key character.
 *
 * @example
 * show('1234567'); // "1,234,567"
 */
const show = (keys: string, from?: CalcState) => displayText(press(keys, from));

describe('calculator engine', () => {
  it('enters numbers with grouping and a single decimal point', () => {
    expect(show('1234567')).toBe('1,234,567');
    expect(show('0012')).toBe('12');
    expect(show('.5')).toBe('0.5');
    expect(show('1..2.3')).toBe('1.23');
    expect(show('12.')).toBe('12.');
  });

  it('respects operator precedence', () => {
    expect(show('2+3*4=')).toBe('14');
    expect(show('2*3+4=')).toBe('10');
    expect(show('10-4/2=')).toBe('8');
    expect(show('2+3*4-5=')).toBe('9');
  });

  it('shows intermediate results like macOS', () => {
    expect(show('2*3+')).toBe('6');
    expect(show('2+3*')).toBe('3');
    expect(show('2+3+')).toBe('5');
  });

  it('replaces an operator pressed twice', () => {
    expect(show('2+*3=')).toBe('6');
    expect(show('2+3*-1=')).toBe('4');
    expect(highlightedOp(press('2+3*'))).toBe('*');
    expect(highlightedOp(press('2+3*4'))).toBeNull();
  });

  it('repeats the last operation on repeated =', () => {
    expect(show('2+3==')).toBe('8');
    expect(show('2+3===')).toBe('11');
    expect(show('2*3==')).toBe('18');
    expect(show('2+3*4==')).toBe('56');
    // A new number followed by = reuses the last operation.
    expect(show('2+3=7=')).toBe('10');
    // "5 + =" uses the displayed value as the second operand.
    expect(show('5+=')).toBe('10');
  });

  it('handles percent', () => {
    expect(show('50%')).toBe('0.5');
    expect(show('200+10%')).toBe('20');
    expect(show('200+10%=')).toBe('220');
    expect(show('200-10%=')).toBe('180');
    expect(show('200*10%=')).toBe('20');
  });

  it('toggles the sign', () => {
    expect(show('5n')).toBe('-5');
    expect(show('5nn')).toBe('5');
    expect(show('3+n')).toBe('-0');
    expect(show('3+n2=')).toBe('1');
    expect(show('2+3=n')).toBe('-5');
  });

  it('C clears the entry, AC clears everything', () => {
    const s = press('2+3');
    expect(clearLabel(s)).toBe('C');
    const c = press('c', s);
    expect(displayText(c)).toBe('0');
    expect(clearLabel(c)).toBe('AC');
    expect(highlightedOp(c)).toBe('+');
    expect(show('5=', c)).toBe('7');
    const ac = press('c', c);
    expect(ac).toEqual(initialState);
  });

  it('backspace deletes the last typed digit only', () => {
    expect(show('123<')).toBe('12');
    expect(show('1<')).toBe('0');
    expect(show('5n<')).toBe('0');
    expect(show('2+3=<')).toBe('5');
  });

  it('cleans floating point noise', () => {
    expect(show('.1+.2=')).toBe('0.3');
    expect(show('1/3*3=')).toBe('1');
    expect(show('1.1*1.1=')).toBe('1.21');
  });

  it('reports division by zero and recovers', () => {
    const s = press('5/0=');
    expect(s.error).toBe(true);
    expect(displayText(s)).toBeNull();
    expect(press('+', s).error).toBe(true);
    expect(show('7', s)).toBe('7');
    expect(press('c', s).error).toBe(false);
  });

  it('uses exponential notation for huge and tiny numbers', () => {
    expect(show('999999999*999999999=')).toBe('9.99999998e17');
    expect(formatNumber(1e21)).toBe('1e21');
    expect(formatNumber(1.5e-12)).toBe('1.5e-12');
    expect(formatNumber(123456789012345)).toBe('123456789012345');
    expect(formatNumber(-0.000001)).toBe('-0.000001');
  });

  it('limits typed digits', () => {
    expect(show('1234567890123456789')).toBe('123,456,789,012,345');
  });

  it('evaluates parentheses', () => {
    expect(show('(2+3)*4=')).toBe('20');
    expect(show('2*(3+4)=')).toBe('14');
    expect(show('2*(3+4')).toBe('4');
    expect(show('2*(3+4=')).toBe('14');
    expect(show('(2+3)(1+1)=')).toBe('10');
    expect(show('2^3^2=')).toBe('512');
  });

  it('builds the expression line', () => {
    expect(expressionText(press('2+3*4'))).toBe('2+3×4');
    expect(expressionText(press('2+3*4='))).toBe('2+3×4');
    expect(expressionText(press('2*(3+4)'))).toBe('2×(3+4)');
    expect(expressionText(press('1234+'))).toBe('1,234+');
    expect(expressionText(press('2+3=5'))).toBe('');
  });

  it('applies scientific functions', () => {
    /**
     * Reads the display text of a state.
     *
     * Shorthand for `displayText`.
     *
     * @param {CalcState} s - Calculator state.
     * @returns {string | null} The grouped display text, or null in the error state.
     *
     * @example
     * v(calculate(press('9'), { type: 'fn', fn: 'sqrt' })); // "3"
     */
    const v = (s: CalcState) => displayText(s);
    expect(v(calculate(press('9'), { type: 'fn', fn: 'sqrt' }))).toBe('3');
    expect(v(calculate(press('30'), { type: 'fn', fn: 'sin' }))).toBe('0.5');
    expect(v(calculate(press('180'), { type: 'fn', fn: 'sin' }))).toBe('0');
    expect(v(calculate(press('5'), { type: 'fn', fn: 'fact' }))).toBe('120');
    expect(calculate(press('90'), { type: 'fn', fn: 'tan' }).error).toBe(true);
    expect(calculate(press('5n'), { type: 'fn', fn: 'sqrt' }).error).toBe(true);
    const rad = calculate(initialState, { type: 'angle' });
    expect(rad.angle).toBe('rad');
    expect(v(calculate(calculate(rad, { type: 'const', value: Math.PI / 2 }), { type: 'fn', fn: 'sin' }))).toBe('1');
  });

  it('keeps a memory register', () => {
    let s = press('5');
    s = calculate(s, { type: 'memory', op: 'm+' });
    s = press('3', s);
    s = calculate(s, { type: 'memory', op: 'm+' });
    s = calculate(press('c', s), { type: 'memory', op: 'mr' });
    expect(displayText(s)).toBe('8');
    s = calculate(s, { type: 'memory', op: 'mc' });
    expect(s.memory).toBeNull();
  });

  it('copies and pastes plain numbers', () => {
    expect(clipboardText(press('1234.5'))).toBe('1234.5');
    expect(parsePasted('1,234.5')).toBe(1234.5);
    expect(parsePasted(' -3e4 ')).toBe(-30000);
    expect(parsePasted('abc')).toBeNull();
    expect(displayText(calculate(initialState, { type: 'paste', value: 42 }))).toBe('42');
  });

  it('groups digits', () => {
    expect(groupDigits('-1234567.891')).toBe('-1,234,567.891');
    expect(groupDigits('1e21')).toBe('1e21');
  });
});

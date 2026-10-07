import { describe, expect, it } from 'vitest';
import { calculate, convert, evaluate, formatNumber } from './calc';

describe('evaluate', () => {
  it('respects precedence and associativity', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluate('-2 ^ 2')).toBe(-4);
    expect(evaluate('2 ^ -1')).toBe(0.5);
    expect(evaluate('10 - 4 - 3')).toBe(3);
    expect(evaluate('100 / 10 / 5')).toBe(2);
  });

  it('supports decimals, modulo, percent and factorial', () => {
    expect(evaluate('.5 + 1.25')).toBe(1.75);
    expect(evaluate('7 % 3')).toBe(1);
    expect(evaluate('50%')).toBe(0.5);
    expect(evaluate('200 * 15%')).toBeCloseTo(30);
    expect(evaluate('5!')).toBe(120);
    expect(evaluate('1e3 + 1')).toBe(1001);
  });

  it('supports functions, constants and implicit multiplication', () => {
    expect(evaluate('sqrt(16)')).toBe(4);
    expect(evaluate('sqrt 16')).toBe(4);
    expect(evaluate('abs(-3)')).toBe(3);
    expect(evaluate('log(1000)')).toBeCloseTo(3);
    expect(evaluate('ln(e)')).toBeCloseTo(1);
    expect(evaluate('sin(pi / 2)')).toBeCloseTo(1);
    expect(evaluate('cos(0)')).toBe(1);
    expect(evaluate('tan(0)')).toBe(0);
    expect(evaluate('2pi')).toBeCloseTo(Math.PI * 2);
    expect(evaluate('3(1 + 2)')).toBe(9);
    expect(evaluate('(1 + 1)(2 + 2)')).toBe(8);
    expect(evaluate('2 × 3 ÷ 4 − 1')).toBe(0.5);
  });

  it('rejects malformed input', () => {
    expect(() => evaluate('1 +')).toThrow();
    expect(() => evaluate('(1 + 2')).toThrow();
    expect(() => evaluate('foo(2)')).toThrow();
    expect(() => evaluate('2 $ 3')).toThrow();
  });
});

describe('calculate', () => {
  it('only treats math-looking queries as math', () => {
    expect(calculate('42')).toBeNull();
    expect(calculate('e')).toBeNull();
    expect(calculate('safari')).toBeNull();
    expect(calculate('1/0')).toBeNull();
    expect(calculate('2+2')?.display).toBe('4');
    expect(calculate('=6*7')?.plain).toBe('42');
    expect(calculate('pi')?.display).toBe('3.1415926536');
  });

  it('formats large and small numbers', () => {
    expect(calculate('1000 * 1234.5')?.display).toBe('1,234,500');
    expect(calculate('0.1 + 0.2')?.plain).toBe('0.3');
    expect(formatNumber(1e20)).toBe('1e+20');
  });
});

describe('convert', () => {
  it('converts between compatible units', () => {
    expect(convert('10 km to mi')?.display).toBe('6.21371');
    expect(convert('212 f in c')?.display).toBe('100');
    expect(convert('1 kg')?.to).toBe('2.20462 lb');
    expect(convert('0 c to k')?.display).toBe('273.15');
  });

  it('rejects incompatible or unknown units', () => {
    expect(convert('10 km to kg')).toBeNull();
    expect(convert('10 apples')).toBeNull();
    expect(convert('km')).toBeNull();
  });
});

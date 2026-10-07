import { describe, expect, it } from 'vitest';
import { applyLineStyle, caretPosition, lineRange, lineStyleOf, listContinuation, textStats, toggleChecked } from './editing';
import { findMatches, matchIndexFrom, replaceAllText } from './find';

describe('find', () => {
  it('finds case-insensitively by default', () => {
    expect(findMatches('Foo foo FOO', 'foo')).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
    expect(findMatches('Foo foo FOO', 'foo', true)).toEqual([[4, 7]]);
  });

  it('treats the query literally', () => {
    expect(findMatches('a.b axb (a.b)', 'a.b')).toEqual([
      [0, 3],
      [9, 12],
    ]);
    expect(findMatches('anything', '')).toEqual([]);
  });

  it('picks the match at or after an offset, wrapping', () => {
    const m = findMatches('x--x--x', 'x');
    expect(matchIndexFrom(m, 1)).toBe(1);
    expect(matchIndexFrom(m, 7)).toBe(0);
    expect(matchIndexFrom([], 3)).toBe(-1);
  });

  it('replaces all with literal $ sequences', () => {
    expect(replaceAllText('cat Cat', 'cat', '$&!')).toEqual({ text: '$&! $&!', count: 2 });
    expect(replaceAllText('한글 한글', '한글', '영어')).toEqual({ text: '영어 영어', count: 2 });
  });
});

describe('editing helpers', () => {
  it('computes line ranges', () => {
    const v = 'one\ntwo\nthree';
    expect(lineRange(v, 5, 5)).toEqual({ start: 4, end: 7 });
    expect(lineRange(v, 0, 8)).toEqual({ start: 0, end: 7 });
    expect(lineRange(v, 2, 9)).toEqual({ start: 0, end: 13 });
  });

  it('computes caret position and stats', () => {
    expect(caretPosition('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
    expect(textStats('hello world\n안녕 😀')).toEqual({ words: 4, chars: 16, lines: 2 });
    expect(textStats('')).toEqual({ words: 0, chars: 0, lines: 1 });
  });

  it('applies and toggles paragraph styles', () => {
    expect(applyLineStyle('task', 'checklist')).toBe('- [ ] task');
    expect(applyLineStyle('- [ ] task', 'checklist')).toBe('task');
    expect(applyLineStyle('## Head', 'title')).toBe('# Head');
    expect(applyLineStyle('  * item', 'number', 2)).toBe('  3. item');
    expect(applyLineStyle('# T', 'body')).toBe('T');
    expect(lineStyleOf('- [x] done')).toBe('checklist');
    expect(lineStyleOf('### Sub')).toBe('subheading');
  });

  it('toggles checkboxes', () => {
    expect(toggleChecked('- [ ] a')).toBe('- [x] a');
    expect(toggleChecked('  - [x] a')).toBe('  - [ ] a');
    expect(toggleChecked('plain')).toBe('plain');
  });

  it('continues lists on Enter', () => {
    expect(listContinuation('- [x] done')).toEqual({ insert: '\n- [ ] ' });
    expect(listContinuation('  9. nine')).toEqual({ insert: '\n  10. ' });
    expect(listContinuation('* ')).toEqual({ end: true });
    expect(listContinuation('plain text')).toBeNull();
  });
});

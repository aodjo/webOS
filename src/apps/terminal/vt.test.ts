import { describe, expect, it } from 'vitest';
import { stripAnsi } from './shell/ansi';
import { VT, encodeKey } from './vt';

/**
 * Returns the screen as plain text rows with trailing spaces removed.
 *
 * @param {VT} vt - The screen.
 * @returns {string[]} One string per row.
 *
 * @example
 * text(vt)[0]; // 'hello'
 */
const text = (vt: VT) => vt.frame(false).map((l) => stripAnsi(l).replace(/ +$/, ''));

describe('VT', () => {
  it('prints, wraps and scrolls', () => {
    const vt = new VT(5, 2);
    vt.write('abcdefg\r\nxy');
    expect(text(vt)).toEqual(['fg', 'xy']);
  });

  it('moves the cursor and erases', () => {
    const vt = new VT(10, 3);
    vt.write('hello\x1b[2;3Hx\x1b[1;2H\x1b[K');
    expect(text(vt)).toEqual(['h', '  x', '']);
    vt.write('\x1b[2J');
    expect(text(vt)).toEqual(['', '', '']);
  });

  it('edits a line like readline does', () => {
    const vt = new VT(20, 1);
    vt.write('# lsx\b\x1b[K\x1b[2D\x1b[@a');
    expect(text(vt)).toEqual(['# als']);
  });

  it('keeps colors and switches to the alternate screen and back', () => {
    const vt = new VT(10, 2);
    vt.write('\x1b[31mred\x1b[0m');
    expect(vt.frame(false)[0]).toContain('\x1b[0;31mred');
    vt.write('\x1b[?1049h\x1b[Hvim');
    expect(text(vt)[0]).toBe('vim');
    vt.write('\x1b[?1049l');
    expect(text(vt)[0]).toBe('red');
  });

  it('answers cursor position reports', () => {
    const replies: string[] = [];
    const vt = new VT(10, 5, (s) => replies.push(s));
    vt.write('\x1b[3;4H\x1b[6n');
    expect(replies).toEqual(['\x1b[3;4R']);
  });
});

describe('encodeKey', () => {
  /**
   * Encodes a key press with the given modifiers.
   *
   * @param {string} k - `KeyboardEvent.key`.
   * @param {Object} [mods={}] - Modifier flags to set.
   * @returns {string | null} The encoded bytes.
   *
   * @example
   * key('c', { ctrlKey: true }); // '\x03'
   */
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => encodeKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('encodes printable, control and named keys', () => {
    expect(key('a')).toBe('a');
    expect(key('c', { ctrlKey: true })).toBe('\x03');
    expect(key(']', { ctrlKey: true })).toBe('\x1d');
    expect(encodeKey({ key: 'Unidentified', code: 'BracketRight', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe('\x1d');
    expect(key('Enter')).toBe('\r');
    expect(key('Backspace')).toBe('\x7f');
    expect(key('ArrowUp')).toBe('\x1b[A');
    expect(key('Tab', { shiftKey: true })).toBe('\x1b[Z');
  });

  it('leaves ⌘ and ⌥ shortcuts alone', () => {
    expect(key('w', { altKey: true })).toBeNull();
    expect(key('k', { metaKey: true })).toBeNull();
  });
});

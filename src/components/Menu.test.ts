import { describe, expect, it } from 'vitest';
import { isAimingAt, isSelectable, placeMenu, pointInTriangle, shortcutLabel, stepIndex, type MenuEntry } from './Menu';

const viewport = { width: 1000, height: 800 }; /** Viewport size shared by the placement tests. */

describe('placeMenu', () => {
  it('opens at the requested point when it fits', () => {
    expect(placeMenu({ x: 100, y: 50, width: 200, height: 300, viewport })).toEqual({ left: 100, top: 50, maxHeight: 792 });
  });

  it('flips left around flipX when there is no room on the right', () => {
    expect(placeMenu({ x: 900, y: 50, width: 200, height: 100, viewport }).left).toBe(700);
    // Submenus flip to the other side of their parent panel.
    expect(placeMenu({ x: 900, y: 50, width: 200, height: 100, flipX: 600, viewport }).left).toBe(400);
  });

  it('shifts instead of flipping when flipping would leave the screen', () => {
    expect(placeMenu({ x: 150, y: 50, width: 300, height: 100, flipX: 100, viewport: { width: 400, height: 800 } }).left).toBe(96);
  });

  it('flips up around the pointer, or shifts up when flipY is null', () => {
    expect(placeMenu({ x: 10, y: 700, width: 100, height: 300, viewport }).top).toBe(400);
    expect(placeMenu({ x: 10, y: 700, width: 100, height: 300, flipY: null, viewport }).top).toBe(496);
  });

  it('never goes above minTop and limits the height', () => {
    const p = placeMenu({ x: 10, y: 27, width: 100, height: 2000, minTop: 26, flipY: null, viewport });
    expect(p.top).toBe(26);
    expect(p.maxHeight).toBe(800 - 4 - 26);
  });
});

describe('stepIndex', () => {
  const list: MenuEntry[] = [{ label: 'A' }, { separator: true }, { label: 'B', disabled: true }, { heading: true, label: 'H' }, { label: 'C' }];

  it('skips separators, headings and disabled items', () => {
    expect(stepIndex(list, -1, 1)).toBe(0);
    expect(stepIndex(list, 0, 1)).toBe(4);
    expect(stepIndex(list, list.length, -1)).toBe(4);
    expect(stepIndex(list, 4, -1)).toBe(0);
  });

  it('wraps around', () => {
    expect(stepIndex(list, 4, 1)).toBe(0);
  });

  it('returns -1 when nothing is selectable', () => {
    expect(stepIndex([{ separator: true }, { label: 'x', disabled: true }], -1, 1)).toBe(-1);
  });

  it('knows what is selectable', () => {
    expect(isSelectable({ label: 'x' })).toBe(true);
    expect(isSelectable({ custom: null })).toBe(false);
    expect(isSelectable({ info: true, label: 'x' })).toBe(false);
  });
});

describe('menu aim', () => {
  it('detects points inside a triangle', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 0, y: 10 };
    expect(pointInTriangle({ x: 2, y: 2 }, a, b, c)).toBe(true);
    expect(pointInTriangle({ x: 9, y: 9 }, a, b, c)).toBe(false);
  });

  it('treats diagonal movement toward the submenu as aiming', () => {
    const sub = { left: 300, right: 500, top: 100, bottom: 400 };
    expect(isAimingAt({ x: 200, y: 110 }, { x: 220, y: 130 }, sub)).toBe(true);
    // Moving straight down (away from the submenu's edge) is not.
    expect(isAimingAt({ x: 200, y: 110 }, { x: 190, y: 140 }, sub)).toBe(false);
    expect(isAimingAt({ x: 200, y: 110 }, { x: 200, y: 110 }, sub)).toBe(false);
  });
});

describe('shortcutLabel', () => {
  it('hides ⌃ shortcuts on hosts where Ctrl is the command key (they cannot be typed there)', () => {
    expect(shortcutLabel('ctrl+mod+q', false)).toBe('');
    expect(shortcutLabel('ctrl+alt+left', false)).toBe('');
    expect(shortcutLabel('alt+w', false)).not.toBe('');
  });

  it('keeps every shortcut on macOS', () => {
    expect(shortcutLabel('ctrl+mod+q', true)).not.toBe('');
  });
});

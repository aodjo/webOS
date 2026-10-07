import { describe, expect, it } from 'vitest';
import type { WindowState } from '@/kernel/types';
import { computeExposeLayout, exposeArea, selectExposeSlots, type ExposeSlot } from './expose';

const area = { x: 40, y: 130, width: 1360, height: 640 }; /** Layout area shared by the `computeExposeLayout` tests. */

/**
 * Tells whether two slots' rectangles overlap.
 *
 * Edges that only touch do not count as overlapping.
 *
 * @param {ExposeSlot} a - First slot.
 * @param {ExposeSlot} b - Second slot.
 * @returns {boolean} True when the rectangles share any interior area.
 *
 * @example
 * expect(overlaps(slots[0], slots[1])).toBe(false);
 */
function overlaps(a: ExposeSlot, b: ExposeSlot): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Builds a complete `WindowState` for tests.
 *
 * Fills every required field with neutral defaults (a resizable, non-minimized Finder window
 * owned by pid 1) and applies `extra` on top.
 *
 * @param {string} id - Window id (also used as the title).
 * @param {number} x - Left edge.
 * @param {number} y - Top edge.
 * @param {number} width - Window width.
 * @param {number} height - Window height.
 * @param {Partial<WindowState>} [extra={}] - Fields that override the defaults.
 * @returns {WindowState} The window state.
 *
 * @example
 * const minimized = win('b', 300, 200, 600, 400, { minimized: true });
 */
function win(id: string, x: number, y: number, width: number, height: number, extra: Partial<WindowState> = {}): WindowState {
  return {
    id,
    pid: 1,
    appId: 'finder',
    title: id,
    x,
    y,
    width,
    height,
    minWidth: 100,
    minHeight: 100,
    resizable: true,
    maximizable: true,
    titlebar: 'standard',
    vibrancy: false,
    minimized: false,
    maximized: false,
    tiled: null,
    restoreBounds: null,
    z: 1,
    args: {},
    dirty: false,
    createdAt: 0,
    argsVersion: 0,
    ...extra,
  };
}

describe('computeExposeLayout', () => {
  it('returns nothing for no windows', () => {
    expect(computeExposeLayout([], area)).toEqual([]);
  });

  it('lays out many windows without overlaps, inside the area, preserving aspect ratios', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, x: (i * 97) % 900, y: 30 + ((i * 53) % 400), width: 500 + i * 30, height: 360 + ((i * 17) % 120) }));
    const slots = computeExposeLayout(items, area);
    expect(slots).toHaveLength(items.length);
    slots.forEach((a, i) => {
      expect(a.id).toBe(items[i].id);
      expect(a.x).toBeGreaterThanOrEqual(area.x - 1);
      expect(a.y).toBeGreaterThanOrEqual(area.y - 1);
      expect(a.x + a.width).toBeLessThanOrEqual(area.x + area.width + 1);
      expect(a.y + a.height).toBeLessThanOrEqual(area.y + area.height + 1);
      expect(a.width / a.height).toBeCloseTo(items[i].width / items[i].height, 1);
      slots.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false));
    });
  });

  it('never enlarges windows past the max scale', () => {
    const [slot] = computeExposeLayout([{ id: 'a', x: 0, y: 0, width: 200, height: 150 }], area);
    expect(slot.scale).toBeLessThanOrEqual(0.9);
    expect(Math.abs(slot.x + slot.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(1);
  });

  it('keeps the left/right arrangement of side-by-side windows', () => {
    const slots = computeExposeLayout(
      [
        { id: 'right', x: 800, y: 100, width: 600, height: 500 },
        { id: 'left', x: 10, y: 120, width: 600, height: 500 },
      ],
      area,
    );
    const byId = Object.fromEntries(slots.map((s) => [s.id, s]));
    expect(byId.left.x).toBeLessThan(byId.right.x);
  });
});

describe('selectExposeSlots', () => {
  const screen = { width: 1440, height: 900 };
  const ws = { x: 0, y: 26, width: 1440, height: 798 };

  it('skips minimized windows and hidden apps, and is memoized', () => {
    const windows = [win('a', 10, 40, 600, 400), win('b', 300, 200, 600, 400, { minimized: true }), win('c', 500, 100, 500, 300, { appId: 'notes' })];
    const processes = [
      { pid: 1, appId: 'finder', startedAt: 0, hidden: false },
      { pid: 2, appId: 'notes', startedAt: 0, hidden: true },
    ];
    const state = { windows, processes };
    const slots = selectExposeSlots(state, screen, ws);
    expect([...slots.keys()]).toEqual(['a']);
    expect(selectExposeSlots(state, screen, ws)).toBe(slots);
    expect(selectExposeSlots({ windows: [...windows], processes }, screen, ws)).not.toBe(slots);
  });

  it('lays out below the Spaces bar', () => {
    expect(exposeArea(screen, ws).y).toBeGreaterThan(ws.y + 60);
  });
});

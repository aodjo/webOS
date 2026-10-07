import { describe, expect, it } from 'vitest';
import { bellSum, clampShift, fitIconSize, gapFor, insertionIndex, magnifiedSizes, moveTo, panelShift, restCenters, restLength, type SlotSpec } from './dockGeometry';

/**
 * Creates `n` identical magnifying icon slots.
 *
 * Every slot gets the same base length and `magnify: true`, matching a dock of icons with no
 * separators.
 *
 * @param {number} n - Number of slots.
 * @param {number} [len=50] - Base length of each slot.
 * @returns {SlotSpec[]} The slots.
 *
 * @example
 * const slots = icons(3); // three 50px icons
 */
const icons = (n: number, len = 50): SlotSpec[] => Array.from({ length: n }, () => ({ len, magnify: true }));

describe('rest layout', () => {
  it('centers the panel around the given center', () => {
    const slots = icons(3);
    expect(restLength(slots, 4, 6)).toBe(6 * 2 + 150 + 8);
    const c = restCenters(slots, 4, 6, 500);
    expect(c[1]).toBe(500);
    expect(c[2] - c[1]).toBe(54);
  });
});

describe('magnification', () => {
  it('peaks under the pointer and falls off symmetrically', () => {
    const slots = icons(7);
    const centers = restCenters(slots, 0, 0, 0);
    const sizes = magnifiedSizes(slots, centers, centers[3], 50, 100, 150);
    expect(sizes[3]).toBe(100);
    expect(sizes[2]).toBeCloseTo(sizes[4]);
    expect(sizes[2]).toBeLessThan(100);
    expect(sizes[0]).toBe(50);
  });

  it('does not magnify separators or when the pointer is away', () => {
    const slots: SlotSpec[] = [{ len: 50, magnify: true }, { len: 13, magnify: false }];
    const centers = restCenters(slots, 0, 0, 0);
    expect(magnifiedSizes(slots, centers, centers[1], 50, 100, 150)[1]).toBe(13);
    expect(magnifiedSizes(slots, centers, null, 50, 100, 150)).toEqual([50, 13]);
  });

  it('keeps the content under the pointer stationary', () => {
    const slots = icons(5);
    const centers = restCenters(slots, 0, 0, 0);
    const pointer = centers[1] + 10;
    const sizes = magnifiedSizes(slots, centers, pointer, 50, 90, 150);
    const shift = panelShift(slots, centers, sizes, pointer);
    // Rebuild the magnified layout (centered flex + shift) and locate the pointer's content.
    const total = sizes.reduce((a, b) => a + b, 0);
    const start = -total / 2 + shift;
    const restStart = -restLength(slots, 0, 0) / 2;
    const restOffsetInSlot1 = pointer - (restStart + 50);
    const slot1Start = start + sizes[0];
    const magnifiedPos = slot1Start + (restOffsetInSlot1 / 50) * sizes[1];
    expect(magnifiedPos).toBeCloseTo(pointer);
  });
});

describe('fitting the magnified dock on screen', () => {
  it('bounds the total growth by the cosine bell sum', () => {
    const slots = icons(15);
    const centers = restCenters(slots, 2, 0, 0);
    const k = bellSum(52, 150);
    for (const p of [centers[7], centers[7] + 13, centers[7] + 26]) {
      const extra = magnifiedSizes(slots, centers, p, 50, 90, 150).reduce((sum, s) => sum + s - 50, 0);
      expect(extra).toBeLessThanOrEqual(k * 40 + 1e-6);
    }
    expect(k).toBeGreaterThan(2);
    expect(k).toBeLessThan(4);
  });

  it('keeps the panel inside the screen bounds', () => {
    // Panel of 400 centered at 250 grown by 100 → 500 wide, screen [0, 600].
    expect(clampShift(-200, 400, 100, 250, 0, 600)).toBe(0);
    expect(clampShift(200, 400, 100, 250, 0, 600)).toBe(100);
    expect(clampShift(30, 400, 100, 250, 0, 600)).toBe(30);
    // Too long to fit: centered in the bounds.
    expect(clampShift(50, 600, 100, 250, 0, 600)).toBe(50);
  });
});

describe('fitIconSize', () => {
  it('keeps the wanted size when it fits and shrinks otherwise', () => {
    expect(fitIconSize(52, 10, 13, 11, 6, 2000, 0.05)).toBe(52);
    const s = fitIconSize(52, 20, 13, 21, 6, 600, 0.05);
    expect(s).toBeLessThan(52);
    expect(6 * 2 + 13 + s * 20 + gapFor(s, 0.05) * 20).toBeLessThanOrEqual(600);
  });

  it('goes below 24px when the caller allows it (a phone-width Dock)', () => {
    // 15 icons + separator in a 390px screen (minus margins and slack): 24px would be 403px long.
    const s = fitIconSize(44, 15, 13, 16, 6, 390 - 12 - 16, 0.05, 14);
    expect(s).toBeLessThan(24);
    expect(6 * 2 + 13 + s * 15 + gapFor(s, 0.05) * 15).toBeLessThanOrEqual(390 - 12 - 16);
    expect(fitIconSize(44, 15, 13, 16, 6, 100, 0.05, 14)).toBe(14);
  });
});

describe('reordering', () => {
  it('computes clamped insertion indices', () => {
    expect(insertionIndex(0, 0, 50, 1, 5)).toBe(1);
    expect(insertionIndex(160, 0, 50, 1, 5)).toBe(3);
    expect(insertionIndex(9999, 0, 50, 1, 5)).toBe(5);
  });

  it('moves an item to an index', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });
});

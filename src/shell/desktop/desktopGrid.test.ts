import { describe, expect, it } from 'vitest';
import { arrange, cellAtPoint, cellOrigin, gridMetrics, gridOrder, layoutIcons, moveGroup, nearestFree, neighbor, occupiedCells, placeFrom, CELL_H, CELL_W, type GridMetrics } from './desktopGrid';

const m: GridMetrics = { right: 1000, top: 30, cols: 4, rows: 3 }; /** A 4×3 test grid whose right edge is at x=1000 and first row at y=30. */

describe('gridMetrics', () => {
  it('fits whole cells into the work area', () => {
    const g = gridMetrics({ x: 0, y: 26, width: 1440, height: 800 });
    expect(g.rows).toBe(Math.floor((800 - 10) / CELL_H));
    expect(g.cols).toBe(Math.floor((1440 - 8) / CELL_W));
    expect(g.right).toBe(1432);
    expect(g.top).toBe(32);
  });

  it('always has at least one cell', () => {
    const g = gridMetrics({ x: 0, y: 0, width: 10, height: 10 });
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(1);
  });
});

describe('cell geometry', () => {
  it('maps cells to positions from the top-right', () => {
    expect(cellOrigin(m, { col: 0, row: 0 })).toEqual({ x: 1000 - CELL_W, y: 30 });
    expect(cellOrigin(m, { col: 1, row: 2 })).toEqual({ x: 1000 - 2 * CELL_W, y: 30 + 2 * CELL_H });
  });

  it('finds the cell under a point and clamps to the grid', () => {
    expect(cellAtPoint(m, 995, 35)).toEqual({ col: 0, row: 0 });
    expect(cellAtPoint(m, 1000 - CELL_W - 1, 30 + CELL_H + 1)).toEqual({ col: 1, row: 1 });
    expect(cellAtPoint(m, -500, 5000)).toEqual({ col: 3, row: 2 });
  });
});

describe('layoutIcons', () => {
  it('keeps saved positions and fills the rest top-right first, column by column', () => {
    const layout = layoutIcons(
      [
        { path: 'a', x: 0, y: 1 },
        { path: 'b' },
        { path: 'c' },
        { path: 'd', x: 2, y: 2 },
      ],
      m,
    );
    expect(layout.get('a')).toEqual({ col: 0, row: 1 });
    expect(layout.get('b')).toEqual({ col: 0, row: 0 });
    expect(layout.get('c')).toEqual({ col: 0, row: 2 });
    expect(layout.get('d')).toEqual({ col: 2, row: 2 });
  });

  it('re-flows collisions and off-screen positions', () => {
    const layout = layoutIcons(
      [
        { path: 'a', x: 0, y: 0 },
        { path: 'b', x: 0, y: 0 },
        { path: 'c', x: 9, y: 9 },
        { path: 'd', x: 1.5, y: 0 },
      ],
      m,
    );
    expect(layout.get('a')).toEqual({ col: 0, row: 0 });
    expect(layout.get('b')).toEqual({ col: 0, row: 1 });
    expect(layout.get('c')).toEqual({ col: 0, row: 2 });
    expect(layout.get('d')).toEqual({ col: 1, row: 0 });
  });

  it('flows unplaced items from a drop cell when asked', () => {
    const layout = layoutIcons([{ path: 'a', x: 1, y: 1 }, { path: 'b' }, { path: 'c' }], m, { col: 1, row: 1 });
    expect(layout.get('a')).toEqual({ col: 1, row: 1 });
    expect(layout.get('b')).toEqual({ col: 1, row: 2 });
    expect(layout.get('c')).toEqual({ col: 2, row: 0 });
  });

  it('overflows past the visible columns when the screen is full', () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ path: `p${i}` }));
    const layout = layoutIcons(items, m);
    expect(layout.get('p12')).toEqual({ col: 4, row: 0 });
  });
});

describe('placement', () => {
  it('nearestFree returns the wanted cell when free, otherwise a close one', () => {
    const taken = new Set(['0,0']);
    expect(nearestFree({ col: 1, row: 1 }, taken, m)).toEqual({ col: 1, row: 1 });
    expect(nearestFree({ col: 0, row: 0 }, taken, m)).toEqual({ col: 0, row: 1 });
  });

  it('placeFrom lays new items down the column from the drop point', () => {
    const cells = placeFrom(3, { col: 1, row: 1 }, new Set(['1,2']), m);
    expect(cells).toEqual([
      { col: 1, row: 1 },
      { col: 2, row: 0 },
      { col: 2, row: 1 },
    ]);
  });

  it('moveGroup keeps relative positions and avoids other icons', () => {
    const layout = new Map([
      ['a', { col: 0, row: 0 }],
      ['b', { col: 0, row: 1 }],
      ['x', { col: 2, row: 1 }],
    ]);
    const moved = moveGroup(['a', 'b'], 'a', { col: 2, row: 0 }, layout, m);
    expect(moved.get('a')).toEqual({ col: 2, row: 0 });
    // b's shifted cell (2,1) belongs to x, so b takes the nearest free cell instead.
    expect(moved.get('b')).not.toEqual({ col: 2, row: 1 });
    expect(occupiedCells(layout, ['a', 'b']).has('2,1')).toBe(true);
  });

  it('arrange and gridOrder round-trip', () => {
    const order = ['c', 'a', 'b', 'd'];
    const layout = arrange(order, m);
    expect(layout.get('d')).toEqual({ col: 1, row: 0 });
    expect(gridOrder(layout, m)).toEqual(order);
  });
});

describe('neighbor', () => {
  const layout = new Map([
    ['a', { col: 0, row: 0 }],
    ['b', { col: 0, row: 1 }],
    ['c', { col: 1, row: 1 }],
    ['d', { col: 2, row: 0 }],
  ]);

  it('moves within a column', () => {
    expect(neighbor(layout, { col: 0, row: 0 }, 'down')).toBe('b');
    expect(neighbor(layout, { col: 0, row: 1 }, 'up')).toBe('a');
    expect(neighbor(layout, { col: 0, row: 1 }, 'down')).toBeNull();
  });

  it('moves across columns (left = higher column index)', () => {
    expect(neighbor(layout, { col: 0, row: 1 }, 'left')).toBe('c');
    expect(neighbor(layout, { col: 1, row: 1 }, 'left')).toBe('d');
    expect(neighbor(layout, { col: 2, row: 0 }, 'right')).toBe('c');
    expect(neighbor(layout, { col: 0, row: 0 }, 'right')).toBeNull();
  });
});

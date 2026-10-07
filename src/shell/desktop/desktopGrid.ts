/**
 * Desktop icon grid. Cells are addressed like Finder stores them in `node.meta`:
 * `col` counts from the right edge of the screen, `row` from the top. Icons fill the grid top-right
 * first, downward, then the next column to the left.
 */
import type { Bounds } from '@/kernel';

export const CELL_W = 90; /** Width of one grid cell, in pixels. */
export const CELL_H = 100; /** Height of one grid cell, in pixels. */
const PAD_TOP = 6; /** Gap between the top of the usable area and the first row, in pixels. */
const PAD_RIGHT = 8; /** Gap between the right edge of the usable area and the first column, in pixels. */
const PAD_BOTTOM = 4; /** Space kept free below the last row, in pixels. */

/** A grid cell address: `col` counts from the right edge, `row` from the top. */
export interface Cell {
  col: number;
  row: number;
}

/** Placement and size of the grid on screen. */
export interface GridMetrics {
  /** Screen x of the grid's right edge. */
  right: number;
  /** Screen y of the first row. */
  top: number;
  /** Number of whole columns that fit on screen. */
  cols: number;
  /** Number of whole rows that fit on screen. */
  rows: number;
}

/** An icon to lay out, with its saved cell (if any). */
export interface Positioned {
  /** File system path of the item. */
  path: string;
  /** Saved column (counted from the right), from `node.meta.x`. */
  x?: number;
  /** Saved row (counted from the top), from `node.meta.y`. */
  y?: number;
}

/** An arrow-key direction on screen. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Clamps a number into an inclusive range.
 *
 * Used to keep computed column and row indices inside the visible grid.
 *
 * @param {number} v - Value to clamp.
 * @param {number} lo - Lower bound.
 * @param {number} hi - Upper bound.
 * @returns {number} `v` limited to `[lo, hi]`.
 *
 * @example
 * clamp(7, 0, 3); // 3
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Serializes a cell into a string key for use in sets and maps.
 *
 * Cells are plain objects, so occupancy sets store this "col,row" string instead.
 *
 * @param {Cell} c - The cell.
 * @returns {string} The key in the form "col,row".
 *
 * @example
 * cellKey({ col: 2, row: 1 }); // '2,1'
 */
export const cellKey = (c: Cell) => `${c.col},${c.row}`;

/**
 * Computes the grid for the usable screen area (menu bar and Dock excluded).
 *
 * The grid is anchored to the area's right edge (minus a small padding) and its top (plus a
 * small padding), and holds as many whole cells as fit. It always has at least one column and
 * one row, even when the area is smaller than a cell.
 *
 * @param {Bounds} area - The usable screen rectangle.
 * @returns {GridMetrics} The grid's right edge, top, and column/row counts.
 *
 * @example
 * const m = gridMetrics({ x: 0, y: 26, width: 1440, height: 800 });
 */
export function gridMetrics(area: Bounds): GridMetrics {
  return {
    right: area.x + area.width - PAD_RIGHT,
    top: area.y + PAD_TOP,
    cols: Math.max(1, Math.floor((area.width - PAD_RIGHT) / CELL_W)),
    rows: Math.max(1, Math.floor((area.height - PAD_TOP - PAD_BOTTOM) / CELL_H)),
  };
}

/**
 * Computes the top-left screen position of a cell.
 *
 * Columns grow leftward from the grid's right edge; rows grow downward from its top.
 *
 * @param {GridMetrics} m - Grid metrics.
 * @param {Cell} c - The cell.
 * @returns {{ x: number; y: number }} Screen coordinates of the cell's top-left corner.
 *
 * @example
 * cellOrigin(m, { col: 0, row: 0 }); // { x: m.right - CELL_W, y: m.top }
 */
export function cellOrigin(m: GridMetrics, c: Cell): { x: number; y: number } {
  return { x: m.right - (c.col + 1) * CELL_W, y: m.top + c.row * CELL_H };
}

/**
 * Finds the on-screen cell under a point.
 *
 * Points outside the grid are clamped to the nearest edge cell, so the result is always a
 * visible cell.
 *
 * @param {GridMetrics} m - Grid metrics.
 * @param {number} x - Screen x coordinate.
 * @param {number} y - Screen y coordinate.
 * @returns {Cell} The cell containing (or nearest to) the point.
 *
 * @example
 * const cell = cellAtPoint(m, e.clientX, e.clientY);
 */
export function cellAtPoint(m: GridMetrics, x: number, y: number): Cell {
  return {
    col: clamp(Math.floor((m.right - x) / CELL_W), 0, m.cols - 1),
    row: clamp(Math.floor((y - m.top) / CELL_H), 0, m.rows - 1),
  };
}

/**
 * Converts a cell into its column-major index.
 *
 * Indices run down the first (rightmost) column, then continue at the top of the next column
 * to the left.
 *
 * @param {GridMetrics} m - Grid metrics (only `rows` is used).
 * @param {Cell} c - The cell.
 * @returns {number} The cell's index in fill order.
 *
 * @example
 * cellIndex(m, { col: 1, row: 0 }); // m.rows
 */
export const cellIndex = (m: GridMetrics, c: Cell) => c.col * m.rows + c.row;

/**
 * Converts a column-major index back into a cell.
 *
 * Indices beyond the visible grid produce columns past `m.cols - 1`, i.e. off-screen to the left.
 *
 * @param {GridMetrics} m - Grid metrics (only `rows` is used).
 * @param {number} i - Index in fill order.
 * @returns {Cell} The cell at that index.
 *
 * @example
 * cellFromIndex(m, m.rows); // { col: 1, row: 0 }
 */
export const cellFromIndex = (m: GridMetrics, i: number): Cell => ({ col: Math.floor(i / m.rows), row: i % m.rows });

/**
 * Checks whether an item has a usable saved cell.
 *
 * The saved `x`/`y` must both be non-negative integers inside the current grid.
 *
 * @param {Positioned} p - The item with its saved position.
 * @param {GridMetrics} m - Grid metrics.
 * @returns {boolean} True when the saved cell exists and is on screen.
 *
 * @example
 * isSavedCell({ path: '/a', x: 0, y: 1 }, m); // true
 */
const isSavedCell = (p: Positioned, m: GridMetrics) =>
  Number.isInteger(p.x) && Number.isInteger(p.y) && p.x! >= 0 && p.y! >= 0 && p.x! < m.cols && p.y! < m.rows;

/**
 * Resolves the cell of every icon.
 *
 * Saved positions win when they are on screen and not already taken by an earlier item.
 * Everything else (new items, items off-screen after a resize, collisions) flows into the
 * first free cells in column-major order, overflowing past the visible columns when the
 * screen is full. With `flowFrom`, those items instead form a run starting at that cell
 * (used for files being dropped), see `placeFrom`.
 *
 * @param {Positioned[]} items - Items in priority order with their saved positions.
 * @param {GridMetrics} m - Grid metrics.
 * @param {Cell} [flowFrom] - Optional cell where unplaced items start flowing.
 * @returns {Map<string, Cell>} The cell of every item, keyed by path.
 *
 * @example
 * const layout = layoutIcons([{ path: 'a', x: 0, y: 1 }, { path: 'b' }], m);
 * layout.get('b'); // { col: 0, row: 0 }
 */
export function layoutIcons(items: Positioned[], m: GridMetrics, flowFrom?: Cell): Map<string, Cell> {
  const out = new Map<string, Cell>();
  const taken = new Set<string>();
  const rest: Positioned[] = [];
  for (const it of items) {
    const c = { col: it.x!, row: it.y! };
    if (isSavedCell(it, m) && !taken.has(cellKey(c))) {
      out.set(it.path, c);
      taken.add(cellKey(c));
    } else rest.push(it);
  }
  if (flowFrom) {
    const cells = placeFrom(rest.length, flowFrom, taken, m);
    rest.forEach((it, k) => out.set(it.path, cells[k]));
    return out;
  }
  let i = 0;
  for (const it of rest) {
    while (taken.has(cellKey(cellFromIndex(m, i)))) i++;
    const c = cellFromIndex(m, i);
    out.set(it.path, c);
    taken.add(cellKey(c));
  }
  return out;
}

/**
 * Collects the keys of the cells occupied in a layout.
 *
 * Paths listed in `except` are skipped, so their current cells count as free; this lets a
 * group being moved reuse the cells it is leaving.
 *
 * @param {Map<string, Cell>} layout - Cells keyed by path.
 * @param {Iterable<string>} [except=[]] - Paths whose cells are not counted (e.g. icons being moved).
 * @returns {Set<string>} Cell keys ("col,row") of all other items.
 *
 * @example
 * const taken = occupiedCells(layout, ['/Desktop/a.txt']);
 */
export const occupiedCells = (layout: Map<string, Cell>, except: Iterable<string> = []): Set<string> => {
  const skip = new Set(except);
  const out = new Set<string>();
  for (const [p, c] of layout) if (!skip.has(p)) out.add(cellKey(c));
  return out;
};

/**
 * Finds the free cell closest to `want`.
 *
 * Returns `want` itself when it is on screen and free. Otherwise it scans every visible cell
 * and picks the one with the smallest weighted squared distance; horizontal distance is
 * weighted by 1.2 so the search slightly prefers staying in the same column (Finder fills
 * columns first). When the visible grid is full, it returns the first free cell past the
 * visible area, i.e. it overflows to the left.
 *
 * @param {Cell} want - The preferred cell.
 * @param {Set<string>} taken - Keys of occupied cells.
 * @param {GridMetrics} m - Grid metrics.
 * @returns {Cell} The chosen free cell.
 *
 * @example
 * nearestFree({ col: 0, row: 0 }, new Set(['0,0']), m); // { col: 0, row: 1 }
 */
export function nearestFree(want: Cell, taken: Set<string>, m: GridMetrics): Cell {
  if (want.col < m.cols && want.row < m.rows && !taken.has(cellKey(want))) return want;
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let col = 0; col < m.cols; col++) {
    for (let row = 0; row < m.rows; row++) {
      if (taken.has(`${col},${row}`)) continue;
      const d = (col - want.col) ** 2 * 1.2 + (row - want.row) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { col, row };
      }
    }
  }
  if (best) return best;
  let i = m.cols * m.rows;
  while (taken.has(cellKey(cellFromIndex(m, i)))) i++;
  return cellFromIndex(m, i);
}

/**
 * Picks cells for `count` new items dropped at `start`.
 *
 * Walks forward in column-major order from the drop cell (down the column, then on to the
 * next column to the left), skipping occupied cells. Once the end of the visible grid is
 * reached, remaining items take the free cell nearest to `start`. The `taken` set is not
 * modified.
 *
 * @param {number} count - Number of items to place.
 * @param {Cell} start - The drop cell.
 * @param {Set<string>} taken - Keys of cells that are already occupied.
 * @param {GridMetrics} m - Grid metrics.
 * @returns {Cell[]} One cell per item, in order.
 *
 * @example
 * const cells = placeFrom(3, { col: 1, row: 1 }, new Set(['1,2']), m);
 */
export function placeFrom(count: number, start: Cell, taken: Set<string>, m: GridMetrics): Cell[] {
  const occupied = new Set(taken);
  const out: Cell[] = [];
  const total = m.cols * m.rows;
  let i = cellIndex(m, start);
  for (let k = 0; k < count; k++) {
    while (i < total && occupied.has(cellKey(cellFromIndex(m, i)))) i++;
    const c = i < total ? cellFromIndex(m, i) : nearestFree(start, occupied, m);
    occupied.add(cellKey(c));
    out.push(c);
  }
  return out;
}

/**
 * Moves a group of icons so that `anchor` lands on `target`, keeping their relative layout.
 *
 * Every icon is shifted by the anchor's offset and clamped to the visible grid; an icon whose
 * target cell is occupied by an icon outside the group (or by one already placed) takes the
 * nearest free cell instead. The anchor is placed first so it gets its exact target when free.
 * Paths missing from `layout` are skipped.
 *
 * @param {string[]} paths - Paths of the icons being moved.
 * @param {string} anchor - Path of the icon that was dragged.
 * @param {Cell} target - Cell the anchor was dropped on.
 * @param {Map<string, Cell>} layout - Current cells of all icons.
 * @param {GridMetrics} m - Grid metrics.
 * @returns {Map<string, Cell>} New cells for the moved icons; empty when the anchor has no cell.
 *
 * @example
 * const moved = moveGroup(['a', 'b'], 'a', { col: 2, row: 0 }, layout, m);
 */
export function moveGroup(paths: string[], anchor: string, target: Cell, layout: Map<string, Cell>, m: GridMetrics): Map<string, Cell> {
  const from = layout.get(anchor);
  const out = new Map<string, Cell>();
  if (!from) return out;
  const dc = target.col - from.col;
  const dr = target.row - from.row;
  const taken = occupiedCells(layout, paths);
  for (const p of [anchor, ...paths.filter((x) => x !== anchor)]) {
    const c = layout.get(p);
    if (!c) continue;
    const want = { col: clamp(c.col + dc, 0, m.cols - 1), row: clamp(c.row + dr, 0, m.rows - 1) };
    const got = nearestFree(want, taken, m);
    taken.add(cellKey(got));
    out.set(p, got);
  }
  return out;
}

/**
 * Assigns sequential cells to an ordered list (Clean Up / Sort By).
 *
 * Ignores saved positions entirely and fills the grid in column-major order starting at the
 * top-right cell, overflowing past the visible columns when there are more items than cells.
 *
 * @param {string[]} paths - Paths in the desired order.
 * @param {GridMetrics} m - Grid metrics.
 * @returns {Map<string, Cell>} The i-th path mapped to the i-th cell in column-major order.
 *
 * @example
 * const layout = arrange(['c', 'a', 'b'], m);
 */
export function arrange(paths: string[], m: GridMetrics): Map<string, Cell> {
  return new Map(paths.map((p, i) => [p, cellFromIndex(m, i)]));
}

/**
 * Lists paths in the grid's reading order.
 *
 * Sorts by column-major index, i.e. down each column starting at the top-right.
 *
 * @param {Map<string, Cell>} layout - Cells keyed by path.
 * @param {GridMetrics} m - Grid metrics.
 * @returns {string[]} Paths in reading order.
 *
 * @example
 * gridOrder(arrange(['c', 'a'], m), m); // ['c', 'a']
 */
export function gridOrder(layout: Map<string, Cell>, m: GridMetrics): string[] {
  return [...layout].sort((a, b) => cellIndex(m, a[1]) - cellIndex(m, b[1])).map(([p]) => p);
}

/**
 * Finds the nearest icon from `from` in an arrow-key direction.
 *
 * Up/down only considers icons in the same column and picks the closest one ahead. Left/right
 * considers icons in any column ahead (left means a higher column index, since columns count
 * from the right), preferring the nearest column and then the smallest row difference.
 *
 * @param {Map<string, Cell>} layout - Cells keyed by path.
 * @param {Cell} from - The currently selected cell.
 * @param {Direction} dir - Direction of the arrow key.
 * @returns {string | null} Path of the neighboring icon, or null when there is none.
 *
 * @example
 * const next = neighbor(layout, { col: 0, row: 0 }, 'down');
 */
export function neighbor(layout: Map<string, Cell>, from: Cell, dir: Direction): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [p, c] of layout) {
    const dCol = c.col - from.col;
    const dRow = c.row - from.row;
    let score: number;
    if (dir === 'up' || dir === 'down') {
      const ahead = dir === 'down' ? dRow : -dRow;
      if (dCol !== 0 || ahead <= 0) continue;
      score = ahead;
    } else {
      const ahead = dir === 'left' ? dCol : -dCol;
      if (ahead <= 0) continue;
      score = ahead * 1000 + Math.abs(dRow);
    }
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

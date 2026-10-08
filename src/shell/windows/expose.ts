/**
 * Mission Control (exposé) layout: arranges windows in non-overlapping, justified rows that keep
 * each window's aspect ratio and roughly its on-screen arrangement. Shared by the Window frames
 * (which transform themselves into their slot) and MissionControl (which draws the Spaces bar
 * and the name of the hovered window).
 */
import type { Bounds, Process, WindowState } from '@/kernel/types';
import { clamp, type Size } from './geometry';

/** A window to lay out: its id and its current on-screen rect. */
export interface ExposeItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a window is drawn in Mission Control: the scaled rect (top-left + scaled size). */
export interface ExposeSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Factor applied to the window's real size to get `width`/`height`. */
  scale: number;
}

/** Tuning for `computeExposeLayout`. */
export interface ExposeOptions {
  /** Gap between windows (px). */
  gap: number;
  /** Space reserved under every window for its label. */
  labelHeight: number;
  /** Windows are never drawn larger than this. */
  maxScale: number;
}

const DEFAULTS: ExposeOptions = { gap: 28, labelHeight: 0, maxScale: 0.9 }; /** Layout options used when the caller doesn't override them. */

/**
 * Returns the height of the Spaces bar ("Desktop 1" thumbnail strip) at the top of Mission Control.
 *
 * Short screens (under 640px tall) get a compact bar.
 *
 * @param {Size} screen - The viewport size.
 * @returns {number} The bar height in pixels (76 or 104).
 *
 * @example
 * spacesBarHeight({ width: 1440, height: 900 }); // 104
 */
export function spacesBarHeight(screen: Size): number {
  return screen.height < 640 ? 76 : 104;
}

/**
 * Returns the region windows are laid out in: below the Spaces bar, inside the workspace.
 *
 * Horizontal padding is 4% of the screen width clamped to 16..64px, and 20px is kept free at
 * the bottom. Width and height are at least 1 so the layout never divides by zero.
 *
 * @param {Size} screen - The viewport size.
 * @param {Bounds} ws - The workspace rect.
 * @returns {Bounds} The layout area.
 *
 * @example
 * const area = exposeArea({ width: 1440, height: 900 }, getWorkspace());
 */
export function exposeArea(screen: Size, ws: Bounds): Bounds {
  const padX = clamp(Math.round(screen.width * 0.04), 16, 64);
  const top = ws.y + spacesBarHeight(screen);
  const bottom = ws.y + ws.height - 20;
  return { x: ws.x + padX, y: top, width: Math.max(1, ws.width - padX * 2), height: Math.max(1, bottom - top) };
}

/**
 * Splits `items` (already sorted) into `rows` chunks as evenly as possible.
 *
 * The first `items.length % rows` chunks get one extra item. Empty chunks (when there are more
 * rows than items) are dropped.
 *
 * @template T
 * @param {T[]} items - The items to split, in order.
 * @param {number} rows - The number of chunks to aim for.
 * @returns {T[][]} The non-empty chunks, preserving item order.
 *
 * @example
 * chunk([1, 2, 3, 4, 5], 2); // [[1, 2, 3], [4, 5]]
 */
function chunk<T>(items: T[], rows: number): T[][] {
  const out: T[][] = [];
  const base = Math.floor(items.length / rows);
  const extra = items.length % rows;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const n = base + (r < extra ? 1 : 0);
    out.push(items.slice(i, i + n));
    i += n;
  }
  return out.filter((row) => row.length);
}

/** One possible layout: windows grouped into rows with their scales, and the total drawn area. */
interface Candidate {
  rows: { item: ExposeItem; scale: number }[][];
  area: number;
}

/**
 * Tries laying out `sorted` in `rowCount` rows and scores the result.
 *
 * Each row gets an equal share of the area height (minus gaps and label space). Within a row,
 * windows are ordered left to right by their horizontal center, each window is scaled to the row
 * height (capped at `maxScale`), and the whole row is shrunk uniformly if it is wider than the
 * area. The score is the total on-screen area of all scaled windows.
 *
 * @param {ExposeItem[]} sorted - Windows in reading order.
 * @param {number} rowCount - How many rows to use.
 * @param {Bounds} area - The layout area.
 * @param {ExposeOptions} o - Gap, label height and max scale.
 * @returns {Candidate | null} The candidate layout, or null when rows would be under 24px tall.
 *
 * @example
 * const candidate = tryRows(sorted, 2, area, DEFAULTS);
 */
function tryRows(sorted: ExposeItem[], rowCount: number, area: Bounds, o: ExposeOptions): Candidate | null {
  const rowHeight = (area.height - (rowCount - 1) * o.gap) / rowCount - o.labelHeight;
  if (rowHeight < 24) return null;
  const rows = chunk(sorted, rowCount).map((row) => row.slice().sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2) || a.id.localeCompare(b.id)));
  let total = 0;
  const placed = rows.map((row) => {
    const scales = row.map((it) => Math.min(o.maxScale, rowHeight / it.height));
    const widths = row.reduce((sum, it, i) => sum + it.width * scales[i], 0);
    const room = area.width - (row.length - 1) * o.gap;
    const fit = widths > room ? room / widths : 1;
    return row.map((item, i) => {
      const scale = scales[i] * fit;
      total += item.width * scale * item.height * scale;
      return { item, scale };
    });
  });
  return { rows: placed, area: total };
}

/**
 * Lays out `items` inside `area` for Mission Control.
 *
 * Windows are sorted into reading order (top-to-bottom by center, then left-to-right) so rows keep
 * the on-screen arrangement. Every row count from 1 to `items.length` is tried; more rows are
 * only preferred when they show the windows at least 4% bigger in total area. If no row count
 * fits, a single row without label space is used, and as a last resort every window is drawn at
 * 10%. The chosen rows are centered vertically in the area and each row is centered
 * horizontally; windows shorter than their row are centered vertically within it.
 *
 * @param {ExposeItem[]} items - The windows to lay out.
 * @param {Bounds} area - The layout area (see `exposeArea`).
 * @param {Partial<ExposeOptions>} [opts={}] - Overrides for the default gap, label height and max scale.
 * @returns {ExposeSlot[]} One rounded slot per item, in the same order as `items`.
 *
 * @example
 * const slots = computeExposeLayout([{ id: 'a', x: 0, y: 0, width: 800, height: 600 }], area);
 */
export function computeExposeLayout(items: ExposeItem[], area: Bounds, opts: Partial<ExposeOptions> = {}): ExposeSlot[] {
  if (!items.length) return [];
  const o = { ...DEFAULTS, ...opts };
  const sorted = items.slice().sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x || a.id.localeCompare(b.id));

  let best: Candidate | null = null;
  for (let r = 1; r <= items.length; r++) {
    const c = tryRows(sorted, r, area, o);
    if (c && (!best || c.area > best.area * 1.04)) best = c;
  }
  if (!best) best = tryRows(sorted, 1, area, { ...o, labelHeight: 0 }) ?? { rows: [sorted.map((item) => ({ item, scale: 0.1 }))], area: 0 };

  const rowHeights = best.rows.map((row) => Math.max(...row.map((p) => p.item.height * p.scale)));
  const totalHeight = rowHeights.reduce((a, h) => a + h + o.labelHeight, 0) + (best.rows.length - 1) * o.gap;
  let y = area.y + Math.max(0, (area.height - totalHeight) / 2);

  const byId = new Map<string, ExposeSlot>();
  best.rows.forEach((row, ri) => {
    const rowWidth = row.reduce((sum, p) => sum + p.item.width * p.scale, 0) + (row.length - 1) * o.gap;
    let x = area.x + (area.width - rowWidth) / 2;
    for (const p of row) {
      const w = p.item.width * p.scale;
      const h = p.item.height * p.scale;
      byId.set(p.item.id, { id: p.item.id, x: Math.round(x), y: Math.round(y + (rowHeights[ri] - h) / 2), width: Math.round(w), height: Math.round(h), scale: p.scale });
      x += w + o.gap;
    }
    y += rowHeights[ri] + o.labelHeight + o.gap;
  });
  return items.map((it) => byId.get(it.id)!);
}

/* ───────────────────────── Store selector (memoized) ───────────────────────── */

/** The parts of the window-manager state the Mission Control layout depends on. */
interface WMSlice {
  windows: WindowState[];
  processes: Process[];
}

let cacheState: WMSlice | null = null; /** Store slices the cached layouts were computed for; a change clears `cacheByKey`. */
const cacheByKey = new Map<string, Map<string, ExposeSlot>>(); /** Layouts for the current store slices, by geometry key (a few callers may differ for a frame during a resize). */
let lastSlots = new Map<string, ExposeSlot>(); /** Last slot handed out per window, reused while its values don't change (stable selector results). */

/**
 * Tells whether two slots have the same position, size and scale.
 *
 * Used by `selectExposeSlots` to hand out the previous slot object for a window whose slot
 * did not change, keeping selector results referentially stable.
 *
 * @param {ExposeSlot} a - First slot.
 * @param {ExposeSlot} b - Second slot.
 * @returns {boolean} True when every geometric field is equal (ids are not compared).
 *
 * @example
 * sameSlot(prev, next); // true when the window didn't move
 */
const sameSlot = (a: ExposeSlot, b: ExposeSlot) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.scale === b.scale;

/**
 * Returns the windows that appear in Mission Control.
 *
 * A window is included unless it is minimized or belongs to a hidden app.
 *
 * @param {WMSlice} s - The window-manager windows and processes.
 * @returns {WindowState[]} The exposable windows, in store order.
 *
 * @example
 * const visible = exposableWindows(useWM.getState());
 */
export function exposableWindows(s: WMSlice): WindowState[] {
  const hidden = new Set(s.processes.filter((p) => p.hidden).map((p) => p.appId));
  return s.windows.filter((w) => !w.minimized && !hidden.has(w.appId));
}

/**
 * Computes the Mission Control slots for every exposable window, memoized.
 *
 * Memoized on the store slices plus geometry, so it can be used directly as a zustand selector:
 * it returns the same Map until something changes, and the same slot object for a window whose
 * slot didn't move (so unrelated window updates don't re-render). The cache is cleared whenever
 * the `windows` or `processes` array changes and holds at most 4 geometry keys. In compact mode
 * every window is drawn full-workspace, so the workspace size is what gets laid out.
 *
 * @param {WMSlice} s - The window-manager windows and processes.
 * @param {Size} screen - The viewport size.
 * @param {Bounds} ws - The workspace rect.
 * @param {boolean} [compact=false] - Lay out every window at the workspace size.
 * @returns {Map<string, ExposeSlot>} Slots keyed by window id.
 *
 * @example
 * const slots = useWM((st) => selectExposeSlots(st, viewport, getWorkspace()));
 */
export function selectExposeSlots(s: WMSlice, screen: Size, ws: Bounds, compact = false): Map<string, ExposeSlot> {
  if (!cacheState || cacheState.windows !== s.windows || cacheState.processes !== s.processes) {
    cacheState = { windows: s.windows, processes: s.processes };
    cacheByKey.clear();
  }
  const key = `${screen.width}x${screen.height}|${ws.x},${ws.y},${ws.width},${ws.height}|${compact}`;
  const cached = cacheByKey.get(key);
  if (cached) return cached;

  const items = exposableWindows(s).map((w) => (compact ? { id: w.id, ...ws } : { id: w.id, x: w.x, y: w.y, width: w.width, height: w.height }));
  const slots = new Map<string, ExposeSlot>();
  for (const slot of computeExposeLayout(items, exposeArea(screen, ws))) {
    const prev = lastSlots.get(slot.id);
    slots.set(slot.id, prev && sameSlot(prev, slot) ? prev : slot);
  }
  lastSlots = slots;
  if (cacheByKey.size >= 4) cacheByKey.clear();
  cacheByKey.set(key, slots);
  return slots;
}

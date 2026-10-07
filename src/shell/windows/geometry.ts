/**
 * Pure window geometry: drag clamping, edge-snap zones, resizing, restore-on-drag, the
 * "show desktop" slide-out and the minimize-to-Dock transform. No DOM / React here so it can be
 * unit-tested.
 */
import type { Bounds, DockPosition } from '@/kernel/types';

/** A width/height pair in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/** A position in CSS pixels, relative to the viewport. */
export interface Point {
  x: number;
  y: number;
}

/** A window edge or corner being dragged to resize: compass direction of the moving edge(s). */
export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
/** Where a dragged window snaps: fill the workspace, or tile to the left/right half. */
export type SnapZone = 'fill' | 'left' | 'right';

export const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']; /** Every resize handle direction, in the order the handles are rendered. */

export const RESIZE_CURSORS: Record<ResizeDir, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}; /** CSS cursor shown for each resize handle direction. */

export const DRAG_THRESHOLD = 3; /** Pointer travel (px) before a press on a drag region becomes a window drag. */
export const MIN_VISIBLE_X = 80; /** Horizontal part of a window (px) that always stays on screen while dragging. */
export const MIN_VISIBLE_Y = 40; /** Minimum distance (px) between the title bar and the bottom of the screen while dragging. */
export const SNAP_EDGE = 2; /** How close (px) the pointer must get to the left/right screen edge to tile (also the minimum top-edge reach for filling). */

/**
 * Clamps a number into the range [min, max].
 *
 * When the range is inverted (`max < min`) the lower bound wins and `min` is returned, so callers
 * with a too-small container still get a deterministic result.
 *
 * @param {number} v - The value to clamp.
 * @param {number} min - Lower bound of the range.
 * @param {number} max - Upper bound of the range.
 * @returns {number} `v` limited to the range, or `min` when the range is empty.
 *
 * @example
 * clamp(120, 0, 100); // 100
 * clamp(5, 10, 0);    // 10
 */
export const clamp = (v: number, min: number, max: number) => (max < min ? min : Math.min(max, Math.max(min, v)));

/**
 * Keeps a dragged window reachable on screen.
 *
 * The title bar never goes above the workspace top (below the menu bar) or closer than
 * `MIN_VISIBLE_Y` to the screen bottom, and at least `MIN_VISIBLE_X` pixels of the window stay
 * visible horizontally. The result is rounded to whole pixels.
 *
 * @param {number} x - Proposed left edge of the window.
 * @param {number} y - Proposed top edge of the window.
 * @param {number} width - Width of the window being dragged.
 * @param {Bounds} ws - The workspace rect (screen minus menu bar and Dock).
 * @param {Size} screen - The viewport size.
 * @returns {Point} The clamped, rounded top-left position.
 *
 * @example
 * clampWindowPosition(100, -50, 400, ws, { width: 1440, height: 900 }); // { x: 100, y: ws.y }
 */
export function clampWindowPosition(x: number, y: number, width: number, ws: Bounds, screen: Size): Point {
  return {
    x: Math.round(clamp(x, MIN_VISIBLE_X - width, screen.width - MIN_VISIBLE_X)),
    y: Math.round(clamp(y, ws.y, screen.height - MIN_VISIBLE_Y)),
  };
}

/**
 * Detects which snap zone the pointer is in while dragging a window.
 *
 * Follows macOS Sequoia tiling: pushing the pointer within `SNAP_EDGE` pixels of the left/right
 * screen edge tiles to that half, and pushing it into the menu bar (the top edge, or anywhere
 * above `ws.y - 12`) fills the workspace. Tiling is checked before filling, and each zone is only
 * reported when the window supports it.
 *
 * @param {Point} p - Current pointer position.
 * @param {Bounds} ws - The workspace rect.
 * @param {Size} screen - The viewport size.
 * @param {Object} caps - What the dragged window supports.
 * @param {boolean} caps.canFill - Whether the window may fill the workspace (maximizable).
 * @param {boolean} caps.canTile - Whether the window may be tiled to a half (resizable).
 * @returns {SnapZone | null} The zone under the pointer, or null when no snap applies.
 *
 * @example
 * detectSnap({ x: 0, y: 400 }, ws, screen, { canFill: true, canTile: true }); // 'left'
 */
export function detectSnap(p: Point, ws: Bounds, screen: Size, caps: { canFill: boolean; canTile: boolean }): SnapZone | null {
  if (caps.canTile && p.x <= SNAP_EDGE) return 'left';
  if (caps.canTile && p.x >= screen.width - 1 - SNAP_EDGE) return 'right';
  if (caps.canFill && p.y <= Math.max(SNAP_EDGE, ws.y - 12)) return 'fill';
  return null;
}

/**
 * Returns the bounds a snap zone resolves to.
 *
 * `fill` is the whole workspace; `left`/`right` split the workspace width in two, giving the
 * rounded half to the left side and the remainder to the right. These rects are identical to
 * the ones `wm.tile` and maximize use, so the snap preview matches the final window.
 *
 * @param {SnapZone} zone - The snap zone.
 * @param {Bounds} ws - The workspace rect.
 * @returns {Bounds} A new rect for the zone.
 *
 * @example
 * snapRect('left', { x: 0, y: 26, width: 1440, height: 798 }); // { x: 0, y: 26, width: 720, height: 798 }
 */
export function snapRect(zone: SnapZone, ws: Bounds): Bounds {
  if (zone === 'fill') return { ...ws };
  const half = Math.round(ws.width / 2);
  return zone === 'left' ? { x: ws.x, y: ws.y, width: half, height: ws.height } : { x: ws.x + half, y: ws.y, width: ws.width - half, height: ws.height };
}

/**
 * Computes the bounds of a maximized/tiled window that is being dragged out of its snapped state.
 *
 * The window shrinks back to its `restore` size while the pointer keeps the same relative x
 * position inside the title bar (clamped to 0..1; 0.5 when the current width is 0). The top edge
 * stays where it is. Width and height are rounded.
 *
 * @param {Bounds} current - The window's current (snapped) bounds.
 * @param {Size} restore - The size to restore to.
 * @param {number} pointerX - The pointer's x position.
 * @returns {Bounds} The restored bounds positioned under the pointer.
 *
 * @example
 * restoreOnDrag({ x: 0, y: 26, width: 1440, height: 798 }, { width: 600, height: 400 }, 360);
 * // { x: 210, y: 26, width: 600, height: 400 }
 */
export function restoreOnDrag(current: Bounds, restore: Size, pointerX: number): Bounds {
  const rel = current.width > 0 ? clamp((pointerX - current.x) / current.width, 0, 1) : 0.5;
  return {
    x: Math.round(pointerX - rel * restore.width),
    y: current.y,
    width: Math.round(restore.width),
    height: Math.round(restore.height),
  };
}

/** Constraints applied while resizing a window. */
export interface ResizeLimits {
  /** Minimum window width (px). */
  minWidth: number;
  /** Minimum window height (px). */
  minHeight: number;
  /** Workspace top: the top edge can't go above it. */
  top: number;
}

/**
 * Computes new window bounds for dragging the edge(s) `dir` by (dx, dy).
 *
 * Only the edges named by `dir` move. With `symmetric` (⌥-drag) the opposite edge moves the other
 * way so the window resizes around its center. The top edge is clamped to `lim.top`; in a
 * symmetric vertical resize the bottom is pulled in by the same amount so the window stays
 * centered. When the result is smaller than the minimum size, the anchored (non-dragged) edge
 * stays put, or for a symmetric resize the window is re-centered on its original center (still
 * never above `lim.top`). The result is rounded to whole pixels.
 *
 * @param {Bounds} o - The bounds at the start of the resize.
 * @param {ResizeDir} dir - Which edge(s) are being dragged.
 * @param {number} dx - Horizontal pointer travel since the start.
 * @param {number} dy - Vertical pointer travel since the start.
 * @param {ResizeLimits} lim - Minimum size and workspace top.
 * @param {boolean} [symmetric=false] - Resize around the center (⌥ held).
 * @returns {Bounds} The new window bounds.
 *
 * @example
 * resizeBounds({ x: 100, y: 100, width: 500, height: 400 }, 'se', 50, 20, { minWidth: 300, minHeight: 200, top: 26 });
 * // { x: 100, y: 100, width: 550, height: 420 }
 */
export function resizeBounds(o: Bounds, dir: ResizeDir, dx: number, dy: number, lim: ResizeLimits, symmetric = false): Bounds {
  const hasE = dir.includes('e');
  const hasW = dir.includes('w');
  const hasN = dir.startsWith('n');
  const hasS = dir.startsWith('s');
  let l = o.x;
  let r = o.x + o.width;
  let t = o.y;
  let b = o.y + o.height;

  if (hasE) {
    r += dx;
    if (symmetric) l -= dx;
  } else if (hasW) {
    l += dx;
    if (symmetric) r -= dx;
  }
  if (hasS) {
    b += dy;
    if (symmetric) t -= dy;
  } else if (hasN) {
    t += dy;
    if (symmetric) b -= dy;
  }

  if (t < lim.top) {
    if (symmetric && (hasN || hasS)) b -= lim.top - t;
    t = lim.top;
  }

  if (r - l < lim.minWidth) {
    if (symmetric) {
      const c = (o.x + o.x + o.width) / 2;
      l = c - lim.minWidth / 2;
      r = l + lim.minWidth;
    } else if (hasW) l = r - lim.minWidth;
    else r = l + lim.minWidth;
  }
  if (b - t < lim.minHeight) {
    if (symmetric) {
      const c = (o.y + o.y + o.height) / 2;
      t = Math.max(lim.top, c - lim.minHeight / 2);
      b = t + lim.minHeight;
    } else if (hasN) t = b - lim.minHeight;
    else b = t + lim.minHeight;
  }

  const x = Math.round(l);
  const y = Math.round(t);
  return { x, y, width: Math.round(r) - x, height: Math.round(b) - y };
}

export const SLIVER = 14; /** Pixels of a window left peeking from the screen edge in "Show Desktop". */

/**
 * Computes the offset that slides a window off its nearest screen edge (F11 / Show Desktop).
 *
 * Measures the distance from the window's center to each screen edge (the top distance is
 * measured from `topInset`, e.g. below the menu bar) and pushes the window past the closest one,
 * leaving `SLIVER` pixels visible. Ties resolve in the order left, right, top, bottom.
 *
 * @param {Bounds} b - The window's bounds.
 * @param {Size} screen - The viewport size.
 * @param {number} [topInset=0] - Height reserved at the top of the screen (menu bar).
 * @returns {Point} The translation to apply to the window.
 *
 * @example
 * slideOutOffset({ x: 20, y: 200, width: 300, height: 300 }, { width: 1440, height: 900 });
 * // { x: -306, y: 0 }
 */
export function slideOutOffset(b: Bounds, screen: Size, topInset = 0): Point {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const d = { left: cx, right: screen.width - cx, top: cy - topInset, bottom: screen.height - cy };
  const nearest = (Object.keys(d) as (keyof typeof d)[]).reduce((a, k) => (d[k] < d[a] ? k : a), 'left');
  switch (nearest) {
    case 'left':
      return { x: SLIVER - (b.x + b.width), y: 0 };
    case 'right':
      return { x: screen.width - SLIVER - b.x, y: 0 };
    case 'top':
      return { x: 0, y: topInset + SLIVER - (b.y + b.height) };
    default:
      return { x: 0, y: screen.height - SLIVER - b.y };
  }
}

/**
 * Builds the CSS transform that shrinks a window into `target` (a Dock tile).
 *
 * Meant to be used with `transform-origin: 0 0`. The scale is the largest factor that fits the
 * window inside the tile (clamped to 0.02..1), and the translation centers the scaled window on
 * the tile. Values are formatted with fixed precision so the string is stable.
 *
 * @param {Bounds} b - The window's bounds.
 * @param {Bounds} target - The Dock tile rect to shrink into.
 * @returns {string} A `translate(...) scale(...)` transform string.
 *
 * @example
 * minimizeTransform({ x: 100, y: 100, width: 400, height: 200 }, { x: 700, y: 850, width: 40, height: 40 });
 * // 'translate(600.0px, 760.0px) scale(0.1000)'
 */
export function minimizeTransform(b: Bounds, target: Bounds): string {
  const s = clamp(Math.min(target.width / Math.max(1, b.width), target.height / Math.max(1, b.height)), 0.02, 1);
  const tx = target.x + target.width / 2 - (b.width * s) / 2 - b.x;
  const ty = target.y + target.height / 2 - (b.height * s) / 2 - b.y;
  return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`;
}

/**
 * Estimates where the Dock is when it has not registered an anchor rect.
 *
 * Returns a `size`-sized square 8px in from the screen edge the Dock is attached to, centered
 * along that edge.
 *
 * @param {Size} screen - The viewport size.
 * @param {DockPosition} position - Which screen edge the Dock sits on.
 * @param {number} size - The Dock tile size (px).
 * @returns {Bounds} An approximate Dock tile rect.
 *
 * @example
 * fallbackDockRect({ width: 1440, height: 900 }, 'bottom', 48); // { x: 696, y: 844, width: 48, height: 48 }
 */
export function fallbackDockRect(screen: Size, position: DockPosition, size: number): Bounds {
  if (position === 'left') return { x: 8, y: screen.height / 2 - size / 2, width: size, height: size };
  if (position === 'right') return { x: screen.width - 8 - size, y: screen.height / 2 - size / 2, width: size, height: size };
  return { x: screen.width / 2 - size / 2, y: screen.height - 8 - size, width: size, height: size };
}

/**
 * The macOS "genie" minimize effect.
 *
 * The window is copied into a stack of thin horizontal strips laid over the screen. Each frame,
 * every strip is moved and squeezed so the stack first narrows into a funnel that ends at the
 * Dock tile, then slides down the funnel into the tile. Each strip is clipped to a trapezoid
 * between the funnel's width at its top and bottom edges, so the outline stays a smooth curve. Restoring plays the same frames backwards.
 * The strips are static copies of the window's DOM, so the real window can be hidden while they
 * play.
 */
import type { Bounds } from '@/kernel/types';
import { Z, shellLayerRoot } from '../layers';

const STRIPS = 40; /** Number of horizontal slices the window is cut into; more slices give a smoother curve. */
export const GENIE_MS = 520; /** Duration of one genie animation in ms. */

/**
 * Clamps a number into the 0–1 range.
 *
 * @param {number} v - Value to clamp.
 * @returns {number} `v` limited to 0…1.
 *
 * @example
 * unit(1.4); // 1
 */
const unit = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Linearly interpolates between two numbers.
 *
 * @param {number} a - Value at `t = 0`.
 * @param {number} b - Value at `t = 1`.
 * @param {number} t - Interpolation factor.
 * @returns {number} The interpolated value.
 *
 * @example
 * lerp(0, 10, 0.25); // 2.5
 */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Smoothstep easing: slow at both ends, fastest in the middle.
 *
 * @param {number} t - Progress, 0–1.
 * @returns {number} Eased progress, 0–1.
 *
 * @example
 * smooth(0.5); // 0.5
 */
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Placement of one strip in one frame, relative to its resting place in the window. */
export interface StripFrame {
  /** Horizontal offset of the strip's left edge in px. */
  dx: number;
  /** Vertical offset of the strip's top edge in px. */
  dy: number;
  /** Horizontal scale of the strip. */
  sx: number;
  /** Vertical scale of the strip. */
  sy: number;
  /** Trapezoid clip in fractions of the strip's width: top-left, top-right, bottom-right, bottom-left x. */
  clip: [number, number, number, number];
}

/**
 * Computes where one strip of the window is at a point of the genie animation.
 *
 * Two overlapping phases drive the frame: the funnel (first ~45 %) narrows the lower part of the
 * window toward the tile, following a smoothstep curve from the window's top edge down to the
 * tile's bottom edge; the slide (from 30 % on) moves every row down into the tile and compresses
 * the window's height into the tile's. The funnel's width is read at the strip's current top and
 * bottom edges; the strip is scaled to the wider of the two and clipped to the trapezoid between
 * them. At progress 1 the whole window covers exactly the tile.
 *
 * @param {Bounds} from - The window's bounds on screen.
 * @param {Bounds} to - The Dock tile's bounds on screen.
 * @param {number} index - Strip index, 0 at the top.
 * @param {number} count - Number of strips.
 * @param {number} p - Progress, 0 (window) to 1 (in the tile).
 * @returns {StripFrame} Offset, scale and clip of the strip.
 *
 * @example
 * genieStrip({ x: 100, y: 100, width: 600, height: 400 }, { x: 700, y: 840, width: 48, height: 48 }, 23, 24, 1);
 */
export function genieStrip(from: Bounds, to: Bounds, index: number, count: number, p: number): StripFrame {
  const funnel = smooth(unit(p / 0.45));
  const slide = smooth(unit((p - 0.3) / 0.7));
  const v0 = index / count;
  const v1 = (index + 1) / count;
  const restTop = from.y + v0 * from.height;
  const top = lerp(restTop, to.y + v0 * to.height, slide);
  const bottom = lerp(from.y + v1 * from.height, to.y + v1 * to.height, slide);
  /**
   * Returns the funnel's left and right edge at a screen y.
   *
   * @param {number} y - Screen y in px.
   * @returns {[number, number]} Left and right x in px.
   *
   * @example
   * const [l, r] = edges(top);
   */
  const edges = (y: number): [number, number] => {
    const squeeze = smooth(unit((y - from.y) / Math.max(1, to.y + to.height - from.y))) * funnel;
    const f = squeeze + (1 - squeeze) * slide * slide;
    return [lerp(from.x, to.x, f), lerp(from.x + from.width, to.x + to.width, f)];
  };
  const [lt, rt] = edges(top);
  const [lb, rb] = edges(bottom);
  const left = Math.min(lt, lb);
  const span = Math.max(0.001, Math.max(rt, rb) - left);
  return {
    dx: left - from.x,
    dy: top - restTop,
    sx: Math.max(0.001, span / Math.max(1, from.width)),
    sy: Math.max(0.001, (bottom - top) / Math.max(1, from.height / count)),
    clip: [(lt - left) / span, (rt - left) / span, (rb - left) / span, (lb - left) / span],
  };
}

/**
 * Plays the genie animation for a window.
 *
 * Builds an overlay above the windows (below the Dock) holding `STRIPS` clipped copies of the
 * window element, animates them with `requestAnimationFrame` from the window into the tile
 * (`direction` 'out') or back out of it ('in'), then removes the overlay and calls `onDone`. The
 * copies are inert and hidden from assistive technology. Returns a function that cancels the
 * animation and removes the overlay without calling `onDone`.
 *
 * @param {HTMLElement} source - The window element to copy (its current look is what plays).
 * @param {Bounds} from - The window's bounds on screen.
 * @param {Bounds} to - The Dock tile's bounds on screen.
 * @param {'out' | 'in'} direction - 'out' minimizes into the tile, 'in' restores from it.
 * @param {() => void} onDone - Called once the animation has finished.
 * @returns {() => void} Cancels the animation.
 *
 * @example
 * const cancel = playGenie(el, bounds, tile, 'out', () => setPhase('done'));
 */
export function playGenie(source: HTMLElement, from: Bounds, to: Bounds, direction: 'out' | 'in', onDone: () => void): () => void {
  const overlay = document.createElement('div');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  overlay.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${Z.WINDOWS + 2}`;
  const h = from.height / STRIPS;
  const strips: HTMLElement[] = [];
  for (let i = 0; i < STRIPS; i++) {
    const strip = document.createElement('div');
    strip.style.cssText = `position:absolute;left:${from.x}px;top:${from.y + i * h}px;width:${from.width}px;height:${h + 0.6}px;overflow:hidden;transform-origin:0 0;will-change:transform`;
    const copy = source.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-window-id');
    copy.style.cssText += `;position:absolute;left:0;top:${-i * h}px;width:${from.width}px;height:${from.height}px;transform:none;transition:none;animation:none;opacity:1;visibility:visible;margin:0`;
    strip.appendChild(copy);
    overlay.appendChild(strip);
    strips.push(strip);
  }
  shellLayerRoot().appendChild(overlay);

  let frame = 0;
  const start = performance.now();
  /**
   * Draws one frame and schedules the next until the animation is over.
   *
   * Reads the clock itself (`performance.now()`), since some environments pass frame timestamps
   * on a different time base.
   *
   * @returns {void}
   *
   * @example
   * frame = requestAnimationFrame(tick);
   */
  const tick = () => {
    const t = unit((performance.now() - start) / GENIE_MS);
    const p = direction === 'out' ? t : 1 - t;
    for (let i = 0; i < STRIPS; i++) {
      const { dx, dy, sx, sy, clip } = genieStrip(from, to, i, STRIPS, p);
      const [a, b, c, d] = clip.map((v) => `${(v * 100).toFixed(2)}%`);
      strips[i].style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      strips[i].style.clipPath = `polygon(${a} 0, ${b} 0, ${c} 100%, ${d} 100%)`;
    }
    overlay.style.opacity = String(direction === 'out' ? 1 - unit((t - 0.85) / 0.15) : unit(t / 0.15));
    if (t < 1) frame = requestAnimationFrame(tick);
    else {
      overlay.remove();
      onDone();
    }
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    overlay.remove();
  };
}

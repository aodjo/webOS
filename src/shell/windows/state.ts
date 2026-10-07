/**
 * State and helpers shared by the window-system components in this folder (not part of the
 * kernel contract).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { Bounds } from '@/kernel/types';
import { useSystem } from '@/kernel';
import type { Size } from './geometry';

/** Transient window-chrome UI state that is not part of the window manager. */
interface ChromeState {
  /** Edge-snap preview shown while dragging (z = the dragged window's z). */
  snap: { rect: Bounds; z: number } | null;
  /** Window highlighted in Mission Control (hover or arrow keys). */
  exposeSelected: string | null;
}

export const useWindowChrome = create<ChromeState>()(() => ({ snap: null, exposeSelected: null })); /** Zustand store for the snap preview and the Mission Control selection. */

export const chromeElements = new Map<string, HTMLElement>(); /** Live `.chrome` elements by window id, used to snapshot a closing window for its fade-out. */

/* ───────────────────────── Viewport ───────────────────────── */

/**
 * Subscribes a callback to browser `resize` events.
 *
 * Used as the `subscribe` argument of `useSyncExternalStore`.
 *
 * @param {() => void} cb - Called on every `resize` event.
 * @returns {() => void} A function that removes the listener.
 *
 * @example
 * const unsubscribe = subscribeResize(() => console.log('resized'));
 * unsubscribe();
 */
const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};

/**
 * Returns the current viewport size as a string snapshot.
 *
 * A string (rather than an object) keeps the `useSyncExternalStore` snapshot comparable by value,
 * so components only re-render when the size actually changes.
 *
 * @returns {string} The viewport size as `"<width>x<height>"`.
 *
 * @example
 * viewportKey(); // '1440x900'
 */
const viewportKey = () => `${window.innerWidth}x${window.innerHeight}`;

/**
 * Reactive viewport size.
 *
 * Subscribes to browser `resize` events and returns a memoized `{ width, height }` object that
 * only changes identity when the size changes. During server rendering it reports 1440×900.
 *
 * @returns {Size} The current viewport width and height.
 *
 * @example
 * const { width, height } = useViewport();
 */
export function useViewport(): Size {
  const key = useSyncExternalStore(subscribeResize, viewportKey, () => '1440x900');
  return useMemo(() => {
    const [width, height] = key.split('x').map(Number);
    return { width, height };
  }, [key]);
}

/* ───────────────────────── Live browser resizing ───────────────────────── */

const RESIZE_SETTLE_MS = 180; /** How long (ms) after the last `resize` event the browser is still considered "being resized". */

const useResizeFlag = create<{ resizing: boolean }>()(() => ({ resizing: false })); /** Zustand store holding whether the browser window is currently being resized. */
let resizeTimer: ReturnType<typeof setTimeout> | undefined; /** Timer that clears the resizing flag once resize events settle. */
let resizeSubscribers = 0; /** Number of mounted `useViewportResizing` users sharing the single `resize` listener. */

/**
 * Marks the browser as being resized and schedules the flag to clear.
 *
 * Sets `resizing` to true (only if it isn't already, to avoid redundant store updates) and
 * restarts a `RESIZE_SETTLE_MS` timer that sets it back to false once events stop arriving.
 *
 * @returns {void}
 *
 * @example
 * window.addEventListener('resize', onWindowResize, true);
 */
function onWindowResize() {
  if (!useResizeFlag.getState().resizing) useResizeFlag.setState({ resizing: true });
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => useResizeFlag.setState({ resizing: false }), RESIZE_SETTLE_MS);
}

/**
 * Tells whether the browser window is currently being resized.
 *
 * Windows re-fitted by `wm.relayout` use this to follow the viewport immediately instead of
 * trailing behind it with their bounds transition. All callers share one `resize` listener,
 * reference-counted by `resizeSubscribers`. It is registered in the capture phase: at the target,
 * capturing listeners run before the shell's own `resize` listener (`wm.relayout`), so the flag
 * is already set when the new bounds render. The last unmounting caller removes the listener and
 * resets the flag.
 *
 * @returns {boolean} True while resize events keep arriving (and for `RESIZE_SETTLE_MS` after).
 *
 * @example
 * const resizingViewport = useViewportResizing();
 */
export function useViewportResizing(): boolean {
  useEffect(() => {
    if (resizeSubscribers++ === 0) window.addEventListener('resize', onWindowResize, true);
    return () => {
      if (--resizeSubscribers > 0) return;
      window.removeEventListener('resize', onWindowResize, true);
      clearTimeout(resizeTimer);
      if (useResizeFlag.getState().resizing) useResizeFlag.setState({ resizing: false });
    };
  }, []);
  return useResizeFlag((s) => s.resizing);
}

/* ───────────────────────── Motion ───────────────────────── */

/**
 * Reads the host's `prefers-reduced-motion` media query.
 *
 * Returns false when `matchMedia` is unavailable (e.g. in some test environments).
 *
 * @returns {boolean} True when the host asks for reduced motion.
 *
 * @example
 * if (prefersReduced()) skipAnimation();
 */
const prefersReduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Tells whether JS-timed animations should be skipped right now.
 *
 * Non-reactive: reads the OS "Reduce motion" setting from the system store and the host's
 * `prefers-reduced-motion` preference at call time.
 *
 * @returns {boolean} True when either the OS setting or the host preference requests reduced motion.
 *
 * @example
 * if (reduceMotionNow()) return;
 */
export function reduceMotionNow(): boolean {
  return useSystem.getState().settings.reduceMotion || prefersReduced();
}

/**
 * Runs `fn` once the current DOM state has been painted.
 *
 * Uses a double `requestAnimationFrame`: the first frame is the one that paints the current
 * DOM, the second runs after it. The returned canceller cancels whichever frame is still pending.
 *
 * @param {() => void} fn - The callback to run after the paint.
 * @returns {() => void} A function that cancels the pending callback.
 *
 * @example
 * const cancel = afterPaint(() => setInteracting(false));
 * cancel();
 */
export function afterPaint(fn: () => void): () => void {
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(fn);
  });
  return () => {
    cancelAnimationFrame(outer);
    if (inner) cancelAnimationFrame(inner);
  };
}

/**
 * Keeps something mounted for `exitMs` after `open` turns false so it can play an exit animation.
 *
 * Tracks the previous `open` value in state and adjusts during render: when `open` flips to
 * false, `lingering` becomes true; an effect clears it after `exitMs`. Reopening clears it
 * immediately.
 *
 * @param {boolean} open - Whether the element should be shown.
 * @param {number} exitMs - Length of the exit animation in milliseconds.
 * @returns {{ mounted: boolean; closing: boolean }} `mounted` while open or lingering; `closing`
 *   only during the exit animation.
 *
 * @example
 * const { mounted, closing } = usePresence(open, 300);
 * if (!mounted) return null;
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [lingering, setLingering] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setLingering(!open);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), exitMs);
    return () => clearTimeout(timer);
  }, [lingering, exitMs]);
  return { mounted: open || lingering, closing: !open && lingering };
}

/* ───────────────────────── Interaction cursor ───────────────────────── */

/**
 * Forces one cursor everywhere while a window is dragged or resized.
 *
 * Sets `data-wm-cursor` and the `--wm-cursor` custom property on `<html>`; Window.module.css uses
 * them to apply the cursor globally and to stop iframes from eating pointer events. Passing null
 * removes both.
 *
 * @param {string | null} cursor - A CSS cursor value, or null to clear the override.
 * @returns {void}
 *
 * @example
 * setInteractionCursor('ew-resize');
 * setInteractionCursor(null);
 */
export function setInteractionCursor(cursor: string | null): void {
  const root = document.documentElement;
  if (cursor) {
    root.dataset.wmCursor = cursor;
    root.style.setProperty('--wm-cursor', cursor);
  } else {
    delete root.dataset.wmCursor;
    root.style.removeProperty('--wm-cursor');
  }
}

/**
 * Joins class names, skipping falsy entries.
 *
 * Lets callers write conditional classes inline (`cond && 'name'`); `false`, `null`,
 * `undefined` and empty strings are dropped before joining.
 *
 * @param {...(string | false | null | undefined)} parts - Class names or falsy values.
 * @returns {string} The truthy class names separated by spaces.
 *
 * @example
 * cx('a', open && 'b', null); // 'a b' when open is true
 */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * Adaptive content tone for Liquid Glass controls that float over the desktop (Control Center,
 * Notification Center widgets): white content over dark backdrops, dark content on frosted glass
 * over bright ones, decided per control from what lies right behind it.
 */
import { useLayoutEffect, type RefObject } from 'react';
import { regionLuminance, useWallpaperLuminanceMap } from './wallpaperTone';

export const DARK_CONTENT_ABOVE = 0.36; /** Desktop picture luminance above which a control switches to frosted glass with dark content. */

/**
 * Tells whether a window lies right behind a viewport point, ignoring one container.
 *
 * Looks at the topmost element under the point that is not inside `root` and checks whether it
 * belongs to a window (`[data-window-id]`). Returns false where `elementsFromPoint` is missing.
 *
 * @param {HTMLElement} root - The container whose own elements are skipped.
 * @param {number} x - Viewport x in px.
 * @param {number} y - Viewport y in px.
 * @returns {boolean} True when that element belongs to a window.
 *
 * @example
 * overWindow(panel, 1300, 80);
 */
function overWindow(root: HTMLElement, x: number, y: number): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const behind = document.elementsFromPoint(x, y).find((el) => !root.contains(el));
  return !!behind?.closest('[data-window-id]');
}

/**
 * Sets `data-tone` on glass controls from what lies behind each of them.
 *
 * While `active`, every element inside `ref` that matches `selector` gets `data-tone="dark"` when
 * a window lies behind its left edge, centre or right edge (windows are light in light mode) or
 * when the desktop picture behind it is brighter than DARK_CONTENT_ABOVE, and
 * `data-tone="light"` otherwise. Measures right away and again whenever an animation inside the
 * container ends (panels slide or scale in, which moves the controls), and when the desktop
 * picture or the viewport size changes. Stylesheets decide what each tone looks like (dark mode
 * usually ignores it).
 *
 * @param {RefObject<HTMLElement | null>} ref - Container of the controls.
 * @param {string} selector - CSS selector of the controls inside the container.
 * @param {boolean} active - Whether the container is shown.
 * @returns {void}
 *
 * @example
 * useAdaptiveTone(panelRef, '[data-adaptive-tone]', open);
 */
export function useAdaptiveTone(ref: RefObject<HTMLElement | null>, selector: string, active: boolean): void {
  const map = useWallpaperLuminanceMap();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    /**
     * Measures every control and writes its tone.
     *
     * @returns {void}
     *
     * @example
     * update();
     */
    const update = () => {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        const r = el.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        const behindWindow = [r.left + 12, r.left + r.width / 2, r.right - 12].some((x) => overWindow(root, x, cy));
        const lum = map ? regionLuminance(map, { x0: r.left / vw, y0: r.top / vh, x1: r.right / vw, y1: r.bottom / vh }) : 0;
        el.dataset.tone = behindWindow || lum > DARK_CONTENT_ABOVE ? 'dark' : 'light';
      }
    };
    update();
    root.addEventListener('animationend', update);
    return () => root.removeEventListener('animationend', update);
  }, [ref, selector, active, map]);
}

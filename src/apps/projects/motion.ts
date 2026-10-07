import { useSystem } from '@/kernel';

export const EASE_OUT = 'cubic-bezier(0.2, 0.9, 0.25, 1)'; /** Ease-out timing function used by the Projects app's Web Animations transitions. */

/**
 * Reports whether animations should be reduced.
 *
 * Returns true when either the OS-level "Reduce motion" setting in System
 * Settings is on or the host browser reports `prefers-reduced-motion: reduce`.
 * The component re-renders when the system setting changes; the media query
 * is read on each render and is not subscribed to.
 *
 * @returns {boolean} True when motion should be reduced.
 *
 * @example
 * const reduce = useReducedMotion();
 * if (!reduce) el.animate(keyframes, { duration: 300 });
 */
export function useReducedMotion(): boolean {
  const setting = useSystem((s) => s.settings.reduceMotion);
  return setting || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Computes the FLIP "invert" transform between two rects.
 *
 * Produces a CSS transform that makes an element laid out at `to` appear at
 * the position and size of `from`, by translating by the offset of the
 * top-left corners and scaling by the width and height ratios. The element
 * must use `transform-origin: 0 0` for the result to line up.
 *
 * @param {DOMRect} from - Rect the element should visually start at.
 * @param {DOMRect} to - Rect the element is actually laid out at.
 * @returns {string} A `translate(...) scale(...)` transform string.
 *
 * @example
 * const t = flipTransform(cover.getBoundingClientRect(), hero.getBoundingClientRect());
 * hero.animate([{ transform: t }, { transform: 'none' }], { duration: 400 });
 */
export function flipTransform(from: DOMRect, to: DOMRect): string {
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
}

/**
 * Checks whether an element supports the Web Animations API.
 *
 * Acts as a type guard: returns true only for a non-null element that has an
 * `animate` method, which lets callers skip animations in environments such
 * as jsdom where `Element.animate` is missing.
 *
 * @param {Element | null} el - Element to check.
 * @returns {boolean} True (narrowing to `HTMLElement`) when `el.animate` can be called.
 *
 * @example
 * if (canAnimate(ref.current)) ref.current.animate([{ opacity: 0 }, { opacity: 1 }], 200);
 */
export const canAnimate = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === 'function';

/**
 * Scrolls a single container so that an element is visible inside it.
 *
 * Compares the element's bounding rect with the container's rect (inset by
 * `margin`) and adjusts only `container.scrollTop`: up when the element is
 * above the visible area, down when it is below, and not at all when it
 * already fits. Unlike `scrollIntoView`, outer scroll containers such as the
 * desktop are never scrolled, so a window that hangs off-screen does not shift
 * the whole OS. Does nothing when either argument is null.
 *
 * @param {HTMLElement | null} container - Scrollable container to adjust.
 * @param {Element | null} el - Element to bring into view.
 * @param {number} [margin=12] - Gap in pixels kept between the element and the container edge.
 * @returns {void}
 *
 * @example
 * revealWithin(galleryScroll.current, cardButton);
 * revealWithin(listEl, rowEl, 0);
 */
export function revealWithin(container: HTMLElement | null, el: Element | null, margin = 12): void {
  if (!container || !el) return;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top + margin) container.scrollTop -= c.top + margin - r.top;
  else if (r.bottom > c.bottom - margin) container.scrollTop += r.bottom - (c.bottom - margin);
}

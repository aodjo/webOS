import { useWM } from '@/kernel';

/**
 * Hands keyboard focus back when a system overlay (Spotlight, Launchpad) starts closing.
 *
 * If focus has already moved outside the overlay to something other than the body, it is left
 * alone. If the overlay was dismissed without changing the focused window, focus returns to
 * `prev` (the element focused when the overlay opened). If something else took over (an app was
 * launched, another window got focused), the overlay just blurs its own element so that window can
 * claim focus (Window.tsx waits for focus to leave modal overlays before taking it).
 * Does nothing outside a DOM environment.
 *
 * @param {HTMLElement | null} prev - Element that had focus when the overlay opened.
 * @param {HTMLElement | null} container - The overlay's root element.
 * @returns {void}
 *
 * @example
 * handBackFocus(prevFocusRef.current, overlayRef.current);
 */
export function handBackFocus(prev: HTMLElement | null, container: HTMLElement | null): void {
  if (typeof document === 'undefined') return;
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && !container?.contains(active)) return;
  const prevWindow = prev?.closest('[data-window-id]')?.getAttribute('data-window-id') ?? null;
  const unchanged = prevWindow === useWM.getState().focusedId;
  if (prev && prev !== document.body && prev.isConnected && !container?.contains(prev) && unchanged) {
    prev.focus({ preventScroll: true });
  } else if (active && active !== document.body) {
    active.blur();
  }
}

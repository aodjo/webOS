/**
 * Small hooks shared by the menu bar, Control Center and Notification Center.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useSystem } from '@/kernel/system';

/**
 * Returns the current timestamp, re-rendering on every `step` ms boundary.
 *
 * Each timer is aligned to the next multiple of `step` (plus 5ms so it fires just after the
 * boundary), so a 1000ms step ticks on each wall-clock second and a 60000ms step on each minute.
 * The value is refreshed immediately when `step` changes, and the timer is cleared on unmount.
 *
 * @param {number} step - Tick interval in milliseconds.
 * @returns {number} The current time in ms since the epoch.
 *
 * @example
 * const now = useNow(60000);
 * const label = new Date(now).toLocaleTimeString();
 */
export function useNow(step: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    /**
     * Schedules the next tick at the upcoming `step` boundary.
     *
     * Each tick updates `now` and schedules the following one, keeping the ticks aligned to
     * the boundaries instead of drifting.
     *
     * @returns {void}
     *
     * @example
     * schedule();
     */
    const schedule = () => {
      id = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, step - (Date.now() % step) + 5);
    };
    setNow(Date.now());
    schedule();
    return () => clearTimeout(id);
  }, [step]);
  return now;
}

/**
 * Keeps an overlay mounted for `exitMs` after `open` turns false so it can play its exit animation.
 *
 * `mounted` is true while open and for `exitMs` after closing; `closing` is simply `!open`, so
 * it is true for the whole exit animation. Reopening during the exit cancels the pending unmount.
 * Enter animations run from CSS on mount.
 *
 * @param {boolean} open - Whether the overlay is logically open.
 * @param {number} exitMs - Duration of the exit animation in milliseconds.
 * @returns {{ mounted: boolean; closing: boolean }} Whether to render the overlay and whether it
 *   is animating out.
 *
 * @example
 * const { mounted, closing } = usePresence(open, 320);
 * if (!mounted) return null;
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [lingering, setLingering] = useState(open);
  useEffect(() => {
    if (open) {
      setLingering(true);
      return;
    }
    const id = setTimeout(() => setLingering(false), exitMs);
    return () => clearTimeout(id);
  }, [open, exitMs]);
  return { mounted: open || lingering, closing: !open };
}

/**
 * Closes a panel on a pointer-down outside of it or on Escape.
 *
 * While `active`, a capture-phase `pointerdown` listener on `window` calls `onDismiss` for
 * presses outside `ref` that do not hit an element matching `ignore` (e.g. the panel's own
 * toggle button), and a `keydown` listener does the same for an Escape press that no one has
 * `preventDefault`-ed. The latest `onDismiss` is stored in a ref, so passing a new callback on
 * every render does not re-register the listeners.
 *
 * @param {boolean} active - Whether the panel is open and the listeners should be attached.
 * @param {RefObject<HTMLElement | null>} ref - The panel element; presses inside it are ignored.
 * @param {() => void} onDismiss - Called to close the panel.
 * @param {string} [ignore] - CSS selector of elements whose presses are ignored as well.
 * @returns {void}
 *
 * @example
 * useDismiss(open, panelRef, () => setOpen(false), '[data-cc-toggle]');
 */
export function useDismiss(active: boolean, ref: RefObject<HTMLElement | null>, onDismiss: () => void, ignore?: string): void {
  const cb = useRef(onDismiss);
  useLayoutEffect(() => {
    cb.current = onDismiss;
  });
  useEffect(() => {
    if (!active) return;
    /**
     * Dismisses the panel when a pointer goes down outside it.
     *
     * Ignores non-element targets, targets inside the panel, and targets inside an element
     * matching `ignore`.
     *
     * @param {PointerEvent} e - The pointer-down event (captured on `window`).
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerdown', onDown, true);
     */
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target) || (ignore && target.closest(ignore))) return;
      cb.current();
    };
    /**
     * Dismisses the panel on Escape.
     *
     * Skips key events whose default was already prevented by another handler.
     *
     * @param {KeyboardEvent} e - The keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) cb.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, ref, ignore]);
}

/**
 * Closes a menu or panel when the session stops being interactive (lock, sleep, log out…).
 *
 * Watches the system power state and calls `close` whenever the panel is open while the power
 * state is anything other than `'desktop'`. The latest `close` is stored in a ref, so a new
 * callback on every render does not retrigger the effect.
 *
 * @param {boolean} open - Whether the menu or panel is open.
 * @param {() => void} close - Closes the menu or panel.
 * @returns {void}
 *
 * @example
 * useCloseOnSessionEnd(open, () => setOpen(false));
 */
export function useCloseOnSessionEnd(open: boolean, close: () => void): void {
  const active = useSystem((s) => s.power === 'desktop');
  const cb = useRef(close);
  useLayoutEffect(() => {
    cb.current = close;
  });
  useEffect(() => {
    if (open && !active) cb.current();
  }, [open, active]);
}

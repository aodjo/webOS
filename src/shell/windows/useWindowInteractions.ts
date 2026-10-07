/**
 * Window dragging (with edge snapping) and resizing via Pointer Events.
 *
 * During a gesture the frame is moved by writing to the DOM directly (rAF-throttled) and the
 * result is committed to the window manager once on pointerup, so React doesn't re-render the
 * window (and its app) every frame. `interacting` is true from the start of a gesture until the
 * committed bounds have been painted; the frame uses it to disable its bounds transition.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { Bounds } from '@/kernel/types';
import { getWorkspace, useWM, wm } from '@/kernel';
import {
  DRAG_THRESHOLD,
  RESIZE_CURSORS,
  clampWindowPosition,
  detectSnap,
  resizeBounds,
  restoreOnDrag,
  snapRect,
  type Point,
  type ResizeDir,
  type SnapZone,
} from './geometry';
import { afterPaint, setInteractionCursor, useWindowChrome } from './state';

export const NO_DRAG_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'summary',
  'a',
  'label',
  'video',
  'audio',
  '[contenteditable]:not([contenteditable="false"])',
  '[draggable="true"]',
  '[data-no-drag]',
  ...['button', 'link', 'tab', 'switch', 'slider', 'checkbox', 'radio', 'combobox', 'searchbox', 'spinbutton', 'menuitem', 'textbox', 'option'].map(
    (role) => `[role="${role}"]`,
  ),
].join(', '); /** CSS selector for elements inside a drag region that keep their own pointer behavior (controls, links, editable and draggable content, `[data-no-drag]`). */

/**
 * Finds the drag region (title bar / `[data-drag-region]`) a press started on.
 *
 * The region must be inside `frame`. A press on a control matching `NO_DRAG_SELECTOR` cancels
 * the drag only when that control is inside the region (or is the region itself); controls that
 * are ancestors of the region don't matter.
 *
 * @param {EventTarget | null} target - The pointerdown event target.
 * @param {HTMLElement | null} frame - The window frame element.
 * @returns {Element | null} The drag region element, or null when the press should not drag.
 *
 * @example
 * if (dragRegionFor(e.target, frameRef.current)) startDrag(e);
 */
export function dragRegionFor(target: EventTarget | null, frame: HTMLElement | null): Element | null {
  if (!(target instanceof Element) || !frame) return null;
  const region = target.closest('[data-drag-region]');
  if (!region || !frame.contains(region)) return null;
  const control = target.closest(NO_DRAG_SELECTOR);
  if (control && region.contains(control)) return null;
  return region;
}

/**
 * Snaps a window into a zone after a drag.
 *
 * `fill` maximizes the window to the workspace and focuses it; `left`/`right` tile it via
 * `wm.tile`. In both cases `restore` is stored as the window's `restoreBounds` so un-snapping
 * returns it to its pre-snap size.
 *
 * @param {string} id - The window id.
 * @param {SnapZone} zone - The zone to snap into.
 * @param {Bounds} restore - The bounds to restore when the window is un-snapped.
 * @returns {void}
 *
 * @example
 * applySnap(win.id, 'left', { x: 100, y: 100, width: 600, height: 400 });
 */
export function applySnap(id: string, zone: SnapZone, restore: Bounds): void {
  if (zone === 'fill') {
    wm.update(id, { ...getWorkspace(), maximized: true, tiled: null, restoreBounds: restore });
    wm.focus(id);
  } else {
    wm.update(id, { restoreBounds: restore });
    wm.tile(id, zone);
  }
}

/**
 * Looks up a window's current state in the window-manager store.
 *
 * Reads the store non-reactively via `useWM.getState()`, so gesture handlers always see the
 * latest window state without subscribing.
 *
 * @param {string} id - The window id.
 * @returns {WindowState | undefined} The window, or undefined when no window has that id.
 *
 * @example
 * const w = getWin(id);
 */
const getWin = (id: string) => useWM.getState().windows.find((w) => w.id === id);

/**
 * Copies only the position and size out of a bounds-like object.
 *
 * Strips every other field (e.g. of a `WindowState`) so the result can be spread into
 * `wm.update` or stored as `restoreBounds` without carrying extra state.
 *
 * @param {Bounds} w - A window or any object with x, y, width and height.
 * @returns {Bounds} A new plain `{ x, y, width, height }` object.
 *
 * @example
 * const origin = boundsOf(win);
 */
const boundsOf = (w: Bounds): Bounds => ({ x: w.x, y: w.y, width: w.width, height: w.height });

/**
 * Provides the drag and resize gesture handlers for one window frame.
 *
 * Only one gesture runs at a time: `abortRef` holds the function that ends the current gesture
 * (listeners, pointer capture, pending rAF) and is called before a new gesture starts and on
 * unmount. `gestureRef` is bumped per gesture so a late "after paint" callback from an older
 * gesture can't clear `interacting` for a newer one.
 *
 * @param {string} id - The window id.
 * @param {RefObject<HTMLElement | null>} frameRef - Ref to the window frame element that is moved and resized.
 * @returns {{ interacting: boolean; startDrag: (e: ReactPointerEvent<HTMLElement>) => void; startResize: (dir: ResizeDir, e: ReactPointerEvent<HTMLElement>) => void; cancel: () => void }}
 *   `interacting` while a gesture runs (until its result is painted), the pointerdown handlers
 *   for the drag region and the resize handles, and `cancel` to abandon the current gesture.
 *
 * @example
 * const { interacting, startDrag, startResize, cancel } = useWindowInteractions(id, frameRef);
 */
export function useWindowInteractions(id: string, frameRef: RefObject<HTMLElement | null>) {
  const [interacting, setInteracting] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const gestureRef = useRef(0);

  useEffect(() => () => abortRef.current?.(), []);

  /**
   * Ends the `interacting` state once the committed bounds have been painted.
   *
   * Waits for `afterPaint`, then does nothing if a newer gesture has started meanwhile;
   * otherwise clears `interacting` and runs `then` (e.g. a snap that must animate from the
   * dropped position).
   *
   * @param {number} gesture - The gesture number this call belongs to.
   * @param {() => void} [then] - Optional callback to run after `interacting` is cleared.
   * @returns {void}
   *
   * @example
   * finish(gesture, () => applySnap(id, 'fill', restoreTo));
   */
  const finish = useCallback((gesture: number, then?: () => void) => {
    afterPaint(() => {
      if (gestureRef.current !== gesture) return;
      setInteracting(false);
      then?.();
    });
  }, []);

  /**
   * Handles pointerdown on a drag region (title bar or `[data-drag-region]`).
   *
   * Aborts any running gesture and listens for pointer moves on `window`. The drag only starts
   * after the pointer travels `DRAG_THRESHOLD` pixels; until then a release is a plain click.
   * While dragging, the frame is moved with a temporary CSS `translate` (clamped by
   * `clampWindowPosition`) and the snap preview in `useWindowChrome` tracks the zone under the
   * pointer. On release the position is committed to the window manager and, if the pointer
   * ended in a snap zone, the window snaps into it. A cancelled pointer commits the position
   * without snapping.
   *
   * @param {ReactPointerEvent<HTMLElement>} e - The pointerdown event.
   * @returns {void}
   *
   * @example
   * <div data-drag-region onPointerDown={startDrag} />
   */
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const frame = frameRef.current;
      const w0 = getWin(id);
      if (!frame || !w0) return;
      const el: HTMLElement = frame;
      abortRef.current?.();

      const pointerId = e.pointerId;
      const ws = getWorkspace();
      const screen = { width: window.innerWidth, height: window.innerHeight };
      const caps = { canFill: w0.maximizable, canTile: w0.resizable };
      const restoreTo = (w0.maximized || w0.tiled) && w0.restoreBounds ? w0.restoreBounds : boundsOf(w0);
      let origin = boundsOf(w0);
      let start: Point = { x: e.clientX, y: e.clientY };
      let ptr: Point = start;
      let pos: Point = { x: origin.x, y: origin.y };
      let zone: SnapZone | null = null;
      let started = false;
      let raf = 0;
      const gesture = ++gestureRef.current;

      /**
       * Applies the latest pointer position to the frame (runs once per animation frame).
       *
       * Computes the clamped window position, writes it as a CSS `translate` relative to
       * `origin`, and updates the snap preview only when the snap zone changes.
       *
       * @returns {void}
       *
       * @example
       * raf = requestAnimationFrame(apply);
       */
      const apply = () => {
        raf = 0;
        pos = clampWindowPosition(origin.x + ptr.x - start.x, origin.y + ptr.y - start.y, origin.width, ws, screen);
        el.style.translate = `${pos.x - origin.x}px ${pos.y - origin.y}px`;
        const next = detectSnap(ptr, ws, screen, caps);
        if (next !== zone) {
          zone = next;
          useWindowChrome.setState({ snap: next ? { rect: snapRect(next, ws), z: getWin(id)?.z ?? 0 } : null });
        }
      };

      /**
       * Turns the press into an actual drag once the threshold is crossed.
       *
       * Forces the default cursor, captures the pointer (ignoring failure when the pointer was
       * already released), and synchronously sets `interacting`. A maximized or tiled window is
       * first restored to its `restoreBounds` (or 70% of its current size when it has none),
       * positioned under the pointer by `restoreOnDrag`, and the drag restarts from there.
       *
       * @returns {void}
       *
       * @example
       * if (!started) begin();
       */
      const begin = () => {
        started = true;
        setInteractionCursor('default');
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* the pointer was already released */
        }
        const w = getWin(id);
        flushSync(() => {
          setInteracting(true);
          if (w && (w.maximized || w.tiled)) {
            const rb = w.restoreBounds ?? { ...origin, width: Math.round(origin.width * 0.7), height: Math.round(origin.height * 0.7) };
            origin = restoreOnDrag(boundsOf(w), rb, ptr.x);
            start = ptr;
            wm.update(id, { ...origin, maximized: false, tiled: null, restoreBounds: null });
          }
        });
      };

      /**
       * Tracks pointer movement for this gesture's pointer.
       *
       * Records the pointer position, starts the drag once it has moved `DRAG_THRESHOLD` pixels
       * from the press, and schedules `apply` for the next animation frame (at most once per frame).
       *
       * @param {PointerEvent} ev - The pointermove event.
       * @returns {void}
       *
       * @example
       * window.addEventListener('pointermove', onMove);
       */
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        ptr = { x: ev.clientX, y: ev.clientY };
        if (!started) {
          if (Math.hypot(ptr.x - start.x, ptr.y - start.y) < DRAG_THRESHOLD) return;
          begin();
        }
        if (!raf) raf = requestAnimationFrame(apply);
      };

      /**
       * Removes the gesture's listeners, pending frame and pointer capture.
       *
       * Also clears `abortRef` if it still points at this gesture's `abort`.
       *
       * @returns {void}
       *
       * @example
       * teardown();
       */
      const teardown = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        el.removeEventListener('lostpointercapture', onCancel);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
        if (abortRef.current === abort) abortRef.current = null;
      };

      /**
       * Finishes the drag and commits the final position.
       *
       * Applies the last pointer position, hides the snap preview and resets the cursor. The
       * position is committed with `flushSync` while transitions are still off, and the
       * temporary `translate` is dropped in the same frame so the window doesn't jump. Snapping
       * animates from the dropped position, so it is deferred via `finish` until that frame has
       * been painted. Does nothing beyond teardown if the drag never started.
       *
       * @param {boolean} commit - True to snap into the zone under the pointer; false to skip snapping.
       * @returns {void}
       *
       * @example
       * end(true);
       */
      const end = (commit: boolean) => {
        teardown();
        if (!started) return;
        apply();
        useWindowChrome.setState({ snap: null });
        setInteractionCursor(null);
        const snap = commit ? zone : null;
        flushSync(() => wm.update(id, { x: pos.x, y: pos.y }));
        el.style.translate = '';
        finish(gesture, snap ? () => applySnap(id, snap, restoreTo) : undefined);
      };

      /**
       * Ends the drag (with snapping) when this gesture's pointer is released.
       *
       * Events from other pointers are ignored. The final position is committed and the window
       * snaps into the zone under the pointer, if any.
       *
       * @param {PointerEvent} ev - The pointerup event.
       * @returns {void}
       *
       * @example
       * window.addEventListener('pointerup', onUp);
       */
      function onUp(ev: PointerEvent) {
        if (ev.pointerId === pointerId) end(true);
      }

      /**
       * Ends the drag without snapping when this gesture's pointer is cancelled or loses capture.
       *
       * Events from other pointers are ignored. The position reached so far is still committed,
       * but no snap zone is applied.
       *
       * @param {PointerEvent} ev - The pointercancel or lostpointercapture event.
       * @returns {void}
       *
       * @example
       * window.addEventListener('pointercancel', onCancel);
       */
      function onCancel(ev: PointerEvent) {
        if (ev.pointerId === pointerId) end(false);
      }

      /**
       * Abandons the drag without committing it.
       *
       * Tears down the gesture and, if the drag had started, removes the temporary `translate`,
       * hides the snap preview, resets the cursor and clears `interacting` after paint. The
       * window stays at the bounds stored in the window manager.
       *
       * @returns {void}
       *
       * @example
       * abortRef.current = abort;
       */
      function abort() {
        teardown();
        if (started) {
          el.style.translate = '';
          useWindowChrome.setState({ snap: null });
          setInteractionCursor(null);
          finish(gesture);
        }
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      el.addEventListener('lostpointercapture', onCancel);
      abortRef.current = abort;
    },
    [id, frameRef, finish],
  );

  /**
   * Handles pointerdown on one of the 8 resize handles.
   *
   * Ignores non-primary buttons. Aborts any running gesture, captures the pointer on the handle
   * (bailing out if capture fails) and forces the handle's resize cursor. While resizing, the
   * frame's `left/top/width/height` styles are written directly from `resizeBounds`; holding ⌥
   * resizes around the center. On release (or cancel / lost capture) the new bounds are
   * committed and the window leaves any maximized or tiled state.
   *
   * @param {ResizeDir} dir - The edge or corner of the handle.
   * @param {ReactPointerEvent<HTMLElement>} e - The pointerdown event on the handle.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={(e) => startResize('se', e)} />
   */
  const startResize = useCallback(
    (dir: ResizeDir, e: ReactPointerEvent<HTMLElement>) => {
      const frame = frameRef.current;
      const handle = e.currentTarget;
      const w0 = getWin(id);
      if (!frame || !w0 || e.button !== 0) return;
      const el: HTMLElement = frame;
      e.preventDefault();
      e.stopPropagation();
      abortRef.current?.();

      const pointerId = e.pointerId;
      const origin = boundsOf(w0);
      const limits = { minWidth: w0.minWidth, minHeight: w0.minHeight, top: getWorkspace().y };
      const start: Point = { x: e.clientX, y: e.clientY };
      let ptr = start;
      let symmetric = false;
      let b = origin;
      let started = false;
      let raf = 0;
      const gesture = ++gestureRef.current;

      /**
       * Applies the latest pointer position to the frame (runs once per animation frame).
       *
       * Computes the new bounds with `resizeBounds` and writes them straight to the frame's
       * inline `left/top/width/height` styles.
       *
       * @returns {void}
       *
       * @example
       * raf = requestAnimationFrame(apply);
       */
      const apply = () => {
        raf = 0;
        b = resizeBounds(origin, dir, ptr.x - start.x, ptr.y - start.y, limits, symmetric);
        const st = el.style;
        st.left = `${b.x}px`;
        st.top = `${b.y}px`;
        st.width = `${b.width}px`;
        st.height = `${b.height}px`;
      };

      /**
       * Tracks pointer movement for this resize.
       *
       * Records the pointer position and whether ⌥ is held, sets `interacting` synchronously on
       * the first move, and schedules `apply` for the next animation frame (at most once per frame).
       *
       * @param {PointerEvent} ev - The pointermove event.
       * @returns {void}
       *
       * @example
       * handle.addEventListener('pointermove', onMove);
       */
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        ptr = { x: ev.clientX, y: ev.clientY };
        symmetric = ev.altKey;
        if (!started) {
          started = true;
          flushSync(() => setInteracting(true));
        }
        if (!raf) raf = requestAnimationFrame(apply);
      };

      /**
       * Removes the resize's listeners, pending frame, pointer capture and forced cursor.
       *
       * Also clears `abortRef` if it still points at this gesture's `abort`.
       *
       * @returns {void}
       *
       * @example
       * teardown();
       */
      const teardown = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
        handle.removeEventListener('lostpointercapture', onEnd);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        setInteractionCursor(null);
        if (abortRef.current === abort) abortRef.current = null;
      };

      /**
       * Finishes the resize and commits the new bounds.
       *
       * Applies the last pointer position, then commits the bounds synchronously while clearing
       * `maximized`, `tiled` and `restoreBounds`, and clears `interacting` after paint. A press
       * that never moved only tears down.
       *
       * @param {PointerEvent} ev - The pointerup, pointercancel or lostpointercapture event.
       * @returns {void}
       *
       * @example
       * handle.addEventListener('pointerup', onEnd);
       */
      function onEnd(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        teardown();
        if (!started) return;
        apply();
        flushSync(() => wm.update(id, { ...b, maximized: false, tiled: null, restoreBounds: null }));
        finish(gesture);
      }

      /**
       * Abandons the resize without committing it.
       *
       * Because the resize wrote to the frame's inline styles directly, the bounds React last
       * rendered (`origin`) are written back before `interacting` is cleared after paint.
       *
       * @returns {void}
       *
       * @example
       * abortRef.current = abort;
       */
      function abort() {
        teardown();
        if (!started) return;
        Object.assign(el.style, { left: `${origin.x}px`, top: `${origin.y}px`, width: `${origin.width}px`, height: `${origin.height}px` });
        finish(gesture);
      }

      try {
        handle.setPointerCapture(pointerId);
      } catch {
        return;
      }
      setInteractionCursor(RESIZE_CURSORS[dir]);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
      handle.addEventListener('lostpointercapture', onEnd);
      abortRef.current = abort;
    },
    [id, frameRef, finish],
  );

  /**
   * Abandons the gesture in progress without committing it.
   *
   * Used when the window is minimized, Mission Control opens, or similar; does nothing when no
   * gesture is running.
   *
   * @returns {void}
   *
   * @example
   * cancel();
   */
  const cancel = useCallback(() => abortRef.current?.(), []);

  return { interacting, startDrag, startResize, cancel };
}

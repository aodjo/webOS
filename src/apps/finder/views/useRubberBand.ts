import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { xor } from '../model';

/** Rubber-band rectangle in the scroller's content coordinates (px). */
export interface Band {
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Width. */
  w: number;
  /** Height. */
  h: number;
}

/** A hit area (`data-hit` element) of an item, in the scroller's content coordinates (px). */
interface HitRect {
  /** Path of the item the hit area belongs to. */
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rubber-band (marquee) selection inside a scrolling view.
 *
 * Items must carry `data-path`, and the parts of an item that count as a hit (icon, label)
 * `data-hit`. A drag starts only from a primary-button press on empty space: presses on items, on
 * `data-no-band` areas (headers) and on the scrollbars are ignored. Without a modifier the
 * selection is cleared at once and replaced by the items the band touches; holding ⌘, Ctrl or ⇧
 * toggles those items relative to the selection that existed when the drag started. Hit areas are
 * measured once at mouse down, in content coordinates, so they stay valid while the view scrolls.
 * The band appears after the pointer moves 3px, `onChange` is called only when the resulting
 * selection changes, and dragging above or below the view auto-scrolls it on every animation
 * frame. The latest `selection` and `onChange` are read through a ref, and an active drag is
 * stopped on unmount.
 *
 * @param {RefObject<HTMLElement | null>} scrollRef - The scrolling element that contains the items.
 * @param {string[]} selection - Current selection, in display order.
 * @param {(paths: string[]) => void} onChange - Receives the new selection during the drag.
 * @returns {{ band: Band | null; onMouseDown: (e: MouseEvent) => void }} The band to draw (null
 *   when no drag is active) and the mouse-down handler to attach to the scroller.
 *
 * @example
 * const { band, onMouseDown } = useRubberBand(scrollRef, selection, ctl.setSelection);
 * <div ref={scrollRef} onMouseDown={onMouseDown}>
 *   {band && <div className={s.band} style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
 * </div>
 */
export function useRubberBand(scrollRef: RefObject<HTMLElement | null>, selection: string[], onChange: (paths: string[]) => void) {
  const [band, setBand] = useState<Band | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const latest = useRef({ selection, onChange });
  useEffect(() => {
    latest.current = { selection, onChange };
  });
  useEffect(() => () => stopRef.current?.(), []);

  /**
   * Starts a rubber-band drag from a mouse down on the scroller.
   *
   * Returns early for non-primary buttons, presses on items or `data-no-band` areas, and presses
   * whose position lies beyond the scroller's client area (its scrollbars). Otherwise it clears the
   * selection (unless a modifier is held), snapshots the hit areas of all items, stops any drag
   * still in progress and installs window-level `mousemove` / `mouseup` listeners plus an
   * animation-frame loop for auto-scrolling until the button is released.
   *
   * @param {MouseEvent} e - Mouse down event on the scroller.
   * @returns {void}
   *
   * @example
   * <div ref={scrollRef} onMouseDown={onMouseDown} />
   */
  const onMouseDown = (e: MouseEvent) => {
    const el = scrollRef.current;
    if (e.button !== 0 || !el || (e.target as Element).closest('[data-path], [data-no-band]')) return;
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left >= el.clientLeft + el.clientWidth || e.clientY - rect.top >= el.clientTop + el.clientHeight) return;

    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    const base = additive ? latest.current.selection : [];
    if (!additive) latest.current.onChange([]);

    /**
     * Converts viewport coordinates to the scroller's content coordinates.
     *
     * Uses the scroller's bounding rect captured at mouse down plus its current scroll offsets.
     *
     * @param {number} cx - Viewport x coordinate.
     * @param {number} cy - Viewport y coordinate.
     * @returns {{ x: number; y: number }} The point relative to the scrolled content.
     *
     * @example
     * const p = toContent(ev.clientX, ev.clientY);
     */
    const toContent = (cx: number, cy: number) => ({ x: cx - rect.left + el.scrollLeft, y: cy - rect.top + el.scrollTop });
    const start = toContent(e.clientX, e.clientY);
    const hits: HitRect[] = [];
    el.querySelectorAll<HTMLElement>('[data-hit]').forEach((h) => {
      const path = h.closest('[data-path]')?.getAttribute('data-path');
      if (!path) return;
      const r = h.getBoundingClientRect();
      hits.push({ path, ...toContent(r.left, r.top), w: r.width, h: r.height });
    });

    let pointer = { x: e.clientX, y: e.clientY };
    let moved = false;
    let prevKey = base.join('\n');
    let raf = 0;

    /**
     * Recomputes the band and the selection from the current pointer position.
     *
     * Builds the band between the start point and the pointer, collects the (deduplicated) paths
     * of hit areas that intersect it, and XORs them with the starting selection in additive mode.
     * `onChange` is only called when the resulting list differs from the previous one.
     *
     * @returns {void}
     *
     * @example
     * pointer = { x: ev.clientX, y: ev.clientY };
     * update();
     */
    const update = () => {
      const cur = toContent(pointer.x, pointer.y);
      const b = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
      setBand(b);
      const inside = [...new Set(hits.filter((r) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y).map((r) => r.path))];
      const next = additive ? xor(base, inside) : inside;
      const key = next.join('\n');
      if (key !== prevKey) {
        prevKey = key;
        latest.current.onChange(next);
      }
    };

    /**
     * Animation-frame loop that auto-scrolls while the pointer is above or below the scroller.
     *
     * Once the band is visible, scrolls by half the distance past the edge (at most 24px per frame)
     * and recomputes the band, then schedules itself for the next frame.
     *
     * @returns {void}
     *
     * @example
     * raf = requestAnimationFrame(tick);
     */
    const tick = () => {
      if (moved) {
        const dy = pointer.y < rect.top ? pointer.y - rect.top : pointer.y > rect.bottom ? pointer.y - rect.bottom : 0;
        if (dy) {
          el.scrollTop += Math.max(-24, Math.min(24, dy / 2));
          update();
        }
      }
      raf = requestAnimationFrame(tick);
    };

    /**
     * Tracks the pointer during the drag.
     *
     * Records the pointer position and, once it has moved at least 3px from the press, shows the
     * band and updates the selection.
     *
     * @param {globalThis.MouseEvent} ev - Window mouse move event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('mousemove', onMove);
     */
    const onMove = (ev: globalThis.MouseEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      update();
    };
    /**
     * Ends the drag.
     *
     * Removes the window listeners, cancels the auto-scroll loop, clears the stored stop callback
     * and hides the band. The selection is left as it is.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('mouseup', stop);
     */
    const stop = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      cancelAnimationFrame(raf);
      stopRef.current = null;
      setBand(null);
    };
    stopRef.current?.();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    raf = requestAnimationFrame(tick);
    stopRef.current = stop;
  };

  return { band, onMouseDown };
}

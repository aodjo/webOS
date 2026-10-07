/**
 * The draggable selection "thumb" of segmented controls (macOS 26 / iOS 26 Liquid Glass).
 *
 * The selected segment is marked by a glass capsule that slides between segments. Pressing the
 * selected segment picks the capsule up: it follows the pointer along the track (lifting like a
 * lens while held) and, when released, snaps to the nearest segment and selects it. Pressing any
 * other segment still selects it with a normal click.
 */
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** Position of the thumb inside its track, in px from the track's padding edge. */
export interface Thumb {
  x: number;
  w: number;
  /** True while the thumb is held and follows the pointer. */
  dragging: boolean;
}

/** Event handlers to spread onto the track element. */
export interface ThumbHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
}

const DRAG_SLOP = 3; /** Pointer travel in px before a press on the thumb counts as a drag (and not a click). */

/**
 * Lists the segment buttons of a track, in order.
 *
 * @param {HTMLElement} track - The segmented control element.
 * @returns {HTMLElement[]} Its direct `<button>` children.
 *
 * @example
 * segmentsOf(trackRef.current!);
 */
const segmentsOf = (track: HTMLElement) => Array.from(track.querySelectorAll<HTMLElement>(':scope > button'));

/**
 * Drives the sliding, draggable selection thumb of a segmented control.
 *
 * Measures the selected segment (`offsetLeft` / `offsetWidth`, so the track must be the
 * segments' offset parent) whenever the selection or `measureKey` changes and when the track is
 * resized. A primary press on the selected segment captures the pointer: moving it more than
 * DRAG_SLOP px drags the thumb, clamped to the track, and releasing selects the segment whose
 * centre is nearest to the thumb's centre (or slides back when that is the current one). The
 * click that follows a drag is swallowed so it does not select the segment under the pointer.
 *
 * @param {RefObject<HTMLElement | null>} trackRef - The segmented control element.
 * @param {number} activeIndex - Index of the selected segment (-1 for none).
 * @param {(index: number) => void} onSelect - Called with the segment chosen by a drag.
 * @param {unknown} [measureKey] - Extra value that changes the segment widths (e.g. the locale).
 * @returns {{ thumb: Thumb | null; handlers: ThumbHandlers }} The thumb to draw and the track's
 *   event handlers.
 *
 * @example
 * const { thumb, handlers } = useDraggableThumb(ref, index, (i) => onChange(options[i].value));
 */
export function useDraggableThumb(trackRef: RefObject<HTMLElement | null>, activeIndex: number, onSelect: (index: number) => void, measureKey?: unknown): { thumb: Thumb | null; handlers: ThumbHandlers } {
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const drag = useRef<{ startX: number; startLeft: number; w: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  /**
   * Places the thumb on the selected segment.
   *
   * Keeps the previous state object when nothing changed, so repeated measurements do not
   * re-render.
   *
   * @returns {void}
   *
   * @example
   * snap();
   */
  const snap = useCallback(() => {
    const track = trackRef.current;
    const seg = track ? segmentsOf(track)[activeIndex] : undefined;
    if (!seg) {
      setThumb(null);
      return;
    }
    setThumb((prev) => (prev && !prev.dragging && prev.x === seg.offsetLeft && prev.w === seg.offsetWidth ? prev : { x: seg.offsetLeft, w: seg.offsetWidth, dragging: false }));
  }, [trackRef, activeIndex]);

  useLayoutEffect(() => {
    snap();
    const track = trackRef.current;
    if (typeof ResizeObserver === 'undefined' || !track) return;
    const ro = new ResizeObserver(() => {
      if (!drag.current) snap();
    });
    ro.observe(track);
    return () => ro.disconnect();
  }, [snap, trackRef, measureKey]);

  const handlers: ThumbHandlers = {
    /**
     * Picks the thumb up when the selected segment is pressed with the primary button.
     *
     * @param {ReactPointerEvent<HTMLElement>} e - Pointer-down on the track.
     * @returns {void}
     *
     * @example
     * <div onPointerDown={handlers.onPointerDown} />
     */
    onPointerDown: (e) => {
      swallowClick.current = false;
      const track = trackRef.current;
      if (e.button !== 0 || !track || !thumb) return;
      const seg = (e.target as Element).closest('button');
      if (!seg || segmentsOf(track).indexOf(seg as HTMLElement) !== activeIndex) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startLeft: thumb.x, w: thumb.w, moved: false };
    },
    /**
     * Moves the held thumb with the pointer, clamped to the track.
     *
     * @param {ReactPointerEvent<HTMLElement>} e - Pointer-move on the track.
     * @returns {void}
     *
     * @example
     * <div onPointerMove={handlers.onPointerMove} />
     */
    onPointerMove: (e) => {
      const d = drag.current;
      const track = trackRef.current;
      if (!d || !track) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
      d.moved = true;
      const segs = segmentsOf(track);
      const min = segs[0]?.offsetLeft ?? 0;
      const last = segs[segs.length - 1];
      const max = last ? last.offsetLeft + last.offsetWidth - d.w : min;
      setThumb({ x: Math.min(max, Math.max(min, d.startLeft + dx)), w: d.w, dragging: true });
    },
    /**
     * Drops the thumb: selects the nearest segment after a drag.
     *
     * @param {ReactPointerEvent<HTMLElement>} e - Pointer-up on the track.
     * @returns {void}
     *
     * @example
     * <div onPointerUp={handlers.onPointerUp} />
     */
    onPointerUp: (e) => {
      const d = drag.current;
      const track = trackRef.current;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (!d?.moved || !track || !thumb) return;
      swallowClick.current = true;
      const centre = thumb.x + thumb.w / 2;
      const segs = segmentsOf(track);
      let best = activeIndex;
      let bestDist = Infinity;
      segs.forEach((seg, i) => {
        const dist = Math.abs(seg.offsetLeft + seg.offsetWidth / 2 - centre);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      if (best !== activeIndex) onSelect(best);
      else snap();
    },
    /**
     * Abandons a drag when the browser cancels the pointer; the thumb slides back.
     *
     * @returns {void}
     *
     * @example
     * <div onPointerCancel={handlers.onPointerCancel} />
     */
    onPointerCancel: () => {
      drag.current = null;
      snap();
    },
    /**
     * Swallows the click that the browser fires after a drag ends.
     *
     * @param {ReactMouseEvent<HTMLElement>} e - Click on the track, in the capture phase.
     * @returns {void}
     *
     * @example
     * <div onClickCapture={handlers.onClickCapture} />
     */
    onClickCapture: (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };

  return { thumb, handlers };
}

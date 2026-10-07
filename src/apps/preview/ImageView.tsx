import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { ImageOff } from 'lucide-react';
import { useT } from '@/kernel';
import styles from './Preview.module.css';

/** Imperative zoom and rotation controls that Preview's menus and toolbar call on the image view. */
export interface ImageViewHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  actualSize: () => void;
  zoomToFit: () => void;
  /** Rotates by a quarter turn: 1 clockwise, -1 counter-clockwise. */
  rotate: (dir: 1 | -1) => void;
}

interface Props {
  src: string;
  alt: string;
  /** Vector images may be scaled above 100% when fitting. */
  vector: boolean;
  onDimensions: (dims: { width: number; height: number } | null) => void;
  onZoomChange?: (percent: number) => void;
}

const MIN_ZOOM = 0.05; /** Smallest allowed zoom factor (5%). */
const MAX_ZOOM = 16; /** Largest allowed zoom factor (1600%). */
const STEP = 1.25; /** Factor applied to the scale by one Zoom In / Zoom Out step. */

const S = {
  error: { en: 'The image couldn’t be displayed.', ko: '이미지를 표시할 수 없습니다.' },
}; /** Localized strings used by the image view. */

/** Unscaled image point (ix, iy) that must stay under the container point (ax, ay) after a zoom. */
type Anchor = { ix: number; iy: number; ax: number; ay: number };

/**
 * Zoomable, pannable, rotatable image view used by Preview.
 *
 * Zoom and rotation are applied with a single CSS transform on the <img>, and a "stage" element
 * sized to the scaled (and rotated) image provides native scrolling when the image is larger
 * than the view. In "fit" mode the scale is the largest that fits the container, capped at 100%
 * unless the image is a vector. A ResizeObserver tracks the container size, and the current
 * geometry is mirrored into a ref so event handlers registered once always read the latest
 * values. Ctrl/⌘ + wheel (how Chrome and Firefox report trackpad pinches), Safari gesture events
 * and two-finger touch pinches zoom around the pointer; dragging pans while the image overflows;
 * double-click toggles between fit and twice the fit scale (at least 100%). Rotation animates via
 * a CSS transition that is switched off again on `transitionend`. The image stays transparent
 * until its natural size is known, and a load error replaces it with a message.
 *
 * @param {Object} props - Component props.
 * @param {string} props.src - URL of the image to display.
 * @param {string} props.alt - Alternative text for the image.
 * @param {boolean} props.vector - Whether the image is a vector, which allows fitting above 100%.
 * @param {(dims: { width: number; height: number } | null) => void} props.onDimensions - Called
 *   with the natural size after the image loads, or null when it fails to load.
 * @param {(percent: number) => void} [props.onZoomChange] - Called with the rounded zoom
 *   percentage whenever the effective scale changes.
 * @param {React.ForwardedRef<ImageViewHandle>} ref - Receives the imperative zoom and rotation handle.
 * @returns {JSX.Element} The scroll container holding the image, or an error message when the
 *   image fails to load.
 *
 * @example
 * const viewRef = useRef<ImageViewHandle>(null);
 * <ImageView ref={viewRef} src={url} alt="cat.png" vector={false} onDimensions={setDims} />;
 * viewRef.current?.rotate(1);
 */
export const ImageView = forwardRef<ImageViewHandle, Props>(function ImageView({ src, alt, vector, onDimensions, onZoomChange }, ref) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [rotation, setRotation] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [panning, setPanning] = useState(false);
  const anchorRef = useRef<Anchor | null>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number; id: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /**
     * Stores the container's current client size in state.
     *
     * Keeps the previous state object when the size is unchanged so React skips the re-render.
     *
     * @returns {void}
     *
     * @example
     * const ro = new ResizeObserver(measure);
     */
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const quarter = ((rotation % 180) + 180) % 180 === 90;
  const nw = natural?.w || box.w || 1;
  const nh = natural?.h || box.h || 1;
  const rw = quarter ? nh : nw;
  const rh = quarter ? nw : nh;
  let fit = box.w && box.h ? Math.min(box.w / rw, box.h / rh) : 1;
  if (!vector) fit = Math.min(fit, 1);
  const scale = zoom === 'fit' ? fit : zoom;
  const stageW = Math.max(box.w, rw * scale);
  const stageH = Math.max(box.h, rh * scale);
  const overflow = rw * scale > box.w + 0.5 || rh * scale > box.h + 0.5;

  const geo = useRef({ scale, rw, rh, stageW, stageH });
  useLayoutEffect(() => {
    geo.current = { scale, rw, rh, stageW, stageH };
  });

  useEffect(() => onZoomChange?.(Math.round(scale * 100)), [scale, onZoomChange]);

  /**
   * Sets a new zoom factor while keeping one point of the image fixed on screen.
   *
   * Clamps `next` to [MIN_ZOOM, MAX_ZOOM] and records an anchor: the unscaled image point that is
   * currently under the client coordinates `cx`/`cy`, or under the view center when they are
   * omitted. Once the stage has been rendered at the new size, a layout effect restores the
   * scroll offsets from that anchor so the point stays under the cursor (or center).
   *
   * @param {number} next - Requested zoom factor (1 = 100%).
   * @param {Object} [opts={}] - Zoom options.
   * @param {number} [opts.cx] - Client X coordinate to keep fixed.
   * @param {number} [opts.cy] - Client Y coordinate to keep fixed.
   * @param {boolean} [opts.animate] - Whether the transform change is animated.
   * @returns {void}
   *
   * @example
   * zoomTo(2, { cx: e.clientX, cy: e.clientY });
   */
  const zoomTo = useCallback((next: number, opts: { cx?: number; cy?: number; animate?: boolean } = {}) => {
    const el = scrollRef.current;
    const g = geo.current;
    const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (el) {
      const rect = el.getBoundingClientRect();
      const ax = opts.cx !== undefined ? opts.cx - rect.left : el.clientWidth / 2;
      const ay = opts.cy !== undefined ? opts.cy - rect.top : el.clientHeight / 2;
      const offX = (g.stageW - g.rw * g.scale) / 2;
      const offY = (g.stageH - g.rh * g.scale) / 2;
      anchorRef.current = { ix: (el.scrollLeft + ax - offX) / g.scale, iy: (el.scrollTop + ay - offY) / g.scale, ax, ay };
    }
    setAnimate(!!opts.animate);
    setZoom(target);
  }, []);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    anchorRef.current = null;
    const offX = (stageW - rw * scale) / 2;
    const offY = (stageH - rh * scale) / 2;
    el.scrollLeft = a.ix * scale + offX - a.ax;
    el.scrollTop = a.iy * scale + offY - a.ay;
  }, [scale, stageW, stageH, rw, rh]);

  useImperativeHandle(
    ref,
    () => ({
      /**
       * Zooms in by one step around the view center.
       *
       * Multiplies the current scale by STEP, snapping to exactly 100% when the result lands
       * within 6% of it.
       *
       * @returns {void}
       *
       * @example
       * viewRef.current?.zoomIn();
       */
      zoomIn: () => zoomTo(Math.abs(geo.current.scale * STEP - 1) < 0.06 ? 1 : geo.current.scale * STEP),
      /**
       * Zooms out by one step around the view center.
       *
       * Divides the current scale by STEP, snapping to exactly 100% when the result lands
       * within 6% of it.
       *
       * @returns {void}
       *
       * @example
       * viewRef.current?.zoomOut();
       */
      zoomOut: () => zoomTo(Math.abs(geo.current.scale / STEP - 1) < 0.06 ? 1 : geo.current.scale / STEP),
      /**
       * Shows the image at 100% around the view center.
       *
       * Sets an explicit zoom factor of 1, which leaves fit mode.
       *
       * @returns {void}
       *
       * @example
       * viewRef.current?.actualSize();
       */
      actualSize: () => zoomTo(1),
      /**
       * Returns to fit-to-window zoom.
       *
       * Switches the zoom back to "fit" without animation, so the scale follows the container
       * size again.
       *
       * @returns {void}
       *
       * @example
       * viewRef.current?.zoomToFit();
       */
      zoomToFit: () => {
        setAnimate(false);
        setZoom('fit');
      },
      /**
       * Rotates the image by a quarter turn.
       *
       * Adds ±90° to the rotation with the transform transition enabled; in fit mode the fit
       * scale is recomputed for the swapped width and height.
       *
       * @param {1 | -1} dir - 1 rotates clockwise, -1 counter-clockwise.
       * @returns {void}
       *
       * @example
       * viewRef.current?.rotate(-1);
       */
      rotate: (dir) => {
        setAnimate(true);
        setRotation((r) => r + dir * 90);
      },
    }),
    [zoomTo],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /**
     * Zooms on ctrl/⌘ + wheel, which is also how Chrome and Firefox report trackpad pinches.
     *
     * Plain wheel events are left alone so they scroll normally. The listener is registered as
     * non-passive so `preventDefault` can block the browser's page zoom. The delta is converted
     * from lines to pixels when needed, clamped to ±50 and turned into an exponential zoom
     * factor anchored at the pointer.
     *
     * @param {WheelEvent} e - The native wheel event.
     * @returns {void}
     *
     * @example
     * el.addEventListener('wheel', onWheel, { passive: false });
     */
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      zoomTo(geo.current.scale * Math.exp(-dy * 0.01), { cx: e.clientX, cy: e.clientY });
    };
    let base = 1;
    /**
     * Starts a Safari trackpad pinch gesture.
     *
     * Prevents the browser's page zoom and remembers the current scale as the base that later
     * `gesturechange` scale factors are multiplied with.
     *
     * @param {Event} e - The Safari `gesturestart` event.
     * @returns {void}
     *
     * @example
     * el.addEventListener('gesturestart', onGestureStart);
     */
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      base = geo.current.scale;
    };
    /**
     * Applies an update of a Safari trackpad pinch gesture.
     *
     * Zooms to the base scale times the gesture's cumulative `scale`, anchored at the gesture's
     * client coordinates.
     *
     * @param {Event} e - The Safari `gesturechange` event, carrying `scale`, `clientX` and `clientY`.
     * @returns {void}
     *
     * @example
     * el.addEventListener('gesturechange', onGestureChange);
     */
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomTo(base * g.scale, { cx: g.clientX, cy: g.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [zoomTo]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  /**
   * Measures the two tracked touch pointers.
   *
   * Assumes exactly two touches are tracked and returns their distance (at least 1, so it can
   * safely be divided by) and their midpoint in client coordinates.
   *
   * @returns {{ dist: number; cx: number; cy: number }} Distance between the touches and their midpoint.
   *
   * @example
   * const { dist, cx, cy } = spread();
   */
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  /**
   * Starts a pan or a two-finger pinch.
   *
   * Ignores non-primary buttons. Touch pointers are tracked by id; when a second touch lands, the
   * pointer is captured and a pinch starts from the current finger distance and scale, cancelling
   * any pan. Otherwise, when the image overflows the view, the pointer is captured and a pan
   * starts from the current scroll offsets (shown with a "grabbing" cursor).
   *
   * @param {PointerEvent<HTMLDivElement>} e - Pointer-down event on the scroll container.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    if (e.pointerType === 'touch') pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      el.setPointerCapture(e.pointerId);
      pinchRef.current = { dist: spread().dist, scale: geo.current.scale };
      panRef.current = null;
      setPanning(false);
      return;
    }
    if (!overflow || pointers.current.size > 1) return;
    el.setPointerCapture(e.pointerId);
    panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, id: e.pointerId };
    setPanning(true);
  };
  /**
   * Updates an active pinch or pan.
   *
   * Refreshes the tracked touch position. During a two-finger pinch it zooms by the ratio of the
   * current to the initial finger distance, anchored at the fingers' midpoint; otherwise, for the
   * pointer that started the pan, it scrolls the container by the distance moved.
   *
   * @param {PointerEvent<HTMLDivElement>} e - Pointer-move event on the scroll container.
   * @returns {void}
   *
   * @example
   * <div onPointerMove={onPointerMove} />
   */
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (pinch && pointers.current.size === 2) {
      const s = spread();
      zoomTo(pinch.scale * (s.dist / pinch.dist), { cx: s.cx, cy: s.cy });
      return;
    }
    const p = panRef.current;
    if (!p || p.id !== e.pointerId) return;
    e.currentTarget.scrollLeft = p.sl - (e.clientX - p.x);
    e.currentTarget.scrollTop = p.st - (e.clientY - p.y);
  };
  /**
   * Ends a pinch or pan when a pointer is released or cancelled.
   *
   * Stops tracking the pointer, ends the pinch once fewer than two touches remain, and clears the
   * pan state when this pointer started the pan.
   *
   * @param {PointerEvent<HTMLDivElement>} e - Pointer-up or pointer-cancel event on the scroll container.
   * @returns {void}
   *
   * @example
   * <div onPointerUp={endPan} onPointerCancel={endPan} />
   */
  const endPan = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (panRef.current?.id !== e.pointerId) return;
    panRef.current = null;
    setPanning(false);
  };

  const cursor = overflow ? (panning ? 'grabbing' : 'grab') : 'default';

  return (
    <div
      ref={scrollRef}
      className={styles.imageScroll}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={(e) => (zoom === 'fit' ? zoomTo(Math.max(1, fit * 2), { cx: e.clientX, cy: e.clientY, animate: false }) : setZoom('fit'))}
    >
      {failed ? (
        <div className={styles.imageError}>
          <ImageOff size={40} strokeWidth={1.2} />
          <span>{t(S.error)}</span>
        </div>
      ) : (
        <div className={styles.stage} style={{ width: stageW, height: stageH }}>
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={`${styles.image} ${animate ? styles.imageAnimate : ''}`}
            style={{
              width: nw,
              height: nh,
              opacity: natural ? 1 : 0,
              transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`,
            }}
            onLoad={(e) => {
              const img = e.currentTarget;
              setFailed(false);
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              onDimensions(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
            }}
            onError={() => {
              setFailed(true);
              onDimensions(null);
            }}
            onTransitionEnd={() => setAnimate(false)}
          />
        </div>
      )}
    </div>
  );
});

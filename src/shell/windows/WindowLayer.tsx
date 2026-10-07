/**
 * Full-screen layer holding every window. Windows of hidden apps and minimized windows stay
 * mounted (their app state survives) but are invisible. Closed windows leave a short-lived
 * snapshot ("ghost") that fades out. Also renders the edge-snap preview and handles Show Desktop.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Bounds, WindowState } from '@/kernel/types';
import { useSystem, useUI, useWM } from '@/kernel';
import { Z } from '../layers';
import { Window } from './Window';
import { chromeElements, cx, reduceMotionNow, usePresence, useWindowChrome } from './state';
import s from './WindowLayer.module.css';
import ws from './Window.module.css';

const GHOST_MS = 170; /** Close fade duration in ms (matches the `.ghost` animation in WindowLayer.module.css). */
const MC_EXIT_MS = 460; /** How long (ms) the layer stays above the Mission Control backdrop after it closes, until windows are back in place. */

/** Snapshot of a closed window, drawn at its last position while it fades out. */
interface Ghost {
  id: string;
  bounds: Bounds;
  z: number;
  /** The window's corner-radius class (so an empty frame fades out with the same corners). */
  radius?: string;
  /** Detached snapshot of the window's DOM (null → draw an empty frame). */
  node: HTMLElement | null;
  /** Scroll offsets to restore on cloned elements: [element, scrollTop, scrollLeft]. */
  scrolls: [HTMLElement, number, number][];
}

const MAX_SNAPSHOT_NODES = 4000; /** Windows with more DOM elements than this fade out as an empty frame instead of a clone. */

const LIVE_MEDIA = 'iframe, video, audio, object, embed, canvas'; /** Elements that would reload or keep playing if cloned; replaced by a placeholder (canvas content is copied). */

/**
 * Clones a window's DOM for the close animation, neutralizing anything live.
 *
 * Looks up the window's live `.chrome` element (registered in `chromeElements`) and measures its
 * frame. Windows with more than `MAX_SNAPSHOT_NODES` elements aren't worth a frame hitch, so they
 * get an empty frame instead. Otherwise the clone copies scroll offsets (restored once attached)
 * and form values, strips `id` and `autofocus` attributes (SVG ids stay in place because gradients
 * and clip paths are referenced by id), and replaces `LIVE_MEDIA` elements: canvases with a
 * pixel copy, everything else with a same-sized blank `div`. The clone is made `inert` and
 * `aria-hidden`. Any error while cloning falls back to an empty frame.
 *
 * @param {WindowState} win - The window that just closed.
 * @returns {Ghost | null} The ghost to render, or null when the window's DOM is not available.
 *
 * @example
 * const ghosts = closed.map(snapshot).filter((g): g is Ghost => !!g);
 */
function snapshot(win: WindowState): Ghost | null {
  const src = chromeElements.get(win.id);
  const frame = src?.parentElement;
  if (!src || !frame) return null;
  const r = frame.getBoundingClientRect();
  const bounds = { x: r.left, y: r.top, width: r.width, height: r.height };
  const radius = [ws.radiusOverlay, ws.radiusNone].find((c) => !!c && src.classList.contains(c));
  if (src.getElementsByTagName('*').length > MAX_SNAPSHOT_NODES) return { id: win.id, bounds, z: win.z, radius, node: null, scrolls: [] };
  try {
    const node = src.cloneNode(true) as HTMLElement;
    const from = src.querySelectorAll<HTMLElement>('*');
    const to = node.querySelectorAll<HTMLElement>('*');
    const scrolls: Ghost['scrolls'] = [];
    from.forEach((orig, i) => {
      const copy = to[i];
      if (!copy) return;
      if (orig.scrollTop || orig.scrollLeft) scrolls.push([copy, orig.scrollTop, orig.scrollLeft]);
      if (orig instanceof HTMLInputElement || orig instanceof HTMLTextAreaElement || orig instanceof HTMLSelectElement) {
        (copy as HTMLInputElement).value = orig.value;
      }
      if (!(copy instanceof SVGElement)) copy.removeAttribute('id');
      copy.removeAttribute('autofocus');
    });
    node.querySelectorAll<HTMLElement>(LIVE_MEDIA).forEach((copy) => {
      const orig = from[Array.prototype.indexOf.call(to, copy)];
      let replacement: HTMLElement;
      let fill = '';
      if (orig instanceof HTMLCanvasElement && orig.width && orig.height) {
        const c = document.createElement('canvas');
        c.width = orig.width;
        c.height = orig.height;
        c.getContext('2d')?.drawImage(orig, 0, 0);
        replacement = c;
      } else {
        replacement = document.createElement('div');
        fill = ';background:var(--content-bg)';
      }
      replacement.className = copy.className;
      replacement.setAttribute('style', `${copy.getAttribute('style') ?? ''};width:${orig?.offsetWidth ?? 0}px;height:${orig?.offsetHeight ?? 0}px${fill}`);
      copy.replaceWith(replacement);
    });
    node.classList.remove(ws.opening);
    node.setAttribute('inert', '');
    node.setAttribute('aria-hidden', 'true');
    return { id: win.id, bounds, z: win.z, radius, node, scrolls };
  } catch {
    return { id: win.id, bounds, z: win.z, radius, node: null, scrolls: [] };
  }
}

/**
 * Renders one closing window's ghost and removes it when its fade-out ends.
 *
 * In a layout effect the detached snapshot is appended to the ghost container and the recorded
 * scroll offsets are restored (scrolling only works once the nodes are in the document); the
 * node is removed again on cleanup. A timer calls `onDone` slightly after `GHOST_MS` so the
 * CSS fade has finished. Ghosts without a snapshot render as an empty, styled frame.
 *
 * @param {Object} props - Component props.
 * @param {Ghost} props.ghost - The snapshot to show.
 * @param {(id: string) => void} props.onDone - Called with the ghost's id when it should be removed.
 * @returns {JSX.Element} The positioned, fading ghost element.
 *
 * @example
 * <GhostWindow key={g.id} ghost={g} onDone={dropGhost} />
 */
function GhostWindow({ ghost, onDone }: { ghost: Ghost; onDone: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = ref.current;
    const node = ghost.node;
    if (!host || !node) return;
    host.appendChild(node);
    for (const [el, top, left] of ghost.scrolls) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
    return () => node.remove();
  }, [ghost]);

  useEffect(() => {
    const timer = setTimeout(() => onDone(ghost.id), GHOST_MS + 30);
    return () => clearTimeout(timer);
  }, [ghost.id, onDone]);

  const { x, y, width, height } = ghost.bounds;
  return <div ref={ref} className={cx(s.ghost, ghost.radius, !ghost.node && s.ghostEmpty)} style={{ left: x, top: y, width, height, zIndex: ghost.z }} aria-hidden />;
}

/**
 * Renders the clear glass pane showing where a dragged window will snap.
 *
 * Reads the snap preview from `useWindowChrome`. The last non-null preview is remembered in
 * state (updated during render) so the pane keeps its rect while it fades out after the snap
 * is cleared.
 *
 * @returns {JSX.Element | null} The preview pane, or null before any snap has been shown.
 *
 * @example
 * <SnapPreview />
 */
function SnapPreview() {
  const snap = useWindowChrome((c) => c.snap);
  const [last, setLast] = useState(snap);
  if (snap && snap !== last) setLast(snap);
  const shown = snap ?? last;
  if (!shown) return null;
  const { x, y, width, height } = shown.rect;
  return <div className={cx('lg lg-clear', s.snap, snap && s.snapVisible)} style={{ left: x, top: y, width, height, zIndex: shown.z }} aria-hidden />;
}

const DESKTOP_ITEM =
  '[data-desktop-item], [data-widget], button, a, input, textarea, select, [draggable="true"], [role="button"], [role="option"], [role="gridcell"], [role="listitem"], [data-path]'; /** Desktop items that keep working in Show Desktop (a plain click anywhere else restores windows). */

/**
 * Renders the full-screen layer containing every window, the snap preview and close ghosts.
 *
 * Subscribes to the window-manager store: when a window opens or a different window gains
 * focus, Show Desktop is turned off. Windows that just closed while visible (not minimized, not
 * in a hidden app) are snapshotted into ghosts while their DOM still exists; this is skipped
 * when motion is reduced, in Mission Control or Show Desktop, or when the system is not on the
 * desktop. While Show Desktop is active, a plain primary click (under 4px of movement) on empty
 * desktop brings the windows back; rubber-band drags and clicks on `DESKTOP_ITEM` elements
 * don't. The layer's z-index is raised above Mission Control while it is open and for
 * `MC_EXIT_MS` after it closes.
 *
 * @returns {JSX.Element} The window layer.
 *
 * @example
 * <WindowLayer />
 */
export function WindowLayer() {
  const ids = useWM(useShallow((st) => st.windows.map((w) => w.id)));
  const missionControl = useUI((u) => u.missionControl);
  const showDesktop = useUI((u) => u.showDesktop);
  const elevated = usePresence(missionControl, MC_EXIT_MS).mounted;
  const layerRef = useRef<HTMLDivElement>(null);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);

  /**
   * Removes a finished ghost from the list.
   *
   * Filters the ghost with the given id out of the `ghosts` state. It is memoized with no
   * dependencies so `GhostWindow`'s timer effect does not restart on every render.
   *
   * @param {string} id - The id of the ghost (closed window) to remove.
   * @returns {void}
   *
   * @example
   * dropGhost('win-3');
   */
  const dropGhost = useCallback((id: string) => setGhosts((g) => g.filter((x) => x.id !== id)), []);

  useEffect(
    () =>
      useWM.subscribe((st, prev) => {
        if (st.windows === prev.windows) return;
        const ui = useUI.getState();

        if (ui.showDesktop && ((st.focusedId && st.focusedId !== prev.focusedId) || st.windows.length > prev.windows.length)) {
          ui.set({ showDesktop: false });
        }

        if (reduceMotionNow() || ui.missionControl || ui.showDesktop || useSystem.getState().power !== 'desktop') return;
        const hiddenApps = new Set(prev.processes.filter((p) => p.hidden).map((p) => p.appId));
        const closed = prev.windows.filter((w) => !w.minimized && !hiddenApps.has(w.appId) && !st.windows.some((x) => x.id === w.id));
        const fresh = closed.map(snapshot).filter((g): g is Ghost => !!g);
        if (fresh.length) setGhosts((g) => [...g, ...fresh]);
      }),
    [],
  );

  useEffect(() => {
    if (!showDesktop) return;
    let press: { x: number; y: number; id: number } | null = null;

    /**
     * Records a primary press that starts on empty desktop during Show Desktop.
     *
     * The desktop is the element just before this layer. Presses outside it, with other
     * buttons, or on a `DESKTOP_ITEM` inside it reset the recorded press instead.
     *
     * @param {PointerEvent} e - The pointerdown event (captured on the document).
     * @returns {void}
     *
     * @example
     * document.addEventListener('pointerdown', onDown, true);
     */
    const onDown = (e: PointerEvent) => {
      press = null;
      if (e.button !== 0) return;
      const desktop = layerRef.current?.previousElementSibling;
      const target = e.target instanceof Element ? e.target : null;
      if (!desktop || !target || !desktop.contains(target)) return;
      const item = target.closest(DESKTOP_ITEM);
      if (item && item !== desktop && desktop.contains(item)) return;
      press = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };

    /**
     * Ends Show Desktop when the recorded press is released without dragging.
     *
     * The release must come from the same pointer and be within 4px of the press, so a
     * rubber-band selection on the desktop doesn't restore the windows.
     *
     * @param {PointerEvent} e - The pointerup event (captured on the document).
     * @returns {void}
     *
     * @example
     * document.addEventListener('pointerup', onUp, true);
     */
    const onUp = (e: PointerEvent) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4) useUI.getState().set({ showDesktop: false });
      press = null;
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
    };
  }, [showDesktop]);

  return (
    <div ref={layerRef} className={s.layer} style={{ zIndex: elevated ? Z.MISSION_CONTROL + 1 : Z.WINDOWS }}>
      <SnapPreview />
      {ids.map((id) => (
        <Window key={id} id={id} />
      ))}
      {ghosts.map((g) => (
        <GhostWindow key={g.id} ghost={g} onDone={dropGhost} />
      ))}
    </div>
  );
}

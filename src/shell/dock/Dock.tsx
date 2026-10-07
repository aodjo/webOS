/**
 * The Dock.
 *
 * Items: pinned apps, running unpinned apps, a separator, minimized windows and the Trash.
 * Behaves like macOS: cosine magnification that pushes neighbors apart around the pointer,
 * launch bounce, running dots, badges, labels, right-click / long-press menus (⌥ turns Quit into
 * Force Quit), drag-to-reorder and drag-out-to-remove, file drops onto apps and the Trash,
 * autohide, separator drag to resize, ⌃F3 to focus. Every item's rest rectangle is published in
 * `dockAnchors` so the window manager can animate minimize/launch to the right spot.
 *
 * Magnification runs outside React: a rAF loop writes `--s` (slot size) and `--k` (icon scale) CSS
 * variables on each slot, so pointer moves never re-render.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  COMPACT_BREAKPOINT,
  DOCK_MARGIN,
  DOCK_PADDING,
  MENU_BAR_HEIGHT,
  PATHS,
  dockAnchors,
  extname,
  fs,
  getApp,
  getDragPaths,
  hasDragPaths,
  hasHostFiles,
  importHostFiles,
  isWithin,
  revealInFinder,
  trashPaths,
  useBadges,
  useSystem,
  useT,
  useTrashCount,
  useUI,
  useWM,
  wm,
  type AppManifest,
  type WindowState,
} from '@/kernel';
import { TrashFullIcon, TrashIcon } from '@/icons';
import { useRefraction } from '@/components/Glass';
import { Z } from '../layers';
import { bellSum, clampShift, fitIconSize, gapFor, insertionIndex, magnifiedSizes, moveTo, panelShift, restCenters, restLength, type SlotSpec } from './dockGeometry';
import { appMenu, dockMenu, minimizedMenu, normalizePinned, openDockMenu, openTrash, pinApps, setPinned, trashMenu } from './dockMenus';
import { captureWindow, dropSnapshot, hasSnapshot, mountSnapshot } from './windowSnapshot';
import { useViewport } from './useViewport';
import s from './Dock.module.css';

const S = {
  dock: { en: 'Dock', ko: 'Dock' },
  trash: { en: 'Trash', ko: '휴지통' },
  remove: { en: 'Remove', ko: '제거' },
  resize: { en: 'Drag to resize the Dock', ko: '드래그하여 Dock 크기 조절' },
}; /** Localized strings for the Dock's toolbar label, tooltips and separator hint. */

const SEP_LEN = 13; /** Separator slot length along the Dock axis: a 1px line plus 6px on each side. */
const GAP_RATIO = 0.05; /** Gap between slots as a fraction of the rest icon size. */
const RANGE_ICONS = 3; /** Magnification fades out over this many icon widths on each side of the pointer. */
const MIN_ICON = 16; /** Smallest rest icon size when shrinking to fit; past it the panel scrolls. */
const MIN_ICON_COMPACT = 14; /** Smallest rest icon size on compact (phone-width) viewports. */
const LONG_PRESS_MS = 600; /** Press duration in ms after which an item opens its Dock menu. */
const DRAG_THRESHOLD = 5; /** Pointer travel in px after which a press becomes a drag. */
const REMOVE_DISTANCE = 80; /** Distance in px past the Dock edge at which a dragged app is removed on release. */
const HIDE_DELAY = 300; /** Delay in ms before an autohidden Dock slides away. */
const EDGE_SENSOR = 4; /** Thickness in px of the screen-edge strip that reveals an autohidden Dock. */
const MIN_DOCK_SIZE = 32; /** Smallest icon size in px reachable by dragging the separator. */
const MAX_DOCK_SIZE = 96; /** Largest icon size in px reachable by dragging the separator. */
const DOCK_REFRACTION = { bezel: 16, scale: 30 }; /** Edge lensing of the glass shelf (Chromium only). */

/** One Dock entry: an app icon, the separator, a minimized-window tile or the Trash. */
type Item =
  | { kind: 'app'; key: string; appId: string; app: AppManifest; running: boolean }
  | { kind: 'sep'; key: 'sep' }
  | { kind: 'win'; key: string; win: WindowState }
  | { kind: 'trash'; key: 'trash' };

/** Layout snapshot shared with the imperative magnification, anchor and drag code. */
interface Model {
  /** Item keys in Dock order. */
  keys: string[];
  /** Rest length and magnifiability of each slot, parallel to `keys`. */
  slots: SlotSpec[];
  /** Rest centers along the Dock axis (screen px). */
  centers: number[];
  /** Rest offset of the icons across the axis (screen px): top edge (bottom Dock) or left edge (side Dock). */
  cross: number;
  /** Rest icon size (px). */
  base: number;
  /** Fully magnified icon size (px); equals `base` when magnification is off. */
  max: number;
  /** Gap between neighboring slots (px). */
  gap: number;
  /** Whether the Dock runs along a side edge (y axis) instead of the bottom (x axis). */
  vertical: boolean;
  /** Panel length at rest and its center along the axis. */
  restLen: number;
  center: number;
  /** Screen span (along the axis) the magnified panel must stay inside. */
  lo: number;
  hi: number;
}

/** Reorder drag of an app icon in progress. */
interface DragState {
  appId: string;
  /** App-section order with the dragged app at its current insertion point. */
  order: string[];
  /** Dragged far enough out of the Dock to be removed on release. */
  out: boolean;
  /** Order when the drag started (dropping back in place changes nothing). */
  origin: string[];
  /** Ghost center when the drag started (later moves are applied imperatively). */
  x0: number;
  y0: number;
}

/** Pointer press on a Dock item, tracked until release (click, long-press menu or drag). */
interface Press {
  item: Item;
  /** The pressed button (captures the pointer once a drag starts). */
  el: HTMLElement;
  pointerId: number;
  x0: number;
  y0: number;
  /** The pointer travelled past `DRAG_THRESHOLD`. */
  moved: boolean;
  /** The long-press menu opened (the release must not click). */
  menu: boolean;
  /** Long-press timer that opens the menu. */
  timer: ReturnType<typeof setTimeout>;
  /** Pointer offset from the icon center at rest size (keeps the icon under the finger while dragging). */
  grabX: number;
  grabY: number;
}

/** Rest geometry captured when a reorder drag starts. */
interface DragGeom {
  /** Rest center of the first app slot (screen px, adjusted for panel scroll). */
  firstCenter: number;
  /** Distance between neighboring slot centers. */
  step: number;
  /** Rest rectangle of the panel, used to detect dragging out of the Dock. */
  panel: DOMRect;
}

let currentDragPaths: string[] | null = null; /** FS paths of the current HTML5 drag, read at dragstart. */
const minimizedAt = new Map<string, number>(); /** Minimize time per window id; orders the window tiles. */
let poofSeq = 0; /** Counter that gives each drag-out "poof" animation a unique id. */

/**
 * Reports whether animations should be skipped.
 *
 * True when the OS Reduce Motion setting is on or the host browser reports
 * `prefers-reduced-motion: reduce` (the media query is skipped where `matchMedia` is missing).
 *
 * @returns {boolean} Whether motion should be reduced.
 *
 * @example
 * if (prefersReducedMotion()) return;
 */
function prefersReducedMotion(): boolean {
  return useSystem.getState().settings.reduceMotion || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Checks whether a path is an application bundle.
 *
 * App bundles are plain files with the `.app` extension whose content is the app id; folders
 * named `*.app` and missing paths do not count.
 *
 * @param {string} path - Virtual FS path to test.
 * @returns {boolean} True for an existing `.app` file.
 *
 * @example
 * isAppBundle('/Applications/Notes.app'); // true
 */
function isAppBundle(path: string): boolean {
  return extname(path) === 'app' && fs.stat(path)?.type === 'file';
}

/**
 * Reads the app id stored in an application bundle.
 *
 * The bundle's trimmed file content is the id; it is returned only when it names a registered
 * app.
 *
 * @param {string} path - Path of a `.app` bundle file.
 * @returns {string | null} The registered app id, or null when the file is missing or the id unknown.
 *
 * @example
 * bundleAppId('/Applications/Notes.app'); // 'notes'
 */
function bundleAppId(path: string): string | null {
  const id = (fs.stat(path)?.content ?? '').trim();
  return getApp(id) ? id : null;
}

/**
 * Decides whether an app accepts a dropped FS item.
 *
 * Apps without a window component never accept. Finder accepts anything (it opens folders and
 * reveals files). Folders are accepted by apps that list `'dir'` in `opens` and by Terminal;
 * files by apps whose `opens` lists the file's extension or `'*'`.
 *
 * @param {AppManifest} app - The app whose Dock icon is the drop target.
 * @param {string} path - Path of the dragged item.
 * @returns {boolean} True when dropping `path` on the app should open it.
 *
 * @example
 * canOpen(getApp('textedit')!, `${PATHS.documents}/todo.txt`); // true
 */
function canOpen(app: AppManifest, path: string): boolean {
  const node = fs.stat(path);
  if (!node || !app.component) return false;
  if (app.id === 'finder') return true;
  if (node.type === 'dir') return !!app.opens?.includes('dir') || app.id === 'terminal';
  const ext = extname(node.name);
  return !!app.opens?.includes(ext) || !!app.opens?.includes('*');
}

/**
 * Opens an FS item with a specific app.
 *
 * Finder opens a folder in a new Finder window and reveals a file in its enclosing folder; any
 * other app receives the path through `wm.openPath`.
 *
 * @param {AppManifest} app - The app to open the item with.
 * @param {string} path - Path of the item to open.
 * @returns {void}
 *
 * @example
 * openWith(getApp('finder')!, PATHS.desktop);
 */
function openWith(app: AppManifest, path: string): void {
  if (app.id === 'finder') {
    if (fs.isDir(path)) wm.openWindow('finder', { path });
    else revealInFinder(path);
  } else wm.openPath(path, app.id);
}

/**
 * The Dock: app icons, minimized-window tiles and the Trash along a screen edge.
 *
 * Builds the item list from the pinned apps, running unpinned apps, the separator, minimized
 * windows (ordered by minimize time) and the Trash, reading settings from `useSystem` and
 * processes/windows from `useWM`. Rest icons shrink to fit the screen and the panel scrolls only
 * when even the minimum size overflows. Magnification is driven outside React by a rAF loop that
 * writes CSS variables; layout changes animate with FLIP slides and grow-in. Also handles the
 * launch bounce, long-press and right-click menus, drag-to-reorder and drag-out-to-remove of apps,
 * HTML5 drops of files and app bundles, separator drag to resize, autohide through an edge sensor
 * strip covering the Dock's extent, and keyboard navigation (⌃F3 focuses the Dock).
 *
 * @returns {JSX.Element} The Dock, its autohide sensor and portals for the drag ghost and poofs.
 *
 * @example
 * <Dock />
 */
export function Dock() {
  const t = useT();
  const cfg = useSystem(
    useShallow((st) => ({
      size: st.settings.dockSize,
      magnification: st.settings.dockMagnification,
      magnifiedSize: st.settings.dockMagnifiedSize,
      position: st.settings.dockPosition,
      autohide: st.settings.dockAutohide,
      pinnedRaw: st.settings.dockPinned,
    })),
  );
  const running = useWM(useShallow((st) => st.processes.map((p) => p.appId)));
  const minimizedWins = useWM(useShallow((st) => st.windows.filter((w) => w.minimized)));
  const badges = useBadges((st) => st.badges);
  const trashFull = useTrashCount() > 0;
  const vp = useViewport();

  const vertical = cfg.position !== 'bottom';
  const compact = vp.w < COMPACT_BREAKPOINT;
  const [coarse] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [poofs, setPoofs] = useState<{ id: number; x: number; y: number }[]>([]);

  const pinned = useMemo(() => normalizePinned(cfg.pinnedRaw), [cfg.pinnedRaw]);

  /* ── Items ── */

  const items = useMemo<Item[]>(() => {
    const runningSet = new Set(running);
    const pinnedSet = new Set(pinned);
    const extra = running.filter((id) => !pinnedSet.has(id) && getApp(id) && !getApp(id)!.hidden && getApp(id)!.component);
    const appIds = drag ? drag.order : [...pinned, ...extra];
    const apps: Item[] = [];
    for (const id of appIds) {
      const app = getApp(id);
      if (app) apps.push({ kind: 'app', key: id, appId: id, app, running: runningSet.has(id) });
    }
    // On phones, windows minimize into their app's icon instead of getting tiles of their own, so
    // the tile count is bounded by the number of apps (they are still reachable from the app's
    // Dock menu, and clicking the app icon restores them).
    const wins: Item[] = compact
      ? []
      : [...minimizedWins]
          .sort((a, b) => (minimizedAt.get(a.id) ?? 0) - (minimizedAt.get(b.id) ?? 0))
          .map((w) => ({ kind: 'win', key: `win:${w.id}`, win: w }));
    return [...apps, { kind: 'sep', key: 'sep' }, ...wins, { kind: 'trash', key: 'trash' }];
  }, [running, pinned, minimizedWins, drag, compact]);

  /* ── Geometry ── */

  const axisStart = vertical ? MENU_BAR_HEIGHT : 0;
  const axisLen = vertical ? vp.h - MENU_BAR_HEIGHT : vp.w;
  const iconCount = items.length - 1;
  const wanted = compact ? Math.min(cfg.size, 44) : cfg.size;
  const base = fitIconSize(wanted, iconCount, SEP_LEN, items.length, DOCK_PADDING, axisLen - DOCK_MARGIN * 2 - 16, GAP_RATIO, compact ? MIN_ICON_COMPACT : MIN_ICON);
  const gap = gapFor(base, GAP_RATIO);
  const slots = useMemo(() => items.map<SlotSpec>((it) => ({ len: it.kind === 'sep' ? SEP_LEN : base, magnify: it.kind !== 'sep' })), [items, base]);
  const restLen = restLength(slots, gap, DOCK_PADDING);
  const lo = axisStart + DOCK_MARGIN;
  const hi = axisStart + axisLen - DOCK_MARGIN;
  // Limit the magnified size so the fully magnified Dock still fits on screen.
  const fitMax = base + Math.max(0, hi - lo - restLen) / bellSum(base + gap, base * RANGE_ICONS);
  const wantedMax = cfg.magnification && !compact && !coarse ? Math.min(cfg.magnifiedSize, Math.floor(fitMax)) : base;
  const max = wantedMax >= base + 4 ? wantedMax : base;
  const axisCenter = axisStart + axisLen / 2;
  // Even the smallest icons don't fit: the panel is capped to the screen (starting at `lo`) and
  // scrolls, so the end tiles stay reachable instead of being pushed off both edges.
  const overflow = restLen > hi - lo;
  const panelCenter = overflow ? lo + restLen / 2 : axisCenter;
  // Concentric with the icons: the icon body's corner (≈ a third of the icon) plus the inset to the
  // shelf edge — about 24px at the default size.
  const radius = Math.round(DOCK_PADDING + base * 0.34);

  const cross = cfg.position === 'bottom' ? vp.h - DOCK_MARGIN - DOCK_PADDING - base : cfg.position === 'left' ? DOCK_MARGIN + DOCK_PADDING : vp.w - DOCK_MARGIN - DOCK_PADDING - base;

  const model = useMemo<Model>(
    () => ({ keys: items.map((i) => i.key), slots, centers: restCenters(slots, gap, DOCK_PADDING, panelCenter), cross, base, max, gap, vertical, restLen, center: panelCenter, lo, hi }),
    [items, slots, base, max, gap, panelCenter, cross, vertical, restLen, lo, hi],
  );

  const hidden = cfg.autohide && !revealed;

  /* ── Refs shared with imperative code ── */

  const panelRef = useRef<HTMLDivElement>(null);
  // While magnification is possible the shelf resizes every frame, and each size would need a new
  // displacement map: the shelf keeps its blur and rim light but skips the lensing then.
  const shelfRef = useRefraction<HTMLDivElement>(max > base ? false : DOCK_REFRACTION);
  const ghostRef = useRef<HTMLDivElement>(null);
  const slotEls = useRef(new Map<string, HTMLDivElement>());
  const modelRef = useRef(model);
  const itemsRef = useRef(items);
  const cur = useRef(new Map<string, number>());
  const pointerRef = useRef<number | null>(null);
  const lastPointer = useRef<number | null>(null);
  const magnifying = useRef(false);
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const positions = useRef(new Map<string, number>());
  const flips = useRef(new Map<string, Animation>());
  const sigRef = useRef<string | null>(null);
  const registered = useRef(new Set<string>());
  const press = useRef<Press | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragGeom = useRef<DragGeom | null>(null);
  const ghostPos = useRef({ x: 0, y: 0 });
  const dropFrom = useRef<{ key: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const hoverRef = useRef(false);
  const menuOpen = useRef(false);
  const stopMenuTracking = useRef<(() => void) | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const autohideRef = useRef(cfg.autohide);
  const dropKeyRef = useRef(dropKey);
  useLayoutEffect(() => {
    autohideRef.current = cfg.autohide;
    dropKeyRef.current = dropKey;
  });

  /**
   * Schedules a callback that is cancelled if the Dock unmounts first.
   *
   * Wraps `setTimeout` and keeps the timer id in `timers` until it fires, so the unmount cleanup
   * can clear every pending timer.
   *
   * @param {() => void} fn - Callback to run.
   * @param {number} ms - Delay in milliseconds.
   * @returns {void}
   *
   * @example
   * later(() => setPoofs([]), 520);
   */
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  /* ── Magnification engine ── */

  /**
   * Writes the current slot sizes to the DOM.
   *
   * Sets `--s` (slot size) and `--k` (icon scale relative to the magnified size) on every
   * magnifiable slot, translates the panel by the shift that keeps the content under the last
   * pointer position stationary (clamped so the panel stays within `lo..hi`), and sets `--band` to
   * the peak growth over the rest size. Works on refs only, so it never causes a render.
   *
   * @returns {void}
   *
   * @example
   * cur.current.clear();
   * applySizes();
   */
  const applySizes = useCallback(() => {
    const m = modelRef.current;
    const panel = panelRef.current;
    if (!panel) return;
    const sizes = m.slots.map((sl, i) => (sl.magnify ? (cur.current.get(m.keys[i]) ?? m.base) : sl.len));
    let peak = m.base;
    let extra = 0;
    m.keys.forEach((k, i) => {
      if (!m.slots[i].magnify) return;
      const el = slotEls.current.get(k);
      const size = sizes[i];
      peak = Math.max(peak, size);
      extra += size - m.slots[i].len;
      if (!el) return;
      el.style.setProperty('--s', `${size}px`);
      el.style.setProperty('--k', String(size / m.max));
    });
    const shift = extra > 0.01 ? clampShift(panelShift(m.slots, m.centers, sizes, lastPointer.current), m.restLen, extra, m.center, m.lo, m.hi) : 0;
    panel.style.transform = Math.abs(shift) > 0.01 ? (m.vertical ? `translate3d(0, ${shift}px, 0)` : `translate3d(${shift}px, 0, 0)`) : '';
    panel.style.setProperty('--band', `${peak - m.base}px`);
  }, []);

  /**
   * Publishes every item's rest rectangle in `dockAnchors`.
   *
   * The rectangles drive the window manager's minimize/launch animations. They are computed from
   * the layout model rather than measured, so they are exact even while icons are magnified,
   * growing in, sliding or the Dock is auto-hidden. Anchors of items that left the Dock are kept
   * for 800 ms (unless the item comes back) so a restore/quit animation can still find them.
   *
   * @returns {void}
   *
   * @example
   * registerAnchors();
   */
  const registerAnchors = useCallback(() => {
    const m = modelRef.current;
    const seen = new Set<string>();
    m.keys.forEach((key, i) => {
      if (key === 'sep') return;
      const along = m.centers[i] - m.base / 2;
      dockAnchors.set(key, m.vertical ? new DOMRect(m.cross, along, m.base, m.base) : new DOMRect(along, m.cross, m.base, m.base));
      seen.add(key);
    });
    for (const key of registered.current) {
      if (!seen.has(key)) later(() => !modelRef.current.keys.includes(key) && dockAnchors.delete(key), 800);
    }
    registered.current = seen;
  }, [later]);

  /**
   * Records each slot's current screen position along the Dock axis.
   *
   * These positions are the FLIP baseline: after the next change to the item set, every slot
   * slides from its stored position to its new one. Does nothing before the panel is mounted.
   *
   * @returns {void}
   *
   * @example
   * storePositions();
   */
  const storePositions = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const pr = panel.getBoundingClientRect();
    const next = new Map<string, number>();
    for (const [key, el] of slotEls.current) next.set(key, modelRef.current.vertical ? pr.top + el.offsetTop : pr.left + el.offsetLeft);
    positions.current = next;
  }, []);

  /**
   * Advances the magnification animation by one frame.
   *
   * Eases every slot's size toward its target from `magnifiedSizes` for the current pointer, using
   * frame-rate-independent exponential smoothing, applies the sizes, and requests another frame
   * while any slot is still moving. Once settled with no pointer, it clears the magnified sizes,
   * re-applies the rest layout and refreshes the FLIP baseline.
   *
   * @param {number} now - The requestAnimationFrame timestamp in milliseconds.
   * @returns {void}
   *
   * @example
   * raf.current = requestAnimationFrame(tick);
   */
  const tick = useCallback(
    (now: number) => {
      const m = modelRef.current;
      const dt = lastFrame.current ? Math.min(64, now - lastFrame.current) : 16.7;
      lastFrame.current = now;
      const targets = magnifiedSizes(m.slots, m.centers, pointerRef.current, m.base, m.max, m.base * RANGE_ICONS);
      const a = 1 - Math.pow(1 - 0.3, dt / 16.7);
      let moving = false;
      m.keys.forEach((k, i) => {
        if (!m.slots[i].magnify) return;
        const c = cur.current.get(k) ?? m.base;
        let next = c + (targets[i] - c) * a;
        if (Math.abs(targets[i] - next) < 0.1) next = targets[i];
        else moving = true;
        cur.current.set(k, next);
      });
      applySizes();
      if (moving) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      raf.current = 0;
      lastFrame.current = 0;
      if (pointerRef.current === null) {
        magnifying.current = false;
        lastPointer.current = null;
        cur.current.clear();
        applySizes();
        storePositions();
      }
    },
    [applySizes, storePositions],
  );

  /**
   * Starts the magnification loop unless a frame is already pending.
   *
   * Requests one animation frame for `tick`, which keeps rescheduling itself until the sizes
   * settle.
   *
   * @returns {void}
   *
   * @example
   * kick();
   */
  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  /**
   * Sets the pointer position that drives magnification.
   *
   * A position is treated as null when magnification is off (`max` not above `base`). Null lets
   * the icons shrink back to rest, and a repeated null is a no-op. A position also becomes the last
   * pointer used for the panel shift and marks the Dock as magnifying, which suspends FLIP
   * animations. Then kicks the animation loop.
   *
   * @param {number | null} p - Pointer coordinate along the Dock axis (screen px), or null.
   * @returns {void}
   *
   * @example
   * setMagnifyPointer(vertical ? e.clientY : e.clientX);
   */
  const setMagnifyPointer = useCallback(
    (p: number | null) => {
      if (p !== null && !(modelRef.current.max > modelRef.current.base)) p = null;
      if (p === null && pointerRef.current === null) return;
      pointerRef.current = p;
      if (p !== null) {
        lastPointer.current = p;
        magnifying.current = true;
      }
      kick();
    },
    [kick],
  );

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ── Layout bookkeeping: FLIP on reorder/removal, grow-in on insertion, anchors ── */

  useLayoutEffect(() => {
    modelRef.current = model;
    itemsRef.current = items;
    const sig = model.keys.join('|');
    const prevSig = sigRef.current;
    sigRef.current = sig;
    registerAnchors();
    if (prevSig === sig) {
      applySizes();
      return;
    }
    // Sizes of items that disappeared are irrelevant; new ones start from the base size.
    for (const k of cur.current.keys()) if (!model.keys.includes(k)) cur.current.delete(k);
    applySizes();
    if (magnifying.current) return;

    const prevKeys = new Set(prevSig ? prevSig.split('|') : []);
    const added = prevSig !== null ? model.keys.filter((k) => !prevKeys.has(k)) : [];
    const animate = prevSig !== null && !prefersReducedMotion();
    const panel = panelRef.current;
    if (animate && panel) {
      if (added.length) {
        const prop = model.vertical ? 'height' : 'width';
        for (const k of added) {
          const el = slotEls.current.get(k);
          if (k === 'sep' || !el) continue;
          const anim = el.animate([{ [prop]: '0px', opacity: 0 }, { [prop]: `${model.base}px`, opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' });
          anim.onfinish = () => {
            if (!magnifying.current) storePositions();
          };
        }
      } else {
        const pr = panel.getBoundingClientRect();
        for (const [key, el] of slotEls.current) {
          const prev = positions.current.get(key);
          if (prev === undefined) continue;
          const now = model.vertical ? pr.top + el.offsetTop : pr.left + el.offsetLeft;
          let inflight = 0;
          const running = flips.current.get(key);
          if (running) {
            const tf = getComputedStyle(el).transform;
            if (tf && tf !== 'none') {
              const mtx = new DOMMatrixReadOnly(tf);
              inflight = model.vertical ? mtx.m42 : mtx.m41;
            }
            running.cancel();
          }
          const delta = prev + inflight - now;
          if (Math.abs(delta) < 0.5) continue;
          const axis = model.vertical ? 'translateY' : 'translateX';
          const anim = el.animate([{ transform: `${axis}(${delta}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' });
          flips.current.set(key, anim);

          /**
           * Forgets the slot's FLIP animation once it finishes or is cancelled.
           *
           * Removes the entry only while it still refers to this animation, so a newer FLIP started for
           * the same slot is kept.
           *
           * @returns {boolean} Whether the entry was removed.
           *
           * @example
           * anim.onfinish = done;
           */
          const done = () => flips.current.get(key) === anim && flips.current.delete(key);
          anim.onfinish = done;
          anim.oncancel = done;
        }
      }
    }
    storePositions();
  });

  // A dropped icon flies from the pointer into its new slot.
  useLayoutEffect(() => {
    const from = dropFrom.current;
    if (drag || !from) return;
    dropFrom.current = null;
    const el = slotEls.current.get(from.key)?.querySelector<HTMLElement>('[data-bouncer]');
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    const dx = from.x - (r.left + r.width / 2);
    const dy = from.y - (r.top + r.height / 2);
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' });
  }, [drag]);

  // Geometry changed (size setting, viewport, position): reset magnification and FLIP baselines.
  useEffect(() => {
    cur.current.clear();
    applySizes();
    const id = requestAnimationFrame(storePositions);
    return () => cancelAnimationFrame(id);
  }, [base, max, cfg.position, vp.w, vp.h, applySizes, storePositions]);

  // On unmount (e.g. at log out) every anchor this Dock registered is removed.
  useEffect(
    () => () => {
      for (const key of registered.current) dockAnchors.delete(key);
    },
    [],
  );

  /* ── Bounce when an app's process appears ── */

  /**
   * Plays the launch bounce on an app's icon.
   *
   * Animates the icon's `[data-bouncer]` wrapper away from the screen edge in two decaying hops
   * (half, then 28% of the icon size) over 1.1 s. Skipped with reduced motion or when the app has
   * no slot.
   *
   * @param {string} appId - App whose icon bounces.
   * @returns {void}
   *
   * @example
   * bounce('notes');
   */
  const bounce = useCallback(
    (appId: string) => {
      if (prefersReducedMotion()) return;
      const el = slotEls.current.get(appId)?.querySelector<HTMLElement>('[data-bouncer]');
      if (!el) return;
      const m = modelRef.current;
      const sign = cfg.position === 'left' ? 1 : -1;

      /**
       * Builds the transform for a bounce offset.
       *
       * Translates across the Dock axis toward the screen center: up for a bottom Dock, right for a
       * left Dock, left for a right Dock.
       *
       * @param {number} v - Offset from the rest position in px.
       * @returns {string} A CSS `translateX(...)` or `translateY(...)` value.
       *
       * @example
       * tf(26); // 'translateY(-26px)' on a bottom Dock
       */
      const tf = (v: number) => (m.vertical ? `translateX(${sign * v}px)` : `translateY(${sign * v}px)`);
      const up = 'cubic-bezier(0.25, 0.6, 0.4, 1)';
      const down = 'cubic-bezier(0.6, 0, 0.75, 0.4)';
      el.animate(
        [
          { transform: tf(0), easing: up },
          { transform: tf(m.base * 0.5), offset: 0.22, easing: down },
          { transform: tf(0), offset: 0.46, easing: up },
          { transform: tf(m.base * 0.28), offset: 0.66, easing: down },
          { transform: tf(0), offset: 0.86 },
          { transform: tf(0) },
        ],
        { duration: 1100 },
      );
    },
    [cfg.position],
  );

  const prevRunning = useRef<Set<string> | null>(null);
  const mountedAt = useRef(0);
  useEffect(() => {
    if (!mountedAt.current) mountedAt.current = performance.now();
    const now = new Set(running);
    const prev = prevRunning.current;
    prevRunning.current = now;
    // Skip the burst of processes started with the session (Finder at login).
    if (!prev || performance.now() - mountedAt.current < 600) return;
    for (const id of now) if (!prev.has(id)) bounce(id);
  }, [running, bounce]);

  /* ── Window-manager observer: minimize snapshots, tile order and anchor predictions ── */

  useEffect(() => {
    let prev = useWM.getState();

    /**
     * Pre-registers a guessed anchor for an item that is about to appear.
     *
     * The window manager may animate toward an item before the Dock has rendered it, so its anchor
     * is guessed from a neighbor's anchor shifted by half a slot in `dir`. Nothing changes when the
     * item already has an anchor or the neighbor has none.
     *
     * @param {string} key - Key of the item that will appear.
     * @param {string} refKey - Key of the neighbor whose anchor is the reference.
     * @param {1 | -1} dir - Direction along the Dock axis (1 = after the neighbor, -1 = before).
     * @returns {void}
     *
     * @example
     * predict(`win:${w.id}`, 'trash', -1);
     */
    const predict = (key: string, refKey: string, dir: 1 | -1) => {
      if (dockAnchors.has(key)) return;
      const ref = dockAnchors.get(refKey);
      if (!ref) return;
      const m = modelRef.current;
      const half = ((m.base + m.gap) / 2) * dir;
      dockAnchors.set(key, m.vertical ? new DOMRect(ref.x, ref.y + half, ref.width, ref.height) : new DOMRect(ref.x + half, ref.y, ref.width, ref.height));
    };
    const unsub = useWM.subscribe((state) => {
      if (state.windows === prev.windows && state.processes === prev.processes) {
        prev = state;
        return;
      }
      const before = new Map(prev.windows.map((w) => [w.id, w]));
      for (const w of state.windows) {
        const old = before.get(w.id);
        if (w.minimized && !old?.minimized) {
          minimizedAt.set(w.id, Date.now());
          // The window DOM is still un-minimized right now (React hasn't rendered yet).
          captureWindow(w.id, w.width, w.height);
          // The new tile will appear just before the Trash, which shifts along by half a slot.
          predict(`win:${w.id}`, 'trash', -1);
        } else if (!w.minimized && old?.minimized) {
          minimizedAt.delete(w.id);
          dropSnapshot(w.id);
        }
      }
      const live = new Set(state.windows.map((w) => w.id));
      for (const id of before.keys()) {
        if (!live.has(id)) {
          minimizedAt.delete(id);
          dropSnapshot(id);
        }
      }
      if (state.processes !== prev.processes) {
        const known = new Set(prev.processes.map((p) => p.appId));
        const appKeys = itemsRef.current.filter((i) => i.kind === 'app').map((i) => i.key);
        const last = appKeys[appKeys.length - 1];
        for (const p of state.processes) {
          if (!known.has(p.appId) && !appKeys.includes(p.appId) && last) predict(p.appId, last, 1);
        }
      }
      prev = state;
    });
    return unsub;
  }, []);

  /* ── Autohide ── */

  /**
   * Cancels a pending autohide.
   *
   * Clears the hide timer, if any, and forgets its id.
   *
   * @returns {void}
   *
   * @example
   * clearHide();
   */
  const clearHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  /**
   * Shows an autohidden Dock.
   *
   * Cancels any pending hide and, when autohide is on, marks the Dock as revealed so it slides in.
   *
   * @returns {void}
   *
   * @example
   * <div onPointerEnter={reveal} />
   */
  const reveal = useCallback(() => {
    clearHide();
    if (autohideRef.current) setRevealed(true);
  }, [clearHide]);

  /**
   * Hides an autohidden Dock after a delay.
   *
   * Does nothing unless autohide is on. Restarts the hide timer; when it fires, the Dock stays
   * visible while it is hovered, a Dock menu is open, an icon is pressed or dragged, or a file
   * drag is over an item.
   *
   * @param {number} [delay=HIDE_DELAY] - Delay in milliseconds.
   * @returns {void}
   *
   * @example
   * scheduleHide();
   */
  const scheduleHide = useCallback(
    (delay = HIDE_DELAY) => {
      if (!autohideRef.current) return;
      clearHide();
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        if (hoverRef.current || menuOpen.current || dragRef.current || press.current || dropKeyRef.current) return;
        setRevealed(false);
      }, delay);
    },
    [clearHide],
  );

  useEffect(() => {
    if (!cfg.autohide || !revealed) return;

    /**
     * Keeps a revealed Dock visible while the pointer is in its zone, otherwise schedules hiding.
     *
     * The zone reaches from the screen edge across the panel thickness, the edge margin and the
     * magnified band, and along the rest panel length plus 1.5x the magnified growth on each side
     * (the magnified panel grows by about three icons' worth). It comes from the rest layout rather
     * than the panel's live rect, so it is already right while the Dock is still sliding in under a
     * pointer resting on the screen edge.
     *
     * @param {PointerEvent} e - The window pointermove event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointermove', onMove);
     */
    const onMove = (e: PointerEvent) => {
      const m = modelRef.current;
      const grow = m.max - m.base;
      const depth = m.base + DOCK_PADDING * 2 + DOCK_MARGIN + grow + 8;
      const along = m.vertical ? e.clientY : e.clientX;
      const alongIn = Math.abs(along - m.center) <= m.restLen / 2 + grow * 1.5 + 8;
      const across = cfg.position === 'bottom' ? window.innerHeight - e.clientY : cfg.position === 'left' ? e.clientX : window.innerWidth - e.clientX;
      if (alongIn && across <= depth) clearHide();
      else if (!hideTimer.current) scheduleHide();
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [cfg.autohide, cfg.position, revealed, clearHide, scheduleHide]);

  // Toggling autohide always starts from the hidden state (like macOS).
  useEffect(() => {
    autohideRef.current = cfg.autohide;
    setRevealed(false);
  }, [cfg.autohide]);

  useEffect(
    () => () => {
      stopMenuTracking.current?.();
      clearHide();
      for (const id of timers.current) clearTimeout(id);
      if (press.current) clearTimeout(press.current.timer);
    },
    [clearHide],
  );

  /* ── Track HTML5 drags of FS items (to know what is being dragged over us) ── */

  useEffect(() => {
    /**
     * Captures the FS paths of a starting HTML5 drag.
     *
     * Stores them in `currentDragPaths` (null for drags without FS paths) because dragover handlers
     * cannot read the drag payload.
     *
     * @param {DragEvent} e - The window dragstart event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('dragstart', onStart);
     */
    const onStart = (e: DragEvent) => {
      currentDragPaths = hasDragPaths(e) ? getDragPaths(e) : null;
    };

    /**
     * Resets drag state when an HTML5 drag ends or is dropped.
     *
     * Forgets the dragged paths, clears the drop highlight and lets the icons shrink back.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('dragend', onEnd);
     */
    const onEnd = () => {
      currentDragPaths = null;
      setDropKey(null);
      setMagnifyPointer(null);
    };
    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('drop', onEnd);
    return () => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('drop', onEnd);
    };
  }, [setMagnifyPointer]);

  /* ── ⌃F3: move keyboard focus to the Dock ── */

  useEffect(() => {
    /**
     * Moves keyboard focus to the Dock on ⌃F3.
     *
     * Reveals an autohidden Dock and focuses its first item button without scrolling.
     *
     * @param {KeyboardEvent} e - The window keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'F3') {
        e.preventDefault();
        reveal();
        panelRef.current?.querySelector<HTMLButtonElement>('button[data-dock-item]')?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal]);

  /* ── Menus ── */

  /**
   * Opens the Dock menu for an item.
   *
   * Builds the menu by item kind (app, minimized window, Trash, or the Dock menu for the separator
   * and panel) and places it just outside the Dock next to the item: at the pointer's coordinate
   * along the axis when `at` is given, otherwise centered on the item; the menu host flips/clamps
   * it on screen. Any previous Dock menu is finished first so its close bookkeeping cannot clobber
   * this one. While open, the tooltip is hidden, magnification stays frozen (keeping the menu next
   * to its icon) and the Dock stays revealed; on close, magnification is released and hiding is
   * scheduled unless the pointer is over the Dock.
   *
   * @param {Item} item - The item whose menu opens.
   * @param {{ x: number; y: number }} [at] - Pointer position that opened the menu; omitted for keyboard.
   * @param {boolean} [alt=false] - Whether Option was held (turns Quit into Force Quit).
   * @returns {void}
   *
   * @example
   * openMenuFor(item, { x: e.clientX, y: e.clientY }, e.altKey);
   */
  const openMenuFor = (item: Item, at?: { x: number; y: number }, alt = false) => {
    /**
     * Builds the item's menu entries.
     *
     * Called again by the menu host whenever Option is pressed or released while the menu is open.
     *
     * @param {boolean} a - Whether Option is held.
     * @returns {MenuItem[]} The menu entries for the item's kind.
     *
     * @example
     * build(false);
     */
    const build = (a: boolean) => (item.kind === 'app' ? appMenu(item.appId, a) : item.kind === 'win' ? minimizedMenu(item.win.id) : item.kind === 'trash' ? trashMenu() : dockMenu());
    const el = slotEls.current.get(item.key);
    const r = el?.getBoundingClientRect();
    let x = at?.x ?? 0;
    let y = at?.y ?? 0;
    if (r) {
      if (cfg.position === 'bottom') {
        x = at?.x ?? r.left + r.width / 2;
        y = r.top - 6;
      } else if (cfg.position === 'left') {
        x = r.right + 6;
        y = at?.y ?? r.top + r.height / 2;
      } else {
        x = r.left - 6;
        y = at?.y ?? r.top + r.height / 2;
      }
    }
    stopMenuTracking.current?.();
    setHovered(null);
    setMenuFor(item.key);
    menuOpen.current = true;
    reveal();
    stopMenuTracking.current = openDockMenu(
      x,
      y,
      build,
      () => {
        menuOpen.current = false;
        stopMenuTracking.current = null;
        setMenuFor((k) => (k === item.key ? null : k));
        if (!hoverRef.current) {
          setMagnifyPointer(null);
          scheduleHide();
        }
      },
      alt,
    );
  };

  /**
   * Handles a right-click or keyboard context-menu request on a Dock item.
   *
   * Suppresses the browser menu and opens the item's Dock menu with the event's Option state.
   * Touch browsers also fire `contextmenu` on a long press, so during an active press the menu is
   * opened only once and the long-press timer is cancelled. A keyboard-generated event (at 0,0)
   * places the menu on the item instead of the pointer.
   *
   * @param {ReactMouseEvent} e - The contextmenu event.
   * @param {Item} item - The item that was clicked.
   * @returns {void}
   *
   * @example
   * <button onContextMenu={(e) => onItemContextMenu(e, item)} />
   */
  const onItemContextMenu = (e: ReactMouseEvent, item: Item) => {
    e.preventDefault();
    e.stopPropagation();
    if (press.current) {
      if (press.current.menu) return;
      clearTimeout(press.current.timer);
      press.current.menu = true;
      suppressClick.current = true;
    }
    const keyboard = e.clientX === 0 && e.clientY === 0;
    openMenuFor(item, keyboard ? undefined : { x: e.clientX, y: e.clientY }, e.altKey);
  };

  /* ── Clicks ── */

  /**
   * Performs an item's click action.
   *
   * Apps are launched or brought forward (closing Launchpad unless the app is Launchpad itself),
   * minimized windows are restored and the Trash opens in Finder. Ignored while a drag or a
   * long-press menu has suppressed the click.
   *
   * @param {Item} item - The clicked item.
   * @returns {void}
   *
   * @example
   * <button onClick={() => activate(item)} />
   */
  const activate = (item: Item) => {
    if (suppressClick.current) return;
    if (item.kind === 'app') {
      if (item.appId !== 'launchpad' && useUI.getState().launchpad) useUI.getState().set({ launchpad: false });
      wm.launch(item.appId);
    } else if (item.kind === 'win') wm.restore(item.win.id);
    else if (item.kind === 'trash') openTrash();
  };

  /* ── Pointer: long-press menu, reorder drag, drag-out to remove ── */

  /**
   * Starts a reorder drag for a pressed app icon.
   *
   * Captures rest geometry from the layout model, since magnification is switched off while
   * dragging: the first app slot's center adjusted for panel scroll, the slot pitch, and the rest
   * panel rectangle used to detect dragging out. Places the ghost so the grabbed point stays under
   * the pointer, suppresses the click and switches the Dock into drag mode. Non-app items are
   * ignored.
   *
   * @param {Press} p - The active press.
   * @param {PointerEvent} e - The pointermove event that crossed the drag threshold.
   * @returns {void}
   *
   * @example
   * startDrag(p, e);
   */
  const startDrag = (p: Press, e: PointerEvent) => {
    if (p.item.kind !== 'app') return;
    const m = modelRef.current;
    const order = itemsRef.current.filter((i) => i.kind === 'app').map((i) => i.key);
    const firstIdx = m.keys.indexOf(order[0]);
    if (firstIdx < 0) return;
    const along = m.centers[0] - m.slots[0].len / 2 - DOCK_PADDING;
    const across = m.cross - DOCK_PADDING;
    const thick = m.base + DOCK_PADDING * 2;
    const restPanel = m.vertical ? new DOMRect(across, along, thick, m.restLen) : new DOMRect(along, across, m.restLen, thick);
    const panel = panelRef.current;
    const scrolled = panel ? (m.vertical ? panel.scrollTop : panel.scrollLeft) : 0;
    dragGeom.current = { firstCenter: m.centers[firstIdx] - scrolled, step: m.base + m.gap, panel: restPanel };
    const x0 = e.clientX - p.grabX;
    const y0 = e.clientY - p.grabY;
    ghostPos.current = { x: x0, y: y0 };
    const st: DragState = { appId: p.item.appId, order, out: false, origin: order, x0, y0 };
    dragRef.current = st;
    suppressClick.current = true;
    setMagnifyPointer(null);
    setHovered(null);
    setDrag(st);
  };

  /**
   * Follows the pointer during a reorder drag.
   *
   * Moves the ghost imperatively and marks the drag as out once the pointer is more than
   * `REMOVE_DISTANCE` px beyond the panel toward the screen center; otherwise moves the dragged app
   * to the insertion index under the pointer (never ahead of Finder at index 0). React state is
   * updated, after storing a FLIP baseline, only when the order or the out flag changes.
   *
   * @param {PointerEvent} e - The window pointermove event.
   * @param {Press} p - The active press, which holds the grab offset.
   * @returns {void}
   *
   * @example
   * updateDrag(e, p);
   */
  const updateDrag = (e: PointerEvent, p: Press) => {
    const st = dragRef.current;
    const g = dragGeom.current;
    if (!st || !g) return;
    const m = modelRef.current;
    const cx = e.clientX - p.grabX;
    const cy = e.clientY - p.grabY;
    ghostPos.current = { x: cx, y: cy };
    if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${cx - m.base / 2}px, ${cy - m.base / 2}px, 0)`;
    const away = cfg.position === 'bottom' ? g.panel.top - e.clientY : cfg.position === 'left' ? e.clientX - g.panel.right : g.panel.left - e.clientX;
    const out = away > REMOVE_DISTANCE;
    let order = st.order;
    if (!out) {
      const idx = insertionIndex(m.vertical ? cy : cx, g.firstCenter, g.step, 1, st.order.length - 1);
      if (st.order.indexOf(st.appId) !== idx) order = moveTo(st.order, st.appId, idx);
    }
    if (out !== st.out || order !== st.order) {
      storePositions();
      const next = { ...st, order, out };
      dragRef.current = next;
      setDrag(next);
    }
  };

  /**
   * Completes a reorder drag on pointer release.
   *
   * Stores the FLIP baseline from what is on screen (the dragged slot may be collapsed). A drag
   * that ended out of the Dock unpins the app and, if it is not running, plays a poof at the
   * release point. Otherwise the new order is saved: pinned apps keep their new positions and a
   * running-but-unpinned app that was actually moved becomes pinned (like macOS), and the icon
   * then flies from the ghost position into its slot. Finally leaves drag mode and schedules hiding
   * unless the pointer is over the Dock.
   *
   * @param {PointerEvent} e - The pointerup event.
   * @returns {void}
   *
   * @example
   * finishDrag(e);
   */
  const finishDrag = (e: PointerEvent) => {
    const st = dragRef.current;
    dragRef.current = null;
    dragGeom.current = null;
    if (!st) return;
    const isRunning = useWM.getState().processes.some((p) => p.appId === st.appId);
    storePositions();
    if (st.out) {
      setPinned(pinned.filter((id) => id !== st.appId));
      if (!isRunning) {
        const id = ++poofSeq;
        setPoofs((list) => [...list, { id, x: e.clientX, y: e.clientY }]);
        later(() => setPoofs((list) => list.filter((pf) => pf.id !== id)), 520);
      }
    } else {
      const moved = st.order.join('|') !== st.origin.join('|');
      const pinnedSet = new Set(pinned);
      const next = st.order.filter((id) => pinnedSet.has(id) || (moved && id === st.appId));
      if (next.join('|') !== pinned.join('|')) setPinned(next);
      dropFrom.current = { key: st.appId, ...ghostPos.current };
    }
    setDrag(null);
    if (!hoverRef.current) scheduleHide();
  };

  const pressHandlers = useRef({
    /**
     * Placeholder for the active press's pointermove handler.
     *
     * Does nothing; a layout effect replaces it with `onPressMove` after every render.
     *
     * @param {PointerEvent} _e - The pointermove event (unused).
     * @returns {void}
     *
     * @example
     * pressHandlers.current.move(e);
     */
    move: (_e: PointerEvent) => {},

    /**
     * Placeholder for the active press's pointerup/pointercancel handler.
     *
     * Does nothing; a layout effect replaces it with `onPressUp` after every render.
     *
     * @param {PointerEvent} _e - The pointerup or pointercancel event (unused).
     * @returns {void}
     *
     * @example
     * pressHandlers.current.up(e);
     */
    up: (_e: PointerEvent) => {},
  });

  /**
   * Tracks the active press while the pointer moves.
   *
   * Once the pointer travels more than `DRAG_THRESHOLD` px the press counts as moved: the
   * long-press timer is cancelled, the following click is suppressed and the pressed look is
   * removed. If no menu opened and the item is an app other than Finder, a reorder drag starts and
   * the pointer is captured so moves keep arriving over iframes (Safari) and outside the browser
   * window. During a drag, default handling such as scrolling is prevented and the drag follows the
   * pointer. Events from other pointers are ignored.
   *
   * @param {PointerEvent} e - The window pointermove event.
   * @returns {void}
   *
   * @example
   * pressHandlers.current = { move: onPressMove, up: onPressUp };
   */
  const onPressMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > DRAG_THRESHOLD) {
      p.moved = true;
      clearTimeout(p.timer);
      suppressClick.current = true;
      delete p.el.dataset.pressed;
      if (!p.menu && p.item.kind === 'app' && p.item.appId !== 'finder') {
        startDrag(p, e);
        try {
          p.el.setPointerCapture?.(p.pointerId);
        } catch {
          /* the pointer is already gone */
        }
      }
    }
    if (dragRef.current) {
      e.preventDefault();
      updateDrag(e, p);
    }
  };

  /**
   * Ends the active press on pointerup or pointercancel.
   *
   * Clears the long-press timer, the pressed look and the window listeners. A drag completes on
   * pointerup and is reverted on pointercancel (the system took the pointer, e.g. for a touch
   * scroll). A suppressed click stays suppressed until the click that follows this release has
   * been dispatched: immediately for mice, 350 ms later for touch, whose browsers dispatch it
   * later. Events from other pointers are ignored.
   *
   * @param {PointerEvent} e - The window pointerup or pointercancel event.
   * @returns {void}
   *
   * @example
   * pressHandlers.current = { move: onPressMove, up: onPressUp };
   */
  const onPressUp = (e: PointerEvent) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    press.current = null;
    clearTimeout(p.timer);
    delete p.el.dataset.pressed;
    window.removeEventListener('pointermove', onWinMove);
    window.removeEventListener('pointerup', onWinUp);
    window.removeEventListener('pointercancel', onWinUp);
    if (dragRef.current) {
      if (e.type === 'pointercancel') {
        dragRef.current = null;
        dragGeom.current = null;
        setDrag(null);
      } else finishDrag(e);
    }
    if (suppressClick.current) later(() => (suppressClick.current = false), e.pointerType === 'mouse' ? 0 : 350);
  };
  useLayoutEffect(() => {
    pressHandlers.current = { move: onPressMove, up: onPressUp };
  });

  /**
   * Stable window pointermove listener for the active press.
   *
   * Created once, so the same function can be added and removed, and forwards to the latest
   * `onPressMove` through `pressHandlers`.
   *
   * @param {PointerEvent} e - The window pointermove event.
   * @returns {void}
   *
   * @example
   * window.addEventListener('pointermove', onWinMove, { passive: false });
   */
  const [onWinMove] = useState(() => (e: PointerEvent) => pressHandlers.current.move(e));

  /**
   * Stable window pointerup/pointercancel listener for the active press.
   *
   * Created once, so the same function can be added and removed, and forwards to the latest
   * `onPressUp` through `pressHandlers`.
   *
   * @param {PointerEvent} e - The window pointerup or pointercancel event.
   * @returns {void}
   *
   * @example
   * window.addEventListener('pointerup', onWinUp);
   */
  const [onWinUp] = useState(() => (e: PointerEvent) => pressHandlers.current.up(e));

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    },
    [onWinMove, onWinUp],
  );

  /**
   * Starts tracking a press on a Dock item.
   *
   * Ignores non-primary mouse buttons and presses while another press is active. Records the grab
   * offset from the icon's center scaled to the rest size (the icon may be magnified), arms the
   * long-press timer that opens the item's menu after `LONG_PRESS_MS`, applies the pressed look via
   * `data-pressed` (`:active` does not apply in every browser once mousedown is prevented) and
   * listens for moves and release on the window.
   *
   * @param {ReactPointerEvent} e - The pointerdown event on the item's button.
   * @param {Item} item - The pressed item.
   * @returns {void}
   *
   * @example
   * <button onPointerDown={(e) => onItemPointerDown(e, item)} />
   */
  const onItemPointerDown = (e: ReactPointerEvent, item: Item) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (press.current) return;
    suppressClick.current = false;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const k = r.width ? modelRef.current.base / r.width : 1;
    const p: Press = {
      item,
      el: e.currentTarget as HTMLElement,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      menu: false,
      grabX: r.width ? (e.clientX - (r.left + r.width / 2)) * k : 0,
      grabY: r.height ? (e.clientY - (r.top + r.height / 2)) * k : 0,
      timer: setTimeout(() => {
        if (press.current !== p || p.moved) return;
        p.menu = true;
        suppressClick.current = true;
        openMenuFor(item, { x: p.x0, y: p.y0 });
      }, LONG_PRESS_MS),
    };
    press.current = p;
    p.el.dataset.pressed = '';
    window.addEventListener('pointermove', onWinMove, { passive: false });
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
  };

  /* ── Keyboard ── */

  /**
   * Keyboard navigation between Dock items.
   *
   * Applies only while an item button is focused. The arrow keys along the Dock axis and Home/End
   * move focus between items; the ContextMenu key or Shift+F10 opens the focused item's menu;
   * Escape blurs it; Enter and Space activate the button natively but stop propagation so the
   * focused window's shortcuts do not also fire. Other keys pass through.
   *
   * @param {ReactKeyboardEvent} e - The keydown event on the panel.
   * @returns {void}
   *
   * @example
   * <div role="toolbar" onKeyDown={onPanelKeyDown} />
   */
  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[data-dock-item]') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    let target = -1;
    if (e.key === prevKey) target = Math.max(0, i - 1);
    else if (e.key === nextKey) target = Math.min(buttons.length - 1, i + 1);
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = buttons.length - 1;
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      e.stopPropagation();
      const key = buttons[i].dataset.dockItem;
      const item = itemsRef.current.find((it) => it.key === key);
      if (item) openMenuFor(item);
      return;
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      buttons[i].blur();
      return;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    buttons[target].focus({ preventScroll: true });
  };

  /* ── HTML5 drops (files from Finder / Desktop / the host OS) ── */

  /**
   * Accepts or rejects an HTML5 drag over a Dock item.
   *
   * Only FS drags (Finder, Desktop) and host-file drags are considered. The Trash accepts FS items
   * as a move unless they are all app bundles. An app accepts app bundles (to pin them) and FS
   * items it can open; when the dragged paths are unknown, an app with a window accepts any FS
   * drag, and a host-file drag if it opens some file types (Finder always). An accepted drag
   * highlights the item and keeps the Dock magnified around the pointer.
   *
   * @param {ReactDragEvent} e - The dragover event.
   * @param {Item} item - The item under the pointer.
   * @returns {void}
   *
   * @example
   * <div onDragOver={(e) => onItemDragOver(e, item)} />
   */
  const onItemDragOver = (e: ReactDragEvent, item: Item) => {
    const fsDrag = hasDragPaths(e);
    const host = !fsDrag && hasHostFiles(e);
    if (!fsDrag && !host) return;
    const paths = fsDrag ? currentDragPaths : null;
    const allBundles = !!paths?.length && paths.every(isAppBundle);
    let ok = false;
    let effect: DataTransfer['dropEffect'] = 'copy';
    if (item.kind === 'trash') {
      ok = fsDrag && !allBundles;
      effect = 'move';
    } else if (item.kind === 'app') {
      if (allBundles) ok = true;
      else if (paths) ok = paths.some((p) => canOpen(item.app, p));
      else ok = fsDrag ? !!item.app.component : !!item.app.component && (!!item.app.opens?.length || item.appId === 'finder');
    }
    if (!ok) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = effect;
    if (dropKey !== item.key) setDropKey(item.key);
    setMagnifyPointer(vertical ? e.clientY : e.clientX);
  };

  /**
   * Clears an item's drop highlight when a drag leaves it.
   *
   * Moves between the item's own descendants are ignored.
   *
   * @param {ReactDragEvent} e - The dragleave event.
   * @param {Item} item - The item being left.
   * @returns {void}
   *
   * @example
   * <div onDragLeave={(e) => onItemDragLeave(e, item)} />
   */
  const onItemDragLeave = (e: ReactDragEvent, item: Item) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropKey((k) => (k === item.key ? null : k));
  };

  /**
   * Handles an HTML5 drop on a Dock item.
   *
   * On the Trash, dropped FS items outside the Trash are moved into it (items already there stay
   * put, like macOS). On an app: app bundles are pinned before that app; FS items it can open are
   * opened with it; host files are imported into Downloads and then opened with the app, or the
   * first one is revealed in Finder when the app can open none of them. Other items ignore drops.
   *
   * @param {ReactDragEvent} e - The drop event.
   * @param {Item} item - The item that received the drop.
   * @returns {void}
   *
   * @example
   * <div onDrop={(e) => onItemDrop(e, item)} />
   */
  const onItemDrop = (e: ReactDragEvent, item: Item) => {
    e.preventDefault();
    e.stopPropagation();
    setDropKey(null);
    setMagnifyPointer(null);
    const paths = getDragPaths(e);
    const files = Array.from(e.dataTransfer.files ?? []);
    currentDragPaths = null;
    if (item.kind === 'trash') {
      const outside = paths.filter((p) => !isWithin(p, PATHS.trash));
      if (outside.length) void trashPaths(outside);
      return;
    }
    if (item.kind !== 'app') return;
    if (paths.length && paths.every(isAppBundle)) {
      pinApps(paths.map(bundleAppId).filter((id): id is string => !!id), item.appId);
      return;
    }
    if (paths.length) {
      for (const p of paths) if (canOpen(item.app, p)) openWith(item.app, p);
      return;
    }
    if (files.length) {
      void importHostFiles(files, PATHS.downloads).then(({ created }) => {
        const openable = created.filter((p) => canOpen(item.app, p));
        if (openable.length) openable.forEach((p) => openWith(item.app, p));
        else if (created.length) revealInFinder(created[0]);
      });
    }
  };

  /**
   * Handles an HTML5 drag over the Dock panel.
   *
   * For FS or host-file drags, reveals the Dock and magnifies around the pointer. Accepts the drag
   * as a copy when every dragged path is an app bundle, so bundles can be dropped anywhere on the
   * Dock to pin them.
   *
   * @param {ReactDragEvent} e - The dragover event.
   * @returns {void}
   *
   * @example
   * <div onDragOver={onPanelDragOver} />
   */
  const onPanelDragOver = (e: ReactDragEvent) => {
    if (!hasDragPaths(e) && !hasHostFiles(e)) return;
    reveal();
    setMagnifyPointer(vertical ? e.clientY : e.clientX);
    if (currentDragPaths?.length && currentDragPaths.every(isAppBundle)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  /**
   * Resets the panel when a drag leaves the Dock.
   *
   * Ignores moves into the panel's descendants; otherwise releases magnification, clears the drop
   * highlight and schedules hiding unless the pointer is over the Dock.
   *
   * @param {ReactDragEvent} e - The dragleave event.
   * @returns {void}
   *
   * @example
   * <div onDragLeave={onPanelDragLeave} />
   */
  const onPanelDragLeave = (e: ReactDragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setMagnifyPointer(null);
    setDropKey(null);
    if (!hoverRef.current) scheduleHide();
  };

  /**
   * Pins app bundles dropped on the Dock panel outside any item.
   *
   * Releases magnification, then appends the bundles' apps to the pinned list when every dropped
   * path is an app bundle; any other drop is left alone.
   *
   * @param {ReactDragEvent} e - The drop event.
   * @returns {void}
   *
   * @example
   * <div onDrop={onPanelDrop} />
   */
  const onPanelDrop = (e: ReactDragEvent) => {
    const paths = getDragPaths(e);
    setMagnifyPointer(null);
    if (!paths.length || !paths.every(isAppBundle)) return;
    e.preventDefault();
    pinApps(paths.map(bundleAppId).filter((id): id is string => !!id));
  };

  /* ── Separator: drag to resize, right-click for Dock options ── */

  const sepDrag = useRef<{ id: number; start: number; size: number; raf: number } | null>(null);

  /**
   * Starts resizing the Dock by dragging the separator.
   *
   * Primary button only. Captures the pointer, records the start coordinate across the Dock axis
   * and the current size setting, and releases magnification for the duration of the resize.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - The pointerdown event on the separator.
   * @returns {void}
   *
   * @example
   * <div role="separator" onPointerDown={onSepPointerDown} />
   */
  const onSepPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sepDrag.current = { id: e.pointerId, start: vertical ? e.clientX : e.clientY, size: cfg.size, raf: 0 };
    setMagnifyPointer(null);
  };

  /**
   * Resizes the Dock while the separator is dragged.
   *
   * Moving away from the screen edge grows the icons. The size is rounded, clamped to
   * `MIN_DOCK_SIZE..MAX_DOCK_SIZE` and written to the settings at most once per animation frame.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - The pointermove event on the separator.
   * @returns {void}
   *
   * @example
   * <div role="separator" onPointerMove={onSepPointerMove} />
   */
  const onSepPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = sepDrag.current;
    if (!d || d.id !== e.pointerId) return;
    const pos = vertical ? e.clientX : e.clientY;
    const delta = cfg.position === 'bottom' ? d.start - pos : cfg.position === 'left' ? pos - d.start : d.start - pos;
    const size = Math.round(Math.min(MAX_DOCK_SIZE, Math.max(MIN_DOCK_SIZE, d.size + delta)));
    cancelAnimationFrame(d.raf);
    d.raf = requestAnimationFrame(() => {
      if (useSystem.getState().settings.dockSize !== size) useSystem.getState().updateSettings({ dockSize: size });
    });
  };

  /**
   * Ends a separator resize for the pointer that started it.
   *
   * Other pointers are ignored.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - The pointerup or pointercancel event.
   * @returns {void}
   *
   * @example
   * <div role="separator" onPointerUp={onSepPointerUp} />
   */
  const onSepPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (sepDrag.current?.id === e.pointerId) sepDrag.current = null;
  };

  /* ── Render ── */

  const rootStyle = {
    zIndex: Z.DOCK,
    '--base': `${base}px`,
    '--max': `${max}px`,
    '--kb': String(base / max),
    '--pad': `${DOCK_PADDING}px`,
    '--gap': `${gap}px`,
    '--radius': `${radius}px`,
    '--margin': `${DOCK_MARGIN}px`,
    '--menubar': `${MENU_BAR_HEIGHT}px`,
  } as CSSProperties;

  // The autohide trigger strip covers the Dock's extent along its screen edge.
  const panelStart = panelCenter - restLen / 2;
  const panelLen = Math.min(restLen, hi - lo);
  const sensorStyle: CSSProperties = vertical
    ? { zIndex: Z.DOCK, top: panelStart, height: panelLen, width: EDGE_SENSOR, [cfg.position === 'left' ? 'left' : 'right']: 0 }
    : { zIndex: Z.DOCK, left: panelStart, width: panelLen, height: EDGE_SENSOR, bottom: 0 };

  const positionClass = cfg.position === 'left' ? s.left : cfg.position === 'right' ? s.right : s.bottom;
  const showTips = !drag && !menuFor && !hidden;
  const draggedApp = drag ? getApp(drag.appId) : null;
  const DraggedIcon = draggedApp?.icon;

  return (
    <>
      {hidden && <div className={s.sensor} style={sensorStyle} onPointerEnter={reveal} onPointerMove={reveal} onMouseDown={(e) => e.preventDefault()} onDragEnter={reveal} aria-hidden />}
      <div className={`${s.root} ${positionClass} ${vertical ? s.vertical : ''} ${hidden ? s.hidden : ''}`} style={rootStyle}>
        <div
          ref={panelRef}
          className={`${s.panel} ${drag ? s.dragMode : ''} ${overflow ? s.overflow : ''}`}
          // The Dock runs its own long-press menu; the shell's touch long-press fallback skips it.
          data-own-longpress
          role="toolbar"
          aria-label={t(S.dock)}
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          onPointerEnter={(e) => {
            if (e.pointerType === 'touch') return;
            hoverRef.current = true;
            clearHide();
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'touch' || dragRef.current || sepDrag.current || menuOpen.current || hidden) return;
            setMagnifyPointer(vertical ? e.clientY : e.clientX);
          }}
          onPointerLeave={() => {
            hoverRef.current = false;
            if (!menuOpen.current) setMagnifyPointer(null);
            setHovered(null);
            scheduleHide();
          }}
          // Clicking the Dock never takes keyboard focus from the active window (like macOS).
          onMouseDown={(e) => e.preventDefault()}
          onFocus={reveal}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !hoverRef.current) scheduleHide();
          }}
          onKeyDown={onPanelKeyDown}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenuFor({ kind: 'sep', key: 'sep' }, { x: e.clientX, y: e.clientY });
          }}
          onDragOver={onPanelDragOver}
          onDragLeave={onPanelDragLeave}
          onDrop={onPanelDrop}
        >
          {/* In a scrolling panel the background spans the whole content, not just the visible part. */}
          <div ref={shelfRef} className={`lg lg-float ${s.bg}`} style={overflow ? (vertical ? { bottom: 'auto', height: restLen } : { right: 'auto', width: restLen }) : undefined} aria-hidden />
          {items.map((item) => {
            if (item.kind === 'sep') {
              return (
                <div
                  key="sep"
                  ref={(el) => {
                    if (el) slotEls.current.set('sep', el);
                    else slotEls.current.delete('sep');
                  }}
                  className={s.sep}
                  role="separator"
                  aria-label={t(S.resize)}
                  onPointerDown={onSepPointerDown}
                  onPointerMove={onSepPointerMove}
                  onPointerUp={onSepPointerUp}
                  onPointerCancel={onSepPointerUp}
                />
              );
            }
            const label = item.kind === 'app' ? t(item.app.name) : item.kind === 'win' ? item.win.title || t(getApp(item.win.appId)?.name) : t(S.trash);
            const badge = item.kind === 'app' ? badges[item.appId] : undefined;
            const isDragged = drag?.appId === item.key;
            const cls = [
              s.slot,
              dropKey === item.key ? s.dropTarget : '',
              menuFor === item.key ? s.menuOpen : '',
              isDragged ? s.placeholder : '',
              isDragged && drag?.out ? s.collapsed : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={item.key}
                ref={(el) => {
                  if (el) slotEls.current.set(item.key, el);
                  else slotEls.current.delete(item.key);
                }}
                className={cls}
                onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(item.key)}
                onPointerLeave={() => setHovered((k) => (k === item.key ? null : k))}
                onDragOver={(e) => onItemDragOver(e, item)}
                onDragLeave={(e) => onItemDragLeave(e, item)}
                onDrop={(e) => onItemDrop(e, item)}
              >
                <div className={s.bouncer} data-bouncer>
                  <button
                    type="button"
                    className={s.icon}
                    tabIndex={item.key === items[0].key ? 0 : -1}
                    data-dock-item={item.key}
                    aria-label={badge ? `${label} (${badge})` : label}
                    onPointerDown={(e) => onItemPointerDown(e, item)}
                    onClick={() => activate(item)}
                    onContextMenu={(e) => onItemContextMenu(e, item)}
                    onFocus={() => setHovered(item.key)}
                    onBlur={() => setHovered((k) => (k === item.key ? null : k))}
                  >
                    {item.kind === 'app' && <item.app.icon size={max} />}
                    {item.kind === 'win' && <MiniWindow win={item.win} max={max} />}
                    {item.kind === 'trash' && (trashFull ? <TrashFullIcon size={max} /> : <TrashIcon size={max} />)}
                    {badge && <span className={s.badge}>{badge}</span>}
                  </button>
                </div>
                {item.kind === 'app' && item.running && <span className={s.dot} aria-hidden />}
                {showTips && hovered === item.key && (
                  <div className={`lg lg-thick lg-capsule ${s.tip}`} role="tooltip">
                    {label}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {drag &&
        DraggedIcon &&
        createPortal(
          <div
            ref={ghostRef}
            className={s.ghost}
            style={{ zIndex: Z.DRAG_GHOST, width: base, height: base, transform: `translate3d(${drag.x0 - base / 2}px, ${drag.y0 - base / 2}px, 0)` }}
            aria-hidden
          >
            <div className={`${s.ghostIcon} ${drag.out ? s.ghostOut : ''}`}>
              <DraggedIcon size={base} />
            </div>
            {drag.out && <div className={`lg lg-thick lg-capsule ${s.removeTip}`}>{t(S.remove)}</div>}
          </div>,
          document.body,
        )}

      {poofs.length > 0 &&
        createPortal(
          poofs.map((p) => (
            <div key={p.id} className={s.poof} style={{ zIndex: Z.DRAG_GHOST, left: p.x, top: p.y }} aria-hidden>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <i key={i} style={{ ['--a' as string]: `${i * 60 + 15}deg` }} />
              ))}
            </div>
          )),
          document.body,
        )}
    </>
  );
}

/* ───────────────────────── Minimized window tile ───────────────────────── */

/**
 * Minimized-window tile shown in the Dock.
 *
 * Fits the window's aspect ratio into 84% of the slot size and shows the snapshot captured when
 * the window was minimized, mounted into the tile and scaled to fit, or a schematic window with
 * traffic lights and text lines when there is none (decided once on mount). Corners scale with
 * the tile (about 10px at the default Dock size, at least 4px), and the owning app's icon is
 * overlaid as a badge at 40% of the slot size.
 *
 * @param {Object} props - Component props.
 * @param {WindowState} props.win - The minimized window.
 * @param {number} props.max - Magnified slot size in px; the tile is drawn at this size and scaled by CSS.
 * @returns {JSX.Element} The tile contents.
 *
 * @example
 * <MiniWindow win={win} max={max} />
 */
function MiniWindow({ win, max }: { win: WindowState; max: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const app = getApp(win.appId);
  const AppIcon = app?.icon;
  const box = max * 0.84;
  const ratio = win.width / Math.max(1, win.height);
  const w = ratio >= 1 ? box : box * ratio;
  const h = ratio >= 1 ? box / ratio : box;
  const [snap] = useState(() => hasSnapshot(win.id));

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !snap) return;
    return mountSnapshot(win.id, host, w / win.width) ?? undefined;
  }, [snap, win.id, w, win.width]);

  return (
    <span className={s.mini}>
      {/* 10px corners at the default Dock size, scaled with the tile. */}
      <span className={s.miniWin} style={{ width: w, height: h, borderRadius: Math.max(4, Math.round(max * 0.19)) }}>
        {snap ? (
          <span ref={hostRef} className={s.snapHost} />
        ) : (
          <>
            <span className={s.miniBar} style={{ height: Math.max(4, h * 0.12) }}>
              <i />
              <i />
              <i />
            </span>
            <span className={s.miniBody}>
              <i style={{ width: '70%' }} />
              <i style={{ width: '88%' }} />
              <i style={{ width: '54%' }} />
            </span>
          </>
        )}
      </span>
      {AppIcon && (
        <span className={s.miniBadge} style={{ width: max * 0.4, height: max * 0.4 }}>
          <AppIcon size={Math.round(max * 0.4)} />
        </span>
      )}
    </span>
  );
}

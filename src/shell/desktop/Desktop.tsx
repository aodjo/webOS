/**
 * The desktop: wallpaper, widgets and the icons of ~/Desktop — selection, rubber band, inline
 * rename, drag & drop, context menus and keyboard navigation. While no window is focused the
 * desktop is Finder's key "window", so it also provides Finder's menu-bar menus (and with them the
 * ⌘ shortcuts: ⌘O, ⌘I, ⌘D, ⌘⌫, ⌘C, ⌘V, ⌘A, ⌥⇧N…).
 */
import { Suspense, lazy, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  PATHS,
  dialogs,
  dirname,
  dropInto,
  duplicatePaths,
  extname,
  fileClipboard,
  fileContextMenu,
  fs,
  getDragPaths,
  getWorkspace,
  hasDragPaths,
  hasHostFiles,
  importHostFiles,
  newFolder,
  openGetInfo,
  openPaths,
  pasteInto,
  pickHostFiles,
  renamePath,
  setDragPaths,
  showContextMenu,
  sortNodes,
  trashPaths,
  useDir,
  useFileClipboard,
  useMenus,
  useSystem,
  useT,
  useTrashCount,
  useUI,
  useWM,
  wm,
  type Bounds,
  type FSNode,
} from '@/kernel';
import { Z } from '../layers';
import { isModKey } from './DialogParts';
import { DesktopIcon, iconLabel, type IconEvents } from './DesktopIcon';
import {
  arrange,
  cellAtPoint,
  cellKey,
  cellOrigin,
  gridMetrics,
  gridOrder,
  layoutIcons,
  moveGroup,
  nearestFree,
  neighbor,
  occupiedCells,
  placeFrom,
  type Cell,
  type Direction,
  type GridMetrics,
} from './desktopGrid';
import { buildDesktopContextMenu, buildDesktopMenuBar, guardActions, quickLookLabel, type DesktopApi } from './desktopMenus';
import { desktopUI, useDesktopUI } from './desktopStore';
import { setIconsDragImage } from './dragImage';
import { hasModalKeyOwner } from './modalKeys';
import { Wallpaper } from './Wallpaper';
import { useWallpaperLuminance } from '../menubar/wallpaperTone';
import { Widgets } from './Widgets';
import styles from './Desktop.module.css';

const S = {
  desktop: { en: 'Desktop', ko: '데스크탑' },
}; /** Localized strings of the desktop (accessible name of the icon list). */

const QuickLook = lazy(() => import('@/apps/finder/QuickLook').then((m) => ({ default: m.QuickLook }))); /** Finder's Quick Look panel (Space), code-split and loaded on first use. */

/**
 * Stops a React event from propagating to ancestor handlers.
 *
 * Used on the Quick Look portal wrapper: React events bubble through portals to their React
 * parents, so without it presses and drops on Quick Look would reach the desktop root.
 *
 * @param {SyntheticEvent} e - The React event.
 * @returns {void}
 *
 * @example
 * <div onPointerDown={stop} />
 */
const stop = (e: SyntheticEvent) => e.stopPropagation();

const EMPTY: ReadonlySet<string> = new Set(); /** Shared empty selection, so clearing it keeps a stable identity. */

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }; /** Maps arrow-key `KeyboardEvent.key` values to grid directions. */

/** Rectangle in viewport coordinates (the rubber band). */
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** State of a rubber-band selection in progress. */
interface BandState {
  /** Viewport x where the drag started. */
  x: number;
  /** Viewport y where the drag started. */
  y: number;
  /** Selection kept underneath the band (non-empty for ⇧/⌘ drags). */
  base: ReadonlySet<string>;
  /** The pointer has moved past the 3 px threshold. */
  moved: boolean;
  /** Hit boxes (icon image + label) of every icon, captured when the drag starts. */
  targets: [string, DOMRect[]][];
}

/**
 * Tells whether a DOM rectangle overlaps a rectangle.
 *
 * Edges that only touch do not count as an overlap.
 *
 * @param {DOMRect} a - An icon hit box.
 * @param {Rect} b - The rubber band.
 * @returns {boolean} True when the two rectangles overlap.
 *
 * @example
 * intersects(el.getBoundingClientRect(), { left: 0, top: 0, right: 100, bottom: 100 });
 */
const intersects = (a: DOMRect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Tells whether two sets contain the same strings.
 *
 * Compares the sizes first, then checks every member of `a` against `b`; insertion order is
 * ignored.
 *
 * @param {ReadonlySet<string>} a - First set.
 * @param {ReadonlySet<string>} b - Second set.
 * @returns {boolean} True when both sets have the same members.
 *
 * @example
 * sameSet(new Set(['a', 'b']), new Set(['b', 'a'])); // true
 */
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Tells whether an event target is a text-editable element.
 *
 * Matches `<input>`, `<textarea>`, `<select>` and any `contenteditable` element.
 *
 * @param {EventTarget | null} t - The target to test.
 * @returns {boolean} True when the target accepts text input.
 *
 * @example
 * if (isEditable(document.activeElement)) return;
 */
const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

const CONTROL_KEYS = new Set([' ', 'Enter', 'Tab']); /** Keys that activate whatever control has DOM focus, so desktop navigation leaves them alone then. */

/**
 * Classifies an item as a drop destination.
 *
 * Folders accept items to move or copy into them; `.app` bundles open dropped items. Every other
 * item rejects drops.
 *
 * @param {FSNode} n - The item under the drag.
 * @returns {'folder' | 'app' | null} 'folder' for directories, 'app' for `.app` bundles, null otherwise.
 *
 * @example
 * dropKind(appNode); // 'app'
 */
const dropKind = (n: FSNode): 'folder' | 'app' | null => (n.type === 'dir' ? 'folder' : extname(n.name) === 'app' ? 'app' : null);

/**
 * Extracts an item's path and stored grid position for the layout.
 *
 * The position lives in `meta.x` (column) and `meta.y` (row); both are undefined for items that
 * have never been placed.
 *
 * @param {FSNode} n - A desktop item.
 * @returns {{ path: string; x: number | undefined; y: number | undefined }} The positioned entry.
 *
 * @example
 * layoutIcons(items.map(toPositioned), metrics);
 */
const toPositioned = (n: FSNode) => ({ path: n.path, x: n.meta?.x, y: n.meta?.y });

/**
 * Stores an item's grid cell in its metadata.
 *
 * Writes the column to `meta.x` and the row to `meta.y`. Errors are ignored, since the item may
 * have been removed in the meantime.
 *
 * @param {string} path - Path of the desktop item.
 * @param {Cell} c - The cell to store.
 * @returns {void}
 *
 * @example
 * setCell(`${PATHS.desktop}/notes.txt`, { col: 0, row: 2 });
 */
function setCell(path: string, c: Cell): void {
  try {
    fs.setMeta(path, { x: c.col, y: c.row });
  } catch {
    /* The item was removed in the meantime; nothing to store. */
  }
}

/**
 * Stores the grid cell of every item in a layout.
 *
 * Calls setCell for each entry, so items that have been removed are skipped silently.
 *
 * @param {Map<string, Cell>} cells - Cells keyed by item path.
 * @returns {void}
 *
 * @example
 * writePositions(arrange(paths, metrics));
 */
function writePositions(cells: Map<string, Cell>): void {
  for (const [p, c] of cells) setCell(p, c);
}

/**
 * Tells the user which host files could not be imported.
 *
 * Shows a Finder alert listing the skipped names and the 15 MB size limit. Does nothing when the
 * list is empty.
 *
 * @param {string[]} skipped - Names of the files that were not imported.
 * @returns {void}
 *
 * @example
 * reportSkipped(['movie.mov']);
 */
function reportSkipped(skipped: string[]): void {
  if (!skipped.length) return;
  const names = skipped.join(', ');
  void dialogs.alert({
    appId: 'finder',
    title: { en: 'Some files couldn’t be imported.', ko: '일부 파일을 가져올 수 없습니다.' },
    message: { en: `${names}\nFiles larger than 15 MB can’t be imported.`, ko: `${names}\n15MB보다 큰 파일은 가져올 수 없습니다.` },
  });
}

/**
 * Tracks the work area (screen minus menu bar and Dock).
 *
 * Recomputes `getWorkspace()` whenever the viewport is resized or the Dock size, position or
 * autohide setting changes; `getWorkspace()` reads those values itself, so they are only listed as
 * memo dependencies.
 *
 * @returns {{ area: Bounds; viewportHeight: number }} The work area and the viewport height in px.
 *
 * @example
 * const { area, viewportHeight } = useWorkArea();
 */
function useWorkArea(): { area: Bounds; viewportHeight: number } {
  const dockKey = useSystem((s) => `${s.settings.dockSize}|${s.settings.dockPosition}|${s.settings.dockAutohide}`);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    /**
     * Stores the new viewport size.
     *
     * The new state object changes the memo key, so the work area is recomputed.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('resize', onResize);
     */
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const area = useMemo(() => getWorkspace(), [viewport, dockKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { area, viewportHeight: viewport.h };
}

/**
 * Returns a stable object whose methods always call the latest handlers.
 *
 * The returned object is created once with one forwarding method per key of the first `handlers`
 * object; each forwarder calls the method of the most recent `handlers` (updated in a layout
 * effect). Memoized children and registered menus can therefore hold it without seeing stale
 * closures. Keys added after the first render are not forwarded.
 *
 * @param {T} handlers - An object of functions, recreated on every render.
 * @returns {T} An object with the same keys and a stable identity.
 *
 * @example
 * const menuApi = useStableHandlers(api);
 */
function useStableHandlers<T extends object>(handlers: T): T {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });
  const [stable] = useState(() => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(handlers)) {
      out[key] = (...args: unknown[]) => (ref.current as Record<string, (...a: unknown[]) => unknown>)[key](...args);
    }
    return out as T;
  });
  return stable;
}

/**
 * Tells whether the desktop has keyboard focus.
 *
 * Reads the window manager state directly (not through a hook), so it is safe to call from
 * timers and event handlers.
 *
 * @returns {boolean} True when Finder is the active app and no window is focused.
 *
 * @example
 * if (desktopIsKey()) startRename(path);
 */
const desktopIsKey = () => {
  const w = useWM.getState();
  return w.focusedId === null && w.activeAppId === 'finder';
};

const ICON_REGION = { x0: 0.7, y0: 0.03, x1: 1, y1: 0.65 }; /** Viewport region (fractions) where desktop icons live, filling from the top-right; sampled to pick a legible label color. */
const DARK_LABELS_ABOVE = 0.42; /** Wallpaper luminance above which dark labels with a light halo read better than white ones. */

/**
 * The desktop: wallpaper, widgets and the icons of ~/Desktop.
 *
 * Lays out the visible items of ~/Desktop on the icon grid of the current work area and handles
 * selection (click, ⇧/⌘-click, rubber band, arrow keys, Tab, type-ahead), inline rename, Quick
 * Look, context menus and drag & drop of icons, Finder items and host files.
 *
 * - Items without a stored position (created by Terminal, a save panel…) get their current layout
 *   cell written to the FS. The live node is re-read first, so a position written by an action
 *   since this render (e.g. a drop) is never overwritten.
 * - Host files dropped on the wallpaper flow from the drop cell while they are being imported.
 * - Quick Look shows the lead (most recently selected) item and closes when the selection empties,
 *   renaming starts or another app becomes active. It is portaled above the windows, and its
 *   wrapper stops React events from reaching the wallpaper handlers.
 * - While the desktop is key it registers Finder's menu-bar menus (and so their ⌘ shortcuts); the
 *   menus are removed on unmount.
 * - Relaunching Finder clears the selection, renaming and Quick Look, and remounts the icon layer
 *   so the icons blink back in.
 * - Unmounting (e.g. logging out) clears pending timers and leaves widget edit mode.
 * - Icon labels switch to dark text when the wallpaper under ICON_REGION is brighter than
 *   DARK_LABELS_ABOVE.
 *
 * @returns {JSX.Element} The desktop layer.
 *
 * @example
 * <Desktop />
 */
export function Desktop() {
  const t = useT();
  const showHidden = useSystem((s) => s.settings.showHiddenFiles);
  const items = useDir(PATHS.desktop, { showHidden });
  const { area, viewportHeight } = useWorkArea();
  const metrics = useMemo(() => gridMetrics(area), [area]);
  const [flowFrom, setFlowFrom] = useState<Cell | null>(null);
  const layout = useMemo(() => layoutIcons(items.map(toPositioned), metrics, flowFrom ?? undefined), [items, metrics, flowFrom]);
  const keyActive = useWM((s) => s.focusedId === null && s.activeAppId === 'finder');
  const relaunches = useDesktopUI((s) => s.finderRelaunches);
  const clipboardCount = useFileClipboard((s) => s.paths.length);
  const trashCount = useTrashCount();

  const [selection, setSelection] = useState<ReadonlySet<string>>(EMPTY);
  const [renamingState, setRenaming] = useState<string | null>(null);
  const [band, setBand] = useState<Rect | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState<ReadonlySet<string>>(EMPTY);
  const [arranging, setArranging] = useState(false);
  const [quickLook, setQuickLook] = useState(false);

  const selected = useMemo(() => items.filter((n) => selection.has(n.path)).map((n) => n.path), [items, selection]);
  const renaming = renamingState && items.some((n) => n.path === renamingState) ? renamingState : null;
  const lead = useMemo(() => [...selection].filter((p) => layout.has(p)).pop() ?? null, [selection, layout]);
  const quickLookNode = quickLook && keyActive && !renaming ? items.find((n) => n.path === lead) : undefined;

  const rootRef = useRef<HTMLDivElement>(null);
  const iconEls = useRef(new Map<string, HTMLDivElement>());
  const metricsRef = useRef<GridMetrics>(metrics);
  const bandRef = useRef<BandState | null>(null);
  const dragSource = useRef<{ paths: string[]; anchor: string } | null>(null);
  const pendingSingle = useRef<string | null>(null);
  const wasSoleSelection = useRef(false);
  const renameTimer = useRef(0);
  const arrangeTimer = useRef(0);
  const spring = useRef<{ path: string; timer: number } | null>(null);
  const typeAhead = useRef({ text: '', at: 0 });

  useLayoutEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    for (const n of items) {
      if (n.meta?.x !== undefined || n.meta?.y !== undefined) continue;
      const live = fs.stat(n.path);
      if (!live || live.meta?.x !== undefined || live.meta?.y !== undefined) continue;
      const c = layout.get(n.path);
      if (c) setCell(n.path, c);
    }
  }, [items, layout]);

  useEffect(() => {
    if (quickLook && !quickLookNode) setQuickLook(false);
  }, [quickLook, quickLookNode]);

  useEffect(
    () =>
      useDesktopUI.subscribe((s, prev) => {
        if (s.finderRelaunches === prev.finderRelaunches) return;
        setSelection(EMPTY);
        setRenaming(null);
        setQuickLook(false);
      }),
    [],
  );

  useEffect(
    () => () => {
      clearTimeout(renameTimer.current);
      clearTimeout(arrangeTimer.current);
      if (spring.current) clearTimeout(spring.current.timer);
      desktopUI.setEditing(false);
    },
    [],
  );

  /**
   * Replaces the selection.
   *
   * Insertion order matters: the last path becomes the lead item.
   *
   * @param {Iterable<string>} paths - Paths of the items to select.
   * @returns {void}
   *
   * @example
   * select([path]);
   */
  const select = (paths: Iterable<string>) => setSelection(new Set(paths));

  /**
   * Computes the desktop layout from the FS as it is right now.
   *
   * Reads ~/Desktop directly instead of the rendered `items`, so actions can place new items
   * against positions written moments ago. Hidden items are skipped unless they are shown.
   *
   * @returns {Map<string, Cell>} Cells keyed by item path (empty when the folder can't be read).
   *
   * @example
   * const taken = occupiedCells(liveLayout());
   */
  const liveLayout = (): Map<string, Cell> => {
    let nodes: FSNode[];
    try {
      nodes = fs.readdir(PATHS.desktop);
    } catch {
      return new Map();
    }
    const visible = showHidden ? nodes : nodes.filter((n) => !n.name.startsWith('.') && !n.meta?.hidden);
    return layoutIcons(sortNodes(visible, 'name').map(toPositioned), metricsRef.current);
  };

  /**
   * Places newly arrived items on the grid.
   *
   * Fills cells from `start` down the column, skipping cells occupied by other items, and stores
   * the positions.
   *
   * @param {string[]} paths - Paths of the new items.
   * @param {Cell} [start={ col: 0, row: 0 }] - The first cell to try.
   * @returns {void}
   *
   * @example
   * placeNew(created, cellAtPoint(metrics, e.clientX, e.clientY));
   */
  const placeNew = (paths: string[], start: Cell = { col: 0, row: 0 }) => {
    if (!paths.length) return;
    const cells = placeFrom(paths.length, start, occupiedCells(liveLayout(), paths), metricsRef.current);
    writePositions(new Map(paths.map((p, i) => [p, cells[i]])));
  };

  /**
   * Animates icon position changes for the next 520 ms.
   *
   * Turns on the icons' transform transition and restarts the timer that turns it off, so
   * back-to-back arrangements share one animation window.
   *
   * @returns {void}
   *
   * @example
   * writePositions(arrange(paths, metrics));
   * animateArrange();
   */
  const animateArrange = () => {
    setArranging(true);
    clearTimeout(arrangeTimer.current);
    arrangeTimer.current = window.setTimeout(() => setArranging(false), 520);
  };

  /**
   * Selects an item alone and shows its inline rename field.
   *
   * Cancels a pending click-to-rename. Missing and protected items are not renamed.
   *
   * @param {string} path - Path of the item to rename.
   * @returns {void}
   *
   * @example
   * startRename(selected[0]);
   */
  const startRename = (path: string) => {
    clearTimeout(renameTimer.current);
    if (!fs.exists(path) || fs.isProtected(path)) return;
    select([path]);
    setRenaming(path);
  };

  /**
   * Cancels a pending spring-loaded folder opening.
   *
   * Clears the spring timer, if any, and forgets the armed folder.
   *
   * @returns {void}
   *
   * @example
   * disarmSpring();
   */
  const disarmSpring = () => {
    if (spring.current) clearTimeout(spring.current.timer);
    spring.current = null;
  };

  /**
   * Spring-loads a folder: hovering a drag over it for 1.1 s opens it in Finder.
   *
   * Re-arming the same folder keeps its running timer; arming another folder replaces it. When
   * the timer fires the drop highlight is cleared and a Finder window opens on the folder.
   *
   * @param {string} path - Path of the hovered folder.
   * @returns {void}
   *
   * @example
   * if (kind === 'folder') armSpring(node.path);
   */
  const armSpring = (path: string) => {
    if (spring.current?.path === path) return;
    disarmSpring();
    spring.current = {
      path,
      timer: window.setTimeout(() => {
        spring.current = null;
        setDropTarget(null);
        wm.openWindow('finder', { path });
      }, 1100),
    };
  };

  const api: DesktopApi = {
    /**
     * Opens the selected items with their default apps.
     *
     * Folders open in Finder and files in their handler app; nothing happens with an empty
     * selection.
     *
     * @returns {void}
     *
     * @example
     * api.open();
     */
    open: () => openPaths(selected),
    /**
     * Creates an "untitled folder" on the desktop and starts renaming it.
     *
     * The folder goes to the free cell nearest to `at`, or to the first free cell when no cell is
     * given. The desktop is focused and the new folder selected.
     *
     * @param {Cell} [at] - Preferred cell (the cell under a context-menu click).
     * @returns {void}
     *
     * @example
     * api.newFolder({ col: 1, row: 3 });
     */
    newFolder: (at) => {
      const path = newFolder(PATHS.desktop);
      if (!path) return;
      const taken = occupiedCells(liveLayout(), [path]);
      const m = metricsRef.current;
      setCell(path, at ? nearestFree(at, taken, m) : placeFrom(1, { col: 0, row: 0 }, taken, m)[0]);
      wm.focusDesktop();
      select([path]);
      setRenaming(path);
    },
    /**
     * Starts renaming the selected item when exactly one is selected.
     *
     * Delegates to startRename, which also refuses missing and protected items.
     *
     * @returns {void}
     *
     * @example
     * api.rename();
     */
    rename: () => {
      if (selected.length === 1) startRename(selected[0]);
    },
    /**
     * Opens Get Info for every selected item, or for the Desktop folder when nothing is selected.
     *
     * Each item gets its own Get Info window.
     *
     * @returns {void}
     *
     * @example
     * api.getInfo();
     */
    getInfo: () => {
      if (selected.length) selected.forEach(openGetInfo);
      else openGetInfo(PATHS.desktop);
    },
    /**
     * Duplicates the selected items and selects the copies.
     *
     * Like Finder, each copy is placed in the free cell nearest to the one right below its
     * original.
     *
     * @returns {void}
     *
     * @example
     * api.duplicate();
     */
    duplicate: () => {
      const live = liveLayout();
      const taken = occupiedCells(live);
      const out: string[] = [];
      for (const src of selected) {
        const [copy] = duplicatePaths([src]);
        if (!copy) continue;
        const from = live.get(src) ?? { col: 0, row: 0 };
        const c = nearestFree({ col: from.col, row: from.row + 1 }, taken, metricsRef.current);
        taken.add(cellKey(c));
        setCell(copy, c);
        out.push(copy);
      }
      if (out.length) select(out);
    },
    /**
     * Moves the selected items that are not protected to the Trash.
     *
     * Protected items are filtered out first; the trash operation runs asynchronously and reports
     * its own errors.
     *
     * @returns {void}
     *
     * @example
     * api.trash();
     */
    trash: () => {
      const paths = selected.filter((p) => !fs.isProtected(p));
      if (paths.length) void trashPaths(paths);
    },
    /**
     * Copies the selected items to the file clipboard.
     *
     * Leaves the clipboard untouched when nothing is selected.
     *
     * @returns {void}
     *
     * @example
     * api.copy();
     */
    copy: () => {
      if (selected.length) fileClipboard.copy(selected);
    },
    /**
     * Pastes the file clipboard onto the desktop and selects the result.
     *
     * With `move` the clipboard items are moved here and the clipboard is cleared; otherwise the
     * clipboard's own copy / cut mode applies. Items that were not on the desktop before are
     * placed from the first free cell.
     *
     * @param {boolean} move - Move the items instead of copying them.
     * @returns {void}
     *
     * @example
     * api.paste(false);
     */
    paste: (move) => {
      const before = new Set(liveLayout().keys());
      let out: string[];
      if (move) {
        out = dropInto(fileClipboard.get().paths.filter((p) => fs.exists(p)), PATHS.desktop);
        fileClipboard.clear();
      } else out = pasteInto(PATHS.desktop);
      placeNew(out.filter((p) => !before.has(p)));
      if (out.length) select(out);
    },
    /**
     * Selects every desktop item.
     *
     * Uses the rendered item list, so hidden items are included only while they are shown.
     *
     * @returns {void}
     *
     * @example
     * api.selectAll();
     */
    selectAll: () => select(items.map((n) => n.path)),
    /**
     * Snaps the icons onto consecutive grid cells in their current visual order, animated.
     *
     * Reads the icons in grid reading order (down each column from the top-right), stores the
     * packed cells and animates the move.
     *
     * @returns {void}
     *
     * @example
     * api.cleanUp();
     */
    cleanUp: () => {
      writePositions(arrange(gridOrder(layout, metrics), metrics));
      animateArrange();
    },
    /**
     * Rearranges the icons sorted by the given key, animated.
     *
     * The sorted items are packed onto consecutive grid cells, the cells are stored and the move
     * is animated.
     *
     * @param {SortKey} key - Sort order: 'name', 'kind', 'date' or 'size'.
     * @returns {void}
     *
     * @example
     * api.sortBy('kind');
     */
    sortBy: (key) => {
      writePositions(arrange(sortNodes(items, key).map((n) => n.path), metrics));
      animateArrange();
    },
    /**
     * Lets the user pick host files, imports them onto the desktop, places and selects them.
     *
     * Opens the browser's file picker; once the import resolves, the created items are placed
     * from the first free cell and selected.
     *
     * @returns {void}
     *
     * @example
     * api.importFiles();
     */
    importFiles: () => {
      void pickHostFiles(PATHS.desktop).then((created) => {
        placeNew(created);
        if (created.length) select(created);
      });
    },
    /**
     * Enters widget edit mode.
     *
     * Sets the shared desktop UI flag that the widget layer reads; a plain click on the wallpaper
     * leaves the mode again.
     *
     * @returns {void}
     *
     * @example
     * api.editWidgets();
     */
    editWidgets: () => desktopUI.setEditing(true),
    /**
     * Toggles Quick Look when something is selected.
     *
     * Quick Look previews the lead item; with an empty selection nothing happens.
     *
     * @returns {void}
     *
     * @example
     * api.quickLook();
     */
    quickLook: () => {
      if (selected.length) setQuickLook((v) => !v);
    },
  };

  const menuApi = useStableHandlers(api);

  const canRename = selected.length === 1 && !fs.isProtected(selected[0]);
  const canTrash = selected.length > 0 && selected.every((p) => !fs.isProtected(p));
  const quickLookName = lead && selected.length ? iconLabel({ name: lead.slice(lead.lastIndexOf('/') + 1) }) : null;
  useEffect(() => {
    /**
     * Tells whether the user is typing in a field outside the desktop.
     *
     * Menu shortcuts are dispatched globally, so Finder's desktop menu actions are guarded with
     * this and do nothing while a field elsewhere (Spotlight…) has focus. The desktop's own rename
     * field still lets ⌘-actions through, like Finder.
     *
     * @returns {boolean} True when an editable element outside the desktop has focus.
     *
     * @example
     * guardActions(menus, typingElsewhere);
     */
    const typingElsewhere = () => isEditable(document.activeElement) && !rootRef.current?.contains(document.activeElement);
    const menus = buildDesktopMenuBar(menuApi, { count: selected.length, canRename, canTrash, clipboard: clipboardCount, trashCount, quickLookName });
    useMenus.setState((s) => ({ byApp: { ...s.byApp, finder: guardActions(menus, typingElsewhere) } }));
  }, [menuApi, selected.length, canRename, canTrash, clipboardCount, trashCount, quickLookName]);
  useEffect(
    () => () =>
      useMenus.setState((s) => {
        const byApp = { ...s.byApp };
        delete byApp.finder;
        return { byApp };
      }),
    [],
  );

  /**
   * Moves (or extends) the selection to the neighboring icon on the grid.
   *
   * Starts from the lead item; with no selection, selects the first icon in grid order. When
   * extending, the neighbor is added (or moved) to the end of the selection so it becomes the new
   * lead.
   *
   * @param {Direction} dir - Direction to move in.
   * @param {boolean} extend - Add to the selection instead of replacing it (⇧).
   * @returns {void}
   *
   * @example
   * moveSelection('down', false);
   */
  const moveSelection = (dir: Direction, extend: boolean) => {
    const lead = [...selection].filter((p) => layout.has(p)).pop();
    if (!lead) {
      const first = gridOrder(layout, metrics)[0];
      if (first) select([first]);
      return;
    }
    const next = neighbor(layout, layout.get(lead)!, dir);
    if (!next) return;
    if (!extend) {
      select([next]);
      return;
    }
    const s = new Set(selection);
    s.delete(next);
    s.add(next);
    setSelection(s);
  };

  /**
   * Selects the item `delta` positions away from the lead in name order, wrapping around.
   *
   * With no selection, selects the first item (forward) or the last item (backward).
   *
   * @param {number} delta - Offset in the item list (1 for Tab, -1 for ⇧Tab).
   * @returns {void}
   *
   * @example
   * selectByOffset(-1);
   */
  const selectByOffset = (delta: number) => {
    if (!items.length) return;
    const lead = [...selection].pop();
    const i = items.findIndex((n) => n.path === lead);
    const next = i === -1 ? (delta > 0 ? 0 : items.length - 1) : (i + delta + items.length) % items.length;
    select([items[next].path]);
  };

  /**
   * Type-ahead selection.
   *
   * Characters typed within 900 ms of each other build up a prefix. Selects the first item whose
   * label starts with it, or else the first label that sorts after it.
   *
   * @param {string} ch - The typed character.
   * @returns {void}
   *
   * @example
   * typeSelect('r');
   */
  const typeSelect = (ch: string) => {
    const ta = typeAhead.current;
    const now = performance.now();
    ta.text = (now - ta.at > 900 ? '' : ta.text) + ch.toLowerCase();
    ta.at = now;
    const labels = items.map((n) => iconLabel(n).toLowerCase());
    let i = labels.findIndex((l) => l.startsWith(ta.text));
    if (i < 0) i = labels.findIndex((l) => l.localeCompare(ta.text) > 0);
    if (i >= 0) select([items[i].path]);
  };

  /**
   * Desktop keyboard navigation (an effect event, so it always sees the latest state).
   *
   * Ignored when the event was already handled, while renaming or composing, unless the desktop is
   * key on the running desktop, in editable fields, while a modal key owner or a shell overlay
   * (Spotlight, Launchpad, Mission Control, Control Center, Notification Center, a context menu,
   * the app switcher) is open, and for Space / Return / Tab while a control holds DOM focus (the
   * key activates that control instead). The Force Quit window consumes its keys before they get
   * here. Keys: ⌘↓ opens the selection; arrows move the selection (⇧ extends it); Space toggles
   * Quick Look; Escape closes Quick Look; Return renames the single selected item; Tab / ⇧Tab
   * cycle through the items; any other printable character selects by type-ahead.
   *
   * @param {KeyboardEvent} e - The window keydown event.
   * @returns {void}
   *
   * @example
   * window.addEventListener('keydown', (e) => onKeyDown(e));
   */
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || renaming || e.isComposing) return;
    if (!desktopIsKey() || useSystem.getState().power !== 'desktop') return;
    if (isEditable(e.target) || hasModalKeyOwner()) return;
    const el = e.target instanceof Element ? e.target : null;
    if (el && el !== document.body && el !== document.documentElement && CONTROL_KEYS.has(e.key)) return;
    const ui = useUI.getState();
    if (ui.spotlight || ui.launchpad || ui.missionControl || ui.controlCenter || ui.notificationCenter || ui.contextMenu || ui.appSwitcher !== null) return;

    if (isModKey(e) && !e.shiftKey && !e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      api.open();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      moveSelection(dir, e.shiftKey);
    } else if (e.key === ' ') {
      e.preventDefault();
      api.quickLook();
    } else if (e.key === 'Escape') {
      if (quickLook) {
        e.preventDefault();
        setQuickLook(false);
      }
    } else if (e.key === 'Enter') {
      if (selected.length === 1) {
        e.preventDefault();
        startRename(selected[0]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      selectByOffset(e.shiftKey ? -1 : 1);
    } else if (e.key.length === 1 && e.key !== ' ') {
      typeSelect(e.key);
    }
  });

  useEffect(() => {
    /**
     * Forwards window keydown events to the desktop's keyboard handler.
     *
     * The listener is installed once; onKeyDown is an effect event, so it still sees the latest
     * state on every call.
     *
     * @param {KeyboardEvent} e - The window keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', handler);
     */
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /**
   * Captures the hit boxes of every icon for a rubber-band drag.
   *
   * Measures each registered icon element once, when the drag starts, so moving the band does
   * not force a layout read per icon.
   *
   * @returns {[string, DOMRect[]][]} For each icon path, the rectangles of its `[data-hit]` parts (image and label).
   *
   * @example
   * bandRef.current = { x, y, base: EMPTY, moved: false, targets: collectTargets() };
   */
  const collectTargets = (): [string, DOMRect[]][] =>
    [...iconEls.current].map(([p, el]) => [p, Array.from(el.querySelectorAll('[data-hit]'), (n) => n.getBoundingClientRect())]);

  /**
   * Handles a press on the desktop background.
   *
   * Cancels a pending click-to-rename. A press on a widget only focuses the desktop; presses on
   * icons and with buttons other than the primary one are ignored. Otherwise the desktop is
   * focused, the selection is cleared unless ⇧ or ⌘ is held (then it is kept under the band), a
   * rubber band starts at the pointer and the pointer is captured.
   *
   * @param {PointerEvent<HTMLDivElement>} e - The pointerdown event on the desktop root.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={onRootPointerDown} />
   */
  const onRootPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    clearTimeout(renameTimer.current);
    const target = e.target as Element;
    if (target.closest('[data-widget]')) {
      wm.focusDesktop();
      return;
    }
    if (target.closest('[data-desktop-item]') || e.button !== 0) return;
    wm.focusDesktop();
    const additive = e.shiftKey || isModKey(e);
    if (!additive && selection.size) setSelection(EMPTY);
    bandRef.current = { x: e.clientX, y: e.clientY, base: additive ? selection : EMPTY, moved: false, targets: collectTargets() };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  /**
   * Updates the rubber band and the selection while dragging on the background.
   *
   * The band appears once the pointer has moved 3 px. The selection becomes the base selection
   * plus every icon whose image or label overlaps the band; an unchanged set keeps its identity
   * so icons don't re-render.
   *
   * @param {PointerEvent<HTMLDivElement>} e - The pointermove event on the desktop root.
   * @returns {void}
   *
   * @example
   * <div onPointerMove={onRootPointerMove} />
   */
  const onRootPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const b = bandRef.current;
    if (!b) return;
    if (!b.moved && Math.hypot(e.clientX - b.x, e.clientY - b.y) < 3) return;
    b.moved = true;
    const r: Rect = { left: Math.min(b.x, e.clientX), top: Math.min(b.y, e.clientY), right: Math.max(b.x, e.clientX), bottom: Math.max(b.y, e.clientY) };
    setBand(r);
    const next = new Set(b.base);
    for (const [p, rects] of b.targets) if (rects.some((rr) => intersects(rr, r))) next.add(p);
    setSelection((prev) => (sameSet(prev, next) ? prev : next));
  };

  /**
   * Ends a rubber-band drag.
   *
   * A plain click on the wallpaper (no movement, not cancelled) also closes the shell overlays and
   * leaves widget edit mode.
   *
   * @param {boolean} cancelled - The pointer was cancelled or lost its capture.
   * @returns {void}
   *
   * @example
   * <div onPointerUp={() => endBand(false)} onPointerCancel={() => endBand(true)} />
   */
  const endBand = (cancelled: boolean) => {
    const b = bandRef.current;
    if (!b) return;
    bandRef.current = null;
    setBand(null);
    if (!b.moved && !cancelled) {
      useUI.getState().closeOverlays();
      desktopUI.setEditing(false);
    }
  };

  /**
   * Shows the desktop context menu for a right-click on the background.
   *
   * Clicks on icons and widgets are left to their own handlers. Focuses the desktop, clears the
   * selection and passes the grid cell under the pointer (where New Folder will go).
   *
   * @param {MouseEvent<HTMLDivElement>} e - The contextmenu event on the desktop root.
   * @returns {void}
   *
   * @example
   * <div onContextMenu={onRootContextMenu} />
   */
  const onRootContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('[data-desktop-item],[data-widget]')) return;
    wm.focusDesktop();
    setSelection(EMPTY);
    showContextMenu(e, buildDesktopContextMenu(menuApi, cellAtPoint(metrics, e.clientX, e.clientY), clipboardCount));
  };

  /**
   * Accepts drags of FS items or host files over the background.
   *
   * FS items are moved (copied with ⌥) and host files copied. Any icon drop highlight and pending
   * spring-loading are cleared.
   *
   * @param {DragEvent<HTMLDivElement>} e - The dragover event on the desktop root.
   * @returns {void}
   *
   * @example
   * <div onDragOver={onRootDragOver} />
   */
  const onRootDragOver = (e: DragEvent<HTMLDivElement>) => {
    const fsDrag = hasDragPaths(e);
    if (!fsDrag && !hasHostFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = fsDrag && !e.altKey ? 'move' : 'copy';
    if (dropTarget) setDropTarget(null);
    disarmSpring();
  };

  /**
   * Clears the drop highlight and spring-loading when a drag leaves the page.
   *
   * Leaves into a child element (non-null `relatedTarget`) are ignored.
   *
   * @param {DragEvent<HTMLDivElement>} e - The dragleave event on the desktop root.
   * @returns {void}
   *
   * @example
   * <div onDragLeave={onRootDragLeave} />
   */
  const onRootDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.relatedTarget) return;
    setDropTarget(null);
    disarmSpring();
  };

  /**
   * Handles a drop on the background.
   *
   * - Host files are imported into ~/Desktop; while importing, the layout flows from the drop cell.
   *   The created items are placed from that cell and selected, and skipped files are reported.
   * - Desktop icons moved without ⌥ are repositioned as a group: the grabbed icon lands on the drop
   *   cell and the others keep their formation.
   * - Other FS items are moved (copied with ⌥) onto the desktop, placed from the drop cell and
   *   selected.
   *
   * @param {DragEvent<HTMLDivElement>} e - The drop event on the desktop root.
   * @returns {void}
   *
   * @example
   * <div onDrop={onRootDrop} />
   */
  const onRootDrop = (e: DragEvent<HTMLDivElement>) => {
    const fsDrag = hasDragPaths(e);
    if (!fsDrag && !hasHostFiles(e)) return;
    e.preventDefault();
    setDropTarget(null);
    disarmSpring();
    const cell = cellAtPoint(metrics, e.clientX, e.clientY);
    if (!fsDrag) {
      const files = Array.from(e.dataTransfer.files);
      setFlowFrom(cell);
      void importHostFiles(files, PATHS.desktop)
        .then(({ created, skipped }) => {
          placeNew(created, cell);
          if (created.length) select(created);
          reportSkipped(skipped);
        })
        .finally(() => setFlowFrom((c) => (c === cell ? null : c)));
      return;
    }
    const paths = getDragPaths(e).filter((p) => fs.exists(p));
    if (!paths.length) return;
    const copy = e.altKey;
    if (!copy && paths.every((p) => dirname(p) === PATHS.desktop)) {
      const src = dragSource.current;
      const anchor = src && paths.includes(src.anchor) ? src.anchor : paths[0];
      writePositions(moveGroup(paths, anchor, cell, liveLayout(), metrics));
      select(paths);
      return;
    }
    const out = dropInto(paths, PATHS.desktop, { copy });
    placeNew(out, cell);
    if (out.length) select(out);
  };

  const events = useStableHandlers<IconEvents>({
    /**
     * Handles a press on an icon.
     *
     * Only the primary and secondary buttons count. Focuses the desktop and remembers whether the
     * icon was the sole selection (for click-to-rename). A right press selects the icon unless it
     * is already selected; ⌘ or ⇧ toggles it; a plain press selects it alone, except that an
     * already selected icon keeps the multi-selection so it can be dragged and collapses it on
     * click instead.
     *
     * @param {PointerEvent<HTMLDivElement>} e - The pointerdown event.
     * @param {FSNode} node - The pressed item.
     * @returns {void}
     *
     * @example
     * events.onPointerDown(e, node);
     */
    onPointerDown: (e, node) => {
      clearTimeout(renameTimer.current);
      if (e.button !== 0 && e.button !== 2) return;
      wm.focusDesktop();
      const p = node.path;
      wasSoleSelection.current = selection.size === 1 && selection.has(p);
      pendingSingle.current = null;
      if (e.button === 2) {
        if (!selection.has(p)) select([p]);
        return;
      }
      if (isModKey(e) || e.shiftKey) {
        const s = new Set(selection);
        if (s.has(p)) s.delete(p);
        else s.add(p);
        setSelection(s);
        return;
      }
      if (!selection.has(p)) select([p]);
      else pendingSingle.current = p;
    },
    /**
     * Handles a click on an icon.
     *
     * Collapses a multi-selection kept on press to the clicked icon. As in Finder, a single plain
     * click on the name of the icon that was already the sole selection starts renaming after
     * 700 ms, if the desktop is still key by then.
     *
     * @param {MouseEvent<HTMLDivElement>} e - The click event.
     * @param {FSNode} node - The clicked item.
     * @returns {void}
     *
     * @example
     * events.onClick(e, node);
     */
    onClick: (e, node) => {
      const p = node.path;
      if (pendingSingle.current === p) {
        pendingSingle.current = null;
        if (selection.size > 1) select([p]);
      }
      if (wasSoleSelection.current && e.detail === 1 && !isModKey(e) && !e.shiftKey && (e.target as Element).closest('[data-label]')) {
        clearTimeout(renameTimer.current);
        renameTimer.current = window.setTimeout(() => {
          if (desktopIsKey()) startRename(p);
        }, 700);
      }
      wasSoleSelection.current = false;
    },
    /**
     * Opens the selection when a selected icon is double-clicked, otherwise just that icon.
     *
     * Cancels a pending click-to-rename.
     *
     * @param {FSNode} node - The double-clicked item.
     * @returns {void}
     *
     * @example
     * events.onDoubleClick(node);
     */
    onDoubleClick: (node) => {
      clearTimeout(renameTimer.current);
      openPaths(selection.has(node.path) ? selected : [node.path]);
    },
    /**
     * Shows the file context menu for an icon.
     *
     * Applies to the whole selection when the icon is selected, otherwise selects the icon alone.
     * The standard file menu is shown without "Show in Enclosing Folder"; Rename starts on the
     * next frame, after the menu has closed and returned focus. A Quick Look item is inserted
     * right after Duplicate, as in Finder.
     *
     * @param {MouseEvent<HTMLDivElement>} e - The contextmenu event.
     * @param {FSNode} node - The item under the pointer.
     * @returns {void}
     *
     * @example
     * events.onContextMenu(e, node);
     */
    onContextMenu: (e, node) => {
      wm.focusDesktop();
      const paths = selection.has(node.path) ? selected : [node.path];
      if (!selection.has(node.path)) select([node.path]);
      const menu = fileContextMenu(paths, { onRename: (p) => requestAnimationFrame(() => startRename(p)), showReveal: false });
      const at = menu.findIndex((it) => typeof it.label === 'object' && it.label.en === 'Duplicate');
      if (at >= 0) menu.splice(at + 1, 0, { label: quickLookLabel(paths.length === 1 ? iconLabel(node) : null), action: () => setQuickLook(true) });
      showContextMenu(e, menu);
    },
    /**
     * Starts dragging an icon.
     *
     * Blocked while renaming. Drags the whole selection when the icon is selected, otherwise the
     * icon alone (selecting it). Records the grabbed icon as the group anchor and builds a drag
     * image from all dragged icons. The originals are dimmed on the next frame, after the browser
     * has taken its drag snapshot.
     *
     * @param {DragEvent<HTMLDivElement>} e - The dragstart event.
     * @param {FSNode} node - The grabbed item.
     * @returns {void}
     *
     * @example
     * events.onDragStart(e, node);
     */
    onDragStart: (e, node) => {
      if (renaming) {
        e.preventDefault();
        return;
      }
      clearTimeout(renameTimer.current);
      pendingSingle.current = null;
      const p = node.path;
      const paths = selection.has(p) ? selected : [p];
      if (!selection.has(p)) select([p]);
      setDragPaths(e, paths);
      dragSource.current = { paths, anchor: p };
      setIconsDragImage(
        e,
        paths.map((x) => iconEls.current.get(x)).filter((x): x is HTMLDivElement => !!x),
        e.currentTarget,
      );
      requestAnimationFrame(() => {
        if (dragSource.current) setDragging(new Set(paths));
      });
    },
    /**
     * Resets the drag state when an icon drag ends.
     *
     * Forgets the drag source, undims the dragged icons, clears the drop highlight and cancels
     * any spring-loading, whether the drop succeeded or not.
     *
     * @returns {void}
     *
     * @example
     * events.onDragEnd();
     */
    onDragEnd: () => {
      dragSource.current = null;
      setDragging(EMPTY);
      setDropTarget(null);
      disarmSpring();
    },
    /**
     * Accepts a drag over a folder or app icon.
     *
     * Ignores other items and icons that are part of the drag itself. Folders accept FS items and
     * host files; apps accept FS items only. The drop effect is copy for apps, host files or with
     * ⌥, move otherwise. Highlights the icon and spring-loads folders.
     *
     * @param {DragEvent<HTMLDivElement>} e - The dragover event.
     * @param {FSNode} node - The item under the drag.
     * @returns {void}
     *
     * @example
     * events.onDragOver(e, node);
     */
    onDragOver: (e, node) => {
      const kind = dropKind(node);
      if (!kind || dragSource.current?.paths.includes(node.path)) return;
      const fsDrag = hasDragPaths(e);
      if (!fsDrag && !(kind === 'folder' && hasHostFiles(e))) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = kind === 'app' || !fsDrag || e.altKey ? 'copy' : 'move';
      if (dropTarget !== node.path) setDropTarget(node.path);
      if (kind === 'folder') armSpring(node.path);
    },
    /**
     * Clears an icon's drop highlight and spring-loading when the drag leaves it.
     *
     * Moves into the icon's own children are ignored.
     *
     * @param {DragEvent<HTMLDivElement>} e - The dragleave event.
     * @param {FSNode} node - The item the drag left.
     * @returns {void}
     *
     * @example
     * events.onDragLeave(e, node);
     */
    onDragLeave: (e, node) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropTarget((cur) => (cur === node.path ? null : cur));
      if (spring.current?.path === node.path) disarmSpring();
    },
    /**
     * Handles a drop on a folder or app icon.
     *
     * Host files are imported into the folder (skipped files are reported). FS items dropped on an
     * app are opened with it (the app id is read from the bundle's content); items dropped on a
     * folder are moved into it, or copied with ⌥.
     *
     * @param {DragEvent<HTMLDivElement>} e - The drop event.
     * @param {FSNode} node - The folder or app the items were dropped on.
     * @returns {void}
     *
     * @example
     * events.onDrop(e, node);
     */
    onDrop: (e, node) => {
      const kind = dropKind(node);
      if (!kind || dragSource.current?.paths.includes(node.path)) return;
      const fsDrag = hasDragPaths(e);
      if (!fsDrag && !(kind === 'folder' && hasHostFiles(e))) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      disarmSpring();
      if (!fsDrag) {
        void importHostFiles(Array.from(e.dataTransfer.files), node.path).then(({ skipped }) => reportSkipped(skipped));
        return;
      }
      const paths = getDragPaths(e).filter((p) => fs.exists(p));
      if (kind === 'app') {
        const appId = (node.content ?? '').trim();
        for (const p of paths) wm.openPath(p, appId);
      } else dropInto(paths, node.path, { copy: e.altKey });
    },
    /**
     * Finishes inline renaming.
     *
     * A null value cancels. Otherwise the item is renamed (errors are reported by `renamePath`)
     * and the renamed item is selected.
     *
     * @param {FSNode} node - The item being renamed.
     * @param {string | null} value - The new name, or null when cancelled.
     * @returns {void}
     *
     * @example
     * events.onRenameDone(node, 'Projects');
     */
    onRenameDone: (node, value) => {
      setRenaming(null);
      if (value === null) return;
      const next = renamePath(node.path, value);
      if (next) select([next]);
    },
  });

  /**
   * Registers (or, with null, unregisters) an icon's element for hit-testing and drag images.
   *
   * Stores the element in the path-keyed `iconEls` map. Memoized with no dependencies, so the
   * memoized icons always receive the same callback.
   *
   * @param {string} path - Path of the icon's item.
   * @param {HTMLDivElement | null} el - The mounted element, or null on unmount.
   * @returns {void}
   *
   * @example
   * <DesktopIcon register={registerIcon} />
   */
  const registerIcon = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) iconEls.current.set(path, el);
    else iconEls.current.delete(path);
  }, []);

  const iconAreaLum = useWallpaperLuminance(ICON_REGION);
  const labelTone = iconAreaLum !== null && iconAreaLum > DARK_LABELS_ABOVE ? 'dark' : 'light';

  return (
    <div
      ref={rootRef}
      className={styles.desktop}
      data-label-tone={labelTone}
      style={{ zIndex: Z.DESKTOP }}
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={() => endBand(false)}
      onPointerCancel={() => endBand(true)}
      onLostPointerCapture={() => endBand(true)}
      onContextMenu={onRootContextMenu}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
    >
      <Wallpaper />
      <Widgets left={area.x + 18} top={area.y + 14} bottom={viewportHeight - area.y - area.height + 18} />
      <div key={relaunches} className={`${styles.icons} ${relaunches ? styles.iconsReturning : ''}`} role="listbox" aria-label={t(S.desktop)} aria-multiselectable="true">
        {items.map((node) => {
          const cell = layout.get(node.path);
          if (!cell) return null;
          const { x, y } = cellOrigin(metrics, cell);
          return (
            <DesktopIcon
              key={node.path}
              node={node}
              x={x}
              y={y}
              selected={selection.has(node.path)}
              keyActive={keyActive}
              dragging={dragging.has(node.path)}
              dropTarget={dropTarget === node.path}
              renaming={renaming === node.path}
              animate={arranging}
              events={events}
              register={registerIcon}
            />
          );
        })}
      </div>
      {band && <div className={styles.band} style={{ left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top }} />}
      {quickLookNode &&
        createPortal(
          <div className={styles.quickLook} style={{ zIndex: Z.WINDOWS + 1 }} data-quicklook="" onPointerDown={stop} onContextMenu={stop} onDragOver={stop} onDrop={stop}>
            <Suspense fallback={null}>
              <QuickLook
                node={quickLookNode}
                position={selected.length > 1 ? { index: selected.indexOf(quickLookNode.path), total: selected.length } : undefined}
                onClose={() => setQuickLook(false)}
                onOpen={(n) => openPaths([n.path])}
              />
            </Suspense>
          </div>,
          document.body,
        )}
    </div>
  );
}

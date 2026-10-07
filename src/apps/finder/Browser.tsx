/**
 * The Finder browser window: navigation history, selection model, keyboard handling, menus,
 * context menus and the four view modes over the shared virtual file system.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AppArgs, AppProps, FSNode, LString, MenuDef, MenuItem, SortKey } from '@/kernel';
import {
  HOME,
  PATHS,
  appsThatOpen,
  defaultAppFor,
  dialogs,
  dirname,
  downloadFile,
  emptyTrashWithConfirm,
  fileClipboard,
  fileContextMenu,
  fmt,
  fs,
  hasHostFiles,
  isCompact,
  isMacHost,
  isWithin,
  keyboardBusy,
  openGetInfo,
  pickHostFiles,
  showContextMenu,
  tr,
  useAppMenus,
  useArgsChange,
  useFS,
  useFileClipboard,
  useLocale,
  useSystem,
  useT,
  useTrashCount,
  useWindow,
  useWM,
  useWindowKeydown,
  wm,
} from '@/kernel';
import {
  RECENTS,
  TAG_PREFIX,
  canDropInto,
  chain,
  defaultSort,
  displayName,
  flattenRows,
  gridMove,
  isAppFile,
  isVirtual,
  linearMove,
  listChildren,
  locationName,
  nextSort,
  rangeBetween,
  resolveExistingDir,
  findMovedPath,
  selectRecents,
  selectTagged,
  sortItems,
  tagOf,
  toggleIn,
  typeAheadMatch,
  type Direction,
  type Row,
  type SortSpec,
  type ViewMode,
} from './model';
import { S, TAG_COLORS } from './strings';
import { ops, resolveTyped, undoLast, useUndo } from './ops';
import { prefs, useFinderPrefs } from './prefs';
import { beginItemDrag, endItemDrag, guardHostDrop } from './dnd';
import { tagDot } from './glyphs';
import { Sidebar } from './Sidebar';
import { FinderToolbar } from './FinderToolbar';
import { PathBar, ScopeBar, StatusBar, TrashBanner } from './Bars';
import { QuickLook } from './QuickLook';
import { Z, shellLayerRoot } from '@/shell/layers';
import { IconView } from './views/IconView';
import { ListView } from './views/ListView';
import { ColumnView, type Column } from './views/ColumnView';
import { GalleryView } from './views/GalleryView';
import type { ViewController } from './views/types';
import s from './Finder.module.css';

const TAG_ICONS = Object.fromEntries(TAG_COLORS.map((c) => [c.id, tagDot(c.color)])); /** Colored dot icon for each tag id, shown in the Tags submenu. */
const VIEW_MODES: { mode: ViewMode; label: LString; shortcut: string }[] = [
  { mode: 'icons', label: S.asIcons, shortcut: 'mod+1' },
  { mode: 'list', label: S.asList, shortcut: 'mod+2' },
  { mode: 'columns', label: S.asColumns, shortcut: 'mod+3' },
  { mode: 'gallery', label: S.asGallery, shortcut: 'mod+4' },
]; /** View modes in menu order, with their labels and ⌘1–⌘4 shortcuts. */
const SORT_KEYS: { key: SortKey; label: LString }[] = [
  { key: 'name', label: S.name },
  { key: 'kind', label: S.kind },
  { key: 'date', label: S.dateModified },
  { key: 'size', label: S.size },
]; /** Sort keys offered in the Sort By menu, in menu order. */
const sep: MenuItem = { separator: true }; /** Shared menu separator item. */
const EMPTY_SET: ReadonlySet<string> = new Set(); /** Stable empty set used for "nothing expanded" and "nothing highlighted". */
const DRAWER_BELOW = 500; /** Width (px) below which the sidebar becomes an overlay drawer (Finder's min window width is 520). */
const RENAME_DELAY = 650; /** Delay (ms) before a click on an already-selected name starts renaming (slow double-click). */

interface History {
  stack: string[];
  index: number;
}

/**
 * Computes where a new Finder window starts from its launch arguments.
 *
 * `args.path` may name Recents or a tag location (used as-is), a folder (opened), or a file
 * (its parent folder is opened with the file selected). A missing or unknown path falls back
 * to the home folder with nothing selected. String entries of `args.select` are kept as the
 * initial selection for folder and virtual locations.
 *
 * @param {AppArgs} args - Window arguments, read for `path` and `select`.
 * @returns {{ loc: string; select: string[] }} The initial location and selected paths.
 *
 * @example
 * initialState({ path: '/Users/guest/Documents/notes.txt' });
 * // { loc: '/Users/guest/Documents', select: ['/Users/guest/Documents/notes.txt'] }
 */
function initialState(args: AppArgs): { loc: string; select: string[] } {
  const raw = typeof args.path === 'string' ? args.path : '';
  const select = Array.isArray(args.select) ? args.select.filter((p): p is string => typeof p === 'string') : [];
  if (raw === RECENTS || raw.startsWith(TAG_PREFIX)) return { loc: raw, select };
  const node = raw ? fs.stat(raw) : null;
  if (node?.type === 'dir') return { loc: node.path, select };
  if (node) return { loc: dirname(node.path), select: [node.path] };
  return { loc: HOME, select: [] };
}

/**
 * Tells whether an event target sits on a control the user focused with the keyboard.
 *
 * Looks for the closest button, link or `role="button"` element and checks `:focus-visible`,
 * so Return activates a Tab-focused control instead of starting a rename. Environments that do
 * not support the `:focus-visible` selector make `matches` throw; that case returns false.
 *
 * @param {EventTarget | null} target - The keyboard event's target.
 * @returns {boolean} True when the target is inside a keyboard-focused button or link.
 *
 * @example
 * if (e.key === 'Enter' && !onKeyboardFocusedControl(e.target)) startRename(sel[0]);
 */
function onKeyboardFocusedControl(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target.closest('button, a[href], [role="button"]') : null;
  if (!el) return false;
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Returns the centre of a window in viewport coordinates.
 *
 * Reads the window's current bounds from the window manager; used to open Quick Look over the
 * Finder window it belongs to.
 *
 * @param {string} windowId - Id of the window.
 * @returns {{ x: number; y: number } | undefined} The centre point, or undefined when the window is gone.
 *
 * @example
 * windowCenter(windowId); // { x: 720, y: 400 }
 */
function windowCenter(windowId: string): { x: number; y: number } | undefined {
  const w = useWM.getState().windows.find((win) => win.id === windowId);
  return w ? { x: w.x + w.width / 2, y: w.y + w.height / 2 } : undefined;
}

/**
 * The Finder browser window component.
 *
 * Keeps a per-window history stack of locations (real folders, Recents or a tag) and renders the
 * sidebar, toolbar, banners, the active view (icons, list, columns or gallery), path bar, status
 * bar and Quick Look panel.
 *
 * View mode: the window has its own current view, which folders without a remembered view
 * inherit; a folder with a remembered view switches the window to it on navigation. In column
 * view every column shares the root folder's view settings (`colRoot`), so moving between
 * columns never leaves column view. Search results use their own remembered view (list by
 * default), and column view falls back to list for searches and virtual locations.
 *
 * Selection: only items currently visible in the view count as selected, so deleted or collapsed
 * items drop out automatically. The last selected path is the "lead" item. Gallery view always
 * selects the first item when nothing is selected.
 *
 * Folder tracking: when the folder shown disappears, the window compares the previous and current
 * FS snapshots and follows it if it was renamed or moved (by any app); a folder that was deleted
 * or moved into the Trash falls back to the nearest ancestor that still exists. When the moved
 * folder lies outside the column root, the columns are re-rooted at the moved copy of the old
 * root (or at the moved folder itself when that copy cannot be derived from its path).
 * Visited real folders are recorded in the Go ▸ Recent Folders list.
 *
 * Layout: below `DRAWER_BELOW` pixels of width (measured with a ResizeObserver) the sidebar is an
 * overlay drawer instead of a fixed column, so the content keeps the full width; the drawer
 * closes when the window becomes wide again, and the persisted `showSidebar` preference only
 * applies to wide windows.
 *
 * Menus and keyboard: the menu bar's File/Edit/View/Go menus are rebuilt from current state, and
 * their actions call through a ref so they always see the latest closures. Arrow keys move or
 * extend the selection (or expand/collapse in list view, move across columns in column view),
 * Return renames the single selected item, ⌘↓ opens the selection, Escape closes Quick Look or
 * the drawer, and typing printable characters jumps to the first matching name (type-ahead; the
 * typed text resets after one second without keystrokes).
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - Id of this Finder window.
 * @param {AppArgs} props.args - Launch arguments (`path`, `select`), also re-applied on args changes.
 * @returns {JSX.Element} The full Finder window content.
 *
 * @example
 * <FinderBrowser windowId={id} pid={pid} args={{ path: '/Users/guest/Documents' }} />
 */
export function FinderBrowser({ windowId, args }: AppProps) {
  const t = useT();
  const locale = useLocale();
  const { focused } = useWindow();
  const showHidden = useSystem((st) => st.settings.showHiddenFiles);
  const h24 = useSystem((st) => st.settings.clock24h);
  const nodes = useFS((st) => st.nodes);
  const clipboardCount = useFileClipboard((c) => c.paths.length);
  const undoTop = useUndo((u) => u.stack.at(-1)?.label ?? null);
  const trashCount = useTrashCount();
  const pref = useFinderPrefs();

  const [init] = useState(() => initialState(args));
  const [hist, setHist] = useState<History>({ stack: [init.loc], index: 0 });
  const [winView, setWinView] = useState<ViewMode>(() => useFinderPrefs.getState().views[init.loc] ?? 'icons');
  const [columnRoot, setColumnRoot] = useState(init.loc);
  const [selection, setSelectionState] = useState<string[]>(init.select);
  const [anchor, setAnchor] = useState<string | null>(init.select.at(-1) ?? null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'folder' | 'all'>('folder');
  const [quickLook, setQuickLook] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [narrow, setNarrow] = useState(() => isCompact());
  const [drawer, setDrawer] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const colsRef = useRef(1);
  const searchRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef({ text: '', at: 0 });
  const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameArmed = useRef(false);
  const pendingCollapse = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    /**
     * Updates the narrow-window flag from the root element's current width.
     *
     * Runs once on mount and on every resize; a zero width (e.g. a hidden or not yet laid out
     * window) is ignored so the previous layout is kept.
     *
     * @returns {void} Nothing.
     *
     * @example
     * const ro = new ResizeObserver(measure);
     */
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setNarrow(w < DRAWER_BELOW);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);
  const sidebarShown = narrow ? drawer : pref.showSidebar;

  /**
   * Shows or hides the sidebar.
   *
   * In a narrow window it toggles the overlay drawer; otherwise it flips the persisted
   * `showSidebar` Finder preference, which affects every wide Finder window.
   *
   * @returns {void} Nothing.
   *
   * @example
   * toggleSidebar(); // opens the drawer in a narrow window
   */
  const toggleSidebar = () => (narrow ? setDrawer((v) => !v) : prefs.set({ showSidebar: !useFinderPrefs.getState().showSidebar }));

  const rawLoc = hist.stack[hist.index];
  const loc = resolveExistingDir(rawLoc, nodes);
  const virtual = isVirtual(loc);
  const realDir = virtual ? null : loc;
  const tag = tagOf(loc);
  const searching = query.trim().length > 0;
  const searchRoot = scope === 'all' ? '/' : (realDir ?? HOME);
  const writableDir = !searching && realDir && realDir !== PATHS.trash && canDropInto(nodes[realDir]) ? realDir : null;
  const inTrashView = loc === PATHS.trash && !searching;

  const colRoot = !virtual && isWithin(loc, columnRoot) ? columnRoot : loc;
  const inColumns = !searching && !virtual && (pref.views[colRoot] ?? winView) === 'columns';
  const viewKey = searching ? 'search' : inColumns ? colRoot : loc;
  let viewMode: ViewMode = pref.views[viewKey] ?? (searching ? 'list' : winView);
  if (viewMode === 'columns' && (searching || virtual)) viewMode = 'list';
  const sort: SortSpec = pref.sorts[viewKey] ?? defaultSort(loc);

  const rawItems = useMemo(() => {
    if (searching) return fs.search(query, searchRoot, 500);
    if (loc === RECENTS) return selectRecents(nodes);
    if (tag) return selectTagged(nodes, tag);
    return listChildren(nodes, loc, showHidden);
  }, [nodes, searching, query, searchRoot, loc, tag, showHidden]);
  const items = useMemo(() => sortItems(rawItems, sort, locale), [rawItems, sort, locale]);

  /**
   * Lists a folder's children the way the current view shows them.
   *
   * Reads the children of `dir` from the FS snapshot, honoring the "show hidden files" setting,
   * and sorts them with the active sort order and locale. Memoized with `useCallback` so list
   * rows only recompute when the inputs change.
   *
   * @param {string} dir - Absolute path of the folder.
   * @returns {FSNode[]} The sorted child nodes.
   *
   * @example
   * const kids = childrenOf('/Users/guest/Documents');
   */
  const childrenOf = useCallback((dir: string) => sortItems(listChildren(nodes, dir, showHidden), sort, locale), [nodes, showHidden, sort, locale]);
  const rows: Row[] = useMemo(
    () => (viewMode === 'list' && !searching ? flattenRows(items, expanded, childrenOf) : items.map((node) => ({ node, depth: 0, expanded: false }))),
    [viewMode, searching, items, expanded, childrenOf],
  );
  const order = useMemo(() => rows.map((r) => r.node.path), [rows]);
  const orderSet = useMemo(() => new Set(order), [order]);
  const sel = useMemo(() => selection.filter((p) => orderSet.has(p)), [selection, orderSet]);
  const selSet = useMemo(() => new Set(sel), [sel]);
  const lead = sel.at(-1) ?? null;
  const leadNode = lead ? nodes[lead] : undefined;
  const renamingNow = renaming && nodes[renaming] ? renaming : null;

  /**
   * Cancels a pending slow-click rename.
   *
   * Clears the timer armed by a click on an already-selected name, so the rename does not start.
   * Also used as the unmount cleanup of the component.
   *
   * @returns {void} Nothing.
   *
   * @example
   * cancelRenameTimer();
   */
  const cancelRenameTimer = () => {
    if (renameTimer.current) clearTimeout(renameTimer.current);
    renameTimer.current = null;
  };
  useEffect(() => cancelRenameTimer, []);

  /**
   * Replaces the selection and moves the range anchor to its last item.
   *
   * The last path becomes both the lead item and the anchor for later ⇧-click / ⇧-arrow ranges.
   * Memoized with `useCallback` so it can be passed to effects and views as a stable reference.
   *
   * @param {string[]} paths - Paths to select, in order (the last one is the lead).
   * @returns {void} Nothing.
   *
   * @example
   * setSelection(['/Users/guest/Documents/a.txt']);
   */
  const setSelection = useCallback((paths: string[]) => {
    setSelectionState(paths);
    setAnchor(paths.at(-1) ?? null);
  }, []);

  /**
   * Clears per-location UI state before showing another location.
   *
   * Empties the search query, ends any rename (and its pending timer) and collapses all
   * expanded list-view folders.
   *
   * @returns {void} Nothing.
   *
   * @example
   * resetTransient();
   */
  const resetTransient = () => {
    setQuery('');
    setRenaming(null);
    setExpanded(EMPTY_SET);
    cancelRenameTimer();
  };

  /**
   * Switches the window's view to the one remembered for a location, if any.
   *
   * A folder with a remembered view mode makes it the window's current view; folders without
   * one keep (and inherit) the current view.
   *
   * @param {string} target - Location about to be shown.
   * @returns {void} Nothing.
   *
   * @example
   * adoptView('/Users/guest/Pictures');
   */
  const adoptView = (target: string) => {
    const remembered = useFinderPrefs.getState().views[target];
    if (remembered) setWinView(remembered);
  };

  /**
   * Shows a location in this window and records it in the history.
   *
   * Resets transient state, applies the given selection, re-roots column view at the target and
   * adopts the target's remembered view. When the target differs from the current location it
   * drops any forward history and pushes the target as the new current entry.
   *
   * @param {string} target - Folder path or virtual location to show.
   * @param {string[]} [select=[]] - Paths to select after navigating.
   * @returns {void} Nothing.
   *
   * @example
   * navigate('/Users/guest/Documents', ['/Users/guest/Documents/notes.txt']);
   */
  const navigate = (target: string, select: string[] = []) => {
    resetTransient();
    setSelection(select);
    setColumnRoot(target);
    adoptView(target);
    if (target !== loc) setHist((h) => ({ stack: [...h.stack.slice(0, h.index + 1), target], index: h.index + 1 }));
  };

  /**
   * Moves the current folder between columns in column view.
   *
   * Ends any rename, applies the selection and replaces the current history entry with `dir`
   * instead of pushing a new one, so Back leaves column browsing as a single step.
   *
   * @param {string} dir - Folder that becomes the current (rightmost active) column.
   * @param {string[]} select - Paths to select in that column.
   * @returns {void} Nothing.
   *
   * @example
   * navigateColumn('/Users/guest/Documents', ['/Users/guest/Documents/Work']);
   */
  const navigateColumn = (dir: string, select: string[]) => {
    setRenaming(null);
    cancelRenameTimer();
    setSelection(select);
    if (dir !== loc) setHist((h) => ({ stack: h.stack.map((p, i) => (i === h.index ? dir : p)), index: h.index }));
  };

  /**
   * Steps backward or forward through the window's history.
   *
   * Does nothing past either end of the stack. The destination is resolved to the nearest
   * folder that still exists. When the destination is the parent of the current real folder,
   * the folder that was just left is selected; otherwise the selection is cleared. Column view
   * is re-rooted at the destination and its remembered view is adopted.
   *
   * @param {-1 | 1} delta - -1 for Back, 1 for Forward.
   * @returns {void} Nothing.
   *
   * @example
   * goHistory(-1); // Go ▸ Back
   */
  const goHistory = (delta: -1 | 1) => {
    const index = hist.index + delta;
    if (index < 0 || index >= hist.stack.length) return;
    const to = resolveExistingDir(hist.stack[index], nodes);
    resetTransient();
    setSelection(!virtual && !isVirtual(to) && loc !== '/' && dirname(loc) === to ? [loc] : []);
    setColumnRoot(to);
    adoptView(to);
    setHist((h) => ({ ...h, index }));
  };

  /**
   * Navigates to the parent of the current folder, selecting the folder that was left.
   *
   * Does nothing for virtual locations and at the root folder.
   *
   * @returns {void} Nothing.
   *
   * @example
   * enclosingFolder(); // Go ▸ Enclosing Folder (⌘↑)
   */
  const enclosingFolder = () => {
    if (realDir && realDir !== '/') navigate(dirname(realDir), [realDir]);
  };

  /**
   * Opens a folder inside this window.
   *
   * In column view a folder under the current column root is shown as a column (no new history
   * entry); otherwise the window navigates to it.
   *
   * @param {string} dir - Absolute path of the folder to open.
   * @returns {void} Nothing.
   *
   * @example
   * openFolder('/Users/guest/Downloads');
   */
  const openFolder = (dir: string) => {
    if (viewMode === 'columns' && isWithin(dir, colRoot)) navigateColumn(dir, []);
    else navigate(dir);
  };

  /**
   * Opens items the way Finder's File ▸ Open does.
   *
   * A single folder (and nothing else) opens in place unless `opts.newWindow` is set; otherwise
   * every folder opens in a new Finder window. Files open in their default apps. Paths that no
   * longer exist are ignored.
   *
   * @param {string[]} paths - Paths of the items to open.
   * @param {{ newWindow?: boolean }} [opts={}] - Options; `newWindow` forces folders into new windows.
   * @returns {void} Nothing.
   *
   * @example
   * openItems(sel);
   * openItems(['/Users/guest/Documents'], { newWindow: true });
   */
  const openItems = (paths: string[], opts: { newWindow?: boolean } = {}) => {
    const targets = paths.map((p) => nodes[p]).filter((n): n is FSNode => !!n);
    const dirs = targets.filter((n) => n.type === 'dir');
    if (dirs.length === 1 && targets.length === 1 && !opts.newWindow) openFolder(dirs[0].path);
    else dirs.forEach((d) => wm.openWindow('finder', { path: d.path }));
    targets.filter((n) => n.type === 'file').forEach((f) => wm.openPath(f.path));
  };

  const prevNodes = useRef(nodes);
  useEffect(() => {
    const before = prevNodes.current;
    prevNodes.current = nodes;
    if (loc === rawLoc) return;
    const last = before[rawLoc];
    const moved = last ? findMovedPath(last, before, nodes) : null;
    const target = moved && nodes[moved]?.type === 'dir' && !isWithin(moved, PATHS.trash) ? moved : loc;
    setHist((h) => ({ stack: h.stack.map((p, i) => (i === h.index ? target : p)), index: h.index }));
    if (target === moved && !isWithin(moved, columnRoot)) {
      const suffix = isWithin(rawLoc, columnRoot) ? rawLoc.slice(columnRoot.length) : '';
      setColumnRoot(suffix && moved.endsWith(suffix) ? moved.slice(0, -suffix.length) || '/' : moved);
    }
  }, [nodes, loc, rawLoc, columnRoot]);
  useEffect(() => {
    // Skipped while the effect above is still re-pointing a vanished folder (loc !== rawLoc).
    if (loc === rawLoc && colRoot !== columnRoot) setColumnRoot(colRoot);
  }, [loc, rawLoc, colRoot, columnRoot]);
  useEffect(() => {
    if (realDir) prefs.pushRecentFolder(realDir);
  }, [realDir]);
  useEffect(() => {
    if (quickLook && !leadNode) setQuickLook(false);
  }, [quickLook, leadNode]);
  const firstItem = order[0];
  useEffect(() => {
    if (viewMode === 'gallery' && !sel.length && firstItem) setSelection([firstItem]);
  }, [viewMode, sel.length, firstItem, setSelection]);

  const title = searching ? fmt(t(S.searchingTitle), { q: query.trim() }) : locationName(loc, locale);
  useEffect(() => wm.setTitle(windowId, title), [windowId, title]);

  useArgsChange((a) => {
    const next = initialState(a as AppArgs);
    navigate(next.loc, next.select);
  });

  /**
   * Starts inline renaming of an item.
   *
   * Cancels any pending slow-click rename, then selects the item and puts it into rename mode.
   * Protected items and items inside the Trash cannot be renamed and are ignored.
   *
   * @param {string} path - Path of the item to rename.
   * @returns {void} Nothing.
   *
   * @example
   * startRename('/Users/guest/Documents/notes.txt');
   */
  const startRename = (path: string) => {
    cancelRenameTimer();
    if (fs.isProtected(path) || isWithin(path, PATHS.trash)) return;
    setSelection([path]);
    setRenaming(path);
  };

  /**
   * Selects the results of an operation when they landed in the folder being shown.
   *
   * Does nothing when `paths` is empty or `dir` is not the current location.
   *
   * @param {string[]} paths - Resulting item paths (e.g. pasted or duplicated items).
   * @param {string} dir - Folder the items were created in.
   * @returns {void} Nothing.
   *
   * @example
   * selectIfHere(ops.paste(loc), loc);
   */
  const selectIfHere = (paths: string[], dir: string) => {
    if (paths.length && dir === loc) setSelection(paths);
  };

  /**
   * Creates an "untitled folder" and starts renaming it.
   *
   * Creates the folder through `ops` (so it can be undone). When it was created in the folder
   * being shown, it is selected and put into rename mode. Does nothing when `dir` is null.
   *
   * @param {string | null} [dir=writableDir] - Folder to create the new folder in.
   * @returns {void} Nothing.
   *
   * @example
   * createFolder(); // File ▸ New Folder in the current folder
   */
  const createFolder = (dir: string | null = writableDir) => {
    if (!dir) return;
    const p = ops.newFolder(dir, windowId);
    if (p && dir === loc) {
      setSelection([p]);
      setRenaming(p);
    }
  };

  /**
   * Moves the selected items into a newly created folder and starts renaming it.
   *
   * Requires a writable current folder and a non-empty selection; the new folder is selected
   * and put into rename mode when it was created.
   *
   * @returns {void} Nothing.
   *
   * @example
   * folderWithSelection(); // File ▸ New Folder with Selection
   */
  const folderWithSelection = () => {
    if (!writableDir || !sel.length) return;
    const p = ops.newFolderWithItems(sel, writableDir, windowId);
    if (p) {
      setSelection([p]);
      setRenaming(p);
    }
  };

  /**
   * Duplicates items next to the originals and selects the copies.
   *
   * Duplicates through `ops.duplicate`, which records an undo entry, and passes the new paths
   * to `selectIfHere` with the current location. Copies that are not visible in the view (for
   * example while searching) drop out of the effective selection.
   *
   * @param {string[]} [paths=sel] - Items to duplicate.
   * @returns {void} Nothing.
   *
   * @example
   * duplicate(); // File ▸ Duplicate (⌘D)
   */
  const duplicate = (paths = sel) => selectIfHere(ops.duplicate(paths), loc);

  /**
   * Pastes the file clipboard into a folder and selects the pasted items if they are in view.
   *
   * Does nothing when `dir` is null (no writable folder).
   *
   * @param {string | null} [dir=writableDir] - Destination folder.
   * @returns {'' | null | void} Nothing meaningful; the short-circuit value is ignored.
   *
   * @example
   * paste(); // Edit ▸ Paste (⌘V)
   */
  const paste = (dir: string | null = writableDir) => dir && selectIfHere(ops.paste(dir), dir);

  /**
   * Moves the clipboard's items into the current folder and selects them.
   *
   * Does nothing when the current location is not writable.
   *
   * @returns {'' | null | void} Nothing meaningful; the short-circuit value is ignored.
   *
   * @example
   * moveHere(); // Edit ▸ Move Item Here (⌥⌘V)
   */
  const moveHere = () => writableDir && selectIfHere(ops.moveHere(writableDir), writableDir);

  /**
   * Moves items to the Trash, or deletes them immediately when they are already in it.
   *
   * Starts the asynchronous `ops.trash` call without awaiting it; any confirmation dialog is
   * shown as a sheet on this window.
   *
   * @param {string[]} [paths=sel] - Items to trash.
   * @returns {void} Nothing.
   *
   * @example
   * trashSel(); // File ▸ Move to Trash (⌘⌫)
   */
  const trashSel = (paths = sel) => void ops.trash(paths, windowId);

  /**
   * Restores items from the Trash to their original locations.
   *
   * Calls `ops.putBack`, which restores the items in order, stops at the first failure with an
   * error sheet on this window and records an undo entry. The returned paths are discarded.
   *
   * @param {string[]} [paths=sel] - Trashed items to put back.
   * @returns {void} Nothing.
   *
   * @example
   * putBack(); // File ▸ Put Back
   */
  const putBack = (paths = sel) => void ops.putBack(paths, windowId);

  /**
   * Opens a Get Info window for every selected item, or for the current folder when nothing
   * is selected.
   *
   * Does nothing in a virtual location with an empty selection.
   *
   * @returns {void} Nothing.
   *
   * @example
   * getInfo(); // File ▸ Get Info (⌘I)
   */
  const getInfo = () => (sel.length ? sel : realDir ? [realDir] : []).forEach(openGetInfo);

  /**
   * Lets the user pick files from the host computer and imports them into a folder.
   *
   * Opens the host file picker; once the files are created they are selected if `dir` is the
   * folder being shown. Does nothing when `dir` is null.
   *
   * @param {string | null} [dir=writableDir] - Destination folder.
   * @returns {void} Nothing.
   *
   * @example
   * importFiles('/Users/guest/Downloads');
   */
  const importFiles = (dir: string | null = writableDir) => {
    if (dir) void pickHostFiles(dir).then((created) => selectIfHere(created, dir));
  };

  /**
   * Moves keyboard focus into the toolbar's search field.
   *
   * Looks up the first `<input>` inside the element held by `searchRef` and focuses it; does
   * nothing when the toolbar has not rendered the field.
   *
   * @returns {void} Nothing.
   *
   * @example
   * focusSearch(); // File ▸ Find (⌘F)
   */
  const focusSearch = () => searchRef.current?.querySelector('input')?.focus();

  /**
   * Changes the view mode and remembers it.
   *
   * While searching, only the remembered search-results view changes. Otherwise the window's
   * view changes and is stored for the current folder (or for the column root in column view).
   * Leaving column view while browsing a subfolder also stores the new mode for the column root
   * and moves the column root down to the folder being browsed.
   *
   * @param {ViewMode} mode - The view mode to switch to.
   * @returns {void} Nothing.
   *
   * @example
   * setView('list'); // View ▸ as List (⌘2)
   */
  const setView = (mode: ViewMode) => {
    if (searching) return prefs.setView('search', mode);
    setWinView(mode);
    if (mode !== 'columns' && colRoot !== loc) {
      prefs.setView(colRoot, mode);
      setColumnRoot(loc);
    }
    prefs.setView(mode === 'columns' ? colRoot : loc, mode);
  };

  /**
   * Stores a sort order for the current view key (folder, column root or search).
   *
   * Writes the spec to the persisted Finder preferences under `viewKey`, so every window
   * showing the same folder (or search results) picks up the new order.
   *
   * @param {SortSpec} spec - The new sort key and direction.
   * @returns {void} Nothing.
   *
   * @example
   * setSort({ key: 'date', dir: 'desc' });
   */
  const setSort = (spec: SortSpec) => prefs.setSort(viewKey, spec);

  /**
   * Shows the Go to Folder prompt and navigates to the typed path.
   *
   * The prompt is prefilled with the current folder (or "~/"). The input is resolved relative to
   * the current folder and supports "~". A folder is opened; a file opens its parent folder with
   * the file selected; an unknown path shows a "folder not found" alert. Cancelling or entering
   * only whitespace does nothing.
   *
   * @async
   * @returns {Promise<void>} Resolves when the prompt (and any alert) has been handled.
   *
   * @example
   * void goToFolder(); // Go ▸ Go to Folder… (⇧⌘G)
   */
  const goToFolder = async () => {
    const input = await dialogs.prompt({ windowId, title: S.goToFolderTitle, defaultValue: realDir ? `${realDir === '/' ? '' : realDir}/` : '~/', placeholder: S.goToFolderPlaceholder, okLabel: S.goButton });
    if (!input?.trim()) return;
    const target = resolveTyped(input, realDir ?? HOME);
    const node = fs.stat(target);
    if (node?.type === 'dir') navigate(node.path);
    else if (node) navigate(dirname(node.path), [node.path]);
    else await dialogs.alert({ windowId, title: S.folderNotFound, message: input.trim() });
  };

  /**
   * Expands or collapses a folder's disclosure triangle in list view.
   *
   * The folder's current state decides the direction: a collapsed folder opens, an expanded one
   * closes. With `recursive` (⌥-click / ⌥-arrow) every subfolder below it changes the same way.
   *
   * @param {string} path - Path of the folder row.
   * @param {boolean} recursive - Whether to apply the change to all nested subfolders too.
   * @returns {void} Nothing.
   *
   * @example
   * toggleExpand('/Users/guest/Documents', false);
   */
  const toggleExpand = (path: string, recursive: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const open = !prev.has(path);
      const targets = recursive ? [path, ...fs.walk(path).filter((n) => n.type === 'dir').map((n) => n.path)] : [path];
      for (const p of targets) {
        if (open) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  };

  /**
   * Builds the "View as" submenu used by context menus.
   *
   * One checkable item per view mode; the column view entry is disabled while searching or in
   * a virtual location.
   *
   * @returns {MenuItem[]} The submenu items.
   *
   * @example
   * items.push({ label: S.viewAs, submenu: viewSubmenu() });
   */
  const viewSubmenu = (): MenuItem[] =>
    VIEW_MODES.map((v) => ({ label: v.label, checked: viewMode === v.mode, disabled: v.mode === 'columns' && (searching || virtual), action: () => setView(v.mode) }));

  /**
   * Builds the "Sort By" submenu.
   *
   * One checkable item per sort key followed by Ascending / Descending. Picking a different key
   * applies that key's default direction via `nextSort`; picking the active key keeps the order.
   *
   * @returns {MenuItem[]} The submenu items.
   *
   * @example
   * items.push({ label: S.sortBy, submenu: sortSubmenu() });
   */
  const sortSubmenu = (): MenuItem[] => [
    ...SORT_KEYS.map((k) => ({ label: k.label, checked: sort.key === k.key, action: () => setSort(sort.key === k.key ? sort : nextSort(sort, k.key)) })),
    sep,
    { label: S.ascending, checked: sort.dir === 'asc', action: () => setSort({ ...sort, dir: 'asc' }) },
    { label: S.descending, checked: sort.dir === 'desc', action: () => setSort({ ...sort, dir: 'desc' }) },
  ];

  /**
   * Builds the "Tags" submenu for a set of items.
   *
   * Each tag color is checked when every item has that tag; choosing a checked tag removes it,
   * choosing another applies it to all items. "No Tag" clears the tag and is disabled when none
   * of the items is tagged. Changes go through `ops.setTag`, so they can be undone.
   *
   * @param {string[]} paths - Items the menu acts on.
   * @returns {MenuItem[]} The submenu items.
   *
   * @example
   * extras.push({ label: S.tagsMenu, submenu: tagSubmenu(paths) });
   */
  const tagSubmenu = (paths: string[]): MenuItem[] => {
    const tags = paths.map((p) => nodes[p]?.meta?.tag);
    return [
      ...TAG_COLORS.map((c) => {
        const all = tags.every((x) => x === c.id);
        return { label: c.name, icon: TAG_ICONS[c.id], checked: all, action: () => ops.setTag(paths, all ? undefined : c.id) };
      }),
      sep,
      { label: S.noTag, disabled: tags.every((x) => !x), action: () => ops.setTag(paths, undefined) },
    ];
  };

  /**
   * Returns an item's display name in a specific language.
   *
   * Used to build bilingual menu labels; returns an empty string for paths that do not exist.
   *
   * @param {string} path - Path of the item.
   * @param {'en' | 'ko'} l - Language to localize the name in.
   * @returns {string} The localized display name, or ''.
   *
   * @example
   * nameIn(PATHS.desktop, 'ko'); // '데스크탑'
   */
  const nameIn = (path: string, l: 'en' | 'ko') => (nodes[path] ? displayName(nodes[path], l) : '');

  /**
   * Builds the bilingual label of the Edit ▸ Copy item for a selection.
   *
   * A single item is named in quotes; several items are counted.
   *
   * @param {string[]} paths - Selected item paths.
   * @returns {LString} The localized "Copy …" label.
   *
   * @example
   * copyLabel(['/Users/guest/a.txt']); // { en: 'Copy “a.txt”', ko: '“a.txt” 복사하기' }
   */
  const copyLabel = (paths: string[]): LString =>
    paths.length === 1 ? { en: `Copy “${nameIn(paths[0], 'en')}”`, ko: `“${nameIn(paths[0], 'ko')}” 복사하기` } : { en: `Copy ${paths.length} Items`, ko: `${paths.length}개 항목 복사하기` };

  const pasteLabel: LString = clipboardCount > 1 ? { en: `Paste ${clipboardCount} Items`, ko: `${clipboardCount}개 항목 붙여넣기` } : { en: 'Paste Item', ko: '항목 붙여넣기' };
  const moveHereLabel: LString = clipboardCount > 1 ? { en: `Move ${clipboardCount} Items Here`, ko: `${clipboardCount}개 항목을 여기로 이동` } : { en: 'Move Item Here', ko: '항목을 여기로 이동' };
  const quickLookLabel: LString = lead ? { en: `Quick Look “${nameIn(lead, 'en')}”`, ko: `“${nameIn(lead, 'ko')}” 훑어보기` } : S.quickLook;
  const undoMenuLabel: LString = undoTop ? { en: `Undo ${tr(undoTop, 'en')}`, ko: `${tr(undoTop, 'ko')} 실행 취소` } : S.undo;

  /**
   * Builds the context menu for one or more items.
   *
   * Starts from the kernel's standard file context menu and rewires its enabled Move to Trash,
   * Duplicate, Put Back and Delete Immediately entries (matched by English label) to this
   * window's `ops`-based actions, which record undo entries and select duplicates in view.
   * Appends Quick Look, the Tags submenu (unless every item is in the Trash) and, for several
   * unprotected items that all live in the writable current folder, "New Folder with
   * Selection". "Show in Enclosing Folder" is included while searching or in a virtual
   * location.
   *
   * @param {string[]} paths - Items the menu acts on.
   * @returns {MenuItem[]} The context menu items.
   *
   * @example
   * showContextMenu(e, itemMenu(sel));
   */
  const itemMenu = (paths: string[]): MenuItem[] => {
    const base = fileContextMenu(paths, { onRename: startRename, windowId, showReveal: searching || virtual });
    const rewire: Record<string, () => void> = {
      'Move to Trash': () => trashSel(paths),
      Duplicate: () => duplicate(paths),
      'Put Back': () => putBack(paths),
      'Delete Immediately…': () => trashSel(paths),
    };
    const items = base.map((it) => {
      const key = typeof it.label === 'object' ? it.label.en : it.label;
      return key && rewire[key] && !it.disabled ? { ...it, action: rewire[key] } : it;
    });
    const qlLabel: LString = paths.length === 1 ? { en: `Quick Look “${nameIn(paths[0], 'en')}”`, ko: `“${nameIn(paths[0], 'ko')}” 훑어보기` } : S.quickLook;
    const extras: MenuItem[] = [{ label: qlLabel, action: () => setQuickLook(true) }];
    if (!paths.every((p) => isWithin(p, PATHS.trash))) {
      extras.push({ label: S.tagsMenu, submenu: tagSubmenu(paths) });
      if (paths.length > 1 && writableDir && !paths.some((p) => fs.isProtected(p)) && paths.every((p) => dirname(p) === writableDir)) {
        extras.push({ label: { en: `New Folder with Selection (${paths.length} Items)`, ko: `선택 항목(${paths.length}개)으로 새로운 폴더 만들기` }, action: folderWithSelection });
      }
    }
    return [...items, sep, ...extras];
  };

  /**
   * Builds the context menu for empty space in a view.
   *
   * For a real folder it offers New Folder, Get Info, Import Files and Paste (write actions are
   * disabled while searching, in the Trash or in folders that refuse drops), followed by the
   * View as and Sort By submenus. A null `dir` (virtual location or search results) gets only
   * the two submenus. The Trash also gets Empty Trash, disabled when it has no items.
   *
   * @param {string | null} dir - Folder whose background was clicked, or null for a virtual location or search results.
   * @returns {MenuItem[]} The context menu items.
   *
   * @example
   * showContextMenu(e, backgroundMenu(loc));
   */
  const backgroundMenu = (dir: string | null): MenuItem[] => {
    const canWrite = !!dir && !searching && dir !== PATHS.trash && canDropInto(nodes[dir]);
    const items: MenuItem[] = [];
    if (dir) {
      items.push(
        { label: S.newFolder, disabled: !canWrite, action: () => createFolder(dir) },
        sep,
        { label: S.getInfo, action: () => openGetInfo(dir) },
        sep,
        { label: S.importFiles, disabled: !canWrite, action: () => importFiles(dir) },
        { label: pasteLabel, disabled: !canWrite || !clipboardCount, action: () => paste(dir) },
        sep,
      );
    }
    items.push({ label: S.viewAs, submenu: viewSubmenu() }, { label: S.sortBy, submenu: sortSubmenu() });
    if (dir === PATHS.trash) items.push(sep, { label: S.emptyTrash, disabled: !trashCount, action: () => void emptyTrashWithConfirm(windowId) });
    return items;
  };

  const anySelProtected = sel.some((p) => fs.isProtected(p));
  const singleFile = sel.length === 1 && leadNode?.type === 'file' && !isAppFile(leadNode) ? leadNode : null;
  const openWithApps = singleFile ? appsThatOpen(singleFile.name) : [];
  const defaultApp = singleFile ? defaultAppFor(singleFile.name) : undefined;
  const recentFolders = pref.recentFolders.filter((p) => nodes[p]?.type === 'dir');

  const api = { createFolder, folderWithSelection, openItems, getInfo, startRename, duplicate, trashSel, putBack, paste, moveHere, importFiles, focusSearch, setView, setSort, goHistory, enclosingFolder, navigate, goToFolder, sortSubmenu, toggleSidebar };
  const apiRef = useRef(api);
  useLayoutEffect(() => {
    apiRef.current = api;
  });

  useAppMenus((): MenuDef[] => {
    const A = apiRef;
    const fileMenu: MenuItem[] = [
      { label: S.newFinderWindow, shortcut: 'alt+n', action: () => wm.openWindow('finder', { path: HOME }) },
      { label: S.newFolder, shortcut: 'alt+shift+n', disabled: !writableDir, action: () => A.current.createFolder() },
      { label: S.newFolderWithSelection, disabled: !writableDir || !sel.length || anySelProtected, action: () => A.current.folderWithSelection() },
      sep,
      { label: S.open, shortcut: 'mod+o', disabled: !sel.length, action: () => A.current.openItems(sel) },
    ];
    if (singleFile && openWithApps.length) {
      fileMenu.push({
        label: S.openWith,
        submenu: openWithApps.map((a) => ({ label: a.id === defaultApp ? `${t(a.name)} ${t(S.defaultSuffix)}` : t(a.name), action: () => wm.openPath(singleFile.path, a.id) })),
      });
    }
    fileMenu.push(
      { label: S.closeWindow, shortcut: 'alt+w', action: () => void wm.close(windowId) },
      sep,
      { label: S.getInfo, shortcut: 'mod+i', disabled: !sel.length && !realDir, action: () => A.current.getInfo() },
      { label: S.rename, disabled: sel.length !== 1 || anySelProtected || inTrashView, action: () => lead && A.current.startRename(lead) },
      { label: S.duplicate, shortcut: 'mod+d', disabled: !sel.length || inTrashView || sel.some((p) => nodes[p] && isAppFile(nodes[p])), action: () => A.current.duplicate() },
      { label: quickLookLabel, shortcut: 'space', disabled: !lead, action: () => setQuickLook((q) => !q) },
      sep,
    );
    if (inTrashView) {
      fileMenu.push(
        { label: S.putBack, shortcut: 'mod+backspace', disabled: !sel.length, action: () => A.current.putBack() },
        { label: S.deleteImmediately, shortcut: 'mod+alt+backspace', disabled: !sel.length, action: () => A.current.trashSel() },
      );
    } else {
      fileMenu.push({ label: S.moveToTrash, shortcut: 'mod+backspace', disabled: !sel.length || anySelProtected, action: () => A.current.trashSel() });
    }
    fileMenu.push(
      sep,
      { label: S.download, disabled: !singleFile, action: () => singleFile && downloadFile(singleFile.path) },
      { label: S.importFiles, disabled: !writableDir, action: () => A.current.importFiles() },
      sep,
      { label: S.find, shortcut: 'mod+f', action: () => A.current.focusSearch() },
    );

    const editMenu: MenuItem[] = [
      { label: undoMenuLabel, shortcut: 'mod+z', disabled: !undoTop, action: () => undoLast(windowId) },
      { label: S.redo, shortcut: 'mod+shift+z', disabled: true },
      sep,
      { label: S.cut, shortcut: 'mod+x', disabled: true },
      { label: sel.length ? copyLabel(sel) : S.copy, shortcut: 'mod+c', disabled: !sel.length, action: () => fileClipboard.copy(sel) },
      { label: pasteLabel, shortcut: 'mod+v', disabled: !clipboardCount || !writableDir, action: () => A.current.paste() },
      { label: moveHereLabel, shortcut: 'mod+alt+v', disabled: !clipboardCount || !writableDir, action: () => A.current.moveHere() },
      { label: S.selectAll, shortcut: 'mod+a', disabled: !order.length, action: () => setSelection(order) },
    ];

    const viewMenu: MenuItem[] = [
      ...VIEW_MODES.map((v) => ({ label: v.label, shortcut: v.shortcut, checked: viewMode === v.mode, disabled: v.mode === 'columns' && (searching || virtual), action: () => A.current.setView(v.mode) })),
      sep,
      { label: S.sortBy, submenu: sortSubmenu() },
      sep,
      { label: sidebarShown ? S.hideSidebar : S.showSidebar, shortcut: 'mod+alt+s', action: () => A.current.toggleSidebar() },
      { label: pref.showPathBar ? S.hidePathBar : S.showPathBar, shortcut: 'mod+alt+p', action: () => prefs.set({ showPathBar: !useFinderPrefs.getState().showPathBar }) },
      { label: pref.showStatusBar ? S.hideStatusBar : S.showStatusBar, shortcut: 'mod+/', action: () => prefs.set({ showStatusBar: !useFinderPrefs.getState().showStatusBar }) },
      sep,
      {
        label: S.showHiddenFiles,
        shortcut: 'mod+shift+.',
        checked: showHidden,
        action: () => useSystem.getState().updateSettings({ showHiddenFiles: !useSystem.getState().settings.showHiddenFiles }),
      },
    ];

    /**
     * Creates a menu action that navigates this window to a location.
     *
     * The returned closure reads `navigate` from the API ref when it runs, so it always uses
     * the component's latest state even though the menu was built earlier.
     *
     * @param {string} path - Folder path or virtual location to open.
     * @returns {() => void} A menu action calling `navigate(path)` through the latest API ref.
     *
     * @example
     * { label: S.home, shortcut: 'mod+shift+h', action: go(HOME) }
     */
    const go = (path: string) => () => A.current.navigate(path);
    const goMenu: MenuItem[] = [
      { label: S.back, shortcut: 'mod+[', disabled: hist.index === 0, action: () => A.current.goHistory(-1) },
      { label: S.forward, shortcut: 'mod+]', disabled: hist.index >= hist.stack.length - 1, action: () => A.current.goHistory(1) },
      { label: S.enclosingFolder, shortcut: 'mod+up', disabled: !realDir || realDir === '/' || searching, action: () => A.current.enclosingFolder() },
      sep,
      { label: S.recents, shortcut: 'mod+shift+f', action: go(RECENTS) },
      { label: S.documents, shortcut: 'mod+shift+o', action: go(PATHS.documents) },
      { label: S.desktop, shortcut: 'mod+shift+d', action: go(PATHS.desktop) },
      { label: S.downloads, shortcut: 'mod+alt+l', action: go(PATHS.downloads) },
      { label: S.home, shortcut: 'mod+shift+h', action: go(HOME) },
      { label: S.computer, action: go('/') },
      { label: S.applications, shortcut: 'mod+shift+a', action: go(PATHS.applications) },
      { label: S.trash, action: go(PATHS.trash) },
      sep,
      {
        label: S.recentFolders,
        disabled: !recentFolders.length,
        submenu: [...recentFolders.map((p) => ({ label: locationName(p, locale), action: go(p) })), sep, { label: S.clearMenu, action: () => prefs.clearRecentFolders() }],
      },
      sep,
      { label: S.goToFolder, shortcut: 'mod+shift+g', action: () => void A.current.goToFolder() },
    ];

    return [
      { label: S.file, items: fileMenu },
      { label: S.edit, items: editMenu },
      { label: S.view, items: viewMenu },
      { label: S.go, items: goMenu },
    ];
  }, [locale, sel, lead, nodes, loc, viewMode, sort, sidebarShown, pref.showPathBar, pref.showStatusBar, showHidden, hist, clipboardCount, undoTop, searching, writableDir, inTrashView, recentFolders.join('\n'), order]);

  /**
   * Handles an arrow key for the current view.
   *
   * List view, ←/→: → expands the collapsed selected folders, while ⌥→ toggles every selected
   * folder together with all of its subfolders; ← collapses the expanded selected folders
   * (recursively with ⌥), or else selects the lead item's parent row when that parent is
   * expanded. Column view, ←/→: → enters the single selected folder and selects its first
   * child; ← moves back to the previous column, selecting the folder that was left.
   * Otherwise the lead moves through the grid (icon view, using the measured column count) or
   * linearly (other views). With `extend` and a visible anchor the selection becomes the range
   * from the anchor to the new item, ordered so the moving end is last and stays the lead.
   *
   * @param {Direction} dir - Arrow direction ('up' | 'down' | 'left' | 'right').
   * @param {boolean} extend - Whether ⇧ is held (extend the selection as a range).
   * @param {boolean} alt - Whether ⌥ is held (recursive expand/collapse in list view).
   * @returns {void} Nothing.
   *
   * @example
   * moveSelection('down', e.shiftKey, e.altKey);
   */
  const moveSelection = (dir: Direction, extend: boolean, alt: boolean) => {
    if (viewMode === 'list' && (dir === 'left' || dir === 'right')) {
      const folders = sel.filter((p) => nodes[p]?.type === 'dir');
      if (dir === 'right') folders.filter((p) => !expanded.has(p) || alt).forEach((p) => toggleExpand(p, alt));
      else if (folders.some((p) => expanded.has(p))) folders.filter((p) => expanded.has(p)).forEach((p) => toggleExpand(p, alt));
      else if (lead && expanded.has(dirname(lead))) setSelection([dirname(lead)]);
      return;
    }
    if (viewMode === 'columns' && (dir === 'left' || dir === 'right')) {
      if (dir === 'right' && lead && leadNode?.type === 'dir' && sel.length === 1) {
        const kids = childrenOf(lead);
        if (kids.length) navigateColumn(lead, [kids[0].path]);
      } else if (dir === 'left' && loc !== colRoot) navigateColumn(dirname(loc), [loc]);
      return;
    }
    const index = lead ? order.indexOf(lead) : -1;
    let next: number;
    if (viewMode === 'icons') next = gridMove(index, order.length, colsRef.current, dir);
    else next = linearMove(index, order.length, dir === 'up' || dir === 'left' ? -1 : 1);
    if (next < 0) return;
    const path = order[next];
    if (extend && anchor && orderSet.has(anchor)) {
      const range = rangeBetween(order, anchor, path);
      setSelectionState(range[0] === path ? range.reverse() : range);
    } else setSelection([path]);
  };

  useWindowKeydown((e) => {
    if (e.defaultPrevented || keyboardBusy(windowId)) return;
    const mod = isMacHost ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape') {
      if (quickLook) {
        e.preventDefault();
        setQuickLook(false);
      } else if (narrow && drawer) {
        e.preventDefault();
        setDrawer(false);
      }
      return;
    }
    if (mod && e.key === 'ArrowDown' && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (sel.length) openItems(sel);
      return;
    }
    if (mod || (!isMacHost && e.metaKey)) return;
    if (e.key === 'Enter' && !e.altKey) {
      if (sel.length === 1 && !onKeyboardFocusedControl(e.target)) {
        e.preventDefault();
        startRename(sel[0]);
      }
      return;
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      cancelRenameTimer();
      moveSelection(e.key.slice(5).toLowerCase() as Direction, e.shiftKey, e.altKey);
      return;
    }
    if (e.key.length === 1 && e.key !== ' ' && !e.altKey && !e.ctrlKey) {
      const now = performance.now();
      const ta = typeAhead.current;
      ta.text = now - ta.at > 1000 ? e.key : ta.text + e.key;
      ta.at = now;
      const match = typeAheadMatch(
        order.map((p) => ({ path: p, name: displayName(nodes[p], locale) })),
        ta.text,
        locale,
      );
      if (match) setSelection([match]);
    }
  });

  const ctl: ViewController = {
    windowId,
    locale,
    active: focused,
    h24,
    selected: selSet,
    renaming: renamingNow,

    /**
     * Updates the selection when the mouse goes down on an item.
     *
     * Ignores presses on nested controls (disclosure triangles, rename fields), which handle
     * their own clicks. Arms the slow-click rename when the item is the only selected one.
     * A right press selects the item unless it is already selected. A left press with ⇧ selects
     * the range from the anchor to the item (added to the selection with ⌘/Ctrl), reversed when
     * needed so the clicked item is last and becomes the lead; ⌘/Ctrl toggles the item and
     * moves the anchor to it; a plain press on an already-selected item keeps the
     * multi-selection until mouse up so it can be dragged as a whole; otherwise only the item
     * is selected.
     *
     * @param {MouseEvent} e - The mousedown event.
     * @param {string} path - Path of the pressed item.
     * @param {string[]} ord - Display order of the items, used for ⇧-click ranges.
     * @returns {void} Nothing.
     *
     * @example
     * onMouseDown={(e) => ctl.itemMouseDown(e, node.path, order)}
     */
    itemMouseDown(e, path, ord) {
      cancelRenameTimer();
      if ((e.target as Element).closest('button, input, textarea')) return;
      renameArmed.current = e.button === 0 && sel.length === 1 && sel[0] === path;
      pendingCollapse.current = null;
      if (e.button === 2) {
        if (!selSet.has(path)) setSelection([path]);
        return;
      }
      if (e.button !== 0) return;
      const mod = isMacHost ? e.metaKey : e.ctrlKey;
      if (e.shiftKey && anchor && ord.includes(anchor)) {
        const range = rangeBetween(ord, anchor, path);
        if (range[0] === path) range.reverse();
        setSelectionState(mod ? [...new Set([...sel.filter((p) => !range.includes(p)), ...range])] : range);
      } else if (mod) {
        setSelectionState(toggleIn(sel, path));
        setAnchor(path);
      } else if (selSet.has(path)) {
        pendingCollapse.current = path;
      } else setSelection([path]);
    },

    /**
     * Finishes a click (mouse up without a drag) on an item.
     *
     * Collapses a multi-selection kept by `itemMouseDown` down to the clicked item. A single,
     * unmodified click on the name of an item that was already the only selection schedules a
     * rename after `RENAME_DELAY` ms (slow double-click); a later mouse down in the content
     * area, an arrow key, an open, a context menu or a drag cancels that timer.
     *
     * @param {MouseEvent} e - The click event.
     * @param {string} path - Path of the clicked item.
     * @param {boolean} onName - Whether the click landed on the item's name label.
     * @returns {void} Nothing.
     *
     * @example
     * onClick={(e) => ctl.itemClick(e, node.path, true)}
     */
    itemClick(e, path, onName) {
      if (pendingCollapse.current === path) {
        pendingCollapse.current = null;
        if (sel.length > 1) setSelection([path]);
      }
      if (onName && renameArmed.current && e.detail === 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        renameTimer.current = setTimeout(() => {
          renameTimer.current = null;
          apiRef.current.startRename(path);
        }, RENAME_DELAY);
      }
      renameArmed.current = false;
    },

    /**
     * Opens an item that was double-clicked.
     *
     * Folders open in this window (as a column in column view), or in a new Finder window with
     * ⌘/Ctrl held; files open in their default app. Cancels any pending slow-click rename.
     *
     * @param {MouseEvent} e - The double-click event (read for the ⌘/Ctrl modifier).
     * @param {FSNode} node - The item to open.
     * @returns {void} Nothing.
     *
     * @example
     * onDoubleClick={(e) => ctl.itemOpen(e, node)}
     */
    itemOpen(e, node) {
      cancelRenameTimer();
      const mod = isMacHost ? e.metaKey : e.ctrlKey;
      if (node.type === 'dir') {
        if (mod) wm.openWindow('finder', { path: node.path });
        else openFolder(node.path);
      } else wm.openPath(node.path);
    },

    /**
     * Shows the item context menu.
     *
     * Right-clicking a selected item acts on the whole selection; right-clicking an unselected
     * item selects just that item and acts on it.
     *
     * @param {MouseEvent} e - The contextmenu event (used for the menu position).
     * @param {string} path - Path of the item under the pointer.
     * @returns {void} Nothing.
     *
     * @example
     * onContextMenu={(e) => ctl.itemContextMenu(e, node.path)}
     */
    itemContextMenu(e, path) {
      cancelRenameTimer();
      const paths = selSet.has(path) ? sel : [path];
      if (!selSet.has(path)) setSelection([path]);
      showContextMenu(e, itemMenu(paths));
    },

    /**
     * Shows the context menu for empty space in a view.
     *
     * Clears the selection when the background belongs to the current location (or a virtual
     * one), then opens `backgroundMenu(dir)` at the pointer.
     *
     * @param {MouseEvent} e - The contextmenu event (used for the menu position).
     * @param {string | null} dir - Folder whose background was clicked, or null for a virtual location.
     * @returns {void} Nothing.
     *
     * @example
     * onContextMenu={(e) => ctl.backgroundContextMenu(e, dir)}
     */
    backgroundContextMenu(e, dir) {
      if (dir === loc || !dir) setSelection([]);
      showContextMenu(e, backgroundMenu(dir));
    },
    setSelection,

    /**
     * Ends inline renaming and applies the new name.
     *
     * Renames through `ops` (undoable, with the kernel's error alerts) and selects the item at
     * its new path when the rename succeeded.
     *
     * @param {string} path - Path of the item being renamed.
     * @param {string} name - The name typed by the user.
     * @returns {void} Nothing.
     *
     * @example
     * ctl.commitRename('/Users/guest/a.txt', 'b.txt');
     */
    commitRename(path, name) {
      setRenaming(null);
      const next = ops.rename(path, name, windowId);
      if (next) setSelection([next]);
    },

    /**
     * Ends inline renaming without changing the name.
     *
     * Clears the renaming path, so the view swaps the rename field back to the plain name
     * label; the selection is left unchanged.
     *
     * @returns {void} Nothing.
     *
     * @example
     * ctl.cancelRename(); // Escape in the rename field
     */
    cancelRename() {
      setRenaming(null);
    },

    /**
     * Starts dragging items from a view.
     *
     * Dragging a selected item drags the whole selection; dragging an unselected item selects
     * and drags just that item. Cancels any pending rename or deferred selection collapse.
     *
     * @param {DragEvent} e - The dragstart event.
     * @param {string} path - Path of the item the drag started on.
     * @param {Element | null} ghost - Element to use as the drag image, if any.
     * @returns {void} Nothing.
     *
     * @example
     * onDragStart={(e) => ctl.dragStart(e, node.path, iconRef.current)}
     */
    dragStart(e, path, ghost) {
      cancelRenameTimer();
      pendingCollapse.current = null;
      const paths = selSet.has(path) ? sel : [path];
      if (!selSet.has(path)) setSelection([path]);
      beginItemDrag(e, paths, ghost);
    },
    dragEnd: endItemDrag,

    /**
     * Opens a folder that a drag has hovered over long enough (spring-loaded folder).
     *
     * In column view a folder under the column root is shown as a column; otherwise the window
     * navigates to it.
     *
     * @param {string} path - Path of the folder to open.
     * @returns {void} Nothing.
     *
     * @example
     * useDropTarget({ dir: node.path, onSpring: () => ctl.springOpen(node.path) });
     */
    springOpen(path) {
      if (viewMode === 'columns' && isWithin(path, colRoot)) navigateColumn(path, []);
      else navigate(path);
    },

    /**
     * Selects items that were just dropped, when they landed in the folder being shown.
     *
     * Delegates to `selectIfHere`, so drops into other folders (a sidebar entry, a path bar
     * crumb or a subfolder) and empty results leave the selection unchanged.
     *
     * @param {string[]} paths - Resulting paths of the dropped items.
     * @param {string} dir - Folder the items were dropped into.
     * @returns {void} Nothing.
     *
     * @example
     * ctl.dropped(['/Users/guest/Documents/a.txt'], '/Users/guest/Documents');
     */
    dropped(paths, dir) {
      selectIfHere(paths, dir);
    },
  };

  /**
   * Receives the number of icon columns currently laid out by the icon view.
   *
   * Stores it in a ref (no re-render) so ↑/↓ can move the selection by whole rows.
   * Memoized with `useCallback` so the icon view gets a stable callback.
   *
   * @param {number} n - Number of columns in the icon grid.
   * @returns {void} Nothing.
   *
   * @example
   * <IconView ctl={ctl} items={items} dir={dropDir} iconSize={64} onColumns={onColumns} />
   */
  const onColumns = useCallback((n: number) => {
    colsRef.current = n;
  }, []);

  const emptyText = searching ? t(S.noResults) : loc === RECENTS ? t(S.noRecents) : undefined;
  const dropDir = searching || virtual ? null : loc;

  let view;
  if (viewMode === 'list') {
    view = (
      <ListView
        ctl={ctl}
        rows={rows}
        dir={dropDir}
        sort={sort}
        onSort={(key) => setSort(nextSort(sort, key))}
        onToggle={toggleExpand}
        showWhere={searching || virtual}
        emptyText={emptyText}
      />
    );
  } else if (viewMode === 'columns') {
    const dirs = chain(colRoot, loc);
    const columns: Column[] = dirs.map((d, i) => {
      const current = i === dirs.length - 1;
      return { dir: d, items: current ? items : childrenOf(d), highlighted: current ? selSet : new Set([dirs[i + 1]]), current };
    });
    if (lead && sel.length === 1 && leadNode?.type === 'dir') columns.push({ dir: lead, items: childrenOf(lead), highlighted: EMPTY_SET, current: false });
    view = (
      <ColumnView
        ctl={ctl}
        columns={columns}
        preview={sel.length === 1 && leadNode?.type === 'file' ? leadNode : null}
        onPick={(e: MouseEvent, dir: string, path: string, ord: string[]) => {
          if (dir === loc) ctl.itemMouseDown(e, path, ord);
          else if (e.button === 0 || e.button === 2) navigateColumn(dir, [path]);
        }}
        onPickBackground={(dir: string) => (dir === loc ? setSelection([]) : navigateColumn(dir, []))}
      />
    );
  } else if (viewMode === 'gallery') {
    view = <GalleryView ctl={ctl} items={items} dir={dropDir} emptyText={emptyText} />;
  } else {
    view = <IconView ctl={ctl} items={items} dir={dropDir} iconSize={pref.iconSize} emptyText={emptyText} onColumns={onColumns} />;
  }

  const pathTarget = sel.length === 1 ? sel[0] : searching ? searchRoot : loc;

  return (
    <div
      ref={rootRef}
      className={s.root}
      onDragOver={guardHostDrop}
      onDrop={(e: DragEvent) => {
        if (hasHostFiles(e)) e.preventDefault();
      }}
    >
      {!narrow && pref.showSidebar && <Sidebar location={loc} width={pref.sidebarWidth} windowId={windowId} onNavigate={(p) => navigate(p)} onDropped={ctl.dropped} />}
      <div className={s.main}>
        <FinderToolbar
          title={title}
          inset={narrow || !pref.showSidebar}
          sidebarToggle={narrow ? { open: drawer, onToggle: () => setDrawer((v) => !v) } : undefined}
          canBack={hist.index > 0}
          canForward={hist.index < hist.stack.length - 1}
          onBack={() => goHistory(-1)}
          onForward={() => goHistory(1)}
          view={viewMode}
          onView={setView}
          onSortMenu={(r) => showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {} }, sortSubmenu())}
          onActionMenu={(r) => showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {} }, sel.length ? itemMenu(sel) : backgroundMenu(dropDir))}
          query={query}
          onQuery={(q) => {
            setQuery(q);
            setSelection([]);
            setRenaming(null);
          }}
          onSearchDown={() => order.length && setSelection([order[0]])}
          searchRef={searchRef}
        />
        {searching ? (
          <ScopeBar scope={scope} folderName={locationName(realDir ?? HOME, locale)} onScope={setScope} />
        ) : inTrashView ? (
          <TrashBanner empty={!trashCount} onEmpty={() => void emptyTrashWithConfirm(windowId)} />
        ) : null}
        <div className={s.content} onMouseDownCapture={cancelRenameTimer}>
          {view}
        </div>
        {pref.showPathBar && <PathBar target={pathTarget} windowId={windowId} onNavigate={(p) => navigate(p)} onDropped={ctl.dropped} />}
        {pref.showStatusBar && (
          <StatusBar
            count={items.length}
            selected={sel.length}
            showAvailable={!virtual || searching}
            iconSize={viewMode === 'icons' ? pref.iconSize : null}
            onIconSize={(v) => prefs.set({ iconSize: v })}
          />
        )}
      </div>
      {narrow && drawer && (
        <>
          <div className={s.drawerScrim} onClick={() => setDrawer(false)} />
          <Sidebar
            drawer
            location={loc}
            width={pref.sidebarWidth}
            windowId={windowId}
            onNavigate={(p) => {
              setDrawer(false);
              navigate(p);
            }}
            onDropped={ctl.dropped}
          />
        </>
      )}
      {quickLook &&
        leadNode &&
        focused &&
        createPortal(
          <div className={s.quickLook} style={{ zIndex: Z.WINDOWS + 1 }}>
            <QuickLook
              node={leadNode}
              position={sel.length > 1 ? { index: sel.indexOf(leadNode.path), total: sel.length } : undefined}
              origin={windowCenter(windowId)}
              onClose={() => setQuickLook(false)}
              onOpen={(n) => openItems([n.path])}
            />
          </div>,
          shellLayerRoot(),
        )}
    </div>
  );
}

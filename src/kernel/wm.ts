/**
 * Process & window manager.
 *
 * macOS semantics:
 *  - One process per app. An app can have 0…n windows. Closing the last window does NOT quit
 *    the app (it stays in the Dock with a running dot and stays "active" in the menu bar).
 *  - Finder is always running (persistent) and becomes active when you click the desktop.
 *  - `launch(appId)` = clicking the Dock icon: focuses/unhides an existing window if there is
 *    one, otherwise opens a new window.
 *  - `openWindow(appId, args)` = always a new window (unless the app is singleWindow).
 */
import { create } from 'zustand';
import type { AppArgs, Bounds, Process, WindowOptions, WindowState } from './types';
import { getApp, defaultAppFor } from './registry';
import { COMPACT_BREAKPOINT, COMPACT_HEIGHT_BREAKPOINT, DOCK_MARGIN, DOCK_PADDING, MENU_BAR_HEIGHT } from './constants';
import { useSystem } from './system';
import { fs } from './fs';
import { extname } from './path';
import { t } from './i18n';

/* ───────────────────────── Workspace geometry ───────────────────────── */

/**
 * Returns the area windows may occupy.
 *
 * The workspace is the screen minus the menu bar and, unless the Dock auto-hides, the Dock's
 * thickness (icon size plus its padding and margin on both sides) on whichever edge it sits.
 * Outside a browser (no `window`) a 1440×900 screen is assumed.
 *
 * @returns {Bounds} The workspace rectangle in screen px.
 *
 * @example
 * const ws = getWorkspace();
 * wm.update(id, { ...ws, maximized: true });
 */
export function getWorkspace(): Bounds {
  const W = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const H = typeof window !== 'undefined' ? window.innerHeight : 900;
  const s = useSystem.getState().settings;
  const dock = s.dockAutohide ? 0 : s.dockSize + DOCK_PADDING * 2 + DOCK_MARGIN * 2;
  const top = MENU_BAR_HEIGHT;
  if (s.dockPosition === 'left') return { x: dock, y: top, width: W - dock, height: H - top };
  if (s.dockPosition === 'right') return { x: 0, y: top, width: W - dock, height: H - top };
  return { x: 0, y: top, width: W, height: H - top - dock };
}

/**
 * Reports whether the screen is phone-sized.
 *
 * True when the viewport is narrower than `COMPACT_BREAKPOINT` or shorter than
 * `COMPACT_HEIGHT_BREAKPOINT` (a phone in landscape). On compact screens every window fills the
 * workspace. Always false outside a browser.
 *
 * @returns {boolean} True on compact screens.
 *
 * @example
 * if (isCompact()) console.log('windows open full-screen');
 */
export function isCompact(): boolean {
  return typeof window !== 'undefined' && (window.innerWidth < COMPACT_BREAKPOINT || window.innerHeight < COMPACT_HEIGHT_BREAKPOINT);
}

const FIT_MARGIN = 20; /** Gap in px kept around floating windows that are placed or sized automatically. */

/**
 * Decides whether a window must fill the workspace instead of floating.
 *
 * Everything fills the workspace on compact screens. Elsewhere only a fixed-size (non-resizable)
 * window that does not fit inside the workspace minus `FIT_MARGIN` fills it, because it would
 * otherwise be clipped with no way to resize it.
 *
 * @param {boolean} resizable - Whether the window can be resized.
 * @param {number} width - Natural width of the window.
 * @param {number} height - Natural height of the window.
 * @param {Bounds} ws - The current workspace.
 * @param {boolean} compact - Whether the screen is compact.
 * @returns {boolean} True when the window has to be maximized.
 *
 * @example
 * const fill = mustFill(false, 900, 700, getWorkspace(), isCompact());
 */
function mustFill(resizable: boolean, width: number, height: number, ws: Bounds, compact: boolean): boolean {
  return compact || (!resizable && (width > ws.width - FIT_MARGIN || height > ws.height - FIT_MARGIN));
}

/**
 * Shrinks bounds to fit the workspace, moving them only as far as needed.
 *
 * Width and height are clamped to the workspace (minimum 1px). An axis that had to shrink is
 * moved fully inside the workspace. An axis that already fits may stay partly off screen, but
 * at least 80px stay visible horizontally, the top never goes above the workspace (so the title
 * bar stays below the menu bar) and the top edge stays at least 40px above the workspace's
 * bottom edge.
 *
 * @param {Bounds} b - The bounds to fit.
 * @param {Bounds} ws - The workspace to fit them into.
 * @returns {Bounds} The adjusted bounds.
 *
 * @example
 * const r = fitBounds({ x: 1300, y: 40, width: 600, height: 400 }, getWorkspace());
 */
function fitBounds(b: Bounds, ws: Bounds): Bounds {
  const width = Math.max(1, Math.min(b.width, ws.width));
  const height = Math.max(1, Math.min(b.height, ws.height));
  const x = width < b.width ? Math.max(ws.x, Math.min(b.x, ws.x + ws.width - width)) : Math.min(Math.max(b.x, ws.x - width + 80), ws.x + ws.width - 80);
  const y = height < b.height ? Math.max(ws.y, Math.min(b.y, ws.y + ws.height - height)) : Math.min(Math.max(b.y, ws.y), ws.y + ws.height - 40);
  return { x, y, width, height };
}

/**
 * Compares two rectangles.
 *
 * Checks x, y, width and height for strict equality; any other fields on the objects are
 * ignored.
 *
 * @param {Bounds} a - First rectangle.
 * @param {Bounds} b - Second rectangle.
 * @returns {boolean} True when position and size are identical.
 *
 * @example
 * sameBounds({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }); // true
 */
const sameBounds = (a: Bounds, b: Bounds) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/* ───────────────────────── Store ───────────────────────── */

/** State held by the window manager store. */
interface WMState {
  processes: Process[];
  windows: WindowState[];
  /** Id of the window with keyboard focus (top-most visible window of the active app). */
  focusedId: string | null;
  /** App shown in the menu bar. */
  activeAppId: string;
  /** Highest z-index handed out so far; focusing a window gives it the next value. */
  zCounter: number;
}

export const useWM = create<WMState>()(() => ({
  processes: [],
  windows: [],
  focusedId: null,
  activeAppId: 'finder',
  zCounter: 10,
})); /** Store of running processes, open windows, the focused window and the active app. */

/**
 * Reads the current window manager state.
 *
 * Shorthand for `useWM.getState()`, used by the helpers and `wm` methods outside React. The
 * returned object is not reactive; call it again after a state change to see new values.
 *
 * @returns {WMState} A snapshot of the store.
 *
 * @example
 * const focused = st().focusedId;
 */
const st = () => useWM.getState();

// Windows still titled with their app's name follow UI language changes (menu bar, Window menu,
// Mission Control, Dock menus and the title bar all read `title`).
useSystem.subscribe((next, prev) => {
  if (next.settings.locale === prev.settings.locale) return;
  const windows = st().windows;
  if (!windows.some((w) => w.defaultTitle)) return;
  useWM.setState({
    windows: windows.map((w) => {
      const app = w.defaultTitle ? getApp(w.appId) : undefined;
      if (!app) return w;
      const title = t(app.name);
      return title === w.title ? w : { ...w, title };
    }),
  });
});

let pidCounter = 300 + Math.floor(Math.random() * 200); /** Next process id; starts at a random value in 300–499 so pids look like real ones. */
let winCounter = 0; /** Sequence number used to build unique window ids (`w<n>-<appId>`). */

/* ───────────────────────── before-close hooks ───────────────────────── */

/** Handler that may veto closing a window: return (or resolve) false to keep it open. */
type BeforeClose = () => boolean | Promise<boolean>;
const beforeCloseHandlers = new Map<string, BeforeClose>(); /** Before-close handlers keyed by window id. */

/**
 * Registers or removes a window's before-close handler.
 *
 * `wm.close` and `wm.quit` call the handler before closing the window (unless forced) and keep
 * the window open when it returns or resolves false. Apps use it through `useBeforeClose`.
 *
 * @param {string} windowId - Window the handler belongs to.
 * @param {BeforeClose | null} fn - The handler, or null to remove the current one.
 * @returns {void}
 *
 * @example
 * setBeforeClose(windowId, async () => dialogs.confirm({ title: 'Discard changes?', windowId }));
 */
export function setBeforeClose(windowId: string, fn: BeforeClose | null): void {
  if (fn) beforeCloseHandlers.set(windowId, fn);
  else beforeCloseHandlers.delete(windowId);
}

/* ───────────────────────── Internal helpers ───────────────────────── */

/**
 * Finds the front-most visible window.
 *
 * Skips minimized windows and windows of hidden apps, then returns the one with the highest
 * z-index, optionally limited to a single app.
 *
 * @param {WindowState[]} windows - Windows to search.
 * @param {Process[]} processes - Processes, used to tell which apps are hidden.
 * @param {string} [appId] - Only consider windows of this app.
 * @returns {WindowState | undefined} The top visible window, or undefined if there is none.
 *
 * @example
 * const top = topVisibleWindow(st().windows, st().processes, 'finder');
 */
function topVisibleWindow(windows: WindowState[], processes: Process[], appId?: string): WindowState | undefined {
  const hiddenApps = new Set(processes.filter((p) => p.hidden).map((p) => p.appId));
  return windows
    .filter((w) => !w.minimized && !hiddenApps.has(w.appId) && (!appId || w.appId === appId))
    .sort((a, b) => b.z - a.z)[0];
}

/**
 * Returns the app's process, starting one if it is not running.
 *
 * A new process gets the next pid; the pid counter then skips a random 0–6 extra numbers so
 * consecutive launches don't get consecutive pids.
 *
 * @param {string} appId - App whose process is needed.
 * @returns {Process} The existing or newly started process.
 *
 * @example
 * const proc = ensureProcess('finder');
 */
function ensureProcess(appId: string): Process {
  const existing = st().processes.find((p) => p.appId === appId);
  if (existing) return existing;
  const proc: Process = { pid: pidCounter++, appId, startedAt: Date.now(), hidden: false };
  pidCounter += Math.floor(Math.random() * 7);
  useWM.setState((s) => ({ processes: [...s.processes, proc] }));
  return proc;
}

/**
 * Chooses the position and size of a new window.
 *
 * The size is clamped to the workspace minus `FIT_MARGIN`. When the app has no other
 * non-minimized window, the new one is centered horizontally and placed slightly above the
 * vertical center; otherwise it cascades 26px down and right from the app's most recently
 * created non-minimized window, wrapping back to the top-left of the workspace when the
 * cascade would leave it, like macOS.
 *
 * @param {string} appId - App the window belongs to.
 * @param {number} width - Requested width.
 * @param {number} height - Requested height.
 * @returns {Bounds} The bounds for the new window.
 *
 * @example
 * const { x, y, width, height } = placeWindow('textedit', 640, 480);
 */
function placeWindow(appId: string, width: number, height: number): Bounds {
  const ws = getWorkspace();
  const w = Math.max(1, Math.min(width, ws.width - FIT_MARGIN));
  const h = Math.max(1, Math.min(height, ws.height - FIT_MARGIN));
  const siblings = st().windows.filter((x) => x.appId === appId && !x.minimized);
  let x = ws.x + Math.round((ws.width - w) / 2);
  let y = ws.y + Math.max(8, Math.round((ws.height - h) / 2.6));
  if (siblings.length) {
    const last = siblings.sort((a, b) => b.createdAt - a.createdAt)[0];
    x = last.x + 26;
    y = last.y + 26;
    if (x + w > ws.x + ws.width || y + h > ws.y + ws.height) {
      x = ws.x + 40;
      y = ws.y + 20;
    }
  }
  return { x, y, width: w, height: h };
}

/* ───────────────────────── Public API ───────────────────────── */

export const wm = {
  /**
   * Launches an app with Dock-click semantics.
   *
   * Pseudo apps run their `onLaunch` instead. Non-empty `args` always go to `openWindow` (a new
   * window, or the existing one of a singleWindow app). Otherwise a running app is unhidden and
   * its front visible window focused; if it only has minimized windows the top one is restored;
   * if it has no windows (or is not running) a new window is opened.
   *
   * @param {string} appId - App to launch.
   * @param {AppArgs} [args] - Arguments for the window, e.g. `{ path }`.
   * @returns {string | null} Id of the focused/opened window, or null for unknown or pseudo apps.
   *
   * @example
   * wm.launch('safari');
   * wm.launch('textedit', { path: '/Users/aodjo/Desktop/Notes.txt' });
   */
  launch(appId: string, args?: AppArgs): string | null {
    const app = getApp(appId);
    if (!app) return null;
    if (app.onLaunch) {
      app.onLaunch();
      return null;
    }
    if (args && Object.keys(args).length) return wm.openWindow(appId, args);
    const proc = st().processes.find((p) => p.appId === appId);
    if (proc) {
      if (proc.hidden) wm.unhideApp(appId);
      const visible = topVisibleWindow(st().windows, st().processes, appId);
      if (visible) {
        wm.focus(visible.id);
        return visible.id;
      }
      const minimized = st()
        .windows.filter((w) => w.appId === appId && w.minimized)
        .sort((a, b) => b.z - a.z)[0];
      if (minimized) {
        wm.restore(minimized.id);
        return minimized.id;
      }
    }
    return wm.openWindow(appId);
  },

  /**
   * Opens a new window for an app, starting its process if necessary.
   *
   * Pseudo apps run their `onLaunch` instead. A hidden app is unhidden. A singleWindow app that
   * already has a window gets the new `args` (when non-empty) and that window is restored or
   * focused instead. Otherwise the window uses the app's `window` options (720×480 by default)
   * merged with `overrides`, is placed by `placeWindow`, and becomes the focused window of the
   * active app. Its title is the localized app name (marked `defaultTitle` so it follows language
   * changes) unless `overrides.title` is given. Minimum sizes default to 280×160, capped to the
   * workspace, and `maximizable` defaults to `resizable`.
   *
   * On compact screens, and for fixed-size windows larger than the workspace, the window opens
   * filling the workspace with `autoMaximized` set; its natural size is kept in `restoreBounds`
   * so `relayout` can float it again once the screen is big enough.
   *
   * @param {string} appId - App to open a window for.
   * @param {AppArgs} [args={}] - Arguments passed to the window component.
   * @param {Partial<Bounds> & Partial<WindowOptions> & { title?: string }} [overrides={}] - Position,
   *   size, window options and title for this window only (e.g. Finder's small, fixed-size,
   *   standard-titlebar Get Info window).
   * @returns {string | null} Id of the new (or reused) window, or null for unknown or pseudo apps.
   *
   * @example
   * const id = wm.openWindow('finder', { path: '/Users/aodjo/Documents' });
   * wm.openWindow('finder', { view: 'info', path }, { width: 290, height: 520, resizable: false });
   */
  openWindow(appId: string, args: AppArgs = {}, overrides: Partial<Bounds> & Partial<WindowOptions> & { title?: string } = {}): string | null {
    const app = getApp(appId);
    if (!app) return null;
    if (app.onLaunch) {
      app.onLaunch();
      return null;
    }
    const proc = ensureProcess(appId);
    if (proc.hidden) wm.unhideApp(appId);

    if (app.singleWindow) {
      const existing = st().windows.find((w) => w.appId === appId);
      if (existing) {
        if (Object.keys(args).length) wm.setArgs(existing.id, args);
        if (existing.minimized) wm.restore(existing.id);
        else wm.focus(existing.id);
        return existing.id;
      }
    }

    const opts: WindowOptions = { ...(app.window ?? { width: 720, height: 480 }), ...overrides };
    const placed = placeWindow(appId, opts.width, opts.height);
    const ws = getWorkspace();
    const resizable = opts.resizable ?? true;
    const fill = mustFill(resizable, opts.width, opts.height, ws, isCompact());
    const z = st().zCounter + 1;
    const id = `w${++winCounter}-${appId}`;
    const win: WindowState = {
      id,
      pid: proc.pid,
      appId,
      title: overrides.title ?? t(app.name),
      defaultTitle: overrides.title === undefined,
      x: overrides.x ?? placed.x,
      y: overrides.y ?? placed.y,
      width: placed.width,
      height: placed.height,
      minWidth: Math.min(opts.minWidth ?? 280, ws.width),
      minHeight: Math.min(opts.minHeight ?? 160, ws.height),
      resizable,
      maximizable: opts.maximizable ?? opts.resizable ?? true,
      titlebar: opts.titlebar ?? 'standard',
      vibrancy: opts.vibrancy ?? false,
      minimized: false,
      maximized: fill,
      autoMaximized: fill,
      tiled: null,
      restoreBounds: fill ? { x: overrides.x ?? placed.x, y: overrides.y ?? placed.y, width: opts.width, height: opts.height } : null,
      z,
      args,
      dirty: false,
      createdAt: Date.now(),
      argsVersion: 0,
    };
    if (fill) Object.assign(win, ws);
    useWM.setState((s) => ({ windows: [...s.windows, win], zCounter: z, focusedId: id, activeAppId: appId }));
    return id;
  },

  /**
   * Opens a file or folder with its default app, or with a specific app.
   *
   * An `.app` file (opened without an explicit app) launches the app whose id is stored in its
   * content. Otherwise the handler is `appId`, else the file's "Open with" choice (if that app is
   * registered), else the default app for the name/type. Like macOS, opening a document that is
   * already open in the handler brings its window forward instead of opening another one;
   * windows opened with a `view` argument (e.g. Get Info) are not reused.
   *
   * @param {string} path - Path of the file or folder.
   * @param {string} [appId] - App to open it with instead of the default.
   * @returns {string | null} Id of the window showing the item, or null when the path does not
   *   exist, no app can open it, or the launched app opens no window.
   *
   * @example
   * wm.openPath('/Users/aodjo/Desktop/Notes.txt');
   * wm.openPath('/Users/aodjo/Pictures/cat.png', 'preview');
   */
  openPath(path: string, appId?: string): string | null {
    const node = fs.stat(path);
    if (!node) return null;
    if (node.type === 'file' && extname(node.name) === 'app' && !appId) {
      const target = (node.content ?? '').trim();
      return wm.launch(target);
    }
    const preferred = node.meta?.openWith && getApp(node.meta.openWith) ? node.meta.openWith : undefined;
    const handler = appId ?? preferred ?? defaultAppFor(node.name, node.type === 'dir');
    if (!handler) return null;
    const existing = st().windows.find((w) => w.appId === handler && w.args.path === node.path && !w.args.view);
    if (existing) {
      wm.focus(existing.id);
      return existing.id;
    }
    return wm.openWindow(handler, { path: node.path });
  },

  /**
   * Brings a window to the front and gives it keyboard focus.
   *
   * Unhides the window's app if needed, raises the window to a new top z-index, un-minimizes it
   * and makes its app active. When the window is already focused, on top and visible, only the
   * active app is corrected. Unknown ids are ignored.
   *
   * @param {string} id - Window to focus.
   * @returns {void}
   *
   * @example
   * wm.focus(windowId);
   */
  focus(id: string): void {
    const w = st().windows.find((x) => x.id === id);
    if (!w) return;
    const proc = st().processes.find((p) => p.appId === w.appId);
    if (proc?.hidden) wm.unhideApp(w.appId);
    if (st().focusedId === id && w.z === st().zCounter && !w.minimized) {
      if (st().activeAppId !== w.appId) useWM.setState({ activeAppId: w.appId });
      return;
    }
    const z = st().zCounter + 1;
    useWM.setState((s) => ({
      zCounter: z,
      focusedId: id,
      activeAppId: w.appId,
      windows: s.windows.map((x) => (x.id === id ? { ...x, z, minimized: false } : x)),
    }));
  },

  /**
   * Makes an app active.
   *
   * Focuses the app's front visible window; when it has none, the app becomes active in the
   * menu bar with no focused window (e.g. clicking the desktop activates Finder).
   *
   * @param {string} appId - App to activate.
   * @returns {void}
   *
   * @example
   * wm.activateApp('finder');
   */
  activateApp(appId: string): void {
    const top = topVisibleWindow(st().windows, st().processes, appId);
    if (top) wm.focus(top.id);
    else useWM.setState({ activeAppId: appId, focusedId: null });
  },

  /**
   * Gives keyboard focus to the desktop.
   *
   * Used when the wallpaper or a desktop icon is clicked: Finder becomes the active app and no
   * window is focused, even if Finder has open windows. The store is only updated when something
   * changes.
   *
   * @returns {void}
   *
   * @example
   * wm.focusDesktop();
   */
  focusDesktop(): void {
    const s = st();
    if (s.activeAppId !== 'finder' || s.focusedId !== null) useWM.setState({ activeAppId: 'finder', focusedId: null });
  },

  /**
   * Closes a window.
   *
   * Unless `opts.force` is set, the window's before-close handler (if any) is asked first: the
   * window is focused so its prompt is visible, and a false result cancels the close. Closing
   * removes the handler and the window. If it was the focused window, focus moves to the app's
   * next visible window, or to none while the app stays active (apps keep running with zero
   * windows).
   *
   * @async
   * @param {string} id - Window to close.
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.force] - Skip the before-close handler.
   * @returns {Promise<boolean>} Resolves true if the window is gone (or never existed), false if
   *   the handler cancelled.
   *
   * @example
   * const closed = await wm.close(windowId);
   * await wm.close(windowId, { force: true });
   */
  async close(id: string, opts: { force?: boolean } = {}): Promise<boolean> {
    const w = st().windows.find((x) => x.id === id);
    if (!w) return true;
    if (!opts.force) {
      const handler = beforeCloseHandlers.get(id);
      if (handler) {
        wm.focus(id);
        const ok = await handler();
        if (!ok) return false;
      }
    }
    beforeCloseHandlers.delete(id);
    useWM.setState((s) => {
      const windows = s.windows.filter((x) => x.id !== id);
      let focusedId = s.focusedId;
      let activeAppId = s.activeAppId;
      if (s.focusedId === id) {
        const sameApp = topVisibleWindow(windows, s.processes, w.appId);
        focusedId = sameApp?.id ?? null;
        activeAppId = w.appId;
      }
      return { windows, focusedId, activeAppId };
    });
    return true;
  },

  /**
   * Minimizes a window to the Dock.
   *
   * If it was the focused window, focus moves to the front-most visible window of any app and
   * that app becomes active; with no visible window left, nothing is focused and the active app
   * stays the same.
   *
   * @param {string} id - Window to minimize.
   * @returns {void}
   *
   * @example
   * wm.minimize(windowId);
   */
  minimize(id: string): void {
    useWM.setState((s) => {
      const windows = s.windows.map((x) => (x.id === id ? { ...x, minimized: true } : x));
      const next = s.focusedId === id ? topVisibleWindow(windows, s.processes) : undefined;
      return {
        windows,
        focusedId: s.focusedId === id ? next?.id ?? null : s.focusedId,
        activeAppId: s.focusedId === id && next ? next.appId : s.activeAppId,
      };
    });
  },

  /**
   * Restores a minimized window.
   *
   * Equivalent to `focus`, which un-minimizes and raises the window.
   *
   * @param {string} id - Window to restore.
   * @returns {void}
   *
   * @example
   * wm.restore(windowId);
   */
  restore(id: string): void {
    wm.focus(id);
  },

  /**
   * Toggles filling the workspace (the green zoom button).
   *
   * A maximized or tiled window goes back to its `restoreBounds` fitted to the current workspace
   * (or is re-placed at its current size when none were saved); any other window fills the
   * workspace and remembers its current bounds. The window is focused afterwards. Windows that
   * are not maximizable are ignored. Going through `update`, this also clears `autoMaximized`.
   *
   * @param {string} id - Window to zoom or unzoom.
   * @returns {void}
   *
   * @example
   * wm.toggleMaximize(windowId);
   */
  toggleMaximize(id: string): void {
    const w = st().windows.find((x) => x.id === id);
    if (!w || !w.maximizable) return;
    if (w.maximized || w.tiled) {
      const r = w.restoreBounds ? fitBounds(w.restoreBounds, getWorkspace()) : placeWindow(w.appId, w.width, w.height);
      wm.update(id, { ...r, maximized: false, tiled: null, restoreBounds: null });
    } else {
      wm.update(id, { ...getWorkspace(), maximized: true, tiled: null, restoreBounds: { x: w.x, y: w.y, width: w.width, height: w.height } });
    }
    wm.focus(id);
  },

  /**
   * Tiles a window to the left or right half of the workspace (window snapping).
   *
   * The right half takes the remaining width when the workspace width is odd. Bounds saved by an
   * earlier maximize/tile are kept as `restoreBounds`; otherwise the current bounds are saved.
   * The window is focused afterwards. Non-resizable windows are ignored.
   *
   * @param {string} id - Window to tile.
   * @param {'left' | 'right'} side - Half of the workspace to occupy.
   * @returns {void}
   *
   * @example
   * wm.tile(windowId, 'left');
   */
  tile(id: string, side: 'left' | 'right'): void {
    const w = st().windows.find((x) => x.id === id);
    if (!w || !w.resizable) return;
    const ws = getWorkspace();
    const half = Math.round(ws.width / 2);
    const bounds = side === 'left' ? { x: ws.x, y: ws.y, width: half, height: ws.height } : { x: ws.x + half, y: ws.y, width: ws.width - half, height: ws.height };
    wm.update(id, {
      ...bounds,
      tiled: side,
      maximized: false,
      restoreBounds: w.restoreBounds ?? { x: w.x, y: w.y, width: w.width, height: w.height },
    });
    wm.focus(id);
  },

  /**
   * Merges a patch into a window's state (low-level; used by drag & resize).
   *
   * A patch that sets `maximized` or `tiled` without mentioning `autoMaximized` is treated as a
   * user layout decision and clears `autoMaximized`, so `relayout` leaves the layout to the
   * user instead of floating the window again on its own.
   *
   * @param {string} id - Window to update.
   * @param {Partial<WindowState>} patch - Fields to change.
   * @returns {void}
   *
   * @example
   * wm.update(windowId, { x: 120, y: 80 });
   */
  update(id: string, patch: Partial<WindowState>): void {
    const userLayout = ('maximized' in patch || 'tiled' in patch) && !('autoMaximized' in patch) ? { autoMaximized: false } : null;
    useWM.setState((s) => ({ windows: s.windows.map((x) => (x.id === id ? { ...x, ...patch, ...userLayout } : x)) }));
  },

  /**
   * Sets a custom window title.
   *
   * Clears `defaultTitle`, so the title stays as given when the UI language changes. Nothing is
   * written when the title is unchanged and already custom.
   *
   * @param {string} id - Window to rename.
   * @param {string} title - New title.
   * @returns {void}
   *
   * @example
   * wm.setTitle(windowId, 'Notes.txt');
   */
  setTitle(id: string, title: string): void {
    const w = st().windows.find((x) => x.id === id);
    if (w && (w.title !== title || w.defaultTitle)) wm.update(id, { title, defaultTitle: false });
  },

  /**
   * Marks a window as having unsaved changes or not.
   *
   * A dirty window shows a dot in its close button. The store is only updated when the flag
   * actually changes.
   *
   * @param {string} id - Window to mark.
   * @param {boolean} dirty - Whether the window has unsaved changes.
   * @returns {void}
   *
   * @example
   * wm.setDirty(windowId, true);
   */
  setDirty(id: string, dirty: boolean): void {
    const w = st().windows.find((x) => x.id === id);
    if (w && w.dirty !== dirty) wm.update(id, { dirty });
  },

  /**
   * Replaces a window's args (e.g. a singleWindow app asked to open another file).
   *
   * Increments `argsVersion` so the app can react through `useArgsChange`.
   *
   * @param {string} id - Window whose args are replaced.
   * @param {AppArgs} args - The new args.
   * @returns {void}
   *
   * @example
   * wm.setArgs(windowId, { path: '/Users/aodjo/Documents/Readme.md' });
   */
  setArgs(id: string, args: AppArgs): void {
    useWM.setState((s) => ({ windows: s.windows.map((x) => (x.id === id ? { ...x, args, argsVersion: x.argsVersion + 1 } : x)) }));
  },

  /**
   * Hides an app (the app menu's Hide command).
   *
   * Its windows disappear from screen without being minimized. Focus moves to the front-most
   * visible window of the remaining apps, whose app becomes active; Finder becomes active when
   * no window is visible.
   *
   * @param {string} appId - App to hide.
   * @returns {void}
   *
   * @example
   * wm.hideApp('safari');
   */
  hideApp(appId: string): void {
    useWM.setState((s) => {
      const processes = s.processes.map((p) => (p.appId === appId ? { ...p, hidden: true } : p));
      const next = topVisibleWindow(s.windows, processes);
      return { processes, focusedId: next?.id ?? null, activeAppId: next?.appId ?? 'finder' };
    });
  },

  /**
   * Shows a hidden app's windows again.
   *
   * Only clears the hidden flag; focus and the active app are unchanged.
   *
   * @param {string} appId - App to unhide.
   * @returns {void}
   *
   * @example
   * wm.unhideApp('safari');
   */
  unhideApp(appId: string): void {
    useWM.setState((s) => ({ processes: s.processes.map((p) => (p.appId === appId ? { ...p, hidden: false } : p)) }));
  },

  /**
   * Hides every app except one (the app menu's Hide Others command).
   *
   * The given app is unhidden if it was hidden; focus is unchanged.
   *
   * @param {string} appId - App that stays visible.
   * @returns {void}
   *
   * @example
   * wm.hideOthers('textedit');
   */
  hideOthers(appId: string): void {
    useWM.setState((s) => ({ processes: s.processes.map((p) => ({ ...p, hidden: p.appId !== appId })) }));
  },

  /**
   * Unhides every app (the app menu's Show All command).
   *
   * Clears the hidden flag on every process so all their windows are shown again. Focus and the
   * active app are unchanged.
   *
   * @returns {void}
   *
   * @example
   * wm.showAll();
   */
  showAll(): void {
    useWM.setState((s) => ({ processes: s.processes.map((p) => ({ ...p, hidden: false })) }));
  },

  /**
   * Quits an app.
   *
   * Closes its windows one by one (asking before-close handlers unless `opts.force`) and stops
   * at the first cancelled close, leaving the app running. Persistent apps (Finder) only close
   * their windows. Otherwise the process ends; if the app was active, the front-most visible
   * window of another app is focused and its app (or Finder) becomes active.
   *
   * @async
   * @param {string} appId - App to quit.
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.force] - Skip before-close handlers.
   * @returns {Promise<boolean>} Resolves false if a close was cancelled, true otherwise.
   *
   * @example
   * const quit = await wm.quit('textedit');
   */
  async quit(appId: string, opts: { force?: boolean } = {}): Promise<boolean> {
    const app = getApp(appId);
    const wins = st().windows.filter((w) => w.appId === appId);
    for (const w of wins) {
      const ok = await wm.close(w.id, opts);
      if (!ok) return false;
    }
    if (app?.persistent) return true;
    useWM.setState((s) => {
      const processes = s.processes.filter((p) => p.appId !== appId);
      const next = topVisibleWindow(s.windows, processes);
      const wasActive = s.activeAppId === appId;
      return {
        processes,
        activeAppId: wasActive ? next?.appId ?? 'finder' : s.activeAppId,
        focusedId: wasActive ? next?.id ?? null : s.focusedId,
      };
    });
    return true;
  },

  /**
   * Quits the app that owns a process id (Activity Monitor).
   *
   * Looks up the process by pid and delegates to `wm.quit` for its app with the same options, so
   * before-close handlers run unless `opts.force` is set.
   *
   * @async
   * @param {number} pid - Process id to end.
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.force] - Skip before-close handlers.
   * @returns {Promise<boolean>} Resolves false if no process has that pid or a close was
   *   cancelled, true otherwise.
   *
   * @example
   * await wm.kill(412, { force: true });
   */
  async kill(pid: number, opts: { force?: boolean } = {}): Promise<boolean> {
    const p = st().processes.find((x) => x.pid === pid);
    if (!p) return false;
    return wm.quit(p.appId, opts);
  },

  /**
   * Force-quits everything (log out / restart / shut down).
   *
   * Drops all before-close handlers, processes (including Finder's) and windows without asking,
   * and resets the active app to Finder. `startSession` starts Finder again.
   *
   * @returns {void}
   *
   * @example
   * wm.killAll();
   */
  killAll(): void {
    beforeCloseHandlers.clear();
    useWM.setState({ processes: [], windows: [], focusedId: null, activeAppId: 'finder' });
  },

  /**
   * Starts the persistent processes after login.
   *
   * Ensures Finder is running and makes it the active app.
   *
   * @returns {void}
   *
   * @example
   * wm.startSession();
   */
  startSession(): void {
    ensureProcess('finder');
    useWM.setState({ activeAppId: 'finder' });
  },

  /**
   * Cycles focus between the active app's windows (Cycle Through Windows, ⌘`).
   *
   * Focuses the bottom-most non-minimized window of the active app; repeating this brings each
   * window to the front in turn.
   *
   * @returns {void}
   *
   * @example
   * wm.cycleAppWindows();
   */
  cycleAppWindows(): void {
    const { activeAppId, windows } = st();
    const list = windows.filter((w) => w.appId === activeAppId && !w.minimized).sort((a, b) => a.z - b.z);
    if (list.length) wm.focus(list[0].id);
  },

  /**
   * Re-fits every window after the viewport or Dock changes (like macOS on a display change).
   *
   * - Maximized windows follow the workspace; a window that was only filled automatically floats
   *   at its fitted `restoreBounds` as soon as its natural size fits without filling the screen.
   * - Tiled windows keep their half of the new workspace, and their `restoreBounds` are fitted.
   * - Floating windows that must fill the screen (compact screen, or fixed-size and too large)
   *   are filled automatically, remembering their floating frame in `restoreBounds`.
   * - Other floating windows are shrunk/moved by `fitBounds` so part of the title bar stays
   *   reachable, with their minimum size capped to the workspace. Unchanged windows keep their
   *   object identity.
   *
   * @returns {void}
   *
   * @example
   * window.addEventListener('resize', () => wm.relayout());
   */
  relayout(): void {
    const ws = getWorkspace();
    const compact = isCompact();
    useWM.setState((s) => ({
      windows: s.windows.map((w) => {
        if (w.maximized) {
          const natural = w.restoreBounds ?? { x: w.x, y: w.y, width: w.width, height: w.height };
          if (w.autoMaximized && !mustFill(w.resizable, natural.width, natural.height, ws, compact)) {
            return { ...w, ...fitBounds(natural, ws), maximized: false, autoMaximized: false, restoreBounds: null };
          }
          return { ...w, ...ws };
        }
        if (w.tiled) {
          const half = Math.round(ws.width / 2);
          const restoreBounds = w.restoreBounds && fitBounds(w.restoreBounds, ws);
          return w.tiled === 'left'
            ? { ...w, x: ws.x, y: ws.y, width: half, height: ws.height, restoreBounds }
            : { ...w, x: ws.x + half, y: ws.y, width: ws.width - half, height: ws.height, restoreBounds };
        }
        const current = { x: w.x, y: w.y, width: w.width, height: w.height };
        if (mustFill(w.resizable, w.width, w.height, ws, compact)) {
          return { ...w, ...ws, maximized: true, autoMaximized: true, restoreBounds: current };
        }
        const minWidth = Math.min(w.minWidth, ws.width);
        const minHeight = Math.min(w.minHeight, ws.height);
        const fitted = fitBounds(current, ws);
        const width = Math.max(minWidth, fitted.width);
        const height = Math.max(minHeight, fitted.height);
        const next = { ...fitted, width, height };
        if (sameBounds(next, current) && minWidth === w.minWidth && minHeight === w.minHeight) return w;
        return { ...w, ...next, minWidth, minHeight };
      }),
    }));
  },

  /**
   * Lists the apps that have a running process.
   *
   * Reads the current processes once; the result does not update. Apps with zero windows and
   * hidden apps are included.
   *
   * @returns {string[]} App ids in launch order.
   *
   * @example
   * const running = wm.runningApps(); // ['finder', 'safari']
   */
  runningApps(): string[] {
    return st().processes.map((p) => p.appId);
  },
}; /** The window manager API: launching apps, opening/closing/focusing windows, layout and process control. */

/* ───────────────────────── Selectors ───────────────────────── */

/**
 * Store selector for the focused window.
 *
 * Looks up the window whose id is `focusedId`. Returns null while the desktop or an app with
 * no windows has focus.
 *
 * @param {WMState} s - Window manager state.
 * @returns {WindowState | null} The window with keyboard focus, or null when none is focused.
 *
 * @example
 * const win = useWM(selectFocusedWindow);
 */
export const selectFocusedWindow = (s: WMState) => s.windows.find((w) => w.id === s.focusedId) ?? null;

/**
 * Creates a store selector that tells whether an app is running.
 *
 * The returned selector checks the process list, so an app with no open windows still counts
 * as running. A new selector function is created on every call.
 *
 * @param {string} appId - App to check.
 * @returns {(s: WMState) => boolean} Selector returning true while the app has a process.
 *
 * @example
 * const running = useWM(selectIsRunning('safari'));
 */
export const selectIsRunning = (appId: string) => (s: WMState) => s.processes.some((p) => p.appId === appId);

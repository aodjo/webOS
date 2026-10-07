/**
 * Hooks available to app components rendered inside a window.
 */
import { createContext, useContext, useEffect, useRef, type DependencyList } from 'react';
import { useWM, wm, setBeforeClose } from './wm';
import { setWindowMenus } from './menus';
import { keyboardBusy } from './ui';
import type { MenuDef, WindowState } from './types';

/** Identity of the window a component is rendered in, provided by the shell through `WindowContext`. */
export interface WindowContextValue {
  /** Window id. */
  id: string;
  /** Process id of the app that owns the window. */
  pid: number;
  /** Registered id of the app that owns the window. */
  appId: string;
}

export const WindowContext = createContext<WindowContextValue | null>(null); /** React context holding the enclosing window's identity; `null` outside any window. */

/**
 * Returns information about, and controls for, the window the calling component is rendered in.
 *
 * Reads the window identity from `WindowContext` and subscribes to the window manager store, so
 * the component re-renders when its window state or focus changes. `args` falls back to an empty
 * object and `argsVersion` to 0 while the window is not (yet) in the store. Every control is bound
 * to this window's id and forwards to the matching `wm` method.
 *
 * @returns {object} The window identity (`id`, `pid`, `appId`), its store entry (`win`), the
 *   `focused` flag, the launch `args` and `argsVersion`, and the bound controls `setTitle`,
 *   `setDirty`, `close(force?)` (resolves to whether the window closed), `minimize`,
 *   `toggleMaximize` and `focus`.
 * @throws {Error} When called from a component that is not rendered inside a window.
 *
 * @example
 * const { args, setTitle, setDirty } = useWindow();
 * setTitle(basename(args.path ?? 'Untitled'));
 */
export function useWindow() {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error('useWindow must be used inside a window');
  const id = ctx.id;
  const win = useWM((s) => s.windows.find((w) => w.id === id)) as WindowState | undefined;
  const focused = useWM((s) => s.focusedId === id);
  return {
    ...ctx,
    win,
    focused,
    args: win?.args ?? {},
    argsVersion: win?.argsVersion ?? 0,
    /**
     * Sets this window's title.
     *
     * A custom title replaces the app's default title and stays as given when the UI language
     * changes. Nothing is written when the title is unchanged and already custom.
     *
     * @param {string} title - The new title.
     * @returns {void}
     *
     * @example
     * setTitle('Groceries.txt');
     */
    setTitle: (title: string) => wm.setTitle(id, title),
    /**
     * Marks whether this window has unsaved changes.
     *
     * The window state is only updated when the flag actually changes.
     *
     * @param {boolean} dirty - True when the document has unsaved edits.
     * @returns {void}
     *
     * @example
     * setDirty(text !== saved);
     */
    setDirty: (dirty: boolean) => wm.setDirty(id, dirty),
    /**
     * Closes this window.
     *
     * Runs the window's before-close handler first unless `force` is set; the handler can veto
     * the close.
     *
     * @param {boolean} [force=false] - Skip the before-close handler.
     * @returns {Promise<boolean>} Whether the window was closed.
     *
     * @example
     * await close();
     */
    close: (force = false) => wm.close(id, { force }),
    /**
     * Minimizes this window to the Dock.
     *
     * If the window had focus, focus moves to the topmost remaining visible window.
     *
     * @returns {void}
     *
     * @example
     * minimize();
     */
    minimize: () => wm.minimize(id),
    /**
     * Toggles this window between filling the workspace and its previous frame.
     *
     * A tiled window is restored as well. Non-maximizable windows are left unchanged; otherwise
     * the window is also focused.
     *
     * @returns {void}
     *
     * @example
     * toggleMaximize();
     */
    toggleMaximize: () => wm.toggleMaximize(id),
    /**
     * Brings this window to the front and gives it focus.
     *
     * Also un-minimizes the window and unhides its app when needed.
     *
     * @returns {void}
     *
     * @example
     * focus();
     */
    focus: () => wm.focus(id),
  };
}

/**
 * Registers the menu-bar menus for the calling window.
 *
 * The menus appear after the app-name menu while this window is focused, and the shortcuts
 * declared on their items are dispatched while it is focused. The factory is re-run whenever
 * the window id or any value in `deps` changes, so menu actions always close over the latest
 * values. The menus are removed when the component unmounts. Outside a window it does nothing.
 *
 * @param {() => MenuDef[]} factory - Builds the window's menus.
 * @param {DependencyList} deps - Values that trigger rebuilding the menus when they change.
 * @returns {void}
 *
 * @example
 * useAppMenus(() => [
 *   { label: COMMON.file, items: [{ label: COMMON.save, shortcut: 'mod+s', action: save }] },
 * ], [save]);
 */
export function useAppMenus(factory: () => MenuDef[], deps: DependencyList): void {
  const ctx = useContext(WindowContext);
  const id = ctx?.id;
  useEffect(() => {
    if (!id) return;
    setWindowMenus(id, factory());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ...deps]);
  useEffect(() => {
    if (!id) return;
    return () => setWindowMenus(id, null);
  }, [id]);
}

/**
 * Registers a handler that runs before the calling window closes.
 *
 * The handler is consulted for every close path (close button, the close shortcut, Quit, Log Out)
 * and can veto the close by returning `false` or a Promise resolving to `false`. The latest
 * handler is kept in a ref, so it always sees current state without re-registering; the
 * registration is removed on unmount. Outside a window it does nothing.
 *
 * @param {() => boolean | Promise<boolean>} handler - Returns whether the window may close.
 * @returns {void}
 *
 * @example
 * useBeforeClose(async () => !dirty || (await confirmDiscard()));
 */
export function useBeforeClose(handler: () => boolean | Promise<boolean>): void {
  const ctx = useContext(WindowContext);
  const ref = useRef(handler);
  ref.current = handler;
  const id = ctx?.id;
  useEffect(() => {
    if (!id) return;
    setBeforeClose(id, () => ref.current());
    return () => setBeforeClose(id, null);
  }, [id]);
}

/**
 * Runs a callback whenever the calling window's args are replaced.
 *
 * Single-window apps that are launched again with a new file receive new args in their existing
 * window, which bumps `argsVersion`. The callback fires on each bump after the first launch
 * (not for the initial args, where `argsVersion` is 0) and always uses the latest callback.
 *
 * @param {(args: Record<string, unknown>) => void} cb - Receives the new args.
 * @returns {void}
 * @throws {Error} When called from a component that is not rendered inside a window.
 *
 * @example
 * useArgsChange((args) => { if (typeof args.path === 'string') openFile(args.path); });
 */
export function useArgsChange(cb: (args: Record<string, unknown>) => void): void {
  const { args, argsVersion } = useWindow();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (argsVersion > 0) ref.current(args);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [argsVersion]);
}

/**
 * Listens for keydown events only while the calling window is focused.
 *
 * A window-level listener is attached while the window has focus and removed when it loses it.
 * Events are ignored when another handler already called `preventDefault`, when a shell overlay
 * owns the keyboard (a menu, Spotlight, Launchpad, Mission Control, an alert or a sheet on this
 * window, and the other overlays checked by `keyboardBusy`), when the event target sits inside a
 * different window, and, unless `allowInInputs` is set, when the target is a text input, textarea
 * or contenteditable element.
 * The latest handler is kept in a ref, so it always sees current state.
 *
 * @param {(e: KeyboardEvent) => void} handler - Called with each accepted keydown event.
 * @param {Object} [opts={}] - Listener options.
 * @param {boolean} [opts.allowInInputs] - Also deliver keys typed into text fields.
 * @returns {void}
 *
 * @example
 * useWindowKeydown((e) => { if (e.key === 'Escape') clearSelection(); });
 */
export function useWindowKeydown(handler: (e: KeyboardEvent) => void, opts: { allowInInputs?: boolean } = {}): void {
  const ctx = useContext(WindowContext);
  const ref = useRef(handler);
  ref.current = handler;
  const id = ctx?.id;
  const focused = useWM((s) => s.focusedId === id);
  useEffect(() => {
    if (!focused || !id) return;
    /**
     * Filters a window-level keydown event and forwards accepted ones to the latest handler.
     *
     * Drops events already handled elsewhere, events while the keyboard is owned by a shell
     * overlay, events targeted at elements inside another window, and (unless allowed) events
     * typed into text-editing elements.
     *
     * @param {KeyboardEvent} e - The keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || keyboardBusy(id)) return;
      const t = e.target instanceof Element ? (e.target as HTMLElement) : null;
      if (t && t !== document.body && t !== document.documentElement && t.closest('[data-window-id]')?.getAttribute('data-window-id') !== id) return;
      if (!opts.allowInInputs && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, id, opts.allowInInputs]);
}

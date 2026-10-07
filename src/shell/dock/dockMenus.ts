/**
 * Dock context menus (app icons, minimized windows, Trash, the Dock itself) and the pinned-app
 * list helpers. Menus are rendered by the shared ContextMenuHost via `showContextMenu`.
 */
import {
  emptyTrashWithConfirm,
  fs,
  getApp,
  revealInFinder,
  showContextMenu,
  tr,
  t,
  useSystem,
  useUI,
  useWM,
  wm,
  PATHS,
  type DockPosition,
  type LString,
  type MenuItem,
} from '@/kernel';

const M = {
  options: { en: 'Options', ko: '옵션' },
  keepInDock: { en: 'Keep in Dock', ko: 'Dock에 유지' },
  removeFromDock: { en: 'Remove from Dock', ko: 'Dock에서 제거' },
  showInFinder: { en: 'Show in Finder', ko: 'Finder에서 보기' },
  showAllWindows: { en: 'Show All Windows', ko: '모든 윈도우 보기' },
  hide: { en: 'Hide', ko: '가리기' },
  hideOthers: { en: 'Hide Others', ko: '기타 가리기' },
  show: { en: 'Show', ko: '보기' },
  quit: { en: 'Quit', ko: '종료' },
  forceQuit: { en: 'Force Quit', ko: '강제 종료' },
  newWindow: { en: 'New Window', ko: '새로운 윈도우' },
  newFinderWindow: { en: 'New Finder Window', ko: '새로운 Finder 윈도우' },
  open: { en: 'Open', ko: '열기' },
  close: { en: 'Close', ko: '닫기' },
  emptyTrash: { en: 'Empty Trash', ko: '휴지통 비우기' },
  hidingOn: { en: 'Turn Hiding On', ko: '가리기 켜기' },
  hidingOff: { en: 'Turn Hiding Off', ko: '가리기 끄기' },
  magnificationOn: { en: 'Turn Magnification On', ko: '확대 켜기' },
  magnificationOff: { en: 'Turn Magnification Off', ko: '확대 끄기' },
  position: { en: 'Position on Screen', ko: '화면상의 위치' },
  left: { en: 'Left', ko: '왼쪽' },
  bottom: { en: 'Bottom', ko: '하단' },
  right: { en: 'Right', ko: '오른쪽' },
  dockSettings: { en: 'Dock Settings…', ko: 'Dock 설정…' },
} satisfies Record<string, LString>; /** Localized menu labels; `left`/`bottom`/`right` are indexed by DockPosition. */

const sep: MenuItem = { separator: true }; /** Shared separator menu item. */

export const DOCK_SETTINGS_PANE = 'desktop-dock'; /** System Settings pane that holds the Dock options. */

/* ───────────────────────── Pinned apps ───────────────────────── */

/**
 * Normalizes a pinned-app list into the order shown in the Dock.
 *
 * Finder is always first; ids of unregistered apps and duplicates are dropped.
 *
 * @param {readonly string[]} list - Stored pinned app ids.
 * @returns {string[]} The cleaned list, starting with "finder".
 *
 * @example
 * normalizePinned(['safari', 'finder', 'safari', 'nope']); // ['finder', 'safari']
 */
export function normalizePinned(list: readonly string[]): string[] {
  const out = ['finder'];
  for (const id of list) if (id !== 'finder' && getApp(id) && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Saves the pinned-app list to the system settings.
 *
 * The list is passed through `normalizePinned` before it is stored as `dockPinned`, so Finder
 * leads and unknown or duplicate ids are dropped.
 *
 * @param {string[]} ids - App ids in Dock order.
 * @returns {void}
 *
 * @example
 * setPinned(['finder', 'safari', 'mail']);
 */
export function setPinned(ids: string[]): void {
  useSystem.getState().updateSettings({ dockPinned: normalizePinned(ids) });
}

/**
 * Reads the current pinned-app list from the system settings.
 *
 * The stored `dockPinned` value is normalized on every read, so the result is always a clean
 * list that starts with Finder.
 *
 * @returns {string[]} The normalized pinned app ids.
 *
 * @example
 * const isPinned = pinnedNow().includes('safari');
 */
export function pinnedNow(): string[] {
  return normalizePinned(useSystem.getState().settings.dockPinned);
}

/**
 * Removes an app from the pinned list.
 *
 * Filters the app out of the current list and saves the result. Removing an app that is not
 * pinned saves the list unchanged.
 *
 * @param {string} appId - The app to unpin; Finder stays pinned regardless.
 * @returns {void}
 *
 * @example
 * unpin('mail');
 */
export function unpin(appId: string): void {
  setPinned(pinnedNow().filter((id) => id !== appId));
}

/**
 * Pins an app at the end of the Dock, or unpins it when it is already pinned.
 *
 * Backs the "Keep in Dock" option. Finder cannot be unpinned because normalization always puts it
 * back at the front.
 *
 * @param {string} appId - The app to toggle.
 * @returns {void}
 *
 * @example
 * togglePinned('terminal'); // "Keep in Dock"
 */
export function togglePinned(appId: string): void {
  const list = pinnedNow();
  setPinned(list.includes(appId) ? list.filter((id) => id !== appId) : [...list, appId]);
}

/**
 * Pins several apps at once.
 *
 * Unknown and already pinned apps are skipped; nothing is saved when no app remains. The new apps
 * are inserted before `beforeId` when it is pinned after Finder, otherwise appended at the end.
 *
 * @param {string[]} appIds - Apps to pin, in order.
 * @param {string} [beforeId] - Pinned app to insert in front of.
 * @returns {void}
 *
 * @example
 * pinApps(['terminal', 'notes'], 'mail');
 */
export function pinApps(appIds: string[], beforeId?: string): void {
  let list = pinnedNow();
  const add = appIds.filter((id) => getApp(id) && !list.includes(id));
  if (!add.length) return;
  const at = beforeId ? list.indexOf(beforeId) : -1;
  list = at > 0 ? [...list.slice(0, at), ...add, ...list.slice(at)] : [...list, ...add];
  setPinned(list);
}

/**
 * Builds the virtual-FS path of an app's bundle in /Applications.
 *
 * The bundle is named after the app's English name.
 *
 * @param {string} appId - The app id.
 * @returns {string | null} A path like "/Applications/Safari.app", or null for an unknown app.
 *
 * @example
 * appBundlePath('safari'); // "/Applications/Safari.app"
 */
export function appBundlePath(appId: string): string | null {
  const app = getApp(appId);
  return app ? `/Applications/${tr(app.name, 'en')}.app` : null;
}

/**
 * Opens the Trash in a Finder window.
 *
 * Asks the window manager for a new Finder window whose path is the Trash folder.
 *
 * @returns {void}
 *
 * @example
 * openTrash();
 */
export function openTrash(): void {
  wm.openWindow('finder', { path: PATHS.trash });
}

/* ───────────────────────── Menu builders ───────────────────────── */

/**
 * Builds the Dock menu for an app icon.
 *
 * Sections, separated as needed: the app's open windows (oldest first, the focused one checked);
 * "New Window" for running multi-window apps and Finder; an Options submenu ("Keep in Dock" for
 * running apps, "Remove from Dock" otherwise, plus "Show in Finder" when the app bundle exists;
 * not shown for Finder); then Show All Windows / Show / Hide / Quit for running apps or Open for
 * stopped ones. Persistent apps get no Quit. Leading, doubled and trailing separators are trimmed.
 *
 * @param {string} appId - The app whose icon was clicked.
 * @param {boolean} alt - Option held: Quit becomes Force Quit and Hide becomes Hide Others.
 * @returns {MenuItem[]} The menu items, or an empty array for an unknown app.
 *
 * @example
 * showContextMenu(e, appMenu('safari', e.altKey));
 */
export function appMenu(appId: string, alt: boolean): MenuItem[] {
  const app = getApp(appId);
  if (!app) return [];
  const st = useWM.getState();
  const proc = st.processes.find((p) => p.appId === appId);
  const wins = st.windows.filter((w) => w.appId === appId).sort((a, b) => a.createdAt - b.createdAt);
  const pinned = pinnedNow().includes(appId);
  const items: MenuItem[] = [];

  if (wins.length) {
    for (const w of wins) items.push({ label: w.title || t(app.name), checked: w.id === st.focusedId, action: () => wm.focus(w.id) });
    items.push(sep);
  }
  if (app.component && !app.singleWindow && (proc || appId === 'finder')) {
    items.push({ label: appId === 'finder' ? M.newFinderWindow : M.newWindow, action: () => wm.openWindow(appId) }, sep);
  }

  if (appId !== 'finder') {
    const options: MenuItem[] = [proc ? { label: M.keepInDock, checked: pinned, action: () => togglePinned(appId) } : { label: M.removeFromDock, action: () => unpin(appId) }];
    const bundle = appBundlePath(appId);
    if (bundle && fs.exists(bundle)) options.push(sep, { label: M.showInFinder, action: () => revealInFinder(bundle) });
    items.push({ label: M.options, submenu: options }, sep);
  }

  if (proc) {
    if (wins.length) {
      items.push({
        label: M.showAllWindows,
        action: () => {
          wm.launch(appId);
          useUI.getState().set({ missionControl: true });
        },
      });
    }
    if (proc.hidden) items.push({ label: M.show, action: () => wm.launch(appId) });
    else if (alt) items.push({ label: M.hideOthers, action: () => wm.hideOthers(appId) });
    else items.push({ label: M.hide, action: () => wm.hideApp(appId) });
    if (!app.persistent) items.push(alt ? { label: M.forceQuit, action: () => void wm.quit(appId, { force: true }) } : { label: M.quit, action: () => void wm.quit(appId) });
  } else {
    items.push({ label: M.open, action: () => wm.launch(appId) });
  }
  return trimSeparators(items);
}

/**
 * Builds the Dock menu for a minimized-window tile.
 *
 * "Open" restores the window from the Dock; "Close" closes it through the window manager, which
 * may still ask for confirmation before the window goes away.
 *
 * @param {string} windowId - The minimized window.
 * @returns {MenuItem[]} "Open" (restore) and "Close" items.
 *
 * @example
 * showContextMenu(e, minimizedMenu(win.id));
 */
export function minimizedMenu(windowId: string): MenuItem[] {
  return [
    { label: M.open, action: () => wm.restore(windowId) },
    { label: M.close, action: () => void wm.close(windowId) },
  ];
}

/**
 * Builds the Dock menu for the Trash.
 *
 * "Empty Trash" asks for confirmation and is disabled while the Trash is empty.
 *
 * @returns {MenuItem[]} "Open" and "Empty Trash" items.
 *
 * @example
 * showContextMenu(e, trashMenu());
 */
export function trashMenu(): MenuItem[] {
  return [{ label: M.open, action: openTrash }, sep, { label: M.emptyTrash, disabled: fs.trashCount() === 0, action: () => void emptyTrashWithConfirm() }];
}

/**
 * Builds the menu shown on a right-click on the Dock separator or background.
 *
 * Toggles auto-hide and magnification, picks the Dock position (left / bottom / right), and opens
 * the Dock pane of System Settings. Labels reflect the current settings.
 *
 * @returns {MenuItem[]} The Dock options menu.
 *
 * @example
 * showContextMenu(e, dockMenu());
 */
export function dockMenu(): MenuItem[] {
  const { settings, updateSettings } = useSystem.getState();
  const positions: DockPosition[] = ['left', 'bottom', 'right'];
  return [
    { label: settings.dockAutohide ? M.hidingOff : M.hidingOn, action: () => updateSettings({ dockAutohide: !settings.dockAutohide }) },
    { label: settings.dockMagnification ? M.magnificationOff : M.magnificationOn, action: () => updateSettings({ dockMagnification: !settings.dockMagnification }) },
    sep,
    { label: M.position, submenu: positions.map((p) => ({ label: M[p], checked: settings.dockPosition === p, action: () => updateSettings({ dockPosition: p }) })) },
    sep,
    { label: M.dockSettings, action: () => wm.launch('settings', { pane: DOCK_SETTINGS_PANE }) },
  ];
}

/**
 * Removes separators at the start, directly after another separator, and at the end of a menu.
 *
 * Leading and doubled separators are filtered out in one pass; trailing separators are then popped
 * off the end. The input array is not modified.
 *
 * @param {MenuItem[]} items - Menu items that may contain redundant separators.
 * @returns {MenuItem[]} A new array without redundant separators.
 *
 * @example
 * trimSeparators([sep, item, sep, sep, other, sep]); // [item, sep, other]
 */
function trimSeparators(items: MenuItem[]): MenuItem[] {
  const out = items.filter((it, i) => !(it.separator && (i === 0 || items[i - 1].separator)));
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

/* ───────────────────────── Opening ───────────────────────── */

let active: { close: () => void } | null = null; /** Tracking handle of the Dock menu currently open, if any. */

/**
 * Shows a Dock menu at (x, y) and tracks it until it goes away.
 *
 * Any Dock menu already being tracked is finished first. While the menu is open, pressing or
 * releasing Option rebuilds it with `build(alt)` and swaps the items in place, so "Quit" turns
 * into "Force Quit" live. Tracking ends when the context menu is closed or replaced (detected by
 * subscribing to the UI store and comparing the items array); `onClose` then runs exactly once.
 * When `build` returns no items, nothing is shown and `onClose` runs immediately.
 *
 * @param {number} x - Client x coordinate of the menu.
 * @param {number} y - Client y coordinate of the menu.
 * @param {(alt: boolean) => MenuItem[]} build - Builds the items for the current Option state.
 * @param {() => void} onClose - Called once when the menu goes away or tracking is stopped.
 * @param {boolean} [altAtOpen=false] - Whether Option was held when the menu was opened.
 * @returns {() => void} Stops tracking and runs `onClose` (if it hasn't run) without closing the
 *   menu itself.
 *
 * @example
 * const stop = openDockMenu(e.clientX, e.clientY, (alt) => appMenu('safari', alt), () => setMenuFor(null), e.altKey);
 */
export function openDockMenu(x: number, y: number, build: (alt: boolean) => MenuItem[], onClose: () => void, altAtOpen = false): () => void {
  active?.close();
  let alt = altAtOpen;
  let items = build(alt);
  if (!items.length) {
    onClose();
    return () => {};
  }
  let done = false;

  /**
   * Rebuilds the open menu when the Option key changes state.
   *
   * Ignores other keys, repeats of the current Option state, and events while the open context
   * menu is a different one.
   *
   * @param {KeyboardEvent} e - A keydown or keyup event (captured on window).
   * @returns {void}
   *
   * @example
   * window.addEventListener('keydown', onKey, true);
   */
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Alt') return;
    const down = e.type === 'keydown';
    if (down === alt) return;
    alt = down;
    const cm = useUI.getState().contextMenu;
    if (!cm || cm.items !== items) return;
    items = build(alt);
    useUI.getState().set({ contextMenu: { ...cm, items } });
  };
  /**
   * Ends tracking of this Dock menu.
   *
   * Unsubscribes from the UI store, removes the key listeners, clears the active handle if it is
   * this menu's, and calls `onClose`. A flag makes repeated calls no-ops, so `onClose` runs once.
   *
   * @returns {void}
   *
   * @example
   * finish();
   */
  const finish = () => {
    if (done) return;
    done = true;
    unsub();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    if (active === handle) active = null;
    onClose();
  };
  const handle = { close: finish };
  active = handle;

  showContextMenu({ clientX: x, clientY: y, preventDefault: () => {} }, items);
  const unsub = useUI.subscribe((s) => {
    if (s.contextMenu?.items !== items) finish();
  });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  return finish;
}

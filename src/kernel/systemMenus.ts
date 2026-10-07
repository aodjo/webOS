/**
 * Builds the menu bar contents (logo menu, app menu, app-provided menus + defaults).
 * Used both by the MenuBar UI and by the global keyboard shortcut dispatcher, so every shortcut
 * shown in a menu actually works.
 *
 * Shortcut policy: browsers reserve ⌘W/⌘Q/⌘N/⌘T/⇧⌘N/⇧⌘T/⌘Tab, so window-level commands use ⌥
 * (Option) instead: ⌥W close, ⌥Q quit, ⌥N new window, ⌥M minimize, ⌥H hide.
 */
import type { LString, MenuDef, MenuItem } from './types';
import { getApp } from './registry';
import { useWM, wm } from './wm';
import { canonicalShortcut, isMacHost, useMenus } from './menus';
import { useUI } from './ui';
import { power } from './system';
import { dialogs } from './dialogs';
import { t } from './i18n';
import { osInfo } from '@/data/portfolio';

/**
 * Returns the language-independent key of a menu label.
 *
 * Plain strings are used as is; localized labels use their English text, so menus can be matched
 * by name ("File", "Window"…) in any locale.
 *
 * @param {LString} l - The menu label.
 * @returns {string} The label's English text.
 *
 * @example
 * labelKey({ en: 'File', ko: '파일' }); // "File"
 */
const labelKey = (l: LString) => (typeof l === 'string' ? l : l.en);

const sep: MenuItem = { separator: true }; /** Shared separator item. */

export const SYSTEM_SHORTCUTS = {
  spotlight: 'mod+k',
  launchpad: 'f4',
  missionControl: 'f3',
  showDesktop: 'f11',
  forceQuit: isMacHost ? 'ctrl+alt+esc' : 'mod+alt+esc',
  lockScreen: isMacHost ? 'ctrl+alt+q' : undefined,
  tileLeft: isMacHost ? 'ctrl+alt+left' : 'mod+alt+shift+left',
  tileRight: isMacHost ? 'ctrl+alt+right' : 'mod+alt+shift+right',
  fillScreen: isMacHost ? 'ctrl+alt+up' : 'mod+alt+shift+up',
} as const; /** Shortcuts of the system-wide commands, the single source for the menus and every place that advertises them (Tips, Keyboard Shortcuts, Settings, Force Quit). On macOS the chords avoid keys the host captures first (⌃⌘Q, ⌥⌘⎋, ⌃Space, ⌃↑); off macOS, where Ctrl is the command key, the tiling chords add Shift to stay clear of app shortcuts and there is no lock-screen shortcut. */

/* ───────────────────────── Logo () menu ───────────────────────── */

/**
 * Builds the items of the logo () menu.
 *
 * Contains About This Computer, System Settings, App Store (opens Launchpad), Recent Items, Force
 * Quit, Sleep, Restart, Shut Down, Lock Screen and Log Out. Restart, Shut Down and Log Out ask for
 * confirmation through `confirmPower`.
 *
 * @returns {MenuItem[]} The menu items.
 *
 * @example
 * const items = buildLogoMenu();
 */
export function buildLogoMenu(): MenuItem[] {
  return [
    { label: { en: 'About This Computer', ko: '이 컴퓨터에 관하여' }, action: () => wm.launch('about-this-mac') },
    sep,
    { label: { en: 'System Settings…', ko: '시스템 설정…' }, action: () => wm.launch('settings') },
    { label: { en: 'App Store…', ko: 'App Store…' }, action: () => useUI.getState().set({ launchpad: true }) },
    sep,
    {
      label: { en: 'Recent Items', ko: '최근 사용 항목' },
      submenu: [
        { label: { en: 'Projects', ko: '프로젝트' }, action: () => wm.launch('projects') },
        { label: { en: 'About Me', ko: '내 소개' }, action: () => wm.launch('about-me') },
        { label: { en: 'Terminal', ko: '터미널' }, action: () => wm.launch('terminal') },
      ],
    },
    sep,
    { label: { en: 'Force Quit…', ko: '강제 종료…' }, shortcut: SYSTEM_SHORTCUTS.forceQuit, action: () => useUI.getState().set({ forceQuit: true }) },
    sep,
    { label: { en: 'Sleep', ko: '잠자기' }, action: power.sleep },
    { label: { en: 'Restart…', ko: '재시동…' }, action: () => void confirmPower('restart') },
    { label: { en: 'Shut Down…', ko: '시스템 종료…' }, action: () => void confirmPower('shutDown') },
    sep,
    { label: { en: 'Lock Screen', ko: '화면 잠금' }, shortcut: SYSTEM_SHORTCUTS.lockScreen, action: power.lock },
    { label: { en: 'Log Out…', ko: '로그아웃…' }, action: () => void confirmPower('logOut') },
  ];
}

/**
 * Asks for confirmation, then restarts, shuts down or logs out.
 *
 * Shows a confirmation dialog; if confirmed, every window with unsaved changes is asked to close
 * first (like macOS, each one may prompt to save). If any of those windows refuses to close, the
 * whole action is cancelled; otherwise the matching power action runs.
 *
 * @async
 * @param {'restart' | 'shutDown' | 'logOut'} kind - The power action to perform.
 * @returns {Promise<void>} Resolves once the action has started or was cancelled.
 *
 * @example
 * await confirmPower('restart');
 */
export async function confirmPower(kind: 'restart' | 'shutDown' | 'logOut'): Promise<void> {
  const titles = {
    restart: { en: 'Are you sure you want to restart your computer now?', ko: '지금 컴퓨터를 재시동하겠습니까?' },
    shutDown: { en: 'Are you sure you want to shut down your computer now?', ko: '지금 컴퓨터를 종료하겠습니까?' },
    logOut: { en: 'Are you sure you want to quit all applications and log out now?', ko: '모든 응용 프로그램을 종료하고 지금 로그아웃하겠습니까?' },
  };
  const ok = { restart: { en: 'Restart', ko: '재시동' }, shutDown: { en: 'Shut Down', ko: '시스템 종료' }, logOut: { en: 'Log Out', ko: '로그아웃' } };
  const yes = await dialogs.confirm({ title: titles[kind], message: { en: 'Open windows with unsaved changes will ask you to save.', ko: '저장되지 않은 변경 사항이 있는 윈도우는 저장 여부를 묻습니다.' }, okLabel: ok[kind] });
  if (!yes) return;
  for (const w of [...useWM.getState().windows]) {
    if (w.dirty) {
      const closed = await wm.close(w.id);
      if (!closed) return;
    }
  }
  power[kind]();
}

/* ───────────────────────── App menu & defaults ───────────────────────── */

/**
 * Builds the application menu (the bold menu named after the active app).
 *
 * Contains About (Finder opens About This Computer, other apps show an alert with their version
 * and bundle id), Settings, Hide, Hide Others, Show All and Quit. Quit is disabled for persistent
 * apps such as Finder.
 *
 * @param {string} appId - Id of the active app.
 * @returns {MenuDef} The app menu.
 *
 * @example
 * const menu = appMenu('notes');
 */
function appMenu(appId: string): MenuDef {
  const app = getApp(appId);
  const name = app ? t(app.name) : appId;
  return {
    label: name,
    items: [
      {
        label: { en: `About ${name}`, ko: `${name}에 관하여` },
        action: () =>
          appId === 'finder'
            ? wm.launch('about-this-mac')
            : void dialogs.alert({
                appId,
                title: name,
                message: { en: `Version ${app?.version ?? osInfo.version}\n${app?.bundleId ?? ''}`, ko: `버전 ${app?.version ?? osInfo.version}\n${app?.bundleId ?? ''}` },
              }),
      },
      sep,
      { label: { en: 'Settings…', ko: '설정…' }, shortcut: 'mod+,', action: () => wm.launch('settings') },
      sep,
      { label: { en: `Hide ${name}`, ko: `${name} 가리기` }, shortcut: 'alt+h', action: () => wm.hideApp(appId) },
      { label: { en: 'Hide Others', ko: '기타 가리기' }, shortcut: 'alt+shift+h', action: () => wm.hideOthers(appId) },
      { label: { en: 'Show All', ko: '모두 보기' }, action: () => wm.showAll() },
      sep,
      { label: { en: `Quit ${name}`, ko: `${name} 종료` }, shortcut: 'alt+q', disabled: !!app?.persistent, action: () => void wm.quit(appId) },
    ],
  };
}

/**
 * Builds the default File menu used when the app provides none.
 *
 * Contains only Close Window (⌥W), disabled when no window is focused.
 *
 * @param {string | null} focusedId - Id of the focused window, or null.
 * @returns {MenuDef} The File menu.
 *
 * @example
 * menus.push(defaultFileMenu(focusedId));
 */
function defaultFileMenu(focusedId: string | null): MenuDef {
  return {
    label: { en: 'File', ko: '파일' },
    items: [{ label: { en: 'Close Window', ko: '윈도우 닫기' }, shortcut: 'alt+w', disabled: !focusedId, action: () => focusedId && void wm.close(focusedId) }],
  };
}

/**
 * Creates a menu action that runs a `document.execCommand` editing command.
 *
 * The command applies to the focused editable element; errors thrown by browsers that do not
 * support the command are ignored.
 *
 * @param {string} cmd - The editing command, e.g. "undo" or "selectAll".
 * @returns {() => void} The menu action.
 *
 * @example
 * const item = { label: 'Undo', action: exec('undo') };
 */
const exec = (cmd: string) => () => {
  try {
    document.execCommand(cmd);
  } catch {}
};

/**
 * Builds the default Edit menu used when the app provides none.
 *
 * Undo, Redo, Cut, Copy and Select All run the matching `document.execCommand`; Paste reads the
 * host clipboard and inserts the text at the caret (silently doing nothing if clipboard access
 * is denied).
 *
 * @returns {MenuDef} The Edit menu.
 *
 * @example
 * menus.push(defaultEditMenu());
 */
function defaultEditMenu(): MenuDef {
  return {
    label: { en: 'Edit', ko: '편집' },
    items: [
      { label: { en: 'Undo', ko: '실행 취소' }, action: exec('undo') },
      { label: { en: 'Redo', ko: '실행 복귀' }, action: exec('redo') },
      sep,
      { label: { en: 'Cut', ko: '오려두기' }, action: exec('cut') },
      { label: { en: 'Copy', ko: '복사하기' }, action: exec('copy') },
      { label: { en: 'Paste', ko: '붙여넣기' }, action: () => void navigator.clipboard?.readText().then((txt) => document.execCommand('insertText', false, txt)).catch(() => {}) },
      { label: { en: 'Select All', ko: '전체 선택' }, action: exec('selectAll') },
    ],
  };
}

/**
 * Collects the canonical chords of every shortcut in a menu tree.
 *
 * Walks the items and their submenus recursively, adding each shortcut in canonical form.
 *
 * @param {MenuItem[]} items - The menu items to scan.
 * @param {Set<string>} [into=new Set()] - Set to add the chords to.
 * @returns {Set<string>} The set of canonical chords.
 *
 * @example
 * chordsOf(menu.items).has('alt+m');
 */
function chordsOf(items: MenuItem[], into = new Set<string>()): Set<string> {
  for (const it of items) {
    if (it.shortcut) into.add(canonicalShortcut(it.shortcut));
    if (it.submenu) chordsOf(it.submenu, into);
  }
  return into;
}

/**
 * Builds the Window menu.
 *
 * Contains Minimize, Zoom, tiling commands and Fill Screen for the focused window, then any
 * app-provided Window items, Cycle Through Windows, Bring All to Front and a checked list of the
 * active app's windows. App-provided items win over a default item that uses the same shortcut:
 * the default item drops its shortcut, so the dispatcher (which finds default items first) does
 * not shadow the app's item and the chord is not shown twice.
 *
 * @param {string | null} focusedId - Id of the focused window, or null.
 * @param {MenuItem[]} [extra=[]] - Items of the app-provided Window menu.
 * @returns {MenuDef} The Window menu.
 *
 * @example
 * menus.push(windowMenu(focusedId, appWindowMenu?.items));
 */
function windowMenu(focusedId: string | null, extra: MenuItem[] = []): MenuDef {
  const s = useWM.getState();
  const w = s.windows.find((x) => x.id === focusedId);
  const appWins = s.windows.filter((x) => x.appId === s.activeAppId);
  const taken = chordsOf(extra);
  /**
   * Returns the shortcut for a default Window item unless an app-provided item already uses it.
   *
   * Compares the canonical form of the shortcut against the chords collected from the
   * app-provided Window items.
   *
   * @param {string} shortcut - The default item's shortcut.
   * @returns {string | undefined} The shortcut, or undefined when the app's items take it.
   *
   * @example
   * const shortcut = own('alt+m'); // undefined if the app's Window menu uses ⌥M
   */
  const own = (shortcut: string) => (taken.has(canonicalShortcut(shortcut)) ? undefined : shortcut);
  return {
    label: { en: 'Window', ko: '윈도우' },
    items: [
      { label: { en: 'Minimize', ko: '최소화' }, shortcut: own('alt+m'), disabled: !w, action: () => w && wm.minimize(w.id) },
      { label: { en: 'Zoom', ko: '확대/축소' }, disabled: !w?.maximizable, action: () => w && wm.toggleMaximize(w.id) },
      sep,
      { label: { en: 'Move Window to Left Side of Screen', ko: '윈도우를 화면 왼쪽으로 이동' }, shortcut: own(SYSTEM_SHORTCUTS.tileLeft), disabled: !w?.resizable, action: () => w && wm.tile(w.id, 'left') },
      { label: { en: 'Move Window to Right Side of Screen', ko: '윈도우를 화면 오른쪽으로 이동' }, shortcut: own(SYSTEM_SHORTCUTS.tileRight), disabled: !w?.resizable, action: () => w && wm.tile(w.id, 'right') },
      { label: { en: 'Fill Screen', ko: '화면 채우기' }, shortcut: own(SYSTEM_SHORTCUTS.fillScreen), disabled: !w?.maximizable, action: () => w && !w.maximized && wm.toggleMaximize(w.id) },
      ...(extra.length ? [sep, ...extra] : []),
      sep,
      { label: { en: 'Cycle Through Windows', ko: '윈도우 순환' }, shortcut: own('mod+`'), action: () => wm.cycleAppWindows() },
      { label: { en: 'Bring All to Front', ko: '모두 앞으로 가져오기' }, action: () => appWins.forEach((x) => wm.focus(x.id)) },
      ...(appWins.length ? [sep] : []),
      ...appWins.map<MenuItem>((x) => ({ label: x.title, checked: x.id === focusedId, action: () => wm.focus(x.id) })),
    ],
  };
}

/**
 * Builds the default Help menu.
 *
 * Contains the OS Tips (Welcome app), Keyboard Shortcuts (Welcome app on its shortcuts page) and
 * Search (opens Spotlight).
 *
 * @returns {MenuDef} The Help menu.
 *
 * @example
 * const help = helpMenu();
 */
function helpMenu(): MenuDef {
  return {
    label: { en: 'Help', ko: '도움말' },
    items: [
      { label: { en: `${osInfo.name} Tips`, ko: `${osInfo.name} 팁` }, action: () => wm.launch('welcome') },
      { label: { en: 'Keyboard Shortcuts', ko: '키보드 단축키' }, action: () => wm.openWindow('welcome', { page: 'shortcuts' }) },
      sep,
      { label: { en: 'Search…', ko: '검색…' }, shortcut: SYSTEM_SHORTCUTS.spotlight, action: () => useUI.getState().set({ spotlight: true }) },
    ],
  };
}

/**
 * Builds the shell-wide shortcuts that work regardless of the focused app.
 *
 * These are not shown in any menu. They toggle Spotlight, Launchpad, Mission Control and Show
 * Desktop with the keys from `SYSTEM_SHORTCUTS`. On Mac hosts the macOS originals (⌃Space for
 * Spotlight, ⌃↑ for Mission Control) are registered as well, unadvertised, for hosts that let them
 * through; elsewhere Ctrl is the command key and these would shadow app shortcuts.
 *
 * @returns {MenuItem[]} Items carrying only a shortcut and an action.
 *
 * @example
 * const item = findShortcutItem([{ label: '', items: buildGlobalShortcuts() }], e);
 */
export function buildGlobalShortcuts(): MenuItem[] {
  const ui = useUI.getState();
  /**
   * Opens Spotlight, or closes it when it is open.
   *
   * Reads the current UI state at call time, so it always flips the latest value.
   *
   * @returns {void}
   *
   * @example
   * toggleSpotlight();
   */
  const toggleSpotlight = () => ui.set({ spotlight: !useUI.getState().spotlight });
  /**
   * Opens Mission Control, or closes it when it is open.
   *
   * Reads the current UI state at call time, so it always flips the latest value.
   *
   * @returns {void}
   *
   * @example
   * toggleMissionControl();
   */
  const toggleMissionControl = () => ui.set({ missionControl: !useUI.getState().missionControl });
  return [
    { shortcut: SYSTEM_SHORTCUTS.spotlight, action: toggleSpotlight },
    { shortcut: SYSTEM_SHORTCUTS.launchpad, action: () => ui.set({ launchpad: !useUI.getState().launchpad }) },
    { shortcut: SYSTEM_SHORTCUTS.missionControl, action: toggleMissionControl },
    { shortcut: SYSTEM_SHORTCUTS.showDesktop, action: () => ui.set({ showDesktop: !useUI.getState().showDesktop }) },
    ...(isMacHost
      ? [
          { shortcut: 'ctrl+space', action: toggleSpotlight },
          { shortcut: 'ctrl+up', action: toggleMissionControl },
        ]
      : []),
  ];
}

/**
 * Builds the full menu bar for the current state.
 *
 * Uses the menus registered by the focused window (or, when the active app has no focused
 * window, the menus registered for the app) and merges them with the defaults: the app's File
 * menu (or its menu with `role: 'file'`) comes first and Edit second, each falling back to the
 * default when missing; the app's other menus follow in their order; Window and Help are always
 * last. App-provided "Window" items are added into the default Window menu, and app-provided
 * "Help" items are placed above the default Help items. Menus are matched by their English label.
 *
 * @returns {{ appMenu: MenuDef; menus: MenuDef[] }} The app menu and the remaining menus in order.
 *
 * @example
 * const { appMenu, menus } = buildMenuBar();
 */
export function buildMenuBar(): { appMenu: MenuDef; menus: MenuDef[] } {
  const { activeAppId, focusedId, windows } = useWM.getState();
  const focused = windows.find((w) => w.id === focusedId);
  const provided = (focused && focused.appId === activeAppId ? useMenus.getState().byWindow[focused.id] : useMenus.getState().byApp[activeAppId]) ?? [];
  const keyed = new Map(provided.map((m) => [labelKey(m.label), m]));
  const menus: MenuDef[] = [];
  const fileMenu = keyed.get('File') ?? provided.find((m) => m.role === 'file');
  menus.push(fileMenu ?? defaultFileMenu(focusedId));
  menus.push(keyed.get('Edit') ?? defaultEditMenu());
  for (const m of provided) {
    const k = labelKey(m.label);
    if (m !== fileMenu && k !== 'File' && k !== 'Edit' && k !== 'Window' && k !== 'Help') menus.push(m);
  }
  menus.push(windowMenu(focusedId, keyed.get('Window')?.items));
  const help = helpMenu();
  const providedHelp = keyed.get('Help');
  if (providedHelp) help.items = [...providedHelp.items, sep, ...help.items];
  menus.push(help);
  return { appMenu: appMenu(activeAppId), menus };
}

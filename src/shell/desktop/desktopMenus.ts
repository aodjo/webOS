/**
 * Finder's menus while the desktop is key (Finder active, no window focused), and the desktop's
 * context menu. Shortcuts declared here are dispatched by the shell's global key handler.
 */
import { COMMON, HOME, PATHS, dialogs, emptyTrashWithConfirm, fs, openGetInfo, resolve, revealInFinder, wm, type LString, type MenuDef, type MenuItem, type SortKey } from '@/kernel';
import { RECENTS } from '@/apps/finder/model';
import type { Cell } from './desktopGrid';

export const DS = {
  newFinderWindow: { en: 'New Finder Window', ko: '새로운 Finder 윈도우' },
  duplicate: { en: 'Duplicate', ko: '복제' },
  importFiles: { en: 'Import Files…', ko: '파일 가져오기…' },
  changeWallpaper: { en: 'Change Wallpaper…', ko: '배경화면 변경…' },
  editWidgets: { en: 'Edit Widgets…', ko: '위젯 편집…' },
  useStacks: { en: 'Use Stacks', ko: '스택 사용' },
  sortBy: { en: 'Sort By', ko: '정렬 기준' },
  cleanUp: { en: 'Clean Up', ko: '정리' },
  showViewOptions: { en: 'Show View Options', ko: '보기 옵션 보기' },
  name: { en: 'Name', ko: '이름' },
  kind: { en: 'Kind', ko: '종류' },
  dateModified: { en: 'Date Modified', ko: '수정일' },
  size: { en: 'Size', ko: '크기' },
  pasteItem: { en: 'Paste Item', ko: '항목 붙여넣기' },
  moveItemHere: { en: 'Move Item Here', ko: '항목을 여기로 이동' },
  documents: { en: 'Documents', ko: '문서' },
  desktop: { en: 'Desktop', ko: '데스크탑' },
  downloads: { en: 'Downloads', ko: '다운로드' },
  home: { en: 'Home', ko: '홈' },
  applications: { en: 'Applications', ko: '응용 프로그램' },
  emptyTrash: { en: 'Empty Trash…', ko: '휴지통 비우기…' },
  goToFolder: { en: 'Go to Folder…', ko: '폴더로 이동…' },
  goToFolderTitle: { en: 'Go to Folder', ko: '폴더로 이동' },
  goToFolderMessage: { en: 'Type a path, such as ~/Documents or /Applications.', ko: '~/Documents 또는 /Applications와 같은 경로를 입력하십시오.' },
  go: { en: 'Go', ko: '이동' },
  quickLook: { en: 'Quick Look', ko: '훑어보기' },
  recents: { en: 'Recents', ko: '최근 항목' },
  computer: { en: 'Computer', ko: '컴퓨터' },
} satisfies Record<string, LString>; /** Localized strings for the desktop's menu bar, context menu and Go to Folder prompt. */

/**
 * Builds the label of the Quick Look menu item.
 *
 * Mirrors Finder's menus: a single item is named in quotes ("Quick Look “name”"), while no item
 * or several items fall back to the plain "Quick Look" label.
 *
 * @param {string | null} name - Display name of the single item to preview, or null for none/several.
 * @returns {LString} The localized menu label.
 *
 * @example
 * quickLookLabel('Resume.md').en; // 'Quick Look “Resume.md”'
 * quickLookLabel(null);           // DS.quickLook
 */
export const quickLookLabel = (name: string | null): LString => (name ? { en: `Quick Look “${name}”`, ko: `“${name}” 훑어보기` } : DS.quickLook);

/**
 * Builds the label of the Paste menu item for the current file clipboard.
 *
 * More than one item yields "Paste N Items"; one item (or none) yields "Paste Item".
 *
 * @param {number} n - Number of items on the file clipboard.
 * @returns {LString} The localized menu label.
 *
 * @example
 * pasteLabel(3).en; // 'Paste 3 Items'
 */
const pasteLabel = (n: number): LString => (n > 1 ? { en: `Paste ${n} Items`, ko: `${n}개 항목 붙여넣기` } : DS.pasteItem);

/** Actions the desktop exposes to its menus. */
export interface DesktopApi {
  open: () => void;
  newFolder: (at?: Cell) => void;
  rename: () => void;
  getInfo: () => void;
  duplicate: () => void;
  trash: () => void;
  copy: () => void;
  paste: (move: boolean) => void;
  selectAll: () => void;
  cleanUp: () => void;
  sortBy: (key: SortKey) => void;
  importFiles: () => void;
  editWidgets: () => void;
  quickLook: () => void;
}

/** Desktop selection and clipboard state that decides which menu items are enabled. */
export interface DesktopMenuState {
  /** Number of selected desktop icons. */
  count: number;
  canRename: boolean;
  canTrash: boolean;
  /** Number of items on the file clipboard. */
  clipboard: number;
  /** Number of items in the Trash. */
  trashCount: number;
  /** Name of the item Quick Look would show (null when nothing is selected). */
  quickLookName: string | null;
}

const sep: MenuItem = { separator: true }; /** Shared separator item. */

/**
 * Builds the "Sort By" submenu items.
 *
 * Produces one item per sort key (Name, Kind, Date Modified, Size), each calling
 * `api.sortBy` with its key.
 *
 * @param {DesktopApi} api - The desktop actions.
 * @returns {MenuItem[]} The submenu items.
 *
 * @example
 * const item: MenuItem = { label: DS.sortBy, submenu: sortItems(api) };
 */
function sortItems(api: DesktopApi): MenuItem[] {
  const keys: [SortKey, LString][] = [
    ['name', DS.name],
    ['kind', DS.kind],
    ['date', DS.dateModified],
    ['size', DS.size],
  ];
  return keys.map(([key, label]) => ({ label, action: () => api.sortBy(key) }));
}

/**
 * Runs Finder's "Go to Folder…" prompt.
 *
 * Asks for a path (prefilled with "~/"), resolves it against the home directory and opens a
 * Finder window on it when it is a folder, or reveals it in Finder when it is a file. A blank
 * entry or Cancel does nothing; a path that does not exist shows an alert instead.
 *
 * @async
 * @returns {Promise<void>} Resolves once the prompt (and any alert) is dismissed and the target is opened.
 *
 * @example
 * void goToFolder();
 */
async function goToFolder(): Promise<void> {
  const input = await dialogs.prompt({ appId: 'finder', title: DS.goToFolderTitle, message: DS.goToFolderMessage, defaultValue: '~/', okLabel: DS.go });
  const raw = input?.trim();
  if (!raw) return;
  const path = resolve(HOME, raw);
  const node = fs.stat(path);
  if (!node) {
    await dialogs.alert({ appId: 'finder', title: { en: `The folder “${raw}” can’t be found.`, ko: `“${raw}” 폴더를 찾을 수 없습니다.` } });
    return;
  }
  if (node.type === 'dir') wm.openWindow('finder', { path });
  else revealInFinder(path);
}

/**
 * Creates a menu action that opens a new Finder window on a folder.
 *
 * The returned function calls `wm.openWindow('finder', { path })` each time it runs, so every
 * use of the Go menu item opens a fresh window rather than reusing an existing one.
 *
 * @param {string} path - The folder (or Finder location such as Recents) to open.
 * @returns {() => void} An action that opens the Finder window when called.
 *
 * @example
 * const item: MenuItem = { label: DS.home, action: goTo(HOME) };
 */
const goTo = (path: string) => () => void wm.openWindow('finder', { path });

/**
 * Builds Finder's menu bar for when the desktop is key.
 *
 * Returns the File, Edit, View and Go menus with items enabled according to the selection and
 * clipboard state. Quick Look has no shortcut here because the desktop handles Space itself, so it
 * cannot fire while a control has focus. The Go menu uses the same shortcuts as a Finder window.
 *
 * @param {DesktopApi} api - The desktop actions the items call.
 * @param {DesktopMenuState} s - Selection and clipboard state that enables or relabels items.
 * @returns {MenuDef[]} The app menus for the menu bar.
 *
 * @example
 * const menus = buildDesktopMenuBar(menuApi, { count: 1, canRename: true, canTrash: true, clipboard: 0, trashCount: 2, quickLookName: 'Notes.txt' });
 */
export function buildDesktopMenuBar(api: DesktopApi, s: DesktopMenuState): MenuDef[] {
  return [
    {
      label: COMMON.file,
      items: [
        { label: DS.newFinderWindow, shortcut: 'alt+n', action: () => void wm.openWindow('finder') },
        { label: COMMON.newFolder, shortcut: 'alt+shift+n', action: () => api.newFolder() },
        { label: COMMON.open, shortcut: 'mod+o', disabled: !s.count, action: api.open },
        { label: COMMON.closeWindow, shortcut: 'alt+w', disabled: true },
        sep,
        { label: COMMON.getInfo, shortcut: 'mod+i', action: api.getInfo },
        { label: COMMON.rename, disabled: !s.canRename, action: api.rename },
        { label: DS.duplicate, shortcut: 'mod+d', disabled: !s.count, action: api.duplicate },
        { label: quickLookLabel(s.count === 1 ? s.quickLookName : null), disabled: !s.count, action: api.quickLook },
        sep,
        { label: COMMON.moveToTrash, shortcut: 'mod+backspace', disabled: !s.canTrash, action: api.trash },
        { label: DS.emptyTrash, shortcut: 'mod+shift+backspace', disabled: !s.trashCount, action: () => void emptyTrashWithConfirm() },
        sep,
        { label: DS.importFiles, action: api.importFiles },
      ],
    },
    {
      label: COMMON.edit,
      items: [
        { label: COMMON.undo, shortcut: 'mod+z', disabled: true },
        { label: COMMON.redo, shortcut: 'mod+shift+z', disabled: true },
        sep,
        { label: COMMON.cut, shortcut: 'mod+x', disabled: true },
        { label: COMMON.copy, shortcut: 'mod+c', disabled: !s.count, action: api.copy },
        { label: pasteLabel(s.clipboard), shortcut: 'mod+v', disabled: !s.clipboard, action: () => api.paste(false) },
        { label: DS.moveItemHere, shortcut: 'mod+alt+v', disabled: !s.clipboard, action: () => api.paste(true) },
        { label: COMMON.selectAll, shortcut: 'mod+a', action: api.selectAll },
      ],
    },
    {
      label: COMMON.view,
      items: [
        { label: DS.cleanUp, action: api.cleanUp },
        { label: DS.sortBy, submenu: sortItems(api) },
        sep,
        { label: DS.useStacks, disabled: true },
        { label: DS.showViewOptions, shortcut: 'mod+j', disabled: true },
        sep,
        { label: DS.editWidgets, action: api.editWidgets },
      ],
    },
    {
      label: COMMON.go,
      items: [
        { label: DS.recents, shortcut: 'mod+shift+f', action: goTo(RECENTS) },
        { label: DS.documents, shortcut: 'mod+shift+o', action: goTo(PATHS.documents) },
        { label: DS.desktop, shortcut: 'mod+shift+d', action: goTo(PATHS.desktop) },
        { label: DS.downloads, shortcut: 'mod+alt+l', action: goTo(PATHS.downloads) },
        { label: DS.home, shortcut: 'mod+shift+h', action: goTo(HOME) },
        { label: DS.computer, action: goTo('/') },
        { label: DS.applications, shortcut: 'mod+shift+a', action: goTo(PATHS.applications) },
        sep,
        { label: DS.goToFolder, shortcut: 'mod+shift+g', action: () => void goToFolder() },
      ],
    },
  ];
}

/**
 * Wraps every menu action so it does nothing while `blocked()` is true.
 *
 * The shell dispatches menu shortcuts globally, so this keeps e.g. ⌘D from duplicating desktop
 * icons while the user is typing in Spotlight. Submenus are wrapped recursively; items without an
 * action keep `action` undefined. `blocked` is evaluated each time an action runs.
 *
 * @param {MenuDef[]} menus - The menus to wrap.
 * @param {() => boolean} blocked - Returns true while actions must be ignored.
 * @returns {MenuDef[]} New menus with guarded actions (the input is not mutated).
 *
 * @example
 * const guarded = guardActions(buildDesktopMenuBar(menuApi, state), typingElsewhere);
 */
export function guardActions(menus: MenuDef[], blocked: () => boolean): MenuDef[] {
  /**
   * Returns copies of menu items whose actions (and submenu actions) check `blocked` first.
   *
   * Each item is shallow-copied; its action is replaced by one that runs the original only when
   * `blocked()` returns false, and its submenu is wrapped recursively.
   *
   * @param {MenuItem[]} items - The items to wrap.
   * @returns {MenuItem[]} The wrapped items.
   *
   * @example
   * const items = wrap(menu.items);
   */
  const wrap = (items: MenuItem[]): MenuItem[] =>
    items.map((it) => {
      const action = it.action;
      return {
        ...it,
        action:
          action &&
          (() => {
            if (!blocked()) action();
          }),
        submenu: it.submenu && wrap(it.submenu),
      };
    });
  return menus.map((m) => ({ ...m, items: wrap(m.items) }));
}

/**
 * Builds the context menu shown when right-clicking the wallpaper.
 *
 * Includes New Folder (placed at the clicked cell), a Paste item only when the file clipboard
 * holds items, Get Info on the Desktop folder, wallpaper and widget shortcuts, and the sort and
 * clean-up commands.
 *
 * @param {DesktopApi} api - The desktop actions the items call.
 * @param {Cell} at - The grid cell under the pointer, where a new folder is placed.
 * @param {number} clipboard - Number of items on the file clipboard.
 * @returns {MenuItem[]} The context menu items.
 *
 * @example
 * showContextMenu(e, buildDesktopContextMenu(menuApi, cellAtPoint(metrics, e.clientX, e.clientY), clipboardCount));
 */
export function buildDesktopContextMenu(api: DesktopApi, at: Cell, clipboard: number): MenuItem[] {
  return [
    { label: COMMON.newFolder, action: () => api.newFolder(at) },
    ...(clipboard ? [{ label: pasteLabel(clipboard), action: () => api.paste(false) }] : []),
    sep,
    { label: COMMON.getInfo, action: () => openGetInfo(PATHS.desktop) },
    { label: DS.changeWallpaper, action: () => void wm.launch('settings', { pane: 'wallpaper' }) },
    { label: DS.editWidgets, action: api.editWidgets },
    sep,
    { label: DS.useStacks, disabled: true },
    { label: DS.sortBy, submenu: sortItems(api) },
    { label: DS.cleanUp, action: api.cleanUp },
    { label: DS.showViewOptions, disabled: true },
    sep,
    { label: DS.importFiles, action: api.importFiles },
  ];
}

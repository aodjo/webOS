/**
 * High-level file actions shared by Finder, the Desktop, the Dock and Spotlight, so every
 * surface behaves identically (same dialogs, same error messages, same context menus).
 */
import type { MenuItem } from './types';
import { fs, FSError, kindOf, useFS } from './fs';
import { wm } from './wm';
import { dialogs } from './dialogs';
import { fileClipboard } from './clipboard';
import { downloadFile } from './io';
import { appsThatOpen, defaultAppFor } from './registry';
import { basename, dirname, extname, isWithin, join } from './path';
import { PATHS } from './constants';
import { t } from './i18n';
import { useSystem } from './system';

/**
 * Converts an error into a user-facing message.
 *
 * Known `FSError` codes (EPERM, EEXIST, EINVAL, ENOENT, ENOTEMPTY) map to Finder-style localized
 * sentences; other FS errors fall back to their own message. Non-FS errors use `Error.message`
 * or their string form.
 *
 * @param {unknown} e - The caught error.
 * @returns {string} A message in the current locale.
 *
 * @example
 * errorMessage(new FSError('EEXIST', '/tmp/a')); // "An item with that name already exists."
 */
function errorMessage(e: unknown): string {
  if (e instanceof FSError) {
    const map: Record<string, { en: string; ko: string }> = {
      EPERM: { en: 'You don’t have permission to change this item.', ko: '이 항목을 변경할 권한이 없습니다.' },
      EEXIST: { en: 'An item with that name already exists.', ko: '같은 이름의 항목이 이미 존재합니다.' },
      EINVAL: { en: 'That name is not valid.', ko: '사용할 수 없는 이름입니다.' },
      ENOENT: { en: 'The item can’t be found.', ko: '항목을 찾을 수 없습니다.' },
      ENOTEMPTY: { en: 'The folder is not empty.', ko: '폴더가 비어 있지 않습니다.' },
    };
    return t(map[e.code] ?? { en: e.message, ko: e.message });
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Shows the standard "The operation can't be completed." alert for an error.
 *
 * The alert's message comes from `errorMessage`. With `windowId` it appears as a sheet on that
 * window, otherwise as a system modal.
 *
 * @async
 * @param {unknown} e - The caught error.
 * @param {string} [windowId] - Window to attach the alert to.
 * @returns {Promise<void>} Resolves once the user dismissed the alert.
 *
 * @example
 * try { fs.mkdir(path); } catch (e) { await showFSError(e, windowId); }
 */
export async function showFSError(e: unknown, windowId?: string): Promise<void> {
  await dialogs.alert({ windowId, title: { en: 'The operation can’t be completed.', ko: '작업을 완료할 수 없습니다.' }, message: errorMessage(e) });
}

/**
 * Opens the Finder "Get Info" window for a path.
 *
 * Opens a fixed-size, non-resizable Finder window in its `info` view, titled with the item name.
 *
 * @param {string} path - Absolute path of the item.
 * @returns {void}
 *
 * @example
 * openGetInfo('/Users/me/Desktop/photo.png');
 */
export function openGetInfo(path: string): void {
  wm.openWindow('finder', { view: 'info', path }, { width: 290, height: 520, titlebar: 'standard', resizable: false, maximizable: false, title: basename(path) });
}

/**
 * Opens a Finder window at the item's folder with the item selected.
 *
 * Always opens a new Finder window on the parent folder (`dirname(path)`) and passes the item as
 * the window's initial selection.
 *
 * @param {string} path - Absolute path of the item to reveal.
 * @returns {void}
 *
 * @example
 * revealInFinder('/Users/me/Documents/report.md');
 */
export function revealInFinder(path: string): void {
  wm.openWindow('finder', { path: dirname(path), select: [path] });
}

/**
 * Opens each path with its default app.
 *
 * Delegates to `wm.openPath`, so folders open in Finder and files in their handler app.
 *
 * @param {string[]} paths - Absolute paths to open.
 * @returns {void}
 *
 * @example
 * openPaths(selection);
 */
export function openPaths(paths: string[]): void {
  for (const p of paths) wm.openPath(p);
}

/**
 * Moves items to the Trash, or deletes them permanently if they are already in it.
 *
 * When any of the items is inside the Trash, a destructive confirmation is shown first and
 * nothing happens if the user cancels. Each item is then passed to `fs.trash` (which deletes
 * items already in the Trash). The first failure shows an error alert and stops processing the
 * remaining items.
 *
 * @async
 * @param {string[]} paths - Absolute paths of the items.
 * @param {string} [windowId] - Window to attach dialogs to.
 * @returns {Promise<void>} Resolves when done or cancelled.
 *
 * @example
 * await trashPaths(selection, windowId);
 */
export async function trashPaths(paths: string[], windowId?: string): Promise<void> {
  const inTrash = paths.filter((p) => isWithin(p, PATHS.trash) && p !== PATHS.trash);
  if (inTrash.length) {
    const ok = await dialogs.confirm({
      windowId,
      title: inTrash.length === 1 ? { en: `Are you sure you want to delete “${basename(inTrash[0])}” immediately?`, ko: `“${basename(inTrash[0])}” 항목을 즉시 삭제하겠습니까?` } : { en: `Delete ${inTrash.length} items immediately?`, ko: `${inTrash.length}개 항목을 즉시 삭제하겠습니까?` },
      message: { en: 'You can’t undo this action.', ko: '이 동작은 실행 취소할 수 없습니다.' },
      okLabel: { en: 'Delete', ko: '삭제' },
      danger: true,
    });
    if (!ok) return;
  }
  for (const p of paths) {
    try {
      fs.trash(p);
    } catch (e) {
      await showFSError(e, windowId);
      return;
    }
  }
}

/**
 * Empties the Trash after asking the user to confirm.
 *
 * Does nothing when the Trash is empty. After the confirmation, if the Trash holds locked items,
 * a second alert (like Finder's) offers Stop (keep everything), Remove Unlocked Items or Remove
 * All; the choice decides whether `fs.emptyTrash` also erases locked items.
 *
 * @async
 * @param {string} [windowId] - Window to attach the dialogs to.
 * @returns {Promise<void>} Resolves when the Trash was emptied or the user cancelled.
 *
 * @example
 * await emptyTrashWithConfirm();
 */
export async function emptyTrashWithConfirm(windowId?: string): Promise<void> {
  const n = fs.trashCount();
  if (!n) return;
  const ok = await dialogs.confirm({
    windowId,
    title: { en: 'Are you sure you want to permanently erase the items in the Trash?', ko: '휴지통에 있는 항목을 영구적으로 지우겠습니까?' },
    message: { en: 'You can’t undo this action.', ko: '이 동작은 실행 취소할 수 없습니다.' },
    okLabel: { en: 'Empty Trash', ko: '휴지통 비우기' },
    danger: true,
  });
  if (!ok) return;
  let includeLocked = false;
  if (fs.lockedInTrash() > 0) {
    const choice = await dialogs.alert({
      windowId,
      title: { en: 'Some items in the Trash are locked. Do you want to remove all items, including locked ones?', ko: '휴지통에 있는 일부 항목이 잠겨 있습니다. 잠긴 항목을 포함한 모든 항목을 제거하겠습니까?' },
      buttons: [
        { label: { en: 'Stop', ko: '중단' }, value: 'stop', cancel: true },
        { label: { en: 'Remove Unlocked Items', ko: '잠기지 않은 항목 제거' }, value: 'unlocked' },
        { label: { en: 'Remove All', ko: '모두 제거' }, value: 'all', primary: true, danger: true },
      ],
    });
    if (choice === 'stop') return;
    includeLocked = choice === 'all';
  }
  fs.emptyTrash({ includeLocked });
}

/**
 * Restores items from the Trash to where they came from.
 *
 * Calls `fs.restore` for each item; a failure shows an error alert (not awaited) and the
 * remaining items are still processed.
 *
 * @param {string[]} paths - Absolute paths of items inside the Trash.
 * @returns {void}
 *
 * @example
 * putBack(['/Users/me/.Trash/notes.txt']);
 */
export function putBack(paths: string[]): void {
  for (const p of paths) {
    try {
      fs.restore(p);
    } catch (e) {
      void showFSError(e);
    }
  }
}

/**
 * Creates a new "untitled folder" in a directory.
 *
 * The localized name is made unique within `dir` ("untitled folder 2", …). Errors are shown in
 * an alert instead of being thrown.
 *
 * @param {string} dir - Absolute path of the parent folder.
 * @param {string} [windowId] - Window to attach an error alert to.
 * @returns {string | null} Path of the new folder, or null on error.
 *
 * @example
 * const path = newFolder(PATHS.desktop);
 * if (path) startRename(path);
 */
export function newFolder(dir: string, windowId?: string): string | null {
  try {
    const name = fs.uniqueName(dir, t({ en: 'untitled folder', ko: '무제 폴더' }), true);
    return fs.mkdir(join(dir, name)).path;
  } catch (e) {
    void showFSError(e, windowId);
    return null;
  }
}

/**
 * Duplicates items next to themselves.
 *
 * Each copy gets a Finder-style name ("file copy.txt") via `fs.duplicate`. A failure shows an
 * error alert and the remaining items are still processed.
 *
 * @param {string[]} paths - Absolute paths of the items to duplicate.
 * @returns {string[]} Paths of the copies that were created.
 *
 * @example
 * const copies = duplicatePaths(selection);
 */
export function duplicatePaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    try {
      out.push(fs.duplicate(p));
    } catch (e) {
      void showFSError(e);
    }
  }
  return out;
}

/**
 * Rejects names that start with a dot, like Finder does.
 *
 * A leading dot would make the item invisible, so when the trimmed `name` starts with "." the
 * macOS "You can't use a name that begins with a dot" alert is shown (not awaited). Use it for
 * every user-facing rename or new-item name; the terminal can still create dotfiles.
 *
 * @param {string} name - The proposed name.
 * @param {string} [windowId] - Window to attach the alert to.
 * @returns {boolean} True when the name was rejected and the alert was shown.
 *
 * @example
 * if (dotNameError(input, windowId)) return;
 */
export function dotNameError(name: string, windowId?: string): boolean {
  if (!name.trim().startsWith('.')) return false;
  void dialogs.alert({
    windowId,
    title: { en: 'You can’t use a name that begins with a dot “.”', ko: '마침표(“.”)로 시작하는 이름은 사용할 수 없습니다.' },
    message: { en: 'These names are reserved for the system. Please choose another name.', ko: '이러한 이름은 시스템용으로 예약되어 있습니다. 다른 이름을 선택하십시오.' },
  });
  return true;
}

/**
 * Renames an item, reporting problems in dialogs.
 *
 * The new name is trimmed; an empty or unchanged name is a no-op, and dot names are rejected via
 * `dotNameError`. FS errors (name taken, protected item, …) are shown in an alert.
 *
 * @param {string} path - Absolute path of the item.
 * @param {string} newName - The new file name (not a path).
 * @param {string} [windowId] - Window to attach dialogs to.
 * @returns {string | null} The item's new path, or null when nothing was renamed.
 *
 * @example
 * const next = renamePath('/Users/me/Desktop/a.txt', 'b.txt');
 */
export function renamePath(path: string, newName: string, windowId?: string): string | null {
  const name = newName.trim();
  if (!name || name === basename(path)) return null;
  if (dotNameError(name, windowId)) return null;
  try {
    return fs.rename(path, name).path;
  } catch (e) {
    void showFSError(e, windowId);
    return null;
  }
}

/**
 * Moves (or copies) dropped items into a folder.
 *
 * Items dropped onto themselves or into their own subfolder are skipped. Dropping into the Trash
 * (without `copy`) trashes the items. Otherwise items are copied when `copy` is set or when they
 * are protected (they cannot be moved), and moved with a unique name otherwise. Each failure
 * shows an error alert and the remaining items are still processed.
 *
 * @param {string[]} paths - Absolute paths of the dropped items.
 * @param {string} dir - Absolute path of the target folder.
 * @param {Object} [opts={}] - Drop options.
 * @param {boolean} [opts.copy] - Copy instead of move (e.g. ⌥-drag or a paste after ⌘C).
 * @returns {string[]} Resulting paths of the moved or copied items (trashed items are not included).
 *
 * @example
 * dropInto(getDragPaths(e), PATHS.documents, { copy: e.altKey });
 */
export function dropInto(paths: string[], dir: string, opts: { copy?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (p === dir || isWithin(dir, p)) continue;
    try {
      if (isWithin(dir, PATHS.trash) && !opts.copy) {
        fs.trash(p);
        continue;
      }
      if (opts.copy || fs.isProtected(p)) out.push(fs.duplicate(p, dir));
      else out.push(fs.moveInto(p, dir));
    } catch (e) {
      void showFSError(e);
    }
  }
  return out;
}

/**
 * Pastes the files on the file clipboard into a folder (⌘V).
 *
 * Clipboard paths that do not exist are skipped. Copied items are duplicated and cut items are
 * moved (via `dropInto`); after a cut the clipboard is cleared.
 *
 * @param {string} dir - Absolute path of the target folder.
 * @returns {string[]} Paths of the pasted items, or an empty array when the clipboard is empty.
 *
 * @example
 * const pasted = pasteInto(currentDir);
 * setSelection(pasted);
 */
export function pasteInto(dir: string): string[] {
  const { paths, mode } = fileClipboard.get();
  if (!paths.length) return [];
  const existing = paths.filter((p) => fs.exists(p));
  const out = dropInto(existing, dir, { copy: mode === 'copy' });
  if (mode === 'cut') fileClipboard.clear();
  return out;
}

/**
 * Uses an image file as the desktop picture.
 *
 * Stores the absolute path in the `wallpaper` system setting.
 *
 * @param {string} path - Absolute path of an image file.
 * @returns {void}
 *
 * @example
 * setDesktopPicture('/Users/me/Pictures/beach.jpg');
 */
export function setDesktopPicture(path: string): void {
  useSystem.getState().updateSettings({ wallpaper: path });
}

const FOLLOWED_SETTINGS = ['wallpaper', 'avatar'] as const; /** Settings holding an FS path that follows the file when it moves. */

/**
 * Updates path-valued settings whose file was renamed or moved.
 *
 * For each setting in `FOLLOWED_SETTINGS` holding an absolute path that does not exist, looks
 * up the file's new location with `fs.movedTo` (which also follows moves to the Trash) and saves
 * it, so every consumer reading the setting stays in sync. Files that were deleted keep the old
 * path and consumers fall back to their defaults. Runs on every change of the FS tree.
 *
 * @returns {void}
 *
 * @example
 * useFS.subscribe((next, prev) => {
 *   if (next.nodes !== prev.nodes) followMovedSettingFiles();
 * });
 */
function followMovedSettingFiles(): void {
  const settings = useSystem.getState().settings;
  const patch: Partial<Record<(typeof FOLLOWED_SETTINGS)[number], string>> = {};
  for (const key of FOLLOWED_SETTINGS) {
    const v = settings[key];
    if (typeof v !== 'string' || !v.startsWith('/') || fs.exists(v)) continue;
    const to = fs.movedTo(v);
    if (to) patch[key] = to;
  }
  if (Object.keys(patch).length) useSystem.getState().updateSettings(patch);
}
useFS.subscribe((next, prev) => {
  if (next.nodes !== prev.nodes) followMovedSettingFiles();
});

/**
 * Builds the standard context menu for one or more selected items (Finder and Desktop).
 *
 * Items inside the Trash get Put Back / Delete Immediately / Empty Trash / Get Info. Other
 * selections get Open, Open With (single non-app file that some app can open; the default
 * app is marked), Move to Trash (disabled for protected items), Get Info, Rename
 * (single, unprotected, and only when `onRename` is given), Duplicate (not for apps) and Copy,
 * plus Download (single non-app file), Set Desktop Picture (single image) and Show in Enclosing
 * Folder (when `showReveal`). Returns an empty menu when the selection is empty or the first
 * path does not exist.
 *
 * @param {string[]} paths - Absolute paths of the selected items.
 * @param {Object} [opts={}] - Menu options.
 * @param {(path: string) => void} [opts.onRename] - Starts inline renaming in the calling view.
 * @param {string} [opts.windowId] - Window to attach dialogs to.
 * @param {boolean} [opts.showReveal] - Add "Show in Enclosing Folder" (e.g. in search results).
 * @returns {MenuItem[]} The menu items.
 *
 * @example
 * showContextMenu(e, fileContextMenu(selection, { onRename: startRename, windowId }));
 */
export function fileContextMenu(paths: string[], opts: { onRename?: (path: string) => void; windowId?: string; showReveal?: boolean } = {}): MenuItem[] {
  if (!paths.length) return [];
  const first = fs.stat(paths[0]);
  if (!first) return [];
  const single = paths.length === 1;
  const inTrash = paths.every((p) => isWithin(p, PATHS.trash) && p !== PATHS.trash);
  const locked = paths.some((p) => fs.isProtected(p));
  const isApp = first.type === 'file' && extname(first.name) === 'app';
  const sep: MenuItem = { separator: true };

  if (inTrash) {
    return [
      { label: { en: 'Put Back', ko: '되돌려 놓기' }, action: () => putBack(paths) },
      { label: { en: 'Delete Immediately…', ko: '즉시 삭제…' }, danger: true, action: () => void trashPaths(paths, opts.windowId) },
      sep,
      { label: { en: 'Empty Trash', ko: '휴지통 비우기' }, action: () => void emptyTrashWithConfirm(opts.windowId) },
      sep,
      { label: { en: 'Get Info', ko: '정보 가져오기' }, action: () => paths.forEach(openGetInfo) },
    ];
  }

  const handlers = single && first.type === 'file' && !isApp ? appsThatOpen(first.name) : [];
  const def = single ? defaultAppFor(first.name, first.type === 'dir') : undefined;

  const items: MenuItem[] = [
    { label: { en: 'Open', ko: '열기' }, action: () => openPaths(paths) },
  ];
  if (handlers.length) {
    items.push({
      label: { en: 'Open With', ko: '다음으로 열기' },
      submenu: handlers.map((a) => ({
        label: a.id === def ? `${t(a.name)} ${t({ en: '(default)', ko: '(기본)' })}` : t(a.name),
        action: () => wm.openPath(first.path, a.id),
      })),
    });
  }
  items.push(sep, { label: { en: 'Move to Trash', ko: '휴지통으로 이동' }, disabled: locked, action: () => void trashPaths(paths, opts.windowId) }, sep);
  items.push(
    { label: { en: 'Get Info', ko: '정보 가져오기' }, action: () => paths.forEach(openGetInfo) },
    { label: { en: 'Rename', ko: '이름 변경' }, disabled: !single || locked || !opts.onRename, action: () => opts.onRename?.(first.path) },
    { label: { en: 'Duplicate', ko: '복제' }, disabled: isApp, action: () => void duplicatePaths(paths) },
    sep,
    { label: single ? { en: `Copy “${first.name}”`, ko: `“${first.name}” 복사하기` } : { en: `Copy ${paths.length} Items`, ko: `${paths.length}개 항목 복사하기` }, action: () => fileClipboard.copy(paths) },
  );
  if (single && first.type === 'file' && !isApp) items.push({ label: { en: 'Download to This Computer', ko: '이 컴퓨터로 다운로드' }, action: () => downloadFile(first.path) });
  if (single && first.type === 'file' && kindOf(first) === 'image') items.push(sep, { label: { en: 'Set Desktop Picture', ko: '데스크탑 사진 설정' }, action: () => setDesktopPicture(first.path) });
  if (opts.showReveal) items.push(sep, { label: { en: 'Show in Enclosing Folder', ko: '상위 폴더에서 보기' }, action: () => revealInFinder(first.path) });
  return items;
}

/**
 * File operations performed from Finder. They wrap the shared kernel actions (same dialogs and
 * error messages as the Desktop) and record an app-wide undo entry, so Edit ▸ Undo (⌘Z) can
 * revert moves, renames, trashing, new folders and copies like the real Finder.
 */
import { create } from 'zustand';
import type { LString } from '@/kernel';
import {
  PATHS,
  basename,
  dirname,
  dropInto,
  duplicatePaths,
  fileClipboard,
  fs,
  isWithin,
  join,
  newFolder,
  renamePath,
  showFSError,
  trashPaths,
} from '@/kernel';
import { S } from './strings';

/** One undoable Finder operation. */
interface UndoEntry {
  /** Operation name shown in the Edit menu ("Undo Move"). */
  label: LString;
  /** Reverts the operation. */
  run: () => void;
}

/** State of the Finder undo store. */
interface UndoState {
  /** Undo entries, most recent last. */
  stack: UndoEntry[];
}

export const useUndo = create<UndoState>()(() => ({ stack: [] })); /** App-wide Finder undo stack shared by every Finder window. */

/**
 * Records an undoable operation.
 *
 * Appends the entry to the undo stack, keeping only the 30 most recent entries.
 *
 * @param {LString} label - Operation name shown in the Edit menu.
 * @param {() => void} run - Callback that reverts the operation.
 * @returns {void}
 *
 * @example
 * pushUndo(S.undoRename, () => fs.rename(next, oldName));
 */
function pushUndo(label: LString, run: () => void): void {
  useUndo.setState((s) => ({ stack: [...s.stack.slice(-29), { label, run }] }));
}

/**
 * Undoes the most recent Finder operation (Edit ▸ Undo).
 *
 * Pops the top entry and runs it. Errors raised while reverting are shown in an alert (a sheet
 * on `windowId` when given). Does nothing when the stack is empty.
 *
 * @param {string} [windowId] - Window that hosts the error sheet.
 * @returns {void}
 *
 * @example
 * ops.rename(`${PATHS.documents}/a.txt`, 'b.txt');
 * undoLast(); // a.txt is back
 */
export function undoLast(windowId?: string): void {
  const stack = useUndo.getState().stack;
  const top = stack.at(-1);
  if (!top) return;
  useUndo.setState({ stack: stack.slice(0, -1) });
  try {
    top.run();
  } catch (e) {
    void showFSError(e, windowId);
  }
}

/**
 * Finds where an item that was at `original` ended up inside the Trash.
 *
 * Looks at the top level of the Trash for entries whose `trashedFrom` meta matches and picks
 * the most recently modified one.
 *
 * @param {string} original - Path the item had before it was trashed.
 * @returns {string | null} Its path inside the Trash, or null when not found.
 *
 * @example
 * trashedLocation('/Users/me/Documents/a.txt'); // '/Users/me/.Trash/a.txt'
 */
function trashedLocation(original: string): string | null {
  if (!fs.isDir(PATHS.trash)) return null;
  const matches = fs.readdir(PATHS.trash).filter((n) => n.meta?.trashedFrom === original);
  matches.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return matches[0]?.path ?? null;
}

/**
 * Moves items out of the way to the Trash, as the inverse of a copy.
 *
 * Paths that no longer exist are skipped.
 *
 * @param {string[]} paths - Items to trash.
 * @returns {void}
 * @throws {FSError} When an item cannot be trashed (for example a protected or locked item).
 *
 * @example
 * trashIfExists(['/Users/me/Desktop/a 2.txt']);
 */
function trashIfExists(paths: string[]): void {
  for (const p of paths) if (fs.exists(p)) fs.trash(p);
}

export const ops = {
  /**
   * Moves items to the Trash, or deletes items already in it.
   *
   * Delegates to the kernel's `trashPaths`, which asks for confirmation before deleting items
   * that are already in the Trash and reports errors. Items that left their original location
   * are located in the Trash and an undo entry that restores them is recorded.
   *
   * @async
   * @param {string[]} paths - Items to trash.
   * @param {string} [windowId] - Window that hosts dialogs and error sheets.
   * @returns {Promise<void>} Resolves once the operation (and any confirmation) has finished.
   *
   * @example
   * await ops.trash([`${PATHS.documents}/a.txt`], windowId);
   */
  async trash(paths: string[], windowId?: string): Promise<void> {
    if (!paths.length) return;
    await trashPaths(paths, windowId);
    const moved = paths.filter((p) => !isWithin(p, PATHS.trash) && !fs.exists(p)).map(trashedLocation).filter((p): p is string => !!p);
    if (moved.length) pushUndo(S.undoTrash, () => moved.forEach((p) => fs.exists(p) && fs.restore(p)));
  },

  /**
   * Puts items in the Trash back where they came from (File ▸ Put Back).
   *
   * Restores items in order and stops at the first failure, showing its error. An undo entry
   * that moves the restored items back to the Trash is recorded.
   *
   * @param {string[]} paths - Items inside the Trash.
   * @param {string} [windowId] - Window that hosts the error sheet.
   * @returns {string[]} The restored paths.
   *
   * @example
   * const restored = ops.putBack([`${PATHS.trash}/a.txt`]);
   * console.log(restored); // ['/Users/me/Documents/a.txt']
   */
  putBack(paths: string[], windowId?: string): string[] {
    const restored: string[] = [];
    for (const p of paths) {
      try {
        restored.push(fs.restore(p));
      } catch (e) {
        void showFSError(e, windowId);
        break;
      }
    }
    if (restored.length) pushUndo(S.undoPutBack, () => trashIfExists(restored));
    return restored;
  },

  /**
   * Renames an item.
   *
   * Uses the kernel's `renamePath`, which ignores unchanged names, refuses dot names and shows
   * errors. On success an undo entry that restores the old name is recorded.
   *
   * @param {string} path - Item to rename.
   * @param {string} name - New name.
   * @param {string} [windowId] - Window that hosts alerts.
   * @returns {string | null} The new path, or null when nothing was renamed.
   *
   * @example
   * ops.rename(`${PATHS.documents}/a.txt`, 'b.txt'); // '/Users/me/Documents/b.txt'
   */
  rename(path: string, name: string, windowId?: string): string | null {
    const next = renamePath(path, name, windowId);
    if (next) {
      const oldName = basename(path);
      pushUndo(S.undoRename, () => fs.exists(next) && fs.rename(next, oldName));
    }
    return next;
  },

  /**
   * Creates an "untitled folder" in a folder.
   *
   * The undo entry removes the folder again: it is deleted when empty and moved to the Trash
   * when something was put into it meanwhile.
   *
   * @param {string} dir - Parent folder.
   * @param {string} [windowId] - Window that hosts the error sheet.
   * @returns {string | null} Path of the new folder, or null on failure.
   *
   * @example
   * const folder = ops.newFolder(PATHS.desktop);
   */
  newFolder(dir: string, windowId?: string): string | null {
    const path = newFolder(dir, windowId);
    if (path) pushUndo(S.undoNewFolder, () => fs.exists(path) && (fs.readdir(path).length ? fs.trash(path) : fs.rm(path)));
    return path;
  },

  /**
   * Creates a folder and moves the given items into it (New Folder with Selection).
   *
   * The undo entry moves the items back in reverse order and deletes the folder if it ended up
   * empty.
   *
   * @param {string[]} paths - Items to move into the new folder.
   * @param {string} dir - Folder in which the new folder is created.
   * @param {string} [windowId] - Window that hosts the error sheet.
   * @returns {string | null} Path of the new folder, or null when it could not be created.
   *
   * @example
   * const folder = ops.newFolderWithItems(selection, PATHS.documents, windowId);
   */
  newFolderWithItems(paths: string[], dir: string, windowId?: string): string | null {
    const folder = newFolder(dir, windowId);
    if (!folder) return null;
    const moves = ops.moveRaw(paths, folder, false);
    pushUndo(S.undoNewFolder, () => {
      for (const [from, to] of [...moves].reverse()) if (fs.exists(to) && !fs.exists(from)) fs.move(to, from);
      if (fs.exists(folder) && !fs.readdir(folder).length) fs.rm(folder);
    });
    return folder;
  },

  /**
   * Duplicates items next to themselves ("a copy").
   *
   * The undo entry moves the duplicates to the Trash.
   *
   * @param {string[]} paths - Items to duplicate.
   * @returns {string[]} Paths of the duplicates that were created.
   *
   * @example
   * ops.duplicate([`${PATHS.documents}/a.txt`]); // ['/Users/me/Documents/a copy.txt']
   */
  duplicate(paths: string[]): string[] {
    const out = duplicatePaths(paths);
    if (out.length) pushUndo(S.undoDuplicate, () => trashIfExists(out));
    return out;
  },

  /**
   * Moves or copies items into a folder without recording undo.
   *
   * Calls the kernel's `dropInto` one item at a time so every result can be paired with its
   * source. Missing items, moves into the item's own folder, and items already inside the Trash
   * dropped on the Trash (which would erase them) are skipped. Because moving an item onto the
   * Trash makes `dropInto` return no path, the item's location inside the Trash is looked up
   * with `trashedLocation` instead.
   *
   * @param {string[]} paths - Items to move or copy.
   * @param {string} dir - Target folder.
   * @param {boolean} copy - Copy instead of move.
   * @returns {[string, string][]} `[source, result]` pairs for every item that was handled.
   *
   * @example
   * const pairs = ops.moveRaw([`${PATHS.documents}/a.txt`], PATHS.desktop, false);
   * console.log(pairs); // [['/Users/me/Documents/a.txt', '/Users/me/Desktop/a.txt']]
   */
  moveRaw(paths: string[], dir: string, copy: boolean): [string, string][] {
    const pairs: [string, string][] = [];
    for (const p of paths) {
      if (!fs.exists(p)) continue;
      if (dir === PATHS.trash && isWithin(p, PATHS.trash)) continue;
      if (!copy && dirname(p) === dir) continue;
      const [result] = dropInto([p], dir, { copy });
      if (result) pairs.push([p, result]);
      else if (dir === PATHS.trash) {
        const tp = trashedLocation(p);
        if (tp) pairs.push([p, tp]);
      }
    }
    return pairs;
  },

  /**
   * Moves or copies items into a folder with undo (drag & drop, paste).
   *
   * A move onto the Trash records an undo entry that puts the items back and returns no paths.
   * Otherwise `dropInto` copies protected items (such as apps) instead of moving them, so
   * sources that still exist afterwards count as copies. The undo entry trashes the copies and
   * moves the moved items back in reverse order; it is labeled "Move" when anything moved and
   * "Copy" otherwise.
   *
   * @param {string[]} paths - Items to move or copy.
   * @param {string} dir - Target folder.
   * @param {boolean} copy - Copy instead of move.
   * @returns {string[]} The resulting paths in `dir` (empty for a move onto the Trash).
   *
   * @example
   * ops.drop([`${PATHS.documents}/a.txt`], PATHS.desktop, false); // ['/Users/me/Desktop/a.txt']
   */
  drop(paths: string[], dir: string, copy: boolean): string[] {
    const pairs = ops.moveRaw(paths, dir, copy);
    if (!pairs.length) return [];
    const copied = pairs.filter(([from]) => fs.exists(from));
    const moved = pairs.filter(([from]) => !fs.exists(from));
    if (dir === PATHS.trash && !copy) {
      const inTrash = moved.map(([, to]) => to);
      pushUndo(S.undoTrash, () => inTrash.forEach((p) => fs.exists(p) && fs.restore(p)));
      return [];
    }
    pushUndo(moved.length ? S.undoMove : S.undoCopy, () => {
      trashIfExists(copied.map(([, to]) => to));
      for (const [from, to] of [...moved].reverse()) if (fs.exists(to) && !fs.exists(from)) fs.move(to, from);
    });
    return pairs.map(([, to]) => to);
  },

  /**
   * Pastes the file clipboard into a folder (⌘V).
   *
   * Copies the clipboard items, or moves them when they were cut elsewhere; a cut clipboard is
   * cleared afterwards. Items that no longer exist are ignored.
   *
   * @param {string} dir - Target folder.
   * @returns {string[]} The resulting paths in `dir`.
   *
   * @example
   * fileClipboard.copy([`${PATHS.documents}/a.txt`]);
   * ops.paste(PATHS.desktop); // ['/Users/me/Desktop/a.txt']
   */
  paste(dir: string): string[] {
    const { paths, mode } = fileClipboard.get();
    const out = ops.drop(paths.filter((p) => fs.exists(p)), dir, mode === 'copy');
    if (mode === 'cut') fileClipboard.clear();
    return out;
  },

  /**
   * Moves the copied items into a folder (⌥⌘V, Move Item Here).
   *
   * Always moves regardless of the clipboard mode, then clears the clipboard.
   *
   * @param {string} dir - Target folder.
   * @returns {string[]} The resulting paths in `dir`.
   *
   * @example
   * ops.moveHere(PATHS.desktop);
   */
  moveHere(dir: string): string[] {
    const { paths } = fileClipboard.get();
    const out = ops.drop(paths.filter((p) => fs.exists(p)), dir, false);
    fileClipboard.clear();
    return out;
  },

  /**
   * Sets or clears the color tag of items.
   *
   * Remembers each existing item's previous tag so the undo entry can restore it.
   *
   * @param {string[]} paths - Items to tag.
   * @param {string | undefined} tag - Tag id, or undefined to remove the tag.
   * @returns {void}
   *
   * @example
   * ops.setTag(selection, 'red');
   */
  setTag(paths: string[], tag: string | undefined): void {
    const before = paths.filter((p) => fs.exists(p)).map((p) => [p, fs.stat(p)?.meta?.tag] as const);
    for (const [p] of before) fs.setMeta(p, { tag });
    pushUndo(S.undoTag, () => before.forEach(([p, prev]) => fs.exists(p) && fs.setMeta(p, { tag: prev })));
  },
}; /** Finder file operations; every one except `moveRaw` pushes an entry that reverts it onto the Finder undo stack. */

/**
 * Resolves a path typed into Go to Folder.
 *
 * Trims the input and trailing slashes (an empty result means "/"). "~" and "~/…" expand to
 * the home folder, absolute paths are normalized, and anything else is resolved relative to
 * the current folder.
 *
 * @param {string} input - The text the user typed.
 * @param {string} cwd - The folder the window currently shows.
 * @returns {string} The normalized absolute path.
 *
 * @example
 * resolveTyped('~/Documents/', '/'); // '/Users/me/Documents'
 * resolveTyped('Desktop', HOME); // '/Users/me/Desktop'
 */
export function resolveTyped(input: string, cwd: string): string {
  const s = input.trim().replace(/\/+$/, '') || '/';
  if (s === '~' || s.startsWith('~/')) return join(PATHS.home, s.slice(1));
  if (s.startsWith('/')) return join(s);
  return join(cwd, s);
}

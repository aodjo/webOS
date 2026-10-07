/**
 * File clipboard shared by Finder and the Desktop (⌘C / ⌘X / ⌘V on files), plus helpers for
 * dragging FS paths with HTML5 drag-and-drop. Text copy/paste uses the real browser clipboard.
 */
import type { DragEvent as ReactDragEvent } from 'react';
import { create } from 'zustand';

/** Contents of the file clipboard. */
interface FileClipboard {
  /** Absolute FS paths that were copied or cut. */
  paths: string[];
  /** `cut` moves the items on paste and clears the clipboard; `copy` duplicates them. */
  mode: 'copy' | 'cut';
}

export const useFileClipboard = create<FileClipboard>()(() => ({ paths: [], mode: 'copy' })); /** Store of the file clipboard (subscribe to enable Paste). */

export const fileClipboard = {
  /**
   * Puts paths on the file clipboard for copying.
   *
   * Replaces any previous clipboard contents; pasting duplicates the items.
   *
   * @param {string[]} paths - Absolute FS paths to copy.
   * @returns {void}
   *
   * @example
   * fileClipboard.copy(['/Users/me/Desktop/notes.txt']);
   */
  copy: (paths: string[]) => useFileClipboard.setState({ paths, mode: 'copy' }),

  /**
   * Puts paths on the file clipboard for moving.
   *
   * Replaces any previous clipboard contents; pasting moves the items and clears the clipboard.
   *
   * @param {string[]} paths - Absolute FS paths to cut.
   * @returns {void}
   *
   * @example
   * fileClipboard.cut(selection);
   */
  cut: (paths: string[]) => useFileClipboard.setState({ paths, mode: 'cut' }),

  /**
   * Empties the file clipboard.
   *
   * Resets the store to no paths in `copy` mode.
   *
   * @returns {void}
   *
   * @example
   * fileClipboard.clear();
   */
  clear: () => useFileClipboard.setState({ paths: [], mode: 'copy' }),

  /**
   * Reads the current file clipboard contents.
   *
   * Returns a non-reactive snapshot; components should use `useFileClipboard` to re-render on
   * changes.
   *
   * @returns {FileClipboard} The copied/cut paths and the clipboard mode.
   *
   * @example
   * const { paths, mode } = fileClipboard.get();
   */
  get: () => useFileClipboard.getState(),
}; /** Imperative API of the file clipboard. */

export const DRAG_MIME = 'application/x-webos-paths'; /** Drag-and-drop MIME type for FS paths dragged between Finder, Desktop, Dock and apps. */

/**
 * Attaches FS paths to a drag operation.
 *
 * Stores the paths as JSON under `DRAG_MIME` (read back by `getDragPaths`), adds a newline-separated
 * `text/plain` fallback for text targets, and allows both copy and move effects. Does nothing when
 * the event has no `dataTransfer`.
 *
 * @param {DragEvent | ReactDragEvent} e - The `dragstart` event (native or React).
 * @param {string[]} paths - Absolute FS paths being dragged.
 * @returns {void}
 *
 * @example
 * <div draggable onDragStart={(e) => setDragPaths(e, selected)} />
 */
export function setDragPaths(e: DragEvent | ReactDragEvent, paths: string[]): void {
  e.dataTransfer?.setData(DRAG_MIME, JSON.stringify(paths));
  e.dataTransfer?.setData('text/plain', paths.join('\n'));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
}

/**
 * Reads the FS paths carried by a drag operation.
 *
 * Parses the JSON stored under `DRAG_MIME`. Browsers only expose drag data on `drop`, so during
 * `dragover` this returns an empty array (use `hasDragPaths` there). Missing or malformed data
 * also yields an empty array.
 *
 * @param {DragEvent | ReactDragEvent} e - The `drop` event (native or React).
 * @returns {string[]} The dragged paths, or an empty array.
 *
 * @example
 * const paths = getDragPaths(e);
 * if (paths.length) dropInto(paths, dir);
 */
export function getDragPaths(e: DragEvent | ReactDragEvent): string[] {
  try {
    const raw = e.dataTransfer?.getData(DRAG_MIME);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Checks whether a drag operation carries FS paths.
 *
 * Inspects only the advertised data types, so it works during `dragenter` / `dragover`, where
 * the data itself is not readable yet.
 *
 * @param {DragEvent | ReactDragEvent} e - A drag event (native or React).
 * @returns {boolean} True when the drag includes `DRAG_MIME` data.
 *
 * @example
 * if (hasDragPaths(e)) e.preventDefault();
 */
export function hasDragPaths(e: DragEvent | ReactDragEvent): boolean {
  return !!e.dataTransfer?.types.includes(DRAG_MIME);
}

/**
 * Checks whether a drag operation carries real files from the host OS.
 *
 * Looks for the browser's `Files` data type, which is present when files are dragged in from
 * outside the page.
 *
 * @param {DragEvent | ReactDragEvent} e - A drag event (native or React).
 * @returns {boolean} True when host files are being dragged.
 *
 * @example
 * if (hasHostFiles(e)) void importHostFiles(e.dataTransfer.files, dir);
 */
export function hasHostFiles(e: DragEvent | ReactDragEvent): boolean {
  return !!e.dataTransfer?.types.includes('Files');
}

import type { DragEvent, MouseEvent } from 'react';
import type { FSNode, Locale } from '@/kernel';

/**
 * Callbacks and shared state handed from the Finder window to its views.
 *
 * All selection, opening, renaming and drag logic lives in the window, so the icon, list, column
 * and gallery views only render items and forward their events here, and all behave the same.
 */
export interface ViewController {
  /** Id of the Finder window that owns the view. */
  windowId: string;
  /** Locale used for names, kinds and dates. */
  locale: Locale;
  /** Whether the window is key (focused): selections are accent colored when true, grey otherwise. */
  active: boolean;
  /** Whether times are formatted with a 24-hour clock. */
  h24: boolean;
  /** Paths of the selected items. */
  selected: ReadonlySet<string>;
  /** Path of the item whose name is being edited inline, or null. */
  renaming: string | null;
  /** Handles a mouse down on an item; `order` is the display order used for ⇧-click ranges. */
  itemMouseDown(e: MouseEvent, path: string, order: string[]): void;
  /** Handles a click (mouse up without a drag) on an item; `onName` is true when its name was hit. */
  itemClick(e: MouseEvent, path: string, onName: boolean): void;
  /** Opens an item: folders navigate (or open a new window with ⌘), files open in their app. */
  itemOpen(e: MouseEvent, node: FSNode): void;
  /** Shows the context menu for an item, selecting it first when it is not already selected. */
  itemContextMenu(e: MouseEvent, path: string): void;
  /** Shows the context menu for the empty area of `dir` (null for virtual locations). */
  backgroundContextMenu(e: MouseEvent, dir: string | null): void;
  /** Replaces the selection with `paths`. */
  setSelection(paths: string[]): void;
  /** Renames the item at `path` to `name` and ends inline renaming. */
  commitRename(path: string, name: string): void;
  /** Ends inline renaming without changing the name. */
  cancelRename(): void;
  /** Starts dragging the item at `path` (with the selection); `ghost` is cloned as the drag image. */
  dragStart(e: DragEvent, path: string, ghost: Element | null): void;
  /** Clears the drag state when a drag ends. */
  dragEnd(): void;
  /** Opens the folder at `path` while a drag hovers over it (spring-loaded folder). */
  springOpen(path: string): void;
  /** Reports that `paths` landed in `dir` after a drop. */
  dropped(paths: string[], dir: string): void;
}

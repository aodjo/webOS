/**
 * Drag & drop for Finder: dragging items out (with a count badge on the drag image), drop
 * targets with highlight + not-allowed feedback, spring-loaded folders, Alt to copy, dropping
 * host files to import them, and dropping documents on an app to open them with it.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { PATHS, extname, fs, getApp, getDragPaths, hasDragPaths, hasHostFiles, importHostFiles, setDragPaths, showFSError, wm } from '@/kernel';
import { canDropInto, isInvalidDrop } from './model';
import { ops } from './ops';

let activeDrag: string[] | null = null; /** Paths of the drag that started in a Finder view, so `dragover` can validate a target before the drop. */
let stopWatching: (() => void) | null = null; /** Removes the window listeners installed by `watchDragEnd`, or null when no drag is being watched. */

/**
 * Starts dragging Finder items.
 *
 * Writes the paths into the drag payload, records them as the active Finder drag (replacing
 * any previous one) and starts watching for the end of the drag. When a source element is
 * given, a cloned drag image with a count badge is centered under the pointer.
 *
 * @param {DragEvent} e - The React `dragstart` event.
 * @param {string[]} paths - Paths of the items being dragged.
 * @param {Element | null} ghostSource - Element to clone as the drag image, or null to keep the browser default.
 * @returns {void}
 *
 * @example
 * onDragStart={(e) => beginItemDrag(e, selection, e.currentTarget.querySelector('.icon'))}
 */
export function beginItemDrag(e: DragEvent, paths: string[], ghostSource: Element | null): void {
  setDragPaths(e, paths);
  endItemDrag();
  activeDrag = paths;
  watchDragEnd();
  if (ghostSource && e.dataTransfer) {
    const ghost = makeGhost(ghostSource, paths.length);
    const r = ghostSource.getBoundingClientRect();
    e.dataTransfer.setDragImage(ghost, Math.round(r.width / 2), Math.round(r.height / 2));
  }
}

/**
 * Marks the active Finder drag as finished.
 *
 * Clears the remembered drag paths and removes the window listeners installed by
 * `watchDragEnd`. Safe to call when no drag is active.
 *
 * @returns {void}
 *
 * @example
 * endItemDrag();
 */
export function endItemDrag(): void {
  activeDrag = null;
  stopWatching?.();
  stopWatching = null;
}

/**
 * Installs window listeners that detect the end of the active drag.
 *
 * `dragend` only reaches React while the source element is still mounted, but spring-loaded
 * folders replace the view mid-drag. Browsers dispatch no mouse events during a drag, so a
 * capturing `dragend` on the window or the first `mousemove`/`pointerdown` afterwards ends the
 * drag. Pointer events within the first 50 ms are ignored because they belong to the gesture
 * that started the drag. The cleanup is stored in `stopWatching`.
 *
 * @returns {void}
 *
 * @example
 * watchDragEnd();
 */
function watchDragEnd(): void {
  const started = performance.now();
  /**
   * Ends the drag on pointer activity that follows the drag start.
   *
   * Events arriving within 50 ms of the start are ignored.
   *
   * @returns {void}
   *
   * @example
   * window.addEventListener('mousemove', onPointer, true);
   */
  const onPointer = () => {
    if (performance.now() - started > 50) endItemDrag();
  };
  window.addEventListener('dragend', endItemDrag, true);
  window.addEventListener('mousemove', onPointer, true);
  window.addEventListener('pointerdown', onPointer, true);
  /**
   * Stops watching for the end of the drag.
   *
   * Removes the capturing `dragend`, `mousemove` and `pointerdown` listeners that this call of
   * `watchDragEnd` installed. `endItemDrag` calls it and then resets `stopWatching` to null.
   *
   * @returns {void}
   *
   * @example
   * stopWatching?.();
   */
  stopWatching = () => {
    window.removeEventListener('dragend', endItemDrag, true);
    window.removeEventListener('mousemove', onPointer, true);
    window.removeEventListener('pointerdown', onPointer, true);
  };
}

/**
 * Returns the Finder drag that is currently being validated.
 *
 * A drag whose items no longer all exist (for example because they were moved by an earlier
 * drop) is ignored and reported as null.
 *
 * @returns {string[] | null} Paths of the active drag, or null when there is none or it is stale.
 *
 * @example
 * const drag = currentDrag();
 * if (drag) console.log(drag.length); // 2
 */
function currentDrag(): string[] | null {
  return activeDrag && activeDrag.every((p) => fs.exists(p)) ? activeDrag : null;
}

/**
 * Builds the drag image for one or more items.
 *
 * Clones `source` into a fixed, off-screen, semi-transparent container of the same size and,
 * when more than one item is dragged, adds a red count badge. The container is appended to the
 * document so the browser can snapshot it and is removed again on the next tick.
 *
 * @param {Element} source - Element to clone (usually the item's icon).
 * @param {number} count - Number of dragged items shown in the badge.
 * @returns {HTMLElement} The off-screen element to pass to `setDragImage`.
 *
 * @example
 * const ghost = makeGhost(iconEl, 3);
 * e.dataTransfer.setDragImage(ghost, 32, 32);
 */
function makeGhost(source: Element, count: number): HTMLElement {
  const r = source.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:fixed;top:-2000px;left:-2000px;width:${r.width}px;height:${r.height}px;pointer-events:none;opacity:0.85;`;
  ghost.appendChild(source.cloneNode(true));
  if (count > 1) {
    const badge = document.createElement('span');
    badge.textContent = String(count);
    badge.style.cssText =
      'position:absolute;top:-6px;right:-8px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--red);color:#fff;font:600 12px/20px var(--font);text-align:center;box-sizing:border-box;';
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 0);
  return ghost;
}

/**
 * Tells whether a drag carries anything Finder can handle.
 *
 * Accepts virtual file system paths and files from the host operating system; other drags
 * (text, links) are ignored so they bubble on untouched.
 *
 * @param {DragEvent} e - The drag event to inspect.
 * @returns {boolean} True when the drag carries FS paths or host files.
 *
 * @example
 * if (!accepts(e)) return;
 */
const accepts = (e: DragEvent) => hasDragPaths(e) || hasHostFiles(e);

/** Options for `useDropTarget`. */
export interface DropTargetOptions {
  /** Folder that receives the drop. Null disables the target (events bubble to the parent). */
  dir: string | null;
  /** Dropping documents on an application opens them with it. */
  appId?: string;
  /** Called with the resulting paths after a successful drop. */
  onDropped?: (paths: string[]) => void;
  /** Spring-loaded folders: called after hovering for a moment during a drag. */
  onSpring?: () => void;
  /** Window used as the parent of error sheets shown while importing host files. */
  windowId?: string;
}

const SPRING_DELAY = 900; /** Milliseconds a drag must hover over a target before its spring-loaded folder opens. */

/**
 * Turns an element into a Finder drop target.
 *
 * Returns drag event handlers to spread on the element plus an `over` flag for the highlight.
 * A depth counter keeps `over` stable while the pointer crosses child elements. Each event is
 * checked against the target's rules (folder must accept drops, the Trash takes only FS items
 * and no protected ones, no drop into itself or a no-op move; an app accepts only documents of
 * types it opens) and refused drags get the "none" drop effect. Hovering for `SPRING_DELAY`
 * calls `onSpring`. Holding Alt copies instead of moving (except onto the Trash). A drop runs
 * `performDrop` and reports the resulting paths to `onDropped`. With `dir` null and no `appId`
 * no handlers are returned, so events bubble to the parent.
 *
 * @param {DropTargetOptions} options - Drop target configuration.
 * @param {string | null} options.dir - Folder that receives the drop, or null.
 * @param {string} [options.appId] - Application that opens dropped documents.
 * @param {(paths: string[]) => void} [options.onDropped] - Called with the resulting paths after a drop.
 * @param {() => void} [options.onSpring] - Called after hovering long enough during a drag.
 * @param {string} [options.windowId] - Window that hosts import error sheets.
 * @returns {{ over: boolean; props: Partial<Record<'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop', (e: DragEvent) => void>> }}
 *   The highlight flag and the handlers to spread on the element.
 *
 * @example
 * const { over, props } = useDropTarget({ dir: PATHS.desktop, onDropped: setSelection });
 * return <div {...props} className={over ? styles.dropping : undefined} />;
 */
export function useDropTarget({ dir, appId, onDropped, onSpring, windowId }: DropTargetOptions) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const springRef = useRef(onSpring);
  useEffect(() => {
    springRef.current = onSpring;
  }, [onSpring]);

  /**
   * Cancels a pending spring-loaded folder timer.
   *
   * Clears the timeout stored in `springTimer` (if any) and resets the ref to null so a new
   * timer can start on the next drag enter. Also runs as the unmount cleanup of the hook.
   *
   * @returns {void}
   *
   * @example
   * clearSpring();
   */
  const clearSpring = () => {
    if (springTimer.current) clearTimeout(springTimer.current);
    springTimer.current = null;
  };
  useEffect(() => clearSpring, []);

  const enabled = dir !== null || !!appId;
  /**
   * Decides whether the current drag may be dropped on this target.
   *
   * For an application target only FS items qualify, and every item of a Finder drag must be
   * a file whose extension the app opens (or the app opens `*`). For a folder target the folder
   * must accept drops; the Trash refuses host files (they can be imported anywhere writable but
   * not straight into the Trash) and protected system items such as apps and standard folders.
   * A Finder drag is finally checked with `isInvalidDrop`, treating Alt as copy except on the
   * Trash.
   *
   * @param {DragEvent} e - The drag event being handled.
   * @returns {boolean} True when the drop is allowed.
   *
   * @example
   * if (!allowed(e)) e.dataTransfer.dropEffect = 'none';
   */
  const allowed = (e: DragEvent): boolean => {
    const drag = hasDragPaths(e) ? currentDrag() : null;
    if (appId) {
      if (!hasDragPaths(e)) return false;
      const app = getApp(appId);
      return !drag || drag.every((p) => !fs.isDir(p) && !!app?.opens?.some((x) => x === extname(p) || x === '*'));
    }
    if (dir === null) return false;
    if (!canDropInto(fs.stat(dir))) return false;
    if (dir === PATHS.trash) {
      if (!hasDragPaths(e)) return false;
      if (drag?.some((p) => fs.isProtected(p))) return false;
    }
    if (drag) return !isInvalidDrop(drag, dir, e.altKey && dir !== PATHS.trash);
    return true;
  };

  /**
   * Clears the hover state.
   *
   * Resets the enter/leave depth counter, removes the highlight and cancels the spring timer.
   *
   * @returns {void}
   *
   * @example
   * reset();
   */
  const reset = () => {
    depth.current = 0;
    setOver(false);
    clearSpring();
  };

  const props = enabled
    ? {
        /**
         * Handles a drag entering the target or one of its children.
         *
         * Claims accepted drags, and on the first allowed enter turns on the highlight and
         * starts the spring-loaded folder timer when `onSpring` is set.
         *
         * @param {DragEvent} e - The `dragenter` event.
         * @returns {void}
         *
         * @example
         * <div onDragEnter={props.onDragEnter} />
         */
        onDragEnter(e: DragEvent) {
          if (!accepts(e)) return;
          e.stopPropagation();
          if (!allowed(e)) return;
          e.preventDefault();
          depth.current += 1;
          if (depth.current === 1) {
            setOver(true);
            if (springRef.current && !springTimer.current) {
              springTimer.current = setTimeout(() => {
                springTimer.current = null;
                springRef.current?.();
              }, SPRING_DELAY);
            }
          }
        },
        /**
         * Handles a drag moving over the target.
         *
         * Sets the drop effect: "none" when refused, "copy" for app targets, host files and
         * Alt-drags outside the Trash, otherwise "move".
         *
         * @param {DragEvent} e - The `dragover` event.
         * @returns {void}
         *
         * @example
         * <div onDragOver={props.onDragOver} />
         */
        onDragOver(e: DragEvent) {
          if (!accepts(e)) return;
          e.stopPropagation();
          if (!e.dataTransfer) return;
          if (!allowed(e)) {
            e.dataTransfer.dropEffect = 'none';
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = appId ? 'copy' : hasHostFiles(e) && !hasDragPaths(e) ? 'copy' : e.altKey && dir !== PATHS.trash ? 'copy' : 'move';
        },
        /**
         * Handles a drag leaving the target or one of its children.
         *
         * Decrements the depth counter and clears the hover state once the drag has left the
         * target entirely.
         *
         * @param {DragEvent} e - The `dragleave` event.
         * @returns {void}
         *
         * @example
         * <div onDragLeave={props.onDragLeave} />
         */
        onDragLeave(e: DragEvent) {
          if (!accepts(e)) return;
          e.stopPropagation();
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) reset();
        },
        /**
         * Handles a drop on the target.
         *
         * Clears the hover state, re-checks the rules and runs `performDrop`; non-empty results
         * are passed to `onDropped`.
         *
         * @param {DragEvent} e - The `drop` event.
         * @returns {void}
         *
         * @example
         * <div onDrop={props.onDrop} />
         */
        onDrop(e: DragEvent) {
          if (!accepts(e)) return;
          e.preventDefault();
          e.stopPropagation();
          reset();
          if (!allowed(e)) return;
          void performDrop(e, { dir, appId, windowId }).then((paths) => paths.length && onDropped?.(paths));
        },
      }
    : {};

  return { over, props };
}

/**
 * Carries out a drop on a Finder target.
 *
 * Ends the active Finder drag first. On an application target every dropped path is opened
 * with that app. On a folder target FS items are moved (or copied when Alt is held, except on
 * the Trash) through `ops.drop`, which records an undo entry; invalid drops do nothing. Host
 * files are imported into the folder, and import errors are shown as an alert (a sheet on
 * `windowId` when given).
 *
 * @async
 * @param {DragEvent} e - The `drop` event.
 * @param {Object} target - Where the drop landed.
 * @param {string | null} target.dir - Folder that receives the items, or null.
 * @param {string} [target.appId] - Application that opens dropped documents.
 * @param {string} [target.windowId] - Window that hosts error sheets.
 * @returns {Promise<string[]>} Resulting paths in the folder (empty for app targets, Trash drops and failures).
 *
 * @example
 * const paths = await performDrop(e, { dir: PATHS.documents });
 * console.log(paths); // ['/Users/me/Documents/a.txt']
 */
async function performDrop(e: DragEvent, target: { dir: string | null; appId?: string; windowId?: string }): Promise<string[]> {
  const { dir, appId, windowId } = target;
  const paths = getDragPaths(e);
  endItemDrag();
  if (appId) {
    for (const p of paths) wm.openPath(p, appId);
    return [];
  }
  if (!dir) return [];
  if (paths.length) {
    const copy = e.altKey && dir !== PATHS.trash;
    if (isInvalidDrop(paths, dir, copy)) return [];
    return ops.drop(paths, dir, copy);
  }
  const files = e.dataTransfer?.files;
  if (files?.length) {
    try {
      const { created } = await importHostFiles(files, dir);
      return created;
    } catch (err) {
      void showFSError(err, windowId);
    }
  }
  return [];
}

/**
 * Root-level guard against host file drops outside drop targets.
 *
 * Prevents the default action and sets the "none" drop effect for host files, so the browser
 * does not navigate to a file dropped somewhere in the Finder window that is not a drop target
 * (such as the toolbar). Other drags are left alone.
 *
 * @param {DragEvent} e - A `dragover` or `drop` event that bubbled to the window root.
 * @returns {void}
 *
 * @example
 * <div onDragOver={guardHostDrop} onDrop={guardHostDrop}>{children}</div>
 */
export function guardHostDrop(e: DragEvent): void {
  if (hasHostFiles(e) && e.dataTransfer) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
  }
}

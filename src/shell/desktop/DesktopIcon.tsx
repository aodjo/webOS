/**
 * A desktop icon: 64px Finder icon + name (two lines, or the full name while selected), and the
 * inline rename field. Selected: a rounded glass square behind the icon and an accent capsule
 * behind each line of the name. Memoized: during a rubber-band drag only icons whose selection
 * changed re-render, so `events` and `register` must be stable.
 */
import { memo, useCallback, useLayoutEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { COMMON, extname, stem, useT, type FSNode } from '@/kernel';
import { FileIcon } from '@/icons';
import styles from './Desktop.module.css';

/** Handlers shared by every desktop icon; each receives the icon's node. Must be referentially stable. */
export interface IconEvents {
  onPointerDown: (e: PointerEvent<HTMLDivElement>, node: FSNode) => void;
  onClick: (e: MouseEvent<HTMLDivElement>, node: FSNode) => void;
  onDoubleClick: (node: FSNode) => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>, node: FSNode) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, node: FSNode) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, node: FSNode) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>, node: FSNode) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, node: FSNode) => void;
  /** Called once when renaming ends: the new name, or null when cancelled. */
  onRenameDone: (node: FSNode, value: string | null) => void;
}

interface Props {
  node: FSNode;
  /** Left edge in px within the desktop. */
  x: number;
  /** Top edge in px within the desktop. */
  y: number;
  selected: boolean;
  /** The desktop is the key "window" (selection drawn in the accent color). */
  keyActive: boolean;
  /** Part of the items being dragged (drawn dimmed). */
  dragging: boolean;
  /** A drag is hovering this folder or app. */
  dropTarget: boolean;
  /** Shows the inline rename field instead of the name. */
  renaming: boolean;
  /** Animates position changes (Clean Up / Sort By). */
  animate: boolean;
  events: IconEvents;
  /** Registers the icon's element (null on unmount) for hit-testing and drag images. */
  register: (path: string, el: HTMLDivElement | null) => void;
}

/**
 * Returns the name shown under a desktop icon.
 *
 * Like Finder, hides the ".app" extension of application bundles; every other name is shown
 * unchanged.
 *
 * @param {Pick<FSNode, 'name'>} node - The item (only its name is read).
 * @returns {string} The display label.
 *
 * @example
 * iconLabel({ name: 'Notes.app' }); // 'Notes'
 * iconLabel({ name: 'resume.pdf' }); // 'resume.pdf'
 */
export const iconLabel = (node: Pick<FSNode, 'name'>) => (extname(node.name) === 'app' ? stem(node.name) : node.name);

/**
 * One icon on the desktop.
 *
 * Positioned with a `translate3d` at (`x`, `y`) and exposed as a listbox option. Pointer, click,
 * context-menu and drag events are forwarded to `events` with the icon's node. The image and the
 * name carry `data-hit` (rubber-band hit boxes) and the name carries `data-label` (click-to-rename
 * target). The icon is not draggable while renaming, when the name is replaced by RenameField.
 * Wrapped in `memo`, so it re-renders only when one of its props changes.
 *
 * @param {Props} props - Component props.
 * @param {FSNode} props.node - The item the icon represents.
 * @param {number} props.x - Left edge in px within the desktop.
 * @param {number} props.y - Top edge in px within the desktop.
 * @param {boolean} props.selected - Whether the icon is selected.
 * @param {boolean} props.keyActive - Whether the desktop is key (accent selection vs. gray).
 * @param {boolean} props.dragging - Whether the icon is part of the current drag (dimmed).
 * @param {boolean} props.dropTarget - Whether a drag is hovering this icon.
 * @param {boolean} props.renaming - Whether the inline rename field is shown.
 * @param {boolean} props.animate - Whether position changes are animated.
 * @param {IconEvents} props.events - Stable event handlers shared by all icons.
 * @param {(path: string, el: HTMLDivElement | null) => void} props.register - Registers the icon's element.
 * @returns {JSX.Element} The icon element.
 *
 * @example
 * <DesktopIcon node={node} x={x} y={y} selected={false} keyActive dragging={false} dropTarget={false}
 *   renaming={false} animate={false} events={events} register={registerIcon} />
 */
export const DesktopIcon = memo(function DesktopIcon({ node, x, y, selected, keyActive, dragging, dropTarget, renaming, animate, events, register }: Props) {
  const label = iconLabel(node);
  const path = node.path;
  /**
   * Ref callback that registers the icon's element under its path (null on unmount).
   *
   * Memoized on `register` and the path, so React only re-runs it when either changes (for
   * example after the item is renamed).
   *
   * @param {HTMLDivElement | null} el - The mounted element, or null when it unmounts.
   * @returns {void}
   *
   * @example
   * <div ref={setRef} />
   */
  const setRef = useCallback((el: HTMLDivElement | null) => register(path, el), [register, path]);
  const cls = [styles.icon, selected && styles.selected, selected && !keyActive && styles.inactive, dragging && styles.dragging, dropTarget && styles.dropTarget, animate && styles.animate]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={setRef}
      className={cls}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
      role="option"
      aria-selected={selected}
      aria-label={label}
      data-desktop-item=""
      draggable={!renaming}
      onPointerDown={(e) => events.onPointerDown(e, node)}
      onClick={(e) => events.onClick(e, node)}
      onDoubleClick={() => events.onDoubleClick(node)}
      onContextMenu={(e) => events.onContextMenu(e, node)}
      onDragStart={(e) => events.onDragStart(e, node)}
      onDragEnd={events.onDragEnd}
      onDragOver={(e) => events.onDragOver(e, node)}
      onDragLeave={(e) => events.onDragLeave(e, node)}
      onDrop={(e) => events.onDrop(e, node)}
    >
      <div className={styles.image} data-hit="">
        <FileIcon node={node} size={64} />
      </div>
      {renaming ? (
        <RenameField name={node.name} isDir={node.type === 'dir'} onDone={(v) => events.onRenameDone(node, v)} />
      ) : (
        <div className={styles.labelWrap}>
          <span className={styles.label} data-hit="" data-label="">
            <span className={styles.labelText}>{label}</span>
          </span>
        </div>
      )}
    </div>
  );
});

/**
 * Grows or shrinks a textarea to fit its content.
 *
 * Collapses the height to 0 first so `scrollHeight` reflects the content, then sets the height to
 * it.
 *
 * @param {HTMLTextAreaElement} el - The textarea to resize.
 * @returns {void}
 *
 * @example
 * fit(textarea);
 */
const fit = (el: HTMLTextAreaElement) => {
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
};

/**
 * Inline, auto-growing name editor shown in place of a desktop icon's label.
 *
 * On mount it focuses itself and, like Finder, selects the name without its extension (the whole
 * name for folders). Return commits and Escape cancels (both ignored during IME composition);
 * line breaks in the value become spaces. Losing focus commits, except within 250 ms of opening:
 * focus can bounce back to the page right after a menu click, so focus is restored on the next
 * frame instead. `onDone` is called at most once. Pointer and click events are stopped so they do
 * not reach the icon.
 *
 * @param {Object} props - Component props.
 * @param {string} props.name - The current name, used as the initial value.
 * @param {boolean} props.isDir - Whether the item is a folder (selects the whole name).
 * @param {(value: string | null) => void} props.onDone - Receives the new name, or null when cancelled.
 * @returns {JSX.Element} The textarea.
 *
 * @example
 * <RenameField name="notes.txt" isDir={false} onDone={(v) => console.log(v)} />
 */
function RenameField({ name, isDir, onDone }: { name: string; isDir: boolean; onDone: (value: string | null) => void }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const startedAt = useRef(0);
  const initial = useRef({ name, isDir });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { name: n, isDir: dir } = initial.current;
    startedAt.current = performance.now();
    el.focus({ preventScroll: true });
    const dot = dir ? -1 : n.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : n.length);
    fit(el);
  }, []);

  /**
   * Ends editing once, reporting the result to `onDone`.
   *
   * Later calls are ignored. Runs of CR/LF in the value are replaced by a single space.
   *
   * @param {string | null} value - The edited name, or null to cancel.
   * @returns {void}
   *
   * @example
   * finish(e.currentTarget.value);
   */
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value === null ? null : value.replace(/[\r\n]+/g, ' '));
  };

  return (
    <textarea
      ref={ref}
      className={styles.renameField}
      defaultValue={name}
      rows={1}
      spellCheck={false}
      aria-label={t(COMMON.rename)}
      onInput={(e) => fit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={(e) => {
        const el = e.currentTarget;
        if (performance.now() - startedAt.current < 250) {
          requestAnimationFrame(() => {
            if (!done.current && el.isConnected) el.focus({ preventScroll: true });
          });
          return;
        }
        finish(el.value);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

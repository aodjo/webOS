import { useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { FSNode } from '@/kernel';
import { fileSizeOf, formatBytes, openGetInfo, useT } from '@/kernel';
import { Button } from '@/components/ui';
import { FileIcon } from '@/icons';
import { displayName, formatFinderDate, isAppFile, kindLabel, locationName } from '../model';
import { S, tagColor } from '../strings';
import { useDropTarget } from '../dnd';
import { FilePreview } from '../Preview';
import { RenameField } from './RenameField';
import type { ViewController } from './types';
import s from './ColumnView.module.css';

/** One column of the column view: the contents of a single folder. */
export interface Column {
  /** Folder whose items the column lists. */
  dir: string;
  /** Items of `dir`, in display order. */
  items: FSNode[];
  /** Highlighted items: the selection in the current column, the opened folder in the others. */
  highlighted: ReadonlySet<string>;
  /** Whether the column shows the Finder's current location, the one that holds the selection. */
  current: boolean;
}

interface Props {
  /** Shared Finder controller. */
  ctl: ViewController;
  /** Columns from the column root to the current location, plus one for a selected folder. */
  columns: Column[];
  /** Single selected file to show in the trailing preview column, or null. */
  preview: FSNode | null;
  /** Mouse down on an item in the column showing `dir`. */
  onPick: (e: MouseEvent, dir: string, path: string, order: string[]) => void;
  /** Mouse down on empty space in the column showing `dir`. */
  onPickBackground: (dir: string) => void;
}

/**
 * Column view (Miller columns) of the Finder.
 *
 * Renders one {@link ColumnList} per opened folder side by side in a horizontal scroller, so every
 * selected folder opens a new column to the right, followed by a preview column when a single
 * file is selected. Whenever a column is added, the last folder changes or the preview appears or
 * disappears, the scroller smoothly scrolls to its right end so the newest column stays in view.
 *
 * @param {Object} props - Component props.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {Column[]} props.columns - Columns to render, leftmost first.
 * @param {FSNode | null} props.preview - Selected file to preview, or null for no preview column.
 * @param {(e: MouseEvent, dir: string, path: string, order: string[]) => void} props.onPick - Called
 *   on a mouse down on an item.
 * @param {(dir: string) => void} props.onPickBackground - Called on a mouse down on a column's empty space.
 * @returns {JSX.Element} The scrolling row of columns.
 *
 * @example
 * <ColumnView ctl={ctl} columns={columns} preview={file} onPick={pick} onPickBackground={pickDir} />
 */
export function ColumnView({ ctl, columns, preview, onPick, onPickBackground }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastDir = columns.at(-1)?.dir;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, [columns.length, lastDir, !!preview]);

  return (
    <div ref={scrollRef} className={`${s.scroll} ${ctl.active ? '' : s.inactive}`} tabIndex={-1}>
      {columns.map((col) => (
        <ColumnList key={col.dir} col={col} ctl={ctl} onPick={onPick} onPickBackground={onPickBackground} />
      ))}
      {preview && <PreviewColumn node={preview} ctl={ctl} />}
    </div>
  );
}

/**
 * A single column listing the items of one folder.
 *
 * The column is a listbox that is also a drop target for its folder. A mouse down on its empty
 * space (not on a row) picks the folder itself. The lead highlighted item (the last entry of
 * `highlighted` in the current column, the first one, i.e. the opened folder, in the others) is
 * scrolled into view whenever it changes.
 *
 * @param {Object} props - Component props.
 * @param {Column} props.col - Column to render.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {Props['onPick']} props.onPick - Called on a mouse down on an item.
 * @param {Props['onPickBackground']} props.onPickBackground - Called on a mouse down on empty space.
 * @returns {JSX.Element} The column's list of rows.
 *
 * @example
 * <ColumnList col={col} ctl={ctl} onPick={onPick} onPickBackground={onPickBackground} />
 */
function ColumnList({ col, ctl, onPick, onPickBackground }: { col: Column; ctl: ViewController; onPick: Props['onPick']; onPickBackground: Props['onPickBackground'] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const order = col.items.map((n) => n.path);
  const drop = useDropTarget({ dir: col.dir, windowId: ctl.windowId, onDropped: (paths) => ctl.dropped(paths, col.dir) });
  const lead = col.current ? [...col.highlighted].at(-1) : [...col.highlighted][0];

  useEffect(() => {
    if (!lead) return;
    listRef.current?.querySelector(`[data-path="${CSS.escape(lead)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [lead]);

  return (
    <div
      ref={listRef}
      className={`${s.column} ${drop.over ? s.dropping : ''}`}
      role="listbox"
      aria-multiselectable={col.current}
      aria-label={locationName(col.dir, ctl.locale)}
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) onPickBackground(col.dir);
      }}
      onContextMenu={(e) => ctl.backgroundContextMenu(e, col.dir)}
      {...drop.props}
    >
      {col.items.map((node) => (
        <ColumnRow key={node.path} node={node} ctl={ctl} col={col} order={order} onPick={onPick} />
      ))}
    </div>
  );
}

/**
 * One row of a column: icon, name (or inline rename field), tag dot and a chevron for folders.
 *
 * Highlighted rows use the selection style in the current column and the "path" style (the
 * opened folder) in the others. Clicks only reach `ctl.itemClick` in the current column, and a
 * double-click opens files only, because folders open by being picked. Folders are drop targets
 * that spring open during a drag; application files accept documents dropped on them.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - Item shown by the row.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {Column} props.col - Column containing the row.
 * @param {string[]} props.order - Paths of the column's items in display order (for ⇧-click ranges).
 * @param {Props['onPick']} props.onPick - Called on a mouse down on the row.
 * @returns {JSX.Element} The row element.
 *
 * @example
 * <ColumnRow node={node} ctl={ctl} col={col} order={order} onPick={onPick} />
 */
function ColumnRow({ node, ctl, col, order, onPick }: { node: FSNode; ctl: ViewController; col: Column; order: string[]; onPick: Props['onPick'] }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const isDir = node.type === 'dir';
  const lit = col.highlighted.has(node.path);
  const renaming = ctl.renaming === node.path;
  const app = isAppFile(node) ? (node.content ?? '').trim() : undefined;
  const drop = useDropTarget({
    dir: isDir ? node.path : null,
    appId: app,
    windowId: ctl.windowId,
    onSpring: isDir ? () => ctl.springOpen(node.path) : undefined,
    onDropped: (paths) => isDir && ctl.dropped(paths, node.path),
  });
  const tag = tagColor(node.meta?.tag);
  const name = displayName(node, ctl.locale);

  return (
    <div
      className={`${s.row} ${lit ? (col.current ? s.selected : s.path) : ''} ${drop.over ? s.drop : ''}`}
      role="option"
      aria-selected={lit}
      data-path={node.path}
      title={name}
      draggable={!renaming}
      onMouseDown={(e) => onPick(e, col.dir, node.path, order)}
      onClick={(e) => col.current && ctl.itemClick(e, node.path, !!(e.target as Element).closest('[data-name]'))}
      onDoubleClick={(e) => !isDir && ctl.itemOpen(e, node)}
      onContextMenu={(e) => ctl.itemContextMenu(e, node.path)}
      onDragStart={(e) => ctl.dragStart(e, node.path, iconRef.current)}
      onDragEnd={ctl.dragEnd}
      {...drop.props}
    >
      <span ref={iconRef} className={s.icon}>
        <FileIcon node={node} size={16} />
      </span>
      {renaming ? (
        <RenameField node={node} onCommit={(v) => ctl.commitRename(node.path, v)} onCancel={ctl.cancelRename} />
      ) : (
        <span className={s.name} data-name>
          {name}
        </span>
      )}
      {tag && <span className={s.tag} style={{ background: tag }} />}
      {isDir && <ChevronRight className={s.chevron} size={13} strokeWidth={2.4} />}
    </div>
  );
}

/**
 * Trailing column that previews the single selected file.
 *
 * Shows a large thumbnail, the file's name, kind and size, its created and modified dates, and a
 * "More…" button that opens the Get Info window for the file.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - File to preview.
 * @param {ViewController} props.ctl - Shared Finder controller (locale and clock format).
 * @returns {JSX.Element} The preview column.
 *
 * @example
 * <PreviewColumn node={file} ctl={ctl} />
 */
function PreviewColumn({ node, ctl }: { node: FSNode; ctl: ViewController }) {
  const t = useT();
  const { locale, h24 } = ctl;
  return (
    <div className={s.preview}>
      <div className={s.previewArt}>
        <FilePreview node={node} variant="thumb" iconSize={128} />
      </div>
      <div className={s.previewName}>{displayName(node, locale)}</div>
      <div className={s.previewMeta}>
        {kindLabel(node, locale)} – {formatBytes(fileSizeOf(node), locale)}
      </div>
      <div className={s.infoTitle}>{t(S.information)}</div>
      <dl className={s.info}>
        <dt>{t(S.created)}</dt>
        <dd>{formatFinderDate(node.createdAt, locale, { h24 })}</dd>
        <dt>{t(S.modified)}</dt>
        <dd>{formatFinderDate(node.modifiedAt, locale, { h24 })}</dd>
      </dl>
      <Button className={s.more} onClick={() => openGetInfo(node.path)}>
        {t(S.more)}
      </Button>
    </div>
  );
}

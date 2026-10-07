import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SortKey } from '@/kernel';
import { dirname, fileSizeOf, formatBytes, tildify, useT } from '@/kernel';
import { FileIcon } from '@/icons';
import { displayName, formatFinderDate, isAppFile, kindLabel, locationName, type Row, type SortSpec } from '../model';
import { S, tagColor } from '../strings';
import { useDropTarget } from '../dnd';
import { prefs, useFinderPrefs, type ListWidths } from '../prefs';
import { RenameField } from './RenameField';
import { useRubberBand } from './useRubberBand';
import type { ViewController } from './types';
import s from './ListView.module.css';

const ROW_H = 26; /** Height (px) of a list row; must match `.row` in ListView.module.css. */
const HEADER_H = 28; /** Height (px) of the sticky column header; must match `.header`. */
const INDENT = 16; /** Extra left padding (px) of the name cell per nesting level of expanded folders. */

interface Props {
  /** Shared Finder controller. */
  ctl: ViewController;
  /** Visible rows, including the contents of folders expanded inline. */
  rows: Row[];
  /** Folder shown (drop target for the empty area); null for virtual locations. */
  dir: string | null;
  /** Current sort column and direction. */
  sort: SortSpec;
  /** Called when a sortable column header is clicked. */
  onSort: (key: SortKey) => void;
  /** Expands or collapses a folder; `recursive` also applies to its subfolders. */
  onToggle: (path: string, recursive: boolean) => void;
  /** Whether to show the Where (parent folder) column, used for search results. */
  showWhere?: boolean;
  /** Text centered below the header when there are no rows. */
  emptyText?: string;
}

/** Identifier of a list column. */
type Col = 'name' | 'date' | 'size' | 'kind' | 'where';

/**
 * List view of the Finder: a table of rows with sortable, resizable columns.
 *
 * Shows Name / Date Modified / Size / Kind, plus Where (the parent folder) for search results.
 * The Name column takes the remaining space; the others use the widths saved in the Finder prefs,
 * overridden by the live width of the column being resized until the drag ends. A ResizeObserver
 * tracks the view height so empty striped filler rows fill the visible area below the last row.
 * Disclosure triangles expand folders inline, the empty area supports rubber-band selection, and
 * the whole view is a drop target for `dir`. The last selected row in display order is scrolled into
 * view whenever it changes, except during a rubber-band drag, which auto-scrolls on its own. Adjacent
 * selected rows get `joinTop` / `joinBottom` so their highlights merge into one block.
 *
 * @param {Object} props - Component props.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {Row[]} props.rows - Visible rows.
 * @param {string | null} props.dir - Folder shown, or null for virtual locations.
 * @param {SortSpec} props.sort - Current sort column and direction.
 * @param {(key: SortKey) => void} props.onSort - Called when a sortable header is clicked.
 * @param {(path: string, recursive: boolean) => void} props.onToggle - Expands or collapses a folder.
 * @param {boolean} [props.showWhere] - Whether to show the Where column.
 * @param {string} [props.emptyText] - Text shown when there are no rows.
 * @returns {JSX.Element} The scrolling list table.
 *
 * @example
 * <ListView ctl={ctl} rows={rows} dir={loc} sort={sort} onSort={setSortKey} onToggle={toggle} />
 */
export function ListView({ ctl, rows, dir, sort, onSort, onToggle, showWhere, emptyText }: Props) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedWidths = useFinderPrefs((p) => p.listWidths);
  const [live, setLive] = useState<{ col: keyof ListWidths; width: number } | null>(null);
  const widths = live ? { ...savedWidths, [live.col]: live.width } : savedWidths;
  const order = useMemo(() => rows.map((r) => r.node.path), [rows]);
  const selection = useMemo(() => order.filter((p) => ctl.selected.has(p)), [order, ctl.selected]);
  const { band, onMouseDown } = useRubberBand(scrollRef, selection, ctl.setSelection);
  const drop = useDropTarget({ dir, windowId: ctl.windowId, onDropped: (paths) => dir && ctl.dropped(paths, dir) });

  const [viewH, setViewH] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fillers = Math.max(0, Math.ceil((viewH - HEADER_H) / ROW_H) - rows.length);

  const lead = selection.at(-1);
  const banding = !!band;
  useEffect(() => {
    if (!lead || banding) return;
    scrollRef.current?.querySelector(`[data-path="${CSS.escape(lead)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [lead, banding]);

  const cols: { id: Col; label: string; sortKey?: SortKey; width?: number }[] = [
    { id: 'name', label: t(S.name), sortKey: 'name' },
    ...(showWhere ? [{ id: 'where' as const, label: t(S.where), width: widths.where }] : []),
    { id: 'date', label: t(S.dateModified), sortKey: 'date', width: widths.date },
    { id: 'size', label: t(S.size), sortKey: 'size', width: widths.size },
    { id: 'kind', label: t(S.kind), sortKey: 'kind', width: widths.kind },
  ];
  const template = cols.map((c) => (c.width ? `${c.width}px` : 'minmax(180px, 1fr)')).join(' ');
  const minWidth = 180 + cols.reduce((sum, c) => sum + (c.width ?? 0), 0) + 20;

  return (
    <div
      ref={scrollRef}
      className={`${s.scroll} ${ctl.active ? '' : s.inactive} ${drop.over ? s.dropping : ''}`}
      tabIndex={-1}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => ctl.backgroundContextMenu(e, dir)}
      {...drop.props}
    >
      <div className={s.table} style={{ minWidth }} role="grid" aria-multiselectable="true">
        <div className={s.header} role="row" data-no-band style={{ gridTemplateColumns: template }}>
          {cols.map((c) => (
            <div key={c.id} role="columnheader" aria-sort={c.sortKey === sort.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${s.headCell} ${c.id === 'size' ? s.right : ''}`}>
              {c.sortKey ? (
                <button type="button" className={`${s.headBtn} ${sort.key === c.sortKey ? s.sorted : ''}`} onClick={() => onSort(c.sortKey!)}>
                  <span className={s.headLabel}>{c.label}</span>
                  {sort.key === c.sortKey && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </button>
              ) : (
                <span className={s.headStatic}>{c.label}</span>
              )}
              {c.width !== undefined && <ColumnResizer col={c.id as keyof ListWidths} width={c.width} onLive={setLive} />}
            </div>
          ))}
        </div>
        {rows.map((r, i) => (
          <ListRow
            key={r.node.path}
            row={r}
            index={i}
            ctl={ctl}
            order={order}
            template={template}
            showWhere={!!showWhere}
            joinTop={i > 0 && ctl.selected.has(order[i - 1])}
            joinBottom={i < order.length - 1 && ctl.selected.has(order[i + 1])}
            onToggle={onToggle}
          />
        ))}
        {Array.from({ length: fillers }, (_, i) => (
          <div key={`f${i}`} className={`${s.row} ${s.filler} ${(rows.length + i) % 2 ? s.odd : ''}`} aria-hidden="true" />
        ))}
      </div>
      {rows.length === 0 && emptyText ? <div className={s.empty}>{emptyText}</div> : null}
      {band && <div className={s.band} style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
    </div>
  );
}

/**
 * Drag handle on the right edge of a column header that resizes the column.
 *
 * While dragging, the new width (clamped to 56–480px) is reported through `onLive` so the table
 * reflows immediately; on release it is saved to the Finder prefs (only when it changed) and the
 * live override is cleared.
 *
 * @param {Object} props - Component props.
 * @param {keyof ListWidths} props.col - Column being resized.
 * @param {number} props.width - Column width (px) when the drag starts.
 * @param {(v: { col: keyof ListWidths; width: number } | null) => void} props.onLive - Receives the
 *   live width, or null when the drag ends.
 * @returns {JSX.Element} The separator element.
 *
 * @example
 * <ColumnResizer col="date" width={widths.date} onLive={setLive} />
 */
function ColumnResizer({ col, width, onLive }: { col: keyof ListWidths; width: number; onLive: (v: { col: keyof ListWidths; width: number } | null) => void }) {
  const t = useT();
  /**
   * Starts a column resize drag.
   *
   * Ignores buttons other than the primary one. Captures the pointer on the handle so move and up
   * events keep arriving outside it, then listens for them on the handle until the pointer is
   * released or the gesture is cancelled.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer down event on the handle.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let last = width;
    /**
     * Updates the live column width from the pointer position.
     *
     * Adds the horizontal distance moved since the drag started to the starting width, clamps
     * the result to 56–480px, rounds it and reports it through `onLive`.
     *
     * @param {PointerEvent} ev - Pointer move event.
     * @returns {void}
     *
     * @example
     * el.addEventListener('pointermove', onMove);
     */
    const onMove = (ev: PointerEvent) => {
      last = Math.round(Math.min(480, Math.max(56, width + ev.clientX - startX)));
      onLive({ col, width: last });
    };
    /**
     * Ends the resize drag.
     *
     * Removes the move/up/cancel listeners, saves the final width to the Finder prefs when it
     * differs from the starting width, and clears the live override.
     *
     * @returns {void}
     *
     * @example
     * el.addEventListener('pointerup', onUp);
     */
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (last !== width) prefs.setListWidth(col, last);
      onLive(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };
  return <div className={s.resizer} role="separator" aria-orientation="vertical" aria-label={t(S.resizeColumn)} onPointerDown={onPointerDown} />;
}

interface RowProps {
  /** Row to render (node, nesting depth, expanded state). */
  row: Row;
  /** Position in the list, used for zebra striping. */
  index: number;
  /** Shared Finder controller. */
  ctl: ViewController;
  /** Paths of all rows in display order (for ⇧-click ranges). */
  order: string[];
  /** CSS `grid-template-columns` shared with the header. */
  template: string;
  /** Whether to render the Where cell. */
  showWhere: boolean;
  /** The row above is also selected (square off the top corners). */
  joinTop: boolean;
  /** The row below is also selected (square off the bottom corners). */
  joinBottom: boolean;
  /** Expands or collapses a folder. */
  onToggle: (path: string, recursive: boolean) => void;
}

/**
 * One row of the list view.
 *
 * Memoized because the rubber band re-renders the list on every mouse move. The name cell holds a
 * disclosure triangle for folders (⌥-click toggles recursively; its clicks never reach the row),
 * the icon, the name or rename field and a tag dot, indented by the row's depth. The name cell
 * carries `data-hit` so it alone counts for rubber-band hits. Folders are drop targets, and a
 * collapsed folder expands inline (instead of navigating) when a drag hovers over it; application
 * files accept documents dropped on them.
 *
 * @param {RowProps} props - Component props (see {@link RowProps}).
 * @param {Row} props.row - Row to render.
 * @param {number} props.index - Position in the list.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {string[]} props.order - Paths of all rows in display order.
 * @param {string} props.template - Grid template shared with the header.
 * @param {boolean} props.showWhere - Whether to render the Where cell.
 * @param {boolean} props.joinTop - Whether the row above is also selected.
 * @param {boolean} props.joinBottom - Whether the row below is also selected.
 * @param {(path: string, recursive: boolean) => void} props.onToggle - Expands or collapses a folder.
 * @returns {JSX.Element} The row element.
 *
 * @example
 * <ListRow row={r} index={i} ctl={ctl} order={order} template={template}
 *   showWhere={false} joinTop={false} joinBottom={false} onToggle={toggle} />
 */
const ListRow = memo(function ListRow({ row, index, ctl, order, template, showWhere, joinTop, joinBottom, onToggle }: RowProps) {
  const t = useT();
  const { node, depth, expanded } = row;
  const iconRef = useRef<HTMLSpanElement>(null);
  const selected = ctl.selected.has(node.path);
  const renaming = ctl.renaming === node.path;
  const isDir = node.type === 'dir';
  const app = isAppFile(node) ? (node.content ?? '').trim() : undefined;
  const drop = useDropTarget({
    dir: isDir ? node.path : null,
    appId: app,
    windowId: ctl.windowId,
    onSpring: isDir && !expanded ? () => onToggle(node.path, false) : undefined,
    onDropped: (paths) => isDir && ctl.dropped(paths, node.path),
  });
  const name = displayName(node, ctl.locale);
  const tag = tagColor(node.meta?.tag);
  const cls = [s.row, index % 2 ? s.odd : '', selected ? s.selected : '', selected && joinTop ? s.joinTop : '', selected && joinBottom ? s.joinBottom : '', drop.over ? s.drop : ''].join(' ');

  return (
    <div
      className={cls}
      style={{ gridTemplateColumns: template }}
      role="row"
      aria-selected={selected}
      aria-expanded={isDir ? expanded : undefined}
      aria-level={depth + 1}
      data-path={node.path}
      draggable={!renaming}
      onMouseDown={(e) => ctl.itemMouseDown(e, node.path, order)}
      onClick={(e) => ctl.itemClick(e, node.path, !!(e.target as Element).closest('[data-name]'))}
      onDoubleClick={(e) => ctl.itemOpen(e, node)}
      onContextMenu={(e) => ctl.itemContextMenu(e, node.path)}
      onDragStart={(e) => ctl.dragStart(e, node.path, iconRef.current)}
      onDragEnd={ctl.dragEnd}
      {...drop.props}
    >
      <div className={s.nameCell} role="gridcell" style={{ paddingLeft: 4 + depth * INDENT }} data-hit>
        {isDir ? (
          <button
            type="button"
            className={`${s.disclosure} ${expanded ? s.open : ''}`}
            aria-label={t(expanded ? S.collapse : S.expand)}
            aria-expanded={expanded}
            tabIndex={-1}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path, e.altKey);
            }}
          />
        ) : (
          <span className={s.disclosureSpacer} />
        )}
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
        {tag && !renaming && <span className={s.tag} style={{ background: tag }} />}
      </div>
      {showWhere && (
        <div className={s.cell} role="gridcell" title={tildify(dirname(node.path))}>
          {locationName(dirname(node.path), ctl.locale)}
        </div>
      )}
      <div className={s.cell} role="gridcell">
        {formatFinderDate(node.modifiedAt, ctl.locale, { h24: ctl.h24 })}
      </div>
      <div className={`${s.cell} ${s.right}`} role="gridcell">
        {isDir ? '--' : formatBytes(fileSizeOf(node), ctl.locale)}
      </div>
      <div className={s.cell} role="gridcell">
        {kindLabel(node, ctl.locale)}
      </div>
    </div>
  );
});

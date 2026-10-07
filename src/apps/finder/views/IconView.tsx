import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { FSNode } from '@/kernel';
import { FileIcon } from '@/icons';
import { displayName, isAppFile } from '../model';
import { tagColor } from '../strings';
import { useDropTarget } from '../dnd';
import { RenameField } from './RenameField';
import { useRubberBand } from './useRubberBand';
import type { ViewController } from './types';
import s from './IconView.module.css';

const PAD_X = 12; /** Horizontal padding (px) on each side of the icon grid. */

/**
 * Computes the minimum width of one grid cell for an icon size.
 *
 * The cell is the icon plus room for its two-line name, but never narrower than 84px so short
 * names on small icons still fit.
 *
 * @param {number} iconSize - Icon size in pixels.
 * @returns {number} Minimum cell width in pixels.
 *
 * @example
 * cellWidth(64); // 100
 * cellWidth(32); // 84
 */
function cellWidth(iconSize: number): number {
  return Math.max(84, iconSize + 36);
}

interface Props {
  /** Shared Finder controller. */
  ctl: ViewController;
  /** Items to show, in display order. */
  items: FSNode[];
  /** Folder shown (drop target for the empty area); null for virtual locations. */
  dir: string | null;
  /** Icon size in pixels. */
  iconSize: number;
  /** Text centered in the view when there are no items. */
  emptyText?: string;
  /** Receives the grid's column count on mount and on every resize, for grid-aware arrow keys. */
  onColumns: (cols: number) => void;
}

/**
 * Icon view of the Finder: a grid of file icons with two-line names.
 *
 * Supports rubber-band selection on the empty area, inline rename and drag & drop (the whole view
 * is a drop target for `dir`). A ResizeObserver reports the current column count through
 * `onColumns` so arrow keys can move through the grid. The last selected item in display order is
 * scrolled into view whenever it changes (keyboard navigation, new folders…), except while a rubber
 * band is active, because the band auto-scrolls on its own.
 *
 * @param {Object} props - Component props.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {FSNode[]} props.items - Items to show.
 * @param {string | null} props.dir - Folder shown, or null for virtual locations.
 * @param {number} props.iconSize - Icon size in pixels.
 * @param {string} [props.emptyText] - Text shown when there are no items.
 * @param {(cols: number) => void} props.onColumns - Receives the grid's column count.
 * @returns {JSX.Element} The scrolling icon grid.
 *
 * @example
 * <IconView ctl={ctl} items={items} dir="/Users/guest/Documents" iconSize={64} onColumns={setCols} />
 */
export function IconView({ ctl, items, dir, iconSize, emptyText, onColumns }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const order = useMemo(() => items.map((n) => n.path), [items]);
  const selection = useMemo(() => order.filter((p) => ctl.selected.has(p)), [order, ctl.selected]);
  const { band, onMouseDown } = useRubberBand(scrollRef, selection, ctl.setSelection);
  const drop = useDropTarget({ dir, windowId: ctl.windowId, onDropped: (paths) => dir && ctl.dropped(paths, dir) });
  const cell = cellWidth(iconSize);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /**
     * Reports how many grid columns fit in the view.
     *
     * Divides the scroller's inner width (minus the grid's horizontal padding) by the cell width,
     * matching the CSS `repeat(auto-fill, minmax(cell, 1fr))` track count, with at least one column.
     *
     * @returns {void}
     *
     * @example
     * measure(); // calls onColumns(5) in a 560px-wide view with 100px cells
     */
    const measure = () => onColumns(Math.max(1, Math.floor((el.clientWidth - PAD_X * 2) / cell)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cell, onColumns]);

  const lead = selection.at(-1);
  const banding = !!band;
  useEffect(() => {
    if (!lead || banding) return;
    scrollRef.current?.querySelector(`[data-path="${CSS.escape(lead)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [lead, banding]);

  return (
    <div
      ref={scrollRef}
      className={`${s.scroll} ${ctl.active ? '' : s.inactive} ${drop.over ? s.dropping : ''}`}
      role="listbox"
      aria-multiselectable="true"
      tabIndex={-1}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => ctl.backgroundContextMenu(e, dir)}
      {...drop.props}
    >
      {items.length === 0 && emptyText ? <div className={s.empty}>{emptyText}</div> : null}
      <div className={s.grid} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cell}px, 1fr))`, padding: `14px ${PAD_X}px 28px` }}>
        {items.map((node) => (
          <IconItem key={node.path} node={node} ctl={ctl} order={order} iconSize={iconSize} />
        ))}
      </div>
      {band && <div className={s.band} style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
    </div>
  );
}

/**
 * One item of the icon grid: the icon above its name (or the multiline rename field).
 *
 * Memoized because the rubber band re-renders the grid on every mouse move. The icon and the label
 * carry `data-hit`, so only they count for rubber-band hits, and a tag shows as a colored dot
 * before the name. Folders are drop targets that spring open during a drag; application files
 * accept documents dropped on them.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - Item to render.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {string[]} props.order - Paths of all items in display order (for ⇧-click ranges).
 * @param {number} props.iconSize - Icon size in pixels.
 * @returns {JSX.Element} The grid item.
 *
 * @example
 * <IconItem node={node} ctl={ctl} order={order} iconSize={64} />
 */
const IconItem = memo(function IconItem({ node, ctl, order, iconSize }: { node: FSNode; ctl: ViewController; order: string[]; iconSize: number }) {
  const iconRef = useRef<HTMLDivElement>(null);
  const selected = ctl.selected.has(node.path);
  const renaming = ctl.renaming === node.path;
  const isDir = node.type === 'dir';
  const app = isAppFile(node) ? (node.content ?? '').trim() : undefined;
  const drop = useDropTarget({
    dir: isDir ? node.path : null,
    appId: app,
    windowId: ctl.windowId,
    onSpring: isDir ? () => ctl.springOpen(node.path) : undefined,
    onDropped: (paths) => isDir && ctl.dropped(paths, node.path),
  });
  const name = displayName(node, ctl.locale);
  const tag = tagColor(node.meta?.tag);

  return (
    <div
      className={`${s.item} ${selected ? s.selected : ''} ${drop.over ? s.drop : ''}`}
      data-path={node.path}
      role="option"
      aria-selected={selected}
      aria-label={name}
      title={name}
      draggable={!renaming}
      onMouseDown={(e) => ctl.itemMouseDown(e, node.path, order)}
      onClick={(e) => ctl.itemClick(e, node.path, !!(e.target as Element).closest('[data-name]'))}
      onDoubleClick={(e) => ctl.itemOpen(e, node)}
      onContextMenu={(e) => ctl.itemContextMenu(e, node.path)}
      onDragStart={(e) => ctl.dragStart(e, node.path, iconRef.current)}
      onDragEnd={ctl.dragEnd}
      {...drop.props}
    >
      <div ref={iconRef} className={s.icon} data-hit>
        <FileIcon node={node} size={iconSize} />
      </div>
      {renaming ? (
        <RenameField node={node} multiline className={s.rename} onCommit={(v) => ctl.commitRename(node.path, v)} onCancel={ctl.cancelRename} />
      ) : (
        <div className={s.label} data-hit>
          <span className={s.name} data-name>
            {tag && <span className={s.tag} style={{ background: tag }} />}
            {name}
          </span>
        </div>
      )}
    </div>
  );
});

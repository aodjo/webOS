import { useEffect, useMemo, useRef } from 'react';
import type { FSNode } from '@/kernel';
import { fileSizeOf, formatBytes, useT } from '@/kernel';
import { FileIcon } from '@/icons';
import { displayName, formatFinderDate, isAppFile, kindLabel } from '../model';
import { S } from '../strings';
import { useDropTarget } from '../dnd';
import { FilePreview } from '../Preview';
import { RenameField } from './RenameField';
import type { ViewController } from './types';
import s from './GalleryView.module.css';

interface Props {
  /** Shared Finder controller. */
  ctl: ViewController;
  /** Items to show, in display order. */
  items: FSNode[];
  /** Folder shown (drop target for the whole view); null for virtual locations. */
  dir: string | null;
  /** Text shown on the stage when there are no items. */
  emptyText?: string;
}

/**
 * Gallery view of the Finder: a large preview of the selected item above a strip of thumbnails.
 *
 * The lead item is the last selected one in display order. The stage shows its preview (double
 * click opens it), its name or the inline rename field, and its kind, size and modification date;
 * without a selection it shows a placeholder, or `emptyText` when the folder is empty. Whenever the
 * lead changes, its thumbnail is smoothly scrolled to the center of the strip. The whole view is a
 * drop target for `dir`.
 *
 * @param {Object} props - Component props.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {FSNode[]} props.items - Items to show.
 * @param {string | null} props.dir - Folder shown, or null for virtual locations.
 * @param {string} [props.emptyText] - Text shown when there are no items.
 * @returns {JSX.Element} The gallery view.
 *
 * @example
 * <GalleryView ctl={ctl} items={items} dir="/Users/guest/Pictures" emptyText="No items" />
 */
export function GalleryView({ ctl, items, dir, emptyText }: Props) {
  const t = useT();
  const stripRef = useRef<HTMLDivElement>(null);
  const order = useMemo(() => items.map((n) => n.path), [items]);
  const leadPath = order.filter((p) => ctl.selected.has(p)).at(-1);
  const lead = items.find((n) => n.path === leadPath) ?? null;
  const drop = useDropTarget({ dir, windowId: ctl.windowId, onDropped: (paths) => dir && ctl.dropped(paths, dir) });

  useEffect(() => {
    if (!leadPath) return;
    stripRef.current?.querySelector(`[data-path="${CSS.escape(leadPath)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [leadPath]);

  return (
    <div className={`${s.root} ${ctl.active ? '' : s.inactive} ${drop.over ? s.dropping : ''}`} tabIndex={-1} onContextMenu={(e) => ctl.backgroundContextMenu(e, dir)} {...drop.props}>
      <div className={s.stage}>
        {lead ? (
          <>
            <div className={s.art} key={lead.path} onDoubleClick={(e) => ctl.itemOpen(e, lead)}>
              <FilePreview node={lead} variant="thumb" iconSize={192} />
            </div>
            <div className={s.caption}>
              {ctl.renaming === lead.path ? (
                <RenameField node={lead} onCommit={(v) => ctl.commitRename(lead.path, v)} onCancel={ctl.cancelRename} />
              ) : (
                <div className={s.title}>{displayName(lead, ctl.locale)}</div>
              )}
              <div className={s.meta}>
                {kindLabel(lead, ctl.locale)}
                {lead.type === 'file' && ` – ${formatBytes(fileSizeOf(lead), ctl.locale)}`} · {formatFinderDate(lead.modifiedAt, ctl.locale, { h24: ctl.h24 })}
              </div>
            </div>
          </>
        ) : (
          <div className={s.placeholder}>{items.length ? t(S.noSelection) : emptyText}</div>
        )}
      </div>
      {/* The glass shelf is a wrapper around the strip so the glass stays put while the strip scrolls. */}
      <div className={`lg lg-control ${s.shelf}`}>
        <div ref={stripRef} className={s.strip} role="listbox" aria-multiselectable="true">
          {items.map((node) => (
            <GalleryThumb key={node.path} node={node} ctl={ctl} order={order} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One thumbnail in the gallery strip.
 *
 * Forwards mouse, context-menu and drag events to the controller (a click on a thumbnail never
 * arms renaming, since it shows no name). Folders are drop targets that spring open during a drag;
 * application files accept documents dropped on them.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - Item shown by the thumbnail.
 * @param {ViewController} props.ctl - Shared Finder controller.
 * @param {string[]} props.order - Paths of all items in display order (for ⇧-click ranges).
 * @returns {JSX.Element} The thumbnail element.
 *
 * @example
 * <GalleryThumb node={node} ctl={ctl} order={order} />
 */
function GalleryThumb({ node, ctl, order }: { node: FSNode; ctl: ViewController; order: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = ctl.selected.has(node.path);
  const isDir = node.type === 'dir';
  const drop = useDropTarget({
    dir: isDir ? node.path : null,
    appId: isAppFile(node) ? (node.content ?? '').trim() : undefined,
    windowId: ctl.windowId,
    onSpring: isDir ? () => ctl.springOpen(node.path) : undefined,
    onDropped: (paths) => isDir && ctl.dropped(paths, node.path),
  });
  const name = displayName(node, ctl.locale);
  return (
    <div
      ref={ref}
      className={`${s.thumb} ${selected ? s.selected : ''} ${drop.over ? s.drop : ''}`}
      role="option"
      aria-selected={selected}
      aria-label={name}
      title={name}
      data-path={node.path}
      draggable
      onMouseDown={(e) => ctl.itemMouseDown(e, node.path, order)}
      onClick={(e) => ctl.itemClick(e, node.path, false)}
      onDoubleClick={(e) => ctl.itemOpen(e, node)}
      onContextMenu={(e) => ctl.itemContextMenu(e, node.path)}
      onDragStart={(e) => ctl.dragStart(e, node.path, ref.current)}
      onDragEnd={ctl.dragEnd}
      {...drop.props}
    >
      <FileIcon node={node} size={48} />
    </div>
  );
}

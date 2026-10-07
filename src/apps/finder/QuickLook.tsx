import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Share } from 'lucide-react';
import type { FSNode } from '@/kernel';
import { defaultAppFor, downloadFile, fileClipboard, fileSizeOf, fmt, formatBytes, formatDate, fs, getApp, notify, showContextMenu, useLocale, useT } from '@/kernel';
import { FileIcon } from '@/icons';
import { PanelLights } from '@/shell/windows/TrafficLights';
import { displayName, isAppFile, itemCount, kindLabel, withRo } from './model';
import { S } from './strings';
import { FilePreview, hasContentPreview } from './Preview';
import s from './QuickLook.module.css';

interface Props {
  node: FSNode;
  /** Zero-based item index and selection size; shown as a 1-based counter when total > 1. */
  position?: { index: number; total: number };
  /** Viewport point the panel is first centred on (e.g. the middle of the Finder window); the middle of the viewport when omitted. */
  origin?: { x: number; y: number };
  onClose: () => void;
  onOpen: (node: FSNode) => void;
}

/**
 * Finds the app the "Open with …" button would use for an item.
 *
 * Folders and app bundles have no opener (their button just says "Open"). For files, the
 * per-file `openWith` override wins when that app is still registered; otherwise the default
 * app for the file name's extension is used.
 *
 * @param {FSNode} node - Item shown in Quick Look.
 * @returns {string | null} The opener's app id, or null when there is none.
 *
 * @example
 * openerFor(notesTxtNode); // e.g. 'textedit'
 * openerFor(folderNode); // null
 */
function openerFor(node: FSNode): string | null {
  if (node.type === 'dir' || isAppFile(node)) return null;
  const preferred = node.meta?.openWith;
  return (preferred && getApp(preferred) ? preferred : defaultAppFor(node.name)) ?? null;
}

/**
 * Quick Look panel: a floating, movable, non-modal preview over the Finder window.
 *
 * It never takes focus, so the Finder keeps handling the keyboard: arrow keys move the selection
 * underneath (the panel follows `node`) and Space / Escape close it. The header can be dragged
 * with the primary button to offset the panel (pointer capture keeps the drag going outside it);
 * presses on its buttons do not start a drag. The window traffic lights sit at the top left:
 * close, and zoom to full size (the panel then fills the window; pressing it again
 * restores the floating size and position). At the top right are, for files and apps, a plain
 * "Open" / "Open with <app>" text button and a plain Share icon. The Share menu offers AirDrop (which reports that no devices are nearby), Copy (to the file
 * clipboard) and, for files, Download to This Computer.
 *
 * Items with a content preview (images, text, PDFs, media…) get a large panel: the item name with
 * an "index / total" counter for multi-item selections between the buttons, the preview body
 * (keyed by path so it remounts for each item) and a footer with the folder's item count or the
 * file's kind and size. Folders, apps and other files without one get a compact card (macOS 26):
 * a big icon beside the name, the same details and the modification date.
 *
 * @param {Props} props - Component props.
 * @param {FSNode} props.node - Item being previewed.
 * @param {{ index: number; total: number }} [props.position] - Position of the item in a multi-item selection.
 * @param {{ x: number; y: number }} [props.origin] - Viewport point the panel is first centred on.
 * @param {() => void} props.onClose - Closes the panel.
 * @param {(node: FSNode) => void} props.onOpen - Opens the item; the panel closes right after.
 * @returns {JSX.Element} The panel overlay.
 *
 * @example
 * <QuickLook node={leadNode} onClose={() => setQuickLook(false)}
 *   onOpen={(n) => openItems([n.path])} />
 */
export function QuickLook({ node, position, origin, onClose, onOpen }: Props) {
  const t = useT();
  const locale = useLocale();
  const [offset, setOffset] = useState(() => (origin ? { x: Math.round(origin.x - window.innerWidth / 2), y: Math.round(origin.y - window.innerHeight / 2) } : { x: 0, y: 0 }));
  const [full, setFull] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const opener = openerFor(node);
  const appName = opener ? t(getApp(opener)?.name) : '';
  const canOpen = !!opener || node.type === 'dir' || isAppFile(node);
  const name = displayName(node, locale);

  /**
   * Starts dragging the panel from its header.
   *
   * Ignores non-primary buttons and presses on buttons inside the header, captures the pointer
   * and records the start position together with the current offset.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer-down event on the header.
   * @returns {void} Nothing.
   *
   * @example
   * <div onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  /**
   * Moves the panel while a header drag is in progress.
   *
   * Sets the offset to the drag's starting offset plus the pointer's movement since then;
   * does nothing when no drag is active.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer-move event on the header.
   * @returns {void} Nothing.
   *
   * @example
   * <div onPointerMove={onPointerMove} />
   */
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
  };
  /**
   * Ends a header drag, keeping the panel at its current offset.
   *
   * Used for both pointer-up and pointer-cancel.
   *
   * @returns {void} Nothing.
   *
   * @example
   * <div onPointerUp={endDrag} onPointerCancel={endDrag} />
   */
  const endDrag = () => {
    drag.current = null;
  };

  const details = node.type === 'dir' ? itemCount(fs.walk(node.path).length, locale) : `${kindLabel(node, locale)} – ${formatBytes(fileSizeOf(node), locale)}`;

  const openLabel = !opener ? t(S.open) : locale === 'ko' ? `${withRo(appName)} 열기` : `Open with ${appName}`;
  const rich = hasContentPreview(node);

  /**
   * Opens the Share menu just below the Share button.
   *
   * @param {ReactMouseEvent<HTMLButtonElement>} e - Click event of the Share button.
   * @returns {void}
   *
   * @example
   * <button onClick={shareMenu} />
   */
  const shareMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    showContextMenu(
      {
        clientX: b.left,
        clientY: b.bottom + 4,
        preventDefault: () => {},
        stopPropagation: () => {},
      },
      [
        {
          label: S.airDrop,
          action: () => notify({ appId: 'finder', title: S.airDrop, body: S.airDropNone }),
        },
        { separator: true },
        { label: S.copy, action: () => fileClipboard.copy([node.path]) },
        ...(node.type === 'file' ? [{ label: S.download, action: () => void downloadFile(node.path) }] : []),
      ],
    );
  };
  const controls = (
    <>
      <div className={s.side}>
        <PanelLights onClose={onClose} onZoom={() => setFull((f) => !f)} zoomed={full} closeLabel={t(S.closeQuickLook)} zoomLabel={t(full ? S.exitFullScreen : S.fullScreen)} />
      </div>
      <div className={s.title}>
        {rich && <span className={s.name}>{name}</span>}
        {position && position.total > 1 && (
          <span className={s.counter}>
            {position.index + 1} / {position.total}
          </span>
        )}
      </div>
      <div className={`${s.side} ${s.sideEnd}`}>
        {canOpen && node.type !== 'dir' && (
          <button
            type="button"
            className={s.textBtn}
            onClick={() => {
              onOpen(node);
              onClose();
            }}
          >
            {openLabel}
          </button>
        )}
        <button type="button" className={s.iconBtn} aria-label={t(S.share)} title={t(S.share)} aria-haspopup="menu" onClick={shareMenu}>
          <Share size={17} strokeWidth={1.9} />
        </button>
      </div>
    </>
  );

  return (
    <div className={s.layer}>
      <div
        className={`lg lg-thick lg-float ${s.panel} ${full ? s.full : rich ? '' : s.compact}`}
        role="dialog"
        aria-label={`${t(S.quickLook)}: ${name}`}
        style={full ? undefined : { translate: `${offset.x}px ${offset.y}px` }}
      >
        <div className={s.header} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {controls}
        </div>
        {rich ? (
          <>
            <div className={s.body} key={node.path}>
              <FilePreview node={node} variant="full" />
            </div>
            <div className={s.footer}>{details}</div>
          </>
        ) : (
          <div className={s.card} key={node.path} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <FileIcon node={node} size={180} />
            <div className={s.meta}>
              <h2 className={s.bigName}>{name}</h2>
              <p>{details}</p>
              <p>
                {fmt(t(S.modifiedInline), {
                  date: formatDate(node.modifiedAt, locale, {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  }),
                })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

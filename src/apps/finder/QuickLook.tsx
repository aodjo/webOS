import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import type { FSNode } from '@/kernel';
import { defaultAppFor, fileSizeOf, formatBytes, fs, getApp, useLocale, useT } from '@/kernel';
import { Button } from '@/components/ui';
import { displayName, isAppFile, itemCount, kindLabel, withRo } from './model';
import { S } from './strings';
import { FilePreview } from './Preview';
import s from './QuickLook.module.css';

interface Props {
  node: FSNode;
  /** Zero-based item index and selection size; shown as a 1-based counter when total > 1. */
  position?: { index: number; total: number };
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
 * presses on its buttons do not start a drag. The header shows a close button, the item name with
 * an "index / total" counter for multi-item selections, and an "Open" / "Open with <app>" button
 * when the item can be opened. The footer shows the item count of a folder, or a file's kind and
 * size. The preview body is keyed by path so it remounts for each item.
 *
 * @param {Props} props - Component props.
 * @param {FSNode} props.node - Item being previewed.
 * @param {{ index: number; total: number }} [props.position] - Position of the item in a multi-item selection.
 * @param {() => void} props.onClose - Closes the panel.
 * @param {(node: FSNode) => void} props.onOpen - Opens the item; the panel closes right after.
 * @returns {JSX.Element} The panel overlay.
 *
 * @example
 * <QuickLook node={leadNode} onClose={() => setQuickLook(false)}
 *   onOpen={(n) => openItems([n.path])} />
 */
export function QuickLook({ node, position, onClose, onOpen }: Props) {
  const t = useT();
  const locale = useLocale();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
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

  const details =
    node.type === 'dir'
      ? itemCount(fs.walk(node.path).length, locale)
      : `${kindLabel(node, locale)} – ${formatBytes(fileSizeOf(node), locale)}`;

  return (
    <div className={s.layer}>
      <div className={`lg lg-thick lg-float ${s.panel}`} role="dialog" aria-label={`${t(S.quickLook)}: ${name}`} style={{ translate: `${offset.x}px ${offset.y}px` }}>
        <div className={s.header} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <button type="button" className={`lg lg-control lg-circle lg-interactive ${s.close}`} aria-label={t(S.closeQuickLook)} onClick={onClose}>
            <X size={12} strokeWidth={2.6} />
          </button>
          <div className={s.title}>
            <span className={s.name}>{name}</span>
            {position && position.total > 1 && (
              <span className={s.counter}>
                {position.index + 1} / {position.total}
              </span>
            )}
          </div>
          {canOpen && (
            <Button
              className={s.openBtn}
              onClick={() => {
                onOpen(node);
                onClose();
              }}
            >
              {!opener ? t(S.open) : locale === 'ko' ? `${withRo(appName)} 열기` : `Open with ${appName}`}
            </Button>
          )}
        </div>
        <div className={s.body} key={node.path}>
          <FilePreview node={node} variant="full" />
        </div>
        <div className={s.footer}>{details}</div>
      </div>
    </div>
  );
}

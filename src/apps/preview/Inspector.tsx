import { X } from 'lucide-react';
import { dirname, fileSizeOf, formatBytes, formatDate, tildify, useLocale, useT, type FSNode, type LString } from '@/kernel';
import { FileIcon } from '@/icons';
import styles from './Preview.module.css';

const S = {
  title: { en: 'Info', ko: '정보' },
  close: { en: 'Close Inspector', ko: '속성 닫기' },
  kind: { en: 'Kind', ko: '종류' },
  size: { en: 'Size', ko: '크기' },
  dimensions: { en: 'Dimensions', ko: '치수' },
  zoom: { en: 'Zoom', ko: '확대/축소' },
  where: { en: 'Where', ko: '위치' },
  created: { en: 'Created', ko: '생성일' },
  modified: { en: 'Modified', ko: '수정일' },
}; /** Localized labels for the inspector's title, close button and info rows. */

interface Props {
  node: FSNode;
  kindLabel: LString;
  dimensions: { width: number; height: number } | null;
  zoom: number | null;
  onClose: () => void;
}

/**
 * Floating info panel for the previewed file (Tools ▸ Show Inspector, ⌘I).
 *
 * Shows the file icon, name and kind in a header, followed by rows for kind, size, dimensions
 * and zoom (only when known), enclosing folder and creation/modification dates, formatted for
 * the current locale. It renders as a thick Liquid Glass popover; because `.lg` draws its rim
 * with pseudo-elements, the scrolling happens in an inner element.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - The file being previewed.
 * @param {LString} props.kindLabel - Localized description of the file's kind.
 * @param {{ width: number; height: number } | null} props.dimensions - Pixel size of the image or
 *   video, or null to hide the row.
 * @param {number | null} props.zoom - Current zoom percentage, or null to hide the row.
 * @param {() => void} props.onClose - Called when the close button is clicked.
 * @returns {JSX.Element} The inspector panel.
 *
 * @example
 * <Inspector node={file} kindLabel={kindLabel(kind)} dimensions={dims} zoom={100} onClose={hide} />
 */
export function Inspector({ node, kindLabel, dimensions, zoom, onClose }: Props) {
  const t = useT();
  const locale = useLocale();
  const rows: [LString, string][] = [
    [S.kind, t(kindLabel)],
    [S.size, formatBytes(fileSizeOf(node), locale)],
  ];
  if (dimensions) rows.push([S.dimensions, `${dimensions.width} × ${dimensions.height}`]);
  if (zoom !== null) rows.push([S.zoom, `${zoom}%`]);
  rows.push([S.where, tildify(dirname(node.path))], [S.created, formatDate(node.createdAt, locale)], [S.modified, formatDate(node.modifiedAt, locale)]);

  return (
    <aside className={`lg lg-thick lg-float ${styles.inspector}`} aria-label={t(S.title)}>
      <div className={styles.inspectorScroll}>
        <header className={styles.inspectorHead}>
          <FileIcon node={node} size={32} />
          <div className={styles.inspectorName}>
            <strong title={node.name}>{node.name}</strong>
            <span>{t(kindLabel)}</span>
          </div>
          <button type="button" className={styles.inspectorClose} aria-label={t(S.close)} title={t(S.close)} onClick={onClose}>
            <X size={12} strokeWidth={2.4} />
          </button>
        </header>
        <dl className={`${styles.inspectorRows} selectable`}>
          {rows.map(([k, v]) => (
            <div key={t(k)} className={styles.inspectorRow}>
              <dt>{t(k)}</dt>
              <dd title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}

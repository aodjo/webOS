/** Bottom path bar & status bar, the Trash banner and the search scope bar. */
import { ChevronRight, Clock } from 'lucide-react';
import type { FSNode } from '@/kernel';
import { formatBytes, useFS, useLocale, useT, wm } from '@/kernel';
import { Button, Slider } from '@/components/ui';
import { FileIcon } from '@/icons';
import { RECENTS, ancestors, diskUsage, displayName, isVirtual, itemCount, locationName, tagOf } from './model';
import { S, tagColor } from './strings';
import { useDropTarget } from './dnd';
import s from './Finder.module.css';

interface PathBarProps {
  /** Selected item or current folder (real path), or a virtual location. */
  target: string;
  windowId: string;
  onNavigate: (dir: string) => void;
  onDropped: (paths: string[], dir: string) => void;
}

/**
 * Footer bar that shows the folder chain leading to the current target.
 *
 * For a real path it renders one `Crumb` per ancestor, from "/" down to the target itself,
 * separated by chevrons; every folder crumb is also a drop target. For a virtual location
 * (Recents or a tag) it renders a single static crumb with a clock glyph or the tag's color
 * dot and the location's localized name.
 *
 * @param {PathBarProps} props - Component props.
 * @param {string} props.target - Selected item or current folder path, or a virtual location id.
 * @param {string} props.windowId - Id of the Finder window that owns the bar (hosts error sheets for drops).
 * @param {(dir: string) => void} props.onNavigate - Called to open a folder in the window.
 * @param {(paths: string[], dir: string) => void} props.onDropped - Called after items were dropped on a crumb.
 * @returns {JSX.Element} The path bar element.
 *
 * @example
 * <PathBar target="/Users/guest/Documents" windowId={id} onNavigate={navigate} onDropped={selectIfHere} />
 */
export function PathBar({ target, windowId, onNavigate, onDropped }: PathBarProps) {
  const locale = useLocale();
  if (isVirtual(target)) {
    const tag = tagOf(target);
    return (
      <div className={s.pathBar}>
        <span className={s.crumb}>
          {target === RECENTS ? <Clock size={13} className={s.crumbGlyph} /> : <span className={s.crumbDot} style={{ background: tagColor(tag ?? undefined) }} />}
          <span className={s.crumbLabel}>{locationName(target, locale)}</span>
        </span>
      </div>
    );
  }
  const chain = ancestors(target);
  return (
    <div className={s.pathBar} role="navigation">
      {chain.map((p, i) => (
        <Crumb key={p} path={p} last={i === chain.length - 1} windowId={windowId} onNavigate={onNavigate} onDropped={onDropped} />
      ))}
    </div>
  );
}

/**
 * One clickable segment of the path bar.
 *
 * Subscribes to the node at `path` and renders nothing when it does not exist. A click on a
 * folder crumb (other than the last one) navigates to it; a double-click opens folders in the
 * window and files in their default app. Folder crumbs accept dropped items and spring-load
 * (navigate) when a drag hovers over them. A chevron separator follows every crumb but the last.
 *
 * @param {Object} props - Component props.
 * @param {string} props.path - Absolute path of the item this crumb represents.
 * @param {boolean} props.last - Whether this is the final crumb (the target itself).
 * @param {string} props.windowId - Id of the owning Finder window.
 * @param {(dir: string) => void} props.onNavigate - Called to open a folder in the window.
 * @param {(paths: string[], dir: string) => void} props.onDropped - Called after items were dropped on this crumb.
 * @returns {JSX.Element | null} The crumb button plus separator, or null when the node is missing.
 *
 * @example
 * <Crumb path="/Users/guest" last={false} windowId={id} onNavigate={navigate} onDropped={onDropped} />
 */
function Crumb({ path, last, windowId, onNavigate, onDropped }: { path: string; last: boolean; windowId: string; onNavigate: (dir: string) => void; onDropped: PathBarProps['onDropped'] }) {
  const locale = useLocale();
  const node = useFS((st) => st.nodes[path]) as FSNode | undefined;
  const isDir = node?.type === 'dir';
  const drop = useDropTarget({ dir: isDir ? path : null, windowId, onSpring: isDir ? () => onNavigate(path) : undefined, onDropped: (paths) => onDropped(paths, path) });
  if (!node) return null;
  return (
    <>
      <button
        type="button"
        className={`${s.crumb} ${last ? s.crumbLast : ''} ${drop.over ? s.crumbDrop : ''}`}
        title={path}
        onDoubleClick={() => (isDir ? onNavigate(path) : wm.openPath(path))}
        onClick={() => isDir && !last && onNavigate(path)}
        {...drop.props}
      >
        <FileIcon node={node} size={14} />
        <span className={s.crumbLabel}>{displayName(node, locale)}</span>
      </button>
      {!last && <ChevronRight size={11} strokeWidth={2.4} className={s.crumbSep} aria-hidden="true" />}
    </>
  );
}

interface StatusBarProps {
  count: number;
  selected: number;
  showAvailable: boolean;
  iconSize: number | null;
  onIconSize: (v: number) => void;
}

/**
 * Footer bar with the item count, selection count, free disk space and an icon-size slider.
 *
 * The centered text joins the localized item count, the number of selected items (when any)
 * and the available space (when `showAvailable`). The FS store selector returns only the free
 * space number, so the bar re-renders when that number changes rather than on every FS write.
 * The slider appears on the right only when `iconSize` is not null (icon view).
 *
 * @param {StatusBarProps} props - Component props.
 * @param {number} props.count - Number of items shown in the view.
 * @param {number} props.selected - Number of selected items.
 * @param {boolean} props.showAvailable - Whether to append the available disk space.
 * @param {number | null} props.iconSize - Current icon size in pixels, or null to hide the slider.
 * @param {(v: number) => void} props.onIconSize - Called with the new size when the slider moves.
 * @returns {JSX.Element} The status bar element.
 *
 * @example
 * <StatusBar count={12} selected={2} showAvailable iconSize={64} onIconSize={setIconSize} />
 */
export function StatusBar({ count, selected, showAvailable, iconSize, onIconSize }: StatusBarProps) {
  const t = useT();
  const locale = useLocale();
  const available = useFS((st) => (showAvailable ? diskUsage(st.nodes).available : 0));
  const parts = [itemCount(count, locale)];
  if (selected) parts.push(locale === 'ko' ? `${selected}개 선택됨` : `${selected} selected`);
  if (showAvailable) parts.push(locale === 'ko' ? `${formatBytes(available, locale)} 사용 가능` : `${formatBytes(available, locale)} available`);
  return (
    <div className={s.statusBar}>
      <div className={s.statusSide} />
      <div className={s.statusText}>{parts.join(', ')}</div>
      <div className={s.statusSide}>{iconSize !== null && <Slider value={iconSize} min={32} max={128} step={8} onChange={onIconSize} label={t(S.iconSize)} style={{ width: 84 }} />}</div>
    </div>
  );
}

/**
 * Banner shown under the toolbar while viewing the Trash.
 *
 * Displays the "Trash" title and an "Empty" button that is disabled when the Trash has no items.
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.empty - Whether the Trash is empty (disables the button).
 * @param {() => void} props.onEmpty - Called when the "Empty" button is clicked.
 * @returns {JSX.Element} The banner element.
 *
 * @example
 * <TrashBanner empty={!trashCount} onEmpty={() => void emptyTrashWithConfirm(windowId)} />
 */
export function TrashBanner({ empty, onEmpty }: { empty: boolean; onEmpty: () => void }) {
  const t = useT();
  return (
    <div className={s.banner}>
      <span className={s.bannerTitle}>{t(S.trash)}</span>
      <Button disabled={empty} onClick={onEmpty}>
        {t(S.empty)}
      </Button>
    </div>
  );
}

/**
 * Search scope toolbar shown under the toolbar while a search is active.
 *
 * Offers two toggle buttons, "This Computer" and the quoted name of the current folder; the
 * active one is marked with `aria-pressed`.
 *
 * @param {Object} props - Component props.
 * @param {'all' | 'folder'} props.scope - The active search scope.
 * @param {string} props.folderName - Display name of the folder searched in the 'folder' scope.
 * @param {(s: 'all' | 'folder') => void} props.onScope - Called with the scope the user picked.
 * @returns {JSX.Element} The scope bar element.
 *
 * @example
 * <ScopeBar scope="folder" folderName="Documents" onScope={setScope} />
 */
export function ScopeBar({ scope, folderName, onScope }: { scope: 'all' | 'folder'; folderName: string; onScope: (s: 'all' | 'folder') => void }) {
  const t = useT();
  return (
    <div className={s.banner} role="toolbar" aria-label={t(S.searchLabel)}>
      <span className={s.bannerLabel}>{t(S.searchLabel)}</span>
      <button type="button" className={s.scopeBtn} aria-pressed={scope === 'all'} onClick={() => onScope('all')}>
        {t(S.thisComputer)}
      </button>
      <button type="button" className={s.scopeBtn} aria-pressed={scope === 'folder'} onClick={() => onScope('folder')}>
        “{folderName}”
      </button>
    </div>
  );
}

import { useRef, useState, type ComponentType, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AppWindowMac, ChevronRight, CircleArrowDown, Clock, FileText, HardDrive, House, Image, Monitor, Music } from 'lucide-react';
import type { LString, MenuItem } from '@/kernel';
import { HOME, PATHS, USER, emptyTrashWithConfirm, openGetInfo, revealInFinder, showContextMenu, useT, useTrashCount, wm } from '@/kernel';
import { osInfo } from '@/data/portfolio';
import { RECENTS, TAG_PREFIX, isVirtual } from './model';
import { S, TAG_COLORS } from './strings';
import { useDropTarget } from './dnd';
import { prefs, useFinderPrefs } from './prefs';
import { TrashEmptyGlyph, TrashFullGlyph } from './glyphs';
import s from './Sidebar.module.css';

/** Icon component accepted for a sidebar row (lucide icons and the custom Trash glyphs). */
type Glyph = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

/** One sidebar row: a real folder or virtual location, drawn with a glyph or a tag color dot. */
interface Entry {
  path: string;
  label: LString;
  icon?: Glyph;
  color?: string;
}

const TOP: Entry[] = [{ path: RECENTS, label: S.recents, icon: Clock }]; /** Rows above the titled sections (macOS 26): Recents. */

const FAVORITES: Entry[] = [
  { path: PATHS.applications, label: S.applications, icon: AppWindowMac },
  { path: PATHS.desktop, label: S.desktop, icon: Monitor },
  { path: PATHS.documents, label: S.documents, icon: FileText },
  { path: PATHS.downloads, label: S.downloads, icon: CircleArrowDown },
  { path: PATHS.pictures, label: S.pictures, icon: Image },
  { path: PATHS.music, label: S.music, icon: Music },
]; /** Rows of the Favorites section: the standard folders. */

interface Props {
  location: string;
  width: number;
  windowId: string;
  onNavigate: (path: string) => void;
  onDropped: (paths: string[], dir: string) => void;
  /** Renders the sidebar as an overlay drawer for narrow windows: fixed width, no resizer. */
  drawer?: boolean;
}

/**
 * Finder sidebar laid out like macOS 26: Recents on top without a heading, then the Favorites
 * (standard folders), Locations (home folder, startup disk and Trash) and Tags sections.
 *
 * Each section title toggles its collapsed state in the Finder prefs. Rows navigate on click,
 * accept dropped items (with spring-loading) and have their own context menu; the Trash row
 * swaps its glyph when the Trash is not empty. Docked, the Liquid Glass pane is inset in the
 * window and followed by a resize handle: while it is dragged the width lives in local state
 * and is committed to the prefs on release. As a drawer it floats over the content at a fixed
 * width without a resizer.
 *
 * @param {Props} props - Component props.
 * @param {string} props.location - Current location, used to highlight the matching row.
 * @param {number} props.width - Docked width in pixels from the Finder prefs.
 * @param {string} props.windowId - Finder window id (drag and drop, dialogs).
 * @param {(path: string) => void} props.onNavigate - Opens a location in the window.
 * @param {(paths: string[], dir: string) => void} props.onDropped - Called after items were
 *   dropped onto a row's folder.
 * @param {boolean} [props.drawer=false] - Renders the sidebar as an overlay drawer.
 * @returns {JSX.Element} The sidebar navigation element.
 *
 * @example
 * <Sidebar location={PATHS.documents} width={180} windowId={id} onNavigate={navigate} onDropped={selectDropped} />
 */
export function Sidebar({ location, width, windowId, onNavigate, onDropped, drawer = false }: Props) {
  const t = useT();
  const trashFull = useTrashCount() > 0;
  const collapsed = useFinderPrefs((p) => p.collapsed);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const locations: Entry[] = [
    { path: HOME, label: USER, icon: House },
    { path: '/', label: `${osInfo.name} HD`, icon: HardDrive },
    { path: PATHS.trash, label: S.trash, icon: trashFull ? TrashFullGlyph : TrashEmptyGlyph },
  ];
  const tags: Entry[] = TAG_COLORS.map((c) => ({ path: TAG_PREFIX + c.id, label: c.name, color: c.color }));
  const sections: { id: string; title?: LString; entries: Entry[] }[] = [
    { id: 'top', entries: TOP },
    { id: 'favorites', title: S.favorites, entries: FAVORITES },
    { id: 'locations', title: S.locations, entries: locations },
    { id: 'tags', title: S.tags, entries: tags },
  ];

  return (
    <nav className={`${s.sidebar} ${drawer ? s.drawer : s.docked}`} style={drawer ? undefined : { width: liveWidth ?? width }} aria-label={t(S.sidebar)}>
      {/* Liquid Glass pane inset in the window (docked) or floating over the content (drawer).
          The traffic lights sit in its top area. */}
      <div className={`lg ${drawer ? 'lg-thick lg-float' : ''} ${s.pane}`}>
        <div className={s.titlebarSpace} data-drag-region />
        <div className={s.scroll}>
          {sections.map((sec) => (
            <section key={sec.id} className={s.section}>
              {sec.title && (
                <button type="button" className={s.sectionTitle} aria-expanded={!collapsed[sec.id]} onClick={() => prefs.toggleSection(sec.id)}>
                  <span>{t(sec.title)}</span>
                  <ChevronRight size={12} strokeWidth={2.4} className={`${s.sectionChevron} ${collapsed[sec.id] ? '' : s.sectionOpen}`} aria-hidden="true" />
                </button>
              )}
              {!(sec.title && collapsed[sec.id]) && (
                <div className={s.items}>
                  {sec.entries.map((e) => (
                    <SidebarRow key={e.path} entry={e} selected={location === e.path} windowId={windowId} onNavigate={onNavigate} onDropped={onDropped} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
      {!drawer && <SidebarResizer width={liveWidth ?? width} onLive={setLiveWidth} />}
    </nav>
  );
}

/**
 * A single sidebar row.
 *
 * Clicking navigates to the entry. Real folders, including the Trash, are drop targets, and all
 * of them except the Trash spring-load (navigate while a drag hovers over them); virtual
 * locations such as Recents and tags accept no drops. The row shows the entry's glyph, or a
 * color dot for tags, and is highlighted while selected or while a drag hovers over it.
 *
 * @param {Object} props - Component props.
 * @param {Entry} props.entry - Location shown by the row.
 * @param {boolean} props.selected - Whether the row is the current location.
 * @param {string} props.windowId - Finder window id (drag and drop, dialogs).
 * @param {(path: string) => void} props.onNavigate - Opens a location in the window.
 * @param {Props['onDropped']} props.onDropped - Called with the dropped paths and the row's folder.
 * @returns {JSX.Element} The row button.
 *
 * @example
 * <SidebarRow entry={entry} selected={location === entry.path} windowId={id}
 *   onNavigate={go} onDropped={dropped} />
 */
function SidebarRow({ entry, selected, windowId, onNavigate, onDropped }: { entry: Entry; selected: boolean; windowId: string; onNavigate: (path: string) => void; onDropped: Props['onDropped'] }) {
  const t = useT();
  const virtual = isVirtual(entry.path);
  const drop = useDropTarget({
    dir: virtual ? null : entry.path,
    windowId,
    onSpring: virtual || entry.path === PATHS.trash ? undefined : () => onNavigate(entry.path),
    onDropped: (paths) => onDropped(paths, entry.path),
  });
  const Icon = entry.icon;

  /**
   * Shows the row's context menu.
   *
   * Always offers "Open in New Window". Real locations add "Show in Enclosing Folder" (except
   * the startup disk) and "Get Info"; the Trash also offers "Empty Trash", which asks for
   * confirmation.
   *
   * @param {MouseEvent} e - The contextmenu event, used to position the menu.
   * @returns {void} Nothing.
   *
   * @example
   * <button onContextMenu={onContextMenu} />
   */
  const onContextMenu = (e: MouseEvent) => {
    const items: MenuItem[] = [{ label: S.openInNewWindow, action: () => wm.openWindow('finder', { path: entry.path }) }];
    if (!virtual) {
      if (entry.path !== '/') items.push({ label: S.showInEnclosingFolder, action: () => revealInFinder(entry.path) });
      items.push({ separator: true }, { label: S.getInfo, action: () => openGetInfo(entry.path) });
    }
    if (entry.path === PATHS.trash) items.push({ separator: true }, { label: S.emptyTrash, action: () => void emptyTrashWithConfirm(windowId) });
    showContextMenu(e, items);
  };

  return (
    <button
      type="button"
      className={`${s.item} ${selected ? s.selected : ''} ${drop.over ? s.drop : ''}`}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onNavigate(entry.path)}
      onContextMenu={onContextMenu}
      {...drop.props}
    >
      {Icon ? <Icon size={16} strokeWidth={1.8} className={s.glyph} /> : <span className={s.tagDot} style={{ background: entry.color }} />}
      <span className={s.label}>{t(entry.label)}</span>
    </button>
  );
}

const MIN_WIDTH = 150; /** Narrowest docked sidebar width in pixels the resizer allows. */
const MAX_WIDTH = 320; /** Widest docked sidebar width in pixels the resizer allows. */

/**
 * Vertical resize handle on the right edge of the docked sidebar.
 *
 * Dragging with the primary button (pointer captured) reports the rounded width, clamped to
 * `MIN_WIDTH`..`MAX_WIDTH`, through `onLive` on every move. On release or cancel the final width
 * is saved to the Finder prefs if it changed, and `onLive(null)` hands control back to the
 * persisted width. Exposed as an ARIA separator with the current and allowed widths.
 *
 * @param {Object} props - Component props.
 * @param {number} props.width - Current sidebar width in pixels.
 * @param {(w: number | null) => void} props.onLive - Receives the live width while dragging, then null.
 * @returns {JSX.Element} The resize handle.
 *
 * @example
 * <SidebarResizer width={liveWidth ?? width} onLive={setLiveWidth} />
 */
function SidebarResizer({ width, onLive }: { width: number; onLive: (w: number | null) => void }) {
  const t = useT();
  const startRef = useRef<{ x: number; w: number; last: number } | null>(null);
  /**
   * Starts a resize drag.
   *
   * Ignores non-primary buttons, prevents text selection, captures the pointer and records the
   * start position and width.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer-down event on the handle.
   * @returns {void} Nothing.
   *
   * @example
   * <div onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, w: width, last: width };
  };
  /**
   * Updates the live width while a resize drag is active.
   *
   * Adds the horizontal pointer movement to the starting width, clamps and rounds it, stores it
   * as the drag's last width and reports it through `onLive`.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer-move event on the handle.
   * @returns {void} Nothing.
   *
   * @example
   * <div onPointerMove={onPointerMove} />
   */
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    start.last = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start.w + e.clientX - start.x)));
    onLive(start.last);
  };
  /**
   * Ends a resize drag.
   *
   * Saves the last width to the Finder prefs when it differs from the starting width and clears
   * the live width. Used for both pointer-up and pointer-cancel.
   *
   * @returns {void} Nothing.
   *
   * @example
   * <div onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
   */
  const onPointerUp = () => {
    const start = startRef.current;
    if (!start) return;
    startRef.current = null;
    if (start.last !== start.w) prefs.set({ sidebarWidth: start.last });
    onLive(null);
  };
  return (
    <div
      className={s.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label={t(S.resizeSidebar)}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

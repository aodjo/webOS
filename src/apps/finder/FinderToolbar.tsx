import type { KeyboardEvent, MouseEvent, RefObject } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, CircleEllipsis, Columns3, GalleryHorizontalEnd, LayoutGrid, List, PanelLeft, Rows3 } from 'lucide-react';
import { useT } from '@/kernel';
import { IconButton, SearchField, Segmented, Toolbar } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import type { ViewMode } from './model';
import { S } from './strings';
import s from './Finder.module.css';

interface Props {
  title: string;
  inset: boolean;
  /** Narrow windows only: state and handler of the button that opens or closes the sidebar drawer. */
  sidebarToggle?: { open: boolean; onToggle: () => void };
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  onSortMenu: (anchor: DOMRect) => void;
  onActionMenu: (anchor: DOMRect) => void;
  query: string;
  onQuery: (q: string) => void;
  /** Called when ↓ is pressed in the search field with a query set, to move the keyboard into the results. */
  onSearchDown: () => void;
  searchRef: RefObject<HTMLDivElement | null>;
}

/**
 * Unified Finder toolbar whose controls float in Liquid Glass capsules.
 *
 * Renders, from left to right: the sidebar-drawer toggle (only when `sidebarToggle` is given),
 * the back / forward capsule, the folder title and a draggable spacer, the view-mode segmented
 * control, the group-sort and action menu buttons, and the search field. The search field is a
 * glass circle that expands into a capsule on focus or while a query is set. The optional
 * controls are hidden in narrow windows by container queries in Finder.module.css.
 *
 * @param {Props} p - Toolbar props.
 * @param {string} p.title - Folder title shown in the middle (also used as its tooltip).
 * @param {boolean} p.inset - Whether the toolbar leaves room on the left for the traffic lights.
 * @param {{ open: boolean; onToggle: () => void }} [p.sidebarToggle] - Drawer toggle state and
 *   handler for narrow windows.
 * @param {boolean} p.canBack - Enables the back button.
 * @param {boolean} p.canForward - Enables the forward button.
 * @param {() => void} p.onBack - Navigates back in the window history.
 * @param {() => void} p.onForward - Navigates forward in the window history.
 * @param {ViewMode} p.view - Active view mode shown in the segmented control.
 * @param {(v: ViewMode) => void} p.onView - Called with the view mode picked in the segmented control.
 * @param {(anchor: DOMRect) => void} p.onSortMenu - Opens the group/sort menu below the given button rectangle.
 * @param {(anchor: DOMRect) => void} p.onActionMenu - Opens the action menu below the given button rectangle.
 * @param {string} p.query - Current search query.
 * @param {(q: string) => void} p.onQuery - Called with the new query on every edit, and with '' on Escape.
 * @param {() => void} p.onSearchDown - Moves keyboard focus into the search results.
 * @param {RefObject<HTMLDivElement | null>} p.searchRef - Ref attached to the search container.
 * @returns {JSX.Element} The toolbar element.
 *
 * @example
 * <FinderToolbar title="Documents" inset view="icons" query="" canBack={false} canForward={false}
 *   searchRef={searchRef} {...handlers} />
 */
export function FinderToolbar(p: Props) {
  const t = useT();
  /**
   * Returns the viewport rectangle of the element that received a mouse event.
   *
   * Used to position the group/sort and action menus right below their buttons.
   *
   * @param {MouseEvent<HTMLElement>} e - Click event of a toolbar button.
   * @returns {DOMRect} The bounding rectangle of `e.currentTarget`.
   *
   * @example
   * p.onSortMenu(anchor(e));
   */
  const anchor = (e: MouseEvent<HTMLElement>) => e.currentTarget.getBoundingClientRect();
  /**
   * Handles keys in the search field.
   *
   * Ignores keys pressed during IME composition. Escape clears the query, blurs the field and
   * stops the event so the window does not handle it too. ArrowDown, when the query is not
   * blank, blurs the field and calls `onSearchDown` to move into the results.
   *
   * @param {KeyboardEvent<HTMLInputElement>} e - Keydown event from the search input.
   * @returns {void} Nothing.
   *
   * @example
   * <SearchField value={p.query} onChange={p.onQuery} onKeyDown={onSearchKey} />
   */
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      p.onQuery('');
      e.currentTarget.blur();
    } else if (e.key === 'ArrowDown' && p.query.trim()) {
      e.preventDefault();
      e.currentTarget.blur();
      p.onSearchDown();
    }
  };

  return (
    <Toolbar inset={p.inset} className={s.toolbar}>
      {p.sidebarToggle && (
        <GlassGroup className={s.group}>
          <IconButton className={s.sidebarBtn} label={t(p.sidebarToggle.open ? S.hideSidebar : S.showSidebar)} aria-expanded={p.sidebarToggle.open} onClick={p.sidebarToggle.onToggle}>
            <PanelLeft size={17} />
          </IconButton>
        </GlassGroup>
      )}
      <GlassGroup className={`${s.group} ${s.nav}`} label={t(S.backForward)}>
        <IconButton label={t(S.back)} disabled={!p.canBack} onClick={p.onBack}>
          <ChevronLeft size={19} strokeWidth={2.1} />
        </IconButton>
        <IconButton label={t(S.forward)} disabled={!p.canForward} onClick={p.onForward}>
          <ChevronRight size={19} strokeWidth={2.1} />
        </IconButton>
      </GlassGroup>
      <div className={`ui-toolbar-title ${s.title}`} data-drag-region title={p.title}>
        {p.title}
      </div>
      <div className={s.spacer} data-drag-region />
      <div className={`lg lg-control lg-group ${s.group} ${s.viewSeg}`} data-no-drag>
        <Segmented
          value={p.view}
          onChange={p.onView}
          options={[
            { value: 'icons', title: t(S.icons), label: <LayoutGrid size={15} aria-label={t(S.icons)} /> },
            { value: 'list', title: t(S.list), label: <List size={16} aria-label={t(S.list)} /> },
            { value: 'columns', title: t(S.columns), label: <Columns3 size={15} aria-label={t(S.columns)} /> },
            { value: 'gallery', title: t(S.gallery), label: <GalleryHorizontalEnd size={15} aria-label={t(S.gallery)} /> },
          ]}
        />
      </div>
      <GlassGroup className={`${s.group} ${s.optional}`}>
        <IconButton className={s.menuBtn} label={t(S.groupSort)} aria-haspopup="menu" onClick={(e) => p.onSortMenu(anchor(e))}>
          <Rows3 size={16} />
          <ChevronDown size={10} strokeWidth={2.6} />
        </IconButton>
        <IconButton className={s.menuBtn} label={t(S.actions)} aria-haspopup="menu" onClick={(e) => p.onActionMenu(anchor(e))}>
          <CircleEllipsis size={17} />
          <ChevronDown size={10} strokeWidth={2.6} />
        </IconButton>
      </GlassGroup>
      {/* Without a query (searchIdle) the field is a glass circle; it expands into a capsule on focus or while a query is set. */}
      <div ref={p.searchRef} className={`${s.search} ${p.query ? '' : s.searchIdle}`} role="search" data-no-drag>
        <SearchField value={p.query} onChange={p.onQuery} placeholder={t(S.search)} onKeyDown={onSearchKey} />
      </div>
    </Toolbar>
  );
}

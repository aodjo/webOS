import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AppProps, MenuItem } from '@/kernel';
import { COMMON, PATHS, fs, join, showContextMenu, useAppMenus, useArgsChange, useT, useUI, useWindowKeydown, wm } from '@/kernel';
import { IconButton, SearchField, Select, Spacer, Toolbar } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import { projects, type Project } from '@/data/portfolio';
import { Detail } from './Detail';
import { FilterBar, Hero, ProjectGrid } from './Gallery';
import { allTags, filterProjects, sortProjects, type SortKey } from './filter';
import { revealWithin, useReducedMotion } from './motion';
import styles from './Projects.module.css';

const S = {
  title: { en: 'Projects', ko: '프로젝트' },
  newest: { en: 'Newest', ko: '최신순' },
  name: { en: 'Name', ko: '이름순' },
  sort: { en: 'Sort', ko: '정렬' },
  sortBy: { en: 'Sort By', ko: '정렬 기준' },
  search: { en: 'Search', ko: '검색' },
  searchProjects: { en: 'Search Projects', ko: '프로젝트 검색' },
  back: { en: 'Projects', ko: '프로젝트' },
  backToAll: { en: 'Back to All Projects', ko: '모든 프로젝트로 돌아가기' },
  previous: { en: 'Previous Project', ko: '이전 프로젝트' },
  next: { en: 'Next Project', ko: '다음 프로젝트' },
  navigate: { en: 'Previous / Next Project', ko: '이전 / 다음 프로젝트' },
  clearFilters: { en: 'Clear Filters', ko: '필터 지우기' },
  project: { en: 'Project', ko: '프로젝트' },
  open: { en: 'Open', ko: '열기' },
  openDemo: { en: 'Open Live Demo', ko: '라이브 데모 열기' },
  viewSource: { en: 'View Source Code', ko: '소스 코드 보기' },
  showInFinder: { en: 'Show in Finder', ko: 'Finder에서 보기' },
}; /** Localized UI strings for the Projects app (toolbar, menus, context menu). */

const TAGS = allTags(projects); /** Every project tag, most frequent first; drives the filter bar and validates `tag` args. */
const FEATURED = projects.filter((p) => p.featured); /** Projects flagged `featured`, shown in the hero carousel when no filter is active. */

/**
 * Looks up a project by its id.
 *
 * Accepts any value (typically a window argument) and returns null unless it
 * is a string matching the `id` of a project in the portfolio data.
 *
 * @param {unknown} id - Candidate project id.
 * @returns {Project | null} The matching project, or null.
 *
 * @example
 * const p = byId(args.project);
 * console.log(p?.name); // 'webOS'
 */
const byId = (id: unknown): Project | null => (typeof id === 'string' ? (projects.find((p) => p.id === id) ?? null) : null);

/** Which project the detail view shows and how it animates in. */
interface DetailState {
  /** Id of the project being shown. */
  id: string;
  /** Cover rect the detail was opened from (null = no shared-element transition). */
  origin: DOMRect | null;
  /** Slide direction when stepping between projects: -1 previous, 1 next, 0 none. */
  dir: number;
}

/**
 * Opens a URL in a new Safari window.
 *
 * Passes the address to Safari as the `url` window argument through
 * `wm.openWindow`, so each call opens a separate browser window. Used for a
 * project's live demo and source code links.
 *
 * @param {string} url - Address to load.
 * @returns {string | null} The new window id, or null if Safari is not registered.
 *
 * @example
 * openURL('https://github.com/example/webos');
 */
const openURL = (url: string) => wm.openWindow('safari', { url });

/**
 * Reports whether a shell overlay is currently open.
 *
 * Esc also dismisses shell overlays (Launchpad, Spotlight, Mission Control,
 * the app switcher, or a context menu), so the detail view's Esc shortcut
 * checks this first to avoid leaving the detail view in the same keystroke.
 *
 * @returns {boolean} True when any shell overlay is visible.
 *
 * @example
 * if (!shellOverlayOpen()) close();
 */
function shellOverlayOpen(): boolean {
  const ui = useUI.getState();
  return ui.launchpad || ui.spotlight || ui.missionControl || ui.appSwitcher !== null || ui.contextMenu !== null;
}

/**
 * Reveals a project's folder in a new Finder window.
 *
 * Opens `PATHS.projects/<project name>`. If the visitor renamed or trashed that
 * folder, it falls back to the projects folder, and if that is gone too, to
 * the Documents folder.
 *
 * @param {Project} p - Project whose folder is shown.
 * @returns {void}
 *
 * @example
 * showInFinder(projects[0]);
 */
function showInFinder(p: Project): void {
  const folder = join(PATHS.projects, p.name);
  const path = fs.isDir(folder) ? folder : fs.isDir(PATHS.projects) ? PATHS.projects : PATHS.documents;
  wm.openWindow('finder', { path });
}

/**
 * Projects app window: a filterable gallery of portfolio projects with a detail view.
 *
 * The gallery shows a featured hero carousel (hidden while filtering), a tag
 * filter bar, and a card grid filtered by tags and search text and ordered by
 * the selected sort. Opening a card shows the detail view on top of the
 * gallery, which stays mounted but inert; when motion is allowed, the detail
 * flies out of the card's cover and flies back into it on close, and focus
 * returns to that card afterwards. Previous/next navigation follows the
 * gallery's visible order when the current project is in it, otherwise the
 * full list in the current sort order. The window title tracks the open
 * project.
 *
 * Window args: `tag` preselects a single known tag and `project` opens that
 * project's detail; both are also handled when the args change on an
 * already-open window. The app registers View and Project menus (Esc to go
 * back, ⌘F to search) and uses ←/→ to step between projects in the detail view.
 *
 * @param {Object} props - App window props.
 * @param {string} props.windowId - Id of the window hosting the app.
 * @param {AppArgs} props.args - Launch args (`tag`, `project`).
 * @returns {JSX.Element} The Projects window content.
 *
 * @example
 * wm.openWindow('projects', { project: 'webos' });
 * wm.openWindow('projects', { tag: 'React' });
 */
export default function Projects({ windowId, args }: AppProps) {
  const t = useT();
  const reduce = useReducedMotion();
  const [tags, setTags] = useState<string[]>(() => (typeof args.tag === 'string' && TAGS.includes(args.tag) ? [args.tag] : []));
  const [sort, setSort] = useState<SortKey>('newest');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<DetailState | null>(() => {
    const p = byId(args.project);
    return p ? { id: p.id, origin: null, dir: 0 } : null;
  });
  const [closing, setClosing] = useState(false);
  const covers = useRef(new Map<string, HTMLElement>());
  const galleryScroll = useRef<HTMLDivElement>(null);
  const searchWrap = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);

  const filtered = tags.length > 0 || query.trim() !== '';
  const visible = useMemo(() => filterProjects(projects, { tags, query, sort }), [tags, query, sort]);
  const current = detail ? byId(detail.id) : null;
  const navList = current && visible.some((p) => p.id === current.id) ? visible : sortProjects(projects, sort);
  const pos = current ? navList.findIndex((p) => p.id === current.id) : -1;
  const prev = pos > 0 ? navList[pos - 1] : null;
  const next = pos >= 0 && pos < navList.length - 1 ? navList[pos + 1] : null;

  useEffect(() => {
    wm.setTitle(windowId, current ? current.name : t(S.title));
  }, [windowId, current, t]);

  useEffect(() => {
    if (detail || !refocus.current) return;
    covers.current.get(refocus.current)?.closest('button')?.focus({ preventScroll: true });
    refocus.current = null;
  }, [detail]);

  /**
   * Registers or unregisters a card's cover element.
   *
   * Passed to the grid as a ref callback. The cover elements are kept in a
   * map by project id so the detail view can animate from and back to them
   * and so focus can return to the card after closing.
   *
   * @param {string} id - Project id of the card.
   * @param {HTMLElement | null} el - The mounted cover element, or null on unmount.
   * @returns {void}
   *
   * @example
   * <div ref={(el) => registerCover(project.id, el)} />
   */
  const registerCover = useCallback((id: string, el: HTMLElement | null) => {
    if (el) covers.current.set(id, el);
    else covers.current.delete(id);
  }, []);

  /**
   * Opens a project's detail view from the gallery.
   *
   * Cancels any running close animation and records the cover's current rect
   * as the origin of the shared-element transition. When motion is reduced or
   * no cover element is given, the origin is null and the detail appears
   * without the flight.
   *
   * @param {Project} p - Project to open.
   * @param {HTMLElement | null} coverEl - Cover element the detail flies out of.
   * @returns {void}
   *
   * @example
   * open(project, covers.current.get(project.id) ?? null);
   */
  const open = useCallback(
    (p: Project, coverEl: HTMLElement | null) => {
      setClosing(false);
      setDetail({ id: p.id, origin: coverEl && !reduce ? coverEl.getBoundingClientRect() : null, dir: 0 });
    },
    [reduce],
  );

  /**
   * Switches the detail view to another project.
   *
   * Cancels any running close animation and shows `p` without a
   * shared-element transition; `dir` tells the detail view which way to slide.
   *
   * @param {Project} p - Project to show.
   * @param {number} dir - Slide direction: -1 for previous, 1 for next.
   * @returns {void}
   *
   * @example
   * if (next) navigate(next, 1);
   */
  const navigate = useCallback((p: Project, dir: number) => {
    setClosing(false);
    setDetail({ id: p.id, origin: null, dir });
  }, []);

  /**
   * Removes the detail view once its close animation has finished.
   *
   * Remembers the closed project's id so that, after the gallery becomes
   * interactive again, focus returns to that project's card.
   *
   * @returns {void}
   *
   * @example
   * <Detail onClosed={finishClose} />
   */
  const finishClose = useCallback(() => {
    refocus.current = detail?.id ?? null;
    setDetail(null);
    setClosing(false);
  }, [detail]);

  /**
   * Leaves the detail view and returns to the gallery.
   *
   * Does nothing when no detail is open or a close is already running. With
   * reduced motion the detail is removed immediately; otherwise `closing` is
   * set so the detail view plays its exit animation and then calls
   * `finishClose`.
   *
   * @returns {void}
   *
   * @example
   * <button onClick={close}>Back</button>
   */
  const close = useCallback(() => {
    if (!detail || closing) return;
    if (reduce) finishClose();
    else setClosing(true);
  }, [detail, closing, reduce, finishClose]);

  /**
   * Returns the rect the closing detail view should fly back into.
   *
   * Looks up the open project's card cover; if it is missing or detached
   * from the document (for example filtered out), there is no target. Otherwise the
   * gallery is scrolled so the card is visible and the cover's rect is
   * returned, or null when the cover has no width (not laid out).
   *
   * @returns {DOMRect | null} The cover's on-screen rect, or null to close without a flight.
   *
   * @example
   * const target = getCloseTarget();
   * if (!target) onClosed();
   */
  const getCloseTarget = useCallback((): DOMRect | null => {
    const el = detail ? covers.current.get(detail.id) : null;
    if (!el?.isConnected) return null;
    revealWithin(galleryScroll.current, el.closest('button'));
    const r = el.getBoundingClientRect();
    return r.width > 0 ? r : null;
  }, [detail]);

  /**
   * Adds a tag to the filter, or removes it if it is already selected.
   *
   * Updates the selected tags with a functional state update, so several
   * toggles in a row each see the latest selection. Newly selected tags are
   * appended to the end of the list.
   *
   * @param {string} tag - Tag to toggle.
   * @returns {void}
   *
   * @example
   * <FilterBar onToggle={toggleTag} />
   */
  const toggleTag = useCallback((tag: string) => setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag])), []);

  /**
   * Clears both the tag selection and the search text.
   *
   * Resets the selected tags to none and the query to an empty string, so the
   * gallery shows every project again along with the featured carousel. The
   * sort order is left unchanged.
   *
   * @returns {void}
   *
   * @example
   * <ProjectGrid onClearFilters={clearFilters} />
   */
  const clearFilters = useCallback(() => {
    setTags([]);
    setQuery('');
  }, []);

  /**
   * Focuses the toolbar search field.
   *
   * The search field only exists in gallery mode, so an open detail view is
   * dismissed immediately (without the close animation) and focusing is
   * deferred to the next animation frame, after the gallery toolbar renders.
   *
   * @returns {void}
   *
   * @example
   * { label: S.searchProjects, shortcut: 'mod+f', action: focusSearch }
   */
  const focusSearch = useCallback(() => {
    if (detail) {
      setDetail(null);
      setClosing(false);
    }
    requestAnimationFrame(() => searchWrap.current?.querySelector('input')?.focus());
  }, [detail]);

  /**
   * Filters the gallery by a single tag and returns to it.
   *
   * Used by the tag chips in the detail view: replaces the tag selection with
   * `tag`, clears the search text, and closes the detail view.
   *
   * @param {string} tag - Tag to filter by.
   * @returns {void}
   *
   * @example
   * <Detail onTag={filterByTag} />
   */
  const filterByTag = useCallback(
    (tag: string) => {
      setTags([tag]);
      setQuery('');
      close();
    },
    [close],
  );

  useArgsChange((a) => {
    if (typeof a.tag === 'string') {
      setTags(TAGS.includes(a.tag) ? [a.tag] : []);
      setQuery('');
    }
    const p = byId(a.project);
    if (p) {
      setClosing(false);
      setDetail((d) => (d?.id === p.id ? d : { id: p.id, origin: null, dir: 0 }));
    } else if (typeof a.tag === 'string') {
      setDetail(null);
      setClosing(false);
    }
  });

  useWindowKeydown((e) => {
    if (!detail || closing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft' && prev) {
      e.preventDefault();
      navigate(prev, -1);
    } else if (e.key === 'ArrowRight' && next) {
      e.preventDefault();
      navigate(next, 1);
    }
  });

  useAppMenus(() => {
    const p = current;
    return [
      {
        label: COMMON.view,
        items: [
          {
            label: S.backToAll,
            shortcut: 'esc',
            disabled: !detail || closing,
            action: () => {
              if (!shellOverlayOpen()) close();
            },
          },
          { label: S.previous, disabled: !prev, action: () => prev && navigate(prev, -1) },
          { label: S.next, disabled: !next, action: () => next && navigate(next, 1) },
          { separator: true },
          {
            label: S.sortBy,
            submenu: [
              { label: S.newest, checked: sort === 'newest', action: () => setSort('newest') },
              { label: S.name, checked: sort === 'name', action: () => setSort('name') },
            ],
          },
          { label: S.clearFilters, disabled: !filtered, action: clearFilters },
          { separator: true },
          { label: S.searchProjects, shortcut: 'mod+f', action: focusSearch },
        ],
      },
      {
        label: S.project,
        items: [
          { label: S.openDemo, disabled: !p?.links.demo, action: () => p?.links.demo && openURL(p.links.demo) },
          { label: S.viewSource, disabled: !p?.links.github, action: () => p?.links.github && openURL(p.links.github) },
          { separator: true },
          { label: S.showInFinder, disabled: !p, action: () => p && showInFinder(p) },
        ],
      },
    ];
  }, [current, detail, closing, prev, next, sort, filtered, close, navigate, clearFilters, focusSearch]);

  /**
   * Shows the context menu for a project card.
   *
   * Always offers Open and Show in Finder; Open Live Demo and View Source Code
   * are appended after a separator only for the links the project has.
   *
   * @param {ReactMouseEvent} e - The contextmenu event, used for positioning.
   * @param {Project} p - Project of the card.
   * @param {HTMLElement | null} coverEl - Card cover, used as the origin when opening.
   * @returns {void}
   *
   * @example
   * <ProjectGrid onContextMenu={onCardContextMenu} />
   */
  const onCardContextMenu = useCallback(
    (e: ReactMouseEvent, p: Project, coverEl: HTMLElement | null) => {
      const items: MenuItem[] = [
        { label: S.open, action: () => open(p, coverEl) },
        { label: S.showInFinder, action: () => showInFinder(p) },
      ];
      const { demo, github } = p.links;
      const links: MenuItem[] = [];
      if (demo) links.push({ label: S.openDemo, action: () => openURL(demo) });
      if (github) links.push({ label: S.viewSource, action: () => openURL(github) });
      showContextMenu(e, links.length ? [...items, { separator: true }, ...links] : items);
    },
    [open],
  );

  /**
   * Handles keyboard shortcuts in the search field.
   *
   * Escape clears the query, or blurs the field when it is already empty.
   * Enter opens the first visible project. ArrowDown moves focus to the first
   * card and scrolls it into view within the gallery. Keys pressed while an
   * IME (Korean, Japanese, …) is composing are ignored because they belong to
   * the composition.
   *
   * @param {ReactKeyboardEvent<HTMLInputElement>} e - Keydown event from the search input.
   * @returns {void}
   *
   * @example
   * <SearchField value={query} onChange={setQuery} onKeyDown={onSearchKey} />
   */
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      if (query) {
        e.preventDefault();
        setQuery('');
      } else e.currentTarget.blur();
    } else if (e.key === 'Enter' && visible[0]) {
      e.preventDefault();
      open(visible[0], covers.current.get(visible[0].id) ?? null);
    } else if (e.key === 'ArrowDown') {
      const first = galleryScroll.current?.querySelector<HTMLElement>('[data-card]');
      if (first) {
        e.preventDefault();
        first.focus({ preventScroll: true });
        revealWithin(galleryScroll.current, first);
      }
    }
  };

  return (
    <div className={styles.root}>
      <Toolbar className={styles.toolbar}>
        {current ? (
          <div className={styles.toolbarRow} key="detail" data-drag-region>
            <button type="button" className={`lg lg-control lg-capsule lg-interactive ${styles.backButton}`} onClick={close} aria-label={t(S.backToAll)} title={t(S.backToAll)}>
              <ChevronLeft size={17} />
              <span>{t(S.back)}</span>
            </button>
            <div className={`ui-toolbar-title ${styles.toolbarTitle}`} key={current.id}>
              {current.name}
            </div>
            <Spacer />
            <GlassGroup className={styles.navGroup} label={t(S.navigate)}>
              <IconButton label={t(S.previous)} disabled={!prev} onClick={() => prev && navigate(prev, -1)}>
                <ChevronLeft size={16} />
              </IconButton>
              <IconButton label={t(S.next)} disabled={!next} onClick={() => next && navigate(next, 1)}>
                <ChevronRight size={16} />
              </IconButton>
            </GlassGroup>
          </div>
        ) : (
          <div className={styles.toolbarRow} key="gallery" data-drag-region>
            <div className={`ui-toolbar-title ${styles.toolbarTitle}`}>{t(S.title)}</div>
            <Spacer />
            <label className={styles.sortLabel}>
              <span className={styles.srOnly}>{t(S.sort)}</span>
              <Select
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'newest', label: t(S.newest) },
                  { value: 'name', label: t(S.name) },
                ]}
              />
            </label>
            <div ref={searchWrap} className={styles.searchWrap}>
              <SearchField value={query} onChange={setQuery} placeholder={t(S.search)} onKeyDown={onSearchKey} />
            </div>
          </div>
        )}
      </Toolbar>

      <div className={styles.body}>
        <div className={styles.gallery} inert={current ? true : undefined}>
          <FilterBar tags={TAGS} selected={tags} onToggle={toggleTag} onClear={() => setTags([])} />
          <div ref={galleryScroll} className={styles.galleryScroll} data-scroller>
            <div className={styles.galleryInner}>
              {!filtered && FEATURED.length > 0 && <Hero items={FEATURED} paused={!!current} onOpen={open} />}
              <ProjectGrid
                items={visible}
                filtered={filtered}
                activeTags={tags}
                onOpen={open}
                onContextMenu={onCardContextMenu}
                registerCover={registerCover}
                onClearFilters={clearFilters}
              />
            </div>
          </div>
        </div>

        {current && detail && (
          <Detail
            project={current}
            prev={prev}
            next={next}
            origin={detail.origin}
            dir={detail.dir}
            closing={closing}
            getCloseTarget={getCloseTarget}
            onClosed={finishClose}
            onNavigate={navigate}
            onOpenURL={openURL}
            onShowInFinder={showInFinder}
            onTag={filterByTag}
          />
        )}
      </div>
    </div>
  );
}

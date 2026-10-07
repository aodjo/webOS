import { useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Search, Star } from 'lucide-react';
import { WindowContext, fmt, useT, useWM } from '@/kernel';
import { Button, EmptyState } from '@/components/ui';
import type { Project } from '@/data/portfolio';
import { ProjectCover } from './Cover';
import { revealWithin, useReducedMotion } from './motion';
import styles from './Projects.module.css';

const S = {
  all: { en: 'All', ko: '전체' },
  filterByTag: { en: 'Filter by tag', ko: '태그로 필터링' },
  featured: { en: 'Featured', ko: '추천' },
  featuredProjects: { en: 'Featured projects', ko: '추천 프로젝트' },
  viewProject: { en: 'View Project', ko: '프로젝트 보기' },
  previousSlide: { en: 'Previous slide', ko: '이전 슬라이드' },
  nextSlide: { en: 'Next slide', ko: '다음 슬라이드' },
  goToSlide: { en: 'Show {name}', ko: '{name} 보기' },
  slide: { en: '{n} of {total}', ko: '{total}개 중 {n}번째' },
  allProjects: { en: 'All Projects', ko: '모든 프로젝트' },
  results: { en: 'Results', ko: '검색 결과' },
  count: { en: '{n} projects', ko: '프로젝트 {n}개' },
  countOne: { en: '1 project', ko: '프로젝트 1개' },
  noResults: { en: 'No Projects Found', ko: '프로젝트 없음' },
  noResultsHint: { en: 'Try a different search or tag.', ko: '다른 검색어나 태그를 사용해 보세요.' },
  clearFilters: { en: 'Clear Filters', ko: '필터 지우기' },
}; /** Localized strings used by the gallery view. */

/**
 * Renders the tag filter toolbar above the gallery.
 *
 * Shows an "All" chip, pressed when no tag is selected, that clears the selection, followed by one
 * toggle chip per tag whose `aria-pressed` state reflects whether the tag is selected.
 *
 * @param {Object} props - Component props.
 * @param {string[]} props.tags - Every tag that can be filtered by.
 * @param {string[]} props.selected - Currently selected tags.
 * @param {(tag: string) => void} props.onToggle - Called with a tag when its chip is clicked.
 * @param {() => void} props.onClear - Called when the "All" chip is clicked.
 * @returns {JSX.Element} The filter toolbar.
 *
 * @example
 * <FilterBar tags={TAGS} selected={tags} onToggle={toggleTag} onClear={() => setTags([])} />
 */
export function FilterBar({ tags, selected, onToggle, onClear }: { tags: string[]; selected: string[]; onToggle: (tag: string) => void; onClear: () => void }) {
  const t = useT();
  return (
    <div className={styles.filterBar} role="toolbar" aria-label={t(S.filterByTag)}>
      <button type="button" className={`lg lg-control lg-capsule ${styles.filterChip}`} aria-pressed={selected.length === 0} onClick={onClear}>
        {t(S.all)}
      </button>
      <span className={styles.filterDivider} aria-hidden="true" />
      {tags.map((tag) => (
        <button key={tag} type="button" className={`lg lg-control lg-capsule ${styles.filterChip}`} aria-pressed={selected.includes(tag)} onClick={() => onToggle(tag)}>
          {tag}
        </button>
      ))}
    </div>
  );
}

const AUTOPLAY_MS = 6500; /** Milliseconds each featured slide stays visible before the carousel advances. */

/**
 * Renders the featured-projects carousel.
 *
 * Shows one slide at a time; inactive slides are hidden from assistive technology and made inert.
 * Autoplay advances every {@link AUTOPLAY_MS} milliseconds while there is more than one slide, the
 * carousel is not `paused`, is neither hovered nor focused, its window is focused and motion is
 * not reduced. Only the window's focus flag is read from the window manager, so moving or
 * resizing the window does not re-render the carousel. The parent makes the gallery inert while
 * `paused` is set, which can drop focus without a blur event, so pausing also clears the
 * focus-within flag. Left and Right arrow keys step through slides, and the active page dot
 * doubles as the autoplay progress indicator, restarting whenever the slide or running state
 * changes.
 *
 * @param {Object} props - Component props.
 * @param {Project[]} props.items - Featured projects shown as slides.
 * @param {boolean} props.paused - Stops autoplay (e.g. while a project detail is open).
 * @param {(p: Project, coverEl: HTMLElement | null) => void} props.onOpen - Called with the project
 *   and its cover element when a slide is opened.
 * @returns {JSX.Element} The carousel section.
 *
 * @example
 * <Hero items={FEATURED} paused={!!current} onOpen={open} />
 */
export function Hero({ items, paused, onOpen }: { items: Project[]; paused: boolean; onOpen: (p: Project, coverEl: HTMLElement | null) => void }) {
  const t = useT();
  const windowId = useContext(WindowContext)?.id;
  const focused = useWM((s) => s.focusedId === windowId);
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const covers = useRef<(HTMLDivElement | null)[]>([]);
  const count = items.length;
  const active = Math.min(index, count - 1);

  const running = count > 1 && !paused && !hover && !focusWithin && focused && !reduce;

  useEffect(() => {
    if (paused) setFocusWithin(false);
  }, [paused]);

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => clearTimeout(id);
  }, [active, count, running]);

  /**
   * Moves the carousel by a number of slides.
   *
   * Wraps around at both ends, so stepping past the last slide returns to the first.
   *
   * @param {number} delta - Number of slides to move; negative values move backwards.
   * @returns {void}
   *
   * @example
   * go(-1); // show the previous slide
   */
  const go = (delta: number) => setIndex((active + delta + count) % count);

  /**
   * Handles arrow-key navigation inside the carousel.
   *
   * ArrowLeft and ArrowRight step to the previous or next slide; the event's default action and
   * propagation are stopped so outer handlers do not also react. Other keys are ignored.
   *
   * @param {ReactKeyboardEvent} e - Keyboard event from the carousel section.
   * @returns {void}
   *
   * @example
   * <section onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  return (
    <section
      className={styles.hero}
      aria-roledescription="carousel"
      aria-label={t(S.featuredProjects)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocusWithin(false)}
      onKeyDown={onKeyDown}
    >
      {items.map((p, k) => {
        const isActive = k === active;
        return (
          <div
            key={p.id}
            className={styles.slide}
            data-active={isActive}
            data-side={k < active ? 'before' : k > active ? 'after' : 'current'}
            role="group"
            aria-roledescription="slide"
            aria-label={fmt(t(S.slide), { n: k + 1, total: count })}
            aria-hidden={!isActive}
            inert={!isActive ? true : undefined}
            style={{ '--c': p.color, '--cover': `url(${JSON.stringify(p.cover)})` } as CSSProperties}
          >
            {/* Ambient light: the cover itself, blurred into the slide's color. */}
            <div className={styles.slideAmbient} aria-hidden="true" />
            {/* The artwork, full height on the right, fading into the ambient light on its left. */}
            <button type="button" className={styles.slideCoverButton} tabIndex={-1} aria-hidden="true" onClick={() => onOpen(p, covers.current[k])}>
              <ProjectCover
                ref={(el) => {
                  covers.current[k] = el;
                }}
                project={p}
                className={styles.slideCover}
                eager
              />
            </button>
            {/* Glass caption floating over the artwork (concentric with the card: 24 − 10). */}
            <div className={`lg ${styles.slideCaption}`}>
              <span className={styles.featuredBadge}>
                <Star size={10} fill="currentColor" /> {t(S.featured)}
              </span>
              <h2 className={styles.slideTitle}>{p.name}</h2>
              <p className={styles.slideTagline}>{t(p.tagline)}</p>
              <div className={styles.slideFooter}>
                <button type="button" className={styles.heroButton} onClick={() => onOpen(p, covers.current[k])}>
                  {t(S.viewProject)} <ArrowRight size={13} />
                </button>
                <span className={styles.slideMeta}>
                  {p.year} · {p.tags.slice(0, 3).join(' · ')}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {count > 1 && (
        <div className={`lg lg-clear lg-capsule ${styles.heroControls}`}>
          <button type="button" className={styles.heroArrow} aria-label={t(S.previousSlide)} onClick={() => go(-1)}>
            <ChevronLeft size={15} />
          </button>
          <div className={styles.heroDots}>
            {items.map((p, k) => (
              <button
                key={p.id}
                type="button"
                className={styles.heroDot}
                aria-label={fmt(t(S.goToSlide), { name: p.name })}
                aria-current={k === active ? 'true' : undefined}
                onClick={() => setIndex(k)}
              >
                {/* The active dot's fill doubles as the autoplay progress; it restarts with the timer. */}
                {k === active && <span key={`${active}-${running}`} className={styles.heroDotFill} data-running={running} style={{ animationDuration: `${AUTOPLAY_MS}ms` }} />}
              </button>
            ))}
          </div>
          <button type="button" className={styles.heroArrow} aria-label={t(S.nextSlide)} onClick={() => go(1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      {/* Specular rim light, drawn above the slides. */}
      <span className={styles.heroRim} aria-hidden="true" />
    </section>
  );
}

/**
 * Renders one project card in the gallery grid.
 *
 * The card is a button showing the cover, name, year, tagline and up to three tags (tags that are
 * currently filtered by are highlighted, and the rest are summarized as "+N"). Its cover element
 * is kept in a ref for the open and context-menu callbacks and is also registered with the parent
 * through `registerCover`, so the detail view can fly back to it. The stagger index for the
 * entrance animation is capped at 12.
 *
 * @param {Object} props - Component props.
 * @param {Project} props.project - Project shown on the card.
 * @param {number} props.index - Position in the grid, used for the staggered entrance.
 * @param {string[]} props.activeTags - Tags currently used as filters.
 * @param {(p: Project, coverEl: HTMLElement | null) => void} props.onOpen - Called when the card
 *   is clicked.
 * @param {(e: ReactMouseEvent, p: Project, coverEl: HTMLElement | null) => void} props.onContextMenu -
 *   Shows the context menu for the card.
 * @param {(id: string, el: HTMLElement | null) => void} props.registerCover - Receives the card's
 *   cover element (or null when it unmounts) keyed by project id.
 * @returns {JSX.Element} The card button.
 *
 * @example
 * <ProjectCard project={p} index={0} activeTags={[]} onOpen={open} onContextMenu={menu}
 *   registerCover={registerCover} />
 */
function ProjectCard({
  project,
  index,
  activeTags,
  onOpen,
  onContextMenu,
  registerCover,
}: {
  project: Project;
  index: number;
  activeTags: string[];
  onOpen: (p: Project, coverEl: HTMLElement | null) => void;
  onContextMenu: (e: ReactMouseEvent, p: Project, coverEl: HTMLElement | null) => void;
  registerCover: (id: string, el: HTMLElement | null) => void;
}) {
  const t = useT();
  const coverRef = useRef<HTMLDivElement | null>(null);
  const shown = project.tags.slice(0, 3);
  const more = project.tags.length - shown.length;
  return (
    <button
      type="button"
      className={`lg lg-thick ${styles.card}`}
      data-card={project.id}
      style={{ '--i': Math.min(index, 12), '--c': project.color } as CSSProperties}
      onClick={() => onOpen(project, coverRef.current)}
      onContextMenu={(e) => onContextMenu(e, project, coverRef.current)}
    >
      <ProjectCover
        ref={(el) => {
          coverRef.current = el;
          registerCover(project.id, el);
        }}
        project={project}
        className={styles.cardCover}
      />
      <span className={styles.cardBody}>
        <span className={styles.cardTitleRow}>
          <span className={styles.cardTitle}>{project.name}</span>
          <span className={styles.cardYear}>{project.year}</span>
        </span>
        <span className={styles.cardTagline}>{t(project.tagline)}</span>
        <span className={styles.cardTags}>
          {shown.map((tag) => (
            <span key={tag} className={styles.tag} data-active={activeTags.includes(tag)}>
              {tag}
            </span>
          ))}
          {more > 0 && <span className={styles.tagMore}>+{more}</span>}
        </span>
      </span>
    </button>
  );
}

/**
 * Renders the grid of project cards with its heading and count.
 *
 * The heading reads "Results" when `filtered` is true and "All Projects" otherwise. With no items,
 * an empty state with a "Clear Filters" button is shown instead. Arrow keys move focus between
 * cards using the grid's current column count, and Home/End jump to the first or last card.
 *
 * @param {Object} props - Component props.
 * @param {Project[]} props.items - Projects to show.
 * @param {boolean} props.filtered - Whether a search or tag filter is active.
 * @param {string[]} props.activeTags - Tags currently used as filters.
 * @param {(p: Project, coverEl: HTMLElement | null) => void} props.onOpen - Called when a card is
 *   clicked.
 * @param {(e: ReactMouseEvent, p: Project, coverEl: HTMLElement | null) => void} props.onContextMenu -
 *   Shows the context menu for a card.
 * @param {(id: string, el: HTMLElement | null) => void} props.registerCover - Receives each card's
 *   cover element keyed by project id.
 * @param {() => void} props.onClearFilters - Called by the empty state's "Clear Filters" button.
 * @returns {JSX.Element} The grid, or the empty state when there are no items.
 *
 * @example
 * <ProjectGrid items={visible} filtered={false} activeTags={[]} onOpen={open}
 *   onContextMenu={menu} registerCover={registerCover} onClearFilters={clearFilters} />
 */
export function ProjectGrid({
  items,
  filtered,
  activeTags,
  onOpen,
  onContextMenu,
  registerCover,
  onClearFilters,
}: {
  items: Project[];
  filtered: boolean;
  activeTags: string[];
  onOpen: (p: Project, coverEl: HTMLElement | null) => void;
  onContextMenu: (e: ReactMouseEvent, p: Project, coverEl: HTMLElement | null) => void;
  registerCover: (id: string, el: HTMLElement | null) => void;
  onClearFilters: () => void;
}) {
  const t = useT();
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * Moves keyboard focus between cards.
   *
   * Arrow keys move by one card horizontally or by one row vertically, using the column count
   * read from the grid's computed `grid-template-columns`; Home and End jump to the first and last
   * card. The target index is clamped to the card range, focused without scrolling, and then
   * revealed inside the nearest `[data-scroller]` ancestor. Keys pressed with Meta, Ctrl or Alt,
   * other keys, and events while no card is focused are ignored. Enter and Space open cards
   * through the native button behavior.
   *
   * @param {ReactKeyboardEvent<HTMLDivElement>} e - Keyboard event from the grid container.
   * @returns {void}
   *
   * @example
   * <div ref={gridRef} onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (!grid || e.metaKey || e.ctrlKey || e.altKey) return;
    const cards = [...grid.querySelectorAll<HTMLButtonElement>('[data-card]')];
    const current = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
    let next = current;
    if (e.key in moves) next = current + moves[e.key];
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cards.length - 1;
    else return;
    e.preventDefault();
    const target = cards[Math.max(0, Math.min(cards.length - 1, next))];
    target?.focus({ preventScroll: true });
    revealWithin(grid.closest<HTMLElement>('[data-scroller]'), target);
  };

  if (!items.length) {
    return (
      <div className={styles.empty}>
        <EmptyState icon={<Search size={30} strokeWidth={1.5} />} title={t(S.noResults)} subtitle={t(S.noResultsHint)} />
        <Button onClick={onClearFilters}>{t(S.clearFilters)}</Button>
      </div>
    );
  }

  return (
    <>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t(filtered ? S.results : S.allProjects)}</h2>
        <span className={styles.sectionCount}>{items.length === 1 ? t(S.countOne) : fmt(t(S.count), { n: items.length })}</span>
      </div>
      <div ref={gridRef} className={styles.grid} onKeyDown={onKeyDown}>
        {items.map((p, i) => (
          <ProjectCard key={p.id} project={p} index={i} activeTags={activeTags} onOpen={onOpen} onContextMenu={onContextMenu} registerCover={registerCover} />
        ))}
      </div>
    </>
  );
}

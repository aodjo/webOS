import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Briefcase, Check, Copy, Globe, Layers, Mail, MapPin, PenLine, Sparkles, Trophy } from 'lucide-react';
import type { AppProps, MenuItem } from '@/kernel';
import { COMMON, fs, localizePeriod, useAppMenus, useArgsChange, useLocale, useNode, useSystem, useT, wm } from '@/kernel';
import { Toolbar } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { useDraggableThumb } from '@/components/segmentThumb';
import { awards, education, experience, owner, projects, skills, type Project } from '@/data/portfolio';
import { ProjectCover } from '../projects/Cover';
import { GitHubMark, LinkedInMark } from './brand';
import { formatYears, parsePeriod, yearsOfExperience } from './stats';
import styles from './AboutMe.module.css';

const S = {
  mail: { en: 'Mail', ko: '메일' },
  copy: { en: 'Copy', ko: '복사' },
  copyEmail: { en: 'Copy Email Address', ko: '이메일 주소 복사' },
  copied: { en: 'Copied', ko: '복사됨' },
  email: { en: 'email', ko: '이메일' },
  website: { en: 'website', ko: '웹사이트' },
  blog: { en: 'blog', ko: '블로그' },
  overview: { en: 'Overview', ko: '개요' },
  experience: { en: 'Activities', ko: '활동' },
  workTitle: { en: 'Experience', ko: '경력' },
  awardsTitle: { en: 'Awards', ko: '수상' },
  awardsStat: { en: 'Awards', ko: '수상' },
  skills: { en: 'Skills', ko: '기술' },
  education: { en: 'Education', ko: '학력' },
  highlights: { en: 'Highlights', ko: '한눈에 보기' },
  years: { en: 'Years of experience', ko: '년 경력' },
  projectsStat: { en: 'Projects shipped', ko: '프로젝트' },
  skillsStat: { en: 'Technologies', ko: '기술 스택' },
  featured: { en: 'Featured Projects', ko: '주요 프로젝트' },
  allProjects: { en: 'All Projects', ko: '모든 프로젝트' },
  now: { en: 'Now', ko: '재직 중' },
  enrolled: { en: 'Enrolled', ko: '재학 중' },
  alsoUsed: { en: 'Also used in projects', ko: '프로젝트에서 사용한 기술' },
  card: { en: 'Card', ko: '카드' },
  sendEmail: { en: 'Send Email…', ko: '이메일 보내기…' },
  copyAddress: { en: 'Copy Email Address', ko: '이메일 주소 복사' },
  openGitHub: { en: 'Open GitHub Profile', ko: 'GitHub 프로필 열기' },
  openLinkedIn: { en: 'Open LinkedIn Profile', ko: 'LinkedIn 프로필 열기' },
  openWebsite: { en: 'Open Website', ko: '웹사이트 열기' },
  openBlog: { en: 'Open Blog', ko: '블로그 열기' },
  showProjects: { en: 'Show Projects', ko: '프로젝트 보기' },
  restore: { en: 'Restore', ko: '복원' },
  sections: { en: 'Sections', ko: '섹션' },
}; /** Localized strings for the About Me window and its menus. */

const TABS = ['overview', 'experience', 'skills', 'education'] as const; /** Section ids of the main pane, in tab-bar and keyboard order. */
type Tab = (typeof TABS)[number];

/**
 * Checks whether a value is a known section tab id.
 *
 * Accepts any value, such as an untyped launch argument, and tests it against `TABS`, so the
 * result can be used as a type guard.
 *
 * @param {unknown} v - Value to check.
 * @returns {v is Tab} True when `v` is one of the section ids.
 *
 * @example
 * const tab = isTab(args.tab) ? args.tab : 'overview';
 */
const isTab = (v: unknown): v is Tab => typeof v === 'string' && (TABS as readonly string[]).includes(v);

const skillCount = skills.reduce((n, g) => n + g.items.length, 0); /** Total number of skills across all categories, shown as an Overview highlight. */

/**
 * Computes the owner's total years of experience.
 *
 * Merges the periods of all experience entries (overlapping ranges are counted once) up to the
 * current date, so an ongoing position keeps adding to the total.
 *
 * @returns {number} Fractional number of years.
 *
 * @example
 * formatYears(experienceYears()); // "3+"
 */
const experienceYears = () => yearsOfExperience(experience.map((e) => e.period));

/**
 * Opens a web address in the Safari app.
 *
 * Always opens a new Safari window that loads the given URL.
 *
 * @param {string} url - Address to open.
 * @returns {string | null} Id of the new window, or null when no window was opened.
 *
 * @example
 * openURL('https://github.com/aodjo');
 */
const openURL = (url: string) => wm.openWindow('safari', { url });

/**
 * Opens a new message window in the Mail app.
 *
 * Launches Mail with the `compose` argument so it starts a blank draft.
 *
 * @returns {string | null} Id of the new window, or null when no window was opened.
 *
 * @example
 * <button onClick={composeMail}>Mail</button>
 */
const composeMail = () => wm.openWindow('mail', { compose: true });

/**
 * Shortens a URL for display.
 *
 * Removes a leading "http://" or "https://" and a single trailing slash.
 *
 * @param {string} url - Full URL.
 * @returns {string} The URL without its scheme and trailing slash.
 *
 * @example
 * prettyURL('https://github.com/aodjo/'); // "github.com/aodjo"
 */
const prettyURL = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * Copies text to the host clipboard.
 *
 * Uses the async Clipboard API first. When that is unavailable or rejected (an insecure
 * context or denied permission), selects the text in a hidden, fixed-position textarea, runs
 * `document.execCommand('copy')` and removes the textarea again.
 *
 * @async
 * @param {string} text - Text to place on the clipboard.
 * @returns {Promise<void>} Resolves after the copy attempt has finished.
 *
 * @example
 * await writeClipboard(owner.email);
 */
async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/**
 * Reports whether animations should be reduced.
 *
 * Combines the "Reduce motion" setting from the system store with the host's
 * `prefers-reduced-motion` media query; either one being on is enough. The media query is
 * read on every render and treated as off outside a browser or where `matchMedia` is missing.
 *
 * @returns {boolean} True when motion should be reduced.
 *
 * @example
 * const reduce = useReducedMotion();
 */
function useReducedMotion(): boolean {
  const setting = useSystem((s) => s.settings.reduceMotion);
  return setting || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Animates a number counting up from 0 to a target.
 *
 * Runs a requestAnimationFrame loop for `duration` milliseconds along an ease-out cubic curve
 * and rounds each frame's value to an integer. The count restarts from 0 whenever the target
 * or duration changes, and the pending frame is cancelled on unmount. When motion is reduced
 * no animation runs and the target is returned directly.
 *
 * @param {number} target - Final value of the count.
 * @param {number} [duration=900] - Animation length in milliseconds.
 * @returns {number} The current animated value, or the target when motion is reduced.
 *
 * @example
 * const n = useCountUp(12);
 * return <span>{n}</span>;
 */
function useCountUp(target: number, duration = 900): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const t0 = performance.now();
    /**
     * Advances the count-up animation by one frame.
     *
     * Converts the time elapsed since the start into progress, sets the eased value and
     * schedules the next frame until progress reaches 1.
     *
     * @param {number} now - Frame timestamp passed by requestAnimationFrame.
     * @returns {void}
     *
     * @example
     * raf = requestAnimationFrame(step);
     */
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return reduce ? target : value;
}

/**
 * Renders the owner's profile picture, falling back to their initials.
 *
 * Tries the avatar chosen in Settings first and then `owner.avatar` from the portfolio data,
 * skipping duplicates and any image that has already failed to load. A path starting with "/"
 * points into the virtual file system (e.g. ~/Pictures/me.png) and is resolved to a URL through
 * `useNode`, so the picture follows changes to that file; other values are used as URLs as is.
 * When every candidate has failed or none is set, the first two initials of the owner's name
 * are shown instead.
 *
 * @returns {JSX.Element} The avatar container with an image or initials.
 *
 * @example
 * <Avatar />
 */
function Avatar() {
  const t = useT();
  const setting = useSystem((s) => s.settings.avatar);
  const candidates = [setting, owner.avatar].filter((p, i, a): p is string => !!p && a.indexOf(p) === i);
  const [failed, setFailed] = useState<string[]>([]);
  const path = candidates.find((p) => !failed.includes(p));
  const node = useNode(path?.startsWith('/') ? path : null);
  const url = node?.type === 'file' ? (node.src ?? fs.getURL(node.path)) : path;
  const initials = t(owner.name)
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className={styles.avatar}>
      {url && path ? <img src={url} alt="" draggable={false} onError={() => setFailed((f) => [...f, path])} /> : <span aria-hidden="true">{initials}</span>}
    </div>
  );
}

/**
 * Renders one round quick-action button of the profile sidebar.
 *
 * Shows a glass circle holding the icon above a short label. The tooltip and accessible name
 * use `title` when given and fall back to `label`. While `active`, the circle uses the tinted
 * glass style instead of the interactive one.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.icon - Icon drawn inside the circle.
 * @param {string} props.label - Short caption under the circle.
 * @param {string} [props.title] - Tooltip and accessible name; defaults to the label.
 * @param {() => void} props.onClick - Called when the button is pressed.
 * @param {boolean} [props.active] - Whether the button shows its tinted, active state.
 * @returns {JSX.Element} The action button.
 *
 * @example
 * <ActionButton icon={<Mail size={16} />} label="Mail" onClick={composeMail} />
 */
function ActionButton({ icon, label, title, onClick, active }: { icon: ReactNode; label: string; title?: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" className={`${styles.action} ${active ? styles.actionActive : ''}`} onClick={onClick} title={title ?? label} aria-label={title ?? label}>
      {/* The circle's hover and pressed states are driven by the whole button (.action in the CSS). */}
      <span className={`lg lg-control lg-circle ${active ? 'lg-tinted' : 'lg-interactive'} ${styles.actionCircle}`}>{icon}</span>
      <span className={styles.actionLabel}>{label}</span>
    </button>
  );
}

/**
 * Renders the segmented tab control that switches the main pane's section.
 *
 * Follows the ARIA tabs pattern: only the selected tab is in the tab order, and ArrowLeft,
 * ArrowRight, Home and End move both the selection and the focus. A glass thumb slides under the
 * selected segment and can be grabbed and dragged to another tab (useDraggableThumb); it is
 * re-measured when the locale changes the label widths.
 *
 * @param {Object} props - Component props.
 * @param {Tab} props.value - Currently selected tab.
 * @param {(t: Tab) => void} props.onChange - Called with the tab the user selects.
 * @param {string} props.idPrefix - Prefix for the tab element ids and the controlled panel id.
 * @returns {JSX.Element} The tab list.
 *
 * @example
 * <TabBar value={tab} onChange={selectTab} idPrefix={windowId} />
 */
function TabBar({ value, onChange, idPrefix }: { value: Tab; onChange: (t: Tab) => void; idPrefix: string }) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = TABS.indexOf(value);
  const { thumb, handlers } = useDraggableThumb(listRef, idx, (i) => onChange(TABS[i]), t);

  /**
   * Moves the tab selection with the keyboard.
   *
   * ArrowRight and ArrowLeft step through the tabs and wrap around at either end; Home and End
   * jump to the first and last tab. For these keys the default action is prevented, the new tab
   * is selected and focused; any other key is ignored.
   *
   * @param {ReactKeyboardEvent} e - Key event from the tab list.
   * @returns {void}
   *
   * @example
   * <div role="tablist" onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    onChange(TABS[next]);
    btnRefs.current[next]?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={t(S.sections)} className={`lg lg-capsule ${styles.tabs}`} onKeyDown={onKeyDown} {...handlers}>
      {thumb && <span className={`${styles.tabIndicator} ${thumb.dragging ? styles.tabIndicatorDragging : ''}`} style={{ width: thumb.w, translate: `${thumb.x}px 0` }} aria-hidden="true" />}
      {TABS.map((id, i) => (
        <button
          key={id}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${id}`}
          aria-selected={id === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={id === value ? 0 : -1}
          className={styles.tab}
          onClick={() => onChange(id)}
        >
          {t(S[id])}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders a highlight tile with an animated number.
 *
 * Counts the value up from 0 with `useCountUp` and passes each frame's number through
 * `format`. The `delay` index is exposed as the `--i` CSS variable, which staggers the tiles'
 * entrance animation.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.icon - Icon shown in the tile.
 * @param {number} props.value - Number to count up to.
 * @param {(n: number) => string} [props.format=String] - Turns the animated number into display text.
 * @param {string} props.label - Caption under the number.
 * @param {number} props.delay - Stagger index for the entrance animation.
 * @returns {JSX.Element} The stat tile.
 *
 * @example
 * <StatTile icon={<Layers size={15} />} value={projects.length} label="Projects shipped" delay={1} />
 */
function StatTile({ icon, value, format = String, label, delay }: { icon: ReactNode; value: number; format?: (n: number) => string; label: string; delay: number }) {
  const n = useCountUp(value);
  return (
    <div className={`lg lg-thick ${styles.stat}`} style={{ '--i': delay } as CSSProperties}>
      <span className={styles.statGlow} aria-hidden="true" />
      <span className={styles.statIcon}>{icon}</span>
      <span className={styles.statValue}>{format(n)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/**
 * Renders a compact card for a featured project.
 *
 * Shows the project's cover, name, year and tagline. Clicking the card opens the Projects app
 * with that project selected. `index` is exposed as the `--i` CSS variable to stagger the
 * entrance animation.
 *
 * @param {Object} props - Component props.
 * @param {Project} props.project - Project to show.
 * @param {number} props.index - Position in the grid, used for the stagger delay.
 * @returns {JSX.Element} The card button.
 *
 * @example
 * <MiniProjectCard project={projects[0]} index={0} />
 */
function MiniProjectCard({ project, index }: { project: Project; index: number }) {
  const t = useT();
  return (
    <button type="button" className={`lg lg-thick ${styles.mini}`} style={{ '--i': index } as CSSProperties} onClick={() => wm.launch('projects', { project: project.id })}>
      <ProjectCover project={project} className={styles.miniCover} />
      <span className={styles.miniBody}>
        <span className={styles.miniTitle}>
          {project.name}
          <span className={styles.miniYear}>{project.year}</span>
        </span>
        <span className={styles.miniTagline}>{t(project.tagline)}</span>
      </span>
    </button>
  );
}

const EMOJI = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u; /** Matches one emoji (with variation selectors and ZWJ sequences), captured so `split` keeps it. */

/**
 * Renders the Overview section.
 *
 * Shows the owner's tagline and Markdown bio, three animated highlight tiles (years of
 * experience, or the number of awards when there is no work history; number of projects;
 * number of skills) and up to four featured projects with a
 * button that opens the Projects app. When no project is marked as featured, the first four
 * projects are shown. The years tile keeps the "<1" and "N+" forms produced by `formatYears`
 * while it counts up.
 *
 * @returns {JSX.Element} The Overview content.
 *
 * @example
 * {tab === 'overview' && <Overview />}
 */
function Overview() {
  const t = useT();
  const years = experienceYears();
  const yearsLabel = formatYears(years);
  const featured = projects.filter((p) => p.featured);
  const shown = (featured.length ? featured : projects).slice(0, 4);
  return (
    <>
      <h1 className={styles.display}>
        {t(owner.tagline)
          .split(EMOJI)
          .map((part, i) => (i % 2 ? <span key={i} className={styles.emoji}>{part}</span> : part))}
      </h1>
      <Markdown source={t(owner.bio)} className={styles.bio} />

      <h2 className={styles.sectionTitle}>{t(S.highlights)}</h2>
      <div className={styles.stats}>
        {experience.length > 0 ? (
          <StatTile
            icon={<Briefcase size={15} />}
            value={Math.floor(years)}
            format={(n) => (yearsLabel === '<1' ? yearsLabel : yearsLabel.endsWith('+') ? `${n}+` : String(n))}
            label={t(S.years)}
            delay={0}
          />
        ) : (
          <StatTile icon={<Trophy size={15} />} value={awards.length} label={t(S.awardsStat)} delay={0} />
        )}
        <StatTile icon={<Layers size={15} />} value={projects.length} label={t(S.projectsStat)} delay={1} />
        <StatTile icon={<Sparkles size={15} />} value={skillCount} label={t(S.skillsStat)} delay={2} />
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t(S.featured)}</h2>
        <button type="button" className={`lg lg-control lg-capsule lg-interactive ${styles.linkButton}`} onClick={() => wm.launch('projects')}>
          {t(S.allProjects)} <ArrowRight size={12} />
        </button>
      </div>
      <div className={styles.miniGrid}>
        {shown.map((p, i) => (
          <MiniProjectCard key={p.id} project={p} index={i} />
        ))}
      </div>
    </>
  );
}

/**
 * Renders the Activities section: work history and awards as vertical timelines.
 *
 * Lists every experience entry from the portfolio data with its localized period, role,
 * company, description and highlights; entries whose period ends in "Present" (or a localized
 * equivalent) get an emphasized dot and a "Now" badge. Awards follow under their own heading
 * with the month, title, placing, division and, when the award has a page, a link that opens it
 * in Safari. A heading or list is left out when it has no entries.
 *
 * @returns {JSX.Element} The timelines.
 *
 * @example
 * {tab === 'experience' && <ExperienceTab />}
 */
function ExperienceTab() {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      {experience.length > 0 && (
        <>
          {awards.length > 0 && <h2 className={styles.sectionTitle}>{t(S.workTitle)}</h2>}
          <ol className={styles.timeline}>
            {experience.map((e, i) => {
              const current = !!parsePeriod(e.period)?.current;
              return (
                <li key={`${t(e.company)}-${e.period}`} className={styles.tlItem} style={{ '--i': i } as CSSProperties}>
                  <span className={`${styles.tlDot} ${current ? styles.tlDotCurrent : ''}`} aria-hidden="true" />
                  <div className={`lg lg-thick ${styles.tlCard}`}>
                    <div className={styles.tlPeriod}>
                      {localizePeriod(e.period, locale)}
                      {current && <span className={styles.nowBadge}>{t(S.now)}</span>}
                    </div>
                    <h3 className={styles.tlRole}>
                      {t(e.role)} <span className={styles.tlCompany}>@ {t(e.company)}</span>
                    </h3>
                    <p className={styles.tlDesc}>{t(e.description)}</p>
                    {e.highlights.length > 0 && (
                      <ul className={styles.tlHighlights}>
                        {e.highlights.map((h, k) => (
                          <li key={k}>{t(h)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {awards.length > 0 && (
        <>
          {experience.length > 0 && <h2 className={styles.sectionTitle}>{t(S.awardsTitle)}</h2>}
          <ol className={styles.timeline}>
            {awards.map((a, i) => (
              <li key={`${a.date}-${t(a.title)}`} className={styles.tlItem} style={{ '--i': i } as CSSProperties}>
                <span className={`${styles.tlDot} ${a.result ? styles.tlDotCurrent : ''}`} aria-hidden="true" />
                <div className={`lg lg-thick ${styles.tlCard}`}>
                  <div className={styles.tlPeriod}>
                    {a.date}
                    {a.result && <span className={styles.nowBadge}>{t(a.result)}</span>}
                  </div>
                  <h3 className={styles.tlRole}>
                    {a.href ? (
                      <button type="button" className={styles.tlLink} onClick={() => openURL(a.href!)} title={a.href}>
                        {t(a.title)} <ArrowUpRight size={13} />
                      </button>
                    ) : (
                      t(a.title)
                    )}
                  </h3>
                  {a.detail && <p className={styles.tlDesc}>{t(a.detail)}</p>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/**
 * Renders the Skills section.
 *
 * Shows one card per skill category listing its skills as chips. Project tags
 * that are not listed as skills (compared case-insensitively) follow as chips; clicking one
 * opens the Projects app filtered by that tag.
 *
 * @returns {JSX.Element} The Skills content.
 *
 * @example
 * {tab === 'skills' && <SkillsTab />}
 */
function SkillsTab() {
  const t = useT();
  const known = new Set(skills.flatMap((g) => g.items.map((s) => s.name.toLowerCase())));
  const extra = [...new Set(projects.flatMap((p) => p.tags))].filter((tag) => !known.has(tag.toLowerCase()));
  return (
    <>
      <div className={styles.skillGrid}>
        {skills.map((group, gi) => (
          <section key={t(group.category)} className={`lg lg-thick ${styles.skillCard}`} style={{ '--i': gi } as CSSProperties}>
            <header className={styles.skillHead}>
              <h3>{t(group.category)}</h3>
              <span className={styles.count}>{group.items.length}</span>
            </header>
            <ul className={styles.skillList}>
              {group.items.map((s) => (
                <li key={s.name} className={styles.chip}>
                  {s.name}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {extra.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>{t(S.alsoUsed)}</h2>
          <div className={styles.chipCloud}>
            {extra.map((tag) => (
              <button key={tag} type="button" className={`${styles.chip} ${styles.chipButton}`} onClick={() => wm.launch('projects', { tag })}>
                {tag}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Renders the Education section as a vertical timeline.
 *
 * Shows one timeline entry per education entry, newest first, with the localized period, the
 * school and the degree. Entries whose period is open-ended get a highlighted dot and an
 * "Enrolled" badge.
 *
 * @returns {JSX.Element} The education timeline.
 *
 * @example
 * {tab === 'education' && <EducationTab />}
 */
function EducationTab() {
  const t = useT();
  const locale = useLocale();
  return (
    <ol className={styles.timeline}>
      {education.map((e, i) => {
        const current = !!parsePeriod(e.period)?.current;
        return (
          <li key={`${t(e.school)}-${e.period}`} className={styles.tlItem} style={{ '--i': i } as CSSProperties}>
            <span className={`${styles.tlDot} ${current ? styles.tlDotCurrent : ''}`} aria-hidden="true" />
            <div className={`lg lg-thick ${styles.tlCard}`}>
              <div className={styles.tlPeriod}>
                {localizePeriod(e.period, locale)}
                {current && <span className={styles.nowBadge}>{t(S.enrolled)}</span>}
              </div>
              <h3 className={styles.tlRole}>{t(e.school)}</h3>
              <p className={styles.tlDesc}>{t(e.degree)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The About Me window: a profile card beside tabbed sections.
 *
 * The sidebar shows the avatar, name, role, location, quick actions (mail, GitHub, copy
 * email address) and contact links; the main pane shows the Overview, Experience, Skills
 * or Education section. The first section comes from `args.tab`, and later launches that pass
 * a `tab` argument switch to it. On every section change the panel gets the slide direction
 * (`data-dir`) for its entrance animation and the content is scrolled to its top; in the
 * narrow, stacked layout, where the whole card scrolls, the sticky tab bar is brought back to
 * the top of the window instead. The app also adds a View menu (alt+1 to alt+4 select
 * sections) and a Card menu with the contact actions.
 *
 * @param {AppProps} props - Window props supplied by the window manager.
 * @param {string} props.windowId - Id of the hosting window, used for sheets and element ids.
 * @param {AppArgs} props.args - Launch arguments; `args.tab` selects the first section.
 * @returns {JSX.Element} The window content.
 *
 * @example
 * wm.launch('about-me', { tab: 'skills' });
 */
export default function AboutMe({ windowId, args }: AppProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(() => (isTab(args.tab) ? args.tab : 'overview'));
  const [dir, setDir] = useState(0);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const layoutRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /**
   * Switches the main pane to another section.
   *
   * Does nothing for the section already shown. Otherwise records the slide direction (-1 or
   * 1, from the tabs' order) used by the panel animation and selects the new section.
   *
   * @param {Tab} next - Section to show.
   * @returns {void}
   *
   * @example
   * selectTab('skills');
   */
  const selectTab = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      setDir(Math.sign(TABS.indexOf(next) - TABS.indexOf(tab)));
      setTab(next);
    },
    [tab],
  );

  useArgsChange((a) => {
    if (isTab(a.tab)) selectTab(a.tab);
  });

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    const layout = layoutRef.current;
    const main = mainRef.current;
    if (!layout || !main) return;
    const mainTop = main.getBoundingClientRect().top - layout.getBoundingClientRect().top + layout.scrollTop;
    if (layout.scrollTop > mainTop) layout.scrollTop = mainTop;
  }, [tab]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  /**
   * Copies the owner's email address and shows brief feedback.
   *
   * Writes the address to the clipboard, then switches the copy button to its "Copied" state
   * for 1.6 seconds. Copying again restarts that timer, and the timer is cleared on unmount.
   *
   * @async
   * @returns {Promise<void>} Resolves once the address is copied and the feedback is shown.
   *
   * @example
   * <button onClick={() => void copyEmail()} />
   */
  const copyEmail = useCallback(async () => {
    await writeClipboard(owner.email);
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  }, []);

  const { github, linkedin, website, blog } = owner.links;

  useAppMenus(() => {
    const linkItems: MenuItem[] = [
      { label: S.openGitHub, disabled: !github, action: () => github && openURL(github) },
      ...(linkedin ? [{ label: S.openLinkedIn, action: () => openURL(linkedin) }] : []),
      ...(website ? [{ label: S.openWebsite, action: () => openURL(website) }] : []),
      ...(blog ? [{ label: S.openBlog, action: () => openURL(blog) }] : []),
    ];
    return [
      {
        label: COMMON.view,
        items: TABS.map<MenuItem>((id, i) => ({ label: S[id], shortcut: `alt+${i + 1}`, checked: tab === id, action: () => selectTab(id) })),
      },
      {
        label: S.card,
        items: [
          { label: S.sendEmail, action: composeMail },
          { label: S.copyAddress, action: () => void copyEmail() },
          { separator: true },
          ...linkItems,
          { separator: true },
          { label: S.showProjects, action: () => wm.launch('projects') },
        ],
      },
    ];
  }, [tab, selectTab, copyEmail, windowId, github, linkedin, website, blog]);

  const contacts: { key: string; label: ReactNode; value: string; icon: ReactNode; onClick: () => void }[] = [
    ...(owner.email ? [{ key: 'email', label: t(S.email), value: owner.email, icon: <Mail size={12} />, onClick: composeMail }] : []),
    ...(github ? [{ key: 'github', label: 'GitHub', value: prettyURL(github), icon: <GitHubMark size={12} />, onClick: () => openURL(github) }] : []),
    ...(linkedin ? [{ key: 'linkedin', label: 'LinkedIn', value: prettyURL(linkedin), icon: <LinkedInMark size={12} />, onClick: () => openURL(linkedin) }] : []),
    ...(website ? [{ key: 'website', label: t(S.website), value: prettyURL(website), icon: <Globe size={12} />, onClick: () => openURL(website) }] : []),
    ...(blog ? [{ key: 'blog', label: t(S.blog), value: prettyURL(blog), icon: <PenLine size={12} />, onClick: () => openURL(blog) }] : []),
  ];

  return (
    <div className={styles.container}>
      <div ref={layoutRef} className={styles.layout}>
        {/* A glass pane floating inside the window; the inner element scrolls so the rim light stays put. */}
        <aside className={`lg lg-thick ${styles.sidebar}`}>
          <div className={styles.dragStrip} data-drag-region />
          <div className={styles.sidebarScroll}>
            <div className={styles.profile}>
              <Avatar />
              <div className={styles.identity}>
                <h1 className={styles.name}>{t(owner.name)}</h1>
                <div className={styles.role}>{t(owner.role)}</div>
                <div className={styles.location}>
                  <MapPin size={11} /> {t(owner.location)}
                </div>
              </div>
            </div>

            <div className={styles.actions}>
              <ActionButton icon={<Mail size={16} />} label={t(S.mail)} title={t(S.sendEmail)} onClick={composeMail} />
              {github && <ActionButton icon={<GitHubMark size={16} />} label="GitHub" title={t(S.openGitHub)} onClick={() => openURL(github)} />}
              <ActionButton
                icon={copied ? <Check size={16} /> : <Copy size={15} />}
                label={t(copied ? S.copied : S.copy)}
                title={t(copied ? S.copied : S.copyEmail)}
                onClick={() => void copyEmail()}
                active={copied}
              />
            </div>

            {contacts.length > 0 && (
              <dl className={styles.contacts}>
                {contacts.map((c) => (
                  <div key={c.key} className={styles.contactRow}>
                    <dt>{c.label}</dt>
                    <dd>
                      <button type="button" className={styles.contactValue} onClick={c.onClick} title={c.value}>
                        {c.icon}
                        <span>{c.value}</span>
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </aside>

        <section ref={mainRef} className={styles.main}>
          <Toolbar inset={false} className={styles.toolbar}>
            <TabBar value={tab} onChange={selectTab} idPrefix={windowId} />
          </Toolbar>
          <div ref={contentRef} className={styles.content}>
            <div key={tab} id={`${windowId}-panel`} role="tabpanel" aria-labelledby={`${windowId}-tab-${tab}`} className={styles.panel} data-dir={dir}>
              {tab === 'overview' && <Overview />}
              {tab === 'experience' && <ExperienceTab />}
              {tab === 'skills' && <SkillsTab />}
              {tab === 'education' && <EducationTab />}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

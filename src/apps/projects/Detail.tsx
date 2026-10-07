import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, FolderOpen, Globe, Play } from 'lucide-react';
import { fmt, useT } from '@/kernel';
import { Button } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import type { Project } from '@/data/portfolio';
import { GitHubMark } from '../about-me/brand';
import { ProjectCover } from './Cover';
import { EASE_OUT, canAnimate, flipTransform, useReducedMotion } from './motion';
import styles from './Projects.module.css';

const S = {
  liveDemo: { en: 'Live Demo', ko: '라이브 데모' },
  source: { en: 'Source', ko: '소스 코드' },
  sourceCode: { en: 'Source Code', ko: '소스 코드' },
  showInFinder: { en: 'Show in Finder', ko: 'Finder에서 보기' },
  about: { en: 'About', ko: '소개' },
  highlights: { en: 'Highlights', ko: '주요 내용' },
  stack: { en: 'Stack', ko: '기술 스택' },
  links: { en: 'Links', ko: '링크' },
  openInSafari: { en: 'Open', ko: '열기' },
  openInNewTab: { en: 'Open in New Tab', ko: '새 탭에서 열기' },
  noLinks: { en: 'This project has no public links yet.', ko: '아직 공개된 링크가 없는 프로젝트입니다.' },
  filterTag: { en: 'Show projects tagged “{tag}”', ko: '“{tag}” 태그가 있는 프로젝트 보기' },
  previous: { en: 'Previous', ko: '이전' },
  next: { en: 'Next', ko: '다음' },
  projectNav: { en: 'Project navigation', ko: '프로젝트 탐색' },
}; /** Localized strings used by the project detail view. */

/**
 * Formats a URL for display.
 *
 * Strips the leading `http://` or `https://` scheme and a single trailing slash.
 *
 * @param {string} url - Absolute URL to shorten.
 * @returns {string} The URL without scheme and trailing slash.
 *
 * @example
 * prettyURL('https://github.com/me/repo/'); // 'github.com/me/repo'
 */
const prettyURL = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** Props of the project detail view. */
export interface DetailProps {
  /** Project being shown. */
  project: Project;
  /** Previous project for the pager, or null when this is the first one. */
  prev: Project | null;
  /** Next project for the pager, or null when this is the last one. */
  next: Project | null;
  /** Screen rect of the cover the detail was opened from (shared-element transition). */
  origin: DOMRect | null;
  /** -1 / 1 when navigating to the previous / next project, 0 otherwise. */
  dir: number;
  /** True while the close animation plays. */
  closing: boolean;
  /** Where the cover should fly back to when closing (the card in the gallery), if visible. */
  getCloseTarget: () => DOMRect | null;
  /** Called once the close animation has finished. */
  onClosed: () => void;
  /** Called with the target project and direction when a pager button is pressed. */
  onNavigate: (p: Project, dir: number) => void;
  /** Opens a URL in the in-OS browser. */
  onOpenURL: (url: string) => void;
  /** Reveals the project's file in Finder. */
  onShowInFinder: (p: Project) => void;
  /** Filters the gallery by a stack tag. */
  onTag: (tag: string) => void;
}

/**
 * Renders a titled section of the detail view.
 *
 * The section fades in with the staggered `fade` animation; `index` is passed as the `--i` custom
 * property that sets its delay.
 *
 * @param {Object} props - Component props.
 * @param {string} props.title - Heading text.
 * @param {number} props.index - Stagger index for the fade-in animation.
 * @param {ReactNode} props.children - Section content.
 * @param {string} [props.className=''] - Extra class names for the section element.
 * @returns {JSX.Element} The section element.
 *
 * @example
 * <Section title={t(S.about)} index={1}>{content}</Section>
 */
function Section({ title, index, children, className = '' }: { title: string; index: number; children: ReactNode; className?: string }) {
  return (
    <section className={`${styles.detailSection} ${styles.fade} ${className}`} style={{ '--i': index } as CSSProperties}>
      <h2 className={styles.detailHeading}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Renders the full-window detail view of a project.
 *
 * Shows the cover, title, actions, description, highlights, stack tags, links and a
 * previous/next pager. When opened with an `origin` rect and motion is not reduced, the cover
 * flies from that rect to its resting place (FLIP animation); navigating between projects does
 * not replay it. Changing `project.id` scrolls back to the top, and the scroller receives focus
 * on mount. When `closing` becomes true, the cover flies back to `getCloseTarget()` while the
 * rest fades out, and `onClosed` is called when the animation ends; without a target, without
 * Web Animations, or with reduced motion, `onClosed` is called after a 220 ms timeout instead
 * (a zero-delay timeout when motion is reduced). The latest `onClosed` is read through a ref so
 * the close effect does not restart when the callback identity changes.
 *
 * @param {DetailProps} props - Project to show, its neighbors, transition state and callbacks.
 * @returns {JSX.Element} The detail view.
 *
 * @example
 * <Detail project={p} prev={null} next={q} origin={rect} dir={0} closing={false}
 *   getCloseTarget={() => null} onClosed={close} onNavigate={go} onOpenURL={open}
 *   onShowInFinder={reveal} onTag={filter} />
 */
export function Detail({ project, prev, next, origin, dir, closing, getCloseTarget, onClosed, onNavigate, onOpenURL, onShowInFinder, onTag }: DetailProps) {
  const t = useT();
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const onClosedRef = useRef(onClosed);
  useLayoutEffect(() => {
    onClosedRef.current = onClosed;
  });
  const { demo, github } = project.links;
  const links: { key: string; url: string; label: string; icon: ReactNode }[] = [];
  if (demo) links.push({ key: 'demo', url: demo, label: t(S.liveDemo), icon: <Globe size={15} /> });
  if (github) links.push({ key: 'github', url: github, label: t(S.sourceCode), icon: <GitHubMark size={15} /> });

  useLayoutEffect(() => {
    const el = coverRef.current;
    if (!origin || reduce || !canAnimate(el)) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const anim = el.animate([{ transform: flipTransform(origin, to), borderRadius: '14px' }, { transform: 'none' }], { duration: 480, easing: EASE_OUT });
    return () => anim.cancel();
    // Runs only when a new origin arrives (on open), not on project navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [project.id]);
  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!closing) return;
    const el = coverRef.current;
    const target = reduce ? null : getCloseTarget();
    if (!target || !canAnimate(el)) {
      const id = setTimeout(() => onClosedRef.current(), reduce ? 0 : 220);
      return () => clearTimeout(id);
    }
    // If the opening flight is still running, reverse from where the cover is right now
    // instead of jumping to its resting place first.
    const visual = el.getBoundingClientRect();
    if (typeof el.getAnimations === 'function') for (const a of el.getAnimations()) a.cancel();
    const rest = el.getBoundingClientRect();
    const anim = el.animate([{ transform: flipTransform(visual, rest) }, { transform: flipTransform(target, rest), borderRadius: '14px' }], {
      duration: 400,
      easing: EASE_OUT,
      fill: 'forwards',
    });
    anim.onfinish = () => onClosedRef.current();
    return () => {
      anim.onfinish = null;
      anim.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  return (
    <div className={styles.detail} data-closing={closing} data-animated={!!origin && !reduce} style={{ '--c': project.color } as CSSProperties}>
      {/* Ambient light in the project's color, so the glass below has something to refract. */}
      <div className={styles.detailBg} aria-hidden="true" />
      <div ref={scrollRef} className={styles.detailScroll} tabIndex={-1}>
        <article key={project.id} className={styles.detailInner} data-dir={dir} aria-labelledby={`project-title-${project.id}`}>
          <header className={styles.detailHero}>
            <div className={styles.detailCoverWrap}>
              <div className={styles.detailGlow} aria-hidden="true" />
              <ProjectCover ref={coverRef} project={project} className={styles.detailCover} eager />
            </div>
            <div className={`${styles.detailHeroInfo} ${styles.fade}`} style={{ '--i': 0 } as CSSProperties}>
              <div className={styles.eyebrow}>
                <span>{project.year}</span>
                <span className={styles.eyebrowDot} aria-hidden="true" />
                <span>{t(project.role)}</span>
              </div>
              <h1 id={`project-title-${project.id}`} className={styles.detailTitle}>
                {project.name}
              </h1>
              <p className={styles.detailTagline}>{t(project.tagline)}</p>
              <div className={styles.heroActions}>
                {demo && (
                  <Button variant="primary" size="large" onClick={() => onOpenURL(demo)}>
                    <Play size={13} fill="currentColor" /> {t(S.liveDemo)}
                  </Button>
                )}
                {github && (
                  <Button size="large" className="lg lg-control" onClick={() => onOpenURL(github)}>
                    <GitHubMark size={14} /> {t(S.source)}
                  </Button>
                )}
                <Button size="large" className="lg lg-control" onClick={() => onShowInFinder(project)}>
                  <FolderOpen size={14} /> {t(S.showInFinder)}
                </Button>
              </div>
            </div>
          </header>

          <Section title={t(S.about)} index={1}>
            <Markdown source={t(project.description)} className={styles.markdown} />
          </Section>

          <div className={styles.detailColumns}>
            {project.highlights.length > 0 && (
              <Section title={t(S.highlights)} index={2}>
                <ul className={styles.checklist}>
                  {project.highlights.map((h, k) => (
                    <li key={k}>
                      <span className={styles.check} aria-hidden="true">
                        <Check size={10} strokeWidth={3.2} />
                      </span>
                      {t(h)}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <div className={styles.detailSide}>
              <Section title={t(S.stack)} index={3}>
                <div className={styles.stack}>
                  {project.tags.map((tag) => (
                    <button key={tag} type="button" className={styles.stackChip} title={fmt(t(S.filterTag), { tag })} onClick={() => onTag(tag)}>
                      {tag}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title={t(S.links)} index={4}>
                {links.length ? (
                  <ul className={styles.links}>
                    {links.map((l) => (
                      <li key={l.key} className={`lg lg-thick ${styles.linkRow}`}>
                        <span className={styles.linkIcon}>{l.icon}</span>
                        <span className={styles.linkText}>
                          <strong>{l.label}</strong>
                          <span>{prettyURL(l.url)}</span>
                        </span>
                        <span className={styles.linkActions}>
                          <Button className="lg lg-control" onClick={() => onOpenURL(l.url)}>
                            {t(S.openInSafari)}
                          </Button>
                          <Button variant="plain" title={t(S.openInNewTab)} onClick={() => window.open(l.url, '_blank', 'noopener,noreferrer')}>
                            {t(S.openInNewTab)} <ArrowUpRight size={12} />
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.muted}>{t(S.noLinks)}</p>
                )}
              </Section>
            </div>
          </div>

          <nav className={`${styles.pager} ${styles.fade}`} style={{ '--i': 5 } as CSSProperties} aria-label={t(S.projectNav)}>
            <button type="button" className={`lg lg-thick lg-interactive ${styles.pagerButton}`} disabled={!prev} onClick={() => prev && onNavigate(prev, -1)}>
              <ChevronLeft size={16} />
              <span className={styles.pagerText}>
                <small>{t(S.previous)}</small>
                <strong>{prev?.name ?? '—'}</strong>
              </span>
            </button>
            <button type="button" className={`lg lg-thick lg-interactive ${styles.pagerButton} ${styles.pagerNext}`} disabled={!next} onClick={() => next && onNavigate(next, 1)}>
              <span className={styles.pagerText}>
                <small>{t(S.next)}</small>
                <strong>{next?.name ?? '—'}</strong>
              </span>
              <ChevronRight size={16} />
            </button>
          </nav>
        </article>
      </div>
    </div>
  );
}

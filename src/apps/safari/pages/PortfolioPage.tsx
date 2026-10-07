/**
 * webos://portfolio — a small personal homepage rendered inside Safari, generated from
 * src/data/portfolio.ts. Sticky glass nav, scroll-reveal sections, project cards that deep-link
 * into the Projects app, and a contact section wired to Mail.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ArrowRight, Check, Copy, ExternalLink, Mail, MapPin, Sparkles } from 'lucide-react';
import { awards, education, experience, osInfo, owner, projects, skills } from '@/data/portfolio';
import { localizePeriod, useLocale, useT, wm } from '@/kernel';
import { openCompose } from '@/apps/mail/compose';
import { Markdown } from '@/components/Markdown';
import { GitHubMark, LinkedInMark } from '../brands';
import type { PageAPI } from './api';
import styles from './Portfolio.module.css';

const P = {
  work: { en: 'Work', ko: '작업물' },
  about: { en: 'About', ko: '소개' },
  skills: { en: 'Skills', ko: '기술' },
  experience: { en: 'Experience', ko: '경력' },
  contact: { en: 'Contact', ko: '연락처' },
  hi: { en: 'Hi, I’m', ko: '안녕하세요, 저는' },
  seeWork: { en: 'See my work', ko: '작업물 보기' },
  getInTouch: { en: 'Get in touch', ko: '연락하기' },
  projects: { en: 'Projects', ko: '프로젝트' },
  skillsCount: { en: 'Skills', ko: '기술' },
  roles: { en: 'Roles', ko: '경력' },
  awardsCount: { en: 'Awards', ko: '수상' },
  selectedWork: { en: 'Selected work', ko: '주요 작업물' },
  workTitle: { en: 'Things I’ve built', ko: '제가 만든 것들' },
  featured: { en: 'Featured', ko: '추천' },
  demo: { en: 'Live demo', ko: '데모' },
  code: { en: 'Code', ko: '코드' },
  details: { en: 'Details', ko: '자세히' },
  toolbox: { en: 'Toolbox', ko: '도구 상자' },
  skillsTitle: { en: 'What I work with', ko: '사용하는 기술' },
  journey: { en: 'Journey', ko: '여정' },
  experienceTitle: { en: 'Where I’ve worked', ko: '일해 온 곳' },
  awardsTitle: { en: 'Awards & competitions', ko: '수상과 대회' },
  education: { en: 'Education', ko: '학력' },
  contactEyebrow: { en: 'Say hello', ko: '인사 나누기' },
  contactTitle: { en: 'Let’s build something together.', ko: '함께 만들 일을 기다립니다.' },
  contactBody: {
    en: 'I’m always happy to talk about interesting products, building software, or opportunities. My inbox is open.',
    ko: '흥미로운 제품, 개발, 새로운 기회에 대한 이야기라면 언제든 환영합니다. 편하게 연락 주세요.',
  },
  copy: { en: 'Copy address', ko: '주소 복사' },
  blog: { en: 'Blog', ko: '블로그' },
  website: { en: 'Website', ko: '웹사이트' },
  copied: { en: 'Copied', ko: '복사됨' },
  footer: { en: `Made with React and TypeScript, running inside ${osInfo.name}.`, ko: `React와 TypeScript로 만들었으며 ${osInfo.name} 안에서 실행 중입니다.` },
}; /** Localized strings used only by the portfolio page. */

/**
 * Fades elements in as they scroll into view inside the page's own scroll container.
 *
 * On mount, every descendant of `root` marked with `data-reveal` is observed with an
 * `IntersectionObserver` rooted at the container. Once at least 8% of an element is visible,
 * `data-shown="true"` is set on it (the CSS animates that state) and the observer stops
 * watching it, so each element reveals only once. Without `IntersectionObserver` support
 * every element is shown immediately. The observer is disconnected on unmount.
 *
 * @param {RefObject<HTMLElement | null>} root - Ref to the scroll container.
 * @returns {void}
 *
 * @example
 * const root = useRef<HTMLDivElement>(null);
 * useReveal(root);
 */
function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>('[data-reveal]');
    if (typeof IntersectionObserver === 'undefined') {
      items.forEach((i) => (i.dataset.shown = 'true'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.shown = 'true';
          io.unobserve(e.target);
        }
      },
      { root: el, threshold: 0.08 },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, [root]);
}

/**
 * Returns up to two upper-case initials for a name.
 *
 * Takes the first character of each whitespace-separated word.
 *
 * @param {string} name - The full name.
 * @returns {string} The initials, e.g. for the nav's brand mark.
 *
 * @example
 * initials('Jane Doe'); // 'JD'
 */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * The owner's portfolio homepage (`webos://portfolio`), generated from `src/data/portfolio.ts`.
 *
 * Renders a sticky glass nav (it gains a scrolled style once the page scrolls past 8px and its
 * links smooth-scroll to the sections), a hero with stats, project cards, the bio, skills with
 * 1–5 meters, the experience timeline with education, a contact section and a footer. Sections
 * fade in via `useReveal`. Project covers and "Details" launch the Projects app on that
 * project; demo, code and social links navigate the hosting tab; the email buttons open a Mail
 * compose window. "Copy address" copies the email and shows "Copied" for 1.6 seconds.
 *
 * @param {Object} props - Component props.
 * @param {PageAPI} props.api - Navigation API of the hosting tab.
 * @returns {JSX.Element} The portfolio page.
 *
 * @example
 * <PortfolioPage api={api} />
 */
export function PortfolioPage({ api }: { api: PageAPI }) {
  const t = useT();
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const work = useRef<HTMLElement>(null);
  const about = useRef<HTMLElement>(null);
  const skillsRef = useRef<HTMLElement>(null);
  const expRef = useRef<HTMLElement>(null);
  const contact = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useReveal(root);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  /**
   * Smooth-scrolls a section to the top of the page.
   *
   * Calls `scrollIntoView` on the referenced element with smooth behavior and start alignment,
   * so the page's scroll container brings the section's top edge into view. Does nothing while
   * the ref is not attached.
   *
   * @param {RefObject<HTMLElement | null>} ref - Ref to the section element.
   * @returns {void}
   *
   * @example
   * go(contact);
   */
  const go = (ref: RefObject<HTMLElement | null>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const name = t(owner.name);
  const skillCount = skills.reduce((n, c) => n + c.items.length, 0);
  const socials = [
    owner.links.github && { href: owner.links.github, label: 'GitHub', icon: <GitHubMark size={16} /> },
    owner.links.linkedin && { href: owner.links.linkedin, label: 'LinkedIn', icon: <LinkedInMark size={16} /> },
    owner.links.blog && { href: owner.links.blog, label: t(P.blog), icon: <ExternalLink size={15} /> },
    owner.links.website && { href: owner.links.website, label: t(P.website), icon: <ExternalLink size={15} /> },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode }[];

  /**
   * Copies the owner's email address to the host clipboard.
   *
   * On success the copy button switches to its "Copied" state; failures (or a missing
   * Clipboard API) are ignored.
   *
   * @returns {void}
   *
   * @example
   * <button onClick={copyEmail}>Copy address</button>
   */
  const copyEmail = () =>
    void navigator.clipboard
      ?.writeText(owner.email)
      .then(() => setCopied(true))
      .catch(() => {});

  return (
    <div ref={root} className={styles.page} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}>
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
        <button type="button" className={styles.brand} onClick={() => root.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className={styles.brandMark}>{initials(name)}</span>
          {name}
        </button>
        <div className={styles.navLinks}>
          <button type="button" onClick={() => go(work)}>
            {t(P.work)}
          </button>
          <button type="button" onClick={() => go(about)}>
            {t(P.about)}
          </button>
          <button type="button" onClick={() => go(skillsRef)}>
            {t(P.skills)}
          </button>
          <button type="button" onClick={() => go(expRef)}>
            {t(P.experience)}
          </button>
          <button type="button" className={styles.navCta} onClick={() => go(contact)}>
            {t(P.contact)}
          </button>
        </div>
      </nav>

      <header className={styles.hero}>
        <div className={styles.blobA} aria-hidden />
        <div className={styles.blobB} aria-hidden />
        <div className={styles.heroInner}>
          <img className={styles.avatar} src={owner.avatar} alt="" />
          <p className={styles.eyebrow}>
            <span className={styles.wave} aria-hidden>
              👋
            </span>{' '}
            {t(P.hi)}
          </p>
          <h1 className={styles.name}>{name}</h1>
          <p className={styles.role}>
            {t(owner.role)}
            <span className={styles.dot} aria-hidden>
              ·
            </span>
            <MapPin size={14} /> {t(owner.location)}
          </p>
          <p className={styles.tagline}>{t(owner.tagline)}</p>
          <div className={styles.ctas}>
            <button type="button" className={styles.primary} onClick={() => go(work)}>
              {t(P.seeWork)} <ArrowRight size={15} />
            </button>
            <button type="button" className={styles.secondary} onClick={() => openCompose({ to: owner.email })}>
              <Mail size={15} /> {t(P.getInTouch)}
            </button>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>{projects.length}</dt>
              <dd>{t(P.projects)}</dd>
            </div>
            <div>
              <dt>{skillCount}</dt>
              <dd>{t(P.skillsCount)}</dd>
            </div>
            <div>
              <dt>{experience.length || awards.length}</dt>
              <dd>{t(experience.length ? P.roles : P.awardsCount)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <section ref={work} className={styles.section}>
        <div className={styles.sectionHead} data-reveal>
          <span className={styles.kicker}>{t(P.selectedWork)}</span>
          <h2>{t(P.workTitle)}</h2>
        </div>
        <div className={styles.cards}>
          {projects.map((p, i) => (
            <article key={p.id} className={`${styles.card} ${p.featured && i === 0 ? styles.cardWide : ''}`} style={{ '--c': p.color } as CSSProperties} data-reveal>
              <button type="button" className={styles.cover} onClick={() => wm.launch('projects', { project: p.id })} aria-label={`${p.name} — ${t(P.details)}`}>
                <img src={p.cover} alt="" loading="lazy" />
                {p.featured && (
                  <span className={styles.featured}>
                    <Sparkles size={11} /> {t(P.featured)}
                  </span>
                )}
              </button>
              <div className={styles.cardBody}>
                <div className={styles.cardTop}>
                  <h3>{p.name}</h3>
                  <span className={styles.year}>{p.year}</span>
                </div>
                <p className={styles.cardText}>{t(p.tagline)}</p>
                <ul className={styles.tags}>
                  {p.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
                <div className={styles.cardLinks}>
                  {p.links.demo && (
                    <button type="button" onClick={() => api.navigate(p.links.demo!)}>
                      <ExternalLink size={13} /> {t(P.demo)}
                    </button>
                  )}
                  {p.links.github && (
                    <button type="button" onClick={() => api.navigate(p.links.github!)}>
                      <GitHubMark size={13} /> {t(P.code)}
                    </button>
                  )}
                  <button type="button" className={styles.more} onClick={() => wm.launch('projects', { project: p.id })}>
                    {t(P.details)} <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section ref={about} className={`${styles.section} ${styles.about}`}>
        <div className={styles.sectionHead} data-reveal>
          <span className={styles.kicker}>{t(P.about)}</span>
        </div>
        <div className={styles.bio} data-reveal>
          <Markdown source={t(owner.bio)} />
        </div>
      </section>

      <section ref={skillsRef} className={styles.section}>
        <div className={styles.sectionHead} data-reveal>
          <span className={styles.kicker}>{t(P.toolbox)}</span>
          <h2>{t(P.skillsTitle)}</h2>
        </div>
        <div className={styles.skillGrid}>
          {skills.map((cat, ci) => (
            <div key={ci} className={styles.skillCard} data-reveal>
              <h3>{t(cat.category)}</h3>
              <ul>
                {cat.items.map((s) => (
                  <li key={s.name}>{s.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section ref={expRef} className={styles.section}>
        <div className={styles.sectionHead} data-reveal>
          <span className={styles.kicker}>{t(P.journey)}</span>
          <h2>{t(experience.length ? P.experienceTitle : P.awardsTitle)}</h2>
        </div>
        <ol className={styles.timeline}>
          {experience.map((e, ei) => (
            <li key={ei} data-reveal>
              <div className={styles.period}>{localizePeriod(e.period, locale)}</div>
              <h3>
                {t(e.role)} <span>· {t(e.company)}</span>
              </h3>
              <p>{t(e.description)}</p>
              {e.highlights.length > 0 && (
                <ul>
                  {e.highlights.map((h, i) => (
                    <li key={i}>{t(h)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {awards.map((a, ai) => (
            <li key={`award-${ai}`} data-reveal>
              <div className={styles.period}>{a.date}</div>
              <h3>
                {a.href ? (
                  <button type="button" className={styles.awardLink} onClick={() => api.navigate(a.href!)} title={a.href}>
                    {t(a.title)}
                  </button>
                ) : (
                  t(a.title)
                )}
                {a.result && <span> · {t(a.result)}</span>}
              </h3>
              {a.detail && <p>{t(a.detail)}</p>}
            </li>
          ))}
        </ol>
        {education.length > 0 && (
          <div className={styles.edu} data-reveal>
            <h3>{t(P.education)}</h3>
            {education.map((e, ei) => (
              <div key={ei} className={styles.eduRow}>
                <b>{t(e.school)}</b>
                <span>{t(e.degree)}</span>
                <span className={styles.period}>{localizePeriod(e.period, locale)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section ref={contact} className={`${styles.section} ${styles.contact}`}>
        <div className={styles.contactCard} data-reveal>
          <span className={styles.kicker}>{t(P.contactEyebrow)}</span>
          <h2>{t(P.contactTitle)}</h2>
          <p>{t(P.contactBody)}</p>
          <div className={styles.ctas}>
            <button type="button" className={styles.primary} onClick={() => openCompose({ to: owner.email })}>
              <Mail size={15} /> {owner.email}
            </button>
            <button type="button" className={styles.secondary} onClick={copyEmail}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {t(copied ? P.copied : P.copy)}
            </button>
          </div>
          {socials.length > 0 && (
            <div className={styles.socials}>
              {socials.map((s) => (
                <button key={s.href} type="button" onClick={() => api.navigate(s.href)} aria-label={s.label} title={s.href}>
                  {s.icon}
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        © {osInfo.year} {name} · {t(P.footer)}
      </footer>
    </div>
  );
}

/**
 * Illustrations for the Tips pages, drawn with CSS, SVG and the real app icons.
 * Every scene is decorative (aria-hidden) except the Explore tiles, which are real buttons.
 */
import type { ComponentType, CSSProperties } from 'react';
import { MousePointer2, Search } from 'lucide-react';
import { PATHS, useT } from '@/kernel';
import { AboutMeIcon, FileIcon, FinderIcon, LaunchpadIcon, MailIcon, NotesIcon, OSLogo, ProjectsIcon, SafariIcon, TerminalIcon, TrashIcon } from '@/icons';
import { osInfo, owner } from '@/data/portfolio';
import styles from './Welcome.module.css';

const S = {
  query: { en: 'Projects', ko: '프로젝트' },
  application: { en: 'Application', ko: '응용 프로그램' },
  launchpad: 'Launchpad',
  aboutMe: { en: 'About Me', ko: '내 소개' },
  aboutMeDesc: { en: 'Who I am & what I do', ko: '저는 누구이고 무엇을 하는지' },
  projects: { en: 'Projects', ko: '프로젝트' },
  projectsDesc: { en: 'Things I’ve built', ko: '제가 만든 것들' },
  mail: { en: 'Mail', ko: '메일' },
  mailDesc: { en: 'Say hello', ko: '인사 건네기' },
  documents: { en: 'Documents', ko: '문서' },
  resume: { en: 'Résumé.md', ko: '이력서.md' },
  notes: { en: 'Notes', ko: '메모' },
  pictures: { en: 'Pictures', ko: '사진' },
  draft: { en: 'Old Draft.txt', ko: '오래된 초안.txt' },
}; /** Localized labels shown inside the scene illustrations. */

/**
 * Casts a map of style values, including CSS custom properties, to `CSSProperties`.
 *
 * React's `CSSProperties` type does not accept arbitrary `--name` keys, so scenes that
 * pass animation delays or indices through custom properties use this helper to satisfy
 * the type checker. The object is returned unchanged.
 *
 * @param {Record<string, string | number>} v - Style declarations, e.g. `{ left: '10%', '--delay': '0.4s' }`.
 * @returns {CSSProperties} The same object typed as React inline styles.
 *
 * @example
 * <span style={vars({ left: '14%', '--delay': '0.8s' })} />
 */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

const ORBIT: { Icon: ComponentType<{ size: number }>; x: number; y: number; size: number; delay: number }[] = [
  { Icon: FinderIcon, x: 14, y: 30, size: 44, delay: 0 },
  { Icon: SafariIcon, x: 24, y: 68, size: 36, delay: 0.8 },
  { Icon: NotesIcon, x: 33, y: 22, size: 30, delay: 1.6 },
  { Icon: ProjectsIcon, x: 70, y: 24, size: 40, delay: 0.4 },
  { Icon: TerminalIcon, x: 82, y: 58, size: 44, delay: 1.2 },
  { Icon: AboutMeIcon, x: 67, y: 74, size: 34, delay: 2 },
  { Icon: MailIcon, x: 90, y: 22, size: 28, delay: 2.4 },
]; /** Icons floating around the Welcome logo: position in % of the canvas, size in px, float delay in s. */

/**
 * Illustration for the first Tips page (Welcome).
 *
 * Renders an animated aurora background, a set of app icons drifting at the positions
 * listed in `ORBIT` (each with its own `--delay` so they bob out of phase), and the OS
 * logo inside a glass badge with two pulsing rings. Purely decorative and hidden from
 * assistive technology.
 *
 * @returns {JSX.Element} The Welcome scene.
 *
 * @example
 * const page = { scene: <WelcomeScene />, copy: <h1>Welcome</h1> };
 */
export function WelcomeScene() {
  return (
    <div className={`${styles.sceneBg} ${styles.bgAurora}`} aria-hidden="true">
      <div className={styles.aurora}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.canvas}>
        {ORBIT.map(({ Icon, x, y, size, delay }, i) => (
          <span key={i} className={styles.floatIcon} style={vars({ left: `${x}%`, top: `${y}%`, '--delay': `${delay}s` })}>
            <Icon size={size} />
          </span>
        ))}
        <div className={`lg lg-clear lg-float ${styles.logoBadge}`}>
          <span className={styles.logoRing} />
          <span className={`${styles.logoRing} ${styles.logoRing2}`} />
          <OSLogo size={58} color="#fff" />
        </div>
      </div>
    </div>
  );
}

const DOCK_ICONS: ComponentType<{ size: number }>[] = [FinderIcon, LaunchpadIcon, SafariIcon, MailIcon, AboutMeIcon, ProjectsIcon, TerminalIcon]; /** Miniature Dock icons, left to right; Trash is drawn separately after the separator. */

/**
 * Illustration for the second Tips page (Dock, Launchpad and Spotlight).
 *
 * Draws a Spotlight field with a blinking caret and a single localized "Projects"
 * result above a miniature Dock built from `DOCK_ICONS`. Inside the Dock, the
 * Launchpad icon (index 1) shows a hover tooltip, the Projects icon (index 5) bounces
 * via `data-bounce`, and Finder and Projects carry running-indicator dots. Purely
 * decorative and hidden from assistive technology.
 *
 * @returns {JSX.Element} The Dock scene.
 *
 * @example
 * const page = { scene: <DockScene />, copy: <p>Use the Dock to launch apps.</p> };
 */
export function DockScene() {
  const t = useT();
  return (
    <div className={`${styles.sceneBg} ${styles.bgWallpaper}`} aria-hidden="true">
      <div className={styles.canvas}>
        <div className={styles.spotlight}>
          <div className={`lg lg-thick lg-float lg-capsule ${styles.spotField}`}>
            <Search size={15} />
            <span className={styles.spotQuery}>{t(S.query)}</span>
            <span className={styles.caret} />
          </div>
          <div className={`lg lg-thick lg-float ${styles.spotResults}`}>
            <div className={styles.spotResult}>
              <ProjectsIcon size={22} />
              <span className={styles.spotName}>{t(S.projects)}</span>
              <span className={styles.spotKind}>{t(S.application)}</span>
            </div>
          </div>
        </div>
        <div className={styles.dockWrap}>
          <div className={`lg lg-float ${styles.dock}`}>
            {DOCK_ICONS.map((Icon, i) => (
              <span key={i} className={styles.dockItem} data-bounce={i === 5 || undefined} data-hover={i === 1 || undefined}>
                {i === 1 && <span className={`lg lg-thick lg-capsule ${styles.dockTip}`}>{S.launchpad}</span>}
                <Icon size={38} />
                {(i === 0 || i === 5) && <i className={styles.runDot} />}
              </span>
            ))}
            <span className={styles.dockSep} />
            <span className={styles.dockItem}>
              <TrashIcon size={38} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Miniature window drawn with plain elements: a title bar with three traffic-light dots
 * and a body of placeholder text lines.
 *
 * Line widths are derived from the line index (`88 - (i * 23) % 45` percent) so the
 * lines look ragged but render identically every time.
 *
 * @param {Object} props - Component props.
 * @param {string} props.className - Extra class that positions and animates the window.
 * @param {number} [props.lines=4] - Number of placeholder text lines in the body.
 * @returns {JSX.Element} The miniature window.
 *
 * @example
 * <MiniWindow className={styles.winA} lines={5} />
 */
function MiniWindow({ className, lines = 4 }: { className: string; lines?: number }) {
  return (
    <div className={`${styles.miniWin} ${className}`}>
      <div className={styles.miniBar}>
        <i />
        <i />
        <i />
      </div>
      <div className={styles.miniBody}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} style={{ width: `${88 - ((i * 23) % 45)}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Illustration for the third Tips page (Windows).
 *
 * Shows a tiny screen with a menu bar, two `MiniWindow`s, a glass snap preview and a
 * mouse cursor. Looping CSS animations have the cursor drag the front window to the
 * left edge, fade in the snap preview there, and then tile the window into the left
 * half. Purely decorative and hidden from assistive technology.
 *
 * @returns {JSX.Element} The Windows scene.
 *
 * @example
 * const page = { scene: <WindowsScene />, copy: <h1>Windows</h1> };
 */
export function WindowsScene() {
  return (
    <div className={`${styles.sceneBg} ${styles.bgStudio}`} aria-hidden="true">
      <div className={styles.canvas}>
        <div className={styles.screen}>
          <div className={styles.miniMenubar}>
            <OSLogo size={8} color="currentColor" />
            <i />
            <i />
            <i />
          </div>
          <div className={`lg lg-clear ${styles.snapPreview}`} />
          <MiniWindow className={styles.winB} lines={6} />
          <MiniWindow className={styles.winA} lines={5} />
          <span className={styles.cursor}>
            <MousePointer2 size={16} fill="#fff" strokeWidth={1.6} />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Illustration for the fourth Tips page (Files).
 *
 * Combines a miniature Finder window listing localized Documents, Résumé, Notes and
 * Pictures entries (drawn with the real `FileIcon`, using paths under `PATHS` so the
 * correct folder icons are picked), a Terminal window running `neofetch` with the
 * owner's handle and OS info from the portfolio data, and a document that animates
 * into the Trash. Purely decorative and hidden from assistive technology.
 *
 * @returns {JSX.Element} The Files scene.
 *
 * @example
 * const page = { scene: <FilesScene />, copy: <h1>Files</h1> };
 */
export function FilesScene() {
  const t = useT();
  const items = [
    { name: t(S.documents), type: 'dir' as const, path: PATHS.documents },
    { name: t(S.resume), type: 'file' as const, path: `${PATHS.documents}/${t(S.resume)}` },
    { name: t(S.notes), type: 'dir' as const, path: PATHS.notes },
    { name: t(S.pictures), type: 'dir' as const, path: PATHS.pictures },
  ];
  return (
    <div className={`${styles.sceneBg} ${styles.bgWallpaper3}`} aria-hidden="true">
      <div className={styles.canvas}>
        <div className={`${styles.miniWin} ${styles.finderWin}`}>
          <div className={`lg lg-thick ${styles.finderSide}`}>
            <div className={styles.miniBar}>
              <i />
              <i />
              <i />
            </div>
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.finderGrid}>
            {items.map((it) => (
              <span key={it.name} className={styles.finderItem}>
                <FileIcon node={{ type: it.type, name: it.name, path: it.path }} size={38} />
                <span>{it.name}</span>
              </span>
            ))}
          </div>
        </div>

        <div className={`${styles.miniWin} ${styles.termWin}`}>
          <div className={styles.miniBar}>
            <i />
            <i />
            <i />
          </div>
          <div className={styles.termBody}>
            <div>
              <span className={styles.prompt}>{owner.handle} ~ %</span> <span className={styles.typed}>neofetch</span>
            </div>
            <div className={styles.neofetch}>
              <OSLogo size={36} color="currentColor" />
              <div>
                <b>
                  {owner.handle}@{osInfo.machineShort}
                </b>
                <div>
                  OS: {osInfo.name} {osInfo.version}
                </div>
                <div>Shell: zsh</div>
                <div className={styles.swatches}>
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.flyingDoc}>
          <FileIcon node={{ type: 'file', name: t(S.draft), path: `${PATHS.desktop}/${t(S.draft)}` }} size={34} />
        </div>
        <div className={`lg lg-float ${styles.trashSpot}`}>
          <TrashIcon size={46} />
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive scene for the last Tips page (Explore).
 *
 * Renders three glass tiles (About Me, Projects, Mail) as real buttons, each with an
 * app icon, a localized name and a short description. Each tile receives its index as
 * the `--i` custom property so the entrance animation is staggered. Clicking a tile
 * calls `onLaunch` with that app's id.
 *
 * @param {Object} props - Component props.
 * @param {(id: 'about-me' | 'projects' | 'mail') => void} props.onLaunch - Called with the app id of the clicked tile.
 * @returns {JSX.Element} The Explore scene.
 *
 * @example
 * <ExploreScene onLaunch={(id) => wm.launch(id)} />
 */
export function ExploreScene({ onLaunch }: { onLaunch: (id: 'about-me' | 'projects' | 'mail') => void }) {
  const t = useT();
  const tiles = [
    { id: 'about-me' as const, Icon: AboutMeIcon, name: S.aboutMe, desc: S.aboutMeDesc },
    { id: 'projects' as const, Icon: ProjectsIcon, name: S.projects, desc: S.projectsDesc },
    { id: 'mail' as const, Icon: MailIcon, name: S.mail, desc: S.mailDesc },
  ];
  return (
    <div className={`${styles.sceneBg} ${styles.bgExplore}`}>
      <div className={styles.exploreRow}>
        {tiles.map(({ id, Icon, name, desc }, i) => (
          <button key={id} type="button" className={`lg lg-thick ${styles.exploreTile}`} style={vars({ '--i': i })} onClick={() => onLaunch(id)}>
            <span className={styles.exploreIcon}>
              <Icon size={58} />
            </span>
            <strong>{t(name)}</strong>
            <span>{t(desc)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

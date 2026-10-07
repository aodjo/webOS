import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AppWindow, Columns2, Database, HardDrive, LayoutGrid, Maximize2, SquareTerminal, Trash } from 'lucide-react';
import type { AppProps } from '@/kernel';
import { COMMON, fmt, SYSTEM_SHORTCUTS, useAppMenus, useArgsChange, useSystem, useT, useWindowKeydown, wm } from '@/kernel';
import { Button } from '@/components/ui';
import { osInfo, owner } from '@/data/portfolio';
import { DockScene, ExploreScene, FilesScene, WelcomeScene, WindowsScene } from './Scenes';
import { KeyCaps, ShortcutsView } from './ShortcutsView';
import styles from './Welcome.module.css';

const S = {
  tips: { en: 'Tips', ko: '팁' },
  shortcuts: { en: 'Keyboard Shortcuts', ko: '키보드 단축키' },
  back: { en: 'Back', ko: '이전' },
  continue: { en: 'Continue', ko: '계속' },
  getStarted: { en: 'Get Started', ko: '시작하기' },
  showAtLogin: { en: 'Show at login', ko: '로그인 시 보기' },
  pages: { en: 'Pages', ko: '페이지' },
  page: { en: 'Page {n} of {total}', ko: '{total}페이지 중 {n}페이지' },
  previousTip: { en: 'Previous Tip', ko: '이전 팁' },
  nextTip: { en: 'Next Tip', ko: '다음 팁' },

  welcomeTitle: { en: 'Welcome to {name}', ko: '{name}에 오신 것을 환영합니다' },
  welcomeBody: {
    en: 'This website is my portfolio — it’s a real little OS. Open apps, move windows, make files: it all works.',
    ko: '이 웹사이트는 제 포트폴리오이자 실제로 동작하는 작은 운영체제입니다. 앱을 열고, 윈도우를 옮기고, 파일을 만들어 보세요.',
  },

  dockTitle: { en: 'Dock, Launchpad & Spotlight', ko: 'Dock, Launchpad 및 Spotlight' },
  dockBody: {
    en: 'Click an app in the Dock to open it. Launchpad shows every app, and Spotlight finds apps, files and projects as you type.',
    ko: 'Dock에서 앱을 클릭해 실행하세요. Launchpad에서는 모든 앱을 볼 수 있고, Spotlight는 입력하는 즉시 앱, 파일, 프로젝트를 찾아 줍니다.',
  },

  windowsTitle: { en: 'Windows that behave', ko: '진짜처럼 움직이는 윈도우' },
  snap: { en: 'Drag a window to a screen edge to snap it', ko: '윈도우를 화면 가장자리로 끌어 배치하기' },
  zoom: { en: 'Double-click the title bar to zoom', ko: '제목 막대를 이중 클릭해 확대/축소' },
  mission: { en: 'See every window in Mission Control', ko: 'Mission Control로 모든 윈도우 보기' },
  switcher: { en: 'Switch between apps', ko: '앱 간 전환하기' },

  filesTitle: { en: 'Your files are real', ko: '파일도 진짜입니다' },
  fs: { en: 'Finder, Terminal and every app share one file system', ko: 'Finder, 터미널, 모든 앱이 하나의 파일 시스템을 공유' },
  neofetch: { en: 'Try {cmd} in the Terminal', ko: '터미널에서 {cmd} 입력해 보기' },
  trash: { en: 'Drag files to the Trash — and put them back', ko: '파일을 휴지통에 버리고 다시 되돌려 놓기' },
  saved: { en: 'Everything is saved in this browser', ko: '모든 변경 사항은 이 브라우저에 저장' },

  exploreTitle: { en: 'Explore my work', ko: '제 작업물을 둘러보세요' },
  exploreBody: {
    en: 'Start with About Me, browse my Projects, or drop me a line in Mail. You can reopen these tips anytime from the Help menu.',
    ko: '‘내 소개’부터 시작해 ‘프로젝트’를 둘러보거나 ‘메일’로 연락해 주세요. 이 팁은 언제든지 도움말 메뉴에서 다시 볼 수 있습니다.',
  },
}; /** Localized strings for the Tips window: chrome, navigation and the copy of every page. */

const SHOW_AT_LOGIN_KEY = 'webos.tips.showAtLogin'; /** localStorage key holding the "Show at login" checkbox state ('true' / 'false'). */
const PAGE_COUNT = 5; /** Number of pages in the tips carousel. */

/**
 * Reads the persisted "Show at login" preference.
 *
 * Looks up SHOW_AT_LOGIN_KEY in localStorage and treats only the exact string 'true' as checked.
 * When storage is unavailable (private mode, blocked site data) the error is caught and the
 * preference is reported as unchecked.
 *
 * @returns {boolean} True when the Tips window should open again at the next login.
 *
 * @example
 * const [showAtLogin, setShowAtLogin] = useState(readShowAtLogin);
 */
function readShowAtLogin(): boolean {
  try {
    return localStorage.getItem(SHOW_AT_LOGIN_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists the "Show at login" preference.
 *
 * Stores the value as a string under SHOW_AT_LOGIN_KEY. Storage errors are swallowed, so when
 * localStorage is unavailable the choice only lasts for the current session.
 *
 * @param {boolean} value - Whether the Tips window should open at the next login.
 * @returns {void}
 *
 * @example
 * writeShowAtLogin(true);
 */
function writeShowAtLogin(value: boolean): void {
  try {
    localStorage.setItem(SHOW_AT_LOGIN_KEY, String(value));
  } catch {}
}

/**
 * Converts any number into a valid page index.
 *
 * Rounds to the nearest integer and clamps the result to the range 0 … PAGE_COUNT - 1.
 *
 * @param {number} n - Requested page index.
 * @returns {number} The nearest valid page index.
 *
 * @example
 * clampPage(7.4); // 4
 */
const clampPage = (n: number) => Math.max(0, Math.min(PAGE_COUNT - 1, Math.round(n)));

/**
 * Derives the starting page from the window's launch arguments.
 *
 * Accepts only finite numbers (clamped with clampPage); anything else, including the
 * 'shortcuts' marker, starts on the first page.
 *
 * @param {unknown} v - The raw `args.page` value.
 * @returns {number} The page index to show first.
 *
 * @example
 * initialPage(2); // 2
 * initialPage('shortcuts'); // 0
 */
const initialPage = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clampPage(v) : 0);

/**
 * One glass tip card in a page's tip grid.
 *
 * Renders an icon, the tip text and, when `keys` is given, the matching shortcuts as key caps
 * separated by a slash.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.icon - Icon shown at the start of the card.
 * @param {ReactNode} props.children - Tip text.
 * @param {string[]} [props.keys] - Shortcuts in MenuItem.shortcut syntax, shown as alternatives.
 * @returns {JSX.Element} The list item for the tip.
 *
 * @example
 * <Tip icon={<Maximize2 size={15} />} keys={['alt+tab']}>{t(S.switcher)}</Tip>
 */
function Tip({ icon, children, keys }: { icon: ReactNode; children: ReactNode; keys?: string[] }) {
  return (
    <li className={`lg lg-thick ${styles.tip}`}>
      <span className={styles.tipIcon}>{icon}</span>
      <span className={styles.tipText}>{children}</span>
      {keys && (
        <span className={styles.tipKeys}>
          {keys.map((k, i) => (
            <span key={k} className={styles.keyPair}>
              {i > 0 && <span className={styles.or}>/</span>}
              <KeyCaps shortcut={k} />
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

/**
 * The Tips window: a five-page onboarding carousel plus a keyboard shortcuts reference.
 *
 * `args.page` selects the view: 'shortcuts' opens the shortcuts reference, a number opens that
 * tips page (clamped). Arguments re-sent to an open window switch the view the same way. The
 * window title follows the current view.
 *
 * The "Show at login" checkbox is stored in localStorage and drives the `firstRun` setting that
 * the shell checks at login. The shell clears `firstRun` when it shows this window, so while the
 * box is checked the flag is set again, and once more when the component unmounts (closing the
 * window, quitting or logging out). Unchecking the box clears the flag.
 *
 * All pages stay mounted: each scene and copy block gets `data-state` 'before', 'current' or
 * 'after' so CSS can slide between them, and non-current pages are `inert`. ArrowLeft/ArrowRight
 * change pages and Enter triggers the primary button unless focus is on a control. The View menu
 * switches between tips and shortcuts and steps through the tips.
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - Id of the window hosting the app.
 * @param {AppArgs} props.args - Launch arguments; `page` is 'shortcuts' or a page index.
 * @returns {JSX.Element} The tips carousel or the shortcuts view.
 *
 * @example
 * wm.openWindow('welcome', { page: 'shortcuts' });
 */
export default function Welcome({ windowId, args }: AppProps) {
  const t = useT();
  const [mode, setMode] = useState<'tips' | 'shortcuts'>(() => (args.page === 'shortcuts' ? 'shortcuts' : 'tips'));
  const [page, setPage] = useState(() => initialPage(args.page));
  const [showAtLogin, setShowAtLogin] = useState(readShowAtLogin);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const last = page === PAGE_COUNT - 1;

  useArgsChange((a) => {
    if (a.page === 'shortcuts') setMode('shortcuts');
    else if (typeof a.page === 'number') {
      setMode('tips');
      setPage(clampPage(a.page));
    }
  });

  useEffect(() => {
    wm.setTitle(windowId, t(mode === 'shortcuts' ? S.shortcuts : S.tips));
  }, [windowId, mode, t]);

  useEffect(() => {
    if (showAtLogin) useSystem.getState().updateSettings({ firstRun: true });
  }, [showAtLogin]);

  useEffect(
    () => () => {
      if (readShowAtLogin()) useSystem.getState().updateSettings({ firstRun: true });
    },
    [],
  );

  useEffect(() => {
    if (mode === 'tips') primaryRef.current?.focus({ preventScroll: true });
  }, [mode]);

  /**
   * Handles a change of the "Show at login" checkbox.
   *
   * Updates the checkbox state, persists it, and clears the `firstRun` setting when unchecked
   * (checking it sets `firstRun` through an effect).
   *
   * @param {boolean} value - New checkbox state.
   * @returns {void}
   *
   * @example
   * toggleShowAtLogin(e.target.checked);
   */
  const toggleShowAtLogin = (value: boolean) => {
    setShowAtLogin(value);
    writeShowAtLogin(value);
    if (!value) useSystem.getState().updateSettings({ firstRun: false });
  };

  /**
   * Shows the given tips page.
   *
   * The index is clamped, so stepping past either end stays on the first or last page.
   *
   * @param {number} n - Target page index.
   * @returns {void}
   *
   * @example
   * goTo(page + 1);
   */
  const goTo = (n: number) => setPage(clampPage(n));

  /**
   * Closes the Tips window.
   *
   * Asks the window manager to close this window and discards the returned promise; the
   * unmount cleanup then restores `firstRun` if "Show at login" is checked.
   *
   * @returns {void}
   *
   * @example
   * close();
   */
  const close = () => void wm.close(windowId);

  /**
   * Runs the primary button's action.
   *
   * Advances to the next page, or closes the window on the last page ("Get Started").
   *
   * @returns {void}
   *
   * @example
   * primary();
   */
  const primary = () => (last ? close() : goTo(page + 1));

  /**
   * Opens one of the portfolio apps offered on the last page.
   *
   * Mail opens a new compose window; the other apps are launched normally.
   *
   * @param {'about-me' | 'projects' | 'mail'} id - App to open.
   * @returns {void}
   *
   * @example
   * launch('projects');
   */
  const launch = (id: 'about-me' | 'projects' | 'mail') => {
    if (id === 'mail') wm.openWindow('mail', { compose: true });
    else wm.launch(id);
  };

  useWindowKeydown((e) => {
    if (mode !== 'tips' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' && !last) {
      e.preventDefault();
      goTo(page + 1);
    } else if (e.key === 'ArrowLeft' && page > 0) {
      e.preventDefault();
      goTo(page - 1);
    } else if (e.key === 'Enter' && !(e.target as Element | null)?.closest?.('button, a, input, label, select')) {
      e.preventDefault();
      primary();
    }
  });

  useAppMenus(
    () => [
      {
        label: COMMON.view,
        items: [
          { label: S.tips, checked: mode === 'tips', action: () => setMode('tips') },
          { label: S.shortcuts, checked: mode === 'shortcuts', action: () => setMode('shortcuts') },
          { separator: true },
          { label: S.previousTip, disabled: mode !== 'tips' || page === 0, action: () => goTo(page - 1) },
          { label: S.nextTip, disabled: mode !== 'tips' || last, action: () => goTo(page + 1) },
        ],
      },
    ],
    [mode, page, last],
  );

  if (mode === 'shortcuts') return <ShortcutsView onBack={() => setMode('tips')} />;

  const [beforeCmd, afterCmd] = t(S.neofetch).split('{cmd}');
  const pages: { scene: ReactNode; copy: ReactNode }[] = [
    {
      scene: <WelcomeScene />,
      copy: (
        <>
          <h1 className={styles.heroTitle}>{fmt(t(S.welcomeTitle), { name: osInfo.name })}</h1>
          <p className={styles.byline}>
            <strong>{t(owner.name)}</strong>
            <span className={styles.bullet} aria-hidden="true" />
            {t(owner.role)}
          </p>
          <p className={styles.body}>
            {t(owner.tagline)} {t(S.welcomeBody)}
          </p>
        </>
      ),
    },
    {
      scene: <DockScene />,
      copy: (
        <>
          <h1 className={styles.title}>{t(S.dockTitle)}</h1>
          <p className={styles.body}>{t(S.dockBody)}</p>
          <div className={styles.keyRow}>
            <span className={styles.keyItem}>
              <KeyCaps shortcut={SYSTEM_SHORTCUTS.spotlight} />
              Spotlight
            </span>
            <span className={styles.keyItem}>
              <KeyCaps shortcut={SYSTEM_SHORTCUTS.launchpad} />
              Launchpad
            </span>
          </div>
        </>
      ),
    },
    {
      scene: <WindowsScene />,
      copy: (
        <>
          <h1 className={styles.title}>{t(S.windowsTitle)}</h1>
          <ul className={styles.tipGrid}>
            <Tip icon={<Columns2 size={15} />} keys={[SYSTEM_SHORTCUTS.tileLeft, SYSTEM_SHORTCUTS.tileRight]}>
              {t(S.snap)}
            </Tip>
            <Tip icon={<Maximize2 size={15} />}>{t(S.zoom)}</Tip>
            <Tip icon={<LayoutGrid size={15} />} keys={[SYSTEM_SHORTCUTS.missionControl]}>
              {t(S.mission)}
            </Tip>
            <Tip icon={<AppWindow size={15} />} keys={['alt+tab']}>
              {t(S.switcher)}
            </Tip>
          </ul>
        </>
      ),
    },
    {
      scene: <FilesScene />,
      copy: (
        <>
          <h1 className={styles.title}>{t(S.filesTitle)}</h1>
          <ul className={styles.tipGrid}>
            <Tip icon={<HardDrive size={15} />}>{t(S.fs)}</Tip>
            <Tip icon={<SquareTerminal size={15} />}>
              {beforeCmd}
              <code className={styles.code}>neofetch</code>
              {afterCmd}
            </Tip>
            <Tip icon={<Trash size={15} />}>{t(S.trash)}</Tip>
            <Tip icon={<Database size={15} />}>{t(S.saved)}</Tip>
          </ul>
        </>
      ),
    },
    {
      scene: <ExploreScene onLaunch={launch} />,
      copy: (
        <>
          <h1 className={styles.title}>{t(S.exploreTitle)}</h1>
          <p className={styles.body}>{t(S.exploreBody)}</p>
        </>
      ),
    },
  ];

  /**
   * Gives a page's position relative to the current page.
   *
   * The result is written to `data-state` so the stylesheet can place and animate each page.
   *
   * @param {number} i - Page index.
   * @returns {'before' | 'after' | 'current'} Where the page sits relative to the current one.
   *
   * @example
   * stateOf(0); // 'before' while page 2 is shown
   */
  const stateOf = (i: number) => (i < page ? 'before' : i > page ? 'after' : 'current');

  return (
    <div className={styles.root}>
      <div className={styles.stage}>
        {pages.map((p, i) => (
          <div key={i} className={styles.scene} data-state={stateOf(i)} inert={i !== page ? true : undefined}>
            {p.scene}
          </div>
        ))}
        <div className={styles.dragStrip} data-drag-region />
      </div>

      <div className={styles.copyArea}>
        {pages.map((p, i) => (
          <div key={i} className={styles.copy} data-state={stateOf(i)} aria-hidden={i !== page} inert={i !== page ? true : undefined}>
            {p.copy}
          </div>
        ))}
      </div>

      <footer className={styles.footer} data-drag-region>
        <label className={styles.check}>
          <input type="checkbox" checked={showAtLogin} onChange={(e) => toggleShowAtLogin(e.target.checked)} />
          {t(S.showAtLogin)}
        </label>

        {/* Page control: one dot per page; the current page's dot carries aria-current="step". */}
        <div className={`lg lg-control lg-capsule ${styles.dots}`} role="group" aria-label={t(S.pages)}>
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              className={styles.dot}
              aria-label={fmt(t(S.page), { n: i + 1, total: PAGE_COUNT })}
              aria-current={i === page ? 'step' : undefined}
              onClick={() => goTo(i)}
              style={{ '--i': i } as CSSProperties}
            />
          ))}
        </div>

        <div className={styles.navButtons}>
          <Button
            size="large"
            className="lg lg-control"
            onClick={() => goTo(page - 1)}
            style={{ visibility: page === 0 ? 'hidden' : undefined }}
            tabIndex={page === 0 ? -1 : undefined}
          >
            {t(S.back)}
          </Button>
          <Button ref={primaryRef} size="large" variant="primary" onClick={primary} className={styles.primary}>
            {t(last ? S.getStarted : S.continue)}
          </Button>
        </div>
      </footer>
    </div>
  );
}

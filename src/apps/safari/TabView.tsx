/**
 * The content of one Safari tab. Internal webos:// pages render as React; websites and local
 * .html files load in a sandboxed iframe. Tabs stay mounted while hidden so background tabs
 * keep their page state.
 */
import { memo, useEffect, useMemo, type Dispatch } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { fs, useLocale, useNode, useT, wm } from '@/kernel';
import { openCompose, parseMailto } from '@/apps/mail/compose';
import { useSafari } from './store';
import { S, titleFor } from './strings';
import { currentURL, type Tab, type TabsAction } from './tabs';
import { HISTORY_URL, PORTFOLIO_URL, START_URL, filePathOf, isKnownBlocked, isKnownFramable, isMailto, isSelf, kindOfURL } from './url';
import type { PageAPI } from './pages/api';
import { openExternal } from './pages/api';
import { StartPage } from './pages/StartPage';
import { HistoryPage } from './pages/HistoryPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { BlockedPage, HomeAgainPage, NotFoundPage, TimeoutPage } from './pages/ErrorPages';
import styles from './Safari.module.css';

const LOAD_TIMEOUT = 8000; /** Milliseconds a frame may stay loading before it is treated as blocked or unreachable. */

const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'; /** `sandbox` permissions for page iframes: scripts, same-origin access, forms and popups, with popups opened outside the sandbox. */

/**
 * Sandboxed iframe that shows a website or a local file for one tab.
 *
 * The iframe is keyed by the tab's navigation counter, so every navigation or reload mounts
 * a fresh frame. It sends no referrer and, when its `load` event fires, dispatches a `status`
 * action marking that navigation as loaded (stale navigations are ignored by the reducer).
 *
 * @param {Object} props - Component props.
 * @param {Tab} props.tab - The tab the frame belongs to.
 * @param {string} props.src - URL loaded into the iframe.
 * @param {Dispatch<TabsAction>} props.dispatch - Dispatcher of the window's tab reducer.
 * @returns {JSX.Element} The iframe element.
 *
 * @example
 * <Frame tab={tab} src="https://example.com/" dispatch={dispatch} />
 */
function Frame({ tab, src, dispatch }: { tab: Tab; src: string; dispatch: Dispatch<TabsAction> }) {
  const locale = useLocale();
  const { id, nav } = tab;
  return (
    <iframe
      key={nav}
      className={styles.frame}
      src={src}
      title={titleFor(currentURL(tab), locale)}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      allow="fullscreen; clipboard-write"
      onLoad={() => dispatch({ type: 'status', id, nav, status: 'loaded' })}
    />
  );
}

/**
 * Shows a file:// URL from the virtual file system in a frame.
 *
 * Subscribes to the file's node, so the frame re-renders (and reloads) whenever the file
 * changes. When the path is missing or is not a file, it marks the navigation as loaded and
 * renders the "file not found" page instead; otherwise it loads the URL from `fs.getURL`
 * (the file's `src`, or a data: URL of its content) into a `Frame`.
 *
 * @param {Object} props - Component props.
 * @param {Tab} props.tab - The tab whose current URL is a file:// URL.
 * @param {Dispatch<TabsAction>} props.dispatch - Dispatcher of the window's tab reducer.
 * @returns {JSX.Element} The file's frame, or the not-found page.
 *
 * @example
 * <FileFrame tab={tab} dispatch={dispatch} />
 */
function FileFrame({ tab, dispatch }: { tab: Tab; dispatch: Dispatch<TabsAction> }) {
  const url = currentURL(tab);
  const node = useNode(filePathOf(url));
  const missing = !node || node.type !== 'file';
  const { id, nav } = tab;
  useEffect(() => {
    if (missing) dispatch({ type: 'status', id, nav, status: 'loaded' });
  }, [missing, id, nav, dispatch]);
  if (missing) return <NotFoundPage url={filePathOf(url)} file />;
  return <Frame tab={tab} src={fs.getURL(node.path)} dispatch={dispatch} />;
}

/** Props of one tab's content view. */
interface Props {
  /** The tab to render. */
  tab: Tab;
  /** Whether this is the window's selected tab; inactive tabs stay mounted but hidden. */
  active: boolean;
  /** Id of the Safari window hosting the tab. */
  windowId: string;
  /** Dispatcher of the window's tab reducer. */
  dispatch: Dispatch<TabsAction>;
}

/**
 * Content of one Safari tab, memoized so unchanged background tabs skip re-rendering.
 *
 * Picks what to render from the current URL: webos:// pages (Start Page, portfolio, history,
 * or not-found) as React, about:blank as an empty pane, file:// URLs through `FileFrame`, this
 * site's own URL as the "home again" page, sites known to refuse framing as the blocked page,
 * and every other website in a sandboxed `Frame`. mailto: links from internal pages open a Mail
 * compose window instead of navigating. While a navigation is loading, a timer marks it as
 * timed out after `LOAD_TIMEOUT` and the timeout page is overlaid. Each navigation (keyed by
 * tab id and nav counter) is recorded in the shared history. For websites that may refuse
 * framing silently, a dismissible hint offers to open the page in the host browser. Page zoom
 * scales an oversized box so the scaled content still fills the view.
 *
 * @param {Props} props - Component props.
 * @param {Tab} props.tab - The tab to render.
 * @param {boolean} props.active - Whether the tab is visible.
 * @param {string} props.windowId - Id of the hosting Safari window.
 * @param {Dispatch<TabsAction>} props.dispatch - Dispatcher of the window's tab reducer.
 * @returns {JSX.Element} The tab's content view.
 *
 * @example
 * <TabView key={tab.id} tab={tab} active={tab.id === state.activeId} windowId={windowId} dispatch={dispatch} />
 */
export const TabView = memo(function TabView({ tab, active, windowId, dispatch }: Props) {
  const t = useT();
  const locale = useLocale();
  const url = currentURL(tab);
  const kind = kindOfURL(url);
  const { id, nav, status } = tab;

  const api = useMemo<PageAPI>(
    () => ({
      windowId,
      /**
       * Opens a URL in this tab.
       *
       * mailto: URLs open a Mail compose window instead; anything else is pushed onto the
       * tab's back/forward stack.
       *
       * @param {string} to - URL to open.
       * @returns {void}
       *
       * @example
       * api.navigate('webos://history');
       */
      navigate: (to) => (isMailto(to) ? void openCompose(parseMailto(to)) : dispatch({ type: 'navigate', id, url: to })),
      /**
       * Opens a URL in a new tab placed right after the active tab.
       *
       * mailto: URLs open a Mail compose window instead.
       *
       * @param {string} to - URL to open.
       * @param {boolean} [background] - Keep the current tab selected instead of switching to the new one.
       * @returns {void}
       *
       * @example
       * api.openTab('https://example.com/', true);
       */
      openTab: (to, background) => (isMailto(to) ? void openCompose(parseMailto(to)) : dispatch({ type: 'new', url: to, background, afterActive: true })),
      /**
       * Opens a URL in a new Safari window.
       *
       * @param {string} to - URL to open.
       * @returns {void}
       *
       * @example
       * api.openWindow('https://example.com/');
       */
      openWindow: (to) => void wm.openWindow('safari', { url: to }),
    }),
    [windowId, id, dispatch],
  );

  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setTimeout(() => dispatch({ type: 'status', id, nav, status: 'timeout' }), LOAD_TIMEOUT);
    return () => clearTimeout(timer);
  }, [status, id, nav, dispatch]);

  useEffect(() => {
    useSafari.getState().addVisit(url, titleFor(url, locale));
    // Records each navigation once; a later locale change does not record the visit again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nav]);

  let content: React.ReactNode;
  if (kind === 'internal') {
    if (url === START_URL) content = <StartPage api={api} />;
    else if (url === PORTFOLIO_URL) content = <PortfolioPage api={api} />;
    else if (url === HISTORY_URL) content = <HistoryPage api={api} />;
    else content = <NotFoundPage url={url} />;
  } else if (kind === 'blank') {
    content = <div className={styles.blank} />;
  } else if (kind === 'file') {
    content = <FileFrame tab={tab} dispatch={dispatch} />;
  } else if (isSelf(url)) {
    content = <HomeAgainPage api={api} />;
  } else if (isKnownBlocked(url)) {
    content = <BlockedPage url={url} api={api} />;
  } else {
    content = <Frame tab={tab} src={url} dispatch={dispatch} />;
  }

  const showHint = kind === 'web' && status === 'loaded' && !tab.hintDismissed && !isKnownBlocked(url) && !isKnownFramable(url) && !isSelf(url);
  const zoomStyle = tab.zoom !== 1 ? { width: `${100 / tab.zoom}%`, height: `${100 / tab.zoom}%`, transform: `scale(${tab.zoom})` } : undefined;

  return (
    <div className={styles.tabView} hidden={!active} aria-hidden={!active}>
      <div className={styles.zoomBox} style={zoomStyle}>
        {content}
      </div>
      {status === 'timeout' && (
        <div className={styles.overlayPage}>
          <TimeoutPage url={url} onRetry={() => dispatch({ type: 'reload', id })} />
        </div>
      )}
      {showHint && (
        <div className={`lg lg-thick lg-capsule lg-float ${styles.hint}`} role="status">
          <span>{t(S.frameHint)}</span>
          <button type="button" className={styles.hintLink} onClick={() => openExternal(url)}>
            {t(S.frameHintAction)} <ExternalLink size={11} />
          </button>
          <button type="button" className={styles.hintClose} aria-label={t(S.dismiss)} onClick={() => dispatch({ type: 'dismissHint', id })}>
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
});

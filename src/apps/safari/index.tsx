/**
 * Safari: a tabbed web browser. Websites load in sandboxed iframes; webos:// pages (Start Page,
 * portfolio, history) are React. Each tab has its own back/forward history; browsing history,
 * bookmarks and the Reading List are shared by all Safari windows (see ./store).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, Glasses, PanelLeft, Plus, Share, Star, X } from 'lucide-react';
import { IconButton, SidebarItem, SidebarSection, Toolbar } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import {
  PATHS,
  dialogs,
  extname,
  fs,
  showContextMenu,
  showFSError,
  useAppMenus,
  useArgsChange,
  useLocale,
  useT,
  useWindow,
  useWindowKeydown,
  wm,
  type AppArgs,
  type AppProps,
  type Locale,
  type MenuItem,
} from '@/kernel';
import { openCompose, parseMailto } from '@/apps/mail/compose';
import { AddressBar, type AddressBarHandle } from './AddressBar';
import { TabView } from './TabView';
import { confirmClearHistory } from './pages/HistoryPage';
import { linkMenu, openExternal, type PageAPI } from './pages/api';
import { buildFavorites, useSafari } from './store';
import { S, titleFor } from './strings';
import { ZOOM_STEPS, canGoBack, canGoForward, currentURL, initTabs, tabsReducer, type Tab, type TabsAction, type TabsState } from './tabs';
import { HISTORY_URL, START_URL, fileURL, isKnownBlocked, isMailto, isSelf, kindOfURL, letterIcon, parseInput, parseLinkFile } from './url';
import styles from './Safari.module.css';

const sep: MenuItem = { separator: true }; /** Separator entry reused in menus and context menus. */

/**
 * Resolves the URL Safari should show for a file opened from the file system.
 *
 * For .webloc and .url link files, the target URL is read from the file content and
 * normalized with `parseInput`; any other file is shown directly through its file:// URL.
 * Missing paths, directories and link files without a readable target yield null.
 *
 * @param {string} path - Absolute path of the file in the virtual file system.
 * @returns {string | null} The URL to open, or null when nothing can be opened.
 *
 * @example
 * urlForPath('/Users/guest/Downloads/Example.webloc'); // 'https://example.com/'
 */
function urlForPath(path: string): string | null {
  const node = fs.stat(path);
  if (!node || node.type !== 'file') return null;
  const ext = extname(path);
  if (ext === 'webloc' || ext === 'url') {
    const target = parseLinkFile(node.content ?? '');
    return target ? parseInput(target) : null;
  }
  return fileURL(path);
}

/**
 * Picks the first URL to show from a window's launch args.
 *
 * A non-empty string `url` arg is parsed like address-bar input; otherwise a string `path`
 * arg is resolved with `urlForPath`. mailto: URLs and args that resolve to nothing fall back
 * to the Start Page.
 *
 * @param {AppArgs} args - Arguments the window was opened (or re-activated) with.
 * @returns {string} The URL for the new tab.
 *
 * @example
 * initialURL({ url: 'example.com' }); // 'https://example.com/'
 * initialURL({}); // START_URL
 */
function initialURL(args: AppArgs): string {
  const url = typeof args.url === 'string' && args.url ? parseInput(args.url) : typeof args.path === 'string' ? urlForPath(args.path) : null;
  return url && !isMailto(url) ? url : START_URL;
}

/**
 * Tells whether a URL is displayed in an iframe rather than as a React page.
 *
 * File URLs and websites are framed, except sites known to refuse framing and this site's
 * own URL, which render React placeholder pages.
 *
 * @param {string} url - URL of the page.
 * @returns {boolean} True when the tab shows the URL in an iframe.
 *
 * @example
 * isFramed('https://example.com/'); // true
 * isFramed('webos://start'); // false
 */
function isFramed(url: string): boolean {
  const kind = kindOfURL(url);
  return kind === 'file' || (kind === 'web' && !isKnownBlocked(url) && !isSelf(url));
}

/* ───────────────────────── Tab bar ───────────────────────── */

const TAB_MIME = 'application/x-webos-safari-tab'; /** Drag-and-drop data type carrying the index of a dragged tab. */

/**
 * Tab strip shown under the toolbar when a window has more than one tab.
 *
 * Each tab shows a letter tile (or a spinner while loading), its title and a hover close
 * button. Clicking selects a tab, middle-clicking closes it, and right-clicking opens a menu
 * with New Tab, Close Tab, Close Other Tabs, Reload and Copy Link. Tabs can be reordered by
 * dragging (only drags that started in this bar are accepted). The bar is a roving-tabindex
 * tablist navigated with the arrow keys, Home and End. Double-clicking the empty bar opens a
 * new tab and stops the event so the window frame does not also zoom.
 *
 * @param {Object} props - Component props.
 * @param {TabsState} props.state - Tab state of the window.
 * @param {Dispatch<TabsAction>} props.dispatch - Dispatcher of the window's tab reducer.
 * @param {(id: string) => void} props.onClose - Closes a tab (closing the last one closes the window).
 * @param {() => void} props.onNewTab - Opens a new tab.
 * @param {Locale} props.locale - Locale used for page titles.
 * @returns {JSX.Element} The tab bar.
 *
 * @example
 * <TabBar state={state} dispatch={dispatch} onClose={closeTab} onNewTab={() => newTab()} locale={locale} />
 */
function TabBar({ state, dispatch, onClose, onNewTab, locale }: { state: TabsState; dispatch: Dispatch<TabsAction>; onClose: (id: string) => void; onNewTab: () => void; locale: Locale }) {
  const t = useT();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /**
   * Clears the tab drag state.
   *
   * Resets both the dragged index and the drop-target index, removing the dragging and
   * drop-target highlights.
   *
   * @returns {void}
   *
   * @example
   * <div onDragEnd={endDrag} />
   */
  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  /**
   * Keyboard navigation for a focused tab (roving tabindex).
   *
   * ArrowLeft / ArrowRight select the previous / next tab (wrapping), Home and End the first
   * and last tab; the newly selected tab is focused on the next frame, after it has become
   * the tab with `tabIndex=0`. Enter and Space select the focused tab.
   *
   * @param {KeyboardEvent<HTMLDivElement>} e - The keyboard event on the tab element.
   * @param {string} id - Id of the focused tab.
   * @param {number} i - Index of the focused tab in the bar.
   * @returns {void}
   *
   * @example
   * <div role="tab" onKeyDown={(e) => onTabKey(e, tab.id, i)} />
   */
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>, id: string, i: number) => {
    let to: number | null = null;
    if (e.key === 'ArrowLeft') to = (i - 1 + state.tabs.length) % state.tabs.length;
    else if (e.key === 'ArrowRight') to = (i + 1) % state.tabs.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = state.tabs.length - 1;
    if (to !== null) {
      e.preventDefault();
      const target = state.tabs[to];
      dispatch({ type: 'select', id: target.id });
      const bar = e.currentTarget.parentElement;
      requestAnimationFrame(() => bar?.querySelector<HTMLElement>(`[data-tab-id="${target.id}"]`)?.focus());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dispatch({ type: 'select', id });
    }
  };

  return (
    <div
      className={`lg lg-flat lg-capsule ${styles.tabbar}`}
      role="tablist"
      data-drag-region
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        onNewTab();
      }}
    >
      {state.tabs.map((tab, i) => {
        const url = currentURL(tab);
        const title = titleFor(url, locale);
        const li = letterIcon(title, url);
        const active = tab.id === state.activeId;
        const cls = [styles.tab, active && styles.tabActive, dragFrom === i && styles.tabDragging, dragOver === i && dragFrom !== i && styles.tabDropTarget].filter(Boolean).join(' ');
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={title}
            className={cls}
            draggable
            onClick={() => dispatch({ type: 'select', id: tab.id })}
            onKeyDown={(e) => onTabKey(e, tab.id, i)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            onContextMenu={(e) =>
              showContextMenu(e, [
                { label: S.newTab, action: onNewTab },
                sep,
                { label: S.closeTab, action: () => onClose(tab.id) },
                { label: S.closeOtherTabs, disabled: state.tabs.length < 2, action: () => state.tabs.forEach((x) => x.id !== tab.id && dispatch({ type: 'close', id: x.id })) },
                sep,
                { label: S.reload, action: () => dispatch({ type: 'reload', id: tab.id }) },
                { label: S.copyLink, disabled: kindOfURL(url) !== 'web', action: () => void navigator.clipboard?.writeText(url).catch(() => {}) },
              ])
            }
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_MIME, String(i));
              e.dataTransfer.effectAllowed = 'move';
              setDragFrom(i);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) dispatch({ type: 'move', from: dragFrom, to: i });
              endDrag();
            }}
            onDragEnd={endDrag}
          >
            <button
              type="button"
              className={styles.tabClose}
              aria-label={t(S.closeTab)}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X size={10} strokeWidth={2.4} />
            </button>
            <span className={styles.tabIcon} style={{ '--tile': li.color } as CSSProperties} aria-hidden>
              {tab.status === 'loading' ? <span className={styles.spinner} /> : li.letter}
            </span>
            <span className={styles.tabTitle}>{title}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Window ───────────────────────── */

/**
 * Root component of a Safari window.
 *
 * Holds the window's tabs in a reducer initialized from the launch args; re-activating the
 * window with new args opens them in a new tab. Renders the toolbar (sidebar toggle,
 * back/forward with right-click history menus, the address bar, Share and New Tab), the tab bar
 * when there is more than one tab, an optional sidebar (tabs, favorites, Reading List) and every
 * tab's `TabView` (inactive tabs stay mounted but hidden). Registers the File, View, History,
 * Bookmarks and Window menus, whose shortcuts work while the window is focused; the Window menu
 * lists every tab, with ⌘1–⌘8 selecting tabs by position and ⌘9 the last tab. The window title
 * follows the active page's title. Focus requests for the address field are counted in state and
 * applied in an effect, so New Tab focuses the field only after the new tab has rendered. A short
 * toast reports zoom changes and added bookmarks / Reading List items. While the window is not
 * focused and the active tab shows an iframe, a transparent shield covers the content so the
 * first click focuses the window. Escape stops a loading page.
 *
 * @param {AppProps} props - Props passed by the window manager.
 * @param {string} props.windowId - Id of the window hosting this component.
 * @param {AppArgs} props.args - Launch args: an optional `url` to open or a file `path`.
 * @returns {JSX.Element} The Safari window content.
 *
 * @example
 * <Safari windowId="w1" pid={1} args={{ url: 'https://example.com' }} />
 */
export default function Safari({ windowId, args }: AppProps) {
  const t = useT();
  const locale = useLocale();
  const { focused } = useWindow();
  const [state, dispatch] = useReducer(tabsReducer, args, (a: AppArgs) => initTabs(initialURL(a)));
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const address = useRef<AddressBarHandle>(null);
  const shareBtn = useRef<HTMLButtonElement>(null);

  const bookmarks = useSafari((s) => s.bookmarks);
  const history = useSafari((s) => s.history);
  const readingList = useSafari((s) => s.readingList);
  const favorites = useMemo(() => buildFavorites(locale, bookmarks), [locale, bookmarks]);

  const tab: Tab = state.tabs.find((x) => x.id === state.activeId) ?? state.tabs[0];
  const url = currentURL(tab);
  const kind = kindOfURL(url);
  const title = titleFor(url, locale);
  const bookmarkable = kind === 'web' || (kind === 'internal' && url !== START_URL);

  useEffect(() => wm.setTitle(windowId, title), [windowId, title]);

  useEffect(() => {
    if (focusRequest) address.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(id);
  }, [toast]);

  useArgsChange((a) => dispatch({ type: 'new', url: initialURL(a) }));

  /* ── Actions ── */

  /**
   * Opens a URL in the active tab.
   *
   * mailto: URLs open a Mail compose window instead; anything else is pushed onto the active
   * tab's back/forward stack (dropping its forward history).
   *
   * @param {string} to - URL to open.
   * @returns {void}
   *
   * @example
   * navigate('https://example.com/');
   */
  const navigate = useCallback((to: string) => (isMailto(to) ? void openCompose(parseMailto(to)) : dispatch({ type: 'navigate', id: tab.id, url: to })), [tab.id]);
  /**
   * Opens a new tab at the end of the tab bar and selects it.
   *
   * Without a URL the tab shows the Start Page and the address field is focused once the new
   * tab has rendered (through the focus-request counter).
   *
   * @param {string} [to] - URL for the new tab; omitted for an empty Start Page tab.
   * @returns {void}
   *
   * @example
   * newTab();
   * newTab('webos://portfolio');
   */
  const newTab = useCallback((to?: string) => {
    dispatch({ type: 'new', url: to });
    if (!to) setFocusRequest((n) => n + 1);
  }, []);
  /**
   * Closes a tab, or the whole window when it is the only tab.
   *
   * @param {string} id - Id of the tab to close.
   * @returns {void}
   *
   * @example
   * closeTab(tab.id);
   */
  const closeTab = useCallback((id: string) => (state.tabs.length <= 1 ? void wm.close(windowId) : dispatch({ type: 'close', id })), [state.tabs.length, windowId]);
  /**
   * Goes one entry back in the active tab's history.
   *
   * @returns {void}
   *
   * @example
   * <IconButton onClick={back} />
   */
  const back = () => dispatch({ type: 'go', id: tab.id, delta: -1 });
  /**
   * Goes one entry forward in the active tab's history.
   *
   * @returns {void}
   *
   * @example
   * <IconButton onClick={forward} />
   */
  const forward = () => dispatch({ type: 'go', id: tab.id, delta: 1 });
  /**
   * Reloads the active tab's current page.
   *
   * Bumps the tab's navigation counter, which remounts its iframe.
   *
   * @returns {void}
   *
   * @example
   * reload();
   */
  const reload = () => dispatch({ type: 'reload', id: tab.id });
  /**
   * Stops loading the active tab.
   *
   * A loading tab is marked as loaded; the iframe itself is left as is.
   *
   * @returns {void}
   *
   * @example
   * stop();
   */
  const stop = () => dispatch({ type: 'stop', id: tab.id });
  /**
   * Shows or hides the sidebar.
   *
   * @returns {void}
   *
   * @example
   * <IconButton onClick={toggleSidebar} />
   */
  const toggleSidebar = () => setSidebar((v) => !v);

  /**
   * Copies the active page's URL to the host clipboard.
   *
   * Clipboard failures (missing API or denied permission) are ignored.
   *
   * @returns {void}
   *
   * @example
   * copyLink();
   */
  const copyLink = () => void navigator.clipboard?.writeText(url).catch(() => {});
  /**
   * Opens a Mail compose window containing the active page.
   *
   * The subject is the page title and the body holds the title and the URL.
   *
   * @returns {string | null} Id of the compose window, or null when no window was opened.
   *
   * @example
   * emailPage();
   */
  const emailPage = () => openCompose({ to: '', subject: title, body: `${title}\n${url}\n` });
  /**
   * Bookmarks the active page and shows a confirmation toast.
   *
   * The store ignores URLs that are already bookmarked.
   *
   * @returns {void}
   *
   * @example
   * addBookmark();
   */
  const addBookmark = () => {
    useSafari.getState().addBookmark({ url, title });
    setToast(t(S.bookmarkAdded));
  };
  /**
   * Adds the active page to the Reading List and shows a confirmation toast.
   *
   * The store ignores URLs that are already in the list.
   *
   * @returns {void}
   *
   * @example
   * addReading();
   */
  const addReading = () => {
    useSafari.getState().addToReadingList({ url, title });
    setToast(t(S.readingAdded));
  };

  /**
   * Changes the active tab's page zoom and shows the new level in a toast.
   *
   * A direction of 0 resets to 100%. Otherwise the current zoom is located in `ZOOM_STEPS`
   * (the first step not below it, or the last step) and moved one step in the given direction,
   * clamped to the first and last steps.
   *
   * @param {-1 | 0 | 1} dir - -1 to zoom out, 1 to zoom in, 0 for actual size.
   * @returns {void}
   *
   * @example
   * zoomBy(1); // e.g. 100% → 110%
   */
  const zoomBy = (dir: -1 | 0 | 1) => {
    let zoom = 1;
    if (dir !== 0) {
      const i = ZOOM_STEPS.findIndex((z) => z >= tab.zoom - 1e-6);
      const cur = i === -1 ? ZOOM_STEPS.length - 1 : i;
      zoom = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, cur + dir))];
    }
    dispatch({ type: 'zoom', id: tab.id, zoom });
    setToast(`${Math.round(zoom * 100)}%`);
  };

  /**
   * Saves the active page as a .webloc link file.
   *
   * Does nothing for pages that cannot be bookmarked. The suggested name is the page title with
   * `/`, `:` and `\` replaced by `-`, trimmed and cut to 80 characters (or "Untitled"), and the
   * save panel opens as a sheet on this window in Downloads. The file content is the URL
   * followed by a newline. File-system errors are reported in an alert instead of being thrown.
   *
   * @async
   * @returns {Promise<void>} Resolves when the file is written or the panel is cancelled.
   *
   * @example
   * void saveAs();
   */
  const saveAs = async () => {
    if (!bookmarkable) return;
    const base = title.replace(/[/:\\]/g, '-').trim().slice(0, 80) || t(S.untitled);
    const path = await dialogs.save({ windowId, appId: 'safari', title: S.saveWebloc, defaultName: `${base}.webloc`, defaultDir: PATHS.downloads });
    if (!path) return;
    try {
      fs.writeFile(path, `${url}\n`);
    } catch (e) {
      void showFSError(e, windowId);
    }
  };

  /**
   * Lets the user pick an HTML or link file and opens it in the active tab.
   *
   * Shows an open panel (as a sheet, starting in Documents) limited to .html, .htm, .webloc and
   * .url files. HTML files open through their file:// URL and link files open their target;
   * nothing happens when the panel is cancelled or the file has no usable URL.
   *
   * @async
   * @returns {Promise<void>} Resolves after the panel closes and any navigation is dispatched.
   *
   * @example
   * void openFile();
   */
  const openFile = async () => {
    const path = await dialogs.open({ windowId, appId: 'safari', defaultDir: PATHS.documents, extensions: ['html', 'htm', 'webloc', 'url'] });
    const target = path ? urlForPath(path) : null;
    if (target) navigate(target);
  };

  /**
   * Builds the Share menu for the active page.
   *
   * Copy Link and Open in New Browser Tab are enabled only for websites; Email This Page, Add Bookmark
   * and Add to Reading List only for bookmarkable pages. The same items serve the toolbar's
   * Share button and the File ▸ Share submenu.
   *
   * @returns {MenuItem[]} The Share menu items.
   *
   * @example
   * showContextMenu(e, shareItems());
   */
  const shareItems = (): MenuItem[] => [
    { label: S.copyLink, disabled: kind !== 'web', action: copyLink },
    { label: S.openInBrowser, disabled: kind !== 'web', action: () => openExternal(url) },
    { label: S.emailPage, shortcut: 'mod+i', disabled: !bookmarkable, action: emailPage },
    sep,
    { label: S.addBookmark, disabled: !bookmarkable, action: addBookmark },
    { label: S.addReadingList, disabled: !bookmarkable, action: addReading },
  ];

  /**
   * Opens the Share menu below the toolbar's Share button.
   *
   * Positions the context menu at the button's bottom-left corner (4px below it) by passing a
   * minimal event-like object to `showContextMenu`.
   *
   * @returns {void}
   *
   * @example
   * <IconButton ref={shareBtn} onClick={openShare} />
   */
  const openShare = () => {
    const r = shareBtn.current?.getBoundingClientRect();
    if (r) showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} }, shareItems());
  };

  /**
   * Creates the context-menu handler for the Back or Forward button.
   *
   * The handler lists up to 12 history entries of the active tab in the given direction,
   * nearest first, each jumping straight to that entry. When there are none, it only prevents
   * the browser's own context menu.
   *
   * @param {-1 | 1} dir - -1 for the Back button, 1 for the Forward button.
   * @returns {(e: MouseEvent) => void} The `onContextMenu` handler.
   *
   * @example
   * <IconButton onClick={back} onContextMenu={historyMenu(-1)} />
   */
  const historyMenu = (dir: -1 | 1) => (e: MouseEvent) => {
    const items: MenuItem[] = [];
    for (let i = tab.index + dir, n = 0; i >= 0 && i < tab.entries.length && n < 12; i += dir, n++) {
      const delta = i - tab.index;
      items.push({ label: titleFor(tab.entries[i], locale), action: () => dispatch({ type: 'go', id: tab.id, delta }) });
    }
    if (items.length) showContextMenu(e, items);
    else e.preventDefault();
  };

  useWindowKeydown((e) => {
    if (e.key === 'Escape' && tab.status === 'loading') stop();
  });

  /* ── Menu bar ── */

  const recent = useMemo(() => {
    const seen = new Set<string>();
    return history.filter((h) => !seen.has(h.url) && seen.add(h.url)).slice(0, 10);
  }, [history]);

  useAppMenus(
    () => [
      {
        label: S.file,
        items: [
          { label: S.newWindow, shortcut: 'alt+n', action: () => void wm.openWindow('safari') },
          { label: S.newTab, shortcut: 'alt+t', action: () => newTab() },
          { label: S.openLocation, shortcut: 'mod+alt+l', action: () => address.current?.focus() },
          { label: S.openFile, shortcut: 'mod+o', action: () => void openFile() },
          sep,
          { label: S.closeTab, shortcut: 'alt+w', action: () => closeTab(tab.id) },
          { label: S.closeWindow, shortcut: 'alt+shift+w', action: () => void wm.close(windowId) },
          { label: S.closeOtherTabs, disabled: state.tabs.length < 2, action: () => state.tabs.forEach((x) => x.id !== tab.id && dispatch({ type: 'close', id: x.id })) },
          sep,
          { label: S.saveAs, shortcut: 'mod+s', disabled: !bookmarkable, action: () => void saveAs() },
          sep,
          { label: S.share, submenu: shareItems() },
        ],
      },
      {
        label: S.view,
        items: [
          { label: sidebar ? S.hideSidebar : S.showSidebar, shortcut: 'mod+alt+s', action: toggleSidebar },
          sep,
          { label: S.stop, shortcut: 'mod+.', disabled: tab.status !== 'loading', action: stop },
          { label: S.reload, action: reload },
          sep,
          { label: S.actualSize, shortcut: 'mod+0', disabled: tab.zoom === 1, action: () => zoomBy(0) },
          { label: S.zoomIn, shortcut: 'mod+=', disabled: tab.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1], action: () => zoomBy(1) },
          { label: S.zoomOut, shortcut: 'mod+-', disabled: tab.zoom <= ZOOM_STEPS[0], action: () => zoomBy(-1) },
        ],
      },
      {
        label: S.history,
        items: [
          { label: S.back, shortcut: 'mod+[', disabled: !canGoBack(tab), action: back },
          { label: S.forward, shortcut: 'mod+]', disabled: !canGoForward(tab), action: forward },
          { label: S.home, shortcut: 'mod+shift+h', action: () => navigate(START_URL) },
          sep,
          { label: S.showAllHistory, shortcut: 'mod+y', action: () => navigate(HISTORY_URL) },
          { label: S.reopenTab, shortcut: 'alt+shift+t', disabled: !state.closed.length, action: () => dispatch({ type: 'reopen' }) },
          ...(recent.length ? [sep, ...recent.map<MenuItem>((h) => ({ label: h.title, action: () => navigate(h.url) }))] : []),
          sep,
          { label: S.clearHistory, disabled: !history.length, action: () => void confirmClearHistory(windowId) },
        ],
      },
      {
        label: S.bookmarks,
        items: [
          { label: S.addBookmark, shortcut: 'mod+d', disabled: !bookmarkable, action: addBookmark },
          { label: S.addReadingList, shortcut: 'mod+shift+d', disabled: !bookmarkable, action: addReading },
          sep,
          ...favorites.map<MenuItem>((f) => ({ label: f.title, icon: Star, action: () => navigate(f.url) })),
          ...(readingList.length
            ? [sep, { label: S.readingList, icon: Glasses, submenu: readingList.map<MenuItem>((r) => ({ label: r.title, action: () => navigate(r.url) })) }]
            : []),
        ],
      },
      {
        label: S.window,
        items: [
          { label: S.prevTab, shortcut: 'mod+alt+left', disabled: state.tabs.length < 2, action: () => dispatch({ type: 'cycle', delta: -1 }) },
          { label: S.nextTab, shortcut: 'mod+alt+right', disabled: state.tabs.length < 2, action: () => dispatch({ type: 'cycle', delta: 1 }) },
          sep,
          ...state.tabs.map<MenuItem>((x, i) => ({
            label: titleFor(currentURL(x), locale),
            checked: x.id === state.activeId,
            shortcut: i < 8 ? `mod+${i + 1}` : i === state.tabs.length - 1 ? 'mod+9' : undefined,
            action: () => dispatch({ type: 'select', id: x.id }),
          })),
        ],
      },
    ],
    [state, sidebar, favorites, readingList, history, recent, locale, url, title, bookmarkable, closeTab, navigate, newTab],
  );

  /* ── Render ── */

  const sidebarAPI: PageAPI = {
    windowId,
    navigate,
    /**
     * Opens a sidebar link in a new tab placed right after the active tab.
     *
     * @param {string} to - URL to open.
     * @param {boolean} [background] - Keep the current tab selected instead of switching to the new one.
     * @returns {void}
     *
     * @example
     * sidebarAPI.openTab('https://example.com/', true);
     */
    openTab: (to, background) => dispatch({ type: 'new', url: to, background, afterActive: true }),
    /**
     * Opens a sidebar link in a new Safari window.
     *
     * @param {string} to - URL to open.
     * @returns {void}
     *
     * @example
     * sidebarAPI.openWindow('https://example.com/');
     */
    openWindow: (to) => void wm.openWindow('safari', { url: to }),
  };

  return (
    <div className={styles.safari}>
      <Toolbar className={styles.toolbar} inset={false}>
        <div className={styles.leading} data-drag-region>
          <GlassGroup>
          <IconButton label={t(sidebar ? S.hideSidebar : S.showSidebar)} active={sidebar} onClick={toggleSidebar}>
            <PanelLeft size={16} />
          </IconButton>
        </GlassGroup>
        <GlassGroup>
          <IconButton label={t(S.back)} disabled={!canGoBack(tab)} onClick={back} onContextMenu={historyMenu(-1)}>
            <ChevronLeft size={20} />
          </IconButton>
          <IconButton label={t(S.forward)} disabled={!canGoForward(tab)} onClick={forward} onContextMenu={historyMenu(1)}>
            <ChevronRight size={20} />
          </IconButton>
        </GlassGroup>
        </div>
        <div className={styles.fieldSlot} data-drag-region>
          <AddressBar
            ref={address}
            url={url}
            status={tab.status}
            nav={tab.nav}
            tabId={tab.id}
            favorites={favorites}
            history={history}
            onSubmit={navigate}
            onReload={reload}
            onStop={stop}
          />
        </div>
        <div className={styles.trailing} data-drag-region>
          <GlassGroup>
            <IconButton ref={shareBtn} label={t(S.share)} onClick={openShare}>
              <Share size={15} />
            </IconButton>
            <IconButton label={t(S.newTab)} onClick={() => newTab()}>
              <Plus size={18} />
            </IconButton>
          </GlassGroup>
        </div>
      </Toolbar>

      {state.tabs.length > 1 && <TabBar state={state} dispatch={dispatch} onClose={closeTab} onNewTab={() => newTab()} locale={locale} />}

      <div className={styles.body}>
        {sidebar && (
          <aside className={`ui-sidebar ${styles.sidebar}`} aria-label={t(S.sidebar)}>
            <SidebarSection title={`${t(S.tabs)} · ${state.tabs.length}`}>
              {state.tabs.map((x) => {
                const u = currentURL(x);
                const ti = titleFor(u, locale);
                const li = letterIcon(ti, u);
                return (
                  <SidebarItem
                    key={x.id}
                    selected={x.id === state.activeId}
                    icon={
                      <span className={styles.sideIcon} style={{ '--tile': li.color } as CSSProperties}>
                        {li.letter}
                      </span>
                    }
                    label={ti}
                    onClick={() => dispatch({ type: 'select', id: x.id })}
                  />
                );
              })}
            </SidebarSection>
            <SidebarSection title={t(S.favorites)}>
              {favorites.map((f) => (
                <SidebarItem
                  key={f.url}
                  icon={<Star size={14} />}
                  label={f.title}
                  title={f.url}
                  onClick={() => navigate(f.url)}
                  onContextMenu={(e) => showContextMenu(e, linkMenu(sidebarAPI, f.url, f.builtin ? [] : [{ label: S.removeFavorite, action: () => useSafari.getState().removeBookmark(f.url) }]))}
                />
              ))}
            </SidebarSection>
            <SidebarSection title={t(S.readingList)}>
              {readingList.length === 0 ? (
                <div className={styles.sideEmpty}>—</div>
              ) : (
                readingList.map((r) => (
                  <SidebarItem
                    key={r.url}
                    icon={<Glasses size={14} />}
                    label={r.title}
                    title={r.url}
                    onClick={() => {
                      useSafari.getState().markRead(r.url);
                      navigate(r.url);
                    }}
                    onContextMenu={(e) => showContextMenu(e, linkMenu(sidebarAPI, r.url, [{ label: S.removeReading, action: () => useSafari.getState().removeFromReadingList(r.url) }]))}
                  />
                ))
              )}
            </SidebarSection>
          </aside>
        )}

        <main className={styles.content}>
          {state.tabs.map((x) => (
            <TabView key={x.id} tab={x} active={x.id === state.activeId} windowId={windowId} dispatch={dispatch} />
          ))}
          {/* Clicks inside a cross-origin iframe never reach this document, so an inactive window
              covers its frame to receive the activating click. */}
          {!focused && isFramed(url) && <div className={styles.shield} onMouseDown={() => wm.focus(windowId)} aria-hidden />}
          {toast && (
            <div key={toast} className={`lg lg-thick lg-capsule lg-float ${styles.toast}`} role="status">
              {toast}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}


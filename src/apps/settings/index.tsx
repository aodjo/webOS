/**
 * System Settings (macOS 26 Tahoe layout): an inset Liquid Glass sidebar running the full window
 * height (traffic lights inside its top, then search, the user card and grouped panes); a content
 * area whose toolbar carries the back/forward glass capsule and the pane title, over inset-grouped forms.
 *
 * Every control writes straight to the reactive kernel settings, so changes apply live across
 * the whole OS. Panes can be opened from elsewhere with `wm.launch('settings', { pane: 'wallpaper' })`.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { IconButton, SearchField } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import { osInfo } from '@/data/portfolio';
import { COMMON, fmt, useAppMenus, useArgsChange, useSystem, useT, useWM, wm, type AppProps, type MenuItem } from '@/kernel';
import { PaneIcon, UserAvatar } from './kit';
import { NavContext, type SettingsNav } from './nav';
import { DEFAULT_PANE, findPanes, getPane, resolvePane, SIDEBAR_GROUPS, type PaneDef } from './registry';
import { setPrefs, usePrefs } from './prefs';
import styles from './Settings.module.css';

const S = {
  search: { en: 'Search', ko: '검색' },
  account: { en: '{os} Account', ko: '{os} 계정' },
  back: { en: 'Back', ko: '뒤로' },
  forward: { en: 'Forward', ko: '앞으로' },
  showAll: { en: 'Show All', ko: '모두 보기' },
  noResults: { en: 'No Results', ko: '결과 없음' },
  panes: { en: 'Settings', ko: '설정' },
}; /** Localized UI strings of the Settings window chrome. */

/* ───────────────────────── Navigation history ───────────────────────── */

/** Back/forward history of visited panes. */
interface History {
  /** Visited pane ids, oldest first. */
  stack: string[];
  /** Position of the current pane in `stack`. */
  index: number;
}

/** Actions accepted by `historyReducer`. */
type HistoryAction = { type: 'go'; id: string } | { type: 'back' } | { type: 'forward' };

const MAX_HISTORY = 50; /** Maximum number of entries kept in the back/forward history. */

/**
 * Reducer for the pane back/forward history, browser style.
 *
 * `go` drops any forward entries, appends the pane and makes it current, trimming the oldest
 * entries beyond `MAX_HISTORY`; going to the pane that is already current is a no-op. `back`
 * and `forward` move the index by one and are no-ops at either end. Unchanged history is
 * returned as the same object, so React skips the re-render.
 *
 * @param {History} h - Current history state.
 * @param {HistoryAction} a - Navigation action.
 * @returns {History} The next history state.
 *
 * @example
 * const [history, dispatch] = useReducer(historyReducer, { stack: ['appearance'], index: 0 });
 * dispatch({ type: 'go', id: 'wallpaper' });
 */
function historyReducer(h: History, a: HistoryAction): History {
  switch (a.type) {
    case 'go': {
      if (h.stack[h.index] === a.id) return h;
      const stack = [...h.stack.slice(0, h.index + 1), a.id].slice(-MAX_HISTORY);
      return { stack, index: stack.length - 1 };
    }
    case 'back':
      return h.index > 0 ? { ...h, index: h.index - 1 } : h;
    case 'forward':
      return h.index < h.stack.length - 1 ? { ...h, index: h.index + 1 } : h;
  }
}

const NARROW_WIDTH = 600; /** Window width (px) below which the sidebar and the content are shown one at a time, like iOS. */

/* ───────────────────────── App ───────────────────────── */

/**
 * Invisible component that navigates when the app is re-launched with a `pane` argument.
 *
 * Re-launching the single-window app with `{ pane }` delivers new args to the existing window;
 * this resolves them (ids and aliases) and calls `onPane` with the matching pane id, ignoring
 * unknown values. It lives in its own component because `useArgsChange` subscribes to the whole
 * window state, and the panes should not re-render whenever the window is moved, retitled or
 * restacked.
 *
 * @param {Object} props - Component props.
 * @param {(id: string) => void} props.onPane - Called with the resolved pane id.
 * @returns {null} Renders nothing.
 *
 * @example
 * <PaneArgsListener onPane={go} />
 */
function PaneArgsListener({ onPane }: { onPane: (id: string) => void }) {
  useArgsChange((a) => {
    const target = resolvePane(a.pane);
    if (target) onPane(target.id);
  });
  return null;
}

/**
 * System Settings window: searchable pane sidebar plus the selected pane's content.
 *
 * The first pane comes from `args.pane`, else the last pane remembered in the app prefs, else
 * the default pane. Navigation goes through a back/forward history (toolbar capsule, View menu
 * ⌘[ / ⌘], and the `go` function shared with panes via `NavContext`). The window title follows
 * the pane name, the current pane is saved for next launch, and switching panes scrolls the
 * content back to the top. Typing in the search field replaces the grouped list with matching
 * panes. A ResizeObserver switches to a narrow layout below `NARROW_WIDTH`, where the sidebar
 * and the content are shown one at a time. In-window sheets portal into a host element that
 * covers the whole window.
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - Id of this Settings window.
 * @param {AppArgs} props.args - Launch arguments; `args.pane` selects the initial pane.
 * @returns {JSX.Element} The Settings window content.
 *
 * @example
 * wm.launch('settings', { pane: 'wallpaper' });
 */
export default function SettingsApp({ windowId, args }: AppProps) {
  const t = useT();
  const focused = useWM((s) => s.focusedId === windowId);
  const fullName = useSystem((x) => x.settings.fullName);
  const avatar = useSystem((x) => x.settings.avatar);

  const [history, dispatch] = useReducer(historyReducer, undefined, (): History => {
    const initial = resolvePane(args.pane) ?? resolvePane(usePrefs.getState().lastPane) ?? getPane(DEFAULT_PANE);
    return { stack: [initial.id], index: 0 };
  });
  const pane = getPane(history.stack[history.index]);
  const canBack = history.index > 0;
  const canForward = history.index < history.stack.length - 1;

  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim() ? findPanes(query) : null), [query]);

  const [sheetHost, setSheetHost] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  /**
   * Navigates to a pane and, in the narrow layout, leaves the sidebar list for the content.
   *
   * Dispatches a `go` action to the history reducer (a no-op when the pane is already current)
   * and closes the narrow-layout list so the pane content is shown. The callback is stable, so
   * it can be shared with panes through `NavContext` without re-rendering them.
   *
   * @param {string} id - Pane id to open.
   * @returns {void}
   *
   * @example
   * go('wallpaper');
   */
  const go = useCallback((id: string) => {
    dispatch({ type: 'go', id });
    setListOpen(false);
  }, []);

  useEffect(() => {
    wm.setTitle(windowId, t(pane.name));
  }, [windowId, pane, t]);
  useEffect(() => {
    setPrefs({ lastPane: pane.id });
  }, [pane.id]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setScrolled(false);
  }, [pane.id]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < NARROW_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Focuses the sidebar search field (View → Search, ⌘F).
   *
   * In the narrow layout the sidebar is opened first; focusing waits one animation frame so the
   * field has been rendered and is visible.
   *
   * @returns {void}
   *
   * @example
   * focusSearch();
   */
  const focusSearch = useCallback(() => {
    if (narrow) setListOpen(true);
    requestAnimationFrame(() => searchRef.current?.querySelector('input')?.focus());
  }, [narrow]);

  useAppMenus(() => {
    const paneItems: MenuItem[] = SIDEBAR_GROUPS.flatMap((group, i) => [
      ...(i > 0 ? [{ separator: true } as MenuItem] : []),
      ...group.map<MenuItem>((p) => ({ label: p.name, checked: (pane.parent ?? pane.id) === p.id, action: () => go(p.id) })),
    ]);
    return [
      {
        label: COMMON.view,
        items: [
          { label: S.back, shortcut: 'mod+[', disabled: !canBack, action: () => dispatch({ type: 'back' }) },
          { label: S.forward, shortcut: 'mod+]', disabled: !canForward, action: () => dispatch({ type: 'forward' }) },
          { separator: true },
          { label: S.search, shortcut: 'mod+f', action: focusSearch },
          { separator: true },
          ...paneItems,
        ],
      },
    ];
  }, [canBack, canForward, pane, go, focusSearch]);

  const nav = useMemo<SettingsNav>(() => ({ windowId, go, sheetHost }), [windowId, go, sheetHost]);

  /**
   * Sidebar keyboard navigation: ↑/↓ move the selection between pane items, like macOS.
   *
   * Moves focus to the previous/next `[data-pane]` button (clamped at both ends, starting at the
   * first item when none is focused) and opens that pane. In the narrow layout only the focus
   * moves, since opening a pane there would hide the list.
   *
   * @param {KeyboardEvent} e - Keydown event from the sidebar list.
   * @returns {void}
   *
   * @example
   * <nav onKeyDown={onListKeyDown}>…</nav>
   */
  const onListKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-pane]') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
    const id = next.dataset.pane;
    if (id && !narrow) go(id);
  };

  /**
   * Keyboard handling for the sidebar search field.
   *
   * Escape clears a non-empty query (and stops the event so it does not also act on the
   * window); Enter opens the first result; ↓ moves focus into the result list. Keys pressed
   * while an IME composition is in progress (e.g. Korean input) are ignored.
   *
   * @param {KeyboardEvent<HTMLInputElement>} e - Keydown event from the search input.
   * @returns {void}
   *
   * @example
   * <SearchField value={query} onChange={setQuery} onKeyDown={onSearchKeyDown} />
   */
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      if (query) {
        e.stopPropagation();
        setQuery('');
      }
    } else if (e.key === 'Enter' && results?.length) {
      go(results[0].id);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      listRef.current?.querySelector<HTMLButtonElement>('[data-pane]')?.focus();
    }
  };

  const selectedId = pane.parent ?? pane.id;
  const showSidebar = !narrow || listOpen;
  const showMain = !narrow || !listOpen;

  /**
   * Renders one sidebar entry: the pane's icon and name as a button that opens it.
   *
   * The button carries `data-pane` for keyboard navigation and `aria-current="page"` when
   * selected.
   *
   * @param {PaneDef} p - Pane to render.
   * @param {boolean} selected - Whether the entry is highlighted as the current pane.
   * @returns {JSX.Element} The sidebar button.
   *
   * @example
   * {group.map((p) => item(p, p.id === selectedId))}
   */
  const item = (p: PaneDef, selected: boolean) => (
    <button
      key={p.id}
      type="button"
      data-pane={p.id}
      className={`${styles.item} ${selected ? styles.selected : ''}`}
      aria-current={selected ? 'page' : undefined}
      onClick={() => go(p.id)}
    >
      <PaneIcon icon={p.icon} color={p.color} size={22} />
      <span className={styles.itemLabel}>{t(p.name)}</span>
    </button>
  );

  return (
    <NavContext.Provider value={nav}>
      <PaneArgsListener onPane={go} />
      <div ref={rootRef} className={`${styles.root} ${focused ? styles.focused : ''} ${narrow ? styles.narrow : ''}`}>
        {showSidebar && (
          <aside className={`ui-sidebar ${styles.sidebar}`}>
            <div className={styles.sidebarTop} data-drag-region />
            <div ref={searchRef} className={styles.search}>
              <SearchField value={query} onChange={setQuery} placeholder={t(S.search)} onKeyDown={onSearchKeyDown} />
            </div>
            <nav ref={listRef} className={styles.list} aria-label={t(S.panes)} onKeyDown={onListKeyDown}>
              {results ? (
                results.length ? (
                  <div className={styles.group}>{results.map((p) => item(p, p.id === pane.id))}</div>
                ) : (
                  <div className={styles.noResults}>{t(S.noResults)}</div>
                )
              ) : (
                <>
                  <button type="button" className={styles.userCard} onClick={() => go('users')}>
                    <UserAvatar src={avatar} name={fullName} size={34} />
                    <span className={styles.userText}>
                      <span className={styles.userName}>{fullName}</span>
                      <span className={styles.userSub}>{fmt(t(S.account), { os: osInfo.name })}</span>
                    </span>
                  </button>
                  {SIDEBAR_GROUPS.map((group, i) => (
                    <div key={i} className={styles.group}>
                      {group.map((p) => item(p, p.id === selectedId))}
                    </div>
                  ))}
                </>
              )}
            </nav>
          </aside>
        )}

        {showMain && (
          <main className={styles.main}>
            <header className={`${styles.toolbar} ${scrolled ? styles.toolbarScrolled : ''}`} data-drag-region>
              {narrow && (
                <GlassGroup className={styles.navGroup}>
                  <IconButton label={t(S.showAll)} onClick={() => setListOpen(true)}>
                    <LayoutGrid size={15} />
                  </IconButton>
                </GlassGroup>
              )}
              <GlassGroup className={styles.navGroup}>
                <IconButton label={t(S.back)} disabled={!canBack} onClick={() => dispatch({ type: 'back' })}>
                  <ChevronLeft size={18} strokeWidth={2.2} />
                </IconButton>
                <IconButton label={t(S.forward)} disabled={!canForward} onClick={() => dispatch({ type: 'forward' })}>
                  <ChevronRight size={18} strokeWidth={2.2} />
                </IconButton>
              </GlassGroup>
              <h1 className={`ui-toolbar-title ${styles.title}`} data-drag-region>
                {t(pane.name)}
              </h1>
            </header>
            <div
              ref={contentRef}
              className={styles.content}
              onScroll={(e) => {
                const isScrolled = e.currentTarget.scrollTop > 2;
                if (isScrolled !== scrolled) setScrolled(isScrolled);
              }}
            >
              <div key={pane.id} className={styles.contentInner}>
                <pane.component />
              </div>
            </div>
          </main>
        )}

        <div ref={setSheetHost} className={styles.sheetHost} />
      </div>
    </NavContext.Provider>
  );
}

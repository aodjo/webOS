/**
 * Safari's smart search field: shows the domain while idle and the full URL while editing,
 * offers Top Hits from favorites and history, and draws the page-load progress bar.
 */
import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FileText, Globe, Lock, RotateCw, Search, X } from 'lucide-react';
import { fmt, useLocale, useT } from '@/kernel';
import type { Bookmark, HistoryEntry } from './store';
import type { TabStatus } from './tabs';
import { S, titleFor } from './strings';
import { START_URL, displayHost, isSecure, kindOfURL, letterIcon, parseInput, searchQueryOf, searchURL } from './url';
import styles from './Safari.module.css';

/** Imperative handle exposed by `<AddressBar ref>`. */
export interface AddressBarHandle {
  /** Focuses the field and selects its whole text. */
  focus: () => void;
}

/** Props of the address bar. */
interface Props {
  /** URL of the active tab's current page. */
  url: string;
  /** Load status of the active tab, which drives the progress bar and the Reload/Stop button. */
  status: TabStatus;
  /** Navigation counter of the active tab; a new value restarts the progress bar. */
  nav: number;
  /** Id of the active tab; switching tabs restarts the progress bar. */
  tabId: string;
  /** Bookmarks searched for Top Hits (before history). */
  favorites: Bookmark[];
  /** Browsing history searched for Top Hits. */
  history: HistoryEntry[];
  /** Called with the resolved URL when the user submits the field or picks a suggestion. */
  onSubmit: (url: string) => void;
  /** Reloads the active tab. */
  onReload: () => void;
  /** Stops loading the active tab. */
  onStop: () => void;
}

/** One row of the Top Hits popover. */
interface Suggestion {
  /** React key of the row. */
  key: string;
  /** URL opened when the row is chosen. */
  url: string;
  /** Main label of the row. */
  title: string;
  /** Secondary label (host or URL) shown on the right. */
  subtitle?: string;
  /** Icon kind: a search glass, a globe, or the site's letter tile. */
  icon: 'search' | 'globe' | 'site';
}

/**
 * Page-load progress bar drawn along the bottom of the field's glass capsule.
 *
 * The bar only appears when the component mounts while the tab is loading, i.e. for
 * navigations that load an iframe; internal pages that are loaded immediately render nothing.
 * The parent keys it by tab id and navigation counter, so every navigation remounts it and
 * re-evaluates this. After mounting, the `data-state` attribute follows `status` and the CSS
 * animates the bar (growing while loading, filling and fading out once loaded).
 *
 * @param {Object} props - Component props.
 * @param {TabStatus} props.status - Current load status of the tab.
 * @returns {JSX.Element | null} The progress bar, or null when the navigation did not start loading.
 *
 * @example
 * <Progress key={`${tabId}:${nav}`} status="loading" />
 */
function Progress({ status }: { status: TabStatus }) {
  const [started] = useState(status === 'loading');
  if (!started) return null;
  return <div className={styles.progress} data-state={status} aria-hidden />;
}

/**
 * Safari's smart search field (address bar) with Top Hits suggestions.
 *
 * While idle the input is empty and an overlay shows a compact label: the host (with a lock
 * for https), the query of a Google search URL, or the page title for internal and file URLs.
 * Focusing fills the input with the editable URL (empty on the Start Page, the bare query for
 * search URLs) and selects it on the next frame. Once the user types, a listbox offers a
 * primary "Search Google" / "Go to site" row followed by the favorites and then the history
 * entries whose title or URL contains the text (deduplicated by URL, at most 7 rows). Arrow keys move the
 * highlight, Enter submits the highlighted row or the parsed input, and Escape first restores
 * the original URL and then blurs; keys pressed during IME composition are ignored. Mouse-down
 * on the popover and on the Reload/Stop button is prevented so the input keeps focus. The
 * parent can focus the field through the `AddressBarHandle` ref.
 *
 * @param {Props} props - Component props.
 * @param {string} props.url - URL of the active tab's current page.
 * @param {TabStatus} props.status - Load status of the active tab.
 * @param {number} props.nav - Navigation counter of the active tab.
 * @param {string} props.tabId - Id of the active tab.
 * @param {Bookmark[]} props.favorites - Bookmarks searched for suggestions.
 * @param {HistoryEntry[]} props.history - History entries searched for suggestions.
 * @param {(url: string) => void} props.onSubmit - Called with the URL to open.
 * @param {() => void} props.onReload - Reloads the active tab.
 * @param {() => void} props.onStop - Stops loading the active tab.
 * @param {React.ForwardedRef<AddressBarHandle>} ref - Receives the `focus()` handle.
 * @returns {JSX.Element} The search field with its idle label, Reload/Stop button and suggestions.
 *
 * @example
 * const address = useRef<AddressBarHandle>(null);
 * <AddressBar ref={address} url={url} status="loaded" nav={0} tabId="tab1" favorites={[]} history={[]}
 *   onSubmit={navigate} onReload={reload} onStop={stop} />
 */
export const AddressBar = forwardRef<AddressBarHandle, Props>(function AddressBar({ url, status, nav, tabId, favorites, history, onSubmit, onReload, onStop }, ref) {
  const t = useT();
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [typed, setTyped] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const editableURL = url === START_URL ? '' : searchQueryOf(url) ?? url;

  useImperativeHandle(ref, () => ({
    /**
     * Focuses the field and selects all of its text.
     *
     * Focusing triggers the input's focus handler, which loads the editable URL into the draft,
     * so the selection covers the full URL.
     *
     * @returns {void}
     *
     * @example
     * address.current?.focus();
     */
    focus: () => {
      input.current?.focus();
      input.current?.select();
    },
  }));

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = draft.trim();
    if (!focused || !typed || !q) return [];
    const target = parseInput(q);
    const out: Suggestion[] = [];
    if (target) {
      const isSearch = target === searchURL(q);
      out.push({ key: 'primary', url: target, title: fmt(t(isSearch ? S.searchGoogle : S.goTo), { q }), icon: isSearch ? 'search' : 'globe' });
    }
    const needle = q.toLowerCase();
    const seen = new Set(out.map((s) => s.url));
    const pool: Bookmark[] = [...favorites, ...history];
    for (const item of pool) {
      if (out.length >= 7) break;
      if (seen.has(item.url)) continue;
      if (item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle)) {
        seen.add(item.url);
        out.push({ key: item.url, url: item.url, title: item.title, subtitle: kindOfURL(item.url) === 'web' ? displayHost(item.url) : item.url, icon: 'site' });
      }
    }
    return out;
  }, [draft, focused, typed, favorites, history, t]);

  /**
   * Opens a URL from the field and leaves editing mode.
   *
   * Passes a non-null target to `onSubmit`, then clears the typed flag (which hides the
   * suggestions) and blurs the input. A null target (unparseable or empty input) only blurs.
   *
   * @param {string | null} target - URL to open, or null to just close the field.
   * @returns {void}
   *
   * @example
   * submit(parseInput('example.com'));
   */
  const submit = (target: string | null) => {
    if (target) onSubmit(target);
    setTyped(false);
    input.current?.blur();
  };

  /**
   * Keyboard handling for the search field.
   *
   * Ignores keys that belong to an IME composition (`isComposing` or keyCode 229). ArrowDown and
   * ArrowUp cycle the highlighted suggestion (wrapping around). Enter submits the highlighted
   * suggestion, or else the draft parsed with `parseInput`. Escape restores the page URL and
   * reselects it if the user has typed something different; otherwise it blurs the field.
   *
   * @param {KeyboardEvent<HTMLInputElement>} e - The React keyboard event.
   * @returns {void}
   *
   * @example
   * <input onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit(highlight >= 0 && suggestions[highlight] ? suggestions[highlight].url : parseInput(draft));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (typed && draft !== editableURL) {
        setDraft(editableURL);
        setTyped(false);
        requestAnimationFrame(() => input.current?.select());
      } else input.current?.blur();
    }
  };

  const kind = kindOfURL(url);
  const query = searchQueryOf(url);
  let idleText: string;
  if (url === START_URL) idleText = '';
  else if (kind === 'web') idleText = query ?? (displayHost(url) || url);
  else idleText = titleFor(url, locale);
  const loading = status === 'loading';

  return (
    <div className={`${styles.field} ${focused ? styles.fieldFocused : ''}`}>
      {/* The glass capsule is its own layer (not the field itself): a backdrop-filter on the
          field would become the backdrop root of the Top Hits popover and stop it blurring the page. */}
      <div className={`lg lg-control lg-capsule ${styles.fieldGlass}`} aria-hidden>
        <Progress key={`${tabId}:${nav}`} status={status} />
      </div>
      <input
        ref={input}
        className={styles.fieldInput}
        value={focused ? draft : ''}
        placeholder={focused || !idleText ? t(S.searchPlaceholder) : ''}
        aria-label={t(S.searchPlaceholder)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={suggestions.length > 0 ? listId : undefined}
        aria-activedescendant={highlight >= 0 && suggestions[highlight] ? `${listId}-${highlight}` : undefined}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onFocus={(e) => {
          setDraft(editableURL);
          setFocused(true);
          setTyped(false);
          setHighlight(-1);
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onBlur={() => {
          setFocused(false);
          setTyped(false);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setTyped(true);
          setHighlight(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {!focused && idleText && (
        <div className={styles.fieldIdle} aria-hidden>
          {kind === 'web' && !query && isSecure(url) && <Lock size={10} strokeWidth={2.4} />}
          {kind === 'web' && query && <Search size={11} strokeWidth={2.2} />}
          {kind === 'file' && <FileText size={11} />}
          <span>{idleText}</span>
        </div>
      )}
      {!focused && url !== START_URL && (
        <button
          type="button"
          className={styles.fieldBtn}
          aria-label={t(loading ? S.stop : S.reload)}
          title={t(loading ? S.stop : S.reload)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={loading ? onStop : onReload}
        >
          {loading ? <X size={13} /> : <RotateCw size={12} />}
        </button>
      )}
      {suggestions.length > 0 && (
        <div id={listId} className={`lg lg-thick lg-float ${styles.suggest}`} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {suggestions.length > 1 && <div className={styles.suggestHeader}>{t(S.topHits)}</div>}
          {suggestions.map((s, i) => {
            const li = letterIcon(s.title, s.url);
            return (
              <div
                key={s.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                className={`${styles.suggestRow} ${i === highlight ? styles.suggestActive : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => submit(s.url)}
              >
                <span className={styles.suggestIcon} style={s.icon === 'site' ? { background: li.color } : undefined}>
                  {s.icon === 'search' ? <Search size={12} /> : s.icon === 'globe' ? <Globe size={12} /> : li.letter}
                </span>
                <span className={styles.suggestTitle}>{s.title}</span>
                {s.subtitle && <span className={styles.suggestSub}>{s.subtitle}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

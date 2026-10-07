/**
 * Safari's persistent state shared by every Safari window: browsing history, user bookmarks
 * and the Reading List (localStorage 'webos.safari').
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { owner, projects } from '@/data/portfolio';
import { tr, type Locale } from '@/kernel';
import { PORTFOLIO_URL, kindOfURL } from './url';

/** One visit in the browsing history. */
export interface HistoryEntry {
  url: string;
  title: string;
  /** Visit time (ms since epoch); also identifies the entry. */
  ts: number;
}

/** A saved page (user bookmark / favorite). */
export interface Bookmark {
  url: string;
  title: string;
}

/** A page saved to the Reading List. */
export interface ReadingItem extends Bookmark {
  /** Time it was added (ms since epoch). */
  addedAt: number;
  /** Whether the item has been opened from the Reading List. */
  read: boolean;
}

/** Shape of the Safari store: persisted lists plus the actions that edit them. */
interface SafariState {
  /** Visits, newest first. */
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  /** Reading List items, newest first. */
  readingList: ReadingItem[];
  addVisit: (url: string, title: string) => void;
  clearHistory: () => void;
  removeVisit: (ts: number) => void;
  addBookmark: (b: Bookmark) => void;
  removeBookmark: (url: string) => void;
  addToReadingList: (b: Bookmark) => void;
  removeFromReadingList: (url: string) => void;
  markRead: (url: string) => void;
}

const MAX_HISTORY = 400; /** Maximum number of history entries kept; older visits are dropped. */

export const useSafari = create<SafariState>()(
  persist(
    (set) => ({
      history: [],
      bookmarks: [],
      readingList: [],
      /**
       * Records a visit at the top of the history.
       *
       * Blank tabs and the Start Page are not recorded. When the newest entry is the same URL
       * and is less than a minute old (a reload or a repeated navigation), that entry is updated
       * with the new title and time instead of adding another one. The history is capped at
       * `MAX_HISTORY` entries.
       *
       * @param {string} url - The visited URL.
       * @param {string} title - The page title at the time of the visit.
       * @returns {void}
       *
       * @example
       * useSafari.getState().addVisit('https://example.com/', 'example.com');
       */
      addVisit: (url, title) =>
        set((s) => {
          if (kindOfURL(url) === 'blank' || url === 'webos://start') return s;
          const last = s.history[0];
          if (last && last.url === url && Date.now() - last.ts < 60_000) return { history: [{ ...last, title, ts: Date.now() }, ...s.history.slice(1)] };
          return { history: [{ url, title, ts: Date.now() }, ...s.history].slice(0, MAX_HISTORY) };
        }),
      /**
       * Removes every history entry.
       *
       * Frequently Visited sites are derived from the history, so they are cleared as well.
       *
       * @returns {void}
       *
       * @example
       * useSafari.getState().clearHistory();
       */
      clearHistory: () => set({ history: [] }),
      /**
       * Removes a single visit from the history.
       *
       * Visits are identified by their timestamp, so only the entry whose `ts` equals the given
       * value is dropped; other visits to the same URL stay.
       *
       * @param {number} ts - Timestamp identifying the visit.
       * @returns {void}
       *
       * @example
       * useSafari.getState().removeVisit(entry.ts);
       */
      removeVisit: (ts) => set((s) => ({ history: s.history.filter((h) => h.ts !== ts) })),
      /**
       * Appends a bookmark, unless one with the same URL already exists.
       *
       * New bookmarks go to the end of the list, so they appear after the built-in favorites in
       * creation order. When the URL is already bookmarked the state is left untouched.
       *
       * @param {Bookmark} b - The page to bookmark.
       * @returns {void}
       *
       * @example
       * useSafari.getState().addBookmark({ url: 'https://example.com/', title: 'Example' });
       */
      addBookmark: (b) => set((s) => (s.bookmarks.some((x) => x.url === b.url) ? s : { bookmarks: [...s.bookmarks, b] })),
      /**
       * Removes the bookmark with the given URL.
       *
       * Filters the bookmark list by URL; built-in favorites are not stored here and are
       * unaffected. Unknown URLs leave the list as it is.
       *
       * @param {string} url - URL of the bookmark to remove.
       * @returns {void}
       *
       * @example
       * useSafari.getState().removeBookmark('https://example.com/');
       */
      removeBookmark: (url) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.url !== url) })),
      /**
       * Adds a page to the top of the Reading List as unread.
       *
       * Does nothing when the URL is already in the list.
       *
       * @param {Bookmark} b - The page to save.
       * @returns {void}
       *
       * @example
       * useSafari.getState().addToReadingList({ url: 'https://example.com/', title: 'Example' });
       */
      addToReadingList: (b) => set((s) => (s.readingList.some((x) => x.url === b.url) ? s : { readingList: [{ ...b, addedAt: Date.now(), read: false }, ...s.readingList] })),
      /**
       * Removes the Reading List item with the given URL.
       *
       * Filters the Reading List by URL, whether the item was read or not. Unknown URLs leave
       * the list as it is.
       *
       * @param {string} url - URL of the item to remove.
       * @returns {void}
       *
       * @example
       * useSafari.getState().removeFromReadingList('https://example.com/');
       */
      removeFromReadingList: (url) => set((s) => ({ readingList: s.readingList.filter((r) => r.url !== url) })),
      /**
       * Marks the Reading List item with the given URL as read.
       *
       * Sets `read: true` on the matching item, which hides its unread dot on the Start Page.
       * The item keeps its position in the list; unknown URLs change nothing.
       *
       * @param {string} url - URL of the item.
       * @returns {void}
       *
       * @example
       * useSafari.getState().markRead('https://example.com/');
       */
      markRead: (url) => set((s) => ({ readingList: s.readingList.map((r) => (r.url === url ? { ...r, read: true } : r)) })),
    }),
    {
      name: 'webos.safari',
      version: 1,
      /**
       * Selects the part of the state written to localStorage.
       *
       * Only the three lists are persisted; the action functions are not.
       *
       * @param {SafariState} s - The full store state.
       * @returns {Pick<SafariState, 'history' | 'bookmarks' | 'readingList'>} The persisted slice.
       *
       * @example
       * const { partialize } = useSafari.persist.getOptions();
       * partialize?.(useSafari.getState()); // { history, bookmarks, readingList }
       */
      partialize: (s) => ({ history: s.history, bookmarks: s.bookmarks, readingList: s.readingList }),
    },
  ),
); /** Zustand store with Safari's history, bookmarks and Reading List, persisted to localStorage under 'webos.safari'. */

/* ───────────────────────── Favorites ───────────────────────── */

/** A tile on the Start Page's Favorites grid. */
export interface Favorite extends Bookmark {
  /** Built-in favorites can't be removed. */
  builtin?: boolean;
}

/**
 * Builds the Start Page favorites.
 *
 * The built-in favorites come first, in order: the portfolio page, the owner's GitHub,
 * LinkedIn, blog and website links, each project's demo and GitHub links, then a few sites
 * that render well in a frame (a mobile Wikipedia matching the locale, example.com and a
 * frameable Google homepage). Empty links are skipped and URLs are de-duplicated. The user's
 * bookmarks follow, minus any URL already present.
 *
 * @param {Locale} locale - Locale used for the localized favorite titles.
 * @param {Bookmark[]} bookmarks - The user's bookmarks.
 * @returns {Favorite[]} Built-in favorites (`builtin: true`) followed by user bookmarks.
 *
 * @example
 * const favorites = useMemo(() => buildFavorites(locale, bookmarks), [locale, bookmarks]);
 */
export function buildFavorites(locale: Locale, bookmarks: Bookmark[]): Favorite[] {
  const out: Favorite[] = [];
  /**
   * Appends a built-in favorite when its URL is set and not already in the list.
   *
   * Pushes `{ title, url, builtin: true }` onto the favorites being built. Owner and project
   * links that are left empty in the portfolio data are skipped, and a URL that was already
   * added keeps its first title.
   *
   * @param {string} title - Tile title.
   * @param {string | undefined} url - Target URL; empty or missing URLs are skipped.
   * @returns {void}
   *
   * @example
   * add('GitHub', owner.links.github);
   */
  const add = (title: string, url: string | undefined) => {
    if (url && !out.some((f) => f.url === url)) out.push({ title, url, builtin: true });
  };
  add(locale === 'ko' ? '포트폴리오' : 'Portfolio', PORTFOLIO_URL);
  add('GitHub', owner.links.github);
  add('LinkedIn', owner.links.linkedin);
  add(locale === 'ko' ? '블로그' : 'Blog', owner.links.blog);
  add(locale === 'ko' ? '웹사이트' : 'Website', owner.links.website);
  for (const p of projects) {
    add(p.name, p.links.demo);
    add(`${p.name} · GitHub`, p.links.github);
  }
  add(locale === 'ko' ? '위키백과' : 'Wikipedia', locale === 'ko' ? 'https://ko.m.wikipedia.org' : 'https://en.m.wikipedia.org');
  add('Example', 'https://example.com');
  add('Google', 'https://www.google.com/webhp?igu=1');
  for (const b of bookmarks) if (!out.some((f) => f.url === b.url)) out.push(b);
  return out;
}

/**
 * Lists the most visited pages for the Start Page's Frequently Visited section.
 *
 * Counts visits per URL, skipping URLs in `exclude` (the favorites) and internal `webos://`
 * pages. Pages are ordered by visit count, ties broken by the most recent visit, and each is
 * represented by its newest history entry.
 *
 * @param {HistoryEntry[]} history - Visits, newest first.
 * @param {Set<string>} exclude - URLs to leave out.
 * @param {number} [limit=8] - Maximum number of pages returned.
 * @returns {HistoryEntry[]} One entry per page, most visited first.
 *
 * @example
 * frequentlyVisited(history, new Set(favorites.map((f) => f.url)));
 */
export function frequentlyVisited(history: HistoryEntry[], exclude: Set<string>, limit = 8): HistoryEntry[] {
  const counts = new Map<string, { entry: HistoryEntry; n: number }>();
  for (const h of history) {
    if (exclude.has(h.url) || kindOfURL(h.url) === 'internal') continue;
    const c = counts.get(h.url);
    if (c) c.n++;
    else counts.set(h.url, { entry: h, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || b.entry.ts - a.entry.ts)
    .slice(0, limit)
    .map((c) => c.entry);
}

/**
 * Returns the owner's name in the given locale.
 *
 * Used to build internal page titles such as the portfolio page's tab title.
 *
 * @param {Locale} locale - Target locale.
 * @returns {string} The localized owner name.
 *
 * @example
 * const title = `${ownerName('en')} — Portfolio`;
 */
export const ownerName = (locale: Locale) => tr(owner.name, locale);

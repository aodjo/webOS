/**
 * Safari tab model: every tab owns a back/forward stack. A navigation bumps `nav`, which the
 * view uses as the iframe key so each navigation (or reload) is a fresh load.
 */
import { START_URL, isKnownBlocked, isSelf, kindOfURL } from './url';

/** Load state of a tab's current page; `timeout` marks a frame that did not report a load in time. */
export type TabStatus = 'loading' | 'loaded' | 'timeout';

/** One Safari tab and its navigation history. */
export interface Tab {
  id: string;
  /** Back/forward stack of visited URLs. */
  entries: string[];
  /** Position of the current page in `entries`. */
  index: number;
  /** Navigation counter, incremented on every load; used as the frame key and to ignore stale load events. */
  nav: number;
  status: TabStatus;
  /** Page zoom (1 = 100%). */
  zoom: number;
  /** The "some websites can't be displayed" hint was dismissed for this load. */
  hintDismissed: boolean;
}

/** All tabs of one Safari window. */
export interface TabsState {
  tabs: Tab[];
  activeId: string;
  /** Recently closed tabs (most recent last, at most 20) for "Reopen Last Closed Tab". */
  closed: { entries: string[]; index: number }[];
}

/** Actions handled by {@link tabsReducer}. */
export type TabsAction =
  | { type: 'new'; url?: string; background?: boolean; afterActive?: boolean }
  | { type: 'close'; id: string }
  | { type: 'select'; id: string }
  | { type: 'selectIndex'; index: number }
  | { type: 'cycle'; delta: number }
  | { type: 'navigate'; id: string; url: string }
  | { type: 'go'; id: string; delta: number }
  | { type: 'reload'; id: string }
  | { type: 'status'; id: string; nav: number; status: TabStatus }
  | { type: 'stop'; id: string }
  | { type: 'zoom'; id: string; zoom: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'reopen' }
  | { type: 'dismissHint'; id: string };

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]; /** Page zoom levels that Zoom In / Zoom Out step through. */

let counter = 0; /** Running counter used to generate unique tab ids. */

/**
 * Generates a unique tab id.
 *
 * Increments the module-level counter, so ids are unique for the lifetime of the page.
 *
 * @returns {string} An id such as `tab3`.
 *
 * @example
 * const id = newId(); // 'tab1'
 */
const newId = () => `tab${++counter}`;

/**
 * Returns the status a tab starts in when it loads a URL.
 *
 * Internal and blank pages are rendered by React, so they are `loaded` immediately. Web pages
 * known to block framing and pages of the OS itself are also rendered as React pages instead
 * of a frame, so they are `loaded` too. Every other page starts `loading` until its frame
 * reports a load.
 *
 * @param {string} url - The URL being loaded.
 * @returns {TabStatus} `'loaded'` or `'loading'`.
 *
 * @example
 * initialStatus('webos://start'); // 'loaded'
 * initialStatus('https://example.com/'); // 'loading'
 */
export function initialStatus(url: string): TabStatus {
  const kind = kindOfURL(url);
  if (kind === 'internal' || kind === 'blank') return 'loaded';
  if (kind === 'web' && (isKnownBlocked(url) || isSelf(url))) return 'loaded';
  return 'loading';
}

/**
 * Creates a new tab.
 *
 * Without `history` the tab has a single entry, `url`. With `history` (a reopened tab) its
 * back/forward stack and position are restored and `url` is ignored. The tab gets a fresh id,
 * `nav` 0, 100% zoom and the initial status of its current URL.
 *
 * @param {string} [url=START_URL] - URL of the tab's only entry.
 * @param {{ entries: string[]; index: number }} [history] - Back/forward stack to restore.
 * @returns {Tab} The new tab.
 *
 * @example
 * const tab = makeTab('https://example.com/');
 */
export function makeTab(url: string = START_URL, history?: { entries: string[]; index: number }): Tab {
  const entries = history?.entries ?? [url];
  const index = history?.index ?? 0;
  return { id: newId(), entries, index, nav: 0, status: initialStatus(entries[index]), zoom: 1, hintDismissed: false };
}

/**
 * Returns the URL a tab is currently showing.
 *
 * Reads the entry at `tab.index` in the tab's back/forward stack, so going back or forward
 * changes the result without altering the stack.
 *
 * @param {Tab} tab - The tab.
 * @returns {string} The entry at the tab's current index.
 *
 * @example
 * currentURL(makeTab('https://example.com/')); // 'https://example.com/'
 */
export const currentURL = (tab: Tab) => tab.entries[tab.index];

/**
 * Tells whether a tab has a page to go back to.
 *
 * True whenever the current position is past the first entry of the back/forward stack; the
 * toolbar's Back button and the History menu use it to enable going back.
 *
 * @param {Tab} tab - The tab.
 * @returns {boolean} `true` when the current entry is not the first one.
 *
 * @example
 * canGoBack(makeTab()); // false
 */
export const canGoBack = (tab: Tab) => tab.index > 0;

/**
 * Tells whether a tab has a page to go forward to.
 *
 * True whenever entries follow the current position in the back/forward stack. A new
 * navigation drops those entries, so it becomes false after navigating from a past page.
 *
 * @param {Tab} tab - The tab.
 * @returns {boolean} `true` when the current entry is not the last one.
 *
 * @example
 * canGoForward(makeTab()); // false
 */
export const canGoForward = (tab: Tab) => tab.index < tab.entries.length - 1;

/**
 * Creates the initial tab state of a Safari window.
 *
 * The state holds a single active tab (showing `url`, or the Start Page when omitted) and an
 * empty closed-tabs list.
 *
 * @param {string} [url] - URL of the first tab; defaults to the Start Page.
 * @returns {TabsState} The initial state.
 *
 * @example
 * const [state, dispatch] = useReducer(tabsReducer, undefined, () => initTabs('https://example.com/'));
 */
export function initTabs(url?: string): TabsState {
  const tab = makeTab(url);
  return { tabs: [tab], activeId: tab.id, closed: [] };
}

/**
 * Replaces one tab in the state with an updated copy.
 *
 * Applies `fn` to the tab with the given id and leaves the others untouched. When no tab has
 * that id the tab list is copied unchanged.
 *
 * @param {TabsState} state - The current state.
 * @param {string} id - Id of the tab to update.
 * @param {(t: Tab) => Tab} fn - Returns the updated tab.
 * @returns {TabsState} The new state.
 *
 * @example
 * mapTab(state, id, (t) => ({ ...t, zoom: 1.25 }));
 */
function mapTab(state: TabsState, id: string, fn: (t: Tab) => Tab): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? fn(t) : t)) };
}

/**
 * Starts a new load in a tab.
 *
 * Sets the tab's history stack and position, increments `nav` so the view mounts a fresh frame
 * (and late load events of the previous navigation are ignored), resets the status for the new
 * URL and clears a dismissed "can't be displayed" hint.
 *
 * @param {Tab} t - The tab to load in.
 * @param {string[]} entries - The tab's back/forward stack after the navigation.
 * @param {number} index - Position of the page to show in `entries`.
 * @returns {Tab} The updated tab.
 *
 * @example
 * load(tab, tab.entries, tab.index); // reload
 */
function load(t: Tab, entries: string[], index: number): Tab {
  return { ...t, entries, index, nav: t.nav + 1, status: initialStatus(entries[index]), hintDismissed: false };
}

/**
 * Reduces a Safari window's tab state.
 *
 * - `new` opens a tab at the end (or right after the active tab with `afterActive`) and
 *   activates it unless `background` is set.
 * - `close` removes a tab and remembers its history (the 20 most recent closed tabs are kept).
 *   When the active tab closes, the tab to its right is activated, or the one to its left when
 *   it was the last tab. The last remaining tab is never closed; the state is returned
 *   unchanged so the caller can close the window instead.
 * - `select` activates a tab by id; `selectIndex` by position, where index 8 or higher (⌘9)
 *   always selects the last tab; `cycle` moves the selection by `delta`, wrapping around.
 * - `navigate` drops the forward history and appends the URL; `go` moves through the history
 *   by `delta`, clamped to its ends (a no-op when the position does not change); `reload`
 *   reloads the current entry.
 * - `status` applies a load status only when its `nav` matches the tab's current navigation;
 *   `stop` marks a loading tab as loaded.
 * - `zoom` sets the page zoom; `move` reorders tabs (out-of-range indices are ignored);
 *   `reopen` restores the most recently closed tab and activates it; `dismissHint` hides the
 *   "can't be displayed" hint for the current load.
 *
 * Unknown tab ids leave the state effectively unchanged.
 *
 * @param {TabsState} state - The current state.
 * @param {TabsAction} action - The action to apply.
 * @returns {TabsState} The next state; `close`, `select`, `selectIndex`, `move` and `reopen`
 *   return `state` itself when they change nothing.
 *
 * @example
 * let s = initTabs();
 * s = tabsReducer(s, { type: 'navigate', id: s.activeId, url: 'https://example.com/' });
 * s = tabsReducer(s, { type: 'go', id: s.activeId, delta: -1 });
 */
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'new': {
      const tab = makeTab(action.url);
      const at = action.afterActive ? state.tabs.findIndex((t) => t.id === state.activeId) + 1 : state.tabs.length;
      const tabs = [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)];
      return { ...state, tabs, activeId: action.background ? state.activeId : tab.id };
    }
    case 'close': {
      const i = state.tabs.findIndex((t) => t.id === action.id);
      if (i === -1 || state.tabs.length === 1) return state;
      const closedTab = state.tabs[i];
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const activeId = state.activeId === action.id ? tabs[Math.min(i, tabs.length - 1)].id : state.activeId;
      return { tabs, activeId, closed: [...state.closed, { entries: closedTab.entries, index: closedTab.index }].slice(-20) };
    }
    case 'select':
      return state.tabs.some((t) => t.id === action.id) ? { ...state, activeId: action.id } : state;
    case 'selectIndex': {
      const i = action.index >= 8 ? state.tabs.length - 1 : action.index;
      const tab = state.tabs[i];
      return tab ? { ...state, activeId: tab.id } : state;
    }
    case 'cycle': {
      const i = state.tabs.findIndex((t) => t.id === state.activeId);
      const n = state.tabs.length;
      return { ...state, activeId: state.tabs[(((i + action.delta) % n) + n) % n].id };
    }
    case 'navigate':
      return mapTab(state, action.id, (t) => {
        const entries = [...t.entries.slice(0, t.index + 1), action.url];
        return load(t, entries, entries.length - 1);
      });
    case 'go':
      return mapTab(state, action.id, (t) => {
        const index = Math.max(0, Math.min(t.entries.length - 1, t.index + action.delta));
        return index === t.index ? t : load(t, t.entries, index);
      });
    case 'reload':
      return mapTab(state, action.id, (t) => load(t, t.entries, t.index));
    case 'status':
      return mapTab(state, action.id, (t) => (t.nav === action.nav && t.status !== action.status ? { ...t, status: action.status } : t));
    case 'stop':
      return mapTab(state, action.id, (t) => (t.status === 'loading' ? { ...t, status: 'loaded' } : t));
    case 'zoom':
      return mapTab(state, action.id, (t) => ({ ...t, zoom: action.zoom }));
    case 'move': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= state.tabs.length || to >= state.tabs.length) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...state, tabs };
    }
    case 'reopen': {
      const last = state.closed[state.closed.length - 1];
      if (!last) return state;
      const tab = makeTab(undefined, last);
      return { tabs: [...state.tabs, tab], activeId: tab.id, closed: state.closed.slice(0, -1) };
    }
    case 'dismissHint':
      return mapTab(state, action.id, (t) => ({ ...t, hintDismissed: true }));
  }
}

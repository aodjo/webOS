import { describe, expect, it } from 'vitest';
import { canGoBack, canGoForward, currentURL, initTabs, tabsReducer, type TabsState } from './tabs';
import { START_URL } from './url';

/**
 * Returns the active tab of a tab state.
 *
 * Asserts (with `!`) that the active id refers to an existing tab.
 *
 * @param {TabsState} s - The tab state.
 * @returns {Tab} The tab whose id is `s.activeId`.
 *
 * @example
 * expect(currentURL(active(s))).toBe(START_URL);
 */
const active = (s: TabsState) => s.tabs.find((t) => t.id === s.activeId)!;

describe('safari tabs', () => {
  it('keeps a back/forward stack per tab', () => {
    let s = initTabs();
    const id = s.activeId;
    s = tabsReducer(s, { type: 'navigate', id, url: 'https://example.com/' });
    s = tabsReducer(s, { type: 'navigate', id, url: 'https://example.com/a' });
    expect(currentURL(active(s))).toBe('https://example.com/a');
    s = tabsReducer(s, { type: 'go', id, delta: -1 });
    expect(currentURL(active(s))).toBe('https://example.com/');
    expect(canGoForward(active(s))).toBe(true);
    // A new navigation discards forward history.
    s = tabsReducer(s, { type: 'navigate', id, url: 'webos://history' });
    expect(active(s).entries).toEqual([START_URL, 'https://example.com/', 'webos://history']);
    expect(canGoForward(active(s))).toBe(false);
    s = tabsReducer(s, { type: 'go', id, delta: -5 });
    expect(currentURL(active(s))).toBe(START_URL);
    expect(canGoBack(active(s))).toBe(false);
  });

  it('tracks load status per navigation', () => {
    let s = initTabs('https://example.com/');
    const id = s.activeId;
    expect(active(s).status).toBe('loading');
    const nav = active(s).nav;
    s = tabsReducer(s, { type: 'reload', id });
    // A stale load event from the previous navigation is ignored.
    s = tabsReducer(s, { type: 'status', id, nav, status: 'loaded' });
    expect(active(s).status).toBe('loading');
    s = tabsReducer(s, { type: 'status', id, nav: active(s).nav, status: 'loaded' });
    expect(active(s).status).toBe('loaded');
    // Sites known to refuse framing are rendered without a frame, so they start as loaded.
    s = tabsReducer(s, { type: 'navigate', id, url: 'https://github.com/aodjo' });
    expect(active(s).status).toBe('loaded');
  });

  it('opens, closes, reorders and reopens tabs', () => {
    let s = initTabs();
    const first = s.activeId;
    s = tabsReducer(s, { type: 'new', url: 'https://example.com/' });
    s = tabsReducer(s, { type: 'new' });
    expect(s.tabs).toHaveLength(3);
    const third = s.activeId;
    s = tabsReducer(s, { type: 'close', id: third });
    expect(s.tabs).toHaveLength(2);
    expect(currentURL(active(s))).toBe('https://example.com/');
    s = tabsReducer(s, { type: 'move', from: 1, to: 0 });
    expect(s.tabs[1].id).toBe(first);
    s = tabsReducer(s, { type: 'reopen' });
    expect(s.tabs).toHaveLength(3);
    expect(s.closed).toHaveLength(0);
    s = tabsReducer(s, { type: 'selectIndex', index: 0 });
    expect(currentURL(active(s))).toBe('https://example.com/');
    s = tabsReducer(s, { type: 'selectIndex', index: 8 });
    expect(s.activeId).toBe(s.tabs[2].id);
    s = tabsReducer(s, { type: 'cycle', delta: 1 });
    expect(s.activeId).toBe(s.tabs[0].id);
    // The last tab can't be closed by the reducer (the window closes instead).
    const one = initTabs();
    expect(tabsReducer(one, { type: 'close', id: one.activeId })).toBe(one);
  });
});

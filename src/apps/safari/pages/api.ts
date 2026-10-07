import type { MenuItem } from '@/kernel';
import { S } from '../strings';

/** What internal (React-rendered) pages can ask the hosting Safari tab to do. */
export interface PageAPI {
  /** Id of the Safari window hosting the page. */
  windowId: string;
  /** Loads a URL in the hosting tab. */
  navigate: (url: string) => void;
  /** Opens a URL in a new tab, optionally without switching to it. */
  openTab: (url: string, background?: boolean) => void;
  /** Opens a URL in a new Safari window. */
  openWindow: (url: string) => void;
}

/**
 * Builds the standard context menu for a link on an internal page.
 *
 * The menu offers Open, Open in New Tab (in the background), Open in New Window and Copy Link.
 * Copy Link writes the URL to the host clipboard and silently ignores failures. When `extra`
 * items are given they are appended after a separator.
 *
 * @param {PageAPI} api - The hosting tab's page API.
 * @param {string} url - The link's URL.
 * @param {MenuItem[]} [extra=[]] - Additional items for the end of the menu.
 * @returns {MenuItem[]} The menu items, ready for `showContextMenu`.
 *
 * @example
 * showContextMenu(e, linkMenu(api, url, [{ label: S.removeFavorite, action: () => removeBookmark(url) }]));
 */
export function linkMenu(api: PageAPI, url: string, extra: MenuItem[] = []): MenuItem[] {
  return [
    { label: S.open, action: () => api.navigate(url) },
    { label: S.openNewTab, action: () => api.openTab(url, true) },
    { label: S.openNewWindow, action: () => api.openWindow(url) },
    { separator: true },
    { label: S.copyLink, action: () => void navigator.clipboard?.writeText(url).catch(() => {}) },
    ...(extra.length ? [{ separator: true }, ...extra] : []),
  ];
}

/**
 * Opens a URL in a real browser tab, outside the OS.
 *
 * Uses `window.open` with `noopener,noreferrer`, so the new tab gets no reference back to this
 * page.
 *
 * @param {string} url - The URL to open.
 * @returns {void}
 *
 * @example
 * openExternal('https://github.com/aodjo');
 */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Finder preferences shared by every Finder window and persisted in localStorage: per-folder
 * view mode & sort order (like macOS view settings), bar visibility, sidebar layout and the
 * Go ▸ Recent Folders list.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ViewMode, SortSpec } from './model';

/** Widths in pixels of the resizable list view columns. */
export interface ListWidths {
  date: number;
  size: number;
  kind: number;
  where: number;
}

/** Persisted Finder preferences. */
interface FinderPrefs {
  /** View mode per location. */
  views: Record<string, ViewMode>;
  /** Sort order per location. */
  sorts: Record<string, SortSpec>;
  showPathBar: boolean;
  showStatusBar: boolean;
  showSidebar: boolean;
  /** Sidebar width in pixels. */
  sidebarWidth: number;
  /** Collapsed sidebar sections by id. */
  collapsed: Record<string, boolean>;
  listWidths: ListWidths;
  /** Icon size in pixels for the icon view. */
  iconSize: number;
  /** Go ▸ Recent Folders, most recent first. */
  recentFolders: string[];
}

const DEFAULTS: FinderPrefs = {
  views: {},
  sorts: {},
  showPathBar: true,
  showStatusBar: true,
  showSidebar: true,
  sidebarWidth: 180,
  collapsed: {},
  listWidths: { date: 180, size: 84, kind: 150, where: 170 },
  iconSize: 64,
  recentFolders: [],
}; /** Preferences used before anything has been saved. */

const MAX_REMEMBERED = 200; /** Maximum number of locations remembered in the per-folder view and sort maps. */

/**
 * Sets a key in a per-folder map while keeping the map bounded.
 *
 * Deletes and re-inserts the key so it becomes the newest entry (object keys keep insertion
 * order), then drops the oldest entries beyond `MAX_REMEMBERED`. The input map is not modified.
 *
 * @template T
 * @param {Record<string, T>} map - The current map.
 * @param {string} key - Location key to set.
 * @param {T} value - Value to store.
 * @returns {Record<string, T>} A new map with the key set.
 *
 * @example
 * const views = bounded(s.views, '/Users/me', 'list');
 */
function bounded<T>(map: Record<string, T>, key: string, value: T): Record<string, T> {
  const next = { ...map };
  delete next[key];
  next[key] = value;
  const keys = Object.keys(next);
  if (keys.length > MAX_REMEMBERED) for (const k of keys.slice(0, keys.length - MAX_REMEMBERED)) delete next[k];
  return next;
}

export const useFinderPrefs = create<FinderPrefs>()(
  persist(() => DEFAULTS, {
    name: 'webos.finder',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    /**
     * Combines saved preferences with the current state on rehydration.
     *
     * Shallow-merges the persisted object over the current state, so fields missing from the
     * saved data keep their default values.
     *
     * @param {unknown} persisted - Preferences read from localStorage (may be undefined).
     * @param {FinderPrefs} current - The current store state.
     * @returns {FinderPrefs} The merged state.
     *
     * @example
     * merge({ iconSize: 96 }, DEFAULTS); // { ...DEFAULTS, iconSize: 96 }
     */
    merge: (persisted, current) => ({ ...current, ...(persisted as Partial<FinderPrefs> | undefined) }),
  }),
); /** Finder preferences store, persisted in localStorage under "webos.finder"; saved values are shallow-merged over the defaults. */

export const prefs = {
  /**
   * Updates any preferences.
   *
   * Shallow-merges the patch into the store; fields not in the patch keep their values and
   * the change is persisted to localStorage.
   *
   * @param {Partial<FinderPrefs>} patch - Fields to change.
   * @returns {void}
   *
   * @example
   * prefs.set({ showPathBar: false });
   */
  set(patch: Partial<FinderPrefs>) {
    useFinderPrefs.setState(patch);
  },
  /**
   * Remembers the view mode of a location.
   *
   * Stores the mode in the `views` map through `bounded`, so the location becomes the newest
   * entry and the oldest ones beyond `MAX_REMEMBERED` are dropped.
   *
   * @param {string} key - Location key.
   * @param {ViewMode} mode - View mode to store.
   * @returns {void}
   *
   * @example
   * prefs.setView(PATHS.documents, 'list');
   */
  setView(key: string, mode: ViewMode) {
    useFinderPrefs.setState((s) => ({ views: bounded(s.views, key, mode) }));
  },
  /**
   * Remembers the sort order of a location.
   *
   * Stores the sort in the `sorts` map through `bounded`, so the location becomes the newest
   * entry and the oldest ones beyond `MAX_REMEMBERED` are dropped.
   *
   * @param {string} key - Location key.
   * @param {SortSpec} spec - Sort order to store.
   * @returns {void}
   *
   * @example
   * prefs.setSort(PATHS.documents, { key: 'date', dir: 'desc' });
   */
  setSort(key: string, spec: SortSpec) {
    useFinderPrefs.setState((s) => ({ sorts: bounded(s.sorts, key, spec) }));
  },
  /**
   * Stores the width of a list view column.
   *
   * Rounds the width to whole pixels and replaces only that column's entry in `listWidths`.
   *
   * @param {keyof ListWidths} col - Column to resize.
   * @param {number} width - New width in pixels.
   * @returns {void}
   *
   * @example
   * prefs.setListWidth('kind', 162.4);
   */
  setListWidth(col: keyof ListWidths, width: number) {
    useFinderPrefs.setState((s) => ({ listWidths: { ...s.listWidths, [col]: Math.round(width) } }));
  },
  /**
   * Collapses or expands a sidebar section.
   *
   * Flips the section's flag in `collapsed`; a section without an entry counts as expanded,
   * so the first toggle collapses it.
   *
   * @param {string} id - Section id.
   * @returns {void}
   *
   * @example
   * prefs.toggleSection('tags');
   */
  toggleSection(id: string) {
    useFinderPrefs.setState((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }));
  },
  /**
   * Records a visited folder for Go ▸ Recent Folders.
   *
   * Moves the folder to the front without duplicates and keeps the 10 most recent. Leaves the
   * state untouched when the folder is already first.
   *
   * @param {string} path - Folder that was opened.
   * @returns {void}
   *
   * @example
   * prefs.pushRecentFolder(PATHS.downloads);
   */
  pushRecentFolder(path: string) {
    useFinderPrefs.setState((s) => (s.recentFolders[0] === path ? s : { recentFolders: [path, ...s.recentFolders.filter((p) => p !== path)].slice(0, 10) }));
  },
  /**
   * Empties Go ▸ Recent Folders (Clear Menu).
   *
   * Replaces `recentFolders` with an empty list; other preferences are unchanged.
   *
   * @returns {void}
   *
   * @example
   * prefs.clearRecentFolders();
   */
  clearRecentFolders() {
    useFinderPrefs.setState({ recentFolders: [] });
  },
}; /** Actions that update the Finder preferences store. */

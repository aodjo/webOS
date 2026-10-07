/**
 * Save and Open panels (NSSavePanel / NSOpenPanel look-alikes) backed by the virtual FS.
 *
 *  - Save: compact form (name, tags, "Where" popup) that expands into a mini browser with a
 *    sidebar, folder navigation and "New Folder". Asks before replacing an existing file.
 *  - Open: sidebar + toolbar (back/forward, folder popup, search) + sortable list. Files that do
 *    not match the requested extensions are greyed out.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { AppWindow, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, CircleArrowDown, Clock, FileText, Folder, HardDrive, House, Monitor } from 'lucide-react';
import {
  COMMON,
  FSError,
  HOME,
  PATHS,
  USER,
  basename,
  dirname,
  extname,
  fileSizeOf,
  formatBytes,
  fs,
  isWithin,
  join,
  normalize,
  showContextMenu,
  stem,
  useFS,
  useLocale,
  useNode,
  useSystem,
  useT,
  type FSNode,
  type Locale,
  type LString,
  type MenuItem,
  type OpenPanelRequest,
  type SavePanelRequest,
} from '@/kernel';
import { Button, IconButton, SearchField, SidebarItem, SidebarSection, TextField } from '@/components/ui';
import { FileIcon } from '@/icons';
import { osInfo } from '@/data/portfolio';
import { AlertBody, AlertIcon, InnerAlert, PanelShell, isModKey, isPlainKey, useFinish, type DialogMode } from './DialogParts';
import styles from './FilePanel.module.css';

const S = {
  saveAs: { en: 'Save As:', ko: '별도 저장:' },
  tags: { en: 'Tags:', ko: '태그:' },
  where: { en: 'Where:', ko: '위치:' },
  favorites: { en: 'Favorites', ko: '즐겨찾기' },
  locations: { en: 'Locations', ko: '위치' },
  recents: { en: 'Recents', ko: '최근 항목' },
  recentPlaces: { en: 'Recent Places', ko: '최근 위치' },
  sidebar: { en: 'Sidebar', ko: '사이드바' },
  back: { en: 'Back', ko: '뒤로' },
  forward: { en: 'Forward', ko: '앞으로' },
  location: { en: 'Location', ko: '위치' },
  showMore: { en: 'Show more options', ko: '옵션 더 보기' },
  showLess: { en: 'Show fewer options', ko: '옵션 숨기기' },
  name: { en: 'Name', ko: '이름' },
  dateModified: { en: 'Date Modified', ko: '수정일' },
  size: { en: 'Size', ko: '크기' },
  files: { en: 'Files', ko: '파일' },
  noResults: { en: 'No Results', ko: '결과 없음' },
  choose: { en: 'Choose', ko: '선택' },
  create: { en: 'Create', ko: '생성' },
  replace: { en: 'Replace', ko: '대치' },
  newFolderTitle: { en: 'New Folder', ko: '새로운 폴더' },
  newFolderMessage: { en: 'Name of new folder:', ko: '새로운 폴더의 이름:' },
  dotNameTitle: { en: 'You can’t use a name that begins with a dot “.”', ko: '마침표(“.”)로 시작하는 이름은 사용할 수 없습니다.' },
  dotNameMessage: { en: 'These names are reserved for the system. Please choose another name.', ko: '이러한 이름은 시스템용으로 예약되어 있습니다. 다른 이름을 선택하십시오.' },
  savePanel: { en: 'Save', ko: '저장' },
  openPanel: { en: 'Open', ko: '열기' },
  today: { en: 'Today at {t}', ko: '오늘 {t}' },
  yesterday: { en: 'Yesterday at {t}', ko: '어제 {t}' },
  dateAt: { en: '{d} at {t}', ko: '{d} {t}' },
  desktop: { en: 'Desktop', ko: '데스크탑' },
  documents: { en: 'Documents', ko: '문서' },
  downloads: { en: 'Downloads', ko: '다운로드' },
  pictures: { en: 'Pictures', ko: '사진' },
  music: { en: 'Music', ko: '음악' },
  movies: { en: 'Movies', ko: '동영상' },
  public: { en: 'Public', ko: '공개' },
  applications: { en: 'Applications', ko: '응용 프로그램' },
  trash: { en: 'Trash', ko: '휴지통' },
  users: { en: 'Users', ko: '사용자' },
} satisfies Record<string, LString>; /** Localized strings of both panels; the dot-name texts use the same wording as the kernel's Finder rename error. */

/**
 * Fills `{key}` placeholders in a localized template.
 *
 * Resolves the template for the given locale (plain strings are used as they are) and replaces
 * every `{key}` token with the matching entry of `vars`; unknown keys become an empty string.
 *
 * @param {LString} s - Localized template containing `{key}` placeholders.
 * @param {Locale} locale - Locale whose variant of the template is used.
 * @param {Record<string, string>} vars - Values substituted for the placeholders.
 * @returns {string} The resolved, filled-in string.
 *
 * @example
 * tpl(S.today, 'en', { t: '9:41 AM' }); // 'Today at 9:41 AM'
 */
const tpl = (s: LString, locale: Locale, vars: Record<string, string>) => (typeof s === 'string' ? s : s[locale]).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/* ───────────────────────── Locations ───────────────────────── */

const RECENTS = 'recents:'; /** Virtual "Recents" location; it is not an absolute path, so it never collides with a real folder. */
type Loc = string;

const DISK_NAME = `${osInfo.name} HD`; /** Display name of the root volume, e.g. "webOS HD". */

const KNOWN: Record<string, LString> = {
  [PATHS.desktop]: S.desktop,
  [PATHS.documents]: S.documents,
  [PATHS.downloads]: S.downloads,
  [PATHS.pictures]: S.pictures,
  [PATHS.music]: S.music,
  [`${HOME}/Movies`]: S.movies,
  [`${HOME}/Public`]: S.public,
  [PATHS.applications]: S.applications,
  [PATHS.trash]: S.trash,
  '/Users': S.users,
}; /** Localized display names of well-known folders, keyed by absolute path. */

type Translate = (s: LString | undefined | null) => string;

/**
 * Returns the Finder-style display name of a location.
 *
 * Recents and the root volume get fixed labels, the home folder shows the user name, well-known
 * folders are localized through `KNOWN`, and the ".app" extension of application bundles is
 * hidden. Any other path shows its basename.
 *
 * @param {string} path - Absolute path or the virtual `RECENTS` location.
 * @param {Translate} t - Translator returned by `useT()`.
 * @returns {string} The name shown in the sidebar, popups and file list.
 *
 * @example
 * displayName(PATHS.documents, t); // 'Documents'
 * displayName('/Applications/Notes.app', t); // 'Notes'
 */
function displayName(path: string, t: Translate): string {
  if (path === RECENTS) return t(S.recents);
  if (path === '/') return DISK_NAME;
  if (path === HOME) return USER;
  const known = KNOWN[path];
  if (known) return t(known);
  const name = basename(path);
  return extname(name) === 'app' ? stem(name) : name;
}

type IconC = ComponentType<{ size?: number; className?: string }>;

/**
 * Picks the sidebar and popup icon of a location.
 *
 * Recents, the root volume, Home, Desktop, Documents, Downloads and Applications get dedicated
 * icons; every other folder uses the generic folder icon.
 *
 * @param {Loc} loc - Absolute path or the virtual `RECENTS` location.
 * @returns {IconC} Icon component to render for the location.
 *
 * @example
 * const Icon = locationIcon(HOME);
 * <Icon size={15} />;
 */
function locationIcon(loc: Loc): IconC {
  switch (loc) {
    case RECENTS:
      return Clock;
    case '/':
      return HardDrive;
    case HOME:
      return House;
    case PATHS.desktop:
      return Monitor;
    case PATHS.documents:
      return FileText;
    case PATHS.downloads:
      return CircleArrowDown;
    case PATHS.applications:
      return AppWindow;
    default:
      return Folder;
  }
}

/**
 * Lists a location and all of its enclosing folders, innermost first.
 *
 * Walks up with `dirname` from the normalized path until it reaches the root "/". The virtual
 * Recents location has no parents and yields only itself.
 *
 * @param {Loc} loc - Absolute path or the virtual `RECENTS` location.
 * @returns {Loc[]} The location followed by its parents, ending with "/".
 *
 * @example
 * ancestors('/Users/guest/Documents'); // ['/Users/guest/Documents', '/Users/guest', '/Users', '/']
 */
function ancestors(loc: Loc): Loc[] {
  if (loc === RECENTS) return [RECENTS];
  const out: Loc[] = [];
  for (let p = normalize(loc); ; p = dirname(p)) {
    out.push(p);
    if (p === '/') break;
  }
  return out;
}

/**
 * Normalizes a requested starting folder if it exists.
 *
 * Missing paths and paths that are not directories are rejected so the caller can fall back to
 * a default folder.
 *
 * @param {string | undefined} p - Folder requested by the caller, possibly missing.
 * @returns {string | null} The normalized path when it is an existing directory, otherwise null.
 *
 * @example
 * const start = validDir(req.defaultDir) ?? PATHS.documents;
 */
const validDir = (p: string | undefined): string | null => (p && fs.isDir(p) ? normalize(p) : null);

const RECENT_KEY = 'webos.recentPlaces'; /** localStorage key of the recently used folders shared by every panel ("Recent Places"). */
const EXPANDED_KEY = 'webos.savePanel.expanded'; /** localStorage key remembering whether the Save panel was last left expanded. */

/**
 * Reads the "Recent Places" list from localStorage.
 *
 * Parses the stored JSON array and keeps only its string entries. Missing, malformed or
 * inaccessible storage yields an empty list instead of throwing.
 *
 * @returns {string[]} Recently used folder paths, most recent first.
 *
 * @example
 * const recent = loadRecentPlaces(); // ['/Users/guest/Desktop', ...]
 */
function loadRecentPlaces(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Records a folder as the most recently used place.
 *
 * Moves `dir` to the front of the stored list, removing any earlier occurrence, and keeps at
 * most five entries. Storage errors are ignored.
 *
 * @param {string} dir - Folder that was just saved into or opened from.
 * @returns {void}
 *
 * @example
 * rememberPlace(PATHS.documents);
 */
function rememberPlace(dir: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([dir, ...loadRecentPlaces().filter((d) => d !== dir)].slice(0, 5)));
  } catch {
    /* Storage unavailable: the folder is not remembered. */
  }
}

/**
 * Reads whether the Save panel should open in its expanded (browser) form.
 *
 * Returns false when nothing was stored or storage is unavailable.
 *
 * @returns {boolean} True when the panel was last left expanded.
 *
 * @example
 * const [expanded, setExpanded] = useState(loadExpanded);
 */
function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Persists the Save panel's expanded state for the next panel.
 *
 * Stores "1" or "0" in localStorage; storage errors are ignored.
 *
 * @param {boolean} v - Whether the panel is expanded.
 * @returns {void}
 *
 * @example
 * saveExpanded(true);
 */
function saveExpanded(v: boolean): void {
  try {
    localStorage.setItem(EXPANDED_KEY, v ? '1' : '0');
  } catch {
    /* Storage unavailable: the state is not remembered. */
  }
}

/* ───────────────────────── Navigation history ───────────────────────── */

/**
 * Back/forward navigation history of a panel's browser.
 *
 * Keeps a stack of visited locations and a cursor into it. Going to a new location drops the
 * forward entries, while going to the location already shown does nothing. Back and forward
 * only move the cursor and stop at either end of the stack.
 *
 * @param {Loc} initial - Location shown first.
 * @returns {{ loc: Loc; go: (next: Loc) => void; back: () => void; forward: () => void; canBack: boolean; canForward: boolean }}
 *   The current location, the navigation callbacks and whether back/forward are possible.
 *
 * @example
 * const hist = useHistory(PATHS.documents);
 * hist.go(PATHS.desktop);
 * hist.back(); // hist.loc is PATHS.documents again
 */
function useHistory(initial: Loc) {
  const [h, setH] = useState({ stack: [initial], i: 0 });
  /**
   * Navigates to a location, discarding the forward history.
   *
   * Does nothing when `next` is already the current entry.
   *
   * @param {Loc} next - Location to show.
   * @returns {void}
   *
   * @example
   * go(PATHS.downloads);
   */
  const go = useCallback((next: Loc) => setH((s) => (s.stack[s.i] === next ? s : { stack: [...s.stack.slice(0, s.i + 1), next], i: s.i + 1 })), []);
  /**
   * Moves one entry back in the history.
   *
   * Does nothing when the first entry is already shown.
   *
   * @returns {void}
   *
   * @example
   * back();
   */
  const back = useCallback(() => setH((s) => (s.i > 0 ? { ...s, i: s.i - 1 } : s)), []);
  /**
   * Moves one entry forward in the history.
   *
   * Does nothing when the newest entry is already shown.
   *
   * @returns {void}
   *
   * @example
   * forward();
   */
  const forward = useCallback(() => setH((s) => (s.i < s.stack.length - 1 ? { ...s, i: s.i + 1 } : s)), []);
  return { loc: h.stack[h.i], go, back, forward, canBack: h.i > 0, canForward: h.i < h.stack.length - 1 };
}

/**
 * Resolves the location a panel actually displays.
 *
 * Subscribes to the folder's node so the panel re-renders when it changes. When the folder is
 * deleted (or replaced by a file) while the panel is open, the home folder is shown instead.
 * The virtual Recents location is always valid.
 *
 * @param {Loc} loc - Location selected in the navigation history.
 * @returns {Loc} `loc` while it exists as a folder (or is Recents), otherwise `HOME`.
 *
 * @example
 * const loc = useLiveLocation(hist.loc);
 */
function useLiveLocation(loc: Loc): Loc {
  const node = useNode(loc === RECENTS ? null : loc);
  return loc === RECENTS || node?.type === 'dir' ? loc : HOME;
}

/* ───────────────────────── Listing ───────────────────────── */

type ColumnKey = 'name' | 'date' | 'size';
interface SortState {
  key: ColumnKey;
  asc: boolean;
}
/**
 * Returns the initial column sort of a location.
 *
 * Recents is sorted by modification date, newest first; every folder is sorted by name, A to Z.
 *
 * @param {Loc} loc - Location being shown.
 * @returns {SortState} The default sort for that location.
 *
 * @example
 * defaultSort(RECENTS); // { key: 'date', asc: false }
 */
const defaultSort = (loc: Loc): SortState => (loc === RECENTS ? { key: 'date', asc: false } : { key: 'name', asc: true });

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); /** Natural, case-insensitive name comparison used by every sort ("File 2" precedes "File 10"). */

/**
 * Sorts file list entries by the chosen column.
 *
 * Compares modification time or size (folders count as size -1 so they group together) and
 * falls back to a natural name comparison for ties and for the Name column. The comparison is
 * reversed for descending order. The input array is not mutated.
 *
 * @param {FSNode[]} list - Entries to sort.
 * @param {SortState} sort - Column and direction.
 * @returns {FSNode[]} A new, sorted array.
 *
 * @example
 * const byDate = sortList(nodes, { key: 'date', asc: false });
 */
function sortList(list: FSNode[], sort: SortState): FSNode[] {
  const sign = sort.asc ? 1 : -1;
  /**
   * Returns the sort key of the Size column.
   *
   * Folders have no size and map to -1 so they sort before every file.
   *
   * @param {FSNode} n - Entry to measure.
   * @returns {number} File size in bytes, or -1 for a folder.
   *
   * @example
   * sizeOf(fileNode); // 1024
   */
  const sizeOf = (n: FSNode) => (n.type === 'dir' ? -1 : fileSizeOf(n));
  return [...list].sort((a, b) => {
    const d = sort.key === 'date' ? a.modifiedAt - b.modifiedAt : sort.key === 'size' ? sizeOf(a) - sizeOf(b) : 0;
    return (d || collator.compare(a.name, b.name)) * sign;
  });
}

/**
 * Tells whether a relative path passes through a dot-named (hidden) item.
 *
 * Any segment starting with "." makes the whole path hidden, so items inside hidden folders are
 * hidden too.
 *
 * @param {string} rel - Path relative to the listed folder.
 * @returns {boolean} True when some segment begins with a dot.
 *
 * @example
 * hasHiddenSegment('.config/app.json'); // true
 */
const hasHiddenSegment = (rel: string) => rel.split('/').some((seg) => seg.startsWith('.'));

/**
 * Computes the entries the file list shows for a location, search query and sort.
 *
 * Without a query a folder shows its direct children. With a query, the folder's whole subtree
 * is searched by name, case-insensitively. Recents shows the 60 most recently modified files in
 * the home folder, or searches the home folder when a query is typed. Search and Recents never
 * include items in the Trash. Hidden items (dot names or `meta.hidden`) are skipped unless
 * "Show hidden files" is on. The result is sorted, capped at 400 entries and recomputed
 * whenever the file system changes.
 *
 * @param {Loc} loc - Folder path or the virtual `RECENTS` location.
 * @param {string} query - Search text; blank shows the folder contents.
 * @param {SortState} sort - Column and direction to sort by.
 * @returns {FSNode[]} The nodes to display.
 *
 * @example
 * const items = useListing(PATHS.documents, '', { key: 'name', asc: true });
 */
function useListing(loc: Loc, query: string, sort: SortState): FSNode[] {
  const nodes = useFS((s) => s.nodes);
  const showHidden = useSystem((s) => s.settings.showHiddenFiles);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(nodes);
    /**
     * Applies the hidden-files rule to one candidate.
     *
     * Everything is visible while "Show hidden files" is on; otherwise items with a dot-named
     * segment in `rel` or flagged `meta.hidden` are left out.
     *
     * @param {FSNode} n - Candidate node.
     * @param {string} rel - Its path relative to the listed folder.
     * @returns {boolean} True when the node may be listed.
     *
     * @example
     * all.filter((n) => visible(n, n.name));
     */
    const visible = (n: FSNode, rel: string) => showHidden || (!hasHiddenSegment(rel) && !n.meta?.hidden);
    let list: FSNode[];
    if (q || loc === RECENTS) {
      const root = loc === RECENTS ? HOME : loc;
      const prefix = root === '/' ? '/' : `${root}/`;
      list = all.filter((n) => {
        if (!n.path.startsWith(prefix) || isWithin(n.path, PATHS.trash)) return false;
        if (!visible(n, n.path.slice(prefix.length))) return false;
        return q ? n.name.toLowerCase().includes(q) : n.type === 'file';
      });
      if (!q) list = sortList(list, { key: 'date', asc: false }).slice(0, 60);
    } else {
      const prefix = loc === '/' ? '/' : `${loc}/`;
      list = all.filter((n) => n.path.startsWith(prefix) && !n.path.slice(prefix.length).includes('/') && visible(n, n.name));
    }
    return sortList(list, sort).slice(0, 400);
  }, [nodes, loc, query, sort, showHidden]);
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>(); /** Cache of date and time formatters keyed by "locale:kind". */

/**
 * Returns a cached `Intl.DateTimeFormat` for a locale and kind.
 *
 * Creates a medium-date or short-time formatter (ko-KR or en-US) on first use and reuses it
 * afterwards, so rows do not construct a formatter each time they render.
 *
 * @param {Locale} locale - UI locale.
 * @param {'date' | 'time'} kind - Whether to format the date or the time of day.
 * @returns {Intl.DateTimeFormat} The shared formatter.
 *
 * @example
 * formatter('en', 'time').format(new Date()); // '9:41 AM'
 */
function formatter(locale: Locale, kind: 'date' | 'time'): Intl.DateTimeFormat {
  const key = `${locale}:${kind}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', kind === 'date' ? { dateStyle: 'medium' } : { timeStyle: 'short' });
    dateFormatters.set(key, f);
  }
  return f;
}

/**
 * Formats a modification time the way Finder's Date Modified column does.
 *
 * Times from today or yesterday read "Today at …" / "Yesterday at …"; older ones show the
 * medium date followed by the time.
 *
 * @param {number} ts - Modification time in milliseconds since the epoch.
 * @param {Locale} locale - UI locale.
 * @returns {string} The localized label.
 *
 * @example
 * formatModified(Date.now(), 'en'); // 'Today at 9:41 AM'
 */
function formatModified(ts: number, locale: Locale): string {
  const d = new Date(ts);
  const time = formatter(locale, 'time').format(d);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return tpl(S.today, locale, { t: time });
  if (d.toDateString() === yesterday.toDateString()) return tpl(S.yesterday, locale, { t: time });
  return tpl(S.dateAt, locale, { d: formatter(locale, 'date').format(d), t: time });
}

/* ───────────────────────── Shared UI ───────────────────────── */

/**
 * Builds a mouse-event-like object that anchors a context menu below an element.
 *
 * `showContextMenu` opens the menu at the event's client coordinates, so this places it at the
 * element's bottom-left corner, 4px below, and supplies no-op event methods.
 *
 * @param {HTMLElement} el - Element the menu drops down from.
 * @returns {{ clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }}
 *   Event-like object accepted by `showContextMenu`.
 *
 * @example
 * showContextMenu(anchorEvent(button), items);
 */
const anchorEvent = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return {
    clientX: r.left,
    clientY: r.bottom + 4,
    /**
     * No-op stand-in for `Event.preventDefault`.
     *
     * The synthetic event has no default action to cancel.
     *
     * @returns {void}
     *
     * @example
     * anchorEvent(el).preventDefault();
     */
    preventDefault() {},
    /**
     * No-op stand-in for `Event.stopPropagation`.
     *
     * The synthetic event is never dispatched, so there is nothing to stop.
     *
     * @returns {void}
     *
     * @example
     * anchorEvent(el).stopPropagation();
     */
    stopPropagation() {},
  };
};

const SAVE_FAVORITES: Loc[] = [PATHS.desktop, PATHS.documents, PATHS.downloads, HOME]; /** Sidebar favorites of the Save panel. */
const OPEN_FAVORITES: Loc[] = [RECENTS, PATHS.applications, PATHS.desktop, PATHS.documents, PATHS.downloads, HOME]; /** Sidebar favorites of the Open panel, led by Recents and Applications. */

/**
 * Popup button showing the current folder, like the "Where" popup of a macOS save panel.
 *
 * Clicking it opens a menu anchored under the button that lists the folder and its enclosing
 * folders (the current one checked), optionally the Save panel favorites, and the "Recent
 * Places" that still exist. Choosing an entry calls `onGo`.
 *
 * @param {Object} props - Component props.
 * @param {Loc} props.loc - Location shown on the button.
 * @param {(l: Loc) => void} props.onGo - Called with the chosen location.
 * @param {boolean} [props.withFavorites] - Also list the Save panel favorites.
 * @param {boolean} [props.wide] - Use the wide variant of the button.
 * @returns {JSX.Element} The popup button.
 *
 * @example
 * <LocationPopup loc={dir} onGo={navigate} withFavorites wide />
 */
function LocationPopup({ loc, onGo, withFavorites, wide }: { loc: Loc; onGo: (l: Loc) => void; withFavorites?: boolean; wide?: boolean }) {
  const t = useT();
  /**
   * Builds the location menu and shows it under the button.
   *
   * Entries appear in this order: enclosing folders, favorites (when enabled), then recent
   * places; the last two groups each start with a separator and a disabled heading.
   *
   * @param {ReactMouseEvent<HTMLButtonElement>} e - Click on the popup button.
   * @returns {void}
   *
   * @example
   * <button onClick={open} />
   */
  const open = (e: ReactMouseEvent<HTMLButtonElement>) => {
    /**
     * Creates a menu item that navigates to a location.
     *
     * The item shows the location's display name and icon and calls `onGo` when chosen.
     *
     * @param {Loc} p - Location the item represents.
     * @param {boolean} [checked=false] - Whether the item shows a checkmark.
     * @returns {MenuItem} The menu entry.
     *
     * @example
     * item(HOME, true);
     */
    const item = (p: Loc, checked = false): MenuItem => ({ label: displayName(p, t), icon: locationIcon(p), checked, action: () => onGo(p) });
    const items: MenuItem[] = ancestors(loc).map((p, i) => item(p, i === 0));
    if (withFavorites) items.push({ separator: true }, { label: t(S.favorites), disabled: true }, ...SAVE_FAVORITES.filter((p) => p !== loc).map((p) => item(p)));
    const recent = loadRecentPlaces().filter((p) => p !== loc && fs.isDir(p));
    if (recent.length) items.push({ separator: true }, { label: t(S.recentPlaces), disabled: true }, ...recent.map((p) => item(p)));
    showContextMenu(anchorEvent(e.currentTarget), items);
  };
  return (
    <button type="button" className={`${styles.popup} ${wide ? styles.popupWide : ''}`} onClick={open} aria-haspopup="menu" aria-label={`${t(S.location)}: ${displayName(loc, t)}`}>
      <span className={styles.popupIcon}>{loc === RECENTS ? <Clock size={14} /> : <FileIcon node={{ type: 'dir', name: basename(loc), path: loc }} size={16} />}</span>
      <span className={styles.popupLabel}>{displayName(loc, t)}</span>
      <ChevronsUpDown size={12} className={styles.popupChevron} />
    </button>
  );
}

/**
 * Sidebar of a file panel with Favorites and Locations sections.
 *
 * Lists the given favorite locations followed by the root volume. The entry matching `loc` is
 * drawn selected, and clicking any entry calls `onGo`.
 *
 * @param {Object} props - Component props.
 * @param {Loc} props.loc - Currently shown location.
 * @param {(l: Loc) => void} props.onGo - Called with the clicked location.
 * @param {Loc[]} props.favorites - Locations listed under Favorites.
 * @returns {JSX.Element} The sidebar navigation.
 *
 * @example
 * <PanelSidebar loc={b.loc} onGo={b.navigate} favorites={OPEN_FAVORITES} />
 */
function PanelSidebar({ loc, onGo, favorites }: { loc: Loc; onGo: (l: Loc) => void; favorites: Loc[] }) {
  const t = useT();
  return (
    <nav className={`ui-sidebar ${styles.sidebar}`} aria-label={t(S.sidebar)}>
      <SidebarSection title={t(S.favorites)}>
        {favorites.map((p) => {
          const Icon = locationIcon(p);
          return <SidebarItem key={p} icon={<Icon size={15} />} label={displayName(p, t)} selected={loc === p} onClick={() => onGo(p)} />;
        })}
      </SidebarSection>
      <SidebarSection title={t(S.locations)}>
        <SidebarItem icon={<HardDrive size={15} />} label={DISK_NAME} selected={loc === '/'} onClick={() => onGo('/')} />
      </SidebarSection>
    </nav>
  );
}

/**
 * Browser toolbar with back/forward buttons, the folder popup and a search field.
 *
 * The back and forward buttons are disabled when the history cannot move in that direction.
 *
 * @param {Object} props - Component props.
 * @param {ReturnType<typeof useHistory>} props.hist - Navigation history driving back/forward.
 * @param {Loc} props.loc - Currently shown location.
 * @param {(l: Loc) => void} props.onGo - Called with a location chosen in the popup.
 * @param {string} props.query - Current search text.
 * @param {(q: string) => void} props.onQuery - Called when the search text changes.
 * @returns {JSX.Element} The toolbar.
 *
 * @example
 * <NavToolbar hist={b.hist} loc={b.loc} onGo={b.navigate} query={b.query} onQuery={b.setQuery} />
 */
function NavToolbar({ hist, loc, onGo, query, onQuery }: { hist: ReturnType<typeof useHistory>; loc: Loc; onGo: (l: Loc) => void; query: string; onQuery: (q: string) => void }) {
  const t = useT();
  return (
    <div className={styles.toolbar}>
      <div className={`lg lg-control lg-group ${styles.navGroup}`}>
        <IconButton label={t(S.back)} disabled={!hist.canBack} onClick={hist.back}>
          <ChevronLeft size={17} />
        </IconButton>
        <IconButton label={t(S.forward)} disabled={!hist.canForward} onClick={hist.forward}>
          <ChevronRight size={17} />
        </IconButton>
      </div>
      <LocationPopup loc={loc} onGo={onGo} />
      <div className={styles.spacer} />
      <SearchField value={query} onChange={onQuery} placeholder={t(COMMON.search)} style={{ width: 168 }} />
    </div>
  );
}

const COLUMNS: { key: ColumnKey; label: LString }[] = [
  { key: 'name', label: S.name },
  { key: 'date', label: S.dateModified },
  { key: 'size', label: S.size },
]; /** File list columns in display order. */

interface FileListProps {
  items: FSNode[];
  selected: string | null;
  /** The panel is the key window: selection is drawn in the accent color. */
  keyActive: boolean;
  isSelectable: (n: FSNode) => boolean;
  isDimmed: (n: FSNode) => boolean;
  onSelect: (n: FSNode | null) => void;
  onActivate: (n: FSNode) => void;
  onGoUp: () => void;
  sort: SortState;
  onSort: (key: ColumnKey) => void;
  emptyText?: string;
  listRef: RefObject<HTMLDivElement | null>;
}

/**
 * Sortable list of files and folders shared by both panels.
 *
 * Renders a header row (clicking a column sorts by it) and one row per item with its icon,
 * name, modification date and size. Rows that are not selectable ignore clicks, and dimmed rows
 * are drawn greyed out. The selected row scrolls into view and uses the accent color while the
 * panel is key. Pressing the mouse on empty space clears the selection. Keyboard navigation is
 * handled by `onKeyDown`.
 *
 * @param {FileListProps} props - Component props.
 * @param {FSNode[]} props.items - Entries to show, already sorted.
 * @param {string | null} props.selected - Path of the selected entry.
 * @param {boolean} props.keyActive - Whether the panel is key (accent-colored selection).
 * @param {(n: FSNode) => boolean} props.isSelectable - Whether an entry can be selected.
 * @param {(n: FSNode) => boolean} props.isDimmed - Whether an entry is drawn greyed out.
 * @param {(n: FSNode | null) => void} props.onSelect - Called with the new selection, or null.
 * @param {(n: FSNode) => void} props.onActivate - Called on double-click or ⌘↓.
 * @param {() => void} props.onGoUp - Called on ⌘↑ to show the enclosing folder.
 * @param {SortState} props.sort - Current sort column and direction.
 * @param {(key: ColumnKey) => void} props.onSort - Called when a column header is clicked.
 * @param {string} [props.emptyText] - Text shown when there are no items.
 * @param {RefObject<HTMLDivElement | null>} props.listRef - Ref attached to the list box.
 * @returns {JSX.Element} The list box.
 *
 * @example
 * <FileList items={b.items} selected={b.selected} keyActive isSelectable={() => true}
 *   isDimmed={() => false} onSelect={select} onActivate={activate} onGoUp={b.goUp}
 *   sort={b.sort} onSort={b.onSort} listRef={listRef} />
 */
function FileList({ items, selected, keyActive, isSelectable, isDimmed, onSelect, onActivate, onGoUp, sort, onSort, emptyText, listRef }: FileListProps) {
  const t = useT();
  const locale = useLocale();
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const typeAhead = useRef({ text: '', at: 0 });
  const selectable = items.filter(isSelectable);

  useEffect(() => {
    if (selected) rowRefs.current.get(selected)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  /**
   * Selects the selectable item at an index, clamped to the list bounds.
   *
   * Does nothing when no item is selectable.
   *
   * @param {number} index - Desired index into the selectable items.
   * @returns {void}
   *
   * @example
   * moveTo(0); // selects the first selectable item
   */
  const moveTo = (index: number) => {
    if (!selectable.length) return;
    onSelect(selectable[Math.max(0, Math.min(selectable.length - 1, index))]);
  };

  /**
   * Handles keyboard navigation inside the list.
   *
   * ⌘↑ shows the enclosing folder and ⌘↓ activates the selected item. Without modifiers the
   * arrow keys, Home and End move the selection among selectable items, and printable characters
   * typed less than 900 ms apart build a type-select prefix that selects the first item whose
   * display name starts with it. Handled keys have their default action prevented; other
   * modified keys are left alone.
   *
   * @param {ReactKeyboardEvent<HTMLDivElement>} e - Key event from the list box.
   * @returns {void}
   *
   * @example
   * <div role="listbox" onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = selectable.findIndex((n) => n.path === selected);
    if (isModKey(e) && e.key === 'ArrowUp') {
      e.preventDefault();
      onGoUp();
      return;
    }
    if (isModKey(e) && e.key === 'ArrowDown') {
      e.preventDefault();
      if (current >= 0) onActivate(selectable[current]);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const handled: Record<string, () => void> = {
      /**
       * Selects the next item, or the first one when nothing is selected.
       *
       * The index is clamped, so the selection stays on the last item.
       *
       * @returns {void}
       *
       * @example
       * handled.ArrowDown();
       */
      ArrowDown: () => moveTo(current === -1 ? 0 : current + 1),
      /**
       * Selects the previous item, or the last one when nothing is selected.
       *
       * The index is clamped, so the selection stays on the first item.
       *
       * @returns {void}
       *
       * @example
       * handled.ArrowUp();
       */
      ArrowUp: () => moveTo(current === -1 ? selectable.length - 1 : current - 1),
      /**
       * Selects the first selectable item.
       *
       * Does nothing when no item is selectable.
       *
       * @returns {void}
       *
       * @example
       * handled.Home();
       */
      Home: () => moveTo(0),
      /**
       * Selects the last selectable item.
       *
       * Does nothing when no item is selectable.
       *
       * @returns {void}
       *
       * @example
       * handled.End();
       */
      End: () => moveTo(selectable.length - 1),
    };
    if (handled[e.key]) {
      e.preventDefault();
      handled[e.key]();
      return;
    }
    if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault();
      const ta = typeAhead.current;
      const now = Date.now();
      ta.text = (now - ta.at > 900 ? '' : ta.text) + e.key.toLowerCase();
      ta.at = now;
      const names = selectable.map((n) => displayName(n.path, t).toLowerCase());
      const i = names.findIndex((n) => n.startsWith(ta.text));
      if (i >= 0) onSelect(selectable[i]);
    }
  };

  return (
    <div
      ref={listRef}
      className={styles.list}
      role="listbox"
      aria-label={t(S.files)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <div className={styles.listHeader}>
        {COLUMNS.map((c) => (
          <button key={c.key} type="button" tabIndex={-1} className={`${styles.headerCell} ${sort.key === c.key ? styles.sorted : ''}`} onClick={() => onSort(c.key)}>
            <span className={styles.ellipsis}>{t(c.label)}</span>
            {sort.key === c.key && (sort.asc ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
          </button>
        ))}
      </div>
      {items.map((n) => {
        const isSel = n.path === selected;
        const can = isSelectable(n);
        return (
          <div
            key={n.path}
            ref={(el) => {
              if (el) rowRefs.current.set(n.path, el);
              else rowRefs.current.delete(n.path);
            }}
            role="option"
            aria-selected={isSel}
            aria-disabled={can ? undefined : true}
            title={n.path}
            className={`${styles.row} ${isSel ? (keyActive ? styles.selected : styles.selectedInactive) : ''} ${isDimmed(n) ? styles.dimmed : ''}`}
            onMouseDown={() => can && onSelect(n)}
            onDoubleClick={() => can && onActivate(n)}
          >
            <span className={styles.cellName}>
              <span className={styles.rowIcon}>
                <FileIcon node={n} size={16} />
              </span>
              <span className={styles.ellipsis}>{displayName(n.path, t)}</span>
            </span>
            <span className={styles.cellMeta}>{formatModified(n.modifiedAt, locale)}</span>
            <span className={`${styles.cellMeta} ${styles.cellSize}`}>{n.type === 'dir' ? '--' : formatBytes(fileSizeOf(n), locale)}</span>
          </div>
        );
      })}
      {!items.length && emptyText && <div className={styles.empty}>{emptyText}</div>}
    </div>
  );
}

/**
 * Location, selection, search and sort state shared by both panels.
 *
 * Combines the navigation history with the live location and the computed listing. Navigating
 * to a new location clears the selection and the search text and restores that location's
 * default sort; going back or forward clears only the selection.
 *
 * @param {Loc} initial - Location shown first.
 * @returns {{
 *   hist: ReturnType<typeof useHistory>; loc: Loc; items: FSNode[];
 *   selected: string | null; setSelected: Dispatch<SetStateAction<string | null>>;
 *   query: string; setQuery: Dispatch<SetStateAction<string>>;
 *   sort: SortState; onSort: (key: ColumnKey) => void;
 *   navigate: (next: Loc) => void; goUp: () => false | void;
 * }} Browser state and the callbacks that change it.
 *
 * @example
 * const b = useBrowser(PATHS.documents);
 * b.navigate(PATHS.desktop);
 */
function useBrowser(initial: Loc) {
  const hist = useHistory(initial);
  const loc = useLiveLocation(hist.loc);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(() => defaultSort(initial));
  const items = useListing(loc, query, sort);
  const { go } = hist;
  /**
   * Navigates to a location and resets the per-folder state.
   *
   * Pushes the location onto the history, clears the selection and the search text, and
   * applies the location's default sort.
   *
   * @param {Loc} next - Location to show.
   * @returns {void}
   *
   * @example
   * navigate(PATHS.downloads);
   */
  const navigate = useCallback(
    (next: Loc) => {
      go(next);
      setSelected(null);
      setQuery('');
      setSort(defaultSort(next));
    },
    [go],
  );
  /**
   * Goes back in the history and clears the selection.
   *
   * Does nothing beyond clearing the selection when there is no earlier entry.
   *
   * @returns {void}
   *
   * @example
   * goBack();
   */
  const goBack = () => {
    hist.back();
    setSelected(null);
  };
  /**
   * Goes forward in the history and clears the selection.
   *
   * Does nothing beyond clearing the selection when there is no newer entry.
   *
   * @returns {void}
   *
   * @example
   * goForward();
   */
  const goForward = () => {
    hist.forward();
    setSelected(null);
  };
  /**
   * Sorts by a column, toggling the direction when it already is the sort column.
   *
   * Switching to another column sorts Name ascending and Date Modified or Size descending.
   *
   * @param {ColumnKey} key - Column whose header was clicked.
   * @returns {void}
   *
   * @example
   * onSort('size');
   */
  const onSort = (key: ColumnKey) => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'name' }));
  return {
    hist: { ...hist, back: goBack, forward: goForward },
    loc,
    items,
    selected,
    setSelected,
    query,
    setQuery,
    sort,
    onSort,
    navigate,
    /**
     * Shows the folder enclosing the current location.
     *
     * Does nothing at the root volume or in Recents.
     *
     * @returns {false | void} False when there is no enclosing folder.
     *
     * @example
     * b.goUp();
     */
    goUp: () => loc !== RECENTS && loc !== '/' && navigate(dirname(loc)),
  };
}

interface PanelProps<R> {
  req: R;
  mode: DialogMode;
  active: boolean;
  sheetPriority?: number;
  fallbackAppId?: string;
}

/* ───────────────────────── Open panel ───────────────────────── */

/**
 * Open panel (NSOpenPanel look-alike) answering an `OpenPanelRequest`.
 *
 * Starts in the requested folder (Documents when it does not exist) and shows the toolbar,
 * sidebar and file list. Files whose extension is not in `req.extensions` are dimmed and cannot
 * be selected. With `req.chooseDirectory` only folders can be picked, the default button reads
 * "Choose", and without a selected folder it picks the folder being shown. Choosing records the
 * folder in Recent Places and resolves the request with the path; Cancel, Esc and ⌘. resolve it
 * with null. ⌘[ and ⌘] go back and forward.
 *
 * @param {PanelProps<OpenPanelRequest>} props - Component props.
 * @param {OpenPanelRequest} props.req - Request being answered (title, start folder, filters, resolver).
 * @param {DialogMode} props.mode - `'sheet'` to hang from a window, `'modal'` for a centered system modal.
 * @param {boolean} props.active - Whether the panel is key and receives keyboard input.
 * @param {number} [props.sheetPriority] - Key-routing priority used when shown as a sheet.
 * @returns {JSX.Element} The panel.
 *
 * @example
 * <OpenPanel req={request} mode="sheet" active />
 */
export function OpenPanel({ req, mode, active, sheetPriority }: PanelProps<OpenPanelRequest>) {
  const t = useT();
  const titleId = useId();
  const { leaving, finish } = useFinish(req.id);
  const b = useBrowser(validDir(req.defaultDir) ?? PATHS.documents);
  const listRef = useRef<HTMLDivElement>(null);
  const selNode = useNode(b.selected);

  const exts = useMemo(() => req.extensions?.map((e) => e.toLowerCase().replace(/^\./, '')), [req.extensions]);
  /**
   * Tells whether a file can be returned for this request.
   *
   * Files are never allowed while choosing a folder; otherwise the extension must be in the
   * requested list, and any file is allowed when the list is missing or empty.
   *
   * @param {FSNode} n - File to check.
   * @returns {boolean} True when the file may be chosen.
   *
   * @example
   * fileAllowed(node); // true for "notes.md" when extensions is ['md']
   */
  const fileAllowed = (n: FSNode) => !req.chooseDirectory && (!exts?.length || exts.includes(extname(n.name)));
  /**
   * Tells whether a list entry can be selected.
   *
   * Folders are always selectable so they can be entered; files only when they are allowed.
   *
   * @param {FSNode} n - Entry to check.
   * @returns {boolean} True when the entry can be selected.
   *
   * @example
   * items.filter(isSelectable);
   */
  const isSelectable = (n: FSNode) => n.type === 'dir' || fileAllowed(n);

  /**
   * Completes the panel with the chosen path.
   *
   * Records the chosen folder, or the folder containing the chosen file, in Recent Places, then
   * plays the closing animation and resolves the request with the path.
   *
   * @param {string} path - Chosen file or folder.
   * @returns {void}
   *
   * @example
   * done('/Users/guest/Documents/notes.md');
   */
  const done = (path: string) => {
    rememberPlace(fs.isDir(path) ? path : dirname(path));
    finish(() => req.resolve(path));
  };
  /**
   * Dismisses the panel without a choice.
   *
   * Plays the closing animation and resolves the request with null.
   *
   * @returns {void}
   *
   * @example
   * <Button onClick={cancel}>Cancel</Button>
   */
  const cancel = () => finish(() => req.resolve(null));

  const target = req.chooseDirectory ? (selNode?.type === 'dir' ? selNode.path : b.loc !== RECENTS ? b.loc : null) : selNode && isSelectable(selNode) ? selNode.path : null;

  /**
   * Performs the default button's action.
   *
   * While choosing files, a selected folder is entered instead of returned. Otherwise the
   * current target (the selected file, or the selected or shown folder when choosing folders)
   * completes the panel. Does nothing without a target.
   *
   * @returns {void}
   *
   * @example
   * <Button variant="primary" onClick={open}>Open</Button>
   */
  const open = () => {
    if (!target) return;
    if (!req.chooseDirectory && selNode?.type === 'dir') b.navigate(selNode.path);
    else done(target);
  };

  /**
   * Handles a double-click or ⌘↓ on a list entry.
   *
   * Folders are entered and allowed files complete the panel; other files are ignored.
   *
   * @param {FSNode} n - Activated entry.
   * @returns {void}
   *
   * @example
   * activate(folderNode); // shows the folder's contents
   */
  const activate = (n: FSNode) => {
    if (n.type === 'dir') b.navigate(n.path);
    else if (fileAllowed(n)) done(n.path);
  };

  /**
   * Panel-level keyboard shortcuts.
   *
   * Return performs the default action, Esc or ⌘. cancels, and ⌘[ / ⌘] go back and forward in
   * the history.
   *
   * @param {KeyboardEvent} e - Key event routed to the panel.
   * @returns {boolean} True when the key was handled.
   *
   * @example
   * <PanelShell onKey={onKey} />
   */
  const onKey = (e: KeyboardEvent) => {
    if (isPlainKey(e, 'Enter')) {
      open();
      return true;
    }
    if (isPlainKey(e, 'Escape') || (isModKey(e) && e.key === '.')) {
      cancel();
      return true;
    }
    if (isModKey(e) && e.key === '[') {
      b.hist.back();
      return true;
    }
    if (isModKey(e) && e.key === ']') {
      b.hist.forward();
      return true;
    }
    return false;
  };

  return (
    <PanelShell mode={mode} active={active} leaving={leaving} sheetPriority={sheetPriority} onKey={onKey} initialFocus={listRef} label={t(S.openPanel)} labelledBy={req.title ? titleId : undefined} className={styles.openPanel}>
      {req.title && (
        <div id={titleId} className={styles.panelTitle}>
          {t(req.title)}
        </div>
      )}
      <NavToolbar hist={b.hist} loc={b.loc} onGo={b.navigate} query={b.query} onQuery={b.setQuery} />
      <div className={styles.body}>
        <PanelSidebar loc={b.loc} onGo={b.navigate} favorites={OPEN_FAVORITES} />
        <FileList
          items={b.items}
          selected={b.selected}
          keyActive={active}
          isSelectable={isSelectable}
          isDimmed={(n) => !isSelectable(n)}
          onSelect={(n) => b.setSelected(n?.path ?? null)}
          onActivate={activate}
          onGoUp={b.goUp}
          sort={b.sort}
          onSort={b.onSort}
          emptyText={b.query.trim() ? t(S.noResults) : undefined}
          listRef={listRef}
        />
      </div>
      <div className={styles.footer}>
        <div className={styles.spacer} />
        <Button className={styles.footerBtn} onClick={cancel}>
          {t(COMMON.cancel)}
        </Button>
        <Button className={styles.footerBtn} variant="primary" disabled={!target} onClick={open}>
          {t(req.chooseDirectory ? S.choose : COMMON.open)}
        </Button>
      </div>
    </PanelShell>
  );
}

/* ───────────────────────── Save panel ───────────────────────── */

type Inner = { kind: 'replace'; path: string } | { kind: 'newFolder' } | { kind: 'error'; title: LString; message?: LString };

/**
 * Tells whether a file name is unusable.
 *
 * Rejects empty names, "." and "..", names containing "/" and names longer than 255
 * characters. Names beginning with a dot are checked separately.
 *
 * @param {string} n - Trimmed file name.
 * @returns {boolean} True when the name cannot be used.
 *
 * @example
 * invalidName('a/b'); // true
 */
const invalidName = (n: string) => !n || n === '.' || n === '..' || n.includes('/') || n.length > 255;

const DOT_NAME_ERROR: Inner = { kind: 'error', title: S.dotNameTitle, message: S.dotNameMessage }; /** Alert for names beginning with a dot, which are refused because the item would be invisible. */

/**
 * "New Folder" alert body with a name field.
 *
 * Focuses the field and selects its text when it appears. The Create button is disabled while
 * the name is blank.
 *
 * @param {Object} props - Component props.
 * @param {string} props.name - Current folder name.
 * @param {(v: string) => void} props.onName - Called when the name is edited.
 * @param {() => void} props.onCancel - Called by the Cancel button.
 * @param {() => void} props.onCreate - Called by the Create button.
 * @returns {JSX.Element} The alert content.
 *
 * @example
 * <NewFolderPrompt name={folderName} onName={setFolderName} onCancel={closeInner} onCreate={createFolder} />
 */
function NewFolderPrompt({ name, onName, onCancel, onCreate }: { name: string; onName: (v: string) => void; onCancel: () => void; onCreate: () => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <AlertBody
      icon={<FileIcon node={{ type: 'dir', name: 'folder', path: '/folder' }} size={64} />}
      title={t(S.newFolderTitle)}
      titleId={titleId}
      message={t(S.newFolderMessage)}
      buttons={[
        { key: 'cancel', label: t(COMMON.cancel), onClick: onCancel },
        { key: 'create', label: t(S.create), primary: true, disabled: !name.trim(), onClick: onCreate },
      ]}
    >
      <TextField ref={inputRef} className={styles.innerField} value={name} aria-labelledby={titleId} onChange={(e) => onName(e.target.value)} />
    </AlertBody>
  );
}

/**
 * Save panel (NSSavePanel look-alike) answering a `SavePanelRequest`.
 *
 * The compact form shows the name, tags and a "Where" popup; the disclosure button expands it
 * into a browser with toolbar, sidebar, file list and "New Folder", and the choice is
 * remembered for the next panel. Saving from Recents targets the home folder. Clicking a file
 * in the list copies its name into the name field, double-clicking a folder enters it and
 * double-clicking a file saves. The first focus of the name field selects the name without its
 * extension. While a nested alert (Replace, New Folder or an error) is open, everything behind
 * it is inert to mouse, Tab and screen readers, keystrokes go to the alert, and focus returns
 * to the name field once it closes. The request resolves with the chosen path, or with null on
 * Cancel, Esc or ⌘.
 *
 * @param {PanelProps<SavePanelRequest>} props - Component props.
 * @param {SavePanelRequest} props.req - Request being answered (title, default name and folder, resolver).
 * @param {DialogMode} props.mode - `'sheet'` to hang from a window, `'modal'` for a centered system modal.
 * @param {boolean} props.active - Whether the panel is key and receives keyboard input.
 * @param {number} [props.sheetPriority] - Key-routing priority used when shown as a sheet.
 * @param {string} [props.fallbackAppId] - App whose icon the nested alerts show.
 * @returns {JSX.Element} The panel.
 *
 * @example
 * <SavePanel req={request} mode="sheet" active fallbackAppId="textedit" />
 */
export function SavePanel({ req, mode, active, sheetPriority, fallbackAppId }: PanelProps<SavePanelRequest>) {
  const t = useT();
  const nameId = useId();
  const innerTitleId = useId();
  const { leaving, finish } = useFinish(req.id);
  const b = useBrowser(validDir(req.defaultDir) ?? PATHS.documents);
  const dir = b.loc === RECENTS ? HOME : b.loc;
  const [name, setName] = useState(() => req.defaultName || t(COMMON.untitled));
  const [expanded, setExpanded] = useState(loadExpanded);
  const [inner, setInner] = useState<Inner | null>(null);
  const [folderName, setFolderName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const preselected = useRef(false);

  const hadInner = useRef(false);
  useEffect(() => {
    if (inner) {
      hadInner.current = true;
      if (inner.kind !== 'newFolder') innerRef.current?.focus({ preventScroll: true });
    } else if (hadInner.current) {
      hadInner.current = false;
      nameRef.current?.focus({ preventScroll: true });
    }
  }, [inner]);

  /**
   * Expands or collapses the browser part of the panel.
   *
   * The new state is persisted so the next Save panel opens the same way.
   *
   * @returns {void}
   *
   * @example
   * <button onClick={toggleExpanded} />
   */
  const toggleExpanded = () => {
    setExpanded((v) => {
      saveExpanded(!v);
      return !v;
    });
  };

  /**
   * Completes the panel with the path to save to.
   *
   * Records the destination folder in Recent Places, then plays the closing animation and
   * resolves the request with the path.
   *
   * @param {string} path - Absolute path of the file to write.
   * @returns {void}
   *
   * @example
   * done('/Users/guest/Documents/Untitled.txt');
   */
  const done = (path: string) => {
    rememberPlace(dirname(path));
    finish(() => req.resolve(path));
  };
  /**
   * Dismisses the panel without saving.
   *
   * Plays the closing animation and resolves the request with null.
   *
   * @returns {void}
   *
   * @example
   * <Button onClick={cancel}>Cancel</Button>
   */
  const cancel = () => finish(() => req.resolve(null));

  /**
   * Validates the entered name and saves, or explains why it cannot.
   *
   * Blank names are ignored. Names beginning with a dot and otherwise invalid names show an
   * error alert. A free name completes the panel right away; an existing folder or a protected
   * file shows a "can't be replaced" alert, and an existing file asks for confirmation through
   * the Replace alert.
   *
   * @returns {void}
   *
   * @example
   * <Button variant="primary" onClick={save}>Save</Button>
   */
  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (n.startsWith('.')) {
      setInner(DOT_NAME_ERROR);
      return;
    }
    if (invalidName(n)) {
      setInner({
        kind: 'error',
        title: { en: `The name “${n}” can’t be used.`, ko: `“${n}” 이름은 사용할 수 없습니다.` },
        message: { en: 'Try using a name with fewer characters or without “/”.', ko: '더 짧은 이름이나 “/”가 없는 이름을 사용해 보십시오.' },
      });
      return;
    }
    const path = join(dir, n);
    const existing = fs.stat(path);
    if (!existing) {
      done(path);
      return;
    }
    if (existing.type === 'dir' || fs.isProtected(path)) {
      setInner({
        kind: 'error',
        title: { en: `“${n}” can’t be replaced.`, ko: `“${n}” 항목을 대치할 수 없습니다.` },
        message:
          existing.type === 'dir'
            ? { en: 'A folder with the same name already exists. Choose a different name.', ko: '같은 이름의 폴더가 이미 존재합니다. 다른 이름을 선택하십시오.' }
            : { en: 'You don’t have permission to change this item.', ko: '이 항목을 변경할 권한이 없습니다.' },
      });
      return;
    }
    setInner({ kind: 'replace', path });
  };

  /**
   * Opens the "New Folder" prompt.
   *
   * The name field starts with the localized "untitled folder" name.
   *
   * @returns {void}
   *
   * @example
   * <Button onClick={openNewFolder}>New Folder</Button>
   */
  const openNewFolder = () => {
    setFolderName(t(COMMON.untitledFolder));
    setInner({ kind: 'newFolder' });
  };

  /**
   * Creates the folder named in the "New Folder" prompt and shows it.
   *
   * Blank names are ignored and names beginning with a dot show the dot-name alert. File system
   * errors from `fs.mkdir` are caught and reported in an error alert that distinguishes a taken
   * name, an invalid name and a location where folders cannot be created.
   *
   * @returns {void}
   *
   * @example
   * <NewFolderPrompt onCreate={createFolder} />
   */
  const createFolder = () => {
    const n = folderName.trim();
    if (!n) return;
    if (n.startsWith('.')) {
      setInner(DOT_NAME_ERROR);
      return;
    }
    try {
      const created = fs.mkdir(join(dir, n));
      setInner(null);
      b.navigate(created.path);
    } catch (e) {
      const msg: LString =
        e instanceof FSError && e.code === 'EEXIST'
          ? { en: `The name “${n}” is already taken. Please choose a different name.`, ko: `“${n}” 이름이 이미 사용 중입니다. 다른 이름을 선택하십시오.` }
          : e instanceof FSError && e.code === 'EINVAL'
            ? { en: `The name “${n}” can’t be used.`, ko: `“${n}” 이름은 사용할 수 없습니다.` }
            : { en: 'The folder can’t be created here.', ko: '이 위치에 폴더를 생성할 수 없습니다.' };
      setInner({ kind: 'error', title: { en: 'The folder can’t be created.', ko: '폴더를 생성할 수 없습니다.' }, message: msg });
    }
  };

  /**
   * Closes the nested alert or prompt.
   *
   * Focus then returns to the name field.
   *
   * @returns {void}
   *
   * @example
   * closeInner();
   */
  const closeInner = () => setInner(null);

  /**
   * Panel-level keyboard shortcuts.
   *
   * While a nested alert is open, Return creates the folder in the New Folder prompt and
   * otherwise closes the alert (in the Replace alert Return means its default button, Cancel,
   * as in macOS), and Esc or ⌘. closes it. Without a nested alert Return saves, Esc or ⌘.
   * cancels, and in the expanded form ⌘[ / ⌘] go back and forward.
   *
   * @param {KeyboardEvent} e - Key event routed to the panel.
   * @returns {boolean} True when the key was handled.
   *
   * @example
   * <PanelShell onKey={onKey} />
   */
  const onKey = (e: KeyboardEvent) => {
    const nested = !inner ? null : inner.kind === 'newFolder' ? { ok: createFolder, cancel: closeInner } : { ok: closeInner, cancel: closeInner };
    const enter = isPlainKey(e, 'Enter');
    const esc = isPlainKey(e, 'Escape') || (isModKey(e) && e.key === '.');
    if (nested) {
      if (enter) nested.ok();
      else if (esc) nested.cancel();
      return enter || esc;
    }
    if (enter) save();
    else if (esc) cancel();
    else if (expanded && isModKey(e) && e.key === '[') b.hist.back();
    else if (expanded && isModKey(e) && e.key === ']') b.hist.forward();
    else return false;
    return true;
  };

  /**
   * Selects the name without its extension the first time the field gains focus.
   *
   * Selects up to the last dot, or the whole name when it has no extension or starts with a
   * dot. Later focus events keep the user's own selection.
   *
   * @param {HTMLInputElement} el - The name field.
   * @returns {void}
   *
   * @example
   * <TextField onFocus={(e) => preselectName(e.currentTarget)} />
   */
  const preselectName = (el: HTMLInputElement) => {
    if (preselected.current) return;
    preselected.current = true;
    const dot = el.value.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
  };

  const dirLabel = displayName(dir, t);
  const behind = inner ? true : undefined;

  return (
    <PanelShell
      mode={mode}
      active={active}
      leaving={leaving}
      sheetPriority={sheetPriority}
      onKey={onKey}
      initialFocus={nameRef}
      label={req.title ? t(req.title) : t(S.savePanel)}
      className={`${styles.savePanel} ${expanded ? styles.saveExpanded : ''}`}
    >
      {req.title && (
        <div className={styles.panelTitle} inert={behind}>
          {t(req.title)}
        </div>
      )}
      <div className={styles.saveForm} inert={behind}>
        <label className={styles.formLabel} htmlFor={nameId}>
          {t(S.saveAs)}
        </label>
        <div className={styles.nameRow}>
          <TextField
            id={nameId}
            ref={nameRef}
            className={styles.nameField}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => preselectName(e.currentTarget)}
          />
          <button type="button" className={styles.expandBtn} aria-expanded={expanded} aria-label={t(expanded ? S.showLess : S.showMore)} title={t(expanded ? S.showLess : S.showMore)} onClick={toggleExpanded}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        <label className={styles.formLabel} htmlFor={`${nameId}-tags`}>
          {t(S.tags)}
        </label>
        <TextField id={`${nameId}-tags`} className={styles.tagsField} />
        {!expanded && (
          <>
            <span className={styles.formLabel}>{t(S.where)}</span>
            <div>
              <LocationPopup loc={dir} onGo={b.navigate} withFavorites wide />
            </div>
          </>
        )}
      </div>

      {expanded && (
        <div className={styles.browser} inert={behind}>
          <NavToolbar hist={b.hist} loc={b.loc} onGo={b.navigate} query={b.query} onQuery={b.setQuery} />
          <div className={styles.body}>
            <PanelSidebar loc={b.loc} onGo={b.navigate} favorites={SAVE_FAVORITES} />
            <FileList
              items={b.items}
              selected={b.selected}
              keyActive={active}
              isSelectable={() => true}
              isDimmed={(n) => n.type !== 'dir'}
              onSelect={(n) => {
                b.setSelected(n?.path ?? null);
                if (n?.type === 'file') setName(n.name);
              }}
              onActivate={(n) => (n.type === 'dir' ? b.navigate(n.path) : save())}
              onGoUp={b.goUp}
              sort={b.sort}
              onSort={b.onSort}
              emptyText={b.query.trim() ? t(S.noResults) : undefined}
              listRef={listRef}
            />
          </div>
        </div>
      )}

      <div className={styles.footer} inert={behind}>
        {expanded && (
          <Button className={styles.footerBtn} onClick={openNewFolder}>
            {t(COMMON.newFolder)}
          </Button>
        )}
        <div className={styles.spacer} />
        <Button className={styles.footerBtn} onClick={cancel}>
          {t(COMMON.cancel)}
        </Button>
        <Button className={styles.footerBtn} variant="primary" disabled={!name.trim()} onClick={save}>
          {t(COMMON.save)}
        </Button>
      </div>

      {inner && (
        <InnerAlert label={inner.kind === 'error' ? t(inner.title) : t(inner.kind === 'replace' ? S.replace : S.newFolderTitle)}>
          <div ref={innerRef} tabIndex={-1} className={styles.innerContent}>
            {inner.kind === 'newFolder' && <NewFolderPrompt name={folderName} onName={setFolderName} onCancel={closeInner} onCreate={createFolder} />}
            {inner.kind === 'replace' && (
              <AlertBody
                icon={<AlertIcon appId={fallbackAppId} />}
                title={t({ en: `“${basename(inner.path)}” already exists. Do you want to replace it?`, ko: `“${basename(inner.path)}”이(가) 이미 존재합니다. 대치하겠습니까?` })}
                titleId={innerTitleId}
                message={t({
                  en: `A file or folder with the same name already exists in the folder ${dirLabel}. Replacing it will overwrite its current contents.`,
                  ko: `같은 이름의 파일 또는 폴더가 이미 ‘${dirLabel}’ 폴더에 있습니다. 대치하면 현재 내용을 덮어씁니다.`,
                })}
                buttons={[
                  { key: 'replace', label: t(S.replace), danger: true, onClick: () => done(inner.path) },
                  { key: 'cancel', label: t(COMMON.cancel), primary: true, onClick: closeInner },
                ]}
              />
            )}
            {inner.kind === 'error' && (
              <AlertBody
                icon={<AlertIcon appId={fallbackAppId} />}
                title={t(inner.title)}
                titleId={innerTitleId}
                message={inner.message ? t(inner.message) : undefined}
                buttons={[{ key: 'ok', label: t(COMMON.ok), primary: true, onClick: closeInner }]}
              />
            )}
          </div>
        </InnerAlert>
      )}
    </PanelShell>
  );
}

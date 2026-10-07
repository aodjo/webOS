/**
 * Pure Finder logic: virtual locations, display names, kinds, sorting, keyboard navigation
 * helpers and date formatting. No React here so it can be unit-tested.
 */
import type { FSNode, Locale, LString, SortKey } from '@/kernel';
import { HOME, PATHS, USER, basename, dirname, extname, fileSizeOf, getApp, isWithin, kindOf, normalize, tr } from '@/kernel';
import { osInfo } from '@/data/portfolio';
import { S, TAG_COLORS } from './strings';

/** How a Finder window presents a folder's items. */
export type ViewMode = 'icons' | 'list' | 'columns' | 'gallery';
/** Sort direction. */
export type SortDir = 'asc' | 'desc';
/** A sort order: the column to sort by and its direction. */
export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}

/* ───────────────────────── Locations ───────────────────────── */

export const RECENTS = 'finder:recents'; /** Virtual location: the 30 most recently modified files in the home folder. */
export const TAG_PREFIX = 'finder:tag:'; /** Virtual location prefix: every item carrying a color tag (`finder:tag:red`). */

/**
 * Tells whether a location is virtual rather than a real folder.
 *
 * Real locations are absolute paths; virtual ones (Recents, tags) use a `finder:` id.
 *
 * @param {string} loc - A Finder location.
 * @returns {boolean} True when `loc` does not start with "/".
 *
 * @example
 * isVirtual(RECENTS); // true
 * isVirtual('/Users'); // false
 */
export const isVirtual = (loc: string) => !loc.startsWith('/');
/**
 * Extracts the tag id from a tag location.
 *
 * A tag location is `TAG_PREFIX` followed by the tag id; the id is whatever follows the
 * prefix.
 *
 * @param {string} loc - A Finder location.
 * @returns {string | null} The tag id after `TAG_PREFIX`, or null for any other location.
 *
 * @example
 * tagOf('finder:tag:red'); // 'red'
 * tagOf('/Users'); // null
 */
export const tagOf = (loc: string) => (loc.startsWith(TAG_PREFIX) ? loc.slice(TAG_PREFIX.length) : null);

const SPECIAL_NAMES: Record<string, LString> = {
  '/': `${osInfo.name} HD`,
  '/Applications': S.applications,
  '/System': S.system,
  '/Library': S.library,
  '/Users': S.users,
  '/Users/Shared': S.shared,
  [PATHS.desktop]: S.desktop,
  [PATHS.documents]: S.documents,
  [PATHS.downloads]: S.downloads,
  [PATHS.pictures]: S.pictures,
  [PATHS.music]: S.music,
  [`${HOME}/Movies`]: S.movies,
  [`${HOME}/Public`]: S.publicFolder,
  [PATHS.trash]: S.trash,
}; /** Localized display names of the standard folders (the startup disk is shown as "<OS name> HD"). */

/** The node fields needed to compute a display name; `content` identifies the app of a ".app" file. */
type NameNode = Pick<FSNode, 'path' | 'name' | 'type'> & Partial<Pick<FSNode, 'content'>>;

/**
 * Tells whether a node is an application bundle.
 *
 * Applications are ".app" files whose content is the app id.
 *
 * @param {Pick<FSNode, 'type' | 'name'>} n - The node to test.
 * @returns {boolean} True for files with the "app" extension.
 *
 * @example
 * isAppFile({ type: 'file', name: 'Notes.app' }); // true
 */
export function isAppFile(n: Pick<FSNode, 'type' | 'name'>): boolean {
  return n.type === 'file' && extname(n.name) === 'app';
}

/**
 * Returns the name Finder shows for an item.
 *
 * Standard folders get their localized name, the home folder shows the user name, and ".app"
 * files show the registered app's translated name (or the file name without ".app" when the
 * app id is unknown). Every other item shows its file name.
 *
 * @param {NameNode} n - The node to name.
 * @param {Locale} locale - Display language.
 * @returns {string} The display name.
 *
 * @example
 * displayName(fs.stat(PATHS.documents)!, 'ko'); // '문서'
 */
export function displayName(n: NameNode, locale: Locale): string {
  const special = SPECIAL_NAMES[n.path];
  if (special) return tr(special, locale);
  if (n.path === HOME) return USER;
  if (isAppFile(n)) {
    const app = getApp((n.content ?? '').trim());
    return app ? tr(app.name, locale) : n.name.replace(/\.app$/i, '');
  }
  return n.name;
}

/**
 * Returns the title of a location.
 *
 * Handles the Recents and tag virtual locations (tag names come from `TAG_COLORS`, falling
 * back to the raw id) and otherwise names the normalized folder path with `displayName`.
 *
 * @param {string} loc - A real folder path or a virtual location.
 * @param {Locale} locale - Display language.
 * @returns {string} The location name.
 *
 * @example
 * locationName(RECENTS, 'en'); // 'Recents'
 * locationName('finder:tag:red', 'en'); // 'Red'
 */
export function locationName(loc: string, locale: Locale): string {
  if (loc === RECENTS) return tr(S.recents, locale);
  const tag = tagOf(loc);
  if (tag) return tr(TAG_COLORS.find((c) => c.id === tag)?.name ?? tag, locale);
  const p = normalize(loc);
  return displayName({ path: p, name: basename(p), type: 'dir' }, locale);
}

/**
 * Finds the nearest existing folder for a location.
 *
 * Walks up from `loc` until it reaches a directory present in `nodes` (or "/"). Virtual
 * locations are returned unchanged.
 *
 * @param {string} loc - Location that may have been removed.
 * @param {Record<string, FSNode>} nodes - The file system node map.
 * @returns {string} `loc` itself, its closest existing ancestor, or "/".
 *
 * @example
 * resolveExistingDir('/Users/me/Documents/gone/deeper', nodes); // '/Users/me/Documents'
 */
export function resolveExistingDir(loc: string, nodes: Record<string, FSNode>): string {
  if (isVirtual(loc)) return loc;
  let p = normalize(loc);
  while (p !== '/' && nodes[p]?.type !== 'dir') p = dirname(p);
  return p;
}

/**
 * Works out where an item that disappeared from `last.path` went (rename, move or Trash).
 *
 * Only paths that are new in `after` compared to `before` are considered. A Trash entry whose
 * `trashedFrom` equals the old path wins immediately. Otherwise candidates must have the same
 * type and `createdAt` (moves keep it) and either the same name or the same parent folder. A
 * moved folder brings its subfolders along, so the shallowest candidate is the folder itself.
 *
 * @param {FSNode} last - The node as it was before it disappeared.
 * @param {Record<string, FSNode>} before - The previous node map.
 * @param {Record<string, FSNode>} after - The current node map.
 * @returns {string | null} The item's new path, or null when it was deleted.
 *
 * @example
 * const next = findMovedPath(prevNodes['/a/b'], prevNodes, nodes);
 * console.log(next); // '/a/d'
 */
export function findMovedPath(last: FSNode, before: Record<string, FSNode>, after: Record<string, FSNode>): string | null {
  const candidates: string[] = [];
  for (const p in after) {
    if (before[p]) continue;
    const n = after[p];
    if (n.meta?.trashedFrom === last.path) return p;
    if (n.type === last.type && n.createdAt === last.createdAt && (n.name === last.name || dirname(p) === dirname(last.path))) candidates.push(p);
  }
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] ?? null;
}

/* ───────────────────────── Listing ───────────────────────── */

/**
 * Tells whether an item is hidden.
 *
 * Dotfiles and items with the `hidden` meta flag are hidden.
 *
 * @param {Pick<FSNode, 'name' | 'meta'>} n - The node to test.
 * @returns {boolean} True when the item is hidden.
 *
 * @example
 * isHiddenNode({ name: '.secret' }); // true
 */
export function isHiddenNode(n: Pick<FSNode, 'name' | 'meta'>): boolean {
  return n.name.startsWith('.') || !!n.meta?.hidden;
}

/**
 * Lists the direct children of a folder straight from a node map.
 *
 * Scans every key for paths one level below `dir` (the folder itself and deeper descendants
 * are skipped). Hidden items are left out unless `showHidden` is set. The result is unsorted.
 *
 * @param {Record<string, FSNode>} nodes - The file system node map.
 * @param {string} dir - Folder whose children are listed.
 * @param {boolean} showHidden - Whether to include hidden items.
 * @returns {FSNode[]} The children in map order.
 *
 * @example
 * listChildren(nodes, PATHS.documents, false).map((n) => n.name); // ['a.txt']
 */
export function listChildren(nodes: Record<string, FSNode>, dir: string, showHidden: boolean): FSNode[] {
  const d = normalize(dir);
  const prefix = d === '/' ? '/' : d + '/';
  const out: FSNode[] = [];
  for (const p in nodes) {
    if (p === d || !p.startsWith(prefix) || p.indexOf('/', prefix.length) !== -1) continue;
    const n = nodes[p];
    if (showHidden || !isHiddenNode(n)) out.push(n);
  }
  return out;
}

/**
 * Tells whether any path segment below `root` is a dotfile.
 *
 * Drops `root` and the following slash from `path`, splits the rest into segments and checks
 * each one for a leading ".", so items inside hidden folders count as hidden too.
 *
 * @param {string} path - A path inside `root`.
 * @param {string} root - The folder the relative segments start from.
 * @returns {boolean} True when a segment after `root` starts with ".".
 *
 * @example
 * inHiddenPath('/Users/me/.config/a.txt', '/Users/me'); // true
 */
function inHiddenPath(path: string, root: string): boolean {
  return path
    .slice(root.length + 1)
    .split('/')
    .some((seg) => seg.startsWith('.'));
}

/**
 * Builds the "Recents" virtual folder.
 *
 * Collects files under the home folder that are not hidden (by meta flag or a dotfile segment)
 * and not in the Trash, then returns the most recently modified ones first.
 *
 * @param {Record<string, FSNode>} nodes - The file system node map.
 * @param {number} [limit=30] - Maximum number of files returned.
 * @returns {FSNode[]} Files sorted by modification date, newest first.
 *
 * @example
 * selectRecents(nodes, 5).map((n) => n.name); // ['b.md', 'a.txt']
 */
export function selectRecents(nodes: Record<string, FSNode>, limit = 30): FSNode[] {
  const prefix = HOME + '/';
  const out: FSNode[] = [];
  for (const p in nodes) {
    if (!p.startsWith(prefix)) continue;
    const n = nodes[p];
    if (n.type !== 'file' || n.meta?.hidden || isWithin(p, PATHS.trash) || inHiddenPath(p, HOME)) continue;
    out.push(n);
  }
  out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return out.slice(0, limit);
}

/**
 * Lists every item carrying a color tag.
 *
 * Items in the Trash and items whose path contains a dot-prefixed segment (dotfiles and
 * anything inside a hidden folder) are skipped. The result is unsorted.
 *
 * @param {Record<string, FSNode>} nodes - The file system node map.
 * @param {string} tag - Tag id, e.g. "red".
 * @returns {FSNode[]} The tagged files and folders.
 *
 * @example
 * selectTagged(nodes, 'red').length; // 2
 */
export function selectTagged(nodes: Record<string, FSNode>, tag: string): FSNode[] {
  const out: FSNode[] = [];
  for (const p in nodes) {
    const n = nodes[p];
    if (n.meta?.tag !== tag || isWithin(p, PATHS.trash) || p.includes('/.')) continue;
    out.push(n);
  }
  return out;
}

/* ───────────────────────── Kinds ───────────────────────── */

const KIND_BY_EXT: Record<string, LString> = {
  md: { en: 'Markdown Document', ko: 'Markdown 문서' },
  markdown: { en: 'Markdown Document', ko: 'Markdown 문서' },
  txt: { en: 'Plain Text Document', ko: '일반 텍스트 문서' },
  log: { en: 'Log File', ko: '로그 파일' },
  csv: { en: 'CSV Document', ko: 'CSV 문서' },
  json: { en: 'JSON Document', ko: 'JSON 문서' },
  js: { en: 'JavaScript Script', ko: 'JavaScript 스크립트' },
  jsx: { en: 'JSX Source', ko: 'JSX 소스' },
  ts: { en: 'TypeScript Source', ko: 'TypeScript 소스' },
  tsx: { en: 'TypeScript Source', ko: 'TypeScript 소스' },
  css: { en: 'CSS Style Sheet', ko: 'CSS 스타일 시트' },
  html: { en: 'HTML Text', ko: 'HTML 텍스트' },
  htm: { en: 'HTML Text', ko: 'HTML 텍스트' },
  xml: { en: 'XML Text', ko: 'XML 텍스트' },
  plist: { en: 'Property List', ko: '속성 목록' },
  sh: { en: 'Shell Script', ko: '셸 스크립트' },
  py: { en: 'Python Script', ko: 'Python 스크립트' },
  yml: { en: 'YAML Document', ko: 'YAML 문서' },
  yaml: { en: 'YAML Document', ko: 'YAML 문서' },
  pdf: { en: 'PDF Document', ko: 'PDF 문서' },
  webloc: { en: 'Website Location', ko: '웹 사이트 위치' },
  url: { en: 'Website Location', ko: '웹 사이트 위치' },
  zip: { en: 'ZIP Archive', ko: 'ZIP 아카이브' },
  mp3: { en: 'MP3 Audio', ko: 'MP3 오디오' },
  wav: { en: 'WAV Audio', ko: 'WAV 오디오' },
  m4a: { en: 'MPEG-4 Audio', ko: 'MPEG-4 오디오' },
  mp4: { en: 'MPEG-4 Movie', ko: 'MPEG-4 동영상' },
  mov: { en: 'MOV Movie', ko: 'MOV 동영상' },
  webm: { en: 'WebM Movie', ko: 'WebM 동영상' },
}; /** Localized "Kind" text for well-known file extensions. */

/**
 * Returns the localized text of the "Kind" column.
 *
 * Folders are "Folder" ("Volume" for "/"), ".app" files are "Application", known extensions
 * use `KIND_BY_EXT`, images become "<EXT> Image" (jpg shown as JPEG), files without an
 * extension are "Document" and anything else is "<EXT> File".
 *
 * @param {Pick<FSNode, 'path' | 'name' | 'type'>} n - The node to describe.
 * @param {Locale} locale - Display language.
 * @returns {string} The kind label.
 *
 * @example
 * kindLabel({ path: '/a/b.jpg', name: 'b.jpg', type: 'file' }, 'en'); // 'JPEG Image'
 * kindLabel({ path: '/a', name: 'a', type: 'dir' }, 'ko'); // '폴더'
 */
export function kindLabel(n: Pick<FSNode, 'path' | 'name' | 'type'>, locale: Locale): string {
  if (n.type === 'dir') return tr(n.path === '/' ? S.volume : S.folderOf, locale);
  if (isAppFile(n)) return tr({ en: 'Application', ko: '응용 프로그램' }, locale);
  const ext = extname(n.name);
  const known = KIND_BY_EXT[ext];
  if (known) return tr(known, locale);
  if (kindOf(n) === 'image') {
    const label = ext === 'jpg' ? 'JPEG' : ext.toUpperCase();
    return locale === 'ko' ? `${label} 이미지` : `${label} Image`;
  }
  if (!ext) return tr({ en: 'Document', ko: '문서' }, locale);
  return locale === 'ko' ? `${ext.toUpperCase()} 파일` : `${ext.toUpperCase()} File`;
}

/* ───────────────────────── Sorting ───────────────────────── */

export const DEFAULT_DIR: Record<SortKey, SortDir> = { name: 'asc', kind: 'asc', date: 'desc', size: 'desc' }; /** Natural direction of each sort key when it is first selected. */

const SORT_BY_NAME: SortSpec = Object.freeze({ key: 'name', dir: 'asc' }) as SortSpec; /** Frozen shared default sort for folders (name, ascending). */
const SORT_BY_DATE: SortSpec = Object.freeze({ key: 'date', dir: 'desc' }) as SortSpec; /** Frozen shared default sort for Recents (date, newest first). */

/**
 * Returns the default sort order of a location.
 *
 * Recents sorts by date (newest first), every other location by name. The returned objects are
 * frozen shared constants, so the reference is stable across calls and memoized sorted
 * listings (and the menus derived from them) do not recompute on every render. Callers build a
 * new object before changing a sort (`{ ...sort, dir }`, `nextSort`).
 *
 * @param {string} loc - A Finder location.
 * @returns {SortSpec} The shared default sort for that location.
 *
 * @example
 * defaultSort(RECENTS); // { key: 'date', dir: 'desc' }
 * defaultSort('/x') === defaultSort('/y'); // true
 */
export function defaultSort(loc: string): SortSpec {
  return loc === RECENTS ? SORT_BY_DATE : SORT_BY_NAME;
}

/**
 * Computes the sort after clicking a column header.
 *
 * Clicking the current key flips the direction; a new key starts in its natural direction
 * from `DEFAULT_DIR`.
 *
 * @param {SortSpec} cur - The current sort.
 * @param {SortKey} key - The clicked column.
 * @returns {SortSpec} A new sort object.
 *
 * @example
 * nextSort({ key: 'name', dir: 'asc' }, 'name'); // { key: 'name', dir: 'desc' }
 * nextSort({ key: 'name', dir: 'asc' }, 'date'); // { key: 'date', dir: 'desc' }
 */
export function nextSort(cur: SortSpec, key: SortKey): SortSpec {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] };
}

const collators = new Map<Locale, Intl.Collator>(); /** Cache of name collators, one per locale. */
/**
 * Returns the cached name collator for a locale.
 *
 * The collator compares numerically ("file 2" before "file 10") and ignores case and accents.
 * It is created on first use and reused afterwards.
 *
 * @param {Locale} locale - Display language.
 * @returns {Intl.Collator} The collator for that locale.
 *
 * @example
 * ['b', 'A'].sort(collator('en').compare); // ['A', 'b']
 */
export function collator(locale: Locale): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale === 'ko' ? 'ko' : 'en', { numeric: true, sensitivity: 'base' });
    collators.set(locale, c);
  }
  return c;
}

/**
 * Sorts items for display.
 *
 * Compares by the key of `spec` in its direction: display name (natural, case-insensitive),
 * modification date, size or kind label. For size, folders count as -1 bytes, so they come
 * before every file when ascending and after every file when descending. Ties always fall back
 * to ascending name order, like Finder. The input array is not modified.
 *
 * @param {FSNode[]} list - Items to sort.
 * @param {SortSpec} spec - Sort key and direction.
 * @param {Locale} locale - Language used for names, kinds and collation.
 * @returns {FSNode[]} A new sorted array.
 *
 * @example
 * sortItems(items, { key: 'size', dir: 'desc' }, 'en').map((n) => n.name); // ['b.txt', 'a.txt', 'C']
 */
export function sortItems(list: FSNode[], spec: SortSpec, locale: Locale): FSNode[] {
  const coll = collator(locale);
  const names = new Map(list.map((n) => [n.path, displayName(n, locale)]));
  /**
   * Compares two items by display name in ascending order.
   *
   * Looks up the display names computed once for the list and compares them with the
   * locale's natural, case-insensitive collator. Used as the tie-breaker for every key.
   *
   * @param {FSNode} a - First item.
   * @param {FSNode} b - Second item.
   * @returns {number} Negative, zero or positive like `Intl.Collator#compare`.
   *
   * @example
   * [a, b].sort(byName);
   */
  const byName = (a: FSNode, b: FSNode) => coll.compare(names.get(a.path)!, names.get(b.path)!);
  const sign = spec.dir === 'asc' ? 1 : -1;
  /**
   * Ascending comparator for the selected sort key.
   *
   * Assigned by the switch below: "date" compares modification times, "size" compares file
   * sizes with folders counted as -1 bytes, "kind" compares the kind labels (computed once for
   * the list) with the collator, and any other key falls back to `byName`.
   *
   * @param {FSNode} a - First item.
   * @param {FSNode} b - Second item.
   * @returns {number} Negative, zero or positive.
   *
   * @example
   * sign * primary(a, b) || byName(a, b);
   */
  let primary: (a: FSNode, b: FSNode) => number;
  switch (spec.key) {
    case 'date':
      primary = (a, b) => a.modifiedAt - b.modifiedAt;
      break;
    case 'size':
      primary = (a, b) => (a.type === 'dir' ? -1 : fileSizeOf(a)) - (b.type === 'dir' ? -1 : fileSizeOf(b));
      break;
    case 'kind': {
      const kinds = new Map(list.map((n) => [n.path, kindLabel(n, locale)]));
      primary = (a, b) => coll.compare(kinds.get(a.path)!, kinds.get(b.path)!);
      break;
    }
    default:
      primary = byName;
  }
  return [...list].sort((a, b) => sign * primary(a, b) || byName(a, b));
}

/* ───────────────────────── List view tree ───────────────────────── */

/** One visible row of the list view. */
export interface Row {
  /** The item shown in the row. */
  node: FSNode;
  /** Nesting level (0 for items of the listed folder). */
  depth: number;
  /** Whether the row is an expanded folder. */
  expanded: boolean;
}

/**
 * Flattens folders expanded with disclosure triangles into visible rows.
 *
 * Emits a row for each item and, right after an expanded folder, recursively the rows of its
 * children. Recursion stops at depth 32. Rows are appended to `out`, which is also returned.
 *
 * @param {FSNode[]} items - Sorted items of the current level.
 * @param {ReadonlySet<string>} expanded - Paths of expanded folders.
 * @param {(dir: string) => FSNode[]} childrenOf - Returns the sorted children of a folder.
 * @param {number} [depth=0] - Nesting level of `items`.
 * @param {Row[]} [out=[]] - Accumulator for the rows.
 * @returns {Row[]} The visible rows in display order.
 *
 * @example
 * const rows = flattenRows(items, new Set(['/r/A']), (d) => sortItems(listChildren(nodes, d, false), sort, locale));
 * rows.map((r) => r.depth); // [0, 1, 1, 0]
 */
export function flattenRows(items: FSNode[], expanded: ReadonlySet<string>, childrenOf: (dir: string) => FSNode[], depth = 0, out: Row[] = []): Row[] {
  for (const node of items) {
    const isOpen = node.type === 'dir' && expanded.has(node.path);
    out.push({ node, depth, expanded: isOpen });
    if (isOpen && depth < 32) flattenRows(childrenOf(node.path), expanded, childrenOf, depth + 1, out);
  }
  return out;
}

/* ───────────────────────── Selection & keyboard ───────────────────────── */

/** Arrow key direction. */
export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Moves the selection with an arrow key in the icon grid.
 *
 * Without a valid selection, Up/Left select the last item and Down/Right the first. Left and
 * Right move by one item, clamped to the ends. Up and Down move by a whole row and stay put at
 * the edges, except that Down from a row above a shorter last row lands on the last item, like
 * Finder.
 *
 * @param {number} index - Selected index, or -1 when nothing is selected.
 * @param {number} count - Number of items.
 * @param {number} cols - Number of columns (at least 1 is used).
 * @param {Direction} dir - Arrow direction.
 * @returns {number} The new index, or -1 when there are no items.
 *
 * @example
 * gridMove(1, 7, 3, 'down'); // 4
 * gridMove(4, 7, 3, 'down'); // 6
 */
export function gridMove(index: number, count: number, cols: number, dir: Direction): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return dir === 'up' || dir === 'left' ? count - 1 : 0;
  const c = Math.max(1, cols);
  switch (dir) {
    case 'left':
      return Math.max(0, index - 1);
    case 'right':
      return Math.min(count - 1, index + 1);
    case 'up':
      return index - c >= 0 ? index - c : index;
    case 'down':
      if (index + c < count) return index + c;
      return Math.floor(index / c) < Math.floor((count - 1) / c) ? count - 1 : index;
  }
}

/**
 * Moves the selection one step in a linear view (list, column or gallery).
 *
 * Without a selection, moving forward selects the first item and moving back the last.
 * Otherwise the index is clamped to the list bounds.
 *
 * @param {number} index - Selected index, or -1 when nothing is selected.
 * @param {number} count - Number of items.
 * @param {1 | -1} delta - Step direction.
 * @returns {number} The new index, or -1 when there are no items.
 *
 * @example
 * linearMove(-1, 3, -1); // 2
 * linearMove(2, 3, 1); // 2
 */
export function linearMove(index: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/**
 * Returns the items between two paths (inclusive) in display order, for ⇧-click.
 *
 * The order of `a` and `b` does not matter. When either path is missing from `order`, the
 * result is `[b]` if `b` is present, otherwise empty.
 *
 * @param {string[]} order - Paths in display order.
 * @param {string} a - Anchor path.
 * @param {string} b - Clicked path.
 * @returns {string[]} The paths of the range.
 *
 * @example
 * rangeBetween(['a', 'b', 'c', 'd'], 'c', 'a'); // ['a', 'b', 'c']
 */
export function rangeBetween(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return j >= 0 ? [b] : [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * Toggles membership of a path in a selection (⌘-click).
 *
 * Returns a filtered copy when `path` is already selected and a copy with `path` appended
 * otherwise; the input array is not modified.
 *
 * @param {string[]} list - Current selection.
 * @param {string} path - Path to add or remove.
 * @returns {string[]} A new selection without `path` if it was present, otherwise with it appended.
 *
 * @example
 * toggleIn(['a', 'b'], 'a'); // ['b']
 * toggleIn(['a'], 'b'); // ['a', 'b']
 */
export function toggleIn(list: string[], path: string): string[] {
  return list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
}

/**
 * Computes the symmetric difference of two selections (rubber band with ⌘/⇧ held).
 *
 * Items of `base` that the rubber band now covers are deselected and covered items that were
 * not in `base` are added, so dragging over an item flips its selection state.
 *
 * @param {string[]} base - Selection when the rubber band started.
 * @param {string[]} hits - Items currently inside the rubber band.
 * @returns {string[]} Items in exactly one of the two lists: `base` order first, then new hits.
 *
 * @example
 * xor(['a', 'b'], ['b', 'c']); // ['a', 'c']
 */
export function xor(base: string[], hits: string[]): string[] {
  const hitSet = new Set(hits);
  const baseSet = new Set(base);
  return [...base.filter((p) => !hitSet.has(p)), ...hits.filter((p) => !baseSet.has(p))];
}

/**
 * Finds the item to select for typed characters (type-ahead).
 *
 * Sorts the entries by name and returns the first whose name starts with `prefix`
 * (case-insensitive). Without such a name it jumps to the first entry that sorts after the
 * prefix, or to the last entry, like Finder.
 *
 * @param {{ path: string; name: string }[]} entries - Items with their display names.
 * @param {string} prefix - Characters typed so far.
 * @param {Locale} locale - Language used for collation.
 * @returns {string | null} Path of the match, or null for an empty prefix or no entries.
 *
 * @example
 * typeAheadMatch([{ path: '/Cherry', name: 'Cherry' }, { path: '/date', name: 'date' }], 'cz', 'en'); // '/date'
 */
export function typeAheadMatch(entries: { path: string; name: string }[], prefix: string, locale: Locale): string | null {
  const q = prefix.toLocaleLowerCase();
  if (!q || !entries.length) return null;
  const coll = collator(locale);
  const sorted = [...entries].sort((a, b) => coll.compare(a.name, b.name));
  const starts = sorted.find((e) => e.name.toLocaleLowerCase().startsWith(q));
  if (starts) return starts.path;
  const after = sorted.find((e) => coll.compare(e.name, prefix) > 0);
  return (after ?? sorted[sorted.length - 1]).path;
}

/**
 * Builds the folder chain from `root` down to `leaf`, as shown by the column view.
 *
 * Both paths are normalized. The walk stops at `root` or "/".
 *
 * @param {string} root - Top of the chain.
 * @param {string} leaf - Bottom of the chain.
 * @returns {string[]} Paths from `root` to `leaf` (inclusive), or `[leaf]` when `leaf` is outside `root`.
 *
 * @example
 * chain('/a', '/a/b/c'); // ['/a', '/a/b', '/a/b/c']
 * chain('/a', '/x'); // ['/x']
 */
export function chain(root: string, leaf: string): string[] {
  const r = normalize(root);
  const l = normalize(leaf);
  if (!isWithin(l, r)) return [l];
  const out: string[] = [];
  for (let p = l; ; p = dirname(p)) {
    out.unshift(p);
    if (p === r || p === '/') break;
  }
  return out;
}

/**
 * Lists every ancestor of a path, from "/" down to the path itself.
 *
 * Equivalent to `chain('/', path)`, so the path is normalized first. Used for the path bar.
 *
 * @param {string} path - Absolute path.
 * @returns {string[]} The ancestors including "/" and `path`.
 *
 * @example
 * ancestors('/a/b'); // ['/', '/a', '/a/b']
 */
export function ancestors(path: string): string[] {
  return chain('/', path);
}

/* ───────────────────────── Drag & drop rules ───────────────────────── */

const NO_DROP_ROOTS = new Set(['/', '/Users', '/Library']); /** System folders that never accept drops. */

/**
 * Tells whether items can be dropped into a folder.
 *
 * Only folders qualify. The Trash itself accepts drops but folders inside it do not. Locked
 * folders, the roots in `NO_DROP_ROOTS` and anything inside /System or /Applications refuse
 * drops.
 *
 * @param {Pick<FSNode, 'path' | 'type' | 'meta'> | null | undefined} node - The target node.
 * @returns {boolean} True when the folder accepts drops.
 *
 * @example
 * canDropInto(fs.stat(PATHS.desktop)); // true
 * canDropInto(fs.stat('/Applications')); // false
 */
export function canDropInto(node: Pick<FSNode, 'path' | 'type' | 'meta'> | null | undefined): boolean {
  if (!node || node.type !== 'dir') return false;
  if (node.path === PATHS.trash) return true;
  if (isWithin(node.path, PATHS.trash)) return false;
  if (node.meta?.locked || NO_DROP_ROOTS.has(node.path)) return false;
  return !isWithin(node.path, '/System') && !isWithin(node.path, '/Applications');
}

/**
 * Tells whether dropping `paths` into `dir` would be impossible or a no-op.
 *
 * A drop is invalid when `dir` is one of the items or inside one of them, or when it is a
 * move and every item is already directly in `dir`. An empty drop is not invalid.
 *
 * @param {readonly string[]} paths - Dragged paths.
 * @param {string} dir - Target folder.
 * @param {boolean} copy - Whether the drop copies instead of moving.
 * @returns {boolean} True when the drop must be refused.
 *
 * @example
 * isInvalidDrop(['/a/b'], '/a/b/c', false); // true
 * isInvalidDrop(['/a/b'], '/a', true); // false
 */
export function isInvalidDrop(paths: readonly string[], dir: string, copy: boolean): boolean {
  if (!paths.length) return false;
  if (paths.some((p) => isWithin(dir, p))) return true;
  return !copy && paths.every((p) => dirname(p) === dir);
}

/* ───────────────────────── Formatting ───────────────────────── */

/**
 * Tells whether two dates fall on the same local calendar day.
 *
 * Compares year, month and day of month in the local time zone and ignores the time of day.
 *
 * @param {Date} a - First date.
 * @param {Date} b - Second date.
 * @returns {boolean} True when year, month and day match.
 *
 * @example
 * sameDay(new Date(2026, 0, 1, 9), new Date(2026, 0, 1, 23)); // true
 */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Formats a timestamp the way Finder does.
 *
 * Today and yesterday are shown by name with the time; older dates show a short date plus the
 * time. The time uses a 12-hour clock unless `opts.h24` is set.
 *
 * @param {number} ts - Timestamp in milliseconds.
 * @param {Locale} locale - Display language.
 * @param {{ h24?: boolean; now?: number }} [opts={}] - `h24` for a 24-hour clock, `now` to override the current time.
 * @returns {string} The formatted date.
 *
 * @example
 * formatFinderDate(Date.now(), 'en'); // 'Today at 3:41 PM'
 * formatFinderDate(Date.now(), 'ko'); // '오늘 오후 3:41'
 */
export function formatFinderDate(ts: number, locale: Locale, opts: { h24?: boolean; now?: number } = {}): string {
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  const d = new Date(ts);
  const now = new Date(opts.now ?? Date.now());
  const time = new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', hour12: !opts.h24 }).format(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return locale === 'ko' ? `오늘 ${time}` : `Today at ${time}`;
  if (sameDay(d, yesterday)) return locale === 'ko' ? `어제 ${time}` : `Yesterday at ${time}`;
  const date = new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  return locale === 'ko' ? `${date} ${time}` : `${date} at ${time}`;
}

/**
 * Formats an item count.
 *
 * Uses locale digit grouping and "item"/"items" pluralization in English.
 *
 * @param {number} n - Number of items.
 * @param {Locale} locale - Display language.
 * @returns {string} The count text.
 *
 * @example
 * itemCount(1, 'en'); // '1 item'
 * itemCount(3, 'ko'); // '3개 항목'
 */
export function itemCount(n: number, locale: Locale): string {
  if (locale === 'ko') return `${n.toLocaleString('ko-KR')}개 항목`;
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'item' : 'items'}`;
}

const DIGIT_NEEDS_EU = new Set(['0', '3', '6']); /** Digits whose Korean reading (0 yeong, 3 sam, 6 yuk) ends in a final consonant other than ㄹ. */
const LATIN_NEEDS_EU = /(?:[bckmnpt]|ng)$/i; /** Latin word endings pronounced with a final consonant in Korean (TextEdit, Mac, Zoom, Bing). */

/**
 * Appends the Korean particle "(으)로" to a word.
 *
 * For a final Hangul syllable the batchim decides: none or ㄹ (jongseong index 8) takes "로",
 * any other final consonant takes "으로". Digits and Latin letters use a pronunciation guess
 * (`DIGIT_NEEDS_EU`, `LATIN_NEEDS_EU`). Any other last character gets the neutral "(으)로".
 *
 * @param {string} word - The word, e.g. an app name.
 * @returns {string} The word followed by the matching particle.
 *
 * @example
 * withRo('TextEdit'); // 'TextEdit으로'
 * withRo('Safari'); // 'Safari로'
 */
export function withRo(word: string): string {
  const w = word.trim();
  const last = w.slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return word + (jong === 0 || jong === 8 ? '로' : '으로');
  }
  if (/[0-9]/.test(last)) return word + (DIGIT_NEEDS_EU.has(last) ? '으로' : '로');
  if (/[a-z]/i.test(last)) return word + (LATIN_NEEDS_EU.test(w) ? '으로' : '로');
  return word + '(으)로';
}

/* ───────────────────────── Disk ───────────────────────── */

export const DISK = { capacity: 494_384_795_648, system: 186_920_000_000 } as const; /** Simulated startup disk: total capacity and a fixed system footprint, in bytes. */

/**
 * Computes the simulated startup disk usage.
 *
 * Used space is the fixed system footprint plus the size of every file in the node map.
 * Available space never goes below zero.
 *
 * @param {Record<string, FSNode>} nodes - The file system node map.
 * @returns {{ capacity: number; used: number; available: number }} Disk figures in bytes.
 *
 * @example
 * diskUsage({}).available; // 307464795648
 * const { used, capacity } = diskUsage(nodes);
 */
export function diskUsage(nodes: Record<string, FSNode>): { capacity: number; used: number; available: number } {
  let bytes = 0;
  for (const p in nodes) if (nodes[p].type === 'file') bytes += fileSizeOf(nodes[p]);
  const used = DISK.system + bytes;
  return { capacity: DISK.capacity, used, available: Math.max(0, DISK.capacity - used) };
}

/**
 * Rounds a file size up to whole 4 KB disk blocks.
 *
 * Any non-empty file occupies at least one 4096-byte block; an empty file occupies none.
 *
 * @param {number} bytes - Logical file size.
 * @returns {number} Bytes occupied on disk (0 for an empty file).
 *
 * @example
 * onDiskSize(1); // 4096
 * onDiskSize(5000); // 8192
 */
export function onDiskSize(bytes: number): number {
  return bytes === 0 ? 0 : Math.ceil(bytes / 4096) * 4096;
}

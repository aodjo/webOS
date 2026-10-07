/**
 * Notes: a three-pane notes app over real markdown/text files in ~/Documents/Notes.
 *
 * Folders are subdirectories, "Recently Deleted" shows notes moved to the Trash from the notes
 * folder, and pinned notes carry `meta.pinned`. The editor autosaves and renames the file after
 * its title, and everything live-updates when files change elsewhere (Finder, Terminal, TextEdit).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronLeft, ListChecks, PanelLeft, Share, SquarePen, Trash } from 'lucide-react';
import {
  COMMON,
  PATHS,
  basename,
  dialogs,
  dirname,
  dotNameError,
  downloadFile,
  extname,
  fmt,
  fs,
  getDragPaths,
  hasHostFiles,
  importHostFiles,
  isWithin,
  join,
  kindOf,
  normalize,
  renamePath,
  revealInFinder,
  setDragPaths,
  showContextMenu,
  showFSError,
  trashPaths,
  useAppMenus,
  useBeforeClose,
  useFS,
  useLocale,
  useT,
  useWM,
  wm,
  type AppProps,
  type FSNode,
  type LString,
  type MenuDef,
  type MenuItem,
} from '@/kernel';
import { GlassGroup } from '@/components/Glass';
import { EmptyState, SearchField } from '@/components/ui';
import { isComposing, type LineStyle } from '../textedit/editing';
import { NoteEditor, type NoteEditorHandle } from './Editor';
import { NoteList, type ListEntry, type NoteRowData } from './NoteList';
import { Sidebar, type FolderInfo } from './Sidebar';
import { dateGroup, listDate, noteSnippet, noteTitle } from './model';
import styles from './Notes.module.css';

/**
 * Check whether a note is pinned.
 *
 * A note counts as pinned when `meta.pinned` is truthy or when `meta.tag` is "pinned". The tag
 * marker shares its field with Finder color tags; `togglePin` clears it whenever it writes
 * `meta.pinned`.
 *
 * @param {FSNode} n - The note's file node.
 * @returns {boolean} True when the note is pinned.
 *
 * @example
 * const node = fs.stat(join(PATHS.notes, 'Ideas.md'));
 * if (node && isPinned(node)) console.log('pinned');
 */
const isPinned = (n: FSNode) => !!n.meta?.pinned || n.meta?.tag === 'pinned';

/* ───────────────────────── Strings ───────────────────────── */

const S = {
  notesFolder: { en: 'Notes', ko: '메모' },
  allNotes: { en: 'All Notes', ko: '모든 메모' },
  recentlyDeleted: { en: 'Recently Deleted', ko: '최근 삭제된 항목' },
  searchResults: { en: 'Search Results', ko: '검색 결과' },
  pinned: { en: 'Pinned', ko: '고정됨' },
  noNotes: { en: 'No Notes', ko: '메모 없음' },
  noResults: { en: 'No Results', ko: '결과 없음' },
  newNote: { en: 'New Note', ko: '새로운 메모' },
  noText: { en: 'No additional text', ko: '추가 텍스트 없음' },
  count: { en: '{n} notes', ko: '메모 {n}개' },
  countOne: { en: '1 note', ko: '메모 1개' },
  title: { en: 'Title', ko: '제목' },
  search: { en: 'Search', ko: '검색' },
  compose: { en: 'New Note', ko: '새로운 메모' },
  delete: { en: 'Delete', ko: '삭제' },
  deleteNote: { en: 'Delete Note', ko: '메모 삭제' },
  format: { en: 'Format', ko: '포맷' },
  checklist: { en: 'Checklist', ko: '체크리스트' },
  share: { en: 'Share', ko: '공유' },
  back: { en: 'Back', ko: '뒤로' },
  toggleSidebar: { en: 'Show or Hide Sidebar', ko: '사이드바 보기 또는 가리기' },
  showSidebar: { en: 'Show Sidebar', ko: '사이드바 보기' },
  hideSidebar: { en: 'Hide Sidebar', ko: '사이드바 가리기' },
  newFolder: { en: 'New Folder', ko: '새로운 폴더' },
  newFolderMsg: { en: 'Name:', ko: '이름:' },
  renameFolder: { en: 'Rename Folder…', ko: '폴더 이름 변경…' },
  deleteFolder: { en: 'Delete Folder…', ko: '폴더 삭제…' },
  /**
   * Build the confirmation title for deleting a folder.
   *
   * Returns a new `LString` with the folder name inserted in curly quotes in both languages,
   * ready to be passed to `dialogs.confirm` as its title.
   *
   * @param {string} n - Name of the folder being deleted.
   * @returns {LString} The localized question naming the folder.
   *
   * @example
   * const title = t(S.deleteFolderTitle('Work'));
   */
  deleteFolderTitle: (n: string) => ({ en: `Are you sure you want to delete the folder “${n}”?`, ko: `“${n}” 폴더를 삭제하겠습니까?` }),
  deleteFolderMsg: { en: 'The folder and the notes in it will be moved to the Trash.', ko: '폴더와 그 안의 메모가 휴지통으로 이동됩니다.' },
  pin: { en: 'Pin Note', ko: '메모 고정' },
  unpin: { en: 'Unpin Note', ko: '메모 고정 해제' },
  moveTo: { en: 'Move to', ko: '다음으로 이동' },
  openInTextEdit: { en: 'Open in TextEdit', ko: '텍스트 편집기에서 열기' },
  showInFinder: { en: 'Show in Finder', ko: 'Finder에서 보기' },
  copy: { en: 'Copy', ko: '복사하기' },
  exportMd: { en: 'Download as Markdown', ko: 'Markdown으로 다운로드' },
  recover: { en: 'Recover', ko: '복구' },
  deleteNow: { en: 'Delete Immediately…', ko: '즉시 삭제…' },
  deletedBanner: { en: 'Recently deleted notes can’t be edited. To edit this note, you’ll need to recover it.', ko: '최근 삭제된 메모는 편집할 수 없습니다. 이 메모를 편집하려면 복구해야 합니다.' },
  styleTitle: { en: 'Title', ko: '제목' },
  styleHeading: { en: 'Heading', ko: '머리말' },
  styleSubheading: { en: 'Subheading', ko: '부머리말' },
  styleBody: { en: 'Body', ko: '본문' },
  styleBullet: { en: 'Bulleted List', ko: '글머리 기호 목록' },
  styleDash: { en: 'Dashed List', ko: '대시 목록' },
  styleNumber: { en: 'Numbered List', ko: '번호 매기기 목록' },
  styleChecklist: { en: 'Checklist', ko: '체크리스트' },
  markChecked: { en: 'Mark as Checked', ko: '선택됨으로 표시' },
  find: { en: 'Find…', ko: '찾기…' },
  view: COMMON.view,
}; /** Localized strings used by the Notes window, its menus and dialogs. */

const STYLES: { style: LineStyle; label: LString; shortcut?: string }[] = [
  { style: 'title', label: S.styleTitle },
  { style: 'heading', label: S.styleHeading, shortcut: 'mod+shift+h' },
  { style: 'subheading', label: S.styleSubheading, shortcut: 'mod+shift+j' },
  { style: 'body', label: S.styleBody, shortcut: 'mod+shift+b' },
  { style: 'bullet', label: S.styleBullet, shortcut: 'mod+shift+7' },
  { style: 'dash', label: S.styleDash, shortcut: 'mod+shift+8' },
  { style: 'number', label: S.styleNumber, shortcut: 'mod+shift+9' },
]; /** Paragraph styles offered by the Format menu and the "Aa" button, with their shortcuts. */

/* ───────────────────────── Data ───────────────────────── */

const NOTES_PREFIX = PATHS.notes + '/'; /** Path prefix of every node inside the notes folder. */
const TRASH_PREFIX = PATHS.trash + '/'; /** Path prefix of every node inside the Trash. */
const NARROW = 640; /** Window width in pixels below which the app switches to the single-pane phone layout. */

/**
 * Check whether a file node is a note.
 *
 * Notes are visible (not dot-prefixed) files that are markdown or have a ".txt" extension.
 *
 * @param {Pick<FSNode, 'type' | 'name'>} n - The node, or any object with its type and name.
 * @returns {boolean} True when the node is shown as a note.
 *
 * @example
 * const ok = isNoteFile({ type: 'file', name: 'Ideas.md' });
 * console.log(ok); // true
 */
function isNoteFile(n: Pick<FSNode, 'type' | 'name'>): boolean {
  if (n.type !== 'file' || n.name.startsWith('.')) return false;
  return kindOf(n) === 'markdown' || extname(n.name) === 'txt';
}

/**
 * Zustand selector returning every FS node the Notes app depends on.
 *
 * Collects nodes inside the notes folder (skipping any path with a dot-prefixed segment) and
 * every node inside the Trash. The result is an array of the store's own node objects, so a
 * shallow comparison (`useShallow`) re-renders only when a relevant node is added, removed or
 * replaced.
 *
 * @param {Object} s - The FS store state.
 * @param {Record<string, FSNode>} s.nodes - Flat path-to-node map of the file system.
 * @returns {FSNode[]} The relevant nodes in map iteration order.
 *
 * @example
 * const nodes = useFS(useShallow(selectNodes));
 */
function selectNodes(s: { nodes: Record<string, FSNode> }): FSNode[] {
  const out: FSNode[] = [];
  for (const p in s.nodes) {
    if (p.startsWith(NOTES_PREFIX)) {
      if (!p.slice(NOTES_PREFIX.length).split('/').some((seg) => seg.startsWith('.'))) out.push(s.nodes[p]);
    } else if (p.startsWith(TRASH_PREFIX)) out.push(s.nodes[p]);
  }
  return out;
}

/** Notes-app view of the file system, derived from the nodes returned by `selectNodes`. */
interface NotesData {
  /** Subfolders of the notes folder, sorted by path. */
  folders: FSNode[];
  /** Note files inside the notes folder. */
  notes: FSNode[];
  /** Note files in the Trash that were deleted from the notes folder. */
  trashed: FSNode[];
  /** Trash path → where the note was before it was deleted. */
  origins: Map<string, string>;
  /** Note path → creation time (stable across renames and moves, so the open note can be followed). */
  created: Map<string, number>;
}

/**
 * Derive folders, notes, trashed notes and lookup maps from the relevant FS nodes.
 *
 * Nodes outside the Trash are split into folders and note files. For the Trash, only top-level
 * items whose `meta.trashedFrom` lies inside the notes folder are considered; every note file
 * under such an item is listed as trashed and its original path is reconstructed from the
 * item's `trashedFrom` plus the remaining relative path. Folders are sorted with a numeric,
 * case-insensitive collator.
 *
 * @param {FSNode[]} nodes - Nodes returned by `selectNodes`.
 * @returns {NotesData} The derived notes data.
 *
 * @example
 * const data = useMemo(() => deriveData(nodes), [nodes]);
 * console.log(data.notes.length);
 */
function deriveData(nodes: FSNode[]): NotesData {
  const folders: FSNode[] = [];
  const notes: FSNode[] = [];
  const trashed: FSNode[] = [];
  const origins = new Map<string, string>();
  const created = new Map<string, number>();
  const roots = new Map<string, string>();
  for (const n of nodes) {
    if (!n.path.startsWith(TRASH_PREFIX)) {
      if (n.type === 'dir') folders.push(n);
      else if (isNoteFile(n)) notes.push(n);
    } else if (dirname(n.path) === PATHS.trash && n.meta?.trashedFrom && isWithin(n.meta.trashedFrom, PATHS.notes)) {
      roots.set(n.path, n.meta.trashedFrom);
    }
  }
  for (const n of nodes) {
    if (!n.path.startsWith(TRASH_PREFIX) || !isNoteFile(n)) continue;
    const root = TRASH_PREFIX + n.path.slice(TRASH_PREFIX.length).split('/')[0];
    const from = roots.get(root);
    if (!from) continue;
    trashed.push(n);
    origins.set(n.path, from + n.path.slice(root.length));
  }
  for (const n of notes) created.set(n.path, n.createdAt);
  for (const n of trashed) created.set(n.path, n.createdAt);
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  folders.sort((a, b) => coll.compare(a.path, b.path));
  return { folders, notes, trashed, origins, created };
}

const rowCache = new WeakMap<FSNode, { key: string; row: NoteRowData }>(); /** List-row data per immutable node object, so unchanged rows keep their identity for memoized rendering. */

/**
 * Get the list-row data for a node, reusing the cached object when possible.
 *
 * FS nodes are immutable, so a node object that is unchanged since the last render maps to the
 * same row object as long as `key` (which encodes the other inputs such as time and locale) is
 * the same. Otherwise `build` is called and its result replaces the cache entry.
 *
 * @param {FSNode} n - The note's file node.
 * @param {string} key - Cache key for the non-node inputs of the row.
 * @param {() => NoteRowData} build - Creates the row data on a cache miss.
 * @returns {NoteRowData} The cached or newly built row data.
 *
 * @example
 * const row = cachedRow(node, `${now}|${locale}`, () => build(node, node.content ?? ''));
 */
function cachedRow(n: FSNode, key: string, build: () => NoteRowData): NoteRowData {
  const hit = rowCache.get(n);
  if (hit && hit.key === key) return hit.row;
  const row = build();
  rowCache.set(n, { key, row });
  return row;
}

/* ───────────────────────── Persistence ───────────────────────── */

const SEL_KEY = 'webos.notes.selected'; /** localStorage key holding the last scope and selected note path. */
const SIDEBAR_KEY = 'webos.notes.sidebar'; /** localStorage key holding whether the sidebar is shown in the wide layout. */

/**
 * Read a JSON value from localStorage.
 *
 * Returns `fallback` when the key is missing, the stored text is not valid JSON, or storage is
 * unavailable.
 *
 * @param {string} key - The localStorage key.
 * @param {T} fallback - Value returned when nothing usable is stored.
 * @returns {T} The parsed value or the fallback.
 *
 * @example
 * const open = readJSON(SIDEBAR_KEY, true);
 */
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write a value to localStorage as JSON.
 *
 * Errors (storage unavailable, quota exceeded) are ignored.
 *
 * @param {string} key - The localStorage key.
 * @param {unknown} value - Value to serialize and store.
 * @returns {void}
 *
 * @example
 * writeJSON(SIDEBAR_KEY, false);
 */
function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage unavailable or full: the value is not persisted. */
  }
}

/**
 * Create a callback with a stable identity that always runs the latest closure.
 *
 * The latest `fn` is stored in a ref during the layout phase of every render, and the returned
 * function (created once) forwards its arguments to it. This lets handlers be passed to memoized
 * children or effect dependency lists without changing identity.
 *
 * @param {(...args: A) => R} fn - The current implementation of the callback.
 * @returns {(...args: A) => R} A function with a stable identity that calls the latest `fn`.
 *
 * @example
 * const onSelect = useStable((path: string) => setSelected(path));
 * return <NoteList onSelect={onSelect} />;
 */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/* ───────────────────────── Component ───────────────────────── */

/** The note selected in the list and shown in the editor. */
interface Selection {
  /** Path of the selected note, or null when nothing is selected. */
  path: string | null;
  /** Creation time of the selected note: lets the selection follow it across renames/moves. */
  createdAt: number | null;
  /** Editor instance id: changes when a different note is opened, not when the note is renamed. */
  key: number;
  /** Whether the editor focuses the title field when it mounts. */
  focusTitle: boolean;
}

/**
 * Get the creation time of the node at a path.
 *
 * Looks the path up with `fs.stat`. The creation time survives renames and moves, which is what
 * lets a `Selection` follow its note.
 *
 * @param {string | null} path - Path of the note, or null.
 * @returns {number | null} The node's `createdAt`, or null when the path is null or missing.
 *
 * @example
 * const createdAt = createdAtOf(join(PATHS.notes, 'Ideas.md'));
 */
const createdAtOf = (path: string | null) => (path ? (fs.stat(path)?.createdAt ?? null) : null);

/**
 * The Notes app window: folder sidebar, notes list and editor.
 *
 * The initial scope and selection come from `args.path` when given, otherwise from the state
 * saved in localStorage. The list is derived from the FS store and filtered by the current scope
 * ("all", "trash", or a folder path; a folder path that does not exist falls back to "all") or
 * by the search query, then grouped into pinned and date sections. The unsaved text of the open
 * note (`live`) is used for its row and for search so the list updates while typing.
 *
 * The selection is followed across renames and moves by the note's creation time; when the
 * selected note is not listed and cannot be followed, the first listed note is selected.
 * A layout effect adopts the resolved selection before paint, and a different note gets a fresh
 * editor instance (`sel.key`) while a renamed one keeps its editor. Notes created in this
 * session are remembered by creation time (`newNotes`); once another note is selected, however
 * the selection moved (click, search, deletion elsewhere), an effect that runs after the old
 * editor saved deletes them if they are still empty.
 *
 * The sidebar lists the default "Notes" folder (notes directly in ~/Documents/Notes) followed by
 * its subfolders with note counts. A one-minute timer refreshes relative dates ("Today", times),
 * the scope, selection and sidebar state are persisted to localStorage, and re-launching the
 * app with a `path` argument (window `argsVersion` change) clears the search and reveals that
 * note.
 *
 * Below `NARROW` pixels the window shows one pane at a time (list or editor) and the sidebar
 * becomes a drawer. Markdown/text files dropped from the host computer are imported into the
 * current folder.
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - Id of the window hosting the app.
 * @param {AppArgs} props.args - Launch arguments; a string `args.path` selects that note.
 * @returns {JSX.Element} The Notes window content.
 *
 * @example
 * <Notes windowId="w1" args={{ path: join(PATHS.notes, 'Ideas.md') }} />
 */
export default function Notes({ windowId, args }: AppProps) {
  const t = useT();
  const locale = useLocale();

  const nodes = useFS(useShallow(selectNodes));
  const data = useMemo(() => deriveData(nodes), [nodes]);

  const [initial] = useState(() => {
    const saved = readJSON<{ scope?: string; path?: string | null }>(SEL_KEY, {});
    const argPath = typeof args.path === 'string' ? normalize(args.path) : null;
    if (argPath) return { scope: isWithin(argPath, PATHS.trash) ? 'trash' : 'all', path: argPath };
    return { scope: typeof saved.scope === 'string' ? saved.scope : 'all', path: typeof saved.path === 'string' ? saved.path : null };
  });
  const [scope, setScope] = useState(initial.scope);
  const [sel, setSel] = useState<Selection>(() => ({ path: initial.path, createdAt: createdAtOf(initial.path), key: 0, focusTitle: false }));
  const [query, setQuery] = useState('');
  const [live, setLive] = useState<{ path: string; content: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => readJSON(SIDEBAR_KEY, true));
  const [drawer, setDrawer] = useState(false);
  const [width, setWidth] = useState(880);
  const [pane, setPane] = useState<'list' | 'editor'>('list');
  const [now, setNow] = useState(() => Date.now());

  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NoteEditorHandle>(null);
  const searchRef = useRef<HTMLSpanElement>(null);
  const newNotes = useRef(new Set<number>());

  const narrow = width < NARROW;
  const showSidebar = narrow ? drawer : sidebarOpen;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => writeJSON(SIDEBAR_KEY, sidebarOpen), [sidebarOpen]);

  /* ── Derived list ── */

  const effScope = scope === 'all' || scope === 'trash' || scope === PATHS.notes || data.folders.some((f) => f.path === scope) ? scope : 'all';
  const searching = query.trim().length > 0;

  /**
   * Get the display name of a notes folder.
   *
   * The notes folder itself is shown with the localized "Notes" label; any other folder is shown
   * by its base name. Memoized on `t` so the list rebuilds when the locale changes.
   *
   * @param {string} dir - Folder path.
   * @returns {string} The localized "Notes" label for the notes folder, otherwise the folder name.
   *
   * @example
   * const label = folderLabel(PATHS.notes); // 'Notes'
   */
  const folderLabel = useCallback((dir: string) => (dir === PATHS.notes ? t(S.notesFolder) : basename(dir)), [t]);

  const entries = useMemo<ListEntry[]>(() => {
    const q = query.trim().toLowerCase();
    let base = q || effScope === 'all' ? data.notes : effScope === 'trash' ? data.trashed : data.notes.filter((n) => dirname(n.path) === effScope);
    /**
     * Get the current text of a note, preferring the unsaved editor text for the open note.
     *
     * When `live` belongs to this note its content is returned, so search matches what is being
     * typed; otherwise the stored file content (or an empty string) is used.
     *
     * @param {FSNode} n - The note's file node.
     * @returns {string} The live editor content for the open note, otherwise the file content.
     *
     * @example
     * const matches = contentOf(node).toLowerCase().includes(q);
     */
    const contentOf = (n: FSNode) => (live?.path === n.path ? live.content : (n.content ?? ''));
    if (q) base = base.filter((n) => contentOf(n).toLowerCase().includes(q) || n.name.toLowerCase().includes(q));
    const sorted = [...base].sort((a, b) => b.modifiedAt - a.modifiedAt);
    const showFolder = !!q || effScope === 'all' || effScope === 'trash';
    /**
     * Build the list-row data for a note from the given content.
     *
     * The folder label is included only in "All Notes", "Recently Deleted" and search results;
     * for trashed notes it names the folder the note was deleted from.
     *
     * @param {FSNode} n - The note's file node.
     * @param {string} content - Text used for the title and snippet.
     * @returns {NoteRowData} The row data shown in the notes list.
     *
     * @example
     * const data = build(node, node.content ?? '');
     */
    const build = (n: FSNode, content: string): NoteRowData => ({
      path: n.path,
      title: noteTitle(content),
      snippet: noteSnippet(content),
      date: listDate(n.modifiedAt, now, locale),
      folder: showFolder ? folderLabel(dirname(data.origins.get(n.path) ?? n.path)) : undefined,
      pinned: isPinned(n),
    });
    const cacheKey = `${now}|${locale}|${showFolder}`;
    /**
     * Get the list-row data for a note.
     *
     * The open note with unsaved edits is always rebuilt from the live text; every other note
     * goes through `cachedRow` so unchanged rows keep their identity.
     *
     * @param {FSNode} n - The note's file node.
     * @returns {NoteRowData} The row data shown in the notes list.
     *
     * @example
     * out.push({ type: 'note', note: row(node) });
     */
    const row = (n: FSNode): NoteRowData => (live?.path === n.path ? build(n, live.content) : cachedRow(n, cacheKey, () => build(n, n.content ?? '')));
    const out: ListEntry[] = [];
    if (q) {
      if (sorted.length) out.push({ type: 'header', key: 'results', label: t(S.searchResults) });
      for (const n of sorted) out.push({ type: 'note', note: row(n) });
      return out;
    }
    const pinned = effScope === 'trash' ? [] : sorted.filter(isPinned);
    if (pinned.length) {
      out.push({ type: 'header', key: 'pinned', label: t(S.pinned) });
      for (const n of pinned) out.push({ type: 'note', note: row(n) });
    }
    let group = '';
    for (const n of sorted) {
      if (pinned.includes(n)) continue;
      const g = dateGroup(n.modifiedAt, now, locale);
      if (g.key !== group) {
        out.push({ type: 'header', key: g.key, label: g.label });
        group = g.key;
      }
      out.push({ type: 'note', note: row(n) });
    }
    return out;
  }, [data, effScope, query, live, now, locale, t, folderLabel]);

  const order = useMemo(() => entries.flatMap((e) => (e.type === 'note' ? [e.note.path] : [])), [entries]);

  const resolved = useMemo(() => {
    if (sel.path && order.includes(sel.path)) return { path: sel.path, same: true };
    const followed = sel.createdAt !== null ? order.find((p) => data.created.get(p) === sel.createdAt) : undefined;
    if (followed) return { path: followed, same: true };
    return { path: order[0] ?? null, same: false };
  }, [order, sel.path, sel.createdAt, data]);
  const effective = resolved.path;

  useLayoutEffect(() => {
    if (resolved.path === sel.path) return;
    setSel((s) => ({
      path: resolved.path,
      createdAt: createdAtOf(resolved.path),
      key: resolved.same ? s.key : s.key + 1,
      focusTitle: resolved.same && s.focusTitle,
    }));
  }, [resolved, sel.path]);

  useEffect(() => writeJSON(SEL_KEY, { scope: effScope, path: effective }), [effScope, effective]);

  useEffect(() => {
    for (const created of [...newNotes.current]) {
      if (created === sel.createdAt) continue;
      newNotes.current.delete(created);
      const n = fs.walk(PATHS.notes).find((x) => x.type === 'file' && x.createdAt === created);
      if (n && !(n.content ?? '').trim()) fs.rm(n.path, { force: true });
    }
  }, [sel.createdAt]);

  const selectedNode = effective ? (fs.stat(effective) ?? null) : null;
  const readOnly = !!effective && isWithin(effective, PATHS.trash);
  const pinned = !!selectedNode && isPinned(selectedNode);
  const folders: FolderInfo[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of data.notes) counts.set(dirname(n.path), (counts.get(dirname(n.path)) ?? 0) + 1);
    return [
      { path: PATHS.notes, name: t(S.notesFolder), depth: 0, count: counts.get(PATHS.notes) ?? 0, fixed: true },
      ...data.folders.map((f) => ({
        path: f.path,
        name: f.name,
        depth: f.path.slice(NOTES_PREFIX.length).split('/').length - 1,
        count: counts.get(f.path) ?? 0,
      })),
    ];
  }, [data, t]);

  /* ── Actions ── */

  /**
   * Delete a note created in this session if it is still empty.
   *
   * Only files whose creation time is in `newNotes` are affected; the entry is removed from the
   * set either way, and the file is deleted permanently when its content is blank.
   *
   * @param {string | null} path - Path of the note being left, or null.
   * @returns {void}
   * @throws {FSError} When the empty note cannot be removed (e.g. its folder is locked).
   *
   * @example
   * discardIfEmpty(effective);
   */
  const discardIfEmpty = (path: string | null) => {
    const n = path ? fs.stat(path) : null;
    if (!n || n.type !== 'file' || !newNotes.current.delete(n.createdAt)) return;
    if (!(n.content ?? '').trim()) fs.rm(n.path, { force: true });
  };

  /**
   * Build a `Selection` for a path, looking up the note's creation time.
   *
   * The creation time comes from `createdAtOf`, so the resulting selection can follow the note
   * if it is later renamed or moved.
   *
   * @param {string | null} path - Path of the note to select, or null for no selection.
   * @param {number} key - Editor instance id for the selection.
   * @param {boolean} [focusTitle=false] - Whether the editor focuses the title when it mounts.
   * @returns {Selection} The new selection state.
   *
   * @example
   * setSel((s) => selectionFor(path, s.key + 1, true));
   */
  const selectionFor = (path: string | null, key: number, focusTitle = false): Selection => ({ path, createdAt: createdAtOf(path), key, focusTitle });

  /**
   * Leave the open note: save it and drop it if it is a brand-new empty note.
   *
   * Flushes the editor silently (no rename callback), passes the resulting path to
   * `discardIfEmpty`, and clears the live editor text used by the list.
   *
   * @returns {void}
   * @throws {FSError} When a brand-new empty note cannot be removed.
   *
   * @example
   * leaveCurrent();
   * setScope(next);
   */
  const leaveCurrent = () => {
    const current = editorRef.current?.flush({ silent: true }) ?? effective;
    discardIfEmpty(current);
    setLive(null);
  };

  /**
   * Select a note in the list and show it in the editor.
   *
   * Selecting a different note first leaves the current one and then opens the new one in a
   * fresh editor instance. Selecting the open note again only focuses its title when
   * `opts.focusTitle` is set. In the narrow layout the editor pane is shown.
   *
   * @param {string} path - Path of the note to select.
   * @param {Object} [opts={}] - Selection options.
   * @param {boolean} [opts.focusTitle] - Focus the title field of the note.
   * @returns {void}
   * @throws {FSError} When the note being left is a brand-new empty note that cannot be removed.
   *
   * @example
   * select(join(PATHS.notes, 'Ideas.md'), { focusTitle: true });
   */
  const select = useStable((path: string, opts: { focusTitle?: boolean } = {}) => {
    if (path !== effective) {
      leaveCurrent();
      setSel((s) => selectionFor(path, s.key + 1, !!opts.focusTitle));
    } else if (opts.focusTitle) editorRef.current?.focus('title');
    if (narrow) setPane('editor');
  });

  /**
   * Switch the list to another scope (All Notes, Recently Deleted or a folder).
   *
   * A different scope leaves the current note and clears the search. The sidebar drawer is
   * closed, and in the narrow layout the list pane is shown.
   *
   * @param {string} next - "all", "trash" or a folder path.
   * @returns {void}
   * @throws {FSError} When the note being left is a brand-new empty note that cannot be removed.
   *
   * @example
   * changeScope('trash');
   */
  const changeScope = (next: string) => {
    if (next !== effScope) {
      leaveCurrent();
      setScope(next);
      setQuery('');
    }
    setDrawer(false);
    if (narrow) setPane('list');
  };

  /**
   * Create an empty note and open it with the title focused.
   *
   * The note is written to the current folder (or the notes folder in "All Notes" and "Recently
   * Deleted", which switches back to "All Notes") under a unique "New Note.md" name, and its
   * creation time is recorded so it is discarded again if left empty. Errors while creating the
   * note are shown in an alert.
   *
   * @returns {void}
   * @throws {FSError} When the note being left is a brand-new empty note that cannot be removed.
   *
   * @example
   * <button onClick={newNote}>New Note</button>
   */
  const newNote = () => {
    leaveCurrent();
    const dir = effScope !== 'all' && effScope !== 'trash' ? effScope : PATHS.notes;
    try {
      fs.mkdir(dir, { recursive: true });
      const node = fs.writeFile(join(dir, fs.uniqueName(dir, `${t(S.newNote)}.md`)), '');
      newNotes.current.add(node.createdAt);
      setQuery('');
      if (effScope === 'trash') setScope('all');
      setSel((s) => selectionFor(node.path, s.key + 1, true));
      setPane('editor');
    } catch (e) {
      void showFSError(e, windowId);
    }
  };

  /**
   * Get the current path of a note, saving it first if it is the open one.
   *
   * Flushing the editor writes pending edits and may rename the file after its title, so the
   * returned path is the one to act on.
   *
   * @param {string} path - Path of the note as known to the caller.
   * @returns {string} The note's path after saving.
   *
   * @example
   * revealInFinder(settle(path));
   */
  const settle = (path: string) => (path === effective ? (editorRef.current?.flush() ?? path) : path);

  /**
   * Delete a note: move it to the Trash, or erase it permanently from "Recently Deleted".
   *
   * The note is saved first, and it is removed from `newNotes` so it is not discarded twice. If
   * it is the selected note, the selection moves to the next note in list order (or the previous
   * one). Moving to the Trash updates the selection immediately; a permanent delete asks for
   * confirmation and moves the selection only if the file was actually deleted.
   *
   * @async
   * @param {string} path - Path of the note to delete.
   * @returns {Promise<void>} Resolves when the note was trashed, deleted, or the dialog was cancelled.
   *
   * @example
   * await deleteNote(effective);
   */
  const deleteNote = useStable(async (path: string) => {
    const current = settle(path);
    const i = order.indexOf(path);
    const next = order[i + 1] ?? order[i - 1] ?? null;
    /**
     * Move the selection to the neighbouring note if the deleted note is the selected one.
     *
     * The neighbour (`next`) is computed from the list order before the delete; the new
     * selection gets a fresh editor instance id.
     *
     * @returns {false | void} False when the deleted note was not selected.
     *
     * @example
     * if (!fs.exists(current)) selectNext();
     */
    const selectNext = () => path === effective && setSel((s) => selectionFor(next, s.key + 1));
    const node = fs.stat(current);
    if (node) newNotes.current.delete(node.createdAt);
    if (isWithin(current, PATHS.trash)) {
      await trashPaths([current], windowId);
      if (!fs.exists(current)) selectNext();
      return;
    }
    selectNext();
    await trashPaths([current], windowId);
  });

  /**
   * Pin or unpin a note.
   *
   * Writes the inverted pinned state to `meta.pinned`. A `meta.tag` of "pinned" is cleared at the
   * same time, which frees the Finder color-tag field. Missing paths are ignored.
   *
   * @param {string} path - Path of the note.
   * @returns {void}
   *
   * @example
   * togglePin(effective);
   */
  const togglePin = (path: string) => {
    const n = fs.stat(path);
    if (n) fs.setMeta(path, { pinned: !isPinned(n), ...(n.meta?.tag === 'pinned' ? { tag: undefined } : {}) });
  };

  /**
   * Move a note into another folder.
   *
   * The note is saved first and moved under a unique name; nothing happens when it is already in
   * `dir`. A note moved out of the Trash loses its `trashedFrom` marker, and the selection follows
   * the open note to its new path. File system errors are shown in an alert.
   *
   * @param {string} path - Path of the note to move.
   * @param {string} dir - Destination folder path.
   * @returns {void}
   *
   * @example
   * moveNote(path, join(PATHS.notes, 'Work'));
   */
  const moveNote = (path: string, dir: string) => {
    const current = settle(path);
    if (dirname(current) === dir) return;
    try {
      const next = fs.moveInto(current, dir);
      if (isWithin(current, PATHS.trash)) fs.setMeta(next, { trashedFrom: undefined });
      if (path === effective) setSel((s) => ({ ...s, path: next }));
    } catch (e) {
      void showFSError(e, windowId);
    }
  };

  /**
   * Restore a note from "Recently Deleted" to the folder it was deleted from.
   *
   * The destination comes from `data.origins` (or the notes folder for unknown origins); when
   * that folder does not exist, the note goes to the notes folder instead. The note is moved
   * under a unique name and its `trashedFrom` marker is cleared. File system errors are shown in
   * an alert.
   *
   * @param {string} path - Path of the note inside the Trash.
   * @returns {void}
   *
   * @example
   * recover(effective);
   */
  const recover = (path: string) => {
    const origin = data.origins.get(path) ?? join(PATHS.notes, basename(path));
    let dir = dirname(origin);
    try {
      if (!fs.isDir(dir)) {
        dir = PATHS.notes;
        fs.mkdir(dir, { recursive: true });
      }
      const target = join(dir, fs.uniqueName(dir, basename(origin)));
      fs.move(path, target);
      fs.setMeta(target, { trashedFrom: undefined });
    } catch (e) {
      void showFSError(e, windowId);
    }
  };

  /**
   * Ask for a name and create a notes folder, then show it.
   *
   * Slashes in the name become "-", an empty or cancelled name does nothing, and a dot-prefixed
   * name shows an alert instead. The folder is created under a unique name inside the notes
   * folder and becomes the current scope. File system errors are shown in an alert.
   *
   * @async
   * @returns {Promise<void>} Resolves once the folder was created or the prompt was dismissed.
   *
   * @example
   * void newFolder();
   */
  const newFolder = async () => {
    const name = await dialogs.prompt({ windowId, appId: 'notes', title: S.newFolder, message: S.newFolderMsg, defaultValue: t(S.newFolder) });
    const clean = name?.trim().replace(/\//g, '-');
    if (!clean) return;
    if (dotNameError(clean, windowId)) return;
    try {
      fs.mkdir(PATHS.notes, { recursive: true });
      const dir = fs.mkdir(join(PATHS.notes, fs.uniqueName(PATHS.notes, clean, true))).path;
      changeScope(dir);
    } catch (e) {
      void showFSError(e, windowId);
    }
  };

  /**
   * Show the context menu of a folder in the sidebar.
   *
   * Offers Rename (renames the folder and keeps it as the scope when it is the current one),
   * Delete (after confirmation, leaves the open note if it is inside, moves the folder to the
   * Trash and falls back to "All Notes" when it was the scope) and New Folder.
   *
   * @param {MouseEvent} e - The contextmenu event whose coordinates position the menu.
   * @param {string} path - Path of the folder.
   * @returns {void}
   *
   * @example
   * <Sidebar onFolderMenu={folderMenu} />
   */
  const folderMenu = (e: MouseEvent, path: string) => {
    showContextMenu(e, [
      {
        label: S.renameFolder,
        action: async () => {
          const name = await dialogs.prompt({ windowId, appId: 'notes', title: S.renameFolder, message: S.newFolderMsg, defaultValue: basename(path) });
          if (!name) return;
          const next = renamePath(path, name.replace(/\//g, '-'), windowId);
          if (next && effScope === path) setScope(next);
        },
      },
      {
        label: S.deleteFolder,
        danger: true,
        action: async () => {
          const ok = await dialogs.confirm({ windowId, appId: 'notes', title: S.deleteFolderTitle(basename(path)), message: S.deleteFolderMsg, okLabel: S.delete, danger: true });
          if (!ok) return;
          if (effective && isWithin(effective, path)) leaveCurrent();
          await trashPaths([path], windowId);
          if (effScope === path) setScope('all');
        },
      },
      { separator: true },
      { label: S.newFolder, action: () => void newFolder() },
    ]);
  };

  /**
   * Show the context menu of a note in the list.
   *
   * Notes in the Trash get Recover and Delete Immediately. Other notes get Pin/Unpin, a Move to
   * submenu listing every notes folder (the current one checked and disabled), Open in TextEdit,
   * Show in Finder and Delete Note; the file actions save the note first.
   *
   * @param {MouseEvent} e - The contextmenu event whose coordinates position the menu.
   * @param {string} path - Path of the note.
   * @returns {void}
   *
   * @example
   * <NoteList onMenu={noteMenu} />
   */
  const noteMenu = useStable((e: MouseEvent, path: string) => {
    if (isWithin(path, PATHS.trash)) {
      showContextMenu(e, [
        { label: S.recover, action: () => recover(path) },
        { label: S.deleteNow, danger: true, action: () => void deleteNote(path) },
      ]);
      return;
    }
    const n = fs.stat(path);
    const targets = [PATHS.notes as string, ...data.folders.map((f) => f.path)];
    showContextMenu(e, [
      { label: n && isPinned(n) ? S.unpin : S.pin, action: () => togglePin(path) },
      { separator: true },
      {
        label: S.moveTo,
        submenu: targets.map((dir) => ({ label: folderLabel(dir), checked: dirname(path) === dir, disabled: dirname(path) === dir, action: () => moveNote(path, dir) })),
      },
      { label: S.openInTextEdit, action: () => wm.openPath(settle(path), 'textedit') },
      { label: S.showInFinder, action: () => revealInFinder(settle(path)) },
      { separator: true },
      { label: S.deleteNote, danger: true, action: () => void deleteNote(path) },
    ]);
  });

  /**
   * Start dragging a note from the list.
   *
   * Saves the note first and puts its (possibly renamed) path on the drag data so it can be
   * dropped on sidebar folders, Finder or the Desktop.
   *
   * @param {DragEvent} e - The dragstart event.
   * @param {string} path - Path of the dragged note.
   * @returns {void}
   *
   * @example
   * <NoteList onDragStart={onDragStart} />
   */
  const onDragStart = useStable((e: DragEvent, path: string) => setDragPaths(e, [settle(path)]));

  /**
   * Handle notes dropped on a sidebar entry.
   *
   * Only dragged paths that are note files are used. Dropping on "Recently Deleted" moves notes
   * that are not already in the Trash to the Trash (saving them first); dropping on "All Notes"
   * moves them to the notes folder, and dropping on a folder moves them there.
   *
   * @async
   * @param {DragEvent} e - The drop event carrying the dragged paths.
   * @param {string} target - "trash", "all" or a folder path.
   * @returns {Promise<void>} Resolves once the notes were moved or trashed.
   *
   * @example
   * <Sidebar onDropPaths={(e, target) => void onDropPaths(e, target)} />
   */
  const onDropPaths = async (e: DragEvent, target: string) => {
    const paths = getDragPaths(e).filter((p) => {
      const n = fs.stat(p);
      return !!n && isNoteFile(n);
    });
    if (!paths.length) return;
    if (target === 'trash') {
      await trashPaths(
        paths.filter((p) => !isWithin(p, PATHS.trash)).map((p) => settle(p)),
        windowId,
      );
      return;
    }
    for (const p of paths) moveNote(p, target === 'all' ? PATHS.notes : target);
  };

  /**
   * Accept files dragged in from the host computer.
   *
   * Prevents the default only when the drag carries host files, which allows the drop and shows
   * the copy cursor; in-app drags are left alone.
   *
   * @param {DragEvent} e - The dragover event.
   * @returns {void}
   *
   * @example
   * <div onDragOver={onHostDragOver} />
   */
  const onHostDragOver = (e: DragEvent) => {
    if (!hasHostFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  /**
   * Import markdown/text files dropped from the host computer as notes.
   *
   * Only files that qualify as notes by name are imported, into the current folder (or the notes
   * folder in "All Notes" and "Recently Deleted"). The first imported note is selected.
   *
   * @async
   * @param {DragEvent} e - The drop event carrying the host files.
   * @returns {Promise<void>} Resolves once the files were imported.
   * @throws {FSError} When selecting the imported note leaves a brand-new empty note that cannot
   *   be removed (the promise rejects).
   *
   * @example
   * <div onDrop={(e) => void onHostDrop(e)} />
   */
  const onHostDrop = async (e: DragEvent) => {
    if (!hasHostFiles(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => isNoteFile({ type: 'file', name: f.name }));
    if (!files.length) return;
    const dir = effScope !== 'all' && effScope !== 'trash' ? effScope : PATHS.notes;
    const { created } = await importHostFiles(files, dir);
    if (created[0]) select(created[0]);
  };

  /**
   * Show the Share menu below the toolbar button.
   *
   * Offers Copy (the editor's current text to the clipboard), Download as Markdown, Open in
   * TextEdit and Show in Finder; the file actions save the note first. Does nothing without a
   * selected note.
   *
   * @param {MouseEvent<HTMLButtonElement>} e - Click event of the Share button, used as the anchor.
   * @returns {void}
   *
   * @example
   * <button onClick={shareMenu}>Share</button>
   */
  const shareMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!effective) return;
    const r = e.currentTarget.getBoundingClientRect();
    const anchor = { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} };
    showContextMenu(anchor, [
      { label: S.copy, action: () => void navigator.clipboard?.writeText(editorRef.current?.content() ?? selectedNode?.content ?? '').catch(() => {}) },
      { label: S.exportMd, action: () => downloadFile(settle(effective)) },
      { separator: true },
      { label: S.openInTextEdit, action: () => wm.openPath(settle(effective), 'textedit') },
      { label: S.showInFinder, action: () => revealInFinder(settle(effective)) },
    ]);
  };

  /**
   * Show the paragraph-style menu below the "Aa" toolbar button.
   *
   * Lists every style from `STYLES` plus Checklist, with the style of the line at the caret
   * checked; choosing one applies it in the editor.
   *
   * @param {MouseEvent<HTMLButtonElement>} e - Click event of the "Aa" button, used as the anchor.
   * @returns {void}
   *
   * @example
   * <button onClick={formatMenu}>Aa</button>
   */
  const formatMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const current = editorRef.current?.lineStyle();
    showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} }, [
      ...STYLES.map<MenuItem>((s) => ({ label: s.label, checked: current === s.style, action: () => editorRef.current?.applyStyle(s.style) })),
      { separator: true },
      { label: S.styleChecklist, checked: current === 'checklist', action: () => editorRef.current?.applyStyle('checklist') },
    ]);
  };

  /**
   * Focus the search field and select its text.
   *
   * In the narrow layout the search field lives in the list pane, so when the editor pane is
   * shown the list pane is shown first and focusing waits for the next animation frame.
   *
   * @returns {void}
   *
   * @example
   * focusSearch();
   */
  const focusSearch = () => {
    /**
     * Focus and select the search input if it is mounted.
     *
     * Looks up the `<input>` inside the search field wrapper; when the field is not rendered
     * nothing happens.
     *
     * @returns {void}
     *
     * @example
     * requestAnimationFrame(run);
     */
    const run = () => {
      const input = searchRef.current?.querySelector('input');
      input?.focus();
      input?.select();
    };
    if (narrow && pane === 'editor') {
      setPane('list');
      requestAnimationFrame(run);
    } else run();
  };

  useBeforeClose(() => {
    leaveCurrent();
    return true;
  });

  const argsVersion = useWM((s) => s.windows.find((w) => w.id === windowId)?.argsVersion ?? 0);
  useEffect(() => {
    if (!argsVersion) return;
    const p = useWM.getState().windows.find((w) => w.id === windowId)?.args.path;
    if (typeof p !== 'string') return;
    const target = normalize(p);
    setQuery('');
    setScope(isWithin(target, PATHS.trash) ? 'trash' : 'all');
    select(target);
  }, [argsVersion, windowId, select]);

  /* ── Menus ── */

  const api = useRef({ newNote, newFolder, deleteNote, togglePin, focusSearch, settle });
  useLayoutEffect(() => {
    api.current = { newNote, newFolder, deleteNote, togglePin, focusSearch, settle };
  });

  /**
   * Run a standard editing command from the Edit menu on the focused field.
   *
   * When the focused element is inside this window it is focused again so the command targets
   * it, then the command runs through `document.execCommand`. Commands the browser does not
   * support are ignored.
   *
   * @param {'undo' | 'redo' | 'cut' | 'copy' | 'selectAll'} cmd - The editing command.
   * @returns {void}
   *
   * @example
   * editCommand('undo');
   */
  const editCommand = (cmd: 'undo' | 'redo' | 'cut' | 'copy' | 'selectAll') => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && rootRef.current?.contains(el)) el.focus();
    try {
      document.execCommand(cmd);
    } catch {
      /* Unsupported command: nothing happens. */
    }
  };

  const hasNote = !!effective;
  useAppMenus((): MenuDef[] => {
    /**
     * Get the latest action handlers, so menu items never call stale closures.
     *
     * Reads `api.current`, which a layout effect refreshes on every render, at the moment a menu
     * item runs rather than when the menus were built.
     *
     * @returns {typeof api.current} The handlers (newNote, newFolder, deleteNote, togglePin,
     *   focusSearch, settle) from the most recent render.
     *
     * @example
     * a().newNote();
     */
    const a = () => api.current;
    const sep: MenuItem = { separator: true };
    const canFormat = hasNote && !readOnly;
    /**
     * Build a Format-menu item for a paragraph style.
     *
     * Items are disabled when no editable note is open; choosing one applies the style in the
     * editor.
     *
     * @param {(typeof STYLES)[number]} s - The style entry with its label and shortcut.
     * @returns {MenuItem} The menu item.
     *
     * @example
     * const items = STYLES.slice(0, 4).map(fmtItem);
     */
    const fmtItem = (s: (typeof STYLES)[number]): MenuItem => ({ label: s.label, shortcut: s.shortcut, disabled: !canFormat, action: () => editorRef.current?.applyStyle(s.style) });
    return [
      {
        label: COMMON.file,
        items: [
          { label: S.newNote, shortcut: 'alt+n', action: () => a().newNote() },
          { label: S.newFolder, shortcut: 'alt+shift+n', action: () => void a().newFolder() },
          sep,
          { label: COMMON.close, shortcut: 'alt+w', action: () => void wm.close(windowId) },
          sep,
          { label: pinned ? S.unpin : S.pin, disabled: !hasNote || readOnly, action: () => effective && a().togglePin(effective) },
          { label: S.exportMd, disabled: !hasNote, action: () => effective && downloadFile(a().settle(effective)) },
          { label: S.showInFinder, disabled: !hasNote, action: () => effective && revealInFinder(a().settle(effective)) },
        ],
      },
      {
        label: COMMON.edit,
        items: [
          { label: COMMON.undo, shortcut: 'mod+z', action: () => editCommand('undo') },
          { label: COMMON.redo, shortcut: 'mod+shift+z', action: () => editCommand('redo') },
          sep,
          { label: COMMON.cut, shortcut: 'mod+x', action: () => editCommand('cut') },
          { label: COMMON.copy, shortcut: 'mod+c', action: () => editCommand('copy') },
          { label: COMMON.paste, shortcut: 'mod+v', action: () => void navigator.clipboard?.readText().then((txt) => document.execCommand('insertText', false, txt)).catch(() => {}) },
          { label: COMMON.selectAll, shortcut: 'mod+a', action: () => editCommand('selectAll') },
          sep,
          { label: S.deleteNote, shortcut: 'mod+backspace', disabled: !hasNote, action: () => effective && void a().deleteNote(effective) },
          sep,
          { label: S.find, shortcut: 'mod+f', action: () => a().focusSearch() },
        ],
      },
      {
        label: S.format,
        items: [
          ...STYLES.slice(0, 4).map(fmtItem),
          sep,
          ...STYLES.slice(4).map(fmtItem),
          sep,
          { label: S.styleChecklist, shortcut: 'mod+shift+l', disabled: !canFormat, action: () => editorRef.current?.applyStyle('checklist') },
          { label: S.markChecked, shortcut: 'mod+shift+u', disabled: !canFormat, action: () => editorRef.current?.markChecked() },
        ],
      },
      {
        label: S.view,
        items: [{ label: showSidebar ? S.hideSidebar : S.showSidebar, shortcut: 'mod+alt+s', action: () => (narrow ? setDrawer((v) => !v) : setSidebarOpen((v) => !v)) }],
      },
    ];
  }, [t, windowId, hasNote, effective, readOnly, pinned, showSidebar, narrow]);

  /* ── Render ── */

  const scopeTitle = searching ? t(S.searchResults) : effScope === 'all' ? t(S.allNotes) : effScope === 'trash' ? t(S.recentlyDeleted) : folderLabel(effScope);
  const noteCount = order.length;
  const countLabel = noteCount === 1 ? t(S.countOne) : fmt(t(S.count), { n: noteCount });

  const sidebarToggle = (
    <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.toggleSidebar)} title={t(S.toggleSidebar)} aria-pressed={showSidebar} onClick={() => (narrow ? setDrawer((v) => !v) : setSidebarOpen((v) => !v))}>
      <PanelLeft size={17} />
    </button>
  );
  const composeBtn = (
    <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.compose)} title={t(S.compose)} onClick={newNote}>
      <SquarePen size={17} />
    </button>
  );
  const deleteBtn = (
    <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.deleteNote)} title={t(S.deleteNote)} disabled={!hasNote} onClick={() => effective && void deleteNote(effective)}>
      <Trash size={16} />
    </button>
  );
  const search = (
    <span ref={searchRef} className={styles.search}>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t(S.search)}
        onKeyDown={(e) => {
          // The Return/arrow that commits a Hangul syllable arrives twice (composing, then plain);
          // only the plain one may move focus, or it would also open the first note.
          if (isComposing(e)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            setQuery('');
            e.currentTarget.blur();
          } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault();
            rootRef.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
          }
        }}
      />
    </span>
  );

  const sidebarEl = showSidebar && (
    <aside className={`${styles.sidebar} ${narrow ? styles.drawer : ''}`}>
      <div className={styles.sidebarTop} data-drag-region>
        {sidebarToggle}
      </div>
      <Sidebar scope={searching ? '' : effScope} allCount={data.notes.length} trashCount={data.trashed.length} folders={folders} onScope={changeScope} onFolderMenu={folderMenu} onNewFolder={() => void newFolder()} onDropPaths={(e, target) => void onDropPaths(e, target)} />
    </aside>
  );

  const listPane = (
    <section className={styles.listPane} aria-label={scopeTitle}>
      <div className={styles.toolbar} data-drag-region style={{ paddingLeft: showSidebar && !narrow ? 12 : 84 }}>
        {(!showSidebar || narrow) && <GlassGroup>{sidebarToggle}</GlassGroup>}
        <div className={styles.listTitle} data-drag-region>
          <strong>{scopeTitle}</strong>
          <span>{countLabel}</span>
        </div>
        <GlassGroup>{narrow ? composeBtn : deleteBtn}</GlassGroup>
      </div>
      {narrow && <div className={styles.searchRow}>{search}</div>}
      <NoteList
        entries={entries}
        selected={effective}
        query={query}
        untitled={t(S.newNote)}
        noText={t(S.noText)}
        empty={<EmptyState title={t(searching ? S.noResults : S.noNotes)} />}
        label={scopeTitle}
        onSelect={select}
        onOpen={() => editorRef.current?.focus()}
        onDelete={deleteNote}
        onMenu={noteMenu}
        onDragStart={onDragStart}
      />
    </section>
  );

  const editorPane = (
    <main className={styles.editorPane}>
      <div className={styles.toolbar} data-drag-region style={{ paddingLeft: narrow ? 84 : 10 }}>
        {narrow ? (
          <GlassGroup className={styles.backGroup}>
            <button type="button" className={styles.backBtn} onClick={() => setPane('list')} aria-label={t(S.back)}>
              <ChevronLeft size={18} />
              <span>{scopeTitle}</span>
            </button>
          </GlassGroup>
        ) : (
          <GlassGroup>{composeBtn}</GlassGroup>
        )}
        <div className={styles.toolbarSpacer} data-drag-region />
        <GlassGroup className={styles.toolGroup} label={t(S.format)}>
          <button type="button" className={`ui-icon-btn ${styles.toolBtn} ${styles.aaBtn}`} aria-label={t(S.format)} title={t(S.format)} aria-haspopup="menu" disabled={!hasNote || readOnly} onClick={formatMenu}>
            Aa
          </button>
          <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.checklist)} title={t(S.checklist)} disabled={!hasNote || readOnly} onClick={() => editorRef.current?.applyStyle('checklist')}>
            <ListChecks size={17} />
          </button>
        </GlassGroup>
        <GlassGroup className={styles.toolGroup}>
          <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.share)} title={t(S.share)} aria-haspopup="menu" disabled={!hasNote} onClick={shareMenu}>
            <Share size={16} />
          </button>
        </GlassGroup>
        {narrow ? <GlassGroup className={styles.toolGroup}>{deleteBtn}</GlassGroup> : search}
      </div>
      {readOnly && effective && (
        <div className={styles.deletedBanner} role="status">
          <span>{t(S.deletedBanner)}</span>
          <button type="button" className="ui-btn" onClick={() => recover(effective)}>
            {t(S.recover)}
          </button>
        </div>
      )}
      {effective && resolved.same ? (
        <NoteEditor
          key={sel.key}
          ref={editorRef}
          path={effective}
          readOnly={readOnly}
          autoFocusTitle={sel.focusTitle}
          fallbackTitle={t(S.newNote)}
          placeholder={t(S.title)}
          onRenamed={(next) => setSel((s) => ({ ...s, path: next }))}
          onLiveChange={(content) => setLive({ path: effective, content })}
        />
      ) : (
        <div className={styles.editorEmpty} data-drag-region />
      )}
    </main>
  );

  return (
    <div ref={rootRef} className={`${styles.root} ${narrow ? styles.narrow : showSidebar ? styles.withSidebar : ''}`} onDragOver={onHostDragOver} onDrop={(e) => void onHostDrop(e)}>
      {sidebarEl}
      {narrow && drawer && <div className={styles.scrim} onMouseDown={() => setDrawer(false)} />}
      {narrow ? (pane === 'editor' && effective ? editorPane : listPane) : (
        <>
          {listPane}
          {editorPane}
        </>
      )}
    </div>
  );
}

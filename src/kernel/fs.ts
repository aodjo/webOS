/**
 * Virtual file system.
 *
 * A flat map of absolute path → FSNode, persisted to IndexedDB. All mutations go through the
 * `fs` API below (which throws FSError), and React components subscribe with the hooks at the
 * bottom (`useNode`, `useDir`). Because every app (Finder, Terminal, TextEdit, Desktop…) shares
 * this store, a file created in one place appears everywhere instantly.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { FSErrorCode, FSNode, FSNodeMeta } from './types';
import { basename, dirname, extname, isWithin, join, normalize, stem } from './path';
import { PATHS } from './constants';

/* ───────────────────────── Errors ───────────────────────── */

const ERROR_TEXT: Record<FSErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  EPERM: 'Operation not permitted',
  EINVAL: 'Invalid argument',
}; /** POSIX-style message for each FS error code, used in `FSError.message`. */

/** Error thrown by every `fs` operation that fails. */
export class FSError extends Error {
  /** POSIX-style error code (ENOENT, EEXIST, EPERM, …). */
  code: FSErrorCode;
  /** Path the operation failed on, as passed by the caller. */
  path: string;

  /**
   * Creates an FS error for a code and a path.
   *
   * The message has the shell form "<description>: <path>", e.g.
   * "No such file or directory: /tmp/x".
   *
   * @param {FSErrorCode} code - POSIX-style error code.
   * @param {string} path - Path the operation failed on.
   * @returns {FSError} The new error.
   *
   * @example
   * throw new FSError('ENOENT', path);
   */
  constructor(code: FSErrorCode, path: string) {
    super(`${ERROR_TEXT[code]}: ${path}`);
    this.code = code;
    this.path = path;
  }
}

/* ───────────────────────── MIME ───────────────────────── */

const MIME: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  js: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  plist: 'application/xml',
  csv: 'text/csv',
  log: 'text/plain',
  sh: 'text/x-shellscript',
  py: 'text/x-python',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  zip: 'application/zip',
  app: 'application/x-app',
  webloc: 'application/x-webloc',
  url: 'application/x-webloc',
}; /** MIME type for each known lowercase file extension. */

/**
 * Returns the MIME type for a path based on its extension.
 *
 * Looks the lowercase extension up in the built-in table; unknown or missing extensions map to
 * `application/octet-stream`.
 *
 * @param {string} path - File path or name.
 * @returns {string} The MIME type.
 *
 * @example
 * mimeFor('/Users/me/photo.PNG'); // "image/png"
 */
export function mimeFor(path: string): string {
  return MIME[extname(path)] ?? 'application/octet-stream';
}

/** Broad category of a file, used for icons, "Kind" columns and choosing how to preview it. */
export type FileKind = 'folder' | 'app' | 'text' | 'markdown' | 'image' | 'pdf' | 'audio' | 'video' | 'link' | 'code' | 'archive' | 'unknown';

/**
 * Classifies a node into a broad file kind.
 *
 * Directories are `folder`. Files are classified by extension: `.app`, Markdown, PDF, web links
 * (`.webloc` / `.url`), `.zip` and source-code extensions first, then by MIME family (image,
 * audio, video, text). Files without an extension, `.txt`, `.log` and `.csv` count as text;
 * everything else is `unknown`.
 *
 * @param {Pick<FSNode, 'type' | 'name'>} node - The node (only `type` and `name` are read).
 * @returns {FileKind} The file kind.
 *
 * @example
 * kindOf({ type: 'file', name: 'README.md' }); // "markdown"
 */
export function kindOf(node: Pick<FSNode, 'type' | 'name'>): FileKind {
  if (node.type === 'dir') return 'folder';
  const ext = extname(node.name);
  if (ext === 'app') return 'app';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'webloc' || ext === 'url') return 'link';
  if (ext === 'zip') return 'archive';
  if (['js', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'json', 'sh', 'py', 'yml', 'yaml', 'xml', 'plist'].includes(ext)) return 'code';
  const mime = MIME[ext] ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/') || ext === '' || ext === 'txt' || ext === 'log' || ext === 'csv') return 'text';
  return 'unknown';
}

/**
 * Tells whether a node is a file whose `content` is editable text.
 *
 * True for files without a `src` (not binary / URL-backed) whose kind is text, Markdown, code
 * or a web link.
 *
 * @param {Pick<FSNode, 'type' | 'name' | 'src'>} node - The node to check.
 * @returns {boolean} True when the file can be edited as text.
 *
 * @example
 * if (isTextFile(node)) wm.openPath(node.path, 'textedit');
 */
export function isTextFile(node: Pick<FSNode, 'type' | 'name' | 'src'>): boolean {
  if (node.type !== 'file' || node.src) return false;
  const k = kindOf(node);
  return k === 'text' || k === 'markdown' || k === 'code' || k === 'link';
}

/* ───────────────────────── Store ───────────────────────── */

interface FSState {
  /** Every node of the tree, keyed by absolute normalized path. */
  nodes: Record<string, FSNode>;
  /** Hash of the portfolio data the FS was seeded from. When it changes the FS is re-seeded. */
  seedVersion: string;
  /** True once the persisted tree has been loaded (or immediately when there is no IndexedDB). */
  hydrated: boolean;
}

const flushHandlers = new Set<() => void>(); /** Callbacks run right before the final persist when the page is hidden or unloaded. */

/**
 * Registers a callback that runs right before the FS is persisted on page hide / unload.
 *
 * Apps with debounced autosave (e.g. Notes) write their pending changes here so they are part
 * of the final write. Callbacks run synchronously; an exception in one does not stop the others
 * or the persist.
 *
 * @param {() => void} fn - Synchronous callback that flushes pending changes into the FS.
 * @returns {() => void} Function that unregisters the callback.
 *
 * @example
 * useEffect(() => onBeforePersist(saveNow), [saveNow]);
 */
export function onBeforePersist(fn: () => void): () => void {
  flushHandlers.add(fn);
  return () => flushHandlers.delete(fn);
}

type PersistedFS = Pick<FSState, 'nodes' | 'seedVersion'>;
type Stored = StorageValue<PersistedFS>;

/**
 * A localStorage entry holding the changes IndexedDB may be missing when the page is hidden or
 * unloaded. Only nodes that differ from what IndexedDB may hold are recorded; the next load
 * replays every journal onto IndexedDB.
 */
interface Journal {
  /** Time the journal was written (0 marks an unreadable entry that is only removed). */
  t: number;
  /** Persist format version of the journaled state. */
  version?: number;
  seedVersion: string;
  /** Nodes added or changed, keyed by path. */
  upserts: Record<string, FSNode>;
  /** Paths removed. */
  deletes: string[];
}

const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36); /** Random id of this tab: names its journal entry and filters out its own broadcasts. */

/**
 * Returns the localStorage key prefix for a store's journal entries.
 *
 * Each tab's entry is the prefix followed by its `TAB_ID`.
 *
 * @param {string} name - Persisted store name.
 * @returns {string} The key prefix.
 *
 * @example
 * journalPrefix('webos.fs'); // "webos.fs.journal."
 */
const journalPrefix = (name: string) => `${name}.journal.`;

/**
 * Returns `localStorage` when it can be used.
 *
 * Returns null when `localStorage` does not exist (e.g. outside a browser) or accessing it
 * throws (storage blocked by the browser).
 *
 * @returns {Storage | null} The storage object, or null.
 *
 * @example
 * safeLocalStorage()?.removeItem(key);
 */
function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Reads every journal entry of a store from localStorage.
 *
 * Entries are returned oldest first. An entry that is not valid JSON is returned as an empty
 * placeholder with `t: 0`, which the loader skips but still removes; parsed entries without
 * `upserts` / `deletes` are left out. Returns an empty array when localStorage is unavailable or
 * cannot be enumerated.
 *
 * @param {string} name - Persisted store name.
 * @returns {{ key: string; journal: Journal }[]} The localStorage keys with their journals.
 *
 * @example
 * for (const { journal } of readJournals('webos.fs')) apply(journal);
 */
function readJournals(name: string): { key: string; journal: Journal }[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  const out: { key: string; journal: Journal }[] = [];
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key?.startsWith(journalPrefix(name))) continue;
      try {
        const journal = JSON.parse(ls.getItem(key) ?? 'null') as Journal | null;
        if (journal && typeof journal.upserts === 'object' && Array.isArray(journal.deletes)) out.push({ key, journal });
      } catch {
        out.push({ key, journal: { t: 0, seedVersion: '', upserts: {}, deletes: [] } });
      }
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => a.journal.t - b.journal.t);
}

/** zustand persist storage with an extra hook to cancel a scheduled write. */
interface FSStorage extends PersistStorage<PersistedFS> {
  /** Forget a write that has not started yet (another tab persisted a newer tree). */
  discardPending(): void;
}

const IDB_TIMEOUT_MS = 5000; /** How long the boot-time IndexedDB read may take before persistence is turned off for the session. */
let persistenceDisabled = false; /** Set when IndexedDB did not answer at boot; the session then never writes. */

/**
 * Tells whether this session saves the file system.
 *
 * Returns false after IndexedDB failed to answer at boot (blocked by another connection,
 * broken private-mode storage, …); changes then live only in memory.
 *
 * @returns {boolean} True when changes are persisted.
 *
 * @example
 * if (!isPersistenceAvailable()) showBanner('Changes will not be saved.');
 */
export function isPersistenceAvailable(): boolean {
  return !persistenceDisabled;
}

const fsChannel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('webos.fs') : null; /** Channel on which tabs announce that they persisted their tree, or null without BroadcastChannel. */

const TIMED_OUT = Symbol('timed out'); /** Sentinel result of the boot-time IndexedDB read when it times out or fails. */

/**
 * Creates the IndexedDB-backed persist storage for the FS store.
 *
 * Writes are debounced by 250 ms because the tree can hold large data: URLs. The storage keeps
 * per-instance bookkeeping: a sequence number per `setItem` call, the latest value handed to
 * `setItem` (written or not), the pending value waiting for the debounce timer, the state
 * IndexedDB is known to hold (`committed`), writes that have started but not finished
 * (`inflight`), and the sequence number covered by this tab's journal entry.
 *
 * An IndexedDB write started while the page unloads is aborted by the browser, so on `pagehide`
 * and when the page becomes hidden, the storage runs the `onBeforePersist` callbacks, then
 * synchronously writes a localStorage journal of everything IndexedDB may be missing, then
 * starts the IndexedDB write. Otherwise the last ~250 ms of changes (more with app-side
 * debouncing) would be lost on reload. After each successful write the other tabs are notified
 * over `fsChannel`.
 *
 * @returns {FSStorage} The storage to pass to zustand's `persist`.
 *
 * @example
 * const fsStorage = hasIndexedDB ? createIdbStorage() : undefined;
 */
function createIdbStorage(): FSStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let latest: { name: string; value: Stored; seq: number } | null = null;
  let pending: { name: string; value: Stored; seq: number } | null = null;
  let committed: { state: PersistedFS; seq: number } = { state: { nodes: {}, seedVersion: '' }, seq: 0 };
  const inflight = new Map<number, PersistedFS>();
  let journaledSeq: number | null = null;

  /**
   * Returns the localStorage key of this tab's journal entry.
   *
   * Appends this tab's `TAB_ID` to the store's journal prefix, so every tab writes its own entry
   * and never overwrites another tab's journal.
   *
   * @param {string} name - Persisted store name.
   * @returns {string} The journal key for this tab.
   *
   * @example
   * safeLocalStorage()?.removeItem(ownJournalKey('webos.fs'));
   */
  const ownJournalKey = (name: string) => journalPrefix(name) + TAB_ID;

  /**
   * Writes the pending value to IndexedDB immediately.
   *
   * Cancels the debounce timer and does nothing when there is no pending value or persistence
   * is disabled. A value that cannot be serialized is dropped. While the write runs its state is
   * tracked as in flight. On success `committed` advances (if this write is the newest landed),
   * this tab's journal entry is removed once a write at least as new as it has landed, and the
   * other tabs are notified. A failed write is only forgotten.
   *
   * @returns {void}
   *
   * @example
   * timer = setTimeout(flush, 250);
   */
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending || persistenceDisabled) return;
    const { name, value, seq: n } = pending;
    pending = null;
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch {
      return;
    }
    inflight.set(n, value.state);
    idbSet(name, text).then(
      () => {
        inflight.delete(n);
        if (n > committed.seq) committed = { state: value.state, seq: n };
        if (journaledSeq !== null && n >= journaledSeq) {
          journaledSeq = null;
          try {
            safeLocalStorage()?.removeItem(ownJournalKey(name));
          } catch {}
        }
        fsChannel?.postMessage({ type: 'persisted', from: TAB_ID, name });
      },
      () => void inflight.delete(n),
    );
  };

  /**
   * Synchronously journals everything IndexedDB may be missing.
   *
   * Compares the latest tree with the committed state and with every in-flight write: a node is
   * upserted when it differs from any of them, and a path is deleted when any of them has it but
   * the latest tree does not. Nothing is written when the latest value is already committed or
   * there is no difference. If localStorage rejects the entry (quota exceeded by large data:
   * URLs), only the IndexedDB write that follows remains.
   *
   * @returns {void}
   *
   * @example
   * writeJournal();
   * flush();
   */
  const writeJournal = () => {
    if (persistenceDisabled || !latest || latest.seq <= committed.seq) return;
    const { name, value, seq: n } = latest;
    const next = value.state.nodes;
    const bases = [committed.state, ...inflight.values()];
    const upserts: Record<string, FSNode> = {};
    const deletes = new Set<string>();
    for (const p in next) if (bases.some((b) => b.nodes[p] !== next[p])) upserts[p] = next[p];
    for (const b of bases) for (const p in b.nodes) if (!(p in next)) deletes.add(p);
    if (!deletes.size && !Object.keys(upserts).length && bases.every((b) => b.seedVersion === value.state.seedVersion)) return;
    const journal: Journal = { t: Date.now(), version: value.version, seedVersion: value.state.seedVersion, upserts, deletes: [...deletes] };
    try {
      safeLocalStorage()?.setItem(ownJournalKey(name), JSON.stringify(journal));
      journaledSeq = n;
    } catch {}
  };

  /**
   * Persists everything before the page is hidden or unloaded.
   *
   * Runs the `onBeforePersist` callbacks (an exception in one never blocks the rest), writes the
   * localStorage journal and starts the IndexedDB write.
   *
   * @returns {void}
   *
   * @example
   * window.addEventListener('pagehide', finalFlush);
   */
  const finalFlush = () => {
    for (const fn of flushHandlers) {
      try {
        fn();
      } catch {}
    }
    writeJournal();
    flush();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', finalFlush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && finalFlush());
  }

  return {
    /**
     * Loads the persisted tree, replaying any journals.
     *
     * The IndexedDB read races against `IDB_TIMEOUT_MS`; a timeout or failure disables
     * persistence for the session and returns null, so the app boots from the seed in memory
     * and never writes it over the user's real data once storage recovers.
     * Unparseable data counts as nothing stored. Journals left by earlier sessions or other tabs
     * are applied oldest first (deletes, then upserts), the merged tree is written back to
     * IndexedDB and the journals are removed; if that write fails they stay and are replayed on
     * the next load. The loaded tree becomes the committed state, so the write zustand issues
     * right after hydrating is recognized as unchanged and not echoed between tabs.
     *
     * @async
     * @param {string} name - Persisted store name.
     * @returns {Promise<Stored | null>} The stored state, or null when there is none.
     *
     * @example
     * const value = await fsStorage.getItem('webos.fs');
     */
    getItem: async (name) => {
      const raw = await Promise.race([
        idbGet<string>(name),
        new Promise<typeof TIMED_OUT>((res) => setTimeout(() => res(TIMED_OUT), IDB_TIMEOUT_MS)),
      ]).catch((): typeof TIMED_OUT => TIMED_OUT);
      if (raw === TIMED_OUT) {
        persistenceDisabled = true;
        committed = { state: { nodes: {}, seedVersion: '' }, seq };
        latest = pending = null;
        return null;
      }
      let value: Stored | null = null;
      try {
        value = raw ? (JSON.parse(raw) as Stored) : null;
      } catch {
        value = null;
      }
      const journals = readJournals(name);
      if (journals.length) {
        const nodes = { ...(value?.state.nodes ?? {}) };
        let seedVersion = value?.state.seedVersion ?? '';
        let version = value?.version;
        for (const { journal } of journals) {
          if (!journal.t) continue;
          for (const p of journal.deletes) delete nodes[p];
          Object.assign(nodes, journal.upserts);
          seedVersion = journal.seedVersion;
          version = journal.version ?? version;
        }
        value = { state: { nodes, seedVersion }, version };
        try {
          await idbSet(name, JSON.stringify(value));
          const ls = safeLocalStorage();
          for (const { key } of journals) ls?.removeItem(key);
          if (journals.some((j) => j.key === ownJournalKey(name))) journaledSeq = null;
        } catch {}
      }
      committed = { state: value?.state ?? { nodes: {}, seedVersion: '' }, seq };
      latest = null;
      return value;
    },

    /**
     * Schedules a debounced write of the tree.
     *
     * Ignored while persistence is disabled, and when the tree and seed version are the same
     * objects as the latest (or committed) value, which is the case for unrelated store updates
     * such as the `hydrated` flag. Otherwise the value gets a new sequence number and the write
     * is (re)scheduled 250 ms later.
     *
     * @param {string} name - Persisted store name.
     * @param {Stored} value - The state to persist.
     * @returns {void}
     *
     * @example
     * fsStorage.setItem('webos.fs', { state: { nodes, seedVersion }, version: 1 });
     */
    setItem: (name, value) => {
      if (persistenceDisabled) return;
      const prev = latest?.value.state ?? committed.state;
      if (value.state.nodes === prev.nodes && value.state.seedVersion === prev.seedVersion) return;
      latest = pending = { name, value, seq: ++seq };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 250);
    },

    /**
     * Deletes the persisted tree.
     *
     * Drops any pending write, then removes the IndexedDB entry.
     *
     * @async
     * @param {string} name - Persisted store name.
     * @returns {Promise<void>} Resolves once the entry is deleted.
     * @throws {DOMException} Rejects when the IndexedDB delete fails.
     *
     * @example
     * await fsStorage.removeItem('webos.fs');
     */
    removeItem: async (name) => {
      pending = null;
      await idbDel(name);
    },

    /**
     * Cancels a write that has not started yet.
     *
     * Used before reloading a newer tree persisted by another tab, so this tab's stale copy is
     * not written over it.
     *
     * @returns {void}
     *
     * @example
     * fsStorage?.discardPending();
     */
    discardPending: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

const hasIndexedDB = typeof indexedDB !== 'undefined'; /** Whether IndexedDB exists; without it (tests, non-browser) the FS is memory-only. */
const fsStorage = hasIndexedDB ? createIdbStorage() : undefined; /** Persist storage of the FS store, or undefined without IndexedDB. */

export const useFS = create<FSState>()(
  persist(
    () => ({
      nodes: {} as Record<string, FSNode>,
      seedVersion: '',
      hydrated: !hasIndexedDB,
    }),
    {
      name: 'webos.fs',
      version: 1,
      storage: fsStorage,
      skipHydration: !hasIndexedDB,
      /**
       * Selects the part of the state that is persisted.
       *
       * Only the tree and its seed version are stored; `hydrated` is runtime-only.
       *
       * @param {FSState} s - The full store state.
       * @returns {PersistedFS} The persisted subset.
       *
       * @example
       * partialize(useFS.getState()); // { nodes, seedVersion }
       */
      partialize: (s) => ({ nodes: s.nodes, seedVersion: s.seedVersion }),
      /**
       * Provides the callback zustand runs when hydration finishes.
       *
       * The returned callback sets `hydrated`, which `whenFSReady` waits for.
       *
       * @returns {() => void} Callback that marks the store as hydrated.
       *
       * @example
       * onRehydrateStorage()(); // useFS.getState().hydrated === true
       */
      onRehydrateStorage: () => () => {
        useFS.setState({ hydrated: true });
      },
    },
  ),
); /** Zustand store of the whole file system tree, persisted to IndexedDB. Mutate it only through `fs`. */

/**
 * Loads the tree another tab just persisted.
 *
 * Keeps tabs in sync: instead of later overwriting the other tab's tree with this tab's stale
 * copy (last writer would win), the pending write is discarded and the store rehydrates from
 * storage (IndexedDB plus journals). Does nothing before the first hydration finished.
 *
 * @returns {void}
 *
 * @example
 * window.addEventListener('storage', () => reloadFromOtherTab());
 */
function reloadFromOtherTab(): void {
  if (!useFS.getState().hydrated) return;
  fsStorage?.discardPending();
  void useFS.persist.rehydrate();
}
if (fsStorage) {
  if (fsChannel) {
    /**
     * Handles cross-tab FS messages.
     *
     * Reloads the tree when another tab announces that it persisted the `webos.fs` store;
     * this tab's own broadcasts and other messages are ignored.
     *
     * @param {MessageEvent<{ type?: string; from?: string; name?: string }>} e - The channel message.
     * @returns {void}
     *
     * @example
     * fsChannel.postMessage({ type: 'persisted', from: TAB_ID, name: 'webos.fs' });
     */
    fsChannel.onmessage = (e: MessageEvent<{ type?: string; from?: string; name?: string }>) => {
      if (e.data?.type === 'persisted' && e.data.from !== TAB_ID && e.data.name === 'webos.fs') reloadFromOtherTab();
    };
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key?.startsWith(journalPrefix('webos.fs')) && e.newValue && !e.key.endsWith(TAB_ID)) reloadFromOtherTab();
    });
  }
}

/**
 * Waits until the persisted FS has been loaded.
 *
 * Resolves immediately when the store is already hydrated (always the case without IndexedDB);
 * otherwise subscribes to the store and resolves on the first state with `hydrated` set.
 *
 * @returns {Promise<void>} Resolves once the FS is ready.
 *
 * @example
 * await whenFSReady();
 * seedIfNeeded();
 */
export function whenFSReady(): Promise<void> {
  if (useFS.getState().hydrated) return Promise.resolve();
  return new Promise((res) => {
    const unsub = useFS.subscribe((s) => {
      if (s.hydrated) {
        unsub();
        res();
      }
    });
  });
}

/* ───────────────────────── Internal helpers ───────────────────────── */

/**
 * Returns the current node map.
 *
 * Reads the store's state at call time without subscribing, so the result is a snapshot that
 * must not be mutated (use `commit` to change it).
 *
 * @returns {Record<string, FSNode>} Every node keyed by absolute path.
 *
 * @example
 * const n = nodes()['/Users'];
 */
const nodes = () => useFS.getState().nodes;

/**
 * Applies a mutation to a copy of the node map and stores it.
 *
 * The map is shallow-copied, so the new state has a new identity and subscribers and
 * persistence see the change; nodes themselves must be replaced, not mutated.
 *
 * @param {(draft: Record<string, FSNode>) => void} mutator - Function that edits the copy.
 * @returns {void}
 *
 * @example
 * commit((d) => { delete d[path]; });
 */
function commit(mutator: (draft: Record<string, FSNode>) => void) {
  const draft = { ...nodes() };
  mutator(draft);
  useFS.setState({ nodes: draft });
}

/**
 * Returns the node at a path or throws.
 *
 * Normalizes the path before the lookup; the error reports the path as the caller passed it.
 *
 * @param {string} path - Path of the node (normalized before lookup).
 * @returns {FSNode} The node.
 * @throws {FSError} ENOENT when nothing exists at the path.
 *
 * @example
 * const node = mustGet('/Users/me/notes.txt');
 */
function mustGet(path: string): FSNode {
  const n = nodes()[normalize(path)];
  if (!n) throw new FSError('ENOENT', path);
  return n;
}

/**
 * Returns the directory at a path or throws.
 *
 * Looks the node up with `mustGet` and additionally requires it to be a directory.
 *
 * @param {string} path - Path of the directory.
 * @returns {FSNode} The directory node.
 * @throws {FSError} ENOENT when nothing exists at the path, ENOTDIR when it is a file.
 *
 * @example
 * mustBeDir(dirname(path));
 */
function mustBeDir(path: string): FSNode {
  const n = mustGet(path);
  if (n.type !== 'dir') throw new FSError('ENOTDIR', path);
  return n;
}

/**
 * Checks whether a string is a valid file name.
 *
 * A valid name is non-empty, is not "." or "..", contains no "/" and is at most 255 characters.
 *
 * @param {string} name - The file name (not a path).
 * @returns {boolean} True when the name is valid.
 *
 * @example
 * validName('notes.txt'); // true
 * validName('a/b'); // false
 */
function validName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !name.includes('/') && name.length <= 255;
}

/**
 * Lists the direct children of a directory in a node map.
 *
 * Scans every key for paths exactly one level below `dir`; the result is unsorted.
 *
 * @param {Record<string, FSNode>} all - The node map to search.
 * @param {string} dir - Path of the directory.
 * @returns {FSNode[]} The child nodes.
 *
 * @example
 * childrenOf(nodes(), PATHS.desktop);
 */
function childrenOf(all: Record<string, FSNode>, dir: string): FSNode[] {
  const d = normalize(dir);
  const prefix = d === '/' ? '/' : d + '/';
  const out: FSNode[] = [];
  for (const p in all) {
    if (p !== d && p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out.push(all[p]);
  }
  return out;
}

/**
 * Lists the paths of every node below a directory, at any depth.
 *
 * The directory itself is excluded; paths come in the map's key order.
 *
 * @param {Record<string, FSNode>} all - The node map to search.
 * @param {string} dir - Path of the directory.
 * @returns {string[]} Paths of all descendants.
 *
 * @example
 * descendantsOf(nodes(), PATHS.trash).length;
 */
function descendantsOf(all: Record<string, FSNode>, dir: string): string[] {
  const d = normalize(dir);
  const prefix = d === '/' ? '/' : d + '/';
  return Object.keys(all).filter((p) => p !== d && p.startsWith(prefix));
}

const PROTECTED = new Set<string>([
  '/',
  '/Applications',
  '/System',
  '/Users',
  '/Library',
  PATHS.home,
  PATHS.desktop,
  PATHS.documents,
  PATHS.downloads,
  PATHS.pictures,
  PATHS.music,
  `${PATHS.home}/Movies`,
  `${PATHS.home}/Public`,
  PATHS.notes,
  PATHS.projects,
  PATHS.trash,
]); /** Paths that can never be deleted, renamed or moved (incl. the Notes / Projects backing folders). */

/**
 * Tells whether an item can't be deleted, renamed or moved.
 *
 * True for the fixed `PROTECTED` folders, for locked items, and for anything inside /System or
 * /Applications.
 *
 * @param {string} path - Normalized absolute path.
 * @returns {boolean} True when the item is protected.
 *
 * @example
 * if (isProtected(p)) throw new FSError('EPERM', path);
 */
function isProtected(path: string): boolean {
  const n = nodes()[path];
  return PROTECTED.has(path) || !!n?.meta?.locked || isWithin(path, '/System') || isWithin(path, '/Applications');
}

const WRITABLE_ROOTS = [PATHS.home, '/Users/Shared', '/tmp']; /** Folders under which new items may be created, like for a non-admin macOS user. */

let sudoDepth = 0; /** Nesting depth of `fs.sudo` calls; while above 0, write-permission and locked-folder checks are skipped. */

/**
 * Tells whether an item inside the home folder was locked by the user (Get Info).
 *
 * System items outside the home folder can be locked too, but those are handled by
 * `isProtected` instead.
 *
 * @param {string} p - Normalized absolute path.
 * @returns {boolean} True when the item is user-locked.
 *
 * @example
 * descendantsOf(nodes(), dir).some(userLocked);
 */
const userLocked = (p: string) => !!nodes()[p]?.meta?.locked && p.startsWith(PATHS.home + '/');

/**
 * Asserts that new items may be created in a directory.
 *
 * Outside `fs.sudo`, the directory must be inside one of the `WRITABLE_ROOTS` and must not be a
 * user-locked folder.
 *
 * @param {string} dir - Directory that would receive the item.
 * @param {string} path - Path reported in the error.
 * @returns {void}
 * @throws {FSError} EPERM when the directory is not writable or is locked.
 *
 * @example
 * assertWritableDir(dirname(p), path);
 */
function assertWritableDir(dir: string, path: string): void {
  if (sudoDepth === 0 && !WRITABLE_ROOTS.some((r) => isWithin(dir, r))) throw new FSError('EPERM', path);
  assertUnlockedDir(dir, path);
}

/**
 * Asserts that a directory is not locked by the user.
 *
 * Like macOS, nothing can be added to, removed from or renamed inside a locked folder. Skipped
 * inside `fs.sudo`.
 *
 * @param {string} dir - Directory being changed.
 * @param {string} path - Path reported in the error.
 * @returns {void}
 * @throws {FSError} EPERM when the directory is user-locked.
 *
 * @example
 * assertUnlockedDir(dirname(p), path);
 */
function assertUnlockedDir(dir: string, path: string): void {
  if (sudoDepth === 0 && userLocked(dir)) throw new FSError('EPERM', path);
}

/**
 * Asserts that a folder contains no user-locked items.
 *
 * A folder holding locked items can't be trashed or deleted (Finder: "contains locked items").
 * Files always pass; skipped inside `fs.sudo`.
 *
 * @param {string} p - Normalized path of the item being removed.
 * @param {string} path - Path reported in the error.
 * @returns {void}
 * @throws {FSError} EPERM when a descendant is user-locked.
 *
 * @example
 * assertNoLockedInside(p, path);
 */
function assertNoLockedInside(p: string, path: string): void {
  if (sudoDepth === 0 && nodes()[p]?.type === 'dir' && descendantsOf(nodes(), p).some(userLocked)) throw new FSError('EPERM', path);
}

const moveJournal = new Map<string, string>(); /** Old path → new path of recent moves and renames, read by `fs.movedTo`. */
const MOVE_JOURNAL_LIMIT = 500; /** Maximum number of entries kept in `moveJournal`; the oldest are dropped first. */

/**
 * Records that an item moved from one path to another.
 *
 * Re-inserts the entry so it becomes the newest, then drops the oldest entries beyond
 * `MOVE_JOURNAL_LIMIT`.
 *
 * @param {string} from - Old path.
 * @param {string} to - New path.
 * @returns {void}
 *
 * @example
 * recordMove('/Users/me/a.txt', '/Users/me/b.txt');
 */
function recordMove(from: string, to: string): void {
  moveJournal.delete(from);
  moveJournal.set(from, to);
  while (moveJournal.size > MOVE_JOURNAL_LIMIT) moveJournal.delete(moveJournal.keys().next().value!);
}

/**
 * Removes the Desktop icon position from node metadata.
 *
 * Desktop icon cells only make sense inside the folder they were set in, so they are dropped
 * when an item changes folders. Metadata without a position is returned as is; metadata left
 * empty becomes undefined.
 *
 * @param {FSNodeMeta | undefined} meta - The node's metadata.
 * @returns {FSNodeMeta | undefined} Metadata without `x` / `y`.
 *
 * @example
 * withoutPosition({ x: 1, y: 2, tag: 'red' }); // { tag: 'red' }
 */
function withoutPosition(meta: FSNodeMeta | undefined): FSNodeMeta | undefined {
  if (!meta || (meta.x === undefined && meta.y === undefined)) return meta;
  const { x: _x, y: _y, ...rest } = meta;
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * Returns the current time for node timestamps.
 *
 * Thin wrapper around `Date.now()` used for every `createdAt` / `modifiedAt` value.
 *
 * @returns {number} Milliseconds since the Unix epoch.
 *
 * @example
 * const node = { ...n, modifiedAt: now() };
 */
const now = () => Date.now();

/* ───────────────────────── Public API ───────────────────────── */

export const fs = {
  /**
   * Tells whether anything exists at a path.
   *
   * Normalizes the path and checks the node map; never throws.
   *
   * @param {string} path - Path to check (normalized first).
   * @returns {boolean} True when a file or folder exists there.
   *
   * @example
   * if (!fs.exists(path)) return;
   */
  exists(path: string): boolean {
    return !!nodes()[normalize(path)];
  },

  /**
   * Returns the node at a path without throwing.
   *
   * Normalizes the path and looks it up in the node map; a missing node yields null instead of
   * an `FSError`.
   *
   * @param {string} path - Path to look up (normalized first).
   * @returns {FSNode | null} The node, or null when nothing exists there.
   *
   * @example
   * const node = fs.stat('/Users/me/Desktop/notes.txt');
   */
  stat(path: string): FSNode | null {
    return nodes()[normalize(path)] ?? null;
  },

  /**
   * Tells whether a path is an existing directory.
   *
   * Normalizes the path and checks the node's type; never throws.
   *
   * @param {string} path - Path to check (normalized first).
   * @returns {boolean} True for directories, false for files and missing paths.
   *
   * @example
   * fs.isDir(PATHS.desktop); // true
   */
  isDir(path: string): boolean {
    return nodes()[normalize(path)]?.type === 'dir';
  },

  /**
   * Lists the children of a directory.
   *
   * Verifies that the path is a directory, then returns its direct children (no deeper
   * descendants) in store order, including hidden items.
   *
   * @param {string} path - Path of the directory.
   * @returns {FSNode[]} The direct children, unsorted (see `sortNodes`).
   * @throws {FSError} ENOENT when the path doesn't exist, ENOTDIR when it is a file.
   *
   * @example
   * const items = sortNodes(fs.readdir(PATHS.documents));
   */
  readdir(path: string): FSNode[] {
    mustBeDir(path);
    return childrenOf(nodes(), path);
  },

  /**
   * Reads a file's text content.
   *
   * Files backed by `src` (binary / URL) have no text content and read as an empty string.
   *
   * @param {string} path - Path of the file.
   * @returns {string} The file's text.
   * @throws {FSError} ENOENT when the path doesn't exist, EISDIR when it is a directory.
   *
   * @example
   * const text = fs.readFile('/Users/me/notes.txt');
   */
  readFile(path: string): string {
    const n = mustGet(path);
    if (n.type === 'dir') throw new FSError('EISDIR', path);
    return n.content ?? '';
  },

  /**
   * Returns a URL usable in `<img>`, `<iframe>`, `<audio>`, … for a file.
   *
   * Uses the file's `src` when it has one; otherwise builds a UTF-8 `data:` URL of its text
   * content with the file's MIME type.
   *
   * @param {string} path - Path of the file.
   * @returns {string} The URL.
   * @throws {FSError} ENOENT when the path doesn't exist, EISDIR when it is a directory.
   *
   * @example
   * <img src={fs.getURL(path)} alt="" />
   */
  getURL(path: string): string {
    const n = mustGet(path);
    if (n.type === 'dir') throw new FSError('EISDIR', path);
    if (n.src) return n.src;
    return `data:${n.mime ?? mimeFor(n.path)};charset=utf-8,${encodeURIComponent(n.content ?? '')}`;
  },

  /**
   * Returns the size of an item in bytes.
   *
   * For a directory, the sizes of all files below it are summed recursively.
   *
   * @param {string} path - Path of the item.
   * @returns {number} Size in bytes.
   * @throws {FSError} ENOENT when the path doesn't exist.
   *
   * @example
   * formatBytes(fs.size(PATHS.documents));
   */
  size(path: string): number {
    const n = mustGet(path);
    if (n.type === 'file') return fileSize(n);
    return descendantsOf(nodes(), n.path).reduce((sum, p) => {
      const c = nodes()[p];
      return sum + (c.type === 'file' ? fileSize(c) : 0);
    }, 0);
  },

  /**
   * Creates or overwrites a file.
   *
   * The parent directory must exist. With `src` the file is binary / URL-backed: `content` is
   * ignored and `bytes` records its size. The MIME type defaults to the one for the extension,
   * the creation time of an existing file is kept, and its metadata is kept unless `meta` is
   * given. Editing an existing file only requires the path to be inside a writable root, so
   * files inside a locked folder can still be edited; creating a new one also requires the folder
   * to be unlocked. Creating a new file clears any recorded move away from that path, since it is
   * a different document. The parent folder's modification time is updated.
   *
   * @param {string} path - Path of the file.
   * @param {string} content - Text content (ignored when `opts.src` is set).
   * @param {Object} [opts={}] - Write options.
   * @param {string} [opts.src] - data: URL, public asset path or http(s) URL for binary files.
   * @param {number} [opts.bytes] - Size of a `src`-backed file.
   * @param {string} [opts.mime] - MIME type (defaults to the extension's).
   * @param {FSNodeMeta} [opts.meta] - Metadata replacing the existing one.
   * @param {boolean} [opts.exclusive] - Fail if the file already exists.
   * @returns {FSNode} The written node.
   * @throws {FSError} EINVAL for an invalid name; ENOENT / ENOTDIR when the parent is missing or
   *   a file; EPERM outside the writable folders, in a locked folder (new files) or for a locked
   *   file; EEXIST with `exclusive`; EISDIR when a directory exists at the path.
   *
   * @example
   * fs.writeFile(join(PATHS.desktop, 'hello.txt'), 'Hello!');
   */
  writeFile(path: string, content: string, opts: { src?: string; bytes?: number; mime?: string; meta?: FSNodeMeta; exclusive?: boolean } = {}): FSNode {
    const p = normalize(path);
    const name = basename(p);
    if (!validName(name)) throw new FSError('EINVAL', path);
    mustBeDir(dirname(p));
    const existing = nodes()[p];
    if (existing) {
      if (sudoDepth === 0 && !WRITABLE_ROOTS.some((r) => isWithin(dirname(p), r))) throw new FSError('EPERM', path);
    } else assertWritableDir(dirname(p), path);
    if (existing) {
      if (opts.exclusive) throw new FSError('EEXIST', path);
      if (existing.type === 'dir') throw new FSError('EISDIR', path);
      if (existing.meta?.locked) throw new FSError('EPERM', path);
    }
    const node: FSNode = {
      path: p,
      name,
      type: 'file',
      content: opts.src ? undefined : content,
      src: opts.src,
      bytes: opts.src ? opts.bytes : undefined,
      mime: opts.mime ?? mimeFor(p),
      createdAt: existing?.createdAt ?? now(),
      modifiedAt: now(),
      meta: opts.meta ?? existing?.meta,
    };
    if (!existing) moveJournal.delete(p);
    commit((d) => {
      d[p] = node;
      touchDir(d, dirname(p));
    });
    return node;
  },

  /**
   * Appends text to a file, creating it if needed.
   *
   * Reads the current text content (empty for a missing or `src`-backed file) and writes the
   * concatenation back with `fs.writeFile`, so the same permission checks apply.
   *
   * @param {string} path - Path of the file.
   * @param {string} text - Text to append.
   * @returns {FSNode} The written node.
   * @throws {FSError} Same errors as `fs.writeFile`.
   *
   * @example
   * fs.appendFile('/tmp/log.txt', 'done\n');
   */
  appendFile(path: string, text: string): FSNode {
    const n = nodes()[normalize(path)];
    return fs.writeFile(path, (n?.content ?? '') + text);
  },

  /**
   * Creates a directory.
   *
   * With `recursive`, missing parents are created and an existing directory is returned instead
   * of failing. Clears any recorded move away from the path and updates the parent's
   * modification time.
   *
   * @param {string} path - Path of the new directory.
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.recursive] - Create parents and accept an existing directory.
   * @returns {FSNode} The created (or existing) directory node.
   * @throws {FSError} EEXIST when the path exists; ENOENT when the parent is missing (not
   *   recursive); ENOTDIR when the parent is a file; EINVAL for an invalid name; EPERM when the
   *   parent is not writable or is locked.
   *
   * @example
   * fs.mkdir('/Users/me/Documents/Projects/demo', { recursive: true });
   */
  mkdir(path: string, opts: { recursive?: boolean } = {}): FSNode {
    const p = normalize(path);
    const existing = nodes()[p];
    if (existing) {
      if (opts.recursive && existing.type === 'dir') return existing;
      throw new FSError('EEXIST', path);
    }
    const parent = dirname(p);
    if (!nodes()[parent]) {
      if (!opts.recursive) throw new FSError('ENOENT', parent);
      fs.mkdir(parent, { recursive: true });
    } else mustBeDir(parent);
    if (!validName(basename(p))) throw new FSError('EINVAL', path);
    assertWritableDir(parent, path);
    const node: FSNode = { path: p, name: basename(p), type: 'dir', createdAt: now(), modifiedAt: now() };
    moveJournal.delete(p);
    commit((d) => {
      d[p] = node;
      touchDir(d, parent);
    });
    return node;
  },

  /**
   * Permanently deletes an item. Use `fs.trash` for user-facing deletes.
   *
   * Protected items can't be deleted, except items inside the Trash (which may be locked).
   * Outside the Trash the parent folder must not be locked and a folder must not contain locked
   * items. A non-empty directory requires `recursive`. Updates the parent's modification time.
   *
   * @param {string} path - Path of the item.
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.recursive] - Allow deleting a non-empty directory with its contents.
   * @param {boolean} [opts.force] - Silently ignore a missing path.
   * @returns {void}
   * @throws {FSError} ENOENT when the path doesn't exist (without `force`); EPERM for protected
   *   or locked items; ENOTEMPTY for a non-empty directory without `recursive`.
   *
   * @example
   * fs.rm('/tmp/build', { recursive: true, force: true });
   */
  rm(path: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    const p = normalize(path);
    const n = nodes()[p];
    if (!n) {
      if (opts.force) return;
      throw new FSError('ENOENT', path);
    }
    const insideTrash = isWithin(p, PATHS.trash) && p !== PATHS.trash;
    if (isProtected(p) && !insideTrash) throw new FSError('EPERM', path);
    if (!insideTrash) {
      assertUnlockedDir(dirname(p), path);
      assertNoLockedInside(p, path);
    }
    const kids = n.type === 'dir' ? descendantsOf(nodes(), p) : [];
    if (n.type === 'dir' && kids.length && !opts.recursive) throw new FSError('ENOTEMPTY', path);
    commit((d) => {
      delete d[p];
      for (const k of kids) delete d[k];
      touchDir(d, dirname(p));
    });
  },

  /**
   * Moves or renames an item to an exact destination path.
   *
   * Moving onto itself returns the node unchanged. The item and, for a directory, all its
   * descendants get their new paths, and every move is recorded for `fs.movedTo`. Metadata is
   * kept, except that the Desktop icon position is dropped when the item changes folders. Both
   * parent folders get a new modification time.
   *
   * @param {string} src - Current path of the item.
   * @param {string} dst - Full destination path (including the new name).
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.overwrite] - Replace an existing item at `dst` (deleted recursively).
   * @returns {FSNode} The node at its new path.
   * @throws {FSError} ENOENT when the source or the destination folder is missing; EPERM for a
   *   protected source, a locked source folder or an unwritable destination; EINVAL for an
   *   invalid name or a move into the item itself; ENOTDIR when the destination parent is a
   *   file; EEXIST when `dst` exists without `overwrite`.
   *
   * @example
   * fs.move('/Users/me/Desktop/a.txt', '/Users/me/Documents/a.txt');
   */
  move(src: string, dst: string, opts: { overwrite?: boolean } = {}): FSNode {
    const s = normalize(src);
    const t = normalize(dst);
    if (s === t) return mustGet(s);
    const n = mustGet(s);
    if (isProtected(s)) throw new FSError('EPERM', src);
    assertUnlockedDir(dirname(s), src);
    if (!validName(basename(t))) throw new FSError('EINVAL', dst);
    if (isWithin(t, s)) throw new FSError('EINVAL', dst);
    mustBeDir(dirname(t));
    assertWritableDir(dirname(t), dst);
    const existing = nodes()[t];
    if (existing) {
      if (!opts.overwrite) throw new FSError('EEXIST', dst);
      fs.rm(t, { recursive: true });
    }
    const sameDir = dirname(s) === dirname(t);
    commit((d) => {
      const moved: FSNode = { ...n, path: t, name: basename(t), modifiedAt: now(), meta: sameDir ? n.meta : withoutPosition(n.meta) };
      delete d[s];
      d[t] = moved;
      recordMove(s, t);
      if (n.type === 'dir') {
        for (const k of descendantsOf(d, s)) {
          const child = d[k];
          const np = t + k.slice(s.length);
          delete d[k];
          d[np] = { ...child, path: np };
          recordMove(k, np);
        }
      }
      touchDir(d, dirname(s));
      touchDir(d, dirname(t));
    });
    return nodes()[t];
  },

  /**
   * Moves an item into a directory, picking a unique name if needed.
   *
   * An item already in `dir` stays where it is.
   *
   * @param {string} src - Path of the item.
   * @param {string} dir - Path of the target directory.
   * @returns {string} The item's new path.
   * @throws {FSError} Same errors as `fs.move`.
   *
   * @example
   * const p = fs.moveInto('/Users/me/Desktop/a.txt', PATHS.documents);
   */
  moveInto(src: string, dir: string): string {
    const s = normalize(src);
    const d = normalize(dir);
    if (dirname(s) === d) return s;
    const target = join(d, fs.uniqueName(d, basename(s)));
    fs.move(s, target);
    return target;
  },

  /**
   * Renames an item within its folder.
   *
   * Validates the new name, then moves the item to the same parent folder under that name with
   * `fs.move`, so an existing item with the new name is not replaced.
   *
   * @param {string} path - Path of the item.
   * @param {string} newName - New file name (not a path).
   * @returns {FSNode} The renamed node.
   * @throws {FSError} EINVAL for an invalid name, plus the errors of `fs.move`.
   *
   * @example
   * fs.rename('/Users/me/Desktop/a.txt', 'b.txt');
   */
  rename(path: string, newName: string): FSNode {
    if (!validName(newName)) throw new FSError('EINVAL', newName);
    return fs.move(path, join(dirname(path), newName));
  },

  /**
   * Copies an item (recursively for directories) to an exact destination path.
   *
   * Copies get fresh timestamps and are plain user items: never locked, not "in the Trash"
   * (`trashedFrom` / `trashedCell` removed), and the copied item has no Desktop icon position of
   * its own. The destination folder's modification time is updated.
   *
   * @param {string} src - Path of the item to copy.
   * @param {string} dst - Full destination path (including the name).
   * @returns {FSNode} The new node.
   * @throws {FSError} ENOENT when the source or destination folder is missing; EEXIST when `dst`
   *   exists; EINVAL for a copy into the item itself; ENOTDIR when the destination parent is a
   *   file; EPERM when the destination is not writable or is locked.
   *
   * @example
   * fs.copy('/Users/me/a.txt', '/Users/me/Documents/a.txt');
   */
  copy(src: string, dst: string): FSNode {
    const s = normalize(src);
    const t = normalize(dst);
    const n = mustGet(s);
    if (nodes()[t]) throw new FSError('EEXIST', dst);
    if (isWithin(t, s)) throw new FSError('EINVAL', dst);
    mustBeDir(dirname(t));
    assertWritableDir(dirname(t), dst);
    const ts = now();
    /**
     * Strips the metadata a copy must not inherit.
     *
     * Removes `locked`, `trashedFrom` and `trashedCell`; metadata left empty becomes undefined.
     *
     * @param {FSNodeMeta | undefined} meta - The source node's metadata.
     * @returns {FSNodeMeta | undefined} Metadata for the copy.
     *
     * @example
     * clean({ locked: true, tag: 'red' }); // { tag: 'red' }
     */
    const clean = (meta: FSNodeMeta | undefined): FSNodeMeta | undefined => {
      if (!meta) return undefined;
      const { locked: _l, trashedFrom: _t, trashedCell: _c, ...rest } = meta;
      return Object.keys(rest).length ? rest : undefined;
    };
    commit((d) => {
      d[t] = { ...n, path: t, name: basename(t), createdAt: ts, modifiedAt: ts, meta: clean(withoutPosition(n.meta)) };
      if (n.type === 'dir') {
        for (const k of descendantsOf(d, s)) {
          const np = t + k.slice(s.length);
          d[np] = { ...d[k], path: np, createdAt: ts, modifiedAt: ts, meta: clean(d[k].meta) };
        }
      }
      touchDir(d, dirname(t));
    });
    return nodes()[t];
  },

  /**
   * Copies an item into a directory with a Finder-style unique name.
   *
   * In the item's own folder the copy is named "name copy.ext" ("name copy" for folders and
   * files without an extension), then made unique ("name copy 2.ext"). In another folder the
   * original name is kept and made unique.
   *
   * @param {string} src - Path of the item.
   * @param {string} [dir] - Target directory (defaults to the item's own folder).
   * @returns {string} Path of the copy.
   * @throws {FSError} Same errors as `fs.copy`.
   *
   * @example
   * fs.duplicate('/Users/me/Desktop/report.pdf'); // "/Users/me/Desktop/report copy.pdf"
   */
  duplicate(src: string, dir?: string): string {
    const s = normalize(src);
    const d = dir ? normalize(dir) : dirname(s);
    let name = basename(s);
    const isDir = mustGet(s).type === 'dir';
    if (d === dirname(s)) {
      const ext = extname(s);
      const base = isDir || !ext ? basename(s) : stem(s);
      name = `${base} copy${!isDir && ext ? '.' + ext : ''}`;
    }
    const target = join(d, fs.uniqueName(d, name, isDir));
    fs.copy(s, target);
    return target;
  },

  /**
   * Returns a name that is free in a directory.
   *
   * A taken name gets a counter starting at 2 before its extension ("name.txt" → "name 2.txt").
   * Folders have no extension ("v1.2" → "v1.2 2"), and a suffix that is empty, contains
   * whitespace or starts the name (dotfiles) is not an extension either ("my.project copy" →
   * "my.project copy 2").
   *
   * @param {string} dir - Path of the directory.
   * @param {string} name - Desired name.
   * @param {boolean} [isDir] - Whether the new item is a folder; defaults to the type of the
   *   existing item with that name.
   * @returns {string} `name` itself when free, otherwise the first free numbered variant.
   *
   * @example
   * fs.uniqueName(PATHS.desktop, 'untitled folder', true); // "untitled folder 2"
   */
  uniqueName(dir: string, name: string, isDir?: boolean): string {
    const d = normalize(dir);
    const clash = nodes()[join(d, name)];
    if (!clash) return name;
    const folder = isDir ?? clash.type === 'dir';
    const dot = name.lastIndexOf('.');
    const extPart = dot > 0 ? name.slice(dot + 1) : '';
    const hasExt = !folder && extPart.length > 0 && !/\s/.test(extPart);
    const base = hasExt ? name.slice(0, dot) : name;
    const ext = hasExt ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}${ext}`;
      if (!nodes()[join(d, candidate)]) return candidate;
    }
  },

  /**
   * Merges a patch into an item's metadata.
   *
   * Keys set to `undefined` in the patch overwrite existing values. No permission checks are
   * made and the modification time is not changed.
   *
   * @param {string} path - Path of the item.
   * @param {FSNodeMeta} patch - Metadata fields to set.
   * @returns {void}
   * @throws {FSError} ENOENT when the path doesn't exist.
   *
   * @example
   * fs.setMeta(path, { tag: 'red' });
   */
  setMeta(path: string, patch: FSNodeMeta): void {
    const p = normalize(path);
    const n = mustGet(p);
    commit((d) => {
      d[p] = { ...n, meta: { ...n.meta, ...patch } };
    });
  },

  /**
   * Moves an item to ~/.Trash, remembering where it came from.
   *
   * An item already inside the Trash is deleted permanently instead. Otherwise the item is moved
   * under a unique name and its metadata records the original path (`trashedFrom`) and its
   * Desktop icon cell (`trashedCell`), so Put Back can return it to the same spot.
   *
   * @param {string} path - Path of the item.
   * @returns {string} Path inside the Trash, or an empty string when the item was deleted.
   * @throws {FSError} ENOENT when the path doesn't exist; EPERM for protected items, items in a
   *   locked folder and folders containing locked items.
   *
   * @example
   * fs.trash('/Users/me/Desktop/old.txt'); // "/Users/me/.Trash/old.txt"
   */
  trash(path: string): string {
    const p = normalize(path);
    mustGet(p);
    if (isWithin(p, PATHS.trash) && p !== PATHS.trash) {
      fs.rm(p, { recursive: true });
      return '';
    }
    if (isProtected(p)) throw new FSError('EPERM', path);
    assertUnlockedDir(dirname(p), path);
    assertNoLockedInside(p, path);
    const { x, y } = mustGet(p).meta ?? {};
    const target = join(PATHS.trash, fs.uniqueName(PATHS.trash, basename(p)));
    fs.move(p, target);
    fs.setMeta(target, { trashedFrom: p, trashedCell: x !== undefined && y !== undefined ? { x, y } : undefined, x: undefined, y: undefined });
    return target;
  },

  /**
   * Puts an item in the Trash back where it came from.
   *
   * The item returns to its original folder under its original name (made unique); when that
   * folder is missing, or the origin is unknown, it goes to the Desktop. The Desktop icon
   * cell is restored only when the item returns to its original folder.
   *
   * @param {string} trashPath - Path of the item inside the Trash.
   * @returns {string} The restored path.
   * @throws {FSError} ENOENT when the item doesn't exist, plus the errors of `fs.move`.
   *
   * @example
   * fs.restore('/Users/me/.Trash/old.txt'); // "/Users/me/Desktop/old.txt"
   */
  restore(trashPath: string): string {
    const n = mustGet(trashPath);
    const from = n.meta?.trashedFrom;
    let dir = from ? dirname(from) : PATHS.desktop;
    if (!fs.isDir(dir)) dir = PATHS.desktop;
    const name = from ? basename(from) : n.name;
    const target = join(dir, fs.uniqueName(dir, name, n.type === 'dir'));
    fs.move(n.path, target);
    const cell = n.meta?.trashedCell;
    fs.setMeta(target, { trashedFrom: undefined, trashedCell: undefined, ...(cell && from && dir === dirname(from) ? { x: cell.x, y: cell.y } : {}) });
    return target;
  },

  /**
   * Permanently deletes the Trash's contents.
   *
   * Unless `includeLocked` is set, every locked item is kept together with everything inside it
   * and the folders leading to it; callers ask the user first, like Finder does.
   *
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.includeLocked] - Also delete locked items.
   * @returns {number} Number of top-level Trash items that were removed.
   *
   * @example
   * fs.emptyTrash({ includeLocked: true });
   */
  emptyTrash(opts: { includeLocked?: boolean } = {}): number {
    const items = childrenOf(nodes(), PATHS.trash);
    const keep = new Set<string>();
    if (!opts.includeLocked) {
      for (const k of descendantsOf(nodes(), PATHS.trash)) {
        if (!nodes()[k].meta?.locked) continue;
        for (let p = k; p !== PATHS.trash && p !== '/'; p = dirname(p)) keep.add(p);
        for (const c of descendantsOf(nodes(), k)) keep.add(c);
      }
    }
    commit((d) => {
      for (const k of descendantsOf(d, PATHS.trash)) if (!keep.has(k)) delete d[k];
      touchDir(d, PATHS.trash);
    });
    return items.filter((n) => !keep.has(n.path)).length;
  },

  /**
   * Counts the locked items anywhere in the Trash.
   *
   * Scans every descendant of ~/.Trash, so locked items nested inside trashed folders count too.
   *
   * @returns {number} Number of locked nodes at any depth inside the Trash.
   *
   * @example
   * if (fs.lockedInTrash() > 0) askAboutLockedItems();
   */
  lockedInTrash(): number {
    return descendantsOf(nodes(), PATHS.trash).filter((k) => nodes()[k].meta?.locked).length;
  },

  /**
   * Counts the items at the top level of the Trash.
   *
   * Only direct children of ~/.Trash are counted; the contents of trashed folders are not.
   *
   * @returns {number} Number of direct children of ~/.Trash.
   *
   * @example
   * const empty = fs.trashCount() === 0;
   */
  trashCount(): number {
    return childrenOf(nodes(), PATHS.trash).length;
  },

  /**
   * Lists every node below a directory.
   *
   * The root itself is excluded; nodes come in store order.
   *
   * @param {string} [root='/'] - Directory to walk.
   * @returns {FSNode[]} All descendant nodes.
   *
   * @example
   * const files = fs.walk(PATHS.home).filter((n) => n.type === 'file');
   */
  walk(root = '/'): FSNode[] {
    return descendantsOf(nodes(), root).map((p) => nodes()[p]);
  },

  /**
   * Searches item names, case-insensitively.
   *
   * Matches nodes whose name contains the trimmed query. Hidden items (names starting with a
   * dot) and everything inside hidden folders, such as the Trash, are skipped. An empty query
   * returns nothing.
   *
   * @param {string} query - Text to look for.
   * @param {string} [root='/'] - Directory to search in.
   * @param {number} [limit=50] - Maximum number of results.
   * @returns {FSNode[]} Matching nodes in store order.
   *
   * @example
   * fs.search('resume', PATHS.home, 10);
   */
  search(query: string, root = '/', limit = 50): FSNode[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: FSNode[] = [];
    for (const p of descendantsOf(nodes(), root)) {
      const n = nodes()[p];
      if (n.name.startsWith('.') || p.includes('/.')) continue;
      if (n.name.toLowerCase().includes(q)) out.push(n);
      if (out.length >= limit) break;
    }
    return out;
  },

  /**
   * Tells whether an item can't be deleted, renamed or moved.
   *
   * True for system and standard folders, locked items and anything inside /System or
   * /Applications.
   *
   * @param {string} path - Path of the item (normalized first).
   * @returns {boolean} True when the item is protected.
   *
   * @example
   * const canRename = !fs.isProtected(path);
   */
  isProtected(path: string): boolean {
    return isProtected(normalize(path));
  },

  /**
   * Runs a function with system privileges.
   *
   * While `fn` runs, items may be created outside the user folders and locked folders may be
   * changed; protected items stay protected. Calls can be nested. Used for seeding and tests.
   *
   * @param {() => T} fn - Function to run.
   * @returns {T} Whatever `fn` returns.
   * @throws {unknown} Rethrows any error thrown by `fn`.
   *
   * @example
   * fs.sudo(() => fs.writeFile('/System/Library/version.txt', '1.0'));
   */
  sudo<T>(fn: () => T): T {
    sudoDepth++;
    try {
      return fn();
    } finally {
      sudoDepth--;
    }
  },

  /**
   * Tells whether new items may be created inside a directory.
   *
   * True inside the home folder, /Users/Shared and /tmp; locked folders are not considered.
   *
   * @param {string} dir - Path of the directory.
   * @returns {boolean} True when the directory is inside a writable root.
   *
   * @example
   * const canSave = fs.isWritableDir(dir);
   */
  isWritableDir(dir: string): boolean {
    const d = normalize(dir);
    return WRITABLE_ROOTS.some((r) => isWithin(d, r));
  },

  /**
   * Finds the current path of an item that was moved or renamed away from a path.
   *
   * Follows the renames and moves recorded during this session (e.g. Notes renaming a note after
   * its title), up to 50 hops, and checks that the final path exists.
   *
   * @param {string} path - The old path.
   * @returns {string | null} The current path, or null when the item didn't move or nothing
   *   exists at the final path.
   *
   * @example
   * const next = fs.movedTo(openDocumentPath);
   * if (next) setPath(next);
   */
  movedTo(path: string): string | null {
    let p = normalize(path);
    for (let hops = 0; hops < 50; hops++) {
      const next = moveJournal.get(p);
      if (!next) break;
      p = next;
    }
    return p !== normalize(path) && nodes()[p] ? p : null;
  },

  /**
   * Replaces the whole tree.
   *
   * Used by seeding and "Erase All Content". No checks are made.
   *
   * @param {Record<string, FSNode>} next - The new node map, keyed by absolute path.
   * @param {string} seedVersion - Version of the seed data the tree was built from.
   * @returns {void}
   *
   * @example
   * fs.replaceAll(buildSeed(), seedHash);
   */
  replaceAll(next: Record<string, FSNode>, seedVersion: string): void {
    useFS.setState({ nodes: next, seedVersion });
  },
}; /** File system API: every read and mutation of the virtual FS; failures throw `FSError`. */

/**
 * Returns the size of a file node in bytes.
 *
 * Text files report the UTF-8 length of their content. `src`-backed files report `bytes` when
 * known, otherwise an estimate from the length of a base64 `data:` URL (0 for other URLs).
 *
 * @param {FSNode} n - A file node.
 * @returns {number} Size in bytes.
 *
 * @example
 * fileSize({ ...node, content: 'héllo' }); // 6
 */
function fileSize(n: FSNode): number {
  if (n.src) return n.bytes ?? Math.round((n.src.startsWith('data:') ? n.src.length * 0.75 : 0) || 0);
  return new TextEncoder().encode(n.content ?? '').length;
}

/**
 * Updates a directory's modification time inside a draft node map.
 *
 * Does nothing when the directory is not in the map.
 *
 * @param {Record<string, FSNode>} d - Draft node map being committed.
 * @param {string} dir - Path of the directory.
 * @returns {void}
 *
 * @example
 * commit((d) => { d[p] = node; touchDir(d, dirname(p)); });
 */
function touchDir(d: Record<string, FSNode>, dir: string) {
  const n = d[dir];
  if (n) d[dir] = { ...n, modifiedAt: now() };
}

export const fileSizeOf = fileSize; /** Size of a file node in bytes (UTF-8 text length, or the size of a `src`-backed file). */

/* ───────────────────────── Sorting ───────────────────────── */

/** Column a file list can be sorted by. */
export type SortKey = 'name' | 'kind' | 'date' | 'size';

/**
 * Sorts nodes the way Finder lists do.
 *
 * Returns a new array. Names compare with natural, case- and accent-insensitive collation
 * ("file 2" before "file 10"); `date` puts the most recently modified first, `size` the largest
 * first (folders count as 0), and `kind` groups by kind, then name. With `dirsFirst`, folders
 * come before files.
 *
 * @param {FSNode[]} list - Nodes to sort (not modified).
 * @param {SortKey} [key='name'] - Sort column.
 * @param {boolean} [dirsFirst=false] - List folders before files.
 * @returns {FSNode[]} The sorted copy.
 *
 * @example
 * sortNodes(fs.readdir(PATHS.documents), 'date');
 */
export function sortNodes(list: FSNode[], key: SortKey = 'name', dirsFirst = false): FSNode[] {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...list].sort((a, b) => {
    if (dirsFirst && a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    switch (key) {
      case 'date':
        return b.modifiedAt - a.modifiedAt;
      case 'size':
        return fileSize(b) - fileSize(a);
      case 'kind':
        return kindOf(a).localeCompare(kindOf(b)) || coll.compare(a.name, b.name);
      default:
        return coll.compare(a.name, b.name);
    }
  });
}

/* ───────────────────────── React hooks ───────────────────────── */

/**
 * Subscribes a component to one node.
 *
 * Re-renders when the node at the (normalized) path changes, appears or disappears.
 *
 * @param {string | null | undefined} path - Path of the node, or nothing.
 * @returns {FSNode | undefined} The node, or undefined when there is no path or no node.
 *
 * @example
 * const node = useNode(props.path);
 */
export function useNode(path: string | null | undefined): FSNode | undefined {
  return useFS((s) => (path ? s.nodes[normalize(path)] : undefined));
}

/**
 * Subscribes a component to the children of a directory.
 *
 * The child list is compared shallowly, so the component only re-renders when a child node is
 * added, removed or replaced. Hidden items (dotfiles and items with `meta.hidden`) are left out
 * unless `showHidden`, and the result is sorted with `sortNodes`. Returns an empty array when the
 * path is not a directory.
 *
 * @param {string | null | undefined} path - Path of the directory, or nothing.
 * @param {Object} [opts={}] - Options.
 * @param {SortKey} [opts.sort='name'] - Sort column.
 * @param {boolean} [opts.dirsFirst=false] - List folders before files.
 * @param {boolean} [opts.showHidden] - Include hidden items.
 * @returns {FSNode[]} The visible children, sorted.
 *
 * @example
 * const items = useDir(PATHS.desktop, { sort: 'kind', dirsFirst: true });
 */
export function useDir(path: string | null | undefined, opts: { sort?: SortKey; dirsFirst?: boolean; showHidden?: boolean } = {}): FSNode[] {
  const list = useFS(useShallow((s) => (path && s.nodes[normalize(path)]?.type === 'dir' ? childrenOf(s.nodes, path) : [])));
  const { showHidden, sort = 'name', dirsFirst = false } = opts;
  return useMemo(() => {
    const visible = showHidden ? list : list.filter((n) => !n.name.startsWith('.') && !n.meta?.hidden);
    return sortNodes(visible, sort, dirsFirst);
  }, [list, showHidden, sort, dirsFirst]);
}

/**
 * Subscribes a component to the number of items in the Trash.
 *
 * Selects the count of direct children of ~/.Trash from the store, so the component re-renders
 * only when that number changes (e.g. to swap the Dock's empty / full Trash icon).
 *
 * @returns {number} Number of top-level items in ~/.Trash.
 *
 * @example
 * const full = useTrashCount() > 0;
 */
export function useTrashCount(): number {
  return useFS((s) => childrenOf(s.nodes, PATHS.trash).length);
}

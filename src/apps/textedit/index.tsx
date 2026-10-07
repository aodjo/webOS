/**
 * TextEdit — plain-text document editor.
 *
 * Each window is one document backed by a file in the virtual FS (or an "Untitled" document).
 * The editor is a controlled <textarea> whose value always equals what the user typed, so the
 * browser's native undo stack keeps working; programmatic edits use execCommand('insertText').
 * The window tracks its file: external edits reload (or raise a banner when there are unsaved
 * changes), renames/moves are followed, deletion is detected.
 */
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import {
  COMMON,
  PATHS,
  basename,
  defaultAppFor,
  dialogs,
  dirname,
  extname,
  fmt,
  fs,
  getDragPaths,
  hasDragPaths,
  hasHostFiles,
  importHostFiles,
  isTextFile,
  isWithin,
  kindOf,
  normalize,
  renamePath,
  revealInFinder,
  showFSError,
  useAppMenus,
  useBeforeClose,
  useNode,
  useT,
  useWM,
  wm,
  type AppProps,
  type FSNode,
  type MenuDef,
  type MenuItem,
} from '@/kernel';
import { Button, EmptyState } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { FindBar, type FindBarHandle } from './FindBar';
import { caretPosition, insertText, isComposing, replaceRange, textStats } from './editing';
import { findMatches, matchIndexFrom, replaceAllText, type Match } from './find';
import { findMovedFile, type FileIdentity } from './fileTracking';
import styles from './TextEdit.module.css';

/* ───────────────────────── Strings ───────────────────────── */

const S = {
  deleted: { en: '(Deleted)', ko: '(삭제됨)' },
  new: { en: 'New', ko: '신규' },
  open: { en: 'Open…', ko: '열기…' },
  close: { en: 'Close', ko: '닫기' },
  save: { en: 'Save…', ko: '저장…' },
  saveAs: { en: 'Save As…', ko: '다른 이름으로 저장…' },
  rename: { en: 'Rename…', ko: '이름 변경…' },
  renameTitle: { en: 'Rename', ko: '이름 변경' },
  renameMsg: { en: 'Enter a new name for the document.', ko: '문서의 새로운 이름을 입력하십시오.' },
  revert: { en: 'Revert to Saved', ko: '저장된 상태로 되돌리기' },
  /**
   * Builds the title of the Revert to Saved confirmation.
   *
   * Inserts the document name, in quotes, into both the English and the Korean question.
   *
   * @param {string} n - Name of the document's file.
   * @returns {LString} The localized title.
   *
   * @example
   * t(S.revertTitle('notes.txt')); // 'Revert “notes.txt” to the last saved version?'
   */
  revertTitle: (n: string) => ({ en: `Revert “${n}” to the last saved version?`, ko: `“${n}”을(를) 마지막으로 저장된 버전으로 되돌리겠습니까?` }),
  revertMsg: { en: 'Your current changes will be lost.', ko: '현재 변경 사항이 손실됩니다.' },
  revertOk: { en: 'Revert', ko: '되돌리기' },
  showInFinder: { en: 'Show in Finder', ko: 'Finder에서 보기' },
  exportDoc: { en: 'Download a Copy…', ko: '사본 다운로드…' },
  undo: COMMON.undo,
  redo: COMMON.redo,
  cut: COMMON.cut,
  copy: COMMON.copy,
  paste: COMMON.paste,
  selectAll: COMMON.selectAll,
  find: { en: 'Find', ko: '찾기' },
  findEllipsis: { en: 'Find…', ko: '찾기…' },
  findReplace: { en: 'Find and Replace…', ko: '찾기 및 대치…' },
  findNext: { en: 'Find Next', ko: '다음 찾기' },
  findPrev: { en: 'Find Previous', ko: '이전 찾기' },
  useSelection: { en: 'Use Selection for Find', ko: '선택 항목으로 찾기' },
  spelling: { en: 'Check Spelling While Typing', ko: '입력하는 동안 철자 검사' },
  format: { en: 'Format', ko: '포맷' },
  font: { en: 'Font', ko: '서체' },
  bigger: { en: 'Bigger', ko: '크게' },
  smaller: { en: 'Smaller', ko: '작게' },
  defaultSize: { en: 'Default Size', ko: '기본 크기' },
  mono: { en: 'Monospaced Font', ko: '고정폭 서체' },
  wrap: { en: 'Wrap to Window', ko: '윈도우에 맞게 줄바꿈' },
  view: COMMON.view,
  showStatus: { en: 'Show Status Bar', ko: '상태 막대 보기' },
  hideStatus: { en: 'Hide Status Bar', ko: '상태 막대 가리기' },
  showPreview: { en: 'Show Preview', ko: '미리보기 보기' },
  hidePreview: { en: 'Hide Preview', ko: '미리보기 가리기' },
  changedTitle: { en: 'The file has been changed by another application.', ko: '다른 응용 프로그램에서 파일이 변경되었습니다.' },
  changedMsg: { en: 'Keep your version, or revert to the version on disk?', ko: '현재 버전을 유지하거나 디스크에 있는 버전으로 되돌릴 수 있습니다.' },
  keep: { en: 'Keep', ko: '유지' },
  deletedBanner: { en: 'This document’s file was deleted or moved. Save to keep your text.', ko: '이 문서의 파일이 삭제되거나 이동되었습니다. 텍스트를 유지하려면 저장하십시오.' },
  lineCol: { en: 'Line {l}, Column {c}', ko: '{l}행, {c}열' },
  selected: { en: '{n} selected', ko: '{n}자 선택됨' },
  words: { en: '{n} words', ko: '단어 {n}개' },
  chars: { en: '{n} characters', ko: '문자 {n}개' },
  lines: { en: '{n} lines', ko: '{n}줄' },
  missingTitle: { en: 'The document couldn’t be opened.', ko: '문서를 열 수 없습니다.' },
  /**
   * Builds the message shown when the window's file does not exist.
   *
   * Inserts the file name, in quotes, into both the English and the Korean message.
   *
   * @param {string} n - Name of the missing file.
   * @returns {LString} The localized message.
   *
   * @example
   * t(S.missingMsg('todo.txt')); // 'The file “todo.txt” doesn’t exist.'
   */
  missingMsg: (n: string) => ({ en: `The file “${n}” doesn’t exist.`, ko: `“${n}” 파일이 존재하지 않습니다.` }),
  binaryTitle: { en: 'This document can’t be shown in TextEdit.', ko: '이 문서는 텍스트 편집기에서 볼 수 없습니다.' },
  /**
   * Builds the message shown when the window's file is not plain text.
   *
   * Inserts the file name, in quotes, into both the English and the Korean message.
   *
   * @param {string} n - Name of the binary file.
   * @returns {LString} The localized message.
   *
   * @example
   * t(S.binaryMsg('photo.png')); // '“photo.png” isn’t a plain-text document.'
   */
  binaryMsg: (n: string) => ({ en: `“${n}” isn’t a plain-text document.`, ko: `“${n}”은(는) 일반 텍스트 문서가 아닙니다.` }),
  openPreview: { en: 'Open in Preview', ko: '미리보기에서 열기' },
  newDoc: { en: 'New Document', ko: '새로운 문서' },
}; /** Localized strings for TextEdit's menus, dialogs, banners, status bar and empty states. */

/* ───────────────────────── Preferences (per browser) ───────────────────────── */

/** Editor preferences shared by every TextEdit window in this browser. */
interface Prefs {
  /** Editor font size in pixels. */
  fontSize: number;
  /** Soft-wrap lines to the window width. */
  wrap: boolean;
  /** Show the line/column and word-count bar. */
  statusBar: boolean;
  /** Enable the browser's spell checking. */
  spellcheck: boolean;
}

const PREFS_KEY = 'webos.textedit.prefs'; /** localStorage key holding the JSON-encoded preferences. */
const DEFAULT_PREFS: Prefs = { fontSize: 14, wrap: true, statusBar: true, spellcheck: false }; /** Preferences used when nothing (or an invalid value) is stored. */

/**
 * Loads the editor preferences from localStorage.
 *
 * Stored values are merged over `DEFAULT_PREFS`, so missing keys fall back to their defaults.
 * Unavailable storage or invalid JSON yields the defaults.
 *
 * @returns {Prefs} The effective preferences.
 *
 * @example
 * const [prefs, setPrefs] = useState(loadPrefs);
 */
function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * Persists the editor preferences to localStorage.
 *
 * Failures (storage disabled or full) are ignored; the preferences then last only for the
 * session.
 *
 * @param {Prefs} p - The preferences to store.
 * @returns {void}
 *
 * @example
 * savePrefs({ ...prefs, wrap: false });
 */
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/* ───────────────────────── Untitled numbering ───────────────────────── */

const untitledInUse = new Set<number>(); /** "Untitled", "Untitled 2"… numbers held by open windows; freed when a window closes or saves. */

/**
 * Reserves the lowest free "Untitled" number.
 *
 * Adds the number to `untitledInUse`; the caller removes it again when the document gets a
 * file or its window closes.
 *
 * @returns {number} The reserved number (1 is shown as plain "Untitled").
 *
 * @example
 * const n = allocUntitled(); // 1, then 2 for a second window…
 */
function allocUntitled(): number {
  let n = 1;
  while (untitledInUse.has(n)) n++;
  untitledInUse.add(n);
  return n;
}

/* ───────────────────────── Helpers ───────────────────────── */

const TEXT_EXTENSIONS = ['', 'txt', 'md', 'markdown', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'xml', 'plist', 'csv', 'log', 'sh', 'py', 'yml', 'yaml', 'webloc', 'url']; /** Extensions the Open panel lets you pick ('' = no extension, e.g. README or dotfiles). */
const SPACE_INDENT = ['md', 'markdown', 'yml', 'yaml']; /** Extensions where Tab inserts two spaces instead of a tab character. */
const MIN_FONT = 9; /** Smallest editor font size in pixels. */
const MAX_FONT = 48; /** Largest editor font size in pixels. */

/**
 * Whether the document is editable (`ok`), its file does not exist (`missing`) or it is not
 * plain text (`binary`).
 */
type Status = 'ok' | 'missing' | 'binary';
/** The file content and identity last read from or written to disk. */
type Disk = FileIdentity & { content: string };

/**
 * Reads a document's initial state from the virtual file system.
 *
 * A null path is an empty Untitled document. A path that is not a file is `missing`, and a
 * file with a `src` (binary data) is `binary`; both have no text and no disk snapshot.
 *
 * @param {string | null} path - The document's file path, or null for Untitled.
 * @returns {{ text: string; status: Status; disk: Disk | null }} The text to edit, the document
 *   status and the disk snapshot used to detect external changes.
 *
 * @example
 * const { text, status } = readDoc(`${PATHS.documents}/todo.txt`);
 */
function readDoc(path: string | null): { text: string; status: Status; disk: Disk | null } {
  if (!path) return { text: '', status: 'ok', disk: null };
  const node = fs.stat(path);
  if (!node || node.type !== 'file') return { text: '', status: 'missing', disk: null };
  if (node.src) return { text: '', status: 'binary', disk: null };
  const content = node.content ?? '';
  return { text: content, status: 'ok', disk: { createdAt: node.createdAt, content } };
}

/**
 * Tells whether a path names a Markdown file.
 *
 * Compares the path's extension, as returned by `extname`, with `md` and `markdown`. A null
 * path (an Untitled document) is never Markdown.
 *
 * @param {string | null} p - The file path, or null.
 * @returns {boolean} True for Markdown files.
 *
 * @example
 * isMarkdownPath('/a/README.md'); // true
 */
const isMarkdownPath = (p: string | null) => !!p && (extname(p) === 'md' || extname(p) === 'markdown');

/**
 * Tells whether a file should open in the monospaced font.
 *
 * True when the file's kind (from its name) is source code.
 *
 * @param {string | null} p - The file path, or null.
 * @returns {boolean} True for code files.
 *
 * @example
 * prefersMono('/a/main.ts'); // true
 */
const prefersMono = (p: string | null) => !!p && kindOf({ type: 'file', name: basename(p) }) === 'code';

/**
 * Downloads text to the host computer as a UTF-8 plain-text file.
 *
 * Creates a Blob URL, clicks a temporary `<a download>` link and revokes the URL two seconds
 * later.
 *
 * @param {string} name - The suggested file name.
 * @param {string} text - The file contents.
 * @returns {void}
 *
 * @example
 * downloadText('notes.txt', 'Hello');
 */
function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Stores a document's current file path in its window's args.
 *
 * Other code reads `args.path` (the "already open?" checks in `wm.openPath` and
 * `openDocument`, the title bar's proxy icon), so it is updated whenever the document's file
 * changes. Does nothing when the window is gone or the path is unchanged; a null path clears it.
 *
 * @param {string} windowId - The TextEdit window.
 * @param {string | null} path - The document's file path, or null for Untitled.
 * @returns {void}
 *
 * @example
 * rememberPath(windowId, moved.path);
 */
function rememberPath(windowId: string, path: string | null): void {
  const w = useWM.getState().windows.find((x) => x.id === windowId);
  if (w && w.args.path !== (path ?? undefined)) wm.update(windowId, { args: { ...w.args, path: path ?? undefined } });
}

/* ───────────────────────── Component ───────────────────────── */

/**
 * TextEdit window: one plain-text document per window.
 *
 * Opens `args.path` (or an "Untitled" document) into a controlled textarea and keeps the
 * window title, the "Edited" dot and the menus in sync with it. The document follows its file:
 * when the node at its path changes, a clean document reloads and a dirty one shows a
 * "changed by another application" banner; when the node disappears, the kernel's move journal
 * is consulted to follow renames and moves, otherwise the document is marked deleted and offers
 * Save As. `edited` means the text differs from the file (or an Untitled document has text);
 * `dirty` also covers text whose file was deleted and decides whether closing asks to save.
 * An untouched Untitled window is reused for the next document opened from it.
 *
 * Find & replace paints matches in a mirror layer behind the textarea that scrolls with it.
 * After a single Replace, the first match at or after the replaced text is selected once the
 * matches are recomputed. Markdown files can show a live preview that scrolls with the source.
 * Font size, wrapping, the status bar and spell checking are per-browser preferences.
 * Menu actions call the component's handlers through a ref that is refreshed after every
 * render, so they always use the latest closures.
 *
 * @param {AppProps} props - Window props supplied by the window manager.
 * @param {string} props.windowId - ID of the window hosting this document.
 * @param {AppArgs} props.args - Launch arguments; `args.path` is the file to open.
 * @returns {JSX.Element} The editor, or an empty state when the file is missing or not plain text.
 *
 * @example
 * <TextEdit windowId="w1" pid={3} args={{ path: `${PATHS.documents}/notes.txt` }} />
 */
export default function TextEdit({ windowId, args }: AppProps) {
  const t = useT();
  const focused = useWM((s) => s.focusedId === windowId);

  const [init] = useState(() => {
    const p = typeof args.path === 'string' ? normalize(args.path) : null;
    return { path: p, ...readDoc(p) };
  });
  const [path, setPath] = useState<string | null>(init.path);
  const [status, setStatus] = useState<Status>(init.status);
  const [text, setText] = useState(init.text);
  const [savedText, setSavedText] = useState(init.text);
  const [deleted, setDeleted] = useState(false);
  const [external, setExternal] = useState<string | null>(null);
  const diskRef = useRef<Disk | null>(init.disk);

  const [prefs, setPrefs] = useState(loadPrefs);
  const [mono, setMono] = useState(() => prefersMono(init.path));
  const [showPreview, setShowPreview] = useState(false);
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  const [untitledNo, setUntitledNo] = useState(0);

  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [reveal, setReveal] = useState(0);
  const [dropping, setDropping] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<FindBarHandle>(null);
  const nextFromRef = useRef<number | null>(null);

  const isMd = isMarkdownPath(path);
  const previewVisible = showPreview && isMd;
  const hasPath = path !== null;

  // "Untitled" numbers are held only while the document has no file (allocated before paint).
  useLayoutEffect(() => {
    if (hasPath) return;
    const n = allocUntitled();
    setUntitledNo(n);
    return () => {
      untitledInUse.delete(n);
    };
  }, [hasPath]);

  const untitledName = untitledNo > 1 ? `${t(COMMON.untitled)} ${untitledNo}` : t(COMMON.untitled);
  const displayName = path ? basename(path) : untitledName;
  const edited = status === 'ok' && (path ? text !== savedText : text !== '');
  const dirty = edited || (status === 'ok' && !!path && deleted && text !== '');

  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
  });

  useEffect(() => {
    wm.setTitle(windowId, path && deleted ? `${displayName} ${t(S.deleted)}` : displayName);
    wm.setDirty(windowId, dirty);
  }, [windowId, displayName, path, deleted, dirty, t]);

  useEffect(() => savePrefs(prefs), [prefs]);

  /* ── Loading / tracking the file ── */

  /**
   * Replaces the document with a file's current contents.
   *
   * Updates the disk snapshot, the text and the saved text, and clears the external-change
   * banner and the deleted flag. The edit replaces the textarea value, so it is not undoable.
   *
   * @param {FSNode} node - The file to load.
   * @returns {void}
   *
   * @example
   * loadNode(fs.stat(path)!);
   */
  const loadNode = useCallback((node: FSNode) => {
    const content = node.content ?? '';
    diskRef.current = { createdAt: node.createdAt, content };
    setText(content);
    setSavedText(content);
    setExternal(null);
    setDeleted(false);
  }, []);

  const node = useNode(path);
  useEffect(() => {
    if (!path || status !== 'ok') return;
    const disk = diskRef.current;
    if (!node || node.type !== 'file' || node.src) {
      const moved = disk ? findMovedFile(disk, path) : null;
      if (moved && !isWithin(moved.path, PATHS.trash)) {
        setPath(moved.path);
        rememberPath(windowId, moved.path);
      } else setDeleted(true);
      return;
    }
    setDeleted(false);
    const content = node.content ?? '';
    // The identity follows whatever file lives at our path (it may have been replaced), so a
    // later move of that file is recognised by the kernel's move journal.
    if (disk && disk.createdAt !== node.createdAt) diskRef.current = { ...disk, createdAt: node.createdAt };
    if (disk && disk.content === content) return;
    if (!dirtyRef.current) loadNode(node);
    else setExternal(content);
  }, [node, path, status, windowId, loadNode]);

  /* ── Saving ── */

  /**
   * Writes the document's text to a file.
   *
   * Reads the live textarea value (falling back to the `text` state), updates the disk
   * snapshot and saved text, and clears the banners. Writing to a different path makes it the
   * document's file, records it in the window args and switches to the monospaced font for
   * code files. File-system errors are shown as an alert instead of being thrown.
   *
   * @param {string} p - The destination path.
   * @returns {boolean} True when the file was written.
   *
   * @example
   * if (writeTo(path)) console.log('saved');
   */
  const writeTo = useCallback(
    (p: string): boolean => {
      try {
        const written = fs.writeFile(p, taRef.current?.value ?? text);
        const content = written.content ?? '';
        diskRef.current = { createdAt: written.createdAt, content };
        setSavedText(content);
        setExternal(null);
        setDeleted(false);
        if (p !== path) {
          setPath(p);
          rememberPath(windowId, p);
          setMono((m) => m || prefersMono(p));
        }
        return true;
      } catch (e) {
        void showFSError(e, windowId);
        return false;
      }
    },
    [path, text, windowId],
  );

  /**
   * Asks for a destination with the Save panel and writes the document there.
   *
   * Suggests the current file name (or the Untitled name plus `.txt`) in the file's folder,
   * or in Documents when the document has no file, its folder is gone, or it is in the Trash.
   *
   * @async
   * @returns {Promise<boolean>} True when the file was written; false when cancelled or failed.
   *
   * @example
   * await saveAs();
   */
  const saveAs = useCallback(async (): Promise<boolean> => {
    const name = path ? basename(path) : `${untitledName}.txt`;
    const dir = path && fs.isDir(dirname(path)) && !isWithin(path, PATHS.trash) ? dirname(path) : PATHS.documents;
    const p = await dialogs.save({ windowId, defaultName: name, defaultDir: dir });
    if (!p) return false;
    return writeTo(p);
  }, [path, untitledName, windowId, writeTo]);

  /**
   * Saves the document to its file, or asks for one.
   *
   * Writes in place when the document has a file that still exists; otherwise (Untitled or
   * deleted) falls back to `saveAs`.
   *
   * @async
   * @returns {Promise<boolean>} True when the file was written.
   *
   * @example
   * const saved = await save();
   */
  const save = useCallback(async (): Promise<boolean> => {
    if (path && !deleted && fs.exists(path)) return writeTo(path);
    return saveAs();
  }, [path, deleted, writeTo, saveAs]);

  /**
   * Discards unsaved changes after confirmation and reloads the file.
   *
   * Does nothing when the document has no file or nothing exists at its path.
   *
   * @async
   * @returns {Promise<void>} Resolves once the dialog is dismissed and the file is reloaded.
   *
   * @example
   * void revert();
   */
  const revert = useCallback(async () => {
    if (!path) return;
    const n = fs.stat(path);
    if (!n || n.type !== 'file') return;
    const ok = await dialogs.confirm({ windowId, appId: 'textedit', title: S.revertTitle(basename(path)), message: S.revertMsg, okLabel: S.revertOk });
    if (ok) loadNode(n);
  }, [path, windowId, loadNode]);

  /**
   * Asks for a new name and renames the document's file.
   *
   * Uses `renamePath`, which validates the name and reports errors itself; on success the
   * document and its window args follow the new path. Does nothing for Untitled or deleted
   * documents.
   *
   * @async
   * @returns {Promise<void>} Resolves once the prompt is dismissed and the rename is done.
   *
   * @example
   * void rename();
   */
  const rename = useCallback(async () => {
    if (!path || deleted) return;
    const name = await dialogs.prompt({ windowId, title: S.renameTitle, message: S.renameMsg, defaultValue: basename(path) });
    if (!name) return;
    const next = renamePath(path, name, windowId);
    if (next) {
      setPath(next);
      rememberPath(windowId, next);
    }
  }, [path, deleted, windowId]);

  useBeforeClose(async () => {
    if (!dirtyRef.current) return true;
    const r = await dialogs.unsavedChanges({ windowId, appId: 'textedit', name: displayName });
    if (r === 'cancel') return false;
    if (r === 'discard') return true;
    return save();
  });

  /* ── Opening other documents ── */

  const isPristine = !path && text === '' && status === 'ok';
  const pristineRef = useRef(isPristine);
  useLayoutEffect(() => {
    pristineRef.current = isPristine;
  });

  /**
   * Opens a file as a TextEdit document.
   *
   * Focuses the TextEdit window that already shows the file. Otherwise an untouched Untitled
   * window (this one) is reused, like macOS, and everything else opens a new window. The
   * pristine flag is cleared immediately, so opening several files at once reuses this window
   * only for the first.
   *
   * @param {string} p - The file path.
   * @returns {void}
   *
   * @example
   * openDocument(`${PATHS.documents}/todo.txt`);
   */
  const openDocument = useCallback(
    (p: string) => {
      const target = normalize(p);
      const existing = useWM.getState().windows.find((w) => w.appId === 'textedit' && w.args.path === target);
      if (existing) {
        wm.focus(existing.id);
        return;
      }
      if (pristineRef.current) {
        pristineRef.current = false;
        const d = readDoc(target);
        diskRef.current = d.disk;
        setPath(target);
        setStatus(d.status);
        setText(d.text);
        setSavedText(d.text);
        setDeleted(false);
        setExternal(null);
        setMono(prefersMono(target));
        rememberPath(windowId, target);
      } else wm.openWindow('textedit', { path: target });
    },
    [windowId],
  );

  /**
   * Shows the Open panel for text files and opens the chosen one.
   *
   * Starts in the current file's folder (or Documents) and only lists `TEXT_EXTENSIONS`.
   *
   * @async
   * @returns {Promise<void>} Resolves once the panel is dismissed.
   *
   * @example
   * void openPanel();
   */
  const openPanel = useCallback(async () => {
    const p = await dialogs.open({ windowId, defaultDir: path && fs.isDir(dirname(path)) ? dirname(path) : PATHS.documents, extensions: TEXT_EXTENSIONS });
    if (p) openDocument(p);
  }, [windowId, path, openDocument]);

  /* ── Find & replace ── */

  const matches = useMemo<Match[]>(() => (query ? findMatches(text, query, matchCase) : []), [text, query, matchCase]);
  const cur = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1;
  const showMirror = findOpen && matches.length > 0;

  /**
   * Makes a match the current one and selects it in the textarea.
   *
   * Also updates the caret state and bumps `reveal` so the match is scrolled into view. An
   * index below zero or an empty list clears the current match.
   *
   * @param {number} i - Index of the match in `list`, or -1.
   * @param {Match[]} list - The matches to pick from.
   * @returns {void}
   *
   * @example
   * goTo(0, matches);
   */
  const goTo = useCallback((i: number, list: Match[]) => {
    if (i < 0 || !list.length) {
      setCurrent(-1);
      return;
    }
    const [s, e] = list[i];
    setCurrent(i);
    setCaret({ start: s, end: e });
    taRef.current?.setSelectionRange(s, e);
    setReveal((r) => r + 1);
  }, []);

  /**
   * Selects the next or previous match relative to the current selection.
   *
   * Forward picks the first match starting at or after the selection end; backward picks the
   * last match ending at or before the selection start. Both wrap around. When the find bar is
   * closed there is no highlight layer, so the textarea is focused to scroll to the selection.
   *
   * @param {1 | -1} dir - 1 for Find Next, -1 for Find Previous.
   * @returns {void}
   *
   * @example
   * findStep(1);
   */
  const findStep = useCallback(
    (dir: 1 | -1) => {
      const ta = taRef.current;
      if (!ta || !matches.length) return;
      let i: number;
      if (dir === 1) {
        i = matches.findIndex(([s]) => s >= ta.selectionEnd);
        if (i === -1) i = 0;
      } else {
        i = -1;
        for (let k = matches.length - 1; k >= 0; k--) {
          if (matches[k][1] <= ta.selectionStart) {
            i = k;
            break;
          }
        }
        if (i === -1) i = matches.length - 1;
      }
      goTo(i, matches);
      if (!findOpen) ta.focus();
    },
    [matches, goTo, findOpen],
  );

  /**
   * Opens the find bar, optionally with the replace row.
   *
   * A single-line selection shorter than 200 characters becomes the query, like macOS. The
   * first match at or after the selection is selected, and the find (or replace) field is
   * focused on the next frame, after the bar has mounted.
   *
   * @param {boolean} withReplace - Whether to show and focus the replace field.
   * @returns {void}
   *
   * @example
   * openFind(false);
   */
  const openFind = (withReplace: boolean) => {
    setFindOpen(true);
    if (withReplace) setReplaceOpen(true);
    const ta = taRef.current;
    let q = query;
    if (ta && ta.selectionEnd > ta.selectionStart) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (!sel.includes('\n') && sel.length < 200) q = sel;
    }
    setQuery(q);
    const list = q ? findMatches(text, q, matchCase) : [];
    goTo(matchIndexFrom(list, ta?.selectionStart ?? 0), list);
    requestAnimationFrame(() => (withReplace ? findRef.current?.focusReplace() : findRef.current?.focusFind()));
  };

  /**
   * Closes the find bar and returns focus to the document.
   *
   * The current match, if any, stays selected in the textarea.
   *
   * @returns {void}
   *
   * @example
   * closeFind();
   */
  const closeFind = useCallback(() => {
    setFindOpen(false);
    const ta = taRef.current;
    if (ta) {
      ta.focus({ preventScroll: true });
      if (cur >= 0) ta.setSelectionRange(matches[cur][0], matches[cur][1]);
    }
  }, [cur, matches]);

  /**
   * Uses the textarea's current selection as the find query (Use Selection for Find).
   *
   * Does nothing when the selection is empty.
   *
   * @returns {void}
   *
   * @example
   * findWithSelection();
   */
  const findWithSelection = useCallback(() => {
    const ta = taRef.current;
    if (!ta || ta.selectionEnd <= ta.selectionStart) return;
    setQuery(ta.value.slice(ta.selectionStart, ta.selectionEnd));
  }, []);

  /**
   * Updates the find query and selects the first match at or after the caret.
   *
   * The matches for the new query are computed right away, so the selection moves while the
   * user types; an empty query clears the current match.
   *
   * @param {string} q - The new query.
   * @returns {void}
   *
   * @example
   * onQuery('hello');
   */
  const onQuery = (q: string) => {
    setQuery(q);
    const list = q ? findMatches(text, q, matchCase) : [];
    goTo(matchIndexFrom(list, caret.start), list);
  };

  /**
   * Toggles case-sensitive matching and reselects the first match at or after the caret.
   *
   * The matches are recomputed with the new setting before the state update lands, so the
   * selection reflects the toggled case rule immediately.
   *
   * @returns {void}
   *
   * @example
   * onToggleCase();
   */
  const onToggleCase = () => {
    const mc = !matchCase;
    setMatchCase(mc);
    const list = query ? findMatches(text, query, mc) : [];
    goTo(matchIndexFrom(list, caret.start), list);
  };

  /**
   * Remembers the focused element so focus can return to the find bar after an edit.
   *
   * Replacing text focuses the textarea; the returned function puts focus back on the element
   * that was focused when `keepFindFocus` ran, if it belongs to the find bar.
   *
   * @returns {() => void} Restores focus to the remembered find-bar control.
   *
   * @example
   * const restore = keepFindFocus();
   * replaceRange(ta, s, e, replacement);
   * restore();
   */
  const keepFindFocus = () => {
    const active = document.activeElement;
    return () => {
      if (active instanceof HTMLElement && findRef.current?.contains(active)) active.focus();
    };
  };

  /**
   * Replaces the current match with the replacement text as an undoable edit.
   *
   * Records the offset after the inserted text so the next match is selected once the matches
   * are recomputed. Keeps focus in the find bar.
   *
   * @returns {void}
   *
   * @example
   * replaceOne();
   */
  const replaceOne = () => {
    const ta = taRef.current;
    if (!ta || cur < 0) return;
    const restore = keepFindFocus();
    const [s, e] = matches[cur];
    nextFromRef.current = s + replacement.length;
    replaceRange(ta, s, e, replacement);
    restore();
  };

  /**
   * Replaces every match in the document as one undoable edit.
   *
   * Does nothing when the query is empty or has no matches; afterwards the caret is placed at
   * the start of the document and focus stays in the find bar.
   *
   * @returns {void}
   *
   * @example
   * replaceAll();
   */
  const replaceAll = () => {
    const ta = taRef.current;
    if (!ta || !query) return;
    const { text: next, count } = replaceAllText(ta.value, query, replacement, matchCase);
    if (!count) return;
    const restore = keepFindFocus();
    replaceRange(ta, 0, ta.value.length, next, [0, 0]);
    restore();
  };

  // After a single Replace, move on to the next occurrence.
  useLayoutEffect(() => {
    if (nextFromRef.current === null) return;
    const from = nextFromRef.current;
    nextFromRef.current = null;
    goTo(matchIndexFrom(matches, from), matches);
  }, [matches, goTo]);

  /**
   * Scrolls the match-highlight layer to the textarea's scroll position.
   *
   * Does nothing while the highlight layer is not mounted.
   *
   * @returns {void}
   *
   * @example
   * syncMirror();
   */
  const syncMirror = useCallback(() => {
    const ta = taRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }, []);

  useLayoutEffect(syncMirror, [syncMirror, text, showMirror, prefs.fontSize, prefs.wrap, mono]);

  // Scroll the current match (positioned by the highlight layer) into view, a third from the edge.
  useLayoutEffect(() => {
    if (!reveal) return;
    const ta = taRef.current;
    const mark = mirrorRef.current?.querySelector<HTMLElement>('[data-current]');
    if (!ta || !mark) return;
    const { offsetTop: top, offsetHeight: h, offsetLeft: left, offsetWidth: w } = mark;
    if (top < ta.scrollTop || top + h > ta.scrollTop + ta.clientHeight) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    if (left < ta.scrollLeft || left + w > ta.scrollLeft + ta.clientWidth) ta.scrollLeft = Math.max(0, left - ta.clientWidth / 3);
    syncMirror();
  }, [reveal, syncMirror]);

  const highlighted = useMemo<ReactNode[] | null>(() => {
    if (!showMirror) return null;
    const out: ReactNode[] = [];
    let last = 0;
    // Very common queries in huge documents: only paint the first couple of thousand.
    const limit = Math.min(matches.length, 2000);
    for (let i = 0; i < limit; i++) {
      const [s, e] = matches[i];
      if (s > last) out.push(text.slice(last, s));
      out.push(
        <mark key={i} className={i === cur ? styles.current : undefined} data-current={i === cur ? '' : undefined}>
          {text.slice(s, e)}
        </mark>,
      );
      last = e;
    }
    out.push(text.slice(last) + '​');
    return out;
  }, [showMirror, matches, cur, text]);

  /* ── Editing ── */

  /**
   * Handles Tab and Escape in the textarea.
   *
   * A plain Tab inserts a tab character, or two spaces in Markdown and YAML files, as an
   * undoable edit. Escape closes the find bar. Keys are ignored during IME composition.
   *
   * @param {KeyboardEvent<HTMLTextAreaElement>} e - The keydown event.
   * @returns {void}
   *
   * @example
   * <textarea onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposing(e)) return;
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      insertText(e.currentTarget, SPACE_INDENT.includes(extname(path ?? '')) ? '  ' : '\t');
    } else if (e.key === 'Escape' && findOpen) {
      e.preventDefault();
      setFindOpen(false);
    }
  };

  /**
   * Copies the textarea's selection into the caret state.
   *
   * Keeps the previous state object when the selection is unchanged to avoid re-renders.
   *
   * @returns {void}
   *
   * @example
   * <textarea onSelect={updateCaret} />
   */
  const updateCaret = () => {
    const ta = taRef.current;
    if (ta) setCaret((c) => (c.start === ta.selectionStart && c.end === ta.selectionEnd ? c : { start: ta.selectionStart, end: ta.selectionEnd }));
  };

  /**
   * Keeps the highlight layer and the Markdown preview in step with the textarea's scroll.
   *
   * The preview is scrolled to the same fraction of its scrollable height as the source.
   *
   * @returns {void}
   *
   * @example
   * <textarea onScroll={onScroll} />
   */
  const onScroll = () => {
    syncMirror();
    const ta = taRef.current;
    const pv = previewRef.current;
    if (ta && pv && previewVisible) {
      const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
      pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
    }
  };

  /**
   * Finds the text field an Edit-menu command applies to.
   *
   * Returns the focused input or textarea when it is inside this window (e.g. the find bar),
   * otherwise the document textarea.
   *
   * @returns {HTMLInputElement | HTMLTextAreaElement | null} The target field, or null before mount.
   *
   * @example
   * editTarget()?.focus();
   */
  const editTarget = (): HTMLInputElement | HTMLTextAreaElement | null => {
    const el = document.activeElement;
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && rootRef.current?.contains(el)) return el;
    return taRef.current;
  };

  /**
   * Runs an Edit-menu command on the window's focused text field.
   *
   * Focuses the target field and runs `document.execCommand(cmd)`. When copying a selection in
   * the Markdown preview, focus is left alone so that selection is what gets copied.
   * Unsupported commands are ignored.
   *
   * @param {'undo' | 'redo' | 'cut' | 'copy' | 'selectAll'} cmd - The command to run.
   * @returns {void}
   *
   * @example
   * editCommand('undo');
   */
  const editCommand = (cmd: 'undo' | 'redo' | 'cut' | 'copy' | 'selectAll') => {
    const sel = window.getSelection();
    const previewSelection = cmd === 'copy' && !!sel && !sel.isCollapsed && !!previewRef.current?.contains(sel.anchorNode);
    if (!previewSelection) editTarget()?.focus();
    try {
      document.execCommand(cmd);
    } catch {
      /* unsupported */
    }
  };

  /**
   * Pastes the host clipboard's text into the window's focused text field.
   *
   * Reads the clipboard asynchronously; the document gets an undoable `insertText`, other
   * fields an `execCommand('insertText')`. Clipboard errors (e.g. permission denied) are
   * ignored.
   *
   * @returns {void}
   *
   * @example
   * paste();
   */
  const paste = () => {
    const target = editTarget();
    void navigator.clipboard
      ?.readText()
      .then((txt) => {
        if (target instanceof HTMLTextAreaElement) insertText(target, txt);
        else if (target) {
          target.focus();
          document.execCommand('insertText', false, txt);
        }
      })
      .catch(() => {});
  };

  /**
   * Changes the editor font size, clamped to `MIN_FONT`–`MAX_FONT`.
   *
   * Applies `fn` to the stored size inside a functional preferences update, so repeated
   * shortcuts compound correctly; the new size is persisted with the other preferences.
   *
   * @param {(n: number) => number} fn - Maps the current size to the new size.
   * @returns {void}
   *
   * @example
   * setFontSize((n) => n + 1);
   */
  const setFontSize = (fn: (n: number) => number) => setPrefs((p) => ({ ...p, fontSize: Math.min(MAX_FONT, Math.max(MIN_FONT, fn(p.fontSize))) }));

  /* ── Focus: the document is the first responder of a key window ── */

  useEffect(() => {
    if (!focused || status !== 'ok') return;
    // Runs a frame later, after the window frame has restored its last focused control: only
    // falls back to the document, and never pulls focus out of a sheet (save panel, alerts) or
    // a control of this window.
    const raf = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (rootRef.current?.contains(active) || active?.closest('[aria-modal="true"]')) return;
      taRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [focused, status]);

  /* ── Drag & drop: dropping files opens them ── */

  /**
   * Accepts file drags over the window and shows the drop highlight.
   *
   * Only drags carrying virtual-file paths or host files are accepted.
   *
   * @param {DragEvent} e - The dragover event.
   * @returns {void}
   *
   * @example
   * <div onDragOver={onDragOver} />
   */
  const onDragOver = (e: DragEvent) => {
    if (!hasDragPaths(e) && !hasHostFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropping) setDropping(true);
  };

  /**
   * Opens files dropped on the window.
   *
   * Virtual files are opened directly; host files are first imported into Downloads. Text
   * files open as TextEdit documents and everything else in its default app.
   *
   * @async
   * @param {DragEvent} e - The drop event.
   * @returns {Promise<void>} Resolves once host files are imported and opened.
   *
   * @example
   * <div onDrop={(e) => void onDrop(e)} />
   */
  const onDrop = async (e: DragEvent) => {
    if (!hasDragPaths(e) && !hasHostFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    /**
     * Opens one dropped file: text files in TextEdit, anything else in its default app.
     *
     * Paths that are not files are ignored.
     *
     * @param {string} p - The file path.
     * @returns {void}
     *
     * @example
     * getDragPaths(e).forEach(open);
     */
    const open = (p: string) => {
      const n = fs.stat(p);
      if (n?.type !== 'file') return;
      if (isTextFile(n)) openDocument(p);
      else wm.openPath(p);
    };
    if (hasDragPaths(e)) {
      getDragPaths(e).forEach(open);
      return;
    }
    const { created } = await importHostFiles(e.dataTransfer.files, PATHS.downloads);
    created.forEach(open);
  };

  /* ── Menus ── */

  const latest = { save, saveAs, revert, rename, openPanel, openFind, findStep, findWithSelection, editCommand, paste, setFontSize };
  const api = useRef(latest);
  useLayoutEffect(() => {
    api.current = latest;
  });

  const canEdit = status === 'ok';
  useAppMenus((): MenuDef[] => {
    /**
     * Returns the latest component actions for a menu item.
     *
     * Reads `api.current` when the item runs rather than when the menus are built, so the
     * action always uses the closures from the most recent render.
     *
     * @returns {typeof latest} The actions from the most recent render.
     *
     * @example
     * a().save();
     */
    const a = () => api.current;
    const sep: MenuItem = { separator: true };
    return [
      {
        label: COMMON.file,
        items: [
          { label: S.new, shortcut: 'alt+n', action: () => wm.openWindow('textedit') },
          { label: S.open, shortcut: 'mod+o', action: () => void a().openPanel() },
          sep,
          { label: S.close, shortcut: 'alt+w', action: () => void wm.close(windowId) },
          { label: S.save, shortcut: 'mod+s', disabled: !canEdit, action: () => void a().save() },
          { label: S.saveAs, shortcut: 'mod+shift+s', disabled: !canEdit, action: () => void a().saveAs() },
          { label: S.rename, disabled: !hasPath || deleted || !canEdit, action: () => void a().rename() },
          { label: S.revert, disabled: !hasPath || deleted || !dirty, action: () => void a().revert() },
          sep,
          { label: S.showInFinder, disabled: !hasPath || deleted, action: () => path && revealInFinder(path) },
          { label: S.exportDoc, disabled: !canEdit, action: () => downloadText(path ? basename(path) : `${untitledName}.txt`, taRef.current?.value ?? '') },
        ],
      },
      {
        label: COMMON.edit,
        items: [
          { label: S.undo, shortcut: 'mod+z', action: () => a().editCommand('undo') },
          { label: S.redo, shortcut: 'mod+shift+z', action: () => a().editCommand('redo') },
          sep,
          { label: S.cut, shortcut: 'mod+x', action: () => a().editCommand('cut') },
          { label: S.copy, shortcut: 'mod+c', action: () => a().editCommand('copy') },
          { label: S.paste, shortcut: 'mod+v', action: () => a().paste() },
          { label: S.selectAll, shortcut: 'mod+a', action: () => a().editCommand('selectAll') },
          sep,
          {
            label: S.find,
            submenu: [
              { label: S.findEllipsis, shortcut: 'mod+f', disabled: !canEdit, action: () => a().openFind(false) },
              { label: S.findReplace, shortcut: 'mod+alt+f', disabled: !canEdit, action: () => a().openFind(true) },
              { label: S.findNext, shortcut: 'mod+g', disabled: !query, action: () => a().findStep(1) },
              { label: S.findPrev, shortcut: 'mod+shift+g', disabled: !query, action: () => a().findStep(-1) },
              { label: S.useSelection, shortcut: 'mod+e', action: () => a().findWithSelection() },
            ],
          },
          { label: S.spelling, checked: prefs.spellcheck, action: () => setPrefs((p) => ({ ...p, spellcheck: !p.spellcheck })) },
        ],
      },
      {
        label: S.format,
        items: [
          {
            label: S.font,
            submenu: [
              { label: S.bigger, shortcut: 'mod+=', disabled: prefs.fontSize >= MAX_FONT, action: () => a().setFontSize((n) => n + 1) },
              { label: S.smaller, shortcut: 'mod+-', disabled: prefs.fontSize <= MIN_FONT, action: () => a().setFontSize((n) => n - 1) },
              { label: S.defaultSize, shortcut: 'mod+0', action: () => a().setFontSize(() => DEFAULT_PREFS.fontSize) },
              sep,
              { label: S.mono, checked: mono, action: () => setMono((m) => !m) },
            ],
          },
          sep,
          { label: S.wrap, checked: prefs.wrap, action: () => setPrefs((p) => ({ ...p, wrap: !p.wrap })) },
        ],
      },
      {
        label: S.view,
        items: [
          { label: prefs.statusBar ? S.hideStatus : S.showStatus, action: () => setPrefs((p) => ({ ...p, statusBar: !p.statusBar })) },
          ...(isMd ? [sep, { label: showPreview ? S.hidePreview : S.showPreview, shortcut: 'mod+alt+p', action: () => setShowPreview((v) => !v) }] : []),
        ],
      },
    ];
  }, [t, windowId, path, hasPath, deleted, dirty, canEdit, query, prefs, mono, isMd, showPreview, untitledName]);

  /* ── Render ── */

  const deferredText = useDeferredValue(text);
  const stats = useMemo(() => textStats(deferredText), [deferredText]);
  const pos = useMemo(() => caretPosition(text, caret.start), [text, caret.start]);

  if (status !== 'ok') {
    const name = path ? basename(path) : '';
    return (
      <div ref={rootRef} className={styles.root}>
        <EmptyState
          icon={<FileText size={44} strokeWidth={1.2} />}
          title={t(status === 'missing' ? S.missingTitle : S.binaryTitle)}
          subtitle={
            <div className={styles.emptyActions}>
              <div>{t(status === 'missing' ? S.missingMsg(name) : S.binaryMsg(name))}</div>
              <div className={styles.emptyButtons}>
                {status === 'binary' && path && defaultAppFor(basename(path)) === 'preview' && <Button onClick={() => wm.openPath(path, 'preview')}>{t(S.openPreview)}</Button>}
                <Button onClick={() => wm.openWindow('textedit')}>{t(S.newDoc)}</Button>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  const editorStyle = { ['--te-font-size' as string]: `${prefs.fontSize}px` };
  const fontClass = mono ? styles.mono : styles.proportional;
  const wrapClass = prefs.wrap ? styles.wrap : styles.nowrap;
  const selectedChars = caret.end - caret.start;

  return (
    <div ref={rootRef} className={`${styles.root} ${dropping ? styles.dropping : ''}`} onDragOver={onDragOver} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)} onDrop={(e) => void onDrop(e)}>
      {findOpen && (
        <FindBar
          ref={findRef}
          query={query}
          replacement={replacement}
          replaceOpen={replaceOpen}
          matchCase={matchCase}
          total={matches.length}
          current={cur}
          onQuery={onQuery}
          onReplacement={setReplacement}
          onToggleReplace={setReplaceOpen}
          onToggleCase={onToggleCase}
          onNext={() => findStep(1)}
          onPrevious={() => findStep(-1)}
          onReplace={replaceOne}
          onReplaceAll={replaceAll}
          onClose={closeFind}
        />
      )}

      {external !== null && (
        <div className={styles.banner} role="alert">
          <div className={styles.bannerText}>
            <strong>{t(S.changedTitle)}</strong>
            <span>{t(S.changedMsg)}</span>
          </div>
          <Button
            onClick={() => {
              // Keep: our version wins on the next save; stop warning about this disk version.
              if (diskRef.current) diskRef.current = { ...diskRef.current, content: external };
              setSavedText(external);
              setExternal(null);
            }}
          >
            {t(S.keep)}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const n = path ? fs.stat(path) : null;
              if (n) loadNode(n);
            }}
          >
            {t(S.revertOk)}
          </Button>
        </div>
      )}
      {deleted && external === null && text !== '' && (
        <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
          <div className={styles.bannerText}>
            <span>{t(S.deletedBanner)}</span>
          </div>
          <Button onClick={() => void saveAs()}>{t(S.saveAs)}</Button>
        </div>
      )}

      <div className={styles.body}>
        <div className={`${styles.editorPane} ${fontClass} ${wrapClass}`} style={editorStyle}>
          {highlighted && (
            <div ref={mirrorRef} className={`${styles.surface} ${styles.mirror}`} aria-hidden>
              {highlighted}
            </div>
          )}
          <textarea
            ref={taRef}
            className={`${styles.surface} ${styles.textarea}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onSelect={updateCaret}
            onScroll={onScroll}
            wrap={prefs.wrap ? 'soft' : 'off'}
            spellCheck={prefs.spellcheck}
            autoCorrect="off"
            autoCapitalize="off"
            aria-label={displayName}
            autoFocus
          />
        </div>
        {previewVisible && (
          <div ref={previewRef} className={styles.previewPane}>
            <Markdown source={deferredText} baseDir={path ? dirname(path) : undefined} className={styles.previewDoc} />
          </div>
        )}
      </div>

      {prefs.statusBar && (
        <div className={styles.status}>
          <span>{fmt(t(S.lineCol), { l: pos.line, c: pos.col })}</span>
          {selectedChars > 0 && <span className={styles.statusSel}>{fmt(t(S.selected), { n: selectedChars })}</span>}
          <span className={styles.statusSpacer} />
          <span>{fmt(t(S.words), { n: stats.words.toLocaleString() })}</span>
          <span className={styles.statusDot}>·</span>
          <span>{fmt(t(S.chars), { n: stats.chars.toLocaleString() })}</span>
          <span className={styles.statusDot}>·</span>
          <span>{fmt(t(S.lines), { n: stats.lines.toLocaleString() })}</span>
        </div>
      )}
    </div>
  );
}

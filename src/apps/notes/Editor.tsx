/** Notes editor pane: a title field and a body textarea that are saved automatically to the note's file. */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { PATHS, basename, dirname, extname, formatDate, fs, isWithin, join, onBeforePersist, useLocale, useNode } from '@/kernel';
import { applyLineStyle, insertText, isComposing, lineRange, lineStyleOf, listContinuation, replaceRange, toggleChecked, transformLines, type LineStyle } from '../textedit/editing';
import { findMovedFile } from '../textedit/fileTracking';
import { fileNameForTitle, noteTitle, parseNote, serializeNote, uniqueNameExcept, type ParsedNote } from './model';
import styles from './Notes.module.css';

/** Imperative API the Notes window uses to drive the editor from its toolbar and menus. */
export interface NoteEditorHandle {
  /**
   * Writes pending edits immediately and returns the note's (possibly renamed) path. `silent` skips
   * notifying the parent about a rename.
   */
  flush: (opts?: { silent?: boolean }) => string;
  /** Focuses the end of the title, or the end of the body (default). */
  focus: (where?: 'title' | 'end') => void;
  /** Applies a paragraph style to the selected body lines, toggling it off when all have it. */
  applyStyle: (style: LineStyle) => void;
  /** Toggles the checkbox of the selected checklist lines. */
  markChecked: () => void;
  /** Paragraph style of the line with the caret. */
  lineStyle: () => LineStyle;
  /** Current text as it would be saved. */
  content: () => string;
}

interface Props {
  path: string;
  readOnly: boolean;
  autoFocusTitle: boolean;
  /** Localized "New Note": the file name of a note without a title. */
  fallbackTitle: string;
  placeholder: string;
  onRenamed: (path: string) => void;
  onLiveChange: (content: string) => void;
}

const AUTOSAVE_MS = 500; /** Idle time in milliseconds after the last edit before the note is written to disk. */

/**
 * Reads a note file and splits it into title and body.
 *
 * Returns the raw content, the parsed note and the file's creation time (used later to find the
 * file again if it is moved). A missing file reads as an empty note with `createdAt` 0. An empty
 * note that is not a `.txt` file gets the markdown "# " title prefix, so its title is saved as a
 * heading line.
 *
 * @param {string} path - Absolute path of the note file.
 * @returns {{ content: string; parsed: ParsedNote; createdAt: number }} The file content, the
 *   parsed note and the file's creation timestamp.
 *
 * @example
 * const { parsed } = readNote('/Users/guest/Notes/Ideas.md');
 * console.log(parsed.title); // 'Ideas'
 */
function readNote(path: string): { content: string; parsed: ParsedNote; createdAt: number } {
  const node = fs.stat(path);
  const content = node?.content ?? '';
  const parsed = parseNote(content);
  if (!content.trim() && extname(path) !== 'txt') parsed.prefix = '# ';
  return { content, parsed, createdAt: node?.createdAt ?? 0 };
}

/**
 * Editor for a single note file.
 *
 * Renders a bold title field and a body textarea that read as one document: both textareas grow
 * with their content (re-measured on every edit and on width changes) so the pane scrolls as a
 * single page, and clicking below the text puts the caret at the end of the body.
 *
 * Edits are kept in a mutable document ref so the debounced save always sees the latest text.
 * Each edit reports the serialized text through `onLiveChange` and schedules a save
 * `AUTOSAVE_MS` after typing pauses; pending edits are also flushed on unmount and from the
 * kernel's before-persist hook, so the last keystrokes reach IndexedDB when the page closes.
 * After saving, the file is renamed to follow the title.
 *
 * Changes made by other apps (Terminal, TextEdit, Finder) reload the note unless there are
 * unsaved edits, and the reloaded text replaces any live preview in the note list. When the
 * file disappears, the FS move journal is used to follow it to its new path inside the Notes
 * folder via `onRenamed`.
 *
 * Keyboard handling joins the two fields: Return in the title moves into the body, Backspace at
 * the start of the body joins its first line onto the title, and list items continue on Return.
 *
 * @param {Object} props - Component props.
 * @param {string} props.path - Path of the note file to edit.
 * @param {boolean} props.readOnly - Disables editing, e.g. for notes in Recently Deleted.
 * @param {boolean} props.autoFocusTitle - Focuses the end of the title on mount.
 * @param {string} props.fallbackTitle - Localized "New Note", used as the file name of a note
 *   without a title.
 * @param {string} props.placeholder - Placeholder and accessible label of the title field.
 * @param {(path: string) => void} props.onRenamed - Called with the new path after the file is
 *   renamed to follow its title or is moved elsewhere in the Notes folder.
 * @param {(content: string) => void} props.onLiveChange - Called with the unsaved text on every
 *   edit, and with the disk text after an external change is reloaded.
 * @param {React.ForwardedRef<NoteEditorHandle>} ref - Receives the editor's imperative handle.
 * @returns {JSX.Element} The scrollable editor page.
 *
 * @example
 * const editorRef = useRef<NoteEditorHandle>(null);
 * <NoteEditor ref={editorRef} path={path} readOnly={false} autoFocusTitle fallbackTitle="New Note"
 *   placeholder="Title" onRenamed={setPath} onLiveChange={setDraft} />
 */
export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor({ path, readOnly, autoFocusTitle, fallbackTitle, placeholder, onRenamed, onLiveChange }, ref) {
  const locale = useLocale();
  const [init] = useState(() => readNote(path));
  const [title, setTitle] = useState(init.parsed.title);
  const [body, setBody] = useState(init.parsed.body);
  const [width, setWidth] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const doc = useRef({ title: init.parsed.title, body: init.parsed.body, prefix: init.parsed.prefix, sep: init.parsed.sep });
  const disk = useRef({ content: init.content, createdAt: init.createdAt });
  const pathRef = useRef(path);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const props = useRef({ readOnly, fallbackTitle, onRenamed, onLiveChange });
  useLayoutEffect(() => {
    pathRef.current = path;
    props.current = { readOnly, fallbackTitle, onRenamed, onLiveChange };
  });

  /**
   * Serializes the current document state.
   *
   * Reads the mutable document ref, so the result reflects the latest edit even before React
   * re-renders.
   *
   * @returns {string} The note text as it would be written to disk.
   *
   * @example
   * const text = serialized(); // '# Ideas\n\nBuy milk'
   */
  const serialized = () => serializeNote(doc.current);

  /**
   * Writes pending edits to disk immediately and renames the file to follow the title.
   *
   * Cancels the autosave timer. Does nothing unless there are unsaved edits, the path is still a
   * file and the editor is writable. The content is written only when it differs from the file;
   * then a file name is derived from the note title (or the fallback title), made unique within
   * the folder and applied with `fs.rename`. Renaming happens only here, after typing pauses, so
   * the file name does not change on every keystroke. FS errors (such as a name the FS rejects)
   * are swallowed and the current file name is kept.
   *
   * @param {{ silent?: boolean }} [opts={}] - Flush options.
   * @param {boolean} [opts.silent] - Skip calling `onRenamed` when the file is renamed.
   * @returns {string} The note's current path, after any rename.
   *
   * @example
   * const savedPath = flush({ silent: true });
   */
  const flush = useCallback((opts: { silent?: boolean } = {}): string => {
    clearTimeout(timer.current);
    const p = pathRef.current;
    if (!pending.current) return p;
    pending.current = false;
    const node = fs.stat(p);
    if (!node || node.type !== 'file' || props.current.readOnly) return p;
    const content = serializeNote(doc.current);
    try {
      if (content !== node.content) {
        const written = fs.writeFile(p, content);
        disk.current = { content, createdAt: written.createdAt };
      }
      const desired = fileNameForTitle(noteTitle(content), extname(p) || 'md', props.current.fallbackTitle);
      const dir = dirname(p);
      const name = uniqueNameExcept(desired, (c) => fs.exists(join(dir, c)), basename(p));
      if (name !== basename(p)) {
        const next = fs.rename(p, name).path;
        pathRef.current = next;
        if (!opts.silent) props.current.onRenamed(next);
      }
    } catch {
      /* The FS rejected the write or rename: keep the current file name. */
    }
    return pathRef.current;
  }, []);

  useEffect(() => {
    const unregister = onBeforePersist(() => flush({ silent: true }));
    return () => {
      unregister();
      flush({ silent: true });
    };
  }, [flush]);

  /**
   * Applies an edit to the title and body and schedules an autosave.
   *
   * Updates the document ref and React state, marks the note as having unsaved edits, reports
   * the serialized text through `onLiveChange` and restarts the autosave timer. Ignored when the
   * editor is read-only.
   *
   * @param {string} nextTitle - New title text.
   * @param {string} nextBody - New body text.
   * @returns {void}
   *
   * @example
   * commit(doc.current.title, 'New body text');
   */
  const commit = (nextTitle: string, nextBody: string) => {
    if (props.current.readOnly) return;
    doc.current = { ...doc.current, title: nextTitle, body: nextBody };
    setTitle(nextTitle);
    setBody(nextBody);
    pending.current = true;
    props.current.onLiveChange(serializeNote(doc.current));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), AUTOSAVE_MS);
  };

  const node = useNode(path);
  useEffect(() => {
    if (!node) {
      const moved = findMovedFile({ createdAt: disk.current.createdAt, content: disk.current.content }, path);
      if (moved && isWithin(moved.path, PATHS.notes)) props.current.onRenamed(moved.path);
      return;
    }
    const content = node.content ?? '';
    disk.current.createdAt = node.createdAt;
    if (content === disk.current.content || pending.current) return;
    disk.current.content = content;
    const parsed = parseNote(content);
    doc.current = { title: parsed.title, body: parsed.body, prefix: parsed.prefix || doc.current.prefix, sep: parsed.sep };
    setTitle(parsed.title);
    setBody(parsed.body);
    props.current.onLiveChange(content);
  }, [node, path]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const top = scroller?.scrollTop ?? 0;
    for (const el of [titleRef.current, bodyRef.current]) {
      if (!el) continue;
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    }
    if (scroller) scroller.scrollTop = top;
  }, [title, body, width]);

  useEffect(() => {
    if (!autoFocusTitle || readOnly) return;
    const el = titleRef.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocusTitle, readOnly]);

  /**
   * Handles typing or pasting in the title field.
   *
   * The title is a single line: when the new value contains a line break (for example after
   * pasting several lines), the first line becomes the title and the rest is prepended to the
   * body.
   *
   * @param {ChangeEvent<HTMLTextAreaElement>} e - Change event of the title textarea.
   * @returns {void}
   *
   * @example
   * <textarea value={title} onChange={onTitleChange} />
   */
  const onTitleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    const nl = v.indexOf('\n');
    if (nl === -1) return commit(v, doc.current.body);
    const rest = v.slice(nl + 1);
    commit(v.slice(0, nl), rest + (doc.current.body ? `\n${doc.current.body}` : ''));
  };

  /**
   * Focuses the body field and places the caret at an offset.
   *
   * Focuses without scrolling the pane and collapses the selection to `offset`. Does nothing
   * when the body field is not mounted.
   *
   * @param {number} offset - Character offset in the body text.
   * @returns {void}
   *
   * @example
   * focusBody(0); // caret at the start of the body
   */
  const focusBody = (offset: number) => {
    const b = bodyRef.current;
    if (!b) return;
    b.focus({ preventScroll: true });
    b.setSelectionRange(offset, offset);
  };

  /**
   * Keyboard handling for the title field.
   *
   * Return (without Shift, ⌘ or Ctrl) moves into the body: text after the caret is split off and
   * becomes the first body line, or, at the end of the title, a new empty first line is opened in
   * an existing body. The split is committed with `flushSync` so focus moves only once the new
   * text is in the DOM, and a key typed right after Return (fast typing, key rollover) lands in
   * the body rather than the title. ArrowDown at the end of the title moves to the start of the
   * body. Ignored during IME composition and when read-only.
   *
   * @param {KeyboardEvent<HTMLTextAreaElement>} e - Keydown event of the title textarea.
   * @returns {void}
   *
   * @example
   * <textarea onKeyDown={onTitleKeyDown} />
   */
  const onTitleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposing(e) || readOnly) return;
    const el = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const after = el.value.slice(el.selectionEnd);
      const b = bodyRef.current;
      if (!b || readOnly) return;
      if (after) {
        const head = el.value.slice(0, el.selectionStart);
        flushSync(() => commit(head, after + (doc.current.body ? `\n${doc.current.body}` : '')));
      } else if (doc.current.body) {
        replaceRange(b, 0, 0, '\n', [0, 0]);
      }
      focusBody(0);
    } else if (e.key === 'ArrowDown' && el.selectionStart === el.value.length) {
      e.preventDefault();
      focusBody(0);
    }
  };

  /**
   * Keyboard handling for the body field.
   *
   * Without modifier keys:
   * - Backspace with the caret at the very start joins the first body line onto the title and
   *   puts the caret at the join point (committed with `flushSync` before focusing the title).
   * - ArrowUp at the very start moves the caret to the end of the title.
   * - Return on a list line (bullet, number or checklist) continues the list; on an empty list
   *   item it removes the marker instead, ending the list.
   * - Tab inserts a tab character instead of moving focus.
   * List continuation and Tab edit through the textarea's native editing (`insertText` /
   * `replaceRange`) so they stay undoable. Ignored during IME composition and when read-only.
   *
   * @param {KeyboardEvent<HTMLTextAreaElement>} e - Keydown event of the body textarea.
   * @returns {void}
   *
   * @example
   * <textarea onKeyDown={onBodyKeyDown} />
   */
  const onBodyKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposing(e) || readOnly) return;
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: end, value } = ta;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === 'Backspace' && plain && s === 0 && end === 0) {
      e.preventDefault();
      const nl = value.indexOf('\n');
      const first = nl === -1 ? value : value.slice(0, nl);
      const t0 = doc.current.title;
      flushSync(() => commit(t0 + first, nl === -1 ? '' : value.slice(nl + 1)));
      titleRef.current?.focus({ preventScroll: true });
      titleRef.current?.setSelectionRange(t0.length, t0.length);
    } else if (e.key === 'ArrowUp' && plain && !e.shiftKey && s === 0 && end === 0) {
      e.preventDefault();
      const el = titleRef.current;
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(el.value.length, el.value.length);
    } else if (e.key === 'Enter' && plain && !e.shiftKey && s === end) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const cont = listContinuation(value.slice(lineStart, s));
      if (!cont) return;
      e.preventDefault();
      if ('end' in cont) replaceRange(ta, lineStart, s, '');
      else insertText(ta, cont.insert);
    } else if (e.key === 'Tab' && plain && !e.shiftKey) {
      e.preventDefault();
      insertText(ta, '\t');
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      flush,
      /**
       * Focuses the title or the body.
       *
       * Puts the caret at the end of the title, or at the end of the body (default), without
       * scrolling the pane.
       *
       * @param {'title' | 'end'} [where='end'] - Which field to focus.
       * @returns {void}
       *
       * @example
       * editorRef.current?.focus('title');
       */
      focus: (where = 'end') => {
        if (where === 'title') {
          const el = titleRef.current;
          el?.focus({ preventScroll: true });
          el?.setSelectionRange(el.value.length, el.value.length);
        } else focusBody(bodyRef.current?.value.length ?? 0);
      },
      /**
       * Applies a paragraph style to the selected body lines.
       *
       * Works on every line touched by the selection; with the numbered style the lines are
       * numbered 1, 2, 3… in order. When all of those lines already have `style`, they are turned
       * back into plain body text, so applying the same style twice toggles it off. Does nothing
       * when read-only.
       *
       * @param {LineStyle} style - Paragraph style to apply.
       * @returns {void}
       *
       * @example
       * editorRef.current?.applyStyle('checklist');
       */
      applyStyle: (style) => {
        const ta = bodyRef.current;
        if (!ta || readOnly) return;
        const { start, end } = lineRange(ta.value, ta.selectionStart, ta.selectionEnd);
        const lines = ta.value.slice(start, end).split('\n');
        const allSame = lines.every((l) => lineStyleOf(l) === style);
        transformLines(ta, (line, i) => applyLineStyle(line, allSame ? 'body' : style, i, false));
      },
      /**
       * Toggles the checkbox of the selected checklist lines.
       *
       * Flips "- [ ]" and "- [x]" on every line touched by the selection; lines without a checkbox
       * are left unchanged. Does nothing when read-only.
       *
       * @returns {void}
       *
       * @example
       * editorRef.current?.markChecked();
       */
      markChecked: () => {
        const ta = bodyRef.current;
        if (!ta || readOnly) return;
        transformLines(ta, toggleChecked);
      },
      /**
       * Reports the paragraph style of the body line with the caret.
       *
       * Looks at the full line around the caret. Returns 'body' when the body field is not
       * mounted.
       *
       * @returns {LineStyle} Style of the caret line.
       *
       * @example
       * const style = editorRef.current?.lineStyle(); // 'heading'
       */
      lineStyle: () => {
        const ta = bodyRef.current;
        if (!ta) return 'body';
        const v = ta.value;
        const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
        const end = v.indexOf('\n', ta.selectionStart);
        return lineStyleOf(v.slice(start, end === -1 ? v.length : end));
      },
      content: serialized,
    }),
    [flush, readOnly],
  );

  const modified = node?.modifiedAt;

  return (
    <div ref={scrollRef} className={styles.editorScroll}>
      <div className={styles.editorPage}>
        {modified !== undefined && <div className={styles.editorDate}>{formatDate(modified, locale, { dateStyle: 'long', timeStyle: 'short' })}</div>}
        <textarea
          ref={titleRef}
          className={styles.titleField}
          value={title}
          rows={1}
          onChange={onTitleChange}
          onKeyDown={onTitleKeyDown}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          aria-label={placeholder}
        />
        <textarea
          ref={bodyRef}
          className={styles.bodyField}
          value={body}
          rows={1}
          onChange={(e) => commit(doc.current.title, e.target.value)}
          onKeyDown={onBodyKeyDown}
          readOnly={readOnly}
          spellCheck={false}
          aria-label={title || placeholder}
        />
        {/* Clicking below the text puts the caret at the end of the body, like a real page. */}
        <div
          className={styles.editorFiller}
          onMouseDown={(e) => {
            if (readOnly) return;
            e.preventDefault();
            focusBody(bodyRef.current?.value.length ?? 0);
          }}
        />
      </div>
    </div>
  );
});

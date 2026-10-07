/** Notes middle column: the note list grouped under date headers, with keyboard navigation. */
import { memo, useEffect, useId, useRef, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Folder, Pin } from 'lucide-react';
import styles from './Notes.module.css';

/** Display data for one row of the note list. */
export interface NoteRowData {
  /** Path of the note file. */
  path: string;
  title: string;
  /** Preview of the note body. */
  snippet: string;
  /** Formatted modification date. */
  date: string;
  /** Folder name shown under the snippet in "All Notes" / search results. */
  folder?: string;
  pinned: boolean;
}

/** An item of the note list: a section header (date group, "Pinned") or a note row. */
export type ListEntry = { type: 'header'; key: string; label: string } | { type: 'note'; note: NoteRowData };

/**
 * Highlights every occurrence of a search query in a text.
 *
 * Matching is case-insensitive and ignores surrounding whitespace in the query; matches are
 * wrapped in `<mark>` elements and keep their original casing. Returns the text unchanged when
 * the query is empty or does not occur.
 *
 * @param {string} text - Text to search in.
 * @param {string} query - Search query.
 * @returns {ReactNode} The plain text, or an array of strings and `<mark>` elements.
 *
 * @example
 * highlight('Shopping list', 'list'); // ['Shopping ', <mark>list</mark>, '']
 */
export function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: ReactNode[] = [];
  let last = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + needle.length)) {
    if (i > last) out.push(text.slice(last, i));
    out.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    last = i + needle.length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}

interface RowProps {
  id: string;
  note: NoteRowData;
  selected: boolean;
  query: string;
  untitled: string;
  noText: string;
  onSelect: (path: string) => void;
  onMenu: (e: MouseEvent, path: string) => void;
  onDragStart: (e: DragEvent, path: string) => void;
}

/**
 * One note in the list.
 *
 * Shows the title (with a pin icon for pinned notes), the date and a snippet, plus the folder
 * name when set; title and snippet highlight the search query. The row is selected on mouse down,
 * and a right-click selects it before opening the context menu. Rows are draggable so notes can
 * be dropped on sidebar folders. Memoized so a row re-renders only when its own props change.
 *
 * @param {RowProps} props - Component props.
 * @param {string} props.id - DOM id referenced by the list's `aria-activedescendant`.
 * @param {NoteRowData} props.note - Note to display.
 * @param {boolean} props.selected - Whether this is the selected note.
 * @param {string} props.query - Search query to highlight.
 * @param {string} props.untitled - Label shown when the note has no title.
 * @param {string} props.noText - Label shown when the note has no body text.
 * @param {(path: string) => void} props.onSelect - Selects the note.
 * @param {(e: MouseEvent, path: string) => void} props.onMenu - Opens the note's context menu.
 * @param {(e: DragEvent, path: string) => void} props.onDragStart - Starts dragging the note.
 * @returns {JSX.Element} The row element.
 *
 * @example
 * <NoteRow id="r-0" note={note} selected query="" untitled="New Note" noText="No additional text"
 *   onSelect={select} onMenu={openMenu} onDragStart={startDrag} />
 */
const NoteRow = memo(function NoteRow({ id, note, selected, query, untitled, noText, onSelect, onMenu, onDragStart }: RowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
      onMouseDown={() => onSelect(note.path)}
      onContextMenu={(e) => {
        onSelect(note.path);
        onMenu(e, note.path);
      }}
      draggable
      onDragStart={(e) => onDragStart(e, note.path)}
    >
      <div className={styles.rowTitle}>
        {note.pinned && <Pin size={11} className={styles.rowPin} aria-hidden />}
        <span>{highlight(note.title || untitled, query)}</span>
      </div>
      <div className={styles.rowMeta}>
        <span className={styles.rowDate}>{note.date}</span>
        <span className={styles.rowSnippet}>{note.snippet ? highlight(note.snippet, query) : noText}</span>
      </div>
      {note.folder && (
        <div className={styles.rowFolder}>
          <Folder size={11} aria-hidden />
          <span>{note.folder}</span>
        </div>
      )}
    </div>
  );
});

interface Props {
  entries: ListEntry[];
  selected: string | null;
  query: string;
  untitled: string;
  noText: string;
  empty: ReactNode;
  label: string;
  onSelect: (path: string) => void;
  onOpen: () => void;
  onDelete: (path: string) => void;
  onMenu: (e: MouseEvent, path: string) => void;
  onDragStart: (e: DragEvent, path: string) => void;
}

/**
 * The note list column.
 *
 * Renders the entries as an ARIA listbox with sticky section headers and note rows, or the
 * `empty` placeholder when there are no notes. The list itself takes focus and tracks the
 * selected row through `aria-activedescendant`; the selected row is scrolled into view whenever
 * the selection changes. Without modifier keys, ArrowUp/ArrowDown/Home/End move the selection,
 * Return or Tab calls `onOpen` for the selected note, and Backspace/Delete deletes it.
 *
 * @param {Props} props - Component props.
 * @param {ListEntry[]} props.entries - Headers and notes in display order.
 * @param {string | null} props.selected - Path of the selected note.
 * @param {string} props.query - Search query to highlight in rows.
 * @param {string} props.untitled - Label for notes without a title.
 * @param {string} props.noText - Label for notes without body text.
 * @param {ReactNode} props.empty - Content shown when the list has no notes.
 * @param {string} props.label - Accessible label of the listbox.
 * @param {(path: string) => void} props.onSelect - Selects a note.
 * @param {() => void} props.onOpen - Moves focus into the editor for the selected note.
 * @param {(path: string) => void} props.onDelete - Deletes a note.
 * @param {(e: MouseEvent, path: string) => void} props.onMenu - Opens a note's context menu.
 * @param {(e: DragEvent, path: string) => void} props.onDragStart - Starts dragging a note.
 * @returns {JSX.Element} The listbox, or the empty-state container.
 *
 * @example
 * <NoteList entries={entries} selected={path} query="" untitled="New Note" noText="No additional text"
 *   empty="No Notes" label="Notes" onSelect={select} onOpen={focusEditor} onDelete={remove}
 *   onMenu={openMenu} onDragStart={startDrag} />
 */
export function NoteList({ entries, selected, query, untitled, noText, empty, label, onSelect, onOpen, onDelete, onMenu, onDragStart }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();
  const order = entries.flatMap((e) => (e.type === 'note' ? [e.note.path] : []));

  /**
   * Builds the DOM id of a note's row.
   *
   * Combines the component's unique id with the note's position among the notes, so ids are
   * unique per list instance and stay valid in `aria-activedescendant`.
   *
   * @param {string} path - Path of the note.
   * @returns {string} The row's element id.
   *
   * @example
   * rowId(selected); // '_r_1_-3'
   */
  const rowId = (path: string) => `${uid}-${order.indexOf(path)}`;

  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  /**
   * Keyboard navigation for the list.
   *
   * Ignores keys pressed with ⌘, Ctrl or Alt. ArrowUp/ArrowDown move the selection by one note
   * (clamped to the ends), Home/End jump to the first/last note, Return or Tab (without Shift)
   * calls `onOpen`, and Backspace/Delete calls `onDelete` for the selected note.
   *
   * @param {KeyboardEvent<HTMLDivElement>} e - Keydown event of the listbox.
   * @returns {void}
   *
   * @example
   * <div role="listbox" tabIndex={0} onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const i = selected ? order.indexOf(selected) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = order[Math.min(order.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) onSelect(next);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? order[0] : order[order.length - 1];
      if (next) onSelect(next);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (!selected || e.shiftKey) return;
      e.preventDefault();
      onOpen();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault();
      onDelete(selected);
    }
  };

  if (!order.length) return <div className={styles.listEmpty}>{empty}</div>;

  return (
    <div ref={ref} className={styles.list} role="listbox" aria-label={label} aria-activedescendant={selected && order.includes(selected) ? rowId(selected) : undefined} tabIndex={0} onKeyDown={onKeyDown}>
      {entries.map((e) =>
        e.type === 'header' ? (
          <div key={`h:${e.key}`} className={styles.listHeader} role="presentation">
            {e.label}
          </div>
        ) : (
          <NoteRow key={e.note.path} id={rowId(e.note.path)} note={e.note} selected={e.note.path === selected} query={query} untitled={untitled} noText={noText} onSelect={onSelect} onMenu={onMenu} onDragStart={onDragStart} />
        ),
      )}
    </div>
  );
}

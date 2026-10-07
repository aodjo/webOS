/**
 * Plain-text editing helpers shared by TextEdit and Notes.
 *
 * Programmatic edits go through `document.execCommand('insertText')` so they land on the
 * textarea's native undo stack (⌘Z keeps working) and fire a regular `input` event, which keeps
 * React's controlled value in sync.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Replaces the current selection of a textarea with text as an undoable edit.
 *
 * Focuses the textarea (without scrolling) when needed, then uses
 * `execCommand('insertText')`, or `execCommand('delete')` for an empty string, so the change
 * joins the native undo stack. When the command is unsupported or fails, it falls back to
 * `setRangeText` plus a synthetic bubbling `input` event so React still sees the new value.
 * Read-only and disabled textareas are left untouched, because the `setRangeText` fallback
 * would otherwise edit them.
 *
 * @param {HTMLTextAreaElement} ta - The textarea to edit.
 * @param {string} text - The replacement text; an empty string deletes the selection.
 * @returns {void}
 *
 * @example
 * insertText(textarea, '\t');
 */
export function insertText(ta: HTMLTextAreaElement, text: string): void {
  if (ta.readOnly || ta.disabled) return;
  if (document.activeElement !== ta) ta.focus({ preventScroll: true });
  let ok = false;
  try {
    ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete', false);
  } catch {
    ok = false;
  }
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Replaces a character range of a textarea with text as an undoable edit.
 *
 * Selects `[start, end)` and hands it to `insertText`, then optionally places the selection
 * at the given range afterwards.
 *
 * @param {HTMLTextAreaElement} ta - The textarea to edit.
 * @param {number} start - Start offset of the range (inclusive).
 * @param {number} end - End offset of the range (exclusive).
 * @param {string} text - The replacement text.
 * @param {[number, number]} [select] - Selection `[start, end]` to apply after the edit.
 * @returns {void}
 *
 * @example
 * replaceRange(textarea, 0, textarea.value.length, 'new text', [0, 0]);
 */
export function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string, select?: [number, number]): void {
  if (document.activeElement !== ta) ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  insertText(ta, text);
  if (select) ta.setSelectionRange(select[0], select[1]);
}

/**
 * Computes the range of the full lines touched by a selection.
 *
 * The start is the beginning of the line containing `selStart`; the end is the newline (or end
 * of text) after the selection. A non-empty selection that ends right after a newline does not
 * include the line that starts there.
 *
 * @param {string} value - The full text.
 * @param {number} selStart - Selection start offset.
 * @param {number} selEnd - Selection end offset.
 * @returns {{ start: number; end: number }} The `[start, end)` range covering the touched lines,
 *   excluding the final newline.
 *
 * @example
 * lineRange('ab\ncd\nef', 4, 4); // { start: 3, end: 5 }
 */
export function lineRange(value: string, selStart: number, selEnd: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', selStart - 1) + 1;
  const effEnd = selEnd > selStart && value[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
  let end = value.indexOf('\n', effEnd);
  if (end === -1) end = value.length;
  return { start, end };
}

/**
 * Rewrites every line touched by the textarea's selection in a single undo step.
 *
 * Maps each line of the touched range through `fn` and replaces the range with the result.
 * Nothing happens when the output equals the input. The selection is shifted by the length
 * change of the first line and keeps the same distance from the end of the range, so it stays
 * on the same text where possible; a collapsed caret stays collapsed.
 *
 * @param {HTMLTextAreaElement} ta - The textarea to edit.
 * @param {(line: string, index: number, all: string[]) => string} fn - Maps one line (with its
 *   index within the touched lines and the full list) to its replacement.
 * @returns {void}
 *
 * @example
 * transformLines(textarea, (line) => '> ' + line);
 */
export function transformLines(ta: HTMLTextAreaElement, fn: (line: string, index: number, all: string[]) => string): void {
  const value = ta.value;
  const { selectionStart: s, selectionEnd: e } = ta;
  const { start, end } = lineRange(value, s, e);
  const lines = value.slice(start, end).split('\n');
  const next = lines.map(fn);
  const replaced = next.join('\n');
  if (replaced === value.slice(start, end)) return;
  const firstDelta = next[0].length - lines[0].length;
  const newStart = Math.max(start, s + firstDelta);
  const newEnd = s === e ? newStart : Math.max(newStart, start + replaced.length - (end - e));
  replaceRange(ta, start, end, replaced, [newStart, newEnd]);
}

/**
 * Converts a caret offset into a 1-based line and column.
 *
 * Counts the newlines before `offset`; the column is measured in UTF-16 code units from the
 * start of that line.
 *
 * @param {string} value - The full text.
 * @param {number} offset - The caret offset.
 * @returns {{ line: number; col: number }} The 1-based line and column.
 *
 * @example
 * caretPosition('ab\ncd', 4); // { line: 2, col: 2 }
 */
export function caretPosition(value: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = value.indexOf('\n'); i !== -1 && i < offset; i = value.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, col: offset - lineStart + 1 };
}

/** Word, character and line counts shown in the status bar. */
export interface TextStats {
  /** Number of whitespace-separated words. */
  words: number;
  /** Number of Unicode code points (an emoji counts once). */
  chars: number;
  /** Number of lines (an empty text has one line). */
  lines: number;
}

/**
 * Counts the words, characters and lines of a text.
 *
 * Words are whitespace-separated runs of the trimmed text. Characters are counted as code
 * points by skipping low surrogates, so astral characters such as emoji count once. Lines are
 * the number of newlines plus one.
 *
 * @param {string} value - The text to measure.
 * @returns {TextStats} The word, character and line counts.
 *
 * @example
 * textStats('hello world\n😀'); // { words: 3, chars: 13, lines: 2 }
 */
export function textStats(value: string): TextStats {
  const trimmed = value.trim();
  let lines = 1;
  for (let i = value.indexOf('\n'); i !== -1; i = value.indexOf('\n', i + 1)) lines++;
  let chars = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0xdc00 || c > 0xdfff) chars++;
  }
  return { words: trimmed ? trimmed.split(/\s+/).length : 0, chars, lines };
}

/**
 * Tells whether an IME composition (Korean, Japanese…) is in progress.
 *
 * Key handlers should not intercept keys while this is true. Accepts both React synthetic and
 * native keyboard events and also treats the legacy `keyCode` 229 as composing.
 *
 * @param {ReactKeyboardEvent | KeyboardEvent} e - The keyboard event.
 * @returns {boolean} True while a composition is active.
 *
 * @example
 * if (isComposing(e)) return;
 */
export function isComposing(e: ReactKeyboardEvent | KeyboardEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  return native.isComposing || native.keyCode === 229;
}

/* ───────────────────────── Markdown-ish list helpers (Notes) ───────────────────────── */

export const BLOCK_PREFIX = /^(\s*)(#{1,6}\s+|[-*+•]\s+\[[ xX]\]\s+|[-*+•]\s+|\d+[.)]\s+)?/; /** Matches a line's indentation (group 1) and optional block marker (group 2): heading, checklist, bullet or number. */

/** Paragraph style of a line in a Markdown-ish note. */
export type LineStyle = 'title' | 'heading' | 'subheading' | 'body' | 'bullet' | 'dash' | 'number' | 'checklist';

const STYLE_PREFIX: Record<LineStyle, string> = {
  title: '# ',
  heading: '## ',
  subheading: '### ',
  body: '',
  bullet: '* ',
  dash: '- ',
  number: '1. ',
  checklist: '- [ ] ',
}; /** Block marker written for each paragraph style (numbered lists are renumbered by `applyLineStyle`). */

/**
 * Detects the paragraph style of a line from its block marker.
 *
 * `#` is a title, `##` a heading, `###`–`######` a subheading; a `[ ]`/`[x]` box makes a
 * checklist, a digit a numbered item, `-` a dash item and `*`, `+` or `•` a bullet. A line
 * without a marker is body text.
 *
 * @param {string} line - The line to inspect.
 * @returns {LineStyle} The detected style.
 *
 * @example
 * lineStyleOf('- [x] done'); // 'checklist'
 * lineStyleOf('## Notes'); // 'heading'
 */
export function lineStyleOf(line: string): LineStyle {
  const m = BLOCK_PREFIX.exec(line)?.[2] ?? '';
  if (/^#\s/.test(m)) return 'title';
  if (/^##\s/.test(m)) return 'heading';
  if (/^#{3,6}\s/.test(m)) return 'subheading';
  if (/\[[ xX]\]/.test(m)) return 'checklist';
  if (/^\d/.test(m)) return 'number';
  if (/^-/.test(m)) return 'dash';
  if (m) return 'bullet';
  return 'body';
}

/**
 * Applies a paragraph style to a line.
 *
 * Replaces the line's existing block marker with the one for `style` while keeping its
 * indentation and text. When `toggle` is set and the line already has that style (other than
 * body), the marker is removed instead, like the Notes checklist button. Numbered items are
 * written as `index + 1`.
 *
 * @param {string} line - The line to restyle.
 * @param {LineStyle} style - The style to apply.
 * @param {number} [index=0] - Position of the line within the restyled block, used for numbering.
 * @param {boolean} [toggle=true] - Whether applying the current style turns it back into body text.
 * @returns {string} The restyled line.
 *
 * @example
 * applyLineStyle('Buy milk', 'checklist'); // '- [ ] Buy milk'
 * applyLineStyle('- [ ] Buy milk', 'checklist'); // 'Buy milk'
 */
export function applyLineStyle(line: string, style: LineStyle, index = 0, toggle = true): string {
  const m = BLOCK_PREFIX.exec(line)!;
  const indent = m[1] ?? '';
  const rest = line.slice(m[0].length);
  const current = lineStyleOf(line);
  if (toggle && current === style && style !== 'body') return indent + rest;
  const prefix = style === 'number' ? `${index + 1}. ` : STYLE_PREFIX[style];
  return indent + prefix + rest;
}

/**
 * Toggles the checkbox of a checklist line between `[ ]` and `[x]`.
 *
 * Only a box right after a leading `-`, `*`, `+` or `•` marker is toggled; `[X]` counts as
 * checked. Lines without a checkbox are returned unchanged.
 *
 * @param {string} line - The line to toggle.
 * @returns {string} The line with its checkbox flipped.
 *
 * @example
 * toggleChecked('- [ ] task'); // '- [x] task'
 */
export function toggleChecked(line: string): string {
  return line.replace(/^(\s*[-*+•]\s+)\[([ xX])\]/, (_, pre: string, mark: string) => `${pre}[${mark === ' ' ? 'x' : ' '}]`);
}

/**
 * Computes what Enter should insert to continue a list.
 *
 * `line` is the text before the caret on the current line. For a list item with content,
 * returns a newline plus the same indentation and marker: numbers are incremented (keeping
 * `.` or `)`) and a checked box becomes unchecked. For an empty item, returns `{ end: true }`
 * so the caller removes the marker and ends the list.
 *
 * @param {string} line - The text before the caret on the current line.
 * @returns {{ insert: string } | { end: true } | null} The text to insert, an end-of-list signal,
 *   or null when the line is not a list item.
 *
 * @example
 * listContinuation('  3. third'); // { insert: '\n  4. ' }
 * listContinuation('- '); // { end: true }
 */
export function listContinuation(line: string): { insert: string } | { end: true } | null {
  const m = /^(\s*)([-*+•]\s+\[[ xX]\]\s+|[-*+•]\s+|(\d+)([.)])\s+)(.*)$/.exec(line);
  if (!m) return null;
  const [, indent, marker, num, punct, content] = m;
  if (!content.trim()) return { end: true };
  let next = marker;
  if (num) next = `${Number(num) + 1}${punct} `;
  else if (/\[[xX]\]/.test(marker)) next = marker.replace(/\[[xX]\]/, '[ ]');
  return { insert: `\n${indent}${next}` };
}

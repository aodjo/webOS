/**
 * Notes data model. A note is a plain markdown/text file whose first non-empty line is the title
 * (optionally written as a "# Title" heading) and whose remaining text is the body. Every function
 * here is pure: parsing, serializing, list snippets, file naming and date grouping.
 */
import type { Locale } from '@/kernel/types';

/** A note file split into its title line and body, with the exact on-disk formatting around them. */
export interface ParsedNote {
  /** Title text without heading markers or closing hashes. */
  title: string;
  /** Everything after the title line and the blank lines that follow it. */
  body: string;
  /** Marker before the title on disk ("# " for markdown notes, "" for plain text). */
  prefix: string;
  /** Text between the title line and the body (usually "\n\n"). */
  sep: string;
}

const BLANK_LINES = /^(?:[ \t]*\r?\n)*/; /** Matches a run of leading lines that contain only spaces or tabs. */

/**
 * Split note content into title, body, prefix and separator.
 *
 * Leading blank lines are skipped and the first remaining line becomes the title. A markdown
 * heading marker ("#" to "######") is captured as `prefix` (a bare "#" is normalized to "# ") and
 * ATX closing hashes ("Title ##") are stripped from the title. The blank lines between the title
 * and the body are kept in `sep` so serializing reproduces the original layout; when there is no
 * body yet, `sep` is "\n\n" so a body added later is separated by a blank line.
 *
 * @param {string} content - Raw file content of the note.
 * @returns {ParsedNote} The parsed title, body, heading prefix and title/body separator.
 *
 * @example
 * const note = parseNote('# Ideas\n\n- one\n');
 * console.log(note); // { title: 'Ideas', body: '- one\n', prefix: '# ', sep: '\n\n' }
 */
export function parseNote(content: string): ParsedNote {
  const rest = content.slice(BLANK_LINES.exec(content)![0].length);
  const nl = rest.indexOf('\n');
  const first = (nl === -1 ? rest : rest.slice(0, nl)).replace(/\r$/, '');
  const m = /^(#{1,6}[ \t]+|#{1,6}$)?(.*)$/.exec(first)!;
  const prefix = m[1] && m[1].trim() === m[1] ? `${m[1]} ` : (m[1] ?? '');
  const title = m[2].replace(/[ \t]+#+[ \t]*$/, '');
  const after = nl === -1 ? '' : rest.slice(nl + 1);
  const blank = BLANK_LINES.exec(after)![0];
  const body = after.slice(blank.length);
  return { title, body, prefix, sep: body ? '\n' + blank : '\n\n' };
}

/**
 * Turn a parsed note back into file content.
 *
 * Newlines in the title are replaced with spaces. A note with a blank title is written as its
 * body alone (or as an empty string when the body is blank too). A title-only note is written as
 * the prefixed title plus a trailing newline. Otherwise the prefixed title, the separator (falling
 * back to "\n\n" when `sep` contains no newline) and the body are joined, so
 * `serializeNote(parseNote(s))` returns `s` for well-formed notes.
 *
 * @param {ParsedNote} n - The note to serialize.
 * @returns {string} The file content for the note.
 *
 * @example
 * const text = serializeNote({ title: 'Hello', body: '', prefix: '# ', sep: '\n\n' });
 * console.log(text); // '# Hello\n'
 */
export function serializeNote(n: ParsedNote): string {
  const title = n.title.replace(/\n/g, ' ');
  if (!title.trim()) return n.body.trim() ? n.body : '';
  if (!n.body) return `${n.prefix}${title}\n`;
  return `${n.prefix}${title}${n.sep.includes('\n') ? n.sep : '\n\n'}${n.body}`;
}

export const NEW_NOTE: ParsedNote = { title: '', body: '', prefix: '# ', sep: '\n\n' }; /** Defaults for a brand-new note: empty markdown note with a "# " title prefix. */

/**
 * Get the display title of a note.
 *
 * Parses the content with `parseNote` and returns its title with surrounding whitespace removed.
 *
 * @param {string} content - Raw file content of the note.
 * @returns {string} The trimmed title, or an empty string when the note has no title.
 *
 * @example
 * const title = noteTitle('# Groceries\n- milk');
 * console.log(title); // 'Groceries'
 */
export function noteTitle(content: string): string {
  return parseNote(content).title.trim();
}

/**
 * Strip markdown syntax from one line for list snippets.
 *
 * Removes a leading heading, blockquote, checklist, bullet or numbered-list marker, replaces
 * images and links with their text, drops bold/underline/strikethrough/code markers and
 * single-character emphasis around words, then trims the result.
 *
 * @param {string} line - One line of markdown text.
 * @returns {string} The line as plain text.
 *
 * @example
 * const text = plainLine('- [ ] **Buy** [milk](http://x)');
 * console.log(text); // 'Buy milk'
 */
export function plainLine(line: string): string {
  return line
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+•]\s+\[[ xX]\]\s+|[-*+•]\s+|\d+[.)]\s+)/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*)[*_](?=\s|$)/g, '$1$2')
    .trim();
}

/**
 * Get the list-row snippet of a note: the first non-empty body line without markdown syntax.
 *
 * Body lines are scanned in order; code fences ("```") and horizontal rules ("---", "***") are
 * skipped, and each other line is passed through `plainLine`. The first non-empty result is
 * returned, truncated to `max` characters with a trailing ellipsis when longer.
 *
 * @param {string} content - Raw file content of the note.
 * @param {number} [max=140] - Maximum number of characters before the snippet is truncated.
 * @returns {string} The snippet, or an empty string when the body has no text.
 *
 * @example
 * const snippet = noteSnippet('# Ideas\n\n- [ ] **Ship** it\n');
 * console.log(snippet); // 'Ship it'
 */
export function noteSnippet(content: string, max = 140): string {
  const { body } = parseNote(content);
  for (const line of body.split('\n')) {
    if (/^\s*(```|---+|\*\*\*+)\s*$/.test(line)) continue;
    const p = plainLine(line);
    if (p) return p.length > max ? p.slice(0, max) + '…' : p;
  }
  return '';
}

/**
 * Build a safe file name for a note title.
 *
 * The title is stripped of markdown syntax, path separators and colons become "-", control
 * characters are removed, whitespace runs collapse to one space and leading dots are dropped (so
 * the file is never hidden). The base is cut to 64 characters, replaced by `fallback` when empty,
 * and joined with `ext`.
 *
 * @param {string} title - The note title.
 * @param {string} ext - File extension without the dot (e.g. "md").
 * @param {string} fallback - Base name used when the sanitized title is empty.
 * @returns {string} The file name, e.g. "a-b- c.md" for "a/b: c".
 *
 * @example
 * const name = fileNameForTitle('a/b: c', 'md', 'New Note');
 * console.log(name); // 'a-b- c.md'
 */
export function fileNameForTitle(title: string, ext: string, fallback: string): string {
  let base = plainLine(title)
    .replace(/[/\\:]/g, '-')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  if (base.length > 64) base = base.slice(0, 64).trimEnd();
  if (!base) base = fallback;
  return `${base}.${ext}`;
}

/**
 * Pick a free file name, treating the note's own current name as available.
 *
 * Works like `fs.uniqueName` ("Foo.md", "Foo 2.md", "Foo 3.md", …) except that `self` never counts
 * as taken. A note named "Foo 2.md" whose desired name "Foo.md" is taken therefore keeps
 * "Foo 2.md" instead of moving to "Foo 3.md".
 *
 * @param {string} name - The desired file name.
 * @param {(candidate: string) => boolean} taken - Returns true when a candidate name already exists.
 * @param {string} self - The note's current file name.
 * @returns {string} `name` itself, or the first numbered variant that is free or equal to `self`.
 *
 * @example
 * const taken = new Set(['Foo.md', 'Foo 2.md']);
 * const name = uniqueNameExcept('Foo.md', (n) => taken.has(n), 'Bar.md');
 * console.log(name); // 'Foo 3.md'
 */
export function uniqueNameExcept(name: string, taken: (candidate: string) => boolean, self: string): string {
  if (name === self || !taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}${ext}`;
    if (candidate === self || !taken(candidate)) return candidate;
  }
}

/* ───────────────────────── Dates ───────────────────────── */

const DAY = 86_400_000; /** Length of one day in milliseconds. */

/**
 * Get the timestamp of local midnight on the day of `ts`.
 *
 * Creates a `Date` from the timestamp and zeroes its hours, minutes, seconds and milliseconds
 * in the local time zone, so day boundaries follow the user's clock.
 *
 * @param {number} ts - A timestamp in milliseconds.
 * @returns {number} The timestamp of 00:00:00.000 local time on the same day.
 *
 * @example
 * const midnight = startOfDay(Date.now());
 * console.log(new Date(midnight).getHours()); // 0
 */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Map an OS locale to the BCP 47 tag used for `Intl` date formatting.
 *
 * Korean maps to "ko-KR"; every other locale maps to "en-US", so month names, weekdays and
 * numeric dates are formatted in that region's style.
 *
 * @param {Locale} l - The OS locale.
 * @returns {string} "ko-KR" for Korean, "en-US" otherwise.
 *
 * @example
 * const tag = intlLocale('ko');
 * console.log(tag); // 'ko-KR'
 */
const intlLocale = (l: Locale) => (l === 'ko' ? 'ko-KR' : 'en-US');

/** A section of the notes list grouped by modification date. */
export interface DateGroup {
  /** Stable group id ("today", "yesterday", "prev7", "prev30", "m<month>", "y<year>"). */
  key: string;
  /** Localized section header. */
  label: string;
}

/**
 * Get the notes-list section for a modification date.
 *
 * Days are measured from local midnight of `now`: today, yesterday, the previous 7 days and the
 * previous 30 days each get their own localized label; older dates in the current year are grouped by
 * month name and anything earlier by year.
 *
 * @param {number} ts - Modification timestamp of the note.
 * @param {number} now - Current timestamp used as the reference point.
 * @param {Locale} locale - Locale for the section label.
 * @returns {DateGroup} The group key and its localized label.
 *
 * @example
 * const group = dateGroup(Date.now() - 60_000, Date.now(), 'en');
 * console.log(group); // { key: 'today', label: 'Today' }
 */
export function dateGroup(ts: number, now: number, locale: Locale): DateGroup {
  const today = startOfDay(now);
  const ko = locale === 'ko';
  if (ts >= today) return { key: 'today', label: ko ? '오늘' : 'Today' };
  if (ts >= today - DAY) return { key: 'yesterday', label: ko ? '어제' : 'Yesterday' };
  if (ts >= today - 7 * DAY) return { key: 'prev7', label: ko ? '이전 7일' : 'Previous 7 Days' };
  if (ts >= today - 30 * DAY) return { key: 'prev30', label: ko ? '이전 30일' : 'Previous 30 Days' };
  const d = new Date(ts);
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return { key: `m${d.getMonth()}`, label: new Intl.DateTimeFormat(intlLocale(locale), { month: 'long' }).format(d) };
  }
  return { key: `y${d.getFullYear()}`, label: ko ? `${d.getFullYear()}년` : String(d.getFullYear()) };
}

/**
 * Format the date shown in a notes-list row.
 *
 * Shows the time of day for today, "Yesterday" for yesterday, the weekday name within the last
 * six days, and a short numeric date (two-digit year) for anything older.
 *
 * @param {number} ts - Modification timestamp of the note.
 * @param {number} now - Current timestamp used as the reference point.
 * @param {Locale} locale - Locale used for formatting.
 * @returns {string} The localized date label.
 *
 * @example
 * const label = listDate(new Date(2026, 0, 15).getTime(), Date.now(), 'en');
 * console.log(label); // '1/15/26'
 */
export function listDate(ts: number, now: number, locale: Locale): string {
  const today = startOfDay(now);
  const L = intlLocale(locale);
  if (ts >= today) return new Intl.DateTimeFormat(L, { hour: 'numeric', minute: '2-digit' }).format(ts);
  if (ts >= today - DAY) return locale === 'ko' ? '어제' : 'Yesterday';
  if (ts >= today - 6 * DAY) return new Intl.DateTimeFormat(L, { weekday: 'long' }).format(ts);
  return new Intl.DateTimeFormat(L, { year: '2-digit', month: 'numeric', day: 'numeric' }).format(ts);
}

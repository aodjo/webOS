/**
 * Tab completion: command names in command position, paths elsewhere, plus per-command argument
 * candidates (theme → light/dark/auto, man → commands, …).
 */
import { HOME, fs, resolve } from '@/kernel';
import { commandNames } from './commands';
import type { ShellAPI } from './types';

/** One completion candidate. */
export interface Candidate {
  /** Text that replaces the word being completed. */
  insert: string;
  /** Text shown when listing candidates. */
  display: string;
  /** The candidate is a directory (its insert text ends with `/`). */
  dir?: boolean;
}

/** Completion result for a line and cursor position. */
export interface Completion {
  /** Index in the line where the word being completed starts. */
  start: number;
  /** The word as typed (raw, possibly with quotes / escapes). */
  word: string;
  candidates: Candidate[];
}

const OPERATOR = new Set([';', '|', '&', '<', '>', '(', ')']); /** Characters that end a word and start a new command for completion purposes. */
const COMMAND_ARGS = new Set(['man', 'which', 'where', 'type', 'help', 'sudo', 'command', 'exec']); /** Commands whose first argument is completed from command names. */
const DIRS_ONLY = new Set(['cd', 'pushd', 'rmdir']); /** Commands whose path arguments are completed with directories only. */

/**
 * Backslash-escapes characters that are special to the shell.
 *
 * Escapes whitespace, quotes, backslash, `$`, backtick, `!`, `&`, `;`, `|`, `<`, `>`,
 * parentheses, glob characters, braces and `#`, so the result reads back as the same single word.
 *
 * @param {string} s - The text to escape.
 * @returns {string} The escaped text.
 *
 * @example
 * escapeWord('My File (1).txt'); // 'My\\ File\\ \\(1\\).txt'
 */
export function escapeWord(s: string): string {
  return s.replace(/[\s'"\\$`!&;|<>()*?[\]{}#]/g, '\\$&');
}

/**
 * Removes quotes and backslashes from a raw word that may be unterminated.
 *
 * Outside quotes a backslash keeps the next character literally. Inside double quotes a
 * backslash also escapes the next character; inside single quotes everything is literal. An
 * unclosed quote simply runs to the end of the word.
 *
 * @param {string} raw - The word as typed.
 * @returns {string} The word's literal text.
 *
 * @example
 * unquote('"My Doc'); // 'My Doc'
 */
function unquote(raw: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < raw.length) out += raw[++i];
      else out += ch;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '\\' && i + 1 < raw.length) out += raw[++i];
    else out += ch;
  }
  return out;
}

/**
 * Splits the text before the cursor into the current command's words and the word being typed.
 *
 * Walks the text while tracking quotes and backslash escapes. Unquoted blanks finish a word;
 * an unquoted operator character also discards the words collected so far, so only the
 * current command remains.
 *
 * @param {string} before - The line up to the cursor.
 * @returns {{ start: number; words: string[] }} Where the word being typed starts, and the
 *   unquoted words of the current command before it.
 *
 * @example
 * scan('ls | grep fo'); // { start: 10, words: ['grep'] }
 */
function scan(before: string): { start: number; words: string[] } {
  let start = 0;
  let words: string[] = [];
  let quote: string | null = null;
  let wordStart = -1;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') i++;
      continue;
    }
    if (ch === '\\') {
      if (wordStart < 0) wordStart = i;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (wordStart < 0) wordStart = i;
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t' || OPERATOR.has(ch)) {
      if (wordStart >= 0) words.push(unquote(before.slice(wordStart, i)));
      wordStart = -1;
      if (OPERATOR.has(ch)) words = [];
      start = i + 1;
      continue;
    }
    if (wordStart < 0) wordStart = i;
  }
  return { start, words };
}

/**
 * Lists file and directory candidates for a partial path.
 *
 * A bare `~` completes to `~/`. Otherwise the word is split at its last `/`; the directory part
 * is resolved against `cwd` and its entries whose names start with the typed prefix are
 * returned, sorted by name. Hidden entries are included only when the prefix starts with `.`.
 * The directory part is kept as typed (e.g. `~/Doc` keeps `~/`) and re-escaped, directories get
 * a trailing `/` and files a trailing space.
 *
 * @param {string} word - The raw word being completed.
 * @param {string} cwd - The directory relative paths resolve against.
 * @param {boolean} dirsOnly - Only offer directories.
 * @returns {Candidate[]} The matching candidates; empty when the directory does not exist.
 *
 * @example
 * pathCandidates('~/Doc', '/Users/guest', false); // [{ insert: '~/Documents/', display: 'Documents/', dir: true }]
 */
function pathCandidates(word: string, cwd: string, dirsOnly: boolean): Candidate[] {
  const text = unquote(word);
  if (text === '~') return [{ insert: '~/', display: '~/', dir: true }];
  const slash = text.lastIndexOf('/');
  const dirPart = slash >= 0 ? text.slice(0, slash + 1) : '';
  const namePart = text.slice(slash + 1);
  const dirAbs = dirPart ? resolve(cwd, dirPart) : cwd;
  if (!fs.isDir(dirAbs)) return [];
  const rawDir = dirPart.startsWith('~') ? '~' + escapeWord(dirPart.slice(1)) : escapeWord(dirPart);
  return fs
    .readdir(dirAbs)
    .filter((n) => n.name.startsWith(namePart) && (namePart.startsWith('.') || !n.name.startsWith('.')) && (!dirsOnly || n.type === 'dir'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => ({ insert: rawDir + escapeWord(n.name) + (n.type === 'dir' ? '/' : ' '), display: n.name + (n.type === 'dir' ? '/' : ''), dir: n.type === 'dir' }));
}

/**
 * Computes completion candidates for the word at the cursor.
 *
 * In command position (the first word, or the word after `sudo`) and when the word does not
 * look like a path, candidates are command names and aliases. The first argument of commands
 * such as `man`, `which` or `sudo` completes command names. Otherwise the command's own
 * `complete` hook is asked for argument candidates (escaped spaces in its results are
 * unescaped first); when there is no hook or it returns null, paths are offered (directories
 * only for `cd`, `pushd` and `rmdir`).
 *
 * @param {string} line - The full input line.
 * @param {number} cursor - Cursor index in `line`; only the text before it is considered.
 * @param {ShellAPI} shell - Supplies aliases, command definitions and the cwd.
 * @returns {Completion} The word's start index, the raw word and its candidates.
 *
 * @example
 * const { candidates } = complete('ec', 2, shell);
 * console.log(candidates.map((c) => c.display)); // ['echo']
 */
export function complete(line: string, cursor: number, shell: ShellAPI): Completion {
  const before = line.slice(0, cursor);
  const { start, words } = scan(before);
  const word = before.slice(start);
  const prefix = unquote(word);
  /**
   * Turns names into candidates that start with the typed prefix.
   *
   * Removes duplicates, filters by prefix, sorts, and inserts each name escaped with a
   * trailing space.
   *
   * @param {string[]} names - Possible completions.
   * @returns {Candidate[]} The matching candidates.
   *
   * @example
   * byPrefix(['echo', 'env', 'ls']); // candidates for 'echo' and 'env' when the prefix is 'e'
   */
  const byPrefix = (names: string[]): Candidate[] =>
    [...new Set(names)]
      .filter((n) => n.startsWith(prefix))
      .sort()
      .map((n) => ({ insert: escapeWord(n) + ' ', display: n }));

  const commandPosition = words.length === 0 || (words.length === 1 && words[0] === 'sudo');
  if (commandPosition && !prefix.includes('/') && !prefix.startsWith('~') && !prefix.startsWith('.')) {
    return { start, word, candidates: byPrefix([...commandNames(), ...shell.aliases.keys()]) };
  }
  const cmd = words[0] === 'sudo' ? words[1] : words[0];
  if (cmd && COMMAND_ARGS.has(cmd) && words.length === 1) return { start, word, candidates: byPrefix(commandNames()) };
  const def = cmd ? shell.lookup(cmd) : undefined;
  const custom = def?.complete?.(words.length - 1, [...words.slice(1), prefix]);
  if (custom) return { start, word, candidates: byPrefix(custom.map((c) => c.replace(/\\ /g, ' '))) };
  return { start, word, candidates: pathCandidates(word, shell.cwd || HOME, !!cmd && DIRS_ONLY.has(cmd)) };
}

/**
 * Returns the longest common prefix of a list of strings.
 *
 * Used on candidates' insert texts to extend the typed word as far as all candidates agree.
 *
 * @param {string[]} items - The strings to compare.
 * @returns {string} The shared prefix; an empty string for an empty list.
 *
 * @example
 * commonPrefix(['Documents/', 'Downloads/']); // 'Do'
 */
export function commonPrefix(items: string[]): string {
  if (!items.length) return '';
  let p = items[0];
  for (const s of items) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

/** Find & replace over plain text, implemented as pure functions. */

/** A match as a `[start, end)` character range. */
export type Match = [start: number, end: number];

const MAX_MATCHES = 20000; /** Upper bound on the matches `findMatches` collects, so huge documents stay responsive. */

/**
 * Escapes every regular-expression metacharacter in a string.
 *
 * Prefixes each of `. * + ? ^ $ { } ( ) | [ ] \` with a backslash. Only syntax characters are
 * escaped, so the result is also valid in a pattern with the `u` flag.
 *
 * @param {string} s - The literal text.
 * @returns {string} A pattern source that matches `s` literally.
 *
 * @example
 * escapeRegExp('a.b*'); // 'a\\.b\\*'
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a global, Unicode-aware regular expression that matches a query literally.
 *
 * The query is escaped with `escapeRegExp`. A new RegExp is returned on every call, so its
 * `lastIndex` state is never shared between searches.
 *
 * @param {string} query - The text to search for.
 * @param {boolean} matchCase - Whether matching is case-sensitive; otherwise the `i` flag is added.
 * @returns {RegExp} The search pattern with the `g` and `u` flags.
 *
 * @example
 * pattern('Hello', false).test('hello'); // true
 */
function pattern(query: string, matchCase: boolean): RegExp {
  return new RegExp(escapeRegExp(query), matchCase ? 'gu' : 'giu');
}

/**
 * Finds every non-overlapping occurrence of a query in a text.
 *
 * Matches literally (no regex syntax), case-insensitively unless `matchCase` is set. Empty
 * matches are skipped, and collection stops after `MAX_MATCHES` results.
 *
 * @param {string} text - The text to search.
 * @param {string} query - The text to look for; an empty query yields no matches.
 * @param {boolean} [matchCase=false] - Whether matching is case-sensitive.
 * @returns {Match[]} The `[start, end)` ranges of the matches in document order.
 *
 * @example
 * findMatches('Abc abc', 'abc'); // [[0, 3], [4, 7]]
 */
export function findMatches(text: string, query: string, matchCase = false): Match[] {
  if (!query) return [];
  const out: Match[] = [];
  const re = pattern(query, matchCase);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0].length) {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

/**
 * Picks the first match starting at or after an offset.
 *
 * Wraps around to the first match when none starts at or after `offset`.
 *
 * @param {Match[]} matches - Matches in document order.
 * @param {number} offset - The character offset to search from.
 * @returns {number} Index into `matches`, or -1 when the list is empty.
 *
 * @example
 * matchIndexFrom([[0, 3], [4, 7]], 2); // 1
 * matchIndexFrom([[0, 3], [4, 7]], 9); // 0
 */
export function matchIndexFrom(matches: Match[], offset: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex(([s]) => s >= offset);
  return i === -1 ? 0 : i;
}

/**
 * Replaces every occurrence of a query in a text.
 *
 * Uses the same literal, optionally case-sensitive matching as `findMatches`. The replacement
 * is returned from a callback, so `$` sequences in it are inserted literally.
 *
 * @param {string} text - The text to edit.
 * @param {string} query - The text to replace; an empty query changes nothing.
 * @param {string} replacement - The literal replacement text.
 * @param {boolean} [matchCase=false] - Whether matching is case-sensitive.
 * @returns {{ text: string; count: number }} The new text and the number of replacements made.
 *
 * @example
 * replaceAllText('a-a', 'a', '$1'); // { text: '$1-$1', count: 2 }
 */
export function replaceAllText(text: string, query: string, replacement: string, matchCase = false): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  let count = 0;
  const next = text.replace(pattern(query, matchCase), () => {
    count++;
    return replacement;
  });
  return { text: next, count };
}

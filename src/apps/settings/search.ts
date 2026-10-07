/** Pure pane search: matches pane names in every language plus keywords. */
import type { LString } from '@/kernel/types';

/** Minimal shape a pane needs to be searchable. */
export interface Searchable {
  id: string;
  name: LString;
  keywords: string[];
}

/**
 * Normalizes text for case- and whitespace-insensitive matching.
 *
 * Applies Unicode NFC (so composed and decomposed Hangul compare equal), lowercases,
 * collapses runs of whitespace to a single space and trims both ends.
 *
 * @param {string} s - Text to normalize.
 * @returns {string} The normalized text.
 *
 * @example
 * norm('  Dark   Mode '); // 'dark mode'
 */
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Lists every localized variant of a pane name.
 *
 * A plain string name is returned as-is; a localized name yields both its English and
 * Korean forms so search works regardless of the current locale.
 *
 * @param {LString} name - Pane name.
 * @returns {string[]} All name variants.
 *
 * @example
 * names({ en: 'Sound', ko: '사운드' }); // ['Sound', '사운드']
 */
function names(name: LString): string[] {
  return typeof name === 'string' ? [name] : [name.en, name.ko];
}

/**
 * Scores how well a pane matches a search query.
 *
 * Both sides are normalized with `norm`. A name that starts with the query scores 3, a name
 * that contains it scores 2, and, only when no name matched, a keyword containing it scores 1.
 * A blank query never matches.
 *
 * @param {Searchable} p - Pane to score.
 * @param {string} query - Search text.
 * @returns {number} 0 for no match; higher is better.
 *
 * @example
 * scorePane({ id: 'wifi', name: 'Wi-Fi', keywords: ['network'] }, 'wi'); // 3
 * scorePane({ id: 'wifi', name: 'Wi-Fi', keywords: ['network'] }, 'net'); // 1
 */
export function scorePane(p: Searchable, query: string): number {
  const q = norm(query);
  if (!q) return 0;
  let best = 0;
  for (const n of names(p.name).map(norm)) {
    if (n.startsWith(q)) best = Math.max(best, 3);
    else if (n.includes(q)) best = Math.max(best, 2);
  }
  if (!best && p.keywords.some((k) => norm(k).includes(q))) best = 1;
  return best;
}

/**
 * Filters and ranks panes by a search query.
 *
 * Drops panes scoring 0 with `scorePane`, then sorts by descending score; ties keep the
 * panes' original order.
 *
 * @template T
 * @param {T[]} panes - Candidate panes, in their preferred display order.
 * @param {string} query - Search text.
 * @returns {T[]} Matching panes, best first; empty for a blank query.
 *
 * @example
 * searchPanes(PANES, 'd').map((p) => p.id); // ['desktop-dock', 'displays', 'sound', …]
 */
export function searchPanes<T extends Searchable>(panes: T[], query: string): T[] {
  return panes
    .map((p, i) => ({ p, i, score: scorePane(p, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.p);
}

import type { LString } from '@/kernel/types';
import type { Project } from '@/data/portfolio';

/** Gallery sort order: `newest` by year (then name), `name` alphabetically. */
export type SortKey = 'newest' | 'name';

/** Filter and sort options applied to the project gallery. */
export interface ProjectQuery {
  /** Selected tags; a project matches if it has any of them. Empty = all. */
  tags: string[];
  /** Free-text search; every whitespace-separated word must appear in the project. */
  query: string;
  /** Order of the resulting list. */
  sort: SortKey;
}

/**
 * Collects every tag used by any project, most frequent first.
 *
 * Counts how many projects carry each tag and sorts the tags by that count
 * in descending order; tags with the same count are ordered alphabetically
 * with `localeCompare`. Each tag appears once in the result.
 *
 * @param {Project[]} list - Projects whose tags are collected.
 * @returns {string[]} Unique tags ordered by frequency, ties alphabetical.
 *
 * @example
 * const tags = allTags(projects);
 * console.log(tags); // ['React', 'TypeScript', 'Canvas', ...]
 */
export function allTags(list: Project[]): string[] {
  const counts = new Map<string, number>();
  for (const p of list) for (const tag of p.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/**
 * Returns every translation of a localized string.
 *
 * A plain string is returned as a single-element array; an `{ en, ko }`
 * object yields both locale variants so search can match either language.
 *
 * @param {LString} s - Plain or localized string.
 * @returns {string[]} All text variants of the string.
 *
 * @example
 * texts({ en: 'Pixel art', ko: '픽셀 아트' }); // ['Pixel art', '픽셀 아트']
 * texts('Solo'); // ['Solo']
 */
const texts = (s: LString): string[] => (typeof s === 'string' ? [s] : [s.en, s.ko]);

/**
 * Builds the lowercased searchable text of a project in every locale.
 *
 * Joins the project's name, year, tags, and every locale variant of its
 * tagline, description, and role with newlines, so a search word cannot
 * accidentally match across two adjacent fields.
 *
 * @param {Project} p - Project to index.
 * @returns {string} Newline-separated, lowercased search text.
 *
 * @example
 * const hay = haystack(project);
 * console.log(hay.includes('react')); // true when the project is tagged React
 */
function haystack(p: Project): string {
  return [p.name, String(p.year), ...p.tags, ...texts(p.tagline), ...texts(p.description), ...texts(p.role)].join('\n').toLowerCase();
}

/**
 * Returns a sorted copy of a project list.
 *
 * `name` sorts alphabetically; `newest` sorts by year descending and falls
 * back to the name for projects from the same year. Names are compared with
 * a numeric, case- and accent-insensitive `Intl.Collator`. The input array
 * is not mutated.
 *
 * @param {Project[]} list - Projects to sort.
 * @param {SortKey} sort - Sort order to apply.
 * @returns {Project[]} A new, sorted array.
 *
 * @example
 * const byName = sortProjects(projects, 'name');
 * console.log(byName[0].name); // Alphabetically first project
 */
export function sortProjects(list: Project[], sort: SortKey): Project[] {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...list].sort((a, b) => (sort === 'name' ? coll.compare(a.name, b.name) : b.year - a.year || coll.compare(a.name, b.name)));
}

/**
 * Filters projects by tags and search text, then sorts them.
 *
 * A project passes the tag filter when it has at least one of the selected
 * tags (no selected tags means every project passes). The query is trimmed,
 * lowercased, and split on whitespace; every resulting word must occur in the
 * project's searchable text, which covers all locales. The matches are then
 * ordered with `sortProjects`.
 *
 * @param {Project[]} list - Projects to filter.
 * @param {ProjectQuery} options - Filter and sort options.
 * @param {string[]} options.tags - Selected tags (any-of match).
 * @param {string} options.query - Free-text search; all words must match.
 * @param {SortKey} options.sort - Order of the result.
 * @returns {Project[]} Matching projects in the requested order.
 *
 * @example
 * const hits = filterProjects(projects, { tags: ['React'], query: 'webos', sort: 'newest' });
 * console.log(hits.map((p) => p.id)); // ['webos']
 */
export function filterProjects(list: Project[], { tags, query, sort }: ProjectQuery): Project[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = list.filter((p) => {
    if (tags.length && !tags.some((tag) => p.tags.includes(tag))) return false;
    if (!words.length) return true;
    const hay = haystack(p);
    return words.every((w) => hay.includes(w));
  });
  return sortProjects(matches, sort);
}

import { describe, expect, it } from 'vitest';
import type { Project } from '@/data/portfolio';
import { allTags, filterProjects, sortProjects } from './filter';

/**
 * Builds a minimal project fixture.
 *
 * Fills the fields the filter does not inspect with placeholders. The
 * tagline is localized: the English text is `tagline` and the Korean text is
 * `tagline` followed by " (한국어)", so searches can be tested in both locales.
 *
 * @param {string} id - Project id.
 * @param {string} name - Project name.
 * @param {number} year - Project year.
 * @param {string[]} tags - Project tags.
 * @param {string} [tagline=''] - English tagline.
 * @returns {Project} The project fixture.
 *
 * @example
 * const p = make('a', 'Zeta', 2023, ['React'], 'Pixel art');
 */
const make = (id: string, name: string, year: number, tags: string[], tagline = ''): Project => ({
  id,
  name,
  year,
  tags,
  tagline: { en: tagline, ko: `${tagline} (한국어)` },
  description: 'desc',
  role: 'Solo',
  cover: '',
  color: '#000',
  links: {},
  highlights: [],
});

const list = [make('a', 'Zeta', 2023, ['React', 'Canvas'], 'Pixel art'), make('b', 'alpha', 2025, ['React']), make('c', 'Beta', 2024, ['Go'], 'Typing game')]; /** Fixture projects with mixed-case names, distinct years, and overlapping tags. */

describe('projects filter', () => {
  it('collects tags by frequency', () => {
    expect(allTags(list)).toEqual(['React', 'Canvas', 'Go']);
  });

  it('sorts by year (newest first) or by name', () => {
    expect(sortProjects(list, 'newest').map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(sortProjects(list, 'name').map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(sortProjects([list[0], list[2]], 'name').map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('matches any selected tag', () => {
    expect(filterProjects(list, { tags: ['Canvas', 'Go'], query: '', sort: 'newest' }).map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('searches every locale and all words', () => {
    expect(filterProjects(list, { tags: [], query: 'pixel', sort: 'name' }).map((p) => p.id)).toEqual(['a']);
    expect(filterProjects(list, { tags: [], query: '한국어 typing', sort: 'name' }).map((p) => p.id)).toEqual(['c']);
    expect(filterProjects(list, { tags: ['React'], query: 'typing', sort: 'name' })).toEqual([]);
  });
});

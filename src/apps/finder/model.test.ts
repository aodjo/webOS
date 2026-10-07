import { describe, expect, it } from 'vitest';
import type { FSNode } from '@/kernel';
import { HOME, PATHS } from '@/kernel';
import {
  canDropInto,
  chain,
  displayName,
  findMovedPath,
  flattenRows,
  formatFinderDate,
  gridMove,
  isInvalidDrop,
  itemCount,
  kindLabel,
  linearMove,
  listChildren,
  locationName,
  defaultSort,
  nextSort,
  rangeBetween,
  resolveExistingDir,
  RECENTS,
  selectRecents,
  sortItems,
  toggleIn,
  typeAheadMatch,
  withRo,
  xor,
} from './model';

const T0 = Date.UTC(2026, 0, 15, 9, 0, 0); /** Base timestamp for fixture nodes. */

/**
 * Builds a file node fixture.
 *
 * The name is taken from the last path segment and `createdAt` is always `T0`.
 *
 * @param {string} path - Absolute path of the file.
 * @param {string} [content=''] - File content.
 * @param {number} [modifiedAt=T0] - Modification timestamp.
 * @param {FSNode['meta']} [meta] - Optional node metadata.
 * @returns {FSNode} The file node.
 *
 * @example
 * const a = file('/x/a.txt', 'hello', T0 + 1);
 */
function file(path: string, content = '', modifiedAt = T0, meta?: FSNode['meta']): FSNode {
  return { path, name: path.slice(path.lastIndexOf('/') + 1), type: 'file', content, createdAt: T0, modifiedAt, meta };
}
/**
 * Builds a folder node fixture.
 *
 * The name is the last path segment ("/" for the root); both timestamps are `T0`.
 *
 * @param {string} path - Absolute path of the folder.
 * @param {FSNode['meta']} [meta] - Optional node metadata.
 * @returns {FSNode} The folder node.
 *
 * @example
 * const locked = dir('/etc', { locked: true });
 */
function dir(path: string, meta?: FSNode['meta']): FSNode {
  return { path, name: path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1), type: 'dir', createdAt: T0, modifiedAt: T0, meta };
}
/**
 * Builds a node map keyed by path from fixture nodes.
 *
 * Each node is stored under its own `path`; a later node with the same path replaces an
 * earlier one.
 *
 * @param {...FSNode} list - Nodes to include.
 * @returns {Record<string, FSNode>} The path-to-node map.
 *
 * @example
 * const nodes = tree(dir('/'), dir('/a'), file('/a/b.txt'));
 */
function tree(...list: FSNode[]): Record<string, FSNode> {
  return Object.fromEntries(list.map((n) => [n.path, n]));
}

describe('names & kinds', () => {
  it('localizes standard folders', () => {
    expect(displayName(dir(PATHS.documents), 'ko')).toBe('문서');
    expect(displayName(dir(PATHS.documents), 'en')).toBe('Documents');
    expect(displayName(dir(HOME), 'en')).toBe(HOME.split('/').pop());
    expect(locationName(RECENTS, 'ko')).toBe('최근 항목');
    expect(locationName('/', 'en')).toMatch(/ HD$/);
  });

  it('strips .app when the app is unknown', () => {
    expect(displayName(file('/Applications/Foo.app', 'foo'), 'en')).toBe('Foo');
  });

  it('describes kinds', () => {
    expect(kindLabel(file('/a/b.md'), 'en')).toBe('Markdown Document');
    expect(kindLabel(file('/a/b.png'), 'ko')).toBe('PNG 이미지');
    expect(kindLabel(file('/a/b.jpg'), 'en')).toBe('JPEG Image');
    expect(kindLabel(dir('/a'), 'ko')).toBe('폴더');
    expect(kindLabel(file('/a/X.app'), 'en')).toBe('Application');
  });
});

describe('listing', () => {
  const nodes = tree(
    dir('/'),
    dir(HOME),
    dir(PATHS.documents),
    file(`${PATHS.documents}/a.txt`, 'a', T0 + 3),
    file(`${PATHS.documents}/.secret`, 'x', T0 + 9),
    dir(PATHS.trash),
    file(`${PATHS.trash}/old.txt`, 'x', T0 + 10),
    file(`${HOME}/b.md`, 'b', T0 + 5),
    file(`${HOME}/hidden.txt`, 'h', T0 + 8, { hidden: true }),
  );

  it('lists direct children and hides dotfiles unless asked', () => {
    expect(listChildren(nodes, PATHS.documents, false).map((n) => n.name)).toEqual(['a.txt']);
    expect(listChildren(nodes, PATHS.documents, true).map((n) => n.name).sort()).toEqual(['.secret', 'a.txt']);
  });

  it('builds Recents from visible files outside the Trash, newest first', () => {
    expect(selectRecents(nodes).map((n) => n.name)).toEqual(['b.md', 'a.txt']);
  });

  it('falls back to an existing ancestor', () => {
    expect(resolveExistingDir(`${PATHS.documents}/gone/deeper`, nodes)).toBe(PATHS.documents);
    expect(resolveExistingDir(RECENTS, nodes)).toBe(RECENTS);
  });
});

describe('sorting', () => {
  const a = file('/x/b.txt', '12345', T0 + 1);
  const b = file('/x/a.txt', '1', T0 + 2);
  const c = dir('/x/C');
  it('sorts by name (natural, case-insensitive)', () => {
    expect(sortItems([a, c, b], { key: 'name', dir: 'asc' }, 'en').map((n) => n.name)).toEqual(['a.txt', 'b.txt', 'C']);
    expect(sortItems([a, c, b], { key: 'name', dir: 'desc' }, 'en').map((n) => n.name)).toEqual(['C', 'b.txt', 'a.txt']);
  });
  it('sorts by size with folders last when descending', () => {
    expect(sortItems([c, b, a], { key: 'size', dir: 'desc' }, 'en').map((n) => n.name)).toEqual(['b.txt', 'a.txt', 'C']);
  });
  it('sorts by date', () => {
    expect(sortItems([a, b], { key: 'date', dir: 'desc' }, 'en').map((n) => n.name)).toEqual(['a.txt', 'b.txt']);
  });
  it('returns a stable default sort so memoized listings are not re-sorted every render', () => {
    expect(defaultSort('/x')).toBe(defaultSort('/y'));
    expect(defaultSort(RECENTS)).toBe(defaultSort(RECENTS));
    expect(defaultSort(RECENTS)).toEqual({ key: 'date', dir: 'desc' });
    expect(defaultSort('/x')).toEqual({ key: 'name', dir: 'asc' });
  });
  it('toggles direction on the same column, natural direction on a new one', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'date')).toEqual({ key: 'date', dir: 'desc' });
  });
});

describe('list tree', () => {
  it('flattens expanded folders recursively', () => {
    const kids: Record<string, FSNode[]> = { '/r/A': [file('/r/A/1'), dir('/r/A/B')], '/r/A/B': [file('/r/A/B/2')] };
    const rows = flattenRows([dir('/r/A'), file('/r/z')], new Set(['/r/A', '/r/A/B']), (d) => kids[d] ?? []);
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual(['0:A', '1:1', '1:B', '2:2', '0:z']);
  });
});

describe('keyboard navigation', () => {
  it('moves through a grid', () => {
    // 7 items, 3 columns: rows [0 1 2] [3 4 5] [6]
    expect(gridMove(-1, 7, 3, 'down')).toBe(0);
    expect(gridMove(1, 7, 3, 'down')).toBe(4);
    expect(gridMove(4, 7, 3, 'down')).toBe(6);
    expect(gridMove(6, 7, 3, 'down')).toBe(6);
    expect(gridMove(4, 7, 3, 'up')).toBe(1);
    expect(gridMove(1, 7, 3, 'up')).toBe(1);
    expect(gridMove(0, 7, 3, 'left')).toBe(0);
    expect(gridMove(6, 7, 3, 'right')).toBe(6);
    expect(gridMove(0, 0, 3, 'right')).toBe(-1);
  });

  it('moves linearly', () => {
    expect(linearMove(-1, 3, 1)).toBe(0);
    expect(linearMove(-1, 3, -1)).toBe(2);
    expect(linearMove(2, 3, 1)).toBe(2);
  });

  it('selects ranges and toggles', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(rangeBetween(order, 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
    expect(xor(['a', 'b'], ['b', 'c']).sort()).toEqual(['a', 'c']);
  });

  it('jumps with type-ahead', () => {
    const entries = ['Apple', 'banana', 'Cherry', 'date'].map((name) => ({ path: `/${name}`, name }));
    expect(typeAheadMatch(entries, 'ch', 'en')).toBe('/Cherry');
    expect(typeAheadMatch(entries, 'B', 'en')).toBe('/banana');
    expect(typeAheadMatch(entries, 'cz', 'en')).toBe('/date');
    expect(typeAheadMatch(entries, 'zz', 'en')).toBe('/date');
  });

  it('builds the column chain', () => {
    expect(chain('/a', '/a/b/c')).toEqual(['/a', '/a/b', '/a/b/c']);
    expect(chain('/a', '/x')).toEqual(['/x']);
    expect(chain('/', '/a')).toEqual(['/', '/a']);
  });
});

describe('drop rules', () => {
  it('refuses protected system locations and allows home folders + Trash', () => {
    expect(canDropInto(dir('/Applications'))).toBe(false);
    expect(canDropInto(dir('/System/Library'))).toBe(false);
    expect(canDropInto(dir('/'))).toBe(false);
    expect(canDropInto(dir('/etc', { locked: true }))).toBe(false);
    expect(canDropInto(dir(PATHS.desktop))).toBe(true);
    expect(canDropInto(dir(PATHS.trash))).toBe(true);
    expect(canDropInto(dir(`${PATHS.trash}/inner`))).toBe(false);
    expect(canDropInto(file(`${HOME}/a.txt`))).toBe(false);
  });

  it('detects no-op and recursive drops', () => {
    expect(isInvalidDrop(['/a/b'], '/a/b/c', false)).toBe(true);
    expect(isInvalidDrop(['/a/b'], '/a', false)).toBe(true);
    expect(isInvalidDrop(['/a/b'], '/a', true)).toBe(false);
    expect(isInvalidDrop(['/a/b'], '/x', false)).toBe(false);
  });
});

describe('formatting', () => {
  const now = new Date(2026, 9, 2, 15, 0).getTime();
  it('uses relative day names', () => {
    expect(formatFinderDate(new Date(2026, 9, 2, 9, 5).getTime(), 'en', { now })).toBe('Today at 9:05 AM');
    expect(formatFinderDate(new Date(2026, 9, 1, 21, 30).getTime(), 'ko', { now })).toMatch(/^어제 오후 9:30$/);
    expect(formatFinderDate(new Date(2026, 0, 15, 9, 0).getTime(), 'en', { now })).toBe('Jan 15, 2026 at 9:00 AM');
  });

  it('counts items', () => {
    expect(itemCount(1, 'en')).toBe('1 item');
    expect(itemCount(3, 'ko')).toBe('3개 항목');
  });

  it('picks the right Korean particle', () => {
    expect(withRo('미리보기')).toBe('미리보기로');
    expect(withRo('메일')).toBe('메일로');
    expect(withRo('터미널')).toBe('터미널로');
    expect(withRo('계산기 앱')).toBe('계산기 앱으로');
    expect(withRo('TextEdit')).toBe('TextEdit으로');
    expect(withRo('Safari')).toBe('Safari로');
    expect(withRo('Finder')).toBe('Finder로');
    expect(withRo('Zoom')).toBe('Zoom으로');
    expect(withRo('Bing')).toBe('Bing으로');
    expect(withRo('App 3')).toBe('App 3으로');
    expect(withRo('App 2')).toBe('App 2로');
    expect(withRo('★')).toBe('★(으)로');
  });
});

describe('following moved items', () => {
  const before = tree(dir('/a'), dir('/a/b'), file('/a/b/c.txt'), file('/a/x.txt'));

  it('finds a renamed folder (shallowest match) and a moved file', () => {
    const renamed = tree(dir('/a'), { ...dir('/a/d') }, { ...file('/a/d/c.txt') }, file('/a/x.txt'));
    expect(findMovedPath(before['/a/b'], before, renamed)).toBe('/a/d');
    const moved = tree(dir('/a'), dir('/a/b'), file('/a/b/c.txt'), file('/a/b/x.txt'));
    expect(findMovedPath(before['/a/x.txt'], before, moved)).toBe('/a/b/x.txt');
  });

  it('prefers the Trash entry that remembers the original path', () => {
    const trashed = tree(dir('/a'), dir('/a/b'), file('/a/b/c.txt'), { ...file(`${PATHS.trash}/y.txt`, '', T0 + 1), meta: { trashedFrom: '/a/x.txt' } });
    expect(findMovedPath(before['/a/x.txt'], before, trashed)).toBe(`${PATHS.trash}/y.txt`);
  });

  it('returns null when the item was deleted', () => {
    const deleted = tree(dir('/a'), dir('/a/b'), file('/a/b/c.txt'));
    expect(findMovedPath(before['/a/x.txt'], before, deleted)).toBeNull();
  });
});

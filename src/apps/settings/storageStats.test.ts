import { describe, expect, it } from 'vitest';
import type { FSNode } from '@/kernel/types';
import { categorize, computeStorage } from './storageStats';

/**
 * Builds a minimal FS node fixture for storage tests.
 *
 * Derives `name` from the last path segment, stores `size` as `bytes` and zeroes both
 * timestamps.
 *
 * @param {string} path - Absolute path of the node.
 * @param {number} size - Size in bytes.
 * @param {FSNode['type']} [type='file'] - Node type.
 * @returns {FSNode} The fixture node.
 *
 * @example
 * node('/Users/me/a.md', 100); // { path: '/Users/me/a.md', name: 'a.md', type: 'file', bytes: 100, … }
 */
const node = (path: string, size: number, type: FSNode['type'] = 'file'): FSNode => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  type,
  bytes: size,
  createdAt: 0,
  modifiedAt: 0,
});

describe('categorize', () => {
  it('classifies by location first, then by kind', () => {
    expect(categorize(node('/Applications/Safari.app', 1))).toBe('apps');
    expect(categorize(node('/System/Library/Desktop Pictures/Jeju.svg', 1))).toBe('system');
    expect(categorize(node('/etc/hosts', 1))).toBe('system');
    expect(categorize(node('/Users/me/Pictures/cat.png', 1))).toBe('images');
    expect(categorize(node('/Users/me/Documents/Resume.md', 1))).toBe('documents');
    expect(categorize(node('/Users/me/Documents/app.ts', 1))).toBe('documents');
    expect(categorize(node('/Users/me/Music/song.mp3', 1))).toBe('other');
  });

  it('does not treat look-alike prefixes as system folders', () => {
    expect(categorize(node('/Users/me/etcetera.txt', 1))).toBe('documents');
  });
});

describe('computeStorage', () => {
  it('sums file sizes per category and ignores folders', () => {
    const nodes = [
      node('/Applications/Notes.app', 10),
      node('/Users/me/a.md', 100),
      node('/Users/me/b.png', 1000),
      node('/System/x.plist', 5),
      node('/Users/me/song.mp3', 7),
      node('/Users/me/Folder', 999, 'dir'),
    ];
    const stats = computeStorage(nodes, (n) => n.bytes ?? 0);
    expect(stats.total).toBe(1122);
    expect(stats.files).toBe(5);
    expect(stats.byCategory).toEqual({ apps: 10, documents: 100, images: 1000, system: 5, other: 7 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fs, useFS } from '@/kernel/fs';
import { HOME, PATHS } from '@/kernel/constants';
import { basename } from '@/kernel/path';
import type { FSNode } from '@/kernel/types';
import { findMovedFile, identityOf } from './fileTracking';

/**
 * Resets the virtual file system to a minimal tree for each test.
 *
 * Creates the root, `/Users`, the home folder, Desktop, Documents and Trash as directories
 * and installs them as the whole `useFS` state, marked hydrated.
 *
 * @returns {void}
 *
 * @example
 * beforeEach(() => seed());
 */
function seed() {
  const nodes: Record<string, FSNode> = {};
  /**
   * Adds a directory node for a path to the seed map.
   *
   * The node is named after the last path segment (`/` for the root), and both its creation
   * and modification times are 1.
   *
   * @param {string} p - Absolute directory path.
   * @returns {FSNode} The directory node that was stored.
   *
   * @example
   * dir(PATHS.documents);
   */
  const dir = (p: string) => (nodes[p] = { path: p, name: p === '/' ? '/' : basename(p), type: 'dir', createdAt: 1, modifiedAt: 1 });
  ['/', '/Users', HOME, PATHS.desktop, PATHS.documents, PATHS.trash].forEach(dir);
  useFS.setState({ nodes, seedVersion: 'test', hydrated: true });
}

/**
 * Builds a path inside the Documents folder.
 *
 * Joins `name` to `PATHS.documents` with a slash; the path is not checked or normalized.
 *
 * @param {string} name - Relative file or folder name.
 * @returns {string} The absolute path under Documents.
 *
 * @example
 * fs.writeFile(doc('a.txt'), 'x');
 */
const doc = (name: string) => `${PATHS.documents}/${name}`;

describe('findMovedFile', () => {
  beforeEach(() => {
    seed();
    // Every write gets the same timestamp, like `touch a.txt b.txt` in one millisecond.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });
  afterEach(() => vi.restoreAllMocks());

  it('follows a rename through the move journal', () => {
    const id = identityOf(fs.writeFile(doc('track-rename.txt'), 'x'));
    fs.rename(doc('track-rename.txt'), 'track-renamed.txt');
    expect(findMovedFile(id, doc('track-rename.txt'))?.path).toBe(doc('track-renamed.txt'));
  });

  it('does not hand a deleted file over to an identical sibling', () => {
    const id = identityOf(fs.writeFile(doc('twin-a.txt'), ''));
    fs.writeFile(doc('twin-b.txt'), '');
    fs.rm(doc('twin-a.txt'));
    expect(findMovedFile(id, doc('twin-a.txt'))).toBeNull();
  });

  it('does not match children of a copied folder', () => {
    fs.mkdir(doc('track-src'));
    fs.writeFile(doc('track-src/one.txt'), '');
    fs.writeFile(doc('track-src/two.txt'), '');
    fs.copy(doc('track-src'), doc('track-copy'));
    const id = identityOf(fs.stat(doc('track-copy/one.txt'))!);
    fs.rm(doc('track-copy/one.txt'));
    expect(findMovedFile(id, doc('track-copy/one.txt'))).toBeNull();
  });

  it('ignores a stale journal entry for a path that was reused', () => {
    vi.mocked(Date.now).mockReturnValue(1);
    fs.writeFile(doc('reuse.txt'), 'old');
    fs.rename(doc('reuse.txt'), 'reuse-moved.txt');
    vi.mocked(Date.now).mockReturnValue(2);
    const id = identityOf(fs.writeFile(doc('reuse.txt'), 'new'));
    fs.rm(doc('reuse.txt'));
    expect(findMovedFile(id, doc('reuse.txt'))).toBeNull();
  });
});

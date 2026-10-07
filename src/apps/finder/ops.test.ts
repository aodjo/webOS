import { beforeEach, describe, expect, it } from 'vitest';
import type { FSNode } from '@/kernel';
import { HOME, PATHS, fileClipboard, fs } from '@/kernel';
import { ops, resolveTyped, undoLast, useUndo } from './ops';

/**
 * Resets the file system, undo stack and clipboard before each test.
 *
 * Replaces the whole file system with a minimal tree (root, locked /Users and /Applications,
 * the home folder with Desktop, Documents and Trash), empties the Finder undo stack and clears
 * the file clipboard.
 *
 * @returns {void}
 *
 * @example
 * beforeEach(seed);
 */
function seed() {
  const t = Date.now();
  /**
   * Builds a folder node stamped with the seed time.
   *
   * The name is the last path segment ("/" for the root) and both `createdAt` and
   * `modifiedAt` are the timestamp taken when `seed` started.
   *
   * @param {string} path - Absolute path of the folder.
   * @param {FSNode['meta']} [meta] - Optional node metadata.
   * @returns {FSNode} The folder node.
   *
   * @example
   * d('/Users', { locked: true });
   */
  const d = (path: string, meta?: FSNode['meta']): FSNode => ({ path, name: path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1), type: 'dir', createdAt: t, modifiedAt: t, meta });
  const nodes: Record<string, FSNode> = {};
  for (const n of [d('/'), d('/Users', { locked: true }), d(HOME), d(PATHS.desktop), d(PATHS.documents), d(PATHS.trash), d('/Applications', { locked: true })]) nodes[n.path] = n;
  fs.replaceAll(nodes, 'test');
  useUndo.setState({ stack: [] });
  fileClipboard.clear();
}

describe('finder ops with undo', () => {
  beforeEach(seed);

  it('renames and undoes', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'hi');
    const next = ops.rename(`${PATHS.documents}/a.txt`, 'b.txt');
    expect(next).toBe(`${PATHS.documents}/b.txt`);
    undoLast();
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(true);
    expect(fs.exists(`${PATHS.documents}/b.txt`)).toBe(false);
  });

  it('moves by drop and undoes', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'hi');
    const out = ops.drop([`${PATHS.documents}/a.txt`], PATHS.desktop, false);
    expect(out).toEqual([`${PATHS.desktop}/a.txt`]);
    undoLast();
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(true);
    expect(fs.exists(`${PATHS.desktop}/a.txt`)).toBe(false);
  });

  it('copies by drop (alt) and undo moves the copy to the Trash', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'hi');
    const out = ops.drop([`${PATHS.documents}/a.txt`], PATHS.desktop, true);
    expect(out).toEqual([`${PATHS.desktop}/a.txt`]);
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(true);
    undoLast();
    expect(fs.exists(`${PATHS.desktop}/a.txt`)).toBe(false);
    expect(fs.trashCount()).toBe(1);
  });

  it('drops onto the Trash, and undo puts back', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'hi');
    ops.drop([`${PATHS.documents}/a.txt`], PATHS.trash, false);
    expect(fs.trashCount()).toBe(1);
    undoLast();
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(true);
    expect(fs.trashCount()).toBe(0);
  });

  it('never erases Trash items dropped on the Trash again', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'hi');
    const inTrash = fs.trash(`${PATHS.documents}/a.txt`);
    expect(ops.drop([inTrash], PATHS.trash, false)).toEqual([]);
    expect(fs.exists(inTrash)).toBe(true);
  });

  it('trashes and undoes', async () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'hi');
    await ops.trash([`${PATHS.documents}/a.txt`]);
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(false);
    undoLast();
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(true);
  });

  it('creates a folder with the selection and undoes it', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'a');
    fs.writeFile(`${PATHS.documents}/b.txt`, 'b');
    const folder = ops.newFolderWithItems([`${PATHS.documents}/a.txt`, `${PATHS.documents}/b.txt`], PATHS.documents)!;
    expect(fs.readdir(folder).map((n) => n.name).sort()).toEqual(['a.txt', 'b.txt']);
    undoLast();
    expect(fs.exists(folder)).toBe(false);
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(true);
  });

  it('pastes copies from the clipboard', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'a');
    fileClipboard.copy([`${PATHS.documents}/a.txt`]);
    expect(ops.paste(PATHS.desktop)).toEqual([`${PATHS.desktop}/a.txt`]);
    expect(ops.paste(PATHS.desktop)).toEqual([`${PATHS.desktop}/a 2.txt`]);
    expect(ops.moveHere(PATHS.desktop)).toEqual([`${PATHS.desktop}/a 3.txt`]);
    expect(fs.exists(`${PATHS.documents}/a.txt`)).toBe(false);
  });

  it('copies protected items instead of moving them', () => {
    fs.sudo(() => fs.writeFile('/Applications/X.app', 'x', { meta: { locked: true } }));
    const out = ops.drop(['/Applications/X.app'], PATHS.desktop, false);
    expect(out).toEqual([`${PATHS.desktop}/X.app`]);
    expect(fs.exists('/Applications/X.app')).toBe(true);
  });

  it('resolves typed paths', () => {
    expect(resolveTyped('~/Documents/', '/')).toBe(PATHS.documents);
    expect(resolveTyped('Desktop', HOME)).toBe(PATHS.desktop);
    expect(resolveTyped('/etc', HOME)).toBe('/etc');
  });
});

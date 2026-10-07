import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fs, FSError, useFS, sortNodes } from './fs';
import { basename, dirname, extname, isWithin, normalize, resolve, stem, tildify } from './path';
import { HOME, PATHS } from './constants';
import { registerApps } from './registry';
import { useWM, wm } from './wm';
import { canonicalShortcut, eventToShortcut } from './menus';
import type { FSNode } from './types';
import { useSystem } from './system';
import { keyboardBusy, useUI } from './ui';
import { mergeSeed } from './seed';
import { renamePath } from './actions';
import { useDialogs } from './dialogs';

/**
 * Replaces the file-system store with a minimal hydrated tree.
 *
 * Creates the root, `/Users`, the home folder, Desktop, Documents, Trash, `/Applications` and
 * `/System` as empty directories, writing the store directly so no persistence or protection
 * rules are involved.
 *
 * @returns {void}
 *
 * @example
 * beforeEach(seed);
 */
function seed() {
  const t = 1;
  const nodes: Record<string, FSNode> = {};
  /**
   * Adds an empty directory node for a path to the tree being built.
   *
   * The node is named after the last path segment (`/` for the root) and uses the fixed
   * timestamp `t` for both creation and modification.
   *
   * @param {string} p - Absolute directory path.
   * @returns {FSNode} The directory node that was stored.
   *
   * @example
   * dir(PATHS.documents);
   */
  const dir = (p: string) => (nodes[p] = { path: p, name: p === '/' ? '/' : basename(p), type: 'dir', createdAt: t, modifiedAt: t });
  ['/', '/Users', HOME, PATHS.desktop, PATHS.documents, PATHS.trash, '/Applications', '/System'].forEach(dir);
  useFS.setState({ nodes, seedVersion: 'test', hydrated: true });
}

describe('path', () => {
  it('normalizes and resolves', () => {
    expect(normalize('/a//b/./c/../d/')).toBe('/a/b/d');
    expect(normalize('/../..')).toBe('/');
    expect(resolve('/a/b', '../c')).toBe('/a/c');
    expect(resolve('/x', '~/Desktop')).toBe(`${HOME}/Desktop`);
    expect(resolve('/x', '/abs')).toBe('/abs');
  });
  it('splits names', () => {
    expect(dirname('/a/b.txt')).toBe('/a');
    expect(dirname('/a')).toBe('/');
    expect(basename('/a/b.txt')).toBe('b.txt');
    expect(extname('/a/b.TXT')).toBe('txt');
    expect(extname('/a/.zshrc')).toBe('');
    expect(stem('/a/archive.tar.gz')).toBe('archive.tar');
    expect(isWithin('/a/b', '/a')).toBe(true);
    expect(isWithin('/ab', '/a')).toBe(false);
    expect(tildify(`${HOME}/Desktop`)).toBe('~/Desktop');
  });
});

describe('fs', () => {
  beforeEach(seed);

  it('writes, reads and lists', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'hello');
    expect(fs.readFile(`${PATHS.documents}/a.txt`)).toBe('hello');
    expect(fs.readdir(PATHS.documents).map((n) => n.name)).toEqual(['a.txt']);
    expect(fs.size(`${PATHS.documents}/a.txt`)).toBe(5);
  });

  it('enforces parents, types and exclusivity', () => {
    expect(() => fs.writeFile('/nope/a.txt', 'x')).toThrow(FSError);
    fs.writeFile(`${HOME}/f`, 'x');
    expect(() => fs.readdir(`${HOME}/f`)).toThrow(/Not a directory/);
    expect(() => fs.writeFile(`${HOME}/f`, 'y', { exclusive: true })).toThrow(/File exists/);
    expect(() => fs.readFile(HOME)).toThrow(/Is a directory/);
  });

  it('mkdir -p and rm -r', () => {
    fs.mkdir(`${HOME}/x/y/z`, { recursive: true });
    fs.writeFile(`${HOME}/x/y/z/f.txt`, '1');
    expect(() => fs.rm(`${HOME}/x`)).toThrow(/not empty/);
    fs.rm(`${HOME}/x`, { recursive: true });
    expect(fs.exists(`${HOME}/x/y/z/f.txt`)).toBe(false);
    expect(fs.exists(`${HOME}/x`)).toBe(false);
  });

  it('moves directories with their descendants', () => {
    fs.mkdir(`${HOME}/a/b`, { recursive: true });
    fs.writeFile(`${HOME}/a/b/c.txt`, 'c');
    fs.move(`${HOME}/a`, `${PATHS.documents}/a2`);
    expect(fs.readFile(`${PATHS.documents}/a2/b/c.txt`)).toBe('c');
    expect(fs.exists(`${HOME}/a`)).toBe(false);
    expect(() => fs.move(`${PATHS.documents}/a2`, `${PATHS.documents}/a2/b/inside`)).toThrow(FSError);
  });

  it('copies recursively and picks unique names', () => {
    fs.mkdir(`${HOME}/d`);
    fs.writeFile(`${HOME}/d/f.txt`, 'f');
    const dup = fs.duplicate(`${HOME}/d`);
    expect(dup).toBe(`${HOME}/d copy`);
    expect(fs.readFile(`${dup}/f.txt`)).toBe('f');
    const dupFile = fs.duplicate(`${HOME}/d/f.txt`);
    expect(basename(dupFile)).toBe('f copy.txt');
    expect(fs.uniqueName(`${HOME}/d`, 'f.txt')).toBe('f 2.txt');
  });

  it('protects system locations', () => {
    expect(() => fs.rm(PATHS.desktop, { recursive: true })).toThrow(/not permitted/);
    expect(() => fs.trash(HOME)).toThrow(/not permitted/);
    expect(() => fs.rename(PATHS.documents, 'Docs')).toThrow(/not permitted/);
    expect(() => fs.rm(PATHS.trash, { recursive: true })).toThrow(/not permitted/);
  });

  it('trashes, restores and empties', () => {
    fs.writeFile(`${PATHS.desktop}/note.txt`, 'n');
    const t = fs.trash(`${PATHS.desktop}/note.txt`);
    expect(dirname(t)).toBe(PATHS.trash);
    expect(fs.stat(t)?.meta?.trashedFrom).toBe(`${PATHS.desktop}/note.txt`);
    expect(fs.trashCount()).toBe(1);
    const back = fs.restore(t);
    expect(back).toBe(`${PATHS.desktop}/note.txt`);
    fs.trash(back);
    expect(fs.emptyTrash()).toBe(1);
    expect(fs.trashCount()).toBe(0);
    expect(fs.exists(PATHS.trash)).toBe(true);
  });

  it('trashing two items with the same name keeps both', () => {
    fs.writeFile(`${PATHS.desktop}/a.txt`, '1');
    fs.writeFile(`${PATHS.documents}/a.txt`, '2');
    const t1 = fs.trash(`${PATHS.desktop}/a.txt`);
    const t2 = fs.trash(`${PATHS.documents}/a.txt`);
    expect(t1).not.toBe(t2);
    expect(fs.trashCount()).toBe(2);
  });

  it('searches names and sorts naturally', () => {
    fs.writeFile(`${PATHS.documents}/file10.txt`, '');
    fs.writeFile(`${PATHS.documents}/file2.txt`, '');
    fs.writeFile(`${PATHS.documents}/.hidden`, '');
    expect(fs.search('file').length).toBe(2);
    expect(sortNodes(fs.readdir(PATHS.documents)).map((n) => n.name)).toEqual(['.hidden', 'file2.txt', 'file10.txt']);
  });
});

describe('fs: names, protection and locks', () => {
  beforeEach(seed);

  it('uniqueName only treats a real file extension as one', () => {
    fs.mkdir(`${PATHS.documents}/v1.2`);
    expect(fs.uniqueName(PATHS.documents, 'v1.2')).toBe('v1.2 2');
    fs.mkdir(`${PATHS.documents}/my.project`);
    expect(fs.duplicate(`${PATHS.documents}/my.project`)).toBe(`${PATHS.documents}/my.project copy`);
    expect(fs.duplicate(`${PATHS.documents}/my.project`)).toBe(`${PATHS.documents}/my.project copy 2`);
    fs.writeFile(`${PATHS.documents}/f.txt`, '');
    expect(fs.uniqueName(PATHS.documents, 'f.txt')).toBe('f 2.txt');
  });

  it('protects the Notes/Projects backing folders, Movies and Public', () => {
    for (const p of [PATHS.notes, PATHS.projects, `${HOME}/Movies`, `${HOME}/Public`]) fs.mkdir(p, { recursive: true });
    expect(() => fs.rename(PATHS.notes, 'Old Notes')).toThrow(/not permitted/);
    expect(() => fs.rename(`${HOME}/Movies`, 'Films')).toThrow(/not permitted/);
    expect(() => fs.trash(`${HOME}/Public`)).toThrow(/not permitted/);
    expect(() => fs.trash(PATHS.projects)).toThrow(/not permitted/);
  });

  it('a locked folder protects its contents; Empty Trash keeps locked items unless asked', () => {
    const L = `${PATHS.documents}/L`;
    fs.mkdir(L);
    fs.writeFile(`${L}/a.txt`, 'a');
    fs.setMeta(L, { locked: true });
    expect(() => fs.writeFile(`${L}/new.txt`, 'x')).toThrow(/not permitted/);
    expect(() => fs.rename(`${L}/a.txt`, 'b.txt')).toThrow(/not permitted/);
    expect(() => fs.trash(`${L}/a.txt`)).toThrow(/not permitted/);
    expect(() => fs.move(`${L}/a.txt`, `${PATHS.documents}/a.txt`)).toThrow(/not permitted/);
    fs.writeFile(`${L}/a.txt`, 'edited'); // editing an existing file is allowed
    fs.setMeta(L, { locked: false });

    fs.mkdir(`${PATHS.documents}/F`);
    fs.writeFile(`${PATHS.documents}/F/k.txt`, 'k');
    fs.setMeta(`${PATHS.documents}/F/k.txt`, { locked: true });
    expect(() => fs.trash(`${PATHS.documents}/F`)).toThrow(/not permitted/);

    // Locked items already in the Trash survive a plain Empty Trash.
    fs.writeFile(`${PATHS.documents}/z.txt`, 'z');
    const t = fs.trash(`${PATHS.documents}/z.txt`);
    fs.trash(`${L}/a.txt`);
    fs.setMeta(t, { locked: true });
    expect(fs.lockedInTrash()).toBe(1);
    fs.emptyTrash();
    expect(fs.exists(t)).toBe(true);
    expect(fs.trashCount()).toBe(1);
    fs.emptyTrash({ includeLocked: true });
    expect(fs.trashCount()).toBe(0);
  });

  it('Put Back returns a Desktop item to its cell', () => {
    fs.writeFile(`${PATHS.desktop}/a.txt`, 'a', { meta: { x: 3, y: 4 } });
    const t = fs.trash(`${PATHS.desktop}/a.txt`);
    expect(fs.stat(t)?.meta?.x).toBeUndefined();
    const back = fs.restore(t);
    expect(back).toBe(`${PATHS.desktop}/a.txt`);
    expect(fs.stat(back)?.meta).toMatchObject({ x: 3, y: 4 });
    expect(fs.stat(back)?.meta?.trashedCell).toBeUndefined();
  });

  it('refuses user-facing names that start with a dot', () => {
    fs.writeFile(`${PATHS.documents}/c.txt`, '');
    expect(renamePath(`${PATHS.documents}/c.txt`, '  .secret ')).toBeNull();
    expect(fs.exists(`${PATHS.documents}/c.txt`)).toBe(true);
    expect(useDialogs.getState().queue.at(-1)?.kind).toBe('alert');
    useDialogs.setState({ queue: [] });
  });

  it('the desktop picture follows its file when it is renamed or moved', () => {
    fs.writeFile(`${PATHS.documents}/pic.svg`, '<svg/>');
    useSystem.getState().updateSettings({ wallpaper: `${PATHS.documents}/pic.svg` });
    fs.rename(`${PATHS.documents}/pic.svg`, 'art.svg');
    expect(useSystem.getState().settings.wallpaper).toBe(`${PATHS.documents}/art.svg`);
    fs.trash(`${PATHS.documents}/art.svg`);
    expect(useSystem.getState().settings.wallpaper).toBe(`${PATHS.trash}/art.svg`);
    useSystem.getState().updateSettings({ wallpaper: 'hallasan' });
  });
});

describe('seed merge', () => {
  const H = 3_600_000;
  /**
   * Builds a file node for seed-merge fixtures.
   *
   * The node is named after the path's base name. A `modifiedAt` later than `at` marks the file
   * as edited after it was created.
   *
   * @param {string} path - Absolute file path.
   * @param {string} content - Text content.
   * @param {number} at - Creation timestamp.
   * @param {number} [modifiedAt=at] - Modification timestamp; equal to `at` for an unedited file.
   * @param {FSNode['meta']} [meta] - Optional node metadata (desktop cell, trash origin…).
   * @returns {FSNode} The file node.
   *
   * @example
   * f(`${PATHS.desktop}/Read Me.md`, 'new', 3 * H);
   */
  const f = (path: string, content: string, at: number, modifiedAt = at, meta?: FSNode['meta']): FSNode => ({ path, name: basename(path), type: 'file', content, createdAt: at, modifiedAt, meta });
  /**
   * Builds a directory node for seed-merge fixtures.
   *
   * The node is named after the path's base name (`/` for the root) and uses `at` for both
   * creation and modification.
   *
   * @param {string} path - Absolute directory path.
   * @param {number} at - Creation and modification timestamp.
   * @returns {FSNode} The directory node.
   *
   * @example
   * d(PATHS.trash, 6 * H);
   */
  const d = (path: string, at: number): FSNode => ({ path, name: path === '/' ? '/' : basename(path), type: 'dir', createdAt: at, modifiedAt: at });

  it('keeps visitor files and edits, updates untouched seeded files, drops stale ones', () => {
    const now = 1_790_000_000_123;
    const current = {
      '/': d('/', 0),
      [HOME]: d(HOME, H),
      [PATHS.desktop]: d(PATHS.desktop, 2 * H),
      [`${PATHS.desktop}/Read Me.md`]: f(`${PATHS.desktop}/Read Me.md`, 'old', 3 * H, 3 * H, { x: 5, y: 1 }),
      [`${PATHS.desktop}/Edited.md`]: f(`${PATHS.desktop}/Edited.md`, 'mine', 4 * H, now),
      [`${PATHS.desktop}/Gone.md`]: f(`${PATHS.desktop}/Gone.md`, 'old', 5 * H),
      [`${PATHS.desktop}/mine.txt`]: f(`${PATHS.desktop}/mine.txt`, 'x', now),
      [PATHS.trash]: d(PATHS.trash, 6 * H),
      [`${PATHS.trash}/Resume.md`]: f(`${PATHS.trash}/Resume.md`, 'r', 7 * H, now, { trashedFrom: `${PATHS.desktop}/Resume.md` }),
    };
    const seedNodes = {
      '/': d('/', 0),
      [HOME]: d(HOME, H),
      [PATHS.desktop]: d(PATHS.desktop, 2 * H),
      [`${PATHS.desktop}/Read Me.md`]: f(`${PATHS.desktop}/Read Me.md`, 'new', 3 * H, 3 * H, { x: 0, y: 0 }),
      [`${PATHS.desktop}/Edited.md`]: f(`${PATHS.desktop}/Edited.md`, 'seed', 4 * H),
      [`${PATHS.desktop}/Resume.md`]: f(`${PATHS.desktop}/Resume.md`, 'r', 7 * H),
      [`${PATHS.desktop}/New.md`]: f(`${PATHS.desktop}/New.md`, 'n', 8 * H),
      [PATHS.trash]: d(PATHS.trash, 6 * H),
    };
    const next = mergeSeed(current, seedNodes);
    expect(next[`${PATHS.desktop}/mine.txt`].content).toBe('x');
    expect(next[`${PATHS.desktop}/Edited.md`].content).toBe('mine');
    expect(next[`${PATHS.desktop}/Read Me.md`].content).toBe('new');
    expect(next[`${PATHS.desktop}/Read Me.md`].meta).toMatchObject({ x: 5, y: 1 });
    expect(next[`${PATHS.desktop}/Gone.md`]).toBeUndefined();
    expect(next[`${PATHS.desktop}/New.md`]).toBeDefined();
    // Trashed seeded items stay in the Trash and are not resurrected.
    expect(next[`${PATHS.trash}/Resume.md`]).toBeDefined();
    expect(next[`${PATHS.desktop}/Resume.md`]).toBeUndefined();
  });
});

describe('wm', () => {
  /**
   * Placeholder app icon and window component that renders nothing.
   *
   * Used for every test app registration, since the window manager tests only inspect store
   * state and never render app content.
   *
   * @returns {null} Nothing is rendered.
   *
   * @example
   * registerApps([{ id: 'calc', name: 'Calc', icon: Dummy, component: Dummy }]);
   */
  const Dummy = () => null;
  registerApps([
    { id: 'finder', name: 'Finder', icon: Dummy, component: Dummy, persistent: true, opens: ['dir'] },
    { id: 'textedit', name: 'TextEdit', icon: Dummy, component: Dummy, opens: ['txt'] },
    { id: 'calc', name: 'Calc', icon: Dummy, component: Dummy, singleWindow: true },
    { id: 'notes', name: { en: 'Notes', ko: '메모' }, icon: Dummy, component: Dummy },
    { id: 'fixed', name: 'Fixed', icon: Dummy, component: Dummy, window: { width: 320, height: 600, resizable: false, maximizable: false } },
  ]);
  /**
   * Looks up a window's current state in the window manager store.
   *
   * Reads the store on every call, so it reflects changes made since the window was opened.
   *
   * @param {string} id - Window id.
   * @returns {WindowState} The window (asserted to exist).
   *
   * @example
   * expect(win(a).maximized).toBe(true);
   */
  const win = (id: string) => useWM.getState().windows.find((w) => w.id === id)!;
  /**
   * Simulates a browser viewport size.
   *
   * Redefines `window.innerWidth` and `window.innerHeight`, which the window manager reads to
   * compute the workspace.
   *
   * @param {number} width - Viewport width in pixels.
   * @param {number} height - Viewport height in pixels.
   * @returns {void}
   *
   * @example
   * setViewport(390, 844);
   */
  const setViewport = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  };
  afterEach(() => setViewport(1024, 768));

  beforeEach(() => {
    seed();
    wm.killAll();
    wm.startSession();
  });

  it('opens, focuses and closes windows with macOS semantics', async () => {
    const a = wm.openWindow('textedit')!;
    const b = wm.openWindow('textedit')!;
    expect(useWM.getState().focusedId).toBe(b);
    expect(useWM.getState().processes.filter((p) => p.appId === 'textedit')).toHaveLength(1);
    wm.focus(a);
    expect(useWM.getState().focusedId).toBe(a);
    await wm.close(a);
    expect(useWM.getState().focusedId).toBe(b);
    await wm.close(b);
    expect(useWM.getState().activeAppId).toBe('textedit');
    expect(useWM.getState().focusedId).toBeNull();
    expect(wm.runningApps()).toContain('textedit');
  });

  it('launch reuses windows and restores minimized ones', () => {
    const a = wm.launch('textedit')!;
    expect(wm.launch('textedit')).toBe(a);
    wm.minimize(a);
    expect(useWM.getState().windows.find((w) => w.id === a)?.minimized).toBe(true);
    expect(wm.launch('textedit')).toBe(a);
    expect(useWM.getState().windows.find((w) => w.id === a)?.minimized).toBe(false);
  });

  it('singleWindow apps receive new args instead of new windows', () => {
    const a = wm.openWindow('calc')!;
    const b = wm.openWindow('calc', { path: '/x' })!;
    expect(b).toBe(a);
    const w = useWM.getState().windows.find((x) => x.id === a)!;
    expect(w.args.path).toBe('/x');
    expect(w.argsVersion).toBe(1);
  });

  it('respects before-close vetoes and quit', async () => {
    const { setBeforeClose } = await import('./wm');
    const a = wm.openWindow('textedit')!;
    setBeforeClose(a, () => false);
    expect(await wm.close(a)).toBe(false);
    expect(await wm.quit('textedit')).toBe(false);
    expect(await wm.quit('textedit', { force: true })).toBe(true);
    expect(wm.runningApps()).not.toContain('textedit');
  });

  it('persistent apps cannot be quit', async () => {
    wm.openWindow('finder');
    await wm.quit('finder');
    expect(wm.runningApps()).toContain('finder');
    expect(useWM.getState().windows).toHaveLength(0);
  });

  it('opens files with the default handler', () => {
    fs.writeFile(`${PATHS.documents}/a.txt`, 'x');
    const id = wm.openPath(`${PATHS.documents}/a.txt`)!;
    expect(useWM.getState().windows.find((w) => w.id === id)?.appId).toBe('textedit');
  });

  it('tiles and maximizes, then restores', () => {
    const a = wm.openWindow('textedit')!;
    const before = { ...useWM.getState().windows.find((w) => w.id === a)! };
    wm.tile(a, 'left');
    expect(useWM.getState().windows.find((w) => w.id === a)?.tiled).toBe('left');
    wm.toggleMaximize(a);
    const after = useWM.getState().windows.find((w) => w.id === a)!;
    expect(after.tiled).toBeNull();
    expect(after.width).toBe(before.width);
    expect(after.x).toBe(before.x);
  });

  it('default titles follow the UI language; custom titles do not', () => {
    useSystem.getState().updateSettings({ locale: 'en' });
    const a = wm.openWindow('notes')!;
    const b = wm.openWindow('notes')!;
    wm.setTitle(b, 'Groceries');
    useSystem.getState().updateSettings({ locale: 'ko' });
    expect(win(a).title).toBe('메모');
    expect(win(b).title).toBe('Groceries');
    useSystem.getState().updateSettings({ locale: 'en' });
    expect(win(a).title).toBe('Notes');
  });

  it('short viewports are compact; fixed-size windows too big for the screen fill it and float again later', () => {
    setViewport(1280, 400);
    const a = wm.openWindow('fixed')!;
    expect(win(a).maximized).toBe(true);
    setViewport(1280, 900);
    wm.relayout();
    expect(win(a)).toMatchObject({ maximized: false, width: 320, height: 600 });
  });

  it('windows opened on a phone stop filling the screen once it gets bigger', () => {
    setViewport(390, 844);
    const a = wm.openWindow('fixed')!;
    expect(win(a).maximized).toBe(true);
    setViewport(1280, 900);
    wm.relayout();
    expect(win(a).maximized).toBe(false);
    expect(win(a).width).toBe(320);
  });

  it('relayout shrinks windows that no longer fit', () => {
    setViewport(1024, 768);
    const a = wm.openWindow('textedit', {}, { width: 1004, height: 646 })!;
    wm.update(a, { x: 10, y: 34 });
    setViewport(800, 1024);
    wm.relayout();
    const w = win(a);
    expect(w.x + w.width).toBeLessThanOrEqual(800);
    expect(w.x).toBeGreaterThanOrEqual(0);
  });
});

describe('shortcuts', () => {
  it('canonicalizes', () => {
    expect(canonicalShortcut('shift+mod+S')).toBe('mod+shift+s');
    // jsdom is not a Mac host: there Ctrl is "mod".
    expect(canonicalShortcut('alt+ctrl+left')).toBe('mod+alt+left');
  });
  it('maps keyboard events', () => {
    const e = new KeyboardEvent('keydown', { key: 'Ω', code: 'KeyW', altKey: true });
    expect(eventToShortcut(e)).toBe('alt+w');
  });
  it('AltGr characters are typed, not shortcuts (non-Mac hosts)', () => {
    expect(eventToShortcut(new KeyboardEvent('keydown', { key: 'ś', code: 'KeyS', ctrlKey: true, altKey: true }))).toBe('');
    expect(eventToShortcut(new KeyboardEvent('keydown', { key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }))).toBe('');
    expect(eventToShortcut(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, altKey: true }))).toBe('mod+alt+s');
  });
});

describe('keyboardBusy', () => {
  it('reports shell overlays, and only counts sheets of the given window', () => {
    expect(keyboardBusy('w1')).toBe(false);
    useUI.getState().set({ missionControl: true });
    expect(keyboardBusy('w1')).toBe(true);
    useUI.getState().closeOverlays();
    useDialogs.setState({ queue: [{ id: 'd', kind: 'alert', windowId: 'w2', title: 'x', buttons: [], resolve: () => {} }] });
    expect(keyboardBusy('w1')).toBe(false);
    expect(keyboardBusy('w2')).toBe(true);
    expect(keyboardBusy()).toBe(true);
    useDialogs.setState({ queue: [] });
  });
});

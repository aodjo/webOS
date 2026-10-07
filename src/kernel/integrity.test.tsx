/**
 * Cross-app file-system integrity tests: protected locations, copies, desktop cells, documents
 * following renames, Notes pins vs Finder tags, and host imports.
 */
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS, WindowContext, fs, sortNodes, useMenus, useWM, importHostFiles, isTextFile, type AppProps, type FSNode, type MenuItem, type WindowState } from '@/kernel';
import { layoutIcons, gridMetrics } from '@/shell/desktop/desktopGrid';
import TextEdit from '@/apps/textedit/index';
import Preview from '@/apps/preview/index';
import Notes from '@/apps/notes/index';
import { ops } from '@/apps/finder/ops';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  /**
   * No-op `ResizeObserver` stand-in for jsdom, which does not provide one.
   *
   * Installed on `globalThis` only when no `ResizeObserver` exists. Its methods do nothing, so
   * components that observe their size mount without ever receiving resize callbacks.
   *
   * @example
   * new RO().observe();
   */
  class RO {
    /**
     * Accepts an element to observe and does nothing.
     *
     * No resize callback is ever scheduled for the element.
     *
     * @returns {void}
     *
     * @example
     * new RO().observe();
     */
    observe() {}
    /**
     * Accepts an element to stop observing and does nothing.
     *
     * Nothing is tracked, so there is nothing to remove.
     *
     * @returns {void}
     *
     * @example
     * new RO().unobserve();
     */
    unobserve() {}
    /**
     * Stops observing all elements, which is a no-op.
     *
     * Nothing is tracked, so there is nothing to release.
     *
     * @returns {void}
     *
     * @example
     * new RO().disconnect();
     */
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
  /**
   * No-op `scrollIntoView` for jsdom, which does not implement scrolling.
   *
   * Installed on `Element.prototype` only when the method is missing.
   *
   * @returns {void}
   *
   * @example
   * document.body.scrollIntoView();
   */
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

/**
 * Builds a directory node fixture.
 *
 * The node is named after the last path segment (`/` for the root) and uses timestamp 1 for
 * both creation and modification.
 *
 * @param {string} path - Absolute directory path.
 * @param {FSNode['meta']} [meta] - Optional metadata, such as `{ locked: true }`.
 * @returns {FSNode} The directory node.
 *
 * @example
 * dir('/System', { locked: true });
 */
const dir = (path: string, meta?: FSNode['meta']): FSNode => ({ path, name: path.split('/').pop() || '/', type: 'dir', createdAt: 1, modifiedAt: 1, meta });
let tick = 100; /** Fixture timestamp counter; `file` increments it so every fixture file is newer than the previous one. */
/**
 * Builds a text file node fixture.
 *
 * Each call uses a new, increasing timestamp for both creation and modification.
 *
 * @param {string} path - Absolute file path.
 * @param {string} content - Text content.
 * @param {FSNode['meta']} [meta] - Optional metadata, such as a desktop cell `{ x, y }`.
 * @returns {FSNode} The file node.
 *
 * @example
 * file(`${PATHS.desktop}/a.md`, 'a', { x: 2, y: 3 });
 */
const file = (path: string, content: string, meta?: FSNode['meta']): FSNode => ({ path, name: path.split('/').pop()!, type: 'file', content, createdAt: ++tick, modifiedAt: tick, meta });

/**
 * Replaces the whole file system with a minimal user tree plus extra nodes.
 *
 * Creates the root, home and standard user folders, plus locked `/Applications`, `/System`
 * and `/System/Library` folders, then adds `extra` and loads everything with
 * `fs.replaceAll`.
 *
 * @param {FSNode[]} [extra=[]] - Additional nodes to include.
 * @returns {void}
 *
 * @example
 * seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n')]);
 */
function seed(extra: FSNode[] = []) {
  const nodes: Record<string, FSNode> = {};
  for (const p of ['/', '/Users', PATHS.home, PATHS.desktop, PATHS.documents, PATHS.notes, PATHS.trash, PATHS.pictures, PATHS.downloads]) nodes[p] = dir(p);
  nodes['/Applications'] = dir('/Applications', { locked: true });
  nodes['/System'] = dir('/System', { locked: true });
  nodes['/System/Library'] = dir('/System/Library', { locked: true });
  for (const n of extra) nodes[n.path] = n;
  fs.replaceAll(nodes, 'test');
}

const roots: { root: Root; host: HTMLDivElement }[] = []; /** React roots mounted by `mount`, unmounted after each test. */
/**
 * Mounts an app component in a fake focused window.
 *
 * Adds a matching window to the window manager store (focused, with its app active), renders
 * the app inside a `WindowContext` provider in a new host element attached to the document,
 * and records the root for cleanup.
 *
 * @param {ComponentType<AppProps>} App - The app's window component.
 * @param {string} appId - App id of the window.
 * @param {string} id - Window id.
 * @param {AppProps['args']} [args={}] - Launch args, such as `{ path }`.
 * @returns {HTMLDivElement} The host element the app was rendered into.
 *
 * @example
 * const host = mount(Notes, 'notes', 'nt');
 */
function mount(App: ComponentType<AppProps>, appId: string, id: string, args: AppProps['args'] = {}) {
  const win = { id, pid: 1, appId, title: appId, args, argsVersion: 0, dirty: false, minimized: false } as unknown as WindowState;
  useWM.setState((s) => ({ windows: [...s.windows, win], focusedId: id, activeAppId: appId }));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <WindowContext.Provider value={{ id, pid: 1, appId }}>
        <App windowId={id} pid={1} args={args} />
      </WindowContext.Provider>,
    );
  });
  roots.push({ root, host });
  return host;
}
/**
 * Looks up a window's current state in the window manager store.
 *
 * Reads the store on every call, so it reflects title and args changes made by the apps.
 *
 * @param {string} id - Window id.
 * @returns {WindowState} The window (asserted to exist).
 *
 * @example
 * expect(win('te').title).toBe('Plans.md');
 */
const win = (id: string) => useWM.getState().windows.find((w) => w.id === id)!;

/**
 * Finds a menu item that a window registered, by its English label.
 *
 * Searches every menu of the window, including submenus, depth-first.
 *
 * @param {string} windowId - Window whose menus are searched.
 * @param {string} label - English label of the item.
 * @returns {MenuItem} The first matching item.
 * @throws {Error} When no item with that label exists.
 *
 * @example
 * menuItem('nt', 'Pin Note').action!();
 */
function menuItem(windowId: string, label: string): MenuItem {
  /**
   * Recursively searches a list of menu items for the label.
   *
   * Compares each item's plain-string label or its English text, and descends into an item's
   * submenu before moving on to the next sibling.
   *
   * @param {MenuItem[]} items - Items to search, including their submenus.
   * @returns {MenuItem | undefined} The matching item, or `undefined` when none matches.
   *
   * @example
   * const hit = visit(menu.items);
   */
  const visit = (items: MenuItem[]): MenuItem | undefined => {
    for (const it of items) {
      const l = typeof it.label === 'string' ? it.label : it.label?.en;
      if (l === label) return it;
      const sub = it.submenu && visit(it.submenu);
      if (sub) return sub;
    }
  };
  for (const m of useMenus.getState().byWindow[windowId] ?? []) {
    const hit = visit(m.items);
    if (hit) return hit;
  }
  throw new Error(`menu item not found: ${label}`);
}

/**
 * Simulates typing a new value into a textarea.
 *
 * Sets the value through the native `HTMLTextAreaElement` setter, bypassing React's value
 * tracking, and dispatches a bubbling `input` event so React's `onChange` handler runs.
 *
 * @param {HTMLTextAreaElement} el - The textarea to change.
 * @param {string} value - The new value.
 * @returns {void}
 *
 * @example
 * typeInto(titleField, 'Plans');
 */
function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  useMenus.setState({ byWindow: {}, byApp: {} });
  useWM.setState({ windows: [], focusedId: null });
});
afterEach(() => {
  for (const r of roots.splice(0)) {
    act(() => r.root.unmount());
    r.host.remove();
  }
  vi.useRealTimers();
});

describe('protected locations', () => {
  it('refuses to create items outside the user-writable folders', () => {
    seed([file(`${PATHS.documents}/a.txt`, 'x')]);
    expect(() => fs.writeFile('/Applications/notes.txt', 'mine')).toThrow(/not permitted/);
    expect(() => fs.mkdir('/System/Library/Junk')).toThrow(/not permitted/);
    expect(() => fs.copy(`${PATHS.documents}/a.txt`, '/System/Library/a.txt')).toThrow(/not permitted/);
    expect(() => fs.move(`${PATHS.documents}/a.txt`, '/Applications/a.txt')).toThrow(/not permitted/);
    expect(() => fs.writeFile('/root.txt', 'x')).toThrow(/not permitted/);
    expect(fs.isWritableDir(PATHS.documents)).toBe(true);
  });

  it('copies of a locked system folder are fully editable', () => {
    seed([dir('/System/Library/Desktop Pictures', { locked: true }), { ...file('/System/Library/Desktop Pictures/A.svg', '', { locked: true }), content: undefined, src: '/a.svg' }]);
    const out = fs.duplicate('/System/Library/Desktop Pictures', PATHS.documents);
    expect(fs.isProtected(out)).toBe(false);
    expect(fs.isProtected(`${out}/A.svg`)).toBe(false);
    expect(() => fs.trash(`${out}/A.svg`)).not.toThrow();
  });
});

describe('desktop positions', () => {
  it('a duplicate gets its own free cell instead of stealing the original one', () => {
    seed([file(`${PATHS.desktop}/Resume.md`, 'r', { x: 0, y: 1 }), file(`${PATHS.desktop}/Read Me.md`, 'm', { x: 0, y: 0 })]);
    const copy = fs.duplicate(`${PATHS.desktop}/Resume.md`);
    expect(fs.stat(copy)?.meta?.x).toBeUndefined();
    const items = sortNodes(fs.readdir(PATHS.desktop), 'name').map((n) => ({ path: n.path, x: n.meta?.x, y: n.meta?.y }));
    const layout = layoutIcons(items, gridMetrics({ x: 0, y: 26, width: 1440, height: 800 }));
    expect(layout.get(`${PATHS.desktop}/Resume.md`)).toEqual({ col: 0, row: 1 });
    expect(layout.get(copy)).not.toEqual({ col: 0, row: 1 });
  });

  it('moving an item to another folder drops its desktop cell; renaming keeps it', () => {
    seed([file(`${PATHS.desktop}/a.md`, 'a', { x: 2, y: 3 })]);
    fs.rename(`${PATHS.desktop}/a.md`, 'b.md');
    expect(fs.stat(`${PATHS.desktop}/b.md`)?.meta).toMatchObject({ x: 2, y: 3 });
    fs.move(`${PATHS.desktop}/b.md`, `${PATHS.documents}/b.md`);
    expect(fs.stat(`${PATHS.documents}/b.md`)?.meta?.x).toBeUndefined();
  });
});

describe('file tracking across apps', () => {
  it('TextEdit follows a note that Notes renames after its new title (write + rename in one tick)', () => {
    vi.useFakeTimers();
    const note = `${PATHS.notes}/Ideas.md`;
    seed([file(note, '# Ideas\n\nbody\n')]);
    mount(TextEdit, 'textedit', 'te', { path: note });
    expect(win('te').title).toBe('Ideas.md');
    mount(Notes, 'notes', 'nt');
    const host = roots[1].host;
    const [title] = host.querySelectorAll<HTMLTextAreaElement>('main textarea');
    typeInto(title, 'Plans');
    act(() => void vi.advanceTimersByTime(600));
    expect(fs.exists(`${PATHS.notes}/Plans.md`)).toBe(true);
    expect(win('te').title).toBe('Plans.md');
    expect(win('te').args.path).toBe(`${PATHS.notes}/Plans.md`);
  });

  it('Preview follows the same rename', () => {
    const note = `${PATHS.notes}/Ideas.md`;
    seed([file(note, '# Ideas\n\nbody\n')]);
    mount(Preview, 'preview', 'pv', { path: note });
    act(() => {
      fs.writeFile(note, '# Plans\n\nbody\n');
      fs.rename(note, 'Plans.md');
    });
    expect(win('pv').args.path).toBe(`${PATHS.notes}/Plans.md`);
  });

  it('a Finder color tag does not unpin a pinned note', () => {
    const note = `${PATHS.notes}/Ideas.md`;
    seed([file(note, '# Ideas\n')]);
    const host = mount(Notes, 'notes', 'nt');
    act(() => void menuItem('nt', 'Pin Note').action!());
    expect(host.textContent).toContain('Pinned');
    act(() => ops.setTag([note], 'red'));
    expect(host.textContent).toContain('Pinned');
  });
});

describe('host import', () => {
  it('imports source files as text whatever MIME type the browser reports', async () => {
    seed();
    const files = [new File(['const x = 1;\n'], 'main.ts', { type: 'video/mp2t' }), new File(['echo hi\n'], 'run.sh', { type: 'application/x-sh' }), new File(['a: 1\n'], 'c.yaml', { type: 'application/x-yaml' })];
    const { created } = await importHostFiles(files, PATHS.documents);
    expect(created).toHaveLength(3);
    for (const p of created) {
      const n = fs.stat(p)!;
      expect(n.src).toBeUndefined();
      expect(isTextFile(n)).toBe(true);
    }
  });
});

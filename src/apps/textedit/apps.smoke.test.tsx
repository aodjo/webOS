/**
 * Smoke tests: mount TextEdit, Preview and Notes against a small virtual FS and drive them the
 * way a user would (typing, menu commands, files changing underneath).
 */
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS, WindowContext, fs, useMenus, useWM, type AppProps, type FSNode, type MenuItem, type WindowState } from '@/kernel';
import TextEdit from './index';
import Preview from '../preview/index';
import Notes from '../notes/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Tells React that updates are wrapped in act(), so it flushes them synchronously without warnings. */

beforeAll(() => {
  class RO {
    /**
     * Ignore a request to observe an element.
     *
     * jsdom has no layout, so no resize callbacks are ever delivered.
     *
     * @returns {void}
     *
     * @example
     * new RO().observe();
     */
    observe() {}
    /**
     * Ignore a request to stop observing an element.
     *
     * Nothing is tracked by the stub, so there is nothing to remove.
     *
     * @returns {void}
     *
     * @example
     * new RO().unobserve();
     */
    unobserve() {}
    /**
     * Ignore a request to stop observing all elements.
     *
     * Lets components call `disconnect()` on unmount without errors.
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
   * No-op stand-in for `Element.scrollIntoView`.
   *
   * jsdom does not implement scrolling, so the stub is installed only when the method is missing
   * and lets list components scroll their selection into view without throwing.
   *
   * @returns {void}
   *
   * @example
   * el.scrollIntoView();
   */
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

/**
 * Build a directory node for the test file system.
 *
 * The name is the last path component ("/" for the root); timestamps are fixed at 1.
 *
 * @param {string} path - Absolute path of the directory.
 * @returns {FSNode} The directory node.
 *
 * @example
 * dir(PATHS.notes);
 */
const dir = (path: string): FSNode => ({ path, name: path.split('/').pop() || '/', type: 'dir', createdAt: 1, modifiedAt: 1 });
let tick = 100; /** Counter that gives every file built by `file()` a later timestamp than the previous one. */
/**
 * Build a text file node for the test file system.
 *
 * Each call increments `tick` and uses it as the creation and modification time, so files built
 * later are newer.
 *
 * @param {string} path - Absolute path of the file.
 * @param {string} content - Text content.
 * @returns {FSNode} The file node.
 *
 * @example
 * file(`${PATHS.documents}/a.txt`, 'hello');
 */
const file = (path: string, content: string): FSNode => ({ path, name: path.split('/').pop()!, type: 'file', content, createdAt: ++tick, modifiedAt: tick });

/**
 * Replace the virtual file system with the standard folders plus extra nodes.
 *
 * Creates /, /Users, home, Documents, Notes, Trash, Pictures and Downloads, adds `extra` on top,
 * and installs the map with `fs.replaceAll`.
 *
 * @param {FSNode[]} [extra=[]] - Additional nodes (files or folders) to include.
 * @returns {void}
 *
 * @example
 * seed([file(`${PATHS.documents}/a.txt`, 'hello')]);
 */
function seed(extra: FSNode[] = []) {
  const nodes: Record<string, FSNode> = {};
  for (const p of ['/', '/Users', PATHS.home, PATHS.documents, PATHS.notes, PATHS.trash, PATHS.pictures, PATHS.downloads]) nodes[p] = dir(p);
  for (const n of extra) nodes[n.path] = n;
  fs.replaceAll(nodes, 'test');
}

let root: Root | null = null; /** React root of the currently mounted app, unmounted after each test. */
let host: HTMLDivElement; /** DOM container the current app is rendered into. */

/**
 * Render an app as the single focused window "w1".
 *
 * Puts a matching window into the window-manager store (focused, active app), creates a fresh
 * host element in the document, and renders the app inside a `WindowContext` provider within
 * act(), so effects and menu registration have run when it returns.
 *
 * @param {ComponentType<AppProps>} App - App window component to render.
 * @param {string} appId - App id for the window and context.
 * @param {AppProps['args']} [args={}] - Window arguments, e.g. `{ path }`.
 * @returns {void}
 *
 * @example
 * mount(TextEdit, 'textedit', { path: `${PATHS.documents}/a.txt` });
 */
function mount(App: ComponentType<AppProps>, appId: string, args: AppProps['args'] = {}) {
  const win = { id: 'w1', pid: 1, appId, title: appId, args, argsVersion: 0, dirty: false, minimized: false } as unknown as WindowState;
  useWM.setState({ windows: [win], focusedId: 'w1', activeAppId: appId });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <WindowContext.Provider value={{ id: 'w1', pid: 1, appId }}>
        <App windowId="w1" pid={1} args={args} />
      </WindowContext.Provider>,
    );
  });
}

/**
 * Current state of the test window "w1".
 *
 * Reads the window-manager store on every call, so it reflects title, dirty flag and args
 * changes made by the mounted app.
 *
 * @returns {WindowState} The window as stored in the window manager.
 *
 * @example
 * expect(win().dirty).toBe(true);
 */
const win = () => useWM.getState().windows.find((w) => w.id === 'w1')!;

/**
 * Find a menu item of window "w1" by its English label.
 *
 * Searches every menu registered for the window, including submenus, depth-first.
 *
 * @param {string} label - English label of the item, e.g. "Save…".
 * @returns {MenuItem} The first matching item.
 * @throws {Error} When no item has that label.
 *
 * @example
 * act(() => menuItem('New Note').action!());
 */
function menuItem(label: string): MenuItem {
  /**
   * Depth-first search of a menu item list.
   *
   * Compares each item's label (a plain string or the `en` text of a localized label) with
   * `label`, descending into submenus before moving on to the next sibling.
   *
   * @param {MenuItem[]} items - Items to search, including their submenus.
   * @returns {MenuItem | undefined} The first item whose English label matches, if any.
   *
   * @example
   * visit(menu.items);
   */
  const visit = (items: MenuItem[]): MenuItem | undefined => {
    for (const it of items) {
      const l = typeof it.label === 'string' ? it.label : it.label?.en;
      if (l === label) return it;
      const sub = it.submenu && visit(it.submenu);
      if (sub) return sub;
    }
  };
  for (const m of useMenus.getState().byWindow.w1 ?? []) {
    const hit = visit(m.items);
    if (hit) return hit;
  }
  throw new Error(`menu item not found: ${label}`);
}

/**
 * Type into a controlled textarea the way the browser does.
 *
 * Sets the value through the native `HTMLTextAreaElement` setter (bypassing React's value
 * tracking) and dispatches a bubbling input event inside act(), so React's onChange fires.
 *
 * @param {HTMLTextAreaElement} el - The textarea to type into.
 * @param {string} value - The complete new value.
 * @returns {void}
 *
 * @example
 * typeInto(host.querySelector('textarea')!, 'hello world');
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
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

describe('TextEdit', () => {
  const path = `${PATHS.documents}/a.txt`;

  it('opens, edits, saves and tracks the file', () => {
    seed([file(path, 'hello')]);
    mount(TextEdit, 'textedit', { path });
    const ta = host.querySelector('textarea')!;
    expect(ta.value).toBe('hello');
    expect(win().title).toBe('a.txt');

    typeInto(ta, 'hello world');
    // The window frame renders " — Edited" (and the close-button dot) for dirty windows.
    expect(win().title).toBe('a.txt');
    expect(win().dirty).toBe(true);

    act(() => void menuItem('Save…').action!());
    expect(fs.readFile(path)).toBe('hello world');
    expect(win().dirty).toBe(false);

    // Changed by another app while clean → reloads silently.
    act(() => void fs.writeFile(path, 'from terminal'));
    expect(ta.value).toBe('from terminal');

    // Changed while dirty → banner, Revert loads the disk version.
    typeInto(ta, 'mine');
    act(() => void fs.writeFile(path, 'theirs'));
    expect(host.textContent).toContain('The file has been changed by another application.');
    const revert = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Revert')!;
    act(() => revert.click());
    expect(ta.value).toBe('theirs');

    act(() => void fs.rename(path, 'b.txt'));
    expect(win().title).toBe('b.txt');
    expect(win().args.path).toBe(`${PATHS.documents}/b.txt`);

    act(() => void fs.trash(`${PATHS.documents}/b.txt`));
    expect(win().title).toBe('b.txt (Deleted)');
  });

  it('finds and replaces', () => {
    seed([file(path, 'cat Cat cat')]);
    mount(TextEdit, 'textedit', { path });
    act(() => menuItem('Find and Replace…').action!());
    const [find, replace] = [...host.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])')];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(find, 'cat');
      find.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('1 of 3');
    expect(host.querySelectorAll('mark')).toHaveLength(3);
    act(() => {
      setter.call(replace, 'dog');
      replace.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const all = [...host.querySelectorAll('button')].find((b) => b.textContent === 'All')!;
    act(() => all.click());
    expect(host.querySelector('textarea')!.value).toBe('dog dog dog');
  });

  it('starts as Untitled', () => {
    seed();
    mount(TextEdit, 'textedit');
    expect(win().title).toBe('Untitled');
    typeInto(host.querySelector('textarea')!, 'x');
    expect(win().title).toBe('Untitled');
    expect(win().dirty).toBe(true);
  });
});

describe('Preview', () => {
  it('renders markdown and live-updates', () => {
    const path = `${PATHS.documents}/Read Me.md`;
    seed([file(path, '# Hello\n\n<script>x</script>')]);
    mount(Preview, 'preview', { path });
    expect(host.querySelector('h1')?.textContent).toBe('Hello');
    expect(host.querySelector('script')).toBeNull();
    act(() => void fs.writeFile(path, '# Changed'));
    expect(host.querySelector('h1')?.textContent).toBe('Changed');
    expect(win().title).toBe('Read Me.md');
  });

  it('shows images with a sidebar of siblings', () => {
    seed([
      { ...file(`${PATHS.pictures}/a.svg`, ''), src: '/a.svg', content: undefined },
      { ...file(`${PATHS.pictures}/b.svg`, ''), src: '/b.svg', content: undefined },
    ]);
    mount(Preview, 'preview', { path: `${PATHS.pictures}/a.svg` });
    expect(host.querySelectorAll('nav button')).toHaveLength(2);
    act(() => menuItem('Next').action!());
    expect(win().title).toBe('b.svg');
  });

  it('has an empty state without a file', () => {
    seed();
    mount(Preview, 'preview');
    expect(host.textContent).toContain('No document open');
  });
});

describe('Notes', () => {
  it('lists, creates, autosaves, renames and deletes notes', () => {
    vi.useFakeTimers();
    seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n\n- one\n')]);
    mount(Notes, 'notes');
    expect(host.textContent).toContain('Ideas');
    expect(host.textContent).toContain('one');

    act(() => menuItem('New Note').action!());
    expect(fs.exists(`${PATHS.notes}/New Note.md`)).toBe(true);
    const [title, body] = host.querySelectorAll<HTMLTextAreaElement>('main textarea');
    typeInto(title, 'Groceries');
    typeInto(body, '- milk');
    act(() => void vi.advanceTimersByTime(600));
    expect(fs.exists(`${PATHS.notes}/New Note.md`)).toBe(false);
    expect(fs.readFile(`${PATHS.notes}/Groceries.md`)).toBe('# Groceries\n\n- milk');
    // Still the same editor (no remount after the rename).
    expect(host.querySelector('main textarea')).toBe(title);

    act(() => void menuItem('Pin Note').action!());
    expect(fs.stat(`${PATHS.notes}/Groceries.md`)?.meta?.pinned).toBe(true);
    expect(host.textContent).toContain('Pinned');

    act(() => void menuItem('Delete Note').action!());
    expect(fs.exists(`${PATHS.notes}/Groceries.md`)).toBe(false);
    expect(host.textContent).toContain('Recently Deleted');
  });

  it('drops an untouched new note when leaving it', () => {
    seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n')]);
    mount(Notes, 'notes');
    act(() => menuItem('New Note').action!());
    expect(fs.exists(`${PATHS.notes}/New Note.md`)).toBe(true);
    const row = [...host.querySelectorAll('[role="option"]')].find((r) => r.textContent?.includes('Ideas'))!;
    act(() => void row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(fs.exists(`${PATHS.notes}/New Note.md`)).toBe(false);
  });

  it('drops an untouched new note when a search moves the selection away', () => {
    seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n')]);
    mount(Notes, 'notes');
    act(() => menuItem('New Note').action!());
    expect(fs.exists(`${PATHS.notes}/New Note.md`)).toBe(true);
    const search = host.querySelector<HTMLInputElement>('.ui-search input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(search, 'ideas');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fs.exists(`${PATHS.notes}/New Note.md`)).toBe(false);
    expect(fs.exists(`${PATHS.notes}/Ideas.md`)).toBe(true);
  });

  it('keeps a new note typed into before a search moves the selection away', () => {
    seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n')]);
    mount(Notes, 'notes');
    act(() => menuItem('New Note').action!());
    const [title] = host.querySelectorAll<HTMLTextAreaElement>('main textarea');
    typeInto(title, 'Plans');
    const search = host.querySelector<HTMLInputElement>('.ui-search input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(search, 'ideas');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fs.readFile(`${PATHS.notes}/Plans.md`)).toBe('# Plans\n');
  });

  it('shows the default Notes folder with its own count', () => {
    seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n'), dir(`${PATHS.notes}/Work`), file(`${PATHS.notes}/Work/Plan.md`, '# Plan\n')]);
    mount(Notes, 'notes');
    const items = [...host.querySelectorAll('[role="treeitem"]')].map((b) => b.textContent);
    expect(items).toEqual(['All Notes2', 'Notes1', 'Work1']);
  });

  it('moves focus to the body synchronously on Return in the title', () => {
    seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n')]);
    mount(Notes, 'notes');
    act(() => menuItem('New Note').action!());
    const [title, body] = host.querySelectorAll<HTMLTextAreaElement>('main textarea');
    typeInto(title, 'Grocery list');
    title.focus();
    title.setSelectionRange(7, 7);
    act(() => void title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    // No animation frame has run: the very next keystroke must already go to the body.
    expect(document.activeElement).toBe(body);
    expect(title.value).toBe('Grocery');
    expect(body.value).toBe(' list');
    expect(body.selectionStart).toBe(0);

    // Backspace at the start of the body joins it back onto the title, also synchronously.
    act(() => void body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(title);
    expect(title.value).toBe('Grocery list');
    expect(title.selectionStart).toBe(7);
  });

  it('ignores the composing Return of a Korean IME in the search field', () => {
    seed([file(`${PATHS.notes}/Ideas.md`, '# 아이디어\n')]);
    mount(Notes, 'notes');
    const search = host.querySelector<HTMLInputElement>('.ui-search input')!;
    search.focus();
    act(() => void search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(search);
    act(() => void search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(document.activeElement?.getAttribute('role')).toBe('listbox');
  });

  it('reloads the open note when it changes elsewhere', () => {
    seed([file(`${PATHS.notes}/Ideas.md`, '# Ideas\n\nold')]);
    mount(Notes, 'notes');
    act(() => void fs.writeFile(`${PATHS.notes}/Ideas.md`, '# Ideas\n\nnew text'));
    const [, body] = host.querySelectorAll<HTMLTextAreaElement>('main textarea');
    expect(body.value).toBe('new text');
  });
});

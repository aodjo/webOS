/**
 * Render smoke test: mounts the Finder (every view mode, Quick Look, Get Info) in jsdom against a
 * small virtual FS and fails on thrown errors or React warnings.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FSNode } from '@/kernel';
import { HOME, PATHS, WindowContext, fs, registerApps, useDialogs, useMenus, useUI, useWM, wm } from '@/kernel';
import Finder from './index';
import { prefs, useFinderPrefs } from './prefs';
import { RECENTS } from './model';
import { useUndo } from './ops';

/**
 * Placeholder component used as an app icon and as the window component of non-Finder apps.
 *
 * Renders nothing, so stub apps can be registered and opened by the window manager without
 * loading their real implementations.
 *
 * @returns {null} Always null.
 *
 * @example
 * registerApps([{ id: 'textedit', name: 'TextEdit', icon: Stub, component: Stub }]);
 */
const Stub = () => null;

/**
 * Resets the virtual file system to a small fixture tree.
 *
 * Replaces every node with the root, the locked /Users and /Applications folders, the home
 * folder and its standard subfolders (including the Trash), then writes a locked TextEdit app
 * bundle through `fs.sudo`, a markdown and a plain-text document, a plain `Code` folder with one
 * source file and an SVG picture backed by a `src` URL. `Code` is an ordinary, unprotected
 * folder, so tests can rename and trash it.
 *
 * @returns {void} Nothing; the FS store is replaced in place.
 * @throws {FSError} If the file system rejects one of the fixture writes.
 *
 * @example
 * seed();
 * fs.exists(`${PATHS.documents}/notes.txt`); // true
 */
function seed() {
  const t = Date.now();
  /**
   * Builds a directory node for the fixture tree.
   *
   * Uses the last path segment as the name ('/' for the root) and stamps both timestamps with
   * the shared seed time.
   *
   * @param {string} path - Absolute path of the directory.
   * @param {FSNode['meta']} [meta] - Optional metadata, e.g. `{ locked: true }`.
   * @returns {FSNode} The directory node.
   *
   * @example
   * const users = d('/Users', { locked: true });
   * console.log(users.name); // 'Users'
   */
  const d = (path: string, meta?: FSNode['meta']): FSNode => ({ path, name: path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1), type: 'dir', createdAt: t, modifiedAt: t, meta });
  const nodes: Record<string, FSNode> = {};
  for (const n of [d('/'), d('/Users', { locked: true }), d('/Applications', { locked: true }), d(HOME), d(PATHS.desktop), d(PATHS.documents), d(PATHS.downloads), d(PATHS.pictures), d(PATHS.music), d(PATHS.trash)]) nodes[n.path] = n;
  fs.replaceAll(nodes, 'smoke');
  fs.sudo(() => fs.writeFile('/Applications/TextEdit.app', 'textedit', { meta: { locked: true } }));
  fs.writeFile(`${PATHS.documents}/Readme.md`, '# Hello\n\nSome *markdown*.');
  fs.writeFile(`${PATHS.documents}/notes.txt`, 'plain text');
  fs.mkdir(`${PATHS.documents}/Code`);
  fs.writeFile(`${PATHS.documents}/Code/app.ts`, 'export const x = 1;');
  fs.writeFile(`${PATHS.pictures}/pic.svg`, '', { src: '/x.svg', bytes: 100 });
}

let container: HTMLDivElement; /** Host element the Finder is rendered into; recreated before each test. */
let root: Root; /** React root mounted on `container`; recreated before each test. */
const errors: unknown[][] = []; /** Arguments of every console.error/warn call; must stay empty. */

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    /**
     * Starts observing an element; a no-op in this jsdom stub.
     *
     * jsdom has no ResizeObserver, so the stub accepts calls but never reports size changes.
     *
     * @returns {void} Nothing.
     *
     * @example
     * new ResizeObserver(() => {}).observe(el);
     */
    observe() {}
    /**
     * Stops observing an element; a no-op in this jsdom stub.
     *
     * Exists only so components can clean up their observers without errors.
     *
     * @returns {void} Nothing.
     *
     * @example
     * observer.unobserve(el);
     */
    unobserve() {}
    /**
     * Stops observing all elements; a no-op in this jsdom stub.
     *
     * Exists only so components can clean up their observers without errors.
     *
     * @returns {void} Nothing.
     *
     * @example
     * observer.disconnect();
     */
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.CSS ??= {} as typeof CSS;
  /**
   * Minimal `CSS.escape` polyfill for jsdom.
   *
   * Backslash-escapes double quotes and backslashes only, which is enough for the quoted
   * attribute selectors built from file paths.
   *
   * @param {string} s - Raw identifier or attribute value.
   * @returns {string} The escaped string.
   *
   * @example
   * CSS.escape('a"b'); // 'a\\"b'
   */
  CSS.escape ??= (s: string) => s.replace(/["\\]/g, '\\$&');
  /**
   * No-op `scrollIntoView` stub, since jsdom does not implement element scrolling.
   *
   * Lets components that scroll the selection into view run without throwing.
   *
   * @returns {void} Nothing.
   *
   * @example
   * row.scrollIntoView({ block: 'nearest' });
   */
  Element.prototype.scrollIntoView ??= function () {};
  /**
   * No-op `scrollTo` stub, since jsdom does not implement element scrolling.
   *
   * Lets components that scroll their containers run without throwing.
   *
   * @returns {void} Nothing.
   *
   * @example
   * list.scrollTo({ top: 0 });
   */
  Element.prototype.scrollTo ??= function () {};
  registerApps([
    { id: 'finder', name: 'Finder', icon: Stub, component: Finder, opens: ['dir'], persistent: true, window: { width: 920, height: 560, titlebar: 'overlay' } },
    { id: 'textedit', name: 'TextEdit', icon: Stub, component: Stub, opens: ['txt', 'md', 'ts'] },
    { id: 'preview', name: { en: 'Preview', ko: '미리보기' }, icon: Stub, component: Stub, opens: ['md', 'svg'] },
  ]);
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void errors.push(a));
});

afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  seed();
  useFinderPrefs.setState({ views: {}, sorts: {}, showSidebar: true, showPathBar: true, showStatusBar: true });
  errors.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useWM.setState({ windows: [], processes: [], focusedId: null });
});

/**
 * Opens a Finder window and renders its component into the test container.
 *
 * Opens the window through the window manager so it gets a real id and pid, then renders the
 * Finder inside a WindowContext provider. The rendered args are read from the WM store at render
 * time and fall back to the given args.
 *
 * @param {Record<string, unknown>} args - Window arguments, e.g. `{ path }`, `{ select }` or
 *   `{ view: 'info', path }`.
 * @returns {string} The id of the opened window.
 *
 * @example
 * const id = mount({ path: PATHS.documents });
 * useWM.getState().windows.find((w) => w.id === id)?.title; // 'Documents'
 */
function mount(args: Record<string, unknown>): string {
  const id = wm.openWindow('finder', args)!;
  const win = useWM.getState().windows.find((w) => w.id === id)!;
  /**
   * Builds the element tree for the mounted Finder window.
   *
   * Wraps the Finder in a WindowContext provider so the kernel window hooks resolve to this
   * window.
   *
   * @returns {ReactNode} The provider-wrapped Finder element.
   *
   * @example
   * act(() => root.render(tree()));
   */
  const tree = (): ReactNode => (
    <WindowContext.Provider value={{ id, pid: win.pid, appId: 'finder' }}>
      <Finder windowId={id} pid={win.pid} args={useWM.getState().windows.find((w) => w.id === id)?.args ?? args} />
    </WindowContext.Provider>
  );
  act(() => root.render(tree()));
  return id;
}

/**
 * Dispatches a bubbling click on an element inside `act()`.
 *
 * Does nothing when the element is missing, so a failed lookup shows up in the assertions that
 * follow instead of throwing here.
 *
 * @param {Element | null | undefined} el - Element to click.
 * @returns {void} Nothing.
 *
 * @example
 * click(container.querySelector('nav button'));
 */
const click = (el: Element | null | undefined) => act(() => void el?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('Finder renders', () => {
  it('shows a folder in every view mode and live-updates', () => {
    const id = mount({ path: PATHS.documents });
    expect(container.textContent).toContain('Readme.md');
    expect(container.textContent).toContain('Code');
    expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('Documents');

    for (const mode of ['list', 'columns', 'gallery', 'icons'] as const) {
      act(() => prefs.setView(PATHS.documents, mode));
      // Gallery thumbnails carry their names as labels only, so items are located by data-path.
      expect(container.querySelector(`[data-path="${PATHS.documents}/notes.txt"]`)).not.toBeNull();
    }

    act(() => void fs.writeFile(`${PATHS.documents}/new.txt`, 'hi'));
    expect(container.textContent).toContain('new.txt');
    expect(errors).toEqual([]);
  });

  it('opens Quick Look from the menu shortcut and follows arrow keys', () => {
    const id = mount({ path: PATHS.documents, select: [`${PATHS.documents}/Readme.md`] });
    act(() => prefs.setView(PATHS.documents, 'columns'));
    const items = useMenus.getState().byWindow[id].flatMap((m) => m.items);
    const quickLook = items.find((i) => i.shortcut === 'space');
    expect(quickLook?.disabled).toBe(false);
    act(() => quickLook!.action!());
    /**
     * Returns the Quick Look panel currently rendered in the container.
     *
     * Looks up the element with `role="dialog"`, which only Quick Look renders in this test.
     *
     * @returns {Element | null} The panel element, or null when Quick Look is closed.
     *
     * @example
     * expect(dialog()?.textContent).toContain('Hello');
     */
    const dialog = () => container.querySelector('[role="dialog"]');
    expect(dialog()?.getAttribute('aria-label')).toContain('Readme.md');
    expect(dialog()?.textContent).toContain('Hello');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(dialog()?.getAttribute('aria-label')).toContain('notes.txt');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dialog()).toBeNull();
    expect(errors).toEqual([]);
  });

  it('creates, renames and trashes through the menus', () => {
    const id = mount({ path: PATHS.documents });
    /**
     * Finds a menu item of the test window by its English label.
     *
     * Flattens every menu registered for the window and matches the `en` text of object labels.
     *
     * @param {string} en - English label of the item, e.g. 'New Folder'.
     * @returns {MenuItem | undefined} The matching item, or undefined when none matches.
     *
     * @example
     * act(() => find('New Folder')!.action!());
     */
    const find = (en: string) =>
      useMenus
        .getState()
        .byWindow[id].flatMap((m) => m.items)
        .find((i) => typeof i.label === 'object' && i.label.en === en);
    act(() => find('New Folder')!.action!());
    const field = container.querySelector('textarea');
    expect(field).not.toBeNull();
    expect(fs.exists(`${PATHS.documents}/untitled folder`)).toBe(true);
    act(() => void field!.blur());
    act(() => find('Move to Trash')!.action!());
    expect(fs.exists(`${PATHS.documents}/untitled folder`)).toBe(false);
    expect(fs.trashCount()).toBe(1);
    expect(errors).toEqual([]);
  });

  it('renders Recents, the Applications folder and the Trash', () => {
    mount({ path: RECENTS });
    expect(container.textContent).toContain('notes.txt');
    act(() => root.unmount());
    root = createRoot(container);
    mount({ path: PATHS.applications });
    expect(container.textContent).toContain('TextEdit');
    expect(container.textContent).not.toContain('TextEdit.app');
    act(() => root.unmount());
    root = createRoot(container);
    fs.trash(`${PATHS.documents}/notes.txt`);
    mount({ path: PATHS.trash });
    expect(container.textContent).toContain('notes.txt');
    expect(container.textContent).toContain('Empty');
    expect(errors).toEqual([]);
  });

  it('navigates with the sidebar, history, search, list disclosure and context menus', async () => {
    const id = mount({ path: PATHS.documents });
    /**
     * Reads the current title of the test window.
     *
     * Looks the window up in the WM store on every call, so it reflects navigation.
     *
     * @returns {string | undefined} The window title, or undefined if the window is gone.
     *
     * @example
     * expect(title()).toBe('Documents');
     */
    const title = () => useWM.getState().windows.find((w) => w.id === id)?.title;
    /**
     * Finds a menu item of the test window by its English label.
     *
     * Flattens every menu registered for the window and matches the `en` text of object
     * labels; the result is asserted non-null.
     *
     * @param {string} en - English label of the item, e.g. 'Back'.
     * @returns {MenuItem} The matching item.
     *
     * @example
     * act(() => menu('Back').action!());
     */
    const menu = (en: string) =>
      useMenus
        .getState()
        .byWindow[id].flatMap((m) => m.items)
        .find((i) => typeof i.label === 'object' && i.label.en === en)!;

    click([...container.querySelectorAll('nav button')].find((b) => b.textContent === 'Pictures'));
    expect(title()).toBe('Pictures');
    act(() => menu('Back').action!());
    expect(title()).toBe('Documents');
    act(() => menu('Forward').action!());
    expect(title()).toBe('Pictures');
    act(() => menu('Back').action!());

    const input = container.querySelector<HTMLInputElement>('[role="search"] input')!;
    // The native value setter bypasses React's tracked value, so the input event reaches onChange.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, 'app');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(title()).toBe('Searching “app”');
    expect(container.querySelector(`[data-path="${PATHS.documents}/Code/app.ts"]`)).not.toBeNull();
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(title()).toBe('Documents');

    act(() => prefs.setView(PATHS.documents, 'list'));
    // The button inside a list row is its disclosure triangle, which expands the folder inline.
    click(container.querySelector(`[data-path="${PATHS.documents}/Code"] button`));
    expect(container.querySelector(`[data-path="${PATHS.documents}/Code/app.ts"]`)).not.toBeNull();

    const row = container.querySelector(`[data-path="${PATHS.documents}/notes.txt"]`)!;
    act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })));
    const ctx = useUI.getState().contextMenu;
    expect(ctx?.items.some((i) => typeof i.label === 'object' && i.label.en === 'Move to Trash')).toBe(true);
    act(() => useUI.getState().set({ contextMenu: null }));

    act(() => menu('Go to Folder…').action!());
    await act(async () => {
      const req = useDialogs.getState().queue.at(-1);
      expect(req?.kind).toBe('prompt');
      if (req?.kind === 'prompt') req.resolve('~/Downloads');
      useDialogs.setState({ queue: [] });
    });
    expect(title()).toBe('Downloads');

    act(() => menu('Back').action!());
    act(() => prefs.setView(PATHS.documents, 'icons'));
    act(() => menu('Select All').action!());
    await act(async () => {
      menu('Move to Trash').action!();
    });
    expect(fs.readdir(PATHS.documents)).toHaveLength(0);
    act(() => useUndo.getState().stack.length && menu('Undo Move to Trash').action!());
    expect(fs.readdir(PATHS.documents).length).toBe(3);
    expect(errors).toEqual([]);
  });

  it('stays in column view while moving between columns', () => {
    const id = mount({ path: PATHS.documents });
    act(() => prefs.setView(PATHS.documents, 'columns'));
    /**
     * Presses the primary mouse button on the item with the given path.
     *
     * Dispatches a bubbling `mousedown`, which is what selects an item in column view.
     *
     * @param {string} path - Absolute path of the item to press.
     * @returns {void} Nothing.
     *
     * @example
     * press(`${PATHS.documents}/Code`);
     */
    const press = (path: string) => act(() => void container.querySelector(`[data-path="${path}"]`)!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    press(`${PATHS.documents}/Code`);
    press(`${PATHS.documents}/Code/app.ts`);
    expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('Code');
    // Both columns are still shown, plus the preview of the selected file ("More…").
    expect(container.querySelector('[role="listbox"][aria-label="Documents"]')).not.toBeNull();
    expect(container.querySelector('[role="listbox"][aria-label="Code"]')).not.toBeNull();
    expect(container.textContent).toContain('More…');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('Documents');
    expect(container.querySelector(`[data-path="${PATHS.documents}/Code"]`)?.getAttribute('aria-selected')).toBe('true');
    expect(errors).toEqual([]);
  });

  it('keeps the window view for folders without their own view setting', () => {
    const id = mount({ path: PATHS.documents });
    /**
     * Finds a menu item of the test window by its English label.
     *
     * Flattens every menu registered for the window and matches the `en` text of object
     * labels; the result is asserted non-null.
     *
     * @param {string} en - English label of the item, e.g. 'as List'.
     * @returns {MenuItem} The matching item.
     *
     * @example
     * act(() => menu('as List').action!());
     */
    const menu = (en: string) =>
      useMenus
        .getState()
        .byWindow[id].flatMap((m) => m.items)
        .find((i) => typeof i.label === 'object' && i.label.en === en)!;
    act(() => menu('as List').action!());
    act(() => void container.querySelector(`[data-path="${PATHS.documents}/Code"]`)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('Code');
    expect(container.querySelector('[role="grid"]')).not.toBeNull();
    // A folder with a remembered view switches to it.
    act(() => prefs.setView(PATHS.pictures, 'icons'));
    click([...container.querySelectorAll('nav button')].find((b) => b.textContent === 'Pictures'));
    expect(container.querySelector('[role="grid"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('does not re-register its menus on unrelated re-renders', () => {
    const id = mount({ path: PATHS.documents });
    const before = useMenus.getState().byWindow[id];
    act(() => prefs.set({ iconSize: 72 }));
    act(() => wm.update(id, { x: 40 }));
    expect(useMenus.getState().byWindow[id]).toBe(before);
    expect(errors).toEqual([]);
  });

  it('shows the sidebar as a drawer in narrow windows', () => {
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      const id = mount({ path: PATHS.documents });
      /**
       * Returns the sidebar navigation element if it is rendered.
       *
       * In a narrow window the sidebar exists only while its drawer is open.
       *
       * @returns {Element | null} The sidebar `<nav>`, or null when the drawer is closed.
       *
       * @example
       * expect(sidebar()).toBeNull();
       */
      const sidebar = () => container.querySelector('nav[aria-label="Sidebar"]');
      /**
       * Returns the toolbar button that shows or hides the sidebar drawer.
       *
       * Matches either accessible label, since it switches with the drawer state.
       *
       * @returns {Element | null} The toggle button, or null when it is not rendered.
       *
       * @example
       * click(toggle());
       */
      const toggle = () => container.querySelector('button[aria-label="Show Sidebar"], button[aria-label="Hide Sidebar"]');
      // The persisted pref says "shown", but a phone-width window starts with the drawer closed.
      expect(sidebar()).toBeNull();
      click(toggle());
      expect(sidebar()).not.toBeNull();
      expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
      click([...sidebar()!.querySelectorAll('button')].find((b) => b.textContent === 'Downloads'));
      expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('Downloads');
      expect(sidebar()).toBeNull();
      // View > Show Sidebar opens the drawer without touching the desktop preference.
      const item = useMenus
        .getState()
        .byWindow[id].flatMap((m) => m.items)
        .find((i) => typeof i.label === 'object' && i.label.en === 'Show Sidebar')!;
      act(() => item.action!());
      expect(sidebar()).not.toBeNull();
      expect(useFinderPrefs.getState().showSidebar).toBe(true);
      // The element right before the drawer is its scrim; clicking it closes the drawer.
      click(sidebar()!.previousElementSibling);
      expect(sidebar()).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    }
  });

  it('follows the open folder when another app renames it', () => {
    const id = mount({ path: `${PATHS.documents}/Code` });
    act(() => void fs.rename(`${PATHS.documents}/Code`, 'Work'));
    expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('Work');
    expect(container.querySelector(`[data-path="${PATHS.documents}/Work/app.ts"]`)).not.toBeNull();
    // Moving it to the Trash falls back to the enclosing folder instead.
    act(() => void fs.trash(`${PATHS.documents}/Work`));
    expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('Documents');
    expect(errors).toEqual([]);
  });

  it('renders Get Info and follows a rename', () => {
    const id = mount({ view: 'info', path: `${PATHS.documents}/notes.txt` });
    expect(container.textContent).toContain('Plain Text Document');
    expect(useWM.getState().windows.find((w) => w.id === id)?.title).toBe('notes.txt Info');
    act(() => void fs.rename(`${PATHS.documents}/notes.txt`, 'renamed.txt'));
    expect(useWM.getState().windows.find((w) => w.id === id)?.args.path).toBe(`${PATHS.documents}/renamed.txt`);
    expect(errors).toEqual([]);
  });
});

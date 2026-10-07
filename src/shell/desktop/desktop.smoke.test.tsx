/**
 * Render smoke tests (jsdom) for the desktop area: system alerts, sheets, prompt, save/open
 * panels, Force Quit and the desktop icons — mounting, keyboard handling and no React warnings.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPS } from '@/apps';
import { PATHS, dialogs, fs, useDialogs, useMenus, useSystem, useUI, useWM, wm } from '@/kernel';
import { ensureSeeded } from '@/kernel/seed';
import { DialogHost, WindowSheets } from './Dialogs';
import { ForceQuitDialog } from './ForceQuit';
import { Desktop } from './Desktop';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Marks the environment as act()-aware so React flushes updates inside act() without warnings. */

let host: HTMLDivElement; /** Container element the test tree is mounted into, recreated before each test. */
let root: Root; /** React root rendering into `host`, recreated before each test. */
let errors: ReturnType<typeof vi.spyOn>; /** Spy on console.error; each test must finish without React errors or warnings. */

/**
 * Renders a React tree into the test root inside act().
 *
 * Replaces whatever the shared root rendered before; effects run before this returns.
 *
 * @param {React.ReactNode} node - The tree to render.
 * @returns {void}
 *
 * @example
 * render(<DialogHost />);
 */
const render = (node: React.ReactNode) => act(() => root.render(node));
/**
 * Dispatches a bubbling, cancelable keydown event inside act().
 *
 * The event targets the window by default, matching how global shortcut and dialog handlers
 * listen; pass a target to simulate typing in a specific element.
 *
 * @param {string} k - The `key` value of the event.
 * @param {KeyboardEventInit} [init={}] - Extra event fields such as modifier keys or `code`.
 * @param {EventTarget} [target=window] - Element or window that receives the event.
 * @returns {void}
 *
 * @example
 * key('Enter');
 * key('Escape', { metaKey: true, altKey: true });
 */
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
/**
 * Lets pending promises and timers settle.
 *
 * Inside an async act(), awaits one microtask and then advances the fake timers by 400 ms so
 * that dialog close animations and deferred resolutions complete.
 *
 * @async
 * @returns {Promise<void>} Resolves once the updates have been flushed.
 *
 * @example
 * key('Enter');
 * await flush();
 */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(400);
  });
};
/**
 * Dispatches a primary-button pointer event inside act().
 *
 * Uses `PointerEvent` when the environment provides it and falls back to `MouseEvent`
 * (jsdom may lack `PointerEvent`).
 *
 * @param {Element} el - Element that receives the event.
 * @param {string} type - Event type, e.g. 'pointerdown'.
 * @param {MouseEventInit} [init={}] - Extra event fields such as coordinates.
 * @returns {void}
 *
 * @example
 * pointer(icon, 'pointerdown');
 */
function pointer(el: Element, type: string, init: MouseEventInit = {}) {
  const Ctor = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
  act(() => {
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  });
}
/**
 * Clicks an element inside act().
 *
 * Calls the element's native `click()`, which fires a bubbling click event.
 *
 * @param {Element} el - Element to click.
 * @returns {void}
 *
 * @example
 * click(buttonByText('Save')!);
 */
const click = (el: Element) => act(() => (el as HTMLElement).click());
/**
 * Finds a button in the document by its exact (trimmed) text content.
 *
 * Searches the whole document, so buttons inside portals and sheets are found too.
 *
 * @param {string} text - The button's label.
 * @returns {HTMLButtonElement | undefined} The first matching button, or undefined when none matches.
 *
 * @example
 * buttonByText('Open')!.disabled; // true
 */
const buttonByText = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  useSystem.getState().updateSettings({ locale: 'en' });
  useSystem.getState().setPower('desktop');
  ensureSeeded('en', APPS);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  errors = vi.spyOn(console, 'error');
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useDialogs.setState({ queue: [] });
  useUI.getState().set({ forceQuit: false, contextMenu: null, spotlight: false, notificationCenter: false });
  wm.killAll();
  vi.useRealTimers();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

describe('DialogHost', () => {
  it('shows a system alert and resolves the default button with Return', async () => {
    render(<DialogHost />);
    let answer: boolean | undefined;
    act(() => {
      void dialogs.confirm({ title: 'Erase?', message: 'Really', okLabel: 'Erase' }).then((v) => (answer = v));
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Erase?');
    key('Enter');
    await flush();
    expect(answer).toBe(true);
    expect(useDialogs.getState().queue).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('cancels with Escape and shows queued dialogs one at a time', async () => {
    render(<DialogHost />);
    const results: string[] = [];
    act(() => {
      void dialogs.alert({ title: 'First', buttons: [{ label: 'Cancel', value: 'c', cancel: true }, { label: 'OK', value: 'ok', primary: true }] }).then((v) => results.push(v));
      void dialogs.alert({ title: 'Second' }).then((v) => results.push(v));
    });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    key('Escape');
    await flush();
    expect(results).toEqual(['c']);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Second');
    key('Enter');
    await flush();
    expect(results).toEqual(['c', 'ok']);
  });

  it('prompts for text', async () => {
    render(<DialogHost />);
    let value: string | null | undefined;
    act(() => {
      void dialogs.prompt({ title: 'Name?', defaultValue: 'abc' }).then((v) => (value = v));
    });
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    expect(input.value).toBe('abc');
    key('Enter');
    await flush();
    expect(value).toBe('abc');
  });

  it('renders window dialogs as sheets of that window only', async () => {
    useWM.setState({ windows: [], processes: [] });
    const id = wm.openWindow('textedit')!;
    render(
      <>
        <DialogHost />
        <div style={{ position: 'relative' }}>
          <WindowSheets windowId={id} />
        </div>
      </>,
    );
    let answer: string | undefined;
    act(() => {
      void dialogs.unsavedChanges({ windowId: id, name: 'Untitled' }).then((v) => (answer = v));
    });
    const panels = document.querySelectorAll('[role="dialog"]');
    expect(panels).toHaveLength(1);
    expect(panels[0].className).toMatch(/sheet/);
    // Three buttons stack vertically with the default button at the bottom (macOS Tahoe).
    expect(Array.from(panels[0].querySelectorAll('button'), (b) => b.textContent)).toEqual(["Don't Save", 'Cancel', 'Save']);
    key('d', { metaKey: true, ctrlKey: true, code: 'KeyD' } as KeyboardEventInit);
    await flush();
    expect(answer).toBe('discard');
  });
});

describe('Sheets below shell overlays', () => {
  /**
   * Opens a TextEdit window and shows a confirm sheet on it.
   *
   * Resets the window manager, opens a TextEdit window, renders the dialog host plus that
   * window's sheet container, queues a "Delete everything?" confirm sheet and asserts it is
   * rendered as a sheet.
   *
   * @async
   * @returns {Promise<() => boolean | undefined>} A getter for the sheet's answer, undefined while it is still open.
   *
   * @example
   * const answer = await openSheet();
   * expect(answer()).toBeUndefined();
   */
  async function openSheet() {
    useWM.setState({ windows: [], processes: [] });
    const id = wm.openWindow('textedit')!;
    render(
      <>
        <DialogHost />
        <div data-window-id={id} style={{ position: 'relative' }}>
          <WindowSheets windowId={id} />
        </div>
      </>,
    );
    let answer: boolean | undefined;
    act(() => {
      void dialogs.confirm({ windowId: id, title: 'Delete everything?', okLabel: 'Delete' }).then((v) => (answer = v));
    });
    expect(document.querySelector('[role="dialog"]')?.className).toMatch(/sheet/);
    return () => answer;
  }

  it('lets Spotlight take typing and Return instead of the hidden sheet', async () => {
    const answer = await openSheet();
    const spotlight = document.createElement('div');
    spotlight.setAttribute('role', 'dialog');
    spotlight.setAttribute('aria-modal', 'true');
    const input = document.createElement('input');
    spotlight.appendChild(input);
    document.body.appendChild(spotlight);
    act(() => useUI.getState().set({ spotlight: true }));
    input.focus();
    const seen: string[] = [];
    input.addEventListener('keydown', (e) => seen.push(e.key));
    const a = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    act(() => void input.dispatchEvent(a));
    expect(a.defaultPrevented).toBe(false);
    key('Enter', {}, input);
    await flush();
    expect(seen).toEqual(['a', 'Enter']);
    expect(answer()).toBeUndefined();
    expect(useDialogs.getState().queue).toHaveLength(1);
    // Once Spotlight is gone the sheet owns the keys again.
    act(() => useUI.getState().set({ spotlight: false }));
    spotlight.remove();
    key('Enter');
    await flush();
    expect(answer()).toBe(true);
  });

  it('leaves Esc and Return to an open menu-bar menu', async () => {
    const answer = await openSheet();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    key('Escape');
    key('Enter');
    await flush();
    expect(answer()).toBeUndefined();
    expect(useDialogs.getState().queue).toHaveLength(1);
    menu.remove();
    key('Escape');
    await flush();
    expect(answer()).toBe(false);
  });

  it('lets Esc close Notification Center before it cancels the sheet', async () => {
    const answer = await openSheet();
    act(() => useUI.getState().set({ notificationCenter: true }));
    const inSheet = document.querySelector('[role="dialog"] button') as HTMLButtonElement;
    inSheet.focus();
    let dismissed = false;
    /**
     * Records whether an Escape keydown reached the window without being handled.
     *
     * Sets `dismissed` only when no earlier handler called `preventDefault()`, standing in for
     * a window-level Escape listener such as Notification Center's.
     *
     * @param {KeyboardEvent} e - The window keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onEsc);
     */
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) dismissed = true;
    };
    window.addEventListener('keydown', onEsc);
    key('Escape', {}, inSheet);
    window.removeEventListener('keydown', onEsc);
    await flush();
    expect(dismissed).toBe(true);
    expect(answer()).toBeUndefined();
    act(() => useUI.getState().set({ notificationCenter: false }));
  });
});

describe('File panels', () => {
  it('saves into the chosen folder and asks before replacing', async () => {
    render(<DialogHost />);
    fs.writeFile(`${PATHS.documents}/Taken.txt`, 'x');
    let path: string | null | undefined;
    act(() => {
      void dialogs.save({ defaultName: 'Taken.txt', defaultDir: PATHS.documents }).then((v) => (path = v));
    });
    const name = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    expect(name.value).toBe('Taken.txt');
    click(buttonByText('Save')!);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('already exists');
    // Return = "Cancel", the default button of the replace alert.
    key('Enter');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    click(buttonByText('Save')!);
    click(buttonByText('Replace')!);
    await flush();
    expect(path).toBe(`${PATHS.documents}/Taken.txt`);
  });

  it('opens only files matching the extensions', async () => {
    render(<DialogHost />);
    let path: string | null | undefined;
    act(() => {
      void dialogs.open({ defaultDir: PATHS.downloads, extensions: ['txt'] }).then((v) => (path = v));
    });
    const rows = Array.from(document.querySelectorAll('[role="option"]'));
    const todo = rows.find((r) => r.textContent?.includes('todo.txt'))!;
    const webloc = rows.find((r) => r.textContent?.includes('GitHub'));
    expect(webloc?.getAttribute('aria-disabled')).toBe('true');
    expect(buttonByText('Open')!.disabled).toBe(true);
    act(() => {
      todo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(buttonByText('Open')!.disabled).toBe(false);
    key('Enter');
    await flush();
    expect(path).toBe(`${PATHS.downloads}/todo.txt`);
  });
});

describe('Force Quit', () => {
  it('lists running apps and force quits the selected one after confirming', async () => {
    wm.startSession();
    wm.openWindow('calculator');
    useUI.getState().set({ forceQuit: true });
    render(
      <>
        <DialogHost />
        <ForceQuitDialog />
      </>,
    );
    const rows = Array.from(document.querySelectorAll('[role="option"]'));
    expect(rows.map((r) => r.textContent)).toEqual(['Finder', 'Calculator']);
    // The active app (Calculator) is preselected.
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    key('Enter');
    expect(document.querySelector('[role="dialog"][class*="sheet"]')?.textContent).toContain('Do you want to force “Calculator” to quit?');
    key('Enter');
    await flush();
    await flush();
    expect(useWM.getState().processes.map((p) => p.appId)).toEqual(['finder']);
    key('Escape');
    expect(useUI.getState().forceQuit).toBe(false);
  });

  it('stops taking keys once something else is clicked; ⌥⌘⎋ makes it key again', () => {
    wm.startSession();
    useUI.getState().set({ forceQuit: true });
    render(<ForceQuitDialog />);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    pointer(outside, 'pointerdown');
    key('Escape');
    expect(useUI.getState().forceQuit).toBe(true);
    key('Escape', { metaKey: true, ctrlKey: true, altKey: true });
    key('Escape');
    expect(useUI.getState().forceQuit).toBe(false);
    outside.remove();
  });

  it('answers the quit app’s pending sheets with Cancel instead of orphaning them', async () => {
    wm.startSession();
    const id = wm.openWindow('textedit')!;
    useUI.getState().set({ forceQuit: true });
    render(
      <>
        <DialogHost />
        <ForceQuitDialog />
        <div style={{ position: 'relative' }}>
          <WindowSheets windowId={id} />
        </div>
      </>,
    );
    let answer: string | undefined;
    act(() => {
      void dialogs.unsavedChanges({ windowId: id, name: 'Untitled' }).then((v) => (answer = v));
    });
    // Force Quit is the key window: Return goes to it, not to the TextEdit sheet.
    key('Enter');
    expect(document.querySelector('[role="dialog"][class*="sheet"]')?.textContent).toContain('Do you want to force “TextEdit” to quit?');
    key('Enter');
    await flush();
    await flush();
    expect(answer).toBe('cancel');
    expect(useWM.getState().processes.map((p) => p.appId)).toEqual(['finder']);
    expect(useDialogs.getState().queue).toHaveLength(0);
  });

  it('closes when the session ends so it does not reappear after the next login', () => {
    useUI.getState().set({ forceQuit: true });
    render(<ForceQuitDialog />);
    act(() => useSystem.getState().setPower('loggingOut'));
    expect(useUI.getState().forceQuit).toBe(false);
  });
});

describe('Session end', () => {
  it('cancels every pending dialog', async () => {
    render(<DialogHost />);
    let ok: boolean | undefined;
    let name: string | null | undefined = 'unset';
    act(() => {
      void dialogs.confirm({ title: 'Sure?' }).then((v) => (ok = v));
      void dialogs.prompt({ title: 'Name?' }).then((v) => (name = v));
    });
    act(() => useSystem.getState().setPower('restarting'));
    await flush();
    expect(ok).toBe(false);
    expect(name).toBeNull();
    expect(useDialogs.getState().queue).toHaveLength(0);
  });
});

describe('Desktop', () => {
  it('shows ~/Desktop, selects, renames inline and provides Finder menus', async () => {
    useWM.setState({ focusedId: null, activeAppId: 'finder' });
    render(<Desktop />);
    /**
     * Returns the desktop icon elements currently rendered.
     *
     * Queries the DOM on every call so the result reflects re-renders.
     *
     * @returns {Element[]} Elements marked with `data-desktop-item`, in DOM order.
     *
     * @example
     * icons().map((i) => i.getAttribute('aria-label'));
     */
    const icons = () => Array.from(host.querySelectorAll('[data-desktop-item]'));
    expect(icons().map((i) => i.getAttribute('aria-label'))).toEqual(['Read Me.md', 'Screenshot.svg']);

    pointer(icons()[1], 'pointerdown');
    expect(icons()[1].getAttribute('aria-selected')).toBe('true');
    expect(useMenus.getState().byApp.finder?.[0].items.find((i) => i.shortcut === 'mod+o')?.disabled).toBe(false);

    key('ArrowUp');
    expect(icons()[0].getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');

    key('Enter');
    const field = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(field.value).toBe('Screenshot.svg');
    field.value = 'CV.svg';
    key('Enter', {}, field);
    await flush();
    expect(fs.exists(`${PATHS.desktop}/CV.svg`)).toBe(true);
    expect(icons().map((i) => i.getAttribute('aria-label'))).toContain('CV.svg');
    // The renamed item keeps its cell.
    expect(fs.stat(`${PATHS.desktop}/CV.svg`)?.meta).toMatchObject({ x: 0, y: 1 });
  });

  it('ignores its shortcuts while the user types in a field elsewhere, and keys behind the lock screen', () => {
    useWM.setState({ focusedId: null, activeAppId: 'finder' });
    render(<Desktop />);
    /**
     * Returns the desktop icon elements currently rendered.
     *
     * Queries the DOM on every call so the result reflects re-renders.
     *
     * @returns {Element[]} Elements marked with `data-desktop-item`, in DOM order.
     *
     * @example
     * icons().map((i) => i.getAttribute('aria-label'));
     */
    const icons = () => Array.from(host.querySelectorAll('[data-desktop-item]'));
    pointer(icons().find((i) => i.getAttribute('aria-label') === 'Read Me.md')!, 'pointerdown');
    /**
     * Looks up Finder's Duplicate menu item (shortcut mod+d) from the registered menus.
     *
     * Reads the menu store on every call so the item's action reflects the current selection.
     *
     * @returns {MenuItem | undefined} The Duplicate item, or undefined when Finder has no such item.
     *
     * @example
     * act(() => duplicate()!.action!());
     */
    const duplicate = () => useMenus.getState().byApp.finder?.flatMap((m) => m.items).find((i) => i.shortcut === 'mod+d');

    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    act(() => duplicate()!.action!());
    expect(fs.exists(`${PATHS.desktop}/Read Me copy.md`)).toBe(false);
    field.remove();
    act(() => duplicate()!.action!());
    expect(fs.exists(`${PATHS.desktop}/Read Me copy.md`)).toBe(true);

    const before = icons().map((i) => i.getAttribute('aria-selected'));
    act(() => useSystem.getState().setPower('locked'));
    key('ArrowDown');
    expect(icons().map((i) => i.getAttribute('aria-selected'))).toEqual(before);
    act(() => fs.rm(`${PATHS.desktop}/Read Me copy.md`));
  });

  it('toggles Quick Look with Space and closes it with Esc', async () => {
    useWM.setState({ focusedId: null, activeAppId: 'finder' });
    render(<Desktop />);
    await act(async () => {
      await import('@/apps/finder/QuickLook');
    });
    const icon = Array.from(host.querySelectorAll('[data-desktop-item]')).find((i) => i.getAttribute('aria-label') === 'Read Me.md')!;
    pointer(icon, 'pointerdown');
    key(' ');
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[data-quicklook] [role="dialog"]')?.getAttribute('aria-label')).toContain('Read Me');
    key('Escape');
    expect(document.querySelector('[data-quicklook]')).toBeNull();
    key(' ');
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[data-quicklook]')).not.toBeNull();
    // Activating an app closes it.
    act(() => useWM.setState({ activeAppId: 'calculator' }));
    expect(document.querySelector('[data-quicklook]')).toBeNull();
  });

  it('places new items in the first free cell and opens a context menu on the wallpaper', () => {
    useWM.setState({ focusedId: null, activeAppId: 'finder' });
    render(<Desktop />);
    act(() => {
      fs.writeFile(`${PATHS.desktop}/new.txt`, 'hi');
    });
    expect(fs.stat(`${PATHS.desktop}/new.txt`)?.meta).toMatchObject({ x: 0, y: 2 });
    act(() => {
      host.firstElementChild!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    });
    const items = useUI.getState().contextMenu?.items ?? [];
    expect(items.map((i) => (typeof i.label === 'object' ? i.label.en : i.label)).filter(Boolean)).toContain('Change Wallpaper…');
  });
});

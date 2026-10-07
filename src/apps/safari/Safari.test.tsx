import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WindowContext, useMenus, useWM, wm, type AppArgs } from '@/kernel';
import '@/apps';
import Safari from './index';
import { useSafari } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; /** React root of the currently mounted Safari window, unmounted after each test. */
let host: HTMLDivElement | null = null; /** DOM container of the mounted window, removed after each test. */
const errors = vi.spyOn(console, 'error'); /** Spy on console.error; every test asserts that it was never called. */

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    /**
     * Starts observing an element (no-op stub).
     *
     * jsdom has no ResizeObserver, so this stub never reports size changes.
     *
     * @returns {void}
     *
     * @example
     * new ResizeObserver(() => {}).observe(el);
     */
    observe() {}
    /**
     * Stops observing an element (no-op stub).
     *
     * Nothing is tracked, so there is nothing to release.
     *
     * @returns {void}
     *
     * @example
     * observer.unobserve(el);
     */
    unobserve() {}
    /**
     * Stops observing all elements (no-op stub).
     *
     * Nothing is tracked, so there is nothing to release.
     *
     * @returns {void}
     *
     * @example
     * observer.disconnect();
     */
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // The GitHub preview on the blocked-site page calls the public GitHub API; a rejecting fetch keeps tests offline.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  wm.killAll();
  useSafari.setState({ history: [], bookmarks: [], readingList: [] });
});

/**
 * Opens a Safari window and renders its component into the document.
 *
 * Registers the window with the window manager, then renders `Safari` inside a
 * `WindowContext` provider (so menus and window hooks work) wrapped in a div whose
 * double-click handler stands in for the window frame's own double-click (zoom) handler.
 * The created root and host are stored for cleanup in `afterEach`.
 *
 * @param {AppArgs} [args={}] - Launch args for the window, e.g. `{ url }`.
 * @param {() => void} [onFrameDoubleClick] - Spy called when a double-click bubbles up to the frame.
 * @returns {{ id: string; host: HTMLDivElement }} The window id and the DOM container.
 *
 * @example
 * const { id, host } = mount({ url: 'webos://portfolio' });
 * expect(host.querySelector('h1')).not.toBeNull();
 */
function mount(args: AppArgs = {}, onFrameDoubleClick?: () => void) {
  const id = wm.openWindow('safari', args)!;
  const win = useWM.getState().windows.find((w) => w.id === id)!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <WindowContext.Provider value={{ id, pid: win.pid, appId: 'safari' }}>
        <div onDoubleClick={onFrameDoubleClick}>
          <Safari windowId={id} pid={win.pid} args={args} />
        </div>
      </WindowContext.Provider>,
    ),
  );
  return { id, host };
}

/**
 * Finds a menu-bar item that a window registered.
 *
 * Looks up the window's menus in the menu store and matches the menu and the item by their
 * English labels (plain string labels are compared as is). The lookups use non-null
 * assertions instead of checks: a missing menu throws here, and a missing item comes back as
 * undefined, so the caller's `.action!()` fails instead.
 *
 * @param {string} id - Id of the window that registered the menus.
 * @param {string} menu - English label of the menu, e.g. "File".
 * @param {string} label - English label of the item, e.g. "New Tab".
 * @returns {MenuItem} The matching menu item.
 * @throws {TypeError} When the window has no registered menus or none has the given label.
 *
 * @example
 * act(() => menuItem(id, 'File', 'New Tab').action!());
 */
const menuItem = (id: string, menu: string, label: string) => {
  const m = useMenus.getState().byWindow[id].find((x) => (typeof x.label === 'string' ? x.label : x.label.en) === menu)!;
  return m.items.find((i) => i.label && (typeof i.label === 'string' ? i.label : i.label.en) === label)!;
};

/**
 * Types text into an input and presses Enter.
 *
 * Focuses the input, sets its value through the native `HTMLInputElement` value setter and
 * dispatches a bubbling `input` event (so React's `onChange` fires), then dispatches an Enter
 * `keydown`. Each step runs in its own `act()` so state updates flush in between.
 *
 * @param {HTMLInputElement} input - The input element to type into.
 * @param {string} text - Text to enter.
 * @returns {void}
 *
 * @example
 * typeInto(host.querySelector<HTMLInputElement>('input')!, 'example.com');
 */
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => input.focus());
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('Safari window', () => {
  it('shows the Start Page and navigates from the address field', () => {
    const { id, host } = mount();
    expect(host.textContent).toContain('Favorites');
    expect(useWM.getState().windows.find((w) => w.id === id)!.title).toBe('Start Page');
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Search or enter website name"]')!;
    typeInto(field, 'example.com');
    const frame = host.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('https://example.com/');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(useWM.getState().windows.find((w) => w.id === id)!.title).toBe('example.com');
    expect(useSafari.getState().history[0].url).toBe('https://example.com/');
    act(() => menuItem(id, 'History', 'Back').action!());
    expect(host.querySelector('iframe:not([hidden])')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it('opens and closes tabs; closing the last tab closes the window', async () => {
    const { id, host } = mount({ url: 'https://github.com/aodjo' });
    // GitHub refuses framing → friendly page instead of a broken frame.
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.textContent).toContain('can’t be shown here');
    act(() => menuItem(id, 'File', 'New Tab').action!());
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
    act(() => menuItem(id, 'File', 'Close Tab').action!());
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    await act(async () => menuItem(id, 'File', 'Close Tab').action!());
    expect(useWM.getState().windows.find((w) => w.id === id)).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  });

  it('double-clicking the empty tab bar opens a tab without zooming; arrows switch tabs', () => {
    const frameDoubleClick = vi.fn();
    const { id, host } = mount({}, frameDoubleClick);
    act(() => menuItem(id, 'File', 'New Tab').action!());
    const bar = host.querySelector<HTMLElement>('[role="tablist"]')!;
    act(() => bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(frameDoubleClick).not.toHaveBeenCalled();
    /**
     * Lists the tab elements currently rendered in the tab bar.
     *
     * Queries the DOM on every call, so it reflects the tabs after each re-render.
     *
     * @returns {HTMLElement[]} The `role="tab"` elements in bar order.
     *
     * @example
     * expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
     */
    const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    act(() => tabs()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    act(() => tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(errors).not.toHaveBeenCalled();
  });

  it('hands mailto: addresses to a Mail compose window', () => {
    const { host } = mount();
    typeInto(host.querySelector<HTMLInputElement>('input[aria-label="Search or enter website name"]')!, 'mailto:hi@example.com?subject=Hello');
    const compose = useWM.getState().windows.find((w) => w.appId === 'mail');
    expect(compose?.args).toMatchObject({ compose: true, to: 'hi@example.com', subject: 'Hello' });
    expect(host.querySelector('iframe')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it('shows the timeout page when a frame never loads', () => {
    vi.useFakeTimers();
    try {
      const { host } = mount({ url: 'https://unreachable.example.dev' });
      expect(host.querySelector('iframe')).not.toBeNull();
      act(() => vi.advanceTimersByTime(8100));
      expect(host.textContent).toContain('Safari Can’t Open the Page');
    } finally {
      vi.useRealTimers();
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it('renders the portfolio and history pages', () => {
    const { id, host } = mount({ url: 'webos://portfolio' });
    expect(host.querySelector('h1')?.textContent).toBeTruthy();
    act(() => menuItem(id, 'History', 'Show All History').action!());
    expect(host.textContent).toContain('History');
    expect(host.textContent).toContain('Portfolio');
    expect(errors).not.toHaveBeenCalled();
  });
});

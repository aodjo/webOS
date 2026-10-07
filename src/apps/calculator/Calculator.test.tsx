import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WindowContext, useMenus, useWM, wm, type AppProps } from '@/kernel';
import '@/apps';
import Calculator from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; /** React root of the currently mounted window, unmounted after each test. */
let host: HTMLDivElement | null = null; /** Container element of the currently mounted window. */
const errors = vi.spyOn(console, 'error'); /** Spy on console.error so tests can assert React logged no errors. */

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
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  wm.killAll();
});

/**
 * Opens a window for an app and renders its component into the document.
 *
 * Opens the window through the window manager, then renders the component inside a
 * WindowContext provider (so window hooks resolve to that window) in a fresh container
 * appended to the body. The root and container are stored for cleanup after the test.
 *
 * @param {string} appId - Id of the registered app to open.
 * @param {ComponentType<AppProps>} App - The app's window component.
 * @returns {{ id: string; host: HTMLDivElement }} The window id and the container element.
 *
 * @example
 * const { id, host } = mount('calculator', Calculator);
 */
function mount(appId: string, App: ComponentType<AppProps>) {
  const id = wm.openWindow(appId)!;
  const win = useWM.getState().windows.find((w) => w.id === id)!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <WindowContext.Provider value={{ id, pid: win.pid, appId }}>
        <App windowId={id} pid={win.pid} args={{}} />
      </WindowContext.Provider>,
    ),
  );
  return { id, host };
}

/**
 * Clicks the calculator key with the given accessible name.
 *
 * Finds the button whose aria-label equals `label` and clicks it inside act().
 *
 * @param {HTMLElement} el - Container to search.
 * @param {string} label - The key's aria-label, e.g. "Add" or "7".
 * @returns {void}
 * @throws {Error} When no button has that label.
 *
 * @example
 * key(host, '7');
 * key(host, 'Equals');
 */
const key = (el: HTMLElement, label: string) => {
  const btn = [...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
  if (!btn) throw new Error(`no key ${label}`);
  act(() => btn.click());
};

describe('Calculator window', () => {
  it('computes with the keypad and keyboard, and registers menus', () => {
    const { id, host } = mount('calculator', Calculator);
    /**
     * Reads the main display.
     *
     * Returns the text of the result element (the role="status" region).
     *
     * @returns {string | null} The displayed result.
     *
     * @example
     * expect(display()).toBe('23');
     */
    const display = () => host.querySelector('[role="status"]')!.textContent;
    key(host, '7');
    key(host, 'Add');
    key(host, '8');
    key(host, 'Multiply');
    key(host, '2');
    key(host, 'Equals');
    expect(display()).toBe('23');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(display()).toBe('0');
    act(() => {
      for (const k of ['9', '/', '3', 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    });
    expect(display()).toBe('3');
    expect(useMenus.getState().byWindow[id].map((m) => (typeof m.label === 'string' ? m.label : m.label.en))).toEqual(['Edit', 'View']);
    expect(errors).not.toHaveBeenCalled();
  });

  it('switches to scientific mode and resizes the window', () => {
    const { id, host } = mount('calculator', Calculator);
    const view = useMenus.getState().byWindow[id].find((m) => (typeof m.label === 'string' ? m.label : m.label.en) === 'View')!;
    act(() => view.items[1].action!());
    expect(useWM.getState().windows.find((w) => w.id === id)!.width).toBe(560);
    key(host, '9');
    key(host, 'Square Root');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('3');
    act(() => useMenus.getState().byWindow[id].find((m) => (typeof m.label === 'string' ? m.label : m.label.en) === 'View')!.items[0].action!());
    expect(useWM.getState().windows.find((w) => w.id === id)!.width).toBe(232);
    expect(errors).not.toHaveBeenCalled();
  });
});

import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/apps';
import { WindowContext, useSystem, useWM, wm, type AppProps } from '@/kernel';
import Welcome from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; /** React root of the currently mounted window component, unmounted after each test. */
let host: HTMLDivElement | null = null; /** DOM container the window component is rendered into, removed after each test. */

/**
 * Opens a window for an app and renders its component into a fresh DOM host.
 *
 * Asks the window manager to open a window for `appId`, looks up the new
 * window record, then renders `Component` inside a `WindowContext.Provider`
 * (so kernel hooks such as `useWindow()` resolve) within `act()`. The created
 * React root and host element are stored in the module-level `root`/`host`
 * variables so `afterEach` can tear them down.
 *
 * @async
 * @param {string} appId - Registered app id to open a window for.
 * @param {ComponentType<AppProps>} Component - App window component to render.
 * @param {Record<string, unknown>} [args={}] - Launch arguments passed to the window.
 * @returns {Promise<{ id: string; host: HTMLDivElement }>} The new window id and the DOM
 *   element it was rendered into.
 * @throws {TypeError} If the window manager does not open a window, so no window record is found.
 *
 * @example
 * const { id, host } = await mount('welcome', Welcome, { page: 'shortcuts' });
 * expect(host.querySelector('tbody')).not.toBeNull();
 */
async function mount(appId: string, Component: ComponentType<AppProps>, args: Record<string, unknown> = {}) {
  const id = wm.openWindow(appId, args)!;
  const win = useWM.getState().windows.find((w) => w.id === id)!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <WindowContext.Provider value={{ id, pid: win.pid, appId }}>
        <Component windowId={id} pid={win.pid} args={win.args} />
      </WindowContext.Provider>,
    );
  });
  return { id, host };
}

/**
 * Reads the label of the page dot that marks the current tip.
 *
 * Finds the pager dots carrying `aria-current="step"` and returns the
 * `aria-label` of the first one (e.g. "Page 1 of 5"), which contains the
 * 1-based page number.
 *
 * @param {HTMLElement} host - Container the Welcome window is rendered into.
 * @returns {string | null | undefined} The current page's accessible label, `null` if
 *   it has no label, or `undefined` if no page is marked current.
 *
 * @example
 * expect(currentPage(host)).toMatch(/1/);
 */
const currentPage = (host: HTMLElement) => [...host.querySelectorAll('[aria-current="step"]')].map((d) => d.getAttribute('aria-label'))[0];

describe('Welcome / Tips app', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.clear();
    errors = vi.spyOn(console, 'error');
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    wm.killAll();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('pages through the tips and closes on Get Started', async () => {
    const { id, host } = await mount('welcome', Welcome);
    /**
     * Returns the footer's primary (last) button.
     *
     * Re-queries the DOM on every call because the footer re-renders as pages
     * change; the last button reads "Continue" and becomes "Get Started" on the
     * final page.
     *
     * @returns {HTMLButtonElement} The last button inside the window footer.
     *
     * @example
     * await act(async () => primary().click());
     */
    const primary = () => [...host.querySelectorAll<HTMLButtonElement>('footer button')].at(-1)!;
    expect(currentPage(host)).toMatch(/1/);
    for (let i = 0; i < 4; i++) await act(async () => primary().click());
    expect(currentPage(host)).toMatch(/5/);
    expect(primary().textContent).toMatch(/Get Started|시작하기/);
    await act(async () => primary().click());
    await act(() => Promise.resolve());
    expect(useWM.getState().windows.some((w) => w.id === id)).toBe(false);
  });

  it('remembers "Show at login" and re-arms firstRun', async () => {
    useSystem.getState().updateSettings({ firstRun: false });
    const { host } = await mount('welcome', Welcome);
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    await act(async () => box.click());
    expect(localStorage.getItem('webos.tips.showAtLogin')).toBe('true');
    expect(useSystem.getState().settings.firstRun).toBe(true);
    await act(async () => box.click());
    expect(useSystem.getState().settings.firstRun).toBe(false);
  });

  it('shows the keyboard shortcuts page via args and filters it', async () => {
    const { host } = await mount('welcome', Welcome, { page: 'shortcuts' });
    /**
     * Counts the rows currently shown in the shortcuts table.
     *
     * Re-queries the DOM on each call so it reflects the latest search filter.
     *
     * @returns {number} Number of `tbody tr` elements in the window.
     *
     * @example
     * expect(rows()).toBeGreaterThan(0);
     */
    const rows = () => host.querySelectorAll('tbody tr').length;
    const all = rows();
    expect(all).toBeGreaterThan(20);
    expect(host.querySelectorAll('kbd').length).toBeGreaterThan(all);
    const input = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Spotlight');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rows()).toBeGreaterThan(0);
    expect(rows()).toBeLessThan(all);
  });
});

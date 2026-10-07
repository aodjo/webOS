import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/apps';
import { WindowContext, useWM, wm, type AppProps } from '@/kernel';
import { awards, experience } from '@/data/portfolio';
import AboutMe from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Marks this as an act() test environment so React does not warn about act() usage. */

let root: Root | null = null; /** React root of the currently mounted window component; unmounted in afterEach. */
let host: HTMLDivElement | null = null; /** DOM container the current window component renders into; removed in afterEach. */

/**
 * Opens a window for an app and renders its component into a fresh DOM host.
 *
 * Asks the window manager to open a new window with the given args, looks up
 * the resulting window record, then renders the component inside a
 * `WindowContext` provider (so kernel hooks like `useWindow()` resolve) within
 * `act()`. The created root and host are stored in the module-level `root` and
 * `host` variables so `afterEach` can unmount and remove them.
 *
 * @async
 * @param {string} appId - Registered app id to open a window for.
 * @param {ComponentType<AppProps>} Component - The app's window component to render.
 * @param {Record<string, unknown>} [args={}] - Launch args passed to the window (e.g. `{ tab: 'skills' }`).
 * @returns {Promise<{ id: string; host: HTMLDivElement }>} The new window id and the host element it rendered into.
 *
 * @example
 * const { host } = await mount('about-me', AboutMe, { tab: 'skills' });
 * host.querySelector('[role="tablist"]'); // the rendered tab bar
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

describe('About Me app', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error');
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    wm.killAll();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('switches between all sections', async () => {
    const { host } = await mount('about-me', AboutMe);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    for (const tab of tabs) {
      await act(async () => tab.click());
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(host.querySelector('[role="tabpanel"]')).not.toBeNull();
    }
    // tabs[1] is Activities; its timelines render one <li> per job and per award.
    await act(async () => tabs[1].click());
    expect(host.querySelectorAll('ol > li')).toHaveLength(experience.length + awards.length);
  });

  it('honours args.tab and arrow-key navigation in the tab bar', async () => {
    const { host } = await mount('about-me', AboutMe, { tab: 'skills' });
    /**
     * Returns the DOM id of the currently selected tab.
     *
     * Queries the host for the tab whose `aria-selected` is "true" and reads its
     * id, which ends with the tab key (e.g. "...-tab-skills"). Returns an empty
     * string when no tab is selected.
     *
     * @returns {string} The selected tab's element id, or "" if none is selected.
     *
     * @example
     * expect(selected()).toMatch(/skills$/);
     */
    const selected = () => host.querySelector('[role="tab"][aria-selected="true"]')?.id ?? '';
    expect(selected()).toMatch(/skills$/);
    expect(host.textContent).toContain('TypeScript');
    const list = host.querySelector('[role="tablist"]')!;
    await act(async () => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(selected()).toMatch(/education$/);
  });
});

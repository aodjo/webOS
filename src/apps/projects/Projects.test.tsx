import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/apps';
import { WindowContext, useWM, wm, type AppProps } from '@/kernel';
import { projects } from '@/data/portfolio';
import Projects from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Tells React the tests drive updates through act(). */

let root: Root | null = null; /** React root of the currently mounted app; unmounted after each test. */
let host: HTMLDivElement | null = null; /** DOM container of the currently mounted app; removed after each test. */

/**
 * Opens a window for an app and renders its component into the document.
 *
 * Creates the window through the window manager, then renders `Component`
 * inside a `WindowContext` provider with that window's id, pid, and args so
 * kernel hooks work. Rendering happens inside `act()`, and the created root
 * and host are stored in the module-level `root` / `host` for cleanup.
 *
 * @async
 * @param {string} appId - Registered app id to open a window for.
 * @param {ComponentType<AppProps>} Component - App window component to render.
 * @param {Record<string, unknown>} [args={}] - Window args passed to the app.
 * @returns {Promise<{ id: string; host: HTMLDivElement }>} The window id and the DOM container.
 *
 * @example
 * const { id, host } = await mount('projects', Projects, { project: 'webos' });
 * console.log(host.querySelector('h1')?.textContent); // 'webOS'
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
 * Reads a window's current title from the window manager.
 *
 * Looks the window up by id in the current window-manager state, so the
 * result reflects any title set by the app (for example the open project's
 * name).
 *
 * @param {string} id - Window id.
 * @returns {string | undefined} The window title, or undefined if the window does not exist.
 *
 * @example
 * expect(title(id)).toBe('Projects');
 */
const title = (id: string) => useWM.getState().windows.find((w) => w.id === id)?.title;

describe('Projects app', () => {
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

  it('shows every project as a card and opens / closes the detail view', async () => {
    const { id, host } = await mount('projects', Projects);
    const cards = host.querySelectorAll<HTMLButtonElement>('[data-card]');
    expect(cards).toHaveLength(projects.length);

    await act(async () => cards[0].click());
    const heading = host.querySelector('h1');
    expect(heading?.textContent).toBe(projects.find((p) => p.id === cards[0].dataset.card)?.name);
    expect(title(id)).toBe(heading?.textContent);

    const back = host.querySelector<HTMLButtonElement>('button[title]')!;
    await act(async () => back.click());
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(host.querySelector('h1')).toBeNull();
  });

  it('opens the project passed in args and filters by tag', async () => {
    const target = projects[projects.length - 1];
    const { host } = await mount('projects', Projects, { project: target.id });
    expect(host.querySelector('h1')?.textContent).toBe(target.name);

    const chip = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === target.tags[0] && b.closest('section'))!;
    await act(async () => chip.click());
    await act(() => new Promise((r) => setTimeout(r, 300)));
    const cards = [...host.querySelectorAll<HTMLButtonElement>('[data-card]')];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => projects.find((p) => p.id === c.dataset.card)?.tags.includes(target.tags[0]))).toBe(true);
  });
});

import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/apps';
import { WindowContext, useWM, wm, type AppProps } from '@/kernel';
import Minesweeper from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; /** React root of the currently mounted app, unmounted after each test. */
let host: HTMLDivElement | null = null; /** DOM container of the currently mounted app, removed after each test. */

/**
 * Open a window for an app and render its component into a new container in the document.
 *
 * Registers the window with the window manager, wraps the component in a `WindowContext`
 * provider for that window and renders it inside `act`, so effects have run on return. The
 * root and container are stored in the module-level `root` / `host` for cleanup.
 *
 * @async
 * @param {string} appId - Registered app id to open the window for.
 * @param {ComponentType<AppProps>} Component - App window component to render.
 * @param {Record<string, unknown>} [args={}] - Launch arguments passed to the window.
 * @returns {Promise<{ id: string; host: HTMLDivElement }>} The window id and the render container.
 *
 * @example
 * const { id, host } = await mount('minesweeper', Minesweeper);
 * const cells = host.querySelectorAll('[role="gridcell"]');
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
 * Create a bubbling, cancelable mouse pointer event.
 *
 * Defaults to the primary button and a 'mouse' pointer type; `init` overrides any field
 * (e.g. `button: 2` for a right click).
 *
 * @param {string} type - Event type, such as 'pointerdown' or 'pointerup'.
 * @param {PointerEventInit} [init={}] - Extra event fields merged over the defaults.
 * @returns {PointerEvent} The event, ready to dispatch on a cell.
 *
 * @example
 * cell.dispatchEvent(pointer('pointerdown', { button: 2 }));
 */
const pointer = (type: string, init: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', ...init });

describe('Minesweeper app', () => {
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

  it('renders a beginner board and opens an area on the first click', async () => {
    const { host } = await mount('minesweeper', Minesweeper);
    const cells = host.querySelectorAll<HTMLElement>('[role="gridcell"]');
    expect(cells).toHaveLength(81);
    const target = cells[40];
    await act(async () => target.dispatchEvent(pointer('pointerdown')));
    await act(async () => target.dispatchEvent(pointer('pointerup')));
    const opened = [...host.querySelectorAll<HTMLElement>('[role="gridcell"]')].filter((c) => !/covered|flagged|question/.test(c.getAttribute('aria-label') ?? ''));
    expect(opened.length).toBeGreaterThan(1);
  });

  it('flags with a right click and resizes the window for harder levels', async () => {
    const { id, host } = await mount('minesweeper', Minesweeper);
    const cell = host.querySelectorAll<HTMLElement>('[role="gridcell"]')[0];
    await act(async () => cell.dispatchEvent(pointer('pointerdown', { button: 2 })));
    expect(host.querySelectorAll('[role="gridcell"]')[0].getAttribute('aria-label')).toMatch(/flagged/);

    const select = host.querySelector('select')!;
    await act(async () => {
      select.value = 'expert';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelectorAll('[role="gridcell"]')).toHaveLength(480);
    const win = useWM.getState().windows.find((w) => w.id === id)!;
    expect(win.width).toBeGreaterThan(330);
    expect(localStorage.getItem('webos.minesweeper.level')).toBe('"expert"');
  });

  it('starts the clock on the first click', async () => {
    vi.useFakeTimers();
    // Seeded Math.random lays the mines deterministically so the first click cannot clear the
    // whole board, which would end the game and stop the clock.
    let seed = 7;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    try {
      const { host } = await mount('minesweeper', Minesweeper);
      /**
       * Read the accessible label of the elapsed-time counter.
       *
       * The clock is the second `role="img"` element in the status row (after the mine counter).
       *
       * @returns {string} The clock's aria-label, or an empty string when it is missing.
       *
       * @example
       * expect(clock()).toMatch(/\b2\b/);
       */
      const clock = () => host.querySelectorAll('[role="img"]')[1].getAttribute('aria-label') ?? '';
      await act(async () => vi.advanceTimersByTime(3000));
      expect(clock()).toMatch(/\b0\b/);
      const target = host.querySelectorAll<HTMLElement>('[role="gridcell"]')[40];
      await act(async () => target.dispatchEvent(pointer('pointerdown')));
      await act(async () => target.dispatchEvent(pointer('pointerup')));
      expect(host.querySelector('button[title$="(F2)"]')?.textContent).toBe('😊');
      await act(async () => vi.advanceTimersByTime(2600));
      expect(clock()).toMatch(/\b2\b/);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });
});

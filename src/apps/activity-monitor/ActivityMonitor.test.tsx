import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowContext, useDialogs, useMenus, useSystem, useWM, wm, type AlertRequest } from '@/kernel';
import '@/apps';
import ActivityMonitor from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; /** React root of the currently mounted window, unmounted after each test. */
let host: HTMLDivElement | null = null; /** DOM container of the currently mounted window, removed after each test. */
const errors = vi.spyOn(console, 'error'); /** Spy on console.error; each test asserts React logged no errors. */

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  wm.killAll();
  useDialogs.setState({ queue: [] });
  vi.useRealTimers();
});

/**
 * Opens an Activity Monitor window and renders its component into the document.
 *
 * Creates the window through the window manager, then renders `ActivityMonitor` inside a
 * `WindowContext` provider for that window into a fresh container appended to `document.body`.
 * The root and container are stored in module variables so `afterEach` can clean them up.
 *
 * @returns {{ id: string; host: HTMLDivElement }} The window ID and the DOM container.
 *
 * @example
 * const { id, host } = mount();
 * expect(rowNamed(host, 'kernel_task')).toBeTruthy();
 */
function mount() {
  const id = wm.openWindow('activity-monitor')!;
  const win = useWM.getState().windows.find((w) => w.id === id)!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <WindowContext.Provider value={{ id, pid: win.pid, appId: 'activity-monitor' }}>
        <ActivityMonitor windowId={id} pid={win.pid} args={{}} />
      </WindowContext.Provider>,
    ),
  );
  return { id, host };
}

/**
 * Finds the table row whose text contains a process name.
 *
 * Only rows carrying a `data-pid` attribute (process rows, not the header) are searched.
 *
 * @param {HTMLElement} host - Container the window is rendered in.
 * @param {string} name - Text to look for, e.g. a process name.
 * @returns {HTMLElement | undefined} The first matching row, or undefined when none matches.
 *
 * @example
 * rowNamed(host, 'Dock')!.dataset.pid; // '247'
 */
const rowNamed = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>('[role="row"][data-pid]')].find((r) => r.textContent?.includes(name));
/**
 * Looks up an item of the window's View menu by its English label.
 *
 * Reads the menus registered for the window from the menu store; labels may be plain strings
 * or `LString`s. The item is non-null asserted, so a missing item surfaces as a TypeError
 * when it is used.
 *
 * @param {string} id - Window ID.
 * @param {string} label - English label of the item, e.g. 'Memory' or 'Quit Process'.
 * @returns {MenuItem} The matching menu item.
 * @throws {TypeError} When the window has no registered menus or no View menu.
 *
 * @example
 * act(() => viewItem(id, 'Memory').action!());
 */
const viewItem = (id: string, label: string) =>
  useMenus
    .getState()
    .byWindow[id].find((m) => (typeof m.label === 'string' ? m.label : m.label.en) === 'View')!
    .items.find((i) => i.label && (typeof i.label === 'string' ? i.label : i.label.en) === label)!;

describe('Activity Monitor window', () => {
  it('lists real apps and system processes, samples, and switches views', () => {
    vi.useFakeTimers();
    wm.openWindow('calculator');
    const { id, host } = mount();
    expect(useWM.getState().windows.find((w) => w.id === id)!.title).toBe('Activity Monitor (All Processes)');
    expect(rowNamed(host, 'kernel_task')).toBeTruthy();
    expect(rowNamed(host, 'WindowServer')).toBeTruthy();
    expect(rowNamed(host, 'Calculator')).toBeTruthy();
    act(() => vi.advanceTimersByTime(4100));
    // The CPU graph has a red (system) and a blue (user) series. Theme colors are set through
    // the --series custom property because var() doesn't work in SVG presentation attributes.
    const series = [...host.querySelectorAll<SVGGElement>('figure svg g')];
    expect(series.map((g) => g.style.getPropertyValue('--series'))).toEqual(['var(--red)', 'var(--blue)']);
    expect(series[0].querySelector('path')!.getAttribute('fill')).toBeNull();
    for (const tab of ['Memory', 'Energy', 'Disk', 'Network']) {
      act(() => viewItem(id, tab).action!());
      expect(host.querySelector('[role="columnheader"][aria-sort="descending"]')).not.toBeNull();
    }
    act(() => viewItem(id, 'Windowed Processes').action!());
    expect(rowNamed(host, 'kernel_task')).toBeUndefined();
    expect(useWM.getState().windows.find((w) => w.id === id)!.title).toBe('Activity Monitor (Windowed Processes)');
    expect(errors).not.toHaveBeenCalled();
  });

  it('quits an app process and logs out when WindowServer is killed', async () => {
    wm.openWindow('calculator');
    const { id, host } = mount();
    act(() => rowNamed(host, 'Calculator')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => viewItem(id, 'Quit Process').action!());
    await act(async () => (useDialogs.getState().queue[0] as AlertRequest).resolve('quit'));
    useDialogs.setState({ queue: [] });
    expect(useWM.getState().processes.some((p) => p.appId === 'calculator')).toBe(false);
    expect(rowNamed(host, 'Calculator')).toBeUndefined();

    act(() => rowNamed(host, 'WindowServer')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => viewItem(id, 'Quit Process').action!());
    await act(async () => (useDialogs.getState().queue[0] as AlertRequest).resolve('force'));
    expect(useSystem.getState().power).toBe('loggingOut');
    useSystem.getState().setPower('desktop');
    expect(errors).not.toHaveBeenCalled();
  });

  it('relaunches user agents with a new PID', async () => {
    const { id, host } = mount();
    const before = rowNamed(host, 'Dock')!.dataset.pid;
    act(() => rowNamed(host, 'Dock')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => viewItem(id, 'Quit Process').action!());
    await act(async () => (useDialogs.getState().queue[0] as AlertRequest).resolve('quit'));
    expect(rowNamed(host, 'Dock')!.dataset.pid).not.toBe(before);
    expect(errors).not.toHaveBeenCalled();
  });
});

/**
 * Smoke test: mounts the real window layer, Mission Control and the App Switcher in jsdom and
 * drives them through the window manager, failing on any React error or warning.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dialogs, dismissDialog, dockAnchors, registerApps, useDialogs, useSystem, useUI, useWM, useWindow, wm } from '@/kernel';
import type { AppProps } from '@/kernel/types';
import { WindowLayer } from './WindowLayer';
import { useWindowChrome } from './state';
import { minimizeTransform } from './geometry';
import { MissionControl } from './MissionControl';
import { AppSwitcher } from './AppSwitcher';
import { GENIE_MS } from './genie';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const captured = new WeakMap<Element, number>(); /** Pointer id captured per element, for the pointer-capture polyfill jsdom lacks. */
Object.assign(Element.prototype, {
  /**
   * Records that this element captured the given pointer.
   *
   * Minimal stand-in for the DOM method: it only remembers the pointer id so
   * `hasPointerCapture` can report it; events are not retargeted.
   *
   * @param {number} id - The pointer id being captured.
   * @returns {void}
   *
   * @example
   * el.setPointerCapture(e.pointerId);
   */
  setPointerCapture(this: Element, id: number) {
    captured.set(this, id);
  },
  /**
   * Tells whether this element holds capture of the given pointer.
   *
   * Compares the id against the one stored by `setPointerCapture`; a released element reports
   * false for every id.
   *
   * @param {number} id - The pointer id to check.
   * @returns {boolean} True when `setPointerCapture` was last called with this id.
   *
   * @example
   * if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
   */
  hasPointerCapture(this: Element, id: number) {
    return captured.get(this) === id;
  },
  /**
   * Releases whatever pointer this element captured.
   *
   * Ignores the pointer id argument and simply forgets the stored capture.
   *
   * @returns {void}
   *
   * @example
   * el.releasePointerCapture(e.pointerId);
   */
  releasePointerCapture(this: Element) {
    captured.delete(this);
  },
});

/**
 * Minimal app component used as window content in the tests.
 *
 * Renders a marker element tagged with its window id and shows the `path` argument, so tests can
 * find a window's content and check the arguments it received.
 *
 * @param {AppProps} props - Standard app props.
 * @param {AppArgs} props.args - Launch arguments; `args.path` is echoed in the content.
 * @returns {JSX.Element} A `div` with `data-testid="app-<windowId>"`.
 *
 * @example
 * registerApps([{ id: 'textedit', name: 'TextEdit', icon: Icon, component: TestApp }]);
 */
function TestApp({ args }: AppProps) {
  const { id } = useWindow();
  return <div data-testid={`app-${id}`}>content {String(args.path ?? '')}</div>;
}

/**
 * App component that always throws while rendering.
 *
 * Used to check that a crashing app shows the crash screen instead of breaking the shell.
 *
 * @returns {ReactNode} Never returns.
 * @throws {Error} Always throws an error with the message "boom".
 *
 * @example
 * registerApps([{ id: 'crashy', name: 'Crashy', icon: Icon, component: Crashy }]);
 */
function Crashy(): ReactNode {
  throw new Error('boom');
}

/**
 * Placeholder app icon.
 *
 * Renders an empty SVG of the requested size.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Width and height in pixels.
 * @returns {JSX.Element} An empty square SVG.
 *
 * @example
 * <Icon size={32} />
 */
const Icon = ({ size }: { size: number }) => <svg width={size} height={size} />;

registerApps([
  { id: 'finder', name: 'Finder', icon: Icon, component: TestApp, persistent: true, window: { width: 600, height: 400, titlebar: 'overlay' } },
  { id: 'textedit', name: 'TextEdit', icon: Icon, component: TestApp, window: { width: 500, height: 300 } },
  { id: 'crashy', name: 'Crashy', icon: Icon, component: Crashy, window: { width: 400, height: 300 } },
]);

/**
 * Maps a registered test app id to its display name.
 *
 * Looks the id up in a fixed table mirroring the apps registered above, so tests can compare
 * process app ids with the names shown in the App Switcher.
 *
 * @param {string} id - App id ('finder', 'textedit' or 'crashy').
 * @returns {string | undefined} The app's name, or undefined for an unknown id.
 *
 * @example
 * getAppName('textedit'); // 'TextEdit'
 */
const getAppName = (id: string) => ({ finder: 'Finder', textedit: 'TextEdit', crashy: 'Crashy' })[id];
/**
 * Waits for real time to pass inside `act`.
 *
 * Lets timers, animation frames and the state updates they trigger flush before assertions.
 *
 * @async
 * @param {number} ms - How long to wait in milliseconds.
 * @returns {Promise<void>} Resolves after the delay once React has applied the updates.
 *
 * @example
 * await wait(450);
 */
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
/**
 * Finds a window's frame element in the document.
 *
 * Queries the `<section>` that carries the window's `data-window-id` attribute; returns null once
 * the window has been unmounted.
 *
 * @param {string} id - Window id.
 * @returns {HTMLElement | null} The element with the matching `data-window-id`, or null.
 *
 * @example
 * expect(frame(id)!.hasAttribute('inert')).toBe(true);
 */
const frame = (id: string) => document.querySelector<HTMLElement>(`[data-window-id="${id}"]`);

let root: Root; /** React root the shell under test is rendered into. */
let host: HTMLDivElement; /** Container element of the React root, attached to the document body. */
const errors: unknown[][] = []; /** Arguments of every console.error / console.warn call since the last check. */

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a) => void errors.push(a));
  useSystem.setState({ power: 'desktop' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    wm.startSession();
    root.render(
      <>
        <div data-testid="desktop" />
        <WindowLayer />
        <MissionControl />
        <AppSwitcher />
      </>,
    );
  });
});

afterAll(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

afterEach(() => {
  /**
   * Tells whether a captured console call is an expected crash-screen error.
   *
   * The crash test deliberately throws "boom", which React and the error boundary report; those
   * calls are allowed, and every other captured call fails the test.
   *
   * @param {unknown[]} a - Arguments of one console.error / console.warn call.
   * @returns {boolean} True when the call comes from the deliberate app crash.
   *
   * @example
   * const unexpected = errors.filter((a) => !expected(a));
   */
  const expected = (a: unknown[]) => a.some((x) => (x instanceof Error && x.message === 'boom') || String(x).includes('crashed'));
  const unexpected = errors.filter((a) => !expected(a));
  expect(unexpected).toEqual([]);
  errors.length = 0;
});

describe('window layer', () => {
  it('opens a window with title bar, traffic lights and app content', async () => {
    let id = '';
    await act(async () => {
      id = wm.openWindow('textedit', { path: '/Users/aodjo/Desktop/a.txt' })!;
    });
    const el = frame(id)!;
    expect(el).toBeTruthy();
    expect(el.getAttribute('aria-label')).toBe('TextEdit');
    expect(el.querySelector(`[data-testid="app-${id}"]`)?.textContent).toContain('a.txt');
    expect(el.querySelectorAll('button[aria-label]').length).toBe(3);
    expect(el.style.zIndex).toBe(String(useWM.getState().windows.find((w) => w.id === id)!.z));
    await act(async () => wm.setDirty(id, true));
    expect(el.textContent).toContain('Edited');
  });

  it('drags a window by its title bar and commits on pointerup', async () => {
    const id = useWM.getState().windows[0].id;
    const before = useWM.getState().windows[0];
    const bar = frame(id)!.querySelector('[data-drag-region]')!;
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: before.y + 10, pointerId: 1, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 340, clientY: before.y + 60, pointerId: 1 }));
    });
    await wait(40);
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 340, clientY: before.y + 60, pointerId: 1 }));
    });
    await wait(60);
    const after = useWM.getState().windows[0];
    expect(after.x).toBe(before.x + 40);
    expect(after.y).toBe(before.y + 50);
    expect(frame(id)!.style.translate).toBe('');
    expect(document.documentElement.dataset.wmCursor).toBeUndefined();
  });

  it('minimizes (stays mounted, hidden) and restores', async () => {
    const id = useWM.getState().windows[0].id;
    await act(async () => wm.minimize(id));
    await wait(700);
    const el = frame(id)!;
    expect(el).toBeTruthy();
    expect(el.hasAttribute('inert')).toBe(true);
    expect(el.querySelector(`[data-testid="app-${id}"]`)).toBeTruthy();
    await act(async () => wm.restore(id));
    expect(frame(id)!.hasAttribute('inert')).toBe(false);
  });

  it('keeps hidden apps mounted but inert', async () => {
    const id = useWM.getState().windows[0].id;
    await act(async () => wm.hideApp('textedit'));
    expect(frame(id)!.hasAttribute('inert')).toBe(true);
    await act(async () => wm.unhideApp('textedit'));
    expect(frame(id)!.hasAttribute('inert')).toBe(false);
  });

  it('lays windows out in Mission Control and exits on Escape', async () => {
    await act(async () => {
      wm.openWindow('finder');
    });
    await act(async () => useUI.getState().set({ missionControl: true }));
    expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(1);
    for (const w of useWM.getState().windows) expect(frame(w.id)!.style.transform).toMatch(/scale/);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(useUI.getState().missionControl).toBe(false);
    await wait(450);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps Mission Control keys working under a sheet, but not under a system alert', async () => {
    /**
     * Dispatches an Escape keydown on `window` inside `act`.
     *
     * The event bubbles like a real key press, so whichever overlay currently owns the keyboard
     * (Mission Control or a dialog) handles it.
     *
     * @async
     * @returns {Promise<void>} Resolves once React has processed the key press.
     *
     * @example
     * await escape();
     */
    const escape = () => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const winId = useWM.getState().windows[0].id;

    // A sheet on a window is document-modal: Mission Control still takes the keyboard.
    await act(async () => useUI.getState().set({ missionControl: true }));
    await act(async () => void dialogs.alert({ windowId: winId, title: { en: 'Sheet', ko: 'Sheet' } }));
    await escape();
    expect(useUI.getState().missionControl).toBe(false);
    expect(useDialogs.getState().queue).toHaveLength(1);
    await act(async () => dismissDialog(useDialogs.getState().queue[0].id));
    await wait(450);

    // A system alert (no window) sits above Mission Control and owns the keys.
    await act(async () => useUI.getState().set({ missionControl: true }));
    await act(async () => void dialogs.alert({ title: { en: 'System', ko: 'System' } }));
    await escape();
    expect(useUI.getState().missionControl).toBe(true);
    await act(async () => dismissDialog(useDialogs.getState().queue[0].id));
    await escape();
    expect(useUI.getState().missionControl).toBe(false);
    await wait(450);
  });

  it('switches apps with ⌥Tab in most-recently-used order', async () => {
    expect(useWM.getState().activeAppId).toBe('finder');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', altKey: true, bubbles: true }));
    });
    const options = document.querySelectorAll('[role="option"]');
    expect([...options].map((o) => o.textContent)).toEqual(['Finder', 'TextEdit']);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft', bubbles: true }));
    });
    expect(useUI.getState().appSwitcher).toBeNull();
    expect(useWM.getState().activeAppId).toBe('textedit');
  });

  it('closes with a fading snapshot', async () => {
    const id = useWM.getState().windows.find((w) => w.appId === 'textedit')!.id;
    await act(async () => {
      await wm.close(id, { force: true });
    });
    expect(frame(id)).toBeNull();
    await wait(300);
    expect(useWM.getState().windows.some((w) => w.id === id)).toBe(false);
  });

  it('shows a crash screen instead of taking the shell down', async () => {
    let id = '';
    await act(async () => {
      id = wm.openWindow('crashy')!;
    });
    expect(frame(id)!.textContent).toContain('Crashy quit unexpectedly.');
    expect(frame(useWM.getState().windows[0].id)).toBeTruthy();
  });

  it('tiles to the left half when dropped on the screen edge', async () => {
    let id = '';
    await act(async () => {
      id = wm.openWindow('textedit')!;
    });
    const w = useWM.getState().windows.find((x) => x.id === id)!;
    const bar = frame(id)!.querySelector('[data-drag-region]')!;
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: w.x + 100, clientY: w.y + 10, pointerId: 2, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 300, pointerId: 2 }));
    });
    await wait(40);
    expect(useWindowChrome.getState().snap?.rect.x).toBe(0);
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 300, pointerId: 2 }));
    });
    await wait(100);
    const after = useWM.getState().windows.find((x) => x.id === id)!;
    expect(useWindowChrome.getState().snap).toBeNull();
    expect(after.tiled).toBe('left');
    expect(after.x).toBe(0);
    expect(after.restoreBounds).toMatchObject({ width: w.width, height: w.height });
  });

  it('restores the size when a tiled window is dragged away', async () => {
    const w = useWM.getState().windows.find((x) => x.tiled === 'left')!;
    const bar = frame(w.id)!.querySelector('[data-drag-region]')!;
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: w.y + 10, pointerId: 3, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 260, clientY: w.y + 80, pointerId: 3 }));
    });
    await wait(40);
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 260, clientY: w.y + 80, pointerId: 3 }));
    });
    await wait(60);
    const after = useWM.getState().windows.find((x) => x.id === w.id)!;
    expect(after.tiled).toBeNull();
    expect(after.width).toBe(w.restoreBounds!.width);
  });

  it('resizes from a corner, respecting the minimum size', async () => {
    const w = useWM.getState().windows.find((x) => x.appId === 'textedit' && !x.tiled)!;
    const handles = frame(w.id)!.querySelectorAll(':scope > div[aria-hidden="true"]');
    expect(handles.length).toBeGreaterThanOrEqual(8);
    const se = handles[6];
    await act(async () => {
      se.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 500, pointerId: 4, button: 0 }));
      se.dispatchEvent(new PointerEvent('pointermove', { clientX: 560, clientY: 540, pointerId: 4 }));
    });
    await wait(40);
    await act(async () => {
      se.dispatchEvent(new PointerEvent('pointerup', { clientX: 560, clientY: 540, pointerId: 4 }));
    });
    let after = useWM.getState().windows.find((x) => x.id === w.id)!;
    expect([after.width, after.height]).toEqual([w.width + 60, w.height + 40]);
    await act(async () => {
      se.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 500, pointerId: 5, button: 0 }));
      se.dispatchEvent(new PointerEvent('pointermove', { clientX: -2000, clientY: -2000, pointerId: 5 }));
    });
    await wait(40);
    await act(async () => {
      se.dispatchEvent(new PointerEvent('pointerup', { clientX: -2000, clientY: -2000, pointerId: 5 }));
    });
    after = useWM.getState().windows.find((x) => x.id === w.id)!;
    expect([after.width, after.height]).toEqual([after.minWidth, after.minHeight]);
  });

  it('zooms on title bar double-click', async () => {
    const w = useWM.getState().windows.find((x) => x.appId === 'textedit' && !x.tiled)!;
    const bar = frame(w.id)!.querySelector('[data-drag-region]')!;
    await act(async () => {
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(useWM.getState().windows.find((x) => x.id === w.id)!.maximized).toBe(true);
    await act(async () => {
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const after = useWM.getState().windows.find((x) => x.id === w.id)!;
    expect(after.maximized).toBe(false);
    expect(after.width).toBe(w.width);
  });

  it('slides windows away for Show Desktop and brings them back on a desktop click', async () => {
    await act(async () => useUI.getState().set({ showDesktop: true }));
    const visible = useWM.getState().windows.filter((w) => !w.minimized);
    for (const w of visible) expect(frame(w.id)!.style.transform).toMatch(/translate/);
    const desktop = document.querySelector('[data-testid="desktop"]')!;
    await act(async () => {
      desktop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10, pointerId: 9 }));
      desktop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 40, clientY: 40, pointerId: 9 }));
    });
    // A drag (rubber band) keeps the desktop shown.
    expect(useUI.getState().showDesktop).toBe(true);
    await act(async () => {
      desktop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10, pointerId: 9 }));
      desktop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 11, clientY: 10, pointerId: 9 }));
    });
    expect(useUI.getState().showDesktop).toBe(false);
    for (const w of visible) expect(frame(w.id)!.style.transform).toBe('');
  });

  it('quits the highlighted app with Q in the switcher', async () => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', altKey: true, bubbles: true }));
    });
    const highlighted = document.querySelector('[role="option"][aria-selected="true"]')!.textContent;
    expect(highlighted).not.toBe('Finder');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'œ', code: 'KeyQ', altKey: true, bubbles: true }));
    });
    await wait(30);
    expect(useWM.getState().processes.some((p) => getAppName(p.appId) === highlighted)).toBe(false);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', altKey: true, bubbles: true }));
    });
    expect(useUI.getState().appSwitcher).toBeNull();
  });
});

describe('window behavior details', () => {
  let id = '';
  /**
   * Reads the current state of the window under test.
   *
   * Looks the window up by the `id` shared across this describe block.
   *
   * @returns {WindowState} The window's state; assumed to exist.
   *
   * @example
   * expect(win().maximized).toBe(true);
   */
  const win = () => useWM.getState().windows.find((w) => w.id === id)!;
  /**
   * Extracts just the position and size of a window.
   *
   * Copies the four bounds fields into a new object so other window state (z, tiled, …) does not
   * take part in equality checks.
   *
   * @param {Object} w - Anything with window bounds.
   * @param {number} w.x - Left edge in pixels.
   * @param {number} w.y - Top edge in pixels.
   * @param {number} w.width - Width in pixels.
   * @param {number} w.height - Height in pixels.
   * @returns {Bounds} A plain `{ x, y, width, height }` object.
   *
   * @example
   * expect(boundsOf(win())).toEqual(before);
   */
  const boundsOf = (w: { x: number; y: number; width: number; height: number }) => ({ x: w.x, y: w.y, width: w.width, height: w.height });

  it('fills a tiled window from the zoom button menu, keeping its previous size', async () => {
    await act(async () => {
      id = wm.openWindow('textedit')!;
    });
    const before = boundsOf(win());
    await act(async () => wm.tile(id, 'right'));
    const zoom = frame(id)!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => {
      zoom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    const fill = useUI.getState().contextMenu!.items.find((i) => typeof i.label === 'object' && i.label.en === 'Fill')!;
    expect(fill.disabled).toBe(false);
    await act(async () => {
      fill.action!();
      useUI.getState().set({ contextMenu: null });
    });
    expect(win()).toMatchObject({ maximized: true, tiled: null, restoreBounds: before });
    await act(async () => wm.toggleMaximize(id));
    expect(boundsOf(win())).toEqual(before);
  });

  it('drops a drag in progress when the window is minimized', async () => {
    const w = win();
    const bar = frame(id)!.querySelector('[data-drag-region]')!;
    await act(async () => {
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: w.x + 100, clientY: w.y + 10, pointerId: 11, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: w.x + 160, clientY: w.y + 90, pointerId: 11 }));
    });
    await wait(40);
    expect(frame(id)!.style.translate).not.toBe('');
    await act(async () => wm.minimize(id));
    expect(frame(id)!.style.translate).toBe('');
    expect(document.documentElement.dataset.wmCursor).toBeUndefined();
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: w.x + 160, clientY: w.y + 90, pointerId: 11 }));
    });
    expect(boundsOf(win())).toEqual(boundsOf(w));
    await wait(GENIE_MS + 150);
  });

  it('restores out of where its Dock tile is now', async () => {
    const tile = { x: 300, y: 820, width: 40, height: 40 };
    dockAnchors.set(`win:${id}`, tile as DOMRect);
    await act(async () => wm.restore(id));
    const el = frame(id)!;
    expect(el.style.transform).toBe(minimizeTransform(boundsOf(win()), tile));
    expect(el.style.opacity).toBe('0');
    expect(el.hasAttribute('inert')).toBe(false);
    // The genie plays out of the tile first; the window takes its place when it ends.
    await wait(GENIE_MS + 150);
    expect(el.style.transform).toBe('');
    expect(el.style.opacity).toBe('');
    dockAnchors.delete(`win:${id}`);
  });

  it('takes keyboard focus once a system overlay that held it goes away', async () => {
    const overlay = document.createElement('div');
    overlay.setAttribute('aria-modal', 'true');
    const input = document.createElement('input');
    overlay.appendChild(input);
    document.body.appendChild(overlay);
    input.focus();
    let next = '';
    await act(async () => {
      next = wm.openWindow('textedit')!;
    });
    // Spotlight / Launchpad keep the keyboard while they animate out…
    expect(document.activeElement).toBe(input);
    overlay.remove();
    // …and the window that was activated from them gets it afterwards.
    await wait(160);
    expect(frame(next)!.contains(document.activeElement)).toBe(true);
    id = next;
  });

  it('holds the keyboard in Mission Control and hands it back on Escape', async () => {
    expect(frame(id)!.contains(document.activeElement)).toBe(true);
    await act(async () => useUI.getState().set({ missionControl: true }));
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(useUI.getState().missionControl).toBe(false);
    expect(frame(id)!.contains(document.activeElement)).toBe(true);
    await wait(450);
  });

  it("doesn't animate re-fitted windows while the browser is being resized", async () => {
    const el = frame(id)!;
    const settled = el.className;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(el.className).not.toBe(settled);
    await wait(260);
    expect(el.className).toBe(settled);
  });
});

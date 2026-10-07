/**
 * Render smoke tests (jsdom): the Dock, Launchpad and Spotlight mount, respond to input, talk to
 * the window manager and don't log React warnings.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPS } from '@/apps';
import { dockAnchors, ensureSeeded, join, useSystem, useUI, useWM, wm, DEFAULT_DOCK, PATHS } from '@/kernel';
import { projects } from '@/data/portfolio';
import { Dock } from './Dock';
import { Launchpad } from './Launchpad';
import { Spotlight } from './Spotlight';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Marks the test environment as an act() environment so React accepts act()-wrapped updates without warnings. */

let host: HTMLDivElement; /** Container element each test renders into (recreated per test). */
let root: Root; /** React root mounted on `host`. */
let errors: ReturnType<typeof vi.spyOn>; /** Spy on console.error; any call fails the test in afterEach. */

/**
 * Renders a React node into the test root inside act().
 *
 * Wrapping the render in act() flushes effects and state updates synchronously, so the DOM under
 * `host` is complete when the call returns.
 *
 * @param {ReactNode} node - The element to render.
 * @returns {void}
 *
 * @example
 * render(<Dock />);
 */
function render(node: ReactNode) {
  act(() => root.render(node));
}

/**
 * Types a value into a React-controlled input.
 *
 * Sets the value through the native HTMLInputElement setter (bypassing React's value tracker) and
 * dispatches a bubbling `input` event so React's onChange fires, all inside act().
 *
 * @param {HTMLInputElement} input - The input to type into.
 * @param {string} value - The full new value.
 * @returns {void}
 *
 * @example
 * typeInto(host.querySelector('input')!, 'saf');
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Dispatches a bubbling, cancelable keydown event inside act().
 *
 * Fields in `init` are spread over the defaults, so they can add modifier flags or override
 * `bubbles` / `cancelable`. React updates triggered by the event are flushed before returning.
 *
 * @param {Element | Window} el - Event target.
 * @param {string} key - The `KeyboardEvent.key` value, e.g. "Enter".
 * @param {KeyboardEventInit} [init={}] - Extra event fields such as modifier flags.
 * @returns {void}
 *
 * @example
 * keydown(input, 'Enter', { metaKey: true });
 */
function keydown(el: Element | Window, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

beforeAll(() => {
  ensureSeeded('en', APPS);
  /**
   * Minimal matchMedia stub for jsdom: no query ever matches and listeners are ignored.
   *
   * Installed only when jsdom provides no `window.matchMedia`. The returned list reports
   * `matches: false`, echoes the query in `media`, and its listener methods do nothing.
   *
   * @param {string} q - The media query.
   * @returns {MediaQueryList} A non-matching media query list.
   *
   * @example
   * window.matchMedia('(prefers-color-scheme: dark)').matches; // false
   */
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  /**
   * No-op scrollIntoView stub for jsdom.
   *
   * Installed only when jsdom provides no `Element.prototype.scrollIntoView`, so components that
   * scroll the selected row into view can run without errors.
   *
   * @returns {void}
   *
   * @example
   * el.scrollIntoView();
   */
  Element.prototype.scrollIntoView ??= function () {};
  /**
   * Web Animations stub for jsdom that returns an animation handle with no-op controls.
   *
   * Installed only when jsdom provides no `Element.prototype.animate`. The handle never fires
   * `onfinish` or `oncancel`, so no animation-driven state changes happen during the tests.
   *
   * @returns {Animation} A stub animation whose cancel() and finish() do nothing.
   *
   * @example
   * el.animate([{ opacity: 0 }, { opacity: 1 }], 200).cancel();
   */
  Element.prototype.animate ??= function () {
    return { cancel() {}, finish() {}, onfinish: null, oncancel: null } as unknown as Animation;
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useSystem.getState().updateSettings({ locale: 'en', dockPinned: DEFAULT_DOCK, dockAutohide: false, dockPosition: 'bottom' });
  wm.killAll();
  wm.startSession();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  errors = vi.spyOn(console, 'error');
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useUI.getState().closeOverlays();
  vi.useRealTimers();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

describe('Dock', () => {
  it('shows pinned apps, a running dot for Finder and the Trash, and publishes anchors', () => {
    render(<Dock />);
    const labels = [...host.querySelectorAll('button[data-dock-item]')].map((b) => b.getAttribute('data-dock-item'));
    expect(labels[0]).toBe('finder');
    expect(labels).toContain('safari');
    expect(labels[labels.length - 1]).toBe('trash');
    expect(dockAnchors.get('finder')?.width).toBeGreaterThan(0);
    expect(dockAnchors.get('trash')).toBeTruthy();
  });

  it('launches apps on click and adds running unpinned apps', () => {
    render(<Dock />);
    act(() => (host.querySelector('button[data-dock-item="safari"]') as HTMLButtonElement).click());
    expect(useWM.getState().processes.some((p) => p.appId === 'safari')).toBe(true);
    act(() => void wm.launch('minesweeper'));
    expect(host.querySelector('button[data-dock-item="minesweeper"]')).toBeTruthy();
  });

  it('adds a tile for minimized windows that restores on click', () => {
    render(<Dock />);
    let id = '';
    act(() => {
      id = wm.openWindow('textedit')!;
    });
    act(() => wm.minimize(id));
    const tile = host.querySelector(`button[data-dock-item="win:${id}"]`) as HTMLButtonElement;
    expect(tile).toBeTruthy();
    expect(dockAnchors.get(`win:${id}`)).toBeTruthy();
    act(() => tile.click());
    expect(useWM.getState().windows.find((w) => w.id === id)?.minimized).toBe(false);
    expect(host.querySelector(`button[data-dock-item="win:${id}"]`)).toBeNull();
  });

  it('fits on a phone: icons shrink and minimized windows go into their app icon', () => {
    const size = { w: window.innerWidth, h: window.innerHeight };
    /**
     * Overrides window.innerWidth / innerHeight to emulate a screen size.
     *
     * Redefines both properties as configurable values so they can be overridden again; no
     * `resize` event is dispatched.
     *
     * @param {number} w - Viewport width in px.
     * @param {number} h - Viewport height in px.
     * @returns {void}
     *
     * @example
     * setViewport(390, 844);
     */
    const setViewport = (w: number, h: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    };
    setViewport(390, 844);
    try {
      render(<Dock />);
      let id = '';
      act(() => {
        for (const app of ['minesweeper', 'activity-monitor', 'preview']) wm.launch(app);
        id = wm.openWindow('textedit')!;
      });
      act(() => wm.minimize(id));
      expect(host.querySelector(`button[data-dock-item="win:${id}"]`)).toBeNull();
      expect(dockAnchors.get('finder')!.left).toBeGreaterThanOrEqual(0);
      expect(dockAnchors.get('trash')!.right).toBeLessThanOrEqual(390);
      act(() => (host.querySelector('button[data-dock-item="textedit"]') as HTMLButtonElement).click());
      expect(useWM.getState().windows.find((w) => w.id === id)?.minimized).toBe(false);
    } finally {
      setViewport(size.w, size.h);
    }
  });

  it('opens a context menu whose Quit turns into Force Quit with Option', () => {
    render(<Dock />);
    act(() => void wm.launch('safari'));
    const btn = host.querySelector('button[data-dock-item="safari"]')!;
    act(() => {
      btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 700 }));
    });
    /**
     * Reads the English labels of the open context menu.
     *
     * Localized labels contribute their `en` text and plain string labels are returned as they
     * are; items without a label (separators) yield undefined.
     *
     * @returns {(string | undefined)[]} Labels of the current menu items (empty when no menu is open).
     *
     * @example
     * expect(labels()).toContain('Quit');
     */
    const labels = () => (useUI.getState().contextMenu?.items ?? []).map((i) => (typeof i.label === 'object' ? i.label.en : i.label));
    expect(labels()).toContain('Quit');
    expect(labels()).toContain('Options');
    keydown(window, 'Alt', { altKey: true });
    expect(labels()).toContain('Force Quit');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    });
    expect(labels()).toContain('Quit');
  });

  it('reorders pinned apps by dragging and removes them when dragged out', () => {
    render(<Dock />);
    /**
     * Returns the screen center of a published Dock anchor.
     *
     * Reads the anchor rectangle the Dock published in `dockAnchors` and returns the midpoint of
     * its width and height.
     *
     * @param {string} key - Dock item key, e.g. "finder".
     * @returns {{ x: number; y: number }} Center point in client coordinates.
     * @throws {TypeError} When no anchor is published for `key`.
     *
     * @example
     * const finder = center('finder');
     */
    const center = (key: string) => {
      const r = dockAnchors.get(key)!;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    /**
     * Drags a Dock item to a point with pointerdown, two pointermoves and pointerup.
     *
     * The pointerdown goes to the item's button; the moves (halfway, then to the target) and the
     * pointerup are dispatched on window, each inside its own act().
     *
     * @param {string} key - Dock item key to drag.
     * @param {{ x: number; y: number }} to - Drop point in client coordinates.
     * @returns {void}
     * @throws {TypeError} When the item has no anchor or button.
     *
     * @example
     * drag('mail', { x: mail.x, y: mail.y - 220 });
     */
    const drag = (key: string, to: { x: number; y: number }) => {
      const from = center(key);
      const btn = host.querySelector(`button[data-dock-item="${key}"]`)!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: from.x, clientY: from.y }));
      });
      act(() => {
        window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: from.x + (to.x - from.x) / 2, clientY: from.y + (to.y - from.y) / 2 }));
      });
      act(() => {
        window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: to.x, clientY: to.y }));
      });
      act(() => {
        window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: to.x, clientY: to.y }));
      });
    };
    const finder = center('finder');
    drag('safari', { x: finder.x + 40, y: finder.y });
    expect(useSystem.getState().settings.dockPinned.slice(0, 2)).toEqual(['finder', 'safari']);
    const mail = center('mail');
    drag('mail', { x: mail.x, y: mail.y - 220 });
    expect(useSystem.getState().settings.dockPinned).not.toContain('mail');
    expect(host.querySelector('button[data-dock-item="mail"]')).toBeNull();
  });

  it('keeps Return / Space on a focused Dock icon away from app shortcuts', () => {
    render(<Dock />);
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    const btn = host.querySelector<HTMLButtonElement>('button[data-dock-item="finder"]')!;
    expect(btn.tabIndex).toBe(0);
    expect(host.querySelector<HTMLButtonElement>('button[data-dock-item="safari"]')!.tabIndex).toBe(-1);
    act(() => btn.focus());
    keydown(btn, 'Enter');
    keydown(btn, ' ');
    keydown(btn, 'ArrowRight');
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(btn);
    window.removeEventListener('keydown', spy);
  });

  it('offers Dock options on the separator', () => {
    render(<Dock />);
    const sep = host.querySelector('[role="separator"]')!;
    act(() => {
      sep.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 700 }));
    });
    const items = useUI.getState().contextMenu?.items ?? [];
    const hiding = items.find((i) => typeof i.label === 'object' && i.label.en === 'Turn Hiding On');
    expect(hiding).toBeTruthy();
    act(() => hiding!.action!());
    expect(useSystem.getState().settings.dockAutohide).toBe(true);
  });
});

describe('Spotlight', () => {
  it('searches, navigates with the keyboard and launches the selection', () => {
    act(() => useUI.getState().set({ spotlight: true }));
    render(<Spotlight />);
    const input = host.querySelector('input')!;
    typeInto(input, 'saf');
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('Safari');
    keydown(input, 'Enter');
    expect(useUI.getState().spotlight).toBe(false);
    expect(useWM.getState().processes.some((p) => p.appId === 'safari')).toBe(true);
    act(() => void vi.advanceTimersByTime(200));
    expect(host.querySelector('input')).toBeNull();
  });

  it('shows calculator results and Escape clears before closing', () => {
    act(() => useUI.getState().set({ spotlight: true }));
    render(<Spotlight />);
    const input = host.querySelector('input')!;
    typeInto(input, '(2+3)*4');
    expect(host.textContent).toContain('= 20');
    keydown(input, 'Escape');
    expect(input.value).toBe('');
    expect(useUI.getState().spotlight).toBe(true);
    keydown(input, 'Escape');
    expect(useUI.getState().spotlight).toBe(false);
  });
});

describe('Overlay focus', () => {
  it('returns focus to the focused window after a dismissal, but not after launching an app', () => {
    let id = '';
    act(() => {
      id = wm.openWindow('textedit')!;
    });
    const frame = document.createElement('div');
    frame.dataset.windowId = id;
    const field = document.createElement('textarea');
    frame.appendChild(field);
    document.body.appendChild(frame);
    try {
      field.focus();
      act(() => useUI.getState().set({ spotlight: true }));
      render(<Spotlight />);
      const input = host.querySelector('input')!;
      expect(document.activeElement).toBe(input);
      typeInto(input, '');
      keydown(input, 'Escape');
      expect(document.activeElement).toBe(field);

      field.focus();
      act(() => useUI.getState().set({ spotlight: true }));
      act(() => void vi.advanceTimersByTime(200));
      const again = host.querySelector('input')!;
      typeInto(again, 'calculator');
      keydown(again, 'Enter');
      expect(useWM.getState().windows.find((w) => w.id === useWM.getState().focusedId)?.appId).toBe('calculator');
      expect(document.activeElement).not.toBe(field);
    } finally {
      frame.remove();
    }
  });
});

describe('Spotlight actions', () => {
  it('reveals a project folder in Finder with the modifier held', () => {
    act(() => useUI.getState().set({ spotlight: true }));
    render(<Spotlight />);
    const input = host.querySelector('input')!;
    const p = projects[0];
    typeInto(input, p.name);
    expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(p.name);
    keydown(input, 'Enter', { ctrlKey: true, metaKey: true });
    const finder = useWM.getState().windows.find((w) => w.appId === 'finder');
    expect(finder?.args).toMatchObject({ path: PATHS.projects, select: [join(PATHS.projects, p.name)] });
  });
});

describe('Launchpad', () => {
  it('filters apps as you type and launches the first match with Enter', () => {
    act(() => useUI.getState().set({ launchpad: true }));
    render(<Launchpad />);
    expect(host.querySelectorAll('[role="listitem"]').length).toBeGreaterThan(5);
    const input = host.querySelector('input')!;
    typeInto(input, 'term');
    expect(host.querySelectorAll('[role="listitem"]').length).toBe(1);
    keydown(input, 'Enter');
    expect(useUI.getState().launchpad).toBe(false);
    expect(useWM.getState().processes.some((p) => p.appId === 'terminal')).toBe(true);
  });

  it('moves keyboard focus across pages with the arrow keys', () => {
    const h = window.innerHeight;
    // Short enough for two rows per page, but above the compact (phone landscape) height.
    Object.defineProperty(window, 'innerHeight', { value: 520, configurable: true });
    try {
      act(() => useUI.getState().set({ launchpad: true }));
      render(<Launchpad />);
      const pages = host.querySelectorAll('[role="list"] > div');
      expect(pages.length).toBeGreaterThan(1);
      const firstPage = [...pages[0].querySelectorAll('button')];
      const last = firstPage[firstPage.length - 1];
      act(() => last.focus());
      keydown(last, 'ArrowRight');
      expect(pages[1].hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(pages[1].querySelector('button'));
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
    }
  });

  it('closes on Escape', () => {
    act(() => useUI.getState().set({ launchpad: true }));
    render(<Launchpad />);
    keydown(host.querySelector('input')!, 'Escape');
    expect(useUI.getState().launchpad).toBe(false);
  });
});

/**
 * Tests for the shell's global keyboard routing and the touch long-press → context menu
 * fallback (jsdom).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dialogs, registerApps, setWindowMenus, useDialogs, useSystem, useWM, wm } from '@/kernel';
import { dialogOwnsKeyboard, useGlobalShortcuts, useTouchContextMenu } from './Root';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Declares an act() test environment so React does not warn about the act() calls. */

/**
 * Placeholder icon and window component for the test apps.
 *
 * The tests only exercise keyboard and pointer routing, so the registered apps need no real
 * icon or window content; this component ignores its props.
 *
 * @returns {null} Renders nothing.
 *
 * @example
 * registerApps([{ id: 'finder', name: 'Finder', icon: Stub, component: Stub }]);
 */
const Stub = () => null;
registerApps([
  { id: 'finder', name: 'Finder', icon: Stub, component: Stub, persistent: true, window: { width: 600, height: 400 } },
  { id: 'textedit', name: { en: 'TextEdit', ko: '텍스트 편집기' }, icon: Stub, component: Stub, window: { width: 500, height: 300 } },
]);

/**
 * Test component that installs the shell's global hooks.
 *
 * Mounts `useGlobalShortcuts` and `useTouchContextMenu` (both enabled) without rendering any UI,
 * so keyboard and pointer events dispatched on the document go through the real routing.
 *
 * @returns {null} Renders nothing.
 *
 * @example
 * act(() => root.render(<Harness />));
 */
function Harness() {
  useGlobalShortcuts(true);
  useTouchContextMenu(true);
  return null;
}

let host: HTMLDivElement; /** Container element the harness is rendered into. */
let root: Root; /** React root that renders the harness. */
let finderWin: string; /** Id of the Finder window, focused before each test and given the test menus. */
let editWin: string; /** Id of the TextEdit window, kept in the background. */
const close = vi.fn(); /** Action of the Finder window's `alt+w` Close menu item. */
const quickLook = vi.fn(); /** Action of the Finder window's `space` Quick Look menu item. */

beforeAll(() => {
  useSystem.setState({ power: 'desktop' });
  wm.startSession();
  finderWin = wm.openWindow('finder')!;
  editWin = wm.openWindow('textedit')!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterAll(() => {
  act(() => root.unmount());
  host.remove();
});

beforeEach(() => {
  close.mockClear();
  quickLook.mockClear();
  setWindowMenus(finderWin, [
    {
      label: 'File',
      items: [
        { label: 'Close', shortcut: 'alt+w', action: close },
        { label: 'Quick Look', shortcut: 'space', action: quickLook },
      ],
    },
  ]);
  wm.focus(finderWin);
});

afterEach(() => {
  useDialogs.setState({ queue: [] });
  document.body.querySelectorAll('[data-test-node]').forEach((n) => n.remove());
});

/**
 * Dispatches a bubbling, cancelable `keydown` event.
 *
 * Derives `code` from `key` the way a browser would: ' ' becomes 'Space', single characters
 * become `Key<X>`, and named keys are used as they are.
 *
 * @param {EventTarget} target - Element (or document node) the event is dispatched on.
 * @param {string} key - The `KeyboardEvent.key` value.
 * @param {KeyboardEventInit} [init={}] - Extra event fields such as modifier flags.
 * @returns {void}
 *
 * @example
 * press(document.body, 'w', { altKey: true });
 */
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const code = key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init }));
}

/**
 * Adds a piece of markup to the document for one test.
 *
 * The wrapper is tagged with `data-test-node` so `afterEach` removes it.
 *
 * @param {string} html - Inner HTML of the wrapper.
 * @returns {HTMLElement} The wrapper element appended to `document.body`.
 *
 * @example
 * const el = mount('<button type="button">OK</button>');
 */
function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.testNode = '';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('sheets are document-modal', () => {
  it('a sheet on a background window leaves the focused window’s shortcuts working', () => {
    void dialogs.confirm({ title: 'Save?', windowId: editWin });
    expect(useWM.getState().focusedId).toBe(finderWin);
    expect(dialogOwnsKeyboard()).toBe(false);
    press(document.body, 'w', { altKey: true });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('the focused window’s sheet and system alerts own the keyboard', () => {
    void dialogs.confirm({ title: 'Save?', windowId: finderWin });
    expect(dialogOwnsKeyboard()).toBe(true);
    press(document.body, 'w', { altKey: true });
    expect(close).not.toHaveBeenCalled();

    useDialogs.setState({ queue: [] });
    void dialogs.alert({ title: 'System' });
    expect(dialogOwnsKeyboard()).toBe(true);
  });
});

describe('shell overlays and focused controls', () => {
  it('keys typed into a shell overlay don’t reach the window behind it', () => {
    const panel = mount('<div role="dialog" aria-modal="true"><input /></div>');
    press(panel.querySelector('input')!, 'w', { altKey: true });
    expect(close).not.toHaveBeenCalled();
  });

  it('keys typed into the Notification Center don’t reach the window behind it', () => {
    const nc = mount('<aside><button type="button">x</button></aside>');
    press(nc.querySelector('button')!, 'w', { altKey: true });
    expect(close).not.toHaveBeenCalled();
  });

  it('Space presses a focused button instead of firing the app’s Space shortcut', () => {
    const el = mount('<button type="button">Wi-Fi</button>');
    press(el.querySelector('button')!, ' ');
    expect(quickLook).not.toHaveBeenCalled();
    press(document.body, ' ');
    expect(quickLook).toHaveBeenCalledTimes(1);
  });

  it('shortcuts typed inside the focused window still work', () => {
    const el = mount(`<div data-window-id="${finderWin}"><div role="dialog"><button type="button">b</button></div></div>`);
    press(el.querySelector('button')!, 'w', { altKey: true });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('touch long-press opens context menus', () => {
  const Ctor = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
  /**
   * Dispatches a plain pointer/mouse event at (40, 50).
   *
   * Uses `PointerEvent` when jsdom provides it and `MouseEvent` otherwise; no pointer type is
   * set, so the event looks like an ordinary mouse event.
   *
   * @param {EventTarget} el - Target of the event.
   * @param {string} type - Event type, e.g. 'click' or 'contextmenu'.
   * @param {Record<string, unknown>} [init={}] - Extra event init fields.
   * @returns {boolean} False if a listener cancelled the event.
   *
   * @example
   * pointer(target, 'click');
   */
  const pointer = (el: EventTarget, type: string, init: Record<string, unknown> = {}) =>
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: 40, clientY: 50, ...init } as MouseEventInit));
  const touch = { pointerType: 'touch', isPrimary: true, pointerId: 7 };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Mounts a target element with spies on its `contextmenu` and `click` events.
   *
   * The target is a `.icon` element inside a `mount` wrapper, so `afterEach` removes it. The
   * spies are plain bubbling listeners that run after the shell's capture-phase handlers.
   *
   * @returns {{ target: Element; onMenu: Mock; onClick: Mock }} The target and the two spies.
   *
   * @example
   * const { target, onMenu, onClick } = setup();
   */
  function setup() {
    const el = mount('<div class="icon">icon</div>');
    const target = el.querySelector('.icon')!;
    const onMenu = vi.fn();
    const onClick = vi.fn();
    target.addEventListener('contextmenu', onMenu);
    target.addEventListener('click', onClick);
    return { target, onMenu, onClick };
  }

  /**
   * Dispatches a primary touch pointer event at (40, 50).
   *
   * jsdom's PointerEvent may lack `pointerType`, `isPrimary` and `pointerId`, so these (touch,
   * primary, id 7, overridable through `extra`) and every other `extra` field are defined
   * directly on the event object before it is dispatched.
   *
   * @param {EventTarget} el - Target of the event.
   * @param {string} type - Event type, e.g. 'pointerdown' or 'pointermove'.
   * @param {Record<string, unknown>} [extra={}] - Fields that override the defaults, e.g. `{ clientX: 60 }`
   *   or `{ pointerType: 'mouse' }`.
   * @returns {void}
   *
   * @example
   * touchEvent(target, 'pointerdown');
   */
  function touchEvent(el: EventTarget, type: string, extra: Record<string, unknown> = {}) {
    const ev = new Ctor(type, { bubbles: true, cancelable: true, clientX: 40, clientY: 50, ...extra } as MouseEventInit);
    for (const [k, v] of Object.entries({ ...touch, ...extra })) Object.defineProperty(ev, k, { value: v });
    el.dispatchEvent(ev);
  }

  it('a still 500 ms press fires one contextmenu and swallows the click that ends it', () => {
    const { target, onMenu, onClick } = setup();
    touchEvent(target, 'pointerdown');
    vi.advanceTimersByTime(499);
    expect(onMenu).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onMenu).toHaveBeenCalledTimes(1);
    const ev = onMenu.mock.calls[0][0] as MouseEvent;
    expect([ev.clientX, ev.clientY, ev.button]).toEqual([40, 50, 2]);
    touchEvent(target, 'pointerup');
    pointer(target, 'click');
    expect(onClick).not.toHaveBeenCalled();
    // Only the click that ends the long press is swallowed; later taps reach the target.
    vi.advanceTimersByTime(500);
    pointer(target, 'click');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('moving the finger cancels the long press', () => {
    const { target, onMenu } = setup();
    touchEvent(target, 'pointerdown');
    touchEvent(target, 'pointermove', { clientX: 60, clientY: 50 });
    vi.advanceTimersByTime(800);
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('a native long-press contextmenu (Android) is not doubled', () => {
    const { target, onMenu } = setup();
    touchEvent(target, 'pointerdown');
    vi.advanceTimersByTime(300);
    pointer(target, 'contextmenu');
    vi.advanceTimersByTime(800);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('a native contextmenu arriving after the synthesized one is swallowed', () => {
    const { target, onMenu } = setup();
    touchEvent(target, 'pointerdown');
    vi.advanceTimersByTime(500);
    pointer(target, 'contextmenu');
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('mouse presses and opted-out elements are left alone', () => {
    const { target, onMenu } = setup();
    touchEvent(target, 'pointerdown', { pointerType: 'mouse' });
    vi.advanceTimersByTime(800);
    const own = mount('<div data-own-longpress><span>cell</span></div>').querySelector('span')!;
    own.addEventListener('contextmenu', onMenu);
    touchEvent(own, 'pointerdown');
    vi.advanceTimersByTime(800);
    expect(onMenu).not.toHaveBeenCalled();
  });
});

/**
 * Render smoke tests (jsdom): the menu bar, menus, context menus and panels mount, respond to
 * pointer/keyboard input, and don't log React warnings.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/apps';
import { useUI, showContextMenu } from '@/kernel/ui';
import { notify, useNotifications } from '@/kernel/notifications';
import { useSystem } from '@/kernel/system';
import { setPrefs, usePrefs, DEFAULT_PREFS } from '@/apps/settings/prefs';
import { MenuBar } from './MenuBar';
import { ContextMenuHost } from './ContextMenuHost';
import { ControlCenter } from './ControlCenter';
import { NotificationBanners, NotificationCenter } from './Notifications';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; /** Container element each test renders into; recreated before every test. */
let root: Root; /** React root mounted on `host`; unmounted after every test. */
let errors: ReturnType<typeof vi.spyOn>; /** Spy on `console.error`; any call (e.g. a React warning) fails the test. */

/**
 * Renders a React node into the test root inside `act`.
 *
 * Wrapping the render in `act` flushes effects and state updates synchronously, so the
 * rendered DOM can be queried right after the call.
 *
 * @param {React.ReactNode} node - The element tree to render.
 * @returns {void}
 *
 * @example
 * render(<MenuBar />);
 */
function render(node: React.ReactNode) {
  act(() => root.render(node));
}

/**
 * Dispatches a bubbling, cancelable primary-button pointer event on an element.
 *
 * Falls back to `MouseEvent` when the environment has no `PointerEvent` constructor (jsdom).
 *
 * @param {Element} el - The event target.
 * @param {string} type - Event type, e.g. `pointerdown` or `pointerover`.
 * @param {PointerEventInit} [init={}] - Extra event fields, merged over the defaults.
 * @returns {void}
 *
 * @example
 * act(() => pointer(logo, 'pointerdown'));
 */
function pointer(el: Element, type: string, init: PointerEventInit = {}) {
  const Ctor = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, ...init }));
}

/**
 * Dispatches a bubbling, cancelable `keydown` event on `window`.
 *
 * The menu bar and its menus listen for keys on `window`, so this simulates a key press
 * regardless of which element has focus.
 *
 * @param {string} k - The `KeyboardEvent.key` value, e.g. `ArrowDown` or `Escape`.
 * @returns {void}
 *
 * @example
 * act(() => key('Escape'));
 */
function key(k: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  useSystem.getState().updateSettings({ locale: 'en' });
  useSystem.getState().setPower('desktop');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  errors = vi.spyOn(console, 'error');
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useUI.getState().closeOverlays();
  useNotifications.setState({ items: [], banners: [] });
  vi.useRealTimers();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

describe('MenuBar', () => {
  it('opens the logo menu, navigates with arrows and closes with Escape', () => {
    render(<MenuBar />);
    const logo = host.querySelector('[aria-label="webOS Menu"]')!;
    expect(logo).toBeTruthy();
    act(() => pointer(logo, 'pointerdown'));
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain('About This Computer');

    act(() => key('ArrowDown'));
    expect(document.querySelector('[role="menuitem"][class*="hl"]')?.textContent).toContain('About This Computer');

    // ArrowRight moves to the next menu bar menu: the Finder app menu.
    act(() => key('ArrowRight'));
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Hide');

    act(() => key('Escape'));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('chooses an item with Enter after the blink', () => {
    render(<MenuBar />);
    act(() => pointer(host.querySelector('[aria-label="webOS Menu"]')!, 'pointerdown'));
    // Type-to-select "Force Quit…", then choose it.
    act(() => key('f'));
    act(() => key('Enter'));
    act(() => vi.advanceTimersByTime(200));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(useUI.getState().forceQuit).toBe(true);
    useUI.getState().set({ forceQuit: false });
  });

  it('switches the locale from the input source menu', () => {
    render(<MenuBar />);
    act(() => pointer(host.querySelector('[aria-label^="Input source"]')!, 'pointerdown'));
    const korean = [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].find((el) => el.textContent?.includes('2-Set Korean'))!;
    act(() => korean.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => vi.advanceTimersByTime(200));
    expect(useSystem.getState().settings.locale).toBe('ko');
    act(() => useSystem.getState().updateSettings({ locale: 'en' }));
  });

  it('opens the Wi-Fi status menu with the connected network', () => {
    render(<MenuBar />);
    act(() => pointer(host.querySelector('[aria-label="Wi-Fi"]')!, 'pointerdown'));
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain('aodjo-5G');
    expect(menu?.textContent).toContain('Open Wi-Fi Settings…');
  });

  it('folds the app menus into the app menu on a phone-width bar (tap opens them at once)', () => {
    const listeners = new Set<() => void>();
    let phone = true;
    /**
     * Fake `window.matchMedia` that controls the phone-width breakpoint.
     *
     * The returned list matches only the `max-width: 767.98px` query, and only while `phone`
     * is true; change listeners are collected in `listeners` so the test can fire them after
     * flipping `phone`.
     *
     * @param {string} query - The media query string.
     * @returns {MediaQueryList} A minimal media query list for that query.
     *
     * @example
     * window.matchMedia = mq;
     * window.matchMedia('(max-width: 767.98px)').matches; // true while phone is true
     */
    const mq = (query: string) =>
      ({
        /**
         * Reports whether the query currently matches.
         *
         * Evaluated on every read, so flipping `phone` changes the result without creating a
         * new media query list.
         *
         * @returns {boolean} True for the phone-width query while `phone` is true.
         *
         * @example
         * mq('(max-width: 767.98px)').matches; // true
         */
        get matches() {
          return phone && query.includes('max-width: 767.98px');
        },
        media: query,
        /**
         * Registers a change listener.
         *
         * Adds the callback to the shared `listeners` set; the event type is not checked.
         *
         * @param {string} _ - Event type (always `change`; ignored).
         * @param {() => void} cb - Listener called when the test fires a change.
         * @returns {Set<() => void>} The listener set.
         *
         * @example
         * mq(query).addEventListener('change', onChange);
         */
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        /**
         * Unregisters a change listener.
         *
         * Removes the callback from the shared `listeners` set; the event type is not checked.
         *
         * @param {string} _ - Event type (always `change`; ignored).
         * @param {() => void} cb - The listener to remove.
         * @returns {boolean} Whether the listener was registered.
         *
         * @example
         * mq(query).removeEventListener('change', onChange);
         */
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      }) as unknown as MediaQueryList;
    const original = window.matchMedia;
    window.matchMedia = mq;
    try {
      render(<MenuBar />);
      const appTitle = [...host.querySelectorAll('[data-menubar-title]')].find((el) => el.textContent === 'Finder')!;
      act(() => pointer(appTitle, 'pointerdown'));
      const menu = document.querySelector('[role="menu"]')!;
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      const labels = items.map((el) => el.textContent ?? '');
      for (const name of ['File', 'Edit', 'Window', 'Help']) expect(labels.some((l) => l.startsWith(name))).toBe(true);
      expect(labels.some((l) => l.startsWith('Quit') || l.startsWith('Hide'))).toBe(true);
      // Tapping a folded menu opens its submenu right away (no hover delay needed).
      const file = items.find((el) => el.textContent?.startsWith('File'))!;
      act(() => (file as HTMLElement).click());
      expect(document.querySelectorAll('[role="menu"]').length).toBe(2);
      // The Spotlight item stays reachable on the compact bar.
      expect(host.querySelector('[aria-label="Spotlight Search"]')?.className).not.toMatch(/hideCompact/);
      act(() => key('Escape'));
      act(() => key('Escape'));

      // Back to a wide bar: the app menu is the plain one again.
      phone = false;
      act(() => listeners.forEach((cb) => cb()));
      act(() => pointer(appTitle, 'pointerdown'));
      const wide = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((el) => el.textContent ?? '');
      expect(wide.some((l) => l.startsWith('Edit'))).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('ContextMenuHost', () => {
  it('shows submenus on hover and closes on outside pointerdown', () => {
    render(<ContextMenuHost />);
    const action = vi.fn();
    act(() =>
      showContextMenu({ clientX: 50, clientY: 60, preventDefault: () => {} }, [
        { label: 'Open', action },
        { separator: true },
        { label: 'More', submenu: [{ label: 'Deep', action }] },
      ]),
    );
    const more = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('More'))!;
    act(() => pointer(more, 'pointerover'));
    act(() => more.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelectorAll('[role="menu"]').length).toBe(2);

    const deep = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent === 'Deep')!;
    act(() => deep.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => vi.advanceTimersByTime(200));
    expect(action).toHaveBeenCalledTimes(1);
    expect(useUI.getState().contextMenu).toBeNull();

    act(() => showContextMenu({ clientX: 5, clientY: 5, preventDefault: () => {} }, [{ label: 'Open', action }]));
    act(() => pointer(document.body, 'pointerdown'));
    expect(useUI.getState().contextMenu).toBeNull();
    act(() => pointer(document.body, 'pointerup'));
    act(() => vi.advanceTimersByTime(10));
  });

  it('consumes the click that dismisses it, like macOS', () => {
    render(<ContextMenuHost />);
    const behind = document.createElement('button');
    const clicked = vi.fn();
    behind.addEventListener('click', clicked);
    document.body.appendChild(behind);

    act(() => showContextMenu({ clientX: 50, clientY: 60, preventDefault: () => {} }, [{ label: 'Open', action: () => {} }]));
    act(() => {
      pointer(behind, 'pointerdown');
      pointer(behind, 'pointerup');
      behind.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(useUI.getState().contextMenu).toBeNull();
    expect(clicked).not.toHaveBeenCalled();

    // The next click goes through again.
    act(() => vi.advanceTimersByTime(10));
    act(() => {
      pointer(behind, 'pointerdown');
      pointer(behind, 'pointerup');
      behind.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(clicked).toHaveBeenCalledTimes(1);
    behind.remove();
  });
});

describe('MenuBar status items', () => {
  afterEach(() => {
    act(() => useSystem.getState().updateSettings({ doNotDisturb: false, wifi: true }));
    act(() => setPrefs({ wifiNetwork: DEFAULT_PREFS.wifiNetwork, knownNetworks: DEFAULT_PREFS.knownNetworks }));
  });

  it('lets a click on another menu bar item through while a menu is open', () => {
    render(<MenuBar />);
    act(() => pointer(host.querySelector('[aria-label="webOS Menu"]')!, 'pointerdown'));
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    const clock = host.querySelector('[data-nc-toggle]') as HTMLButtonElement;
    act(() => {
      pointer(clock, 'pointerdown');
      pointer(clock, 'pointerup');
      clock.click();
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(useUI.getState().notificationCenter).toBe(true);
  });

  it('shows the Focus item only while Do Not Disturb is on, and ⌥-click on the clock toggles it', () => {
    render(<MenuBar />);
    expect(host.querySelector('[aria-label="Focus: Do Not Disturb"]')).toBeNull();
    const clock = host.querySelector('[data-nc-toggle]')!;
    act(() => clock.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true })));
    expect(useSystem.getState().settings.doNotDisturb).toBe(true);
    expect(useUI.getState().notificationCenter).toBe(false);

    const focus = host.querySelector('[aria-label="Focus: Do Not Disturb"]')!;
    expect(focus).toBeTruthy();
    act(() => pointer(focus, 'pointerdown'));
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Focus Settings…');
  });

  it('shares the joined Wi-Fi network with System Settings', () => {
    render(<MenuBar />);
    act(() => setPrefs({ wifiNetwork: 'Hallasan Guest', knownNetworks: [...usePrefs.getState().knownNetworks, 'Hallasan Guest'] }));
    act(() => pointer(host.querySelector('[aria-label="Wi-Fi"]')!, 'pointerdown'));
    const rows = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((el) => el.textContent);
    expect(rows[0]).toContain('Hallasan Guest');
    act(() => key('Escape'));

    act(() => setPrefs({ wifiNetwork: null }));
    expect(host.querySelector('[aria-label="Wi-Fi: Not Connected"]')).toBeTruthy();
  });

  it('picks its glyph color from the theme until the wallpaper is sampled, and turns light over Launchpad', () => {
    const theme = useSystem.getState().settings.theme;
    act(() => useSystem.getState().updateSettings({ theme: 'light' }));
    render(<MenuBar />);
    const bar = host.querySelector('[data-menubar]')!;
    // jsdom never loads the wallpaper image, so the theme fallback applies.
    expect(bar.getAttribute('data-foreground')).toBe('dark');
    act(() => useUI.getState().set({ launchpad: true }));
    expect(bar.getAttribute('data-foreground')).toBe('light');
    act(() => useUI.getState().set({ launchpad: false }));
    act(() => useSystem.getState().updateSettings({ theme: 'dark' }));
    expect(bar.getAttribute('data-foreground')).toBe('light');
    act(() => useSystem.getState().updateSettings({ theme }));
  });

  it('opens the system menu with ⌃F2', () => {
    render(<MenuBar />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="menuitem"][class*="hl"]')?.textContent).toContain('About This Computer');
    act(() => key('Escape'));
  });
});

describe('session', () => {
  it('closes an open menu when the screen locks', () => {
    render(<MenuBar />);
    act(() => pointer(host.querySelector('[aria-label="webOS Menu"]')!, 'pointerdown'));
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    act(() => useSystem.getState().setPower('locked'));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('Control Center & Notifications', () => {
  it('renders Control Center and toggles a setting', () => {
    render(<ControlCenter />);
    act(() => useUI.getState().set({ controlCenter: true }));
    const before = useSystem.getState().settings.bluetooth;
    const bt = [...document.querySelectorAll('[role="switch"]')].find((el) => el.textContent?.includes('Bluetooth')) as HTMLButtonElement;
    act(() => bt.click());
    expect(useSystem.getState().settings.bluetooth).toBe(!before);
    act(() => useSystem.getState().updateSettings({ bluetooth: before }));
    act(() => key('Escape'));
    expect(useUI.getState().controlCenter).toBe(false);
    act(() => vi.advanceTimersByTime(400));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows banners and lists notifications grouped in Notification Center', () => {
    render(
      <>
        <NotificationBanners />
        <NotificationCenter />
      </>,
    );
    act(() => {
      notify({ appId: 'mail', title: 'Hello', body: 'First' });
      notify({ appId: 'mail', title: 'Again', body: 'Second' });
    });
    expect(host.textContent).toContain('Again');
    act(() => useUI.getState().set({ notificationCenter: true }));
    expect(useNotifications.getState().items.every((n) => n.read)).toBe(true);
    const center = host.querySelector('aside')!;
    expect(center.textContent).toContain('Again');
    // Expand the stack, then clear the group.
    act(() => (center.querySelector('button') as HTMLButtonElement).click());
    const clear = [...center.querySelectorAll('button')].find((b) => b.textContent === 'Clear') as HTMLButtonElement;
    act(() => clear.click());
    expect(useNotifications.getState().items).toHaveLength(0);
    expect(center.textContent).toContain('No Notifications');
    act(() => vi.advanceTimersByTime(6000));
  });

  it('keeps banners while the pointer is over them and removes a closed one at once', () => {
    render(<NotificationBanners />);
    act(() => {
      notify({ appId: 'mail', title: 'One' });
      notify({ appId: 'mail', title: 'Two' });
    });
    /**
     * Lists the banner elements currently in the notification region.
     *
     * Queries the DOM on every call, so the result always matches the banners on screen,
     * including ones that are marked as leaving.
     *
     * @returns {Element[]} The direct children of the banner region, including leaving ones.
     *
     * @example
     * expect(banners()).toHaveLength(2);
     */
    const banners = () => [...host.querySelectorAll('[role="region"] > div')];
    expect(banners()).toHaveLength(2);

    const region = host.querySelector('[role="region"]')!;
    act(() => pointer(banners()[0], 'pointerover', { pointerType: 'mouse' }));
    act(() => vi.advanceTimersByTime(6000));
    // Expired in the kernel, but held on screen.
    expect(useNotifications.getState().banners).toHaveLength(0);
    expect(banners().filter((b) => !b.className.includes('leaving'))).toHaveLength(2);

    // × removes that banner right away, even while held.
    const close = banners()[0].querySelector('[aria-label="Close"]') as HTMLButtonElement;
    act(() => close.click());
    expect(banners().filter((b) => b.className.includes('leaving'))).toHaveLength(1);

    // Leaving the stack lets the rest expire.
    act(() => pointer(region, 'pointerout', { pointerType: 'mouse' }));
    act(() => vi.advanceTimersByTime(1300));
    expect(banners().every((b) => b.className.includes('leaving'))).toBe(true);
  });
});

/**
 * The menu bar: system (logo) menu, the active app's menus and the status items on the right.
 *
 * Behaves like macOS: pressing a title opens its menu (press-drag-release also works); while a
 * menu is open, hovering another title — or a status menu (Wi-Fi, Focus, Battery) — switches to
 * it; ← → walk through the titles; clicking the open title, clicking elsewhere or ⎋ closes it;
 * ⌃F2 opens the system menu from the keyboard, and a menu's title blinks when one of its
 * shortcuts is used. The menus are rebuilt from the kernel (`buildMenuBar`) whenever the
 * windows, app menus or locale change. On a phone-width bar the app menus don't fit, so they are
 * folded into the app menu as submenus (File ▸, Edit ▸, Window ▸, Help ▸…).
 *
 * Like macOS 26 the bar itself is transparent: its glyphs turn light or dark to stay legible over
 * the wallpaper behind them (see wallpaperTone.ts).
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Moon, Search, Wifi, WifiOff } from 'lucide-react';
import type { LString, MenuDef } from '@/kernel/types';
import { useWM } from '@/kernel/wm';
import { findShortcutItem, useMenus } from '@/kernel/menus';
import { useIsDark, useSystem } from '@/kernel/system';
import { useUI } from '@/kernel/ui';
import { useDialogs } from '@/kernel/dialogs';
import { useLocale, useT } from '@/kernel/i18n';
import { buildLogoMenu, buildMenuBar } from '@/kernel/systemMenus';
import { MENU_BAR_HEIGHT } from '@/kernel/constants';
import { osInfo } from '@/data/portfolio';
import { OSLogo } from '@/icons';
import { Menu, type MenuEntry } from '@/components/Menu';
import { useRefraction } from '@/components/Glass';
import { Z } from '../layers';
import { useBattery } from './battery';
import { useKnownNetworks, useStatus, useWifiNetwork } from './status';
import { buildBatteryMenu, buildFocusMenu, buildInputMenu, buildWifiMenu } from './statusMenus';
import { BatteryGlyph, ControlCenterGlyph, InputSourceGlyph } from './glyphs';
import { formatMenuClock } from './format';
import { useCloseOnSessionEnd, useNow } from './hooks';
import { useWallpaperForeground } from './wallpaperTone';
import styles from './MenuBar.module.css';

const S = {
  systemMenu: { en: `${osInfo.name} Menu`, ko: `${osInfo.name} 메뉴` },
  appMenus: { en: 'Application menus', ko: '응용 프로그램 메뉴' },
  statusMenus: { en: 'Status menus', ko: '상태 메뉴' },
  controlCenter: { en: 'Control Center', ko: '제어 센터' },
  spotlight: { en: 'Spotlight Search', ko: 'Spotlight 검색' },
  wifi: { en: 'Wi-Fi', ko: 'Wi-Fi' },
  wifiOff: { en: 'Wi-Fi: Off', ko: 'Wi-Fi: 끔' },
  wifiNotConnected: { en: 'Wi-Fi: Not Connected', ko: 'Wi-Fi: 연결되지 않음' },
  focus: { en: 'Focus: Do Not Disturb', ko: '집중 모드: 방해 금지 모드' },
  battery: { en: 'Battery', ko: '배터리' },
  inputEn: { en: 'Input source: ABC', ko: '입력 소스: ABC' },
  inputKo: { en: 'Input source: 2-Set Korean', ko: '입력 소스: 두벌식' },
} satisfies Record<string, LString>; /** Localized strings used by the menu bar. */

/**
 * Joins class names, skipping falsy entries.
 *
 * Lets conditional classes be written inline as `cond && styles.x`.
 *
 * @param {...(string | false | null | undefined)} c - Class names or falsy placeholders.
 * @returns {string} The truthy class names separated by single spaces.
 *
 * @example
 * cx(styles.item, isOpen && styles.active); // 'item active' while open
 */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/**
 * Returns a locale-independent key for a menu label.
 *
 * Plain strings are used as is; localized labels use their English text, so a menu keeps its
 * key when the locale changes.
 *
 * @param {LString} l - The label.
 * @returns {string} The key text.
 *
 * @example
 * labelKey({ en: 'File', ko: '파일' }); // 'File'
 */
const labelKey = (l: LString) => (typeof l === 'string' ? l : l.en);

/**
 * Prevents the default action of a mouse-down on the bar.
 *
 * Keeps clicks on the menu bar from taking keyboard focus away from the focused window or text
 * field.
 *
 * @param {MouseEvent} e - The mouse-down event.
 * @returns {void}
 *
 * @example
 * <div onMouseDown={stopFocusSteal} />
 */
const stopFocusSteal = (e: MouseEvent) => e.preventDefault();

/**
 * Tells whether an element is inside a menu bar title.
 *
 * Passed to the open Menu as `isInside`, so presses on titles are handled by the titles
 * themselves (toggling or switching menus) instead of closing the menu as outside presses.
 *
 * @param {Element} el - The pressed element.
 * @returns {boolean} True when `el` is within an element marked `data-menubar-title`.
 *
 * @example
 * isMenuBarTitle(titleButton); // true
 */
const isMenuBarTitle = (el: Element) => !!el.closest('[data-menubar-title]');

/**
 * Tells whether an element is inside the menu bar.
 *
 * Passed to the open Menu as `letThrough`: pressing another menu bar item while a menu is open
 * both closes the menu and reaches the item (like macOS), instead of being swallowed.
 *
 * @param {Element} el - The pressed element.
 * @returns {boolean} True when `el` is within the element marked `data-menubar`.
 *
 * @example
 * isInMenuBar(spotlightButton); // true
 */
const isInMenuBar = (el: Element) => !!el.closest('[data-menubar]');

/**
 * Serializes the parts of the window list that the menus depend on.
 *
 * Covers each window's id, title and minimized / maximized / resizable / maximizable flags,
 * separated by control characters. Used as a zustand selector, so moving or resizing a window
 * does not re-render the bar.
 *
 * @param {ReturnType<typeof useWM.getState>} s - The window manager state.
 * @returns {string} A signature that changes only when menu-relevant window fields change.
 *
 * @example
 * useWM(windowsSignature);
 */
const windowsSignature = (s: ReturnType<typeof useWM.getState>) =>
  s.windows.map((w) => `${w.id}\u0000${w.title}\u0000${+w.minimized}${+w.maximized}${+w.resizable}${+w.maximizable}`).join('\u0001');

/**
 * Tells whether something other than the menu bar owns the keyboard.
 *
 * While it does, ⌃F2 and the shortcut title blink stay off. That is the case for a shell overlay
 * outside the bar (Spotlight, Launchpad, Mission Control, Force Quit, the app switcher, a context
 * menu), a system alert or panel (a dialog with no `windowId`, or whose window is gone), or a
 * sheet on the focused window. Sheets are document-modal: a sheet on a background window, or on
 * any window while none is focused, leaves the bar working. The bar's own surfaces (its open
 * menu and the Control Center / Notification Center panels, which opening a menu closes) never
 * count.
 *
 * @returns {boolean} True when another surface owns the keyboard.
 *
 * @example
 * if (keyboardTaken()) return;
 */
function keyboardTaken(): boolean {
  const ui = useUI.getState();
  if (ui.spotlight || ui.launchpad || ui.missionControl || ui.forceQuit || ui.appSwitcher !== null || ui.contextMenu) return true;
  const { focusedId, windows } = useWM.getState();
  return useDialogs.getState().queue.some((d) => !d.windowId || d.windowId === focusedId || !windows.some((w) => w.id === d.windowId));
}

/** A menu in the bar: its title and the items it drops down. */
interface BarMenu {
  /** Stable identity of the menu, used for the open state and the title registry. */
  key: string;
  label: ReactNode;
  items: MenuEntry[];
  ariaLabel?: string;
  className?: string;
  /** Status menus (Battery, Wi-Fi, Focus, input source): no checkmark column, wider. */
  status?: boolean;
}

/** The open menu and where its dropdown is anchored. */
interface OpenState {
  key: string;
  /** The app that was active when it opened; switching apps closes it. */
  app: string;
  /** Opened from the keyboard → highlight the first item. */
  kb: boolean;
  /** Left edge of the title (viewport px); the dropdown's left edge goes here. */
  x: number;
  /** Right edge of the title; the dropdown's right edge goes here when it doesn't fit to the right. */
  flipX: number;
}

/**
 * Counts how many children of an element fit horizontally inside it.
 *
 * Measures in a layout effect and again whenever the container resizes (when ResizeObserver is
 * available) or `signature` changes. The caller hides the children past the count, like app
 * menus colliding with the status items. Starts at Infinity until the first measurement.
 *
 * @param {RefObject<HTMLElement | null>} ref - The container whose children are measured.
 * @param {string} signature - Changes whenever the children's widths may have changed.
 * @returns {number} Number of leading children that fit.
 *
 * @example
 * const fit = useFitCount(menusRef, `${locale}|${keys}`);
 */
function useFitCount(ref: RefObject<HTMLElement | null>, signature: string): number {
  const [count, setCount] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    /**
     * Measures the children and stores how many fit.
     *
     * Walks the children in order and stops at the first one whose right edge passes the
     * container's client width (with 1 px of tolerance).
     *
     * @returns {void}
     *
     * @example
     * measure();
     */
    const measure = () => {
      const limit = el.clientWidth;
      const kids = el.children;
      let n = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i] as HTMLElement;
        if (k.offsetLeft + k.offsetWidth > limit + 1) {
          n = i;
          break;
        }
      }
      setCount(n);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, signature]);
  return count;
}

const MISSION_CONTROL_DIM = 0.45; /** Luminance factor of Mission Control's 30% black backdrop (sRGB × 0.7 ≈ luminance × 0.45). */

const COMPACT_QUERY = '(max-width: 767.98px)'; /** Media query matching the CSS breakpoint that hides app menus and most status items. */

/**
 * Returns the media query list for the compact (phone-width) bar.
 *
 * Returns null where `window.matchMedia` is unavailable (server rendering, some test
 * environments).
 *
 * @returns {MediaQueryList | null} The list for COMPACT_QUERY, or null.
 *
 * @example
 * compactQuery()?.matches; // true on a phone
 */
const compactQuery = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null);

/**
 * Tells whether the viewport is at the compact (phone) breakpoint.
 *
 * Snapshot reader for useSyncExternalStore; false when media queries are unavailable.
 *
 * @returns {boolean} True when COMPACT_QUERY matches.
 *
 * @example
 * isCompactBar(); // false on a desktop-width window
 */
const isCompactBar = () => !!compactQuery()?.matches;

/**
 * Subscribes to changes of the compact breakpoint.
 *
 * Listens for the media query's `change` event, falling back to the legacy `addListener` API on
 * browsers without `addEventListener` on MediaQueryList; a no-op when media queries are
 * unavailable.
 *
 * @param {() => void} cb - Called whenever the query starts or stops matching.
 * @returns {() => void} Function that removes the listener.
 *
 * @example
 * const unsubscribe = subscribeCompact(() => console.log(isCompactBar()));
 */
const subscribeCompact = (cb: () => void) => {
  const mq = compactQuery();
  if (!mq) return () => {};
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  }
  mq.addListener?.(cb);
  return () => mq.removeListener?.(cb);
};

/**
 * Whether the menu bar is in its compact (phone-width) layout.
 *
 * Re-renders the caller whenever the viewport crosses the breakpoint; false during server
 * rendering.
 *
 * @returns {boolean} True on a phone-width viewport.
 *
 * @example
 * const compact = useCompactBar();
 */
const useCompactBar = () => useSyncExternalStore(subscribeCompact, isCompactBar, () => false);

/**
 * Builds the items of the app menu (the bold menu named after the active app).
 *
 * On a phone-width bar the app's other menus (File, Edit, View, Window, Help…) are hidden by CSS,
 * so they are appended to the app menu as submenus, after a separator, to stay reachable.
 * Otherwise, or when the app has no other menus, the app menu's own items are returned as is.
 *
 * @param {MenuDef} appMenu - The app menu.
 * @param {MenuDef[]} menus - The app's other menus, in bar order.
 * @param {boolean} compact - Whether the bar is in its compact layout.
 * @returns {MenuEntry[]} The items to show in the app menu.
 *
 * @example
 * appMenuItems(appMenu, menus, true); // app items, a separator, then File ▸, Edit ▸, …
 */
export function appMenuItems(appMenu: MenuDef, menus: MenuDef[], compact: boolean): MenuEntry[] {
  if (!compact || !menus.length) return appMenu.items;
  return [...appMenu.items, { separator: true }, ...menus.map((m): MenuEntry => ({ label: m.label, submenu: m.items }))];
}

/**
 * The Liquid Glass capsule drawn behind a menu title or status item.
 *
 * A decorative refracting span (bezel 8, scale 12) styled by `.capsule`: hidden at rest, shown
 * on hover and press for status items and fully while the item's menu or panel is open.
 *
 * @returns {JSX.Element} The capsule element.
 *
 * @example
 * <button className={styles.item}><GlassCapsule />File</button>
 */
function GlassCapsule() {
  const refract = useRefraction<HTMLSpanElement>({ bezel: 8, scale: 12 });
  return <span ref={refract} className={cx('lg lg-capsule', styles.capsule)} aria-hidden="true" />;
}

/**
 * The menu bar clock, which toggles Notification Center.
 *
 * Shows the date and time formatted for the locale and the 24-hour / seconds settings,
 * re-rendering on every second or minute boundary accordingly; the full date and time serve as
 * the accessible label and tooltip. A click calls `onToggle`, while an ⌥-click toggles Do Not
 * Disturb instead. Marked `data-nc-toggle` so Notification Center's outside-press handling
 * leaves it to this button.
 *
 * @param {Object} props - Clock properties.
 * @param {boolean} props.active - Whether Notification Center is open (shows the capsule).
 * @param {() => void} props.onToggle - Opens or closes Notification Center.
 * @returns {JSX.Element} The clock button.
 *
 * @example
 * <Clock active={ncOpen} onToggle={toggleNotificationCenter} />
 */
function Clock({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const locale = useLocale();
  const clock24h = useSystem((s) => s.settings.clock24h);
  const showSeconds = useSystem((s) => s.settings.showSeconds);
  const now = useNow(showSeconds ? 1000 : 60000);
  const d = new Date(now);
  const { date, time } = formatMenuClock(d, locale, { clock24h, showSeconds });
  const full = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'full', timeStyle: 'short' }).format(d);
  return (
    <button
      type="button"
      data-nc-toggle
      className={cx(styles.item, styles.status, styles.clock, active && styles.active)}
      aria-label={full}
      aria-pressed={active}
      title={full}
      onClick={(e) => {
        if (e.altKey) {
          const s = useSystem.getState();
          s.updateSettings({ doNotDisturb: !s.settings.doNotDisturb });
        } else onToggle();
      }}
    >
      <GlassCapsule />
      <span className={styles.clockDate}>{date}</span>
      <span>{time}</span>
    </button>
  );
}

/**
 * The menu bar.
 *
 * Builds the system (logo) menu, the app menu and the active app's menus from the kernel
 * (`buildMenuBar`), re-rendering when the active app, the focused window, menu-relevant window
 * fields, registered menus or the locale change. App menus that don't fit before the status
 * items are hidden but kept in the layout for measuring. On the right sit the Battery, Wi-Fi,
 * Focus (only while Do Not Disturb is on, like macOS's "Show in menu bar: When Active") and
 * input source status menus, then the Spotlight and Control Center buttons and the clock; each
 * button closes the open menu before toggling its overlay.
 *
 * The bar is transparent: its glyphs turn light or dark from the sampled wallpaper luminance
 * under it (theme as fallback), forced light while Launchpad's dark shade covers it and sampled
 * with Mission Control's dimming while that is open.
 *
 * One menu is open at a time. It remembers the app that was active when it opened and is
 * dropped for good once another app becomes active or the menu disappears; opening a menu
 * closes Control Center and Notification Center, and the menu closes when the session stops
 * being interactive. A window-level key listener, installed once, opens the system menu on ⌃F2
 * and blinks the title of the menu owning a just-used shortcut; it reads the latest render's
 * menus through a ref refreshed in a layout effect.
 *
 * @returns {JSX.Element} The bar and, while one is open, its dropdown menu.
 *
 * @example
 * <MenuBar />
 */
export function MenuBar() {
  const t = useT();
  const locale = useLocale();
  // Subscriptions: buildMenuBar() below reads these stores directly.
  const activeAppId = useWM((s) => s.activeAppId);
  useWM((s) => s.focusedId);
  useWM(windowsSignature);
  useMenus((s) => s.byWindow);
  useMenus((s) => s.byApp);

  const wifiOn = useSystem((s) => s.settings.wifi);
  const dnd = useSystem((s) => s.settings.doNotDisturb);
  const network = useWifiNetwork();
  const known = useKnownNetworks();
  const connecting = useStatus((s) => s.connecting);
  const battery = useBattery();
  const ccOpen = useUI((s) => s.controlCenter);
  const ncOpen = useUI((s) => s.notificationCenter);
  const spotlightOpen = useUI((s) => s.spotlight);
  const compact = useCompactBar();
  const isDark = useIsDark();
  const launchpadOpen = useUI((s) => s.launchpad);
  const missionControlOpen = useUI((s) => s.missionControl);
  const sampled = useWallpaperForeground(missionControlOpen ? MISSION_CONTROL_DIM : 1);
  const foreground = launchpadOpen ? 'light' : sampled ?? (isDark ? 'light' : 'dark');

  const [open, setOpen] = useState<OpenState | null>(null);
  const menusRef = useRef<HTMLDivElement>(null);
  const titles = useRef(new Map<string, HTMLElement>());

  const { appMenu, menus } = buildMenuBar();
  const appMenus: BarMenu[] = menus.map((m, i) => ({ key: `menu:${i}:${labelKey(m.label)}`, label: t(m.label), items: m.items }));
  const fit = useFitCount(menusRef, `${locale}|${appMenus.map((m) => m.key).join('|')}`);

  const pct = Math.round(battery.level * 100);
  const lowBattery = !battery.charging && battery.level <= 0.2;
  const left: BarMenu[] = [
    { key: 'logo', label: <OSLogo size={14} />, items: buildLogoMenu(), ariaLabel: t(S.systemMenu), className: styles.logo },
    { key: 'app', label: t(appMenu.label), items: appMenuItems(appMenu, menus, compact), className: styles.appName },
  ];
  const batteryMenu: BarMenu = {
    key: 'battery',
    status: true,
    className: styles.hideCompact,
    ariaLabel: `${t(S.battery)} ${pct}%`,
    items: buildBatteryMenu(battery, locale),
    label: (
      <>
        <span className={styles.pct}>{pct}%</span>
        <BatteryGlyph level={battery.level} charging={battery.charging} low={lowBattery} />
      </>
    ),
  };
  const wifiMenu: BarMenu = {
    key: 'wifi',
    status: true,
    className: styles.hideCompact,
    ariaLabel: t(!wifiOn ? S.wifiOff : network || connecting ? S.wifi : S.wifiNotConnected),
    items: buildWifiMenu({ on: wifiOn, network, connecting, known, locale }),
    label: wifiOn ? (
      <Wifi size={16} strokeWidth={2.3} className={connecting ? styles.pulse : network ? undefined : styles.dim} />
    ) : (
      <WifiOff size={16} strokeWidth={2.1} className={styles.dim} />
    ),
  };
  const focusMenu: BarMenu | null = dnd
    ? { key: 'focus', status: true, className: styles.hideCompact, ariaLabel: t(S.focus), items: buildFocusMenu(locale), label: <Moon size={14} strokeWidth={2.3} fill="currentColor" /> }
    : null;
  const inputMenu: BarMenu = {
    key: 'input',
    status: true,
    className: styles.hideCompact,
    ariaLabel: t(locale === 'ko' ? S.inputKo : S.inputEn),
    items: buildInputMenu(locale),
    label: <InputSourceGlyph letter={locale === 'ko' ? '가' : 'A'} />,
  };
  const statusMenus = [batteryMenu, wifiMenu, ...(focusMenu ? [focusMenu] : []), inputMenu];
  const all = [...left, ...appMenus, ...statusMenus];
  const current = open && open.app === activeAppId ? all.find((m) => m.key === open.key) : undefined;
  const stale = !!open && !current;
  useEffect(() => {
    if (stale) setOpen(null);
  }, [stale]);
  useCloseOnSessionEnd(!!open, () => setOpen(null));

  /**
   * Opens a menu under its title.
   *
   * Anchors the dropdown at the title's left edge (its right edge when flipping), records the
   * active app, and closes Control Center and Notification Center if either is open. Does
   * nothing when the title is not rendered.
   *
   * @param {string} key - The menu's key.
   * @param {boolean} kb - Whether it was opened from the keyboard (highlights the first item).
   * @returns {void}
   *
   * @example
   * openMenu('logo', true);
   */
  const openMenu = (key: string, kb: boolean) => {
    const el = titles.current.get(key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setOpen({ key, kb, app: activeAppId, x: r.left, flipX: r.right });
    const ui = useUI.getState();
    if (ui.controlCenter || ui.notificationCenter) ui.set({ controlCenter: false, notificationCenter: false });
  };

  /**
   * Closes the open menu.
   *
   * Clears the open state, which unmounts the dropdown on the next render.
   *
   * @returns {void}
   *
   * @example
   * close();
   */
  const close = () => setOpen(null);

  /**
   * Opens a menu, or closes it when it is already the open one.
   *
   * Pressing the open title closes its menu, like macOS; any other title opens its menu in place
   * of the current one.
   *
   * @param {string} key - The menu's key.
   * @param {boolean} kb - Whether the toggle came from the keyboard.
   * @returns {void}
   *
   * @example
   * toggle('app', false);
   */
  const toggle = (key: string, kb: boolean) => (current?.key === key ? close() : openMenu(key, kb));

  /**
   * Moves the open menu to the neighboring title (← / → inside a menu).
   *
   * Walks the visible titles in bar order, wrapping around: the logo and app menus, the app
   * menus that fit, then the status menus. On the compact (phone) bar only the logo and app
   * menus take part, since the other app menus live inside the app menu and the status menus are
   * hidden. The next menu opens as if from the keyboard. Does nothing when no menu is open or
   * there is only one title.
   *
   * @param {1 | -1} dir - 1 for the next title, -1 for the previous one.
   * @returns {void}
   *
   * @example
   * navigate(1);
   */
  const navigate = (dir: 1 | -1) => {
    if (!current) return;
    const order = (compact ? left : [...left, ...appMenus.slice(0, fit), ...statusMenus]).map((m) => m.key);
    const i = order.indexOf(current.key);
    if (i < 0 || order.length < 2) return;
    openMenu(order[(i + dir + order.length) % order.length], true);
  };

  /**
   * Closes the open menu and applies a patch to the UI store.
   *
   * Used by the Spotlight, Control Center and clock buttons to toggle their overlays.
   *
   * @param {Parameters<ReturnType<typeof useUI.getState>['set']>[0]} patch - UI flags to set.
   * @returns {void}
   *
   * @example
   * setUI({ spotlight: true, controlCenter: false, notificationCenter: false });
   */
  const setUI = (patch: Parameters<ReturnType<typeof useUI.getState>['set']>[0]) => {
    close();
    useUI.getState().set(patch);
  };

  const kb = useRef({ openLogo: () => {}, titleFor: (_e: KeyboardEvent): string | null => null });
  useLayoutEffect(() => {
    const titled: [string, MenuDef][] = [
      ['logo', { label: '', items: buildLogoMenu() }],
      ['app', appMenu],
      ...menus.map((m, i): [string, MenuDef] => [compact ? 'app' : appMenus[i].key, m]),
    ];
    kb.current = {
      /**
       * Opens the system (logo) menu with its first item highlighted.
       *
       * Called by the window key listener for ⌃F2.
       *
       * @returns {void}
       *
       * @example
       * kb.current.openLogo();
       */
      openLogo: () => openMenu('logo', true),

      /**
       * Finds the menu title that owns a keyboard shortcut.
       *
       * Searches the logo menu, the app menu and the app's other menus for an item whose
       * shortcut matches the event. On the compact bar the other app menus are folded into the
       * app menu, so their shortcuts map to the app menu's title.
       *
       * @param {KeyboardEvent} e - The key-down event.
       * @returns {string | null} Key of the owning menu, or null when no item matches.
       *
       * @example
       * kb.current.titleFor(e); // 'menu:0:File'
       */
      titleFor: (e) => titled.find(([, m]) => findShortcutItem([m], e))?.[0] ?? null,
    };
  });

  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    let check: ReturnType<typeof setTimeout> | undefined;
    let off: ReturnType<typeof setTimeout> | undefined;

    /**
     * Handles the menu bar's own keys at the window level.
     *
     * Ignores repeats and does nothing unless the session is on the desktop and nothing else owns
     * the keyboard. ⌃F2 ("Move focus to the menu bar") opens the system menu with its first item
     * highlighted. For other ⌘ / ⌃ / ⌥ combinations it looks up the menu owning the shortcut and,
     * after a zero-delay timeout that lets the shell's shortcut dispatcher run, blinks that title
     * for 150 ms only if the event was actually handled (its default prevented), like macOS.
     *
     * @param {KeyboardEvent} e - The key-down event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || useSystem.getState().power !== 'desktop' || keyboardTaken()) return;
      if (e.key === 'F2' && e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        kb.current.openLogo();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) return;
      const key = kb.current.titleFor(e);
      if (!key) return;
      check = setTimeout(() => {
        if (!e.defaultPrevented) return;
        clearTimeout(off);
        setFlash(key);
        off = setTimeout(() => setFlash(null), 150);
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(check);
      clearTimeout(off);
    };
  }, []);

  /**
   * Renders the title button of a bar menu.
   *
   * Registers the button in `titles` so menus can be anchored to it. A primary pointer-down
   * toggles the menu (press-drag-release then selects in the dropdown); hovering another title
   * with a mouse while a menu is open switches to it; keyboard activation (Enter / Space, seen
   * as a click with `detail` 0) toggles it as a keyboard open. The glass capsule shows while its
   * menu is open or while it blinks for a shortcut. Overflowing titles stay in the layout for
   * measuring but are invisible, unfocusable and hidden from assistive technology.
   *
   * @param {BarMenu} m - The menu to render a title for.
   * @param {Object} [opts={}] - Rendering options.
   * @param {boolean} [opts.hidden] - The title overflows the available space.
   * @param {boolean} [opts.menuitem] - Give the button the `menuitem` role (inside the menubar).
   * @returns {JSX.Element} The title button.
   *
   * @example
   * left.map((m) => title(m, { menuitem: true }));
   */
  const title = (m: BarMenu, opts: { hidden?: boolean; menuitem?: boolean } = {}) => {
    const isOpen = current?.key === m.key;
    return (
      <button
        key={m.key}
        ref={(el) => {
          if (el) titles.current.set(m.key, el);
          else titles.current.delete(m.key);
        }}
        type="button"
        role={opts.menuitem ? 'menuitem' : undefined}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={m.ariaLabel}
        aria-hidden={opts.hidden || undefined}
        tabIndex={opts.hidden ? -1 : undefined}
        data-menubar-title
        data-overflow={opts.hidden ? 'true' : undefined}
        className={cx(styles.item, m.className, m.status && styles.status, (isOpen || flash === m.key) && styles.active)}
        onPointerDown={(e) => {
          if (e.button === 0) toggle(m.key, false);
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse' && current && !isOpen) openMenu(m.key, false);
        }}
        onClick={(e) => {
          if (e.detail === 0) toggle(m.key, true);
        }}
      >
        <GlassCapsule />
        {typeof m.label === 'string' ? <span className={styles.text}>{m.label}</span> : m.label}
      </button>
    );
  };

  return (
    <>
      <div className={styles.bar} style={{ zIndex: Z.MENU_BAR, height: MENU_BAR_HEIGHT }} onMouseDown={stopFocusSteal} data-menubar data-foreground={foreground}>
        <div className={styles.left} role="menubar" aria-label={t(S.appMenus)}>
          {left.map((m) => title(m, { menuitem: true }))}
          <div className={styles.menus} ref={menusRef}>
            {appMenus.map((m, i) => title(m, { menuitem: true, hidden: i >= fit }))}
          </div>
        </div>
        <div className={styles.right} role="group" aria-label={t(S.statusMenus)}>
          {statusMenus.map((m) => title(m))}
          <button
            type="button"
            className={cx(styles.item, styles.status, spotlightOpen && styles.active)}
            aria-label={t(S.spotlight)}
            aria-pressed={spotlightOpen}
            title={t(S.spotlight)}
            onClick={() => setUI({ spotlight: !spotlightOpen, controlCenter: false, notificationCenter: false })}
          >
            <GlassCapsule />
            <Search size={14} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            data-cc-toggle
            className={cx(styles.item, styles.status, ccOpen && styles.active)}
            aria-label={t(S.controlCenter)}
            aria-pressed={ccOpen}
            title={t(S.controlCenter)}
            onClick={() => setUI({ controlCenter: !ccOpen, notificationCenter: false })}
          >
            <GlassCapsule />
            <ControlCenterGlyph />
          </button>
          <Clock active={ncOpen} onToggle={() => setUI({ notificationCenter: !ncOpen, controlCenter: false })} />
        </div>
      </div>

      {current && open && (
        <Menu
          key={current.key}
          items={current.items}
          x={open.x}
          y={MENU_BAR_HEIGHT + 1}
          flipX={open.flipX}
          flipY={null}
          minTop={MENU_BAR_HEIGHT}
          zIndex={Z.PANELS}
          minWidth={current.status ? 250 : 180}
          stateColumn={!current.status}
          autoHighlight={open.kb}
          onClose={close}
          onNavigate={navigate}
          isInside={isMenuBarTitle}
          letThrough={isInMenuBar}
          aria-label={current.ariaLabel ?? (typeof current.label === 'string' ? current.label : undefined)}
        />
      )}
    </>
  );
}

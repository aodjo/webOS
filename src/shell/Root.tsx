/**
 * Top-level shell: power state machine, theme/display settings, global keyboard shortcuts and
 * the composition of every shell layer.
 */
import { useEffect, useRef, useState } from 'react';
import { useSystem, useIsDark, power as powerActions } from '@/kernel/system';
import { wm, useWM } from '@/kernel/wm';
import { isPersistenceAvailable, whenFSReady } from '@/kernel/fs';
import { notify } from '@/kernel/notifications';
import { ensureSeeded } from '@/kernel/seed';
import { useDialogs } from '@/kernel/dialogs';
import { eventToShortcut, findShortcutItem, matchShortcut } from '@/kernel/menus';
import type { MenuDef } from '@/kernel/types';
import { buildGlobalShortcuts, buildLogoMenu, buildMenuBar } from '@/kernel/systemMenus';
import { APPS } from '@/apps';
import { Z } from './layers';
import { hasModalKeyOwner } from './desktop/modalKeys';

import { BootScreen } from './power/BootScreen';
import { LoginScreen } from './power/LoginScreen';
import { PowerOverlay } from './power/PowerOverlay';
import { MenuBar } from './menubar/MenuBar';
import { ContextMenuHost } from './menubar/ContextMenuHost';
import { ControlCenter } from './menubar/ControlCenter';
import { NotificationCenter, NotificationBanners } from './menubar/Notifications';
import { Dock } from './dock/Dock';
import { Launchpad } from './dock/Launchpad';
import { Spotlight } from './dock/Spotlight';
import { WindowLayer } from './windows/WindowLayer';
import { MissionControl } from './windows/MissionControl';
import { AppSwitcher } from './windows/AppSwitcher';
import { Desktop } from './desktop/Desktop';
import { DialogHost } from './desktop/Dialogs';
import { ForceQuitDialog } from './desktop/ForceQuit';

const TEXT_EDITING = new Set([
  'mod+a', 'mod+c', 'mod+v', 'mod+x', 'mod+z', 'mod+shift+z', 'mod+y',
  'mod+backspace', 'alt+backspace', 'mod+left', 'mod+right', 'mod+up', 'mod+down',
  'alt+left', 'alt+right', 'mod+shift+left', 'mod+shift+right', 'backspace', 'delete', 'enter', 'esc', 'space',
  'mod+b', 'mod+i', 'mod+u',
]); /** Shortcuts left to the browser's native text editing while an editable field has focus. */

/**
 * Tells whether an event target is a text-editable element.
 *
 * Matches `<input>`, `<textarea>`, `<select>` and any `contenteditable` element.
 *
 * @param {EventTarget | null} el - The event target to test.
 * @returns {boolean} True when the target accepts text input.
 *
 * @example
 * if (isEditable(e.target) && TEXT_EDITING.has(sc)) return;
 */
function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/**
 * Mirrors the appearance settings onto the document root.
 *
 * Tracks the host's `prefers-color-scheme` media query in the system store, then writes the
 * resolved theme, reduce-motion and reduce-transparency flags as `data-*` attributes on
 * `<html>`, sets `--accent` (with a dark `--accent-contrast` for the yellow accent, white
 * otherwise) and updates `<html lang>` from the locale.
 *
 * @returns {void}
 *
 * @example
 * useThemeSync();
 */
function useThemeSync() {
  const dark = useIsDark();
  const accent = useSystem((s) => s.settings.accent);
  const reduceMotion = useSystem((s) => s.settings.reduceMotion);
  const reduceTransparency = useSystem((s) => s.settings.reduceTransparency);
  const locale = useSystem((s) => s.settings.locale);
  const setPrefersDark = useSystem((s) => s.setPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    /**
     * Copies the current dark-mode media query result into the system store.
     *
     * Runs once on mount and on every `change` event of the media query.
     *
     * @returns {void}
     *
     * @example
     * mq.addEventListener('change', on);
     */
    const on = () => setPrefersDark(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [setPrefersDark]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.reduceMotion = String(reduceMotion);
    root.dataset.reduceTransparency = String(reduceTransparency);
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-contrast', accent === '#ffd60a' ? '#1d1d1f' : '#ffffff');
    root.lang = locale;
  }, [dark, accent, reduceMotion, reduceTransparency, locale]);
}

/**
 * Drives the power-state transitions of the system.
 *
 * - `booting`: waits for the file system to hydrate, seeds it for the current locale and then
 *   reports the boot I/O as ready.
 * - `loggingOut` / `restarting` / `shuttingDown`: after 1.1 s kills every process and moves on
 *   to `login`, `booting` or `off` respectively.
 * - `desktop` entered from `login`: starts the window-manager session, posts a notification when
 *   browser storage is unavailable, and on the first run launches Welcome after 700 ms and clears
 *   the `firstRun` flag.
 *
 * A pending transition timer is cleared when the power state changes again.
 *
 * @returns {boolean} True once the boot I/O (FS hydration and seeding) has finished.
 *
 * @example
 * const bootReady = useBootSequence();
 * return <BootScreen ready={bootReady} onDone={() => setPower('login')} />;
 */
function useBootSequence(): boolean {
  const power = useSystem((s) => s.power);
  const setPower = useSystem((s) => s.setPower);
  const prev = useRef(power);
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    const from = prev.current;
    prev.current = power;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (power === 'booting') {
      setBootReady(false);
      void whenFSReady().then(() => {
        ensureSeeded(useSystem.getState().settings.locale, APPS);
        setBootReady(true);
      });
    } else if (power === 'loggingOut' || power === 'restarting' || power === 'shuttingDown') {
      timer = setTimeout(() => {
        wm.killAll();
        setPower(power === 'loggingOut' ? 'login' : power === 'restarting' ? 'booting' : 'off');
      }, 1100);
    } else if (power === 'desktop' && from === 'login') {
      wm.startSession();
      if (!isPersistenceAvailable()) {
        notify({
          appId: 'finder',
          title: { en: 'Storage isn’t available', ko: '저장 공간을 사용할 수 없음' },
          body: {
            en: 'This browser didn’t give access to its storage, so changes made in this session won’t be saved.',
            ko: '브라우저 저장소에 접근할 수 없어 이번 세션의 변경 사항은 저장되지 않습니다.',
          },
        });
      }
      if (useSystem.getState().settings.firstRun) {
        setTimeout(() => wm.launch('welcome'), 700);
        useSystem.getState().updateSettings({ firstRun: false });
      }
    }
    return () => clearTimeout(timer);
  }, [power, setPower]);
  return bootReady;
}

/**
 * Tells whether an alert or panel currently owns the keyboard.
 *
 * True while a modal key owner is registered, while a dialog without a `windowId` (a system alert
 * or panel) is queued, while a dialog's host is not a window (e.g. Force Quit), or while a sheet
 * is attached to the focused window. Sheets are document-modal as on macOS: a sheet on a
 * background window leaves every other window's shortcuts working.
 *
 * @returns {boolean} True when global shortcuts must be ignored.
 *
 * @example
 * if (dialogOwnsKeyboard()) return;
 */
export function dialogOwnsKeyboard(): boolean {
  if (hasModalKeyOwner()) return true;
  const { focusedId, windows } = useWM.getState();
  return useDialogs.getState().queue.some((d) => !d.windowId || d.windowId === focusedId || !windows.some((w) => w.id === d.windowId));
}

const SHELL_OVERLAY = '[data-shell-overlay], [role="dialog"], [role="alertdialog"], [aria-modal="true"], aside'; /** Selector for shell overlays (Spotlight, Launchpad, Control Center, Notification Center as `aside`, Mission Control, Force Quit, system alerts) that act as their own key window. */

/**
 * Tells whether an event target sits inside a shell overlay.
 *
 * Shell overlays are their own key window, so the focused app's menu shortcuts must not reach the
 * window behind them. Matches found inside a `[data-window-id]` element (a window's own dialog or
 * sidebar) do not count.
 *
 * @param {EventTarget | null} target - The keyboard event target.
 * @returns {boolean} True when the target is inside a shell overlay outside any window.
 *
 * @example
 * if (!inShellOverlay(e.target)) menus = [...appMenus, appMenu, logo];
 */
function inShellOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const overlay = target.closest(SHELL_OVERLAY);
  return !!overlay && !overlay.closest('[data-window-id]');
}

const ACTIVATION_KEYS = new Set(['space', 'enter']); /** Shortcuts that press a focused control, so an unmodified menu shortcut must not take them. */
const ACTIVATABLE = 'button, a[href], summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'; /** Selector for focusable controls that Space / Return activate. */

/**
 * Tells whether a key press activates the focused control.
 *
 * Only Space and Return count, and only when the target is or sits inside an element matching
 * ACTIVATABLE; the shortcut dispatcher then leaves the key to that control.
 *
 * @param {EventTarget | null} target - The keyboard event target.
 * @param {string} sc - The normalized shortcut string of the event (e.g. `'space'`).
 * @returns {boolean} True for Space / Return on (or inside) a button, link, switch or similar control.
 *
 * @example
 * if (pressesControl(e.target, 'enter')) return;
 */
function pressesControl(target: EventTarget | null, sc: string): boolean {
  return ACTIVATION_KEYS.has(sc) && target instanceof Element && !!target.closest(ACTIVATABLE);
}

/**
 * Installs the global keyboard shortcut dispatcher while `enabled`.
 *
 * Every `keydown` on the window is matched in this order: ignored while a dialog owns the
 * keyboard; text-editing keys are left to a focused editable field; shell-wide shortcuts
 * (Spotlight, Launchpad, Mission Control, Show Desktop) run next; Space / Return on a focused
 * control are left to that control; finally the menu bar is searched for an item with a matching
 * shortcut. Inside a shell overlay only the logo menu's system-wide shortcuts apply; otherwise the
 * focused app's menus, its app menu and the logo menu are searched. A matched item's action runs
 * and the event is prevented and stopped.
 *
 * @param {boolean} enabled - Whether the dispatcher is installed (only on the desktop).
 * @returns {void}
 *
 * @example
 * useGlobalShortcuts(power === 'desktop');
 */
export function useGlobalShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    /**
     * Dispatches one `keydown` event to the matching global or menu shortcut.
     *
     * Applies the precedence described on useGlobalShortcuts. A matched shell-wide shortcut
     * prevents the default action; a matched menu item also stops propagation so the focused
     * window does not handle the key a second time.
     *
     * @param {KeyboardEvent} e - The window keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      if (dialogOwnsKeyboard()) return;
      const sc = eventToShortcut(e);
      if (!sc) return;
      if (isEditable(e.target) && TEXT_EDITING.has(sc)) return;
      const global = buildGlobalShortcuts().find((g) => g.shortcut && matchShortcut(e, g.shortcut));
      if (global?.action) {
        e.preventDefault();
        global.action();
        return;
      }
      if (pressesControl(e.target, sc)) return;
      const logo: MenuDef = { label: '', items: buildLogoMenu() };
      let menus = [logo];
      if (!inShellOverlay(e.target)) {
        const { appMenu, menus: appMenus } = buildMenuBar();
        menus = [...appMenus, appMenu, logo];
      }
      const item = findShortcutItem(menus, e);
      if (item?.action) {
        e.preventDefault();
        e.stopPropagation();
        item.action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

const LONG_PRESS_MS = 500; /** How long, in ms, a touch must stay down to count as a long press. */
const LONG_PRESS_SLOP = 10; /** How far, in px, a touch may move and still count as a long press. */
const LONG_PRESS_CLICK_GUARD_MS = 400; /** How long, in ms, after lifting the finger the click that ends a long press is swallowed. */

/** State of the touch currently being tracked as a possible long press. */
interface LongPress {
  /** Pointer id of the tracked touch. */
  id: number;
  /** Viewport x of the touch-down point. */
  x: number;
  /** Viewport y of the touch-down point. */
  y: number;
  /** Element under the finger; the synthesized `contextmenu` is dispatched on it. */
  target: Element;
  /** Timer that fires the long press. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** The browser fired its own `contextmenu` (Android), so none is synthesized. */
  native: boolean;
  /** The synthesized `contextmenu` has been dispatched. */
  fired: boolean;
}

/**
 * Turns a still touch long press into a `contextmenu` event while `enabled`.
 *
 * iOS Safari never fires `contextmenu` for a long press, which would leave every right-click
 * menu (Desktop, Finder, Notes, Mail…) unreachable on iPhone / iPad. Capture-phase pointer
 * listeners track the primary touch; if it stays within LONG_PRESS_SLOP px for LONG_PRESS_MS, a
 * bubbling `contextmenu` MouseEvent (button 2) is dispatched on the pressed element. When the
 * browser fires its own `contextmenu` first (Android), no event is synthesized; when it fires one
 * after ours, that duplicate is cancelled. The click produced by lifting the finger is swallowed
 * so it neither dismisses the menu nor activates the pressed item. Editable fields, open menus and
 * elements marked `data-own-longpress` are ignored.
 *
 * @param {boolean} enabled - Whether the listeners are installed (only on the desktop).
 * @returns {void}
 *
 * @example
 * useTouchContextMenu(power === 'desktop');
 */
export function useTouchContextMenu(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let press: LongPress | null = null;
    let swallowClickUntil = 0;
    let synthesizing = false;

    /**
     * Stops tracking the current press and clears its timer.
     *
     * Safe to call when nothing is tracked; it only resets the press to null then.
     *
     * @returns {void}
     *
     * @example
     * cancel();
     */
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    /**
     * Starts tracking a primary touch as a possible long press.
     *
     * Any previous press is cancelled first. Secondary pointers (a pinch or two-finger gesture)
     * are not tracked. When the timer fires on a still, connected target that the browser has not
     * already handled, it dispatches the synthesized `contextmenu` and swallows clicks until the
     * finger lifts.
     *
     * @param {PointerEvent} e - The capture-phase pointerdown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerdown', onDown, true);
     */
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      cancel();
      if (!e.isPrimary) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || isEditable(target) || target.closest('[data-own-longpress], [role="menu"]')) return;
      const p: LongPress = { id: e.pointerId, x: e.clientX, y: e.clientY, target, timer: undefined, native: false, fired: false };
      p.timer = setTimeout(() => {
        if (press !== p || p.native || !p.target.isConnected) return;
        p.fired = true;
        swallowClickUntil = Infinity;
        synthesizing = true;
        try {
          p.target.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, button: 2, buttons: 2 }),
          );
        } finally {
          synthesizing = false;
        }
      }, LONG_PRESS_MS);
      press = p;
    };
    /**
     * Cancels the pending long press when the tracked touch moves farther than LONG_PRESS_SLOP.
     *
     * Moves of other pointers are ignored, and so are moves after the long press has fired, so
     * the finger can drift while the menu is open.
     *
     * @param {PointerEvent} e - The capture-phase pointermove event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointermove', onMove, true);
     */
    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id || press.fired) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) cancel();
    };
    /**
     * Ends the tracked touch.
     *
     * When the long press already fired, clicks keep being swallowed for
     * LONG_PRESS_CLICK_GUARD_MS so the release does not act on the menu or the pressed item.
     *
     * @param {PointerEvent} e - The capture-phase pointerup or pointercancel event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerup', onUp, true);
     */
    const onUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      if (press.fired) swallowClickUntil = performance.now() + LONG_PRESS_CLICK_GUARD_MS;
      cancel();
    };
    /**
     * Reconciles the browser's own `contextmenu` with the synthesized one.
     *
     * Ignores the synthesized event itself. A native event arriving after ours is cancelled and
     * stopped so the menu opens only once; one arriving before ours marks the press as native and
     * stops its timer.
     *
     * @param {MouseEvent} e - The capture-phase contextmenu event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('contextmenu', onContextMenu, true);
     */
    const onContextMenu = (e: MouseEvent) => {
      if (synthesizing || !press) return;
      if (press.fired) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      press.native = true;
      clearTimeout(press.timer);
    };
    /**
     * Swallows the single click that ends a long press.
     *
     * While the swallow window is open, the next click is prevented and stopped before any other
     * listener sees it, and the window is closed so later clicks pass through.
     *
     * @param {MouseEvent} e - The capture-phase click event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('click', onClick, true);
     */
    const onClick = (e: MouseEvent) => {
      if (performance.now() >= swallowClickUntil) return;
      swallowClickUntil = 0;
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('click', onClick, true);
    return () => {
      cancel();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [enabled]);
}

/**
 * Full-screen overlays that emulate display brightness and Night Shift.
 *
 * Below full brightness a black layer with opacity `(1 - brightness) * 0.85` dims the screen;
 * Night Shift adds an orange layer blended with `multiply`. Both ignore pointer events.
 *
 * @returns {JSX.Element} The filter layers (empty when neither setting applies).
 *
 * @example
 * <DisplayFilters />
 */
function DisplayFilters() {
  const brightness = useSystem((s) => s.settings.brightness);
  const nightShift = useSystem((s) => s.settings.nightShift);
  return (
    <>
      {brightness < 1 && <div style={{ position: 'fixed', inset: 0, background: '#000', opacity: (1 - brightness) * 0.85, pointerEvents: 'none', zIndex: Z.DISPLAY_FILTER }} />}
      {nightShift && <div style={{ position: 'fixed', inset: 0, background: 'rgba(255, 140, 0, 0.16)', mixBlendMode: 'multiply', pointerEvents: 'none', zIndex: Z.DISPLAY_FILTER }} />}
    </>
  );
}

/**
 * The root of the shell.
 *
 * Syncs the theme, runs the boot sequence and, on the desktop, installs the global shortcut
 * dispatcher and the touch long-press menu. The window manager relayouts on viewport resizes and
 * whenever the Dock size, position or autohide setting changes. The session layers (desktop,
 * windows, Dock, menu bar, overlays, dialogs) stay mounted while locked, asleep or powering down
 * and are made `inert` outside the desktop state; the boot, login/lock and power screens and the
 * display filters are drawn above them. The browser's own context menu is suppressed everywhere.
 *
 * @returns {JSX.Element} The full-screen shell.
 *
 * @example
 * createRoot(document.getElementById('root')!).render(<Root />);
 */
export function Root() {
  const power = useSystem((s) => s.power);
  const setPower = useSystem((s) => s.setPower);
  useThemeSync();
  const bootReady = useBootSequence();
  useGlobalShortcuts(power === 'desktop');
  useTouchContextMenu(power === 'desktop');

  useEffect(() => {
    /**
     * Relayouts the windows after the viewport changed size.
     *
     * Calls `wm.relayout()`, which re-fits maximized, tiled and floating windows to the new work
     * area.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('resize', onResize);
     */
    const onResize = () => wm.relayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const dockKey = useSystem((s) => `${s.settings.dockSize}|${s.settings.dockPosition}|${s.settings.dockAutohide}`);
  useEffect(() => wm.relayout(), [dockKey]);

  const sessionVisible = power === 'desktop' || power === 'locked' || power === 'sleep' || power === 'loggingOut' || power === 'restarting' || power === 'shuttingDown';

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#000' }} onContextMenu={(e) => e.preventDefault()}>
      {sessionVisible && (
        <div style={{ position: 'absolute', inset: 0 }} inert={power !== 'desktop' ? true : undefined}>
          <Desktop />
          <WindowLayer />
          <MissionControl />
          <Launchpad />
          <Dock />
          <MenuBar />
          <NotificationBanners />
          <ControlCenter />
          <NotificationCenter />
          <Spotlight />
          <AppSwitcher />
          <ForceQuitDialog />
          <DialogHost />
          <ContextMenuHost />
        </div>
      )}

      {power === 'booting' && <BootScreen ready={bootReady} onDone={() => setPower('login')} />}
      {(power === 'login' || power === 'locked') && <LoginScreen mode={power === 'login' ? 'login' : 'locked'} onUnlock={() => setPower('desktop')} />}
      <PowerOverlay power={power} onWake={() => setPower('locked')} onPowerOn={powerActions.powerOn} />
      <DisplayFilters />
    </div>
  );
}

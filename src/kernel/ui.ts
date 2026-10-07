/**
 * Transient shell UI state (overlays, menus, panels), Dock badges and Dock anchor rectangles.
 * Nothing here is persisted.
 */
import { create } from 'zustand';
import type { MenuItem } from './types';
import { useDialogs } from './dialogs';

/** An open context menu: its screen position and items. */
export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** State held by the shell UI store: one flag per overlay plus its setters. */
interface UIState {
  spotlight: boolean;
  launchpad: boolean;
  missionControl: boolean;
  controlCenter: boolean;
  notificationCenter: boolean;
  /** Force Quit Applications dialog. */
  forceQuit: boolean;
  /** Alt+Tab app switcher (index of highlighted app, or null when closed). */
  appSwitcher: number | null;
  contextMenu: ContextMenuState | null;
  /** Show Desktop: every window slides off screen (toggled with F11). */
  showDesktop: boolean;

  /** Merge a patch into the overlay flags. */
  set: (patch: Partial<Omit<UIState, 'set' | 'closeOverlays'>>) => void;
  /** Close every transient overlay (Esc / click on desktop). */
  closeOverlays: () => void;
}

export const useUI = create<UIState>()((set) => ({
  spotlight: false,
  launchpad: false,
  missionControl: false,
  controlCenter: false,
  notificationCenter: false,
  forceQuit: false,
  appSwitcher: null,
  contextMenu: null,
  showDesktop: false,
  /**
   * Merges a partial patch into the overlay flags.
   *
   * Thin wrapper over zustand's `set`, exposed on the state so components can toggle overlays
   * without importing the store's setter.
   *
   * @param {Partial<Omit<UIState, 'set' | 'closeOverlays'>>} patch - Flags to change.
   * @returns {void}
   *
   * @example
   * useUI.getState().set({ spotlight: true });
   */
  set: (patch) => set(patch),
  /**
   * Closes every transient overlay.
   *
   * Turns off Spotlight, Launchpad, Mission Control, Control Center, Notification Center, the
   * context menu, the app switcher and Show Desktop. The Force Quit dialog is left as it is.
   *
   * @returns {void}
   *
   * @example
   * useUI.getState().closeOverlays();
   */
  closeOverlays: () =>
    set({
      spotlight: false,
      launchpad: false,
      missionControl: false,
      controlCenter: false,
      notificationCenter: false,
      contextMenu: null,
      appSwitcher: null,
      showDesktop: false,
    }),
})); /** Store of the shell's transient overlay flags (Spotlight, Launchpad, menus, panels…). */

/**
 * Reports whether a shell overlay currently owns the keyboard.
 *
 * True while a dialog, context menu, Spotlight, Launchpad, Mission Control, Control Center,
 * Notification Center, the Force Quit dialog or the app switcher is open; app key handlers must
 * ignore keys while it is. Without `windowId` any queued dialog counts. With `windowId`, only
 * system alerts and sheets attached to that window count, so a sheet on another window blocks
 * only its own window, like macOS sheets.
 *
 * @param {string} [windowId] - Window asking; sheets attached to other windows are ignored.
 * @returns {boolean} True when keyboard input should be ignored by the app.
 *
 * @example
 * if (keyboardBusy(windowId)) return;
 */
export function keyboardBusy(windowId?: string): boolean {
  const ui = useUI.getState();
  const queue = useDialogs.getState().queue;
  return (
    (windowId === undefined ? queue.length > 0 : queue.some((q) => !q.windowId || q.windowId === windowId)) ||
    !!ui.contextMenu ||
    ui.spotlight ||
    ui.launchpad ||
    ui.missionControl ||
    ui.controlCenter ||
    ui.notificationCenter ||
    ui.forceQuit ||
    ui.appSwitcher !== null
  );
}

/**
 * Opens a context menu at the mouse position.
 *
 * Meant to be called from `onContextMenu` handlers: it prevents the browser's own menu, stops the
 * event from reaching outer handlers (when the event supports it) and stores the menu with the
 * event's client coordinates.
 *
 * @param {Object} e - The mouse event (React or DOM).
 * @param {number} e.clientX - Horizontal position of the pointer.
 * @param {number} e.clientY - Vertical position of the pointer.
 * @param {() => void} e.preventDefault - Suppresses the browser's context menu.
 * @param {() => void} [e.stopPropagation] - Stops outer handlers from opening their own menu.
 * @param {MenuItem[]} items - Items of the menu.
 * @returns {void}
 *
 * @example
 * <div onContextMenu={(e) => showContextMenu(e, [{ label: 'Open', action: open }])} />
 */
export function showContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation?.();
  useUI.getState().set({ contextMenu: { x: e.clientX, y: e.clientY, items } });
}

/**
 * Closes the open context menu.
 *
 * Clears the context menu state; does nothing visible when no menu is open.
 *
 * @returns {void}
 *
 * @example
 * closeContextMenu();
 */
export function closeContextMenu(): void {
  useUI.getState().set({ contextMenu: null });
}

/* ───────────────────────── Dock badges ───────────────────────── */

interface BadgeState {
  badges: Record<string, string>;
}

export const useBadges = create<BadgeState>()(() => ({ badges: {} })); /** Red badges on Dock icons (e.g. Mail unread count), keyed by app id. */

/**
 * Sets or clears the badge on an app's Dock icon.
 *
 * Any non-empty value is stored as a string. `null`, `0` and `''` remove the badge.
 *
 * @param {string} appId - App whose Dock icon gets the badge.
 * @param {string | number | null} value - Badge text or count; `null`, `0` or `''` clears it.
 * @returns {void}
 *
 * @example
 * setDockBadge('mail', 3);
 * setDockBadge('mail', null);
 */
export function setDockBadge(appId: string, value: string | number | null): void {
  useBadges.setState((s) => {
    const badges = { ...s.badges };
    if (value === null || value === 0 || value === '') delete badges[appId];
    else badges[appId] = String(value);
    return { badges };
  });
}

export const dockAnchors = new Map<string, DOMRect>(); /** Dock item rects (keys: app id, `win:<windowId>`, 'trash') that windows animate to and from. */

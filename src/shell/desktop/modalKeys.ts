/**
 * Keyboard routing for modal UI (alerts, sheets, file panels, Force Quit).
 *
 * Every visible panel that should receive keys registers an entry. The highest-priority (then most
 * recent) entry sees each keydown first, in the capture phase, so Return / Esc / Tab never leak to
 * the app behind a modal, and keystrokes typed inside a panel never reach window-level app
 * handlers (Finder arrow keys, Terminal…).
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useSystem, useUI } from '@/kernel';

export const KEY_PRIORITY = {
  sheet: 1,
  forceQuit: 2,
  forceQuitSheet: 3,
  system: 4,
} as const; /** Key-routing priorities; a higher value receives keys first, and `system` (app-modal alerts) stays above the shell's overlays. */

/** A registered key receiver. */
interface Entry {
  /** Registration sequence number; breaks priority ties in favour of the newest entry. */
  id: number;
  /** Routing priority (one of `KEY_PRIORITY`). */
  priority: number;
  /** Modal entries trap Tab and swallow keys aimed at anything outside the panel. */
  modal: boolean;
  /** Returns the panel element (null while it is not mounted). */
  panel: () => HTMLElement | null;
  /** Return true when the key was handled (it is then prevented and stopped). */
  onKey: (e: KeyboardEvent) => boolean;
}

const entries: Entry[] = []; /** Currently registered key receivers. */
let seq = 0; /** Last assigned entry id. */

/**
 * Returns the entry that receives keys first.
 *
 * The highest priority wins; among equal priorities the most recently registered entry wins.
 *
 * @returns {Entry | undefined} The top entry, or undefined when none is registered.
 *
 * @example
 * const entry = topEntry();
 * if (entry) entry.onKey(e);
 */
function topEntry(): Entry | undefined {
  let best: Entry | undefined;
  for (const e of entries) if (!best || e.priority > best.priority || (e.priority === best.priority && e.id > best.id)) best = e;
  return best;
}

/**
 * Tells whether an event target accepts typed text.
 *
 * Checks the target's tag name for INPUT, TEXTAREA and SELECT, and its `isContentEditable` flag;
 * a null target is never editable.
 *
 * @param {EventTarget | null} t - The event target.
 * @returns {boolean} True for inputs, textareas, selects and contenteditable elements.
 *
 * @example
 * if (isEditable(e.target)) e.preventDefault();
 */
function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'; /** Selector for elements Tab can move focus to inside a panel. */

/**
 * Moves focus to the next or previous focusable element inside a panel, wrapping around.
 *
 * Only enabled, rendered elements outside `[inert]` subtrees are considered. When focus is not
 * on one of them, Tab goes to the first and Shift+Tab to the last. A panel without focusable
 * elements receives focus itself.
 *
 * @param {HTMLElement} panel - The panel that traps focus.
 * @param {boolean} back - True for Shift+Tab (move backwards).
 * @returns {void}
 *
 * @example
 * trapTab(panel, e.shiftKey);
 */
function trapTab(panel: HTMLElement, back: boolean): void {
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
  if (!items.length) {
    panel.focus({ preventScroll: true });
    return;
  }
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = back ? (i <= 0 ? items.length - 1 : i - 1) : i === -1 || i === items.length - 1 ? 0 : i + 1;
  items[next].focus({ preventScroll: true });
}

/**
 * Tells whether a menu is tracking.
 *
 * Menus (menu bar, status item, context or popup menu) never take focus but own the keys while
 * they are open; one is open whenever an element with `role="menu"` is in the document.
 *
 * @returns {boolean} True while a menu is open.
 *
 * @example
 * if (menuOpen()) return;
 */
function menuOpen(): boolean {
  return !!document.querySelector('[role="menu"]');
}

/**
 * Tells whether a shell overlay above the windows owns this key.
 *
 * Spotlight, Launchpad, Mission Control and open menus own the keyboard while they are up, even
 * when a window below them has a sheet: typing goes to Spotlight, Return opens its hit and Esc
 * closes the menu instead of answering the hidden sheet. Control Center and Notification Center
 * only claim Esc, which closes them before anything below. Any other focused `aria-modal`
 * surface outside the windows (e.g. Spotlight while it animates out) also owns the key, unless
 * it is the given panel or nested with it.
 *
 * @param {KeyboardEvent} e - The keydown event.
 * @param {HTMLElement | null} panel - The top entry's panel, if mounted.
 * @returns {boolean} True when the key belongs to a shell overlay.
 *
 * @example
 * if (overlayOwnsKeys(e, entry.panel())) return;
 */
function overlayOwnsKeys(e: KeyboardEvent, panel: HTMLElement | null): boolean {
  const ui = useUI.getState();
  if (ui.spotlight || ui.launchpad || ui.missionControl) return true;
  if ((ui.controlCenter || ui.notificationCenter) && e.key === 'Escape') return true;
  if (menuOpen()) return true;
  const t = e.target;
  if (t instanceof Element) {
    const modal = t.closest('[aria-modal="true"]');
    if (modal && !t.closest('[data-window-id]') && !(panel && (panel === modal || panel.contains(modal) || modal.contains(panel)))) return true;
  }
  return false;
}

/**
 * Capture-phase keydown handler that routes keys to the top entry.
 *
 * Keys are left alone when no entry is registered, the event was already handled, the lock
 * screen or another power overlay is up (it owns the keyboard), an IME is composing (so Return
 * finishes Korean input instead of meaning "OK"; keyCode 229 covers browsers that report
 * composition that way), or a popup menu opened from a panel (e.g. the "Where" popup) is open.
 * Entries below `KEY_PRIORITY.system` (sheets, Force Quit) also yield to shell overlays, while
 * app-modal alerts stay on top. Otherwise the entry's `onKey` runs; a handled key is prevented
 * and stopped. For modal entries, Tab is trapped inside the panel, and keys aimed outside the
 * panel are stopped (and prevented when the target is editable, so nothing is typed into the
 * window behind).
 *
 * @param {KeyboardEvent} e - The keydown event.
 * @returns {void}
 *
 * @example
 * window.addEventListener('keydown', onKeyCapture, true);
 */
function onKeyCapture(e: KeyboardEvent): void {
  const entry = topEntry();
  if (!entry || e.defaultPrevented) return;
  if (useSystem.getState().power !== 'desktop') return;
  if (e.isComposing || e.keyCode === 229) return;
  if (useUI.getState().contextMenu) return;
  const panel = entry.panel();
  if (entry.priority < KEY_PRIORITY.system && overlayOwnsKeys(e, panel)) return;
  const inside = !!panel && e.target instanceof Node && panel.contains(e.target);
  if (entry.onKey(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (!entry.modal || !panel) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    e.stopImmediatePropagation();
    trapTab(panel, e.shiftKey);
    return;
  }
  if (!inside) {
    e.stopImmediatePropagation();
    if (isEditable(e.target)) e.preventDefault();
  }
}

/**
 * Bubble-phase keydown handler that keeps panel keystrokes away from window-level shortcuts.
 *
 * Stops keys typed inside a `[data-modal-panel]` element at the document, before they reach
 * app handlers registered on the window. Keys a shell overlay owns (e.g. the Esc that dismisses
 * Control Center or Notification Center above a sheet) are let through.
 *
 * @param {KeyboardEvent} e - The keydown event.
 * @returns {void}
 *
 * @example
 * document.addEventListener('keydown', onKeyBubble);
 */
function onKeyBubble(e: KeyboardEvent): void {
  const entry = topEntry();
  if (entry && entry.priority < KEY_PRIORITY.system && overlayOwnsKeys(e, entry.panel())) return;
  const t = e.target as Element | null;
  if (t?.closest?.('[data-modal-panel]')) e.stopPropagation();
}

/**
 * Registers a key receiver.
 *
 * The first registration installs the global capture and bubble keydown listeners.
 *
 * @param {Entry} entry - The entry to register.
 * @returns {void}
 *
 * @example
 * add({ id: ++seq, priority: KEY_PRIORITY.sheet, modal: true, panel: () => ref.current, onKey });
 */
function add(entry: Entry): void {
  if (!entries.length) {
    window.addEventListener('keydown', onKeyCapture, true);
    document.addEventListener('keydown', onKeyBubble);
  }
  entries.push(entry);
}

/**
 * Unregisters a key receiver.
 *
 * Removing the last entry also removes the global keydown listeners. Unknown entries are
 * ignored.
 *
 * @param {Entry} entry - The entry to remove.
 * @returns {void}
 *
 * @example
 * remove(entry);
 */
function remove(entry: Entry): void {
  const i = entries.indexOf(entry);
  if (i >= 0) entries.splice(i, 1);
  if (!entries.length) {
    window.removeEventListener('keydown', onKeyCapture, true);
    document.removeEventListener('keydown', onKeyBubble);
  }
}

/**
 * Tells whether a modal entry currently owns the keyboard.
 *
 * True while any modal entry is registered (an alert, the sheet of the focused window or a file
 * panel); callers use it to suppress their own shortcuts.
 *
 * @returns {boolean} True when a modal entry is registered.
 *
 * @example
 * if (hasModalKeyOwner()) return;
 */
export function hasModalKeyOwner(): boolean {
  return entries.some((e) => e.modal);
}

/**
 * Routes keyboard input to a panel while `enabled`.
 *
 * Registers an entry when enabled and unregisters it on disable or unmount; changing `priority`,
 * `modal` or `panel` re-registers it as the newest entry. `onKey` is read through a ref updated
 * after every render, so it always sees the latest closure without re-registering.
 *
 * @param {Object} opts - Routing options.
 * @param {boolean} opts.enabled - Whether the panel currently receives keys.
 * @param {number} opts.priority - Routing priority (one of `KEY_PRIORITY`).
 * @param {boolean} opts.modal - Whether to trap Tab and swallow keys aimed outside the panel.
 * @param {RefObject<HTMLElement | null>} opts.panel - Ref to the panel element.
 * @param {(e: KeyboardEvent) => boolean} opts.onKey - Key handler; returns true when it handled the key.
 * @returns {void}
 *
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * useModalKeys({ enabled: open, priority: KEY_PRIORITY.sheet, modal: true, panel: ref, onKey: handleKey });
 */
export function useModalKeys(opts: { enabled: boolean; priority: number; modal: boolean; panel: RefObject<HTMLElement | null>; onKey: (e: KeyboardEvent) => boolean }): void {
  const { enabled, priority, modal, panel } = opts;
  const onKeyRef = useRef(opts.onKey);
  useLayoutEffect(() => {
    onKeyRef.current = opts.onKey;
  });
  useEffect(() => {
    if (!enabled) return;
    const entry: Entry = { id: ++seq, priority, modal, panel: () => panel.current, onKey: (e) => onKeyRef.current(e) };
    add(entry);
    return () => remove(entry);
  }, [enabled, priority, modal, panel]);
}

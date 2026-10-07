/**
 * App menus shown in the menu bar, registered per window. The global keyboard handler also
 * uses these to dispatch shortcuts to the focused window.
 */
import { create } from 'zustand';
import type { MenuDef, MenuItem } from './types';

interface MenusState {
  /** Menus registered by each window (keyed by window id). */
  byWindow: Record<string, MenuDef[]>;
  /** Menus for an active app that has no focused window (keyed by app id). */
  byApp: Record<string, MenuDef[]>;
}

export const useMenus = create<MenusState>()(() => ({ byWindow: {}, byApp: {} })); /** Store of the menus registered per window and per app, read by the menu bar and the shortcut dispatcher. */

/**
 * Registers or removes the menus of a window.
 *
 * Replaces the window's entry in the menus store with a new object so subscribers re-render;
 * passing `null` deletes the entry (used when the window unmounts).
 *
 * @param {string} windowId - Id of the window the menus belong to.
 * @param {MenuDef[] | null} menus - Menus to register, or null to remove the window's menus.
 * @returns {void}
 *
 * @example
 * setWindowMenus('w1', [{ label: 'View', items: [] }]);
 * setWindowMenus('w1', null);
 */
export function setWindowMenus(windowId: string, menus: MenuDef[] | null): void {
  useMenus.setState((s) => {
    const byWindow = { ...s.byWindow };
    if (menus) byWindow[windowId] = menus;
    else delete byWindow[windowId];
    return { byWindow };
  });
}

/* ───────────────────────── Shortcuts ───────────────────────── */

export const isMacHost = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); /** True when the host is an Apple platform, where "mod" means ⌘ instead of Ctrl. */

/**
 * Converts a KeyboardEvent to the shortcut syntax used in `MenuItem.shortcut`.
 *
 * Produces strings such as "mod+shift+s", "alt+w", "backspace" or "f3", with modifiers in the
 * canonical order mod, ctrl, alt, shift. "mod" is ⌘ on Mac hosts and Ctrl elsewhere; on Mac a
 * held Ctrl is reported separately as "ctrl". Letters and digits are taken from the physical key
 * (`e.code`) so ⌥/⇧ combinations still match even when they type a different character. Bare
 * modifier presses and AltGr-composed characters return an empty string.
 *
 * @param {KeyboardEvent} e - The keyboard event to normalize.
 * @returns {string} The normalized shortcut, or '' when the press is not a shortcut.
 *
 * @example
 * window.addEventListener('keydown', (e) => console.log(eventToShortcut(e))); // "mod+shift+s"
 */
export function eventToShortcut(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  if (['meta', 'control', 'shift', 'alt', 'os', 'altgraph'].includes(key)) return '';
  if (isAltGraphChar(e)) return '';
  const parts: string[] = [];
  const mod = isMacHost ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('mod');
  if (isMacHost && e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  let k = key;
  if (e.code?.startsWith('Key')) k = e.code.slice(3).toLowerCase();
  else if (e.code?.startsWith('Digit')) k = e.code.slice(5);
  else if (key === ' ') k = 'space';
  else if (key === 'arrowup') k = 'up';
  else if (key === 'arrowdown') k = 'down';
  else if (key === 'arrowleft') k = 'left';
  else if (key === 'arrowright') k = 'right';
  else if (key === 'escape') k = 'esc';
  else if (e.code === 'Backquote') k = '`';
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Period') k = '.';
  else if (e.code === 'Equal') k = '=';
  else if (e.code === 'Minus') k = '-';
  parts.push(k);
  return parts.join('+');
}

/**
 * Detects a Ctrl+Alt press that is really AltGr typing a character.
 *
 * Off macOS, AltGr is reported as Ctrl+Alt: AltGr+S types "ś" on a Polish keyboard and AltGr+Q
 * types "@" on a German one. Such presses produce a character and are never shortcuts. The
 * `AltGraph` modifier state is trusted when available; otherwise a printable key that differs
 * from the physical key (`e.code`) means a character was composed, while a real Ctrl+Alt+S still
 * reports "s". Non-Latin letters (Cyrillic, Greek…) are not treated as composed, because those
 * layouts report their own base letter for plain Ctrl+Alt+key. Always false on Mac hosts.
 *
 * @param {KeyboardEvent} e - The keyboard event to inspect.
 * @returns {boolean} True if the press composes a character via AltGr.
 *
 * @example
 * if (isAltGraphChar(e)) return ''; // let the character be typed
 */
function isAltGraphChar(e: KeyboardEvent): boolean {
  if (isMacHost || !e.ctrlKey || !e.altKey || e.metaKey) return false;
  if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) return true;
  if (e.key.length !== 1 || !e.code) return false;
  if (/\p{L}/u.test(e.key) && !/\p{Script=Latin}/u.test(e.key)) return false;
  if (e.code.startsWith('Key')) return e.key.toLowerCase() !== e.code.slice(3).toLowerCase();
  if (e.code.startsWith('Digit') && !e.shiftKey) return e.key !== e.code.slice(5);
  return false;
}

/**
 * Normalizes a shortcut string to its canonical form.
 *
 * Lowercases it and reorders the modifiers to mod, ctrl, alt, shift so that "shift+mod+S" equals
 * "mod+shift+s". Off macOS the Ctrl key is the "mod" key, so a declared "ctrl" is rewritten to
 * "mod" (both mean the same physical keys there).
 *
 * @param {string} s - Shortcut as declared, e.g. "shift+mod+S".
 * @returns {string} The canonical shortcut string.
 *
 * @example
 * canonicalShortcut('shift+mod+S'); // "mod+shift+s"
 */
export function canonicalShortcut(s: string): string {
  const parts = s.toLowerCase().split('+');
  const key = parts.pop()!;
  if (!isMacHost) for (let i = 0; i < parts.length; i++) if (parts[i] === 'ctrl') parts[i] = 'mod';
  const order = ['mod', 'ctrl', 'alt', 'shift'];
  const mods = order.filter((m) => parts.includes(m));
  return [...mods, key].join('+');
}

/**
 * Checks whether a keyboard event triggers a declared shortcut.
 *
 * Compares the normalized event with the canonical form of the shortcut; bare modifier and AltGr
 * presses never match.
 *
 * @param {KeyboardEvent} e - The keyboard event.
 * @param {string} shortcut - The shortcut to test, e.g. "mod+s".
 * @returns {boolean} True if the event matches the shortcut.
 *
 * @example
 * if (matchShortcut(e, 'mod+s')) save();
 */
export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const ev = eventToShortcut(e);
  return !!ev && ev === canonicalShortcut(shortcut);
}

/**
 * Formats a shortcut for display in menus.
 *
 * On Mac hosts modifiers become symbols in macOS order (⌃ ⌥ ⇧ ⌘) followed by the key, e.g.
 * "⇧⌘S"; elsewhere they are spelled out and joined with "+", e.g. "Ctrl+Shift+S". Special keys
 * (backspace, delete, enter, esc, tab, arrows) are shown as symbols, space as "Space", and other
 * keys are uppercased.
 *
 * @param {string} shortcut - Shortcut string, e.g. "mod+shift+s".
 * @returns {string} The human-readable label.
 *
 * @example
 * formatShortcut('mod+shift+s'); // "⇧⌘S" on macOS, "Ctrl+Shift+S" elsewhere
 */
export function formatShortcut(shortcut: string): string {
  const parts = canonicalShortcut(shortcut).split('+');
  const key = parts.pop()!;
  const keyLabel: Record<string, string> = {
    backspace: '⌫',
    delete: '⌦',
    enter: '↩',
    esc: '⎋',
    tab: '⇥',
    space: 'Space',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
  };
  const k = keyLabel[key] ?? (key.length === 1 ? key.toUpperCase() : key.toUpperCase());
  if (isMacHost) {
    const sym: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' };
    const order = ['ctrl', 'alt', 'shift', 'mod'];
    return order.filter((m) => parts.includes(m)).map((m) => sym[m]).join('') + k;
  }
  const names: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  return [...parts.map((m) => names[m]), k].join('+');
}

/**
 * Finds the menu item a keyboard event should trigger.
 *
 * Searches the menus depth-first (submenus before the item that owns them) and returns the first
 * item that has a matching shortcut, an action and is not disabled.
 *
 * @param {MenuDef[]} menus - The menus to search, in menu bar order.
 * @param {KeyboardEvent} e - The keyboard event.
 * @returns {MenuItem | null} The matching item, or null if none matches.
 *
 * @example
 * const item = findShortcutItem(menus, e);
 * item?.action?.();
 */
export function findShortcutItem(menus: MenuDef[], e: KeyboardEvent): MenuItem | null {
  /**
   * Searches a list of menu items and their submenus for a matching item.
   *
   * Recurses into each item's submenu before testing the item itself.
   *
   * @param {MenuItem[]} items - The items to search.
   * @returns {MenuItem | null} The first enabled item whose shortcut matches, or null.
   *
   * @example
   * const hit = visit(menu.items);
   */
  const visit = (items: MenuItem[]): MenuItem | null => {
    for (const it of items) {
      if (it.submenu) {
        const r = visit(it.submenu);
        if (r) return r;
      }
      if (it.shortcut && !it.disabled && it.action && matchShortcut(e, it.shortcut)) return it;
    }
    return null;
  };
  for (const m of menus) {
    const r = visit(m.items);
    if (r) return r;
  }
  return null;
}

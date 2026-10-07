/**
 * Context menu host: renders the menu requested through `showContextMenu` (kernel/ui) at the pointer.
 */
import { useUI, closeContextMenu } from '@/kernel/ui';
import { useT } from '@/kernel/i18n';
import { MENU_BAR_HEIGHT } from '@/kernel/constants';
import { Menu } from '@/components/Menu';
import { Z } from '../layers';
import { useCloseOnSessionEnd } from './hooks';

const S = { label: { en: 'Context menu', ko: '컨텍스트 메뉴' } }; /** Localized strings used by the context menu host. */

const keys = new WeakMap<object, number>(); /** Numeric key assigned to each showContextMenu() request object. */
let seq = 0; /** Last key handed out by keyOf(). */

/**
 * Returns a stable numeric key for an object.
 *
 * The first call for an object takes the next value of a module-wide counter and remembers it in
 * a WeakMap; later calls return the same number. Used as the Menu's React key, so a new
 * context-menu request remounts the menu with fresh highlight and submenu state while
 * re-renders of the same request keep it.
 *
 * @param {object} o - The object to key (a context-menu request).
 * @returns {number} A positive integer unique to `o` for its lifetime.
 *
 * @example
 * const key = keyOf(request);
 * keyOf(request) === key; // true
 */
function keyOf(o: object): number {
  let k = keys.get(o);
  if (k === undefined) {
    k = ++seq;
    keys.set(o, k);
  }
  return k;
}

/**
 * Renders the context menu currently requested in the UI store.
 *
 * Reads `contextMenu` from `useUI` and, when it has items, shows a Menu one pixel right of and
 * below the requested point, kept under the menu bar and stacked at `Z.CONTEXT_MENU`. The Menu
 * closes itself on an outside pointer-down (consuming that click, like macOS), Escape, window
 * blur or resize, a wheel gesture outside it, or after an item is chosen. Its `onClose` only calls
 * `closeContextMenu` while the store still holds the same request, so a newer request that
 * replaced it stays open. The menu is also closed when the session stops being interactive
 * (lock, sleep, log out).
 *
 * @returns {JSX.Element | null} The context menu, or null when nothing (or an empty menu) is requested.
 *
 * @example
 * <ContextMenuHost />
 */
export function ContextMenuHost() {
  const t = useT();
  const menu = useUI((s) => s.contextMenu);
  useCloseOnSessionEnd(!!menu, closeContextMenu);
  if (!menu || !menu.items.length) return null;
  return (
    <Menu
      key={keyOf(menu)}
      items={menu.items}
      x={menu.x + 1}
      y={menu.y + 1}
      minTop={MENU_BAR_HEIGHT}
      zIndex={Z.CONTEXT_MENU}
      minWidth={180}
      onClose={() => {
        if (useUI.getState().contextMenu === menu) closeContextMenu();
      }}
      aria-label={t(S.label)}
    />
  );
}

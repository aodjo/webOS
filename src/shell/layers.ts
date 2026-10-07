export const Z = {
  DESKTOP: 0,
  WINDOWS: 10,
  SHOW_DESKTOP: 3000,
  MISSION_CONTROL: 4000,
  LAUNCHPAD: 4500,
  DOCK: 5000,
  MENU_BAR: 6000,
  BANNERS: 6500,
  PANELS: 7000, // Control Center, Notification Center, menu dropdowns
  SPOTLIGHT: 8000,
  DIALOG: 8500,
  FORCE_QUIT: 8600,
  APP_SWITCHER: 8800,
  CONTEXT_MENU: 9000,
  DRAG_GHOST: 9200,
  DISPLAY_FILTER: 9500, // brightness / night shift overlays (pointer-events: none)
  LOCK: 10000,
  POWER: 11000,
} as const; /** z-index of every shell layer, lowest to highest; windows stack among themselves inside the WindowLayer stacking context (z-index: WINDOWS). */

/**
 * Returns the element that holds every shell layer (desktop, windows, Dock, menu bar, menus…).
 *
 * Overlays portalled out of a window (e.g. Quick Look) must be mounted here rather than on
 * `document.body`: the shell sits in its own stacking context, so anything outside it is stacked
 * against the shell as a whole and would cover the menu bar and context menus whatever its
 * z-index. Falls back to `document.body` before the shell has mounted.
 *
 * @returns {HTMLElement} The shell layer container.
 *
 * @example
 * createPortal(<Panel />, shellLayerRoot());
 */
export function shellLayerRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-shell-layers]') ?? document.body;
}

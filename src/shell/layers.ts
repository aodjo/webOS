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

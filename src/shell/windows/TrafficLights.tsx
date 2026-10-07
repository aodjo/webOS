/**
 * The close / minimize / zoom buttons. Grey when the window is inactive, colored with glyphs
 * while the group is hovered; the close button shows a dot for unsaved changes. Resting the
 * pointer on the zoom button (or right-clicking it) opens the Sequoia "Move & Resize" menu.
 */
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { Bounds, MenuItem, WindowState } from '@/kernel/types';
import { getWorkspace, showContextMenu, useT, useWM, wm } from '@/kernel';
import { cx } from './state';
import s from './Window.module.css';

const S = {
  close: { en: 'Close', ko: '닫기' },
  minimize: { en: 'Minimize', ko: '최소화' },
  zoom: { en: 'Zoom', ko: '확대/축소' },
  fill: { en: 'Fill', ko: '채우기' },
  left: { en: 'Left', ko: '왼쪽' },
  right: { en: 'Right', ko: '오른쪽' },
  center: { en: 'Center', ko: '가운데' },
  previous: { en: 'Return to Previous Size', ko: '이전 크기로 되돌리기' },
}; /** Localized labels for the traffic-light buttons and the zoom button's tiling menu. */

const TILE_MENU_DELAY = 750; /** Hover time in ms on the zoom button before the tiling menu opens. */

/**
 * Builds the "Move & Resize" menu shown from the zoom button.
 *
 * Offers Fill, Left / Right halves, Center and Return to Previous Size for the given window.
 * The "previous" bounds are the window's `restoreBounds` when it is already filled or tiled, so
 * snapping again from a snapped state keeps the original size; otherwise they are the current
 * bounds. Fill is disabled for a non-maximizable or already filled window, Left / Right for a
 * non-resizable window or the side it is already tiled to, and Return to Previous Size unless the
 * window is filled or tiled with saved restore bounds.
 *
 * @param {WindowState} win - Snapshot of the window the menu acts on.
 * @returns {MenuItem[]} Menu items ready to pass to `showContextMenu`.
 *
 * @example
 * showContextMenu(event, tileMenu(win));
 */
function tileMenu(win: WindowState): MenuItem[] {
  const snapped = win.maximized || !!win.tiled;
  const current = { x: win.x, y: win.y, width: win.width, height: win.height };
  const previous = snapped && win.restoreBounds ? win.restoreBounds : current;

  /**
   * Fills the workspace with the window.
   *
   * Sets the window to the full workspace bounds, marks it maximized, clears any tiling and
   * remembers the "previous" bounds so zooming out returns to them. Then focuses the window.
   *
   * @returns {void}
   *
   * @example
   * fill();
   */
  const fill = () => {
    wm.update(win.id, { ...getWorkspace(), maximized: true, tiled: null, restoreBounds: previous });
    wm.focus(win.id);
  };
  /**
   * Moves the window to explicit bounds as a free-floating window.
   *
   * Clears the maximized / tiled state and the saved restore bounds, then focuses the window.
   *
   * @param {Bounds} bounds - Target position and size in screen pixels.
   * @returns {void}
   *
   * @example
   * place({ x: 100, y: 80, width: 800, height: 600 });
   */
  const place = (bounds: Bounds) => {
    wm.update(win.id, { ...bounds, maximized: false, tiled: null, restoreBounds: null });
    wm.focus(win.id);
  };
  /**
   * Centers the window in the workspace at its "previous" size.
   *
   * The size is clamped to the workspace so the window always fits, and the position is rounded
   * to whole pixels.
   *
   * @returns {void}
   *
   * @example
   * center();
   */
  const center = () => {
    const ws = getWorkspace();
    const width = Math.min(previous.width, ws.width);
    const height = Math.min(previous.height, ws.height);
    place({ x: Math.round(ws.x + (ws.width - width) / 2), y: Math.round(ws.y + (ws.height - height) / 2), width, height });
  };

  return [
    { label: S.fill, disabled: !win.maximizable || win.maximized, action: fill },
    { separator: true },
    { label: S.left, disabled: !win.resizable || win.tiled === 'left', action: () => wm.tile(win.id, 'left') },
    { label: S.right, disabled: !win.resizable || win.tiled === 'right', action: () => wm.tile(win.id, 'right') },
    { separator: true },
    { label: S.center, action: center },
    { label: S.previous, disabled: !snapped || !win.restoreBounds, action: () => win.restoreBounds && place(win.restoreBounds) },
  ];
}

/**
 * Lists the visible windows of an app.
 *
 * Reads the window manager state directly (no subscription) and returns the ids of the app's
 * windows that are not minimized. Used by ⌥-click on the close and minimize buttons.
 *
 * @param {string} appId - Id of the app whose windows are collected.
 * @returns {string[]} Ids of the app's non-minimized windows.
 *
 * @example
 * for (const id of appWindowIds('textedit')) wm.minimize(id);
 */
function appWindowIds(appId: string): string[] {
  return useWM
    .getState()
    .windows.filter((w) => w.appId === appId && !w.minimized)
    .map((w) => w.id);
}

/**
 * Renders the "×" glyph of the close button.
 *
 * The stroke color and visibility come from the traffic-light styles (the glyph only shows while
 * the button group is hovered).
 *
 * @returns {JSX.Element} A decorative 12×12 SVG.
 *
 * @example
 * <CloseGlyph />
 */
function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M3.6 3.6l4.8 4.8M8.4 3.6L3.6 8.4" />
    </svg>
  );
}

/**
 * Renders the "−" glyph of the minimize button.
 *
 * Like the other glyphs it is decorative and only visible while the button group is hovered.
 *
 * @returns {JSX.Element} A decorative 12×12 SVG.
 *
 * @example
 * <MinGlyph />
 */
function MinGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M2.8 6h6.4" />
    </svg>
  );
}

/**
 * Renders the arrows glyph of the zoom button.
 *
 * Draws two outward-pointing arrows for a floating window, or two inward-pointing ones when the
 * window is filled or tiled (zooming would shrink it back).
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.inward - Whether to draw the inward ("restore") arrows.
 * @returns {JSX.Element} A decorative 12×12 SVG.
 *
 * @example
 * <ZoomGlyph inward={win.maximized || !!win.tiled} />
 */
function ZoomGlyph({ inward }: { inward: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={s.zoomGlyph}>
      {inward ? <path d="M5.7 5.7H2.6L5.7 2.6zM6.3 6.3h3.1L6.3 9.4z" /> : <path d="M3.3 3.3h4.1L3.3 7.4zM8.7 8.7H4.6L8.7 4.6z" />}
    </svg>
  );
}

/** Props of {@link TrafficLights}. */
export interface TrafficLightsProps {
  /** The window the buttons control. */
  win: WindowState;
  /** Whether the window is focused; unfocused windows show grey buttons. */
  focused: boolean;
  /** Placement: inside the 28px standard title bar or the app's 52px unified toolbar. */
  variant: 'standard' | 'overlay';
  /** Whether the close button is enabled (it is disabled while a sheet is open). */
  canClose: boolean;
  /** Whether the zoom button and its tiling menu are enabled. */
  canZoom: boolean;
}

/**
 * Renders a window's close / minimize / zoom buttons.
 *
 * The buttons are grey while the window is inactive and show their glyphs while the group is
 * hovered; the close button shows a dot when the window has unsaved changes. ⌥-click on close or
 * minimize applies to every visible window of the app. Resting the mouse on the zoom button for
 * `TILE_MENU_DELAY` ms, or right-clicking it, opens the "Move & Resize" tiling menu below it;
 * a plain click toggles maximize. The group prevents default on mousedown so pressing a button
 * never takes DOM focus away from the app (e.g. a text field), and it stops double-clicks from
 * reaching the title bar's zoom-on-double-click handler. The hover timer is cleared on unmount.
 *
 * @param {TrafficLightsProps} props - Component props.
 * @param {WindowState} props.win - The window the buttons control.
 * @param {boolean} props.focused - Whether the window is focused.
 * @param {'standard' | 'overlay'} props.variant - Title bar style the buttons are placed in.
 * @param {boolean} props.canClose - Whether the close button is enabled.
 * @param {boolean} props.canZoom - Whether the zoom button and tiling menu are enabled.
 * @returns {JSX.Element} The button group.
 *
 * @example
 * <TrafficLights win={win} focused={focused} variant="overlay" canClose={!sheetOpen} canZoom />
 */
export function TrafficLights({ win, focused, variant, canClose, canZoom }: TrafficLightsProps) {
  const t = useT();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const zoomRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  /**
   * Opens the tiling menu under the zoom button.
   *
   * Cancels the pending hover timer, then (when zooming is allowed) reads the latest window state
   * from the store, focuses the window and shows the menu anchored 4px below the zoom button.
   * When opened from a mouse event, the menu's preventDefault / stopPropagation are forwarded to
   * that event. Does nothing if the button is not mounted or the window no longer exists.
   *
   * @param {ReactMouseEvent} [e] - The triggering mouse event (absent when opened by the hover timer).
   * @returns {void}
   *
   * @example
   * onContextMenu={(e) => openTileMenu(e)}
   */
  const openTileMenu = (e?: ReactMouseEvent) => {
    clearTimeout(holdTimer.current);
    if (!canZoom) return;
    const r = zoomRef.current?.getBoundingClientRect();
    const current = useWM.getState().windows.find((w) => w.id === win.id);
    if (!r || !current) return;
    const pos = { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e?.preventDefault(), stopPropagation: () => e?.stopPropagation() };
    wm.focus(current.id);
    showContextMenu(pos, tileMenu(current));
  };

  return (
    <div
      className={cx(s.lights, variant === 'overlay' ? s.lightsOverlay : s.lightsStandard, !focused && s.lightsInactive)}
      data-no-drag
      onMouseDown={(e) => e.preventDefault()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cx(s.light, s.close, win.dirty && s.dirty)}
        aria-label={t(S.close)}
        disabled={!canClose}
        onClick={(e) => {
          for (const id of e.altKey ? appWindowIds(win.appId) : [win.id]) void wm.close(id);
        }}
      >
        <CloseGlyph />
        <span className={s.dirtyDot} aria-hidden />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className={cx(s.light, s.min)}
        aria-label={t(S.minimize)}
        onClick={(e) => {
          for (const id of e.altKey ? appWindowIds(win.appId) : [win.id]) wm.minimize(id);
        }}
      >
        <MinGlyph />
      </button>
      <button
        ref={zoomRef}
        type="button"
        tabIndex={-1}
        className={cx(s.light, s.zoom)}
        aria-label={t(S.zoom)}
        aria-haspopup="menu"
        disabled={!canZoom}
        onClick={() => {
          clearTimeout(holdTimer.current);
          wm.toggleMaximize(win.id);
        }}
        onPointerEnter={(e) => {
          clearTimeout(holdTimer.current);
          if (canZoom && e.pointerType === 'mouse') holdTimer.current = setTimeout(() => openTileMenu(), TILE_MENU_DELAY);
        }}
        onPointerLeave={() => clearTimeout(holdTimer.current)}
        onPointerDown={() => clearTimeout(holdTimer.current)}
        onContextMenu={(e) => {
          e.preventDefault();
          openTileMenu(e);
        }}
      >
        <ZoomGlyph inward={win.maximized || !!win.tiled} />
      </button>
    </div>
  );
}

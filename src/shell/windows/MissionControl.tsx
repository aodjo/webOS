/**
 * Mission Control (F3 / ⌃↑): darkens and blurs the desktop, the windows lay themselves out in a
 * non-overlapping grid (see expose.ts – the Window frames apply the transforms) and this
 * component draws the backdrop, the Spaces bar and a label under each window.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { WindowState } from '@/kernel/types';
import { fs, getApp, getWorkspace, isCompact, useDialogs, useIsDark, useSystem, useT, useUI, useWM, wallpaperURL, wm } from '@/kernel';
import { FORCE_QUIT_HOST } from '@/shell/desktop/ForceQuit';
import { Z } from '../layers';
import { exposableWindows, selectExposeSlots, spacesBarHeight, type ExposeSlot } from './expose';
import { cx, usePresence, useViewport, useWindowChrome } from './state';
import type { Size } from './geometry';
import s from './MissionControl.module.css';

const S = {
  title: { en: 'Mission Control', ko: 'Mission Control' },
  desktop: { en: 'Desktop 1', ko: '데스크탑 1' },
}; /** Localized strings for Mission Control. */

const EXIT_MS = 360; /** How long (ms) Mission Control stays mounted after closing, for its exit animation. */

/**
 * Leaves Mission Control.
 *
 * Clears the `missionControl` UI flag; the windows animate back to their frames and the overlay
 * plays its exit animation.
 *
 * @returns {void}
 *
 * @example
 * if (e.key === 'Escape') exit();
 */
const exit = () => useUI.getState().set({ missionControl: false });

/**
 * Picks a window in Mission Control.
 *
 * Focuses the window (bringing it to the front) and leaves Mission Control.
 *
 * @param {string} id - Id of the chosen window.
 * @returns {void}
 *
 * @example
 * choose(win.id);
 */
function choose(id: string) {
  wm.focus(id);
  exit();
}

/**
 * Tells whether a system (app-modal) alert or panel is showing.
 *
 * A system modal sits above Mission Control and owns the keyboard. Sheets are document-modal:
 * they block only their own window (or the Force Quit panel, while it is open) and defer to
 * Mission Control, so they don't count. A queued dialog without a window id, a sheet whose window
 * is gone, and a Force Quit sheet while the Force Quit panel is closed are all shown as system
 * modals (see `DialogHost`), so they do.
 *
 * @returns {boolean} True when a system modal dialog is up.
 *
 * @example
 * if (systemModalOpen()) return;
 */
function systemModalOpen(): boolean {
  const { windows } = useWM.getState();
  const forceQuit = useUI.getState().forceQuit;
  return useDialogs.getState().queue.some((d) => {
    if (!d.windowId) return true;
    if (d.windowId === FORCE_QUIT_HOST) return !forceQuit;
    return !windows.some((w) => w.id === d.windowId);
  });
}

/** Arrow keys used for spatial navigation between exposé slots. */
type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * Finds the exposé slot an arrow key moves the selection to.
 *
 * Compares slot centers: only slots more than 1px ahead in the arrow's direction qualify, and
 * the one with the lowest score (distance along the direction plus twice the sideways offset)
 * wins. When no slot lies in that direction, the current slot is returned.
 *
 * @param {ExposeSlot[]} slots - All exposé slots.
 * @param {ExposeSlot} current - The currently selected slot.
 * @param {Arrow} key - The arrow key that was pressed.
 * @returns {ExposeSlot} The slot to select next.
 *
 * @example
 * const next = nextSlot(slots, current, 'ArrowRight');
 */
function nextSlot(slots: ExposeSlot[], current: ExposeSlot, key: Arrow): ExposeSlot {
  const c = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
  let best: ExposeSlot | undefined;
  let bestScore = Infinity;
  for (const sl of slots) {
    if (sl === current) continue;
    const dx = sl.x + sl.width / 2 - c.x;
    const dy = sl.y + sl.height / 2 - c.y;
    const along = key === 'ArrowLeft' ? -dx : key === 'ArrowRight' ? dx : key === 'ArrowUp' ? -dy : dy;
    const across = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = sl;
    }
  }
  return best ?? current;
}

/**
 * Computes the exposé layout for the current window manager state and viewport.
 *
 * Reads the stores and the window size directly, for use outside React rendering (keyboard
 * handlers).
 *
 * @returns {Map<string, ExposeSlot>} Exposé slots keyed by window id.
 *
 * @example
 * const slots = [...currentSlots().values()];
 */
function currentSlots(): Map<string, ExposeSlot> {
  return selectExposeSlots(useWM.getState(), { width: window.innerWidth, height: window.innerHeight }, getWorkspace(), isCompact());
}

/**
 * Mission Control controller: keyboard, focus and exit handling around the overlay view.
 *
 * Stays mounted for EXIT_MS after closing so the exit animation can play. While open it takes
 * keyboard focus (nothing typed reaches the window that had focus), closes Show Desktop,
 * Launchpad, Spotlight and any context menu, and clears the exposé selection. It exits when a
 * window gets focus (Dock click, app launch), a window opens, or Spotlight / Launchpad open.
 * Arrow keys move the selection between windows, Enter / Space pick the selected window (or just
 * exit) and Esc exits; keys are left alone while a system modal is up or ⌘ / ⌃ is held. When it
 * closes, focus returns to the previously focused element unless a chosen window already claimed
 * it.
 *
 * @returns {JSX.Element | null} The Mission Control view while mounted, otherwise null.
 *
 * @example
 * <MissionControl />
 */
export function MissionControl() {
  const open = useUI((u) => u.missionControl);
  const { mounted, closing } = usePresence(open, EXIT_MS);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const prevFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    root?.focus({ preventScroll: true });

    const ui = useUI.getState();
    if (ui.showDesktop || ui.launchpad || ui.spotlight || ui.contextMenu) ui.set({ showDesktop: false, launchpad: false, spotlight: false, contextMenu: null });
    useWindowChrome.setState({ exposeSelected: null });

    const unsubscribe = useWM.subscribe((st, prev) => {
      if ((st.focusedId && st.focusedId !== prev.focusedId) || st.windows.length > prev.windows.length) exit();
    });
    const unsubscribeUI = useUI.subscribe((u, prev) => {
      if ((u.spotlight && !prev.spotlight) || (u.launchpad && !prev.launchpad)) exit();
    });

    /**
     * Handles the keyboard while Mission Control is open.
     *
     * Esc exits. Arrow keys select the focused window (or the first one) on the first press and
     * then move the selection spatially with `nextSlot`. Enter / Space pick the selected window or
     * exit when nothing is selected, unless a label button focused with Tab is the target (it
     * activates itself). Other printable keys without ⌥ only have their default action prevented
     * so they can't scroll or activate anything. Keys are ignored while a system modal is up or
     * ⌘ / ⌃ is held.
     *
     * @param {KeyboardEvent} e - The captured keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey, true);
     */
    const onKey = (e: KeyboardEvent) => {
      if (systemModalOpen() || e.metaKey || e.ctrlKey) return;
      /**
       * Stops the current key event from reaching the page or other listeners.
       *
       * Prevents the key's default action and stops its propagation; because the listener runs in
       * the capture phase, the focused window never sees the key.
       *
       * @returns {void}
       *
       * @example
       * consume();
       */
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Escape') {
        consume();
        exit();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        consume();
        const slots = [...currentSlots().values()];
        const selected = useWindowChrome.getState().exposeSelected;
        const current = slots.find((sl) => sl.id === selected);
        const next = current ? nextSlot(slots, current, e.key) : (slots.find((sl) => sl.id === useWM.getState().focusedId) ?? slots[0]);
        if (next) useWindowChrome.setState({ exposeSelected: next.id });
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (e.target instanceof HTMLButtonElement && rootRef.current?.contains(e.target)) return;
        consume();
        const selected = useWindowChrome.getState().exposeSelected;
        if (selected) choose(selected);
        else exit();
      } else if (e.key.length === 1 && !e.altKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      unsubscribe();
      unsubscribeUI();
      window.removeEventListener('keydown', onKey, true);
      const now = document.activeElement;
      if (prevFocus?.isConnected && (!now || now === document.body || root?.contains(now))) prevFocus.focus({ preventScroll: true });
    };
  }, [open]);

  return mounted ? <MissionControlView rootRef={rootRef} closing={closing} /> : null;
}

/**
 * The Mission Control overlay: backdrop, Spaces bar and window labels.
 *
 * Darkens and blurs the desktop, draws the "Desktop 1" thumbnail in a glass capsule at the top of
 * the workspace and a label under every window that has an exposé slot (the window frames apply
 * their own exposé transforms). Clicking the empty background exits.
 *
 * @param {Object} props - Component props.
 * @param {RefObject<HTMLDivElement | null>} props.rootRef - Ref to the focusable root element.
 * @param {boolean} props.closing - Whether the exit animation is playing.
 * @returns {JSX.Element} The overlay.
 *
 * @example
 * <MissionControlView rootRef={rootRef} closing={closing} />
 */
function MissionControlView({ rootRef, closing }: { rootRef: RefObject<HTMLDivElement | null>; closing: boolean }) {
  const t = useT();
  const viewport = useViewport();
  const compact = isCompact();
  const windows = useWM((st) => st.windows);
  const slots = useWM((st) => selectExposeSlots(st, viewport, getWorkspace(), compact));
  const selected = useWindowChrome((c) => c.exposeSelected);
  const ws = getWorkspace();
  const barHeight = spacesBarHeight(viewport);

  return (
    <div ref={rootRef} tabIndex={-1} className={cx(s.root, closing && s.closing)} style={{ zIndex: Z.MISSION_CONTROL }} role="dialog" aria-label={t(S.title)} onClick={exit}>
      <div className={s.backdrop} />
      <div className={s.spaces} style={{ left: ws.x, top: ws.y, width: ws.width, height: barHeight }}>
        {/* Thumbnail + label + the capsule's padding leave ~6px above and below the strip. Thick
            glass: the "Desktop 1" label is text over the dimmed (possibly dark) wallpaper. */}
        <div className={cx('lg lg-thick lg-capsule', s.strip)}>
          <SpaceThumbnail screen={viewport} thumbHeight={barHeight - 46} label={t(S.desktop)} compact={compact} />
        </div>
      </div>
      {windows.map((w) => {
        const slot = slots.get(w.id);
        return slot ? <WindowLabel key={w.id} win={w} slot={slot} selected={selected === w.id} /> : null;
      })}
    </div>
  );
}

/**
 * Glass capsule label under a window in Mission Control.
 *
 * Shows the app icon and the window title, centered 8px below the window's exposé slot; it may
 * grow as wide as the slot, and to at least 160px for narrow slots. Hovering selects the window,
 * leaving clears the selection if it is still this window, and clicking picks the window.
 *
 * @param {Object} props - Component props.
 * @param {WindowState} props.win - The window being labeled.
 * @param {ExposeSlot} props.slot - The window's exposé slot.
 * @param {boolean} props.selected - Whether this window is the exposé selection.
 * @returns {JSX.Element} The label button.
 *
 * @example
 * <WindowLabel win={w} slot={slot} selected={selected === w.id} />
 */
function WindowLabel({ win, slot, selected }: { win: WindowState; slot: ExposeSlot; selected: boolean }) {
  const app = getApp(win.appId);
  const Icon = app?.icon;
  return (
    <button
      type="button"
      className={cx('lg lg-thick lg-capsule', s.label, selected && s.labelSelected)}
      style={{ left: slot.x + slot.width / 2, top: slot.y + slot.height + 8, maxWidth: Math.max(slot.width, 160) }}
      onClick={(e) => {
        e.stopPropagation();
        choose(win.id);
      }}
      onPointerEnter={() => useWindowChrome.setState({ exposeSelected: win.id })}
      onPointerLeave={() => useWindowChrome.setState((c) => (c.exposeSelected === win.id ? { exposeSelected: null } : c))}
    >
      {Icon && (
        <span className={s.labelIcon} aria-hidden>
          <Icon size={18} />
        </span>
      )}
      <span className={s.labelText}>{win.title}</span>
    </button>
  );
}

/**
 * The "Desktop 1" thumbnail of the Spaces bar: wallpaper plus miniature windows.
 *
 * Scales the screen down to `thumbHeight`, draws the current wallpaper (an FS wallpaper that
 * can't be read falls back to the built-in default) and one miniature per exposable window in
 * z-order; on compact screens every miniature covers the workspace. Clicking it exits Mission
 * Control.
 *
 * @param {Object} props - Component props.
 * @param {Size} props.screen - Viewport size.
 * @param {number} props.thumbHeight - Height of the thumbnail in px.
 * @param {string} props.label - Caption under the thumbnail.
 * @param {boolean} props.compact - Whether the screen is phone-sized.
 * @returns {JSX.Element} The thumbnail button.
 *
 * @example
 * <SpaceThumbnail screen={viewport} thumbHeight={60} label="Desktop 1" compact={false} />
 */
function SpaceThumbnail({ screen, thumbHeight, label, compact }: { screen: Size; thumbHeight: number; label: string; compact: boolean }) {
  const dark = useIsDark();
  const wallpaper = useSystem((st) => st.settings.wallpaper);
  const minis = useWM(useShallow((st) => exposableWindows(st)));
  const ws = getWorkspace();
  const scale = thumbHeight / Math.max(1, screen.height);
  const url = wallpaperURL(wallpaper, dark, (p) => {
    try {
      return fs.stat(p) ? fs.getURL(p) : null;
    } catch {
      return null;
    }
  });

  return (
    <button
      type="button"
      className={s.space}
      aria-current="true"
      onClick={(e) => {
        e.stopPropagation();
        exit();
      }}
    >
      <span className={s.spaceThumb} style={{ width: Math.round(screen.width * scale), height: Math.round(thumbHeight) }}>
        <img src={url} alt="" draggable={false} />
        {[...minis]
          .sort((a, b) => a.z - b.z)
          .map((w) => {
            const b = compact ? ws : w;
            return <span key={w.id} className={s.mini} style={{ left: b.x * scale, top: b.y * scale, width: Math.max(4, b.width * scale), height: Math.max(3, b.height * scale) }} />;
          })}
      </span>
      <span className={s.spaceLabel}>{label}</span>
    </button>
  );
}

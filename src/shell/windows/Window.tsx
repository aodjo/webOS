/**
 * One window: frame, title bar, traffic lights, resize handles and the app content (inside an
 * error boundary + Suspense). Also drives the window's own animations: open, minimize/restore to
 * the Dock, zoom/tile bounds, Mission Control (exposé) and Show Desktop.
 */
import {
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AppArgs, Bounds, MenuItem, WindowState } from '@/kernel/types';
import {
  MENU_BAR_HEIGHT,
  WindowContext,
  basename,
  dirname,
  dockAnchors,
  getApp,
  getWorkspace,
  isCompact,
  isMacHost,
  revealInFinder,
  setDragPaths,
  showContextMenu,
  useDialogs,
  useNode,
  useSystem,
  useT,
  useUI,
  useWM,
  wm,
} from '@/kernel';
import { FileIcon } from '@/icons';
import { WindowSheets } from '@/shell/desktop/Dialogs';
import { AppErrorBoundary } from './AppErrorBoundary';
import { TrafficLights } from './TrafficLights';
import { RESIZE_DIRS, fallbackDockRect, minimizeTransform, slideOutOffset } from './geometry';
import { playGenie } from './genie';
import { selectExposeSlots } from './expose';
import { afterPaint, chromeElements, cx, reduceMotionNow, useViewport, useViewportResizing, useWindowChrome } from './state';
import { dragRegionFor, useWindowInteractions } from './useWindowInteractions';
import s from './Window.module.css';

const S = {
  edited: { en: 'Edited', ko: '편집됨' },
  loading: { en: 'Loading', ko: '로드 중' },
}; /** Localized strings for the title bar's "Edited" suffix and the loading spinner label. */

const MINIMIZE_MS = 400; /** Duration in ms of the minimize animation; matches `.minimizing` in Window.module.css. */

/**
 * Minimize state machine. 'idle': on screen; 'out': flying into the Dock; 'done': hidden there;
 * 'in': parked on the Dock tile (re-measured, no transition) for one painted frame before flying
 * back out of it.
 */
type MinPhase = 'idle' | 'out' | 'done' | 'in';

/**
 * Finds the Dock rectangle a window minimizes into.
 *
 * Targets the window's own minimized tile (`win:<id>` anchor) when the Dock has registered one,
 * otherwise the app's Dock icon, and falls back to an estimated rectangle at the Dock's configured
 * position and size when neither anchor is measured yet.
 *
 * @param {string} id - Window id.
 * @param {string} appId - Id of the app that owns the window.
 * @returns {Bounds} The target rectangle on screen.
 *
 * @example
 * const tile = dockRect(win.id, win.appId);
 */
function dockRect(id: string, appId: string): Bounds {
  const anchor = dockAnchors.get(`win:${id}`) ?? dockAnchors.get(appId);
  const { dockPosition, dockSize } = useSystem.getState().settings;
  return anchor && anchor.width > 0
    ? { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }
    : fallbackDockRect({ width: window.innerWidth, height: window.innerHeight }, dockPosition, dockSize);
}

/**
 * Computes the CSS transform that sends a window into the Dock (see dockRect).
 *
 * @param {string} id - Window id.
 * @param {string} appId - Id of the app that owns the window.
 * @param {Bounds} b - The window's current on-screen bounds.
 * @returns {string} A `translate(...) scale(...)` transform string.
 *
 * @example
 * setMinTarget(dockTransform(win.id, win.appId, bounds));
 */
function dockTransform(id: string, appId: string, b: Bounds): string {
  return minimizeTransform(b, dockRect(id, appId));
}

/**
 * Tells whether minimize and restore should play the genie effect.
 *
 * The effect is drawn for a Dock along the bottom edge; side Docks, and Reduce Motion, keep the
 * plain scale-into-the-Dock transition.
 *
 * @returns {boolean} True when the genie effect applies.
 *
 * @example
 * if (genieEnabled()) playGenie(el, bounds, tile, 'out', done);
 */
function genieEnabled(): boolean {
  return useSystem.getState().settings.dockPosition === 'bottom' && !reduceMotionNow();
}

/**
 * Builds the "path" menu of a document window's title.
 *
 * The first item is the file itself, followed by each enclosing folder up to the root ("/").
 * Choosing the file reveals it in its folder in Finder; choosing a folder opens that folder in
 * Finder with the entry on the way to the file selected.
 *
 * @param {string} path - Absolute VFS path of the document shown in the window.
 * @returns {MenuItem[]} Menu items ordered from the file up to the root.
 *
 * @example
 * showContextMenu(event, pathMenu('/Users/aodjo/Desktop/a.txt'));
 */
function pathMenu(path: string): MenuItem[] {
  const items: MenuItem[] = [{ label: basename(path), action: () => revealInFinder(path) }];
  for (let child = path; child !== '/'; child = dirname(child)) {
    const dir = dirname(child);
    const select = child;
    items.push({ label: dir === '/' ? '/' : basename(dir), action: () => revealInFinder(select) });
  }
  return items;
}

/**
 * Renders one window by id.
 *
 * Subscribes to that window's state in the window manager and renders its frame, or nothing once
 * the window no longer exists. Memoized so the layer re-rendering does not re-render every window.
 *
 * @param {Object} props - Component props.
 * @param {string} props.id - Id of the window to render.
 * @returns {JSX.Element | null} The window frame, or null when the window is gone.
 *
 * @example
 * {ids.map((id) => <Window key={id} id={id} />)}
 */
export const Window = memo(function Window({ id }: { id: string }) {
  const win = useWM((st) => st.windows.find((w) => w.id === id));
  return win ? <WindowFrame win={win} /> : null;
});

/**
 * Renders a window's frame, chrome and content and drives its animations.
 *
 * The frame is positioned at the window's bounds (or fills the workspace in compact mode) and
 * stacked by its z value. Bounds changes (zoom, tile, relayout) animate, except while the window
 * is being dragged or resized or the browser window is being resized. It handles:
 * - Minimize / restore: a small state machine (`MinPhase`). On minimize it waits one animation
 *   frame so the Dock has registered the tile the window minimizes into, then transforms into it
 *   and becomes hidden after `MINIMIZE_MS`. On restore it re-measures the tile (it may have moved
 *   since apps launched or quit), parks the invisible window there for one painted frame and then
 *   animates back out. With reduced motion the window hides at once and restores in place.
 * - Open animation: played once on mount unless the window starts minimized or motion is reduced.
 * - Overlay modes: Mission Control places the window in its exposé slot with a translate/scale
 *   transform, and Show Desktop slides it past the nearest screen edge, leaving a sliver
 *   visible. In both modes the content ignores pointer events and a shield on top catches clicks
 *   (and, in exposé, hover highlighting).
 * - Drag / resize: only allowed while visible, not compact and not in an overlay mode; an active
 *   drag or resize is cancelled as soon as that stops being true. ⌘-dragging a background window
 *   by its title bar on a Mac host moves it without activating it; any other pointerdown focuses it.
 * - Keyboard focus: while the session is on the desktop, the focused window takes DOM focus
 *   (restoring the last focused element inside it) and an unfocused window blurs its active
 *   element. If a system overlay outside any window (Spotlight, Launchpad, an alert) holds focus,
 *   the window does not steal it, but polls every 100ms for up to 4s and takes focus once the
 *   overlay is gone and focus has fallen back to the document body (polling stops without
 *   taking focus if it moves to some other element instead).
 * - Close animation: the chrome element is registered in `chromeElements` so the layer can
 *   snapshot it when the window closes. The corner-radius class is applied to both the frame
 *   (for the exposé outline) and the chrome (so the detached snapshot keeps its corners).
 *
 * @param {Object} props - Component props.
 * @param {WindowState} props.win - Current state of the window.
 * @returns {JSX.Element} The window's `<section>` element.
 *
 * @example
 * <WindowFrame win={win} />
 */
function WindowFrame({ win }: { win: WindowState }) {
  const { id, appId, pid } = win;
  const frameRef = useRef<HTMLElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const focused = useWM((st) => st.focusedId === id);
  const appHidden = useWM((st) => st.processes.some((p) => p.appId === appId && p.hidden));
  const missionControl = useUI((u) => u.missionControl);
  const showDesktop = useUI((u) => u.showDesktop);
  const sheetOpen = useDialogs((d) => d.queue.some((q) => q.windowId === id));
  const highlighted = useWindowChrome((c) => c.exposeSelected === id);
  const sessionActive = useSystem((st) => st.power === 'desktop');
  const viewport = useViewport();
  const compact = isCompact();
  const resizingViewport = useViewportResizing();
  const { interacting, startDrag, startResize, cancel } = useWindowInteractions(id, frameRef);

  const b: Bounds = compact ? getWorkspace() : { x: win.x, y: win.y, width: win.width, height: win.height };
  const boundsRef = useRef(b);
  useLayoutEffect(() => {
    boundsRef.current = b;
  });

  const [prevMinimized, setPrevMinimized] = useState(win.minimized);
  const [minPhase, setMinPhase] = useState<MinPhase>(win.minimized ? 'done' : 'idle');
  const [minTarget, setMinTarget] = useState<string | null>(() => (win.minimized ? dockTransform(id, appId, b) : null));
  const [genie, setGenie] = useState(false);
  const [instant, setInstant] = useState(false);
  if (prevMinimized !== win.minimized) {
    setPrevMinimized(win.minimized);
    if (win.minimized) setMinPhase('out');
    else if (minPhase === 'done' && !reduceMotionNow()) setMinPhase('in');
    else {
      setMinPhase('idle');
      setMinTarget(null);
    }
  }
  useEffect(() => {
    if (minPhase !== 'out') return;
    const el = frameRef.current;
    let cancelGenie: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      setMinTarget(dockTransform(id, appId, boundsRef.current));
      if (el && genieEnabled()) {
        setGenie(true);
        cancelGenie = playGenie(el, boundsRef.current, dockRect(id, appId), 'out', () => {
          setGenie(false);
          setMinPhase('done');
        });
      } else timer = setTimeout(() => setMinPhase('done'), reduceMotionNow() ? 0 : MINIMIZE_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      cancelGenie?.();
    };
  }, [minPhase, id, appId]);
  useLayoutEffect(() => {
    if (minPhase !== 'in') return;
    setMinTarget(dockTransform(id, appId, boundsRef.current));
    const el = frameRef.current;
    if (el && genieEnabled()) {
      setGenie(true);
      return playGenie(el, boundsRef.current, dockRect(id, appId), 'in', () => {
        setInstant(true);
        setGenie(false);
        setMinPhase('idle');
        setMinTarget(null);
      });
    }
    return afterPaint(() => {
      setMinPhase('idle');
      setMinTarget(null);
    });
  }, [minPhase, id, appId]);
  useEffect(() => {
    if (instant) return afterPaint(() => setInstant(false));
  }, [instant]);

  const [opening, setOpening] = useState(() => !win.minimized && !reduceMotionNow());

  const visible = !appHidden && !win.minimized;
  const hiddenNow = appHidden || (win.minimized && minPhase === 'done');
  const slot = useWM((st) => (missionControl && visible ? (selectExposeSlots(st, viewport, getWorkspace(), compact).get(id) ?? null) : null));
  const slid = showDesktop && visible && !slot;
  const overlayMode = !!slot || slid;
  const canMove = !compact && !overlayMode && visible;
  const parked = win.minimized || minPhase === 'in';

  useEffect(() => {
    if (!canMove) cancel();
  }, [canMove, cancel]);

  let transform: string | undefined;
  if (parked) transform = minTarget ?? undefined;
  else if (slot) transform = `translate(${slot.x - b.x}px, ${slot.y - b.y}px) scale(${slot.scale})`;
  else if (slid) {
    const o = slideOutOffset(b, viewport, MENU_BAR_HEIGHT);
    transform = `translate(${o.x}px, ${o.y}px)`;
  }

  useEffect(() => {
    const el = chromeRef.current;
    if (!el || !sessionActive) return;
    /**
     * Moves DOM focus into the window.
     *
     * Refocuses the element that last had focus inside the window when it is still attached
     * there, otherwise focuses the chrome itself, without scrolling.
     *
     * @returns {void}
     *
     * @example
     * claim();
     */
    const claim = () => {
      const last = lastFocusRef.current;
      (last?.isConnected && el.contains(last) ? last : el).focus({ preventScroll: true });
    };
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && el.contains(active);
    if (focused && !hiddenNow) {
      if (inside) return;
      /**
       * Tells whether an element belongs to a system-level modal overlay.
       *
       * True when the element is inside an `aria-modal="true"` container that is not part of any
       * window (window sheets are modal too, but live inside their window).
       *
       * @param {Element | null} node - Element to test, typically `document.activeElement`.
       * @returns {boolean} Whether the element is inside a system overlay.
       *
       * @example
       * if (inModal(document.activeElement)) return;
       */
      const inModal = (node: Element | null) => !!node?.closest('[aria-modal="true"]') && !node.closest('[data-window-id]');
      if (!inModal(active)) {
        claim();
        return;
      }
      const poll = setInterval(() => {
        const now = document.activeElement;
        if (!now || now === document.body) claim();
        else if (inModal(now)) return;
        clearInterval(poll);
      }, 100);
      const giveUp = setTimeout(() => clearInterval(poll), 4000);
      return () => {
        clearInterval(poll);
        clearTimeout(giveUp);
      };
    }
    if (!focused && inside) active?.blur();
  }, [focused, hiddenNow, sessionActive]);

  /**
   * Remembers the element that received focus inside the window.
   *
   * Focus events bubble from the content; any target other than the chrome itself is stored so
   * focus can be returned to it when the window is focused again.
   *
   * @param {ReactFocusEvent} e - The focus event bubbling up to the chrome.
   * @returns {void}
   *
   * @example
   * <div onFocus={onFocus} />
   */
  const onFocus = (e: ReactFocusEvent) => {
    if (e.target !== chromeRef.current) lastFocusRef.current = e.target as HTMLElement;
  };

  useLayoutEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    chromeElements.set(id, el);
    return () => {
      if (chromeElements.get(id) === el) chromeElements.delete(id);
    };
  }, [id]);

  /**
   * Focuses the window on any pointerdown inside it (capture phase).
   *
   * Runs before the content's own handlers. Skipped in Mission Control / Show Desktop (the shield
   * handles clicks there) and for a ⌘-press on a background window's drag region on a Mac host,
   * which lets the window be moved without activating it.
   *
   * @param {ReactPointerEvent<HTMLElement>} e - The pointerdown event.
   * @returns {void}
   *
   * @example
   * <section onPointerDownCapture={onPointerDownCapture} />
   */
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLElement>) => {
    if (overlayMode) return;
    if (isMacHost && e.metaKey && !focused && dragRegionFor(e.target, frameRef.current)) return;
    wm.focus(id);
  };
  /**
   * Starts dragging the window when its drag region is pressed.
   *
   * Only reacts to an unhandled primary-button press while the window can move, and only when the
   * target lies in a drag region (an element marked `data-drag-region`, such as the title bar)
   * and not on an interactive control inside it.
   *
   * @param {ReactPointerEvent<HTMLElement>} e - The pointerdown event.
   * @returns {void}
   *
   * @example
   * <section onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!canMove || e.button !== 0 || e.defaultPrevented) return;
    if (dragRegionFor(e.target, frameRef.current)) startDrag(e);
  };
  /**
   * Keeps a press on a drag region from moving focus or selecting text.
   *
   * Prevents the default action of a primary-button mousedown whose target is in a drag region.
   *
   * @param {ReactMouseEvent} e - The mousedown event.
   * @returns {void}
   *
   * @example
   * <section onMouseDown={onMouseDown} />
   */
  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button === 0 && dragRegionFor(e.target, frameRef.current)) e.preventDefault();
  };
  /**
   * Toggles maximize when a drag region is double-clicked.
   *
   * Only applies when the window can move and is maximizable.
   *
   * @param {ReactMouseEvent} e - The dblclick event.
   * @returns {void}
   *
   * @example
   * <section onDoubleClick={onDoubleClick} />
   */
  const onDoubleClick = (e: ReactMouseEvent) => {
    if (canMove && win.maximizable && dragRegionFor(e.target, frameRef.current)) wm.toggleMaximize(id);
  };
  /**
   * Handles a click on the window while it is in Mission Control or slid away by Show Desktop.
   *
   * In Mission Control it focuses the window and exits Mission Control; in Show Desktop it brings
   * the windows back and then focuses this one.
   *
   * @returns {void}
   *
   * @example
   * <div className={s.shield} onClick={onShieldClick} />
   */
  const onShieldClick = () => {
    if (slot) {
      wm.focus(id);
      useUI.getState().set({ missionControl: false });
    } else {
      useUI.getState().set({ showDesktop: false });
      wm.focus(id);
    }
  };

  const ctx = useMemo(() => ({ id, pid, appId }), [id, pid, appId]);
  const isOverlay = win.titlebar === 'overlay';
  const radius = compact ? s.radiusNone : isOverlay ? s.radiusOverlay : undefined;

  return (
    <section
      ref={frameRef}
      data-window-id={id}
      aria-label={win.title}
      inert={hiddenNow || undefined}
      className={cx(
        s.frame,
        radius,
        !interacting && !resizingViewport && s.animBounds,
        win.minimized && s.minimizing,
        (minPhase === 'in' || instant) && s.restoring,
        hiddenNow && s.hidden,
        overlayMode && s.overlayMode,
        slot && highlighted && s.highlighted,
      )}
      style={
        {
          left: b.x,
          top: b.y,
          width: b.width,
          height: b.height,
          zIndex: win.z,
          transform,
          opacity: parked ? 0 : undefined,
          visibility: genie ? 'hidden' : undefined,
          '--expose-scale': slot?.scale ?? 1,
        } as CSSProperties
      }
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <WindowContext.Provider value={ctx}>
        <div
          ref={chromeRef}
          tabIndex={-1}
          className={cx(s.chrome, radius, !focused && s.inactive, win.vibrancy && s.vibrant, opening && s.opening, compact && s.compact)}
          onFocus={onFocus}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setOpening(false);
          }}
        >
          {!isOverlay && <TitleBar win={win} />}
          <TrafficLights win={win} focused={focused} variant={isOverlay ? 'overlay' : 'standard'} canClose={!sheetOpen} canZoom={win.maximizable && !compact} />
          <div className={s.content}>
            <WindowBody id={id} pid={pid} appId={appId} args={win.args} />
          </div>
          {/* While a sheet is up the unified toolbar is blocked, but the window can still be dragged. */}
          {sheetOpen && isOverlay && <div className={s.toolbarShield} data-drag-region />}
          <div className={cx(s.sheetLayer, isOverlay ? s.sheetLayerOverlay : s.sheetLayerStandard)}>
            <WindowSheets windowId={id} />
          </div>
        </div>
      </WindowContext.Provider>

      {canMove && win.resizable && RESIZE_DIRS.map((dir) => <div key={dir} className={cx(s.rz, s[`rz_${dir}`])} onPointerDown={(e) => startResize(dir, e)} aria-hidden />)}

      {overlayMode && (
        <div
          className={s.shield}
          aria-hidden
          onClick={onShieldClick}
          onPointerEnter={slot ? () => useWindowChrome.setState({ exposeSelected: id }) : undefined}
          onPointerLeave={slot ? () => useWindowChrome.setState((c) => (c.exposeSelected === id ? { exposeSelected: null } : c)) : undefined}
        />
      )}
    </section>
  );
}

/**
 * Renders the standard 28px title bar of a window.
 *
 * Shows the window title, an "Edited" suffix when the window has unsaved changes and, for
 * document windows (`args.path` is a string), a draggable proxy icon of the file. Right-clicking
 * the bar, or ⌘-clicking (Ctrl-clicking on non-Mac hosts) the title, opens the path menu. The
 * whole bar is a drag region.
 *
 * @param {Object} props - Component props.
 * @param {WindowState} props.win - The window whose title bar is rendered.
 * @returns {JSX.Element} The title bar element.
 *
 * @example
 * {!isOverlay && <TitleBar win={win} />}
 */
function TitleBar({ win }: { win: WindowState }) {
  const t = useT();
  const path = typeof win.args.path === 'string' ? win.args.path : undefined;
  const node = useNode(path);

  /**
   * Opens the path menu of the window's document at the pointer.
   *
   * Does nothing when the window has no document path.
   *
   * @param {ReactMouseEvent} e - The click or contextmenu event that positions the menu.
   * @returns {void}
   *
   * @example
   * <div onContextMenu={openPathMenu} />
   */
  const openPathMenu = (e: ReactMouseEvent) => {
    if (path) showContextMenu(e, pathMenu(path));
  };

  return (
    <div className={s.titlebar} data-drag-region onContextMenu={path ? openPathMenu : undefined}>
      <div
        className={s.title}
        onClick={(e) => {
          if (isMacHost ? e.metaKey : e.ctrlKey) openPathMenu(e);
        }}
      >
        {path && (
          <span className={s.proxy} data-no-drag draggable title={path} onDragStart={(e) => setDragPaths(e, [path])}>
            <FileIcon node={node ?? { type: 'file', name: basename(path), path }} size={16} />
          </span>
        )}
        <span className={s.titleText}>{win.title}</span>
        {win.dirty && <span className={s.edited}>— {t(S.edited)}</span>}
      </div>
    </div>
  );
}

/**
 * Renders the app component inside a window.
 *
 * Wraps the app in an error boundary (showing a crash screen with Reopen / Close) and a Suspense
 * spinner while the lazy app module loads. "Reopen" remounts the app by bumping the boundary's
 * key; "Close" force-closes the window. Memoized so moving or focusing the window does not
 * re-render the app.
 *
 * @param {Object} props - Component props.
 * @param {string} props.id - Window id passed to the app.
 * @param {number} props.pid - Id of the owning process.
 * @param {string} props.appId - Id of the app to render.
 * @param {AppArgs} props.args - Launch arguments passed to the app.
 * @returns {JSX.Element} The app content, a spinner or the crash screen.
 *
 * @example
 * <WindowBody id={id} pid={pid} appId={appId} args={win.args} />
 */
const WindowBody = memo(function WindowBody({ id, pid, appId, args }: { id: string; pid: number; appId: string; args: AppArgs }) {
  const [generation, setGeneration] = useState(0);
  const App = getApp(appId)?.component;
  return (
    <AppErrorBoundary key={generation} appId={appId} onReopen={() => setGeneration((g) => g + 1)} onClose={() => void wm.close(id, { force: true })}>
      <Suspense fallback={<Spinner />}>{App ? <App windowId={id} pid={pid} args={args} /> : null}</Suspense>
    </AppErrorBoundary>
  );
});

/**
 * Renders the loading indicator shown while an app's code loads.
 *
 * Exposed to assistive technology as a status element labeled "Loading".
 *
 * @returns {JSX.Element} The spinner element.
 *
 * @example
 * <Suspense fallback={<Spinner />}>{children}</Suspense>
 */
function Spinner() {
  const t = useT();
  return (
    <div className={s.spinner} role="status" aria-label={t(S.loading)}>
      <span />
    </div>
  );
}

/**
 * Launchpad (F4 / Dock): a full-screen grid of every app over the blurred wallpaper, with
 * type-to-filter search and paging (dots, swipe, trackpad/wheel, arrow keys).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Search } from 'lucide-react';
import { DOCK_MARGIN, DOCK_PADDING, fs, isCompact, listApps, tr, useIsDark, useLocale, useSystem, useT, useUI, wallpaperURL, wm, type AppManifest } from '@/kernel';
import { Z } from '../layers';
import { handBackFocus } from './focus';
import { usePresence } from './usePresence';
import { useViewport } from './useViewport';
import { matchScore } from './spotlightSearch';
import s from './Launchpad.module.css';

const S = {
  launchpad: { en: 'Launchpad', ko: 'Launchpad' },
  search: { en: 'Search', ko: '검색' },
  noResults: { en: 'No Results', ko: '결과 없음' },
  page: { en: 'Page {n}', ko: '{n} 페이지' },
  apps: { en: 'Applications', ko: '응용 프로그램' },
}; /** Localized strings used by the Launchpad view. */

const EXIT_MS = 260; /** Duration in ms of the exit animation, during which the view stays mounted. */

/**
 * Renders the Launchpad overlay while it is open or playing its exit animation.
 *
 * Reads the `launchpad` flag from the UI store and uses `usePresence` to keep the view mounted
 * for `EXIT_MS` after the flag turns off, so the closing animation can finish before unmount.
 *
 * @returns {JSX.Element | null} The Launchpad view, or null when it is fully closed.
 *
 * @example
 * <Launchpad />
 */
export function Launchpad() {
  const open = useUI((st) => st.launchpad);
  const { mounted, closing } = usePresence(open, EXIT_MS);
  if (!mounted) return null;
  return <LaunchpadView closing={closing} />;
}

/**
 * Closes Launchpad.
 *
 * Clears the `launchpad` flag in the UI store; `Launchpad` then plays the exit animation and
 * unmounts the view.
 *
 * @returns {void}
 *
 * @example
 * close();
 */
function close() {
  useUI.getState().set({ launchpad: false });
}

/**
 * Tells whether a key press is a printable character that should start a search.
 *
 * A key qualifies when it produces a single character other than Space and no ⌘, Ctrl or ⌥
 * modifier is held, so shortcuts and navigation keys are excluded.
 *
 * @param {{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }} e - The native or React keyboard event.
 * @returns {boolean} True when the key should be typed into the search field.
 *
 * @example
 * if (isTypingKey(e)) inputRef.current?.focus({ preventScroll: true });
 */
const isTypingKey = (e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey;

/**
 * Computes the icon grid layout for the area available to Launchpad.
 *
 * Derives the side, top and bottom paddings, a column count between 3 and 7 and a row count
 * between 2 and 5 (7×5 on a typical desktop display, like macOS), and an icon size of 62% of
 * the cell clamped to 52–88px. Compact (phone-sized) layouts use tighter paddings and smaller
 * cell targets so more icons fit.
 *
 * @param {number} w - Width available to the grid (the viewport width minus a side Dock).
 * @param {number} h - Viewport height.
 * @param {number} bottomReserve - Height taken by a bottom Dock (0 when the Dock is on a side).
 * @returns {{ sidePad: number; top: number; bottom: number; cols: number; rows: number; icon: number; perPage: number }} Paddings, grid size, icon size in px and number of apps per page.
 *
 * @example
 * const m = gridMetrics(1440, 1000, 80);
 * console.log(m.cols, m.rows, m.perPage); // 7 5 35
 */
function gridMetrics(w: number, h: number, bottomReserve: number) {
  const compact = isCompact();
  const sidePad = compact ? 16 : Math.max(48, Math.round(w * 0.09));
  const top = compact ? 76 : 96;
  const bottom = bottomReserve + (compact ? 44 : 56);
  const gw = Math.max(200, w - sidePad * 2);
  const gh = Math.max(160, h - top - bottom);
  const cols = Math.min(7, Math.max(3, Math.floor(gw / (compact ? 88 : 140))));
  const rows = Math.min(5, Math.max(2, Math.floor(gh / (compact ? 104 : 136))));
  const cell = Math.min(gw / cols, gh / rows);
  const icon = Math.round(Math.min(88, Math.max(52, cell * 0.62)));
  return { sidePad, top, bottom, cols, rows, icon, perPage: cols * rows };
}

/**
 * Full-screen Launchpad view: an app grid over the blurred wallpaper with search and paging.
 *
 * Lists every app that has a window component (except Launchpad itself), filters it by
 * matching the query against the app name in the current locale, English and Korean (score of
 * at least 40, best match first), and splits the result into pages sized by `gridMetrics`. The
 * grid is padded so it stays clear of the Dock, which remains visible above Launchpad. Pages
 * change with the page dots, ←/→, a horizontal pointer swipe or one wheel/trackpad gesture per
 * page, and changing the query returns to the first page. Printable keys move focus to the
 * search field; Escape clears the query, then closes; clicking empty space closes. The search
 * field is focused on open (also when reopened during the exit animation) and keyboard focus
 * is handed back as soon as the exit animation starts.
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.closing - Whether the exit animation is playing; root and window-level key
 *   handling then stops and keyboard focus is handed back.
 * @returns {JSX.Element} The Launchpad dialog.
 *
 * @example
 * <LaunchpadView closing={false} />
 */
function LaunchpadView({ closing }: { closing: boolean }) {
  const t = useT();
  const locale = useLocale();
  const dark = useIsDark();
  const settings = useSystem((st) => st.settings);
  const { w, h } = useViewport();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [queryFor, setQueryFor] = useState(query);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const gridRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const swipe = useRef<{ id: number; x: number; y: number; dx: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const wheel = useRef({ acc: 0, last: 0, lockedUntil: 0 });
  const [prevFocus] = useState(() => (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null));

  const wallpaper = useMemo(
    () =>
      wallpaperURL(settings.wallpaper, dark, (p) => {
        try {
          return fs.getURL(p);
        } catch {
          return null;
        }
      }),
    [settings.wallpaper, dark],
  );

  const dockThickness = settings.dockSize + DOCK_PADDING * 2 + DOCK_MARGIN * 2;
  const m = gridMetrics(w - (settings.dockPosition === 'bottom' ? 0 : dockThickness), h, settings.dockPosition === 'bottom' ? dockThickness : 0);
  const padLeft = m.sidePad + (settings.dockPosition === 'left' ? dockThickness : 0);
  const padRight = m.sidePad + (settings.dockPosition === 'right' ? dockThickness : 0);

  const apps = useMemo(() => listApps().filter((a) => a.id !== 'launchpad' && a.component), []);
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return apps;
    return apps
      .map((a) => ({ a, score: Math.max(matchScore(tr(a.name, locale), q), matchScore(tr(a.name, 'en'), q), matchScore(tr(a.name, 'ko'), q)) }))
      .filter((x) => x.score >= 40)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.a);
  }, [apps, query, locale]);

  const pages = useMemo(() => {
    const out: AppManifest[][] = [];
    for (let i = 0; i < filtered.length; i += m.perPage) out.push(filtered.slice(i, i + m.perPage));
    return out.length ? out : [[]];
  }, [filtered, m.perPage]);

  if (queryFor !== query) {
    setQueryFor(query);
    setPage(0);
  }
  const current = Math.min(page, pages.length - 1);

  /**
   * Switches to a page, clamped to the existing page range.
   *
   * Out-of-range indices land on the first or last page, so callers can pass `current ± 1`
   * without checking bounds.
   *
   * @param {number} p - Target page index.
   * @returns {void}
   *
   * @example
   * goTo(current + 1);
   */
  const goTo = (p: number) => setPage(Math.max(0, Math.min(pages.length - 1, p)));

  /**
   * Closes Launchpad and launches an app.
   *
   * Uses `wm.launch`, which behaves like clicking the app's Dock icon: an existing window is
   * focused (or unhidden), otherwise a new window opens.
   *
   * @param {AppManifest} app - The app to launch.
   * @returns {void}
   *
   * @example
   * launch(filtered[0]);
   */
  const launch = (app: AppManifest) => {
    close();
    wm.launch(app.id);
  };

  /**
   * Handles keys pressed in the search field.
   *
   * Return launches the best match when there is a query; Escape clears the query or, when it is
   * already empty, closes Launchpad; ←/→ flip pages while the query is empty; ↓ moves focus to
   * the first icon of the current page. Return, Escape, ←, → and ↓ are stopped from reaching the
   * global shortcut dispatcher. Events fired during IME composition are ignored.
   *
   * @param {ReactKeyboardEvent<HTMLInputElement>} e - The keydown event from the search input.
   * @returns {void}
   *
   * @example
   * <input onKeyDown={onInputKey} />
   */
  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (['Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(e.key)) e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (query.trim() && filtered[0]) launch(filtered[0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else close();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !query) {
      e.preventDefault();
      goTo(current + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = pages[current][0];
      if (first) gridRefs.current.get(first.id)?.focus({ preventScroll: true });
    }
  };

  /**
   * Moves keyboard focus between app icons with the arrow keys.
   *
   * ←/→ step one icon and continue onto the previous or next page at a page edge; ↑/↓ step one
   * row, and ↑ from the first row returns focus to the search field. Escape closes Launchpad.
   * Return and Space are left to activate the button natively but are stopped from reaching the
   * global shortcut dispatcher. A page other than the current one is inert, so when the target icon is
   * on another page its id is stored in `pendingFocus` and a layout effect focuses it once the
   * page change has rendered.
   *
   * @param {ReactKeyboardEvent<HTMLButtonElement>} e - The keydown event from an icon button.
   * @param {number} pageIdx - Index of the page that holds the focused icon.
   * @param {number} idx - Index of the focused icon within its page.
   * @returns {void}
   *
   * @example
   * <button onKeyDown={(e) => onGridKey(e, pi, i)} />
   */
  const onGridKey = (e: ReactKeyboardEvent<HTMLButtonElement>, pageIdx: number, idx: number) => {
    const list = pages[pageIdx];
    let next = idx;
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      return;
    }
    if (e.key === 'ArrowRight') next = idx + 1;
    else if (e.key === 'ArrowLeft') next = idx - 1;
    else if (e.key === 'ArrowDown') next = idx + m.cols;
    else if (e.key === 'ArrowUp') next = idx - m.cols;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowUp' && next < 0) {
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    let p = pageIdx;
    if (next >= list.length && pageIdx < pages.length - 1 && e.key === 'ArrowRight') {
      p = pageIdx + 1;
      next = 0;
    } else if (next < 0 && pageIdx > 0 && e.key === 'ArrowLeft') {
      p = pageIdx - 1;
      next = pages[p].length - 1;
    }
    next = Math.max(0, Math.min(pages[p].length - 1, next));
    const target = pages[p][next];
    if (!target) return;
    if (p !== pageIdx) {
      pendingFocus.current = target.id;
      goTo(p);
    } else gridRefs.current.get(target.id)?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    gridRefs.current.get(id)?.focus({ preventScroll: true });
  }, [current]);

  /**
   * Handles keys not consumed by the search field or the grid.
   *
   * Used when focus is on a page dot or outside Launchpad. Escape closes Launchpad and ←/→ flip
   * pages. A printable key moves focus to the search field; this happens on keydown, before the
   * character is inserted, so the character lands in the field. Because Launchpad is modal,
   * Escape, ←, →, Return and Space are stopped from triggering the focused window's shortcuts.
   *
   * @param {KeyboardEvent | ReactKeyboardEvent} e - A native window keydown or a React keydown from inside Launchpad.
   * @returns {void}
   *
   * @example
   * onOtherKey(e);
   */
  const onOtherKey = (e: KeyboardEvent | ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setPage((p) => Math.max(0, Math.min(pages.length - 1, p + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (isTypingKey(e)) {
      inputRef.current?.focus({ preventScroll: true });
      return;
    } else if (e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation();
  };

  /**
   * Routes keydown events that bubble up to the Launchpad root.
   *
   * Ignored while closing or during IME composition. Events from the search field are left to
   * `onInputKey`; events from the grid only redirect printable keys to the search field; all
   * other events go to `onOtherKey`.
   *
   * @param {ReactKeyboardEvent} e - The bubbled keydown event.
   * @returns {void}
   *
   * @example
   * <div onKeyDown={onRootKeyDown} />
   */
  const onRootKeyDown = (e: ReactKeyboardEvent) => {
    if (closing || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (el === inputRef.current) return;
    if (el.closest('[data-launchpad-grid]')) {
      if (isTypingKey(e)) inputRef.current?.focus({ preventScroll: true });
      return;
    }
    onOtherKey(e);
  };

  const onOtherKeyRef = useRef(onOtherKey);
  useLayoutEffect(() => {
    onOtherKeyRef.current = onOtherKey;
  });
  useEffect(() => {
    if (closing) return;
    /**
     * Forwards window-level keydowns that happen outside Launchpad to `onOtherKey`.
     *
     * Lets Escape, paging and type-to-search work while focus is outside Launchpad (for example
     * when nothing is focused). Skips events targeted inside Launchpad (its React handlers already
     * ran) and events in other text fields, then calls the latest `onOtherKey` through a ref so
     * the listener, registered once per open, never uses stale state.
     *
     * @param {KeyboardEvent} e - The native keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      onOtherKeyRef.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closing]);

  useEffect(() => {
    if (closing) handBackFocus(prevFocus, rootRef.current);
    else inputRef.current?.focus({ preventScroll: true });
  }, [closing, prevFocus]);

  /**
   * Positions the page strip at the current page plus a pixel offset.
   *
   * Writes the transform straight to the DOM so a drag does not re-render. With `animate` false
   * the CSS transition is disabled and the strip follows the pointer exactly; with `animate`
   * true the transition is restored so the strip slides to the new position.
   *
   * @param {number} dx - Horizontal offset in pixels from the current page position.
   * @param {boolean} animate - Whether the CSS slide transition applies.
   * @returns {void}
   *
   * @example
   * setStripOffset(0, true);
   */
  const setStripOffset = (dx: number, animate: boolean) => {
    const el = stripRef.current;
    if (!el) return;
    el.style.transition = animate ? '' : 'none';
    el.style.transform = `translate3d(calc(${-current * 100}% + ${dx}px), 0, 0)`;
  };

  /**
   * Starts tracking a possible swipe.
   *
   * Only the primary button is tracked, and only when there is more than one page. The swipe
   * stays inactive until `onPointerMove` sees enough horizontal movement, so ordinary clicks are
   * unaffected.
   *
   * @param {ReactPointerEvent} e - The pointerdown event on the Launchpad root.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || pages.length < 2) return;
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
  };
  /**
   * Drags the page strip with the pointer during a swipe.
   *
   * The swipe activates once the pointer has moved more than 8px, and more horizontally than
   * vertically; the pointer is then captured (a capture failure, when the pointer has already
   * been released, is ignored). While active, the strip follows the pointer, with a rubber-band
   * effect (30% of the distance) when dragging past the first or last page.
   *
   * @param {ReactPointerEvent} e - The pointermove event on the Launchpad root.
   * @returns {void}
   *
   * @example
   * <div onPointerMove={onPointerMove} />
   */
  const onPointerMove = (e: ReactPointerEvent) => {
    const sw = swipe.current;
    if (!sw || sw.id !== e.pointerId) return;
    sw.dx = e.clientX - sw.x;
    if (!sw.active && Math.abs(sw.dx) > 8 && Math.abs(sw.dx) > Math.abs(e.clientY - sw.y)) {
      sw.active = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
    }
    if (sw.active) {
      const atEdge = (current === 0 && sw.dx > 0) || (current === pages.length - 1 && sw.dx < 0);
      setStripOffset(atEdge ? sw.dx * 0.3 : sw.dx, false);
    }
  };
  /**
   * Ends a swipe and settles on a page.
   *
   * A drag beyond the threshold (15% of the viewport width, at most 160px) flips one page in that
   * direction; otherwise the strip animates back into place. The click that follows a swipe is
   * suppressed until the next task so it neither launches an app nor closes Launchpad. Also
   * handles `pointercancel`.
   *
   * @param {ReactPointerEvent} e - The pointerup or pointercancel event on the Launchpad root.
   * @returns {void}
   *
   * @example
   * <div onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
   */
  const onPointerUp = (e: ReactPointerEvent) => {
    const sw = swipe.current;
    swipe.current = null;
    if (!sw || sw.id !== e.pointerId || !sw.active) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const threshold = Math.min(160, w * 0.15);
    const target = sw.dx < -threshold ? current + 1 : sw.dx > threshold ? current - 1 : current;
    const clamped = Math.max(0, Math.min(pages.length - 1, target));
    if (clamped === current) setStripOffset(0, true);
    else {
      if (stripRef.current) stripRef.current.style.transition = '';
      goTo(clamped);
    }
  };

  // After a page change React writes the new transform; this re-enables the slide transition.
  useEffect(() => {
    if (stripRef.current) stripRef.current.style.transition = '';
  }, [current]);

  /**
   * Flips pages with the mouse wheel or a trackpad swipe.
   *
   * Deltas along the dominant axis (converted from line or page units to pixels) are accumulated,
   * and the total resets after a 250ms pause. Once it exceeds 50px one page is flipped and
   * further events are locked out for 420ms; each event arriving during the lock (such as
   * trackpad momentum) keeps it active for at least another 140ms, so one gesture flips exactly
   * one page. Does nothing when there is only one page.
   *
   * @param {ReactWheelEvent} e - The wheel event on the Launchpad root.
   * @returns {void}
   *
   * @example
   * <div onWheel={onWheel} />
   */
  const onWheel = (e: ReactWheelEvent) => {
    if (pages.length < 2) return;
    const now = performance.now();
    const wh = wheel.current;
    if (now < wh.lockedUntil) {
      wh.lockedUntil = Math.max(wh.lockedUntil, now + 140);
      return;
    }
    if (now - wh.last > 250) wh.acc = 0;
    wh.last = now;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1;
    const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    wh.acc += d;
    if (Math.abs(wh.acc) > 50) {
      goTo(current + (wh.acc > 0 ? 1 : -1));
      wheel.current = { acc: 0, last: now, lockedUntil: now + 420 };
    }
  };

  /**
   * Closes Launchpad when empty space is clicked.
   *
   * Clicks on buttons, the search field or elements marked `data-launchpad-keep` are ignored,
   * as is the click that ends a swipe.
   *
   * @param {ReactMouseEvent} e - The click event on the Launchpad root.
   * @returns {void}
   *
   * @example
   * <div onClick={onBackgroundClick} />
   */
  const onBackgroundClick = (e: ReactMouseEvent) => {
    if (suppressClick.current) return;
    const el = e.target as HTMLElement;
    if (el.closest('button, input, [data-launchpad-keep]')) return;
    close();
  };

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${m.cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${m.rows}, minmax(0, 1fr))`,
  };

  return (
    <div
      ref={rootRef}
      className={`${s.root} ${closing ? s.closing : ''}`}
      style={{ zIndex: Z.LAUNCHPAD, ['--icon' as string]: `${m.icon}px` }}
      role="dialog"
      aria-modal="true"
      aria-label={t(S.launchpad)}
      onKeyDown={onRootKeyDown}
      onClick={onBackgroundClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={s.backdrop} aria-hidden>
        <img className={s.wallpaper} src={wallpaper} alt="" draggable={false} />
      </div>

      <div className={s.content} style={{ paddingLeft: padLeft, paddingRight: padRight }}>
        <div className={s.searchWrap} style={{ height: m.top }}>
          <label className={`lg lg-capsule ${s.search}`} data-launchpad-keep>
            <Search size={14} strokeWidth={2} aria-hidden />
            <input
              ref={inputRef}
              value={query}
              placeholder={t(S.search)}
              aria-label={t(S.search)}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
            />
          </label>
        </div>

        <div className={s.viewport} style={{ marginBottom: m.bottom }} data-launchpad-grid>
          {filtered.length === 0 ? (
            <div className={s.empty}>{t(S.noResults)}</div>
          ) : (
            <div ref={stripRef} className={s.strip} style={{ transform: `translate3d(${-current * 100}%, 0, 0)` }} role="list" aria-label={t(S.apps)}>
              {pages.map((list, pi) => (
                <div key={pi} className={s.page} style={gridStyle} aria-hidden={pi !== current} inert={pi !== current ? true : undefined}>
                  {list.map((app, i) => {
                    const Icon = app.icon;
                    return (
                      <div key={app.id} className={s.cell} role="listitem">
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) gridRefs.current.set(app.id, el);
                            else gridRefs.current.delete(app.id);
                          }}
                          className={s.app}
                          style={{ animationDelay: `${Math.min(i, 20) * 6}ms` }}
                          onClick={() => !suppressClick.current && launch(app)}
                          onKeyDown={(e) => onGridKey(e, pi, i)}
                        >
                          <span className={s.icon}>
                            <Icon size={m.icon} />
                          </span>
                          <span className={s.label}>{t(app.name)}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {pages.length > 1 && (
          <div className={s.dots} style={{ bottom: m.bottom - 34 }} data-launchpad-keep>
            {pages.map((_, i) => (
              <button key={i} type="button" className={`${s.dot} ${i === current ? s.dotActive : ''}`} aria-label={t(S.page).replace('{n}', String(i + 1))} aria-current={i === current ? 'page' : undefined} onClick={() => goTo(i)}>
                <span className={`lg lg-clear lg-circle lg-flat ${s.dotGlass}`} aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

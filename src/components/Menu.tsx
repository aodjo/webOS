/**
 * macOS-style menu renderer, shared by the menu bar dropdowns, status menus and context menus.
 *
 *   <Menu items={items} x={e.clientX} y={e.clientY} onClose={close} />
 *
 * Renders a Liquid Glass menu panel at (x, y) clamped to the viewport (flipping left/up when there
 * is no room), with hover and keyboard navigation (↑ ↓ → ← ↩ ⎋, Home/End, type-to-select),
 * submenus that open on hover after a short delay with a forgiving pointer path toward them,
 * press-drag-release selection, and the macOS "blink then close" feedback on choose.
 *
 * The menu never takes keyboard focus: keys are captured at the window level while it is open,
 * so the focused text field keeps its selection and Edit ▸ Copy/Paste act on it.
 *
 * Like NSMenu tracking, a primary click outside the menu only dismisses it: the rest of that
 * press is swallowed so it doesn't also select, drag or close whatever was underneath
 * (except on elements passed through `letThrough`, e.g. the menu bar).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { MenuItem } from '@/kernel/types';
import { formatShortcut, isMacHost } from '@/kernel/menus';
import { tr, useLocale } from '@/kernel/i18n';
import { useRefraction } from './Glass';
import styles from './Menu.module.css';

/* ───────────────────────── Types ───────────────────────── */

/**
 * A kernel `MenuItem` plus a few presentation-only extras used by status menus
 * (Wi-Fi, Battery). Any `MenuItem[]` is a valid `MenuEntry[]`.
 */
export interface MenuEntry extends Omit<MenuItem, 'submenu'> {
  submenu?: MenuEntry[];
  /** Small grey bold section title (not selectable). */
  heading?: boolean;
  /** Secondary-colored informational row (not selectable). */
  info?: boolean;
  /** Arbitrary non-selectable row, e.g. a title with a switch. */
  custom?: ReactNode;
  /** Leading visual that replaces `icon` and makes the row taller (network badges…). */
  leading?: ReactNode;
  /** Extra content on the right, before the shortcut. */
  trailing?: ReactNode;
  /** Run the action without closing the menu. */
  keepOpen?: boolean;
}

/** Props of the `Menu` component. */
export interface MenuProps {
  /** Rows of the root panel. */
  items: MenuEntry[];
  /** Preferred top-left corner of the root panel (viewport px). */
  x: number;
  y: number;
  /** When the panel doesn't fit to the right, its right edge is aligned here instead (default: x). */
  flipX?: number;
  /** When the panel doesn't fit below, its bottom edge is aligned here (default: y). `null` shifts it up instead. */
  flipY?: number | null;
  /** Panels never go above this y (e.g. the menu bar height). */
  minTop?: number;
  /** Called when the menu should close (choice made, Escape, outside press, blur, resize…). */
  onClose: () => void;
  /** ← / → pressed at the root level with nothing to open or close (menu bar uses it to switch menus). */
  onNavigate?: (dir: 1 | -1) => void;
  /** Highlight the first item immediately (menus opened from the keyboard). */
  autoHighlight?: boolean;
  /** Pointer-downs on elements for which this returns true don't close the menu (e.g. menu bar titles). */
  isInside?: (el: Element) => boolean;
  /** Outside presses on these elements close the menu and still reach them (not swallowed). */
  letThrough?: (el: Element) => boolean;
  /** z-index of the root panel; each submenu level stacks one above its parent. */
  zIndex?: number;
  /** Minimum width of the root panel in px. */
  minWidth?: number;
  /** Reserve the leading checkmark column (NSMenu's state column). Default true. */
  stateColumn?: boolean;
  className?: string;
  'aria-label'?: string;
}

interface Point {
  x: number;
  y: number;
}

/** Where a panel opens: preferred corner plus the edges it flips around (see `placeMenu`). */
interface Anchor {
  x: number;
  y: number;
  flipX?: number;
  flipY?: number | null;
}

/** State of one open panel (index 0 is the root, each further entry an open submenu). */
interface Level {
  /** Highlighted index in this panel (-1 = none). */
  hl: number;
  /** Where the panel opens (submenus only; the root uses the props). */
  anchor: Anchor | null;
}

/* ───────────────────────── Geometry (pure) ───────────────────────── */

/** Input of `placeMenu`: the preferred position, the panel size and the viewport. */
export interface PlacementInput {
  x: number;
  y: number;
  width: number;
  height: number;
  flipX?: number;
  flipY?: number | null;
  viewport: { width: number; height: number };
  /** Distance kept from the viewport edges. */
  margin?: number;
  minTop?: number;
}

/** Result of `placeMenu`. */
export interface Placement {
  left: number;
  top: number;
  /** Height available to the panel; taller content scrolls. */
  maxHeight: number;
}

/**
 * Position a menu panel inside the viewport.
 *
 * Horizontally, a panel that overflows the right edge is flipped so its right edge sits at
 * `flipX` (default `x`); if that would cross the left margin it is shifted flush against the
 * right margin instead. Vertically, the usable height is the viewport minus `minTop` and the
 * margin (taller content scrolls); a panel that overflows the bottom is flipped so its bottom
 * edge sits at `flipY` (default `y`), shifted up flush with the bottom when the flip would go
 * above `minTop`, or always shifted when `flipY` is `null`. The result is clamped to the
 * margins and rounded to whole pixels.
 *
 * @param {PlacementInput} p - Preferred position, panel size, flip edges and viewport.
 * @returns {Placement} The panel's left/top and maximum height.
 *
 * @example
 * placeMenu({ x: 900, y: 50, width: 200, height: 100, viewport: { width: 1000, height: 800 } });
 * // { left: 700, top: 50, maxHeight: 792 }
 */
export function placeMenu(p: PlacementInput): Placement {
  const margin = p.margin ?? 4;
  const { width: vw, height: vh } = p.viewport;
  const minTop = Math.max(p.minTop ?? margin, 0);

  let left = p.x;
  if (left + p.width > vw - margin) {
    const flipped = (p.flipX ?? p.x) - p.width;
    left = flipped >= margin ? flipped : vw - margin - p.width;
  }
  left = Math.max(margin, Math.min(left, vw - margin - p.width));

  const maxHeight = Math.max(0, vh - margin - minTop);
  const h = Math.min(p.height, maxHeight);
  let top = p.y;
  if (top + h > vh - margin) {
    if (p.flipY === null) top = vh - margin - h;
    else {
      const flipped = (p.flipY ?? p.y) - h;
      top = flipped >= minTop ? flipped : vh - margin - h;
    }
  }
  top = Math.max(minTop, Math.min(top, vh - margin - h));
  return { left: Math.round(left), top: Math.round(top), maxHeight };
}

/**
 * Test whether a point lies inside a triangle.
 *
 * Uses the sign of the cross product of `p` against each edge: the point is inside (edges
 * included) when the signs never disagree. Works for either vertex winding.
 *
 * @param {Point} p - The point to test.
 * @param {Point} a - First vertex.
 * @param {Point} b - Second vertex.
 * @param {Point} c - Third vertex.
 * @returns {boolean} True when `p` is inside or on the edge of triangle abc.
 *
 * @example
 * pointInTriangle({ x: 2, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }); // true
 */
export function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  /**
   * Compute which side of the line p2→p3 the point p1 is on.
   *
   * Returns the 2D cross product of (p1 - p3) and (p2 - p3); its sign tells the side and it is
   * zero when the three points are collinear.
   *
   * @param {Point} p1 - The point being classified.
   * @param {Point} p2 - Start of the edge.
   * @param {Point} p3 - End of the edge.
   * @returns {number} The signed cross product (0 when the points are collinear).
   *
   * @example
   * side({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }); // 1
   */
  const side = (p1: Point, p2: Point, p3: Point) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Decide whether the pointer, moving from `from` to `to`, is heading for a submenu.
 *
 * Implements the classic "menu aim" test: the pointer is aiming when `to` lies inside the
 * triangle formed by the previous position and the submenu's near vertical edge (extended
 * 6px above and below). The near edge is the left edge when the submenu is to the right of
 * the pointer, otherwise its right edge. Movement under 1px never counts as aiming.
 *
 * @param {Point} from - An earlier pointer position.
 * @param {Point} to - The current pointer position.
 * @param {{ left: number; right: number; top: number; bottom: number }} rect - The submenu's bounding rect.
 * @returns {boolean} True when the movement points toward the submenu.
 *
 * @example
 * isAimingAt({ x: 200, y: 110 }, { x: 220, y: 130 }, { left: 300, right: 500, top: 100, bottom: 400 }); // true
 */
export function isAimingAt(from: Point, to: Point, rect: { left: number; right: number; top: number; bottom: number }): boolean {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return false;
  const edge = rect.left >= to.x ? rect.left : rect.right;
  return pointInTriangle(to, from, { x: edge, y: rect.top - 6 }, { x: edge, y: rect.bottom + 6 });
}

/* ───────────────────────── Helpers ───────────────────────── */

const PANEL_PAD = 6; /** The panel's vertical padding in px; submenus open this far above their parent row so their first row lines up with it. */
const SUBMENU_DELAY = 110; /** Delay in ms before a hovered submenu opens. */
const AIM_GRACE = 320; /** How long in ms the pointer may cross other items on its way to an open submenu before the highlight switches. */
const BLINK_MS = 130; /** Duration in ms of the highlight blink after choosing an item, before the menu closes and the action runs. */
const RELEASE_GUARD = 300; /** A pointer release within this many ms of opening doesn't choose an item (protects the press that opened the menu). */

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS', 'Process']); /** `KeyboardEvent.key` values of bare modifier and IME keys, which the menu ignores. */

/**
 * Join class names, skipping falsy entries.
 *
 * Filters out `false`, `null`, `undefined` and empty strings so conditional classes can be
 * written as `cond && styles.x`, then joins the rest with single spaces.
 *
 * @param {...(string | false | null | undefined)} c - Class names or falsy placeholders.
 * @returns {string} The space-separated class list.
 *
 * @example
 * cx(styles.item, isHl && styles.hl); // 'item hl' or 'item'
 */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/**
 * Check whether a menu entry can be highlighted and chosen.
 *
 * Separators, headings, info rows, custom rows and disabled items are not selectable;
 * a missing entry is not either.
 *
 * @param {MenuEntry | undefined} e - The entry to test.
 * @returns {boolean} True when the entry is selectable.
 *
 * @example
 * isSelectable({ label: 'Copy' });               // true
 * isSelectable({ label: 'Copy', disabled: true }); // false
 */
export function isSelectable(e: MenuEntry | undefined): boolean {
  return !!e && !e.separator && !e.heading && !e.info && e.custom === undefined && !e.disabled;
}

/**
 * Find the next selectable index in a direction, wrapping around.
 *
 * Starts one step from `from` (which may be -1 or `list.length` to start before the first or
 * after the last row) and visits every row at most once.
 *
 * @param {MenuEntry[]} list - The panel's entries.
 * @param {number} from - The index to step from.
 * @param {1 | -1} dir - 1 to move down, -1 to move up.
 * @returns {number} The next selectable index, or -1 if there is none.
 *
 * @example
 * stepIndex(items, -1, 1);           // first selectable row
 * stepIndex(items, items.length, -1); // last selectable row
 */
export function stepIndex(list: MenuEntry[], from: number, dir: 1 | -1): number {
  const n = list.length;
  for (let i = 1; i <= n; i++) {
    const j = (((from + dir * i) % n) + n) % n;
    if (isSelectable(list[j])) return j;
  }
  return -1;
}

/**
 * Get the entries shown in the panel at a given depth.
 *
 * Follows the highlighted item's submenu from the root down `level` steps; a missing
 * highlight or submenu yields an empty list.
 *
 * @param {MenuEntry[]} root - The root panel's entries.
 * @param {Level[]} levels - The open panels' state.
 * @param {number} level - Panel depth (0 = root).
 * @returns {MenuEntry[]} The entries of that panel.
 *
 * @example
 * const list = listAt(items, levels, 1); // entries of the first open submenu
 */
function listAt(root: MenuEntry[], levels: Level[], level: number): MenuEntry[] {
  let list = root;
  for (let i = 0; i < level; i++) list = list[levels[i]?.hl]?.submenu ?? [];
  return list;
}

/**
 * Cancel an event's default action.
 *
 * Used on the panel's mousedown (so pressing a row doesn't move focus away from the focused
 * field) and contextmenu events.
 *
 * @param {{ preventDefault: () => void }} e - The event.
 * @returns {void}
 *
 * @example
 * <div onMouseDown={preventDefault} />
 */
const preventDefault = (e: { preventDefault: () => void }) => e.preventDefault();

/**
 * Format a shortcut for display in a menu row.
 *
 * Outside macOS the kernel maps Ctrl to "mod", so shortcuts that spell out "ctrl" (⌃) can't
 * be typed there and are hidden. Other shortcuts are formatted with `formatShortcut`.
 *
 * @param {string} shortcut - The shortcut string, e.g. `'mod+s'`.
 * @param {boolean} [mac=isMacHost] - Whether the host is macOS.
 * @returns {string} The display label, or '' when the shortcut can't be typed on this host.
 *
 * @example
 * shortcutLabel('ctrl+mod+q', false); // ''
 * shortcutLabel('alt+w');             // '⌥W' on a Mac host, 'Alt+W' elsewhere
 */
export function shortcutLabel(shortcut: string, mac: boolean = isMacHost): string {
  if (!mac && shortcut.toLowerCase().split('+').includes('ctrl')) return '';
  return formatShortcut(shortcut);
}

/**
 * Swallow the rest of a press that dismissed a menu, the way macOS consumes that click.
 *
 * Prevents and stops `down`, then installs capturing window listeners that cancel the
 * following `mousedown`, `mouseup`, `pointerup` and `click` events. The listeners are removed
 * one task after the press ends (`pointerup` / `pointercancel`), or at the next `pointerdown`
 * if the release happened outside the page.
 *
 * @param {PointerEvent} down - The pointerdown that started the press.
 * @returns {void}
 *
 * @example
 * window.addEventListener('pointerdown', (e) => swallowPress(e), true);
 */
function swallowPress(down: PointerEvent): void {
  down.preventDefault();
  down.stopPropagation();
  const types = ['mousedown', 'mouseup', 'pointerup', 'click'] as const;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Cancel and stop one event of the swallowed press.
   *
   * Installed as a capturing window listener, so calling `preventDefault` and
   * `stopPropagation` keeps the event from reaching any element on the page.
   *
   * @param {Event} e - The event to swallow.
   * @returns {void}
   *
   * @example
   * window.addEventListener('click', stop, true);
   */
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  /**
   * Remove every listener installed for this press and cancel the pending cleanup timer.
   *
   * Runs either one task after the press ends (via `onEnd`) or on the next `pointerdown`
   * when the release was never seen; afterwards events flow to the page normally again.
   *
   * @returns {void}
   *
   * @example
   * window.addEventListener('pointerdown', done, true);
   */
  const done = () => {
    clearTimeout(timer);
    for (const type of types) window.removeEventListener(type, stop, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    window.removeEventListener('pointerdown', done, true);
  };
  /**
   * Schedule cleanup at the end of the press.
   *
   * Defers `done` by one task because `click` is dispatched right after `pointerup` /
   * `mouseup` in the same task and must still be swallowed.
   *
   * @returns {void}
   *
   * @example
   * window.addEventListener('pointerup', onEnd, true);
   */
  const onEnd = () => {
    clearTimeout(timer);
    timer = setTimeout(done, 0);
  };
  for (const type of types) window.addEventListener(type, stop, true);
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('pointerdown', done, true);
}

/* ───────────────────────── Panel ───────────────────────── */

/** Callbacks a `Panel` reports pointer activity through (implemented by `Menu`). */
interface PanelHandlers {
  enter: (level: number, idx: number, p: Point) => void;
  move: (level: number, idx: number, p: Point) => void;
  release: (level: number, idx: number, button: number, pointerType: string) => void;
  click: (level: number, idx: number, keyboardLike: boolean) => void;
  leave: (level: number) => void;
  press: () => void;
  trail: (p: Point) => void;
}

/** Props of one menu panel (the root or a submenu). */
interface PanelProps {
  level: number;
  entries: MenuEntry[];
  anchor: Anchor;
  hl: number;
  /** Index whose submenu is open (-1 = none). */
  expanded: number;
  blink: number;
  zIndex: number;
  minWidth: number;
  minTop: number;
  stateColumn: boolean;
  locale: 'en' | 'ko';
  className?: string;
  ariaLabel?: string;
  register: (level: number, el: HTMLDivElement | null) => void;
  h: PanelHandlers;
}

/**
 * Render one glass menu panel and its rows.
 *
 * The panel registers its element with the parent `Menu` by level and refracts what's behind
 * its rim like the rest of Liquid Glass (Chromium only). The rows scroll inside an inner
 * element, so the rim and sheen drawn by the panel's pseudo-elements stay put. After every
 * render the panel is measured and placed with `placeMenu` before paint (hidden until the
 * first placement), so content changes re-clamp it to the viewport; the highlighted row is
 * scrolled into view when the menu is taller than the screen.
 *
 * Separators, custom rows, headings and info rows render as non-selectable rows; other entries
 * render as `menuitem` / `menuitemcheckbox` rows with state column, icon or leading visual,
 * label, trailing content, shortcut and submenu chevron. Pointer activity is reported through
 * `h`; the mousedown default is prevented so focus never leaves the focused field, and the
 * native context menu is suppressed.
 *
 * @param {PanelProps} props - Component props.
 * @param {number} props.level - Depth of this panel (0 = root).
 * @param {MenuEntry[]} props.entries - Rows to render.
 * @param {Anchor} props.anchor - Where the panel opens.
 * @param {number} props.hl - Highlighted row index (-1 = none).
 * @param {number} props.expanded - Row whose submenu is open (-1 = none).
 * @param {number} props.blink - Row playing the choose blink (-1 = none).
 * @param {number} props.zIndex - z-index of the panel.
 * @param {number} props.minWidth - Minimum width in px.
 * @param {number} props.minTop - The panel never goes above this y.
 * @param {boolean} props.stateColumn - Whether to reserve the checkmark column.
 * @param {'en' | 'ko'} props.locale - Locale used for the labels.
 * @param {string} [props.className] - Extra class name for the panel.
 * @param {string} [props.ariaLabel] - Accessible name of the panel.
 * @param {(level: number, el: HTMLDivElement | null) => void} props.register - Reports the panel element to the parent.
 * @param {PanelHandlers} props.h - Pointer callbacks.
 * @returns {JSX.Element} The panel.
 *
 * @example
 * <Panel level={0} entries={items} anchor={{ x, y }} hl={-1} expanded={-1} blink={-1} zIndex={9000}
 *   minWidth={160} minTop={4} stateColumn locale="en" register={register} h={h} />
 */
function Panel({ level, entries, anchor, hl, expanded, blink, zIndex, minWidth, minTop, stateColumn, locale, className, ariaLabel, register, h }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const refract = useRefraction<HTMLDivElement>({ bezel: 10, scale: 18 });
  /**
   * Store the panel element and attach the refraction effect to it.
   *
   * Callback ref that keeps `ref` (used for measuring and registration) in sync with the
   * mounted element and hands the same element to `useRefraction`.
   *
   * @param {HTMLDivElement | null} el - The panel element, or null on unmount.
   * @returns {void}
   *
   * @example
   * <div ref={setPanelRef} />
   */
  const setPanelRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      refract(el);
    },
    [refract],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    register(level, ref.current);
    return () => register(level, null);
  }, [level, register]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = placeMenu({
      x: anchor.x,
      y: anchor.y,
      flipX: anchor.flipX,
      flipY: anchor.flipY,
      width: el.offsetWidth,
      height: scrollRef.current?.scrollHeight ?? el.scrollHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      minTop,
    });
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight ? p : next));
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (hl < 0 || !el || el.scrollHeight <= el.clientHeight) return;
    el.querySelector<HTMLElement>(`[data-idx="${hl}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [hl]);

  return (
    <div
      ref={setPanelRef}
      role="menu"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className={cx('lg lg-menu lg-float', styles.panel, !stateColumn && styles.noState, className)}
      style={{
        zIndex,
        minWidth,
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        maxHeight: pos?.maxHeight,
        visibility: pos ? undefined : 'hidden',
      }}
      onMouseDown={preventDefault}
      onContextMenu={preventDefault}
      onPointerDown={h.press}
      onPointerMove={(e) => h.trail({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => h.leave(level)}
    >
      <div ref={scrollRef} role="none" className={styles.scroll}>
        {entries.map((entry, idx) => {
          /**
           * Report that the pointer entered this row.
           *
           * Forwards this panel's level, the row index and the pointer position to
           * `h.enter`; attached to every row, including non-selectable ones.
           *
           * @param {React.PointerEvent} e - The pointerenter event.
           * @returns {void}
           *
           * @example
           * <div onPointerEnter={enter} />
           */
          const enter = (e: React.PointerEvent) => h.enter(level, idx, { x: e.clientX, y: e.clientY });
          if (entry.separator) return <div key={idx} role="separator" className={styles.sep} onPointerEnter={enter} />;
          if (entry.custom !== undefined)
            return (
              <div key={idx} role="none" className={styles.custom} onPointerEnter={enter}>
                {entry.custom}
              </div>
            );
          if (entry.heading)
            return (
              <div key={idx} role="none" className={styles.heading} onPointerEnter={enter}>
                {tr(entry.label, locale)}
              </div>
            );
          if (entry.info)
            return (
              <div key={idx} role="none" className={cx(styles.item, styles.info)} onPointerEnter={enter}>
                {stateColumn && <span className={styles.state} />}
                <span className={styles.label}>{tr(entry.label, locale)}</span>
                {entry.trailing && <span className={styles.trailing}>{entry.trailing}</span>}
              </div>
            );

          const Icon = entry.icon;
          const checkable = entry.checked !== undefined;
          const shortcut = entry.shortcut ? shortcutLabel(entry.shortcut) : '';
          return (
            <div
              key={idx}
              data-idx={idx}
              role={checkable ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={checkable ? !!entry.checked : undefined}
              aria-disabled={entry.disabled || undefined}
              aria-haspopup={entry.submenu ? 'menu' : undefined}
              aria-expanded={entry.submenu ? expanded === idx : undefined}
              className={cx(
                styles.item,
                hl === idx && styles.hl,
                entry.disabled && styles.disabled,
                entry.danger && styles.danger,
                !!entry.leading && styles.tall,
                blink === idx && styles.blink,
              )}
              onPointerEnter={enter}
              onPointerMove={(e) => h.move(level, idx, { x: e.clientX, y: e.clientY })}
              onPointerUp={(e) => h.release(level, idx, e.button, e.pointerType)}
              onClick={(e) => h.click(level, idx, e.detail === 0)}
            >
              {stateColumn && <span className={styles.state}>{entry.checked && <Check size={12} strokeWidth={2.75} />}</span>}
              {entry.leading ? (
                <span className={styles.leading}>{entry.leading}</span>
              ) : Icon ? (
                <span className={styles.icon}>
                  <Icon size={14} />
                </span>
              ) : null}
              <span className={styles.label}>{tr(entry.label, locale)}</span>
              {entry.trailing && <span className={styles.trailing}>{entry.trailing}</span>}
              {shortcut && <span className={styles.shortcut}>{shortcut}</span>}
              {entry.submenu && <ChevronRight className={styles.chevron} size={13} strokeWidth={2.5} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── Menu ───────────────────────── */

/**
 * Render a macOS-style menu (root panel plus any open submenus) and run its tracking.
 *
 * State is a stack of `Level`s, one per open panel. Event handlers read `levelsRef` (updated
 * synchronously by `commit`) and `latest` (the current props) so window listeners always see
 * current values, even between renders; a layout effect refreshes `latest` and the key
 * handler after every render.
 *
 * While open, capturing window listeners handle: keyboard navigation (see `keyHandler`); a
 * pointer-down outside the panels (and outside `isInside`) closes the menu and swallows the
 * rest of a plain primary press unless `letThrough` accepts the target; a wheel gesture
 * outside closes it (programmatic `scroll` events don't, since apps scroll on their own,
 * e.g. a terminal following its output); window blur and resize close it. All timers are
 * cleared on unmount.
 *
 * Because the menu never takes focus, the highlighted row's label (deepest level first) is
 * announced through a polite live region. Renders nothing when `items` is empty.
 *
 * @param {MenuProps} props - Component props (see `MenuProps`).
 * @returns {JSX.Element | null} The panels and the live region, or null for an empty menu.
 *
 * @example
 * <Menu items={items} x={e.clientX} y={e.clientY} onClose={close} />
 */
export function Menu(props: MenuProps) {
  const { items, x, y, flipX, flipY, minTop = 4, autoHighlight = false, zIndex = 9000, minWidth = 160, stateColumn = true, className } = props;
  const locale = useLocale();

  const [levels, setLevels] = useState<Level[]>(() => [{ hl: autoHighlight ? stepIndex(items, -1, 1) : -1, anchor: null }]);
  const [blink, setBlink] = useState<{ level: number; idx: number } | null>(null);

  const levelsRef = useRef(levels);
  const latest = useRef(props);
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const trail = useRef<Point[]>([]);
  const pending = useRef<{ level: number; idx: number } | null>(null);
  const subTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aimTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typed = useRef('');
  const busy = useRef(false);
  const pressInside = useRef(false);
  const openedAt = useRef(0);
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});

  /**
   * Replace the level stack, updating the ref immediately and scheduling a render.
   *
   * Writing `levelsRef` synchronously lets handlers that run before the next render (window
   * listeners, timers) read the new stack right away.
   *
   * @param {Level[]} next - The new level stack.
   * @returns {void}
   *
   * @example
   * commit(levelsRef.current.slice(0, 1));
   */
  const commit = (next: Level[]) => {
    levelsRef.current = next;
    setLevels(next);
  };
  /**
   * Get the current root entries from the latest props.
   *
   * Reads `latest.current` instead of the render-time `items`, so long-lived listeners and
   * timers always see the items of the most recent render.
   *
   * @returns {MenuEntry[]} The root panel's entries.
   *
   * @example
   * const list = listAt(root(), levelsRef.current, level);
   */
  const root = () => latest.current.items;

  /**
   * Record (or clear) the element of the panel at a level.
   *
   * Stored in `panels` by depth; used for outside-press detection, submenu anchoring and
   * menu-aim checks. Memoized so panels don't re-run their registration effect each render.
   *
   * @param {number} level - Panel depth.
   * @param {HTMLDivElement | null} el - The panel element, or null when it unmounts.
   * @returns {void}
   *
   * @example
   * register(0, panelEl);
   */
  const register = useCallback((level: number, el: HTMLDivElement | null) => {
    panels.current[level] = el;
  }, []);

  /**
   * Highlight a row, closing any deeper submenus.
   *
   * Does nothing when the row is already highlighted and nothing deeper is open.
   *
   * @param {number} level - Panel depth.
   * @param {number} idx - Row index to highlight (-1 clears the highlight).
   * @returns {void}
   *
   * @example
   * highlight(0, stepIndex(items, -1, 1));
   */
  const highlight = (level: number, idx: number) => {
    const lv = levelsRef.current;
    if (lv[level]?.hl === idx && lv.length === level + 1) return;
    commit([...lv.slice(0, level), { ...lv[level], hl: idx }]);
  };

  /**
   * Open the submenu of a row.
   *
   * Cancels a pending hover-open, then pushes a new level anchored just inside the parent
   * panel's right edge (flipping to its left edge) and `PANEL_PAD` above the row, so the
   * submenu's first row lines up with it. When that submenu is already open, it only moves
   * into it (highlighting its first selectable row if requested). Does nothing when the row
   * has no submenu or its elements aren't mounted.
   *
   * @param {number} level - Depth of the panel that owns the row.
   * @param {number} idx - Row index.
   * @param {boolean} highlightFirst - Highlight the submenu's first selectable row (keyboard).
   * @returns {void}
   *
   * @example
   * openSub(0, 3, true);
   */
  const openSub = (level: number, idx: number, highlightFirst: boolean) => {
    clearTimeout(subTimer.current);
    const lv = levelsRef.current;
    const sub = listAt(root(), lv, level)[idx]?.submenu;
    const panel = panels.current[level];
    const itemEl = panel?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    if (!sub || !panel || !itemEl) return;
    if (lv[level]?.hl === idx && lv.length > level + 1) {
      if (highlightFirst) commit([...lv.slice(0, level + 1), { ...lv[level + 1], hl: stepIndex(sub, -1, 1) }]);
      return;
    }
    const pr = panel.getBoundingClientRect();
    const ir = itemEl.getBoundingClientRect();
    commit([
      ...lv.slice(0, level),
      { ...lv[level], hl: idx },
      { hl: highlightFirst ? stepIndex(sub, -1, 1) : -1, anchor: { x: pr.right - 3, y: ir.top - PANEL_PAD, flipX: pr.left + 3, flipY: null } },
    ]);
  };

  /**
   * Apply a hover on a row.
   *
   * Cancels pending submenu/aim timers. Hovering the row that owns the open submenu collapses
   * anything deeper than that submenu and clears its highlight. Otherwise the row is
   * highlighted (or the highlight cleared for non-selectable rows) and, for a row with a
   * submenu, the submenu opens after `SUBMENU_DELAY`.
   *
   * @param {number} level - Panel depth.
   * @param {number} idx - Hovered row index.
   * @returns {void}
   *
   * @example
   * hoverSelect(0, 2);
   */
  const hoverSelect = (level: number, idx: number) => {
    clearTimeout(subTimer.current);
    clearTimeout(aimTimer.current);
    pending.current = null;
    const lv = levelsRef.current;
    if (lv[level]?.hl === idx && lv.length > level + 1) {
      if (lv.length > level + 2 || lv[level + 1].hl !== -1) commit([...lv.slice(0, level + 1), { ...lv[level + 1], hl: -1 }]);
      return;
    }
    const entry = listAt(root(), lv, level)[idx];
    const ok = isSelectable(entry);
    highlight(level, ok ? idx : -1);
    if (ok && entry.submenu) subTimer.current = setTimeout(() => openSub(level, idx, false), SUBMENU_DELAY);
  };

  /**
   * Check whether the pointer is heading for the submenu open below a level.
   *
   * Compares the oldest point of the recent pointer trail with `to` using `isAimingAt`.
   *
   * @param {number} level - Depth of the panel the pointer is in.
   * @param {Point} to - The current pointer position.
   * @returns {boolean} True when a submenu is open and the pointer is aiming at it.
   *
   * @example
   * if (aiming(0, { x: e.clientX, y: e.clientY })) return;
   */
  const aiming = (level: number, to: Point) => {
    const sub = panels.current[level + 1];
    const from = trail.current[0];
    return !!sub && !!from && isAimingAt(from, to, sub.getBoundingClientRect());
  };

  /**
   * Choose a row.
   *
   * Ignored while a choice is already blinking or when the row isn't selectable. A row with
   * a submenu opens it instead; a `keepOpen` row runs its action and leaves the menu open.
   * Otherwise the row blinks for `BLINK_MS`, then the menu closes and the action runs.
   *
   * @param {number} level - Panel depth.
   * @param {number} idx - Row index.
   * @param {boolean} viaKeyboard - Whether the choice came from the keyboard (submenus then
   *   open with their first row highlighted).
   * @returns {void}
   *
   * @example
   * activate(0, 1, false);
   */
  const activate = (level: number, idx: number, viaKeyboard: boolean) => {
    if (busy.current) return;
    const entry = listAt(root(), levelsRef.current, level)[idx];
    if (!isSelectable(entry)) return;
    if (entry.submenu) {
      openSub(level, idx, viaKeyboard);
      return;
    }
    if (entry.keepOpen) {
      entry.action?.();
      return;
    }
    busy.current = true;
    highlight(level, idx);
    setBlink({ level, idx });
    const { onClose } = latest.current;
    setTimeout(() => {
      onClose();
      entry.action?.();
    }, BLINK_MS);
  };

  /**
   * Type-to-select: highlight the next row whose label starts with the typed text.
   *
   * Characters typed within 750ms accumulate into one search string. A single character
   * searches from the row after the current one (so repeating a letter cycles through
   * matches); longer strings search from the current row. Matching is case-insensitive and
   * only considers selectable rows.
   *
   * @param {number} level - Panel depth.
   * @param {MenuEntry[]} list - The panel's entries.
   * @param {number} cur - Currently highlighted index (-1 = none).
   * @param {string} ch - The typed character.
   * @returns {void}
   *
   * @example
   * typeahead(0, items, -1, 'c');
   */
  const typeahead = (level: number, list: MenuEntry[], cur: number, ch: string) => {
    clearTimeout(typeTimer.current);
    typed.current += ch.toLowerCase();
    typeTimer.current = setTimeout(() => (typed.current = ''), 750);
    const buf = typed.current;
    const start = buf.length === 1 ? cur + 1 : Math.max(cur, 0);
    for (let i = 0; i < list.length; i++) {
      const j = (start + i) % list.length;
      if (isSelectable(list[j]) && tr(list[j].label, locale).toLowerCase().startsWith(buf)) {
        highlight(level, j);
        return;
      }
    }
  };

  const h: PanelHandlers = {
    /**
     * Handle the pointer entering a row.
     *
     * Ignored while a choice is blinking. When a submenu is open, a different row of its
     * parent panel is entered, and the pointer is aiming at the submenu, the hover is
     * deferred by `AIM_GRACE` (so crossing other rows on the way doesn't switch submenus);
     * otherwise it is applied immediately.
     *
     * @param {number} level - Panel depth.
     * @param {number} idx - Row index.
     * @param {Point} p - Pointer position.
     * @returns {void}
     *
     * @example
     * h.enter(0, 2, { x: e.clientX, y: e.clientY });
     */
    enter: (level, idx, p) => {
      if (busy.current) return;
      const lv = levelsRef.current;
      if (lv.length > level + 1 && lv[level].hl !== idx && aiming(level, p)) {
        clearTimeout(aimTimer.current);
        pending.current = { level, idx };
        aimTimer.current = setTimeout(() => {
          const pend = pending.current;
          if (pend) hoverSelect(pend.level, pend.idx);
        }, AIM_GRACE);
        return;
      }
      hoverSelect(level, idx);
    },
    /**
     * Handle pointer movement within a row.
     *
     * Applies a deferred hover on this row as soon as the pointer stops aiming at the submenu.
     *
     * @param {number} level - Panel depth.
     * @param {number} idx - Row index.
     * @param {Point} p - Pointer position.
     * @returns {void}
     *
     * @example
     * h.move(0, 2, { x: e.clientX, y: e.clientY });
     */
    move: (level, idx, p) => {
      const pend = pending.current;
      if (pend && pend.level === level && pend.idx === idx && !aiming(level, p)) hoverSelect(level, idx);
    },
    /**
     * Handle a pointer release over a row.
     *
     * Chooses the row for a press-drag-release that started outside the menu (e.g. on a menu
     * bar title, or a right-button hold from the context click) once `RELEASE_GUARD` has
     * passed since opening — mouse and pen only, so a finger lifting after a long-press never
     * chooses — or for a right-button press that started inside the menu. Middle-button
     * releases are ignored.
     *
     * @param {number} level - Panel depth.
     * @param {number} idx - Row index.
     * @param {number} button - The released mouse button.
     * @param {string} pointerType - `mouse`, `pen` or `touch`.
     * @returns {void}
     *
     * @example
     * h.release(0, 2, e.button, e.pointerType);
     */
    release: (level, idx, button, pointerType) => {
      if (button === 1) return;
      const dragged = pointerType !== 'touch' && !pressInside.current && performance.now() - openedAt.current > RELEASE_GUARD;
      if (dragged || (pressInside.current && button === 2)) activate(level, idx, false);
    },
    /**
     * Handle a click on a row.
     *
     * Chooses the row via `activate`; synthetic clicks are treated like keyboard choices, so
     * a submenu opened this way gets its first row highlighted.
     *
     * @param {number} level - Panel depth.
     * @param {number} idx - Row index.
     * @param {boolean} keyboardLike - True for synthetic clicks (`detail === 0`, e.g. assistive tech).
     * @returns {void}
     *
     * @example
     * h.click(0, 2, e.detail === 0);
     */
    click: (level, idx, keyboardLike) => activate(level, idx, keyboardLike),
    /**
     * Handle the pointer leaving a panel.
     *
     * Cancels a deferred hover and, for the deepest panel (unless a choice is blinking),
     * cancels a pending submenu open and clears its highlight.
     *
     * @param {number} level - Panel depth.
     * @returns {void}
     *
     * @example
     * h.leave(1);
     */
    leave: (level) => {
      clearTimeout(aimTimer.current);
      pending.current = null;
      const lv = levelsRef.current;
      if (level === lv.length - 1 && lv[level].hl !== -1 && !busy.current) {
        clearTimeout(subTimer.current);
        highlight(level, -1);
      }
    },
    /**
     * Record that the current press started inside the menu.
     *
     * The flag is reset by the window `pointerup` listener after the release has been handled.
     *
     * @returns {void}
     *
     * @example
     * <div onPointerDown={h.press} />
     */
    press: () => {
      pressInside.current = true;
    },
    /**
     * Append a pointer position to the trail used for menu aim.
     *
     * The trail holds at most the last 4 points; the oldest one is what `aiming` compares
     * the current position against.
     *
     * @param {Point} p - Pointer position.
     * @returns {void}
     *
     * @example
     * h.trail({ x: e.clientX, y: e.clientY });
     */
    trail: (p) => {
      const pts = trail.current;
      pts.push(p);
      if (pts.length > 4) pts.shift();
    },
  };

  useLayoutEffect(() => {
    latest.current = props;
    /**
     * Handle a key press while the menu is open.
     *
     * Bare modifier keys and IME composition are ignored; while a choice is blinking every
     * other key is swallowed. Keys act on the deepest panel that has a highlight (a
     * hover-opened submenu has none yet): ↑/↓ move, Home/PageUp and End/PageDown jump to the
     * first/last row, → opens a submenu or calls `onNavigate(1)`, ← closes the submenu or
     * calls `onNavigate(-1)`, Enter chooses (or closes with nothing highlighted), Space
     * chooses unless a type-ahead is in progress, Escape closes, and printable characters
     * type-ahead. Tab is swallowed. A key combined with ⌘/Ctrl/⌥ closes the menu and is left
     * to reach the global shortcut handler. Handled keys are prevented and stopped.
     *
     * @param {KeyboardEvent} e - The keydown event (captured on the window).
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', (e) => keyHandler.current(e), true);
     */
    keyHandler.current = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key) || e.isComposing) return;
      if (busy.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const lv = levelsRef.current;
      let focus = 0;
      for (let i = lv.length - 1; i > 0; i--) {
        if (lv[i].hl !== -1) {
          focus = i;
          break;
        }
      }
      const list = listAt(root(), lv, focus);
      const cur = lv[focus]?.hl ?? -1;
      const entry = cur >= 0 ? list[cur] : undefined;
      switch (e.key) {
        case 'ArrowDown':
          highlight(focus, stepIndex(list, cur, 1));
          break;
        case 'ArrowUp':
          highlight(focus, stepIndex(list, cur < 0 ? list.length : cur, -1));
          break;
        case 'Home':
        case 'PageUp':
          highlight(focus, stepIndex(list, -1, 1));
          break;
        case 'End':
        case 'PageDown':
          highlight(focus, stepIndex(list, list.length, -1));
          break;
        case 'ArrowRight':
          if (entry?.submenu && isSelectable(entry)) openSub(focus, cur, true);
          else latest.current.onNavigate?.(1);
          break;
        case 'ArrowLeft':
          if (focus > 0) commit(lv.slice(0, focus));
          else latest.current.onNavigate?.(-1);
          break;
        case 'Enter':
          if (entry) activate(focus, cur, true);
          else latest.current.onClose();
          break;
        case ' ':
          if (typed.current) typeahead(focus, list, cur, ' ');
          else if (entry) activate(focus, cur, true);
          break;
        case 'Escape':
          latest.current.onClose();
          break;
        case 'Tab':
          break;
        default:
          if (e.metaKey || e.ctrlKey || e.altKey) {
            latest.current.onClose();
            return;
          }
          if (e.key.length !== 1) return;
          typeahead(focus, list, cur, e.key);
      }
      e.preventDefault();
      e.stopPropagation();
    };
  });

  useEffect(() => {
    openedAt.current = performance.now();
    /**
     * Check whether an event target belongs to the menu.
     *
     * True for nodes inside any open panel, and for elements accepted by the `isInside` prop.
     *
     * @param {EventTarget | null} target - The event target.
     * @returns {boolean} True when the target counts as inside the menu.
     *
     * @example
     * if (inside(e.target)) return;
     */
    const inside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (panels.current.some((p) => p?.contains(target))) return true;
      return target instanceof Element && !!latest.current.isInside?.(target);
    };
    /**
     * Close the menu through the latest `onClose` prop.
     *
     * Used directly as the window `blur` and `resize` listener and by the outside-press and
     * wheel handlers.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('blur', close);
     */
    const close = () => latest.current.onClose();
    /**
     * Dismiss the menu on a pointer-down outside it.
     *
     * The rest of a plain primary press is swallowed (`swallowPress`) so it doesn't also act
     * on what's underneath. Secondary clicks and ⌃-clicks go through (they open the next
     * context menu), as do presses on elements accepted by `letThrough`.
     *
     * @param {PointerEvent} e - The pointerdown event (captured on the window).
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerdown', onDown, true);
     */
    const onDown = (e: PointerEvent) => {
      if (inside(e.target)) return;
      close();
      const passes = e.target instanceof Element && !!latest.current.letThrough?.(e.target);
      if (e.button === 0 && !e.ctrlKey && !passes) swallowPress(e);
    };
    /**
     * Clear the "press started inside" flag after a release.
     *
     * The reset is deferred one task so the whole pointerup/click dispatch still sees the flag.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerup', onUp, true);
     */
    const onUp = () => {
      setTimeout(() => (pressInside.current = false), 0);
    };
    /**
     * Dismiss the menu on a wheel gesture outside it.
     *
     * Listens to `wheel` rather than `scroll`, so programmatic scrolling by apps (e.g. a
     * terminal following its output) never closes the menu.
     *
     * @param {WheelEvent} e - The wheel event (captured on the window).
     * @returns {void}
     *
     * @example
     * window.addEventListener('wheel', onWheel, { capture: true, passive: true });
     */
    const onWheel = (e: WheelEvent) => {
      if (!inside(e.target)) close();
    };
    /**
     * Forward a keydown to the current key handler.
     *
     * Indirects through `keyHandler.current`, which is replaced after every render, so the
     * listener installed once on mount always runs the up-to-date handler.
     *
     * @param {KeyboardEvent} e - The keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey, true);
     */
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      clearTimeout(subTimer.current);
      clearTimeout(aimTimer.current);
      clearTimeout(typeTimer.current);
    };
  }, []);

  if (!items.length) return null;

  let announced = '';
  for (let level = levels.length - 1; level >= 0; level--) {
    const entry = levels[level].hl >= 0 ? listAt(items, levels, level)[levels[level].hl] : undefined;
    if (entry) {
      announced = tr(entry.label, locale);
      break;
    }
  }

  const rendered: ReactNode[] = [];
  let list = items;
  for (let level = 0; level < levels.length; level++) {
    if (level > 0) {
      list = list[levels[level - 1].hl]?.submenu ?? [];
      if (!list.length) break;
    }
    const anchor = level === 0 ? { x, y, flipX, flipY } : levels[level].anchor;
    if (!anchor) break;
    const next = levels[level + 1];
    rendered.push(
      <Panel
        key={level === 0 ? 'root' : `${level}:${levels[level - 1].hl}`}
        level={level}
        entries={list}
        anchor={anchor}
        hl={levels[level].hl}
        expanded={next ? levels[level].hl : -1}
        blink={blink?.level === level ? blink.idx : -1}
        zIndex={zIndex + level}
        minWidth={level === 0 ? minWidth : 120}
        minTop={minTop}
        stateColumn={stateColumn}
        locale={locale}
        className={className}
        ariaLabel={level === 0 ? props['aria-label'] : undefined}
        register={register}
        h={h}
      />,
    );
  }
  return (
    <>
      {rendered}
      <div className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announced}
      </div>
    </>
  );
}

/**
 * Render a status-menu title row with a control on the right.
 *
 * Used as a `custom` entry, e.g. "Wi-Fi  [switch]" at the top of a status menu.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.title - The bold title on the left.
 * @param {ReactNode} [props.children] - The control on the right.
 * @returns {JSX.Element} The header row.
 *
 * @example
 * <MenuHeaderRow title="Wi-Fi"><Switch checked={on} onChange={setOn} /></MenuHeaderRow>
 */
export function MenuHeaderRow({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.headerRow}>
      <span className={styles.headerTitle}>{title}</span>
      {children}
    </div>
  );
}

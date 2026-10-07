/**
 * Desktop widgets (top-left) as Liquid Glass tiles: an analog clock with the date, and a "Now"
 * card about the portfolio owner. Like macOS, they recede into monochrome clear glass while an
 * app window is focused, and "Edit Widgets…" shows a glass gallery to add or remove them.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ArrowUpRight, Clock, MapPin, Minus, Plus, UserRound } from 'lucide-react';
import { fs, showContextMenu, useLocale, useNode, useSystem, useT, useWM, wm, type Locale, type LString } from '@/kernel';
import { Button } from '@/components/ui';
import { useRefraction } from '@/components/Glass';
import { owner } from '@/data/portfolio';
import { clockCityLabel, hostTimeZone } from './cities';
import { desktopUI, useDesktopUI, WIDGET_IDS, type WidgetId } from './desktopStore';
import { useWallpaperLuminance } from '../menubar/wallpaperTone';
import styles from './Widgets.module.css';

const S = {
  widgets: { en: 'Widgets', ko: '위젯' },
  done: { en: 'Done', ko: '완료' },
  add: { en: 'Add {name} widget', ko: '{name} 위젯 추가' },
  remove: { en: 'Remove {name} widget', ko: '{name} 위젯 제거' },
  removeWidget: { en: 'Remove Widget', ko: '위젯 제거' },
  editWidgets: { en: 'Edit Widgets…', ko: '위젯 편집…' },
  projects: { en: 'Projects', ko: '프로젝트' },
  openAboutMe: { en: 'Open About Me', ko: '내 소개 열기' },
} satisfies Record<string, LString>; /** Localized UI strings for the widgets, their context menu and the edit gallery. */

const WIDGET_REGION = { x0: 0, y0: 0.03, x1: 0.16, y1: 0.45 }; /** Viewport region (fractions) behind the widget stack, sampled to pick the content tone. */
const DARK_CONTENT_ABOVE = 0.42; /** Wallpaper luminance above which the widgets switch to frosted glass with dark content. */

const WIDGETS: Record<WidgetId, { name: LString; description: LString; icon: ComponentType<{ size?: number }> }> = {
  clock: { name: { en: 'Clock', ko: '시계' }, description: { en: 'Local time and date', ko: '현재 시간과 날짜' }, icon: Clock },
  now: { name: { en: 'Now', ko: '지금' }, description: { en: 'Who made this OS', ko: '이 OS를 만든 사람' }, icon: UserRound },
}; /** Display metadata (name, gallery description, gallery icon) for each widget id. */

/**
 * Resolves a localized template and substitutes its `{name}` placeholder.
 *
 * Picks the string for `locale` from an `LString` (or uses it directly when it is a plain
 * string) and replaces the first `{name}` occurrence with `name`.
 *
 * @param {LString} s - Template string containing a `{name}` placeholder.
 * @param {Locale} locale - Locale used to pick the translation.
 * @param {string} name - Value inserted in place of `{name}`.
 * @returns {string} The localized string with the name filled in.
 *
 * @example
 * fill(S.remove, 'en', 'Clock'); // 'Remove Clock widget'
 */
const fill = (s: LString, locale: Locale, name: string) => (typeof s === 'string' ? s : s[locale]).replace('{name}', name);

/**
 * Desktop widget column plus the edit-mode gallery.
 *
 * Renders every visible widget (per the desktop UI store) in a vertical stack at the given
 * position. The content is white on clear glass, or dark on frosted glass when the desktop
 * picture behind the stack is brighter than DARK_CONTENT_ABOVE. Widgets are dimmed into clear monochrome glass while an app window has focus,
 * unless edit mode is on. In edit mode the gallery is shown at the bottom of the screen, and
 * pressing Escape (outside text inputs) leaves edit mode; clicking the wallpaper, handled by
 * the desktop, does the same. Memoized so desktop re-renders do not re-render the widgets.
 *
 * @param {Object} props - Component props.
 * @param {number} props.left - Left offset of the widget stack, in pixels.
 * @param {number} props.top - Top offset of the widget stack, in pixels.
 * @param {number} props.bottom - Bottom offset of the edit gallery, in pixels.
 * @returns {JSX.Element} The widget stack and, in edit mode, the gallery.
 *
 * @example
 * <Widgets left={16} top={40} bottom={96} />
 */
export const Widgets = memo(function Widgets({ left, top, bottom }: { left: number; top: number; bottom: number }) {
  const visible = useDesktopUI((s) => s.widgets);
  const editing = useDesktopUI((s) => s.editingWidgets);
  const appFocused = useWM((s) => s.focusedId !== null);
  const lum = useWallpaperLuminance(WIDGET_REGION);
  const tone = lum !== null && lum > DARK_CONTENT_ABOVE ? 'dark' : 'light';

  useEffect(() => {
    if (!editing) return;
    /**
     * Leaves widget edit mode when Escape is pressed.
     *
     * Ignores the key when it originates from an `<input>` or `<textarea>` so that text
     * fields keep their own Escape handling.
     *
     * @param {KeyboardEvent} e - The window keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) desktopUI.setEditing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  return (
    <>
      <div className={styles.stack} data-tone={tone} style={{ left, top }}>
        {WIDGET_IDS.filter((id) => visible[id]).map((id) => (
          <WidgetFrame key={id} id={id} dimmed={appFocused && !editing} editing={editing}>
            {id === 'clock' ? <ClockWidget /> : <NowWidget />}
          </WidgetFrame>
        ))}
      </div>
      {editing && <WidgetGallery bottom={bottom} />}
    </>
  );
});

/**
 * Glass tile that hosts a single widget.
 *
 * Applies the Liquid Glass classes and optics (switching to clear glass when dimmed), offers a
 * context menu with "Remove Widget" and "Edit Widgets…", and in edit mode shows a "−" badge that
 * hides the widget. Content is wrapped so CSS can desaturate it while dimmed and make it
 * non-interactive in edit mode.
 *
 * @param {Object} props - Component props.
 * @param {WidgetId} props.id - Which widget the tile hosts.
 * @param {boolean} props.dimmed - Whether the tile recedes into monochrome clear glass.
 * @param {boolean} props.editing - Whether widget edit mode is active.
 * @param {ReactNode} props.children - The widget's content.
 * @returns {JSX.Element} The widget tile.
 *
 * @example
 * <WidgetFrame id="clock" dimmed={false} editing={false}><ClockWidget /></WidgetFrame>
 */
function WidgetFrame({ id, dimmed, editing, children }: { id: WidgetId; dimmed: boolean; editing: boolean; children: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const name = t(WIDGETS[id].name);
  const refract = useRefraction<HTMLElement>();
  return (
    <section
      ref={refract}
      data-widget=""
      aria-label={name}
      className={`lg ${dimmed ? 'lg-clear' : ''} ${styles.widget} ${dimmed ? styles.dimmed : ''} ${editing ? styles.editing : ''}`}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: S.removeWidget, action: () => desktopUI.setWidget(id, false) },
          { separator: true },
          { label: S.editWidgets, action: () => desktopUI.setEditing(true) },
        ])
      }
    >
      <div className={styles.content}>{children}</div>
      {editing && (
        <button type="button" className={`lg lg-thick lg-circle ${styles.remove}`} aria-label={fill(S.remove, locale, name)} onClick={() => desktopUI.setWidget(id, false)}>
          <Minus size={12} strokeWidth={3} />
        </button>
      )}
    </section>
  );
}

/* ───────────────────────── Clock ───────────────────────── */

/**
 * Milliseconds until just after the next minute boundary.
 *
 * Adds a 25 ms margin so a timer scheduled with this delay fires after the minute has
 * rolled over rather than slightly before it.
 *
 * @param {Date} d - The current time.
 * @returns {number} Delay in milliseconds until the next minute begins (plus 25 ms).
 *
 * @example
 * setTimeout(tick, msToNextMinute(new Date()));
 */
const msToNextMinute = (d: Date) => 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 25;

/**
 * Writes the clock-hand CSS variables for a given time onto the clock face.
 *
 * The hands are driven by infinite linear CSS animations; negative animation delays
 * (`--sec-delay`, `--min-delay`, `--hour-delay`) start each one at the current position, giving
 * a smooth sweep without per-second renders. The static angles (`--min-deg`, `--hour-deg`) are
 * used instead when motion is reduced. Changing the delay of an already running animation would
 * double-count elapsed time, so callers remount the hands before resyncing.
 *
 * @param {SVGSVGElement} el - The clock face element that receives the custom properties.
 * @param {Date} d - The time to display.
 * @returns {void}
 *
 * @example
 * setHands(faceRef.current, new Date());
 */
function setHands(el: SVGSVGElement, d: Date): void {
  const s = d.getSeconds() + d.getMilliseconds() / 1000;
  const m = d.getMinutes() + s / 60;
  const h = (d.getHours() % 12) + m / 60;
  el.style.setProperty('--sec-delay', `${-s}s`);
  el.style.setProperty('--min-delay', `${-m * 60}s`);
  el.style.setProperty('--hour-delay', `${-h * 3600}s`);
  el.style.setProperty('--min-deg', `${m * 6}deg`);
  el.style.setProperty('--hour-deg', `${h * 30}deg`);
}

const NUMERALS = Array.from({ length: 12 }, (_, i) => i + 1); /** Hour numerals 1–12 drawn around the dial. */
const TICKS = Array.from({ length: 60 }, (_, i) => i); /** Minute tick indices 0–59; every fifth is a major tick. */

/**
 * Analog clock widget with the city label and date.
 *
 * Draws an SVG dial whose hands are animated by CSS (see `setHands`). The city label follows
 * the UI language ("SEO" / "서울") while the host time zone is read once per mount. The date
 * label re-renders once a minute via a timer aligned to the minute boundary. The hands are
 * remounted (by bumping `syncKey`) and re-anchored to the wall clock at the top of every hour
 * and whenever the page becomes visible again, because background tabs throttle timers and the
 * system clock can change (DST, manual adjustments). The layout effect writes the hand
 * variables after the remounted hands are in the DOM but before their animations start.
 *
 * @returns {JSX.Element} The clock face.
 *
 * @example
 * <WidgetFrame id="clock" dimmed={false} editing={false}><ClockWidget /></WidgetFrame>
 */
function ClockWidget() {
  const locale = useLocale();
  const faceRef = useRef<SVGSVGElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [zone] = useState(hostTimeZone);
  const city = useMemo(() => clockCityLabel(locale, zone), [locale, zone]);
  const [syncKey, setSyncKey] = useState(0);

  useLayoutEffect(() => {
    if (faceRef.current) setHands(faceRef.current, new Date());
  }, [syncKey]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    /**
     * Minute tick: updates the displayed date and schedules the next tick.
     *
     * Stores the current time in state, bumps the sync key at minute 0 so the hands are
     * re-anchored to the wall clock every hour, and re-arms the timer for the next minute
     * boundary.
     *
     * @returns {void}
     *
     * @example
     * timer = setTimeout(tick, msToNextMinute(new Date()));
     */
    const tick = () => {
      const d = new Date();
      setNow(d);
      if (d.getMinutes() === 0) setSyncKey((k) => k + 1);
      timer = setTimeout(tick, msToNextMinute(d));
    };
    timer = setTimeout(tick, msToNextMinute(new Date()));
    /**
     * Resynchronizes the clock when the page becomes visible again.
     *
     * Background tabs throttle timers, so on becoming visible this cancels the pending tick,
     * remounts the hands to re-anchor them, and runs a tick immediately. Does nothing when the
     * page is being hidden.
     *
     * @returns {void}
     *
     * @example
     * document.addEventListener('visibilitychange', onVisible);
     */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      setSyncKey((k) => k + 1);
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(now);
  const dateLabel = locale === 'ko' ? `${now.getDate()}일 ${weekday}` : `${weekday.toUpperCase()} ${now.getDate()}`;
  const spoken = new Intl.DateTimeFormat(tag, { dateStyle: 'full', timeStyle: 'short' }).format(now);

  return (
    <div className={styles.clock}>
      <svg ref={faceRef} className={styles.face} viewBox="0 0 100 100" role="img" aria-label={spoken}>
        <circle cx="50" cy="50" r="48" className={styles.dial} />
        {TICKS.map((i) => (
          <line key={i} x1="50" y1={i % 5 ? 4.5 : 4} x2="50" y2={i % 5 ? 6.5 : 8} className={i % 5 ? styles.tick : styles.tickMajor} transform={`rotate(${i * 6} 50 50)`} />
        ))}
        {NUMERALS.map((n) => {
          const a = (n / 12) * Math.PI * 2;
          return (
            <text key={n} x={50 + 34 * Math.sin(a)} y={50 - 34 * Math.cos(a) + 3.6} className={styles.numeral}>
              {n}
            </text>
          );
        })}
        <text x="50" y="33" className={styles.city}>
          {city}
        </text>
        <text x="50" y="72" className={styles.date}>
          {dateLabel}
        </text>
        <g key={syncKey}>
          <line x1="50" y1="50" x2="50" y2="26" className={`${styles.hand} ${styles.hourHand}`} />
          <line x1="50" y1="50" x2="50" y2="14" className={`${styles.hand} ${styles.minuteHand}`} />
          <g className={`${styles.hand} ${styles.secondHand}`}>
            <line x1="50" y1="59" x2="50" y2="12" />
            <circle cx="50" cy="50" r="2.2" />
          </g>
        </g>
        <circle cx="50" cy="50" r="0.9" className={styles.pin} />
      </svg>
    </div>
  );
}

/* ───────────────────────── Now (portfolio) ───────────────────────── */

/**
 * "Now" card introducing the portfolio owner.
 *
 * Shows the avatar, name, role and location; the name and avatar come from the user's settings
 * and fall back to the portfolio data. The avatar may be a public asset URL or an absolute path
 * in the virtual file system, which is resolved through `fs.getURL`. When there is no avatar or
 * the image fails to load, the owner's initials (up to two letters) are shown instead. Clicking
 * the card opens About Me; the capsule button opens Projects.
 *
 * @returns {JSX.Element} The Now card content.
 *
 * @example
 * <WidgetFrame id="now" dimmed={false} editing={false}><NowWidget /></WidgetFrame>
 */
function NowWidget() {
  const t = useT();
  const fullName = useSystem((s) => s.settings.fullName) || t(owner.name);
  const avatar = useSystem((s) => s.settings.avatar) || owner.avatar;
  const avatarNode = useNode(avatar.startsWith('/') ? avatar : null);
  const src = avatarNode?.type === 'file' ? fs.getURL(avatarNode.path) : avatar;
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const initials = fullName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={styles.now}>
      <button type="button" className={styles.nowMain} onClick={() => wm.launch('about-me')} aria-label={`${t(S.openAboutMe)} — ${fullName}`}>
        <span className={styles.avatar}>
          {src && brokenSrc !== src ? <img src={src} alt="" draggable={false} onError={() => setBrokenSrc(src)} /> : <span className={styles.initials}>{initials}</span>}
          <span className={styles.status} aria-hidden />
        </span>
        <span className={styles.nowName}>{fullName}</span>
        <span className={styles.nowRole}>{t(owner.role)}</span>
        <span className={styles.nowLocation}>
          <MapPin size={10} strokeWidth={2.4} />
          {t(owner.location)}
        </span>
      </button>
      <button type="button" className={styles.nowCta} onClick={() => wm.launch('projects')}>
        {t(S.projects)}
        <ArrowUpRight size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/* ───────────────────────── Gallery (edit mode) ───────────────────────── */

/**
 * Edit-mode gallery for adding and removing widgets.
 *
 * A thick glass panel centered at the bottom of the screen that lists every widget with its
 * icon, name and description, plus a green "+" / gray "−" toggle that shows or hides it via the
 * desktop UI store. "Done" leaves edit mode.
 *
 * @param {Object} props - Component props.
 * @param {number} props.bottom - Bottom offset of the panel, in pixels.
 * @returns {JSX.Element} The gallery panel.
 *
 * @example
 * {editing && <WidgetGallery bottom={96} />}
 */
function WidgetGallery({ bottom }: { bottom: number }) {
  const t = useT();
  const locale = useLocale();
  const visible = useDesktopUI((s) => s.widgets);
  return (
    <div className={`lg lg-thick lg-float ${styles.gallery}`} style={{ bottom }} role="region" aria-label={t(S.widgets)} data-widget="">
      <div className={styles.galleryHeader}>
        <span className={styles.galleryTitle}>{t(S.widgets)}</span>
        <Button variant="primary" onClick={() => desktopUI.setEditing(false)}>
          {t(S.done)}
        </Button>
      </div>
      <div className={styles.galleryItems}>
        {WIDGET_IDS.map((id) => {
          const meta = WIDGETS[id];
          const on = visible[id];
          const name = t(meta.name);
          return (
            <div key={id} className={styles.galleryItem}>
              <span className={styles.galleryIcon}>
                <meta.icon size={20} />
              </span>
              <span className={styles.galleryText}>
                <span className={styles.galleryName}>{name}</span>
                <span className={styles.galleryDesc}>{t(meta.description)}</span>
              </span>
              <button
                type="button"
                className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
                aria-pressed={on}
                aria-label={fill(on ? S.remove : S.add, locale, name)}
                onClick={() => desktopUI.setWidget(id, !on)}
              >
                {on ? <Minus size={12} strokeWidth={3} /> : <Plus size={12} strokeWidth={3} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

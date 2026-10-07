/**
 * Notification Center widgets: World Clock (medium), Calendar (small) and Portfolio (small).
 */
import { useState } from 'react';
import type { LString } from '@/kernel/types';
import { wm } from '@/kernel/wm';
import { fs, useNode } from '@/kernel/fs';
import { useSystem } from '@/kernel/system';
import { useLocale, useT } from '@/kernel/i18n';
import { owner } from '@/data/portfolio';
import { CITIES } from '@/shell/desktop/cities';
import { monthGrid, zoneCaption, zonedTime } from './format';
import { useNow } from './hooks';
import styles from './Widgets.module.css';

const S = {
  worldClock: { en: 'World Clock', ko: '세계 시계' },
  calendar: { en: 'Calendar', ko: '캘린더' },
  portfolio: { en: 'Portfolio', ko: '포트폴리오' },
  aboutMe: { en: 'About Me', ko: '내 소개' },
  projects: { en: 'Projects', ko: '프로젝트' },
} satisfies Record<string, LString>; /** Localized widget names and button labels. */

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']; /** Full English month names for the Calendar widget title, indexed by 0-based month. */
const WEEKDAYS = { en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], ko: ['일', '월', '화', '수', '목', '금', '토'] }; /** Calendar column headers per locale, Sunday first. */

/**
 * Joins CSS class names, skipping falsy entries.
 *
 * Lets callers write conditional classes inline (`cond && styles.x`): `false`, `null`,
 * `undefined` and empty strings are dropped before the rest are joined with spaces.
 *
 * @param {...(string | false | null | undefined)} c - Class names or falsy placeholders.
 * @returns {string} The space-separated class list.
 *
 * @example
 * cx(styles.clock, night && styles.night); // "clock night" or "clock"
 */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const TILE = 'lg lg-thick'; /** Thick Liquid Glass classes (styles/glass.css) shared by every widget tile. */

/* ───────────────────────── World Clock ───────────────────────── */

/**
 * Draws an analog clock face for the World Clock widget.
 *
 * Hand angles are in degrees clockwise from 12: the hour hand moves 30° per hour plus 0.5° per
 * minute, the minute hand 6° per minute plus 0.1° per second, and the second hand 6° per second.
 * Numerals 1–12 sit on a radius of 36 in the 100×100 viewBox. `night` switches to the dark face.
 *
 * @param {Object} props - Component props.
 * @param {number} props.h - Hour of the day (0–23).
 * @param {number} props.m - Minute (0–59).
 * @param {number} props.s - Second (0–59).
 * @param {boolean} props.night - Whether to draw the dark night-time face.
 * @returns {JSX.Element} The clock SVG (hidden from assistive technology).
 *
 * @example
 * <AnalogClock h={15} m={41} s={7} night={false} />
 */
function AnalogClock({ h, m, s, night }: { h: number; m: number; s: number; night: boolean }) {
  const hour = (h % 12) * 30 + m * 0.5;
  const minute = m * 6 + s * 0.1;
  const second = s * 6;
  return (
    <svg viewBox="0 0 100 100" className={cx(styles.clock, night && styles.night)} aria-hidden="true">
      <circle cx="50" cy="50" r="49" className={styles.face} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = ((i + 1) * Math.PI) / 6;
        return (
          <text key={i} x={50 + 36 * Math.sin(a)} y={50 - 36 * Math.cos(a) + 4.6} textAnchor="middle" className={styles.numeral}>
            {i + 1}
          </text>
        );
      })}
      <line x1="50" y1="50" x2="50" y2="27" className={styles.hand} strokeWidth="5" transform={`rotate(${hour} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="13" className={styles.hand} strokeWidth="3.4" transform={`rotate(${minute} 50 50)`} />
      <line x1="50" y1="60" x2="50" y2="11" className={styles.second} strokeWidth="1.5" transform={`rotate(${second} 50 50)`} />
      <circle cx="50" cy="50" r="3.4" className={styles.pin} />
    </svg>
  );
}

/**
 * Renders the medium World Clock widget.
 *
 * Re-renders every second and shows one analog clock per entry of `CITIES`, with the city name
 * and a caption relating its day and offset to local time. A clock uses the night face between
 * 18:00 and 06:00 in its own time zone.
 *
 * @returns {JSX.Element} The widget tile.
 *
 * @example
 * <WorldClockWidget />
 */
function WorldClockWidget() {
  const t = useT();
  const locale = useLocale();
  const now = new Date(useNow(1000));
  return (
    <section data-lg-optics className={cx(TILE, styles.widget, styles.medium, styles.world)} aria-label={t(S.worldClock)}>
      {CITIES.map((c) => {
        const z = zonedTime(now, c.tz);
        return (
          <div key={c.tz} className={styles.city}>
            <AnalogClock h={z.h} m={z.m} s={z.s} night={z.h < 6 || z.h >= 18} />
            <div className={styles.cityName}>{t(c.name)}</div>
            <div className={styles.cityMeta}>{zoneCaption(z, locale)}</div>
          </div>
        );
      })}
    </section>
  );
}

/* ───────────────────────── Calendar ───────────────────────── */

/**
 * Renders the small Calendar widget for the current month.
 *
 * Re-renders every minute so the month and the highlighted day roll over at midnight. The title
 * is "N월" in Korean and the upper-cased month name otherwise. Days come from `monthGrid`
 * (Sunday first, empty padding cells); weekend columns are dimmed and today is circled and
 * marked with `aria-current="date"`.
 *
 * @returns {JSX.Element} The widget tile with an ARIA grid of days.
 *
 * @example
 * <CalendarWidget />
 */
function CalendarWidget() {
  const t = useT();
  const locale = useLocale();
  const today = new Date(useNow(60000));
  const y = today.getFullYear();
  const mo = today.getMonth();
  const rows = monthGrid(y, mo);
  const title = locale === 'ko' ? `${mo + 1}월` : EN_MONTHS[mo].toUpperCase();
  return (
    <section data-lg-optics className={cx(TILE, styles.widget, styles.small, styles.calendar)} aria-label={t(S.calendar)}>
      <div className={styles.month}>{title}</div>
      <div className={styles.calGrid} role="grid">
        <div className={styles.calRow} role="row">
          {WEEKDAYS[locale].map((d, i) => (
            <span key={i} role="columnheader" className={styles.weekday}>
              {d}
            </span>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={r} className={styles.calRow} role="row">
            {row.map((d, i) => (
              <span
                key={i}
                role="gridcell"
                aria-current={d === today.getDate() ? 'date' : undefined}
                className={cx(styles.day, (i === 0 || i === 6) && styles.weekend, d === today.getDate() && styles.today)}
              >
                {d ?? ''}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── Portfolio ───────────────────────── */

/**
 * Renders the small Portfolio widget: the owner's picture, name, role and two app shortcuts.
 *
 * The name is the account's full name from system settings, falling back to the portfolio owner.
 * The picture is the account picture from system settings, falling back to the owner's avatar: a
 * path starting with "/" that names a file in the virtual FS is served through `fs.getURL`, any
 * other value is used as the image URL directly. If the image fails to load, the first letter of
 * the name is shown instead until the source changes.
 *
 * @param {Object} props - Component props.
 * @param {(appId: string) => void} props.onLaunch - Opens the app with the given id.
 * @returns {JSX.Element} The widget tile.
 *
 * @example
 * <PortfolioWidget onLaunch={(id) => wm.launch(id)} />
 */
function PortfolioWidget({ onLaunch }: { onLaunch: (appId: string) => void }) {
  const t = useT();
  const name = useSystem((s) => s.settings.fullName) || t(owner.name);
  const avatar = useSystem((s) => s.settings.avatar) || owner.avatar;
  const avatarNode = useNode(avatar.startsWith('/') ? avatar : null);
  const src = avatarNode?.type === 'file' ? fs.getURL(avatarNode.path) : avatar;
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = brokenSrc === src;
  return (
    <section data-lg-optics className={cx(TILE, styles.widget, styles.small, styles.portfolio)} aria-label={t(S.portfolio)}>
      {broken ? (
        <span className={cx(styles.avatar, styles.initials)}>{name.slice(0, 1).toUpperCase()}</span>
      ) : (
        <img className={styles.avatar} src={src} alt="" draggable={false} onError={() => setBrokenSrc(src)} />
      )}
      <div className={styles.pName}>{name}</div>
      <div className={styles.pRole}>{t(owner.role)}</div>
      <div className={styles.pButtons}>
        <button type="button" onClick={() => onLaunch('about-me')}>
          {t(S.aboutMe)}
        </button>
        <button type="button" onClick={() => onLaunch('projects')}>
          {t(S.projects)}
        </button>
      </div>
    </section>
  );
}

/**
 * Renders the Notification Center widget grid.
 *
 * Lays out World Clock, Calendar and Portfolio. The grid is marked `data-nc-backdrop` so clicks
 * on its empty space close Notification Center.
 *
 * @param {Object} props - Component props.
 * @param {() => void} props.onDone - Called before a widget launches an app (closes the panel).
 * @returns {JSX.Element} The widget grid.
 *
 * @example
 * <Widgets onDone={() => setOpen(false)} />
 */
export function Widgets({ onDone }: { onDone: () => void }) {
  /**
   * Closes the panel and launches an app.
   *
   * Calls `onDone` first, then `wm.launch`, which behaves like clicking the app's Dock icon
   * (an existing window is focused instead of opening a new one).
   *
   * @param {string} appId - Id of the app to launch.
   * @returns {void}
   *
   * @example
   * launch('projects');
   */
  const launch = (appId: string) => {
    onDone();
    wm.launch(appId);
  };
  return (
    <div className={styles.widgets} data-nc-backdrop>
      <WorldClockWidget />
      <CalendarWidget />
      <PortfolioWidget onLaunch={launch} />
    </div>
  );
}

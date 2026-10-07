/**
 * Pure formatting helpers for the menu bar clock, notification timestamps and the world clock.
 */
import type { Locale } from '@/kernel/types';

const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; /** Short English weekday names, indexed by `Date#getDay()`. */
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; /** Short English month names, indexed by `Date#getMonth()`. */
const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토']; /** Single-character Korean weekday names, indexed by `Date#getDay()`. */

/**
 * Zero-pads a number to two digits.
 *
 * Numbers that already have two or more digits are returned unchanged as strings.
 *
 * @param {number} n - The number to pad (minutes, seconds, hours).
 * @returns {string} The number with a leading zero when it has a single digit.
 *
 * @example
 * pad(5); // "05"
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** Menu bar clock preferences. */
export interface ClockOptions {
  /** Use a 24-hour clock instead of 12-hour with AM/PM. */
  clock24h: boolean;
  /** Append seconds to the time. */
  showSeconds: boolean;
}

/**
 * Formats the menu bar clock, split into its date and time parts like macOS.
 *
 * English renders "Fri Oct 2" + "3:41 PM"; Korean renders "10월 2일 (금)" + "오후 3:41" with the
 * AM/PM marker first. The 12-hour clock shows 12 for noon and midnight; the 24-hour clock pads
 * the hour to two digits. Seconds are appended as ":ss" when enabled.
 *
 * @param {Date} d - The moment to format, in local time.
 * @param {Locale} locale - Display locale (`'en'` or `'ko'`).
 * @param {ClockOptions} o - 12/24-hour and seconds preferences.
 * @returns {{ date: string; time: string }} The date part and the time part.
 *
 * @example
 * formatMenuClock(new Date(2026, 9, 2, 15, 41), 'en', { clock24h: false, showSeconds: false });
 * // { date: 'Fri Oct 2', time: '3:41 PM' }
 */
export function formatMenuClock(d: Date, locale: Locale, o: ClockOptions): { date: string; time: string } {
  const h = d.getHours();
  const m = d.getMinutes();
  const sec = o.showSeconds ? `:${pad(d.getSeconds())}` : '';
  let time: string;
  if (o.clock24h) {
    time = `${pad(h)}:${pad(m)}${sec}`;
  } else {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const pm = h >= 12;
    time = locale === 'ko' ? `${pm ? '오후' : '오전'} ${h12}:${pad(m)}${sec}` : `${h12}:${pad(m)}${sec} ${pm ? 'PM' : 'AM'}`;
  }
  const date =
    locale === 'ko'
      ? `${d.getMonth() + 1}월 ${d.getDate()}일 (${KO_DAYS[d.getDay()]})`
      : `${EN_DAYS[d.getDay()]} ${EN_MONTHS[d.getMonth()]} ${d.getDate()}`;
  return { date, time };
}

/**
 * Formats a Notification Center timestamp relative to now.
 *
 * Under a minute it reads "now" ("지금"), under an hour "5m ago" ("5분 전"), under a day
 * "2h ago" ("2시간 전"), and older timestamps fall back to a short month/day date. Timestamps in
 * the future are treated as "now".
 *
 * @param {number} ts - The timestamp to describe, in ms since the epoch.
 * @param {number} now - The current time, in ms since the epoch.
 * @param {Locale} locale - Display locale (`'en'` or `'ko'`).
 * @returns {string} The relative time label.
 *
 * @example
 * relativeTime(Date.now() - 5 * 60_000, Date.now(), 'en'); // "5m ago"
 */
export function relativeTime(ts: number, now: number, locale: Locale): string {
  const min = Math.floor(Math.max(0, now - ts) / 60000);
  if (min < 1) return locale === 'ko' ? '지금' : 'now';
  if (min < 60) return locale === 'ko' ? `${min}분 전` : `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return locale === 'ko' ? `${h}시간 전` : `${h}h ago`;
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' }).format(ts);
}

/* ───────────────────────── Time zones ───────────────────────── */

const zoneFormatters = new Map<string, Intl.DateTimeFormat>(); /** Cache of numeric date/time formatters keyed by IANA time zone. */

/**
 * Returns a cached formatter that splits a date into numeric parts in a time zone.
 *
 * The formatter uses the en-US locale with a 23-hour cycle so `formatToParts` yields plain
 * numbers for year, month, day, hour, minute and second. Formatters are created once per zone
 * and reused from `zoneFormatters`.
 *
 * @param {string} timeZone - IANA time zone name, e.g. "Asia/Seoul".
 * @returns {Intl.DateTimeFormat} The formatter for that zone.
 * @throws {RangeError} When `timeZone` is not a valid time zone.
 *
 * @example
 * zoneFormatter('Europe/London').formatToParts(new Date());
 */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = zoneFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zoneFormatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock time in a time zone and how it relates to local time. */
export interface ZonedTime {
  /** Hour of the day (0–23). */
  h: number;
  /** Minute (0–59). */
  m: number;
  /** Second (0–59). */
  s: number;
  /** -1 yesterday, 0 today, 1 tomorrow — relative to the local calendar day. */
  dayOffset: number;
  /** Whole/fractional hours ahead of local time. */
  offsetHours: number;
}

/**
 * Computes the wall-clock time in a time zone, plus how it relates to the local time zone.
 *
 * Splits `date` into its parts in `timeZone`, then compares that wall-clock time with the local
 * one by encoding both as UTC timestamps. The offset is rounded to the nearest quarter hour and
 * the day offset compares the two calendar dates. An hour of 24 (reported by some engines at
 * midnight) is normalized to 0.
 *
 * @param {Date} date - The moment to convert.
 * @param {string} timeZone - IANA time zone name, e.g. "America/New_York".
 * @returns {ZonedTime} The zoned hour, minute, second, day offset and hour offset.
 * @throws {RangeError} When `timeZone` is not a valid time zone.
 *
 * @example
 * const z = zonedTime(new Date(), 'Asia/Tokyo');
 * console.log(z.h, z.offsetHours);
 */
export function zonedTime(date: Date, timeZone: string): ZonedTime {
  const parts: Record<string, number> = {};
  for (const p of zoneFormatter(timeZone).formatToParts(date)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const zoned = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  const zonedDay = Date.UTC(parts.year, parts.month - 1, parts.day);
  const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return {
    h: parts.hour % 24,
    m: parts.minute,
    s: parts.second,
    dayOffset: Math.round((zonedDay - localDay) / 86400000),
    offsetHours: Math.round(((zoned - local) / 3600000) * 4) / 4,
  };
}

/**
 * Builds the world clock caption for a zoned time.
 *
 * Combines the relative day ("Today" / "Tomorrow" / "Yesterday", or "오늘" / "내일" / "어제")
 * with the signed hour offset, using a true minus sign (U+2212) for negative offsets. Whole
 * offsets have no decimals, half hours one decimal and quarter hours two.
 *
 * @param {ZonedTime} z - The zoned time from `zonedTime`.
 * @param {Locale} locale - Display locale (`'en'` or `'ko'`).
 * @returns {string} A caption such as "Today, +0HRS" or "어제, −16시간".
 *
 * @example
 * zoneCaption({ h: 0, m: 0, s: 0, dayOffset: 0, offsetHours: 5.5 }, 'en'); // "Today, +5.5HRS"
 */
export function zoneCaption(z: ZonedTime, locale: Locale): string {
  const day =
    z.dayOffset === 0 ? (locale === 'ko' ? '오늘' : 'Today') : z.dayOffset > 0 ? (locale === 'ko' ? '내일' : 'Tomorrow') : locale === 'ko' ? '어제' : 'Yesterday';
  const sign = z.offsetHours >= 0 ? '+' : '−';
  const abs = Math.abs(z.offsetHours);
  const num = Number.isInteger(abs) ? String(abs) : abs.toFixed(abs * 2 === Math.round(abs * 2) ? 1 : 2);
  return locale === 'ko' ? `${day}, ${sign}${num}시간` : `${day}, ${sign}${num}HRS`;
}

/* ───────────────────────── Calendar ───────────────────────── */

/**
 * Lays out a month as calendar weeks.
 *
 * Returns rows of 7 cells, Sunday first. Cells before the 1st and after the last day of the
 * month are `null`, so every row has exactly 7 entries.
 *
 * @param {number} year - Full year, e.g. 2026.
 * @param {number} month - 0-based month (0 = January).
 * @returns {(number | null)[][]} Weeks of day numbers, with `null` for padding cells.
 *
 * @example
 * monthGrid(2026, 9)[0]; // [null, null, null, null, 1, 2, 3]
 */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/* ───────────────────────── Battery ───────────────────────── */

/**
 * Formats a Battery Status API duration as "h:mm".
 *
 * Rounds to the nearest minute. Returns an empty string for zero, negative, infinite or NaN
 * values, which the API uses for "unknown" or "not applicable".
 *
 * @param {number} seconds - Duration in seconds.
 * @returns {string} The duration as "h:mm", or "" when there is nothing meaningful to show.
 *
 * @example
 * formatHM(4980); // "1:23"
 */
export function formatHM(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

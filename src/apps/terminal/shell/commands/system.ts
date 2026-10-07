/** System information & process commands: date, cal, uptime, who, whoami, id, hostname, uname, sw_vers, ps, kill, killall, top. */
import { HOSTNAME, USER, getApp, listApps, tr, useSystem, useWM, wm, type Process } from '@/kernel';
import { osInfo } from '@/data/portfolio';
import { c, displayWidth, truncateWidth } from '../ansi';
import { listTTYs } from '../ttys';
import type { CommandContext, CommandDef, Job } from '../types';
import { findJob } from './builtins';
import { DAYS, MONTHS, getopt, padEnd, padStart, seeded, sleep, table, tzAbbr, usageError } from '../util';

/**
 * Zero-pads a number to two digits.
 *
 * Used for clock and date fields; values with two or more digits are
 * returned unchanged.
 *
 * @param {number} n - Number to format.
 * @returns {string} The number as a string of at least two characters.
 *
 * @example
 * two(7); // '07'
 */
const two = (n: number) => String(n).padStart(2, '0');

/**
 * Reads the current system locale.
 *
 * Looks the locale up in the system store on every call, so output follows
 * a language change made while the terminal is open.
 *
 * @returns {Locale} The active locale ('en' or 'ko').
 *
 * @example
 * const ko = locale() === 'ko';
 */
const locale = () => useSystem.getState().settings.locale;
const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토']; /** Korean one-letter weekday names, Sunday first, used by date and cal in the `ko` locale. */

/* ───────────────────────── date ───────────────────────── */

/**
 * Formats a date with a subset of the C `strftime` conversion codes.
 *
 * Replaces each `%X` code in `fmt` with the matching date field, read in
 * local time or, when `utc` is true, in UTC. Supported codes: %Y %y %C %m
 * %d %e %H %I %M %S %p %a %A %b %h %B %j %u %w %s %Z %z %F %T %R %D %c %x
 * %X %n %t %%. Day, month and AM/PM names and the %c / %x layouts follow
 * the system locale, using Korean wording when it is `ko`. Unknown codes
 * are left in the output unchanged.
 *
 * @param {string} fmt - Format string containing `%` codes.
 * @param {Date} d - Date to format.
 * @param {boolean} [utc=false] - Read UTC fields and report the zone as "UTC" instead of local time.
 * @returns {string} The formatted date.
 *
 * @example
 * strftime('%Y-%m-%d %H:%M', new Date(2026, 9, 3, 9, 5)); // '2026-10-03 09:05'
 */
export function strftime(fmt: string, d: Date, utc = false): string {
  const ko = locale() === 'ko';
  const year = utc ? d.getUTCFullYear() : d.getFullYear();
  const month = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  const hours = utc ? d.getUTCHours() : d.getHours();
  const minutes = utc ? d.getUTCMinutes() : d.getMinutes();
  const seconds = utc ? d.getUTCSeconds() : d.getSeconds();
  const wday = utc ? d.getUTCDay() : d.getDay();
  const start = utc ? Date.UTC(year, 0, 1) : new Date(year, 0, 1).getTime();
  const yday = Math.floor((d.getTime() - start) / 86_400_000) + 1;
  const offset = utc ? 0 : -d.getTimezoneOffset();
  const map: Record<string, () => string> = {
    /**
     * Formats %Y, the full year.
     *
     * Returns the year as a plain decimal number without padding.
     *
     * @returns {string} The year.
     *
     * @example
     * strftime('%Y', new Date(2026, 9, 3, 14, 5, 9)); // '2026'
     */
    Y: () => String(year),
    /**
     * Formats %y, the year within its century.
     *
     * Returns the last two digits of the year, zero-padded.
     *
     * @returns {string} The two-digit year.
     *
     * @example
     * strftime('%y', new Date(2026, 9, 3, 14, 5, 9)); // '26'
     */
    y: () => two(year % 100),
    /**
     * Formats %C, the century.
     *
     * Returns the year divided by 100 and rounded down, zero-padded to
     * two digits.
     *
     * @returns {string} The two-digit century.
     *
     * @example
     * strftime('%C', new Date(2026, 9, 3, 14, 5, 9)); // '20'
     */
    C: () => two(Math.floor(year / 100)),
    /**
     * Formats %m, the month number.
     *
     * Returns the one-based month, zero-padded to two digits.
     *
     * @returns {string} The two-digit month.
     *
     * @example
     * strftime('%m', new Date(2026, 9, 3, 14, 5, 9)); // '10'
     */
    m: () => two(month + 1),
    /**
     * Formats %d, the day of the month.
     *
     * Returns the day, zero-padded to two digits.
     *
     * @returns {string} The two-digit day.
     *
     * @example
     * strftime('%d', new Date(2026, 9, 3, 14, 5, 9)); // '03'
     */
    d: () => two(day),
    /**
     * Formats %e, the space-padded day of the month.
     *
     * Returns the day right-aligned in two columns with a leading space.
     *
     * @returns {string} The space-padded day.
     *
     * @example
     * strftime('%e', new Date(2026, 9, 3, 14, 5, 9)); // ' 3'
     */
    e: () => padStart(day, 2),
    /**
     * Formats %H, the hour on a 24-hour clock.
     *
     * Returns the hour (0-23), zero-padded to two digits.
     *
     * @returns {string} The two-digit hour.
     *
     * @example
     * strftime('%H', new Date(2026, 9, 3, 14, 5, 9)); // '14'
     */
    H: () => two(hours),
    /**
     * Formats %I, the hour on a 12-hour clock.
     *
     * Returns the hour (1-12), mapping midnight and noon to 12, zero-padded
     * to two digits.
     *
     * @returns {string} The two-digit 12-hour value.
     *
     * @example
     * strftime('%I', new Date(2026, 9, 3, 14, 5, 9)); // '02'
     */
    I: () => two(hours % 12 || 12),
    /**
     * Formats %M, the minute.
     *
     * Returns the minute, zero-padded to two digits.
     *
     * @returns {string} The two-digit minute.
     *
     * @example
     * strftime('%M', new Date(2026, 9, 3, 14, 5, 9)); // '05'
     */
    M: () => two(minutes),
    /**
     * Formats %S, the second.
     *
     * Returns the second, zero-padded to two digits.
     *
     * @returns {string} The two-digit second.
     *
     * @example
     * strftime('%S', new Date(2026, 9, 3, 14, 5, 9)); // '09'
     */
    S: () => two(seconds),
    /**
     * Formats %p, the AM/PM marker.
     *
     * Returns "AM" before noon and "PM" from noon on, or "오전" / "오후"
     * in the Korean locale.
     *
     * @returns {string} The localized day-half marker.
     *
     * @example
     * strftime('%p', new Date(2026, 9, 3, 14, 5, 9)); // 'PM' in the en locale
     */
    p: () => (ko ? (hours < 12 ? '오전' : '오후') : hours < 12 ? 'AM' : 'PM'),
    /**
     * Formats %a, the abbreviated weekday name.
     *
     * Returns the three-letter English name, or the one-letter Korean name
     * in the Korean locale.
     *
     * @returns {string} The short weekday name.
     *
     * @example
     * strftime('%a', new Date(2026, 9, 3, 14, 5, 9)); // 'Sat' in the en locale
     */
    a: () => (ko ? KO_DAYS[wday] : DAYS[wday]),
    /**
     * Formats %A, the full weekday name.
     *
     * Returns the full English name, or the Korean name followed by
     * "요일" in the Korean locale.
     *
     * @returns {string} The full weekday name.
     *
     * @example
     * strftime('%A', new Date(2026, 9, 3, 14, 5, 9)); // 'Saturday' in the en locale
     */
    A: () => (ko ? `${KO_DAYS[wday]}요일` : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wday]),
    /**
     * Formats %b, the abbreviated month name.
     *
     * Returns the three-letter English name, or "N월" in the Korean locale.
     *
     * @returns {string} The short month name.
     *
     * @example
     * strftime('%b', new Date(2026, 9, 3, 14, 5, 9)); // 'Oct' in the en locale
     */
    b: () => (ko ? `${month + 1}월` : MONTHS[month]),
    /**
     * Formats %h, a synonym for %b.
     *
     * Returns the three-letter English month name, or "N월" in the Korean
     * locale.
     *
     * @returns {string} The short month name.
     *
     * @example
     * strftime('%h', new Date(2026, 9, 3, 14, 5, 9)); // 'Oct' in the en locale
     */
    h: () => (ko ? `${month + 1}월` : MONTHS[month]),
    /**
     * Formats %B, the full month name.
     *
     * Returns the full English name, or "N월" in the Korean locale.
     *
     * @returns {string} The full month name.
     *
     * @example
     * strftime('%B', new Date(2026, 9, 3, 14, 5, 9)); // 'October' in the en locale
     */
    B: () => (ko ? `${month + 1}월` : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month]),
    /**
     * Formats %j, the day of the year.
     *
     * Returns the one-based day number within the year, zero-padded to
     * three digits.
     *
     * @returns {string} The three-digit day of the year.
     *
     * @example
     * strftime('%j', new Date(2026, 9, 3, 14, 5, 9)); // '276'
     */
    j: () => String(yday).padStart(3, '0'),
    /**
     * Formats %u, the ISO weekday number.
     *
     * Returns 1 for Monday through 7 for Sunday.
     *
     * @returns {string} The weekday number.
     *
     * @example
     * strftime('%u', new Date(2026, 9, 3, 14, 5, 9)); // '6'
     */
    u: () => String(wday || 7),
    /**
     * Formats %w, the weekday number counted from Sunday.
     *
     * Returns 0 for Sunday through 6 for Saturday.
     *
     * @returns {string} The weekday number.
     *
     * @example
     * strftime('%w', new Date(2026, 9, 3, 14, 5, 9)); // '6'
     */
    w: () => String(wday),
    /**
     * Formats %s, the Unix timestamp.
     *
     * Returns the whole seconds elapsed since the epoch; the value does not
     * depend on `utc`.
     *
     * @returns {string} The timestamp in seconds.
     *
     * @example
     * strftime('%s', new Date(0)); // '0'
     */
    s: () => String(Math.floor(d.getTime() / 1000)),
    /**
     * Formats %Z, the time zone abbreviation.
     *
     * Returns "UTC" in UTC mode, otherwise the local zone abbreviation
     * from `tzAbbr`.
     *
     * @returns {string} The zone abbreviation.
     *
     * @example
     * strftime('%Z', new Date()); // e.g. 'KST'
     */
    Z: () => (utc ? 'UTC' : tzAbbr(d.getTime())),
    /**
     * Formats %z, the numeric UTC offset.
     *
     * Returns a sign followed by the offset's hours and minutes (+HHMM);
     * always "+0000" in UTC mode.
     *
     * @returns {string} The UTC offset.
     *
     * @example
     * strftime('%z', new Date()); // e.g. '+0900'
     */
    z: () => `${offset >= 0 ? '+' : '-'}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`,
    /**
     * Formats %F, the ISO 8601 date.
     *
     * Returns the date as year-month-day with zero-padded month and day.
     *
     * @returns {string} The date as YYYY-MM-DD.
     *
     * @example
     * strftime('%F', new Date(2026, 9, 3, 14, 5, 9)); // '2026-10-03'
     */
    F: () => `${year}-${two(month + 1)}-${two(day)}`,
    /**
     * Formats %T, the 24-hour time with seconds.
     *
     * Returns hours, minutes and seconds, each zero-padded to two digits.
     *
     * @returns {string} The time as HH:MM:SS.
     *
     * @example
     * strftime('%T', new Date(2026, 9, 3, 14, 5, 9)); // '14:05:09'
     */
    T: () => `${two(hours)}:${two(minutes)}:${two(seconds)}`,
    /**
     * Formats %R, the 24-hour time without seconds.
     *
     * Returns hours and minutes, each zero-padded to two digits.
     *
     * @returns {string} The time as HH:MM.
     *
     * @example
     * strftime('%R', new Date(2026, 9, 3, 14, 5, 9)); // '14:05'
     */
    R: () => `${two(hours)}:${two(minutes)}`,
    /**
     * Formats %D, the US-style short date.
     *
     * Returns month, day and two-digit year separated by slashes.
     *
     * @returns {string} The date as MM/DD/YY.
     *
     * @example
     * strftime('%D', new Date(2026, 9, 3, 14, 5, 9)); // '10/03/26'
     */
    D: () => `${two(month + 1)}/${two(day)}/${two(year % 100)}`,
    /**
     * Formats %c, the locale's date and time.
     *
     * Formats the same date again with "%a %b %e %T %Y", or with
     * "%Y. %m. %e. (%a) %H:%M:%S" in the Korean locale, keeping the UTC
     * mode.
     *
     * @returns {string} The full date and time.
     *
     * @example
     * strftime('%c', new Date(2026, 9, 3, 14, 5, 9)); // 'Sat Oct  3 14:05:09 2026' in the en locale
     */
    c: () => strftime(ko ? '%Y. %m. %e. (%a) %H:%M:%S' : '%a %b %e %T %Y', d, utc),
    /**
     * Formats %x, the locale's date.
     *
     * Formats the same date again with "%m/%d/%y", or with "%Y. %m. %d."
     * in the Korean locale, keeping the UTC mode.
     *
     * @returns {string} The localized date.
     *
     * @example
     * strftime('%x', new Date(2026, 9, 3, 14, 5, 9)); // '10/03/26' in the en locale
     */
    x: () => strftime(ko ? '%Y. %m. %d.' : '%m/%d/%y', d, utc),
    /**
     * Formats %X, the locale's time.
     *
     * Formats the same date again with "%T" in every locale, keeping the
     * UTC mode.
     *
     * @returns {string} The time as HH:MM:SS.
     *
     * @example
     * strftime('%X', new Date(2026, 9, 3, 14, 5, 9)); // '14:05:09'
     */
    X: () => strftime('%T', d, utc),
    /**
     * Formats %n as a newline.
     *
     * Returns a single line feed character.
     *
     * @returns {string} A line feed.
     *
     * @example
     * strftime('%Y%n', new Date()); // e.g. '2026\n'
     */
    n: () => '\n',
    /**
     * Formats %t as a tab.
     *
     * Returns a single horizontal tab character.
     *
     * @returns {string} A tab.
     *
     * @example
     * strftime('%H%t%M', new Date()); // e.g. '14\t05'
     */
    t: () => '\t',
    /**
     * Formats %% as a literal percent sign.
     *
     * Returns a single "%" character.
     *
     * @returns {string} A percent sign.
     *
     * @example
     * strftime('100%%', new Date()); // '100%'
     */
    '%': () => '%',
  };
  return fmt.replace(/%([A-Za-z%])/g, (m, k: string) => (map[k] ? map[k]() : m));
}

const date: CommandDef = {
  name: 'date',
  group: 'system',
  summary: { en: 'display the date and time', ko: '날짜와 시간 표시' },
  usage: 'date [-u] [+format]',
  description: {
    en: 'Prints the current date. A +format argument uses strftime codes, e.g. date "+%Y-%m-%d %H:%M".',
    ko: '현재 날짜를 출력합니다. +형식 인자에는 strftime 코드를 씁니다. 예: date "+%Y-%m-%d %H:%M"',
  },
  options: [['-u', { en: 'Use UTC', ko: 'UTC 기준' }]],
  /**
   * Prints the current date and time.
   *
   * A `+FORMAT` argument is formatted with `strftime`; otherwise a default
   * layout is used (Korean wording in the `ko` locale, the BSD `date` layout
   * otherwise). `-u` formats in UTC. Any other argument prints the BSD usage
   * text.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 on success, 1 on an invalid argument.
   *
   * @example
   * date.run({ ...ctx, args: ['+%H:%M'] }); // prints e.g. '14:03'
   */
  run(ctx) {
    const utc = ctx.args.includes('-u');
    const fmt = ctx.args.find((a) => a.startsWith('+'));
    const bad = ctx.args.find((a) => a !== '-u' && !a.startsWith('+'));
    if (bad) return usageError(ctx, `illegal time format`, 'date [-jnRu] [-I[date|hours|minutes|seconds]] [-f input_fmt]\n            [-r filename|seconds] [-v[+|-]val[y|m|w|d|H|M|S]]\n            [[[[mm]dd]HH]MM[[cc]yy][.SS] | new_date] [+output_fmt]');
    const now = new Date();
    const def = locale() === 'ko' ? '%Y년 %m월 %e일 %A %H시 %M분 %S초 %Z' : '%a %b %e %T %Z %Y';
    ctx.print(strftime(fmt ? fmt.slice(1) : def, now, utc));
    return 0;
  },
}; /** `date`: prints the current date and time, optionally in UTC or with a strftime format. */

/* ───────────────────────── cal ───────────────────────── */

/**
 * Renders one month of a calendar as fixed-width lines.
 *
 * Produces a centered "Month Year" title, a weekday header (Korean in the
 * `ko` locale) and the day grid starting on Sunday. Every line is padded to
 * 20 columns and the block is padded to 8 lines, so months can be placed
 * side by side in the year view. The `highlight` day is shown in inverse
 * video when `tty` is true.
 *
 * @param {number} year - Full year.
 * @param {number} month - Zero-based month (0 = January).
 * @param {number | null} highlight - Day of the month to highlight, or null for none.
 * @param {boolean} tty - Whether output goes to a terminal, which enables the inverse highlight.
 * @returns {string[]} Eight lines of 20 columns each.
 *
 * @example
 * ctx.print(monthBlock(2026, 9, 3, true).join('\n'));
 */
function monthBlock(year: number, month: number, highlight: number | null, tty: boolean): string[] {
  const ko = locale() === 'ko';
  const title = ko ? `${month + 1}월 ${year}` : `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month]} ${year}`;
  const w = displayWidth(title);
  const left = Math.floor((20 - w) / 2);
  const lines = [padEnd(' '.repeat(left) + title, 20), ko ? KO_DAYS.join(' ') : 'Su Mo Tu We Th Fr Sa'];
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  let row: string[] = Array.from({ length: first }, () => '  ');
  for (let d = 1; d <= days; d++) {
    const cell = padStart(d, 2);
    row.push(d === highlight && tty ? c.inverse(cell) : cell);
    if (row.length === 7) {
      lines.push(row.join(' '));
      row = [];
    }
  }
  if (row.length) lines.push(padEnd(row.join(' '), 20));
  while (lines.length < 8) lines.push(' '.repeat(20));
  return lines.map((l) => padEnd(l, 20));
}

const cal: CommandDef = {
  name: 'cal',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'display a calendar', ko: '달력 표시' },
  usage: 'cal [[month] year]',
  description: { en: 'Shows the current month with today highlighted. "cal 2026" shows the whole year.', ko: '오늘이 강조된 이번 달 달력을 표시합니다. "cal 2026"은 한 해 전체를 표시합니다.' },
  options: [['-y', { en: 'Show the whole current year', ko: '올해 전체 표시' }]],
  /**
   * Prints a calendar for a month or a whole year.
   *
   * With no arguments, prints the current month with today highlighted.
   * `cal MONTH YEAR` prints that month (MONTH must be 1–12); `cal YEAR` or
   * `-y` prints all twelve months of the year in rows of three. Today is
   * highlighted only when it falls in a displayed month. Non-numeric
   * arguments print a usage error.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 on success, 1 on an invalid month or argument.
   *
   * @example
   * cal.run({ ...ctx, args: ['2', '2026'] }); // prints February 2026
   */
  run(ctx) {
    const now = new Date();
    const tty = ctx.stdout.isTTY;
    const nums = ctx.args.filter((a) => a !== '-y' && a !== '-h').map(Number);
    if (nums.some((n) => !Number.isInteger(n))) return usageError(ctx, 'not a valid year or month', 'cal [-3hjy] [[month] year]');
    /**
     * Returns the day to highlight in a given month.
     *
     * Yields today's day of the month only when the year and month are the
     * current ones, so other months render without a highlight.
     *
     * @param {number} y - Full year.
     * @param {number} m - Zero-based month.
     * @returns {number | null} Today's day of the month, or null for any other month.
     *
     * @example
     * monthBlock(y, m, today(y, m), tty);
     */
    const today = (y: number, m: number) => (y === now.getFullYear() && m === now.getMonth() ? now.getDate() : null);
    if (nums.length === 2) {
      const [m, y] = nums;
      if (m < 1 || m > 12) {
        ctx.error(`${m} is neither a month number (1..12) nor a name`);
        return 1;
      }
      ctx.print(monthBlock(y, m - 1, today(y, m - 1), tty).join('\n').trimEnd());
      return 0;
    }
    if (nums.length === 1 || ctx.args.includes('-y')) {
      const y = nums[0] ?? now.getFullYear();
      const out = [padStart(String(y), 34)];
      for (let q = 0; q < 4; q++) {
        const blocks = [0, 1, 2].map((k) => monthBlock(y, q * 3 + k, today(y, q * 3 + k), tty));
        out.push('');
        for (let r = 0; r < 8; r++) out.push(blocks.map((b) => b[r]).join('  ').trimEnd());
      }
      ctx.print(out.join('\n'));
      return 0;
    }
    ctx.print(
      monthBlock(now.getFullYear(), now.getMonth(), now.getDate(), tty)
        .map((l) => l.trimEnd())
        .join('\n')
        .trimEnd(),
    );
    return 0;
  },
}; /** `cal`: prints the current month, a given month, or a whole year. */

/* ───────────────────────── uptime / who / identity ───────────────────────── */

/**
 * Formats an uptime duration the way BSD `uptime` does.
 *
 * Durations under a minute are shown in seconds ("12 secs,"). Longer ones
 * combine "N days," with either "H:MM," (when there are whole hours) or
 * "N mins,". Every part ends with a comma to fit the uptime line layout.
 *
 * @param {number} ms - Elapsed time in milliseconds.
 * @returns {string} The formatted duration, ending with a comma.
 *
 * @example
 * formatUptime(90 * 60_000); // ' 1:30,'
 * formatUptime(2 * 86_400_000 + 5 * 60_000); // '2 days, 5 mins,'
 */
function formatUptime(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (ms < 60_000) {
    const secs = Math.max(1, Math.floor(ms / 1000));
    return `${secs} sec${secs === 1 ? '' : 's'},`;
  }
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'},`);
  if (h) parts.push(`${padStart(h, 2)}:${two(m)},`);
  else if (!days || m) parts.push(`${m} min${m === 1 ? '' : 's'},`);
  return parts.join(' ');
}

/**
 * Produces pseudo load averages that follow how busy the desktop is.
 *
 * The base load grows with the number of open windows; a seeded random
 * offset that changes every 5 seconds adds jitter, and the 5- and 15-minute
 * values are slightly lower than the 1-minute value.
 *
 * @returns {string} Three space-separated averages with two decimals each.
 *
 * @example
 * loadAverages(); // e.g. '1.64 1.52 1.47'
 */
function loadAverages(): string {
  const busy = useWM.getState().windows.length;
  const base = 1.1 + busy * 0.18;
  const tick = Math.floor(Date.now() / 5000);
  return [0, 1, 2].map((i) => (base + seeded(tick + i * 31) * 0.6 - i * 0.07).toFixed(2)).join(' ');
}

const uptime: CommandDef = {
  name: 'uptime',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'show how long the system has been running', ko: '시스템 가동 시간 표시' },
  usage: 'uptime',
  /**
   * Prints the time, uptime, user count and load averages.
   *
   * Uptime is measured from the system's boot timestamp. The user count is
   * the console login plus one per open terminal tty.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * uptime.run(ctx); // '14:03  up  1:30, 2 users, load averages: 1.64 1.52 1.47'
   */
  run(ctx) {
    const now = new Date();
    const booted = useSystem.getState().bootedAt;
    const users = listTTYs().length + 1;
    ctx.print(`${now.getHours()}:${two(now.getMinutes())}  up ${formatUptime(Date.now() - booted)} ${users} user${users === 1 ? '' : 's'}, load averages: ${loadAverages()}`);
    return 0;
  },
}; /** `uptime`: prints how long the system has been running, the user count and load averages. */

const who: CommandDef = {
  name: 'who',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'display who is logged in', ko: '로그인한 사용자 표시' },
  usage: 'who [am i]',
  /**
   * Lists the logged-in sessions.
   *
   * Prints a row for the console login (timestamped with the last login, or
   * boot time) and one row per open terminal tty. `who am i` limits the
   * output to the caller's own tty.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * who.run(ctx); // 'aodjo    console  Oct  3 09:12'
   */
  run(ctx) {
    /**
     * Formats a login timestamp as "Mon DD HH:MM".
     *
     * Uses local time and English month abbreviations, like BSD `who`.
     *
     * @param {number} ts - Unix timestamp in milliseconds.
     * @returns {string} The formatted login time.
     *
     * @example
     * fmtTime(tt.startedAt); // 'Oct  3 09:12'
     */
    const fmtTime = (ts: number) => {
      const d = new Date(ts);
      return `${MONTHS[d.getMonth()]} ${padStart(d.getDate(), 2)} ${two(d.getHours())}:${two(d.getMinutes())}`;
    };
    const sys = useSystem.getState();
    const rows = [[USER, 'console', fmtTime(sys.loggedInAt || sys.bootedAt)], ...listTTYs().map((tt) => [USER, tt.name, fmtTime(tt.startedAt)])];
    const mine = ctx.args.join(' ') === 'am i';
    ctx.print((mine ? rows.filter((r) => r[1] === ctx.term.tty) : rows).map((r) => `${padEnd(r[0], 8)} ${padEnd(r[1], 8)} ${r[2]}`).join('\n'));
    return 0;
  },
}; /** `who`: lists the console login and every open terminal session. */

const whoami: CommandDef = {
  name: 'whoami',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'display your user name', ko: '사용자 이름 표시' },
  usage: 'whoami',
  /**
   * Prints the effective user name.
   *
   * Prints "root" when running under sudo, otherwise the desktop user.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * whoami.run(ctx); // prints the user name
   */
  run(ctx) {
    ctx.print(ctx.sudo ? 'root' : USER);
    return 0;
  },
}; /** `whoami`: prints the effective user name. */

const id: CommandDef = {
  name: 'id',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'return user identity', ko: '사용자 ID 정보' },
  usage: 'id [-u | -g | -n] [user]',
  /**
   * Prints the user and group identity.
   *
   * `-u` / `-g` print the numeric uid / gid, or the user / group name with
   * `-n`. Without options prints the full macOS-style uid, gid and groups
   * line. Under sudo the root identity is reported. A user operand is
   * accepted but ignored.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * id.run({ ...ctx, args: ['-u'] }); // '501'
   */
  run(ctx) {
    const root = ctx.sudo;
    if (ctx.args.includes('-u')) ctx.print(ctx.args.includes('-n') ? (root ? 'root' : USER) : root ? '0' : '501');
    else if (ctx.args.includes('-g')) ctx.print(ctx.args.includes('-n') ? (root ? 'wheel' : 'staff') : root ? '0' : '20');
    else if (root) ctx.print('uid=0(root) gid=0(wheel) groups=0(wheel),1(daemon),2(kmem),3(sys),4(tty),5(operator),8(procview),9(procmod),12(everyone),20(staff),29(certusers),61(localaccounts),80(admin)');
    else ctx.print(`uid=501(${USER}) gid=20(staff) groups=20(staff),12(everyone),61(localaccounts),79(_appserverusr),81(_appserveradm),98(_lpadmin),204(_developer),250(_analyticsusers)`);
    return 0;
  },
}; /** `id`: prints the user and group identity. */

const hostname: CommandDef = {
  name: 'hostname',
  group: 'system',
  summary: { en: 'print the name of this computer', ko: '이 컴퓨터의 이름 출력' },
  usage: 'hostname [-s]',
  /**
   * Prints the computer's host name.
   *
   * Prints the fully qualified "<name>.local" form, or only the short name
   * with `-s`.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * hostname.run({ ...ctx, args: ['-s'] }); // prints the short host name
   */
  run(ctx) {
    ctx.print(ctx.args.includes('-s') ? HOSTNAME : `${HOSTNAME}.local`);
    return 0;
  },
}; /** `hostname`: prints the computer's host name. */

export const KERNEL_RELEASE = osInfo.version; /** Kernel release reported by `uname -r`, taken from the OS version in the portfolio data. */

const uname: CommandDef = {
  name: 'uname',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'display information about the system', ko: '시스템 정보 표시' },
  usage: 'uname [-amnprsv]',
  options: [
    ['-a', { en: 'All of the below', ko: '아래 항목 모두' }],
    ['-s', { en: 'Operating system name', ko: '운영체제 이름' }],
    ['-n', { en: 'Network node (host) name', ko: '네트워크 노드(호스트) 이름' }],
    ['-r', { en: 'Release', ko: '릴리스' }],
    ['-v', { en: 'Version', ko: '버전' }],
    ['-m', { en: 'Machine hardware name', ko: '하드웨어 이름' }],
  ],
  /**
   * Prints system identification fields.
   *
   * Flags select fields that are printed in a fixed order: -s OS name, -n
   * host name, -r release, -v full version string, -m machine ("web") and
   * -p processor ("js"); -o is treated as -s and -a prints all of them.
   * Without flags only the OS name is printed. The version string's build
   * date is January 15 of the OS year from the portfolio data.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 on success, 1 on an unknown flag.
   *
   * @example
   * uname.run({ ...ctx, args: ['-sr'] }); // 'webOS 1.0'
   */
  run(ctx) {
    const { opts, error } = getopt(ctx.args, { flags: 'amnoprsv' });
    if (error) return usageError(ctx, error, 'uname [-amnoprsv]');
    const built = new Date(Date.UTC(osInfo.year, 0, 15, 9));
    const version = `${osInfo.name} Kernel Version ${KERNEL_RELEASE}: ${DAYS[built.getUTCDay()]} ${MONTHS[built.getUTCMonth()]} ${padStart(built.getUTCDate(), 2)} 09:00:00 UTC ${osInfo.year}; root:react-19/RELEASE_WEB`;
    const fields: [string, string][] = [
      ['s', osInfo.name],
      ['n', HOSTNAME],
      ['r', KERNEL_RELEASE],
      ['v', version],
      ['m', 'web'],
      ['p', 'js'],
    ];
    const pick = opts.a ? fields.map(([k]) => k) : Object.keys(opts).length ? Object.keys(opts).map((k) => (k === 'o' ? 's' : k)) : ['s'];
    ctx.print(
      fields
        .filter(([k]) => pick.includes(k))
        .map(([, v]) => v)
        .join(' '),
    );
    return 0;
  },
}; /** `uname`: prints the OS name, host name, release, version and machine fields. */

const swVers: CommandDef = {
  name: 'sw_vers',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'print operating system version information', ko: '운영체제 버전 정보 출력' },
  usage: 'sw_vers [-productName | -productVersion | -buildVersion]',
  /**
   * Prints the operating system's product name, version and build.
   *
   * With one of -productName, -productVersion or -buildVersion, prints only
   * that value; any other argument is a usage error. Without arguments
   * prints all three as tab-aligned "Key: value" lines.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 on success, 1 on an unknown option.
   *
   * @example
   * swVers.run({ ...ctx, args: ['-productVersion'] }); // prints the OS version
   */
  run(ctx) {
    const map: Record<string, string> = { '-productName': osInfo.name, '-productVersion': osInfo.version, '-buildVersion': osInfo.build };
    if (ctx.args[0]) {
      if (!map[ctx.args[0]]) return usageError(ctx, `illegal option: ${ctx.args[0]}`, 'sw_vers [-productName | -productVersion | -productVersionExtra | -buildVersion]');
      ctx.print(map[ctx.args[0]]);
      return 0;
    }
    ctx.print(`ProductName:\t\t${osInfo.name}\nProductVersion:\t\t${osInfo.version}\nBuildVersion:\t\t${osInfo.build}`);
    return 0;
  },
}; /** `sw_vers`: prints the OS product name, version and build. */

/* ───────────────────────── Processes ───────────────────────── */

/** One row of the simulated process table shown by ps and top and targeted by kill. */
interface ProcRow {
  pid: number;
  user: string;
  command: string;
  /** Short process name, shown in the COMMAND column of `top`. */
  name: string;
  tty: string;
  startedAt: number;
  cpu: number;
  mem: number;
  threads: number;
  /** App process behind this row; signalling the row quits the app. */
  app?: Process;
  /** Terminal tty whose login shell this row is. */
  shellOf?: string;
  /** Background job (`cmd &`); any signal that is not harmless aborts it. */
  job?: Job;
  /** BSD process state code, e.g. "S", "Ss" or "R+". */
  state: string;
}

const DAEMONS: { pid: number; name: string; user: string; command: string; threads: number }[] = [
  { pid: 0, name: 'kernel_task', user: 'root', command: 'kernel_task', threads: 214 },
  { pid: 1, name: 'launchd', user: 'root', command: '/sbin/launchd', threads: 4 },
  { pid: 98, name: 'logd', user: 'root', command: '/usr/libexec/logd', threads: 6 },
  { pid: 102, name: 'mds', user: 'root', command: '/System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Support/mds', threads: 9 },
  { pid: 152, name: 'WindowServer', user: '_windowserver', command: '/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer -daemon', threads: 22 },
  { pid: 168, name: 'loginwindow', user: USER, command: '/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow console', threads: 4 },
  { pid: 274, name: 'distnoted', user: USER, command: '/usr/sbin/distnoted agent', threads: 2 },
  { pid: 280, name: 'cfprefsd', user: USER, command: '/usr/sbin/cfprefsd agent', threads: 3 },
  { pid: 289, name: 'Dock', user: USER, command: '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock', threads: 5 },
  { pid: 291, name: 'SystemUIServer', user: USER, command: '/System/Library/CoreServices/SystemUIServer.app/Contents/MacOS/SystemUIServer', threads: 4 },
  { pid: 297, name: 'Spotlight', user: USER, command: '/System/Library/CoreServices/Spotlight.app/Contents/MacOS/Spotlight', threads: 6 },
]; /** Static system daemons included in every process table; signalling them is not permitted. */

/**
 * Computes simulated CPU and memory percentages for a process.
 *
 * Both figures come from seeded randomness: memory is stable per pid, while
 * CPU changes every 2 seconds. Both scale with `weight`, so busier
 * processes (such as apps with more windows) report higher figures. Values
 * are rounded to one decimal.
 *
 * @param {number} pid - Process id used as the random seed.
 * @param {number} weight - Activity multiplier.
 * @returns {{ cpu: number; mem: number }} CPU and memory usage in percent.
 *
 * @example
 * const { cpu, mem } = usage(412, 1.6);
 */
function usage(pid: number, weight: number): { cpu: number; mem: number } {
  const tick = Math.floor(Date.now() / 2000);
  const r = seeded(pid * 7.13 + tick);
  return { cpu: Math.round(r * weight * 10 * 10) / 10, mem: Math.round((0.1 + seeded(pid) * weight * 1.4) * 10) / 10 };
}

/**
 * Builds the simulated process table.
 *
 * Combines the fixed system daemons, one row per running app process (with
 * a macOS-style executable path and load that grows with its window count),
 * one login shell (`-zsh`) per open terminal, the foreground command running
 * in each terminal (pid = shell pid + 1) and every terminal's background
 * jobs. Rows keep a reference to their app process, terminal or job so
 * `kill` can act on them. The command running in the caller's own terminal
 * is marked `R+`.
 *
 * @param {CommandContext} ctx - The running command's context.
 * @returns {ProcRow[]} All process rows sorted by pid.
 *
 * @example
 * const row = processTable(ctx).find((r) => r.pid === 412);
 */
export function processTable(ctx: CommandContext): ProcRow[] {
  const sys = useSystem.getState();
  const { processes, windows } = useWM.getState();
  const rows: ProcRow[] = DAEMONS.map((d) => ({ ...d, tty: '??', startedAt: sys.bootedAt, ...usage(d.pid, d.pid === 152 ? 2.5 : 0.3), state: d.pid === 152 ? 'Ss' : 'S' }));
  for (const p of processes) {
    const app = getApp(p.appId);
    const name = app ? tr(app.name, 'en') : p.appId;
    const wins = windows.filter((w) => w.appId === p.appId).length;
    rows.push({ pid: p.pid, user: USER, name, command: `/Applications/${name}.app/Contents/MacOS/${name.replace(/\s+/g, '')}`, tty: '??', startedAt: p.startedAt, threads: 6 + wins * 3, ...usage(p.pid, 0.4 + wins * 0.6), app: p, state: 'S' });
  }
  for (const tt of listTTYs()) {
    rows.push({ pid: tt.pid, user: USER, name: 'zsh', command: '-zsh', tty: tt.name, startedAt: tt.startedAt, threads: 1, ...usage(tt.pid, 0.05), shellOf: tt.name, state: tt.running ? 'S' : 'Ss+' });
    if (tt.running) rows.push({ pid: tt.pid + 1, user: USER, name: tt.running, command: tt.running, tty: tt.name, startedAt: Date.now(), threads: 1, ...usage(tt.pid + 1, 0.3), state: tt.name === ctx.term.tty ? 'R+' : 'S+' });
    for (const job of tt.jobs) {
      const name = job.command.split(/\s+/)[0];
      rows.push({ pid: job.pid, user: USER, name, command: job.command, tty: tt.name, startedAt: job.startedAt, threads: 1, ...usage(job.pid, 0.2), job, state: 'S' });
    }
  }
  return rows.sort((a, b) => a.pid - b.pid);
}

/**
 * Estimates accumulated CPU time in `M:SS.ss` form.
 *
 * Multiplies the wall-clock time since `startedAt` by the CPU percentage
 * (with a floor of 0.2%), so long-running and busy processes show more
 * time.
 *
 * @param {number} startedAt - Process start time as a Unix timestamp in milliseconds.
 * @param {number} cpu - Current CPU usage in percent.
 * @returns {string} The CPU time as minutes, seconds and hundredths.
 *
 * @example
 * cpuTime(Date.now() - 600_000, 5); // '0:30.00'
 */
function cpuTime(startedAt: number, cpu: number): string {
  const secs = ((Date.now() - startedAt) / 1000) * Math.max(0.002, cpu / 100);
  return `${Math.floor(secs / 60)}:${(secs % 60).toFixed(2).padStart(5, '0')}`;
}

/**
 * Formats a process start time for the `ps aux` STARTED column.
 *
 * Processes started today show the clock time ("9:41AM"); older ones show
 * the weekday and hour ("Mon9AM"), as BSD ps does.
 *
 * @param {number} ts - Start time as a Unix timestamp in milliseconds.
 * @returns {string} The compact start label.
 *
 * @example
 * startedLabel(Date.now()); // e.g. '2:03PM'
 */
function startedLabel(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  const h = d.getHours();
  if (sameDay) return `${h % 12 || 12}:${two(d.getMinutes())}${h < 12 ? 'AM' : 'PM'}`;
  return `${DAYS[d.getDay()]}${h % 12 || 12}${h < 12 ? 'AM' : 'PM'}`;
}

const ps: CommandDef = {
  name: 'ps',
  group: 'system',
  summary: { en: 'process status', ko: '프로세스 상태' },
  usage: 'ps [aux]',
  description: {
    en: 'Without options, lists this terminal’s processes. "ps aux" lists every process, including the apps you have open (their PIDs work with kill).',
    ko: '옵션 없이 실행하면 이 터미널의 프로세스를 나열합니다. "ps aux"는 열려 있는 앱을 포함한 모든 프로세스를 나열합니다 (PID는 kill에 사용할 수 있습니다).',
  },
  /**
   * Prints process status.
   *
   * Flags are read BSD-style, with or without a dash. Without a, e, x or A,
   * lists only the processes on the caller's terminal (PID, TTY, TIME,
   * CMD). Otherwise prints the full `ps aux` table (USER through COMMAND)
   * with simulated VSZ and RSS figures; on a terminal each line is cut at
   * the window width, like BSD ps.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * ps.run({ ...ctx, args: ['aux'] }); // lists every process
   */
  run(ctx) {
    const flags = ctx.args.join('').replace(/-/g, '');
    const all = /[aexA]/.test(flags);
    const rows = processTable(ctx);
    if (!all) {
      const mine = rows.filter((r) => r.tty === ctx.term.tty);
      ctx.print(['  PID TTY           TIME CMD', ...mine.map((r) => `${padStart(r.pid, 5)} ${padEnd(r.tty, 8)} ${padStart(cpuTime(r.startedAt, r.cpu), 10)} ${r.command}`)].join('\n'));
      return 0;
    }
    const width = ctx.stdout.isTTY ? ctx.term.size().cols : Infinity;
    const cells = [
      ['USER', 'PID', '%CPU', '%MEM', 'VSZ', 'RSS', 'TT', 'STAT', 'STARTED', 'TIME', 'COMMAND'],
      ...rows.map((r) => [
        r.user,
        String(r.pid),
        r.cpu.toFixed(1),
        r.mem.toFixed(1),
        String(400_000_000 + Math.round(seeded(r.pid + 3) * 12_000_000)),
        String(Math.round(r.mem * 160_000 + 1200)),
        r.tty === '??' ? '??' : `s${r.tty.slice(-3)}`,
        r.state,
        startedLabel(r.startedAt),
        cpuTime(r.startedAt, r.cpu),
        r.command,
      ]),
    ];
    const lines = table(cells, 'lrrrrrllrrl', 1).map((l) => (width === Infinity ? l : truncateWidth(l, width)));
    ctx.print(lines.join('\n'));
    return 0;
  },
}; /** `ps`: lists the caller's terminal processes, or every process with `aux`. */

const SIGNALS = ['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'EMT', 'FPE', 'KILL', 'BUS', 'SEGV', 'SYS', 'PIPE', 'ALRM', 'TERM', 'URG', 'STOP', 'TSTP', 'CONT', 'CHLD', 'TTIN', 'TTOU', 'IO', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'INFO', 'USR1', 'USR2']; /** Signal names in BSD numbering order (index + 1 is the signal number), as listed by `kill -l`. */

const HARMLESS_SIGNALS = new Set(['INFO', 'WINCH', 'CONT', 'URG', 'CHLD', 'IO']); /** Signals whose default action is to ignore them, so delivering them does not stop a job or shell. */

/**
 * Delivers a signal to a process in the simulated process table.
 *
 * What happens depends on the kind of row:
 * - Background job: any signal that is not harmless aborts the job.
 * - App process: the app is quit whatever the signal. KILL forces the quit;
 *   Terminal is always forced because quitting it also closes the caller's
 *   window, so its "terminate running processes?" sheet is skipped.
 *   Persistent apps (such as Finder) are relaunched after 600 ms.
 * - Login shell: INT and harmless signals are ignored; the caller's own
 *   shell exits with status 128 + the signal number, and another terminal's
 *   shell is hung up.
 * - Foreground command of a terminal: that terminal is interrupted.
 * - System daemons cannot be signalled.
 *
 * @param {CommandContext} ctx - The running command's context.
 * @param {number} pid - Target process id.
 * @param {string} sig - Signal name without the SIG prefix, e.g. "TERM".
 * @returns {string | null} An error message ("no such process" or "operation not permitted"), or null on success.
 *
 * @example
 * const err = signalPid(ctx, 412, 'KILL'); // null after force-quitting the app with pid 412
 */
function signalPid(ctx: CommandContext, pid: number, sig: string): string | null {
  const row = processTable(ctx).find((r) => r.pid === pid);
  if (!row) return 'no such process';
  const force = sig === 'KILL';
  if (row.job) {
    if (!HARMLESS_SIGNALS.has(sig)) row.job.controller.abort();
    return null;
  }
  if (row.app) {
    const app = getApp(row.app.appId);
    void wm.kill(pid, { force: force || row.app.appId === 'terminal' });
    if (app?.persistent) setTimeout(() => wm.launch(row.app!.appId), 600);
    return null;
  }
  if (row.shellOf) {
    if (sig === 'INT' || HARMLESS_SIGNALS.has(sig)) return null;
    if (row.shellOf === ctx.term.tty) {
      ctx.shell.exit(128 + SIGNALS.indexOf(sig) + 1);
      return null;
    }
    listTTYs()
      .find((tt) => tt.name === row.shellOf)
      ?.hangup();
    return null;
  }
  if (row.tty !== '??') {
    listTTYs()
      .find((tt) => tt.name === row.tty)
      ?.interrupt();
    return null;
  }
  return 'operation not permitted';
}

const kill: CommandDef = {
  name: 'kill',
  builtin: true,
  group: 'system',
  summary: { en: 'terminate or signal a process', ko: '프로세스 종료 또는 신호 보내기' },
  usage: 'kill [-s signal | -signal] pid | %job ...',
  description: {
    en: 'Sends a signal (TERM by default) to processes. Find PIDs with "ps aux"; killing an app’s PID quits the app. -9 (KILL) skips "save changes?" prompts.',
    ko: '프로세스에 신호(기본값 TERM)를 보냅니다. PID는 "ps aux"로 찾을 수 있으며, 앱의 PID를 종료하면 앱이 종료됩니다. -9(KILL)는 "변경 사항 저장" 확인을 건너뜁니다.',
  },
  options: [
    ['-l', { en: 'List signal names', ko: '신호 이름 나열' }],
    ['-9', { en: 'KILL: force quit', ko: 'KILL: 강제 종료' }],
  ],
  /**
   * Sends a signal to processes or jobs.
   *
   * `-l` lists the signal names. The signal defaults to TERM and can be
   * given as `-s NAME`, `-n NAME`, `-NAME` or `-NUMBER`, with or without the
   * SIG prefix. Each operand is either a job spec of this shell (`%1`, `%%`,
   * `%name`), whose job is aborted unless the signal is harmless, or a pid
   * delivered through `signalPid`. A failing operand is reported and the
   * remaining operands are still processed.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 when every operand was signalled; 1 on an unknown signal, missing operands or any failed operand.
   *
   * @example
   * kill.run({ ...ctx, args: ['-9', '412'] }); // force-quits the app with pid 412
   */
  run(ctx) {
    const args = [...ctx.args];
    if (args[0] === '-l') {
      ctx.print(SIGNALS.join(' '));
      return 0;
    }
    let sig = 'TERM';
    if (args[0] === '-s' || args[0] === '-n') {
      args.shift();
      sig = (args.shift() ?? 'TERM').toUpperCase().replace(/^SIG/, '');
    } else if (args[0]?.startsWith('-')) {
      const s = args.shift()!.slice(1).toUpperCase().replace(/^SIG/, '');
      sig = /^\d+$/.test(s) ? SIGNALS[Number(s) - 1] ?? s : s;
    }
    if (!SIGNALS.includes(sig)) {
      ctx.error(`unknown signal: SIG${sig}`);
      ctx.stderr.write('kill: type kill -l for a list of signals\n');
      return 1;
    }
    if (!args.length) return usageError(ctx, 'not enough arguments');
    let status = 0;
    for (const a of args) {
      if (a.startsWith('%')) {
        const job = findJob(ctx.shell.jobs, a);
        if (job) {
          if (!HARMLESS_SIGNALS.has(sig)) job.controller.abort();
        } else {
          ctx.error(`no such job: ${a}`);
          status = 1;
        }
        continue;
      }
      if (!/^\d+$/.test(a)) {
        ctx.error(`illegal pid: ${a}`);
        status = 1;
        continue;
      }
      const err = signalPid(ctx, Number(a), sig);
      if (err) {
        ctx.error(`kill ${a} failed: ${err}`);
        status = 1;
      }
    }
    return status;
  },
}; /** `kill`: sends a signal to processes by pid or to background jobs by job spec. */

/**
 * Resolves a process name to an app id.
 *
 * Compares the name case-insensitively, ignoring an optional ".app" suffix,
 * against every registered app's id and its English and Korean display
 * names, hidden apps included.
 *
 * @param {string} name - Process or app name as typed.
 * @returns {string | null} The matching app id, or null when no app matches.
 *
 * @example
 * matchApp('TextEdit.app'); // 'textedit'
 */
function matchApp(name: string): string | null {
  const q = name.toLowerCase().replace(/\.app$/, '');
  for (const a of listApps({ includeHidden: true })) {
    if ([a.id, tr(a.name, 'en'), tr(a.name, 'ko')].some((n) => n.toLowerCase() === q)) return a.id;
  }
  return null;
}

const killall: CommandDef = {
  name: 'killall',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'kill processes by name', ko: '이름으로 프로세스 종료' },
  usage: 'killall [-9] name ...',
  /**
   * Lists running app names for tab completion.
   *
   * Returns the English name of every running app process, with spaces
   * escaped so multi-word names complete as a single argument.
   *
   * @returns {string[]} The escaped names of the running apps.
   *
   * @example
   * killall.complete?.(0, []); // e.g. ['Finder', 'Activity\\ Monitor']
   */
  complete: () => useWM.getState().processes.map((p) => tr(getApp(p.appId)?.name ?? p.appId, 'en').replace(/ /g, '\\ ')),
  /**
   * Quits apps by name.
   *
   * Each non-flag argument is resolved with `matchApp`, and the matching
   * running app is quit: forced with -9 / -KILL, and always for Terminal so
   * no confirmation sheet appears. Persistent apps are relaunched after
   * 600 ms. The system processes Dock, SystemUIServer, WindowServer and
   * Spotlight are accepted silently, as if they relaunched instantly. A name
   * with no running app prints "No matching processes…".
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 when every name matched a running app; 1 otherwise or when no name is given.
   *
   * @example
   * killall.run({ ...ctx, args: ['Safari'] }); // quits Safari
   */
  run(ctx) {
    const args = ctx.args.filter((a) => !a.startsWith('-'));
    const force = ctx.args.includes('-9') || ctx.args.includes('-KILL');
    if (!args.length) return usageError(ctx, 'missing process name', 'killall [-delmsvqz] [-help] [-I] [-u user] [-t tty] [-c cmd] [-SIGNAL] [cmd]...');
    let status = 0;
    for (const name of args) {
      if (['dock', 'systemuiserver', 'windowserver', 'spotlight'].includes(name.toLowerCase())) continue;
      const appId = matchApp(name);
      if (!appId || !useWM.getState().processes.some((p) => p.appId === appId)) {
        ctx.stderr.write('No matching processes belonging to you were found\n');
        status = 1;
        continue;
      }
      void wm.quit(appId, { force: force || appId === 'terminal' });
      if (getApp(appId)?.persistent) setTimeout(() => wm.launch(appId), 600);
    }
    return status;
  },
}; /** `killall`: quits running apps by name. */

/**
 * Renders one frame of `top` output.
 *
 * Builds the header (process and thread counts, the clock, load averages,
 * CPU usage split into user / sys / idle, memory using the browser's JS heap
 * size when it is exposed, and the core count), followed by the process
 * table sorted by CPU usage. On a TTY the table's header row is shown in
 * inverse video. The frame is cut to `rows` lines, and plain lines wider
 * than `cols` are truncated.
 *
 * @param {CommandContext} ctx - The running command's context.
 * @param {number} cols - Terminal width in columns.
 * @param {number} rows - Maximum number of lines to return.
 * @param {boolean} tty - Whether to apply terminal styling.
 * @returns {string[]} The frame's lines.
 *
 * @example
 * ctx.term.altScreen(topFrame(ctx, size.cols, size.rows, true));
 */
function topFrame(ctx: CommandContext, cols: number, rows: number, tty: boolean): string[] {
  const procs = processTable(ctx);
  const now = new Date();
  const totalCpu = Math.min(99, procs.reduce((s, p) => s + p.cpu, 0));
  const user = (totalCpu * 0.62).toFixed(2);
  const sysCpu = (totalCpu * 0.38).toFixed(2);
  const threads = procs.reduce((s, p) => s + p.threads, 0);
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const usedM = heap ? Math.round(heap.usedJSHeapSize / 1048576) : 3120;
  const header = [
    `Processes: ${procs.length} total, ${procs.filter((p) => p.state.startsWith('R')).length || 1} running, ${procs.length - 1} sleeping, ${threads} threads ${' '.repeat(Math.max(1, cols - 76))}${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`,
    `Load Avg: ${loadAverages().split(' ').join(', ')}  CPU usage: ${user}% user, ${sysCpu}% sys, ${(100 - totalCpu).toFixed(2)}% idle`,
    `PhysMem: ${osInfo.memory.replace(/\s*GB/, 'G')} total, ${usedM}M used by ${osInfo.name} (JS heap), ${Math.max(0, Math.round(navigator.hardwareConcurrency || 8))} cores.`,
    '',
  ];
  const table0 = [
    ['PID', 'COMMAND', '%CPU', 'TIME', '#TH', 'MEM', 'STATE'],
    ...[...procs]
      .sort((a, b) => b.cpu - a.cpu || a.pid - b.pid)
      .map((p) => [String(p.pid), p.name.slice(0, 16), p.cpu.toFixed(1), cpuTime(p.startedAt, p.cpu).replace(/\.\d+$/, ''), String(p.threads), `${Math.max(1, Math.round(p.mem * 160))}M`, p.state.startsWith('R') ? 'running' : 'sleeping']),
  ];
  const lines = table(table0, 'llrrrrl');
  if (tty) lines[0] = c.inverse(padEnd(lines[0], cols));
  return [...header, ...lines].slice(0, rows).map((l) => (displayWidth(l) > cols && !l.includes('\x1b') ? truncateWidth(l, cols) : l));
}

const top: CommandDef = {
  name: 'top',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'display live process information (q to quit)', ko: '실시간 프로세스 정보 표시 (q로 종료)' },
  usage: 'top [-l samples]',
  options: [['-l n', { en: 'Logging mode: print n samples and exit (-l 1 for a snapshot)', ko: '로그 모드: n개의 샘플을 출력하고 종료 (-l 1은 스냅숏)' }]],
  /**
   * Displays live process information.
   *
   * When stdout is not a TTY or `-l N` is given, prints N frames (default 1)
   * one second apart and exits. Otherwise shows a full-screen view on the
   * alternate screen that refreshes every second until `q` is pressed or
   * the command is interrupted with ^C; a background key reader and the
   * refresh loop share one abort controller, and the normal screen is
   * restored on exit.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on a normal exit, 1 on a usage error, 130 when interrupted.
   *
   * @example
   * await top.run({ ...ctx, args: ['-l', '1'] }); // prints a single snapshot
   */
  async run(ctx) {
    const { opts, error } = getopt(ctx.args, { flags: '', values: 'lsno' });
    if (error) return usageError(ctx, error, 'top [-a | -d | -e | -c <mode>] [-F | -f] [-h] [-i <interval>] [-l <samples>] [-ncols <columns>] [-o <key>] [-O <skey>] [-R | -r] [-S] [-s <delay>] [-n <nprocs>] [-stats <key(s)>] [-pid <processid>] [-user <username>] [-U <username>] [-u]');
    const { cols } = ctx.term.size();
    if (!ctx.stdout.isTTY || opts.l !== undefined) {
      const samples = Math.max(1, Number(opts.l ?? 1) || 1);
      for (let i = 0; i < samples; i++) {
        if (i && !(await sleep(1000, ctx.signal))) return 130;
        ctx.print(topFrame(ctx, cols, 999, false).join('\n'));
      }
      return 0;
    }
    const stop = new AbortController();
    /**
     * Stops the interactive view when the command is interrupted.
     *
     * Forwards an abort of the command's signal (^C) to the local
     * controller, which ends both the key reader and the refresh loop.
     *
     * @returns {void}
     *
     * @example
     * ctx.signal.addEventListener('abort', onAbort, { once: true });
     */
    const onAbort = () => stop.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    void (async () => {
      while (!stop.signal.aborted) {
        const key = await ctx.term.readKey(stop.signal);
        if (key === null || key === 'q' || key === 'Q') stop.abort();
      }
    })();
    try {
      while (!stop.signal.aborted) {
        const size = ctx.term.size();
        ctx.term.altScreen(topFrame(ctx, size.cols, size.rows, true));
        await sleep(1000, stop.signal);
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      ctx.term.altScreen(null);
    }
    return ctx.signal.aborted ? 130 : 0;
  },
}; /** `top`: shows a live, full-screen process view, or prints samples with `-l`. */

export const SYSTEM_COMMANDS: CommandDef[] = [date, cal, uptime, who, whoami, id, hostname, uname, swVers, ps, kill, killall, top]; /** The system command definitions, merged into the shell's command registry. */

export { formatUptime, matchApp };

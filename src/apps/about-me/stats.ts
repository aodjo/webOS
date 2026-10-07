/**
 * Pure helpers that turn experience periods into the About Me app's statistics.
 */

/** A parsed experience period expressed in fractional years. */
export interface YearSpan {
  /** Fractional year the period starts (e.g. 2021.17 for March 2021). */
  start: number;
  /** Fractional year the period ends (e.g. 2026.75), never later than the reference date. */
  end: number;
  /** Whether the period is ongoing, i.e. its end is a word such as "Present". */
  current: boolean;
}

const PRESENT = /present|now|current|현재|재직/i; /** Matches words that mark an ongoing period in English or Korean. */

/**
 * Converts a date into a fractional year.
 *
 * Adds the elapsed share of the date's calendar year to the year number, using the real
 * length of that year so leap years are handled.
 *
 * @param {Date} date - Date to convert.
 * @returns {number} The year plus the elapsed fraction of it.
 *
 * @example
 * fractionalYear(new Date(2026, 6, 1)); // ≈ 2026.5
 */
export function fractionalYear(date: Date): number {
  const y = date.getFullYear();
  const start = new Date(y, 0, 1).getTime();
  const next = new Date(y + 1, 0, 1).getTime();
  return y + (date.getTime() - start) / (next - start);
}

/**
 * Parses an experience period string into a span of fractional years.
 *
 * Splits the text on a dash, en/em dash, "~" or "to", e.g. "2024 — Present", "2023 – 2024" or
 * "2021.03 - 2022.11". A year with a month ("2021.03" or "2021/3") starts at the beginning of
 * that month and ends at the end of it; a year alone starts on 1 January and ends on
 * 31 December. A "Present"-like end uses `now` and marks the span as current. A missing or
 * unreadable end makes the span one year long. The end is clamped so it never lies in the
 * future or before the start.
 *
 * @param {string} period - Period text from the portfolio data.
 * @param {Date} [now=new Date()] - Reference date for "Present" and the future clamp.
 * @returns {YearSpan | null} The parsed span, or null when no start year can be found.
 *
 * @example
 * parsePeriod('2023 — 2024'); // { start: 2023, end: 2025, current: false }
 */
export function parsePeriod(period: string, now: Date = new Date()): YearSpan | null {
  const parts = period.split(/\s*[—–-]{1,2}\s*|\s+~\s+|\s+to\s+/i).filter(Boolean);
  /**
   * Converts one side of a period into a fractional year.
   *
   * Returns the reference date for "Present"-like words; otherwise reads a four-digit year
   * with an optional month and maps it to the start or the end of that month or year.
   *
   * @param {string | undefined} s - Text of the start or end side.
   * @param {boolean} isEnd - Whether `s` is the end side.
   * @returns {number | null} The fractional year, or null when no year is found.
   *
   * @example
   * point('2022.11', true); // 2022 + 11 / 12
   */
  const point = (s: string | undefined, isEnd: boolean): number | null => {
    if (!s) return null;
    if (PRESENT.test(s)) return fractionalYear(now);
    const m = s.match(/(\d{4})(?:[./](\d{1,2}))?/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = m[2] ? Number(m[2]) : null;
    if (month) return year + (month - (isEnd ? 0 : 1)) / 12;
    return isEnd ? year + 1 : year;
  };
  const start = point(parts[0], false);
  if (start == null) return null;
  const current = parts.length > 1 ? PRESENT.test(parts[1]) : false;
  const end = parts.length > 1 ? (point(parts[1], true) ?? start + 1) : start + 1;
  return { start, end: Math.max(start, Math.min(end, fractionalYear(now))), current };
}

/**
 * Totals the years covered by a list of experience periods.
 *
 * Parses every period (skipping unreadable ones), sorts the spans by start and merges spans
 * that overlap or touch, so concurrent positions are counted only once.
 *
 * @param {string[]} periods - Period strings from the portfolio data.
 * @param {Date} [now=new Date()] - Reference date for ongoing periods.
 * @returns {number} Total fractional years; 0 for an empty list.
 *
 * @example
 * yearsOfExperience(['2015 — 2016', '2019 — 2019']); // 3
 */
export function yearsOfExperience(periods: string[], now: Date = new Date()): number {
  const spans = periods
    .map((p) => parsePeriod(p, now))
    .filter((s): s is YearSpan => !!s)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cur: { start: number; end: number } | null = null;
  for (const s of spans) {
    if (cur && s.start <= cur.end) cur.end = Math.max(cur.end, s.end);
    else {
      if (cur) total += cur.end - cur.start;
      cur = { start: s.start, end: s.end };
    }
  }
  if (cur) total += cur.end - cur.start;
  return total;
}

/**
 * Formats a number of years for the experience highlight.
 *
 * Values under one year become "<1". Otherwise the whole number of years is shown, followed by
 * "+" when the remainder exceeds 0.05 years; a tiny epsilon absorbs floating-point error so
 * exact whole numbers are not rounded down.
 *
 * @param {number} years - Fractional number of years.
 * @returns {string} "<1", "N" or "N+".
 *
 * @example
 * formatYears(3.4); // "3+"
 * formatYears(2);   // "2"
 */
export function formatYears(years: number): string {
  if (years < 1) return '<1';
  const whole = Math.floor(years + 1e-6);
  return years - whole > 0.05 ? `${whole}+` : String(whole);
}

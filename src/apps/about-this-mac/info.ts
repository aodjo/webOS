/**
 * Pure helpers that build the facts shown in About This Computer.
 */
import type { Locale } from '@/kernel/types';

const SERIAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'; /** Characters allowed in serial numbers; I and O are left out, as in real serials. */

/**
 * Derives a plausible-looking serial number from a seed string.
 *
 * Runs a 32-bit FNV-1a hash over `seed#0` … `seed#9`, carrying the hash state from one round to
 * the next, and maps each round's hash onto `SERIAL_ALPHABET`. The same seed always yields the
 * same serial.
 *
 * @param {string} seed - Text that identifies the machine, e.g. "handle|build|model".
 * @returns {string} A 10-character serial of uppercase letters (without I and O) and digits.
 *
 * @example
 * serialNumber('aodjo|26A1002'); // same 10-character value on every call
 */
export function serialNumber(seed: string): string {
  let h = 0x811c9dc5;
  let out = '';
  for (let i = 0; i < 10; i++) {
    for (const ch of `${seed}#${i}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += SERIAL_ALPHABET[h % SERIAL_ALPHABET.length];
  }
  return out;
}

/**
 * Formats an uptime duration in words, like the `uptime` command.
 *
 * Shows at most two units: days and hours once the duration reaches a day, otherwise hours and
 * minutes. Zero-valued units are dropped and English units are pluralized. Durations under a
 * minute (including negative ones) read "less than a minute".
 *
 * @param {number} ms - Duration in milliseconds.
 * @param {Locale} locale - Language of the output.
 * @returns {string} Text such as "2 hours, 5 minutes", or the Korean equivalent for 'ko'.
 *
 * @example
 * formatUptime((26 * 60 + 30) * 60_000, 'en'); // "1 day, 2 hours"
 */
export function formatUptime(ms: number, locale: Locale): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  if (totalMin < 1) return locale === 'ko' ? '1분 미만' : 'less than a minute';
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const units: [number, string, string][] = d ? [[d, 'day', '일'], [h, 'hour', '시간']] : [[h, 'hour', '시간'], [m, 'minute', '분']];
  const parts = units.filter(([n]) => n > 0).map(([n, en, ko]) => (locale === 'ko' ? `${n}${ko}` : `${n} ${en}${n === 1 ? '' : 's'}`));
  return parts.join(locale === 'ko' ? ' ' : ', ');
}

/**
 * Identifies the browser and its version from a user agent string.
 *
 * Tests a list of patterns in order, so browsers that also carry "Chrome" or "Safari" tokens
 * (Edge, Whale, Samsung Internet, Opera) are recognized before Chrome and Safari. Most browsers
 * report their major version; Safari reports the "Version/" value, which may include a minor
 * number. Unknown agents fall back to "WebKit" or "Browser".
 *
 * @param {string} ua - User agent string, usually `navigator.userAgent`.
 * @returns {string} Browser name followed by its version, e.g. "Chrome 141" or "Safari 18.1".
 *
 * @example
 * browserName(navigator.userAgent); // "Chrome 141"
 */
export function browserName(ua: string): string {
  const rules: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/Whale\/(\d+)/, 'Whale'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/(?:OPR|OPT)\/(\d+)/, 'Opera'],
    [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
    [/CriOS\/(\d+)/, 'Chrome'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+(?:\.\d+)?).*Safari\//, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return /AppleWebKit/.test(ua) ? 'WebKit' : 'Browser';
}

/**
 * Picks a believable laptop screen size for the visitor's display.
 *
 * Maps the screen width in CSS pixels to 16 inches from 1700px, 14 inches from 1440px and
 * 13 inches below that.
 *
 * @param {number} screenWidth - Screen width in CSS pixels.
 * @returns {number} Diagonal size in inches: 13, 14 or 16.
 *
 * @example
 * screenInches(1512); // 14
 */
export function screenInches(screenWidth: number): number {
  if (screenWidth >= 1700) return 16;
  if (screenWidth >= 1440) return 14;
  return 13;
}

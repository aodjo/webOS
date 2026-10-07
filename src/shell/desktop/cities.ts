/**
 * Localized city names for IANA time zones, shared by the desktop Clock widget and Notification
 * Center's World Clock so the same city reads the same everywhere ("서울", not "SEO", in Korean).
 */
import type { Locale, LString } from '@/kernel';

/** A named city and the IANA time zone it represents. */
export interface City {
  /** Localized display name. */
  name: LString;
  /** IANA time zone identifier, e.g. "Asia/Seoul". */
  tz: string;
}

export const CITIES: City[] = [
  { name: { en: 'Seoul', ko: '서울' }, tz: 'Asia/Seoul' },
  { name: { en: 'London', ko: '런던' }, tz: 'Europe/London' },
  { name: { en: 'New York', ko: '뉴욕' }, tz: 'America/New_York' },
  { name: { en: 'San Francisco', ko: '샌프란시스코' }, tz: 'America/Los_Angeles' },
]; /** The cities shown by Notification Center's World Clock widget, in display order. */

const MORE_CITIES: City[] = [
  { name: { en: 'Tokyo', ko: '도쿄' }, tz: 'Asia/Tokyo' },
  { name: { en: 'Shanghai', ko: '상하이' }, tz: 'Asia/Shanghai' },
  { name: { en: 'Hong Kong', ko: '홍콩' }, tz: 'Asia/Hong_Kong' },
  { name: { en: 'Taipei', ko: '타이베이' }, tz: 'Asia/Taipei' },
  { name: { en: 'Singapore', ko: '싱가포르' }, tz: 'Asia/Singapore' },
  { name: { en: 'Bangkok', ko: '방콕' }, tz: 'Asia/Bangkok' },
  { name: { en: 'Ho Chi Minh City', ko: '호찌민' }, tz: 'Asia/Ho_Chi_Minh' },
  { name: { en: 'Jakarta', ko: '자카르타' }, tz: 'Asia/Jakarta' },
  { name: { en: 'Manila', ko: '마닐라' }, tz: 'Asia/Manila' },
  { name: { en: 'Kolkata', ko: '콜카타' }, tz: 'Asia/Kolkata' },
  { name: { en: 'Kolkata', ko: '콜카타' }, tz: 'Asia/Calcutta' },
  { name: { en: 'Dubai', ko: '두바이' }, tz: 'Asia/Dubai' },
  { name: { en: 'Paris', ko: '파리' }, tz: 'Europe/Paris' },
  { name: { en: 'Berlin', ko: '베를린' }, tz: 'Europe/Berlin' },
  { name: { en: 'Madrid', ko: '마드리드' }, tz: 'Europe/Madrid' },
  { name: { en: 'Rome', ko: '로마' }, tz: 'Europe/Rome' },
  { name: { en: 'Amsterdam', ko: '암스테르담' }, tz: 'Europe/Amsterdam' },
  { name: { en: 'Moscow', ko: '모스크바' }, tz: 'Europe/Moscow' },
  { name: { en: 'Chicago', ko: '시카고' }, tz: 'America/Chicago' },
  { name: { en: 'Denver', ko: '덴버' }, tz: 'America/Denver' },
  { name: { en: 'Toronto', ko: '토론토' }, tz: 'America/Toronto' },
  { name: { en: 'Vancouver', ko: '밴쿠버' }, tz: 'America/Vancouver' },
  { name: { en: 'São Paulo', ko: '상파울루' }, tz: 'America/Sao_Paulo' },
  { name: { en: 'Sydney', ko: '시드니' }, tz: 'Australia/Sydney' },
  { name: { en: 'Melbourne', ko: '멜버른' }, tz: 'Australia/Melbourne' },
  { name: { en: 'Auckland', ko: '오클랜드' }, tz: 'Pacific/Auckland' },
  { name: { en: 'Honolulu', ko: '호놀룰루' }, tz: 'Pacific/Honolulu' },
]; /** Additional zones a visitor's browser commonly reports; used only for labels, not shown in the World Clock. */

const BY_ZONE = new Map<string, City>([...CITIES, ...MORE_CITIES].map((c) => [c.tz, c])); /** Lookup of every known city by its IANA time zone. */

/**
 * Looks up the localized city name for a time zone.
 *
 * Searches both the World Clock cities and the additional label-only cities.
 *
 * @param {string} tz - IANA time zone identifier, e.g. "Europe/Paris".
 * @param {Locale} locale - Locale of the returned name.
 * @returns {string | undefined} The localized city name, or undefined when the zone is not in the table.
 *
 * @example
 * cityName('Asia/Seoul', 'ko'); // '서울'
 */
export function cityName(tz: string, locale: Locale): string | undefined {
  const city = BY_ZONE.get(tz);
  if (!city) return undefined;
  return typeof city.name === 'string' ? city.name : city.name[locale];
}

/**
 * Derives a readable city name from an IANA time zone identifier.
 *
 * Takes the last path segment of the zone and replaces underscores with spaces.
 *
 * @param {string} tz - IANA time zone identifier.
 * @returns {string} The city part of the zone, or '' for an empty identifier.
 *
 * @example
 * zoneCity('America/Los_Angeles'); // 'Los Angeles'
 */
export function zoneCity(tz: string): string {
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? '';
}

/**
 * Reads the host's time zone from the Intl API.
 *
 * Returns an empty string when the runtime does not report a zone or `Intl` throws.
 *
 * @returns {string} The host's IANA time zone, or '' when it cannot be determined.
 *
 * @example
 * hostTimeZone(); // 'Asia/Seoul'
 */
export function hostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

/**
 * Builds the city label shown above the desktop clock's hands.
 *
 * In English it is a three-letter uppercase code taken from the zone's city ("SEO"); in Korean
 * it is the localized city name ("서울"), like the Clock widget on macOS. For a zone that is not
 * in the table, Korean falls back to the zone's Latin city name when it is at most 11
 * characters (so it fits between the numerals), otherwise to the three-letter code. An empty
 * zone yields an empty label.
 *
 * @param {Locale} locale - UI locale.
 * @param {string} [tz=hostTimeZone()] - IANA time zone identifier.
 * @returns {string} The label to draw on the clock face.
 *
 * @example
 * clockCityLabel('en', 'Asia/Seoul'); // 'SEO'
 * clockCityLabel('ko', 'Europe/Lisbon'); // 'Lisbon'
 */
export function clockCityLabel(locale: Locale, tz: string = hostTimeZone()): string {
  if (!tz) return '';
  const code = zoneCity(tz).slice(0, 3).toUpperCase();
  if (locale !== 'ko') return code;
  const known = cityName(tz, 'ko');
  if (known) return known;
  const city = zoneCity(tz);
  return city.length <= 11 ? city : code;
}

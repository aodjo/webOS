import { describe, expect, it } from 'vitest';
import { CITIES, cityName, clockCityLabel } from './cities';

describe('clock city labels', () => {
  it('uses a three-letter code in English and the city name in Korean', () => {
    expect(clockCityLabel('en', 'Asia/Seoul')).toBe('SEO');
    expect(clockCityLabel('ko', 'Asia/Seoul')).toBe('서울');
    expect(clockCityLabel('ko', 'Europe/Paris')).toBe('파리');
  });

  it('falls back to the zone’s city for unlisted zones', () => {
    expect(clockCityLabel('en', 'America/Argentina/Buenos_Aires')).toBe('BUE');
    expect(clockCityLabel('ko', 'Europe/Lisbon')).toBe('Lisbon');
    // Longer than 11 characters, so the label falls back to the three-letter code.
    expect(clockCityLabel('ko', 'America/Port_of_Spain')).toBe('POR');
    expect(clockCityLabel('ko', '')).toBe('');
  });

  it('shares the World Clock cities', () => {
    for (const c of CITIES) expect(cityName(c.tz, 'ko')).toBe(typeof c.name === 'string' ? c.name : c.name.ko);
  });
});

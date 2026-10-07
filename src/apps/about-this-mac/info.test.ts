import { describe, expect, it } from 'vitest';
import { browserName, formatUptime, screenInches, serialNumber } from './info';

describe('serialNumber', () => {
  it('is deterministic, 10 chars, and avoids I/O', () => {
    const a = serialNumber('aodjo|26A1002');
    expect(a).toBe(serialNumber('aodjo|26A1002'));
    expect(a).toMatch(/^[A-HJ-NP-Z0-9]{10}$/);
    expect(serialNumber('someone-else')).not.toBe(a);
  });
});

describe('formatUptime', () => {
  it('formats minutes, hours and days', () => {
    expect(formatUptime(20_000, 'en')).toBe('less than a minute');
    expect(formatUptime(60_000, 'en')).toBe('1 minute');
    expect(formatUptime((2 * 60 + 5) * 60_000, 'en')).toBe('2 hours, 5 minutes');
    expect(formatUptime((2 * 60 + 5) * 60_000, 'ko')).toBe('2시간 5분');
    expect(formatUptime((26 * 60 + 30) * 60_000, 'en')).toBe('1 day, 2 hours');
    expect(formatUptime(3 * 3_600_000, 'ko')).toBe('3시간');
  });
});

describe('browserName', () => {
  it('detects common browsers', () => {
    expect(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome 141');
    expect(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15')).toBe('Safari 18.1');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox 131');
    expect(browserName('Mozilla/5.0 Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('Edge 141');
  });
});

describe('screenInches', () => {
  it('maps screen widths to laptop sizes', () => {
    expect(screenInches(1280)).toBe(13);
    expect(screenInches(1512)).toBe(14);
    expect(screenInches(1728)).toBe(16);
  });
});

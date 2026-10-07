import { describe, expect, it } from 'vitest';
import { formatHM, formatMenuClock, monthGrid, relativeTime, zoneCaption, zonedTime } from './format';

describe('formatMenuClock', () => {
  const d = new Date(2026, 9, 2, 15, 41, 7);

  it('formats the English 12-hour clock', () => {
    expect(formatMenuClock(d, 'en', { clock24h: false, showSeconds: false })).toEqual({ date: 'Fri Oct 2', time: '3:41 PM' });
  });

  it('formats the Korean 12-hour clock', () => {
    expect(formatMenuClock(d, 'ko', { clock24h: false, showSeconds: false })).toEqual({ date: '10월 2일 (금)', time: '오후 3:41' });
  });

  it('supports 24-hour time and seconds', () => {
    expect(formatMenuClock(d, 'en', { clock24h: true, showSeconds: true }).time).toBe('15:41:07');
    const morning = new Date(2026, 9, 2, 9, 5, 0);
    expect(formatMenuClock(morning, 'ko', { clock24h: true, showSeconds: false }).time).toBe('09:05');
  });

  it('uses 12 for noon and midnight', () => {
    expect(formatMenuClock(new Date(2026, 0, 1, 0, 0), 'en', { clock24h: false, showSeconds: false }).time).toBe('12:00 AM');
    expect(formatMenuClock(new Date(2026, 0, 1, 12, 0), 'ko', { clock24h: false, showSeconds: false }).time).toBe('오후 12:00');
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('says now for the first minute', () => {
    expect(relativeTime(now - 20_000, now, 'en')).toBe('now');
    expect(relativeTime(now - 20_000, now, 'ko')).toBe('지금');
  });
  it('uses minutes and hours', () => {
    expect(relativeTime(now - 5 * 60_000, now, 'en')).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now, 'ko')).toBe('3시간 전');
  });
});

describe('zonedTime', () => {
  it('matches local time for the local zone', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const d = new Date(2026, 9, 2, 15, 41, 7);
    const z = zonedTime(d, tz);
    expect([z.h, z.m, z.s, z.dayOffset, z.offsetHours]).toEqual([15, 41, 7, 0, 0]);
  });

  it('captions offsets', () => {
    expect(zoneCaption({ h: 0, m: 0, s: 0, dayOffset: 0, offsetHours: 0 }, 'en')).toBe('Today, +0HRS');
    expect(zoneCaption({ h: 0, m: 0, s: 0, dayOffset: -1, offsetHours: -16 }, 'ko')).toBe('어제, −16시간');
    expect(zoneCaption({ h: 0, m: 0, s: 0, dayOffset: 0, offsetHours: 5.5 }, 'en')).toBe('Today, +5.5HRS');
  });
});

describe('monthGrid', () => {
  it('lays out October 2026 starting on Thursday', () => {
    const rows = monthGrid(2026, 9);
    expect(rows[0]).toEqual([null, null, null, null, 1, 2, 3]);
    expect(rows.flat().filter(Boolean)).toHaveLength(31);
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });
});

describe('formatHM', () => {
  it('formats seconds as h:mm', () => {
    expect(formatHM(4980)).toBe('1:23');
    expect(formatHM(Infinity)).toBe('');
    expect(formatHM(0)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { formatYears, parsePeriod, yearsOfExperience } from './stats';

const NOW = new Date(2026, 9, 1); /** Fixed reference date (1 Oct 2026) for "Present" periods and the future clamp. */

describe('parsePeriod', () => {
  it('parses year ranges and "Present"', () => {
    expect(parsePeriod('2023 — 2024', NOW)).toMatchObject({ start: 2023, end: 2025, current: false });
    const p = parsePeriod('2024 — Present', NOW)!;
    expect(p.start).toBe(2024);
    expect(p.current).toBe(true);
    expect(p.end).toBeCloseTo(2026.75, 1);
    expect(parsePeriod('2025 – 현재', NOW)?.current).toBe(true);
  });

  it('parses months and single years', () => {
    expect(parsePeriod('2021.03 - 2022.11', NOW)).toMatchObject({ start: 2021 + 2 / 12, end: 2021 + 1 + 11 / 12 });
    expect(parsePeriod('2020', NOW)).toMatchObject({ start: 2020, end: 2021 });
  });

  it('never extends into the future and rejects garbage', () => {
    expect(parsePeriod('2026 — 2030', NOW)!.end).toBeLessThan(2027);
    expect(parsePeriod('someday', NOW)).toBeNull();
  });
});

describe('yearsOfExperience', () => {
  it('merges overlapping periods', () => {
    const y = yearsOfExperience(['2024 — Present', '2023 — 2024'], NOW);
    expect(y).toBeCloseTo(3.75, 1);
    expect(formatYears(y)).toBe('3+');
  });

  it('adds disjoint periods', () => {
    expect(yearsOfExperience(['2015 — 2016', '2019 — 2019'], NOW)).toBe(3);
  });

  it('formats small and whole values', () => {
    expect(formatYears(0.4)).toBe('<1');
    expect(formatYears(2)).toBe('2');
    expect(yearsOfExperience([], NOW)).toBe(0);
  });
});

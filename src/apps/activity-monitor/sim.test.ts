import { describe, expect, it } from 'vitest';
import { SYSTEM_PROCESSES, advance, buildRows, cpuOf, emptyAccum, formatCPUTime, formatMem, profileFor, smoothNoise, type ProcInput, type Signals } from './sim';

const signals: Signals = { busy: 0, fps: 60, fsBytesByApp: { terminal: 5000 }, netBytes: 120_000, frameBytes: 0 }; /** Fixed measured signals: an idle main thread at 60 fps, 5000 bytes written by Terminal and 120 kB received. */

/**
 * Builds a Terminal app process input for the simulation tests.
 *
 * Defaults to PID 420 owned by 'me', started at 0, with one window, neither focused nor hidden,
 * using Terminal's CPU / memory profile. Any field can be overridden.
 *
 * @param {Partial<ProcInput>} [over={}] - Fields that replace the defaults.
 * @returns {ProcInput} The process input.
 *
 * @example
 * const focused = cpuOf(app({ focused: true }), 1234, signals, 1);
 */
const app = (over: Partial<ProcInput> = {}): ProcInput => ({
  pid: 420,
  name: 'Terminal',
  appId: 'terminal',
  user: 'me',
  startedAt: 0,
  windows: 1,
  focused: false,
  hidden: false,
  profile: profileFor('terminal'),
  kill: 'app',
  ...over,
});

describe('activity monitor model', () => {
  it('formats CPU time and memory like Activity Monitor', () => {
    expect(formatCPUTime(83.456)).toBe('1:23.45');
    expect(formatCPUTime(7263.5)).toBe('2:01:03.50');
    expect(formatMem(512)).toBe('512 bytes');
    expect(formatMem(1536)).toBe('1.5 KB');
    expect(formatMem(245 * 1024 * 1024)).toBe('245 MB');
    expect(formatMem(3.25 * 1024 ** 3)).toBe('3.3 GB');
  });

  it('produces bounded, smooth noise', () => {
    for (let t = 0; t < 200; t += 0.7) {
      const v = smoothNoise(3, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(smoothNoise(3, t + 0.01) - v)).toBeLessThan(0.05);
    }
  });

  it('gives focused apps more CPU than background or hidden ones', () => {
    const t = 1234;
    const focused = cpuOf(app({ focused: true }), t, signals, 1);
    const background = cpuOf(app(), t, signals, 1);
    const hidden = cpuOf(app({ hidden: true }), t, signals, 1);
    expect(focused).toBeGreaterThan(background);
    expect(background).toBeGreaterThan(hidden);
  });

  it('accumulates CPU time and attributes real disk / network usage', () => {
    const ws = SYSTEM_PROCESSES.find((p) => p.name === 'nsurlsessiond')!;
    const procs: ProcInput[] = [app({ startedAt: 1_000_000 }), { ...ws, user: 'me', startedAt: 1_000_000, windows: 0, focused: false, hidden: false }];
    let acc = emptyAccum();
    acc = advance(acc, procs, 1_000_010, 2, signals, 1);
    const first = acc.cpuTime[420];
    acc = advance(acc, procs, 1_000_012, 2, signals, 1);
    expect(acc.cpuTime[420]).toBeGreaterThan(first);
    const rows = buildRows(procs, acc, 1_000_012, 6, signals, 1);
    expect(rows[0].bytesWritten).toBeGreaterThanOrEqual(5000);
    expect(rows[1].rcvdBytes).toBeGreaterThanOrEqual(120_000);
    expect(rows.every((r) => r.threads >= 1 && r.memory > 0)).toBe(true);
  });

  it('keeps system PIDs unique and below the app PID range', () => {
    const pids = SYSTEM_PROCESSES.map((p) => p.pid);
    expect(new Set(pids).size).toBe(pids.length);
    expect(Math.max(...pids)).toBeLessThan(300);
  });
});

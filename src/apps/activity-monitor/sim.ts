/**
 * Activity Monitor's process model. Real processes come from the window manager; per-process
 * resource usage is simulated with smooth, deterministic noise and shaped by real signals
 * (focus, window count, measured main-thread load, FS writes, network transfer).
 */

/**
 * What quitting a process does: 'app' quits the app through the window manager, 'protected'
 * is refused with a permission alert, 'relaunch' restarts it under a new PID, and 'logout'
 * ends the user session.
 */
export type KillMode = 'app' | 'protected' | 'relaunch' | 'logout';

/** Baseline resource usage a simulated process fluctuates around. */
export interface Profile {
  /** Typical % CPU when in the foreground. */
  cpu: number;
  /** Resident memory in MB. */
  mem: number;
  /** Typical thread count. */
  threads: number;
}

/** One process to sample: identity, ownership and live window state. */
export interface ProcInput {
  pid: number;
  name: string;
  appId?: string;
  bundleId?: string;
  user: string;
  /** Launch time in epoch milliseconds. */
  startedAt: number;
  windows: number;
  focused: boolean;
  hidden: boolean;
  profile: Profile;
  kill: KillMode;
}

/** A sampled process with every column Activity Monitor can display. */
export interface ProcRow extends ProcInput {
  cpu: number;
  /** Accumulated CPU time in seconds. */
  cpuTime: number;
  threads: number;
  idleWakeUps: number;
  /** Memory footprint in bytes. */
  memory: number;
  /** Compressed memory in bytes. */
  compressed: number;
  ports: number;
  /** Current energy impact. */
  energy: number;
  /** Average energy impact over all samples taken so far. */
  power12h: number;
  appNap: boolean;
  preventingSleep: boolean;
  bytesWritten: number;
  bytesRead: number;
  sentBytes: number;
  rcvdBytes: number;
  sentPackets: number;
  rcvdPackets: number;
}

/** Accumulated per-pid counters, advanced on every sample. */
export interface Accum {
  cpuTime: Record<number, number>;
  energy: Record<number, number>;
  samples: Record<number, number>;
  read: Record<number, number>;
  sent: Record<number, number>;
  rcvd: Record<number, number>;
}

/** Real-world signals measured in the browser. */
export interface Signals {
  /** Share of the last interval the main thread was blocked by long tasks (0–1). */
  busy: number;
  /** Measured frames per second of the page. */
  fps: number;
  /** Bytes written to the virtual FS, by app id (cumulative). */
  fsBytesByApp: Record<string, number>;
  /** Bytes received over the network by the page (cumulative). */
  netBytes: number;
  /** Bytes received by Safari's frames (cumulative). */
  frameBytes: number;
}

/**
 * Creates an empty set of per-pid counters.
 *
 * Every counter map starts empty, so the first `advance` call seeds each process
 * from its age and profile.
 *
 * @returns {Accum} A fresh accumulator with no recorded processes.
 *
 * @example
 * let acc = emptyAccum();
 * acc = advance(acc, procs, Date.now() / 1000, 1, signals, 2);
 */
export const emptyAccum = (): Accum => ({ cpuTime: {}, energy: {}, samples: {}, read: {}, sent: {}, rcvd: {} });

const APP_PROFILES: Record<string, Profile> = {
  finder: { cpu: 0.9, mem: 92, threads: 9 },
  safari: { cpu: 2.6, mem: 240, threads: 22 },
  mail: { cpu: 1.1, mem: 124, threads: 14 },
  notes: { cpu: 0.6, mem: 72, threads: 8 },
  'about-me': { cpu: 0.5, mem: 64, threads: 6 },
  projects: { cpu: 0.8, mem: 98, threads: 9 },
  terminal: { cpu: 0.6, mem: 46, threads: 6 },
  textedit: { cpu: 0.4, mem: 56, threads: 6 },
  preview: { cpu: 0.7, mem: 88, threads: 8 },
  calculator: { cpu: 0.2, mem: 28, threads: 4 },
  settings: { cpu: 0.6, mem: 66, threads: 8 },
  'activity-monitor': { cpu: 1.9, mem: 54, threads: 7 },
  minesweeper: { cpu: 0.3, mem: 34, threads: 4 },
  welcome: { cpu: 0.3, mem: 40, threads: 5 },
  'about-this-mac': { cpu: 0.2, mem: 31, threads: 4 },
}; /** Baseline resource profile of each built-in app, keyed by app id. */

/**
 * Looks up the resource profile of an app.
 *
 * Returns the built-in profile for known app ids and a modest generic profile
 * (0.5% CPU, 60 MB, 6 threads) for any other app.
 *
 * @param {string} appId - Id of the app whose profile is wanted.
 * @returns {Profile} The app's baseline CPU, memory and thread usage.
 *
 * @example
 * profileFor('safari'); // { cpu: 2.6, mem: 240, threads: 22 }
 * profileFor('unknown'); // { cpu: 0.5, mem: 60, threads: 6 }
 */
export const profileFor = (appId: string): Profile => APP_PROFILES[appId] ?? { cpu: 0.5, mem: 60, threads: 6 };

/** A background system process listed alongside the running apps. */
export interface SystemProcess {
  name: string;
  pid: number;
  /** null = the logged-in user. */
  user: string | null;
  profile: Profile;
  kill: KillMode;
}

export const SYSTEM_PROCESSES: SystemProcess[] = [
  { name: 'kernel_task', pid: 0, user: 'root', profile: { cpu: 3.4, mem: 820, threads: 212 }, kill: 'protected' },
  { name: 'launchd', pid: 1, user: 'root', profile: { cpu: 0.3, mem: 24, threads: 5 }, kill: 'protected' },
  { name: 'syslogd', pid: 92, user: 'root', profile: { cpu: 0.1, mem: 9, threads: 4 }, kill: 'protected' },
  { name: 'fseventsd', pid: 96, user: 'root', profile: { cpu: 0.2, mem: 12, threads: 7 }, kill: 'protected' },
  { name: 'configd', pid: 101, user: 'root', profile: { cpu: 0.1, mem: 11, threads: 6 }, kill: 'protected' },
  { name: 'powerd', pid: 104, user: 'root', profile: { cpu: 0.05, mem: 6, threads: 3 }, kill: 'protected' },
  { name: 'mds', pid: 118, user: 'root', profile: { cpu: 0.4, mem: 38, threads: 9 }, kill: 'protected' },
  { name: 'cfprefsd', pid: 126, user: 'root', profile: { cpu: 0.1, mem: 7, threads: 3 }, kill: 'protected' },
  { name: 'hidd', pid: 133, user: '_hidd', profile: { cpu: 0.4, mem: 10, threads: 6 }, kill: 'protected' },
  { name: 'bluetoothd', pid: 141, user: 'root', profile: { cpu: 0.2, mem: 14, threads: 5 }, kill: 'protected' },
  { name: 'WindowServer', pid: 157, user: '_windowserver', profile: { cpu: 6.5, mem: 410, threads: 18 }, kill: 'logout' },
  { name: 'loginwindow', pid: 163, user: null, profile: { cpu: 0.1, mem: 48, threads: 4 }, kill: 'logout' },
  { name: 'coreaudiod', pid: 178, user: '_coreaudiod', profile: { cpu: 0.6, mem: 18, threads: 8 }, kill: 'protected' },
  { name: 'airportd', pid: 186, user: 'root', profile: { cpu: 0.2, mem: 13, threads: 5 }, kill: 'protected' },
  { name: 'trustd', pid: 198, user: 'root', profile: { cpu: 0.1, mem: 11, threads: 4 }, kill: 'protected' },
  { name: 'mds_stores', pid: 214, user: 'root', profile: { cpu: 1.2, mem: 120, threads: 6 }, kill: 'protected' },
  { name: 'distnoted', pid: 231, user: null, profile: { cpu: 0.1, mem: 5, threads: 3 }, kill: 'relaunch' },
  { name: 'cfprefsd', pid: 236, user: null, profile: { cpu: 0.1, mem: 6, threads: 3 }, kill: 'relaunch' },
  { name: 'UserEventAgent', pid: 239, user: null, profile: { cpu: 0.1, mem: 9, threads: 4 }, kill: 'relaunch' },
  { name: 'Dock', pid: 247, user: null, profile: { cpu: 0.5, mem: 96, threads: 6 }, kill: 'relaunch' },
  { name: 'SystemUIServer', pid: 251, user: null, profile: { cpu: 0.2, mem: 42, threads: 5 }, kill: 'relaunch' },
  { name: 'ControlCenter', pid: 255, user: null, profile: { cpu: 0.3, mem: 58, threads: 7 }, kill: 'relaunch' },
  { name: 'NotificationCenter', pid: 258, user: null, profile: { cpu: 0.2, mem: 64, threads: 6 }, kill: 'relaunch' },
  { name: 'Spotlight', pid: 262, user: null, profile: { cpu: 0.3, mem: 72, threads: 7 }, kill: 'relaunch' },
  { name: 'nsurlsessiond', pid: 268, user: null, profile: { cpu: 0.2, mem: 16, threads: 5 }, kill: 'relaunch' },
  { name: 'sharingd', pid: 274, user: null, profile: { cpu: 0.1, mem: 21, threads: 5 }, kill: 'relaunch' },
]; /** Background processes of a macOS-like system; their PIDs stay below the window manager's app PID range. */

/* ───────────────────────── Noise ───────────────────────── */

/**
 * Smooth, deterministic noise in [0, 1] for a seed over time.
 *
 * Sums three sine waves of different frequencies around 0.5, each phase-shifted
 * by the seed, and clamps the result to [0, 1]. The same seed and time always
 * give the same value, and nearby times give nearby values.
 *
 * @param {number} seed - Per-series seed (usually derived from a PID).
 * @param {number} t - Time in seconds.
 * @returns {number} A noise value between 0 and 1.
 *
 * @example
 * const n = smoothNoise(42, Date.now() / 1000);
 * console.log(n >= 0 && n <= 1); // true
 */
export function smoothNoise(seed: number, t: number): number {
  const v = 0.5 + 0.22 * Math.sin(t * 0.53 + seed * 1.7) + 0.16 * Math.sin(t * 1.31 + seed * 0.61) + 0.12 * Math.sin(t * 2.97 + seed * 2.3);
  return Math.min(1, Math.max(0, v));
}

/**
 * Stable pseudo-random integer for a (seed, step) pair.
 *
 * Hashes the seed and step with integer multiplications and xor-shifts, then maps
 * the hash onto the inclusive range [-range, range]. The result is repeatable for
 * the same inputs, which keeps re-rendered rows from flickering.
 *
 * @param {number} seed - Per-series seed (usually derived from a PID).
 * @param {number} step - Sample counter.
 * @param {number} range - Maximum absolute value of the result.
 * @returns {number} An integer between -range and range.
 *
 * @example
 * jitter(7, 3, 1); // -1, 0 or 1, always the same for these inputs
 */
function jitter(seed: number, step: number, range: number): number {
  let h = (seed * 374761393 + step * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % (2 * range + 1)) - range;
}

/* ───────────────────────── Sampling ───────────────────────── */

/**
 * Computes a process's current % CPU.
 *
 * Starts from the profile's CPU scaled by smooth noise (35%–165% of baseline).
 * App processes drop to a quarter while hidden or windowless, grow by 35% per open
 * window, and when focused are multiplied by 2.4 plus a share of the measured
 * main-thread load. WindowServer's compositing load tracks the real frame rate, the
 * number of visible windows and the main-thread load; kernel_task also rises with
 * the main-thread load. The result is rounded to one decimal.
 *
 * @param {ProcInput} p - The process to sample.
 * @param {number} t - Current time in seconds.
 * @param {Pick<Signals, 'busy' | 'fps'>} s - Measured main-thread load and frame rate.
 * @param {number} visibleWindows - Number of windows currently on screen.
 * @returns {number} The process's % CPU, rounded to 0.1.
 *
 * @example
 * const cpu = cpuOf(proc, Date.now() / 1000, { busy: 0.1, fps: 60 }, 3);
 * console.log(cpu); // e.g. 4.7
 */
export function cpuOf(p: ProcInput, t: number, s: Pick<Signals, 'busy' | 'fps'>, visibleWindows: number): number {
  const n = smoothNoise(p.pid + 1, t);
  let cpu = p.profile.cpu * (0.35 + 1.3 * n);
  if (p.appId) {
    if (p.hidden || p.windows === 0) cpu *= 0.25;
    else cpu *= 1 + p.windows * 0.35;
    if (p.focused) cpu = cpu * 2.4 + s.busy * 60;
  } else if (p.name === 'WindowServer') {
    cpu += (s.fps / 60) * 4 + visibleWindows * 0.6 + s.busy * 25;
  } else if (p.name === 'kernel_task') {
    cpu += s.busy * 18;
  }
  return Math.round(cpu * 10) / 10;
}

/**
 * Advances the per-pid counters by one sample.
 *
 * Returns a new accumulator (the input is not mutated). For every process, CPU time,
 * disk reads and network traffic grow in proportion to its current CPU and the elapsed
 * interval, the energy total adds the current energy impact and the sample count goes
 * up by one. A process seen for the first time starts its CPU time, read and network
 * counters as if it had run at its typical load since launch, derived from its age
 * (`t` minus `startedAt`) and profile; its energy and sample counters start at 0.
 *
 * @param {Accum} acc - Counters after the previous sample.
 * @param {ProcInput[]} procs - Processes to sample.
 * @param {number} t - Current time in seconds.
 * @param {number} dt - Seconds elapsed since the previous sample.
 * @param {Signals} s - Measured browser signals.
 * @param {number} visibleWindows - Number of windows currently on screen.
 * @returns {Accum} The updated counters.
 *
 * @example
 * const now = Date.now() / 1000;
 * const acc = advance(prev.acc, procs, now, now - prev.t, signals, 2);
 */
export function advance(acc: Accum, procs: ProcInput[], t: number, dt: number, s: Signals, visibleWindows: number): Accum {
  const next: Accum = { cpuTime: { ...acc.cpuTime }, energy: { ...acc.energy }, samples: { ...acc.samples }, read: { ...acc.read }, sent: { ...acc.sent }, rcvd: { ...acc.rcvd } };
  for (const p of procs) {
    const cpu = cpuOf(p, t, s, visibleWindows);
    const age = Math.max(0, (t * 1000 - p.startedAt) / 1000);
    next.cpuTime[p.pid] = (next.cpuTime[p.pid] ?? age * (p.profile.cpu / 100) * 0.6) + (cpu / 100) * dt;
    next.energy[p.pid] = (next.energy[p.pid] ?? 0) + energyOf(cpu, p);
    next.samples[p.pid] = (next.samples[p.pid] ?? 0) + 1;
    next.read[p.pid] = (next.read[p.pid] ?? age * p.profile.mem * 40) + cpu * 9_000 * dt;
    next.sent[p.pid] = (next.sent[p.pid] ?? age * p.profile.cpu * 120) + cpu * 600 * dt;
    next.rcvd[p.pid] = (next.rcvd[p.pid] ?? age * p.profile.cpu * 900) + cpu * 2_400 * dt;
  }
  return next;
}

/**
 * Computes a process's energy impact from its CPU usage.
 *
 * Energy is 0.85 × % CPU, plus 0.4 when the process has any open window, rounded
 * to one decimal.
 *
 * @param {number} cpu - The process's current % CPU.
 * @param {ProcInput} p - The process (only its window count is used).
 * @returns {number} The energy impact, rounded to 0.1.
 *
 * @example
 * energyOf(10, { ...proc, windows: 1 }); // 8.9
 */
const energyOf = (cpu: number, p: ProcInput) => Math.round((cpu * 0.85 + (p.windows ? 0.4 : 0)) * 10) / 10;

/**
 * Builds the table rows for one sample.
 *
 * Combines each process's current CPU with the accumulated counters and simulated
 * per-column values: thread count grows with open windows (±1 jitter), memory grows
 * 35% per extra window with a slow ±3% drift, and App Nap applies to hidden or
 * windowless apps. Real signals are folded in: an app's bytes written include its
 * actual virtual FS writes (fseventsd shows 2% of all FS writes), nsurlsessiond
 * receives the page's real network bytes and Safari receives its frames' bytes.
 * Packet counts are derived from the byte totals.
 *
 * @param {ProcInput[]} procs - Processes to show.
 * @param {Accum} acc - Counters returned by `advance` for this sample.
 * @param {number} t - Sample time in seconds.
 * @param {number} step - Sample counter, used to seed the jitter.
 * @param {Signals} s - Measured browser signals.
 * @param {number} visibleWindows - Number of windows currently on screen.
 * @returns {ProcRow[]} One row per process, in input order.
 *
 * @example
 * const rows = buildRows(procs, acc, now, step, signals, 2);
 * console.log(rows[0].memory); // bytes
 */
export function buildRows(procs: ProcInput[], acc: Accum, t: number, step: number, s: Signals, visibleWindows: number): ProcRow[] {
  return procs.map((p) => {
    const cpu = cpuOf(p, t, s, visibleWindows);
    const threads = Math.max(1, p.profile.threads + p.windows * 3 + jitter(p.pid, step, 1));
    const extraWindows = Math.max(0, p.windows - 1);
    const drift = 1 + (smoothNoise(p.pid + 77, t / 6) - 0.5) * 0.06;
    const memory = Math.round(p.profile.mem * (1 + extraWindows * 0.35) * drift * 1_048_576);
    const fsBytes = p.appId ? s.fsBytesByApp[p.appId] ?? 0 : p.name === 'fseventsd' ? Object.values(s.fsBytesByApp).reduce((a, b) => a + b, 0) * 0.02 : 0;
    const realNet = p.name === 'nsurlsessiond' ? s.netBytes : p.appId === 'safari' ? s.frameBytes : 0;
    const rcvd = Math.round((acc.rcvd[p.pid] ?? 0) + realNet);
    const sent = Math.round((acc.sent[p.pid] ?? 0) + realNet * 0.04);
    const samples = acc.samples[p.pid] ?? 0;
    return {
      ...p,
      cpu,
      cpuTime: acc.cpuTime[p.pid] ?? 0,
      threads,
      idleWakeUps: Math.max(0, Math.round(p.profile.cpu * 14 * smoothNoise(p.pid + 13, t)) + jitter(p.pid + 5, step, 2)),
      memory,
      compressed: Math.round(memory * 0.07 * smoothNoise(p.pid + 31, t / 10)),
      ports: threads * 21 + 40 + (p.pid % 37),
      energy: energyOf(cpu, p),
      power12h: samples ? Math.round(((acc.energy[p.pid] ?? 0) / samples) * 10) / 10 : energyOf(cpu, p),
      appNap: !!p.appId && (p.hidden || p.windows === 0),
      preventingSleep: p.name === 'coreaudiod' || p.name === 'powerd',
      bytesWritten: Math.round(fsBytes + (acc.read[p.pid] ?? 0) * 0.18),
      bytesRead: Math.round(acc.read[p.pid] ?? 0),
      sentBytes: sent,
      rcvdBytes: rcvd,
      sentPackets: Math.round(sent / 1100),
      rcvdPackets: Math.round(rcvd / 1400),
    };
  });
}

/* ───────────────────────── Formatting ───────────────────────── */

/**
 * Formats CPU time the way Activity Monitor shows it.
 *
 * Produces "m:ss.cc" below one hour and "h:mm:ss.cc" from one hour on, where "cc"
 * are hundredths of a second (truncated, not rounded).
 *
 * @param {number} seconds - CPU time in seconds.
 * @returns {string} The formatted CPU time.
 *
 * @example
 * formatCPUTime(83.5); // "1:23.50"
 * formatCPUTime(7283.5); // "2:01:23.50"
 */
export function formatCPUTime(seconds: number): string {
  const cs = Math.floor((seconds % 1) * 100);
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  /**
   * Pads a number to two digits.
   *
   * Left-pads the decimal representation with zeros to a width of two.
   *
   * @param {number} n - The number to pad.
   * @returns {string} The zero-padded number.
   *
   * @example
   * pad(5); // "05"
   */
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}.${pad(cs)}` : `${m}:${pad(sec)}.${pad(cs)}`;
}

/**
 * Formats a memory size the way Activity Monitor shows it.
 *
 * Values below 1024 are shown as a whole number of bytes with the given unit label.
 * Larger values use binary units (KB, MB, GB, TB) with one decimal, or none from
 * 100 upward.
 *
 * @param {number} bytes - Size in bytes.
 * @param {string} [bytesUnit='bytes'] - Label used for sizes below 1 KB (allows localization).
 * @returns {string} The formatted size.
 *
 * @example
 * formatMem(512); // "512 bytes"
 * formatMem(1536); // "1.5 KB"
 * formatMem(250 * 1048576); // "250 MB"
 */
export function formatMem(bytes: number, bytesUnit = 'bytes'): string {
  if (bytes < 1024) return `${bytes} ${bytesUnit}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * Formats a count with thousands separators.
 *
 * Always uses the en-US locale so columns read the same in every UI language.
 *
 * @param {number} n - The count to format.
 * @returns {string} The grouped number.
 *
 * @example
 * formatCount(1234567); // "1,234,567"
 */
export const formatCount = (n: number) => n.toLocaleString('en-US');

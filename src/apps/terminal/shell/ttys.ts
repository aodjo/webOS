/**
 * Registry of live shell sessions (one per Terminal window), so `ps`, `who`, `uptime` and
 * `kill` can see every open shell, not just their own.
 */
import type { Job } from './types';

/** A registered shell session as seen by other shells. */
export interface TTYInfo {
  /** Device name, e.g. "ttys000". */
  name: string;
  /** pid of the zsh process. */
  pid: number;
  /** Unix time (ms) the session started. */
  startedAt: number;
  /** Terminal window hosting the session, or null when it has none. */
  windowId: string | null;
  /** Name of the foreground command, if one is running. */
  running: string | null;
  /** Background jobs (`cmd &`) running in this shell. */
  readonly jobs: readonly Job[];
  /** Abort the foreground command like ^C (used by `kill` on a command running in this tty). */
  interrupt(): void;
  /** Abort any running command and end the shell session (used by `kill` on the shell's pid). */
  hangup(): void;
}

const ttys = new Map<number, TTYInfo>(); /** Live sessions keyed by tty number. */
let pidCounter = 0; /** Last pid handed out by `nextShellPid`. */

/**
 * Find the lowest tty number not used by a live session.
 *
 * Counts up from 0 and returns the first number missing from the registry, so numbers freed by
 * closed windows are reused.
 *
 * @returns {number} A free tty number.
 *
 * @example
 * const n = allocTTY(); // 0 when no shell is open
 */
export function allocTTY(): number {
  let n = 0;
  while (ttys.has(n)) n++;
  return n;
}

/**
 * Format a tty number as a macOS device name.
 *
 * The number is zero-padded to three digits.
 *
 * @param {number} n - tty number.
 * @returns {string} The device name.
 *
 * @example
 * ttyName(3); // 'ttys003'
 */
export function ttyName(n: number): string {
  return `ttys${String(n).padStart(3, '0')}`;
}

/**
 * Register a shell session under a tty number.
 *
 * Replaces any entry already stored under `n`. The returned function removes the entry only if
 * it still holds this same `info` object, so a stale unregister cannot remove a newer session
 * that reused the number.
 *
 * @param {number} n - tty number, usually from `allocTTY()`.
 * @param {TTYInfo} info - Live view of the session.
 * @returns {() => void} Function that unregisters the session.
 *
 * @example
 * const unregister = registerTTY(allocTTY(), info);
 * unregister();
 */
export function registerTTY(n: number, info: TTYInfo): () => void {
  ttys.set(n, info);
  return () => {
    if (ttys.get(n) === info) ttys.delete(n);
  };
}

/**
 * List all live shell sessions.
 *
 * Copies the registry entries into a new array sorted by tty number, so callers can iterate it
 * while sessions register or unregister.
 *
 * @returns {TTYInfo[]} Registered sessions ordered by tty number.
 *
 * @example
 * listTTYs().map((tt) => tt.name); // ['ttys000', 'ttys001']
 */
export function listTTYs(): TTYInfo[] {
  return [...ttys.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/**
 * Allocate a pid for a new shell process.
 *
 * Pids increase monotonically by a random step of 3–42, like a real kernel, and never fall below
 * `base + 400`, which keeps them above the pids of running apps.
 *
 * @param {number} base - pid of the Terminal app process.
 * @returns {number} The new shell pid.
 *
 * @example
 * const pid = nextShellPid(appPid);
 */
export function nextShellPid(base: number): number {
  pidCounter = Math.max(pidCounter + 3 + Math.floor(Math.random() * 40), base + 400);
  return pidCounter;
}

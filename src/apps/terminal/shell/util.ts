import { FSError, HOME, PATHS, USER, fs, isWithin, type FSErrorCode, type FSNode } from '@/kernel';
import { displayWidth } from './ansi';
import type { CommandContext } from './types';

/* ───────────────────────── Options ───────────────────────── */

/** Result of `getopt`. */
export interface Parsed {
  /** Flag → true, or the option's value. */
  opts: Record<string, string | true>;
  /** Non-option arguments, in order. */
  operands: string[];
  /** BSD-style error text ("illegal option -- z"). */
  error?: string;
}

/**
 * Parse command-line options getopt-style.
 *
 * Uses GNU-style permutation: flags may appear after operands. Single-letter flags can be
 * bundled ("-la"); a letter listed in `values` takes the rest of the word or the next argument
 * as its value ("-n5" / "-n 5"). `--name` and `--name=value` are looked up in `long`, which maps
 * the long name to its option key; the key takes the next argument as its value when it is
 * listed in `values` (an empty string when there is none). A bare "--" ends option parsing and
 * everything after it is an operand. Parsing stops at the first unknown option, or at a short
 * option missing its value, and returns what was parsed so far together with a BSD-style `error`.
 *
 * @param {string[]} args - Arguments after the command name.
 * @param {Object} [spec={}] - Accepted options.
 * @param {string} [spec.flags] - Letters of boolean flags.
 * @param {string} [spec.values] - Letters (or long keys) of options that take a value.
 * @param {Record<string, string>} [spec.long] - Long option name → option key.
 * @returns {Parsed} The parsed options, operands and an optional error message.
 *
 * @example
 * const { opts, operands } = getopt(['-n', '5', 'file.txt'], { values: 'n' });
 * console.log(opts.n, operands); // '5' ['file.txt']
 */
export function getopt(args: string[], spec: { flags?: string; values?: string; long?: Record<string, string> } = {}): Parsed {
  const flags = spec.flags ?? '';
  const values = spec.values ?? '';
  const opts: Record<string, string | true> = {};
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const [name, val] = a.slice(2).split(/=(.*)/s);
      const key = spec.long?.[name];
      if (!key) return { opts, operands, error: `unrecognized option \`--${name}'` };
      opts[key] = val ?? (values.includes(key) ? args[++i] ?? '' : true);
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const ch = a[k];
        if (values.includes(ch)) {
          const v = a.slice(k + 1) || args[++i];
          if (v === undefined) return { opts, operands, error: `option requires an argument -- ${ch}` };
          opts[ch] = v;
          break;
        }
        if (!flags.includes(ch)) return { opts, operands, error: `illegal option -- ${ch}` };
        opts[ch] = true;
      }
      continue;
    }
    operands.push(a);
  }
  return { opts, operands };
}

/**
 * Report an option-parsing error and return the failure status.
 *
 * Writes "<command>: <error>" to stderr, followed by "usage: <usage>" when a usage line is given.
 *
 * @param {CommandContext} ctx - Context of the running command.
 * @param {string} error - Error text, usually `Parsed.error`.
 * @param {string} [usage] - Synopsis to print after the error.
 * @returns {number} Always 1, the conventional status for a usage error.
 *
 * @example
 * if (parsed.error) return usageError(ctx, parsed.error, 'head [-n count] [file ...]');
 */
export function usageError(ctx: CommandContext, error: string, usage?: string): number {
  ctx.error(error);
  if (usage) ctx.stderr.write(`usage: ${usage}\n`);
  return 1;
}

/* ───────────────────────── Layout ───────────────────────── */

/**
 * Pad a string on the right to a display width.
 *
 * Width is measured in terminal cells, so ANSI escapes count as zero and wide (CJK, emoji)
 * characters count as two. Strings already at least `width` wide are returned unchanged.
 *
 * @param {string} s - Text to pad.
 * @param {number} width - Target width in cells.
 * @returns {string} The padded text.
 *
 * @example
 * padEnd('ab', 4); // 'ab  '
 */
export function padEnd(s: string, width: number): string {
  const w = displayWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}

/**
 * Pad a value on the left to a display width.
 *
 * Numbers are converted to strings first. Width is measured in terminal cells like `padEnd`.
 *
 * @param {string | number} s - Text or number to pad.
 * @param {number} width - Target width in cells.
 * @returns {string} The right-aligned text.
 *
 * @example
 * padStart(7, 3); // '  7'
 */
export function padStart(s: string | number, width: number): string {
  const str = String(s);
  const w = displayWidth(str);
  return w >= width ? str : ' '.repeat(width - w) + str;
}

/**
 * Lay out items in columns like BSD `ls -C`.
 *
 * Items are filled column-major. Every column is as wide as the widest item plus at least one
 * space, rounded up to a multiple of 8 (a tab stop). When fewer than two columns fit in
 * `termWidth`, the items are returned one per line. The last item on each line is not padded. Items may contain ANSI
 * escapes; widths are measured in cells.
 *
 * @param {string[]} items - Entries to lay out.
 * @param {number} termWidth - Terminal width in columns.
 * @returns {string[]} Output lines.
 *
 * @example
 * columns(['a', 'b', 'c'], 80); // ['a       b       c']
 */
export function columns(items: string[], termWidth: number): string[] {
  if (!items.length) return [];
  const widths = items.map(displayWidth);
  const maxw = Math.max(...widths);
  const colw = (maxw + 8) & ~7;
  if (termWidth < 2 * colw) return items;
  let numcols = Math.max(1, Math.floor(termWidth / colw));
  const numrows = Math.ceil(items.length / numcols);
  numcols = Math.ceil(items.length / numrows);
  const lines: string[] = [];
  for (let r = 0; r < numrows; r++) {
    let line = '';
    for (let col = 0; col < numcols; col++) {
      const idx = col * numrows + r;
      if (idx >= items.length) break;
      const isLast = col === numcols - 1 || (col + 1) * numrows + r >= items.length;
      line += isLast ? items[idx] : items[idx] + ' '.repeat(colw - widths[idx]);
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Render rows as an aligned text table.
 *
 * Each column is as wide as its widest cell (in display cells). Cells are padded to that width,
 * left- or right-aligned per column, and joined with `gap` spaces. A left-aligned last cell in a
 * row is left unpadded so lines carry no trailing spaces.
 *
 * @param {string[][]} rows - Table rows of cell strings.
 * @param {string} align - One character per column: 'r' for right-aligned, anything else for left.
 * @param {number} [gap=2] - Spaces between columns.
 * @returns {string[]} One output line per row.
 *
 * @example
 * table([['a', '1'], ['bbb', '22']], 'lr'); // ['a     1', 'bbb  22']
 */
export function table(rows: string[][], align: string, gap = 2): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, displayWidth(cell))));
  return rows.map((r) =>
    r
      .map((cell, i) => {
        if (i === r.length - 1 && align[i] !== 'r') return cell;
        return align[i] === 'r' ? padStart(cell, widths[i]) : padEnd(cell, widths[i]);
      })
      .join(' '.repeat(gap)),
  );
}

/* ───────────────────────── Sizes & dates ───────────────────────── */

/**
 * Format a byte count like BSD humanize_number (`ls -h`, `du -h`).
 *
 * Divides by 1024 until the value is below 1024 (up to petabytes). Values below 9.95 in a unit
 * above bytes keep one decimal ("1.2K"); everything else is rounded to an integer ("12K").
 *
 * @param {number} n - Size in bytes.
 * @param {Object} [opts={}] - Formatting options.
 * @param {boolean} [opts.space] - Put a space between the number and the unit.
 * @param {boolean} [opts.iec] - Use IEC unit suffixes ("Ki", "Mi", …) above bytes.
 * @returns {string} The human-readable size, e.g. "512B", "1.2K", "3.4M".
 *
 * @example
 * humanBytes(1536); // '1.5K'
 * humanBytes(1536, { space: true, iec: true }); // '1.5 Ki'
 */
export function humanBytes(n: number, opts: { space?: boolean; iec?: boolean } = {}): string {
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const unit = units[i] + (opts.iec && i > 0 ? 'i' : '');
  const num = i === 0 ? String(Math.round(v)) : v < 9.95 ? v.toFixed(1) : String(Math.round(v));
  return `${num}${opts.space ? ' ' : ''}${unit}`;
}

/**
 * Space a file occupies on disk.
 *
 * Rounds up to whole 4 KiB blocks, like APFS.
 *
 * @param {number} bytes - Logical file size in bytes.
 * @returns {number} Allocated size in bytes.
 *
 * @example
 * diskUsage(100); // 4096
 */
export function diskUsage(bytes: number): number {
  return Math.ceil(bytes / 4096) * 4096;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; /** English month abbreviations indexed by `Date.getMonth()`. */
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; /** English weekday abbreviations indexed by `Date.getDay()`. */
/**
 * Format a number as two digits.
 *
 * Zero-pads single-digit values on the left; used for the hour, minute and second fields of
 * `lsDate` and `ctime`.
 *
 * @param {number} n - Value to format (0–99).
 * @returns {string} The value zero-padded to two characters.
 *
 * @example
 * two(7); // '07'
 */
const two = (n: number) => String(n).padStart(2, '0');

/**
 * Format a timestamp the way `ls -l` does.
 *
 * Recent timestamps (less than about six months old and no more than an hour in the future) show
 * the time ("Jan 15 09:00"); older or future ones show the year instead ("Jan 15  2025"). Uses
 * local time.
 *
 * @param {number} ts - Timestamp in ms.
 * @param {number} [now=Date.now()] - Reference time for deciding what is recent.
 * @returns {string} The formatted date.
 *
 * @example
 * lsDate(Date.now()); // e.g. 'Oct  3 09:00'
 */
export function lsDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const recent = now - ts < 182 * 86_400_000 && ts <= now + 3_600_000;
  return `${MONTHS[d.getMonth()]} ${padStart(d.getDate(), 2)} ${recent ? `${two(d.getHours())}:${two(d.getMinutes())}` : ` ${d.getFullYear()}`}`;
}

/**
 * Format a timestamp in asctime style, in local time.
 *
 * Produces weekday, month, space-padded day of month and a zero-padded HH:MM:SS time, followed
 * by the four-digit year unless `withYear` is false.
 *
 * @param {number} ts - Timestamp in ms.
 * @param {boolean} [withYear=true] - Append the year.
 * @returns {string} The formatted date, e.g. "Thu Oct  2 06:42:10 2026".
 *
 * @example
 * ctime(Date.now(), false); // e.g. 'Sat Oct  3 09:00:00'
 */
export function ctime(ts: number, withYear = true): string {
  const d = new Date(ts);
  const base = `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${padStart(d.getDate(), 2)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return withYear ? `${base} ${d.getFullYear()}` : base;
}

/**
 * Short name of the host's time zone.
 *
 * Uses a built-in table for zones whose familiar abbreviation Intl does not produce (e.g. KST for
 * Asia/Seoul); otherwise asks Intl for the short zone name at `ts`, falling back to "UTC".
 *
 * @param {number} [ts=Date.now()] - Time at which to name the zone (matters for daylight saving).
 * @returns {string} The zone abbreviation, e.g. "KST" or "PDT".
 *
 * @example
 * tzAbbr(); // 'KST' in Seoul
 */
export function tzAbbr(ts = Date.now()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const known: Record<string, string> = { 'Asia/Seoul': 'KST', 'Asia/Tokyo': 'JST', 'Asia/Shanghai': 'CST', 'Asia/Taipei': 'CST', 'Asia/Hong_Kong': 'HKT', 'Asia/Singapore': 'SGT', 'Asia/Kolkata': 'IST', UTC: 'UTC', 'Etc/UTC': 'UTC' };
  if (known[zone]) return known[zone];
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(ts).find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'UTC';
}

/* ───────────────────────── Files ───────────────────────── */

const ERRNO_TEXT: Record<FSErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  EPERM: 'Operation not permitted',
  EINVAL: 'Invalid argument',
}; /** strerror() text for each file-system error code. */

/**
 * Describe an error the way strerror() does.
 *
 * FSErrors map to the standard errno text; other Errors give their message and anything else is
 * stringified.
 *
 * @param {unknown} e - The caught error.
 * @returns {string} Human-readable error text.
 *
 * @example
 * fsErrorText(new FSError('ENOENT', '/x')); // 'No such file or directory'
 */
export function fsErrorText(e: unknown): string {
  if (e instanceof FSError) return ERRNO_TEXT[e.code];
  return e instanceof Error ? e.message : String(e);
}

/**
 * Owner and group of a node, as `ls -l` and `stat` show them.
 *
 * Locked nodes, and every node that is neither inside the home folder or /Users/Shared nor the
 * /tmp folder itself, belong to root: items under /Applications are root:admin, other system
 * items root:wheel. Everything else belongs to the user (group staff).
 *
 * @param {FSNode} node - The node to inspect.
 * @returns {{ user: string, group: string, uid: number, gid: number }} Owner and group names with their ids.
 *
 * @example
 * ownerOf(fs.stat('/etc')!).user; // 'root'
 */
export function ownerOf(node: FSNode): { user: string; group: string; uid: number; gid: number } {
  const system = node.meta?.locked || (!isWithin(node.path, HOME) && node.path !== '/tmp' && !isWithin(node.path, '/Users/Shared'));
  if (system) return isWithin(node.path, PATHS.applications) ? { user: 'root', group: 'admin', uid: 0, gid: 80 } : { user: 'root', group: 'wheel', uid: 0, gid: 0 };
  return { user: USER, group: 'staff', uid: 501, gid: 20 };
}

/**
 * Whether a node can be run as a script.
 *
 * Files ending in .sh, .zsh or .command, and files starting with a "#!" line, are executable.
 * Directories never are.
 *
 * @param {FSNode} node - The node to inspect.
 * @returns {boolean} True when the shell may execute the file.
 *
 * @example
 * isExecutable(fs.stat(`${HOME}/build.sh`)!); // true
 */
export function isExecutable(node: FSNode): boolean {
  if (node.type !== 'file') return false;
  return /\.(sh|zsh|command)$/i.test(node.name) || (node.content ?? '').startsWith('#!');
}

/**
 * Unix permission string for a node, like "drwxr-xr-x".
 *
 * The Trash and the private home folders (Desktop, Documents, Downloads, Pictures, Music) are
 * owner-only, /tmp is world-writable with the sticky bit, other directories are 755. App bundles
 * and executable scripts are 755 files; everything else is 644.
 *
 * @param {FSNode} node - The node to inspect.
 * @returns {string} A 10-character mode string.
 *
 * @example
 * modeString(fs.stat('/tmp')!); // 'drwxrwxrwt'
 */
export function modeString(node: FSNode): string {
  if (node.type === 'dir') {
    if (node.path === PATHS.trash) return 'drwx------';
    if (node.path === '/tmp') return 'drwxrwxrwt';
    return [PATHS.desktop, PATHS.documents, PATHS.downloads, PATHS.pictures, PATHS.music].includes(node.path as never) ? 'drwx------' : 'drwxr-xr-x';
  }
  if (node.name.toLowerCase().endsWith('.app')) return '-rwxr-xr-x';
  return isExecutable(node) ? '-rwxr-xr-x' : '-rw-r--r--';
}

/**
 * Convert a mode string to the octal form `stat` prints.
 *
 * The type character is skipped; each rwx triplet becomes one octal digit, and a trailing "t"
 * (sticky bit) adds a leading 1 and counts as execute for "other".
 *
 * @param {string} mode - Mode string from `modeString`.
 * @returns {string} Four octal digits, e.g. "0755" or "1777".
 *
 * @example
 * modeOctal('-rw-r--r--'); // '0644'
 */
export function modeOctal(mode: string): string {
  const bits = mode.slice(1);
  let out = '';
  for (let i = 0; i < 9; i += 3) {
    const t = bits.slice(i, i + 3);
    out += String((t[0] !== '-' ? 4 : 0) + (t[1] !== '-' ? 2 : 0) + (t[2] === 'x' || t[2] === 't' ? 1 : 0));
  }
  return (bits.endsWith('t') ? '1' : '0') + out;
}

/**
 * Size shown for a node in `ls -l`.
 *
 * Directories report the APFS-style entry size: 64 bytes plus 32 per child (64 when the listing
 * fails). Files report their content size.
 *
 * @param {FSNode} node - The node to measure.
 * @returns {number} Size in bytes.
 * @throws {FSError} ENOENT when the file node's path is missing from the file system.
 *
 * @example
 * lsSize(fs.stat(`${HOME}/notes.txt`)!); // 27
 */
export function lsSize(node: FSNode): number {
  if (node.type === 'dir') {
    try {
      return 64 + 32 * fs.readdir(node.path).length;
    } catch {
      return 64;
    }
  }
  return fs.size(node.path);
}

/**
 * Pseudo inode number for a path.
 *
 * Hashes the path with 32-bit FNV-1a and maps it into the range 1,000,000–9,999,999, so the same
 * path always gets the same number.
 *
 * @param {string} path - Absolute path.
 * @returns {number} A stable seven-digit inode number.
 *
 * @example
 * inodeOf('/etc') === inodeOf('/etc'); // true
 */
export function inodeOf(path: string): number {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
  return 1_000_000 + ((h >>> 0) % 9_000_000);
}

/**
 * Compare two names in byte order, like BSD `ls` in the C locale.
 *
 * Uses plain UTF-16 code-unit comparison, so uppercase letters sort before lowercase ones.
 *
 * @param {string} a - First name.
 * @param {string} b - Second name.
 * @returns {number} -1, 0 or 1, suitable for `Array.prototype.sort`.
 *
 * @example
 * ['b', 'B', 'a'].sort(byteCompare); // ['B', 'a', 'b']
 */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ───────────────────────── Async ───────────────────────── */

/**
 * Wait for a number of milliseconds unless aborted.
 *
 * Resolves false immediately when the signal is already aborted. Otherwise resolves true when the
 * timer fires, or false as soon as the signal aborts; the timer and the abort listener are both
 * removed when it settles.
 *
 * @param {number} ms - Delay in milliseconds.
 * @param {AbortSignal} [signal] - Signal that cuts the wait short.
 * @returns {Promise<boolean>} True if the full delay elapsed, false if aborted.
 *
 * @example
 * if (!(await sleep(1000, ctx.signal))) return 130;
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((res) => {
    if (signal?.aborted) return res(false);
    /**
     * Settle the promise and clean up.
     *
     * Clears the pending timer and removes the abort listener before resolving, so neither can
     * fire after the wait has settled.
     *
     * @param {boolean} ok - Whether the delay completed.
     * @returns {void}
     *
     * @example
     * done(true);
     */
    const done = (ok: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      res(ok);
    };
    /**
     * Abort handler that settles the wait as interrupted.
     *
     * Registered with `{ once: true }` and removed again by `done`, so it resolves the promise
     * with false at most once.
     *
     * @returns {void}
     *
     * @example
     * signal.addEventListener('abort', onAbort, { once: true });
     */
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(true), ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Read all of a command's standard input.
 *
 * Returns piped or redirected input directly. When stdin is the terminal, reads lines
 * interactively (each followed by "\n") until ^D (EOF) or ^C.
 *
 * @async
 * @param {CommandContext} ctx - Context of the running command.
 * @returns {Promise<string | null>} The input text, or null when interrupted with ^C.
 *
 * @example
 * const text = await readAllInput(ctx);
 * if (text === null) return 130;
 */
export async function readAllInput(ctx: CommandContext): Promise<string | null> {
  if (ctx.stdin !== null) return ctx.stdin;
  let text = '';
  for (;;) {
    const line = await ctx.term.readLine('', { signal: ctx.signal });
    if (line === null) return ctx.signal.aborted ? null : text;
    text += line + '\n';
  }
}

/**
 * Split text into lines.
 *
 * A trailing newline does not produce an extra empty line, and empty text gives no lines.
 *
 * @param {string} text - Text to split.
 * @returns {string[]} The lines without their newline characters.
 *
 * @example
 * splitLines('a\nb\n'); // ['a', 'b']
 */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Deterministic pseudo-random number from a seed.
 *
 * Uses the classic sin-hash: the fractional part of a scaled sine of the seed. The same seed
 * always yields the same value.
 *
 * @param {number} seed - Any number.
 * @returns {number} A value in [0, 1).
 *
 * @example
 * seeded(42) === seeded(42); // true
 */
export function seeded(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Why the user cannot write into a directory, mirroring macOS.
 *
 * The home folder, /tmp and /Users/Shared are writable. The root, /System, /bin and /usr live on
 * the sealed, read-only system volume; every other system folder needs root.
 *
 * @param {string} dir - Absolute path of the target directory.
 * @returns {string | null} null when writable, otherwise "Read-only file system" or "Permission denied".
 *
 * @example
 * writeDenied('/System'); // 'Read-only file system'
 */
export function writeDenied(dir: string): string | null {
  if (isWithin(dir, HOME) || isWithin(dir, '/tmp') || isWithin(dir, '/Users/Shared')) return null;
  if (dir === '/' || isWithin(dir, '/System') || isWithin(dir, '/bin') || isWithin(dir, '/usr')) return 'Read-only file system';
  return 'Permission denied';
}

/**
 * One terminal session (= one window): owns the zsh instance, the scrollback buffer and the line
 * editor, and implements the TerminalAPI the shell talks to. Framework-free; the React view
 * subscribes to `version` and forwards DOM events.
 */
import { HOME, HOSTNAME, USER, basename, fs, isMacHost, normalize, useSystem } from '@/kernel';
import { ScreenBuffer } from './buffer';
import { encodeKey } from './vt';
import { c } from './shell/ansi';
import { commonPrefix, complete } from './shell/completion';
import { expandHistory } from './shell/history';
import { Shell, defaultEnvironment } from './shell/interpreter';
import type { Incomplete } from './shell/lexer';
import { allocTTY, nextShellPid, registerTTY, ttyName } from './shell/ttys';
import type { Output, TerminalAPI } from './shell/types';
import { columns, ctime } from './shell/util';

/** Lifecycle phase of a session: loading ~/.zshrc, at the prompt, running a command, or closed. */
export type SessionMode = 'starting' | 'idle' | 'running' | 'exited';

/** The subset of a DOM KeyboardEvent the line editor needs. */
export interface KeyInput {
  key: string;
  /** Physical key (KeyboardEvent.code), used for ⌥B / ⌥F which produce symbols on macOS. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** State of an active ^R reverse incremental history search. */
export interface ReverseSearch {
  query: string;
  /** History index of the current match. */
  index: number;
  match: string;
  failing: boolean;
  /** Line to restore when the search is cancelled. */
  original: string;
}

/** A pasted or typed-ahead line waiting for the shell to read it. */
interface Queued {
  text: string;
  /** Run it (pasted / typed-ahead complete line) or just leave it in the editor. */
  submit: boolean;
}

/** Construction options for a TerminalSession. */
export interface SessionOptions {
  windowId: string | null;
  /** pid of the Terminal app process (shell pids are allocated above it). */
  appPid: number;
  /** Start directory (Finder ▸ "Open in Terminal"). */
  cwd?: string;
  /** Called when the shell exits (exit, ^D, kill). */
  onExit: () => void;
}

const LAST_LOGIN_KEY = 'webos.terminal.lastLogin'; /** localStorage key holding the timestamp of the previous login, shown in the banner. */

const PS2: Record<Incomplete, string> = {
  quote: 'quote> ',
  dquote: 'dquote> ',
  bquote: 'bquote> ',
  cmdsubst: 'cmdsubst> ',
  braceparam: 'braceparam> ',
  backslash: '> ',
  pipe: 'pipe> ',
  cmdand: 'cmdand> ',
  cmdor: 'cmdor> ',
}; /** zsh continuation prompts (PS2) keyed by the kind of unfinished construct in the pending input. */

/**
 * Build the interactive prompt string.
 *
 * Mirrors zsh's default macOS prompt "%n@%m %1~ %# ": user@host in bold green, the last path
 * component of the working directory (or "~" for the home directory, "/" for the root) in bold
 * blue, and a "%" mark that turns red when the previous command exited with a non-zero status.
 *
 * @param {string} cwd - Absolute path of the shell's current working directory.
 * @param {number} status - Exit status of the last command.
 * @returns {string} The prompt text including ANSI color escapes and a trailing space.
 *
 * @example
 * stripAnsi(promptString(`${HOME}/Documents`, 0)); // "aodjo@aodjo-PortfolioBook Documents % "
 * promptString(HOME, 1); // same layout with "~" and a red "%"
 */
export function promptString(cwd: string, status: number): string {
  const dir = cwd === HOME ? '~' : cwd === '/' ? '/' : basename(cwd);
  const mark = status === 0 ? '%' : c.red('%');
  return `${c.bold(c.green(`${USER}@${HOSTNAME}`))} ${c.bold(c.blue(dir))} ${mark} `;
}

/**
 * Test whether a character belongs to a word for word-wise cursor movement.
 *
 * Any non-whitespace character counts as part of a word; `undefined` (out of range) does not.
 *
 * @param {string | undefined} ch - A single character, or undefined past either end of the line.
 * @returns {boolean} True when `ch` is defined and not whitespace.
 *
 * @example
 * isWordChar('a'); // true
 * isWordChar(' '); // false
 */
const isWordChar = (ch: string | undefined) => ch !== undefined && !/\s/.test(ch);

/**
 * Derive the foreground process name for a command line.
 *
 * Used for the window title and `ps`. Takes the first command word, skipping leading
 * `VAR=value` assignments and `sudo [-flags]`, resolves it through the alias table (using the
 * alias's first word), strips surrounding quotes and reduces paths to their basename.
 *
 * @param {string} source - The command line as typed.
 * @param {ReadonlyMap<string, string>} aliases - The shell's alias table.
 * @returns {string} The process name, or an empty string for an empty line.
 *
 * @example
 * foregroundName('FOO=1 sudo -E /usr/bin/top -o cpu', new Map()); // "top"
 * foregroundName('ll Documents', new Map([['ll', 'ls -la']])); // "ls"
 */
export function foregroundName(source: string, aliases: ReadonlyMap<string, string>): string {
  const words = source.trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  if (words[i] === 'sudo' && i < words.length - 1) {
    i++;
    while (i < words.length - 1 && words[i].startsWith('-')) i++;
  }
  let word = words[i] ?? '';
  const alias = aliases.get(word);
  if (alias) word = alias.trim().split(/\s+/)[0] ?? word;
  return word.replace(/^['"]|['"]$/g, '').split('/').pop() || word;
}

/**
 * Find the start of the word to the left of a position.
 *
 * Skips any whitespace immediately left of `i`, then the run of word characters before it,
 * matching the motion of ⌥← / ⌥B and the deletion range of ^W / ⌥⌫.
 *
 * @param {string} s - The line being edited.
 * @param {number} i - Cursor index to start from.
 * @returns {number} Index of the first character of the previous word (0 at the line start).
 *
 * @example
 * wordLeft('git commit -m', 13); // 11
 */
function wordLeft(s: string, i: number): number {
  while (i > 0 && !isWordChar(s[i - 1])) i--;
  while (i > 0 && isWordChar(s[i - 1])) i--;
  return i;
}

/**
 * Find the end of the word to the right of a position.
 *
 * Skips any whitespace at `i`, then the following run of word characters, matching the
 * motion of ⌥→ / ⌥F.
 *
 * @param {string} s - The line being edited.
 * @param {number} i - Cursor index to start from.
 * @returns {number} Index just past the end of the next word (s.length at the line end).
 *
 * @example
 * wordRight('git commit -m', 3); // 10
 */
function wordRight(s: string, i: number): number {
  while (i < s.length && !isWordChar(s[i])) i++;
  while (i < s.length && isWordChar(s[i])) i++;
  return i;
}

/**
 * Read the timestamp of the previous terminal login.
 *
 * Returns null when nothing valid is stored or when localStorage is unavailable (the access
 * error is swallowed).
 *
 * @returns {number | null} Milliseconds since the epoch, or null when unknown.
 *
 * @example
 * const prev = readLastLogin() ?? Date.now();
 */
function readLastLogin(): number | null {
  try {
    const prev = Number(localStorage.getItem(LAST_LOGIN_KEY));
    return prev > 0 ? prev : null;
  } catch {
    return null;
  }
}

/**
 * Persist the timestamp of the current terminal login.
 *
 * Errors from an unavailable localStorage are ignored, so the banner simply falls back to the
 * current time next session.
 *
 * @param {number} ts - Milliseconds since the epoch.
 * @returns {void}
 *
 * @example
 * saveLastLogin(Date.now());
 */
function saveLastLogin(ts: number): void {
  try {
    localStorage.setItem(LAST_LOGIN_KEY, String(ts));
  } catch {}
}

/**
 * A single Terminal window's session: shell, screen buffer, line editor and key handling.
 *
 * Implements TerminalAPI for the shell and exposes a `subscribe` / `getVersion` pair for
 * React's useSyncExternalStore. Each instance registers a tty (ttys000, ttys001, …) so other
 * windows can list or kill it.
 */
export class TerminalSession implements TerminalAPI {
  readonly buffer = new ScreenBuffer();
  readonly shell: Shell;
  readonly tty: string;
  readonly windowId: string | null;

  /** Line editor state. The hidden <input> mirrors these. */
  input = '';
  cursor = 0;
  mode: SessionMode = 'starting';
  /** Foreground command name while one runs (window title, ps). */
  running: string | null = null;
  /** Alternate screen frame (top, matrix, sl) or null. */
  alt: string[] | null = null;
  /** sudo password entry: the input is not echoed. */
  secret = false;
  search: ReverseSearch | null = null;
  cols = 80;
  rows = 24;
  version = 0;

  private readonly opts: SessionOptions;
  private readonly listeners = new Set<() => void>();
  private readonly unregister: () => void;
  private continuation: string | null = null;
  /** Continuation prompt shown for `continuation` (dquote>, pipe>, …). */
  private ps2 = '> ';
  private histIndex: number | null = null;
  private draft = '';
  private abort: AbortController | null = null;
  private lineWaiter: ((line: string | null) => void) | null = null;
  private readonly keyWaiters = new Set<(key: string | null) => void>();
  private readonly rawWaiters = new Set<(data: string | null) => void>();
  private queue: Queued[] = [];
  private tabStreak = 0;
  private runGen = 0;
  private disposed = false;
  private frame: number | null = null;
  private loginTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Create a session with its own interactive shell and tty.
   *
   * Allocates the lowest free tty number and a shell pid above the Terminal app's pid, starts
   * the shell in `opts.cwd` when it is an existing directory (otherwise in HOME) with the
   * default environment for the current locale, and registers the tty so `ps`, `who` and
   * `kill` in other windows can see, interrupt or hang up this session. Nothing is printed
   * until start() is called.
   *
   * @param {SessionOptions} opts - Window id, app pid, optional start directory and exit callback.
   * @returns {TerminalSession} The new session, in "starting" mode.
   *
   * @example
   * const session = new TerminalSession({ windowId: 'w1', appPid: 512, onExit: () => wm.close('w1') });
   * void session.start();
   */
  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.windowId = opts.windowId;
    const n = allocTTY();
    this.tty = ttyName(n);
    const pid = nextShellPid(opts.appPid);
    const start = opts.cwd && fs.isDir(opts.cwd) ? normalize(opts.cwd) : HOME;
    this.shell = new Shell({ term: this, pid, cwd: start, interactive: true, env: defaultEnvironment(useSystem.getState().settings.locale) });
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.unregister = registerTTY(n, {
      name: this.tty,
      pid,
      startedAt: Date.now(),
      windowId: opts.windowId,
      /**
       * Report the foreground command of this session.
       *
       * Read live from the session so the tty registry always shows the current command.
       *
       * @returns {string | null} The running command name, or null at the prompt.
       *
       * @example
       * listTTYs()[0].running; // "top"
       */
      get running() {
        return self.running;
      },
      /**
       * Report the background jobs of this session's shell.
       *
       * Read live from the shell so the tty registry always reflects the current job list.
       *
       * @returns {Job[]} The shell's running background jobs, oldest first.
       *
       * @example
       * listTTYs()[0].jobs.length; // 1
       */
      get jobs() {
        return self.shell.jobs;
      },
      /**
       * Send ^C to this session from another process.
       *
       * Delegates to the session's interrupt(), so it behaves exactly like pressing ^C in this
       * window (aborting the foreground command or abandoning ~/.zshrc).
       *
       * @returns {void}
       *
       * @example
       * listTTYs()[0].interrupt();
       */
      interrupt: () => this.interrupt(),
      /**
       * Hang up this session from another process (kill of the shell pid).
       *
       * Delegates to the session's private hangup(), which aborts the running command and
       * ends the session so its window closes.
       *
       * @returns {void}
       *
       * @example
       * listTTYs()[0].hangup();
       */
      hangup: () => this.hangup(),
    });
  }

  /* ───────────── Subscription (useSyncExternalStore) ───────────── */

  /**
   * Register a change listener.
   *
   * Listeners are called whenever `version` increments (immediately or on the next animation
   * frame, see emit()). Bound as an arrow property so it can be passed directly to
   * useSyncExternalStore.
   *
   * @param {() => void} fn - Callback invoked after every state change.
   * @returns {() => void} Unsubscribe function that removes `fn`.
   *
   * @example
   * const version = useSyncExternalStore(session.subscribe, session.getVersion);
   */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /**
   * Snapshot getter for useSyncExternalStore.
   *
   * Returns the `version` counter, which notify() increments on every change. Bound as an
   * arrow property so it can be passed to useSyncExternalStore without losing `this`.
   *
   * @returns {number} A counter that increases on every visible state change.
   *
   * @example
   * const version = useSyncExternalStore(session.subscribe, session.getVersion);
   */
  getVersion = (): number => this.version;

  /**
   * Bump the version and call every listener.
   *
   * Also clears the pending animation-frame handle, since this is the callback scheduled by
   * emit().
   *
   * @returns {void}
   *
   * @example
   * this.frame = requestFrame(this.notify);
   */
  private notify = (): void => {
    this.frame = null;
    this.version++;
    for (const fn of this.listeners) fn();
  };

  /**
   * Schedule a re-render.
   *
   * With `now` the listeners are notified synchronously (and any pending frame is cancelled),
   * which keeps the input field in sync while typing. Otherwise a single notification is
   * coalesced into the next animation frame, so bursts of output render once. Does nothing
   * after dispose().
   *
   * @param {boolean} [now=false] - Notify immediately instead of on the next frame.
   * @returns {void}
   *
   * @example
   * this.emit();      // batched (output)
   * this.emit(true);  // immediate (editor changes)
   */
  private emit(now = false): void {
    if (this.disposed) return;
    if (now) {
      if (this.frame !== null) cancelFrame(this.frame);
      this.notify();
    } else if (this.frame === null) this.frame = requestFrame(this.notify);
  }

  /* ───────────── TerminalAPI ───────────── */

  /**
   * Report the terminal size in character cells.
   *
   * Returns the values last set by resize() (80×24 until the view measures itself). The shell's
   * $COLUMNS / $LINES and full-screen programs such as matrix and sl read them.
   *
   * @returns {{ cols: number; rows: number }} Current columns and rows.
   *
   * @example
   * session.size(); // { cols: 80, rows: 24 }
   */
  size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Clear the visible screen while keeping the scrollback above it.
   *
   * Delegates to the screen buffer's clearScreen() and schedules a batched re-render, so it
   * can be called from a running command like any other output.
   *
   * @returns {void}
   *
   * @example
   * session.clear(); // `clear` command
   */
  clear(): void {
    this.buffer.clearScreen();
    this.emit();
  }

  /**
   * Remove the whole scrollback and screen (⌥⌘K).
   *
   * Empties the screen buffer completely and re-renders immediately. The line being edited
   * lives outside the buffer, so it is not affected.
   *
   * @returns {void}
   *
   * @example
   * session.clearScrollback();
   */
  clearScrollback(): void {
    this.buffer.clearAll();
    this.emit(true);
  }

  /**
   * End the session because the interactive shell exited.
   *
   * Delegates to end(), which switches to "exited" mode and calls the owner's `onExit`
   * callback once.
   *
   * @returns {void}
   *
   * @example
   * session.exit(); // called by the `exit` builtin
   */
  exit(): void {
    this.end();
  }

  /**
   * Read one line from the user for a running command (read, sudo password, cat, …).
   *
   * Prints `prompt`, then serves queued input first, like bytes waiting in a real tty: a
   * queued complete line is echoed (unless `secret`) and returned immediately, and an
   * unterminated pasted tail is placed into this reader's line editor when it is empty.
   * Otherwise the line editor is shown and the promise resolves when submit() is called,
   * with null on ^D at an empty line, on ^C, or when `signal` aborts. While `secret` is set
   * the typed text is neither displayed nor echoed.
   *
   * @param {string} prompt - Text written before reading (may be empty).
   * @param {{ secret?: boolean; signal?: AbortSignal }} [opts={}] - `secret` hides the input;
   *   `signal` cancels the read.
   * @returns {Promise<string | null>} The entered line without its newline, or null on EOF / abort.
   *
   * @example
   * const pw = await term.readLine('Password:', { secret: true, signal });
   * if (pw === null) return 130;
   */
  readLine(prompt: string, opts: { secret?: boolean; signal?: AbortSignal } = {}): Promise<string | null> {
    if (prompt) this.write(prompt);
    if (opts.signal?.aborted) return Promise.resolve(null);
    const queued = this.queue[0];
    if (queued?.submit) {
      this.queue.shift();
      this.write((opts.secret ? '' : queued.text) + '\n');
      return Promise.resolve(queued.text);
    }
    if (queued && !this.input) {
      this.queue.shift();
      this.input = queued.text;
      this.cursor = queued.text.length;
    }
    return new Promise((resolve) => {
      /**
       * Resolve the pending read with null when the signal aborts.
       *
       * Registered as a one-shot abort listener; calls finish(null), which also detaches it
       * and leaves secret mode.
       *
       * @returns {void}
       *
       * @example
       * opts.signal?.addEventListener('abort', onAbort, { once: true });
       */
      const onAbort = () => finish(null);
      /**
       * Complete the pending read.
       *
       * Detaches the abort listener, clears `lineWaiter` if it still points here, leaves
       * secret mode, re-renders and resolves the promise.
       *
       * @param {string | null} line - The entered line, or null for EOF / abort.
       * @returns {void}
       *
       * @example
       * finish('yes');
       */
      const finish = (line: string | null) => {
        opts.signal?.removeEventListener('abort', onAbort);
        if (this.lineWaiter === finish) this.lineWaiter = null;
        this.secret = false;
        this.emit(true);
        resolve(line);
      };
      this.lineWaiter = finish;
      this.secret = !!opts.secret;
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      this.emit(true);
    });
  }

  /**
   * Wait for a single raw key press (used by full-screen programs such as top or matrix).
   *
   * While a command runs with a key waiter registered and no line being read, handleKey()
   * delivers every key's `KeyboardEvent.key` value to the waiters instead of the line editor.
   *
   * @param {AbortSignal} [signal] - Cancels the wait.
   * @returns {Promise<string | null>} The key name (e.g. "q", "ArrowUp"), or null when aborted.
   *
   * @example
   * const key = await term.readKey(signal);
   * if (key === 'q' || key === null) return 0;
   */
  readKey(signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      /**
       * Resolve the pending key wait with null when the signal aborts.
       *
       * Registered as a one-shot abort listener; calls done(null), which also removes this
       * waiter from the session.
       *
       * @returns {void}
       *
       * @example
       * signal?.addEventListener('abort', onAbort, { once: true });
       */
      const onAbort = () => done(null);
      /**
       * Complete the pending key wait and unregister this waiter.
       *
       * Detaches the abort listener, removes itself from `keyWaiters` (so later keys go
       * elsewhere) and resolves the promise. handleKey(), interrupt(), finishRun() and
       * dispose() call it through the waiter set.
       *
       * @param {string | null} key - The pressed key, or null when cancelled.
       * @returns {void}
       *
       * @example
       * done('q');
       */
      const done = (key: string | null) => {
        signal?.removeEventListener('abort', onAbort);
        this.keyWaiters.delete(done);
        resolve(key);
      };
      this.keyWaiters.add(done);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Wait for raw terminal input (used by `linux`, which forwards it to a virtual machine).
   *
   * While a command runs with a raw waiter registered and no line being read, handleKey()
   * encodes each key press as terminal bytes with encodeKey() (so ^C is sent, not acted on) and
   * paste() delivers pasted text with line breaks as carriage returns.
   *
   * @param {AbortSignal} [signal] - Cancels the wait.
   * @returns {Promise<string | null>} The input bytes, or null when aborted.
   *
   * @example
   * const data = await term.readRaw(signal);
   * if (data !== null) vm.serial0_send(data);
   */
  readRaw(signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      /**
       * Resolve the pending wait with null when the signal aborts.
       *
       * @returns {void}
       *
       * @example
       * signal?.addEventListener('abort', onAbort, { once: true });
       */
      const onAbort = () => done(null);
      /**
       * Complete the pending wait and unregister this waiter.
       *
       * @param {string | null} data - The input, or null when cancelled.
       * @returns {void}
       *
       * @example
       * done('\r');
       */
      const done = (data: string | null) => {
        signal?.removeEventListener('abort', onAbort);
        this.rawWaiters.delete(done);
        resolve(data);
      };
      this.rawWaiters.add(done);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Hand input to the raw waiters, if a running command is reading raw input.
   *
   * @param {string} data - Bytes to deliver.
   * @returns {boolean} True when a raw reader took the input.
   *
   * @example
   * if (this.deliverRaw('\x03')) return true;
   */
  private deliverRaw(data: string): boolean {
    if (this.mode !== 'running' || this.lineWaiter || !this.rawWaiters.size) return false;
    for (const k of [...this.rawWaiters]) k(data);
    return true;
  }

  /**
   * Show a full-screen frame on the alternate screen, or leave it.
   *
   * Frame updates are batched to the next animation frame; leaving the alternate screen
   * (null) re-renders immediately.
   *
   * @param {string[] | null} frame - Lines to display, or null to return to the normal screen.
   * @returns {void}
   *
   * @example
   * term.altScreen(['top - 12:00:00', '...']);
   * term.altScreen(null);
   */
  altScreen(frame: string[] | null): void {
    this.alt = frame;
    this.emit(frame === null);
  }

  /**
   * Create the output stream for background jobs (`cmd &`).
   *
   * Writes go through writeAsync(), so job output is never dropped by a later command and is
   * printed above the prompt while the shell is idle.
   *
   * @returns {Output} A TTY output stream bound to this session.
   *
   * @example
   * const out = term.background?.() ?? io.stdout;
   */
  background(): Output {
    return { write: (s) => this.writeAsync(s), isTTY: true };
  }

  /**
   * List everything running in this window, for the close confirmation sheet.
   *
   * Combines the foreground command name with the first word of each background job's
   * command line; an empty array means the window can close without asking.
   *
   * @returns {string[]} The foreground command name (if any) followed by the first word of
   *   each background job's command.
   *
   * @example
   * session.processNames(); // ["top", "sleep"]
   */
  processNames(): string[] {
    return [...(this.running ? [this.running] : []), ...this.shell.jobs.map((j) => j.command.split(/\s+/)[0])];
  }

  /* ───────────── Output ───────────── */

  /**
   * Append text to the screen buffer and schedule a batched re-render.
   *
   * The buffer interprets newlines and ANSI escapes; the re-render is coalesced into the next
   * animation frame by emit(), so bursts of output draw once.
   *
   * @param {string} text - Text, possibly containing ANSI escapes and newlines.
   * @returns {void}
   *
   * @example
   * this.write('hello\n');
   */
  private write(text: string): void {
    this.buffer.write(text);
    this.emit();
  }

  /**
   * Write output from a background job.
   *
   * Ignored after dispose(), after the session exited, or for empty text. When the shell sits
   * at its prompt (idle, no command reading a line), the unterminated prompt line is taken out
   * of the buffer, the text is printed (newline-terminated) and the prompt is written back
   * below it. The line being edited lives outside the buffer, so it is unaffected. Otherwise
   * the text is appended as-is.
   *
   * @param {string} text - Output from the job.
   * @returns {void}
   *
   * @example
   * this.writeAsync('[1]  + done       sleep 5\n');
   */
  private writeAsync(text: string): void {
    if (this.disposed || this.mode === 'exited' || !text) return;
    if (this.mode === 'idle' && !this.lineWaiter) {
      const prompt = this.buffer.takePending();
      this.buffer.write(text.endsWith('\n') ? text : `${text}\n`);
      this.buffer.write(prompt);
    } else this.buffer.write(text);
    this.emit();
  }

  /**
   * Create the output stream for one command run.
   *
   * Writes are forwarded only while `gen` is still the current run generation, so output from
   * a run that was detached after an ignored ^C is dropped.
   *
   * @param {number} gen - Run generation the stream belongs to.
   * @returns {Output} A TTY output stream for stdout / stderr of that run.
   *
   * @example
   * const out = this.stream(++this.runGen);
   * await this.shell.run(source, { stdout: out, stderr: out }, signal);
   */
  private stream(gen: number): Output {
    return { write: (s) => gen === this.runGen && this.write(s), isTTY: true };
  }

  /* ───────────── Lifecycle ───────────── */

  /**
   * Boot the session: print the login banner, run ~/.zshrc and show the first prompt.
   *
   * Prints "Last login: … on ttysNNN" using the stored previous login time, and stores the
   * current time one second later so a window that is torn down immediately (React
   * StrictMode's double mount) does not count as a login. Prints /etc/motd when present
   * (read errors are ignored). Sources ~/.zshrc in this shell with an abortable signal (^C
   * abandons the rest of it) and resets the status to 0 afterwards. When a `script` path is
   * given, it is shell-quoted if needed, placed into the editor and submitted; otherwise any
   * queued typed-ahead input is drained. Returns early if the session was disposed meanwhile.
   *
   * @async
   * @param {string} [script] - Optional path of a script to run right after the prompt appears.
   * @returns {Promise<void>} Resolves once the first prompt has been shown.
   *
   * @example
   * const session = new TerminalSession(opts);
   * await session.start('/Users/aodjo/Desktop/build.sh');
   */
  async start(script?: string): Promise<void> {
    const now = Date.now();
    this.write(`Last login: ${ctime(readLastLogin() ?? now, false)} on ${this.tty}\n`);
    this.loginTimer = setTimeout(() => saveLastLogin(now), 1000);
    try {
      const motd = fs.exists('/etc/motd') ? fs.readFile('/etc/motd') : '';
      if (motd) this.write(motd.endsWith('\n') ? motd : motd + '\n');
    } catch {}
    const rc = `${HOME}/.zshrc`;
    if (fs.stat(rc)?.type === 'file') {
      const gen = ++this.runGen;
      const out = this.stream(gen);
      this.abort = new AbortController();
      await this.shell.source(rc, [], { stdout: out, stderr: out }, this.abort.signal);
      this.abort = null;
      this.shell.status = 0;
    }
    if (this.disposed) return;
    this.showPrompt();
    if (script) {
      this.input = /[\s'"\\$]/.test(script) ? `'${script.replace(/'/g, `'\\''`)}'` : script;
      this.cursor = this.input.length;
      this.submit();
    } else this.drainQueue();
  }

  /**
   * Update the terminal size from the view's measurement.
   *
   * Clamps to at least 10 columns and 3 rows, exports the width as $COLUMNS and re-renders.
   * Does nothing when the size is unchanged.
   *
   * @param {number} cols - Visible columns.
   * @param {number} rows - Visible rows.
   * @returns {void}
   *
   * @example
   * session.resize(120, 36);
   */
  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = Math.max(10, cols);
    this.rows = Math.max(3, rows);
    this.shell.setVar('COLUMNS', String(this.cols));
    this.emit(true);
  }

  /**
   * Tear the session down when its window closes.
   *
   * Idempotent. Cancels the pending last-login write, aborts the running command, kills
   * background jobs, resolves any pending readLine/readKey with null, cancels the scheduled
   * frame, drops all listeners and unregisters the tty.
   *
   * @returns {void}
   *
   * @example
   * useEffect(() => () => session.dispose(), [session]);
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.loginTimer);
    this.abort?.abort();
    this.shell.killJobs();
    this.lineWaiter?.(null);
    for (const k of [...this.keyWaiters]) k(null);
    for (const k of [...this.rawWaiters]) k(null);
    if (this.frame !== null) cancelFrame(this.frame);
    this.listeners.clear();
    this.unregister();
  }

  /**
   * Handle this shell being killed by another process (`kill <pid>` from another window).
   *
   * Aborts the running command and ends the session.
   *
   * @returns {void}
   *
   * @example
   * this.hangup();
   */
  private hangup(): void {
    this.abort?.abort();
    this.end();
  }

  /**
   * Mark the session as exited and notify the owner.
   *
   * Idempotent: only the first call re-renders and invokes `opts.onExit`.
   *
   * @returns {void}
   *
   * @example
   * if (this.shell.exited) this.end();
   */
  private end(): void {
    if (this.mode === 'exited') return;
    this.mode = 'exited';
    this.emit(true);
    this.opts.onExit();
  }

  /* ───────────── Prompt & execution ───────────── */

  /**
   * Whether the line editor is reading for the shell or a command.
   *
   * True in "idle" mode (the shell prompt) and whenever a running command waits in
   * readLine(), i.e. when a submitted line is consumed right away instead of being queued.
   *
   * @returns {boolean} True at the prompt, or while a command is reading a line.
   *
   * @example
   * if (session.editing) inputRef.current?.focus();
   */
  get editing(): boolean {
    return this.mode === 'idle' || this.lineWaiter !== null;
  }

  /**
   * Whether the shell is busy and not reading from the line editor.
   *
   * True in "running" or "starting" mode when no readLine() is pending. Lines submitted or
   * pasted while busy are queued as typed-ahead input instead of being executed.
   *
   * @returns {boolean} True while a command or ~/.zshrc runs without waiting for a line.
   *
   * @example
   * if (this.busy) this.queue.push({ text: line, submit: true });
   */
  private get busy(): boolean {
    return (this.mode === 'running' || this.mode === 'starting') && this.lineWaiter === null;
  }

  /**
   * Print a fresh primary prompt and switch to idle.
   *
   * Implements zsh's PROMPT_SP: when the previous output did not end with a newline, an
   * inverse "%" marks the partial line and a newline is added before the prompt.
   *
   * @returns {void}
   *
   * @example
   * this.showPrompt();
   */
  private showPrompt(): void {
    if (!this.buffer.atLineStart) this.buffer.write(`${c.inverse('%')}\n`);
    this.buffer.write(promptString(this.shell.cwd, this.shell.status));
    this.mode = 'idle';
    this.emit(true);
  }

  /**
   * Move the next queued (pasted / typed-ahead) line into the editor.
   *
   * Complete lines are submitted right away; an unterminated tail is left in the editor for
   * the user to finish. Does nothing when the queue is empty.
   *
   * @returns {void}
   *
   * @example
   * this.showPrompt();
   * this.drainQueue();
   */
  private drainQueue(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.input = next.text;
    this.cursor = next.text.length;
    if (next.submit) this.submit();
    else this.emit(true);
  }

  /**
   * Submit the current editor line (Enter).
   *
   * Accepts a pending ^R match first. Then, in order:
   * - a command waiting in readLine() receives the line (echoed unless secret);
   * - while the shell is busy, the line is queued and runs after the current command;
   * - otherwise, at the prompt, the line is echoed and joined to any pending continuation.
   *   If the shell reports the source as incomplete (open quote, trailing pipe, …) the
   *   matching PS2 prompt is shown and input continues; a syntax error from that check is
   *   ignored here and reported when the line runs. Blank input just reprints the prompt.
   *   History expansion (`!!`, `!$`, …) is applied; on error the message is printed with
   *   status 1, and an expanded line is echoed before running. The line is added to history
   *   and executed asynchronously.
   * In any other mode (exited) nothing happens.
   *
   * @returns {void}
   *
   * @example
   * session.insert('ls -la');
   * session.submit();
   */
  submit(): void {
    if (this.search) this.acceptSearch();
    const line = this.input;
    if (this.lineWaiter) {
      this.write((this.secret ? '' : line) + '\n');
      this.setLine('');
      this.lineWaiter(line);
      return;
    }
    if (this.busy) {
      this.queue.push({ text: line, submit: true });
      this.setLine('');
      return;
    }
    if (this.mode !== 'idle') return;
    this.write(line + '\n');
    this.setLine('');
    this.histIndex = null;
    this.draft = '';
    const source = this.continuation !== null ? `${this.continuation}\n${line}` : line;
    let incomplete: Incomplete | null = null;
    try {
      incomplete = this.shell.check(source);
    } catch {}
    if (incomplete) {
      this.continuation = source;
      this.ps2 = PS2[incomplete];
      this.write(this.ps2);
      this.emit(true);
      this.drainQueue();
      return;
    }
    this.continuation = null;
    if (!source.trim()) {
      this.showPrompt();
      this.drainQueue();
      return;
    }
    const expanded = expandHistory(source, this.shell.history);
    if (expanded.error !== undefined) {
      this.write(expanded.error + '\n');
      this.shell.status = 1;
      this.showPrompt();
      this.drainQueue();
      return;
    }
    if (expanded.changed) this.write(expanded.line + '\n');
    this.shell.addHistory(expanded.line);
    void this.execute(expanded.line);
  }

  /**
   * Run a complete command line in the foreground.
   *
   * Starts a new run generation with its own AbortController, switches to running mode and
   * records the foreground process name. Errors thrown by the interpreter are printed as
   * "zsh: <message>". When the run finishes and is still the current generation (it was not
   * detached by an ignored ^C), finishRun() restores the prompt.
   *
   * @async
   * @param {string} source - The fully expanded command line.
   * @returns {Promise<void>} Resolves when the command has finished.
   *
   * @example
   * void this.execute('ls -la');
   */
  private async execute(source: string): Promise<void> {
    const gen = ++this.runGen;
    const abort = new AbortController();
    this.abort = abort;
    this.mode = 'running';
    this.running = foregroundName(source, this.shell.aliases);
    this.emit(true);
    const out = this.stream(gen);
    try {
      await this.shell.run(source, { stdout: out, stderr: out }, abort.signal);
    } catch (e) {
      out.write(`zsh: ${e instanceof Error ? e.message : String(e)}\n`);
    }
    if (gen === this.runGen) this.finishRun();
  }

  /**
   * Clean up after a foreground run and return to the prompt.
   *
   * Clears the abort controller, foreground name, alternate screen, pending line reader and
   * secret mode, and cancels key waiters. A disposed or hung-up session (killed from another
   * window) stays exited while its window closes; if the command made the shell exit, the
   * session ends. Otherwise the prompt is shown and queued input is drained.
   *
   * @returns {void}
   *
   * @example
   * if (gen === this.runGen) this.finishRun();
   */
  private finishRun(): void {
    this.abort = null;
    this.running = null;
    this.alt = null;
    this.lineWaiter = null;
    this.secret = false;
    for (const k of [...this.keyWaiters]) k(null);
    for (const k of [...this.rawWaiters]) k(null);
    if (this.disposed || this.mode === 'exited') return;
    if (this.shell.exited) {
      this.end();
      return;
    }
    this.showPrompt();
    this.drainQueue();
  }

  /**
   * Handle ^C.
   *
   * Always cancels a ^R search. Behavior depends on the mode:
   * - running: echoes the partially typed line (unless secret) and "^C", clears the editor
   *   and the typed-ahead queue, aborts the command and cancels pending line/key reads. If the
   *   command ignores the abort, it is detached after 1.5 s by bumping the run generation
   *   (its later output is dropped) so the prompt comes back.
   * - starting: abandons the rest of ~/.zshrc (e.g. a `sleep` in it).
   * - idle: prints the current line followed by "^C", discards any continuation and shows a
   *   new prompt.
   *
   * @returns {void}
   *
   * @example
   * session.interrupt();
   */
  interrupt(): void {
    if (this.search) this.search = null;
    if (this.mode === 'running') {
      if (this.lineWaiter && !this.secret) this.buffer.write(this.input);
      this.setLine('');
      this.buffer.write('^C\n');
      this.queue = [];
      const gen = this.runGen;
      this.abort?.abort();
      this.lineWaiter?.(null);
      for (const k of [...this.keyWaiters]) k(null);
      for (const k of [...this.rawWaiters]) k(null);
      setTimeout(() => {
        if (!this.disposed && this.mode === 'running' && this.runGen === gen) {
          this.runGen++;
          this.finishRun();
        }
      }, 1500);
      this.emit(true);
    } else if (this.mode === 'starting') {
      this.buffer.write('^C\n');
      this.abort?.abort();
      this.emit(true);
    } else if (this.mode === 'idle') {
      this.buffer.write(`${this.input}^C\n`);
      this.setLine('');
      this.continuation = null;
      this.histIndex = null;
      this.showPrompt();
    }
  }

  /* ───────────── Line editing ───────────── */

  /**
   * Replace the editor line and place the cursor.
   *
   * The cursor is clamped to the line bounds; the view re-renders immediately.
   *
   * @param {string} text - New line contents.
   * @param {number} [cursor=text.length] - New cursor index.
   * @returns {void}
   *
   * @example
   * this.setLine('git status', 3);
   */
  private setLine(text: string, cursor = text.length): void {
    this.input = text;
    this.cursor = Math.max(0, Math.min(cursor, text.length));
    this.emit(true);
  }

  /**
   * Sync the editor from the hidden <input>'s change event.
   *
   * Resets the Tab streak. During a ^R search the value is ignored, because keys are routed
   * to the search query by handleKey(); the view is just re-rendered so the editor keeps
   * showing the current match.
   *
   * @param {string} value - The input element's value.
   * @param {number} cursor - The input element's selection start.
   * @returns {void}
   *
   * @example
   * onChange={(e) => session.setInput(e.target.value, e.target.selectionStart ?? 0)}
   */
  setInput(value: string, cursor: number): void {
    this.tabStreak = 0;
    if (this.search) {
      this.emit(true);
      return;
    }
    this.input = value;
    this.cursor = Math.max(0, Math.min(cursor, value.length));
    this.emit(true);
  }

  /**
   * Move the editor cursor, clamped to the line.
   *
   * Does nothing when the cursor is already there.
   *
   * @param {number} cursor - Target index.
   * @returns {void}
   *
   * @example
   * session.setCursor(0);
   */
  setCursor(cursor: number): void {
    if (cursor === this.cursor) return;
    this.cursor = Math.max(0, Math.min(cursor, this.input.length));
    this.emit(true);
  }

  /**
   * Insert text at the cursor and move the cursor past it.
   *
   * Resets the Tab streak, so the next Tab starts a fresh completion, and re-renders
   * immediately.
   *
   * @param {string} text - Text to insert (no newlines; use paste() for multi-line text).
   * @returns {void}
   *
   * @example
   * session.insert('~/Documents');
   */
  insert(text: string): void {
    this.tabStreak = 0;
    this.setLine(this.input.slice(0, this.cursor) + text + this.input.slice(this.cursor), this.cursor + text.length);
  }

  /**
   * Paste text into the terminal.
   *
   * CRLF / CR are normalized to LF. Single-line text is inserted at the cursor. For
   * multi-line text the first line is inserted, every following complete line is queued to
   * run in order, and an unterminated last line is queued to stay in the editor. If the shell
   * is busy, the edited first line is queued too and everything waits for the prompt;
   * otherwise the first line is submitted immediately and the queue drains after it.
   *
   * @param {string} raw - Clipboard text.
   * @returns {void}
   *
   * @example
   * session.paste('cd ~/Documents\nls\n');
   */
  paste(raw: string): void {
    if (this.deliverRaw(raw.replace(/\r?\n/g, '\r'))) return;
    const text = raw.replace(/\r\n?/g, '\n');
    if (!text.includes('\n')) {
      this.insert(text);
      return;
    }
    const [first, ...rest] = text.split('\n');
    const tail = rest.pop()!;
    this.insert(first);
    const lines: Queued[] = rest.map((l) => ({ text: l, submit: true }));
    if (tail) lines.push({ text: tail, submit: false });
    if (this.busy) {
      this.queue.push({ text: this.input, submit: true }, ...lines);
      this.setLine('');
      return;
    }
    this.queue.push(...lines);
    this.submit();
  }

  /**
   * Step through command history (↑ / ↓, ^P / ^N).
   *
   * The first step back saves the line being edited as a draft; stepping forward past the
   * newest entry restores that draft. Stops at the oldest entry; does nothing with an empty
   * history or when moving forward without having moved back.
   *
   * @param {-1 | 1} dir - -1 for older, 1 for newer.
   * @returns {void}
   *
   * @example
   * this.historyMove(-1);
   */
  private historyMove(dir: -1 | 1): void {
    const h = this.shell.history;
    if (!h.length) return;
    if (this.histIndex === null) {
      if (dir === 1) return;
      this.draft = this.input;
      this.histIndex = h.length;
    }
    const next = this.histIndex + dir;
    if (next < 0) return;
    if (next >= h.length) {
      this.histIndex = null;
      this.setLine(this.draft);
      return;
    }
    this.histIndex = next;
    this.setLine(h[next]);
  }

  /**
   * Tab completion, zsh-style.
   *
   * A single candidate replaces the word under the cursor. With several candidates, a longer
   * common prefix is inserted first; otherwise the second consecutive Tab prints the
   * candidates in columns below the line (directories in bold blue) and redraws the prompt
   * (or the PS2 continuation prompt) so the editor continues underneath.
   *
   * @returns {void}
   *
   * @example
   * session.insert('cd Doc');
   * session.handleKey({ key: 'Tab', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
   */
  private tab(): void {
    const result = complete(this.input, this.cursor, this.shell);
    const { start, candidates } = result;
    /**
     * Replace the completed word (from `start` to the cursor) with `text`.
     *
     * Keeps everything after the cursor and places the cursor right after the inserted text.
     *
     * @param {string} text - Replacement text.
     * @returns {void}
     *
     * @example
     * replace('Documents/');
     */
    const replace = (text: string) => this.setLine(this.input.slice(0, start) + text + this.input.slice(this.cursor), start + text.length);
    if (!candidates.length) {
      this.tabStreak = 0;
      return;
    }
    if (candidates.length === 1) {
      this.tabStreak = 0;
      replace(candidates[0].insert);
      return;
    }
    const lcp = commonPrefix(candidates.map((cand) => cand.insert));
    if (lcp.length > result.word.length) {
      replace(lcp);
      this.tabStreak = 1;
      return;
    }
    if (++this.tabStreak < 2) return;
    this.tabStreak = 0;
    const list = candidates.map((cand) => (cand.dir ? c.bold(c.blue(cand.display)) : cand.display));
    this.buffer.write(`${this.input}\n${columns(list, this.cols).join('\n')}\n`);
    if (this.continuation !== null) this.buffer.write(this.ps2);
    else this.buffer.write(promptString(this.shell.cwd, this.shell.status));
    this.emit(true);
  }

  /* ───────────── Reverse incremental search (^R) ───────────── */

  /**
   * Search history backwards for a query.
   *
   * Scans entries older than `from` (newest first). On a hit the match is shown in the editor
   * with the cursor at the last occurrence of the query; otherwise the search is marked as
   * failing and the previous match stays visible. Requires an active search.
   *
   * @param {string} query - Substring to look for.
   * @param {number} from - Exclusive upper history index to start scanning below.
   * @returns {void}
   *
   * @example
   * this.searchFor('git', this.shell.history.length);
   */
  private searchFor(query: string, from: number): void {
    const s = this.search!;
    const h = this.shell.history;
    s.query = query;
    for (let i = Math.min(from, h.length) - 1; i >= 0; i--) {
      if (h[i].includes(query)) {
        s.index = i;
        s.match = h[i];
        s.failing = false;
        this.input = s.match;
        this.cursor = Math.max(0, s.match.lastIndexOf(query));
        this.emit(true);
        return;
      }
    }
    s.failing = true;
    this.emit(true);
  }

  /**
   * End the ^R search and keep the current match in the editor.
   *
   * Clears `search` and puts the match on the editor line with the cursor at its end. Does
   * nothing when no search is active.
   *
   * @returns {void}
   *
   * @example
   * this.acceptSearch();
   */
  private acceptSearch(): void {
    if (!this.search) return;
    const { match } = this.search;
    this.search = null;
    this.setLine(match);
  }

  /**
   * Route a key press to the active ^R search.
   *
   * ^R finds the next older match; ^G or Escape cancels and restores the original line;
   * Backspace shortens the query and searches again from the newest entry; printable keys
   * extend the query. Enter is left to the normal handler (which accepts and runs the match).
   * Any other key accepts the match and is then handled normally.
   *
   * @param {KeyInput} e - The key press.
   * @returns {boolean} True when the search consumed the key.
   *
   * @example
   * if (this.search && this.searchKey(e)) return true;
   */
  private searchKey(e: KeyInput): boolean {
    const s = this.search!;
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
      this.searchFor(s.query, s.index);
      return true;
    }
    if ((e.ctrlKey && e.key.toLowerCase() === 'g') || e.key === 'Escape') {
      const original = s.original;
      this.search = null;
      this.setLine(original);
      return true;
    }
    if (e.key === 'Backspace') {
      this.searchFor(s.query.slice(0, -1), this.shell.history.length);
      if (!s.query) {
        s.failing = false;
        this.emit(true);
      }
      return true;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.searchFor(s.query + e.key, s.index + 1);
      return true;
    }
    if (e.key === 'Enter') return false;
    this.acceptSearch();
    return false;
  }

  /* ───────────── Keyboard ───────────── */

  /**
   * Handle a keydown from the hidden input.
   *
   * Dispatch order:
   * 1. Bare modifier keys are ignored.
   * 2. ⌘K (Ctrl+K on Windows/Linux) is never consumed, so it bubbles up to the global
   *    Spotlight shortcut.
   * 3. ⌥⌘K (Ctrl+Alt+K on Windows/Linux) clears the scrollback; on macOS ⌥ turns the key into
   *    a symbol, so the physical key code is matched there.
   * 4. Programs waiting in readKey() get every key raw (^C still interrupts; ⌘ shortcuts pass).
   * 5. An active ^R search gets the key next (see searchKey()).
   * 6. Emacs-style Ctrl bindings: ^C interrupt (copies instead on Windows/Linux when text is
   *    selected), ^D EOF / exit / delete-char, ^L clear, ^A/^E line start/end, ^B/^F char
   *    left/right, ^U kill line, ^K kill to end, ^W kill word, ^P/^N history, ^R search, and
   *    ^Z is swallowed (there is no job control, and it would otherwise undo the input).
   * 7. ⌥←/⌥B and ⌥→/⌥F move by word (matched by physical key), ⌥⌫ deletes a word.
   * 8. Enter submits, Tab completes, ↑/↓ walk history, Escape is swallowed.
   * Everything else is left to the input element's native editing.
   *
   * @param {KeyInput} e - The key press.
   * @param {{ hasSelection?: boolean }} [opts={}] - `hasSelection` is true when terminal text is
   *   selected (lets Ctrl+C copy on Windows/Linux).
   * @returns {boolean} True when the key was consumed (the caller prevents the default action);
   *   false lets the hidden input handle it.
   *
   * @example
   * onKeyDown={(e) => { if (session.handleKey(e, { hasSelection })) e.preventDefault(); }}
   */
  handleKey(e: KeyInput, opts: { hasSelection?: boolean } = {}): boolean {
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const mod = isMacHost ? e.metaKey : e.ctrlKey;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(key)) return false;

    if (mod && !e.altKey && !e.shiftKey && lower === 'k') return false;

    if (mod && e.altKey && !e.shiftKey && (lower === 'k' || (isMacHost && !e.ctrlKey && e.code === 'KeyK'))) {
      this.clearScrollback();
      return true;
    }

    if (this.mode === 'running' && !this.lineWaiter && this.rawWaiters.size) {
      const data = encodeKey(e);
      return data !== null && this.deliverRaw(data);
    }

    if (this.mode === 'running' && !this.lineWaiter && this.keyWaiters.size) {
      if (e.ctrlKey && lower === 'c') {
        this.interrupt();
        return true;
      }
      if (e.metaKey) return false;
      for (const k of [...this.keyWaiters]) k(key);
      return true;
    }

    if (this.search && this.searchKey(e)) return true;

    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      switch (lower) {
        case 'c':
          if (!isMacHost && opts.hasSelection) return false;
          this.interrupt();
          return true;
        case 'd':
          if (this.lineWaiter) {
            if (this.input) this.submit();
            else this.lineWaiter(null);
            return true;
          }
          if (this.mode === 'idle' && !this.input && this.continuation === null) {
            this.buffer.write('\n');
            if (this.shell.confirmExit({ write: (s) => this.buffer.write(s), isTTY: true })) this.end();
            else this.showPrompt();
            return true;
          }
          if (this.cursor < this.input.length) this.setLine(this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1), this.cursor);
          return true;
        case 'l':
          this.buffer.clearScreen();
          this.emit(true);
          return true;
        case 'a':
          this.setCursor(0);
          return true;
        case 'e':
          this.setCursor(this.input.length);
          return true;
        case 'b':
          this.setCursor(this.cursor - 1);
          return true;
        case 'f':
          this.setCursor(this.cursor + 1);
          return true;
        case 'u':
          this.setLine('');
          return true;
        case 'k':
          this.setLine(this.input.slice(0, this.cursor), this.cursor);
          return true;
        case 'w': {
          const from = wordLeft(this.input, this.cursor);
          this.setLine(this.input.slice(0, from) + this.input.slice(this.cursor), from);
          return true;
        }
        case 'p':
          if (this.mode === 'idle') this.historyMove(-1);
          return true;
        case 'n':
          if (this.mode === 'idle') this.historyMove(1);
          return true;
        case 'z':
          return true;
        case 'r':
          if (this.mode === 'idle' && !this.search) {
            this.search = { query: '', index: this.shell.history.length, match: this.input, failing: false, original: this.input };
            this.emit(true);
          }
          return true;
      }
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (key === 'ArrowLeft' || e.code === 'KeyB') {
        this.setCursor(wordLeft(this.input, this.cursor));
        return true;
      }
      if (key === 'ArrowRight' || e.code === 'KeyF') {
        this.setCursor(wordRight(this.input, this.cursor));
        return true;
      }
      if (key === 'Backspace') {
        const from = wordLeft(this.input, this.cursor);
        this.setLine(this.input.slice(0, from) + this.input.slice(this.cursor), from);
        return true;
      }
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return false;

    switch (key) {
      case 'Enter':
        this.tabStreak = 0;
        this.submit();
        return true;
      case 'Tab':
        if (this.mode === 'idle' && !this.lineWaiter) this.tab();
        return true;
      case 'ArrowUp':
        if (this.mode === 'idle') this.historyMove(-1);
        return true;
      case 'ArrowDown':
        if (this.mode === 'idle') this.historyMove(1);
        return true;
      case 'Escape':
        return true;
    }
    this.tabStreak = 0;
    return false;
  }
}

/**
 * Schedule a callback for the next frame.
 *
 * Uses requestAnimationFrame when available and falls back to a 16 ms timer (jsdom, or
 * environments without rAF).
 *
 * @param {() => void} fn - Callback to run.
 * @returns {number} A handle accepted by cancelFrame().
 *
 * @example
 * const id = requestFrame(() => render());
 */
const requestFrame = (fn: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number));
/**
 * Cancel a callback scheduled with requestFrame().
 *
 * Uses cancelAnimationFrame when available and clearTimeout otherwise, mirroring the
 * scheduler requestFrame() picked.
 *
 * @param {number} id - Handle returned by requestFrame().
 * @returns {void}
 *
 * @example
 * cancelFrame(id);
 */
const cancelFrame = (id: number): void => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

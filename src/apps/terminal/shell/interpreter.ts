/**
 * The shell: variables, aliases, history, cwd and the executor for parsed scripts.
 *
 * Pipelines run stage by stage: each stage's stdout is collected and becomes the next stage's
 * stdin (enough for every command here, and it keeps cancellation simple). Redirections are
 * applied left to right, so `cmd > f 2>&1` and `cmd 2>&1 > f` behave like in zsh.
 */
import { FSError, HOME, HOSTNAME, USER, dirname, fs, getApp, resolve, wm } from '@/kernel';
import { ShellSyntaxError, type Incomplete } from './lexer';
import { parseSource, type AndOr, type Pipeline, type SimpleCommand } from './parser';
import { ExpansionError, expandSingle, expandWords, type ExpandContext } from './expand';
import { COMMAND_LIST, findCommand } from './commands';
import { nextShellPid } from './ttys';
import { fsErrorText, isExecutable, writeDenied } from './util';
import type { CommandContext, CommandDef, IO, Job, Output, ShellAPI, TerminalAPI } from './types';

/* ───────────────────────── Outputs ───────────────────────── */

/** Collects output in memory (pipes, command substitution, tests). */
export class BufferOutput implements Output {
  text = '';
  readonly isTTY = false;

  /**
   * Appends text to the buffer.
   *
   * The accumulated output is read back from the public `text` field.
   *
   * @param {string} s - The text to append.
   * @returns {void}
   *
   * @example
   * const out = new BufferOutput();
   * out.write('hi\n'); // out.text === 'hi\n'
   */
  write(s: string): void {
    this.text += s;
  }
}

export const NULL_OUTPUT: Output = {
  /**
   * Discards the text.
   *
   * The argument is ignored and nothing is stored, like writing to `/dev/null`.
   *
   * @returns {void}
   *
   * @example
   * NULL_OUTPUT.write('ignored');
   */
  write: () => {},
  isTTY: false,
}; /** Output that discards everything written to it (`> /dev/null`). */

/** `> file` / `>> file`: buffered, written to the virtual FS when the command finishes. */
class FileOutput implements Output {
  readonly isTTY = false;
  private buf = '';

  /**
   * Creates a buffered file output.
   *
   * Nothing touches the file until `close` is called.
   *
   * @param {string} path - Absolute path of the target file.
   * @param {boolean} append - Append to the file (`>>`) instead of replacing its content (`>`).
   * @returns {FileOutput} The new output.
   *
   * @example
   * const out = new FileOutput('/Users/guest/log.txt', true);
   */
  constructor(
    readonly path: string,
    private readonly append: boolean,
  ) {}

  /**
   * Buffers text for the file.
   *
   * The text stays in memory until `close` writes it to the virtual FS.
   *
   * @param {string} s - The text to write.
   * @returns {void}
   *
   * @example
   * out.write('line\n');
   */
  write(s: string): void {
    this.buf += s;
  }

  /**
   * Flushes the buffered text to the file and empties the buffer.
   *
   * Appends or overwrites depending on the redirection mode.
   *
   * @returns {void}
   * @throws {FSError} When the file cannot be written.
   *
   * @example
   * out.close();
   */
  close(): void {
    if (this.append) fs.appendFile(this.path, this.buf);
    else fs.writeFile(this.path, this.buf);
    this.buf = '';
  }
}

const HISTFILE = `${HOME}/.zsh_history`; /** Persistent history file in the user's home folder. */
const HISTSIZE = 1000; /** Maximum number of history entries kept in memory (also reported as SAVEHIST). */
const MAX_SOURCE_DEPTH = 32; /** Nesting limit for source / scripts / subshells (zsh's FUNCNEST-style guard against runaway recursion). */
const YIELD_EVERY = 200; /** Yield to the event loop every this many pipelines so ^C and rendering stay responsive. */
let commandsRun = 0; /** Pipelines started by all shells so far; drives the periodic yield in `runPipeline`. */

/**
 * Lets the event loop run before continuing.
 *
 * Resolves on a zero-delay timer, so pending rendering and input events are handled first.
 *
 * @returns {Promise<void>} Resolves on the next macrotask.
 *
 * @example
 * await yieldToEventLoop();
 */
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

const INCOMPLETE_MESSAGE: Record<Incomplete, string> = {
  quote: "zsh: unmatched '",
  dquote: 'zsh: unmatched "',
  bquote: 'zsh: unmatched `',
  cmdsubst: 'zsh: closing brace expected',
  braceparam: 'zsh: closing brace expected',
  backslash: 'zsh: parse error near `\\n\'',
  pipe: "zsh: parse error near `|'",
  cmdand: "zsh: parse error near `&&'",
  cmdor: "zsh: parse error near `||'",
}; /** zsh error text that `run` prints for each kind of construct still open at the end of the source. */

/** Options for creating a `Shell`. */
export interface ShellOptions {
  term: TerminalAPI;
  pid: number;
  /** Initial working directory; HOME when missing or not a directory. */
  cwd?: string;
  /** Interactive window shell: loads and saves ~/.zsh_history and can run background jobs. */
  interactive?: boolean;
  /** Initial (exported) environment; defaults to a fresh login environment. */
  env?: Record<string, string>;
}

/**
 * Rebuilds the command text of an and-or list for `jobs` and job notices.
 *
 * Each command is shown as its assignments and words in raw source form, commands are joined
 * with ` | `, negated pipelines get a `! ` prefix, and pipelines are joined with their `&&` /
 * `||` operators.
 *
 * @param {AndOr} andor - The parsed and-or list.
 * @returns {string} The command text, e.g. "sleep 5 && echo hi".
 *
 * @example
 * describeAndOr(parseSource('sleep 5 && echo hi').script![0]); // 'sleep 5 && echo hi'
 */
function describeAndOr(andor: AndOr): string {
  /**
   * Formats one pipeline as source text.
   *
   * Each command becomes its assignments and words in raw source form, separated by spaces;
   * a negated pipeline gets a `! ` prefix.
   *
   * @param {Pipeline} p - The pipeline.
   * @returns {string} The pipeline's commands joined with ` | `.
   *
   * @example
   * pipeline(andor.pipelines[0]); // 'ls -l | wc -l'
   */
  const pipeline = (p: Pipeline) => (p.negate ? '! ' : '') + p.commands.map((cmd) => [...cmd.assigns.map((a) => `${a.name}=${a.value.raw}`), ...cmd.words.map((w) => w.raw)].join(' ')).join(' | ');
  return andor.pipelines.map((p, i) => (i ? ` ${andor.ops[i - 1]} ` : '') + pipeline(p)).join('');
}

/**
 * Builds the terminal view given to a background job.
 *
 * The job sees the real window id, tty and screen size, but has no keyboard (reads resolve to
 * null, as if stdin were /dev/null) and cannot clear the screen, exit the window or take over the
 * screen.
 *
 * @param {TerminalAPI} term - The interactive shell's terminal.
 * @returns {TerminalAPI} A restricted terminal for the job.
 *
 * @example
 * const child = shell.fork(backgroundTerm(shell.term));
 */
function backgroundTerm(term: TerminalAPI): TerminalAPI {
  return {
    windowId: term.windowId,
    tty: term.tty,
    /**
     * Reports the real terminal size.
     *
     * Delegates to the interactive terminal, so $COLUMNS and $LINES stay correct in the job.
     *
     * @returns {{ cols: number; rows: number }} The current size in character cells.
     *
     * @example
     * const { cols } = bgTerm.size();
     */
    size: () => term.size(),
    /**
     * Ignores the request; background jobs cannot clear the screen.
     *
     * A no-op, so a job running `clear` leaves the foreground output intact.
     *
     * @returns {void}
     *
     * @example
     * bgTerm.clear();
     */
    clear: () => {},
    /**
     * Ignores the request; background jobs cannot clear the scrollback.
     *
     * A no-op, so the window's scrollback is never erased by a job.
     *
     * @returns {void}
     *
     * @example
     * bgTerm.clearScrollback();
     */
    clearScrollback: () => {},
    /**
     * Ignores the request; a background job cannot close the window.
     *
     * A no-op, so nothing a job runs can close the terminal window.
     *
     * @returns {void}
     *
     * @example
     * bgTerm.exit();
     */
    exit: () => {},
    /**
     * Reports end of input immediately.
     *
     * The job has no keyboard, so line reads behave as if stdin were `/dev/null`; the prompt and
     * options are ignored.
     *
     * @async
     * @returns {Promise<null>} Always null (EOF).
     *
     * @example
     * await bgTerm.readLine('> '); // null
     */
    readLine: async () => null,
    /**
     * Reports end of input immediately.
     *
     * The job has no keyboard, so key reads resolve at once without waiting for a key press.
     *
     * @async
     * @returns {Promise<null>} Always null (no key).
     *
     * @example
     * await bgTerm.readKey(); // null
     */
    readKey: async () => null,
    /**
     * Ignores the request; background jobs cannot use the alternate screen.
     *
     * A no-op, so full-screen programs started with `&` never take over the window.
     *
     * @returns {void}
     *
     * @example
     * bgTerm.altScreen(['frame']);
     */
    altScreen: () => {},
  };
}

/**
 * Returns the environment of a fresh login shell.
 *
 * Contains HOME, USER, LOGNAME, SHELL, PATH, terminal variables, CLICOLOR, LANG (from the
 * locale), TMPDIR and SHLVL.
 *
 * @param {'en' | 'ko'} [locale='en'] - Selects LANG (`en_US.UTF-8` or `ko_KR.UTF-8`).
 * @returns {Record<string, string>} The environment variables.
 *
 * @example
 * defaultEnvironment('ko').LANG; // 'ko_KR.UTF-8'
 */
export function defaultEnvironment(locale: 'en' | 'ko' = 'en'): Record<string, string> {
  return {
    HOME,
    USER,
    LOGNAME: USER,
    SHELL: '/bin/zsh',
    PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    TERM: 'xterm-256color',
    TERM_PROGRAM: 'Terminal',
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
    LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8',
    TMPDIR: '/tmp/',
    SHLVL: '1',
  };
}

/** A zsh-like shell instance: state plus the executor for parsed scripts. */
export class Shell implements ShellAPI {
  readonly pid: number;
  readonly startedAt = Date.now();
  readonly term: TerminalAPI;
  readonly interactive: boolean;
  cwd: string;
  status = 0;
  history: string[] = [];
  aliases = new Map<string, string>();
  positional: string[] = [];
  scriptName = 'zsh';
  sudoUntil = 0;
  exited = false;
  jobs: Job[] = [];
  /** pid of the most recent background job ($!). */
  private lastJobPid = 0;
  /** "you have running jobs." was shown and no job has started since. */
  private exitWarned = false;
  /** All shell variables by name, exported or not. */
  private vars = new Map<string, string>();
  /** Names of the exported variables. */
  private exported = new Set<string>();
  /** Nesting level: sourced files and child shells (scripts, $(…), zsh -c). */
  private depth = 0;

  /**
   * Creates a shell.
   *
   * Uses `opts.cwd` when it is an existing directory, otherwise HOME. Exports every variable of
   * `opts.env` (or the default login environment) plus PWD, and sets the zsh variables HOST,
   * ZSH_VERSION, PROMPT, HISTFILE, HISTSIZE and SAVEHIST. Interactive shells also load
   * ~/.zsh_history.
   *
   * @param {ShellOptions} opts - Terminal, pid, cwd, interactivity and environment.
   * @returns {Shell} The new shell.
   *
   * @example
   * const shell = new Shell({ term, pid: 501, interactive: true });
   */
  constructor(opts: ShellOptions) {
    this.term = opts.term;
    this.pid = opts.pid;
    this.interactive = opts.interactive ?? false;
    this.cwd = opts.cwd && fs.isDir(opts.cwd) ? opts.cwd : HOME;
    for (const [k, v] of Object.entries(opts.env ?? defaultEnvironment())) this.setVar(k, v, true);
    this.setVar('PWD', this.cwd, true);
    this.setVar('HOST', HOSTNAME);
    this.setVar('ZSH_VERSION', '5.9');
    this.setVar('PROMPT', '%n@%m %1~ %# ');
    this.setVar('HISTFILE', HISTFILE);
    this.setVar('HISTSIZE', String(HISTSIZE));
    this.setVar('SAVEHIST', String(HISTSIZE));
    if (this.interactive) this.loadHistory();
  }

  /* ───────────── Variables ───────────── */

  /**
   * Reads a shell variable or special parameter.
   *
   * Special parameters are computed on each read: `$?` status, `$$` pid, `$#` / `$@` / `$*`
   * positional arguments, `$0` script name, `$!` last background pid, `$-` option flags, and the
   * dynamic variables RANDOM, SECONDS, EPOCHSECONDS, COLUMNS, LINES and PPID. `$1`–`$9` come from
   * the positional arguments; everything else from the variable table.
   *
   * @param {string} name - The variable name without `$`.
   * @returns {string | undefined} The value, or undefined when unset.
   *
   * @example
   * shell.getVar('?'); // '0'
   */
  getVar(name: string): string | undefined {
    switch (name) {
      case '?':
        return String(this.status);
      case '$':
        return String(this.pid);
      case '#':
        return String(this.positional.length);
      case '@':
      case '*':
        return this.positional.join(' ');
      case '0':
        return this.scriptName;
      case '!':
        return this.lastJobPid ? String(this.lastJobPid) : '';
      case '-':
        return this.interactive ? '569JNRXZghiklms' : '569X';
      case 'RANDOM':
        return String(Math.floor(Math.random() * 32768));
      case 'SECONDS':
        return String(Math.floor((Date.now() - this.startedAt) / 1000));
      case 'EPOCHSECONDS':
        return String(Math.floor(Date.now() / 1000));
      case 'COLUMNS':
        return String(this.term.size().cols);
      case 'LINES':
        return String(this.term.size().rows);
      case 'PPID':
        return '1';
    }
    if (/^[1-9]$/.test(name)) return this.positional[Number(name) - 1];
    return this.vars.get(name);
  }

  /**
   * Sets a shell variable.
   *
   * Passing `exported` marks the variable for the environment; an already exported variable
   * stays exported when set without it.
   *
   * @param {string} name - The variable name.
   * @param {string} value - The new value.
   * @param {boolean} [exported=false] - Also export the variable.
   * @returns {void}
   *
   * @example
   * shell.setVar('EDITOR', 'vim', true);
   */
  setVar(name: string, value: string, exported = false): void {
    this.vars.set(name, value);
    if (exported) this.exported.add(name);
  }

  /**
   * Removes a variable and its export flag.
   *
   * Only the variable table is affected; special parameters such as `$?` cannot be unset.
   *
   * @param {string} name - The variable name.
   * @returns {void}
   *
   * @example
   * shell.unsetVar('EDITOR');
   */
  unsetVar(name: string): void {
    this.vars.delete(name);
    this.exported.delete(name);
  }

  /**
   * Tests whether a variable is exported.
   *
   * Checks the export set only; a name can be marked for export without having a value.
   *
   * @param {string} name - The variable name.
   * @returns {boolean} True when the name is marked for export.
   *
   * @example
   * shell.isExported('PATH'); // true
   */
  isExported(name: string): boolean {
    return this.exported.has(name);
  }

  /**
   * Returns the exported variables that currently have a value.
   *
   * Builds a fresh object on each call, skipping exported names whose variable is unset.
   *
   * @returns {Record<string, string>} The environment passed to commands and child shells.
   *
   * @example
   * shell.environment().HOME; // '/Users/guest'
   */
  environment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const k of this.exported) {
      const v = this.vars.get(k);
      if (v !== undefined) env[k] = v;
    }
    return env;
  }

  /**
   * Returns all shell variables, exported or not.
   *
   * Special parameters such as `$?` are not included.
   *
   * @returns {Record<string, string>} A snapshot of the variable table.
   *
   * @example
   * Object.keys(shell.variables()).includes('PROMPT'); // true
   */
  variables(): Record<string, string> {
    return Object.fromEntries(this.vars);
  }

  /**
   * Changes the working directory and updates PWD and OLDPWD.
   *
   * Does nothing when `path` is already the cwd. The path is not validated.
   *
   * @param {string} path - The new absolute working directory.
   * @returns {void}
   *
   * @example
   * shell.setCwd('/Users/guest/Documents');
   */
  setCwd(path: string): void {
    if (path === this.cwd) return;
    this.setVar('OLDPWD', this.cwd, true);
    this.cwd = path;
    this.setVar('PWD', path, true);
  }

  /* ───────────── History ───────────── */

  /**
   * Loads history entries from HISTFILE.
   *
   * Multi-line entries are stored with a trailing backslash on each continued line, so such
   * lines are joined with newlines into one entry. Blank entries are skipped and only the last
   * HISTSIZE entries are kept. Any read error leaves the history empty.
   *
   * @returns {void}
   *
   * @example
   * this.loadHistory();
   */
  private loadHistory(): void {
    try {
      if (!fs.exists(HISTFILE)) return;
      const entries: string[] = [];
      let acc: string | null = null;
      for (const line of fs.readFile(HISTFILE).split('\n')) {
        const cont = line.endsWith('\\');
        const text = cont ? line.slice(0, -1) : line;
        acc = acc === null ? text : `${acc}\n${text}`;
        if (!cont) {
          if (acc.trim()) entries.push(acc);
          acc = null;
        }
      }
      this.history = entries.slice(-HISTSIZE);
    } catch {
      this.history = [];
    }
  }

  /**
   * Records a line in the history.
   *
   * Blank lines and repeats of the previous entry are ignored, and memory is capped at HISTSIZE
   * entries. Interactive shells also persist the line to HISTFILE with embedded newlines written
   * as backslash-newline. The file is appended to until it exceeds 200,000 characters or twice
   * HISTSIZE lines, at which point it is rewritten from the in-memory history. Saving is best
   * effort: file errors (e.g. a missing home folder) are ignored.
   *
   * @param {string} line - The command line as entered.
   * @returns {void}
   *
   * @example
   * shell.addHistory('ls -la');
   */
  addHistory(line: string): void {
    if (!line.trim() || this.history[this.history.length - 1] === line) return;
    this.history.push(line);
    if (this.history.length > HISTSIZE) this.history.splice(0, this.history.length - HISTSIZE);
    if (!this.interactive) return;
    try {
      const stored = line.replace(/\n/g, '\\\n') + '\n';
      const existing = fs.exists(HISTFILE) ? fs.readFile(HISTFILE) : '';
      if (existing.length > 200_000 || existing.split('\n').length > HISTSIZE * 2) {
        fs.writeFile(HISTFILE, this.history.map((h) => h.replace(/\n/g, '\\\n')).join('\n') + '\n');
      } else fs.appendFile(HISTFILE, stored);
    } catch {
      /* best effort: history is not saved when the file cannot be written */
    }
  }

  /**
   * Clears the in-memory history and empties HISTFILE.
   *
   * File errors are ignored.
   *
   * @returns {void}
   *
   * @example
   * shell.clearHistory();
   */
  clearHistory(): void {
    this.history = [];
    try {
      if (fs.exists(HISTFILE)) fs.writeFile(HISTFILE, '');
    } catch {
      /* best effort: the in-memory history is already cleared */
    }
  }

  /* ───────────── Commands ───────────── */

  /**
   * Finds a command definition by name or alias name.
   *
   * Looks the name up in the command registry, which also indexes each command's built-in
   * alternative names; shell aliases defined with `alias` are not consulted.
   *
   * @param {string} name - The command name.
   * @returns {CommandDef | undefined} The definition, or undefined when there is none.
   *
   * @example
   * shell.lookup('ls')?.summary;
   */
  lookup(name: string): CommandDef | undefined {
    return findCommand(name);
  }

  /**
   * Returns every command definition.
   *
   * Returns the shared registry array itself, not a copy, so callers must not mutate it.
   *
   * @returns {CommandDef[]} The full command list.
   *
   * @example
   * shell.commands().length;
   */
  commands(): CommandDef[] {
    return COMMAND_LIST;
  }

  /**
   * Requests the shell to exit with a status after the current command.
   *
   * Sets the status and the `exited` flag; `run` and the and-or loop stop executing further
   * commands once it is set.
   *
   * @param {number} code - The exit status.
   * @returns {void}
   *
   * @example
   * shell.exit(0);
   */
  exit(code: number): void {
    this.status = code;
    this.exited = true;
  }

  /**
   * Decides whether an interactive shell may exit while background jobs are running.
   *
   * The first attempt with jobs running prints "zsh: you have running jobs." and returns false;
   * the next attempt (with no new job started in between) returns true. Non-interactive shells
   * and shells without jobs may always exit.
   *
   * @param {Output} stderr - Where the warning is written.
   * @returns {boolean} True when the shell may exit now.
   *
   * @example
   * if (ctx.shell.confirmExit(ctx.stderr)) ctx.shell.exit(0);
   */
  confirmExit(stderr: Output): boolean {
    if (!this.interactive || !this.jobs.length || this.exitWarned) return true;
    this.exitWarned = true;
    stderr.write('zsh: you have running jobs.\n');
    return false;
  }

  /**
   * Creates a child shell for scripts, subshells and jobs.
   *
   * The child is non-interactive, has the same pid and cwd, receives the exported environment
   * and copies of the non-exported variables, aliases, positional arguments, script name, status
   * and sudo timestamp, and is one nesting level deeper. History is not inherited, and changes in
   * the child never propagate back.
   *
   * @param {TerminalAPI} [term=this.term] - The terminal the child uses.
   * @returns {Shell} The child shell.
   *
   * @example
   * const sub = shell.fork();
   * await sub.run('cd /tmp', io, signal); // shell.cwd is unchanged
   */
  fork(term: TerminalAPI = this.term): Shell {
    const child = new Shell({ term, pid: this.pid, cwd: this.cwd, interactive: false, env: this.environment() });
    for (const [k, v] of this.vars) if (!this.exported.has(k)) child.vars.set(k, v);
    child.aliases = new Map(this.aliases);
    child.positional = [...this.positional];
    child.scriptName = this.scriptName;
    child.status = this.status;
    child.sudoUntil = this.sudoUntil;
    child.depth = this.depth + 1;
    return child;
  }

  /* ───────────── Execution ───────────── */

  /**
   * Tests whether `source` is a complete command.
   *
   * Parses with the current aliases without running anything.
   *
   * @param {string} source - The input typed so far.
   * @returns {Incomplete | null} The continuation kind when more input is needed, otherwise null.
   * @throws {ShellSyntaxError} When the input has a syntax error.
   *
   * @example
   * shell.check('echo "hi'); // 'dquote'
   */
  check(source: string): Incomplete | null {
    return parseSource(source, this.aliases).incomplete ?? null;
  }

  /**
   * Parses and executes source text in this shell.
   *
   * Syntax errors and unfinished input are reported on stderr with status 1. Each and-or list
   * runs in order until the signal aborts or the shell exits. A list ending in `&` starts a
   * background job when the shell is interactive and the terminal supports background output;
   * otherwise it runs in the foreground. An aborted run ends with status 130.
   *
   * @async
   * @param {string} source - The shell source to run.
   * @param {IO} io - Where stdout and stderr go.
   * @param {AbortSignal} signal - Aborts execution (^C).
   * @returns {Promise<number>} The final exit status (also stored in `status`).
   * @throws {Error} Errors that are neither syntax nor expansion errors and are not handled by
   *   the command runner, e.g. an FSError when a script file cannot be read.
   *
   * @example
   * const status = await shell.run('ls | wc -l', { stdout, stderr }, new AbortController().signal);
   */
  async run(source: string, io: IO, signal: AbortSignal): Promise<number> {
    let parsed;
    try {
      parsed = parseSource(source, this.aliases);
    } catch (e) {
      if (!(e instanceof ShellSyntaxError)) throw e;
      io.stderr.write(e.message + '\n');
      return (this.status = 1);
    }
    if (parsed.incomplete) {
      io.stderr.write(INCOMPLETE_MESSAGE[parsed.incomplete] + '\n');
      return (this.status = 1);
    }
    for (const andor of parsed.script) {
      if (signal.aborted || this.exited) break;
      if (andor.background && this.interactive && this.term.background) {
        this.startJob(andor, io);
        this.status = 0;
        continue;
      }
      const status = await this.runAndOr(andor, io, signal);
      if (!this.exited) this.status = status;
    }
    if (signal.aborted && !this.exited) this.status = 130;
    return this.status;
  }

  /**
   * Runs an and-or list with short-circuit evaluation.
   *
   * The pipeline after `&&` runs only when the previous status is 0, and after `||` only when it
   * is non-zero. Evaluation stops when the signal aborts or the shell exits.
   *
   * @async
   * @param {AndOr} andor - The and-or list.
   * @param {IO} io - Where stdout and stderr go.
   * @param {AbortSignal} signal - Aborts execution.
   * @returns {Promise<number>} The status of the last pipeline that ran.
   * @throws {Error} Errors propagated from `runPipeline`, e.g. an FSError when a script file
   *   cannot be read.
   *
   * @example
   * await this.runAndOr(script[0], io, signal);
   */
  private async runAndOr(andor: AndOr, io: IO, signal: AbortSignal): Promise<number> {
    let status = await this.runPipeline(andor.pipelines[0], io, signal);
    for (let k = 1; k < andor.pipelines.length && !signal.aborted && !this.exited; k++) {
      if (andor.ops[k - 1] === '&&' ? status === 0 : status !== 0) status = await this.runPipeline(andor.pipelines[k], io, signal);
    }
    return status;
  }

  /* ───────────── Jobs ───────────── */

  /**
   * Starts an and-or list as a background job (`cmd &`) without waiting for it.
   *
   * The list runs in a forked shell with a keyboard-less terminal, so `cd` or variables do not
   * leak back, as in zsh. The job gets the lowest free job number and a new pid, its output goes
   * to the terminal's background output, and "[1] 4321" is printed on stderr right away. When it
   * finishes it is removed from `jobs` and, unless it was brought to the foreground or killed
   * silently, a notice like "[1]  + done       cmd" is printed. Aborted jobs end with status 143
   * and errors thrown by the job are printed with status 1. Starting a job also resets the exit
   * warning.
   *
   * @param {AndOr} andor - The list to run in the background.
   * @param {IO} io - Where the "[id] pid" line is written.
   * @returns {void}
   *
   * @example
   * this.startJob(andor, io);
   */
  private startJob(andor: AndOr, io: IO): void {
    const out = this.term.background!();
    let id = 1;
    while (this.jobs.some((j) => j.id === id)) id++;
    const controller = new AbortController();
    const job: Job = { id, pid: nextShellPid(this.pid), command: describeAndOr(andor), startedAt: Date.now(), controller, promise: Promise.resolve(0), foreground: false };
    const child = this.fork(backgroundTerm(this.term));
    job.promise = child
      .runAndOr(andor, { stdout: out, stderr: out }, controller.signal)
      .catch((e: unknown) => {
        out.write(`zsh: ${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      })
      .then((code) => {
        const status = controller.signal.aborted ? 143 : code;
        this.jobs = this.jobs.filter((j) => j !== job);
        if (!job.foreground) {
          const state = controller.signal.aborted ? 'terminated' : status === 0 ? 'done' : `exit ${status}`;
          out.write(`[${id}]  + ${state.padEnd(10)} ${job.command}\n`);
        }
        return status;
      });
    this.jobs.push(job);
    this.lastJobPid = job.pid;
    this.exitWarned = false;
    io.stderr.write(`[${id}] ${job.pid}\n`);
  }

  /**
   * Stops every background job silently, e.g. when the window is closing.
   *
   * Marks each job as foreground so no completion notice is printed, aborts it, and clears the
   * job list.
   *
   * @returns {void}
   *
   * @example
   * shell.killJobs();
   */
  killJobs(): void {
    for (const j of this.jobs) {
      j.foreground = true;
      j.controller.abort();
    }
    this.jobs = [];
  }

  /**
   * Runs a pipeline stage by stage.
   *
   * Every stage but the last writes stdout to a buffer whose text becomes the next stage's stdin;
   * stderr goes straight to `io.stderr`. Because execution is promise-based, a long chain of
   * commands would otherwise run as one uninterrupted burst of microtasks, so every YIELD_EVERY
   * pipelines the event loop gets a turn to paint and deliver ^C. A leading `!` inverts the final
   * status.
   *
   * @async
   * @param {Pipeline} p - The pipeline to run.
   * @param {IO} io - Output for the last stage and stderr for all stages.
   * @param {AbortSignal} signal - Aborts execution.
   * @returns {Promise<number>} The last stage's status (inverted when negated), or 130 when aborted.
   * @throws {Error} Errors propagated from `runSimple`, e.g. an FSError when a script file
   *   cannot be read.
   *
   * @example
   * await this.runPipeline(andor.pipelines[0], io, signal);
   */
  private async runPipeline(p: Pipeline, io: IO, signal: AbortSignal): Promise<number> {
    if (++commandsRun % YIELD_EVERY === 0) await yieldToEventLoop();
    if (signal.aborted) return 130;
    let input: string | null = null;
    let status = 0;
    for (let i = 0; i < p.commands.length; i++) {
      const last = i === p.commands.length - 1;
      const pipe = last ? null : new BufferOutput();
      status = await this.runSimple(p.commands[i], pipe ? { stdout: pipe, stderr: io.stderr } : io, input, signal);
      if (signal.aborted) return 130;
      if (pipe) input = pipe.text;
    }
    return p.negate ? (status === 0 ? 1 : 0) : status;
  }

  /**
   * Builds the expansion context for one command.
   *
   * Variables are read from and written to this shell. Command substitutions run in a forked
   * shell with output captured in a buffer and stderr passed through; the substitution's status
   * becomes this shell's `$?`.
   *
   * @param {IO} io - Supplies stderr for command substitutions.
   * @param {AbortSignal} signal - Aborts command substitutions.
   * @returns {ExpandContext} The context for `expandWords` / `expandSingle`.
   *
   * @example
   * const argv = await expandWords(cmd.words, this.expandContext(io, signal));
   */
  private expandContext(io: IO, signal: AbortSignal): ExpandContext {
    return {
      cwd: this.cwd,
      home: HOME,
      /**
       * Reads a variable from this shell.
       *
       * Delegates to `Shell.getVar`, so special parameters such as `$?` and `$RANDOM` work too.
       *
       * @param {string} n - The variable name.
       * @returns {string | undefined} The value, or undefined when unset.
       *
       * @example
       * ctx.getVar('HOME');
       */
      getVar: (n) => this.getVar(n),
      /**
       * Sets a variable in this shell (for `${VAR:=word}`).
       *
       * Delegates to `Shell.setVar` without the export flag, so an already exported variable
       * stays exported and a new one is not exported.
       *
       * @param {string} n - The variable name.
       * @param {string} v - The value.
       * @returns {void}
       *
       * @example
       * ctx.setVar('X', '1');
       */
      setVar: (n, v) => this.setVar(n, v),
      /**
       * Runs a command substitution in a child shell and captures its stdout.
       *
       * The source runs in a fork of this shell, so variable and cwd changes stay in the child.
       * Its stdout is collected in a buffer, its stderr goes to the command's stderr, and its
       * exit status becomes this shell's `$?`.
       *
       * @async
       * @param {string} src - The command source inside `$(…)` or backticks.
       * @returns {Promise<string>} Everything the commands wrote to stdout.
       * @throws {Error} Errors that escape the child shell's `run`, e.g. an FSError when a
       *   script file cannot be read.
       *
       * @example
       * await ctx.commandSubst('date');
       */
      commandSubst: async (src) => {
        const out = new BufferOutput();
        const sub = this.fork();
        await sub.run(src, { stdout: out, stderr: io.stderr }, signal);
        this.status = sub.status;
        return out.text;
      },
    };
  }

  /**
   * Opens the target of an output redirection.
   *
   * `/dev/null` discards output, `/dev/stdout` and `/dev/tty` map to the current stdout and
   * `/dev/stderr` to the current stderr. Other targets are resolved against the cwd and checked:
   * directories, missing parent folders, read-only or protected parents and locked files produce
   * an error message. Like a real shell, `>` truncates the file and `>>` creates it before the
   * command runs.
   *
   * @param {string} target - The expanded redirection target.
   * @param {boolean} append - `>>` instead of `>`.
   * @param {IO} io - The current stdout / stderr, for the device paths.
   * @returns {Output | string} The output to write to, or an error message.
   *
   * @example
   * const out = this.openOutput('log.txt', true, io);
   * if (typeof out === 'string') io.stderr.write(out + '\n');
   */
  private openOutput(target: string, append: boolean, io: IO): Output | string {
    if (target === '/dev/null') return NULL_OUTPUT;
    if (target === '/dev/stdout' || target === '/dev/tty') return io.stdout;
    if (target === '/dev/stderr') return io.stderr;
    const path = resolve(this.cwd, target);
    const node = fs.stat(path);
    const parent = dirname(path);
    if (node?.type === 'dir') return `zsh: is a directory: ${target}`;
    if (!fs.isDir(parent)) return `zsh: no such file or directory: ${target}`;
    const denied = writeDenied(parent);
    if (denied) return `zsh: ${denied.toLowerCase()}: ${target}`;
    if (node?.meta?.locked) return `zsh: permission denied: ${target}`;
    try {
      if (!append) fs.writeFile(path, '');
      else if (!node) fs.writeFile(path, '');
    } catch (e) {
      return e instanceof FSError && e.code === 'EPERM' ? `zsh: permission denied: ${target}` : `zsh: no such file or directory: ${target}`;
    }
    return new FileOutput(path, append);
  }

  /**
   * Expands and runs one simple command with its redirections.
   *
   * Expands assignment values and words first (expansion errors print and return 1). Then the
   * redirections are applied left to right: `2>&1` / `1>&2` point one stream at the other's
   * current target, `<` reads a file (or `/dev/null`) as stdin, and output redirections open
   * files via `openOutput` (`&>` sets both streams). A failing redirection prints its error and
   * returns 1. Without words, the assignments set shell variables (keeping their export state);
   * otherwise they become the command's extra environment. File outputs are flushed when the
   * command finishes or a later redirection fails.
   *
   * @async
   * @param {SimpleCommand} cmd - The parsed command.
   * @param {IO} io - The command's default stdout / stderr.
   * @param {string | null} stdin - Input from the previous pipeline stage, or null.
   * @param {AbortSignal} signal - Aborts execution.
   * @returns {Promise<number>} The command's exit status.
   * @throws {Error} Non-expansion errors from expansion (such as a failing command
   *   substitution) or from `runArgv`, e.g. an FSError when a script file cannot be read.
   *
   * @example
   * await this.runSimple(p.commands[0], io, null, signal);
   */
  private async runSimple(cmd: SimpleCommand, io: IO, stdin: string | null, signal: AbortSignal): Promise<number> {
    const ectx = this.expandContext(io, signal);
    const assigns: [string, string][] = [];
    let argv: string[];
    try {
      for (const a of cmd.assigns) assigns.push([a.name, await expandSingle(a.value, ectx)]);
      argv = await expandWords(cmd.words, ectx);
    } catch (e) {
      if (!(e instanceof ExpansionError)) throw e;
      io.stderr.write(e.message + '\n');
      return 1;
    }

    let stdout = io.stdout;
    let stderr = io.stderr;
    let input = stdin;
    const files: FileOutput[] = [];
    /**
     * Flushes and closes every file opened by this command's redirections.
     *
     * Write errors are reported on stderr instead of being thrown.
     *
     * @returns {void}
     *
     * @example
     * closeFiles();
     */
    const closeFiles = () => {
      for (const f of files) {
        try {
          f.close();
        } catch (e) {
          io.stderr.write(`zsh: ${e instanceof Error ? e.message : String(e)}\n`);
        }
      }
    };

    for (const r of cmd.redirects) {
      if (r.mode === 'dup') {
        if (r.fd === 2 && r.dupTo === 1) stderr = stdout;
        else if (r.fd === 1 && r.dupTo === 2) stdout = stderr;
        continue;
      }
      let target: string;
      try {
        target = await expandSingle(r.target!, ectx);
      } catch (e) {
        if (!(e instanceof ExpansionError)) throw e;
        io.stderr.write(e.message + '\n');
        closeFiles();
        return 1;
      }
      if (r.mode === 'read') {
        if (target === '/dev/null') {
          input = '';
          continue;
        }
        const node = fs.stat(resolve(this.cwd, target));
        if (!node) {
          io.stderr.write(`zsh: no such file or directory: ${target}\n`);
          closeFiles();
          return 1;
        }
        if (node.type === 'dir') {
          io.stderr.write(`zsh: is a directory: ${target}\n`);
          closeFiles();
          return 1;
        }
        input = node.content ?? '';
        continue;
      }
      const out = this.openOutput(target, r.mode === 'append', { stdout, stderr });
      if (typeof out === 'string') {
        io.stderr.write(out + '\n');
        closeFiles();
        return 1;
      }
      if (out instanceof FileOutput) files.push(out);
      if (r.fd === 1) stdout = out;
      else if (r.fd === 2) stderr = out;
      else stdout = stderr = out;
    }

    try {
      if (!argv.length) {
        for (const [k, v] of assigns) this.setVar(k, v, this.exported.has(k));
        return 0;
      }
      return await this.runArgv(argv, { stdout, stderr }, signal, { stdin: input, env: Object.fromEntries(assigns) });
    } finally {
      closeFiles();
    }
  }

  /**
   * Executes an already-expanded argv.
   *
   * A known command name runs that command. A name containing `/` runs the built-in command
   * installed at exactly that path (as `which` reports it, e.g. `/bin/ls`), or otherwise the file
   * at that path via `execPath`. Anything else prints "command not found" with status 127.
   *
   * @async
   * @param {string[]} argv - The command name followed by its arguments.
   * @param {IO} io - Where stdout and stderr go.
   * @param {AbortSignal} signal - Aborts execution.
   * @param {{ stdin?: string | null; sudo?: boolean; env?: Record<string, string> }} [opts={}] -
   *   Input text, whether to run as root, and extra environment variables.
   * @returns {Promise<number>} The exit status.
   * @throws {FSError} When a script file found by path cannot be read.
   *
   * @example
   * await shell.runArgv(['ls', '-l'], io, signal, { sudo: true });
   */
  async runArgv(argv: string[], io: IO, signal: AbortSignal, opts: { stdin?: string | null; sudo?: boolean; env?: Record<string, string> } = {}): Promise<number> {
    const [name, ...args] = argv;
    const def = this.lookup(name);
    if (def) return this.invoke(def, name, args, io, signal, opts);
    if (name.includes('/')) {
      const abs = resolve(this.cwd, name);
      const base = abs.slice(abs.lastIndexOf('/') + 1);
      const installed = this.lookup(base);
      if (installed && `${installed.path ?? '/bin'}/${base}` === abs) return this.invoke(installed, base, args, io, signal, opts);
      return this.execPath(name, args, io, signal);
    }
    io.stderr.write(`zsh: command not found: ${name}\n`);
    return 127;
  }

  /**
   * Runs a command definition with a freshly built `CommandContext`.
   *
   * The environment is the exported variables plus `opts.env`; under sudo USER, LOGNAME and HOME
   * are switched to root and SUDO_USER is set. Errors thrown by the command are printed as
   * "name: message" (file system errors as "name: path: reason") with status 1, and an aborted
   * command returns 130.
   *
   * @async
   * @param {CommandDef} def - The command to run.
   * @param {string} name - argv[0] as typed.
   * @param {string[]} args - The expanded arguments.
   * @param {IO} io - Where stdout and stderr go.
   * @param {AbortSignal} signal - Aborts the command.
   * @param {{ stdin?: string | null; sudo?: boolean; env?: Record<string, string> }} opts - Input
   *   text, sudo flag and extra environment.
   * @returns {Promise<number>} The command's exit status.
   *
   * @example
   * await this.invoke(def, 'ls', ['-l'], io, signal, {});
   */
  private async invoke(def: CommandDef, name: string, args: string[], io: IO, signal: AbortSignal, opts: { stdin?: string | null; sudo?: boolean; env?: Record<string, string> }): Promise<number> {
    const root: Record<string, string> = opts.sudo ? { USER: 'root', LOGNAME: 'root', HOME: '/var/root', SUDO_USER: USER } : {};
    const ctx: CommandContext = {
      name,
      args,
      stdin: opts.stdin ?? null,
      stdout: io.stdout,
      stderr: io.stderr,
      cwd: this.cwd,
      env: { ...this.environment(), ...opts.env, ...root },
      fs,
      shell: this,
      term: this.term,
      signal,
      sudo: !!opts.sudo,
      /**
       * Changes the shell's working directory.
       *
       * Delegates to `Shell.setCwd`, which also updates PWD and OLDPWD; the path is not
       * validated here.
       *
       * @param {string} p - The new absolute working directory.
       * @returns {void}
       *
       * @example
       * ctx.setCwd('/tmp');
       */
      setCwd: (p) => this.setCwd(p),
      /**
       * Resolves a path argument against the shell's cwd.
       *
       * Reads `this.cwd` at call time, so it follows a `setCwd` made earlier by the same command.
       *
       * @param {string} p - The path as given.
       * @returns {string} The absolute path.
       *
       * @example
       * ctx.resolve('notes.txt'); // '/Users/guest/notes.txt'
       */
      resolve: (p) => resolve(this.cwd, p),
      /**
       * Writes a line to stdout.
       *
       * Appends a newline to the text and writes it to the command's (possibly redirected)
       * stdout.
       *
       * @param {string} [text=''] - The text to print before the newline.
       * @returns {void}
       *
       * @example
       * ctx.print('done');
       */
      print: (text = '') => io.stdout.write(text + '\n'),
      /**
       * Writes "name: message" to stderr.
       *
       * Prefixes the message with the command name as typed (argv[0]) and ends it with a
       * newline; the exit status is left to the command.
       *
       * @param {string} msg - The error message.
       * @returns {void}
       *
       * @example
       * ctx.error('missing operand');
       */
      error: (msg) => io.stderr.write(`${name}: ${msg}\n`),
    };
    try {
      const code = await def.run(ctx);
      return signal.aborted ? 130 : code;
    } catch (e) {
      if (signal.aborted) return 130;
      if (e instanceof FSError) io.stderr.write(`${name}: ${e.path}: ${fsErrorText(e)}\n`);
      else io.stderr.write(`${name}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }

  /**
   * Runs a file given by path, such as `./script.sh` or `/Applications/Safari.app`.
   *
   * A missing file returns 127. An `.app` file opens its application through the window manager
   * (when its content names a registered app) and returns 0. Directories and non-executable
   * files return 126 "permission denied"; executable files run as scripts.
   *
   * @async
   * @param {string} name - The path as typed.
   * @param {string[]} args - The script's positional arguments.
   * @param {IO} io - Where stdout and stderr go.
   * @param {AbortSignal} signal - Aborts execution.
   * @returns {Promise<number>} The exit status.
   * @throws {FSError} When the script file cannot be read.
   *
   * @example
   * await this.execPath('./build.sh', ['--fast'], io, signal);
   */
  private async execPath(name: string, args: string[], io: IO, signal: AbortSignal): Promise<number> {
    const path = resolve(this.cwd, name);
    const node = fs.stat(path);
    if (!node) {
      io.stderr.write(`zsh: no such file or directory: ${name}\n`);
      return 127;
    }
    if (node.type === 'file' && node.name.toLowerCase().endsWith('.app')) {
      const app = getApp((node.content ?? '').trim());
      if (app) wm.openPath(path);
      return 0;
    }
    if (node.type === 'dir' || !isExecutable(node)) {
      io.stderr.write(`zsh: permission denied: ${name}\n`);
      return 126;
    }
    return this.runScript(path, args, io, signal);
  }

  /**
   * Runs a script file in a child shell.
   *
   * The child gets the arguments as `$1…`, the path as `$0` and no aliases. Fails with status 1
   * once the nesting limit (MAX_SOURCE_DEPTH) is reached.
   *
   * @async
   * @param {string} path - Absolute path of the script.
   * @param {string[]} args - Positional arguments.
   * @param {IO} io - Where stdout and stderr go.
   * @param {AbortSignal} signal - Aborts execution.
   * @returns {Promise<number>} The script's exit status.
   * @throws {FSError} When the file cannot be read.
   *
   * @example
   * await shell.runScript('/Users/guest/hello.sh', ['world'], io, signal);
   */
  async runScript(path: string, args: string[], io: IO, signal: AbortSignal): Promise<number> {
    if (this.depth >= MAX_SOURCE_DEPTH) {
      io.stderr.write('zsh: maximum nested function level reached\n');
      return 1;
    }
    const child = this.fork();
    child.positional = args;
    child.scriptName = path;
    child.aliases = new Map();
    return child.run(fs.readFile(path), io, signal);
  }

  /**
   * Runs a file in this shell (`source` / `.`).
   *
   * Variables, aliases and cwd changes made by the file stay in this shell. While it runs, `$0`
   * is the file path and, when `args` is non-empty, the positional arguments are replaced; both
   * are restored afterwards. Fails with status 1 once the nesting limit is reached.
   *
   * @async
   * @param {string} path - Absolute path of the file.
   * @param {string[]} args - Positional arguments (empty keeps the current ones).
   * @param {IO} io - Where stdout and stderr go.
   * @param {AbortSignal} signal - Aborts execution.
   * @returns {Promise<number>} The exit status of the file's last command.
   * @throws {FSError} When the file cannot be read.
   *
   * @example
   * await shell.source('/Users/guest/.zshrc', [], io, signal);
   */
  async source(path: string, args: string[], io: IO, signal: AbortSignal): Promise<number> {
    if (this.depth >= MAX_SOURCE_DEPTH) {
      io.stderr.write('zsh: maximum nested function level reached\n');
      return 1;
    }
    const saved = { positional: this.positional, scriptName: this.scriptName };
    this.depth++;
    if (args.length) this.positional = args;
    this.scriptName = path;
    try {
      return await this.run(fs.readFile(path), io, signal);
    } finally {
      this.depth--;
      this.positional = saved.positional;
      this.scriptName = saved.scriptName;
    }
  }
}

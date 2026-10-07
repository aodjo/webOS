import type { LString } from '@/kernel';
import type { fs } from '@/kernel';

/** Where a command writes. The terminal is a TTY; pipes, files and captures are not. */
export interface Output {
  write(text: string): void;
  readonly isTTY: boolean;
}

/** Capabilities the terminal window gives to the shell and its commands. */
export interface TerminalAPI {
  /** Current size in character cells. */
  size(): { cols: number; rows: number };
  /** Clear the visible screen (scrollback above is kept, like Terminal.app). */
  clear(): void;
  /** Clear the screen and the scrollback (⌥⌘K). */
  clearScrollback(): void;
  /** Close the terminal window (the interactive shell exited). */
  exit(): void;
  /**
   * Read one line typed by the user (the prompt is printed first). Resolves null on EOF (^D)
   * or when `signal` aborts (^C).
   */
  readLine(prompt: string, opts?: { secret?: boolean; signal?: AbortSignal }): Promise<string | null>;
  /** Wait for a single key press. Resolves null when aborted. */
  readKey(signal?: AbortSignal): Promise<string | null>;
  /**
   * Wait for raw terminal input: the bytes a key press sends (control characters, escape
   * sequences) or pasted text, for programs that talk to a remote system. ^C is delivered
   * instead of interrupting. Resolves null when aborted. Terminals without raw input omit it.
   */
  readRaw?(signal?: AbortSignal): Promise<string | null>;
  /** Show a full-screen frame (alternate screen buffer); null returns to the normal screen. */
  altScreen(frame: string[] | null): void;
  /**
   * Output for background jobs (`cmd &`). It is never cut off by a later command, and while the
   * prompt is shown it is printed above it. Terminals without one run `&` lists in the foreground.
   */
  background?(): Output;
  /** Terminal window hosting the shell, or null when it has none. */
  readonly windowId: string | null;
  /** Device name, e.g. "ttys000". */
  readonly tty: string;
}

/** The output streams a command or script writes to. */
export interface IO {
  stdout: Output;
  stderr: Output;
}

/** Category a command is listed under in `help`. */
export type CommandGroup = 'files' | 'text' | 'system' | 'apps' | 'network' | 'portfolio' | 'fun' | 'shell';

/** A background job started with `&`. */
export interface Job {
  /** Job number (%1, %2…). */
  id: number;
  pid: number;
  command: string;
  startedAt: number;
  controller: AbortController;
  /** Resolves with the exit status once the job has finished. */
  promise: Promise<number>;
  /** Brought to the foreground by `fg`: no completion notice is printed. */
  foreground: boolean;
}

/** The subset of the interpreter commands may use (keeps commands decoupled from Shell). */
export interface ShellAPI {
  readonly pid: number;
  readonly startedAt: number;
  readonly term: TerminalAPI;
  cwd: string;
  status: number;
  history: string[];
  aliases: Map<string, string>;
  /** Running background jobs, oldest first. */
  jobs: Job[];
  /** Unix time until which sudo does not ask for a password again. */
  sudoUntil: number;
  /** True for the interactive shell of a window (false for scripts / subshells). */
  readonly interactive: boolean;
  getVar(name: string): string | undefined;
  setVar(name: string, value: string, exported?: boolean): void;
  unsetVar(name: string): void;
  isExported(name: string): boolean;
  /** Exported variables (the environment of child commands). */
  environment(): Record<string, string>;
  /** All shell variables. */
  variables(): Record<string, string>;
  setCwd(path: string): void;
  /** Parse & execute source text in this shell. */
  run(source: string, io: IO, signal: AbortSignal): Promise<number>;
  /** Execute an already-expanded argv (used by sudo, env, command…). */
  runArgv(argv: string[], io: IO, signal: AbortSignal, opts?: { stdin?: string | null; sudo?: boolean; env?: Record<string, string> }): Promise<number>;
  /** A child shell (inherits variables and cwd; changes don't propagate back). */
  fork(): ShellAPI;
  /** Run a script file in a child shell. */
  runScript(path: string, args: string[], io: IO, signal: AbortSignal): Promise<number>;
  /** Run a file in this shell (`source`). */
  source(path: string, args: string[], io: IO, signal: AbortSignal): Promise<number>;
  lookup(name: string): CommandDef | undefined;
  commands(): CommandDef[];
  /** Request the shell to exit after the current command. */
  exit(code: number): void;
  /**
   * zsh's guard against losing background jobs: the first attempt to leave an interactive shell
   * with jobs running prints "you have running jobs." and returns false; the next one returns true.
   */
  confirmExit(stderr: Output): boolean;
  /** Record a line in history (memory + ~/.zsh_history). */
  addHistory(line: string): void;
  clearHistory(): void;
}

/** Everything a command receives when it runs. */
export interface CommandContext {
  /** argv[0] as typed. */
  name: string;
  /** Arguments after the command name (already expanded). */
  args: string[];
  /** Piped / redirected input, or null when reading from the terminal. */
  stdin: string | null;
  stdout: Output;
  stderr: Output;
  cwd: string;
  /** Environment (exported variables + per-command assignments). */
  env: Record<string, string>;
  fs: typeof fs;
  shell: ShellAPI;
  term: TerminalAPI;
  signal: AbortSignal;
  /** Running under sudo (as root). */
  sudo: boolean;
  setCwd(path: string): void;
  /** Resolve a path argument against the cwd (handles "~"). */
  resolve(path: string): string;
  /** Write a line to stdout. */
  print(text?: string): void;
  /** Write "<name>: <message>" to stderr. */
  error(message: string): void;
}

/** A command the shell can run: its metadata for `help`, `man` and `which`, and its implementation. */
export interface CommandDef {
  /** Primary command name. */
  name: string;
  /** Extra names that run the same command (e.g. vi → vim). */
  aliases?: string[];
  /** zsh builtins report "shell built-in command" in `which`; others live in `path`. */
  builtin?: boolean;
  /** Install directory shown by `which` (default /bin). */
  path?: string;
  group: CommandGroup;
  /** One-line description shown by `help` and `man`. */
  summary: LString;
  /** Synopsis for `man` / usage errors. */
  usage?: string;
  /** Longer description for `man`. */
  description?: LString;
  /** Option flags and their descriptions for `man`. */
  options?: [flag: string, text: LString][];
  /** Not listed in `help`. */
  hidden?: boolean;
  /** Execute the command and return its exit status. */
  run(ctx: CommandContext): number | Promise<number>;
  /** Candidates for completing the argument at `index` (null = complete paths). */
  complete?: (index: number, args: string[]) => string[] | null;
}

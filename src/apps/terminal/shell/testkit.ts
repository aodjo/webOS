/** Test helpers: a tiny seeded file system, a fake terminal and a runner. Only imported by *.test.ts. */
import { HOME, useFS, type FSNode } from '@/kernel';
import { BufferOutput, Shell } from './interpreter';
import type { TerminalAPI } from './types';

const T0 = Date.UTC(2026, 0, 15, 9, 0, 0); /** Fixed creation/modification timestamp given to every seeded node, so date output is deterministic. */

/**
 * Replace the virtual file system with a small, deterministic fixture tree.
 *
 * Builds the node map directly (bypassing `fs.*`) and writes it into the FS store with
 * `hydrated: true`. The tree contains locked system folders (/Applications, /System, /etc,
 * /tmp, /bin, /Users), the home folder with Desktop, Documents, Downloads, Documents/Projects and
 * .Trash, and a handful of text files (.zshrc with an alias and an export, notes.txt, a few
 * Markdown files) plus one image node. Every node uses the timestamp `T0`.
 *
 * @returns {void} Nothing; the FS store is overwritten in place.
 *
 * @example
 * beforeEach(seedFS);
 * glob('*.md', `${HOME}/Documents`); // ['a.md', 'b.md']
 */
export function seedFS(): void {
  const nodes: Record<string, FSNode> = {};
  /**
   * Last path component of an absolute path.
   *
   * Returns "/" for the root itself; otherwise the text after the final slash.
   *
   * @param {string} p - Absolute path.
   * @returns {string} The node name.
   *
   * @example
   * name('/etc/motd'); // 'motd'
   */
  const name = (p: string) => (p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1));
  /**
   * Add a directory node to the fixture map.
   *
   * Locked directories get `meta: { locked: true }`, which marks them as system-owned.
   *
   * @param {string} p - Absolute path of the directory.
   * @param {boolean} [locked=false] - Whether the directory is a locked system folder.
   * @returns {void}
   *
   * @example
   * dir('/etc', true);
   */
  const dir = (p: string, locked = false) => {
    nodes[p] = { path: p, name: name(p), type: 'dir', createdAt: T0, modifiedAt: T0, meta: locked ? { locked: true } : undefined };
  };
  /**
   * Add a file node to the fixture map.
   *
   * Extra node fields (such as `meta`, `src` or `bytes`) are spread over the defaults.
   *
   * @param {string} p - Absolute path of the file.
   * @param {string} content - Text content of the file.
   * @param {Partial<FSNode>} [extra={}] - Additional node fields to merge in.
   * @returns {void}
   *
   * @example
   * file('/etc/motd', 'Welcome!\n');
   */
  const file = (p: string, content: string, extra: Partial<FSNode> = {}) => {
    nodes[p] = { path: p, name: name(p), type: 'file', content, createdAt: T0, modifiedAt: T0, ...extra };
  };
  dir('/');
  for (const p of ['/Applications', '/System', '/etc', '/tmp', '/bin', '/Users']) dir(p, true);
  dir(HOME);
  for (const p of ['Desktop', 'Documents', 'Downloads', 'Documents/Projects', '.Trash']) dir(`${HOME}/${p}`);
  file('/etc/motd', 'Welcome!\n');
  file('/Applications/Safari.app', 'safari', { meta: { locked: true } });
  file(`${HOME}/.zshrc`, 'alias ll="ls -la"\nexport GREETING=hello\n');
  file(`${HOME}/notes.txt`, 'apple\nbanana\ncherry\nbanana\n');
  file(`${HOME}/Documents/a.md`, '# A\nhello world\n');
  file(`${HOME}/Documents/b.md`, 'Hello again\nbye\n');
  file(`${HOME}/Documents/c.txt`, 'plain\n');
  file(`${HOME}/Documents/Projects/README.md`, '# Projects\n');
  file(`${HOME}/Desktop/photo.png`, '', { src: '/x.png', bytes: 2048 });
  useFS.setState({ nodes, hydrated: true });
}

/** A scriptable in-memory terminal that records what the shell asked it to do. */
export interface FakeTerm extends TerminalAPI {
  /** Number of times `clear()` was called. */
  cleared: number;
  /** Set once `exit()` was called. */
  exited: boolean;
  /** Lines returned by readLine, in order (null = EOF). */
  input: (string | null)[];
}

/**
 * Create a fake 80×24 terminal for driving the shell in tests.
 *
 * `readLine` pops queued lines from `input` and resolves null (EOF) once the queue is empty;
 * `readKey` always resolves null. `clear()` increments `cleared` and `exit()` sets `exited`, so
 * tests can assert on them. The terminal reports tty "ttys000" and no window.
 *
 * @returns {FakeTerm} A fresh fake terminal.
 *
 * @example
 * const term = fakeTerm();
 * term.input.push('y');
 * const sh = newShell(term);
 */
export function fakeTerm(): FakeTerm {
  const term: FakeTerm = {
    cleared: 0,
    exited: false,
    input: [],
    /**
     * Report the fixed terminal size.
     *
     * Returns a new object on every call, so layout code sees a constant 80×24 screen.
     *
     * @returns {{ cols: number, rows: number }} Always 80 columns by 24 rows.
     *
     * @example
     * term.size(); // { cols: 80, rows: 24 }
     */
    size: () => ({ cols: 80, rows: 24 }),
    /**
     * Record a screen clear.
     *
     * Increments `cleared` instead of touching any screen, so tests can count clears.
     *
     * @returns {void}
     *
     * @example
     * term.clear(); // term.cleared === 1
     */
    clear() {
      term.cleared++;
    },
    /**
     * Ignore a scrollback clear.
     *
     * The fake terminal keeps no scrollback, so this does nothing.
     *
     * @returns {void}
     *
     * @example
     * term.clearScrollback();
     */
    clearScrollback() {},
    /**
     * Record that the shell closed the terminal.
     *
     * Sets `exited` to true; the fake terminal itself stays usable.
     *
     * @returns {void}
     *
     * @example
     * term.exit(); // term.exited === true
     */
    exit() {
      term.exited = true;
    },
    /**
     * Return the next queued input line.
     *
     * The prompt and options are ignored; the first entry of `input` is removed and returned,
     * or null (EOF) when the queue is empty.
     *
     * @async
     * @returns {Promise<string | null>} The next line, or null at EOF.
     *
     * @example
     * term.input.push('yes');
     * await term.readLine('> '); // 'yes'
     */
    readLine: async () => (term.input.length ? term.input.shift()! : null),
    /**
     * Report that no key was pressed.
     *
     * Ignores the abort signal and resolves immediately, so commands waiting for a key never
     * block in tests.
     *
     * @async
     * @returns {Promise<null>} Always null, as if the read was aborted.
     *
     * @example
     * await term.readKey(); // null
     */
    readKey: async () => null,
    /**
     * Ignore alternate-screen frames.
     *
     * Full-screen output is discarded; tests inspect stdout instead.
     *
     * @returns {void}
     *
     * @example
     * term.altScreen(['frame']);
     */
    altScreen() {},
    windowId: null,
    tty: 'ttys000',
  };
  return term;
}

/**
 * Create a non-interactive shell for tests.
 *
 * The shell runs with pid 4242 and does not load history from disk, since it is not interactive.
 *
 * @param {TerminalAPI} [term=fakeTerm()] - Terminal the shell talks to.
 * @returns {Shell} A new shell starting in the home folder.
 *
 * @example
 * const sh = newShell();
 * await run(sh, 'echo hi');
 */
export function newShell(term: TerminalAPI = fakeTerm()): Shell {
  return new Shell({ term, pid: 4242, interactive: false });
}

/**
 * Run source text in a shell and capture its output.
 *
 * stdout and stderr are collected into separate in-memory buffers, and the command runs with a
 * signal that is never aborted.
 *
 * @async
 * @param {Shell} sh - Shell to run the source in (its variables and cwd persist between runs).
 * @param {string} source - Shell source text, e.g. a command line or a short script.
 * @returns {Promise<{ out: string, err: string, status: number }>} Captured stdout, stderr and the exit status.
 *
 * @example
 * const { out, status } = await run(newShell(), 'echo hello');
 * console.log(out, status); // 'hello\n' 0
 */
export async function run(sh: Shell, source: string): Promise<{ out: string; err: string; status: number }> {
  const out = new BufferOutput();
  const err = new BufferOutput();
  const status = await sh.run(source, { stdout: out, stderr: err }, new AbortController().signal);
  return { out: out.text, err: err.text, status };
}

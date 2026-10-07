import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME, fs, isMacHost, useSystem } from '@/kernel';
import { TerminalSession, foregroundName } from './session';
import { stripAnsi } from './shell/ansi';
import { seedFS } from './shell/testkit';

let session: TerminalSession; /** Session under test, started fresh before each test. */
let exited: ReturnType<typeof vi.fn<() => void>>; /** Spy passed as the session's onExit callback. */

/**
 * Whole scrollback of the session as plain text.
 *
 * Reads the buffer's plain-text export (committed lines plus the pending line) and strips any
 * remaining ANSI escapes, so assertions can match on visible text only.
 *
 * @returns {string} The buffer text with ANSI escapes removed.
 *
 * @example
 * expect(screen()).toContain('hello\n');
 */
const screen = () => stripAnsi(session.buffer.text());

/**
 * The unterminated last line (normally the prompt) as plain text.
 *
 * Reads the buffer's raw pending text and strips its ANSI escapes; the line editor's contents
 * are not included.
 *
 * @returns {string} The pending line with ANSI escapes removed.
 *
 * @example
 * expect(lastLine()).toBe('dquote> ');
 */
const lastLine = () => stripAnsi(session.buffer.pending);

/**
 * Wait for timers and microtasks to run.
 *
 * Resolves from a setTimeout, so pending promise callbacks and any timers due within `ms`
 * run before the test continues.
 *
 * @param {number} [ms=0] - Milliseconds to wait.
 * @returns {Promise<unknown>} Resolves after the delay.
 *
 * @example
 * await tick(20);
 */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one key to the session with all modifiers off unless given.
 *
 * Builds a minimal key input (Shift always off) and passes it straight to
 * `session.handleKey`, bypassing the DOM.
 *
 * @param {string} k - KeyboardEvent.key value (e.g. "Enter", "Tab", "c").
 * @param {{ ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }} [mods={}] - Modifier flags to set.
 * @returns {boolean} Whether the session consumed the key.
 *
 * @example
 * key('c', { ctrlKey: true });
 */
const key = (k: string, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) => session.handleKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

/**
 * Replace the line editor's contents, press Enter and wait.
 *
 * Sets the input with the cursor at its end, sends Enter through `key` and then waits `settle`
 * ms so the submitted command can produce its output.
 *
 * @async
 * @param {string} line - Command line (or input for a running command) to submit.
 * @param {number} [settle=10] - Milliseconds to wait after pressing Enter.
 * @returns {Promise<void>} Resolves after the settle delay.
 *
 * @example
 * await type('echo hi');
 */
async function type(line: string, settle = 10) {
  session.setInput(line, line.length);
  key('Enter');
  await tick(settle);
}

beforeEach(async () => {
  seedFS();
  useSystem.getState().updateSettings({ password: '' });
  exited = vi.fn<() => void>();
  session = new TerminalSession({ windowId: null, appPid: 400, onExit: exited });
  await session.start();
});

afterEach(() => session.dispose());

describe('TerminalSession', () => {
  it('starts with a banner and a prompt, and loads ~/.zshrc', () => {
    expect(screen()).toMatch(/^Last login: .* on ttys\d{3}\nWelcome!\n/);
    expect(lastLine()).toMatch(/^aodjo@\S+ ~ % $/);
    expect(session.shell.aliases.get('ll')).toBe('ls -la');
    expect(session.mode).toBe('idle');
  });

  it('marks output without a trailing newline (PROMPT_SP)', async () => {
    await type('printf partial');
    expect(screen()).toContain('partial%\n');
  });

  it('runs pasted lines one after another', async () => {
    session.paste('echo one\necho two\necho thr');
    await tick(30);
    expect(screen()).toMatch(/one\n.*% echo two\ntwo\n/);
    expect(session.input).toBe('echo thr');
  });

  it('shows continuation prompts for unfinished input', async () => {
    await type('echo "a');
    expect(lastLine()).toBe('dquote> ');
    await type('b"');
    expect(screen()).toContain('a\nb\n');
  });

  it('expands !! and records history in ~/.zsh_history (skipping repeats)', async () => {
    await type('echo hi');
    await type('!!');
    expect(screen()).toContain('% !!\necho hi\nhi\n');
    await type('pwd');
    expect(fs.readFile(`${HOME}/.zsh_history`)).toBe('echo hi\npwd\n');
  });

  it('searches history with ^R', async () => {
    await type('echo alpha');
    await type('echo beta');
    key('r', { ctrlKey: true });
    for (const ch of 'alp') key(ch);
    expect(session.search?.match).toBe('echo alpha');
    key('Enter');
    await tick(10);
    expect(session.search).toBeNull();
    expect(screen()).toContain('% echo alpha\nalpha\n');
  });

  it('completes on Tab and lists candidates on a second Tab', () => {
    session.setInput('ls Do', 5);
    key('Tab');
    expect(session.input).toBe('ls Do');
    key('Tab');
    expect(screen()).toMatch(/% ls Do\nDocuments\/\s+Downloads\/\n/);
    session.setInput('ec', 2);
    key('Tab');
    expect(session.input).toBe('echo ');
  });

  it('edits the line with emacs keys', () => {
    session.setInput('one two three', 13);
    key('w', { ctrlKey: true });
    expect(session.input).toBe('one two ');
    key('a', { ctrlKey: true });
    expect(session.cursor).toBe(0);
    key('ArrowRight', { altKey: true });
    expect(session.cursor).toBe(3);
    key('u', { ctrlKey: true });
    expect(session.input).toBe('');
  });

  it('leaves ⌘K to the global Spotlight shortcut and clears scrollback with ⌥⌘K', async () => {
    await type('echo marker-line');
    const mod = isMacHost ? { metaKey: true } : { ctrlKey: true };
    session.setInput('keep me', 7);
    expect(key('k', mod)).toBe(false);
    expect(screen()).toContain('marker-line');
    expect(session.input).toBe('keep me');
    // On macOS ⌥ turns K into a symbol, so the physical key decides.
    const consumed = session.handleKey({ key: isMacHost ? '˚' : 'k', code: 'KeyK', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false, ...mod });
    expect(consumed).toBe(true);
    expect(screen()).not.toContain('marker-line');
  });

  it('asks for a password and runs harmless commands with sudo', async () => {
    await type('sudo whoami');
    expect(lastLine()).toBe('Password:');
    expect(session.secret).toBe(true);
    await type('anything');
    expect(screen()).toContain('Password:\nroot\n');
    await type('sudo rm -rf /');
    expect(screen()).toContain('aodjo is not in the sudoers file.  This incident will be reported.');
  });

  it('interrupts running commands and returns to the prompt', async () => {
    await type('ping -c 100 example.com', 20);
    expect(session.mode).toBe('running');
    key('c', { ctrlKey: true });
    await tick(20);
    expect(screen()).toMatch(/\^C\n--- example\.com ping statistics ---\n1 packets transmitted/);
    expect(session.mode).toBe('idle');
  });

  it('gives an unterminated pasted line to the command reading input', async () => {
    await type('cat', 10);
    session.paste('first\nsecond');
    await tick(10);
    expect(session.mode).toBe('running');
    expect(session.input).toBe('second');
    key('Enter');
    await tick();
    key('d', { ctrlKey: true });
    await tick(10);
    expect(screen()).toContain('first\nfirst\nsecond\nsecond\n');
    expect(session.mode).toBe('idle');
  });

  it('runs `cmd &` as a background job and reports it above the prompt', async () => {
    await type('sleep 0.05 &');
    expect(session.mode).toBe('idle');
    expect(screen()).toMatch(/% sleep 0\.05 &\n\[1\] \d+\n/);
    expect(session.shell.jobs.map((j) => j.command)).toEqual(['sleep 0.05']);
    await type('jobs');
    expect(screen()).toContain('[1]  + running    sleep 0.05\n');
    await tick(80);
    expect(screen()).toContain('[1]  + done       sleep 0.05\n');
    expect(lastLine()).toMatch(/% $/);
    expect(session.shell.jobs).toEqual([]);
  });

  it('keeps background jobs in a subshell and stops them with kill %n', async () => {
    await type('cd /tmp & ping example.com &');
    expect(session.shell.cwd).toBe(HOME);
    expect(session.shell.jobs).toHaveLength(1);
    await type('echo $!');
    expect(screen()).toContain(`\n${session.shell.jobs[0].pid}\n`);
    await type('kill %ping', 20);
    expect(screen()).toMatch(/\[2\]  \+ terminated ping example\.com\n/);
    expect(session.processNames()).toEqual([]);
  });

  it('brings a job to the foreground with fg and interrupts it with ^C', async () => {
    await type('sleep 30 &');
    await type('fg', 10);
    expect(session.mode).toBe('running');
    expect(screen()).toContain('[1]  - running    sleep 30\n');
    key('c', { ctrlKey: true });
    await tick(20);
    expect(session.mode).toBe('idle');
    expect(session.shell.jobs).toEqual([]);
    expect(screen()).not.toContain('terminated');
  });

  it('warns once before exiting with running jobs', async () => {
    await type('sleep 30 &');
    await type('exit');
    expect(screen()).toContain('% exit\nzsh: you have running jobs.\n');
    expect(exited).not.toHaveBeenCalled();
    key('d', { ctrlKey: true });
    expect(exited).toHaveBeenCalledOnce();
  });

  it('names the foreground process like Terminal.app', () => {
    const aliases = new Map([['ll', 'ls -la']]);
    expect(foregroundName('FOO=1 sleep 3', aliases)).toBe('sleep');
    expect(foregroundName('sudo -E top', aliases)).toBe('top');
    expect(foregroundName('ll ~', aliases)).toBe('ls');
    expect(foregroundName('/bin/ls -l', aliases)).toBe('ls');
  });

  it('ends the session on ^D at an empty prompt', () => {
    key('d', { ctrlKey: true });
    expect(exited).toHaveBeenCalledOnce();
    expect(session.mode).toBe('exited');
  });
});

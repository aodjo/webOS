/**
 * Smoke test: mounts the real Terminal view in jsdom, types commands into the hidden input and
 * checks the rendered scrollback, the window title and that React logs no errors or warnings.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME, fs, registerApps, useMenus, useWM, wm, WindowContext } from '@/kernel';
import TerminalApp from './index';
import { seedFS } from './shell/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Inert ResizeObserver replacement for jsdom, which has no ResizeObserver.
 *
 * Installed as a global before the tests so the Terminal view can create its observer; it never
 * calls back, so the view measures its cell grid only once, when the effect runs.
 *
 * @example
 * vi.stubGlobal('ResizeObserver', ResizeObserverStub);
 */
class ResizeObserverStub {
  /**
   * Accept an element to observe without ever reporting a resize.
   *
   * Takes no arguments and records nothing, so no resize callback is ever scheduled.
   *
   * @returns {void}
   *
   * @example
   * new ResizeObserverStub().observe();
   */
  observe() {}
  /**
   * Stop observing an element; a no-op.
   *
   * Nothing is tracked, so there is nothing to remove.
   *
   * @returns {void}
   *
   * @example
   * new ResizeObserverStub().unobserve();
   */
  unobserve() {}
  /**
   * Stop observing all elements; a no-op.
   *
   * Called by the view's layout effect cleanup when it unmounts or the font size changes.
   *
   * @returns {void}
   *
   * @example
   * new ResizeObserverStub().disconnect();
   */
  disconnect() {}
}

/**
 * Placeholder app icon used to register the Terminal app in tests.
 *
 * Renders an empty square SVG; the tests never inspect the icon, but the app registry requires
 * one.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Width and height in px.
 * @returns {JSX.Element} An empty SVG of the given size.
 *
 * @example
 * <Icon size={32} />
 */
const Icon = ({ size }: { size: number }) => <svg width={size} height={size} />;
registerApps([{ id: 'terminal', name: 'Terminal', icon: Icon, component: TerminalApp, window: { width: 720, height: 460 } }]);

const errors: unknown[][] = []; /** Arguments of every console.error / console.warn call; afterAll asserts it stays empty so any React warning fails the suite. */
let root: Root; /** React root the Terminal view is rendered into for the current test. */
let host: HTMLDivElement; /** Container element attached to document.body for the current test. */
let windowId: string; /** Id of the Terminal window opened for the current test. */

/**
 * Let timers and pending effects run inside act().
 *
 * Wraps a timeout promise in act() so state updates triggered by timers (shell output, prompt
 * redraws) are flushed to the DOM before the test continues.
 *
 * @param {number} [ms=0] - Milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay, once React has flushed updates.
 *
 * @example
 * await wait(30);
 */
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

/**
 * Text of every rendered terminal line.
 *
 * Collects the leaf <div>s inside the log (the line elements, not the page wrapper).
 *
 * @returns {string[]} One entry per rendered line, including the prompt line.
 *
 * @example
 * expect(screenLines()).toContain('hello');
 */
const screenLines = () => [...host.querySelectorAll('[role="log"] div')].filter((d) => !d.querySelector('div')).map((d) => d.textContent ?? '');

/**
 * Whole rendered screen as one string.
 *
 * Joins the result of `screenLines` with newlines, so multi-line output can be matched with a
 * single regular expression.
 *
 * @returns {string} The rendered lines joined with newlines.
 *
 * @example
 * expect(screenText()).toContain('~ % echo hi');
 */
const screenText = () => screenLines().join('\n');

/**
 * Text of the last rendered line, normally the prompt line with the cursor cell.
 *
 * The cursor cell renders the character under the cursor, or a space at the end of the line,
 * so a prompt line ends with an extra space.
 *
 * @returns {string} The last line, or an empty string when nothing is rendered.
 *
 * @example
 * expect(lastLine()).toMatch(/% \s$/);
 */
const lastLine = () => screenLines().at(-1) ?? '';

/**
 * The terminal's hidden line-editor input.
 *
 * Looks up the only <input> in the test container; its value mirrors the session's line editor.
 *
 * @returns {HTMLInputElement} The input element.
 *
 * @example
 * expect(input().value).toBe('cd Documents/');
 */
const input = () => host.querySelector<HTMLInputElement>('input')!;

/**
 * Simulate typing text into the hidden input.
 *
 * Appends the text through the native value setter (so React sees the change), places the caret
 * at the end and dispatches an input event inside act().
 *
 * @async
 * @param {string} text - Text to append to the current value.
 * @returns {Promise<void>} Resolves once React has processed the change.
 *
 * @example
 * await type('cat Docu');
 */
async function type(text: string) {
  const el = input();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, el.value + text);
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Dispatch a keydown event on the hidden input inside act().
 *
 * The event bubbles and is cancelable, like a real key press, so it reaches React's keydown
 * handler on the input; extra fields are merged over the defaults.
 *
 * @async
 * @param {string} key - KeyboardEvent.key value (e.g. "Enter", "Tab", "c").
 * @param {Partial<KeyboardEventInit>} [mods={}] - Extra event fields such as modifier flags.
 * @returns {Promise<void>} Resolves once React has processed the event.
 *
 * @example
 * await press('c', { ctrlKey: true });
 */
async function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
  });
}

/**
 * Type a command line, press Enter and wait for it to settle.
 *
 * Appends the line with `type`, presses Enter with `press` and then waits `settle` ms with
 * `wait` so the command's output is rendered.
 *
 * @async
 * @param {string} line - Command line to run.
 * @param {number} [settle=30] - Milliseconds to wait after pressing Enter.
 * @returns {Promise<void>} Resolves after the settle delay.
 *
 * @example
 * await run('cd Documents && ls');
 */
async function run(line: string, settle = 30) {
  await type(line);
  await press('Enter');
  await wait(settle);
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a) => void errors.push(a));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (useWM.getState().windows.some((w) => w.id === windowId)) await wm.close(windowId, { force: true });
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(errors).toEqual([]);
});

beforeEach(async () => {
  seedFS();
  windowId = wm.openWindow('terminal')!;
  const win = useWM.getState().windows.find((w) => w.id === windowId)!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <WindowContext.Provider value={{ id: windowId, pid: win.pid, appId: 'terminal' }}>
        <TerminalApp windowId={windowId} pid={win.pid} args={{}} />
      </WindowContext.Provider>,
    );
  });
  await wait(30);
});

describe('Terminal view', () => {
  it('shows the login banner, motd and a zsh prompt', async () => {
    expect(screenLines()[0]).toMatch(/^Last login: \w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d on ttys\d{3}$/);
    expect(screenLines()[1]).toBe('Welcome!');
    expect(lastLine()).toMatch(/^aodjo@\S+ ~ % \s$/);
    expect(useWM.getState().windows.find((w) => w.id === windowId)?.title).toMatch(/^aodjo — -zsh — \d+×\d+$/);
    expect(useWM.getState().windows.find((w) => w.id === windowId)?.args.path).toBe(HOME);
  });

  it('runs commands typed into the line editor and keeps history', async () => {
    await run('echo hello from the test');
    expect(screenLines()).toContain('hello from the test');
    expect(screenText()).toContain('~ % echo hello from the test');
    await run('cd Documents && ls');
    expect(screenText()).toMatch(/Projects\s+a\.md\s+b\.md\s+c\.txt/);
    expect(lastLine()).toMatch(/^aodjo@\S+ Documents % \s$/);
    expect(useWM.getState().windows.find((w) => w.id === windowId)?.title).toMatch(/^Documents — -zsh — /);
    expect(fs.readFile(`${HOME}/.zsh_history`)).toBe('echo hello from the test\ncd Documents && ls\n');

    await press('ArrowUp');
    expect(input().value).toBe('cd Documents && ls');
    await press('ArrowUp');
    expect(input().value).toBe('echo hello from the test');
    await press('ArrowDown');
    await press('ArrowDown');
    expect(input().value).toBe('');
  });

  it('completes paths with Tab', async () => {
    await type('cat Docu');
    await press('Tab');
    expect(input().value).toBe('cat Documents/');
    await type('a');
    await press('Tab');
    expect(input().value).toBe('cat Documents/a.md ');
  });

  it('interrupts a running command with ^C', async () => {
    await run('sleep 30', 10);
    expect(useWM.getState().windows.find((w) => w.id === windowId)?.title).toMatch(/sleep ◂ -zsh/);
    await press('c', { ctrlKey: true });
    await wait(20);
    expect(screenLines()).toContain('^C');
    expect(lastLine()).toMatch(/% \s$/);
    await run('echo $?');
    expect(screenLines()).toContain('130');
  });

  it('continues incomplete lines with a PS2 prompt', async () => {
    await run('echo "one');
    expect(lastLine()).toBe('dquote>  ');
    await run('two"');
    const lines = screenLines();
    expect(lines.slice(lines.indexOf('dquote> two"') + 1, -1)).toEqual(['one', 'two']);
  });

  it('gives up the keyboard when the desktop becomes active', async () => {
    expect(document.activeElement).toBe(input());
    await act(async () => wm.focusDesktop());
    expect(document.activeElement).not.toBe(input());
    await act(async () => wm.focus(windowId));
    expect(document.activeElement).toBe(input());
  });

  it('keeps Shell ▸ New Window available when no terminal window is open', () => {
    const shell = useMenus.getState().byApp.terminal?.find((m) => m.role === 'file');
    expect(shell?.items.find((i) => i.shortcut === 'alt+n')?.disabled).toBeFalsy();
  });

  it('exits and closes the window', async () => {
    await run('exit');
    await wait(10);
    expect(useWM.getState().windows.some((w) => w.id === windowId)).toBe(false);
  });
});

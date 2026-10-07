/** `linux`: connects the terminal to a real Alpine Linux virtual machine, and hints for package managers. */
import { t } from '@/kernel';
import { c } from '../ansi';
import type { CommandDef } from '../types';
import { VT } from '../../vt';

const ESCAPE_KEY = '\x1d'; /** Ctrl+] — leaves the virtual machine, like telnet's escape character. */
const LOGOUT = /[\r\n]logout\r?\n/; /** What the guest's login shell prints when it exits (matched with escape sequences removed). */
const FRAME_MS = 16; /** Minimum time in ms between two redraws of the screen. */

const linux: CommandDef = {
  name: 'linux',
  path: '/usr/local/bin',
  group: 'apps',
  summary: { en: 'open a shell on a real Alpine Linux machine', ko: '진짜 Alpine Linux 머신의 셸 열기' },
  usage: 'linux',
  description: {
    en: 'Boots an x86 PC emulated in the browser (v86) from a snapshot and attaches this terminal to its console. Python, vim, git and htop are installed; there is no network and nothing is saved. Type exit or press Ctrl+] to come back.',
    ko: '브라우저에서 에뮬레이션하는 x86 PC(v86)를 스냅샷에서 켜고 이 터미널을 콘솔에 연결합니다. Python, vim, git, htop이 설치되어 있고, 네트워크는 없으며 아무것도 저장되지 않습니다. exit를 입력하거나 Ctrl+]를 누르면 돌아옵니다.',
  },
  /**
   * Runs a Linux session on a fresh virtual machine until the guest shell exits.
   *
   * Loads the emulator on demand and shows the snapshot download progress. Once the machine is
   * ready, the terminal switches to the alternate screen: serial output is decoded as UTF-8 and
   * fed into a `VT` screen sized like the terminal (its status replies go back to the guest),
   * which is redrawn at most every `FRAME_MS`; raw input from the terminal is forwarded to the
   * serial port, with arrow keys rewritten for application cursor mode. The guest is told the
   * terminal type (xterm-256color) and screen size with `stty`, and the screen is cleared. The
   * session ends when the guest prints `logout`, when Ctrl+] is pressed or when the command is
   * aborted; the machine is destroyed and the normal screen restored.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 after a session, 1 when the machine could not start, 2 without a terminal.
   *
   * @example
   * await linux.run(ctx);
   */
  async run(ctx) {
    const { term, signal } = ctx;
    if (!ctx.stdout.isTTY || ctx.stdin !== null || !term.readRaw) {
      ctx.error(t({ en: 'needs an interactive terminal', ko: '대화형 터미널이 필요합니다' }));
      return 2;
    }
    ctx.print(c.dim(t({ en: 'Starting Alpine Linux (v86)… Type exit or press Ctrl+] to come back.', ko: 'Alpine Linux(v86)를 시작하는 중… exit를 입력하거나 Ctrl+]를 누르면 돌아옵니다.' })));
    const { createMachine } = await import('@/apps/linux/machine');
    const vm = createMachine(null);
    let lastPct = -1;
    vm.add_listener('download-progress', (e) => {
      if (!e.lengthComputable || !e.total || !/state/.test(e.file_name)) return;
      const pct = Math.floor((e.loaded / e.total) * 100);
      if (pct !== lastPct && pct % 10 === 0) ctx.stdout.write(`\r${c.dim(t({ en: `Downloading ${pct}%`, ko: `내려받는 중 ${pct}%` }))}`);
      lastPct = pct;
    });
    const ready = await new Promise<boolean>((resolve) => {
      vm.add_listener('emulator-ready', () => resolve(true));
      vm.add_listener('download-error', () => resolve(false));
      signal.addEventListener('abort', () => resolve(false), { once: true });
    });
    if (lastPct >= 0) ctx.print();
    if (!ready) {
      void vm.destroy();
      if (!signal.aborted) {
        ctx.error(t({ en: 'the virtual machine could not start', ko: '가상 머신을 시작할 수 없습니다' }));
      }
      return signal.aborted ? 130 : 1;
    }

    const { cols, rows } = term.size();
    const vt = new VT(cols, rows, (data) => vm.serial0_send(data));
    const decoder = new TextDecoder();
    const session = new AbortController();
    /**
     * Ends the Linux session.
     *
     * @returns {void}
     *
     * @example
     * stop();
     */
    const stop = () => session.abort();
    signal.addEventListener('abort', stop, { once: true });
    let pending: number[] = [];
    let tail = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Decodes the buffered serial bytes into the screen and redraws it.
     *
     * @returns {void}
     *
     * @example
     * flush();
     */
    const flush = () => {
      timer = null;
      if (session.signal.aborted) return;
      const text = decoder.decode(new Uint8Array(pending), { stream: true });
      pending = [];
      vt.write(text);
      term.altScreen(vt.frame());
      tail = (tail + text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')).slice(-64);
      if (LOGOUT.test(tail)) stop();
    };
    vm.add_listener('serial0-output-byte', (byte) => {
      pending.push(byte);
      timer ??= setTimeout(flush, FRAME_MS);
    });

    term.altScreen(vt.frame());
    vm.serial0_send(`export TERM=xterm-256color; stty rows ${rows} cols ${cols}; clear\n`);
    while (!session.signal.aborted) {
      const data = await term.readRaw(session.signal);
      if (data === null) break;
      if (data === ESCAPE_KEY) break;
      vm.serial0_send(vt.appCursor ? data.replace(/\x1b\[([ABCD])/g, '\x1bO$1') : data);
    }

    signal.removeEventListener('abort', stop);
    if (timer !== null) clearTimeout(timer);
    void vm.destroy();
    term.altScreen(null);
    ctx.print(c.dim(t({ en: 'Connection to Alpine Linux closed.', ko: 'Alpine Linux 연결이 종료되었습니다.' })));
    return 0;
  },
}; /** `linux`: a shell on an emulated Alpine Linux PC, shown through a VT100 screen on the alternate screen. */

const packageManager: CommandDef = {
  name: 'apt',
  aliases: ['apt-get', 'apk', 'brew', 'yum', 'dnf', 'pacman', 'pip', 'npm'],
  path: '/usr/local/bin',
  group: 'apps',
  summary: { en: 'install packages (in the Linux machine)', ko: '패키지 설치 (Linux 머신에서)' },
  usage: 'apt …',
  /**
   * Explains that this shell has no package manager and points to `linux`.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 1.
   *
   * @example
   * packageManager.run({ ...ctx, name: 'brew' });
   */
  run(ctx) {
    ctx.error(t({ en: 'this shell has no package manager.', ko: '이 셸에는 패키지 관리자가 없습니다.' }));
    ctx.print(t({ en: `Run ${c.bold('linux')} for a real Alpine Linux shell with Python, vim, git and htop.`, ko: `${c.bold('linux')}를 실행하면 Python, vim, git, htop이 있는 진짜 Alpine Linux 셸을 쓸 수 있습니다.` }));
    return 1;
  },
}; /** `apt` and other package manager names: a pointer to the `linux` command. */

export const LINUX_COMMANDS: CommandDef[] = [linux, packageManager]; /** The Linux machine commands, merged into the shell's command registry. */

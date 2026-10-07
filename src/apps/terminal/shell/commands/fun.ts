/** Just for fun: neofetch, matrix, cowsay, fortune, sl, yes. */
import { ACCENT_COLORS, HOSTNAME, USER, isDark, listApps, t, tr, useSystem, type LString } from '@/kernel';
import { osInfo } from '@/data/portfolio';
import { c, displayWidth, truncateWidth } from '../ansi';
import type { CommandDef } from '../types';
import { padEnd, sleep } from '../util';
import { KERNEL_RELEASE, formatUptime } from './system';

/* ───────────────────────── Colors ───────────────────────── */

/**
 * Converts a `#rrggbb` color string into an RGB triple.
 *
 * Accepts the value with or without the leading `#` and ignores surrounding
 * whitespace. Anything other than exactly six hex digits falls back to the
 * default blue accent (#0a84ff).
 *
 * @param {string} hex - Color such as the accent setting, e.g. `#ff9500`.
 * @returns {[number, number, number]} Red, green and blue channels (0-255).
 *
 * @example
 * hexToRgb('#ff9500'); // [255, 149, 0]
 */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x0a84ff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Linearly interpolates between two RGB colors.
 *
 * Each channel moves from `a` toward `b` by the factor `k` and is rounded to an
 * integer, so k = 0 yields `a` and k = 1 yields `b`.
 *
 * @param {[number, number, number]} a - Start color.
 * @param {[number, number, number]} b - End color.
 * @param {number} k - Blend factor between 0 and 1.
 * @returns {[number, number, number]} The blended color.
 *
 * @example
 * mix([255, 0, 0], [0, 0, 0], 0.5); // [128, 0, 0]
 */
const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as [number, number, number];

/* ───────────────────────── neofetch ───────────────────────── */

/**
 * Rasterizes the OS logo (a ring with a center dot) to ASCII art.
 *
 * Every character cell is sampled on a 5×5 sub-grid; the fraction of samples
 * inside the ring or the dot picks a character from the density ramp
 * ` .:-=+*#%@`. Rows are twice as wide as the art is tall and horizontal
 * distances are halved, compensating for terminal cells being about twice as
 * tall as they are wide so the ring looks round. Radii follow the proportions
 * of the OSLogo icon.
 *
 * @param {number} [height=17] - Number of lines; each line is `height * 2` characters wide.
 * @returns {string[]} The rows of the logo, top to bottom.
 *
 * @example
 * const lines = logoArt(9);
 * console.log(lines.join('\n'));
 */
export function logoArt(height = 17): string[] {
  const width = height * 2;
  const ramp = ' .:-=+*#%@';
  const outer = (height - 0.9) / 2;
  const inner = outer * (7.8 / 10.2);
  const dot = outer * (3.2 / 10.2);
  const cx = width / 2;
  const cy = height / 2;
  const N = 5;
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const d = Math.hypot((x + (sx + 0.5) / N - cx) * 0.5, y + (sy + 0.5) / N - cy);
          if ((d <= outer && d >= inner) || d <= dot) hits++;
        }
      }
      line += ramp[Math.round((hits / (N * N)) * (ramp.length - 1))];
    }
    lines.push(line);
  }
  return lines;
}

const neofetch: CommandDef = {
  name: 'neofetch',
  path: '/usr/local/bin',
  group: 'fun',
  summary: { en: 'show system information with the OS logo', ko: 'OS 로고와 함께 시스템 정보 표시' },
  usage: 'neofetch',
  /**
   * Runs `neofetch`, printing the ASCII logo beside system information.
   *
   * The logo is shaded with a vertical gradient between a lightened and a
   * darkened accent color, and the info keys are bold in the accent color; when
   * stdout is not a TTY no color is emitted. Values come from the system store,
   * the portfolio `osInfo`, the app registry and the browser (screen size, pixel
   * ratio, core count, JS heap or device memory). When the terminal is too
   * narrow for the logo plus about 30 columns of info, the logo is printed above
   * the info instead of beside it.
   *
   * @param {CommandContext} ctx - Command context with output streams and terminal size.
   * @returns {number} Always 0.
   *
   * @example
   * // $ neofetch
   * neofetch.run(ctx); // 0
   */
  run(ctx) {
    const tty = ctx.stdout.isTTY;
    const s = useSystem.getState();
    const accent = hexToRgb(s.settings.accent);
    const light = mix(accent, [255, 255, 255], 0.45);
    const deep = mix(accent, [0, 0, 0], 0.25);
    const logo = logoArt(17);
    /**
     * Colors one logo line with the accent gradient.
     *
     * Blends from the light to the deep accent shade by `k` as a 24-bit color;
     * the line is returned unchanged when stdout is not a TTY.
     *
     * @param {string} line - One row of the logo.
     * @param {number} k - Position in the gradient (0 = top row, 1 = bottom row).
     * @returns {string} The colored (or plain) line.
     *
     * @example
     * const top = paint(logo[0], 0);
     */
    const paint = (line: string, k: number) => (tty ? c.rgb(...mix(light, deep, k))(line) : line);
    /**
     * Formats an info label in bold accent color.
     *
     * Returns the plain label when stdout is not a TTY.
     *
     * @param {string} k - Label such as `OS` or `Kernel`.
     * @returns {string} The styled (or plain) label.
     *
     * @example
     * const row = `${key('Shell')}: zsh 5.9`;
     */
    const key = (k: string) => (tty ? c.bold(c.rgb(...accent)(k)) : k);
    const accentName = ACCENT_COLORS.find((a) => a.color.toLowerCase() === s.settings.accent.toLowerCase())?.name.en ?? s.settings.accent;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const memory = heap ? `${Math.round(heap.usedJSHeapSize / 1048576)}MiB / ${Math.round(heap.jsHeapSizeLimit / 1048576)}MiB` : deviceMemory ? `${deviceMemory} GB` : osInfo.memory;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const title = `${USER}@${HOSTNAME}`;
    const info: string[] = [
      tty ? `${c.bold(c.rgb(...accent)(USER))}@${c.bold(c.rgb(...accent)(HOSTNAME))}` : title,
      '-'.repeat(title.length),
      `${key('OS')}: ${osInfo.name} ${osInfo.version} (${tr(osInfo.codename, 'en')}) web`,
      `${key('Host')}: ${tr(osInfo.machine, 'en')}`,
      `${key('Kernel')}: ${KERNEL_RELEASE}`,
      `${key('Uptime')}: ${formatUptime(Date.now() - s.bootedAt).replace(/,$/, '').replace(/^\s+/, '')}`,
      `${key('Packages')}: ${listApps().length} (app)`,
      `${key('Shell')}: zsh 5.9`,
      `${key('Resolution')}: ${screen.width}x${screen.height}${dpr > 1 ? ` @${Math.round(dpr * 10) / 10}x` : ''}`,
      `${key('Theme')}: ${isDark() ? 'Dark' : 'Light'} (${accentName})`,
      `${key('Terminal')}: Terminal (${ctx.term.tty})`,
      `${key('CPU')}: ${osInfo.chip} (${navigator.hardwareConcurrency || 8} cores)`,
      `${key('Memory')}: ${memory}`,
      `${key('Locale')}: ${s.settings.locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8'}`,
      '',
      tty ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => c.bgIndex(i)('   ')).join('') : '',
      tty ? [8, 9, 10, 11, 12, 13, 14, 15].map((i) => c.bgIndex(i)('   ')).join('') : '',
    ];
    const cols = ctx.term.size().cols;
    const logoW = logo[0].length;
    const out: string[] = [];
    if (cols >= logoW + 4 + 30) {
      const rows = Math.max(logo.length, info.length);
      for (let i = 0; i < rows; i++) out.push(`${paint(padEnd(logo[i] ?? '', logoW), i / (logo.length - 1))}   ${info[i] ?? ''}`.trimEnd());
    } else {
      out.push(...logo.map((l, i) => paint(l, i / (logo.length - 1)).trimEnd()), '', ...info);
    }
    ctx.print(out.join('\n'));
    return 0;
  },
}; /** `neofetch` command: prints the OS logo next to a summary of system information. */

/* ───────────────────────── matrix ───────────────────────── */

const GLYPHS = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:."=*+-<>¦'; /** Characters the digital rain is drawn from: half-width katakana, digits and symbols. */

/**
 * Picks a random glyph for the digital rain.
 *
 * Chooses uniformly from GLYPHS with Math.random.
 *
 * @returns {string} A single character.
 *
 * @example
 * grid[y][x] = glyph();
 */
const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

const matrix: CommandDef = {
  name: 'matrix',
  path: '/usr/local/bin',
  group: 'fun',
  summary: { en: 'digital rain (press any key to stop)', ko: '디지털 비 (아무 키나 눌러 중지)' },
  usage: 'matrix',
  /**
   * Runs `matrix`, animating digital rain on the alternate screen.
   *
   * Requires a terminal (prints "not a terminal" and exits 1 otherwise). Each
   * column has a falling drop with its own speed and trail length: the head is
   * bright white, the next cells bright green and the tail dim green, and trail
   * glyphs are occasionally re-randomized. Frames are built as SGR-styled lines
   * (an escape is emitted only when the style changes) about every 50 ms and the
   * grid is rebuilt when the terminal is resized. A key press or ^C stops the
   * loop through a local AbortController; `finally` removes the abort listener
   * and restores the normal screen.
   *
   * @async
   * @param {CommandContext} ctx - Command context with terminal access and abort signal.
   * @returns {Promise<number>} 130 when stopped with ^C, 0 when stopped by a key press, 1 when
   *   stdout is not a terminal.
   *
   * @example
   * // $ matrix
   * const status = await matrix.run(ctx);
   */
  async run(ctx) {
    if (!ctx.stdout.isTTY) {
      ctx.error(t({ en: 'not a terminal', ko: '터미널이 아닙니다' }));
      return 1;
    }
    const stop = new AbortController();
    /**
     * Forwards ^C from the command's signal to the animation's stop controller.
     *
     * Registered once on `ctx.signal` and removed when the animation ends.
     *
     * @returns {void}
     *
     * @example
     * ctx.signal.addEventListener('abort', onAbort, { once: true });
     */
    const onAbort = () => stop.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    void ctx.term.readKey(stop.signal).then(() => stop.abort());
    let { cols, rows } = ctx.term.size();
    let grid: string[][] = [];
    let drops: { y: number; speed: number; len: number }[] = [];
    /**
     * Rebuilds the glyph grid and the drops for the current terminal size.
     *
     * Creates a blank `rows × cols` grid and one drop per column that starts
     * above the screen at a random offset, with a random speed and trail length.
     *
     * @returns {void}
     *
     * @example
     * reset();
     */
    const reset = () => {
      grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '));
      drops = Array.from({ length: cols }, () => ({ y: -Math.random() * rows * 1.5, speed: 0.35 + Math.random() * 0.75, len: 6 + Math.floor(Math.random() * rows * 0.8) }));
    };
    reset();
    try {
      while (!stop.signal.aborted) {
        const size = ctx.term.size();
        if (size.cols !== cols || size.rows !== rows) {
          ({ cols, rows } = size);
          reset();
        }
        const frame: string[] = [];
        for (let y = 0; y < rows; y++) {
          let line = '';
          let style = '';
          for (let x = 0; x < cols; x++) {
            const d = drops[x];
            const dist = Math.floor(d.y) - y;
            let s = '';
            let ch = ' ';
            if (dist >= 0 && dist < d.len) {
              if (Math.random() < 0.03 || grid[y][x] === ' ') grid[y][x] = glyph();
              ch = grid[y][x];
              s = dist === 0 ? '1;97' : dist < 3 ? '1;92' : dist > d.len * 0.7 ? '2;32' : '32';
            } else grid[y][x] = ' ';
            if (s !== style) {
              line += `\x1b[0${s ? ';' + s : ''}m`;
              style = s;
            }
            line += ch;
          }
          frame.push(line + '\x1b[0m');
        }
        ctx.term.altScreen(frame);
        for (const d of drops) {
          d.y += d.speed;
          if (d.y - d.len > rows) Object.assign(d, { y: -Math.random() * rows * 0.5, speed: 0.35 + Math.random() * 0.75, len: 6 + Math.floor(Math.random() * rows * 0.8) });
        }
        await sleep(50, stop.signal);
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      ctx.term.altScreen(null);
    }
    return ctx.signal.aborted ? 130 : 0;
  },
}; /** `matrix` command: full-screen digital rain that runs until a key press or ^C. */

/* ───────────────────────── cowsay / fortune ───────────────────────── */

/**
 * Word-wraps text to a maximum display width.
 *
 * Each input line is wrapped separately and runs of whitespace collapse to a
 * single space. Width is measured in terminal cells, so wide (CJK) characters
 * count double. Words longer than the width are hard-split into pieces that
 * fit, and empty input lines produce empty output lines.
 *
 * @param {string} text - Text to wrap; may contain newlines.
 * @param {number} width - Maximum line width in terminal cells.
 * @returns {string[]} The wrapped lines.
 *
 * @example
 * wrapText('the quick brown fox', 10); // ['the quick', 'brown fox']
 */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && displayWidth(line) + 1 + displayWidth(word) > width) {
        out.push(line);
        line = '';
      }
      let w = word;
      while (displayWidth(w) > width) {
        const head = truncateWidth(w, width);
        out.push(head);
        w = w.slice(head.length);
      }
      line = line ? `${line} ${w}` : w;
    }
    out.push(line);
  }
  return out;
}

/**
 * Renders text in a speech bubble spoken by an ASCII cow.
 *
 * Tabs are expanded to eight spaces and the text is wrapped to `width` cells.
 * A single line gets `< >` borders; longer messages use slash, bar and
 * backslash borders, with every line padded to the widest one.
 *
 * @param {string} text - Message to display.
 * @param {number} [width=40] - Maximum text width of the bubble in terminal cells.
 * @returns {string} The multi-line bubble and cow.
 *
 * @example
 * console.log(cowsay('Moo!'));
 */
export function cowsay(text: string, width = 40): string {
  const lines = wrapText(text.replace(/\t/g, '        '), width);
  const w = Math.max(...lines.map(displayWidth));
  const bubble = [` ${'_'.repeat(w + 2)}`];
  if (lines.length === 1) bubble.push(`< ${lines[0]} >`);
  else
    lines.forEach((l, i) => {
      const [a, b] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
      bubble.push(`${a} ${padEnd(l, w)} ${b}`);
    });
  bubble.push(` ${'-'.repeat(w + 2)}`);
  return [...bubble, '        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'].join('\n');
}

const cowsayCmd: CommandDef = {
  name: 'cowsay',
  path: '/usr/local/bin',
  group: 'fun',
  summary: { en: 'a talking cow', ko: '말하는 소' },
  usage: 'cowsay [message]',
  /**
   * Runs `cowsay` with the arguments, piped input or a default message.
   *
   * Arguments are joined with spaces; without them trimmed stdin is used, and
   * failing that a localized default line. The bubble width is the terminal
   * width minus 10, clamped to 10-40 columns.
   *
   * @param {CommandContext} ctx - Command context with arguments, stdin and terminal size.
   * @returns {number} Always 0.
   *
   * @example
   * // $ cowsay hello
   * cowsayCmd.run(ctx); // 0
   */
  run(ctx) {
    const text = ctx.args.join(' ') || (ctx.stdin ?? '').trim() || t({ en: 'Moo! Hire this developer.', ko: '음매! 이 개발자를 채용하세요.' });
    ctx.print(cowsay(text, Math.min(40, Math.max(10, ctx.term.size().cols - 10))));
    return 0;
  },
}; /** `cowsay` command: prints a message in a cow's speech bubble. */

const FORTUNES: LString[] = [
  { en: 'There is no cloud. It’s just someone else’s IndexedDB.', ko: '클라우드는 없습니다. 남의 IndexedDB가 있을 뿐.' },
  { en: 'It works on my machine. Conveniently, my machine is your browser.', ko: '제 컴퓨터에선 잘 돼요. 마침 제 컴퓨터가 당신의 브라우저네요.' },
  { en: 'Every window you drag here is a few hundred lines of TypeScript having a good time.', ko: '여기서 끄는 모든 윈도우는 즐겁게 일하는 수백 줄의 TypeScript입니다.' },
  { en: 'A 200 ms animation is twelve frames of opportunity.', ko: '200ms 애니메이션은 열두 프레임의 기회입니다.' },
  { en: 'rm -rf / has been tried. The system folders are protected. Nice try, though.', ko: 'rm -rf /는 이미 누군가 해봤습니다. 시스템 폴더는 보호됩니다. 시도는 좋았어요.' },
  { en: 'Good software feels like it was always there.', ko: '좋은 소프트웨어는 원래부터 그 자리에 있었던 것처럼 느껴집니다.' },
  { en: 'Read the docs. Then read the source. Then write better docs.', ko: '문서를 읽고, 소스를 읽고, 더 나은 문서를 쓰세요.' },
  { en: 'You found the terminal. You’re my kind of person — say hi with `contact`.', ko: '터미널을 찾으셨군요. 저와 잘 맞는 분이네요 — `contact`로 인사해 주세요.' },
  { en: 'The best way to see my work is the Projects app. The second best is `projects`.', ko: '제 작업을 보는 가장 좋은 방법은 프로젝트 앱, 두 번째는 `projects` 명령입니다.' },
  { en: 'Weeks of coding can save you hours of planning.', ko: '몇 주간의 코딩으로 몇 시간의 계획을 아낄 수 있습니다.' },
  { en: 'Fortune favors the developer who writes tests.', ko: '행운은 테스트를 작성하는 개발자의 편입니다.' },
  { en: 'Today’s lucky shortcut: Ctrl+Space opens Spotlight.', ko: '오늘의 행운의 단축키: Ctrl+Space로 Spotlight를 여세요.' },
  { en: 'There are two hard problems in computer science: cache invalidation, naming things, and off-by-one errors.', ko: '컴퓨터 과학의 어려운 문제는 두 가지입니다: 캐시 무효화, 이름 짓기, 그리고 하나 차이 오류.' },
  { en: 'Hire me before I write another operating system.', ko: '제가 운영체제를 하나 더 만들기 전에 채용해 주세요.' },
]; /** Localized adages that `fortune` picks from at random. */

const fortune: CommandDef = {
  name: 'fortune',
  path: '/usr/local/bin',
  group: 'fun',
  summary: { en: 'print a random, hopefully interesting, adage', ko: '무작위 격언 출력' },
  usage: 'fortune',
  /**
   * Runs `fortune`, printing one random adage in the current language.
   *
   * Picks uniformly from FORTUNES and localizes the entry with `t()`.
   *
   * @param {CommandContext} ctx - Command context used for output.
   * @returns {number} Always 0.
   *
   * @example
   * // $ fortune
   * fortune.run(ctx); // 0
   */
  run(ctx) {
    ctx.print(t(FORTUNES[Math.floor(Math.random() * FORTUNES.length)]));
    return 0;
  },
}; /** `fortune` command: prints a random adage. */

/* ───────────────────────── sl ───────────────────────── */

const TRAIN_BODY = [
  '  _||_                                                ',
  ' |    |_____________________     ____________________ ',
  ' |   webOS   EXPRESS        |   |  []   []   []   [] |',
  ' |____   ___________   _____|=o=|____________________|',
]; /** Rows of the locomotive and carriages drawn by `sl`, without smoke or wheels. */
const WHEELS = [' \\_O_/___\\_O__O_/___\\_O_/___/   \\_O__O_/______\\_O__O_/', ' \\_o_/___\\_o__o_/___\\_o_/___/   \\_o__o_/______\\_o__o_/']; /** Two wheel rows that alternate to animate the turning wheels. */
const SMOKE = [
  ['                  (  ) (@@) ( )  (@)    ', '            (@@@)                       ', '        (   )                           ', '      (@)                               '],
  ['                 (@@) (  ) (@)  ( )     ', '            (   )                       ', '        (@@@@)                          ', '      ( )                               '],
]; /** Two smoke frames (four rows each) that alternate above the train. */

const sl: CommandDef = {
  name: 'sl',
  path: '/usr/local/bin',
  group: 'fun',
  summary: { en: 'steam locomotive (for when you mistype ls)', ko: '증기 기관차 (ls를 잘못 입력했을 때)' },
  usage: 'sl',
  /**
   * Runs `sl`, driving the train from the right edge until it leaves on the left.
   *
   * Does nothing when stdout is not a terminal. Every 40 ms the art shifts one
   * column left on the alternate screen, vertically centered; smoke and wheels
   * switch frames every two columns. Lines entering on the right are padded
   * with spaces, lines leaving on the left are cut from the start, and every
   * line is clipped to the terminal width, which is re-read each frame. ^C
   * stops early, and the normal screen is always restored.
   *
   * @async
   * @param {CommandContext} ctx - Command context with terminal access and abort signal.
   * @returns {Promise<number>} 130 when interrupted with ^C, otherwise 0.
   *
   * @example
   * // $ sl
   * const status = await sl.run(ctx); // 0
   */
  async run(ctx) {
    if (!ctx.stdout.isTTY) return 0;
    const width = TRAIN_BODY[0].length;
    try {
      for (let x = ctx.term.size().cols; x > -width; x -= 1) {
        const { cols, rows } = ctx.term.size();
        const frameNo = Math.floor(x / 2) & 1;
        const art = [...SMOKE[frameNo], ...TRAIN_BODY, WHEELS[frameNo]];
        const top = Math.max(0, Math.floor((rows - art.length) / 2));
        const frame: string[] = Array.from({ length: rows }, () => '');
        art.forEach((line, i) => {
          if (top + i >= rows) return;
          const padded = x >= 0 ? ' '.repeat(x) + line : line.slice(-x);
          frame[top + i] = padded.slice(0, cols);
        });
        ctx.term.altScreen(frame);
        if (!(await sleep(40, ctx.signal))) break;
      }
    } finally {
      ctx.term.altScreen(null);
    }
    return ctx.signal.aborted ? 130 : 0;
  },
}; /** `sl` command: an animated steam locomotive. */

/* ───────────────────────── yes ───────────────────────── */

const yes: CommandDef = {
  name: 'yes',
  path: '/usr/bin',
  group: 'fun',
  summary: { en: 'repeatedly print a string (^C to stop)', ko: '문자열을 계속 출력 (^C로 중지)' },
  usage: 'yes [expletive]',
  /**
   * Runs `yes`, writing the line over and over.
   *
   * The line is the arguments joined with spaces, or `y`. On a terminal 24
   * copies are written about every 33 ms until ^C. A pipe or file has no reader
   * that could close it to stop the command, so a bounded 10,000 lines are
   * written instead and the command exits normally.
   *
   * @async
   * @param {CommandContext} ctx - Command context with arguments, stdout and abort signal.
   * @returns {Promise<number>} 130 after ^C on a terminal, 0 when writing to a pipe or file.
   *
   * @example
   * // $ yes | head -n 3
   * const status = await yes.run(ctx); // 0
   */
  async run(ctx) {
    const line = (ctx.args.length ? ctx.args.join(' ') : 'y') + '\n';
    if (!ctx.stdout.isTTY) {
      ctx.stdout.write(line.repeat(10_000));
      return 0;
    }
    while (await sleep(33, ctx.signal)) ctx.stdout.write(line.repeat(24));
    return 130;
  },
}; /** `yes` command: repeatedly prints a string (default `y`). */

export const FUN_COMMANDS: CommandDef[] = [neofetch, matrix, cowsayCmd, fortune, sl, yes]; /** Novelty commands contributed to the command registry. */

/**
 * A small VT100/xterm screen emulator for programs that drive the terminal with escape
 * sequences (a remote shell, vim, htop…). It keeps a grid of styled cells and a cursor, and
 * renders the screen as lines of SGR-styled text for the terminal's alternate screen.
 */
import { applySGR, charWidth, type Style } from './shell/ansi';

/** One character cell. `ch` is '' for the right half of a wide character. */
interface Cell {
  ch: string;
  style: Style;
}

const BLANK_STYLE: Style = {}; /** Shared style of cells that were never written with attributes. */

/**
 * Creates a blank cell, optionally carrying a background from the current style (as erase does).
 *
 * @param {Style} [style=BLANK_STYLE] - Style whose background the blank keeps.
 * @returns {Cell} The blank cell.
 *
 * @example
 * blank();
 */
const blank = (style: Style = BLANK_STYLE): Cell => ({ ch: ' ', style: style.bg === undefined ? BLANK_STYLE : { bg: style.bg } });

/**
 * Converts a style back into SGR parameters.
 *
 * Palette colors 0–7 and 8–15 map to 30–37 / 90–97 (and 40–47 / 100–107 for backgrounds);
 * `rgb(r,g,b)` colors become truecolor parameters.
 *
 * @param {Style} s - The style.
 * @returns {string} Semicolon-separated SGR parameters, starting with a reset.
 *
 * @example
 * sgrOf({ bold: true, fg: 1 }); // '0;1;31'
 */
function sgrOf(s: Style): string {
  const p = ['0'];
  if (s.bold) p.push('1');
  if (s.dim) p.push('2');
  if (s.italic) p.push('3');
  if (s.underline) p.push('4');
  if (s.inverse) p.push('7');
  if (s.strike) p.push('9');
  for (const [key, base] of [['fg', 30], ['bg', 40]] as const) {
    const v = s[key];
    if (typeof v === 'number') p.push(String(v < 8 ? base + v : base + 60 + v - 8));
    else if (typeof v === 'string') {
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(v);
      if (m) p.push(`${base + 8};2;${m[1]};${m[2]};${m[3]}`);
    }
  }
  return p.join(';');
}

/**
 * A VT100-compatible screen.
 *
 * Supports printable text with autowrap (including wide characters), CR/LF/BS/TAB, cursor
 * movement and positioning, erase in display/line, insert/delete characters and lines, scroll
 * regions, index/reverse index, save/restore cursor, SGR attributes and colors, the alternate
 * screen (modes 47/1047/1049), cursor visibility, application cursor keys and status reports
 * (DSR, DA), which are answered through `reply`. OSC strings and character set designations are
 * ignored.
 *
 * @example
 * const vt = new VT(80, 24, (s) => send(s));
 * vt.write('\x1b[1;31mhi\x1b[0m');
 * term.altScreen(vt.frame());
 */
export class VT {
  /** Whether the program asked for application cursor keys (arrows send ESC O x). */
  appCursor = false;
  private grid: Cell[][] = [];
  private saved: Cell[][] | null = null;
  private x = 0;
  private y = 0;
  private wrapPending = false;
  private style: Style = BLANK_STYLE;
  private top = 0;
  private bottom: number;
  private cursorVisible = true;
  private savedCursor = { x: 0, y: 0, style: BLANK_STYLE as Style };
  private state: 'ground' | 'esc' | 'csi' | 'osc' | 'charset' = 'ground';
  private params = '';

  /**
   * Creates a blank screen.
   *
   * @param {number} cols - Width in cells.
   * @param {number} rows - Height in cells.
   * @param {(data: string) => void} [reply] - Receives answers to status requests.
   *
   * @example
   * new VT(80, 24);
   */
  constructor(
    readonly cols: number,
    readonly rows: number,
    private readonly reply: (data: string) => void = () => {},
  ) {
    this.bottom = rows - 1;
    this.grid = this.emptyGrid();
  }

  /**
   * Builds a grid of blank rows.
   *
   * @returns {Cell[][]} `rows` rows of `cols` blank cells.
   *
   * @example
   * this.grid = this.emptyGrid();
   */
  private emptyGrid(): Cell[][] {
    return Array.from({ length: this.rows }, () => this.emptyRow());
  }

  /**
   * Builds one blank row with the current background.
   *
   * @returns {Cell[]} `cols` blank cells.
   *
   * @example
   * this.grid[0] = this.emptyRow();
   */
  private emptyRow(): Cell[] {
    return Array.from({ length: this.cols }, () => blank(this.style));
  }

  /**
   * Feeds program output into the screen.
   *
   * @param {string} text - Decoded output, escape sequences included.
   * @returns {void}
   *
   * @example
   * vt.write('hello\r\n');
   */
  write(text: string): void {
    for (const ch of text) this.feed(ch);
  }

  /**
   * Advances the parser by one character.
   *
   * @param {string} ch - One code point.
   * @returns {void}
   *
   * @example
   * this.feed('\x1b');
   */
  private feed(ch: string): void {
    switch (this.state) {
      case 'esc':
        this.escape(ch);
        return;
      case 'csi':
        if (ch >= '@' && ch <= '~') {
          this.state = 'ground';
          this.csi(ch);
        } else this.params += ch;
        return;
      case 'osc':
        if (ch === '\x07') this.state = 'ground';
        else if (ch === '\x1b') this.state = 'esc';
        return;
      case 'charset':
        this.state = 'ground';
        return;
    }
    switch (ch) {
      case '\x1b':
        this.state = 'esc';
        return;
      case '\r':
        this.x = 0;
        this.wrapPending = false;
        return;
      case '\n':
      case '\v':
      case '\f':
        this.lineFeed();
        return;
      case '\b':
        if (this.x > 0) this.x--;
        this.wrapPending = false;
        return;
      case '\t':
        this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
        return;
      case '\x07':
      case '\x0e':
      case '\x0f':
        return;
    }
    if (ch < ' ' || ch === '\x7f') return;
    this.print(ch);
  }

  /**
   * Handles the character after ESC.
   *
   * @param {string} ch - The character following ESC.
   * @returns {void}
   *
   * @example
   * this.escape('[');
   */
  private escape(ch: string): void {
    this.state = 'ground';
    switch (ch) {
      case '[':
        this.state = 'csi';
        this.params = '';
        return;
      case ']':
        this.state = 'osc';
        return;
      case '(':
      case ')':
      case '*':
      case '+':
        this.state = 'charset';
        return;
      case '7':
        this.savedCursor = { x: this.x, y: this.y, style: this.style };
        return;
      case '8':
        ({ x: this.x, y: this.y, style: this.style } = this.savedCursor);
        this.wrapPending = false;
        return;
      case 'D':
        this.lineFeed();
        return;
      case 'E':
        this.x = 0;
        this.lineFeed();
        return;
      case 'M':
        if (this.y === this.top) this.scrollDown(1);
        else if (this.y > 0) this.y--;
        return;
      case 'c':
        this.reset();
        return;
    }
  }

  /**
   * Restores the power-on state: blank main screen, home cursor, default modes.
   *
   * @returns {void}
   *
   * @example
   * this.reset();
   */
  private reset(): void {
    this.style = BLANK_STYLE;
    this.grid = this.emptyGrid();
    this.saved = null;
    this.x = this.y = 0;
    this.top = 0;
    this.bottom = this.rows - 1;
    this.wrapPending = false;
    this.cursorVisible = true;
    this.appCursor = false;
  }

  /**
   * Writes a printable character at the cursor and advances it, wrapping at the right margin.
   *
   * @param {string} ch - The character.
   * @returns {void}
   *
   * @example
   * this.print('a');
   */
  private print(ch: string): void {
    const w = charWidth(ch.codePointAt(0)!);
    if (w === 0) return;
    if (this.wrapPending || this.x + w > this.cols) {
      this.x = 0;
      this.lineFeed();
    }
    const row = this.grid[this.y];
    row[this.x] = { ch, style: this.style };
    if (w === 2 && this.x + 1 < this.cols) row[this.x + 1] = { ch: '', style: this.style };
    if (this.x + w >= this.cols) {
      this.x = this.cols - 1;
      this.wrapPending = true;
    } else this.x += w;
  }

  /**
   * Moves the cursor down a line, scrolling the region when it is at the bottom margin.
   *
   * @returns {void}
   *
   * @example
   * this.lineFeed();
   */
  private lineFeed(): void {
    this.wrapPending = false;
    if (this.y === this.bottom) this.scrollUp(1);
    else if (this.y < this.rows - 1) this.y++;
  }

  /**
   * Scrolls the scroll region up, adding blank lines at its bottom.
   *
   * @param {number} n - Number of lines.
   * @returns {void}
   *
   * @example
   * this.scrollUp(1);
   */
  private scrollUp(n: number): void {
    for (let i = 0; i < n; i++) {
      this.grid.splice(this.top, 1);
      this.grid.splice(this.bottom, 0, this.emptyRow());
    }
  }

  /**
   * Scrolls the scroll region down, adding blank lines at its top.
   *
   * @param {number} n - Number of lines.
   * @returns {void}
   *
   * @example
   * this.scrollDown(1);
   */
  private scrollDown(n: number): void {
    for (let i = 0; i < n; i++) {
      this.grid.splice(this.bottom, 1);
      this.grid.splice(this.top, 0, this.emptyRow());
    }
  }

  /**
   * Executes a complete CSI sequence.
   *
   * @param {string} final - The final character.
   * @returns {void}
   *
   * @example
   * this.csi('H');
   */
  private csi(final: string): void {
    const priv = this.params.startsWith('?');
    const nums = (priv ? this.params.slice(1) : this.params).split(';').map((p) => (p === '' ? NaN : parseInt(p, 10)));
    /**
     * Reads a numeric parameter, falling back to a default when it is missing or zero.
     *
     * @param {number} i - Parameter index.
     * @param {number} [def=1] - Default value.
     * @returns {number} The parameter.
     *
     * @example
     * arg(0); // 1 when absent
     */
    const arg = (i: number, def = 1) => (Number.isFinite(nums[i]) && nums[i] > 0 ? nums[i] : def);
    /**
     * Clamps a column to the screen.
     *
     * @param {number} v - Column.
     * @returns {number} Column within 0…cols-1.
     *
     * @example
     * clampX(-3); // 0
     */
    const clampX = (v: number) => Math.max(0, Math.min(this.cols - 1, v));
    /**
     * Clamps a row to the screen.
     *
     * @param {number} v - Row.
     * @returns {number} Row within 0…rows-1.
     *
     * @example
     * clampY(99); // rows - 1
     */
    const clampY = (v: number) => Math.max(0, Math.min(this.rows - 1, v));
    this.wrapPending = false;
    if (priv) {
      if (final === 'h' || final === 'l') for (const n of nums) this.mode(n, final === 'h');
      return;
    }
    const row = this.grid[this.y];
    switch (final) {
      case 'A':
        this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - arg(0));
        break;
      case 'B':
      case 'e':
        this.y = Math.min(this.y <= this.bottom ? this.bottom : this.rows - 1, this.y + arg(0));
        break;
      case 'C':
      case 'a':
        this.x = clampX(this.x + arg(0));
        break;
      case 'D':
        this.x = clampX(this.x - arg(0));
        break;
      case 'E':
        this.x = 0;
        this.y = clampY(this.y + arg(0));
        break;
      case 'F':
        this.x = 0;
        this.y = clampY(this.y - arg(0));
        break;
      case 'G':
      case '`':
        this.x = clampX(arg(0) - 1);
        break;
      case 'd':
        this.y = clampY(arg(0) - 1);
        break;
      case 'H':
      case 'f':
        this.y = clampY(arg(0) - 1);
        this.x = clampX(arg(1) - 1);
        break;
      case 'J': {
        const mode = Number.isFinite(nums[0]) ? nums[0] : 0;
        if (mode === 0) {
          row.splice(this.x, this.cols - this.x, ...Array.from({ length: this.cols - this.x }, () => blank(this.style)));
          for (let i = this.y + 1; i < this.rows; i++) this.grid[i] = this.emptyRow();
        } else if (mode === 1) {
          for (let i = 0; i < this.y; i++) this.grid[i] = this.emptyRow();
          for (let i = 0; i <= this.x; i++) row[i] = blank(this.style);
        } else this.grid = this.emptyGrid();
        break;
      }
      case 'K': {
        const mode = Number.isFinite(nums[0]) ? nums[0] : 0;
        const [from, to] = mode === 0 ? [this.x, this.cols] : mode === 1 ? [0, this.x + 1] : [0, this.cols];
        for (let i = from; i < to; i++) row[i] = blank(this.style);
        break;
      }
      case 'X':
        for (let i = this.x; i < Math.min(this.cols, this.x + arg(0)); i++) row[i] = blank(this.style);
        break;
      case '@': {
        const n = Math.min(arg(0), this.cols - this.x);
        row.splice(this.x, 0, ...Array.from({ length: n }, () => blank(this.style)));
        row.length = this.cols;
        break;
      }
      case 'P': {
        const n = Math.min(arg(0), this.cols - this.x);
        row.splice(this.x, n);
        row.push(...Array.from({ length: n }, () => blank(this.style)));
        break;
      }
      case 'L':
        if (this.y >= this.top && this.y <= this.bottom) {
          for (let i = 0; i < arg(0); i++) {
            this.grid.splice(this.bottom, 1);
            this.grid.splice(this.y, 0, this.emptyRow());
          }
          this.x = 0;
        }
        break;
      case 'M':
        if (this.y >= this.top && this.y <= this.bottom) {
          for (let i = 0; i < arg(0); i++) {
            this.grid.splice(this.y, 1);
            this.grid.splice(this.bottom, 0, this.emptyRow());
          }
          this.x = 0;
        }
        break;
      case 'S':
        this.scrollUp(arg(0));
        break;
      case 'T':
        this.scrollDown(arg(0));
        break;
      case 'r':
        this.top = clampY(arg(0) - 1);
        this.bottom = clampY(arg(1, this.rows) - 1);
        if (this.top >= this.bottom) {
          this.top = 0;
          this.bottom = this.rows - 1;
        }
        this.x = this.y = 0;
        break;
      case 's':
        this.savedCursor = { x: this.x, y: this.y, style: this.style };
        break;
      case 'u':
        ({ x: this.x, y: this.y, style: this.style } = this.savedCursor);
        break;
      case 'm':
        this.style = applySGR(this.style, nums.map((n) => (Number.isFinite(n) ? n : 0)));
        break;
      case 'n':
        if (nums[0] === 6) this.reply(`\x1b[${this.y + 1};${this.x + 1}R`);
        else if (nums[0] === 5) this.reply('\x1b[0n');
        break;
      case 'c':
        this.reply('\x1b[?1;2c');
        break;
    }
  }

  /**
   * Sets or resets a DEC private mode.
   *
   * @param {number} n - Mode number.
   * @param {boolean} on - True for set (h), false for reset (l).
   * @returns {void}
   *
   * @example
   * this.mode(25, false); // hide the cursor
   */
  private mode(n: number, on: boolean): void {
    if (n === 1) this.appCursor = on;
    else if (n === 25) this.cursorVisible = on;
    else if (n === 47 || n === 1047 || n === 1049) {
      if (on && !this.saved) {
        if (n === 1049) this.savedCursor = { x: this.x, y: this.y, style: this.style };
        this.saved = this.grid;
        this.grid = this.emptyGrid();
      } else if (!on && this.saved) {
        this.grid = this.saved;
        this.saved = null;
        if (n === 1049) ({ x: this.x, y: this.y, style: this.style } = this.savedCursor);
      }
    }
  }

  /**
   * Renders the screen as SGR-styled lines, with the cursor drawn as an inverted cell.
   *
   * @param {boolean} [showCursor=true] - Whether to draw the cursor (when the program shows it).
   * @returns {string[]} One string per row.
   *
   * @example
   * term.altScreen(vt.frame());
   */
  frame(showCursor = true): string[] {
    return this.grid.map((row, y) => {
      let out = '';
      let last = '';
      row.forEach((cell, x) => {
        if (cell.ch === '') return;
        const cursor = showCursor && this.cursorVisible && x === this.x && y === this.y;
        const style = cursor ? { ...cell.style, inverse: !cell.style.inverse } : cell.style;
        const sgr = sgrOf(style);
        if (sgr !== last) {
          out += `\x1b[${sgr}m`;
          last = sgr;
        }
        out += cell.ch;
      });
      return `${out}\x1b[0m`;
    });
  }
}

const NAMED_KEYS: Record<string, string> = {
  Enter: '\r',
  Backspace: '\x7f',
  Tab: '\t',
  Escape: '\x1b',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  Insert: '\x1b[2~',
  Delete: '\x1b[3~',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
}; /** Bytes a VT100/xterm terminal sends for named keys (normal cursor-key mode). */

const CODE_CHARS: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Space: ' ', Minus: '_', Digit6: '^' }; /** Characters of the physical keys that have Ctrl codes besides the letters. */

/**
 * Encodes a key press as the bytes a terminal sends to the program it runs.
 *
 * Printable characters are sent as is, Ctrl+letter (and Ctrl+[, \, ], ^, _, space) as the
 * matching control character (read from the physical key `code` when `key` is not a single
 * character, as with some keyboard layouts), Shift+Tab as `ESC [ Z` and named keys per `NAMED_KEYS`. Keys
 * combined with ⌘ or ⌥ return null, so app and system shortcuts keep working.
 *
 * @param {{ key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }} e - The key press.
 * @returns {string | null} The bytes to send, or null when the key is not for the program.
 *
 * @example
 * encodeKey({ key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }); // '\x03'
 */
export function encodeKey(e: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (e.metaKey || e.altKey) return null;
  if (e.ctrlKey) {
    const ch = e.key.length === 1 ? e.key : (CODE_CHARS[e.code ?? ''] ?? /^Key([A-Z])$/.exec(e.code ?? '')?.[1]);
    if (!ch) return NAMED_KEYS[e.key] ?? null;
    const code = ch.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
    if (ch === ' ') return '\0';
    return null;
  }
  if (e.key === 'Tab' && e.shiftKey) return '\x1b[Z';
  if (e.key.length === 1 || [...e.key].length === 1) return e.key;
  return NAMED_KEYS[e.key] ?? null;
}

/**
 * Tiny ANSI toolkit: helpers commands use to produce colored output, and an SGR parser the
 * terminal view uses to render it. Supports 30–37/90–97 (+ 40–47/100–107 backgrounds),
 * 38;5;n / 38;2;r;g;b, bold, dim, italic, underline, inverse and strike-through. Every other
 * escape sequence (cursor movement, OSC titles…) is stripped.
 */

/** Text attributes selected by SGR escape sequences. */
export interface Style {
  /** 0–15 = palette index (themed by the terminal profile), string = CSS color. */
  fg?: number | string;
  /** Background color, same encoding as `fg`. */
  bg?: number | string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
}

/** A run of text that shares one style. */
export interface Segment extends Style {
  text: string;
}

/* ───────────────────────── Producing ───────────────────────── */

/**
 * Create a formatter that wraps text in an SGR "on" / "off" pair.
 *
 * The returned function emits `ESC[<open>m`, the value, then `ESC[<close>m`, so formatters
 * can be nested (e.g. bold inside green) without resetting unrelated attributes.
 *
 * @param {string} open - SGR parameters that switch the attribute on (e.g. "1", "38;2;255;0;0").
 * @param {string} close - SGR parameters that switch it off again (e.g. "22", "39").
 * @returns {(s: string | number) => string} Formatter wrapping its argument in the escapes.
 *
 * @example
 * const red = sgr('31', '39');
 * red('error'); // "\x1b[31merror\x1b[39m"
 */
const sgr = (open: string, close: string) => (s: string | number) => `\x1b[${open}m${s}\x1b[${close}m`;

export const c = {
  bold: sgr('1', '22'),
  dim: sgr('2', '22'),
  italic: sgr('3', '23'),
  underline: sgr('4', '24'),
  inverse: sgr('7', '27'),
  black: sgr('30', '39'),
  red: sgr('31', '39'),
  green: sgr('32', '39'),
  yellow: sgr('33', '39'),
  blue: sgr('34', '39'),
  magenta: sgr('35', '39'),
  cyan: sgr('36', '39'),
  white: sgr('37', '39'),
  gray: sgr('90', '39'),
  brightRed: sgr('91', '39'),
  brightGreen: sgr('92', '39'),
  brightYellow: sgr('93', '39'),
  brightBlue: sgr('94', '39'),
  brightMagenta: sgr('95', '39'),
  brightCyan: sgr('96', '39'),
  brightWhite: sgr('97', '39'),
  bgBlack: sgr('40', '49'),
  /**
   * Build a 24-bit foreground color formatter.
   *
   * Emits `38;2;r;g;b`, which the parser turns into a CSS `rgb()` color.
   *
   * @param {number} r - Red, 0–255.
   * @param {number} g - Green, 0–255.
   * @param {number} b - Blue, 0–255.
   * @returns {(s: string | number) => string} Formatter for that foreground color.
   *
   * @example
   * c.rgb(255, 128, 0)('orange');
   */
  rgb: (r: number, g: number, b: number) => sgr(`38;2;${r};${g};${b}`, '39'),
  /**
   * Build a 24-bit background color formatter.
   *
   * Emits `48;2;r;g;b`, which the parser turns into a CSS `rgb()` background.
   *
   * @param {number} r - Red, 0–255.
   * @param {number} g - Green, 0–255.
   * @param {number} b - Blue, 0–255.
   * @returns {(s: string | number) => string} Formatter for that background color.
   *
   * @example
   * c.bgRgb(0, 0, 128)('  ');
   */
  bgRgb: (r: number, g: number, b: number) => sgr(`48;2;${r};${g};${b}`, '49'),
  /**
   * Build a palette background color formatter.
   *
   * Indices 0–7 map to SGR 40–47 and 8–15 to the bright backgrounds 100–107, so the color
   * follows the terminal profile's theme.
   *
   * @param {number} n - Palette index, 0–15.
   * @returns {(s: string | number) => string} Formatter for that background color.
   *
   * @example
   * c.bgIndex(4)(' INFO '); // blue background
   */
  bgIndex: (n: number) => sgr(n < 8 ? `${40 + n}` : `${100 + n - 8}`, '49'),
}; /** Color and attribute formatters for command output: `c.bold(c.green('ok'))`. */

const ESCAPE_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g; /** Any escape sequence: CSI, OSC (BEL/ST-terminated) and two-char escapes; global, so reset lastIndex before exec loops. */

/**
 * Remove every ANSI escape sequence from a string.
 *
 * Replaces every match of ESCAPE_RE (CSI including SGR colors, OSC and two-character
 * escapes) with nothing, leaving only the visible text.
 *
 * @param {string} s - Text that may contain escapes.
 * @returns {string} The visible text only.
 *
 * @example
 * stripAnsi(c.red('error')); // "error"
 */
export function stripAnsi(s: string): string {
  return s.replace(ESCAPE_RE, '');
}

/**
 * Compute the terminal cell width of a code point.
 *
 * NUL, zero-width space/joiner, variation selector 16 and combining marks take no cells;
 * East Asian wide characters (Hangul, CJK, kana, fullwidth forms) and common emoji blocks take
 * two; everything else takes one.
 *
 * @param {number} cp - Unicode code point.
 * @returns {0 | 1 | 2} Number of cells the character occupies.
 *
 * @example
 * charWidth('a'.codePointAt(0)!); // 1
 * charWidth('한'.codePointAt(0)!); // 2
 */
export function charWidth(cp: number): 0 | 1 | 2 {
  if (cp === 0 || cp === 0x200b || cp === 0x200d || cp === 0xfe0f) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x20d0 && cp <= 0x20ff)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // Kana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // Emoji
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  return 1;
}

/**
 * Measure the visible width of a string in terminal cells.
 *
 * Escape sequences are stripped first, then charWidth() is summed per code point.
 *
 * @param {string} s - Text, possibly containing ANSI escapes.
 * @returns {number} Width in cells.
 *
 * @example
 * displayWidth(c.bold('한글 ok')); // 7
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/**
 * Truncate a string to at most `width` terminal cells.
 *
 * Stops before the first character that would overflow, so a wide character is never split.
 * Not ANSI-aware: escape sequences would be counted as visible text, so use it on plain text.
 *
 * @param {string} s - Plain text to truncate.
 * @param {number} width - Maximum width in cells.
 * @returns {string} The longest prefix of `s` that fits.
 *
 * @example
 * truncateWidth('한글abc', 3); // "한"
 */
export function truncateWidth(s: string, width: number): string {
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > width) break;
    w += cw;
    out += ch;
  }
  return out;
}

/* ───────────────────────── Parsing ───────────────────────── */

/**
 * Convert an xterm 256-color index into a Style color.
 *
 * 0–15 stay palette indices (themed by the profile); 16–231 map to the 6×6×6 color cube
 * (channel levels 0, 95, 135, 175, 215, 255); 232–255 map to the 24-step gray ramp starting
 * at rgb(8,8,8).
 *
 * @param {number} n - Color index, 0–255.
 * @returns {number | string} A palette index, or a CSS `rgb()` string.
 *
 * @example
 * color256(9);   // 9
 * color256(196); // "rgb(255,0,0)"
 */
function color256(n: number): number | string {
  if (n < 16) return n;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  return `rgb(${steps[Math.floor(i / 36)]},${steps[Math.floor(i / 6) % 6]},${steps[i % 6]})`;
}

/**
 * Apply the parameters of one SGR sequence to a style.
 *
 * Works on a copy, so `style` is not mutated. An empty parameter list means reset (0).
 * Handles reset, the bold/dim/italic/underline/inverse/strike attributes and their "off"
 * codes (22 clears both bold and dim), palette foregrounds/backgrounds (30–37, 90–97, 40–47,
 * 100–107), default colors (39, 49) and the extended forms `38/48;5;n` and `38/48;2;r;g;b`,
 * which consume their extra parameters. Unknown codes are ignored.
 *
 * @param {Style} style - Style in effect before the sequence.
 * @param {number[]} params - Numeric SGR parameters.
 * @returns {Style} The resulting style.
 *
 * @example
 * applySGR({}, [1, 38, 5, 196]); // { bold: true, fg: "rgb(255,0,0)" }
 */
function applySGR(style: Style, params: number[]): Style {
  const s: Style = { ...style };
  if (!params.length) params = [0];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) {
      for (const k of Object.keys(s) as (keyof Style)[]) delete s[k];
    } else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 7) s.inverse = true;
    else if (p === 9) s.strike = true;
    else if (p === 22) {
      delete s.bold;
      delete s.dim;
    } else if (p === 23) delete s.italic;
    else if (p === 24) delete s.underline;
    else if (p === 27) delete s.inverse;
    else if (p === 29) delete s.strike;
    else if (p >= 30 && p <= 37) s.fg = p - 30;
    else if (p >= 90 && p <= 97) s.fg = p - 90 + 8;
    else if (p === 39) delete s.fg;
    else if (p >= 40 && p <= 47) s.bg = p - 40;
    else if (p >= 100 && p <= 107) s.bg = p - 100 + 8;
    else if (p === 49) delete s.bg;
    else if (p === 38 || p === 48) {
      const key = p === 38 ? 'fg' : 'bg';
      if (params[i + 1] === 5 && params[i + 2] !== undefined) {
        s[key] = color256(params[i + 2]);
        i += 2;
      } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
        s[key] = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
        i += 4;
      }
    }
  }
  return s;
}

/**
 * Compare two styles for rendering equality.
 *
 * Colors are compared exactly; boolean attributes treat `undefined` and `false` as equal.
 *
 * @param {Style} a - First style.
 * @param {Style} b - Second style.
 * @returns {boolean} True when both render identically.
 *
 * @example
 * sameStyle({ bold: false }, {}); // true
 */
const sameStyle = (a: Style, b: Style) =>
  a.fg === b.fg && a.bg === b.bg && !!a.bold === !!b.bold && !!a.dim === !!b.dim && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.inverse === !!b.inverse && !!a.strike === !!b.strike;

/**
 * Split text containing ANSI escapes into styled segments.
 *
 * SGR sequences (`ESC[…m`) update the current style; every other escape sequence is dropped.
 * Adjacent text with the same style is merged into one segment and empty runs are skipped.
 * Because SGR state carries across lines, the caller passes the style in effect at the start
 * and receives the style after the text.
 *
 * @param {string} input - Text with ANSI escapes.
 * @param {Style} [start={}] - Style in effect at the beginning of `input`.
 * @returns {{ segs: Segment[]; end: Style }} The styled segments and the final style.
 *
 * @example
 * const { segs, end } = parseAnsi(`${c.red('err')}: x`);
 * // segs: [{ fg: 1, text: "err" }, { text: ": x" }], end: {}
 */
export function parseAnsi(input: string, start: Style = {}): { segs: Segment[]; end: Style } {
  const segs: Segment[] = [];
  let style: Style = start;
  let last = 0;
  /**
   * Append text to the segment list in the current style.
   *
   * Merges the text into the previous segment when its style matches the current one
   * (compared with sameStyle()); otherwise starts a new segment. Empty text is ignored.
   *
   * @param {string} text - Plain text between escape sequences.
   * @returns {void}
   *
   * @example
   * push(input.slice(last, m.index));
   */
  const push = (text: string) => {
    if (!text) return;
    const prev = segs[segs.length - 1];
    if (prev && sameStyle(prev, style)) prev.text += text;
    else segs.push({ ...style, text });
  };
  ESCAPE_RE.lastIndex = 0;
  for (let m = ESCAPE_RE.exec(input); m; m = ESCAPE_RE.exec(input)) {
    push(input.slice(last, m.index));
    last = m.index + m[0].length;
    const seq = m[0];
    if (seq.startsWith('\x1b[') && seq.endsWith('m')) {
      const body = seq.slice(2, -1);
      style = applySGR(style, body ? body.split(';').map((x) => Number(x) || 0) : []);
    }
  }
  push(input.slice(last));
  return { segs, end: style };
}

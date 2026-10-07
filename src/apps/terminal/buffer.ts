import { parseAnsi, stripAnsi, type Segment, type Style } from './shell/ansi';

/** One committed scrollback line, parsed into styled segments. */
export interface Line {
  /** Monotonically increasing id, also used as the React key. */
  id: number;
  segs: Segment[];
}

const MAX_LINES = 5000; /** Number of committed lines kept in the scrollback after trimming. */
const TRIM_SLACK = 250; /** Extra lines allowed beyond MAX_LINES before trimming, so floods of output trim in batches instead of shifting the array on every line. */
const CONTROL = /(\x1b\[[23]J|\x1bc)/; /** Splits output around the clear-screen (ESC[2J, ESC c) and clear-scrollback (ESC[3J) sequences, keeping them as separate chunks. */

/**
 * Scrollback buffer of a terminal window.
 *
 * Output is appended as raw text. Complete lines are parsed into styled segments once, with the
 * SGR style carried over line breaks, while the unterminated last line is kept raw so the prompt
 * and the line editor can be drawn after it. Clearing the screen starts a new "page" instead of
 * dropping lines, so earlier output stays in the scrollback above it.
 *
 * @example
 * const buf = new ScreenBuffer();
 * buf.write('\x1b[32mok\x1b[0m\n% ');
 * console.log(buf.lines.length, buf.pending); // 1 '% '
 */
export class ScreenBuffer {
  /** Committed lines, oldest first. */
  lines: Line[] = [];
  /** Raw text (with escapes) of the current, unterminated line. */
  pending = '';
  /**
   * Id of the first line of the current page. `clear` / ^L start a new page that fills the
   * viewport; earlier lines stay in the scrollback above it.
   */
  pageStart = 1;
  private style: Style = {};
  private nextId = 1;
  private cache: { raw: string; style: Style; segs: Segment[] } | null = null;

  /**
   * Append raw terminal output to the buffer.
   *
   * The text is split around clear sequences: ESC[2J and ESC c start a new page, ESC[3J clears
   * the whole scrollback. Remaining text is normalized from CRLF to LF and every newline commits
   * the pending line. A bare carriage return rewinds to the start of the pending line, discarding
   * what came before it, which lets progress bars and spinners redraw in place.
   *
   * @param {string} text - Raw output, possibly containing ANSI escape sequences.
   * @returns {void}
   *
   * @example
   * buffer.write('Downloading 10%\rDownloading 50%\n');
   * console.log(buffer.text()); // 'Downloading 50%\n'
   */
  write(text: string): void {
    for (const chunk of text.split(CONTROL)) {
      if (!chunk) continue;
      if (chunk === '\x1b[2J' || chunk === '\x1bc') {
        this.clearScreen();
        continue;
      }
      if (chunk === '\x1b[3J') {
        this.clearAll();
        continue;
      }
      const parts = chunk.replace(/\r\n/g, '\n').split('\n');
      parts.forEach((part, i) => {
        const cr = part.lastIndexOf('\r');
        if (cr >= 0) {
          this.pending = '';
          part = part.slice(cr + 1);
        }
        this.pending += part;
        if (i < parts.length - 1) this.commit();
      });
    }
  }

  /**
   * Turn the pending raw line into a committed, styled line.
   *
   * Parses the pending text starting from the current SGR style, stores the style in effect at
   * its end for the next line, and resets the pending text. When the scrollback grows beyond
   * MAX_LINES + TRIM_SLACK, the oldest lines are dropped so exactly MAX_LINES remain.
   *
   * @returns {void}
   *
   * @example
   * this.pending = 'hello';
   * this.commit(); // this.lines ends with a line reading 'hello'
   */
  private commit(): void {
    const { segs, end } = parseAnsi(this.pending, this.style);
    this.lines.push({ id: this.nextId++, segs });
    this.style = end;
    this.pending = '';
    if (this.lines.length > MAX_LINES + TRIM_SLACK) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  /**
   * Styled segments of the unterminated line.
   *
   * The result is memoised and only re-parsed when the pending text or the carried-over style
   * changes, so re-rendering the prompt line is cheap.
   *
   * @returns {Segment[]} Segments of the pending line, styled with the current SGR state.
   *
   * @example
   * buffer.write('\x1b[1m$ ');
   * const segs = buffer.pendingSegments(); // [{ text: '$ ', bold: true }]
   */
  pendingSegments(): Segment[] {
    if (!this.cache || this.cache.raw !== this.pending || this.cache.style !== this.style) {
      this.cache = { raw: this.pending, style: this.style, segs: parseAnsi(this.pending, this.style).segs };
    }
    return this.cache.segs;
  }

  /**
   * Remove and return the raw unterminated line.
   *
   * Used to lift the prompt off the screen so something can be printed above it and the prompt
   * written back afterwards.
   *
   * @returns {string} The raw pending text, including escape sequences.
   *
   * @example
   * const prompt = buffer.takePending();
   * buffer.write('[1]  + done       sleep 1\n' + prompt);
   */
  takePending(): string {
    const p = this.pending;
    this.pending = '';
    return p;
  }

  /**
   * Whether the cursor is at the start of a line.
   *
   * True when the pending line has no visible characters (escape sequences alone do not count).
   *
   * @returns {boolean} True when nothing visible is pending.
   *
   * @example
   * buffer.write('partial');
   * console.log(buffer.atLineStart); // false
   */
  get atLineStart(): boolean {
    return stripAnsi(this.pending) === '';
  }

  /**
   * Start a new page at the next line.
   *
   * Existing lines are kept and remain reachable in the scrollback; the view renders lines from
   * `pageStart` onwards in a block that fills the viewport, pushing older lines out of view.
   *
   * @returns {void}
   *
   * @example
   * buffer.clearScreen();
   * console.log(buffer.pageStart); // id of the next committed line
   */
  clearScreen(): void {
    this.pageStart = this.nextId;
  }

  /**
   * Drop every committed line and start a new page.
   *
   * The pending line is left untouched, so a prompt being edited survives the clear.
   *
   * @returns {void}
   *
   * @example
   * buffer.clearAll();
   * console.log(buffer.lines.length); // 0
   */
  clearAll(): void {
    this.lines = [];
    this.pageStart = this.nextId;
  }

  /**
   * Plain text of everything in the buffer, used by Shell ▸ Export Text As….
   *
   * Joins all committed lines without styling. When the pending line has visible text, it is
   * appended on its own line with escape sequences stripped; otherwise the result ends with a
   * newline.
   *
   * @returns {string} The scrollback as plain text.
   *
   * @example
   * buffer.write('one\ntwo');
   * console.log(buffer.text()); // 'one\ntwo'
   */
  text(): string {
    const body = this.lines.map((l) => l.segs.map((s) => s.text).join('')).join('\n');
    const tail = stripAnsi(this.pending);
    return body + (tail ? `\n${tail}` : '\n');
  }
}

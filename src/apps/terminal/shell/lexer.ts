/**
 * zsh-flavoured lexer: words with '…', "…", $'…' and backslash quoting, $VAR / ${VAR} /
 * ${#VAR} / ${VAR:-default}, $(…) and `…` command substitution, $((…)) arithmetic, comments,
 * and the operators ; & && || | > >> < &> &>> 2> 2>> 2>&1 >&2.
 *
 * Input that ends inside a quote/substitution (or with a trailing backslash) is reported as
 * incomplete so the terminal can show a continuation prompt (dquote>, quote>, …).
 */

/**
 * One piece of a shell word: literal text, a parameter expansion (with an optional `${…}`
 * operator and its argument), a command substitution or an arithmetic expansion. `quoted` records
 * whether the piece appeared inside quotes.
 */
export type WordPart =
  /** `quoted` literal text is never globbed or tilde-expanded. */
  | { type: 'lit'; value: string; quoted: boolean }
  | { type: 'var'; name: string; quoted: boolean; op?: 'len' | 'default' | 'assign' | 'alt'; arg?: string }
  | { type: 'cmd'; source: string; quoted: boolean }
  | { type: 'arith'; expr: string; quoted: boolean };

/** A shell word made of one or more parts. */
export interface WordToken {
  type: 'word';
  parts: WordPart[];
  /** Original source text of the word. */
  raw: string;
}

/** A command separator or control operator. */
export interface OpToken {
  type: 'op';
  /** '\n' separates commands like ';' but may also appear where a command is not expected. */
  op: ';' | '&' | '&&' | '||' | '|' | '\n';
}

/** A redirection operator; its target word (if any) is the following token. */
export interface RedirToken {
  type: 'redir';
  /** 0 stdin, 1 stdout, 2 stderr, 3 = both stdout & stderr (&>). */
  fd: 0 | 1 | 2 | 3;
  mode: 'read' | 'write' | 'append' | 'dup';
  /** For 'dup': the fd this one is duplicated from (2>&1 → 1). */
  dupTo?: 1 | 2;
}

/** Any token produced by `tokenize`. */
export type Token = WordToken | OpToken | RedirToken;

/** Names zsh uses in its continuation prompt (PS2). */
export type Incomplete = 'quote' | 'dquote' | 'bquote' | 'cmdsubst' | 'braceparam' | 'backslash' | 'pipe' | 'cmdand' | 'cmdor';

/** Error for input that cannot be parsed; the message is the zsh-style error text. */
export class ShellSyntaxError extends Error {}

/** Result of `tokenize`: the tokens, or the kind of construct the input left open. */
export type LexResult = { tokens: Token[]; incomplete?: undefined } | { incomplete: Incomplete; tokens?: undefined };

const SPECIAL_VARS = new Set(['?', '$', '#', '@', '*', '!', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-']); /** Single-character special parameters that may follow a bare `$` ($?, $$, $#, $1, …). */

/**
 * Tests whether a character can start a parameter name.
 *
 * Parameter names begin with an ASCII letter or an underscore; digits are only allowed after
 * the first character.
 *
 * @param {string} ch - A single character.
 * @returns {boolean} True when `ch` is a letter or `_`.
 *
 * @example
 * isNameStart('H'); // true
 * isNameStart('1'); // false
 */
const isNameStart = (ch: string) => /[A-Za-z_]/.test(ch);

/**
 * Tests whether a character can continue a parameter name.
 *
 * Accepts ASCII letters, digits and underscores, so `$HOME_2` reads the whole name.
 *
 * @param {string} ch - A single character.
 * @returns {boolean} True when `ch` is a letter, digit or `_`.
 *
 * @example
 * isNameChar('9'); // true
 * isNameChar('/'); // false
 */
const isNameChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);

const BREAK = new Set([' ', '\t', '\n', ';', '&', '|', '<', '>', '(', ')']); /** Characters that end an unquoted word: blanks, newline and operator characters. */

/** Internal signal thrown when the input ends before a quote or substitution is closed. */
class Incompl extends Error {
  kind: Incomplete;

  /**
   * Creates a signal for input that ends inside an open construct.
   *
   * The message is the kind name so the error stays readable if it escapes; `tokenize` catches
   * it and turns it into an `{ incomplete }` result.
   *
   * @param {Incomplete} kind - The construct left open (quote, dquote, cmdsubst, …).
   * @returns {Incompl} The new signal instance.
   *
   * @example
   * throw new Incompl('dquote');
   */
  constructor(kind: Incomplete) {
    super(kind);
    this.kind = kind;
  }
}

/**
 * Finds the `)` that closes a `$(` or `$((` body.
 *
 * Scans from `i` while tracking parenthesis depth. A backslash skips the next character, and
 * single- and double-quoted sections are skipped whole so parentheses inside quotes do not count.
 *
 * @param {string} s - The full source text.
 * @param {number} i - Index of the first character after the opening parenthesis.
 * @returns {number} Index of the matching `)`, or -1 if the input ends first (including inside
 *   an unterminated quote).
 *
 * @example
 * findCloseParen('$(echo (a))', 2); // 10
 */
function findCloseParen(s: string, i: number): number {
  let depth = 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') i += 2;
    else if (ch === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return -1;
      i = j + 1;
    } else if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
      if (i >= s.length) return -1;
      i++;
    } else if (ch === '(') {
      depth++;
      i++;
    } else if (ch === ')') {
      if (--depth === 0) return i;
      i++;
    } else i++;
  }
  return -1;
}

/**
 * Decodes the body of a `$'…'` ANSI-C quoted string.
 *
 * Reads from `i` up to the closing `'`, translating the escapes \n \t \r \a \b \e \E \f \v \\ \'
 * and \", `\xHH` (one or two hex digits) and `\NNN` (one to three octal digits). Unknown escapes
 * are kept verbatim with their backslash, and `\x` without hex digits stays literal.
 *
 * @param {string} s - The full source text.
 * @param {number} i - Index of the first character after `$'`.
 * @returns {{ value: string; end: number }} The decoded text and the index just past the closing quote.
 * @throws {Incompl} With kind `quote` when the closing `'` is missing.
 *
 * @example
 * ansiC("$'a\\tb'", 2); // { value: 'a\tb', end: 7 }
 */
function ansiC(s: string, i: number): { value: string; end: number } {
  let out = '';
  while (i < s.length && s[i] !== "'") {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' };
      if (n in map) {
        out += map[n];
        i += 2;
      } else if (n === 'x') {
        const hex = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 2))?.[0] ?? '';
        out += hex ? String.fromCharCode(parseInt(hex, 16)) : '\\x';
        i += 2 + hex.length;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1))![0];
        out += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
      } else {
        out += '\\' + n;
        i += 2;
      }
    } else out += s[i++];
  }
  if (i >= s.length) throw new Incompl('quote');
  return { value: out, end: i + 1 };
}

/**
 * Parses a `$…` expansion starting at the `$` at index `i`.
 *
 * Recognises `${#VAR}` (length), `${VAR:-x}` (default), `${VAR:=x}` (assign) and `${VAR:+x}`
 * (alternative) with or without the colon, plain `${VAR}`, `$((…))` arithmetic, `$(…)` command
 * substitution, `$NAME` and the single-character special parameters. `$((` is arithmetic only
 * when its matching close is `))`; otherwise it is read as a command substitution whose body
 * starts with a parenthesis.
 *
 * @param {string} s - The full source text.
 * @param {number} i - Index of the `$`.
 * @param {boolean} quoted - Whether the expansion is inside double quotes.
 * @returns {{ part: WordPart; end: number } | null} The parsed part and the index just past it,
 *   or null when the `$` is literal (e.g. followed by a blank or the end of input).
 * @throws {Incompl} With kind `braceparam` or `cmdsubst` when the closing `}` / `)` is missing.
 * @throws {ShellSyntaxError} "bad substitution" for an unsupported `${…}` body.
 *
 * @example
 * readDollar('$HOME/x', 0, false);
 * // { part: { type: 'var', name: 'HOME', quoted: false }, end: 5 }
 */
function readDollar(s: string, i: number, quoted: boolean): { part: WordPart; end: number } | null {
  const n = s[i + 1];
  if (n === '{') {
    const close = s.indexOf('}', i + 2);
    if (close < 0) throw new Incompl('braceparam');
    const body = s.slice(i + 2, close);
    let m: RegExpExecArray | null;
    if ((m = /^#([A-Za-z_][A-Za-z0-9_]*|[?$#@*0-9])$/.exec(body))) return { part: { type: 'var', name: m[1], quoted, op: 'len' }, end: close + 1 };
    if ((m = /^([A-Za-z_][A-Za-z0-9_]*|[?$#@*0-9]):?([-=+])(.*)$/s.exec(body))) {
      const op = m[2] === '-' ? 'default' : m[2] === '=' ? 'assign' : 'alt';
      return { part: { type: 'var', name: m[1], quoted, op, arg: m[3] }, end: close + 1 };
    }
    if (/^([A-Za-z_][A-Za-z0-9_]*|[?$#@*0-9!-])$/.test(body)) return { part: { type: 'var', name: body, quoted }, end: close + 1 };
    throw new ShellSyntaxError(`zsh: bad substitution`);
  }
  if (n === '(' && s[i + 2] === '(') {
    const close = findCloseParen(s, i + 2);
    if (close < 0) throw new Incompl('cmdsubst');
    if (s[close - 1] === ')') return { part: { type: 'arith', expr: s.slice(i + 3, close - 1), quoted }, end: close + 1 };
  }
  if (n === '(') {
    const close = findCloseParen(s, i + 2);
    if (close < 0) throw new Incompl('cmdsubst');
    return { part: { type: 'cmd', source: s.slice(i + 2, close), quoted }, end: close + 1 };
  }
  if (n !== undefined && isNameStart(n)) {
    let j = i + 1;
    while (j < s.length && isNameChar(s[j])) j++;
    return { part: { type: 'var', name: s.slice(i + 1, j), quoted }, end: j };
  }
  if (n !== undefined && SPECIAL_VARS.has(n)) return { part: { type: 'var', name: n, quoted }, end: i + 2 };
  return null;
}

/**
 * Parses a backtick command substitution starting at the opening backtick at index `i`.
 *
 * Collects the source up to the next unescaped backtick. A backslash before a backtick, `\` or
 * `$` is removed; every other character, including other backslashes, is copied unchanged.
 *
 * @param {string} s - The full source text.
 * @param {number} i - Index of the opening backtick.
 * @param {boolean} quoted - Whether the substitution is inside double quotes.
 * @returns {{ part: WordPart; end: number }} A `cmd` part and the index just past the closing backtick.
 * @throws {Incompl} With kind `bquote` when the closing backtick is missing.
 *
 * @example
 * readBacktick('`date`', 0, false);
 * // { part: { type: 'cmd', source: 'date', quoted: false }, end: 6 }
 */
function readBacktick(s: string, i: number, quoted: boolean): { part: WordPart; end: number } {
  let j = i + 1;
  let src = '';
  while (j < s.length && s[j] !== '`') {
    if (s[j] === '\\' && (s[j + 1] === '`' || s[j + 1] === '\\' || s[j + 1] === '$')) {
      src += s[j + 1];
      j += 2;
    } else src += s[j++];
  }
  if (j >= s.length) throw new Incompl('bquote');
  return { part: { type: 'cmd', source: src, quoted }, end: j + 1 };
}

/**
 * Reads one shell word starting at `start`.
 *
 * Consumes characters until an unquoted break character (blank, newline or operator). Handles
 * backslash escapes (backslash-newline is a line continuation and adds nothing), single quotes,
 * double quotes (inside which `$…`, backticks and backslash before `$`, backtick, `"` or `\`
 * stay active), `$'…'` ANSI-C strings, unquoted `$…` expansions and backticks. Adjacent literal
 * text with the same quoting is merged into one part. An opening `"` always adds a quoted literal
 * so `""` still yields an (empty) argument; empty literal parts after the first are dropped when
 * the word has more than one part.
 *
 * @param {string} s - The full source text.
 * @param {number} start - Index of the first character of the word.
 * @returns {{ token: WordToken; end: number }} The word token and the index where it ends.
 * @throws {Incompl} When the input ends inside a quote or substitution, or after a trailing backslash.
 * @throws {ShellSyntaxError} When a `${…}` expansion is malformed.
 *
 * @example
 * readWord('"a b"c rest', 0).token.raw; // '"a b"c'
 */
function readWord(s: string, start: number): { token: WordToken; end: number } {
  const parts: WordPart[] = [];
  /**
   * Appends literal text to the word being built.
   *
   * Merges into the previous part when it is also a literal with the same `quoted` flag;
   * otherwise starts a new literal part.
   *
   * @param {string} value - The literal text to append.
   * @param {boolean} quoted - Whether the text came from a quoted context.
   * @returns {void}
   *
   * @example
   * lit('abc', false);
   */
  const lit = (value: string, quoted: boolean) => {
    const prev = parts[parts.length - 1];
    if (prev && prev.type === 'lit' && prev.quoted === quoted) prev.value += value;
    else parts.push({ type: 'lit', value, quoted });
  };
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (BREAK.has(ch)) break;
    if (ch === '\\') {
      if (i + 1 >= s.length) throw new Incompl('backslash');
      if (s[i + 1] !== '\n') lit(s[i + 1], true);
      i += 2;
    } else if (ch === "'") {
      const close = s.indexOf("'", i + 1);
      if (close < 0) throw new Incompl('quote');
      lit(s.slice(i + 1, close), true);
      i = close + 1;
    } else if (ch === '"') {
      i++;
      let closed = false;
      lit('', true);
      while (i < s.length) {
        const d = s[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\') {
          const n = s[i + 1];
          if (n === undefined) break;
          if (n === '\n') i += 2;
          else if ('$`"\\'.includes(n)) {
            lit(n, true);
            i += 2;
          } else {
            lit('\\', true);
            i++;
          }
        } else if (d === '$') {
          const r = readDollar(s, i, true);
          if (r) {
            parts.push(r.part);
            i = r.end;
          } else {
            lit('$', true);
            i++;
          }
        } else if (d === '`') {
          const r = readBacktick(s, i, true);
          parts.push(r.part);
          i = r.end;
        } else {
          lit(d, true);
          i++;
        }
      }
      if (!closed) throw new Incompl('dquote');
    } else if (ch === '$' && s[i + 1] === "'") {
      const r = ansiC(s, i + 2);
      lit(r.value, true);
      i = r.end;
    } else if (ch === '$') {
      const r = readDollar(s, i, false);
      if (r) {
        parts.push(r.part);
        i = r.end;
      } else {
        lit('$', false);
        i++;
      }
    } else if (ch === '`') {
      const r = readBacktick(s, i, false);
      parts.push(r.part);
      i = r.end;
    } else {
      lit(ch, false);
      i++;
    }
  }
  return { token: { type: 'word', parts: parts.filter((p, k) => !(p.type === 'lit' && p.value === '' && parts.length > 1 && k > 0)), raw: s.slice(start, i) }, end: i };
}

/**
 * Splits shell source into word, operator and redirection tokens.
 *
 * Skips blanks, treats `#` at the start of a token as a comment to the end of the line, emits
 * newlines as `\n` operator tokens, and recognises `&&`, `||`, `&>>`, `&>`, `|`, `;`, `&`, the
 * redirections `<`, `>`, `>>`, `>&N` with an optional leading fd digit 0–2, and words.
 * Multi-character operators are matched before single-character ones. Input that stops inside
 * an open construct yields `{ incomplete }` instead of tokens so the caller can prompt for a
 * continuation line.
 *
 * @param {string} s - The shell source to tokenize.
 * @returns {LexResult} Either `{ tokens }` or `{ incomplete }` naming the open construct.
 * @throws {ShellSyntaxError} On `(` or `)` outside a word (subshells are not supported) or on a
 *   bad `${…}` substitution.
 *
 * @example
 * const { tokens } = tokenize('ls -l | wc -l');
 * console.log(tokens?.length); // 5
 */
export function tokenize(s: string): LexResult {
  const tokens: Token[] = [];
  let i = 0;
  try {
    while (i < s.length) {
      const ch = s[i];
      /**
       * Tests whether the source continues with `str` at the current index.
       *
       * Reads the scan position `i` of the enclosing loop at call time.
       *
       * @param {string} str - The operator text to look for.
       * @returns {boolean} True when `s` contains `str` starting at `i`.
       *
       * @example
       * if (at('&&')) tokens.push({ type: 'op', op: '&&' });
       */
      const at = (str: string) => s.startsWith(str, i);
      if (ch === ' ' || ch === '\t') {
        i++;
      } else if (ch === '\n') {
        tokens.push({ type: 'op', op: '\n' });
        i++;
      } else if (ch === '#') {
        while (i < s.length && s[i] !== '\n') i++;
      } else if (at('&&')) {
        tokens.push({ type: 'op', op: '&&' });
        i += 2;
      } else if (at('||')) {
        tokens.push({ type: 'op', op: '||' });
        i += 2;
      } else if (at('&>>')) {
        tokens.push({ type: 'redir', fd: 3, mode: 'append' });
        i += 3;
      } else if (at('&>')) {
        tokens.push({ type: 'redir', fd: 3, mode: 'write' });
        i += 2;
      } else if (ch === '|' || ch === ';' || ch === '&') {
        tokens.push({ type: 'op', op: ch });
        i++;
      } else if (/[0-2]/.test(ch) && (s[i + 1] === '>' || s[i + 1] === '<')) {
        const fd = Number(ch) as 0 | 1 | 2;
        i++;
        i = readRedirect(s, i, fd, tokens);
      } else if (ch === '>' || ch === '<') {
        i = readRedirect(s, i, ch === '<' ? 0 : 1, tokens);
      } else if (ch === '(' || ch === ')') {
        throw new ShellSyntaxError(`zsh: parse error near \`${ch}'`);
      } else {
        const { token, end } = readWord(s, i);
        tokens.push(token);
        i = end;
      }
    }
  } catch (e) {
    if (e instanceof Incompl) return { incomplete: e.kind };
    throw e;
  }
  return { tokens };
}

/**
 * Reads a redirection operator and appends its token.
 *
 * `<` always becomes a stdin read, `>>` an append, `>&1` / `>&2` a dup of that descriptor, and
 * any other `>` a truncating write.
 *
 * @param {string} s - The full source text.
 * @param {number} i - Index of the `<` or `>` character (after any fd digit).
 * @param {0 | 1 | 2} fd - The descriptor being redirected: the explicit digit, or 0 for `<` and
 *   1 for `>`.
 * @param {Token[]} tokens - The token list the redirection is pushed onto (mutated).
 * @returns {number} The index just past the operator.
 *
 * @example
 * const tokens: Token[] = [];
 * readRedirect('2>&1', 1, 2, tokens); // 4; tokens[0] is { type: 'redir', fd: 2, mode: 'dup', dupTo: 1 }
 */
function readRedirect(s: string, i: number, fd: 0 | 1 | 2, tokens: Token[]): number {
  if (s[i] === '<') {
    tokens.push({ type: 'redir', fd: 0, mode: 'read' });
    return i + 1;
  }
  if (s.startsWith('>>', i)) {
    tokens.push({ type: 'redir', fd, mode: 'append' });
    return i + 2;
  }
  const dup = /^>&([12])/.exec(s.slice(i));
  if (dup) {
    tokens.push({ type: 'redir', fd, mode: 'dup', dupTo: Number(dup[1]) as 1 | 2 });
    return i + 3;
  }
  tokens.push({ type: 'redir', fd, mode: 'write' });
  return i + 1;
}

/**
 * Returns the text of a token that is a single unquoted literal.
 *
 * Such words are candidates for alias expansion and keywords such as `!`. Tokens with quoting,
 * expansions, more than one part, or that are not words yield null.
 *
 * @param {Token | undefined} t - The token to inspect.
 * @returns {string | null} The literal text, or null when the token is not a plain word.
 *
 * @example
 * plainWord(tokenize('ls').tokens![0]); // 'ls'
 * plainWord(tokenize('"ls"').tokens![0]); // null
 */
export function plainWord(t: Token | undefined): string | null {
  if (!t || t.type !== 'word' || t.parts.length !== 1) return null;
  const p = t.parts[0];
  return p.type === 'lit' && !p.quoted ? p.value : null;
}

/**
 * Quotes a string so it can be reused as a single shell word.
 *
 * The empty string becomes `''`, strings made only of safe characters (letters, digits and
 * `_@%+=:,./~-`) are returned unchanged, and anything else is wrapped in single quotes with each
 * embedded `'` written as `'\''`.
 *
 * @param {string} s - The text to quote.
 * @returns {string} A shell-safe representation of `s`.
 *
 * @example
 * shellQuote('notes.txt'); // 'notes.txt'
 * shellQuote('my file'); // "'my file'"
 */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Text utilities: echo, printf, grep, head, tail, wc, sort, uniq, cut, tr, rev, seq, pbcopy/pbpaste. */
import { fs, t, useFS } from '@/kernel';
import { c } from '../ansi';
import type { CommandContext, CommandDef } from '../types';
import { fsErrorText, getopt, padStart, readAllInput, splitLines, usageError } from '../util';

/* ───────────────────────── Escapes & printf ───────────────────────── */

/**
 * Interprets backslash escape sequences.
 *
 * Handles \n \t \r \a \b \f \v \e \E and \\, octal `\0NNN` (up to three
 * digits) and hex `\xHH` (one or two digits). Unknown escapes and a
 * trailing lone backslash are kept literally. `\c` ends the output at that
 * point and sets `stop`, which tells echo and printf to suppress everything
 * after it, including the trailing newline.
 *
 * @param {string} s - Text containing backslash escapes.
 * @returns {{ text: string; stop: boolean }} The expanded text, and whether `\c` was seen.
 *
 * @example
 * processEscapes('a\\tb\\c ignored'); // { text: 'a\tb', stop: true }
 */
export function processEscapes(s: string): { text: string; stop: boolean } {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '\\' || i + 1 >= s.length) {
      out += ch;
      continue;
    }
    const n = s[++i];
    const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', E: '\x1b', '\\': '\\' };
    if (n in simple) out += simple[n];
    else if (n === 'c') return { text: out, stop: true };
    else if (n === '0') {
      const oct = /^[0-7]{0,3}/.exec(s.slice(i + 1))![0];
      out += String.fromCharCode(parseInt(oct || '0', 8));
      i += oct.length;
    } else if (n === 'x') {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1))?.[0];
      if (hex) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += hex.length;
      } else out += '\\x';
    } else out += '\\' + n;
  }
  return { text: out, stop: false };
}

/**
 * Formats arguments the way printf(1) does.
 *
 * Backslash escapes in the format are expanded first. Supports the
 * conversions %s %b %c %d %i %u %o %x %X %f %F %e %E %g %G and %%, the
 * flags `-`, `+`, space, `0` and `#`, a field width and a precision (either
 * may be `*` to take it from the next argument). A numeric argument may be a
 * quoted character (`'A` yields its code point); other non-numbers are
 * reported through `onError` and treated as 0. While arguments remain, the
 * format is applied again, as in `printf "%s\n" a b c`.
 *
 * @param {string} format - printf format string.
 * @param {string[]} args - Arguments consumed by the conversions.
 * @param {(msg: string) => void} [onError=() => {}] - Called with a message for each invalid number.
 * @returns {string} The formatted output.
 * @throws {RangeError} When a precision is larger than 100, the limit of toFixed, toExponential and toPrecision.
 *
 * @example
 * formatPrintf('%-5s|%03d\n', ['ab', '7']); // 'ab   |007\n'
 */
export function formatPrintf(format: string, args: string[], onError: (msg: string) => void = () => {}): string {
  const fmt = processEscapes(format).text;
  let out = '';
  let argi = 0;
  /**
   * Converts a printf argument to a number.
   *
   * A missing or empty argument is 0; a leading quote yields the code point
   * of the next character; anything else is parsed with `Number`, and an
   * invalid value is reported through `onError` and treated as 0.
   *
   * @param {string | undefined} a - The argument text.
   * @returns {number} The numeric value.
   *
   * @example
   * num("'A"); // 65
   */
  const num = (a: string | undefined): number => {
    if (a === undefined || a === '') return 0;
    if (/^['"]./.test(a)) return a.codePointAt(1)!;
    const v = Number(a);
    if (Number.isNaN(v)) {
      onError(`${a}: invalid number`);
      return 0;
    }
    return v;
  };
  for (;;) {
    let consumed = false;
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (ch !== '%') {
        out += ch;
        continue;
      }
      if (fmt[i + 1] === '%') {
        out += '%';
        i++;
        continue;
      }
      const m = /^%([-+ #0]*)(\d+|\*)?(?:\.(\d*|\*))?([sbcdiouxXfFeEgG])/.exec(fmt.slice(i));
      if (!m) {
        out += ch;
        continue;
      }
      i += m[0].length - 1;
      const flags = m[1];
      let width = m[2];
      let prec = m[3];
      const conv = m[4];
      if (width === '*') width = args[argi++] ?? '0';
      if (prec === '*') prec = args[argi++] ?? '0';
      const arg = args[argi++];
      consumed = true;
      let s: string;
      let numeric = true;
      switch (conv) {
        case 's':
          s = arg ?? '';
          if (prec !== undefined && prec !== '') s = s.slice(0, Number(prec));
          numeric = false;
          break;
        case 'b':
          s = processEscapes(arg ?? '').text;
          numeric = false;
          break;
        case 'c':
          s = (arg ?? '')[0] ?? '';
          numeric = false;
          break;
        case 'd':
        case 'i':
        case 'u':
          s = String(Math.trunc(conv === 'u' ? Math.abs(num(arg)) : num(arg)));
          break;
        case 'o':
          s = Math.trunc(num(arg)).toString(8);
          if (flags.includes('#') && s !== '0') s = '0' + s;
          break;
        case 'x':
        case 'X':
          s = Math.trunc(num(arg)).toString(16);
          if (flags.includes('#') && s !== '0') s = '0x' + s;
          if (conv === 'X') s = s.toUpperCase();
          break;
        case 'e':
        case 'E':
          s = num(arg)
            .toExponential(prec ? Number(prec) : 6)
            .replace(/e([+-])(\d)$/, 'e$10$2');
          if (conv === 'E') s = s.toUpperCase();
          break;
        case 'g':
        case 'G':
          s = String(Number(num(arg).toPrecision(prec ? Math.max(1, Number(prec)) : 6)));
          if (conv === 'G') s = s.toUpperCase();
          break;
        default:
          s = num(arg).toFixed(prec !== undefined && prec !== '' ? Number(prec) : 6);
      }
      if (numeric && !s.startsWith('-')) {
        if (flags.includes('+')) s = '+' + s;
        else if (flags.includes(' ')) s = ' ' + s;
      }
      const w = Number(width ?? 0);
      if (s.length < w) {
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && numeric) {
          const sign = /^[+\- ]/.test(s) ? s[0] : '';
          s = sign + s.slice(sign.length).padStart(w - sign.length, '0');
        } else s = s.padStart(w);
      }
      out += s;
    }
    if (!consumed || argi >= args.length) break;
  }
  return out;
}

const echo: CommandDef = {
  name: 'echo',
  builtin: true,
  group: 'text',
  summary: { en: 'write arguments to standard output', ko: '인자를 표준 출력에 쓰기' },
  usage: 'echo [-neE] [string ...]',
  description: {
    en: 'Prints its arguments separated by spaces. Like zsh, backslash escapes such as \\n, \\t and \\e are interpreted.',
    ko: '인자를 공백으로 구분해 출력합니다. zsh처럼 \\n, \\t, \\e 같은 백슬래시 이스케이프를 해석합니다.',
  },
  options: [
    ['-n', { en: 'Do not print the trailing newline', ko: '마지막 줄바꿈 생략' }],
    ['-e', { en: 'Interpret backslash escapes (default)', ko: '백슬래시 이스케이프 해석 (기본값)' }],
    ['-E', { en: 'Do not interpret backslash escapes', ko: '백슬래시 이스케이프를 해석하지 않음' }],
  ],
  /**
   * Writes the arguments to stdout, separated by spaces.
   *
   * Leading option words made only of n, e and E letters are consumed:
   * `-n` drops the trailing newline, `-E` disables escapes and `-e`
   * re-enables them (the last one wins). A single "-" after the options is
   * dropped. Escapes are interpreted by default, as in zsh, and `\c`
   * suppresses the rest of the output including the newline.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * echo.run({ ...ctx, args: ['-n', 'hello\\tworld'] }); // writes 'hello\tworld'
   */
  run(ctx) {
    const args = [...ctx.args];
    let newline = true;
    let escapes = true;
    while (args.length && /^-[neE]+$/.test(args[0])) {
      for (const f of args.shift()!.slice(1)) {
        if (f === 'n') newline = false;
        else if (f === 'e') escapes = true;
        else escapes = false;
      }
    }
    if (args[0] === '-') args.shift();
    const joined = args.join(' ');
    const { text, stop } = escapes ? processEscapes(joined) : { text: joined, stop: false };
    ctx.stdout.write(text + (newline && !stop ? '\n' : ''));
    return 0;
  },
}; /** `echo`: writes its arguments to stdout, interpreting backslash escapes. */

const printf: CommandDef = {
  name: 'printf',
  builtin: true,
  group: 'text',
  summary: { en: 'formatted output', ko: '서식에 맞춰 출력' },
  usage: 'printf format [arguments ...]',
  description: {
    en: 'Formats arguments like the C function: %s strings, %d integers, %f floats, %x hex, %b strings with escapes. The format is reused while arguments remain.',
    ko: 'C 함수처럼 인자를 서식화합니다: %s 문자열, %d 정수, %f 실수, %x 16진수, %b 이스케이프가 있는 문자열. 남은 인자가 있으면 서식을 반복 사용합니다.',
  },
  /**
   * Writes the arguments formatted by the first argument.
   *
   * Delegates to `formatPrintf`. Invalid numeric arguments are reported on
   * stderr and make the exit status 1, while the rest of the output is
   * still written.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 on success; 1 when the format is missing or a number was invalid.
   * @throws {RangeError} When a precision in the format is larger than 100.
   *
   * @example
   * printf.run({ ...ctx, args: ['%s=%d\\n', 'x', '42'] }); // writes 'x=42\n'
   */
  run(ctx) {
    if (!ctx.args.length) return usageError(ctx, 'not enough arguments', 'printf format [arguments ...]');
    let status = 0;
    ctx.stdout.write(
      formatPrintf(ctx.args[0], ctx.args.slice(1), (msg) => {
        ctx.error(msg);
        status = 1;
      }),
    );
    return status;
  },
}; /** `printf`: writes arguments formatted with C-style conversions. */

/* ───────────────────────── Input helpers ───────────────────────── */

/** A named chunk of input text read from a file or from stdin. */
interface Source {
  /** Display name: the operand as typed, a path under a searched directory, or "(standard input)". */
  name: string;
  text: string;
}

/**
 * Reads the inputs of a text command.
 *
 * Reads each named file, or stdin when no files are given or for an operand
 * of "-". Missing files, and directories unless `recursive` is set, are
 * reported on stderr and skipped, setting `failed`. With `recursive`,
 * directories are walked and every text file is included in path order,
 * named relative to the operand. Files whose data lives in `src` (images,
 * PDFs and other binary or URL-backed files) are skipped silently. Reading
 * stops with `interrupted` when terminal input is cancelled with ^C.
 *
 * @async
 * @param {CommandContext} ctx - The running command's context.
 * @param {string[]} files - File operands; an empty list reads stdin.
 * @param {{ recursive?: boolean }} [opts={}] - `recursive` walks directory operands (grep -r).
 * @returns {Promise<{ sources: Source[]; failed: boolean; interrupted: boolean }>} The inputs read, whether any operand failed, and whether stdin was interrupted.
 *
 * @example
 * const { sources, failed, interrupted } = await readSources(ctx, ['notes.txt', '-']);
 */
async function readSources(ctx: CommandContext, files: string[], opts: { recursive?: boolean } = {}): Promise<{ sources: Source[]; failed: boolean; interrupted: boolean }> {
  const sources: Source[] = [];
  let failed = false;
  for (const f of files.length ? files : ['-']) {
    if (f === '-') {
      const text = await readAllInput(ctx);
      if (text === null) return { sources, failed, interrupted: true };
      sources.push({ name: '(standard input)', text });
      continue;
    }
    const path = ctx.resolve(f);
    const node = fs.stat(path);
    if (!node) {
      ctx.error(`${f}: No such file or directory`);
      failed = true;
    } else if (node.type === 'dir') {
      if (opts.recursive) {
        for (const n of fs.walk(path).sort((a, b) => (a.path < b.path ? -1 : 1))) {
          if (n.type === 'file' && !n.src) sources.push({ name: (f.endsWith('/') ? f : f + '/') + n.path.slice(path === '/' ? 1 : path.length + 1), text: n.content ?? '' });
        }
      } else {
        ctx.error(`${f}: Is a directory`);
        failed = true;
      }
    } else if (!node.src) sources.push({ name: f, text: node.content ?? '' });
  }
  return { sources, failed, interrupted: false };
}

/* ───────────────────────── grep ───────────────────────── */

/**
 * Escapes regular-expression metacharacters.
 *
 * Prefixes every character that has a special meaning in a JavaScript
 * RegExp with a backslash, so the string matches itself literally.
 *
 * @param {string} s - Text to escape.
 * @returns {string} A pattern that matches `s` literally.
 *
 * @example
 * escapeRegExp('a.b+c'); // 'a\\.b\\+c'
 */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Converts a POSIX basic regular expression to JavaScript syntax.
 *
 * Basic regular expressions (grep without -E) swap the meaning of escaped
 * and bare `( ) { } | + ?` compared to JavaScript: `a\|b` is alternation,
 * while `a|b` matches literally. Other escapes are passed through
 * unchanged.
 *
 * @param {string} p - Pattern in basic regular expression syntax.
 * @returns {string} The equivalent JavaScript pattern source.
 *
 * @example
 * breToJs('a\\|b'); // 'a|b'
 * breToJs('f(x)'); // 'f\\(x\\)'
 */
function breToJs(p: string): string {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) {
      const n = p[++i];
      out += '(){}|+?'.includes(n) ? n : '\\' + n;
    } else out += '(){}|+?'.includes(ch) ? '\\' + ch : ch;
  }
  return out;
}

const grep: CommandDef = {
  name: 'grep',
  aliases: ['egrep', 'fgrep'],
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'search text for a pattern', ko: '텍스트에서 패턴 검색' },
  usage: 'grep [-cEFHhilnoqrvwx] [-e pattern] [-m num] pattern [file ...]',
  description: {
    en: 'Prints lines that match a regular expression. Reads standard input when no file is given, so it works at the end of a pipe: ls | grep md',
    ko: '정규식과 일치하는 줄을 출력합니다. 파일을 지정하지 않으면 표준 입력을 읽으므로 파이프 끝에서도 동작합니다: ls | grep md',
  },
  options: [
    ['-i', { en: 'Ignore case', ko: '대소문자 무시' }],
    ['-n', { en: 'Prefix each line with its line number', ko: '줄 번호 표시' }],
    ['-r', { en: 'Search directories recursively', ko: '디렉터리를 재귀적으로 검색' }],
    ['-v', { en: 'Select non-matching lines', ko: '일치하지 않는 줄 선택' }],
    ['-c', { en: 'Only print a count of matching lines', ko: '일치하는 줄 수만 출력' }],
    ['-l', { en: 'Only print names of files with matches', ko: '일치하는 파일 이름만 출력' }],
    ['-w', { en: 'Match whole words only', ko: '단어 단위로만 일치' }],
    ['-o', { en: 'Print only the matched parts', ko: '일치한 부분만 출력' }],
    ['-F', { en: 'Pattern is a fixed string', ko: '패턴을 고정 문자열로 취급' }],
  ],
  /**
   * Prints the lines that match a pattern.
   *
   * The pattern comes from `-e` or the first operand. It is a basic regular
   * expression by default, extended with -E (or as `egrep`) and a fixed
   * string with -F (or as `fgrep`). It is compiled with Unicode support when
   * possible, falling back to a non-Unicode RegExp and finally to a literal
   * match if it is still invalid. Input comes from the file operands, the
   * current directory with -r, or stdin. Supports -i, -v, -n, -c, -l, -L,
   * -o, -q, -m, -w, -x, -H / -h and -s; on a TTY, file names, line numbers
   * and matches are colored.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 if any line matched; 1 if none did; 2 on a usage error, or when an input could not be read and nothing matched (unless -s); 130 when interrupted.
   *
   * @example
   * await grep.run({ ...ctx, args: ['-in', 'todo', 'notes.txt'] });
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'cEFGHhiIlLnoqrRsvwxz', values: 'emABC', long: { 'ignore-case': 'i', recursive: 'r', count: 'c', color: 'G', 'line-number': 'n', 'invert-match': 'v' } });
    const usage = 'grep [-abcdDEFGHhIiJLlMmnOopqRSsUVvwXxZz] [-A num] [-B num] [-C[num]]\n\t[-e pattern] [-f file] [--binary-files=value] [--color=when]\n\t[--context[=num]] [--directories=action] [--label] [--line-buffered]\n\t[--null] [pattern] [file ...]';
    if (error) {
      ctx.error(error);
      ctx.stderr.write(`usage: ${usage}\n`);
      return 2;
    }
    const pattern = typeof opts.e === 'string' ? opts.e : operands.shift();
    if (pattern === undefined) {
      ctx.stderr.write(`usage: ${usage}\n`);
      return 2;
    }
    const fixed = opts.F || ctx.name === 'fgrep';
    const extended = opts.E || ctx.name === 'egrep';
    const base = fixed ? escapeRegExp(pattern) : extended ? pattern : breToJs(pattern);
    /**
     * Compiles the search pattern into a global RegExp.
     *
     * Applies -w (whole words, bounded by Unicode letters and digits in
     * Unicode mode or by `\b` otherwise), -x (whole line) and -i (ignore
     * case) to the converted pattern.
     *
     * @param {boolean} unicode - Compile with the `u` flag.
     * @returns {RegExp} The compiled global expression.
     * @throws {SyntaxError} When the pattern is not valid in the requested mode.
     *
     * @example
     * const re = build(true);
     */
    const build = (unicode: boolean) => {
      let src = base;
      if (opts.w) src = unicode ? `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])` : `\\b(?:${src})\\b`;
      if (opts.x) src = `^(?:${src})$`;
      return new RegExp(src, `g${unicode ? 'u' : ''}${opts.i ? 'i' : ''}`);
    };
    let re: RegExp;
    try {
      re = build(true);
    } catch {
      try {
        re = build(false);
      } catch {
        re = new RegExp(escapeRegExp(pattern), `g${opts.i ? 'i' : ''}`);
      }
    }
    const recursive = !!(opts.r || opts.R);
    const { sources, failed, interrupted } = await readSources(ctx, operands.length ? operands : recursive ? ['.'] : [], { recursive });
    if (interrupted) return 130;
    const showName = !opts.h && (opts.H || sources.length > 1 || recursive);
    const color = ctx.stdout.isTTY;
    const max = typeof opts.m === 'string' ? Number(opts.m) : Infinity;
    /**
     * Styles a file name for output.
     *
     * Colors the name magenta when stdout is a TTY; returns it unchanged
     * otherwise.
     *
     * @param {string} n - File name.
     * @returns {string} The styled (or unchanged) name.
     *
     * @example
     * out.push(fname(s.name));
     */
    const fname = (n: string) => (color ? c.magenta(n) : n);
    const sep = color ? c.cyan(':') : ':';
    let matched = false;
    const out: string[] = [];
    for (const s of sources) {
      let count = 0;
      const lines = splitLines(s.text);
      for (let idx = 0; idx < lines.length && count < max; idx++) {
        const line = lines[idx];
        re.lastIndex = 0;
        const hit = re.test(line);
        if (hit === !!opts.v) continue;
        count++;
        matched = true;
        if (opts.q) return 0;
        if (opts.l || opts.c) continue;
        const prefix = (showName ? fname(s.name) + sep : '') + (opts.n ? (color ? c.green(String(idx + 1)) : String(idx + 1)) + sep : '');
        if (opts.o && !opts.v) {
          re.lastIndex = 0;
          for (const m of line.matchAll(re)) if (m[0]) out.push(prefix + (color ? c.bold(c.red(m[0])) : m[0]));
        } else if (color && !opts.v) {
          re.lastIndex = 0;
          out.push(prefix + line.replace(re, (m) => (m ? c.bold(c.red(m)) : m)));
        } else out.push(prefix + line);
      }
      if (opts.l && count) out.push(fname(s.name));
      else if (opts.L && !count) out.push(fname(s.name));
      else if (opts.c) out.push((showName ? fname(s.name) + sep : '') + count);
    }
    if (out.length) ctx.print(out.join('\n'));
    if (failed && !opts.s) return matched ? 0 : 2;
    return matched ? 0 : 1;
  },
}; /** `grep` (aliases `egrep`, `fgrep`): prints lines that match a pattern. */

/* ───────────────────────── head / tail ───────────────────────── */

/**
 * Rewrites the `-5` count shorthand as `-n 5`.
 *
 * Every argument made of a dash followed only by digits is expanded into
 * the two arguments `-n` and the number, so getopt can parse it; other
 * arguments pass through unchanged.
 *
 * @param {string[]} args - Command arguments.
 * @returns {string[]} The arguments with count shorthands expanded.
 *
 * @example
 * normalizeCount(['-5', 'log.txt']); // ['-n', '5', 'log.txt']
 */
const normalizeCount = (args: string[]) => args.flatMap((a) => (/^-\d+$/.test(a) ? ['-n', a.slice(1)] : [a]));

/**
 * Builds the `head` or `tail` command definition.
 *
 * Both commands share option parsing (`-n count`, `-c bytes` and the `-5`
 * shorthand) and print a "==> name <==" header before each input when
 * several are given. `tail` additionally accepts `+N` to start at line (or
 * character) N and `-f` to keep following the files.
 *
 * @param {'head' | 'tail'} which - Which command to build.
 * @returns {CommandDef} The command definition.
 *
 * @example
 * const head = headTail('head');
 */
function headTail(which: 'head' | 'tail'): CommandDef {
  return {
    name: which,
    path: '/usr/bin',
    group: 'text',
    summary: which === 'head' ? { en: 'display the first lines of a file', ko: '파일의 처음 몇 줄 표시' } : { en: 'display the last lines of a file', ko: '파일의 마지막 몇 줄 표시' },
    usage: `${which} [-n count | -c bytes]${which === 'tail' ? ' [-f]' : ''} [file ...]`,
    options: [
      ['-n count', { en: 'Number of lines (default 10)', ko: '표시할 줄 수 (기본값 10)' }],
      ['-c bytes', { en: 'Number of bytes', ko: '표시할 바이트 수' }],
      ...(which === 'tail' ? [['-f', { en: 'Keep printing lines as they are appended to the file (^C to stop)', ko: '파일에 추가되는 내용을 계속 출력 (^C로 중지)' }] as [string, { en: string; ko: string }]] : []),
    ],
    /**
     * Prints the first or last lines (or characters) of each input.
     *
     * The count defaults to 10 lines; with `-c` it counts characters
     * instead. For tail, a count of 0 prints nothing and `+N` prints from
     * line N onward. With `tail -f` and file operands, the command keeps
     * running in `follow` after the initial output.
     *
     * @async
     * @param {CommandContext} ctx - The running command's context.
     * @returns {Promise<number>} 0 on success; 1 on an invalid count or unreadable input; 130 when interrupted, which is also how `tail -f` ends.
     *
     * @example
     * await headTail('tail').run({ ...ctx, args: ['-n', '3', 'log.txt'] });
     */
    async run(ctx) {
      const { opts, operands, error } = getopt(normalizeCount(ctx.args), { flags: which === 'tail' ? 'qrvFf' : 'qv', values: 'nc' });
      if (error) return usageError(ctx, error, `${which} [-n lines | -c bytes] [file ...]`);
      const raw = String(opts.n ?? opts.c ?? '10');
      const fromStart = which === 'tail' && raw.startsWith('+');
      const count = Math.abs(Number(raw));
      if (!Number.isFinite(count)) {
        ctx.error(`illegal line count -- ${raw}`);
        return 1;
      }
      const { sources, failed, interrupted } = await readSources(ctx, operands);
      if (interrupted) return 130;
      const out: string[] = [];
      sources.forEach((s, i) => {
        if (sources.length > 1) out.push(`${i ? '\n' : ''}==> ${s.name} <==\n`);
        if (opts.c) {
          out.push(which === 'head' ? s.text.slice(0, count) : fromStart ? s.text.slice(count - 1) : s.text.slice(-count || s.text.length));
          return;
        }
        const lines = splitLines(s.text);
        const pick = which === 'head' ? lines.slice(0, count) : fromStart ? lines.slice(Math.max(0, count - 1)) : count === 0 ? [] : lines.slice(-count);
        if (pick.length) out.push(pick.join('\n') + '\n');
      });
      ctx.stdout.write(out.join(''));
      if (which === 'tail' && (opts.f || opts.F) && operands.length) return follow(ctx, operands);
      return failed ? 1 : 0;
    },
  };
}

/**
 * Follows files like `tail -f` until the command is interrupted.
 *
 * Subscribes to the virtual file system store and, whenever its nodes
 * change, compares each watched file with the content seen last. Appended
 * text is written to stdout; if the content does not start with the
 * previous text, a "file truncated" notice goes to stderr and the whole new
 * content is written. With several files, a "==> name <==" header is
 * printed whenever output switches to a different file. Because the disk is
 * shared, writes from any source (another Terminal window, TextEdit, a
 * shell redirect) are picked up.
 *
 * @param {CommandContext} ctx - The running command's context.
 * @param {string[]} names - File operands as typed.
 * @returns {Promise<number>} Resolves with 130 once the command is interrupted.
 *
 * @example
 * return follow(ctx, ['server.log']);
 */
function follow(ctx: CommandContext, names: string[]): Promise<number> {
  const watched = names.map((name) => {
    const path = ctx.resolve(name);
    return { name, path, text: fs.stat(path)?.content ?? '' };
  });
  let lastShown = watched[watched.length - 1];
  /**
   * Writes the new content of every watched file.
   *
   * Reads each watched path again (missing files, directories and
   * `src`-backed files count as empty) and prints the difference from the
   * last seen text, updating the stored text afterwards.
   *
   * @returns {void}
   *
   * @example
   * if (state.nodes !== prev.nodes) check();
   */
  const check = () => {
    for (const w of watched) {
      const node = fs.stat(w.path);
      const text = node?.type === 'file' && !node.src ? node.content ?? '' : '';
      if (text === w.text) continue;
      if (watched.length > 1 && lastShown !== w) ctx.stdout.write(`\n==> ${w.name} <==\n`);
      lastShown = w;
      if (text.startsWith(w.text)) ctx.stdout.write(text.slice(w.text.length));
      else {
        ctx.stderr.write(`tail: ${w.name}: file truncated\n`);
        ctx.stdout.write(text);
      }
      w.text = text;
    }
  };
  return new Promise((resolve) => {
    if (ctx.signal.aborted) return resolve(130);
    const unsubscribe = useFS.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes) check();
    });
    ctx.signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        resolve(130);
      },
      { once: true },
    );
  });
}

/* ───────────────────────── wc ───────────────────────── */

const wc: CommandDef = {
  name: 'wc',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'word, line and byte count', ko: '단어, 줄, 바이트 수 세기' },
  usage: 'wc [-clmw] [file ...]',
  options: [
    ['-l', { en: 'Lines', ko: '줄 수' }],
    ['-w', { en: 'Words', ko: '단어 수' }],
    ['-c', { en: 'Bytes', ko: '바이트 수' }],
    ['-m', { en: 'Characters', ko: '문자 수' }],
  ],
  /**
   * Counts lines, words, bytes and characters.
   *
   * Without -l, -w, -c or -m prints lines, words and bytes; `-m` (characters)
   * takes the place of `-c`. Bytes are UTF-8 encoded lengths and characters
   * are code points. A total row is added when more than one input was
   * counted.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 on a usage error or unreadable input; 130 when interrupted.
   *
   * @example
   * await wc.run({ ...ctx, args: ['-l', 'notes.txt'] }); // '      12 notes.txt'
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'clmwL' });
    if (error) return usageError(ctx, error, 'wc [-Lclmw] [file ...]');
    const pick = opts.l || opts.w || opts.c || opts.m ? { l: !!opts.l, w: !!opts.w, c: !!opts.c && !opts.m, m: !!opts.m } : { l: true, w: true, c: true, m: false };
    const { sources, failed, interrupted } = await readSources(ctx, operands);
    if (interrupted) return 130;
    const enc = new TextEncoder();
    const totals = { l: 0, w: 0, c: 0, m: 0 };
    /**
     * Formats one output row of counts.
     *
     * Prints the selected counts in line, word, byte, character order, each
     * right-aligned in 8 columns, followed by the name when one is given.
     *
     * @param {{ l: number; w: number; c: number; m: number }} n - Line, word, byte and character counts.
     * @param {string} name - Input name, or '' to omit it.
     * @returns {string} The formatted row.
     *
     * @example
     * out.push(row(totals, 'total'));
     */
    const row = (n: typeof totals, name: string) =>
      (['l', 'w', 'c', 'm'] as const)
        .filter((k) => pick[k])
        .map((k) => padStart(n[k], 8))
        .join('') + (name ? ` ${name}` : '');
    const out: string[] = [];
    for (const s of sources) {
      const n = { l: (s.text.match(/\n/g) ?? []).length, w: (s.text.match(/\S+/g) ?? []).length, c: enc.encode(s.text).length, m: [...s.text].length };
      for (const k of ['l', 'w', 'c', 'm'] as const) totals[k] += n[k];
      out.push(row(n, operands.length ? s.name : ''));
    }
    if (sources.length > 1) out.push(row(totals, 'total'));
    if (out.length) ctx.print(out.join('\n'));
    return failed ? 1 : 0;
  },
}; /** `wc`: counts lines, words, bytes and characters. */

/* ───────────────────────── sort / uniq / cut / tr / rev ───────────────────────── */

const sort: CommandDef = {
  name: 'sort',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'sort lines of text', ko: '텍스트 줄 정렬' },
  usage: 'sort [-fnru] [-k field] [-t sep] [file ...]',
  options: [
    ['-r', { en: 'Reverse the result', ko: '역순 정렬' }],
    ['-n', { en: 'Compare numerically', ko: '숫자로 비교' }],
    ['-u', { en: 'Output only unique lines', ko: '중복 줄 제거' }],
    ['-f', { en: 'Ignore case', ko: '대소문자 무시' }],
    ['-k n', { en: 'Sort by the n-th field', ko: 'n번째 필드로 정렬' }],
    ['-t c', { en: 'Field separator', ko: '필드 구분자' }],
  ],
  /**
   * Sorts the lines of all inputs.
   *
   * Supports -r (reverse), -n / -g / -h (numeric), -f (ignore case), -u
   * (drop lines whose keys compare equal to the previous line), -k (sort
   * from field N) and -t (field separator). Other common GNU/BSD flags are
   * accepted and ignored.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 on a usage error; 2 when an input could not be read; 130 when interrupted.
   *
   * @example
   * await sort.run({ ...ctx, args: ['-rn', 'scores.txt'] });
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'bdfgMnRruVhs', values: 'ktoS' });
    if (error) return usageError(ctx, error, 'sort [-bcCdfghiRMmnrsuVz] [-k field1[,field2]] [-o output] [-S memsize] [-T dir] [-t char] [file ...]');
    const { sources, failed, interrupted } = await readSources(ctx, operands);
    if (interrupted) return 130;
    const lines = sources.flatMap((s) => splitLines(s.text));
    const field = typeof opts.k === 'string' ? Math.max(1, parseInt(opts.k, 10) || 1) : 0;
    const sep = typeof opts.t === 'string' ? opts.t : null;
    /**
     * Extracts the sort key of a line.
     *
     * With -k N, returns the line from field N onward, split on the -t
     * separator or on runs of whitespace; without -k, the whole line.
     *
     * @param {string} l - Input line.
     * @returns {string} The key to compare.
     *
     * @example
     * key('alice 42'); // '42' with -k 2
     */
    const key = (l: string) => {
      if (!field) return l;
      const parts = sep ? l.split(sep) : l.trim().split(/\s+/);
      return parts.slice(field - 1).join(sep ?? ' ');
    };
    const numeric = opts.n || opts.g || opts.h;
    /**
     * Compares two lines for sorting.
     *
     * In numeric modes, compares the leading numbers of the keys (non-numbers
     * count as 0) and breaks ties with a locale comparison of the whole lines.
     * With -f, compares keys case-insensitively; otherwise by code unit.
     *
     * @param {string} a - First line.
     * @param {string} b - Second line.
     * @returns {number} Negative, zero or positive, as `Array.prototype.sort` expects.
     *
     * @example
     * [...lines].sort(cmp);
     */
    const cmp = (a: string, b: string) => {
      const ka = key(a);
      const kb = key(b);
      if (numeric) return (parseFloat(ka) || 0) - (parseFloat(kb) || 0) || a.localeCompare(b);
      return opts.f ? ka.localeCompare(kb, undefined, { sensitivity: 'base' }) : ka < kb ? -1 : ka > kb ? 1 : 0;
    };
    let sorted = [...lines].sort(cmp);
    if (opts.r) sorted.reverse();
    if (opts.u) sorted = sorted.filter((l, i) => i === 0 || cmp(sorted[i - 1], l) !== 0);
    if (sorted.length) ctx.print(sorted.join('\n'));
    return failed ? 2 : 0;
  },
}; /** `sort`: sorts lines of text. */

const uniq: CommandDef = {
  name: 'uniq',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'report or filter out repeated lines', ko: '연속된 중복 줄 걸러내기' },
  usage: 'uniq [-cdiu] [input]',
  options: [
    ['-c', { en: 'Prefix lines with the number of occurrences', ko: '줄 앞에 반복 횟수 표시' }],
    ['-d', { en: 'Only repeated lines', ko: '중복된 줄만' }],
    ['-u', { en: 'Only unique lines', ko: '중복되지 않은 줄만' }],
    ['-i', { en: 'Ignore case', ko: '대소문자 무시' }],
  ],
  /**
   * Collapses adjacent duplicate lines.
   *
   * Reads only the first operand (or stdin). Each run of equal adjacent
   * lines is printed once; -c prefixes the run length, -d keeps only runs
   * that repeated, -u keeps only lines that did not, and -i compares lines
   * case-insensitively.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 on a usage error or unreadable input; 130 when interrupted.
   *
   * @example
   * await uniq.run({ ...ctx, args: ['-c'], stdin: 'a\na\nb\n' }); // '   2 a\n   1 b'
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'cdiu' });
    if (error) return usageError(ctx, error, 'uniq [-c | -d | -D | -u] [-i] [-f fields] [-s chars] [input [output]]');
    const { sources, failed, interrupted } = await readSources(ctx, operands.slice(0, 1));
    if (interrupted) return 130;
    const lines = sources.flatMap((s) => splitLines(s.text));
    /**
     * Tests whether two lines count as duplicates.
     *
     * Compares exactly, or case-insensitively with -i.
     *
     * @param {string} a - First line.
     * @param {string} b - Second line.
     * @returns {boolean} True when the lines are considered equal.
     *
     * @example
     * same('Apple', 'apple'); // true with -i
     */
    const same = (a: string, b: string) => (opts.i ? a.toLowerCase() === b.toLowerCase() : a === b);
    const out: string[] = [];
    for (let i = 0; i < lines.length; ) {
      let j = i + 1;
      while (j < lines.length && same(lines[i], lines[j])) j++;
      const n = j - i;
      if (!(opts.d && n < 2) && !(opts.u && n > 1)) out.push(opts.c ? `${padStart(n, 4)} ${lines[i]}` : lines[i]);
      i = j;
    }
    if (out.length) ctx.print(out.join('\n'));
    return failed ? 1 : 0;
  },
}; /** `uniq`: collapses or filters adjacent repeated lines. */

/**
 * Parses a cut list into a position predicate.
 *
 * Accepts comma-separated items of the forms `N`, `N-M`, `N-` (to the end)
 * and `-M` (from the start); positions are 1-based and inclusive.
 *
 * @param {string} list - The list, e.g. "1,3-5,7-".
 * @returns {((n: number) => boolean) | null} A predicate that tests a 1-based position, or null when the list is malformed.
 *
 * @example
 * parseList('1,3-5')?.(4); // true
 */
function parseList(list: string): ((n: number) => boolean) | null {
  const ranges: [number, number][] = [];
  for (const part of list.split(',')) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : Infinity) : a;
    ranges.push([a, b]);
  }
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

const cut: CommandDef = {
  name: 'cut',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'cut out selected portions of each line', ko: '각 줄에서 선택한 부분 잘라내기' },
  usage: 'cut -c list | -f list [-d delim] [file ...]',
  options: [
    ['-f list', { en: 'Fields, e.g. 1,3 or 2-', ko: '필드 (예: 1,3 또는 2-)' }],
    ['-d c', { en: 'Field delimiter (default tab)', ko: '필드 구분자 (기본값 탭)' }],
    ['-c list', { en: 'Characters', ko: '문자 위치' }],
  ],
  /**
   * Prints selected characters or fields of each line.
   *
   * `-c` and `-b` select character positions; `-f` selects fields split on
   * the `-d` delimiter (its first character, tab by default). Lines without
   * the delimiter are printed whole, or dropped with `-s`.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 on a missing or invalid list, a usage error or unreadable input; 130 when interrupted.
   *
   * @example
   * await cut.run({ ...ctx, args: ['-d', ':', '-f', '1'], stdin: 'root:x:0\n' }); // 'root'
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'sn', values: 'bcdf' });
    const usage = 'cut -b list [-n] [file ...]\n       cut -c list [file ...]\n       cut -f list [-s] [-w | -d delim] [file ...]';
    if (error || !(opts.c || opts.f || opts.b)) return usageError(ctx, error ?? 'missing list', usage);
    const sel = parseList(String(opts.c ?? opts.f ?? opts.b));
    if (!sel) {
      ctx.error('[-bcf] list: illegal list value');
      return 1;
    }
    const delim = typeof opts.d === 'string' ? opts.d[0] ?? '\t' : '\t';
    const { sources, failed, interrupted } = await readSources(ctx, operands);
    if (interrupted) return 130;
    const out = sources
      .flatMap((s) => splitLines(s.text))
      .flatMap((l) => {
        if (!opts.f) return [[...l].filter((_, i) => sel(i + 1)).join('')];
        if (!l.includes(delim)) return opts.s ? [] : [l];
        return [l.split(delim).filter((_, i) => sel(i + 1)).join(delim)];
      });
    if (out.length) ctx.print(out.join('\n'));
    return failed ? 1 : 0;
  },
}; /** `cut`: prints selected characters or fields of each line. */

/**
 * Expands a tr character set into individual characters.
 *
 * Replaces the POSIX classes [:upper:], [:lower:], [:digit:], [:space:],
 * [:blank:], [:punct:], [:alpha:] and [:alnum:] with their ASCII members
 * (escaping `\` and `-` inside them so they stay literal), interprets
 * backslash escapes, and expands `a-z` style ranges by code point. Unknown
 * classes are kept as literal text.
 *
 * @param {string} set - The set as written on the command line.
 * @returns {string[]} The characters of the set, in order.
 *
 * @example
 * expandSet('a-e'); // ['a', 'b', 'c', 'd', 'e']
 */
function expandSet(set: string): string[] {
  const classes: Record<string, string> = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    digit: '0123456789',
    space: ' \t\n\r\f\v',
    blank: ' \t',
    punct: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  };
  classes.alpha = classes.upper + classes.lower;
  classes.alnum = classes.alpha + classes.digit;
  const chars = [...processEscapes(set.replace(/\[:(\w+):\]/g, (m, k: string) => (classes[k] ? classes[k].replace(/[\\-]/g, '\\$&') : m))).text];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i + 1] === '-' && chars[i + 2] !== undefined) {
      const a = chars[i].codePointAt(0)!;
      const b = chars[i + 2].codePointAt(0)!;
      for (let k = a; k <= b; k++) out.push(String.fromCodePoint(k));
      i += 2;
    } else out.push(chars[i]);
  }
  return out;
}

const tr: CommandDef = {
  name: 'tr',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'translate characters', ko: '문자 변환' },
  usage: 'tr [-ds] string1 [string2]',
  description: {
    en: 'Copies standard input to standard output, replacing characters of string1 with those of string2. Example: echo hello | tr a-z A-Z',
    ko: '표준 입력을 표준 출력으로 복사하면서 string1의 문자를 string2의 문자로 바꿉니다. 예: echo hello | tr a-z A-Z',
  },
  options: [
    ['-d', { en: 'Delete characters in string1', ko: 'string1의 문자 삭제' }],
    ['-s', { en: 'Squeeze repeated characters', ko: '반복되는 문자를 하나로' }],
  ],
  /**
   * Translates, deletes or squeezes characters from stdin.
   *
   * Each input character found in string1 is replaced by the character at
   * the same position in string2, whose last character repeats when it is
   * shorter. `-d` deletes the characters of string1 instead. `-s` collapses
   * runs of the same output character when it belongs to the squeeze set:
   * string2 when given (also with -ds), otherwise string1.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 on a usage error; 130 when interrupted.
   *
   * @example
   * await tr.run({ ...ctx, args: ['a-z', 'A-Z'], stdin: 'hello\n' }); // writes 'HELLO\n'
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'dsCcu' });
    const usage = 'tr [-Ccsu] string1 string2\n       tr [-Ccu] -d string1\n       tr [-Ccu] -s string1\n       tr [-Ccu] -ds string1 string2';
    if (error || !operands.length || (!opts.d && !opts.s && operands.length < 2)) return usageError(ctx, error ?? 'missing operand', usage);
    const input = await readAllInput(ctx);
    if (input === null) return 130;
    const from = expandSet(operands[0]);
    const to = operands[1] !== undefined ? expandSet(operands[1]) : [];
    let out = '';
    let prev = '';
    for (const ch of input) {
      const idx = from.indexOf(ch);
      let mapped = ch;
      if (opts.d && idx >= 0) continue;
      if (!opts.d && idx >= 0 && to.length) mapped = to[Math.min(idx, to.length - 1)];
      const squeezeSet = opts.d ? to : to.length ? to : from;
      if (opts.s && mapped === prev && squeezeSet.includes(mapped)) continue;
      out += mapped;
      prev = mapped;
    }
    ctx.stdout.write(out);
    return 0;
  },
}; /** `tr`: translates, deletes or squeezes characters from stdin. */

const rev: CommandDef = {
  name: 'rev',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'reverse lines character by character', ko: '각 줄의 문자 순서 뒤집기' },
  usage: 'rev [file ...]',
  /**
   * Reverses each line character by character.
   *
   * Reads the file operands (or stdin) and prints every line with its code
   * points in reverse order, so non-ASCII characters stay intact.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 when an input could not be read; 130 when interrupted.
   *
   * @example
   * await rev.run({ ...ctx, args: [], stdin: 'hello\n' }); // 'olleh'
   */
  async run(ctx) {
    const { sources, failed, interrupted } = await readSources(ctx, ctx.args);
    if (interrupted) return 130;
    const out = sources.flatMap((s) => splitLines(s.text)).map((l) => [...l].reverse().join(''));
    if (out.length) ctx.print(out.join('\n'));
    return failed ? 1 : 0;
  },
}; /** `rev`: reverses each line character by character. */

const seq: CommandDef = {
  name: 'seq',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'print sequences of numbers', ko: '숫자 수열 출력' },
  usage: 'seq [first [incr]] last',
  /**
   * Prints a sequence of numbers.
   *
   * Accepts `last`, `first last` or `first incr last` (first and incr
   * default to 1). Values are rounded to 10 decimal places to hide
   * floating-point drift, and output stops after 100,001 numbers. `-w`
   * zero-pads every number to the same width and `-s` sets the separator.
   * A zero increment, or a range that runs against the increment by more
   * than 1e9, returns 1 without output.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 on success; 1 on an invalid argument or range.
   *
   * @example
   * seq.run({ ...ctx, args: ['1', '2', '7'] }); // writes '1\n3\n5\n7\n'
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'w', values: 's' });
    const nums = operands.map(Number);
    if (error || !nums.length || nums.length > 3 || nums.some(Number.isNaN)) return usageError(ctx, error ?? 'invalid argument', 'seq [-w] [-f format] [-s string] [-t string] [first [incr]] last');
    const [first, incr, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
    if (incr === 0 || (incr > 0 && first > last + 1e9) || (incr < 0 && first < last - 1e9)) return 1;
    const out: string[] = [];
    for (let v = first; incr > 0 ? v <= last : v >= last; v += incr) {
      out.push(String(Math.round(v * 1e10) / 1e10));
      if (out.length > 100_000) break;
    }
    const width = opts.w ? Math.max(...out.map((s) => s.length)) : 0;
    if (out.length) ctx.stdout.write(out.map((s) => s.padStart(width, '0')).join(typeof opts.s === 'string' ? opts.s : '\n') + '\n');
    return 0;
  },
}; /** `seq`: prints a sequence of numbers. */

/* ───────────────────────── Clipboard ───────────────────────── */

const pbcopy: CommandDef = {
  name: 'pbcopy',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'copy standard input to the clipboard', ko: '표준 입력을 클립보드에 복사' },
  usage: 'pbcopy < file   |   command | pbcopy',
  /**
   * Copies stdin to the host clipboard.
   *
   * Reads all input (interactively until ^D when stdin is the terminal) and
   * writes it with the asynchronous Clipboard API. A rejected write, for
   * example without clipboard permission, is reported on stderr.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 when the clipboard is unavailable; 130 when interrupted.
   *
   * @example
   * await pbcopy.run({ ...ctx, args: [], stdin: 'copied text' });
   */
  async run(ctx) {
    const text = await readAllInput(ctx);
    if (text === null) return 130;
    try {
      await navigator.clipboard.writeText(text);
      return 0;
    } catch (e) {
      ctx.error(`${t({ en: 'clipboard unavailable', ko: '클립보드를 사용할 수 없습니다' })}: ${fsErrorText(e)}`);
      return 1;
    }
  },
}; /** `pbcopy`: copies stdin to the host clipboard. */

const pbpaste: CommandDef = {
  name: 'pbpaste',
  path: '/usr/bin',
  group: 'text',
  summary: { en: 'print the clipboard contents', ko: '클립보드 내용 출력' },
  usage: 'pbpaste',
  /**
   * Writes the host clipboard's text to stdout.
   *
   * Reads the clipboard with the asynchronous Clipboard API; a rejected
   * read, for example without clipboard permission, is reported on stderr.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 on success; 1 when the clipboard is unavailable.
   *
   * @example
   * await pbpaste.run(ctx); // writes the clipboard text
   */
  async run(ctx) {
    try {
      ctx.stdout.write(await navigator.clipboard.readText());
      return 0;
    } catch (e) {
      ctx.error(`${t({ en: 'clipboard unavailable', ko: '클립보드를 사용할 수 없습니다' })}: ${fsErrorText(e)}`);
      return 1;
    }
  },
}; /** `pbpaste`: writes the host clipboard's text to stdout. */

export const TEXT_COMMANDS: CommandDef[] = [echo, printf, grep, headTail('head'), headTail('tail'), wc, sort, uniq, cut, tr, rev, seq, pbcopy, pbpaste]; /** The text command definitions, merged into the shell's command registry. */

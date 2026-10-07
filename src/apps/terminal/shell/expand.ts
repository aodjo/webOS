/**
 * Word expansion in zsh order: brace → tilde → parameter / command substitution → globbing.
 *
 * zsh semantics worth noting: unquoted $VAR is NOT word-split (unlike bash) but unquoted $(cmd)
 * is; a glob that matches nothing is an error ("no matches found") rather than a literal.
 */
import { fs, normalize } from '@/kernel';
import { ArithError, evaluate } from './arith';
import { tokenize, type WordPart, type WordToken } from './lexer';

/** Shell state that word expansion reads and writes. */
export interface ExpandContext {
  cwd: string;
  home: string;
  getVar(name: string): string | undefined;
  setVar(name: string, value: string): void;
  /** Run a command substitution and return its stdout. */
  commandSubst(source: string): Promise<string>;
}

/** Error for a failed expansion; the message is the zsh-style error text. */
export class ExpansionError extends Error {}

/* ───────────────────────── Globbing ───────────────────────── */

/**
 * Tests whether an escaped pattern contains active glob characters.
 *
 * Backslash-escaped characters are skipped. `*` and `?` count, and `[` counts only when a `]`
 * appears at least two characters later (so `[]` alone is literal).
 *
 * @param {string} pattern - A glob pattern in which quoted characters are backslash-escaped.
 * @returns {boolean} True when the pattern would match by globbing.
 *
 * @example
 * hasGlob('*.txt'); // true
 * hasGlob('\\*.txt'); // false
 */
export function hasGlob(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') i++;
    else if (ch === '*' || ch === '?') return true;
    else if (ch === '[' && pattern.indexOf(']', i + 2) > 0) return true;
  }
  return false;
}

/**
 * Removes glob escaping from a pattern.
 *
 * Every backslash is dropped and the character after it is kept literally.
 *
 * @param {string} pattern - An escaped glob pattern.
 * @returns {string} The pattern with escapes removed.
 *
 * @example
 * unescapeGlob('a\\*b'); // 'a*b'
 */
export function unescapeGlob(pattern: string): string {
  return pattern.replace(/\\(.)/gs, '$1');
}

/**
 * Escapes glob metacharacters so the text matches literally.
 *
 * Prefixes `\`, `*`, `?`, `[` and `]` with a backslash.
 *
 * @param {string} text - Literal text.
 * @returns {string} The text as a glob pattern that matches only itself.
 *
 * @example
 * escapeGlob('a*b'); // 'a\\*b'
 */
export function escapeGlob(text: string): string {
  return text.replace(/[\\*?[\]]/g, '\\$&');
}

/**
 * Compiles one path-component glob pattern to an anchored RegExp.
 *
 * Supports `*`, `?`, bracket classes `[a-z]` with `!` or `^` negation, and backslash escapes.
 * A `[` without a closing `]` matches a literal `[`. All other characters are escaped for the
 * RegExp, so the result matches the whole name.
 *
 * @param {string} pattern - The component pattern (no `/`).
 * @param {string} [flags=''] - RegExp flags, e.g. `'i'` for case-insensitive matching.
 * @returns {RegExp} A RegExp anchored with `^` and `$`.
 *
 * @example
 * globToRegExp('*.md').test('README.md'); // true
 */
export function globToRegExp(pattern: string, flags = ''): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (ch === '[') {
      const close = pattern.indexOf(']', i + 2);
      if (close < 0) {
        re += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, close);
      const negate = body[0] === '!' || body[0] === '^';
      if (negate) body = body.slice(1);
      re += `[${negate ? '^' : ''}${body.replace(/[\\\]]/g, '\\$&')}]`;
      i = close;
    } else re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(re + '$', flags);
}

/**
 * Tests whether a name matches a glob pattern (a simple fnmatch).
 *
 * Compiles the pattern with `globToRegExp` (adding the `i` flag when `ignoreCase` is set) and
 * tests the whole name against it; `/` gets no special treatment.
 *
 * @param {string} pattern - The glob pattern.
 * @param {string} name - The name to test.
 * @param {boolean} [ignoreCase=false] - Match case-insensitively.
 * @returns {boolean} True when the whole name matches.
 *
 * @example
 * globMatch('*.TXT', 'notes.txt', true); // true
 */
export function globMatch(pattern: string, name: string, ignoreCase = false): boolean {
  return globToRegExp(pattern, ignoreCase ? 'i' : '').test(name);
}

const collator = new Intl.Collator(undefined, { numeric: false, sensitivity: 'variant' }); /** Locale-aware, non-numeric collator that orders glob matches within a directory. */

/**
 * Expands a glob pattern against the virtual FS.
 *
 * The pattern is matched one path component at a time over a list of candidates, each a pair of
 * the display path (what is returned) and the absolute path (what is looked up). Relative
 * patterns are matched under `cwd` and returned relative, like zsh. A `**` component that is not
 * last matches zero or more directories, skipping hidden ones. Components with glob characters
 * are matched against directory entries, sorted with the collator; names starting with `.` match
 * only when the component itself starts with `.`. Intermediate glob components only match
 * directories. Literal components just check that the path exists. Duplicates are removed.
 *
 * @param {string} pattern - The escaped glob pattern (may contain `/`).
 * @param {string} cwd - The directory relative patterns are resolved against.
 * @returns {string[]} The matching paths, in display form; empty when nothing matches.
 *
 * @example
 * glob('*.md', '/Users/guest'); // ['README.md', ...]
 */
export function glob(pattern: string, cwd: string): string[] {
  const absolute = pattern.startsWith('/');
  const comps = pattern.split('/').filter((c, i) => c !== '' || i === 0);
  if (absolute) comps.shift();
  let current: [string, string][] = [[absolute ? '/' : '', absolute ? '/' : normalize(cwd)]];
  /**
   * Appends a name to a display path.
   *
   * An empty display path yields the bare name, and no extra `/` is added after a trailing slash.
   *
   * @param {string} display - The display path so far.
   * @param {string} name - The name (or relative path) to append.
   * @returns {string} The joined display path.
   *
   * @example
   * join('docs', 'a.md'); // 'docs/a.md'
   */
  const join = (display: string, name: string) => (display === '' ? name : display.endsWith('/') ? display + name : `${display}/${name}`);

  comps.forEach((comp, idx) => {
    const last = idx === comps.length - 1;
    const next: [string, string][] = [];
    if (comp === '**' && !last) {
      for (const [disp, abs] of current) {
        next.push([disp, abs]);
        if (!fs.isDir(abs)) continue;
        for (const n of fs.walk(abs)) {
          if (n.type !== 'dir') continue;
          const rel = n.path.slice(abs === '/' ? 1 : abs.length + 1);
          if (rel.split('/').some((s) => s.startsWith('.'))) continue;
          next.push([join(disp, rel), n.path]);
        }
      }
    } else if (hasGlob(comp)) {
      const re = globToRegExp(comp);
      const dotOk = comp.startsWith('.') || comp.startsWith('\\.');
      for (const [disp, abs] of current) {
        if (!fs.isDir(abs)) continue;
        const names = fs
          .readdir(abs)
          .filter((n) => (dotOk || !n.name.startsWith('.')) && re.test(n.name) && (last || n.type === 'dir'))
          .map((n) => n.name)
          .sort(collator.compare);
        for (const name of names) next.push([join(disp, name), normalize(`${abs}/${name}`)]);
      }
    } else {
      const name = unescapeGlob(comp);
      for (const [disp, abs] of current) {
        const p = normalize(`${abs}/${name}`);
        if (fs.exists(p)) next.push([join(disp, name), p]);
      }
    }
    current = next;
  });
  const seen = new Set<string>();
  return current.map(([d]) => d).filter((d) => d !== '' && !seen.has(d) && !!seen.add(d));
}

/* ───────────────────────── Brace expansion ───────────────────────── */

/**
 * Finds the first `{…}` group in `s` that contains a top-level comma or a `..` range.
 *
 * Scans each `{` in order and walks to its matching `}`, recording commas at depth 1. A comma
 * list yields its items as-is (nested braces stay inside the items). Without commas, the body
 * may be a numeric range `{1..5}` / `{5..1}` or a letter range `{a..e}`, stepping up or down;
 * ranges stop after about 10,000 items. A group that is neither is skipped and the next `{` is
 * tried.
 *
 * @param {string} s - Literal text to search.
 * @returns {{ start: number; end: number; items: string[] } | null} The indices of `{` and `}`
 *   and the alternatives, or null when there is no expandable group.
 *
 * @example
 * findBrace('f{a,b}.txt'); // { start: 1, end: 5, items: ['a', 'b'] }
 */
function findBrace(s: string): { start: number; end: number; items: string[] } | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0;
    const commas: number[] = [];
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        depth--;
        if (depth === 0) {
          const body = s.slice(i + 1, j);
          if (commas.length) {
            const items: string[] = [];
            let from = i + 1;
            for (const c of commas) {
              items.push(s.slice(from, c));
              from = c + 1;
            }
            items.push(s.slice(from, j));
            return { start: i, end: j, items };
          }
          const range = /^(-?\d+)\.\.(-?\d+)$/.exec(body) ?? /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(body);
          if (range) {
            const num = /\d/.test(range[1]);
            const a = num ? Number(range[1]) : range[1].charCodeAt(0);
            const b = num ? Number(range[2]) : range[2].charCodeAt(0);
            const step = a <= b ? 1 : -1;
            const items: string[] = [];
            for (let k = a; step > 0 ? k <= b : k >= b; k += step) {
              items.push(num ? String(k) : String.fromCharCode(k));
              if (items.length > 10_000) break;
            }
            return { start: i, end: j, items };
          }
          break;
        }
      } else if (s[j] === ',' && depth === 1) commas.push(j);
    }
  }
  return null;
}

const MAX_BRACE_WORDS = 100_000; /** Cap on the words one brace expression may produce, so inputs like {a..z}{a..z}{a..z}{a..z} cannot freeze the page. */

/**
 * Brace-expands the unquoted literal parts of a word.
 *
 * Finds the first unquoted literal part with an expandable group, substitutes each alternative
 * and recurses on the result, so several groups (and nested groups) multiply out left to right.
 * Quoted parts and expansions are never brace-expanded.
 *
 * @param {WordPart[]} parts - The parts of one word.
 * @returns {WordPart[][]} One part list per resulting word (just `[parts]` when nothing expands).
 * @throws {ExpansionError} When the expansion would produce more than `MAX_BRACE_WORDS` words.
 *
 * @example
 * braceExpand((tokenize('a{b,c}').tokens![0] as WordToken).parts).length; // 2
 */
export function braceExpand(parts: WordPart[]): WordPart[][] {
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p.type !== 'lit' || p.quoted) continue;
    const b = findBrace(p.value);
    if (!b) continue;
    const out: WordPart[][] = [];
    for (const item of b.items) {
      const replaced: WordPart = { ...p, value: p.value.slice(0, b.start) + item + p.value.slice(b.end + 1) };
      for (const variant of braceExpand([...parts.slice(0, k), replaced, ...parts.slice(k + 1)])) {
        out.push(variant);
        if (out.length > MAX_BRACE_WORDS) throw new ExpansionError('zsh: brace expansion produces too many words');
      }
    }
    return out;
  }
  return [parts];
}

/* ───────────────────────── Tilde ───────────────────────── */

/**
 * Expands a leading `~` in the first part of a word.
 *
 * Only an unquoted literal first part starting with `~` is considered. `~` is the home directory,
 * `~+` the cwd, `~-` `$OLDPWD`, `~root` `/var/root`, and `~user` the home directory when its
 * last path segment is `user`. The directory is inserted as a quoted literal so it is never
 * globbed; the rest of the part (from the first `/`) keeps its original quoting. When no
 * directory is found, a name made only of letters, digits, `_`, `.` and `-` is an error (this
 * includes `~-` while OLDPWD is unset); anything else is left unchanged.
 *
 * @param {WordPart[]} parts - The parts of one word.
 * @param {ExpandContext} ctx - Supplies the home directory, cwd and variables.
 * @returns {WordPart[]} The parts with the tilde prefix replaced, or `parts` unchanged.
 * @throws {ExpansionError} "no such user or named directory" for an unknown `~user`, or for
 *   `~-` when OLDPWD is unset.
 *
 * @example
 * tildeExpand([{ type: 'lit', value: '~/docs', quoted: false }], ctx);
 * // [{ type: 'lit', value: '/Users/guest', quoted: true }, { type: 'lit', value: '/docs', quoted: false }]
 */
function tildeExpand(parts: WordPart[], ctx: ExpandContext): WordPart[] {
  const first = parts[0];
  if (!first || first.type !== 'lit' || first.quoted || !first.value.startsWith('~')) return parts;
  const slash = first.value.indexOf('/');
  const user = first.value.slice(1, slash < 0 ? undefined : slash);
  let dir: string | undefined;
  if (user === '') dir = ctx.home;
  else if (user === '+') dir = ctx.cwd;
  else if (user === '-') dir = ctx.getVar('OLDPWD');
  else if (user === 'root') dir = '/var/root';
  else if (ctx.home.endsWith(`/${user}`)) dir = ctx.home;
  if (dir === undefined) {
    if (user && /^[A-Za-z0-9_.-]+$/.test(user)) throw new ExpansionError(`zsh: no such user or named directory: ${user}`);
    return parts;
  }
  const rest = slash < 0 ? '' : first.value.slice(slash);
  return [{ type: 'lit', value: dir, quoted: true }, ...(rest ? [{ ...first, value: rest }] : []), ...parts.slice(1)];
}

/* ───────────────────────── Parameters ───────────────────────── */

/**
 * Expands the operand word of `${VAR:-word}`, `${VAR:=word}` or `${VAR:+word}`.
 *
 * The operand is itself expanded (`${EDITOR:-$HOME/bin/edit}`, `${X:-~}`) when it contains `$`,
 * a backtick, `~`, a backslash or a quote. It is lexed and, if it forms exactly one word,
 * expanded with `expandSingle`. An operand that does not lex as a single word (e.g. contains
 * spaces), fails to lex or fails to expand is used literally, so this function never rejects.
 *
 * @async
 * @param {string | undefined} arg - The operand text from the `${…}` expression.
 * @param {ExpandContext} ctx - The expansion context.
 * @returns {Promise<string>} The expanded operand (an empty string when there is none).
 *
 * @example
 * await operandValue('$HOME/bin', ctx); // '/Users/guest/bin'
 */
async function operandValue(arg: string | undefined, ctx: ExpandContext): Promise<string> {
  if (!arg || !/[$`~\\'"]/.test(arg)) return arg ?? '';
  try {
    const { tokens } = tokenize(arg);
    if (tokens?.length === 1 && tokens[0].type === 'word') return await expandSingle(tokens[0], ctx);
  } catch {
    /* lexing or expansion failed: fall back to the operand as typed */
  }
  return arg;
}

/**
 * Computes the value of a parameter expansion part.
 *
 * `len` returns the length in code points, `default` the operand when the variable is unset or
 * empty, `assign` additionally stores that operand in the variable, and `alt` the operand only
 * when the variable is non-empty. Without an operator it returns the value or an empty string.
 *
 * @async
 * @param {Extract<WordPart, { type: 'var' }>} part - The parameter expansion part.
 * @param {ExpandContext} ctx - Supplies and receives variable values.
 * @returns {Promise<string>} The expanded value.
 *
 * @example
 * await paramValue({ type: 'var', name: 'EDITOR', quoted: false, op: 'default', arg: 'vi' }, ctx); // 'vi' if unset
 */
async function paramValue(part: Extract<WordPart, { type: 'var' }>, ctx: ExpandContext): Promise<string> {
  const v = ctx.getVar(part.name);
  switch (part.op) {
    case 'len':
      return String([...(v ?? '')].length);
    case 'default':
      return v ? v : operandValue(part.arg, ctx);
    case 'assign':
      if (!v) {
        const value = await operandValue(part.arg, ctx);
        ctx.setVar(part.name, value);
        return value;
      }
      return v;
    case 'alt':
      return v ? operandValue(part.arg, ctx) : '';
    default:
      return v ?? '';
  }
}

/* ───────────────────────── Words ───────────────────────── */

/** A field being built: plain text plus the glob pattern with quoted characters escaped. */
interface Field {
  text: string;
  pattern: string;
  /** Contains at least one quoted part (so an empty result is still an argument). */
  quoted: boolean;
}

/**
 * Expands the parts of one word into fields.
 *
 * Literal parts are appended as-is to both the text and the pattern (quoted literals are
 * glob-escaped in the pattern). Parameter values are appended as quoted text, so unquoted `$VAR`
 * is neither split nor globbed. For arithmetic, `$x` / `${x}` inside the expression are
 * substituted first (unset or empty ones become `0`) and bare names are read by the evaluator.
 * Command substitution output loses its trailing newlines; when unquoted it is split on blanks
 * into separate fields, otherwise it is appended as one quoted piece. Errors from
 * `ctx.commandSubst` propagate unchanged.
 *
 * @async
 * @param {WordPart[]} parts - The (brace- and tilde-expanded) word parts.
 * @param {ExpandContext} ctx - The expansion context.
 * @returns {Promise<Field[]>} One or more fields (always at least one).
 * @throws {ExpansionError} When an arithmetic expression cannot be evaluated.
 *
 * @example
 * const fields = await expandParts(word.parts, ctx);
 * console.log(fields.map((f) => f.text));
 */
async function expandParts(parts: WordPart[], ctx: ExpandContext): Promise<Field[]> {
  const fields: Field[] = [{ text: '', pattern: '', quoted: false }];
  /**
   * Returns the field currently being built (the last one).
   *
   * Unquoted command substitution pushes new fields, so the current field is always the last
   * entry of `fields`.
   *
   * @returns {Field} The current field.
   *
   * @example
   * cur().text += 'x';
   */
  const cur = () => fields[fields.length - 1];
  /**
   * Appends text to the current field.
   *
   * The text is added verbatim to `text`; in `pattern` it is glob-escaped when quoted. Quoted
   * text also marks the field as quoted so an empty result still counts as an argument.
   *
   * @param {string} s - The text to append.
   * @param {boolean} quoted - Whether the text must match literally when globbing.
   * @returns {void}
   *
   * @example
   * appendLiteral('*.txt', false);
   */
  const appendLiteral = (s: string, quoted: boolean) => {
    const f = cur();
    f.text += s;
    f.pattern += quoted ? escapeGlob(s) : s;
    if (quoted) f.quoted = true;
  };
  for (const p of parts) {
    if (p.type === 'lit') appendLiteral(p.value, p.quoted);
    else if (p.type === 'var') appendLiteral(await paramValue(p, ctx), true);
    else if (p.type === 'arith') {
      const expr = p.expr.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*|[?#$0-9])\}?/g, (_, n: string) => ctx.getVar(n) || '0');
      try {
        appendLiteral(String(evaluate(expr, (n) => ctx.getVar(n))), true);
      } catch (e) {
        if (e instanceof ArithError) throw new ExpansionError(`zsh: ${e.message}`);
        throw e;
      }
    } else {
      const out = (await ctx.commandSubst(p.source)).replace(/\n+$/, '');
      if (p.quoted) appendLiteral(out, true);
      else {
        const words = out.split(/[ \t\n]+/).filter(Boolean);
        words.forEach((w, k) => {
          if (k > 0) fields.push({ text: '', pattern: '', quoted: false });
          appendLiteral(w, true);
        });
      }
    }
  }
  return fields;
}

/**
 * Expands one word to zero or more arguments.
 *
 * Applies brace expansion, then tilde expansion and parameter / arithmetic / command
 * substitution to each variant, then globbing to each field whose pattern has active glob
 * characters (unless `opts.glob` is false). Fields that are empty and contain no quoted part
 * are dropped, so an unset unquoted `$VAR` produces no argument.
 *
 * @async
 * @param {WordToken} word - The word to expand.
 * @param {ExpandContext} ctx - The expansion context.
 * @param {{ glob?: boolean }} [opts={}] - Set `glob: false` to skip filename generation.
 * @returns {Promise<string[]>} The resulting arguments.
 * @throws {ExpansionError} When a glob matches nothing ("no matches found") or another expansion fails.
 *
 * @example
 * await expandWord(tokenize('{a,b}.txt').tokens![0] as WordToken, ctx, { glob: false }); // ['a.txt', 'b.txt']
 */
export async function expandWord(word: WordToken, ctx: ExpandContext, opts: { glob?: boolean } = {}): Promise<string[]> {
  const out: string[] = [];
  for (const variant of braceExpand(word.parts)) {
    const fields = await expandParts(tildeExpand(variant, ctx), ctx);
    for (const f of fields) {
      if (opts.glob !== false && hasGlob(f.pattern)) {
        const matches = glob(f.pattern, ctx.cwd);
        if (!matches.length) throw new ExpansionError(`zsh: no matches found: ${f.text}`);
        out.push(...matches);
      } else if (f.text !== '' || f.quoted) out.push(f.text);
    }
  }
  return out;
}

/**
 * Expands a list of words into a flat argument list.
 *
 * Words are expanded one after another (so command substitutions run in order) with globbing
 * enabled.
 *
 * @async
 * @param {WordToken[]} words - The command's words.
 * @param {ExpandContext} ctx - The expansion context.
 * @returns {Promise<string[]>} The concatenated arguments of all words.
 * @throws {ExpansionError} When any word fails to expand.
 *
 * @example
 * const argv = await expandWords(cmd.words, ctx);
 */
export async function expandWords(words: WordToken[], ctx: ExpandContext): Promise<string[]> {
  const out: string[] = [];
  for (const w of words) out.push(...(await expandWord(w, ctx)));
  return out;
}

/**
 * Expands a word to exactly one string, without brace expansion, splitting or globbing.
 *
 * Used for assignment values and redirection targets. Tilde and parameter / arithmetic / command
 * substitution still apply; if a command substitution produces several fields they are joined
 * with single spaces.
 *
 * @async
 * @param {WordToken} word - The word to expand.
 * @param {ExpandContext} ctx - The expansion context.
 * @returns {Promise<string>} The expanded string.
 * @throws {ExpansionError} When an expansion fails.
 *
 * @example
 * await expandSingle(tokenize('~/out.txt').tokens![0] as WordToken, ctx); // '/Users/guest/out.txt'
 */
export async function expandSingle(word: WordToken, ctx: ExpandContext): Promise<string> {
  const fields = await expandParts(tildeExpand(word.parts, ctx), ctx);
  return fields.map((f) => f.text).join(' ');
}


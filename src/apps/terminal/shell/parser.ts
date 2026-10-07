/**
 * Parser: tokens → list of and-or chains of pipelines of simple commands.
 *
 *   script   := sep* andor (sep+ andor)* sep*         sep := ';' | '&' (background) | newline
 *   andor    := pipeline (('&&' | '||') newline* pipeline)*
 *   pipeline := ['!'] command ('|' newline* command)*
 *   command  := (assignment | word | redirect)+
 *
 * Input ending right after `|`, `&&` or `||` is reported as incomplete (pipe>, cmdand>, cmdor>).
 */
import { ShellSyntaxError, plainWord, tokenize, type Incomplete, type OpToken, type RedirToken, type Token, type WordToken } from './lexer';

/** A redirection attached to a simple command. */
export interface Redirect {
  /** 0 stdin, 1 stdout, 2 stderr, 3 = both stdout & stderr. */
  fd: 0 | 1 | 2 | 3;
  mode: RedirToken['mode'];
  /** For 'dup': the fd this one is duplicated from. */
  dupTo?: 1 | 2;
  /** File word for read/write/append redirections; absent for 'dup'. */
  target?: WordToken;
}

/** A `NAME=value` assignment preceding a command's words. */
export interface Assignment {
  name: string;
  /** The value as a word (still to be expanded); the `NAME=` prefix is removed. */
  value: WordToken;
}

/** One command: its leading assignments, argument words and redirections. */
export interface SimpleCommand {
  assigns: Assignment[];
  words: WordToken[];
  redirects: Redirect[];
}

/** Commands joined by `|`, optionally negated with a leading `!`. */
export interface Pipeline {
  negate: boolean;
  commands: SimpleCommand[];
}

/** Pipelines joined by `&&` / `||`; `ops[k]` sits between `pipelines[k]` and `pipelines[k + 1]`. */
export interface AndOr {
  pipelines: Pipeline[];
  ops: ('&&' | '||')[];
  /** Terminated by `&`: run as a background job. */
  background?: boolean;
}

/** A parsed script: and-or lists in execution order. */
export type Script = AndOr[];

/** Result of `parse`: the script, or the kind of construct the input left open. */
export type ParseResult = { script: Script; incomplete?: undefined } | { incomplete: Incomplete; script?: undefined };

/** Internal signal thrown when the tokens end right after `|`, `&&` or `||`. */
class IncompleteSignal extends Error {
  kind: Incomplete;

  /**
   * Creates a signal for input that ends where another command is required.
   *
   * `parse` catches it and turns it into an `{ incomplete }` result.
   *
   * @param {Incomplete} kind - The continuation kind (`pipe`, `cmdand` or `cmdor`).
   * @returns {IncompleteSignal} The new signal instance.
   *
   * @example
   * throw new IncompleteSignal('pipe');
   */
  constructor(kind: Incomplete) {
    super(kind);
    this.kind = kind;
  }
}

/**
 * Renders a token the way zsh shows it in a parse error.
 *
 * A missing token or a newline operator is shown as `\n`, other operators as their text,
 * redirections as `<`, `>>` or `>`, and words as their raw source.
 *
 * @param {Token | undefined} t - The offending token, or undefined at the end of input.
 * @returns {string} The text to put in the "parse error near" message.
 *
 * @example
 * describe({ type: 'op', op: '|' }); // '|'
 */
const describe = (t: Token | undefined): string => {
  if (!t) return '\\n';
  if (t.type === 'op') return t.op === '\n' ? '\\n' : t.op;
  if (t.type === 'redir') return t.mode === 'read' ? '<' : t.mode === 'append' ? '>>' : '>';
  return t.raw;
};

/**
 * Builds a zsh-style "parse error near" error for a token.
 *
 * The error is returned, not thrown, so callers can write `throw syntaxError(t)`.
 *
 * @param {Token | undefined} t - The offending token, or undefined at the end of input.
 * @returns {ShellSyntaxError} The error, e.g. with message "zsh: parse error near `|'".
 *
 * @example
 * throw syntaxError(peek());
 */
const syntaxError = (t: Token | undefined) => new ShellSyntaxError(`zsh: parse error near \`${describe(t)}'`);

/**
 * Tests whether a token is one of the given operators.
 *
 * Acts as a type guard so the token can be used as an `OpToken` afterwards.
 *
 * @param {Token | undefined} t - The token to test.
 * @param {...OpToken['op']} ops - The accepted operators.
 * @returns {boolean} True when `t` is an operator token whose `op` is in `ops`.
 *
 * @example
 * isOp(tokens[0], ';', '\n'); // true for a ';' token
 */
const isOp = (t: Token | undefined, ...ops: OpToken['op'][]): t is OpToken => t?.type === 'op' && ops.includes(t.op);

/**
 * Replaces aliases in command position.
 *
 * A word is in command position at the start of the input, after any operator token (; & && ||
 * | newline), and after `!` or leading `NAME=value` assignments. Only plain unquoted words are
 * looked up. Alias values are lexed and expanded recursively with the alias name added to
 * `seen`, which stops self-reference (alias ls='ls -G'). The word following an expanded alias is
 * not in command position. Alias values that do not lex completely are left unexpanded.
 *
 * @param {Token[]} tokens - The tokens to process.
 * @param {Map<string, string>} aliases - Alias name to replacement source.
 * @param {ReadonlySet<string>} [seen=new Set()] - Aliases already being expanded higher up.
 * @returns {Token[]} A new token list with aliases replaced (the input itself when there are no aliases).
 * @throws {ShellSyntaxError} When an alias value contains a syntax error.
 *
 * @example
 * const { tokens } = tokenize('ll /tmp');
 * expandAliases(tokens!, new Map([['ll', 'ls -l']])); // tokens for "ls -l /tmp"
 */
export function expandAliases(tokens: Token[], aliases: Map<string, string>, seen: ReadonlySet<string> = new Set()): Token[] {
  if (!aliases.size) return tokens;
  const out: Token[] = [];
  let commandPos = true;
  for (const t of tokens) {
    const word = plainWord(t);
    if (commandPos && word !== null && aliases.has(word) && !seen.has(word)) {
      const lexed = tokenize(aliases.get(word)!);
      if (lexed.tokens) {
        out.push(...expandAliases(lexed.tokens, aliases, new Set([...seen, word])));
        commandPos = false;
        continue;
      }
    }
    out.push(t);
    if (t.type === 'op') commandPos = true;
    else if (t.type === 'word') commandPos = commandPos && (word === '!' || ASSIGN_RE.test(word ?? ''));
  }
  return out;
}

const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=/; /** Matches the `NAME=` prefix of an assignment word and captures NAME. */

/**
 * Interprets a word as a `NAME=value` assignment if it is one.
 *
 * The first part must be an unquoted literal starting with a valid name and `=`. The value word
 * keeps the rest of that literal plus all later parts (so `X="a b"` and `X=$HOME` work); an
 * empty value becomes a single quoted empty literal so it still expands to one empty string.
 *
 * @param {WordToken} t - The word to inspect.
 * @returns {Assignment | null} The assignment, or null when the word is not an assignment.
 *
 * @example
 * asAssignment(tokenize('FOO=bar').tokens![0] as WordToken); // { name: 'FOO', value: <word "bar"> }
 */
function asAssignment(t: WordToken): Assignment | null {
  const first = t.parts[0];
  if (!first || first.type !== 'lit' || first.quoted) return null;
  const m = ASSIGN_RE.exec(first.value);
  if (!m) return null;
  const rest = first.value.slice(m[0].length);
  const parts = [...(rest ? [{ ...first, value: rest }] : []), ...t.parts.slice(1)];
  return { name: m[1], value: { type: 'word', parts: parts.length ? parts : [{ type: 'lit', value: '', quoted: true }], raw: t.raw.slice(m[0].length) } };
}

/**
 * Parses a token list into a script of and-or lists.
 *
 * A recursive-descent parser over the grammar in the file header. Leading and trailing newlines
 * are skipped, newlines are allowed after `|`, `&&` and `||`, and an and-or list followed by `&`
 * is marked `background`. Assignments are only recognised before the first word of a command.
 * When the tokens end right after `|`, `&&` or `||` the result is `{ incomplete }` instead of a
 * script.
 *
 * @param {Token[]} tokens - Tokens from `tokenize` (usually after `expandAliases`).
 * @returns {ParseResult} Either `{ script }` or `{ incomplete }`.
 * @throws {ShellSyntaxError} On an empty command, a redirection without a target word, or an
 *   unexpected token between and-or lists.
 *
 * @example
 * const { script } = parse(tokenize('a && b; c &').tokens!);
 * console.log(script?.length); // 2
 */
export function parse(tokens: Token[]): ParseResult {
  let i = 0;
  /**
   * Returns the token at the current position without consuming it.
   *
   * Reads `tokens[i]` through the parser's shared cursor `i` and leaves the cursor unchanged.
   *
   * @returns {Token | undefined} The current token, or undefined at the end of input.
   *
   * @example
   * if (isOp(peek(), '|')) i++;
   */
  const peek = () => tokens[i];
  /**
   * Advances past any newline operator tokens.
   *
   * Moves the shared cursor `i` forward while the current token is a `\n` operator, so blank
   * lines between and-or lists and line breaks after `|`, `&&` or `||` are ignored.
   *
   * @returns {void}
   *
   * @example
   * skipNewlines();
   */
  const skipNewlines = () => {
    while (isOp(peek(), '\n')) i++;
  };

  /**
   * Parses one simple command.
   *
   * Consumes tokens until the next operator. Dup redirections stand alone; other redirections
   * take the following word as their target. Words before the first non-assignment word that look
   * like `NAME=value` become assignments.
   *
   * @returns {SimpleCommand} The parsed command.
   * @throws {ShellSyntaxError} When a redirection has no target word or the command is empty.
   *
   * @example
   * const cmd = parseCommand(); // for "X=1 echo hi > out"
   */
  const parseCommand = (): SimpleCommand => {
    const cmd: SimpleCommand = { assigns: [], words: [], redirects: [] };
    for (let t = peek(); t && t.type !== 'op'; t = peek()) {
      i++;
      if (t.type === 'redir') {
        if (t.mode === 'dup') {
          cmd.redirects.push({ fd: t.fd, mode: 'dup', dupTo: t.dupTo });
          continue;
        }
        const target = peek();
        if (!target || target.type !== 'word') throw syntaxError(target);
        i++;
        cmd.redirects.push({ fd: t.fd, mode: t.mode, target });
      } else {
        const a = cmd.words.length ? null : asAssignment(t);
        if (a) cmd.assigns.push(a);
        else cmd.words.push(t);
      }
    }
    if (!cmd.words.length && !cmd.assigns.length && !cmd.redirects.length) throw syntaxError(peek());
    return cmd;
  };

  /**
   * Parses a pipeline: an optional leading `!` and commands separated by `|`.
   *
   * Newlines after a `|` are skipped.
   *
   * @returns {Pipeline} The parsed pipeline.
   * @throws {IncompleteSignal} With kind `pipe` when the tokens end after a `|`.
   * @throws {ShellSyntaxError} When a command in the pipeline is invalid.
   *
   * @example
   * const p = parsePipeline(); // for "! grep x | wc -l"
   */
  const parsePipeline = (): Pipeline => {
    let negate = false;
    if (plainWord(peek()) === '!') {
      negate = true;
      i++;
    }
    const commands = [parseCommand()];
    while (isOp(peek(), '|')) {
      i++;
      skipNewlines();
      if (i >= tokens.length) throw new IncompleteSignal('pipe');
      commands.push(parseCommand());
    }
    return { negate, commands };
  };

  /**
   * Parses pipelines joined by `&&` / `||`.
   *
   * Newlines after an operator are skipped.
   *
   * @returns {AndOr} The parsed and-or list (without the `background` flag).
   * @throws {IncompleteSignal} With kind `cmdand` or `cmdor` when the tokens end after the operator.
   * @throws {ShellSyntaxError} When a pipeline is invalid.
   *
   * @example
   * const andor = parseAndOr(); // for "make && make install"
   */
  const parseAndOr = (): AndOr => {
    const andor: AndOr = { pipelines: [parsePipeline()], ops: [] };
    for (let t = peek(); isOp(t, '&&', '||'); t = peek()) {
      i++;
      skipNewlines();
      if (i >= tokens.length) throw new IncompleteSignal(t.op === '&&' ? 'cmdand' : 'cmdor');
      andor.ops.push(t.op as '&&' | '||');
      andor.pipelines.push(parsePipeline());
    }
    return andor;
  };

  const script: Script = [];
  try {
    skipNewlines();
    while (i < tokens.length) {
      const andor = parseAndOr();
      script.push(andor);
      const sep = peek();
      if (!sep) break;
      if (!isOp(sep, ';', '&', '\n')) throw syntaxError(sep);
      if (sep.op === '&') andor.background = true;
      i++;
      skipNewlines();
    }
  } catch (e) {
    if (e instanceof IncompleteSignal) return { incomplete: e.kind };
    throw e;
  }
  return { script };
}

/**
 * Lexes, alias-expands and parses shell source in one step.
 *
 * Returns `{ incomplete }` as soon as either the lexer or the parser reports unfinished input.
 *
 * @param {string} source - The shell source.
 * @param {Map<string, string>} [aliases=new Map()] - Aliases to expand in command position.
 * @returns {ParseResult} Either `{ script }` or `{ incomplete }`.
 * @throws {ShellSyntaxError} On syntax errors.
 *
 * @example
 * const result = parseSource('echo "hi');
 * console.log(result.incomplete); // 'dquote'
 */
export function parseSource(source: string, aliases: Map<string, string> = new Map()): ParseResult {
  const lexed = tokenize(source);
  if (lexed.incomplete) return { incomplete: lexed.incomplete };
  return parse(expandAliases(lexed.tokens, aliases));
}

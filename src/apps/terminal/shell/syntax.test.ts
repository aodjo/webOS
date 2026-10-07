import { beforeEach, describe, expect, it } from 'vitest';
import { HOME } from '@/kernel';
import { ShellSyntaxError, tokenize, type WordToken } from './lexer';
import { parseSource } from './parser';
import { braceExpand, glob, globMatch } from './expand';
import { expandHistory } from './history';
import { parseAnsi, displayWidth, stripAnsi } from './ansi';
import { newShell, run, seedFS } from './testkit';

/**
 * Tokenize source text and summarize each token as a string.
 *
 * Word tokens become their literal text, with non-literal parts shown as `<type>` (e.g. `<var>`);
 * operators become the operator itself; redirections become `redir<fd><mode>`.
 *
 * @param {string} src - Shell source text.
 * @returns {string[]} One summary string per token.
 *
 * @example
 * words('ls > out'); // ['ls', 'redir1write', 'out']
 */
const words = (src: string) =>
  (tokenize(src).tokens ?? []).map((t) => (t.type === 'word' ? t.parts.map((p) => (p.type === 'lit' ? p.value : `<${p.type}>`)).join('') : t.type === 'op' ? t.op : `redir${t.fd}${t.mode}`));

describe('lexer', () => {
  it('splits words and operators', () => {
    expect(words('ls -la ; echo a&&b || c | d')).toEqual(['ls', '-la', ';', 'echo', 'a', '&&', 'b', '||', 'c', '|', 'd']);
  });

  it('handles quoting and escapes', () => {
    const tokens = tokenize(`echo 'a b' "c d" e\\ f "q\\"x" ''`).tokens!;
    const w = tokens.filter((t): t is WordToken => t.type === 'word');
    expect(w.map((t) => t.parts.map((p) => (p.type === 'lit' ? p.value : '')).join(''))).toEqual(['echo', 'a b', 'c d', 'e f', 'q"x', '']);
    expect(w[1].parts[0]).toMatchObject({ quoted: true });
  });

  it('recognises variables and command substitution', () => {
    const w = tokenize('echo $HOME ${USER} "$X" $(pwd) `date` $?').tokens!.filter((t): t is WordToken => t.type === 'word');
    expect(w.slice(1).map((t) => t.parts[t.parts.length - 1].type)).toEqual(['var', 'var', 'var', 'cmd', 'cmd', 'var']);
  });

  it('recognises redirections', () => {
    expect(words('ls > out 2>&1')).toEqual(['ls', 'redir1write', 'out', 'redir2dup']);
    expect(words('cat < in >> out 2>/dev/null &> all')).toEqual(['cat', 'redir0read', 'in', 'redir1append', 'out', 'redir2write', '/dev/null', 'redir3write', 'all']);
  });

  it('reports incomplete input for continuation prompts', () => {
    expect(tokenize('echo "abc').incomplete).toBe('dquote');
    expect(tokenize("echo 'abc").incomplete).toBe('quote');
    expect(tokenize('echo \\').incomplete).toBe('backslash');
    expect(tokenize('echo $(ls').incomplete).toBe('cmdsubst');
    expect(parseSource('ls |').incomplete).toBe('pipe');
    expect(parseSource('true &&').incomplete).toBe('cmdand');
    expect(parseSource('false ||').incomplete).toBe('cmdor');
    expect(parseSource('echo "a\nb"').script).toBeDefined();
  });

  it('ignores comments', () => {
    expect(words('echo hi # a comment')).toEqual(['echo', 'hi']);
  });
});

describe('parser', () => {
  it('builds and-or lists of pipelines', () => {
    const { script } = parseSource('a | b && c || d; e');
    expect(script).toHaveLength(2);
    expect(script![0].pipelines.map((p) => p.commands.length)).toEqual([2, 1, 1]);
    expect(script![0].ops).toEqual(['&&', '||']);
  });

  it('detects assignments only before the command', () => {
    const { script } = parseSource('FOO=1 BAR=2 env X=3');
    const cmd = script![0].pipelines[0].commands[0];
    expect(cmd.assigns.map((a) => a.name)).toEqual(['FOO', 'BAR']);
    expect(cmd.words).toHaveLength(2);
  });

  it('throws zsh-style syntax errors', () => {
    expect(() => parseSource('| ls')).toThrow(ShellSyntaxError);
    expect(() => parseSource('ls ;;')).toThrow("parse error near `;'");
    expect(() => parseSource('echo >')).toThrow(ShellSyntaxError);
  });

  it('expands aliases in command position only, without recursion', () => {
    const aliases = new Map([
      ['ll', 'ls -la'],
      ['ls', 'ls -G'],
    ]);
    const { script } = parseSource('ll docs; echo ll', aliases);
    /**
     * Raw words of the first command of a parsed list.
     *
     * Reads the `raw` source text of every word in the first command of the first pipeline of
     * and-or list `i`, after the parser has substituted aliases.
     *
     * @param {number} i - Index of the and-or list in the parsed script.
     * @returns {string[]} The command's words as written after alias expansion.
     *
     * @example
     * raw(0); // ['ls', '-G', '-la', 'docs']
     */
    const raw = (i: number) => script![i].pipelines[0].commands[0].words.map((w) => w.raw);
    expect(raw(0)).toEqual(['ls', '-G', '-la', 'docs']);
    expect(raw(1)).toEqual(['echo', 'll']);
  });
});

describe('expansion', () => {
  beforeEach(seedFS);

  it('matches glob patterns', () => {
    expect(globMatch('*.md', 'a.md')).toBe(true);
    expect(globMatch('?.md', 'ab.md')).toBe(false);
    expect(globMatch('[ab].md', 'b.md')).toBe(true);
    expect(globMatch('[!ab].md', 'b.md')).toBe(false);
    expect(globMatch('READ*', 'readme', true)).toBe(true);
  });

  it('globs against the virtual FS', () => {
    expect(glob('*.md', `${HOME}/Documents`)).toEqual(['a.md', 'b.md']);
    expect(glob('Documents/*.md', HOME)).toEqual(['Documents/a.md', 'Documents/b.md']);
    expect(glob(`${HOME}/D*`, '/')).toEqual([`${HOME}/Desktop`, `${HOME}/Documents`, `${HOME}/Downloads`]);
    expect(glob('**/*.md', HOME)).toEqual(['Documents/a.md', 'Documents/b.md', 'Documents/Projects/README.md']);
    expect(glob('*', HOME)).not.toContain('.zshrc');
    expect(glob('.z*', HOME)).toEqual(['.zshrc']);
  });

  it('brace-expands lists and ranges', () => {
    /**
     * Wrap a string as a single unquoted literal word part list.
     *
     * Produces the word-part shape the lexer emits for plain text, so it can be passed straight
     * to `braceExpand`.
     *
     * @param {string} v - Literal text.
     * @returns {{ type: 'lit', value: string, quoted: boolean }[]} A one-element part list.
     *
     * @example
     * lit('a{b,c}'); // [{ type: 'lit', value: 'a{b,c}', quoted: false }]
     */
    const lit = (v: string) => [{ type: 'lit' as const, value: v, quoted: false }];
    /**
     * Brace-expand a literal word and flatten each result to a string.
     *
     * Each expanded part list is joined back into text; non-literal parts contribute nothing.
     *
     * @param {string} src - Word text containing brace expressions.
     * @returns {string[]} The expanded words.
     *
     * @example
     * flat('a{b,c}d'); // ['abd', 'acd']
     */
    const flat = (src: string) => braceExpand(lit(src)).map((ps) => ps.map((p) => (p.type === 'lit' ? p.value : '')).join(''));
    expect(flat('a{b,c}d')).toEqual(['abd', 'acd']);
    expect(flat('f{1..3}')).toEqual(['f1', 'f2', 'f3']);
    expect(flat('{x,y}{1,2}')).toEqual(['x1', 'x2', 'y1', 'y2']);
    expect(flat('{solo}')).toEqual(['{solo}']);
  });

  it('expands variables, tilde, globs and substitutions in the shell', async () => {
    const sh = newShell();
    expect((await run(sh, 'X=world; echo hello $X ${X}!')).out).toBe('hello world world!\n');
    expect((await run(sh, 'echo ~ ~/Documents')).out).toBe(`${HOME} ${HOME}/Documents\n`);
    expect((await run(sh, 'echo ${#X} ${NOPE:-fallback} "$NOPE" end')).out).toBe('5 fallback  end\n');
    expect((await run(sh, 'false; echo $?')).out).toBe('1\n');
    expect((await run(sh, 'cd Documents && echo *.md')).out).toBe('a.md b.md\n');
    expect((await run(sh, 'echo "*.md" \\*.md')).out).toBe('*.md *.md\n');
    expect((await run(sh, 'echo "today: $(echo is nice)"')).out).toBe('today: is nice\n');
    expect((await run(sh, 'printf "%s|" $(echo a b c)')).out).toBe('a|b|c|');
    expect((await run(sh, 'echo x{1,2}')).out).toBe('x1 x2\n');
    expect((await run(sh, 'N=7; echo $((N * 6)) $(( (1 + 2) ** 2 % 5 )) $((0x10 + $N)) $((7 / 2)) $((N > 5 ? 1 : 0))')).out).toBe('42 4 23 3 1\n');
    expect((await run(sh, 'echo $((1 / 0))')).err).toBe('zsh: division by zero\n');
  });

  it('expands the word of ${VAR:-word} and friends', async () => {
    const sh = newShell();
    expect((await run(sh, 'echo ${NOPE:-$HOME/x} ${NOPE:-~} ${HOME:+set}')).out).toBe(`${HOME}/x ${HOME} set\n`);
    expect((await run(sh, 'echo ${NEW:=$USER}; echo $NEW')).out).toBe('aodjo\naodjo\n');
  });

  it('marks `&` lists as background jobs', () => {
    const { script } = parseSource('sleep 1 & echo hi; ls &');
    expect(script!.map((a) => !!a.background)).toEqual([true, false, true]);
  });

  it('fails like zsh when a glob matches nothing', async () => {
    const r = await run(newShell(), 'echo *.nothing');
    expect(r.status).toBe(1);
    expect(r.err).toBe('zsh: no matches found: *.nothing\n');
    expect(r.out).toBe('');
  });
});

describe('history expansion', () => {
  const hist = ['ls -la', 'cd Documents', 'echo one two three'];

  it('expands events', () => {
    expect(expandHistory('!!', hist)).toEqual({ line: 'echo one two three', changed: true });
    expect(expandHistory('sudo !!', hist).line).toBe('sudo echo one two three');
    expect(expandHistory('!1', hist).line).toBe('ls -la');
    expect(expandHistory('!-2', hist).line).toBe('cd Documents');
    expect(expandHistory('!cd', hist).line).toBe('cd Documents');
    expect(expandHistory('cat !$', hist).line).toBe('cat three');
    expect(expandHistory('^one^ONE', hist).line).toBe('echo ONE two three');
  });

  it('leaves literal bangs alone', () => {
    expect(expandHistory("echo 'hi!!'", hist)).toEqual({ line: "echo 'hi!!'", changed: false });
    expect(expandHistory('echo hi !', hist).changed).toBe(false);
    expect(expandHistory('!nope', hist).error).toBe('zsh: event not found: nope');
  });
});

describe('ansi', () => {
  it('parses SGR colors and carries state', () => {
    const { segs, end } = parseAnsi('a\x1b[1;34mb\x1b[0mc\x1b[31md');
    expect(segs.map((s) => [s.text, s.fg ?? null, !!s.bold])).toEqual([
      ['a', null, false],
      ['b', 4, true],
      ['c', null, false],
      ['d', 1, false],
    ]);
    expect(end.fg).toBe(1);
    expect(parseAnsi('x\x1b[38;2;10;20;30my').segs[1].fg).toBe('rgb(10,20,30)');
  });

  it('measures display width', () => {
    expect(displayWidth('\x1b[1mabc\x1b[0m')).toBe(3);
    expect(displayWidth('이력서.md')).toBe(9);
    expect(stripAnsi('\x1b[32mok\x1b[39m')).toBe('ok');
  });
});

/**
 * Shell builtins and session commands: env, printenv, export, unset, alias, unalias, source,
 * history, clear, which, type, help, man, sudo, exit, logout, shutdown/reboot/halt, sleep, zsh,
 * jobs, fg, wait, test, true, false.
 */
import { USER, confirmPower, dirname, t, useSystem } from '@/kernel';
import { osInfo } from '@/data/portfolio';
import { c, displayWidth } from '../ansi';
import { shellQuote } from '../lexer';
import type { CommandContext, CommandDef, CommandGroup, Job } from '../types';
import { columns, isExecutable, padEnd, sleep, usageError, writeDenied } from '../util';

/* ───────────────────────── Environment ───────────────────────── */

const env: CommandDef = {
  name: 'env',
  path: '/usr/bin',
  group: 'shell',
  summary: { en: 'print the environment or run a command in a modified one', ko: '환경 변수를 출력하거나 바꾼 환경에서 명령 실행' },
  usage: 'env [name=value ...] [command [args ...]]',
  /**
   * Prints the environment, or runs a command with extra environment variables.
   *
   * Leading `NAME=value` arguments are collected as additional variables. If a command follows
   * them, it is run through the shell with those variables added to its environment, the same
   * stdin, output streams and sudo state, and its exit status is returned. Otherwise the
   * environment merged with the additional variables is printed as `NAME=value` lines.
   *
   * @async
   * @param {CommandContext} ctx - Command context with the arguments, environment and streams.
   * @returns {Promise<number>} The command's exit status, or 0 after printing the environment.
   *
   * @example
   * // $ env DEBUG=1 printenv DEBUG
   * await env.run(ctx); // prints "1" and returns 0
   */
  async run(ctx) {
    const extra: Record<string, string> = {};
    let i = 0;
    for (; i < ctx.args.length; i++) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(ctx.args[i]);
      if (!m) break;
      extra[m[1]] = m[2];
    }
    const rest = ctx.args.slice(i);
    if (rest.length) return ctx.shell.runArgv(rest, { stdout: ctx.stdout, stderr: ctx.stderr }, ctx.signal, { stdin: ctx.stdin, env: extra, sudo: ctx.sudo });
    const all = { ...ctx.env, ...extra };
    ctx.print(
      Object.entries(all)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    );
    return 0;
  },
}; /** The `env` command: prints the environment or runs a command with extra variables. */

const assignmentRe = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/s; /** Matches an `export` operand: a valid identifier (group 1) with an optional `=value` (group 2). */

const exportCmd: CommandDef = {
  name: 'export',
  builtin: true,
  group: 'shell',
  summary: { en: 'set environment variables', ko: '환경 변수 설정' },
  usage: 'export [name[=value] ...]',
  /**
   * Exports shell variables, or lists the exported ones.
   *
   * The `-p` flag is ignored. Without operands every exported variable is printed sorted by
   * name as `NAME=value`, with values shell-quoted. Each `NAME=value` operand sets and exports
   * the variable; a bare `NAME` exports its current value (or an empty string when unset).
   * Operands that are not valid identifiers are reported and make the status 1.
   *
   * @param {CommandContext} ctx - Command context with the arguments and shell.
   * @returns {number} 0 on success, 1 when any operand is not a valid identifier.
   *
   * @example
   * // $ export EDITOR=vim
   * exportCmd.run(ctx); // sets EDITOR and exports it to child commands, returns 0
   */
  run(ctx) {
    const args = ctx.args.filter((a) => a !== '-p');
    if (!args.length) {
      const env = ctx.shell.environment();
      ctx.print(
        Object.keys(env)
          .sort()
          .map((k) => `${k}=${shellQuote(env[k])}`)
          .join('\n'),
      );
      return 0;
    }
    let status = 0;
    for (const a of args) {
      const m = assignmentRe.exec(a);
      if (!m) {
        ctx.error(`not an identifier: ${a.split('=')[0]}`);
        status = 1;
        continue;
      }
      ctx.shell.setVar(m[1], m[2] ?? ctx.shell.getVar(m[1]) ?? '', true);
    }
    return status;
  },
}; /** The `export` builtin: sets and exports shell variables. */

const unset: CommandDef = {
  name: 'unset',
  builtin: true,
  group: 'shell',
  summary: { en: 'remove shell variables', ko: '셸 변수 제거' },
  usage: 'unset name ...',
  /**
   * Removes the named shell variables.
   *
   * Each argument is removed from the shell's variables (and from the environment when it was
   * exported). Names that are not set are ignored.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args` are the variable names.
   * @returns {number} 0 on success, 1 when no names were given.
   *
   * @example
   * // $ unset EDITOR
   * unset.run(ctx); // 0
   */
  run(ctx) {
    if (!ctx.args.length) {
      ctx.error('not enough arguments');
      return 1;
    }
    for (const a of ctx.args) ctx.shell.unsetVar(a);
    return 0;
  },
}; /** The `unset` builtin: removes shell variables. */

/* ───────────────────────── Aliases ───────────────────────── */

const alias: CommandDef = {
  name: 'alias',
  builtin: true,
  group: 'shell',
  summary: { en: 'define or list aliases', ko: '별칭 정의 또는 나열' },
  usage: "alias [name[='value'] ...]",
  description: {
    en: 'Aliases from ~/.zshrc are loaded when the window opens. Example: alias gs="git status"',
    ko: '윈도우가 열릴 때 ~/.zshrc의 별칭을 불러옵니다. 예: alias gs="git status"',
  },
  /**
   * Defines aliases, prints selected aliases, or lists all of them.
   *
   * Without arguments every alias is printed sorted by name as `name=value` with the value
   * shell-quoted. An argument containing "=" after its first character defines (or replaces)
   * an alias; a bare name prints that alias. Bare names without an alias produce no output but
   * make the status 1, as in zsh.
   *
   * @param {CommandContext} ctx - Command context with the arguments and the shell's alias map.
   * @returns {number} 0 on success, 1 when a requested alias does not exist.
   *
   * @example
   * // $ alias gs='git status'
   * alias.run(ctx); // defines gs and returns 0
   */
  run(ctx) {
    const aliases = ctx.shell.aliases;
    /**
     * Formats one alias for output.
     *
     * The value is shell-quoted so the printed line can be pasted back as an alias command.
     * The alias must exist in the map.
     *
     * @param {string} k - The alias name.
     * @returns {string} The line `name=quoted-value`.
     *
     * @example
     * show('gs'); // "gs='git status'"
     */
    const show = (k: string) => `${k}=${shellQuote(aliases.get(k)!)}`;
    if (!ctx.args.length) {
      if (aliases.size)
        ctx.print(
          [...aliases.keys()]
            .sort()
            .map(show)
            .join('\n'),
        );
      return 0;
    }
    let status = 0;
    for (const a of ctx.args) {
      const eq = a.indexOf('=');
      if (eq > 0) aliases.set(a.slice(0, eq), a.slice(eq + 1));
      else if (aliases.has(a)) ctx.print(show(a));
      else status = 1;
    }
    return status;
  },
}; /** The `alias` builtin: defines or lists command aliases. */

const unalias: CommandDef = {
  name: 'unalias',
  builtin: true,
  group: 'shell',
  summary: { en: 'remove aliases', ko: '별칭 제거' },
  usage: 'unalias [-a] name ...',
  /**
   * Removes aliases by name, or all of them with `-a`.
   *
   * When the first argument is `-a` every alias is cleared. Otherwise each named alias is
   * deleted; names without an alias are reported with zsh's "no such hash table element"
   * message and make the status 1.
   *
   * @param {CommandContext} ctx - Command context with the arguments and the shell's alias map.
   * @returns {number} 0 on success, 1 when no names were given or any name was not an alias.
   *
   * @example
   * // $ unalias gs
   * unalias.run(ctx); // 0
   */
  run(ctx) {
    if (ctx.args[0] === '-a') {
      ctx.shell.aliases.clear();
      return 0;
    }
    if (!ctx.args.length) {
      ctx.error('not enough arguments');
      return 1;
    }
    let status = 0;
    for (const a of ctx.args) {
      if (!ctx.shell.aliases.delete(a)) {
        ctx.error(`no such hash table element: ${a}`);
        status = 1;
      }
    }
    return status;
  },
}; /** The `unalias` builtin: removes command aliases. */

const source: CommandDef = {
  name: 'source',
  aliases: ['.'],
  builtin: true,
  group: 'shell',
  summary: { en: 'run commands from a file in the current shell', ko: '파일의 명령을 현재 셸에서 실행' },
  usage: 'source file [args ...]',
  description: { en: 'Typical use: source ~/.zshrc after editing it.', ko: '주로 ~/.zshrc를 수정한 뒤 source ~/.zshrc로 다시 불러올 때 씁니다.' },
  /**
   * Runs a script file in the current shell.
   *
   * Unlike `zsh script`, the commands run in this shell, so variables, aliases and the working
   * directory they change stay in effect. Extra arguments become the positional parameters.
   * Missing files and folders are reported as errors.
   *
   * @async
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the file, the rest are its arguments.
   * @returns {Promise<number>} The exit status of the script, or 1 when the file cannot be read.
   *
   * @example
   * // $ source ~/.zshrc
   * await source.run(ctx); // reloads aliases and variables from ~/.zshrc
   */
  async run(ctx) {
    const [file, ...args] = ctx.args;
    if (!file) {
      ctx.error('not enough arguments');
      return 1;
    }
    const path = ctx.resolve(file);
    const node = ctx.fs.stat(path);
    if (!node || node.type !== 'file') {
      ctx.error(`${node ? 'is a directory' : 'no such file or directory'}: ${file}`);
      return 1;
    }
    return ctx.shell.source(path, args, { stdout: ctx.stdout, stderr: ctx.stderr }, ctx.signal);
  },
}; /** The `source` builtin (also `.`): runs a file's commands in the current shell. */

const history: CommandDef = {
  name: 'history',
  builtin: true,
  group: 'shell',
  summary: { en: 'show command history', ko: '명령 기록 표시' },
  usage: 'history [-c] [n]',
  description: {
    en: 'Lists previous commands (saved to ~/.zsh_history). Re-run with !! (last), !n (number n) or !text (last starting with text).',
    ko: '이전 명령을 나열합니다 (~/.zsh_history에 저장됨). !!(마지막), !n(n번), !text(text로 시작하는 마지막 명령)로 다시 실행할 수 있습니다.',
  },
  options: [['-c', { en: 'Clear the history', ko: '기록 지우기' }]],
  /**
   * Lists or clears the command history.
   *
   * `-c` clears the history. Otherwise the entries are printed with 1-based event numbers,
   * right-aligned to at least five columns; a numeric argument limits the output to the last n
   * entries. Newlines inside multi-line entries are shown as "\n" so each event stays on one
   * line. A non-numeric argument is reported as "event not found".
   *
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is `-c` or the entry count.
   * @returns {number} 0 on success, 1 for a non-numeric count.
   *
   * @example
   * // $ history 3
   * history.run(ctx); // prints the last three commands with their event numbers
   */
  run(ctx) {
    if (ctx.args[0] === '-c') {
      ctx.shell.clearHistory();
      return 0;
    }
    const n = ctx.args[0] !== undefined ? Number(ctx.args[0]) : Infinity;
    if (Number.isNaN(n)) return usageError(ctx, `event not found: ${ctx.args[0]}`);
    const list = ctx.shell.history;
    const start = Math.max(0, list.length - n);
    const width = String(list.length).length;
    const lines = list.slice(start).map((h, i) => `${String(start + i + 1).padStart(Math.max(5, width + 1))}  ${h.replace(/\n/g, '\\n')}`);
    if (lines.length) ctx.print(lines.join('\n'));
    return 0;
  },
}; /** The `history` builtin: lists or clears previously entered commands. */

const clear: CommandDef = {
  name: 'clear',
  path: '/usr/bin',
  group: 'shell',
  summary: { en: 'clear the terminal screen (^L)', ko: '터미널 화면 지우기 (^L)' },
  usage: 'clear',
  /**
   * Clears the terminal screen.
   *
   * On the terminal itself the visible screen is cleared through the terminal API (scrollback
   * is kept). When output is redirected or piped, the ANSI "cursor home + erase screen"
   * sequence is written instead, like the real `clear`.
   *
   * @param {CommandContext} ctx - Command context with stdout and the terminal API.
   * @returns {number} Always 0.
   *
   * @example
   * // $ clear
   * clear.run(ctx); // 0
   */
  run(ctx) {
    if (ctx.stdout.isTTY) ctx.term.clear();
    else ctx.stdout.write('\x1b[H\x1b[2J');
    return 0;
  },
}; /** The `clear` command: clears the terminal screen. */

/* ───────────────────────── Lookup ───────────────────────── */

/**
 * Describes how the shell would interpret a command name.
 *
 * Aliases take precedence over commands, matching the shell's lookup order. The "type" style
 * produces zsh `type` sentences ("ls is /bin/ls"); the "which" and "where" styles produce
 * `which` output (an alias line, "shell built-in command", or the bare install path). Commands
 * without an explicit install path are reported in /bin.
 *
 * @param {CommandContext} ctx - Command context giving access to the shell's aliases and command table.
 * @param {string} name - The command name to describe.
 * @param {'which' | 'type' | 'where'} style - The output wording to use.
 * @returns {string | null} The description, or null when the name is neither an alias nor a command.
 *
 * @example
 * describe(ctx, 'ls', 'type'); // 'ls is /bin/ls'
 * describe(ctx, 'cd', 'which'); // 'cd: shell built-in command'
 */
function describe(ctx: CommandContext, name: string, style: 'which' | 'type' | 'where'): string | null {
  const a = ctx.shell.aliases.get(name);
  if (a !== undefined) return style === 'type' ? `${name} is an alias for ${a}` : `${name}: aliased to ${a}`;
  const def = ctx.shell.lookup(name);
  if (!def) return null;
  if (def.builtin) return style === 'type' ? `${name} is a shell builtin` : `${name}: shell built-in command`;
  const path = `${def.path ?? '/bin'}/${name}`;
  return style === 'type' ? `${name} is ${path}` : path;
}

const which: CommandDef = {
  name: 'which',
  aliases: ['where'],
  builtin: true,
  group: 'shell',
  summary: { en: 'locate a command', ko: '명령 위치 찾기' },
  usage: 'which name ...',
  /**
   * Prints where each named command comes from.
   *
   * Arguments starting with "-" are skipped. Each remaining name is described with
   * describe() in the "which" style; unknown names print "name not found" on stdout, as zsh
   * does, and make the status 1.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args` are the command names.
   * @returns {number} 0 when every name was found, 1 when any was not or no names were given.
   *
   * @example
   * // $ which ls
   * which.run(ctx); // prints "/bin/ls" and returns 0
   */
  run(ctx) {
    if (!ctx.args.length) return usageError(ctx, 'not enough arguments');
    let status = 0;
    for (const n of ctx.args.filter((x) => !x.startsWith('-'))) {
      const d = describe(ctx, n, 'which');
      if (d) ctx.print(d);
      else {
        ctx.print(`${n} not found`);
        status = 1;
      }
    }
    return status;
  },
}; /** The `which` builtin (also `where`): locates commands. */

const type: CommandDef = {
  name: 'type',
  builtin: true,
  group: 'shell',
  summary: { en: 'describe how a name would be interpreted', ko: '이름이 어떻게 해석되는지 설명' },
  usage: 'type name ...',
  /**
   * Explains how each name would be interpreted by the shell.
   *
   * Every argument is described with describe() in the "type" style (alias, shell builtin or
   * command path). Unknown names print "name not found" and make the status 1.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args` are the names to describe.
   * @returns {number} 0 when every name was found, 1 otherwise.
   *
   * @example
   * // $ type cd
   * type.run(ctx); // prints "cd is a shell builtin" and returns 0
   */
  run(ctx) {
    let status = 0;
    for (const n of ctx.args) {
      const d = describe(ctx, n, 'type');
      if (d) ctx.print(d);
      else {
        ctx.print(`${n} not found`);
        status = 1;
      }
    }
    return status;
  },
}; /** The `type` builtin: describes how names are interpreted. */

/* ───────────────────────── help / man ───────────────────────── */

const GROUPS: { id: CommandGroup; title: { en: string; ko: string } }[] = [
  { id: 'portfolio', title: { en: 'Portfolio', ko: '포트폴리오' } },
  { id: 'files', title: { en: 'Files & folders', ko: '파일 및 폴더' } },
  { id: 'text', title: { en: 'Text processing', ko: '텍스트 처리' } },
  { id: 'apps', title: { en: 'Apps & system settings', ko: '앱 및 시스템 설정' } },
  { id: 'system', title: { en: 'System & processes', ko: '시스템 및 프로세스' } },
  { id: 'network', title: { en: 'Network', ko: '네트워크' } },
  { id: 'shell', title: { en: 'Shell', ko: '셸' } },
  { id: 'fun', title: { en: 'Just for fun', ko: '재미로' } },
]; /** Command groups in the order `help` lists them, with their localized section titles. */

const help: CommandDef = {
  name: 'help',
  builtin: true,
  group: 'shell',
  summary: { en: 'list available commands', ko: '사용 가능한 명령 나열' },
  usage: 'help [command]',
  /**
   * Lists the available commands grouped by topic, or shows one command's manual page.
   *
   * With an argument it runs `man <command>`. Otherwise every non-hidden command is listed
   * under its group title, in GROUPS order, skipping empty groups. The portfolio group is
   * shown one command per line with its summary when the terminal is at least 48 columns wide;
   * the other groups are laid out in columns. Titles and names are colored only on a TTY. A
   * short tip about shell features and key bindings ends the listing.
   *
   * @async
   * @param {CommandContext} ctx - Command context with the arguments, shell and terminal size.
   * @returns {Promise<number>} 0 after printing the list, or the exit status of `man`.
   *
   * @example
   * // $ help
   * await help.run(ctx); // prints the grouped command list and returns 0
   */
  async run(ctx) {
    if (ctx.args[0]) return ctx.shell.runArgv(['man', ctx.args[0]], { stdout: ctx.stdout, stderr: ctx.stderr }, ctx.signal);
    const tty = ctx.stdout.isTTY;
    const cols = ctx.term.size().cols;
    const out: string[] = [
      tty ? c.bold(t({ en: 'zsh, version 5.9 — available commands', ko: 'zsh 5.9 — 사용 가능한 명령' })) : t({ en: 'Available commands', ko: '사용 가능한 명령' }),
      '',
    ];
    const visible = ctx.shell.commands().filter((d) => !d.hidden);
    /**
     * Styles a command name for the listing.
     *
     * Names are green on a TTY and plain when the output is piped or redirected.
     *
     * @param {string} n - The command name (possibly already padded).
     * @returns {string} The name, wrapped in ANSI color codes on a TTY.
     *
     * @example
     * name('ls'); // '\x1b[32mls\x1b[39m' on a TTY, 'ls' otherwise
     */
    const name = (n: string) => (tty ? c.green(n) : n);
    for (const g of GROUPS) {
      const list = visible.filter((d) => d.group === g.id);
      if (!list.length) continue;
      out.push(tty ? c.bold(c.cyan(t(g.title))) : t(g.title));
      if (g.id === 'portfolio' && cols >= 48) {
        const nameW = Math.max(...list.map((d) => d.name.length)) + 2;
        for (const d of list) out.push(`  ${name(padEnd(d.name, nameW))}${t(d.summary)}`);
      } else out.push(...columns(list.map((d) => name(d.name)), cols - 2).map((l) => `  ${l}`));
      out.push('');
    }
    out.push(
      t({
        en: 'Pipes (|), redirection (> >> 2>&1), globbing (*.md), $VARS, ~, && || ;, background jobs (&) and Tab completion all work.\nUse "man <command>" for details, ↑/↓ for history, ^C to interrupt, ^L to clear.',
        ko: '파이프(|), 리디렉션(> >> 2>&1), 글로빙(*.md), $변수, ~, && || ;, 백그라운드 작업(&), Tab 자동 완성을 모두 지원합니다.\n자세한 내용은 "man <명령>", 기록은 ↑/↓, 중단은 ^C, 화면 지우기는 ^L.',
      }),
    );
    ctx.print(out.join('\n'));
    return 0;
  },
}; /** The `help` builtin: lists the available commands by group. */

const man: CommandDef = {
  name: 'man',
  path: '/usr/bin',
  group: 'shell',
  summary: { en: 'display manual pages', ko: '매뉴얼 페이지 표시' },
  usage: 'man command',
  /**
   * Prints a BSD-style manual page generated from a command's definition.
   *
   * The first non-flag argument names the command. The page has a centered header line,
   * NAME (name and summary), SYNOPSIS (the usage line with its first word in bold), the alias
   * list, DESCRIPTION (the long description, or the summary capitalized as a sentence), each
   * option with its indented explanation, and a footer with the OS name and version. The page
   * width follows the terminal, clamped to 40–100 columns, and paragraphs are word-wrapped
   * using display widths so Korean text aligns. Bold and underline are applied only on a TTY.
   *
   * @param {CommandContext} ctx - Command context; the first non-flag argument is the command name.
   * @returns {number} 0 after printing the page, 1 when no name was given or the command is unknown.
   *
   * @example
   * // $ man ls
   * man.run(ctx); // prints the LS(1) manual page and returns 0
   */
  run(ctx) {
    const name = ctx.args.find((a) => !a.startsWith('-'));
    if (!name) {
      ctx.stderr.write('What manual page do you want?\nFor example, try \'man man\'.\n');
      return 1;
    }
    const def = ctx.shell.lookup(name);
    if (!def) {
      ctx.stderr.write(`No manual entry for ${name}\n`);
      return 1;
    }
    const tty = ctx.stdout.isTTY;
    /**
     * Formats a heading or keyword in bold.
     *
     * Applies ANSI bold only on a TTY so piped output stays plain text.
     *
     * @param {string} s - The text to emphasize.
     * @returns {string} The text, bold on a TTY.
     *
     * @example
     * h('NAME'); // '\x1b[1mNAME\x1b[22m' on a TTY
     */
    const h = (s: string) => (tty ? c.bold(s) : s);
    /**
     * Formats a reference in underline.
     *
     * Applies ANSI underline only on a TTY so piped output stays plain text.
     *
     * @param {string} s - The text to underline.
     * @returns {string} The text, underlined on a TTY.
     *
     * @example
     * def.aliases.map(u); // underlined alias names
     */
    const u = (s: string) => (tty ? c.underline(s) : s);
    const title = `${def.name.toUpperCase()}(1)`;
    const center = t({ en: 'General Commands Manual', ko: '일반 명령 매뉴얼' });
    const width = Math.max(40, Math.min(ctx.term.size().cols, 100));
    const gap = Math.max(1, Math.floor((width - title.length * 2 - displayWidth(center)) / 2));
    /**
     * Word-wraps text to the page width with a left indent.
     *
     * Each "\n"-separated paragraph is wrapped independently by adding words while the line's
     * display width stays within `width - indent`; a single word longer than that is kept on
     * its own line. Every resulting line is prefixed with `indent` spaces.
     *
     * @param {string} text - The text to wrap.
     * @param {number} indent - Number of spaces to indent each line.
     * @returns {string[]} The wrapped, indented lines.
     *
     * @example
     * wrap('Lists the contents of a directory.', 5); // ['     Lists the contents of a directory.']
     */
    const wrap = (text: string, indent: number) => {
      const max = width - indent;
      const lines: string[] = [];
      for (const para of text.split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
          if (line && displayWidth(line + ' ' + word) > max) {
            lines.push(line);
            line = word;
          } else line = line ? `${line} ${word}` : word;
        }
        lines.push(line);
      }
      return lines.map((l) => ' '.repeat(indent) + l);
    };
    const out: string[] = [`${title}${' '.repeat(gap)}${center}${' '.repeat(gap)}${title}`, '', h('NAME'), `     ${h(def.name)} – ${t(def.summary)}`, '', h('SYNOPSIS')];
    out.push(`     ${(def.usage ?? def.name).replace(/^(\S+)/, (m) => h(m))}`);
    if (def.aliases?.length) out.push('', `     ${t({ en: 'Also available as', ko: '다른 이름' })}: ${def.aliases.map(u).join(', ')}`);
    const summary = t(def.summary);
    out.push('', h('DESCRIPTION'), ...wrap(def.description ? t(def.description) : `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`, 5));
    if (def.options?.length) {
      out.push('');
      for (const [flag, text] of def.options) out.push(`     ${h(flag)}`, ...wrap(t(text), 10));
    }
    const footer = `${osInfo.name} ${osInfo.version}`;
    out.push('', `${footer}${' '.repeat(Math.max(1, width - footer.length * 2))}${footer}`);
    ctx.print(out.join('\n'));
    return 0;
  },
}; /** The `man` command: renders a manual page for any registered command. */

/*───────────────────────── sudo & session ───────────────────────── */

const HARMLESS = new Set(['ls', 'cat', 'echo', 'pwd', 'whoami', 'id', 'date', 'cal', 'uptime', 'uname', 'sw_vers', 'hostname', 'ps', 'top', 'df', 'du', 'tree', 'find', 'grep', 'head', 'tail', 'wc', 'env', 'printenv', 'neofetch', 'fortune', 'cowsay', 'sl', 'say', 'help', 'man', 'which', 'type', 'history', 'file', 'stat', 'true', 'false', 'yes', 'matrix', 'ping', 'clear', 'less', 'more', 'about', 'skills', 'experience', 'projects', 'contact']); /** Commands sudo runs with root privileges; other known commands (apart from POWER ones) are refused with the "not in the sudoers file" message. */
const POWER: Record<string, 'shutDown' | 'restart' | 'logOut'> = { shutdown: 'shutDown', halt: 'shutDown', poweroff: 'shutDown', reboot: 'restart', logout: 'logOut' }; /** Maps command names run through sudo to the power action they confirm. */

const sudo: CommandDef = {
  name: 'sudo',
  path: '/usr/bin',
  group: 'system',
  summary: { en: 'execute a command as the superuser', ko: '슈퍼유저 권한으로 명령 실행' },
  usage: 'sudo command [args ...]',
  description: {
    en: 'Asks for your login password, then runs harmless commands as root. "sudo shutdown -h now" really shuts the system down. Everything else is reported.',
    ko: '로그인 암호를 물은 뒤 안전한 명령은 root로 실행합니다. "sudo shutdown -h now"는 실제로 시스템을 종료합니다. 그 외의 명령은 보고됩니다.',
  },
  /**
   * Authenticates with the login password, then runs a command as root.
   *
   * Leading flags are consumed: `-k`/`-K` forget the cached credentials, `-v` only validates
   * them, and any other flag (-E, -H, …) is ignored. Without a command (and without `-v`) the
   * usage is printed, unless `-k` was given. Like sudo's timestamp, the password is requested
   * only when the last successful authentication is more than five minutes old; it is read
   * with hidden input, up to three attempts, and an empty system password accepts any input.
   * Power commands (shutdown, halt, poweroff, reboot, logout) open the system's confirmation
   * dialog; `shutdown -r` restarts. Aliases are not expanded, so only real commands can run.
   * Commands in HARMLESS run with root privileges; everything else is refused with the
   * "not in the sudoers file" message.
   *
   * @async
   * @param {CommandContext} ctx - Command context with the arguments, terminal and abort signal.
   * @returns {Promise<number>} The exit status of the command run as root; 0 after a power
   *   dialog or a successful validation; 1 for usage errors, failed or cancelled
   *   authentication, unknown commands and refused commands.
   *
   * @example
   * // $ sudo shutdown -h now
   * await sudo.run(ctx); // asks for the password, then shows the Shut Down confirmation
   */
  async run(ctx) {
    const args = [...ctx.args];
    let validate = false;
    let reset = false;
    while (args[0]?.startsWith('-')) {
      const f = args.shift()!;
      if (f === '-k' || f === '-K') reset = true;
      else if (f === '-v') validate = true;
    }
    if (reset) {
      ctx.shell.sudoUntil = 0;
      if (!args.length && !validate) return 0;
    }
    if (!args.length && !validate) {
      ctx.stderr.write('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo [-ABbEHknPS] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [command [arg ...]]\n');
      return 1;
    }
    if (Date.now() > ctx.shell.sudoUntil) {
      const password = useSystem.getState().settings.password;
      let ok = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const entered = await ctx.term.readLine('Password:', { secret: true, signal: ctx.signal });
        if (entered === null) return 1;
        if (!password || entered === password) {
          ok = true;
          break;
        }
        ctx.stderr.write('Sorry, try again.\n');
      }
      if (!ok) {
        ctx.stderr.write('sudo: 3 incorrect password attempts\n');
        return 1;
      }
      ctx.shell.sudoUntil = Date.now() + 5 * 60_000;
    }
    if (!args.length) return 0;
    const name = args[0];
    const power = POWER[name];
    if (power) {
      const restart = power === 'shutDown' && args.includes('-r');
      await confirmPower(restart ? 'restart' : power);
      return 0;
    }
    if (!ctx.shell.lookup(name) && !name.includes('/')) {
      ctx.stderr.write(`sudo: ${name}: command not found\n`);
      return 1;
    }
    if (HARMLESS.has(name)) return ctx.shell.runArgv(args, { stdout: ctx.stdout, stderr: ctx.stderr }, ctx.signal, { stdin: ctx.stdin, sudo: true });
    ctx.stderr.write(`${USER} is not in the sudoers file.  This incident will be reported.\n`);
    return 1;
  },
}; /** The `sudo` command: password-checked root execution of harmless commands and power actions. */

const exit: CommandDef = {
  name: 'exit',
  aliases: ['bye'],
  builtin: true,
  group: 'shell',
  summary: { en: 'exit the shell and close the window', ko: '셸을 종료하고 윈도우 닫기' },
  usage: 'exit [n]',
  /**
   * Exits the shell, which closes the terminal window for an interactive shell.
   *
   * The shell's running-jobs guard is consulted first: with background jobs running, the first
   * attempt only prints a warning and fails. The exit code is the numeric argument masked to
   * 0–255, or the status of the previous command when omitted; a non-numeric argument exits
   * with 0.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the optional exit code.
   * @returns {number} The exit code passed to the shell, or 1 when the jobs guard blocked the exit.
   *
   * @example
   * // $ exit 3
   * exit.run(ctx); // requests the shell to exit and returns 3
   */
  run(ctx) {
    if (!ctx.shell.confirmExit(ctx.stderr)) return 1;
    const code = ctx.args[0] !== undefined ? Number(ctx.args[0]) & 255 : ctx.shell.status;
    ctx.shell.exit(Number.isNaN(code) ? 0 : code);
    return ctx.shell.status;
  },
}; /** The `exit` builtin (also `bye`): leaves the shell. */

const logout: CommandDef = {
  name: 'logout',
  builtin: true,
  group: 'shell',
  summary: { en: 'log out of the session (requires sudo)', ko: '세션에서 로그아웃 (sudo 필요)' },
  usage: 'sudo logout',
  /**
   * Refuses to log out from a non-login shell.
   *
   * Prints zsh's "not login shell" error with a hint to use `exit` to close the window or
   * `sudo logout` to end the session (handled by sudo through POWER).
   *
   * @param {CommandContext} ctx - Command context used to print the error.
   * @returns {number} Always 1.
   *
   * @example
   * // $ logout
   * logout.run(ctx); // prints the hint and returns 1
   */
  run(ctx) {
    ctx.error(t({ en: "not login shell: use `exit' to close this window, or `sudo logout' to end the session", ko: "로그인 셸이 아닙니다: 이 윈도우를 닫으려면 `exit', 세션을 끝내려면 `sudo logout'을 사용하세요" }));
    return 1;
  },
}; /** The `logout` builtin: explains how to close the window or end the session. */

/**
 * Builds the definition of a power command that requires sudo.
 *
 * The returned command lives in /sbin and only documents itself: run directly it always fails
 * with a permission error ("NOT super-user" for shutdown, "Operation not permitted" for the
 * others). The actual shutdown or restart is performed when it is run through `sudo`, which
 * maps the name with POWER. Only `shutdown` lists the -h and -r options.
 *
 * @param {'shutdown' | 'reboot' | 'halt'} name - The command name to define.
 * @returns {CommandDef} The command definition.
 *
 * @example
 * const reboot = powerCommand('reboot');
 * reboot.usage; // 'sudo reboot'
 */
function powerCommand(name: 'shutdown' | 'reboot' | 'halt'): CommandDef {
  return {
    name,
    path: '/sbin',
    group: 'system',
    summary: name === 'reboot' ? { en: 'restart the computer (requires sudo)', ko: '컴퓨터 재시동 (sudo 필요)' } : { en: 'shut down the computer (requires sudo)', ko: '컴퓨터 종료 (sudo 필요)' },
    usage: name === 'shutdown' ? 'sudo shutdown [-h | -r] now' : `sudo ${name}`,
    options: name === 'shutdown' ? [['-h', { en: 'Halt (power off)', ko: '종료 (전원 끄기)' }], ['-r', { en: 'Restart', ko: '재시동' }]] : undefined,
    /**
     * Rejects the power command when it is run without sudo.
     *
     * `shutdown` prints its "NOT super-user" message; `reboot` and `halt` print
     * "Operation not permitted".
     *
     * @param {CommandContext} ctx - Command context used to print the error.
     * @returns {number} Always 1.
     *
     * @example
     * // $ reboot
     * powerCommand('reboot').run(ctx); // prints "reboot: Operation not permitted", returns 1
     */
    run(ctx) {
      if (name === 'shutdown') ctx.stderr.write('shutdown: NOT super-user\n');
      else ctx.error('Operation not permitted');
      return 1;
    },
  };
}

const sleepCmd: CommandDef = {
  name: 'sleep',
  group: 'shell',
  summary: { en: 'suspend execution for an interval (^C to stop)', ko: '지정한 시간 동안 대기 (^C로 중단)' },
  usage: 'sleep seconds',
  /**
   * Waits for the given number of seconds.
   *
   * Accepts exactly one non-negative number, optionally with an "s" suffix (fractions are
   * allowed); anything else prints the BSD usage text. The wait ends early when the command is
   * interrupted with ^C.
   *
   * @async
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the duration in seconds.
   * @returns {Promise<number>} 0 when the time elapsed, 130 when interrupted, 1 for invalid arguments.
   *
   * @example
   * // $ sleep 1.5
   * await sleepCmd.run(ctx); // resolves with 0 after 1.5 seconds
   */
  async run(ctx) {
    const secs = Number(ctx.args[0]?.replace(/s$/, ''));
    if (ctx.args.length !== 1 || !Number.isFinite(secs) || secs < 0) {
      ctx.stderr.write('usage: sleep number[unit] [...]\nUnit can be \'s\' (seconds, the default), m (minutes), h (hours), or d (days).\n');
      return 1;
    }
    return (await sleep(secs * 1000, ctx.signal)) ? 0 : 130;
  },
}; /** The `sleep` command: waits for a number of seconds. */

const shellCmd: CommandDef = {
  name: 'zsh',
  aliases: ['sh', 'bash'],
  group: 'shell',
  summary: { en: 'run a shell script or command string', ko: '셸 스크립트 또는 명령 문자열 실행' },
  usage: 'zsh [-c command | script [args ...]]',
  description: {
    en: 'Runs a script from the virtual disk in a child shell ($1, $2… are its arguments), or a command string with -c. Scripts ending in .sh can also be run directly: ./script.sh',
    ko: '가상 디스크의 스크립트를 하위 셸에서 실행하거나($1, $2…가 인자), -c로 명령 문자열을 실행합니다. .sh로 끝나는 스크립트는 ./script.sh처럼 바로 실행할 수도 있습니다.',
  },
  /**
   * Runs a command string or a script file in a child shell.
   *
   * `-c command` runs the string in a forked shell, so variable and directory changes do not
   * leak back. Otherwise a leading flag is ignored and the first operand is the script, with
   * the remaining operands as its positional parameters. Without a script nothing is started
   * (as `bash` on a TTY it prints the "default interactive shell is now zsh" notice). Missing
   * scripts and folders are reported with status 127.
   *
   * @async
   * @param {CommandContext} ctx - Command context; `ctx.name` is the alias typed (zsh, sh or bash).
   * @returns {Promise<number>} The exit status of the command string or script; 0 without a
   *   script; 1 when `-c` lacks its argument; 127 when the script cannot be opened.
   *
   * @example
   * // $ sh deploy.sh production
   * await shellCmd.run(ctx); // runs deploy.sh with $1 = "production"
   */
  async run(ctx) {
    const io = { stdout: ctx.stdout, stderr: ctx.stderr };
    if (ctx.args[0] === '-c') {
      if (ctx.args[1] === undefined) {
        ctx.error('-c: argument required');
        return 1;
      }
      return ctx.shell.fork().run(ctx.args[1], io, ctx.signal);
    }
    const [file, ...args] = ctx.args.filter((a, i) => i > 0 || !a.startsWith('-'));
    if (!file) {
      if (ctx.name === 'bash' && ctx.stdout.isTTY) ctx.print('\nThe default interactive shell is now zsh.\n');
      return 0;
    }
    const node = ctx.fs.stat(ctx.resolve(file));
    if (!node || node.type !== 'file') {
      ctx.stderr.write(`${ctx.name}: ${node ? 'is a directory' : "can't open input file"}: ${file}\n`);
      return 127;
    }
    return ctx.shell.runScript(node.path, args, io, ctx.signal);
  },
}; /** The `zsh` command (also `sh`, `bash`): runs scripts or command strings in a child shell. */

/* ───────────────────────── Jobs ───────────────────────── */

/**
 * Resolves a job spec to a running background job.
 *
 * Supported specs: omitted, `%%`, `%+` or `%` for the current (most recent) job; `%-` for the
 * previous job; `%n` or `n` for job number n; and `%text` or `text` for the most recent job
 * whose command starts with that text.
 *
 * @param {readonly Job[]} jobs - The shell's running jobs, oldest first.
 * @param {string} [spec] - The job spec; the current job when omitted.
 * @returns {Job | undefined} The matching job, or undefined when there is none.
 *
 * @example
 * findJob(ctx.shell.jobs, '%1'); // job number 1
 * findJob(ctx.shell.jobs, '%sleep'); // most recent job started with "sleep"
 */
export function findJob(jobs: readonly Job[], spec?: string): Job | undefined {
  if (!jobs.length) return undefined;
  if (spec === undefined || spec === '%%' || spec === '%+' || spec === '%') return jobs[jobs.length - 1];
  if (spec === '%-') return jobs[jobs.length - 2];
  const body = spec.replace(/^%/, '');
  if (/^\d+$/.test(body)) return jobs.find((j) => j.id === Number(body));
  return [...jobs].reverse().find((j) => j.command.startsWith(body));
}

/**
 * Returns the `jobs` marker for a job.
 *
 * The current (most recent) job is marked "+", the previous one "-", and any other job gets a
 * space so the columns stay aligned.
 *
 * @param {readonly Job[]} jobs - The shell's running jobs, oldest first.
 * @param {Job} j - The job to mark.
 * @returns {string} "+", "-" or " ".
 *
 * @example
 * jobMark(jobs, jobs[jobs.length - 1]); // '+'
 */
const jobMark = (jobs: readonly Job[], j: Job) => (j === jobs[jobs.length - 1] ? '+' : j === jobs[jobs.length - 2] ? '-' : ' ');

const jobsCmd: CommandDef = {
  name: 'jobs',
  builtin: true,
  group: 'shell',
  summary: { en: 'list background jobs', ko: '백그라운드 작업 나열' },
  usage: 'jobs [-l]',
  description: {
    en: 'Lists commands started in the background with &. Bring one back with fg, stop it with kill %n.',
    ko: '&로 백그라운드에서 시작한 명령을 나열합니다. fg로 다시 앞으로 가져오고, kill %n으로 중지합니다.',
  },
  options: [['-l', { en: 'Include process IDs', ko: '프로세스 ID 포함' }]],
  /**
   * Lists the running background jobs.
   *
   * Each job is printed zsh-style as `[id]  mark running command`, where the mark comes from
   * jobMark(); `-l` adds the process ID before the state. Nothing is printed when no jobs run.
   *
   * @param {CommandContext} ctx - Command context with the arguments and the shell's jobs.
   * @returns {number} Always 0.
   *
   * @example
   * // $ jobs -l
   * jobsCmd.run(ctx); // prints e.g. "[1]  + 1234 running    sleep 30"
   */
  run(ctx) {
    const jobs = ctx.shell.jobs;
    const long = ctx.args.includes('-l');
    if (jobs.length) ctx.print(jobs.map((j) => `[${j.id}]  ${jobMark(jobs, j)} ${long ? `${j.pid} ` : ''}${'running'.padEnd(10)} ${j.command}`).join('\n'));
    return 0;
  },
}; /** The `jobs` builtin: lists background jobs. */

const fg: CommandDef = {
  name: 'fg',
  builtin: true,
  group: 'shell',
  summary: { en: 'bring a background job to the foreground', ko: '백그라운드 작업을 포그라운드로 가져오기' },
  usage: 'fg [%job]',
  /**
   * Brings a background job to the foreground and waits for it.
   *
   * The job is chosen with findJob() (the current job by default) and flagged as foreground so
   * no completion notice is printed for it. While waiting, ^C on `fg` is forwarded to the
   * job's abort controller, as if the job had been started in the foreground; the forwarding
   * listener is removed once the job ends.
   *
   * @async
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the optional job spec.
   * @returns {Promise<number>} The job's exit status, or 1 when no matching job exists.
   *
   * @example
   * // $ fg %1
   * await fg.run(ctx); // waits for job 1 and returns its exit status
   */
  async run(ctx) {
    const job = findJob(ctx.shell.jobs, ctx.args[0]);
    if (!job) {
      ctx.error(ctx.args[0] ? `job not found: ${ctx.args[0]}` : 'no current job');
      return 1;
    }
    job.foreground = true;
    ctx.print(`[${job.id}]  - running    ${job.command}`);
    /**
     * Forwards an interrupt to the foreground job.
     *
     * Aborts the job's controller, which stops the job's command.
     *
     * @returns {void} Nothing.
     *
     * @example
     * ctx.signal.addEventListener('abort', onAbort, { once: true });
     */
    const onAbort = () => job.controller.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await job.promise;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
}; /** The `fg` builtin: brings a background job to the foreground. */

const wait: CommandDef = {
  name: 'wait',
  builtin: true,
  group: 'shell',
  hidden: true,
  summary: { en: 'wait for background jobs to finish', ko: '백그라운드 작업이 끝날 때까지 대기' },
  usage: 'wait [%job ...]',
  /**
   * Waits for background jobs to finish.
   *
   * Waits for the jobs named by the arguments (resolved with findJob()), or for every running
   * job when none are given, one after another. Unknown job specs set the status to 127 and
   * are skipped. ^C interrupts only the wait; the jobs keep running.
   *
   * @async
   * @param {CommandContext} ctx - Command context; `ctx.args` are optional job specs.
   * @returns {Promise<number>} The exit status of the last job waited for (127 if the last spec
   *   was unknown), 0 when there was nothing to wait for, or 130 when interrupted.
   *
   * @example
   * // $ sleep 2 & wait
   * await wait.run(ctx); // resolves with 0 once the sleep job ends
   */
  async run(ctx) {
    const targets = ctx.args.length ? ctx.args.map((a) => findJob(ctx.shell.jobs, a)) : [...ctx.shell.jobs];
    const interrupted = new Promise<null>((r) => (ctx.signal.aborted ? r(null) : ctx.signal.addEventListener('abort', () => r(null), { once: true })));
    let status = 0;
    for (const j of targets) {
      if (!j) {
        status = 127;
        continue;
      }
      const done = await Promise.race([j.promise, interrupted]);
      if (done === null) return 130;
      status = done;
    }
    return status;
  },
}; /** The `wait` builtin: waits for background jobs to finish. */

/* ───────────────────────── test / [ ───────────────────────── */

/** Error raised by evalTest() for a malformed expression; `test` reports it with exit status 2. */
class TestError extends Error {}

const UNARY = new Set(['-e', '-f', '-d', '-s', '-r', '-w', '-x', '-z', '-n', '-L', '-h']); /** Unary test(1) operators: file tests and string emptiness checks. */
const BINARY = new Set(['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot']); /** Binary test(1) operators: string, integer and file-age comparisons. */

/**
 * Evaluates a test(1) expression.
 *
 * A recursive-descent parser over the argument list with the usual precedence: `-o` binds
 * loosest, then `-a`, then `!`, parentheses and primaries. A primary is a binary comparison
 * when the next token is a BINARY operator followed by an operand, a unary test when the token
 * is a UNARY operator followed by an operand, and otherwise a lone string that is true when
 * non-empty. File tests resolve paths against the context's working directory; `-L`/`-h` are
 * always false because the virtual disk has no symbolic links. Both sides of `-a`/`-o` are
 * always evaluated. An empty expression is false.
 *
 * @param {string[]} args - The expression tokens, without the closing "]" of `[`.
 * @param {Pick<CommandContext, 'resolve' | 'fs'>} ctx - Path resolver and file system used by file tests.
 * @returns {boolean} The value of the expression.
 * @throws {TestError} When an argument or ")" is missing, an integer comparison gets a
 *   non-integer operand, or tokens are left over after the expression.
 *
 * @example
 * evalTest(['-f', 'notes.txt', '-a', '!', '-z', 'hi'], ctx); // true when notes.txt is a file
 * evalTest(['3', '-gt', '10'], ctx); // false
 */
export function evalTest(args: string[], ctx: Pick<CommandContext, 'resolve' | 'fs'>): boolean {
  let i = 0;
  /**
   * Returns the current token without consuming it.
   *
   * Reads `args` at the shared parser position `i` and leaves the position unchanged, so the
   * caller decides whether to advance past the token.
   *
   * @returns {string | undefined} The token at the parser position, or undefined at the end.
   *
   * @example
   * if (peek() === '-a') i++;
   */
  const peek = () => args[i];
  /**
   * Parses an integer operand.
   *
   * Accepts an optional leading minus and surrounding whitespace, like test(1).
   *
   * @param {string} v - The operand text.
   * @returns {number} The parsed integer.
   * @throws {TestError} When the operand is not an integer.
   *
   * @example
   * int(' 42 '); // 42
   */
  const int = (v: string) => {
    if (!/^\s*-?\d+\s*$/.test(v)) throw new TestError(`integer expression expected: ${v}`);
    return parseInt(v, 10);
  };
  /**
   * Evaluates a unary test.
   *
   * `-z`/`-n` test for an empty/non-empty string. The file tests resolve `v` as a path:
   * `-e`/`-r` exists, `-f` is a file, `-d` is a folder, `-s` exists with a non-zero size,
   * `-w` is writable (not locked, and writeDenied() allows writing to the folder itself or to
   * the file's parent folder), and `-x` is a folder, an executable script or an .app bundle.
   * Any other operator (`-L`, `-h`) is false since the disk has no symbolic links.
   *
   * @param {string} op - The unary operator.
   * @param {string} v - The operand (a string or a path).
   * @returns {boolean} The result of the test.
   *
   * @example
   * unary('-d', '~/Documents'); // true
   */
  const unary = (op: string, v: string): boolean => {
    if (op === '-z') return v === '';
    if (op === '-n') return v !== '';
    const node = ctx.fs.stat(ctx.resolve(v));
    switch (op) {
      case '-e':
      case '-r':
        return !!node;
      case '-f':
        return node?.type === 'file';
      case '-d':
        return node?.type === 'dir';
      case '-s':
        return !!node && ctx.fs.size(node.path) > 0;
      case '-w':
        return !!node && !node.meta?.locked && !writeDenied(node.type === 'dir' ? node.path : dirname(node.path));
      case '-x':
        return !!node && (node.type === 'dir' || isExecutable(node) || node.name.endsWith('.app'));
      default:
        return false;
    }
  };
  /**
   * Evaluates a binary comparison.
   *
   * `=`, `==` and `!=` compare strings. `-nt`/`-ot` compare the modification times of two
   * paths, treating a missing file as older than any existing one. All other operators compare
   * the operands as integers.
   *
   * @param {string} a - The left operand.
   * @param {string} op - The binary operator.
   * @param {string} b - The right operand.
   * @returns {boolean} The result of the comparison.
   * @throws {TestError} When an integer comparison gets a non-integer operand.
   *
   * @example
   * binary('10', '-ge', '3'); // true
   */
  const binary = (a: string, op: string, b: string): boolean => {
    switch (op) {
      case '=':
      case '==':
        return a === b;
      case '!=':
        return a !== b;
      case '-nt':
      case '-ot': {
        const ta = ctx.fs.stat(ctx.resolve(a))?.modifiedAt ?? -Infinity;
        const tb = ctx.fs.stat(ctx.resolve(b))?.modifiedAt ?? -Infinity;
        return op === '-nt' ? ta > tb : ta < tb;
      }
    }
    const [x, y] = [int(a), int(b)];
    return op === '-eq' ? x === y : op === '-ne' ? x !== y : op === '-lt' ? x < y : op === '-le' ? x <= y : op === '-gt' ? x > y : x >= y;
  };
  /**
   * Parses and evaluates one primary expression.
   *
   * Handles `!` negation, parenthesized sub-expressions, binary comparisons, unary tests and
   * lone strings, advancing the parser position past the consumed tokens.
   *
   * @returns {boolean} The value of the primary.
   * @throws {TestError} When the expression ends early, a ")" is missing, or an integer
   *   comparison gets a non-integer operand.
   *
   * @example
   * primary(); // evaluates e.g. "! -d notes.txt"
   */
  const primary = (): boolean => {
    const tok = args[i++];
    if (tok === undefined) throw new TestError('argument expected');
    if (tok === '!') return !primary();
    if (tok === '(') {
      const v = or();
      if (args[i++] !== ')') throw new TestError("')' expected");
      return v;
    }
    if (BINARY.has(args[i]) && args[i + 1] !== undefined) {
      const op = args[i];
      const b = args[i + 1];
      i += 2;
      return binary(tok, op, b);
    }
    if (UNARY.has(tok) && args[i] !== undefined) return unary(tok, args[i++]);
    return tok !== '';
  };
  /**
   * Parses and evaluates a chain of primaries joined by `-a`.
   *
   * Parses one primary, then keeps consuming `-a` followed by another primary. Every primary
   * is evaluated before being combined, so the right side runs even when the left is false.
   *
   * @returns {boolean} True when every primary in the chain is true.
   * @throws {TestError} When a primary is malformed.
   *
   * @example
   * and(); // evaluates e.g. "-f a.txt -a -f b.txt"
   */
  const and = (): boolean => {
    let v = primary();
    while (peek() === '-a') {
      i++;
      v = primary() && v;
    }
    return v;
  };
  /**
   * Parses and evaluates a chain of `-a` groups joined by `-o`.
   *
   * This is the lowest-precedence level and the entry point of the parser (also used for
   * parenthesized sub-expressions). Every group is evaluated before being combined, so the
   * right side runs even when the left is true.
   *
   * @returns {boolean} True when any group in the chain is true.
   * @throws {TestError} When a primary is malformed.
   *
   * @example
   * or(); // evaluates e.g. "-z $X -o -f default.txt"
   */
  const or = (): boolean => {
    let v = and();
    while (peek() === '-o') {
      i++;
      v = and() || v;
    }
    return v;
  };
  if (!args.length) return false;
  const result = or();
  if (i < args.length) throw new TestError(`too many arguments`);
  return result;
}

const testCmd: CommandDef = {
  name: 'test',
  aliases: ['['],
  builtin: true,
  group: 'shell',
  summary: { en: 'evaluate a condition (for && and ||)', ko: '조건 평가 (&&, ||와 함께 사용)' },
  usage: 'test expression   |   [ expression ]',
  description: {
    en: 'Exits with 0 when the expression is true, 1 otherwise. Example: [ -f notes.txt ] && cat notes.txt',
    ko: '식이 참이면 0, 거짓이면 1로 종료합니다. 예: [ -f notes.txt ] && cat notes.txt',
  },
  options: [
    ['-e / -f / -d file', { en: 'Exists / is a file / is a folder', ko: '존재함 / 파일임 / 폴더임' }],
    ['-z / -n string', { en: 'Empty / not empty', ko: '비어 있음 / 비어 있지 않음' }],
    ['a = b, a != b', { en: 'String comparison', ko: '문자열 비교' }],
    ['a -eq b, -lt, -gt…', { en: 'Integer comparison', ko: '정수 비교' }],
  ],
  /**
   * Evaluates a condition and reports the result as the exit status.
   *
   * When invoked as `[`, the last argument must be "]" and is stripped before evaluation.
   * The expression is evaluated with evalTest(); malformed expressions are reported on stderr.
   *
   * @param {CommandContext} ctx - Command context; `ctx.name` is "test" or "[".
   * @returns {number} 0 when the expression is true, 1 when false, 2 for a syntax error or a
   *   missing "]".
   * @throws {Error} Rethrows any error from the evaluation that is not a TestError.
   *
   * @example
   * // $ [ -f notes.txt ] && cat notes.txt
   * testCmd.run(ctx); // 0 when notes.txt exists
   */
  run(ctx) {
    let args = ctx.args;
    if (ctx.name === '[') {
      if (args[args.length - 1] !== ']') {
        ctx.error("']' expected");
        return 2;
      }
      args = args.slice(0, -1);
    }
    try {
      return evalTest(args, ctx) ? 0 : 1;
    } catch (e) {
      if (!(e instanceof TestError)) throw e;
      ctx.error(e.message);
      return 2;
    }
  },
}; /** The `test` builtin (also `[`): evaluates conditions for && and ||. */

const trueCmd: CommandDef = {
  name: 'true',
  builtin: true,
  group: 'shell',
  hidden: true,
  summary: { en: 'return true', ko: '참 반환' },
  /**
   * Does nothing and succeeds.
   *
   * Ignores its arguments and produces no output; useful in conditions and loops.
   *
   * @returns {number} Always 0.
   *
   * @example
   * // $ true && echo ok
   * trueCmd.run(ctx); // 0
   */
  run: () => 0,
}; /** The `true` builtin: always exits with 0. */
const falseCmd: CommandDef = {
  name: 'false',
  builtin: true,
  group: 'shell',
  hidden: true,
  summary: { en: 'return false', ko: '거짓 반환' },
  /**
   * Does nothing and fails.
   *
   * Ignores its arguments and produces no output; useful in conditions and loops.
   *
   * @returns {number} Always 1.
   *
   * @example
   * // $ false || echo failed
   * falseCmd.run(ctx); // 1
   */
  run: () => 1,
}; /** The `false` builtin: always exits with 1. */

const printenv: CommandDef = {
  name: 'printenv',
  path: '/usr/bin',
  group: 'shell',
  hidden: true,
  summary: { en: 'print environment variables', ko: '환경 변수 출력' },
  usage: 'printenv [name]',
  /**
   * Prints one environment variable or the whole environment.
   *
   * With a name, prints that variable's value, or prints nothing and fails when it is not in
   * the environment. Without arguments, prints every variable as `NAME=value`.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the optional variable name.
   * @returns {number} 0 on success, 1 when the named variable is not set.
   *
   * @example
   * // $ printenv HOME
   * printenv.run(ctx); // prints the home folder path and returns 0
   */
  run(ctx) {
    if (ctx.args[0]) {
      const v = ctx.env[ctx.args[0]];
      if (v === undefined) return 1;
      ctx.print(v);
      return 0;
    }
    ctx.print(
      Object.entries(ctx.env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    );
    return 0;
  },
}; /** The `printenv` command: prints environment variables. */

export const BUILTIN_COMMANDS: CommandDef[] = [env, printenv, exportCmd, unset, alias, unalias, source, history, clear, which, type, help, man, sudo, exit, logout, powerCommand('shutdown'), powerCommand('reboot'), powerCommand('halt'), sleepCmd, jobsCmd, fg, wait, shellCmd, testCmd, trueCmd, falseCmd]; /** Shell builtins, session, job-control and power commands registered with the shell. */

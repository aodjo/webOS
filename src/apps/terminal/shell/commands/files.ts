/**
 * File system commands, operating on the shared virtual FS. Messages follow the BSD userland
 * that ships with macOS (e.g. "ls: foo: No such file or directory"); like on a real Mac, these
 * low-level tool messages stay in English regardless of the system language.
 */
import { FSError, basename, dirname, fs, isWithin, join, kindOf, t, tildify, type FSNode } from '@/kernel';
import { c } from '../ansi';
import { globMatch } from '../expand';
import type { CommandContext, CommandDef } from '../types';
import {
  byteCompare,
  columns,
  ctime,
  diskUsage,
  fsErrorText,
  getopt,
  humanBytes,
  inodeOf,
  isExecutable,
  lsDate,
  lsSize,
  modeOctal,
  modeString,
  ownerOf,
  padEnd,
  padStart,
  usageError,
  writeDenied,
} from '../util';

/* ───────────────────────── Helpers ───────────────────────── */

/**
 * Colors an entry name the way `ls -G` does.
 *
 * Directories are bold blue, other nodes named `*.app` green and executable
 * files red; names of hidden (dot) nodes are also dimmed, except the `.` and
 * `..` entries. When the output is not a TTY the name is returned unchanged.
 *
 * @param {FSNode} node - Node the name refers to; its type and name pick the color.
 * @param {string} name - Text to display, e.g. the entry name, an operand as typed or a full path.
 * @param {boolean} tty - Whether the output is a terminal; color is only applied when true.
 * @returns {string} The name, wrapped in ANSI color escapes on a TTY.
 *
 * @example
 * const label = colorName(fs.stat('/Applications')!, 'Applications', true);
 * ctx.print(label); // printed in bold blue
 */
export function colorName(node: FSNode, name: string, tty: boolean): string {
  if (!tty) return name;
  let out = name;
  if (node.type === 'dir') out = c.bold(c.blue(name));
  else if (/\.app$/i.test(node.name)) out = c.green(name);
  else if (isExecutable(node)) out = c.red(name);
  if (node.name.startsWith('.') && name !== '.' && name !== '..') out = c.dim(out);
  return out;
}

/**
 * Joins a displayed directory path and a child name.
 *
 * Avoids a doubled slash when the label already ends with `/` (such as `/` or
 * an operand typed as `dir/`), so paths printed by `ls -R`, `find` and `du`
 * keep the spelling the user typed.
 *
 * @param {string} label - Directory path as displayed.
 * @param {string} name - Name of the child entry.
 * @returns {string} The child's displayed path.
 *
 * @example
 * childPath('/', 'Users'); // '/Users'
 * childPath('docs', 'a.txt'); // 'docs/a.txt'
 */
const childPath = (label: string, name: string) => (label.endsWith('/') ? label + name : `${label}/${name}`);
/**
 * Removes trailing slashes from a path argument.
 *
 * Single-character strings, such as the root path `/`, are returned unchanged.
 *
 * @param {string} s - Path as typed.
 * @returns {string} The path without trailing slashes.
 *
 * @example
 * trimSlash('docs///'); // 'docs'
 * trimSlash('/'); // '/'
 */
const trimSlash = (s: string) => (s.length > 1 ? s.replace(/\/+$/, '') : s);

/**
 * Recursively copies a file or directory with `cp -R` semantics.
 *
 * A file replaces an existing destination file (keeping binary `src`, `bytes`
 * and `mime` data) unless `noClobber` is set, in which case the existing file
 * is left alone. A directory is copied as a whole when the destination does
 * not exist; otherwise its children are merged into the existing directory
 * one by one.
 *
 * @param {string} src - Absolute path of the node to copy.
 * @param {string} dst - Absolute destination path.
 * @param {boolean} noClobber - When true, existing destination files are kept (`cp -n`).
 * @returns {void}
 * @throws {FSError} ENOENT when `src` does not exist, EISDIR when a file would replace a
 *   directory, ENOTDIR when a directory would replace a file, or any error raised by the fs
 *   write or copy.
 *
 * @example
 * copyNode('/tmp/notes', '/tmp/notes-backup', false);
 */
function copyNode(src: string, dst: string, noClobber: boolean): void {
  const node = fs.stat(src);
  if (!node) throw new FSError('ENOENT', src);
  const existing = fs.stat(dst);
  if (node.type === 'file') {
    if (existing?.type === 'dir') throw new FSError('EISDIR', dst);
    if (existing && noClobber) return;
    if (existing) fs.writeFile(dst, node.content ?? '', node.src ? { src: node.src, bytes: node.bytes, mime: node.mime } : {});
    else fs.copy(src, dst);
    return;
  }
  if (!existing) {
    fs.copy(src, dst);
    return;
  }
  if (existing.type !== 'dir') throw new FSError('ENOTDIR', dst);
  for (const child of fs.readdir(src)) copyNode(child.path, join(dst, child.name), noClobber);
}

/* ───────────────────────── ls ───────────────────────── */

/** Options of one `ls` invocation, decoded from its flags. */
interface LsOpts {
  /** -a: include dot entries plus `.` and `..`. */
  all: boolean;
  /** -A: include dot entries but not `.` and `..`. */
  almost: boolean;
  long: boolean;
  human: boolean;
  recursive: boolean;
  /** -d: list directory operands themselves instead of their contents. */
  dirAsFile: boolean;
  /** -F: append `/` to directories and `*` to executables. */
  classify: boolean;
  /** One name per line (-1, or output that is not a terminal). */
  one: boolean;
  sort: 'name' | 'time' | 'size';
  reverse: boolean;
}

/** A node together with the name `ls` displays for it (an entry name, `.`, `..` or an operand as typed). */
interface Entry {
  name: string;
  node: FSNode;
}

/**
 * Sorts `ls` entries by name, modification time or size.
 *
 * Time and size sorts put the newest or largest first and break ties by name.
 * Names compare byte-wise, so uppercase sorts before lowercase as in macOS
 * `ls`. With -r the final order is reversed. The input array is not mutated.
 *
 * @param {Entry[]} list - Entries to sort.
 * @param {LsOpts} o - Options supplying the sort key and the reverse flag.
 * @returns {Entry[]} A new, sorted array.
 *
 * @example
 * const sorted = sortEntries(entries, { ...o, sort: 'time' });
 */
function sortEntries(list: Entry[], o: LsOpts): Entry[] {
  const sorted = [...list].sort((a, b) => {
    if (o.sort === 'time') return b.node.modifiedAt - a.node.modifiedAt || byteCompare(a.name, b.name);
    if (o.sort === 'size') return lsSize(b.node) - lsSize(a.node) || byteCompare(a.name, b.name);
    return byteCompare(a.name, b.name);
  });
  return o.reverse ? sorted.reverse() : sorted;
}

/**
 * Lists the entries of a directory for `ls`.
 *
 * Dot entries are included only with -a or -A. With -a the `.` and `..`
 * entries are added too; at the root `..` falls back to the directory itself.
 * The result is sorted with sortEntries.
 *
 * @param {FSNode} dir - Directory node to list.
 * @param {LsOpts} o - Parsed `ls` options.
 * @returns {Entry[]} The sorted entries.
 *
 * @example
 * const entries = dirEntries(fs.stat('/tmp')!, o);
 */
function dirEntries(dir: FSNode, o: LsOpts): Entry[] {
  const kids = fs.readdir(dir.path).filter((n) => o.all || o.almost || !n.name.startsWith('.'));
  const list: Entry[] = kids.map((n) => ({ name: n.name, node: n }));
  if (o.all) {
    list.push({ name: '.', node: dir }, { name: '..', node: fs.stat(dirname(dir.path)) ?? dir });
  }
  return sortEntries(list, o);
}

/**
 * Formats entries as `ls` output lines.
 *
 * In long format (-l) each row shows the mode string, link count (2 plus the
 * number of subdirectories for folders), owner, group, size (human-readable
 * with -h) and date, with the columns aligned to their widest value.
 * Otherwise the names are printed one per line (-1 or non-TTY output) or
 * packed into columns that fit the terminal width. Names are colored on a TTY
 * and get a type suffix with -F.
 *
 * @param {Entry[]} entries - Entries in display order.
 * @param {LsOpts} o - Parsed `ls` options.
 * @param {CommandContext} ctx - Command context, used for TTY detection and the terminal width.
 * @returns {string[]} The output lines.
 *
 * @example
 * out.push(...formatEntries(sortEntries(files, o), o, ctx));
 */
function formatEntries(entries: Entry[], o: LsOpts, ctx: CommandContext): string[] {
  const tty = ctx.stdout.isTTY;
  /**
   * Builds the displayed name of an entry.
   *
   * Colors the name for a TTY and, with -F, appends `/` to directories and
   * `*` to executables.
   *
   * @param {Entry} e - Entry to label.
   * @returns {string} The display name with optional color and suffix.
   *
   * @example
   * const names = entries.map(label);
   */
  const label = (e: Entry) => {
    const suffix = o.classify ? (e.node.type === 'dir' ? '/' : isExecutable(e.node) ? '*' : '') : '';
    return colorName(e.node, e.name, tty) + suffix;
  };
  if (o.long) {
    const now = Date.now();
    const rows = entries.map((e) => {
      const own = ownerOf(e.node);
      const size = lsSize(e.node);
      const links = e.node.type === 'dir' ? 2 + fs.readdir(e.node.path).filter((n) => n.type === 'dir').length : 1;
      return { mode: modeString(e.node), links: String(links), user: own.user, group: own.group, size: o.human ? humanBytes(size) : String(size), date: lsDate(e.node.modifiedAt, now), name: label(e) };
    });
    /**
     * Measures the widest value of a long-format column.
     *
     * The resulting widths right-align link counts and sizes and left-align
     * owner and group names.
     *
     * @param {'links' | 'user' | 'group' | 'size'} k - Column key.
     * @returns {number} Width in characters, 0 when there are no rows.
     *
     * @example
     * const sizeWidth = w('size');
     */
    const w = (k: 'links' | 'user' | 'group' | 'size') => Math.max(0, ...rows.map((r) => r[k].length));
    const [lw, uw, gw, sw] = [w('links'), w('user'), w('group'), w('size')];
    return rows.map((r) => `${r.mode}  ${padStart(r.links, lw)} ${padEnd(r.user, uw)}  ${padEnd(r.group, gw)}  ${padStart(r.size, sw)} ${r.date} ${r.name}`);
  }
  const names = entries.map(label);
  return o.one ? names : columns(names, ctx.term.size().cols);
}

const LS_USAGE = 'ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]'; /** Full BSD synopsis printed by `ls` after an invalid option. */

const ls: CommandDef = {
  name: 'ls',
  group: 'files',
  summary: { en: 'list directory contents', ko: '디렉터리 내용 나열' },
  usage: 'ls [-1AaCdFhlRrSt] [file ...]',
  description: {
    en: 'For each operand that names a directory, ls lists the files it contains; for files, the name itself. Folders are shown in blue, applications in green and hidden files dimmed.',
    ko: '디렉터리를 지정하면 그 안의 파일을, 파일을 지정하면 파일 이름을 표시합니다. 폴더는 파란색, 응용 프로그램은 초록색, 숨김 파일은 흐리게 표시됩니다.',
  },
  options: [
    ['-a', { en: 'Include entries whose names begin with a dot, plus . and ..', ko: '마침표로 시작하는 항목과 ., ..도 표시' }],
    ['-A', { en: 'Like -a, but without . and ..', ko: '-a와 같지만 .과 ..는 제외' }],
    ['-l', { en: 'Long format: permissions, links, owner, size, date', ko: '자세히: 권한, 링크 수, 소유자, 크기, 날짜' }],
    ['-h', { en: 'With -l, human-readable sizes (K, M, G)', ko: '-l과 함께 사람이 읽기 쉬운 크기(K, M, G)' }],
    ['-1', { en: 'One entry per line', ko: '한 줄에 하나씩' }],
    ['-R', { en: 'Recursively list subdirectories', ko: '하위 디렉터리까지 재귀적으로 나열' }],
    ['-t', { en: 'Sort by modification time, newest first', ko: '수정 시간순 정렬 (최신 순)' }],
    ['-S', { en: 'Sort by size, largest first', ko: '크기순 정렬 (큰 순)' }],
    ['-r', { en: 'Reverse the sort order', ko: '정렬 순서 반대로' }],
    ['-F', { en: 'Append / to folders and * to executables', ko: '폴더에 /, 실행 파일에 * 표시' }],
    ['-d', { en: 'List directories themselves, not their contents', ko: '디렉터리 내용 대신 디렉터리 자체를 나열' }],
  ],
  /**
   * Runs `ls`, listing files and directory contents.
   *
   * Operands (default `.`) are sorted byte-wise; missing ones are reported and
   * set exit status 1. File operands are listed first, then the contents of
   * each directory operand (or the directories themselves with -d). A `name:`
   * header precedes each directory when there are several operands or files
   * were listed. In long format each directory starts with a `total` line
   * counting the 512-byte blocks used by its files. With -R subdirectories are
   * listed recursively under their own headers. When stdout is not a TTY the
   * output is one entry per line unless -C is given.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 if an operand does not exist or an option is invalid.
   *
   * @example
   * // $ ls -la ~
   * const status = ls.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: '1aAdFGhlRrStCU', long: { color: 'G', all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', reverse: 'r', classify: 'F', directory: 'd' } });
    if (error) return usageError(ctx, error, LS_USAGE);
    const o: LsOpts = {
      all: !!opts.a,
      almost: !!opts.A,
      long: !!opts.l,
      human: !!opts.h,
      recursive: !!opts.R,
      dirAsFile: !!opts.d,
      classify: !!opts.F,
      one: !!opts['1'] || (!ctx.stdout.isTTY && !opts.C),
      sort: opts.t ? 'time' : opts.S ? 'size' : 'name',
      reverse: !!opts.r,
    };
    let status = 0;
    const targets = operands.length ? operands : ['.'];
    const files: Entry[] = [];
    const dirs: { label: string; node: FSNode }[] = [];
    for (const t of [...targets].sort(byteCompare)) {
      const node = fs.stat(ctx.resolve(t));
      if (!node) {
        ctx.error(`${t}: No such file or directory`);
        status = 1;
      } else if (node.type === 'dir' && !o.dirAsFile) dirs.push({ label: t, node });
      else files.push({ name: t, node });
    }

    const out: string[] = [];
    if (files.length) out.push(...formatEntries(sortEntries(files, o), o, ctx));
    const header = targets.length > 1 || files.length > 0;
    /**
     * Appends one directory's listing to the output, recursing with -R.
     *
     * Adds the `total` line in long format, then the formatted entries. With
     * -R every subdirectory (except `.` and `..`) follows after a blank line
     * and a `path:` header.
     *
     * @param {string} label - Directory path as displayed.
     * @param {FSNode} dir - Directory node to list.
     * @returns {void}
     *
     * @example
     * listDir('.', fs.stat(ctx.cwd)!);
     */
    const listDir = (label: string, dir: FSNode) => {
      const entries = dirEntries(dir, o);
      if (o.long) out.push(`total ${entries.filter((e) => e.node.type === 'file').reduce((s, e) => s + diskUsage(lsSize(e.node)) / 512, 0)}`);
      out.push(...formatEntries(entries, o, ctx));
      if (!o.recursive) return;
      for (const e of entries) {
        if (e.node.type !== 'dir' || e.name === '.' || e.name === '..') continue;
        const sub = childPath(label, e.name);
        out.push('', `${sub}:`);
        listDir(sub, e.node);
      }
    };
    dirs.forEach((d, i) => {
      if (i > 0 || files.length) out.push('');
      if (header) out.push(`${d.label}:`);
      listDir(d.label, d.node);
    });
    if (out.length) ctx.print(out.join('\n'));
    return status;
  },
}; /** `ls` command: lists directory contents in columns, one per line, or in long format. */

/* ───────────────────────── cd / pwd ───────────────────────── */

const cd: CommandDef = {
  name: 'cd',
  builtin: true,
  group: 'files',
  summary: { en: 'change the working directory', ko: '작업 디렉터리 변경' },
  usage: 'cd [dir | - | ~]',
  description: {
    en: 'Changes the current directory. With no argument goes home; "cd -" returns to the previous directory; "cd .." goes up one level.',
    ko: '현재 디렉터리를 변경합니다. 인자가 없으면 홈으로, "cd -"는 이전 디렉터리로, "cd .."는 상위 디렉터리로 이동합니다.',
  },
  /**
   * Runs `cd`, changing the shell's working directory.
   *
   * `-P` and `-L` are accepted and ignored. Without an argument it goes to
   * $HOME (or `/`); `cd -` switches to $OLDPWD and prints it with `~`
   * abbreviation. Two or more arguments fail with zsh's "string not in pwd".
   * The target must exist and be a directory.
   *
   * @param {CommandContext} ctx - Command context with arguments and shell access.
   * @returns {number} 0 on success, 1 on error.
   *
   * @example
   * // $ cd ~/Documents
   * const status = cd.run(ctx); // 0
   */
  run(ctx) {
    const args = ctx.args.filter((a) => a !== '-P' && a !== '-L');
    if (args.length > 1) {
      ctx.error(`string not in pwd: ${args[0]}`);
      return 1;
    }
    let target = args[0] ?? ctx.shell.getVar('HOME') ?? '/';
    if (target === '-') {
      const old = ctx.shell.getVar('OLDPWD');
      if (!old) {
        ctx.error('OLDPWD not set');
        return 1;
      }
      target = old;
      ctx.print(tildify(target));
    }
    const path = ctx.resolve(target);
    const node = fs.stat(path);
    if (!node) {
      ctx.error(`no such file or directory: ${args[0]}`);
      return 1;
    }
    if (node.type !== 'dir') {
      ctx.error(`not a directory: ${args[0]}`);
      return 1;
    }
    ctx.setCwd(path);
    return 0;
  },
}; /** `cd` builtin: changes the shell's working directory. */

const pwd: CommandDef = {
  name: 'pwd',
  builtin: true,
  group: 'files',
  summary: { en: 'print the working directory', ko: '현재 작업 디렉터리 출력' },
  usage: 'pwd [-L | -P]',
  /**
   * Runs `pwd`, printing the shell's current directory.
   *
   * Options are ignored; the shell's `cwd` is printed as is.
   *
   * @param {CommandContext} ctx - Command context with shell access.
   * @returns {number} Always 0.
   *
   * @example
   * // $ pwd
   * pwd.run(ctx); // prints the shell's cwd
   */
  run(ctx) {
    ctx.print(ctx.shell.cwd);
    return 0;
  },
}; /** `pwd` builtin: prints the working directory. */

/* ───────────────────────── cat ───────────────────────── */

const cat: CommandDef = {
  name: 'cat',
  aliases: ['less', 'more'],
  group: 'text',
  summary: { en: 'concatenate and print files', ko: '파일 내용을 이어서 출력' },
  usage: 'cat [-nbs] [file ...]',
  description: {
    en: 'Reads files in order and writes them to standard output. With no file (or "-"), reads standard input — type lines and press ^D to finish.',
    ko: '파일을 차례로 읽어 표준 출력에 씁니다. 파일이 없거나 "-"이면 표준 입력을 읽습니다 — 줄을 입력한 뒤 ^D로 끝내세요.',
  },
  options: [
    ['-n', { en: 'Number all output lines', ko: '모든 줄에 번호 붙이기' }],
    ['-b', { en: 'Number non-blank lines', ko: '빈 줄이 아닌 줄에만 번호 붙이기' }],
    ['-s', { en: 'Squeeze multiple blank lines', ko: '연속된 빈 줄을 하나로' }],
  ],
  /**
   * Runs `cat`, writing files or standard input to stdout.
   *
   * Operands are processed in order; `-` or no operands read stdin. Piped input
   * is used directly, while on a terminal lines are read interactively and
   * echoed back as they are entered until ^D or ^C. `-n` numbers every line,
   * `-b` only non-blank lines and `-s` squeezes runs of blank lines; the line
   * count and blank-line state carry across all inputs. Directories, missing
   * files and binary files (with a hint to use `open`) are reported and set
   * exit status 1.
   *
   * @async
   * @param {CommandContext} ctx - Command context with arguments, stdin, terminal and output streams.
   * @returns {Promise<number>} 0 on success, 1 if an operand could not be printed or an option is invalid.
   *
   * @example
   * // $ cat -n notes.txt
   * const status = await cat.run(ctx); // 0
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'nbsuveEt' });
    if (error) return usageError(ctx, error, 'cat [-belnstuv] [file ...]');
    const number = opts.n || opts.b;
    let lineNo = 0;
    let lastBlank = false;
    /**
     * Writes a chunk of input, applying the numbering and squeezing options.
     *
     * Without -n, -b or -s the text is written unchanged. Otherwise it is split
     * into lines (keeping a trailing newline), repeated blank lines are dropped
     * with -s, and numbered lines get the running count right-aligned to six
     * columns followed by a tab.
     *
     * @param {string} text - Input text (a whole file or one typed line).
     * @returns {void}
     *
     * @example
     * emit(node.content ?? '');
     */
    const emit = (text: string) => {
      if (!number && !opts.s) return ctx.stdout.write(text);
      const lines = text.split('\n');
      const trailing = lines[lines.length - 1] === '';
      if (trailing) lines.pop();
      const out: string[] = [];
      for (const l of lines) {
        if (opts.s && l === '' && lastBlank) continue;
        lastBlank = l === '';
        if (number && !(opts.b && l === '')) out.push(`${padStart(++lineNo, 6)}\t${l}`);
        else out.push(l);
      }
      ctx.stdout.write(out.join('\n') + (trailing ? '\n' : ''));
    };
    let status = 0;
    for (const f of operands.length ? operands : ['-']) {
      if (f === '-') {
        if (ctx.stdin !== null) emit(ctx.stdin);
        else {
          for (;;) {
            const line = await ctx.term.readLine('', { signal: ctx.signal });
            if (line === null) break;
            emit(line + '\n');
          }
        }
        continue;
      }
      const node = fs.stat(ctx.resolve(f));
      if (!node) {
        ctx.error(`${f}: No such file or directory`);
        status = 1;
      } else if (node.type === 'dir') {
        ctx.error(`${f}: Is a directory`);
        status = 1;
      } else if (node.src) {
        const size = humanBytes(fs.size(node.path));
        ctx.stderr.write(`${ctx.name}: ${f}: ${t({ en: `binary file (${size}) — try \`open ${f}\``, ko: `바이너리 파일(${size}) — \`open ${f}\`(으)로 열어 보세요` })}\n`);
        status = 1;
      } else emit(node.content ?? '');
    }
    return status;
  },
}; /** `cat` command (also run as `less` and `more`): concatenates files or stdin to stdout. */

/* ───────────────────────── mkdir / rmdir / touch ───────────────────────── */

const mkdir: CommandDef = {
  name: 'mkdir',
  group: 'files',
  summary: { en: 'make directories', ko: '디렉터리 만들기' },
  usage: 'mkdir [-pv] [-m mode] directory_name ...',
  options: [
    ['-p', { en: 'Create intermediate directories as required; no error if it exists', ko: '필요한 상위 디렉터리도 함께 생성, 이미 있어도 오류 없음' }],
    ['-v', { en: 'Print each directory as it is created', ko: '생성한 디렉터리 출력' }],
  ],
  /**
   * Runs `mkdir`, creating each named directory.
   *
   * An existing path fails with "File exists", except an existing directory
   * with -p. Write permission is checked up front on the directory that will
   * receive the new folder: the parent, or with -p the deepest ancestor that
   * already exists. -p creates missing parents, -v prints each created
   * operand, and `-m mode` is accepted and ignored.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 if a directory could not be created, an option is
   *   invalid or no operand was given.
   *
   * @example
   * // $ mkdir -p projects/demo
   * const status = mkdir.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'pv', values: 'm' });
    if (error || !operands.length) return usageError(ctx, error ?? 'missing operand', 'mkdir [-pv] [-m mode] directory_name ...');
    let status = 0;
    for (const t of operands) {
      const path = ctx.resolve(t);
      const existing = fs.stat(path);
      if (existing) {
        if (opts.p && existing.type === 'dir') continue;
        ctx.error(`${t}: File exists`);
        status = 1;
        continue;
      }
      let parent = dirname(path);
      while (!fs.exists(parent) && opts.p) parent = dirname(parent);
      const denied = fs.isDir(parent) ? writeDenied(parent) : null;
      if (denied) {
        ctx.error(`${t}: ${denied}`);
        status = 1;
        continue;
      }
      try {
        fs.mkdir(path, { recursive: !!opts.p });
        if (opts.v) ctx.print(t);
      } catch (e) {
        ctx.error(`${t}: ${fsErrorText(e)}`);
        status = 1;
      }
    }
    return status;
  },
}; /** `mkdir` command: creates directories. */

const rmdir: CommandDef = {
  name: 'rmdir',
  group: 'files',
  summary: { en: 'remove empty directories', ko: '빈 디렉터리 삭제' },
  usage: 'rmdir [-pv] directory ...',
  /**
   * Runs `rmdir`, removing each named empty directory.
   *
   * Fails for missing paths, non-directories, non-empty directories and
   * directories whose parent is not writable. -v prints each removed operand;
   * -p is accepted but parent directories are not removed.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 when every directory was removed, otherwise 1.
   *
   * @example
   * // $ rmdir old-folder
   * const status = rmdir.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'pv' });
    if (error || !operands.length) return usageError(ctx, error ?? 'missing operand', 'rmdir [-pv] directory ...');
    let status = 0;
    for (const t of operands) {
      const path = ctx.resolve(t);
      const node = fs.stat(path);
      if (!node) ctx.error(`${t}: No such file or directory`);
      else if (node.type !== 'dir') ctx.error(`${t}: Not a directory`);
      else if (fs.readdir(path).length) ctx.error(`${t}: Directory not empty`);
      else {
        try {
          const denied = writeDenied(dirname(path));
          if (denied) throw new Error(denied);
          fs.rm(path);
          if (opts.v) ctx.print(t);
          continue;
        } catch (e) {
          ctx.error(`${t}: ${fsErrorText(e)}`);
        }
      }
      status = 1;
    }
    return status;
  },
}; /** `rmdir` command: removes empty directories. */

const touch: CommandDef = {
  name: 'touch',
  group: 'files',
  summary: { en: 'create files or update their timestamps', ko: '파일 생성 또는 수정 시간 갱신' },
  usage: 'touch [-c] file ...',
  options: [['-c', { en: 'Do not create files that do not exist', ko: '없는 파일은 만들지 않음' }]],
  /**
   * Runs `touch`, creating missing files or refreshing existing ones.
   *
   * A missing file is created empty (unless -c) when its parent directory
   * exists and is writable. An existing file is rewritten with its own content
   * and binary data, which updates its modification time; locked files and
   * files in read-only locations fail with "Operation not permitted". Existing
   * directories are left untouched. The other BSD options are accepted and
   * ignored.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 if a file could not be touched, an option is invalid or
   *   no operand was given.
   *
   * @example
   * // $ touch todo.txt
   * const status = touch.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'acfhm', values: 'rtd' });
    if (error || !operands.length) return usageError(ctx, error ?? 'missing operand', 'touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]] [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...');
    let status = 0;
    for (const t of operands) {
      const path = ctx.resolve(t);
      const node = fs.stat(path);
      try {
        if (!node) {
          if (opts.c) continue;
          if (!fs.isDir(dirname(path))) throw new FSError('ENOENT', path);
          const denied = writeDenied(dirname(path));
          if (denied) throw new Error(denied);
          fs.writeFile(path, '');
        } else if (node.type === 'file') {
          if (node.meta?.locked || writeDenied(dirname(path))) throw new FSError('EPERM', path);
          fs.writeFile(path, node.content ?? '', node.src ? { src: node.src, bytes: node.bytes, mime: node.mime } : {});
        }
      } catch (e) {
        ctx.error(`${t}: ${fsErrorText(e)}`);
        status = 1;
      }
    }
    return status;
  },
}; /** `touch` command: creates empty files or updates their modification time. */

/* ───────────────────────── rm / mv / cp ───────────────────────── */

const rm: CommandDef = {
  name: 'rm',
  group: 'files',
  summary: { en: 'remove files or directories', ko: '파일 또는 디렉터리 삭제' },
  usage: 'rm [-dfRrv] file ...',
  description: {
    en: 'Removes files immediately — unlike the Trash in Finder, this cannot be undone. System files are protected.',
    ko: '파일을 즉시 삭제합니다 — Finder의 휴지통과 달리 되돌릴 수 없습니다. 시스템 파일은 보호됩니다.',
  },
  options: [
    ['-r, -R', { en: 'Remove directories and their contents recursively', ko: '디렉터리와 그 내용을 재귀적으로 삭제' }],
    ['-f', { en: 'Ignore nonexistent files, never prompt', ko: '존재하지 않는 파일 무시' }],
    ['-d', { en: 'Remove empty directories too', ko: '빈 디렉터리도 삭제' }],
    ['-v', { en: 'Print each file as it is removed', ko: '삭제한 파일 출력' }],
  ],
  /**
   * Runs `rm`, deleting each operand immediately instead of moving it to the Trash.
   *
   * Refuses to remove `/`, `.` and `..`. Missing operands are errors unless -f,
   * which also makes a call without operands succeed silently. Directories
   * need -r/-R, or -d when they are empty. Protected system paths and paths
   * whose parent is not writable fail; everything else is removed recursively.
   * -v prints each removed operand.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 if an operand failed or an option is invalid, 64 when
   *   no operand is given without -f.
   *
   * @example
   * // $ rm -r build
   * const status = rm.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'dfiIPRrvWx' });
    const usage = 'rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file';
    if (error) return usageError(ctx, error, usage);
    if (!operands.length) {
      if (opts.f) return 0;
      ctx.stderr.write(`usage: ${usage}\n`);
      return 64;
    }
    const recursive = opts.r || opts.R;
    let status = 0;
    for (const t of operands) {
      const path = ctx.resolve(t);
      const base = trimSlash(t).split('/').pop();
      if (path === '/') {
        ctx.error('"/" may not be removed');
        status = 1;
        continue;
      }
      if (base === '.' || base === '..') {
        ctx.error('"." and ".." may not be removed');
        status = 1;
        continue;
      }
      const node = fs.stat(path);
      if (!node) {
        if (!opts.f) {
          ctx.error(`${t}: No such file or directory`);
          status = 1;
        }
        continue;
      }
      if (node.type === 'dir' && !recursive && !(opts.d && !fs.readdir(path).length)) {
        ctx.error(`${t}: is a directory`);
        status = 1;
        continue;
      }
      try {
        const denied = writeDenied(dirname(path));
        if (fs.isProtected(path) || denied) throw new Error(fs.isProtected(path) ? 'Operation not permitted' : denied!);
        fs.rm(path, { recursive: true });
        if (opts.v) ctx.print(t);
      } catch (e) {
        ctx.error(`${t}: ${fsErrorText(e)}`);
        status = 1;
      }
    }
    return status;
  },
}; /** `rm` command: permanently removes files and directories. */

const mv: CommandDef = {
  name: 'mv',
  group: 'files',
  summary: { en: 'move or rename files', ko: '파일 이동 또는 이름 변경' },
  usage: 'mv [-fnv] source ... target',
  options: [
    ['-n', { en: 'Do not overwrite an existing file', ko: '기존 파일을 덮어쓰지 않음' }],
    ['-v', { en: 'Print each move', ko: '이동 내역 출력' }],
  ],
  /**
   * Runs `mv`, moving sources onto a target path or into a target directory.
   *
   * With several sources the last operand must be a directory. When the
   * target is an existing directory each source moves into it; otherwise the
   * single source is renamed. Moving onto itself, a file over a directory, a
   * directory over a non-empty directory or a directory over a file is
   * refused, and -n skips existing targets. Both the source and destination
   * parents must be writable. If the shell's working directory lies inside a
   * moved directory it follows to the new location. -v prints
   * `source -> target`.
   *
   * @param {CommandContext} ctx - Command context with arguments, output streams and shell access.
   * @returns {number} 0 on success, 1 if a move failed, 64 on a usage error.
   *
   * @example
   * // $ mv draft.txt final.txt
   * const status = mv.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'fhinv' });
    const usage = 'mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory';
    if (error || operands.length < 2) {
      if (error) ctx.error(error);
      ctx.stderr.write(`usage: ${usage}\n`);
      return 64;
    }
    const dest = operands[operands.length - 1];
    const destPath = ctx.resolve(dest);
    const destNode = fs.stat(destPath);
    const sources = operands.slice(0, -1);
    if (sources.length > 1 && destNode?.type !== 'dir') {
      ctx.error(`${dest} is not a directory`);
      return 1;
    }
    let status = 0;
    for (const s of sources) {
      const src = ctx.resolve(s);
      const into = destNode?.type === 'dir';
      const target = into ? join(destPath, basename(src)) : destPath;
      const shown = into ? `${trimSlash(dest)}/${basename(src)}` : dest;
      /**
       * Reports a failed move of the current source and marks the run as failed.
       *
       * Prints `rename <source> to <target>: <msg>` like BSD mv and sets the
       * exit status to 1.
       *
       * @param {string} msg - Reason, e.g. `Directory not empty`.
       * @returns {void}
       *
       * @example
       * fail('No such file or directory');
       */
      const fail = (msg: string) => {
        ctx.error(`rename ${s} to ${shown}: ${msg}`);
        status = 1;
      };
      const node = fs.stat(src);
      if (!node) {
        fail('No such file or directory');
        continue;
      }
      if (src === target) {
        ctx.error(`${s} and ${shown} are identical`);
        status = 1;
        continue;
      }
      const existing = fs.stat(target);
      if (existing && opts.n) continue;
      if (existing?.type === 'dir' && (node.type !== 'dir' || fs.readdir(target).length)) {
        fail(node.type !== 'dir' ? 'Is a directory' : 'Directory not empty');
        continue;
      }
      if (existing?.type === 'file' && node.type === 'dir') {
        fail('Not a directory');
        continue;
      }
      const denied = writeDenied(dirname(src)) ?? (fs.isDir(dirname(target)) ? writeDenied(dirname(target)) : null);
      if (denied) {
        fail(denied);
        continue;
      }
      try {
        fs.move(src, target, { overwrite: true });
        if (opts.v) ctx.print(`${s} -> ${shown}`);
        if (isWithin(ctx.shell.cwd, src)) ctx.setCwd(target + ctx.shell.cwd.slice(src.length));
      } catch (e) {
        fail(fsErrorText(e));
      }
    }
    return status;
  },
}; /** `mv` command: moves or renames files and directories. */

const cp: CommandDef = {
  name: 'cp',
  group: 'files',
  summary: { en: 'copy files', ko: '파일 복사' },
  usage: 'cp [-Rnv] source ... target',
  options: [
    ['-R, -r', { en: 'Copy directories recursively', ko: '디렉터리를 재귀적으로 복사' }],
    ['-n', { en: 'Do not overwrite an existing file', ko: '기존 파일을 덮어쓰지 않음' }],
    ['-v', { en: 'Print each copy', ko: '복사 내역 출력' }],
  ],
  /**
   * Runs `cp`, copying sources to a target path or into a target directory.
   *
   * With several sources the last operand must be a directory. Directories
   * need -R/-r (or -a). Copying a node onto itself or into its own subtree is
   * refused, and the destination's parent must be writable. Copies go through
   * copyNode, so directories merge into existing ones and files are
   * overwritten unless -n; paths in its errors are shown as the user typed
   * them. -v prints `source -> target`.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 if a copy failed, 64 on a usage error.
   *
   * @example
   * // $ cp -R photos backup
   * const status = cp.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'RrafinpvPHLcsXx' });
    const usage = 'cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory';
    if (error || operands.length < 2) {
      if (error) ctx.error(error);
      ctx.stderr.write(`usage: ${usage}\n`);
      return 64;
    }
    const recursive = opts.R || opts.r || opts.a;
    const dest = operands[operands.length - 1];
    const destPath = ctx.resolve(dest);
    const destNode = fs.stat(destPath);
    const sources = operands.slice(0, -1);
    if (sources.length > 1 && destNode?.type !== 'dir') {
      ctx.error(`${dest} is not a directory`);
      return 1;
    }
    let status = 0;
    for (const s of sources) {
      const src = ctx.resolve(s);
      const node = fs.stat(src);
      if (!node) {
        ctx.error(`${s}: No such file or directory`);
        status = 1;
        continue;
      }
      if (node.type === 'dir' && !recursive) {
        ctx.error(`${s} is a directory (not copied).`);
        status = 1;
        continue;
      }
      const into = destNode?.type === 'dir';
      const target = into ? join(destPath, basename(src)) : destPath;
      const shown = into ? `${trimSlash(dest)}/${basename(src)}` : dest;
      if (target === src) {
        ctx.error(`${s} and ${shown} are identical (not copied).`);
        status = 1;
        continue;
      }
      if (isWithin(target, src)) {
        ctx.error(`${shown} is inside ${s}`);
        status = 1;
        continue;
      }
      const parent = dirname(target);
      const denied = fs.isDir(parent) ? writeDenied(parent) : null;
      if (denied) {
        ctx.error(`${shown}: ${denied}`);
        status = 1;
        continue;
      }
      try {
        copyNode(src, target, !!opts.n);
        if (opts.v) ctx.print(`${s} -> ${shown}`);
      } catch (e) {
        ctx.error(`${e instanceof FSError ? e.path.replace(target, shown) : shown}: ${fsErrorText(e)}`);
        status = 1;
      }
    }
    return status;
  },
}; /** `cp` command: copies files and directories. */

/* ───────────────────────── chmod ───────────────────────── */

const MODE_RE = /^([0-7]{3,4}|[ugoa]*[-+=][rwxXst]*([-+=][rwxXst]*)*(,[ugoa]*[-+=][rwxXst]*([-+=][rwxXst]*)*)*)$/; /** Valid chmod modes: 3-4 octal digits, or comma-separated symbolic clauses such as `u+x` or `go-w`. */

const chmod: CommandDef = {
  name: 'chmod',
  path: '/bin',
  group: 'files',
  summary: { en: 'change file modes', ko: '파일 권한 변경' },
  usage: 'chmod [-Rv] mode file ...',
  description: {
    en: 'Accepts the usual modes (755, +x, u+w…). On this disk permissions follow the file itself: scripts (.sh or #!) are executable, and system files stay read-only.',
    ko: '일반적인 모드(755, +x, u+w…)를 받습니다. 이 디스크에서는 권한이 파일에 따라 정해집니다: 스크립트(.sh 또는 #!)는 실행 가능하고, 시스템 파일은 읽기 전용입니다.',
  },
  /**
   * Runs `chmod`, validating the mode and files without storing permissions.
   *
   * Only leading arguments made up of the known flags (-R, -f, -h, -v, -H,
   * -L, -P) are taken as options, because symbolic modes such as `-x` also
   * start with a dash. The mode must match MODE_RE. Permissions are derived
   * from each file (scripts are executable, system files read-only), so
   * nothing is changed: missing files and root-owned files without sudo are
   * reported (silently with -f) and -v prints each accepted file.
   *
   * @param {CommandContext} ctx - Command context with arguments, output streams and sudo state.
   * @returns {number} 0 on success, 1 on a usage error, an invalid mode or a file that failed.
   *
   * @example
   * // $ chmod +x build.sh
   * const status = chmod.run(ctx); // 0
   */
  run(ctx) {
    const args = [...ctx.args];
    const flags = new Set<string>();
    while (/^-[RfhvHLP]+$/.test(args[0] ?? '')) for (const ch of args.shift()!.slice(1)) flags.add(ch);
    const [mode, ...files] = args;
    const usage = 'chmod [-fhv] [-R [-H | -L | -P]] [-a | +a | =a  [i][# [ n]]] mode|entry file ...\n       chmod [-fhv] [-R [-H | -L | -P]] [-E | -C | -N | -i | -I] file ...';
    if (!mode || !files.length) {
      ctx.stderr.write(`usage: ${usage}\n`);
      return 1;
    }
    if (!MODE_RE.test(mode)) {
      ctx.error(`Invalid file mode: ${mode}`);
      return 1;
    }
    let status = 0;
    for (const f of files) {
      const node = fs.stat(ctx.resolve(f));
      if (!node) {
        if (!flags.has('f')) ctx.error(`${f}: No such file or directory`);
        status = 1;
      } else if (ownerOf(node).uid === 0 && !ctx.sudo) {
        if (!flags.has('f')) ctx.error(`Unable to change file mode on ${f}: Operation not permitted`);
        status = 1;
      } else if (flags.has('v')) ctx.print(f);
    }
    return status;
  },
}; /** `chmod` command: validates modes; permissions on this disk derive from the files themselves. */

/* ───────────────────────── tree / find ───────────────────────── */

const tree: CommandDef = {
  name: 'tree',
  path: '/usr/local/bin',
  group: 'files',
  summary: { en: 'list contents of directories in a tree-like format', ko: '디렉터리 내용을 트리 형태로 표시' },
  usage: 'tree [-ad] [-L level] [directory ...]',
  options: [
    ['-a', { en: 'Include hidden files', ko: '숨김 파일 포함' }],
    ['-d', { en: 'List directories only', ko: '디렉터리만 표시' }],
    ['-L level', { en: 'Descend only level directories deep', ko: '지정한 깊이까지만 표시' }],
  ],
  /**
   * Runs `tree`, drawing each directory operand as a tree.
   *
   * Children are sorted with a locale-aware name comparison; dot entries
   * appear only with -a and -d shows directories only. -L limits the depth and
   * must be greater than 0; -f prints full paths instead of names.
   * Non-directory operands print `[error opening dir]`. A final summary counts
   * the directories and files across all operands.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 for an invalid option or -L level, 2 if an operand is
   *   not a directory.
   *
   * @example
   * // $ tree -L 2 ~/Documents
   * const status = tree.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'adfC', values: 'L' });
    if (error) return usageError(ctx, error, 'tree [-adfC] [-L level] [directory ...]');
    const max = opts.L !== undefined ? Number(opts.L) : Infinity;
    if (!(max > 0)) {
      ctx.error('Invalid level, must be greater than 0.');
      return 1;
    }
    const tty = ctx.stdout.isTTY;
    let dirs = 0;
    let files = 0;
    const out: string[] = [];
    /**
     * Appends the subtree of a directory to the output.
     *
     * Each child gets a `├── ` or `└── ` connector after the prefix.
     * Directories are counted and descended into while `depth` is below the -L
     * limit, extending the prefix with `│   ` or blanks; files are only counted.
     *
     * @param {string} path - Directory to list.
     * @param {string} prefix - Indentation drawn before each child's connector.
     * @param {number} depth - Depth of the children being listed (1 for an operand's direct children).
     * @returns {void}
     *
     * @example
     * walk(node.path, '', 1);
     */
    const walk = (path: string, prefix: string, depth: number) => {
      const kids = fs
        .readdir(path)
        .filter((n) => (opts.a || !n.name.startsWith('.')) && (!opts.d || n.type === 'dir'))
        .sort((a, b) => a.name.localeCompare(b.name));
      kids.forEach((k, i) => {
        const last = i === kids.length - 1;
        out.push(`${prefix}${last ? '└── ' : '├── '}${colorName(k, opts.f ? k.path : k.name, tty)}`);
        if (k.type === 'dir') {
          dirs++;
          if (depth < max) walk(k.path, prefix + (last ? '    ' : '│   '), depth + 1);
        } else files++;
      });
    };
    let status = 0;
    for (const t of operands.length ? operands : ['.']) {
      const node = fs.stat(ctx.resolve(t));
      if (!node || node.type !== 'dir') {
        out.push(`${t}  [error opening dir]`);
        status = 2;
        continue;
      }
      out.push(colorName(node, t, tty));
      walk(node.path, '', 1);
    }
    out.push('', opts.d ? `${dirs} director${dirs === 1 ? 'y' : 'ies'}` : `${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`);
    ctx.print(out.join('\n'));
    return status;
  },
}; /** `tree` command: prints directories as an indented tree with box-drawing connectors. */

/** A compiled `find` test: receives a node and its displayed path and reports whether it matches. */
type Primary = (n: FSNode, display: string) => boolean;

const find: CommandDef = {
  name: 'find',
  path: '/usr/bin',
  group: 'files',
  summary: { en: 'walk a file hierarchy', ko: '파일 계층 구조 검색' },
  usage: 'find [path ...] [-name pattern] [-iname pattern] [-type f|d] [-maxdepth n]',
  options: [
    ['-name pattern', { en: 'File name matches the glob pattern (quote it!)', ko: '파일 이름이 glob 패턴과 일치 (따옴표로 감싸세요)' }],
    ['-iname pattern', { en: 'Like -name, case-insensitive', ko: '-name과 같지만 대소문자 무시' }],
    ['-type f|d', { en: 'Regular files or directories only', ko: '일반 파일 또는 디렉터리만' }],
    ['-maxdepth n', { en: 'Descend at most n levels', ko: '최대 n 단계까지만 탐색' }],
    ['-mindepth n', { en: 'Skip the first n levels', ko: '처음 n 단계는 건너뜀' }],
    ['-path pattern', { en: 'Path matches the pattern', ko: '경로가 패턴과 일치' }],
    ['-empty', { en: 'Empty files and folders', ko: '비어 있는 파일과 폴더' }],
    ['! / -not', { en: 'Negate the next test', ko: '다음 조건을 부정' }],
  ],
  /**
   * Runs `find`, printing the paths below each starting point that pass every test.
   *
   * Leading operands not starting with `-`, `!` or `(` are starting paths
   * (default `.`). The remaining tokens compile into tests that must all
   * match: -name/-iname glob the entry name, -path globs the displayed path,
   * -type f|d checks the node type and -empty matches empty files and
   * folders; `!`/-not negate the next test, -maxdepth/-mindepth limit the
   * depth and -print is accepted as a no-op. An unknown primary or a missing
   * argument prints an error before anything is walked. Children are visited
   * in byte-wise order and the walk stops once the command is aborted.
   *
   * @param {CommandContext} ctx - Command context with arguments, output streams and abort signal.
   * @returns {number} 0 on success, 1 for an invalid expression or a missing starting path.
   *
   * @example
   * // $ find . -name '*.md' -type f
   * const status = find.run(ctx); // 0
   */
  run(ctx) {
    const args = [...ctx.args];
    const paths: string[] = [];
    while (args.length && !args[0].startsWith('-') && args[0] !== '!' && args[0] !== '(') paths.push(args.shift()!);
    const tests: Primary[] = [];
    let maxDepth = Infinity;
    let minDepth = 0;
    let negateNext = false;
    /**
     * Adds a test to the expression, applying a pending negation.
     *
     * If `!` or -not preceded this test, the predicate is wrapped to invert
     * its result and the pending negation is cleared.
     *
     * @param {Primary} p - Predicate for the parsed primary.
     * @returns {void}
     *
     * @example
     * add((n) => n.type === 'dir');
     */
    const add = (p: Primary) => {
      const neg = negateNext;
      negateNext = false;
      tests.push(neg ? (n, d) => !p(n, d) : p);
    };
    while (args.length) {
      const tok = args.shift()!;
      /**
       * Takes the argument of the current primary from the remaining tokens.
       *
       * Shifts the next token off the remaining arguments, so parsing resumes
       * after it; the thrown error is caught by the parser and printed.
       *
       * @returns {string} The argument, e.g. the pattern after -name.
       * @throws {Error} `<primary>: requires additional arguments` when no token is left.
       *
       * @example
       * const pat = needArg();
       */
      const needArg = () => {
        const v = args.shift();
        if (v === undefined) throw new Error(`${tok}: requires additional arguments`);
        return v;
      };
      try {
        switch (tok) {
          case '!':
          case '-not':
            negateNext = !negateNext;
            break;
          case '-name': {
            const pat = needArg();
            add((n) => globMatch(pat, n.name));
            break;
          }
          case '-iname': {
            const pat = needArg();
            add((n) => globMatch(pat, n.name, true));
            break;
          }
          case '-path': {
            const pat = needArg();
            add((_, d) => globMatch(pat, d));
            break;
          }
          case '-type': {
            const ty = needArg();
            if (ty !== 'f' && ty !== 'd') throw new Error(`-type: ${ty}: unknown type`);
            add((n) => (ty === 'd' ? n.type === 'dir' : n.type === 'file'));
            break;
          }
          case '-maxdepth':
            maxDepth = Number(needArg());
            break;
          case '-mindepth':
            minDepth = Number(needArg());
            break;
          case '-empty':
            add((n) => (n.type === 'dir' ? fs.readdir(n.path).length === 0 : fs.size(n.path) === 0));
            break;
          case '-print':
            break;
          default:
            throw new Error(`${tok}: unknown primary or operator`);
        }
      } catch (e) {
        ctx.error((e as Error).message);
        return 1;
      }
    }
    let status = 0;
    const out: string[] = [];
    /**
     * Visits a node and its descendants, collecting matching paths.
     *
     * A node is output when it is at least -mindepth deep and passes every
     * test. Directories are descended into, children in byte-wise order, while
     * the depth is below -maxdepth. Stops early once the command is aborted.
     *
     * @param {FSNode} n - Node to test.
     * @param {string} display - Path as printed, built from the starting operand.
     * @param {number} depth - Depth below the starting point (0 for the starting point itself).
     * @returns {void}
     *
     * @example
     * visit(node, '.', 0);
     */
    const visit = (n: FSNode, display: string, depth: number) => {
      if (ctx.signal.aborted) return;
      if (depth >= minDepth && tests.every((t) => t(n, display))) out.push(display);
      if (n.type === 'dir' && depth < maxDepth) {
        for (const k of fs.readdir(n.path).sort((a, b) => byteCompare(a.name, b.name))) visit(k, childPath(display, k.name), depth + 1);
      }
    };
    for (const p of paths.length ? paths : ['.']) {
      const node = fs.stat(ctx.resolve(p));
      if (!node) {
        ctx.error(`${p}: No such file or directory`);
        status = 1;
        continue;
      }
      visit(node, p, 0);
    }
    if (out.length) ctx.print(out.join('\n'));
    return status;
  },
}; /** `find` command: walks file hierarchies and prints the paths that match every test. */

/* ───────────────────────── du / df ───────────────────────── */

const du: CommandDef = {
  name: 'du',
  path: '/usr/bin',
  group: 'files',
  summary: { en: 'display disk usage statistics', ko: '디스크 사용량 표시' },
  usage: 'du [-ahsc] [-d depth] [file ...]',
  options: [
    ['-s', { en: 'Only a total for each argument', ko: '각 인자의 합계만 표시' }],
    ['-h', { en: 'Human-readable sizes', ko: '사람이 읽기 쉬운 크기' }],
    ['-a', { en: 'Show files as well as directories', ko: '디렉터리뿐 아니라 파일도 표시' }],
    ['-d depth', { en: 'Limit how deep to report', ko: '표시할 깊이 제한' }],
    ['-c', { en: 'Print a grand total', ko: '전체 합계 출력' }],
  ],
  /**
   * Runs `du`, printing disk usage per directory (and per file with -a).
   *
   * Sizes are rounded up to whole 4 KiB blocks and summed recursively.
   * Output is in 512-byte units by default, in KiB/MiB/GiB with -k/-m/-g or
   * human-readable with -h. -s reports only each operand's total, -d limits
   * the reported depth and -c appends a grand total. A file operand is always
   * reported, even without -a.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 if an operand is missing or an option is invalid.
   *
   * @example
   * // $ du -sh ~/Pictures
   * const status = du.run(ctx); // 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'ahsckmgHLPx', values: 'dB' });
    if (error) return usageError(ctx, error, 'du [-Aclnx] [-H | -L | -P] [-g | -h | -k | -m] [-a | -s | -d depth] [-B blocksize] [-I mask] [-t threshold] [file ...]');
    const unit = opts.k ? 1024 : opts.m ? 1024 ** 2 : opts.g ? 1024 ** 3 : 512;
    /**
     * Formats a byte count in the selected unit.
     *
     * Uses humanBytes with -h, otherwise the number of units (512 bytes by
     * default, KiB/MiB/GiB with -k/-m/-g), rounded up.
     *
     * @param {number} bytes - Disk usage in bytes.
     * @returns {string} The formatted size.
     *
     * @example
     * fmt(4096); // '8' with the default 512-byte unit
     */
    const fmt = (bytes: number) => (opts.h ? humanBytes(bytes) : String(Math.ceil(bytes / unit)));
    const depthLimit = opts.s ? 0 : opts.d !== undefined ? Number(opts.d) : Infinity;
    const out: string[] = [];
    let grand = 0;
    let status = 0;
    /**
     * Computes the disk usage of a node, recording output lines on the way.
     *
     * Files contribute their size rounded up to whole 4 KiB blocks and are
     * listed with -a when within the depth limit. Directories sum their
     * children (visited in byte-wise order) and are listed after their
     * contents when within the depth limit.
     *
     * @param {FSNode} n - File or directory to measure.
     * @param {string} display - Path as printed.
     * @param {number} depth - Depth below the operand (0 for the operand itself).
     * @returns {number} Total bytes used by the node.
     *
     * @example
     * const bytes = usage(node, '.', 0);
     */
    const usage = (n: FSNode, display: string, depth: number): number => {
      if (n.type === 'file') {
        const b = diskUsage(fs.size(n.path));
        if (opts.a && depth <= depthLimit) out.push(`${fmt(b)}\t${display}`);
        return b;
      }
      let total = 0;
      for (const k of fs.readdir(n.path).sort((a, b) => byteCompare(a.name, b.name))) total += usage(k, childPath(display, k.name), depth + 1);
      if (depth <= depthLimit) out.push(`${fmt(total)}\t${display}`);
      return total;
    };
    for (const t of operands.length ? operands : ['.']) {
      const node = fs.stat(ctx.resolve(t));
      if (!node) {
        ctx.error(`${t}: No such file or directory`);
        status = 1;
        continue;
      }
      const b = usage(node, t, 0);
      if (node.type === 'file' && !opts.a) out.push(`${fmt(b)}\t${t}`);
      grand += b;
    }
    if (opts.c) out.push(`${fmt(grand)}\ttotal`);
    if (out.length) ctx.print(out.join('\n'));
    return status;
  },
}; /** `du` command: reports the disk usage of files and directories. */

const df: CommandDef = {
  name: 'df',
  group: 'files',
  summary: { en: 'display free disk space', ko: '디스크 여유 공간 표시' },
  usage: 'df [-h]',
  description: {
    en: 'Shows the storage this browser grants the site (navigator.storage.estimate) as the disk mounted on /.',
    ko: '이 브라우저가 사이트에 허용한 저장 공간(navigator.storage.estimate)을 / 에 마운트된 디스크로 표시합니다.',
  },
  options: [['-h', { en: 'Human-readable sizes (Gi, Mi…)', ko: '사람이 읽기 쉬운 크기 (Gi, Mi…)' }]],
  /**
   * Runs `df`, printing a macOS-style table of mounted file systems.
   *
   * The root disk's size and usage come from `navigator.storage.estimate()`,
   * with used space never below the size of the virtual file system. When no
   * estimate is available a fixed ~494 GB disk is shown with only the virtual
   * file system in use. A static devfs row follows. Sizes are 512-byte blocks,
   * or IEC human-readable with -h/-H; inode counts derive from the number of
   * nodes and the free space.
   *
   * @async
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {Promise<number>} 0 on success, 1 for an invalid option.
   *
   * @example
   * // $ df -h
   * const status = await df.run(ctx); // 0
   */
  async run(ctx) {
    const { opts, error } = getopt(ctx.args, { flags: 'hHkmgaiPl' });
    if (error) return usageError(ctx, error, 'df [-b | -g | -H | -h | -k | -m | -P] [-acIiln] [-T type] [-t type] [file | filesystem ...]');
    const vfsBytes = fs.size('/');
    let size = 494_384_795_648;
    let used = vfsBytes;
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) {
        size = est.quota;
        used = Math.max(est.usage ?? 0, vfsBytes);
      }
    } catch {
      /* Storage estimates are unavailable (e.g. insecure context): keep the defaults. */
    }
    const inodes = fs.walk('/').length + 1;
    const rows = [
      ['/dev/disk3s1s1', size, used, inodes, '/'],
      ['devfs', 204_800, 204_800, 704, '/dev'],
    ] as const;
    const human = opts.h || opts.H;
    /**
     * Formats a byte count for a df column.
     *
     * IEC human-readable sizes (Gi, Mi…) with -h/-H, otherwise 512-byte blocks
     * rounded up.
     *
     * @param {number} b - Size in bytes.
     * @returns {string} The formatted size.
     *
     * @example
     * num(1048576); // '2048' without -h
     */
    const num = (b: number) => (human ? humanBytes(b, { iec: true }) : String(Math.ceil(b / 512)));
    const header = ['Filesystem', human ? 'Size' : '512-blocks', 'Used', 'Avail', 'Capacity', 'iused', 'ifree', '%iused', 'Mounted on'];
    const body = rows.map(([fsName, total, u, iused, mount]) => {
      const avail = Math.max(0, total - u);
      const ifree = Math.max(0, Math.floor(avail / 4096));
      return [fsName, num(total), num(u), num(avail), `${Math.ceil((u / total) * 100)}%`, String(iused), String(ifree), `${Math.ceil((iused / Math.max(1, iused + ifree)) * 100)}%`, mount];
    });
    const all = [header, ...body];
    const widths = header.map((_, i) => Math.max(...all.map((r) => r[i].length)));
    ctx.print(all.map((r) => r.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : i === r.length - 1 ? `  ${cell}` : cell.padStart(widths[i]))).join(' ')).join('\n'));
    return 0;
  },
}; /** `df` command: shows the browser's storage quota as the disk mounted on `/`. */

/* ───────────────────────── file / stat / names ───────────────────────── */

/**
 * Describes a node's type in the style of the `file` utility.
 *
 * Directories and `.app` bundles are named directly. Binary nodes (with
 * `src`) are identified by image extension or by kind (PDF, audio, video) and
 * otherwise reported as `data`. Text is reported as `empty`, as an executable
 * script naming the interpreter of a `#!` line, or as JSON, HTML, XML or URL
 * text by extension, noting whether it is plain ASCII or UTF-8.
 *
 * @param {FSNode} n - Node to describe.
 * @returns {string} A description such as `ASCII text` or `PNG image data`.
 *
 * @example
 * describeFile(fs.stat('/tmp/run.sh')!); // '/bin/sh script text executable, ASCII text'
 */
function describeFile(n: FSNode): string {
  if (n.type === 'dir') return 'directory';
  const name = n.name.toLowerCase();
  if (name.endsWith('.app')) return 'application bundle';
  const kind = kindOf(n);
  if (n.src) {
    const ext = name.split('.').pop();
    const images: Record<string, string> = { png: 'PNG image data', jpg: 'JPEG image data', jpeg: 'JPEG image data', gif: 'GIF image data', webp: 'RIFF (little-endian) data, Web/P image', svg: 'SVG Scalable Vector Graphics image', avif: 'ISO Media, AVIF Image' };
    if (ext && images[ext]) return images[ext];
    if (kind === 'pdf') return 'PDF document';
    if (kind === 'audio') return 'Audio file';
    if (kind === 'video') return 'ISO Media';
    return 'data';
  }
  const content = n.content ?? '';
  if (!content) return 'empty';
  const unicode = /[^\x00-\x7f]/.test(content) ? 'Unicode text, UTF-8 text' : 'ASCII text';
  if (content.startsWith('#!')) return `${content.slice(2).split('\n')[0].trim()} script text executable, ${unicode}`;
  if (name.endsWith('.json')) return 'JSON data';
  if (name.endsWith('.html') || name.endsWith('.htm')) return `HTML document text, ${unicode}`;
  if (name.endsWith('.plist') || name.endsWith('.xml')) return `XML 1.0 document text, ${unicode}`;
  if (name.endsWith('.webloc')) return `URL, ${unicode}`;
  return unicode;
}

const file: CommandDef = {
  name: 'file',
  path: '/usr/bin',
  group: 'files',
  summary: { en: 'determine file type', ko: '파일 형식 판별' },
  usage: 'file file ...',
  /**
   * Runs `file`, printing `name: description` for each operand.
   *
   * Missing operands print a `cannot open` line but, as in BSD `file`, do not
   * change the exit status.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0, or 1 when no operand is given.
   *
   * @example
   * // $ file README.md
   * const status = file.run(ctx); // 0
   */
  run(ctx) {
    if (!ctx.args.length) return usageError(ctx, 'missing operand', 'file [-bcdDhiklLNnprsvz0] [--extension] [--mime-encoding] [--mime-type] [-e testname] [-F separator] [-f namefile] [-m magicfiles] [-P name=value] file ...');
    for (const a of ctx.args) {
      const n = fs.stat(ctx.resolve(a));
      ctx.print(`${a}: ${n ? describeFile(n) : `cannot open \`${a}' (No such file or directory)`}`);
    }
    return 0;
  },
}; /** `file` command: prints a type description for each operand. */

const stat: CommandDef = {
  name: 'stat',
  path: '/usr/bin',
  group: 'files',
  summary: { en: 'display file status', ko: '파일 상태 표시' },
  usage: 'stat file ...',
  /**
   * Runs `stat`, printing a status block for each operand.
   *
   * Shows the size, file type, mode (octal and symbolic), owner and group ids
   * and names, a synthetic inode, the link count and the timestamps. Access,
   * modify and change times all use the node's modification time; birth is its
   * creation time. Option flags are accepted but the layout is always the
   * verbose one.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 on success, 1 if an operand is missing, no operand is given or an
   *   option is invalid.
   *
   * @example
   * // $ stat notes.txt
   * const status = stat.run(ctx); // 0
   */
  run(ctx) {
    const { operands, error } = getopt(ctx.args, { flags: 'xLnqrs', values: 'ft' });
    if (error || !operands.length) return usageError(ctx, error ?? 'missing operand', 'stat [-FLnq] [-f format | -l | -r | -s | -x] [-t timefmt] [file|handle ...]');
    let status = 0;
    const blocks: string[] = [];
    for (const a of operands) {
      const n = fs.stat(ctx.resolve(a));
      if (!n) {
        ctx.error(`${a}: stat: No such file or directory`);
        status = 1;
        continue;
      }
      const own = ownerOf(n);
      const mode = modeString(n);
      const size = lsSize(n);
      blocks.push(
        [
          `  File: "${a}"`,
          `  Size: ${padEnd(String(size), 12)} FileType: ${n.type === 'dir' ? 'Directory' : 'Regular File'}`,
          `  Mode: (${modeOctal(mode)}/${mode})         Uid: (${padStart(own.uid, 5)}/${padStart(own.user, 8)})  Gid: (${padStart(own.gid, 5)}/${padStart(own.group, 8)})`,
          `Device: 1,15   Inode: ${inodeOf(n.path)}    Links: ${n.type === 'dir' ? 2 + fs.readdir(n.path).filter((k) => k.type === 'dir').length : 1}`,
          `Access: ${ctime(n.modifiedAt)}`,
          `Modify: ${ctime(n.modifiedAt)}`,
          `Change: ${ctime(n.modifiedAt)}`,
          ` Birth: ${ctime(n.createdAt)}`,
        ].join('\n'),
      );
    }
    if (blocks.length) ctx.print(blocks.join('\n'));
    return status;
  },
}; /** `stat` command: prints file status in the verbose (`stat -x`) layout. */

const basenameCmd: CommandDef = {
  name: 'basename',
  path: '/usr/bin',
  group: 'files',
  summary: { en: 'return the file name portion of a path', ko: '경로에서 파일 이름 부분 반환' },
  usage: 'basename string [suffix]',
  /**
   * Runs `basename`, printing the file name portion of a path.
   *
   * An empty string prints an empty line. The suffix is removed only when the
   * name ends with it and is not the whole name.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0, or 1 when no operand is given.
   *
   * @example
   * // $ basename /tmp/report.txt .txt
   * const status = basenameCmd.run(ctx); // prints 'report'
   */
  run(ctx) {
    const [p, suffix] = ctx.args;
    if (p === undefined) return usageError(ctx, 'missing operand', 'basename string [suffix]\n       basename [-a] [-s suffix] string [...]');
    let b = p === '' ? '' : basename(p);
    if (suffix && b.endsWith(suffix) && b !== suffix) b = b.slice(0, -suffix.length);
    ctx.print(b);
    return 0;
  },
}; /** `basename` command: prints the last component of a path, optionally without a suffix. */

const dirnameCmd: CommandDef = {
  name: 'dirname',
  path: '/usr/bin',
  group: 'files',
  summary: { en: 'return the directory portion of a path', ko: '경로에서 디렉터리 부분 반환' },
  usage: 'dirname string [...]',
  /**
   * Runs `dirname`, printing the parent directory of each operand.
   *
   * Trailing slashes are ignored and paths without a slash print `.`.
   * Absolute paths go through the kernel's dirname; relative paths keep their
   * spelling up to the last slash.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0, or 1 when no operand is given.
   *
   * @example
   * // $ dirname docs/notes/today.md
   * const status = dirnameCmd.run(ctx); // prints 'docs/notes'
   */
  run(ctx) {
    if (!ctx.args.length) return usageError(ctx, 'missing operand', 'dirname string [...]');
    for (const p of ctx.args) {
      const t = trimSlash(p);
      ctx.print(t.includes('/') ? (t.startsWith('/') ? dirname(t) : t.slice(0, t.lastIndexOf('/')) || '/') : '.');
    }
    return 0;
  },
}; /** `dirname` command: prints the directory portion of each path. */

const realpath: CommandDef = {
  name: 'realpath',
  path: '/bin',
  group: 'files',
  summary: { en: 'return the resolved absolute path', ko: '절대 경로 반환' },
  usage: 'realpath [path ...]',
  /**
   * Runs `realpath`, printing each operand resolved against the working directory.
   *
   * Operands default to `.` and `~` is expanded. Paths that do not exist are
   * reported and set exit status 1.
   *
   * @param {CommandContext} ctx - Command context with arguments and output streams.
   * @returns {number} 0 when every path exists, otherwise 1.
   *
   * @example
   * // $ realpath ../Desktop
   * const status = realpath.run(ctx); // 0
   */
  run(ctx) {
    let status = 0;
    for (const p of ctx.args.length ? ctx.args : ['.']) {
      const abs = ctx.resolve(p);
      if (!fs.exists(abs)) {
        ctx.error(`${p}: No such file or directory`);
        status = 1;
      } else ctx.print(abs);
    }
    return status;
  },
}; /** `realpath` command: prints the absolute path of each operand. */

export const FILE_COMMANDS: CommandDef[] = [ls, cd, pwd, cat, mkdir, rmdir, touch, rm, mv, cp, chmod, tree, find, du, df, file, stat, basenameCmd, dirnameCmd, realpath]; /** File system commands contributed to the command registry. */

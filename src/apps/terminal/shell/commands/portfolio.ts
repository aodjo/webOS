/** Portfolio commands that render the data in src/data/portfolio.ts: about, projects, skills, experience, contact, resume. */
import { PATHS, buildResume, fs, join, localizePeriod, t, useSystem, wm } from '@/kernel';
import { education, experience, owner, projects, skills } from '@/data/portfolio';
import { c, displayWidth } from '../ansi';
import type { CommandContext, CommandDef } from '../types';
import { padEnd } from '../util';

/**
 * Word-wraps plain text to fit the terminal width.
 *
 * Splits the text into paragraphs on newlines and greedily packs
 * space-separated words into lines no wider than `width` minus the indent
 * (never narrower than 20 columns). Widths are measured with `displayWidth`,
 * so wide CJK characters count as two cells. Every output line, including
 * empty paragraphs, starts with `indent`; a single word longer than the
 * limit is kept whole on its own line.
 *
 * @param {string} text - Plain text to wrap; newlines start new paragraphs.
 * @param {number} width - Available width in terminal columns, including the indent.
 * @param {string} [indent=''] - Prefix added to every output line.
 * @returns {string[]} The wrapped lines, each starting with `indent`.
 *
 * @example
 * wrap('The quick brown fox jumps over the lazy dog', 24, '  ');
 * // ['  The quick brown fox', '  jumps over the lazy', '  dog']
 */
function wrap(text: string, width: number, indent = ''): string[] {
  const max = Math.max(20, width - displayWidth(indent));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (line && displayWidth(line) + 1 + displayWidth(word) > max) {
        out.push(indent + line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(indent + line);
  }
  return out;
}

/**
 * Strips the light markdown used in portfolio texts.
 *
 * Removes `**bold**` markers and inline-code backticks, and replaces
 * `[label](url)` links with their label so the text reads cleanly in a
 * terminal. Other markdown syntax is left untouched.
 *
 * @param {string} md - Markdown-formatted text.
 * @returns {string} The text with bold, code and link markup removed.
 *
 * @example
 * plain('Built **fast** apps with `React`, see [demo](https://x.dev)');
 * // 'Built fast apps with React, see demo'
 */
const plain = (md: string) => md.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/**
 * Creates the color helpers used by the portfolio commands.
 *
 * Reads the system accent color from settings (a `#rrggbb` hex string,
 * falling back to `#0a84ff` when it cannot be parsed) and returns functions
 * that wrap text in ANSI true-color, bold or dim sequences. When stdout is
 * not a TTY (a pipe or redirect) the helpers return the text unchanged.
 * `cols` is the terminal width capped at 100 columns so long paragraphs stay
 * readable on wide windows.
 *
 * @param {CommandContext} ctx - The running command's context.
 * @returns {{ tty: boolean; accent: (s: string) => string; head: (s: string) => string; bold: (s: string) => string; dim: (s: string) => string; cols: number }}
 *   Whether stdout is a TTY, the formatting helpers, and the layout width in columns.
 *
 * @example
 * const s = styler(ctx);
 * ctx.print(`${s.head('Projects')} ${s.dim('(3)')}`);
 */
function styler(ctx: CommandContext) {
  const tty = ctx.stdout.isTTY;
  const accent = useSystem.getState().settings.accent;
  const m = /^#?([0-9a-f]{6})$/i.exec(accent);
  const n = m ? parseInt(m[1], 16) : 0x0a84ff;
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  return {
    tty,
    /**
     * Colors text with the system accent color.
     *
     * Wraps the text in a 24-bit ANSI foreground sequence built from the
     * accent RGB value; returns it unchanged when stdout is not a TTY.
     *
     * @param {string} s - Text to color.
     * @returns {string} The colored (or unchanged) text.
     *
     * @example
     * out.push(s.accent('★'));
     */
    accent: (s: string) => (tty ? c.rgb(...rgb)(s) : s),
    /**
     * Styles text as a section heading.
     *
     * Applies bold plus the accent color on a TTY; returns the text
     * unchanged otherwise.
     *
     * @param {string} s - Heading text.
     * @returns {string} The styled (or unchanged) text.
     *
     * @example
     * out.push(`  ${s.head('Experience')}`);
     */
    head: (s: string) => (tty ? c.bold(c.rgb(...rgb)(s)) : s),
    /**
     * Makes text bold.
     *
     * Wraps the text in ANSI bold on a TTY; returns it unchanged otherwise.
     *
     * @param {string} s - Text to emphasize.
     * @returns {string} The bold (or unchanged) text.
     *
     * @example
     * out.push(s.bold('Frontend Engineer'));
     */
    bold: (s: string) => (tty ? c.bold(s) : s),
    /**
     * Dims secondary text.
     *
     * Wraps the text in ANSI faint on a TTY; returns it unchanged otherwise.
     *
     * @param {string} s - Text to de-emphasize.
     * @returns {string} The dimmed (or unchanged) text.
     *
     * @example
     * out.push(s.dim('(2024)'));
     */
    dim: (s: string) => (tty ? c.dim(s) : s),
    cols: Math.min(ctx.term.size().cols, 100),
  };
}

const HINT = { en: 'Try: about · projects · skills · experience · contact · resume', ko: '이것도 해보세요: about · projects · skills · experience · contact · resume' }; /** Footer hint listing the portfolio commands, printed at the end of `about`. */

const about: CommandDef = {
  name: 'about',
  path: '/usr/local/bin',
  group: 'portfolio',
  summary: { en: 'who I am', ko: '저에 대해' },
  usage: 'about [-o]',
  options: [['-o', { en: 'Open the About Me app', ko: '내 소개 앱 열기' }]],
  /**
   * Prints the owner's profile card.
   *
   * With `-o`, launches the About Me app and prints nothing. Otherwise prints
   * the owner's name, role, location and tagline from the portfolio data,
   * followed by the bio (markdown stripped and word-wrapped to the terminal
   * width) and a hint listing the other portfolio commands.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * about.run(ctx); // prints the profile card
   * about.run({ ...ctx, args: ['-o'] }); // opens the About Me app
   */
  run(ctx) {
    if (ctx.args.includes('-o')) {
      wm.launch('about-me');
      return 0;
    }
    const s = styler(ctx);
    const out = [
      '',
      `  ${s.head(t(owner.name))} ${s.dim('—')} ${s.bold(t(owner.role))}`,
      `  ${s.dim(t(owner.location))}`,
      '',
      `  ${s.accent(t(owner.tagline))}`,
      '',
      ...wrap(plain(t(owner.bio)), s.cols - 2, '  '),
      '',
      `  ${s.dim(t(HINT))}`,
      '',
    ];
    ctx.print(out.join('\n'));
    return 0;
  },
}; /** `about`: prints the owner's profile card, or opens the About Me app with `-o`. */

const projectsCmd: CommandDef = {
  name: 'projects',
  path: '/usr/local/bin',
  group: 'portfolio',
  summary: { en: 'things I built (projects <name> for details)', ko: '작업물 (자세히 보려면 projects <이름>)' },
  usage: 'projects [-o] [name]',
  options: [['-o', { en: 'Open in the Projects app', ko: '프로젝트 앱에서 열기' }]],
  /**
   * Lists project ids for tab completion.
   *
   * Offers every project id from the portfolio data, whatever argument
   * position is being completed.
   *
   * @returns {string[]} The ids of all projects.
   *
   * @example
   * projectsCmd.complete?.(0, []); // e.g. ['webos', 'blog']
   */
  complete: () => projects.map((p) => p.id),
  /**
   * Lists the portfolio projects or shows one in detail.
   *
   * The first non-flag argument selects a project by id or name
   * (case-insensitive); an unknown name prints an error with the available
   * ids. With a project selected, prints its name, year, featured star,
   * tagline, wrapped description, role, stack, highlights and links.
   * Without one, prints a two-line summary per project. `-o` opens the
   * Projects app, which selects the project passed in its window args; with
   * `-o` and no name nothing is printed.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} 0 on success, 1 when the named project does not exist.
   *
   * @example
   * projectsCmd.run({ ...ctx, args: ['webos'] }); // prints the project details
   */
  run(ctx) {
    const s = styler(ctx);
    const openApp = ctx.args.includes('-o');
    const query = ctx.args.find((a) => !a.startsWith('-'));
    const p = query ? projects.find((x) => x.id === query.toLowerCase() || x.name.toLowerCase() === query.toLowerCase()) : undefined;
    if (query && !p) {
      ctx.error(t({ en: `no such project: ${query}`, ko: `해당 프로젝트가 없습니다: ${query}` }));
      ctx.stderr.write(`${t({ en: 'Available:', ko: '사용 가능:' })} ${projects.map((x) => x.id).join(', ')}\n`);
      return 1;
    }
    if (openApp) {
      wm.openWindow('projects', p ? { project: p.id } : {});
      if (!p) return 0;
    }
    if (p) {
      const out = [
        '',
        `  ${s.head(p.name)} ${s.dim(`(${p.year})`)}${p.featured ? ' ' + s.accent('★') : ''}`,
        `  ${s.bold(t(p.tagline))}`,
        '',
        ...wrap(plain(t(p.description)), s.cols - 2, '  '),
        '',
        `  ${s.dim(t({ en: 'Role', ko: '역할' }))}   ${t(p.role)}`,
        `  ${s.dim(t({ en: 'Stack', ko: '기술' }))}  ${p.tags.map((tag) => s.accent(tag)).join(s.dim(' · '))}`,
      ];
      if (p.highlights.length) out.push('', ...p.highlights.flatMap((h) => wrap(t(h), s.cols - 6, '    ').map((l, i) => (i === 0 ? `  ${s.accent('•')} ${l.trimStart()}` : l))));
      const links = Object.entries(p.links).filter(([, v]) => v);
      if (links.length) out.push('', ...links.map(([k, v]) => `  ${s.dim(padEnd(k === 'github' ? 'GitHub' : 'Demo', 7))}${s.tty ? c.underline(v!) : v}`));
      if (!openApp) out.push('', `  ${s.dim(t({ en: `Open it in the Projects app: projects -o ${p.id}`, ko: `프로젝트 앱에서 열기: projects -o ${p.id}` }))}`);
      out.push('');
      ctx.print(out.join('\n'));
      return 0;
    }
    const nameW = Math.max(...projects.map((x) => x.id.length)) + 2;
    const out = ['', `  ${s.head(t({ en: 'Projects', ko: '프로젝트' }))} ${s.dim(`(${projects.length})`)}`, ''];
    for (const x of projects) {
      out.push(`  ${x.featured ? s.accent('★') : ' '} ${s.bold(padEnd(x.id, nameW))}${s.dim(String(x.year))}  ${t(x.tagline)}`);
      out.push(`    ${' '.repeat(nameW)}      ${s.dim(x.tags.join(' · '))}`);
    }
    out.push('', `  ${s.dim(t({ en: 'Details: projects <name>   ·   Open the app: projects -o', ko: '자세히: projects <이름>   ·   앱 열기: projects -o' }))}`, '');
    ctx.print(out.join('\n'));
    return 0;
  },
}; /** `projects`: lists the portfolio projects, shows one in detail, or opens the Projects app with `-o`. */

const skillsCmd: CommandDef = {
  name: 'skills',
  path: '/usr/local/bin',
  group: 'portfolio',
  summary: { en: 'what I work with', ko: '다루는 기술' },
  usage: 'skills',
  /**
   * Prints the skill groups with level bars.
   *
   * For each skill category, prints a heading and one row per skill: the
   * name padded to the widest skill name, a 20-cell bar (4 filled cells per
   * level out of 5) in the accent color, and the numeric level.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * skillsCmd.run(ctx); // "    TypeScript  ████████████████░░░░ 4/5"
   */
  run(ctx) {
    const s = styler(ctx);
    const nameW = Math.max(...skills.flatMap((g) => g.items.map((i) => displayWidth(i.name)))) + 2;
    const out = [''];
    for (const g of skills) {
      out.push(`  ${s.head(t(g.category))}`);
      for (const item of g.items) {
        const filled = '█'.repeat(item.level * 4);
        const empty = '░'.repeat((5 - item.level) * 4);
        out.push(`    ${padEnd(item.name, nameW)}${s.accent(filled)}${s.dim(empty)} ${s.dim(`${item.level}/5`)}`);
      }
      out.push('');
    }
    ctx.print(out.join('\n'));
    return 0;
  },
}; /** `skills`: prints every skill category with a level bar per skill. */

const experienceCmd: CommandDef = {
  name: 'experience',
  aliases: ['work'],
  path: '/usr/local/bin',
  group: 'portfolio',
  summary: { en: 'where I have worked', ko: '경력' },
  usage: 'experience',
  /**
   * Prints the work history as a timeline, followed by education.
   *
   * Each position shows the role, company and localized period on a bullet,
   * then its wrapped description and highlights hanging off a vertical bar
   * that connects consecutive entries. Education entries, when present, are
   * listed under their own heading.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   *
   * @example
   * experienceCmd.run(ctx); // prints the experience timeline
   */
  run(ctx) {
    const s = styler(ctx);
    const locale = useSystem.getState().settings.locale;
    /**
     * Formats a period string for the current locale.
     *
     * Delegates to `localizePeriod`, which translates a trailing "Present"
     * using the locale read when the command started.
     *
     * @param {string} p - Period as written in the portfolio data.
     * @returns {string} The localized period.
     *
     * @example
     * period('2024 — Present'); // '2024 — 현재' in the Korean locale
     */
    const period = (p: string) => localizePeriod(p, locale);
    const out = ['', `  ${s.head(t({ en: 'Experience', ko: '경력' }))}`, ''];
    experience.forEach((e, i) => {
      const last = i === experience.length - 1;
      const bar = s.dim(last ? ' ' : '│');
      out.push(`  ${s.accent('●')} ${s.bold(t(e.role))} ${s.dim('—')} ${t(e.company)}  ${s.dim(period(e.period))}`);
      out.push(...wrap(t(e.description), s.cols - 6).map((l) => `  ${bar}   ${l}`));
      for (const h of e.highlights) out.push(...wrap(t(h), s.cols - 8).map((l, k) => `  ${bar}   ${k === 0 ? s.accent('▸') + ' ' : '  '}${l}`));
      if (!last) out.push(`  ${bar}`);
    });
    if (education.length) {
      out.push('', `  ${s.head(t({ en: 'Education', ko: '학력' }))}`, '');
      for (const e of education) out.push(`  ${s.accent('●')} ${s.bold(t(e.school))} ${s.dim('—')} ${t(e.degree)}  ${s.dim(period(e.period))}`);
    }
    out.push('');
    ctx.print(out.join('\n'));
    return 0;
  },
}; /** `experience` (alias `work`): prints the work-history timeline and education. */

const contact: CommandDef = {
  name: 'contact',
  path: '/usr/local/bin',
  group: 'portfolio',
  summary: { en: 'how to reach me', ko: '연락처' },
  usage: 'contact',
  /**
   * Prints the owner's contact details and offers to open Mail.
   *
   * Prints the email address and each configured link (GitHub, LinkedIn,
   * blog, website) in an aligned two-column list. When run interactively
   * (no piped stdin and stdout is a TTY), asks whether to open Mail; a yes
   * answer (y, yes, or a Korean equivalent) opens a Mail compose window
   * addressed to the owner.
   *
   * @async
   * @param {CommandContext} ctx - The running command's context.
   * @returns {Promise<number>} 0 normally, or 130 when the prompt is interrupted with ^C.
   *
   * @example
   * await contact.run(ctx); // prints the details, then asks "Open Mail …? [y/N]"
   */
  async run(ctx) {
    const s = styler(ctx);
    const rows: [string, string][] = [[t({ en: 'Email', ko: '이메일' }), owner.email]];
    if (owner.links.github) rows.push(['GitHub', owner.links.github]);
    if (owner.links.linkedin) rows.push(['LinkedIn', owner.links.linkedin]);
    if (owner.links.blog) rows.push([t({ en: 'Blog', ko: '블로그' }), owner.links.blog]);
    if (owner.links.website) rows.push([t({ en: 'Website', ko: '웹사이트' }), owner.links.website]);
    const w = Math.max(...rows.map(([k]) => displayWidth(k))) + 3;
    ctx.print(['', `  ${s.head(t({ en: 'Get in touch', ko: '연락하기' }))}`, '', ...rows.map(([k, v]) => `  ${s.dim(padEnd(k, w))}${s.tty ? c.underline(v) : v}`), ''].join('\n'));
    if (ctx.stdin !== null || !ctx.stdout.isTTY) return 0;
    const answer = await ctx.term.readLine(t({ en: 'Open Mail to write me a message? [y/N] ', ko: '메일 앱을 열어 메시지를 보낼까요? [y/N] ' }), { signal: ctx.signal });
    if (answer === null) return ctx.signal.aborted ? 130 : 0;
    if (/^(y|yes|ㅛ|예|네|응)$/i.test(answer.trim())) {
      wm.openWindow('mail', { compose: true, to: owner.email });
      ctx.print(s.dim(t({ en: 'Opening Mail…', ko: '메일 앱을 여는 중…' })));
    }
    return 0;
  },
}; /** `contact`: prints the owner's email and links and offers to compose a message in Mail. */

const resume: CommandDef = {
  name: 'resume',
  aliases: ['cv'],
  path: '/usr/local/bin',
  group: 'portfolio',
  summary: { en: 'open my résumé in Preview', ko: '이력서를 미리보기에서 열기' },
  usage: 'resume [-p]',
  options: [['-p', { en: 'Print it here instead of opening Preview', ko: '미리보기 대신 여기에 출력' }]],
  /**
   * Opens the résumé in Preview, or prints it with `-p`.
   *
   * Looks for Resume.md or 이력서.md in ~/Documents, then on the Desktop.
   * With `-p`, prints the file found, or a résumé generated from the
   * portfolio data when none exists. Otherwise opens the file in Preview; if
   * no copy exists (for example because it was deleted), a fresh one is
   * generated into /tmp, named for the current locale, and opened instead.
   *
   * @param {CommandContext} ctx - The running command's context.
   * @returns {number} Exit status 0.
   * @throws {FSError} When reading the found file or writing the /tmp copy fails.
   *
   * @example
   * resume.run({ ...ctx, args: ['-p'] }); // prints the résumé markdown
   */
  run(ctx) {
    const locale = useSystem.getState().settings.locale;
    const candidates = [join(PATHS.documents, 'Resume.md'), join(PATHS.documents, '이력서.md'), join(PATHS.desktop, 'Resume.md'), join(PATHS.desktop, '이력서.md')];
    let path = candidates.find((p) => fs.stat(p)?.type === 'file');
    if (ctx.args.includes('-p')) {
      ctx.print(path ? fs.readFile(path) : buildResume(locale));
      return 0;
    }
    if (!path) {
      path = `/tmp/${locale === 'ko' ? '이력서' : 'Resume'}.md`;
      fs.writeFile(path, buildResume(locale));
    }
    wm.openPath(path, 'preview');
    ctx.print(styler(ctx).dim(t({ en: `Opening ${path.split('/').pop()} in Preview…`, ko: `미리보기에서 ${path.split('/').pop()} 여는 중…` })));
    return 0;
  },
}; /** `resume` (alias `cv`): opens the résumé in Preview, regenerating it when missing, or prints it with `-p`. */

export const PORTFOLIO_COMMANDS: CommandDef[] = [about, projectsCmd, skillsCmd, experienceCmd, contact, resume]; /** The portfolio command definitions, merged into the shell's command registry. */

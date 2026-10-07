/** Terminal commands that talk to the rest of the OS: open, edit, theme, lang, wallpaper, accent, say. */
import { ACCENT_COLORS, WALLPAPERS, dirname, fs, kindOf, revealInFinder, t, tr, useSystem, wm, type ThemeSetting } from '@/kernel';
import { c } from '../ansi';
import type { CommandContext, CommandDef } from '../types';
import { getopt, padEnd, usageError, writeDenied } from '../util';
import { matchApp } from './system';

/* ───────────────────────── open ───────────────────────── */

const URL_RE = /^(https?|mailto|ftp):/i; /** Matches operands that `open` treats as URLs (http, https, mailto and ftp schemes). */

/**
 * Opens a URL in the matching built-in app.
 *
 * `mailto:` URLs open a Mail compose window addressed to the recipient (the part before any
 * `?` query string); every other URL opens in a Safari window.
 *
 * @param {string} url - The URL to open.
 * @returns {void} Nothing; the window is opened through the window manager.
 *
 * @example
 * openURL('mailto:hello@example.com?subject=Hi'); // Mail compose window to hello@example.com
 * openURL('https://example.com'); // Safari window
 */
function openURL(url: string): void {
  if (/^mailto:/i.test(url)) wm.openWindow('mail', { compose: true, to: url.slice(7).split('?')[0] });
  else wm.openWindow('safari', { url });
}

const open: CommandDef = {
  name: 'open',
  path: '/usr/bin',
  group: 'apps',
  summary: { en: 'open files, folders, apps and URLs', ko: '파일, 폴더, 앱, URL 열기' },
  usage: 'open [-a application] [-eRt] [file | folder | URL ...]',
  description: {
    en: 'Opens each item as if you had double-clicked it in Finder. "open ." shows the current folder in Finder.',
    ko: 'Finder에서 이중 클릭한 것처럼 각 항목을 엽니다. "open ."은 현재 폴더를 Finder에서 보여줍니다.',
  },
  options: [
    ['-a app', { en: 'Open with (or just launch) the named application, e.g. open -a Safari', ko: '지정한 앱으로 열거나 앱을 실행 (예: open -a Safari)' }],
    ['-e', { en: 'Open with TextEdit', ko: 'TextEdit로 열기' }],
    ['-t', { en: 'Open with the default text editor', ko: '기본 텍스트 편집기로 열기' }],
    ['-R', { en: 'Reveal in Finder instead of opening', ko: '열지 않고 Finder에서 보기' }],
  ],
  /**
   * Completes the word after `-a` with application names.
   *
   * Only the argument directly following a `-a` flag is completed from appNames(); every other
   * position returns null so the shell falls back to path completion.
   *
   * @param {number} _i - Index of the argument being completed (unused).
   * @param {string[]} args - Arguments typed so far, ending with the partial word being completed.
   * @returns {string[] | null} Application name candidates, or null to complete file paths.
   *
   * @example
   * open.complete?.(1, ['-a', 'Saf']); // ['Finder', 'Safari', …]
   * open.complete?.(0, ['not']); // null → path completion
   */
  complete: (_i, args) => (args[args.length - 2] === '-a' ? appNames() : null),
  /**
   * Opens files, folders, applications and URLs as if they were double-clicked in Finder.
   *
   * Flags are parsed like macOS `open`; flags without an effect here (-n, -W, -g, -b, …) are
   * accepted and ignored. `-a` selects an app by name, `-e`/`-t` select TextEdit and `-u`
   * appends a URL operand. With no operands the selected app is just launched. URLs open in
   * Safari or Mail (or only launch the `-a` app), folders open in Finder, `-R` reveals items in
   * Finder, and other files open in the given or default app. A missing file, or a file no app
   * can open, is reported on stderr and sets the status to 1 while the remaining operands are
   * still processed.
   *
   * @param {CommandContext} ctx - Command context with the arguments, path resolver and output streams.
   * @returns {number} 0 on success; 1 on a usage error, an unknown app, or any operand that failed.
   *
   * @example
   * // $ open -a Safari https://example.com
   * open.run(ctx); // opens the URL in Safari and returns 0
   */
  run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: 'eRtnWFgjh', values: 'abu' });
    const usage = 'Usage: open [-e] [-t] [-f] [-W] [-R] [-n] [-g] [-h] [-s <partial SDK name>][-b <bundle identifier>] [-a <application>] [-u URL] [filenames] [--args arguments]';
    if (error) {
      ctx.stderr.write(`open: ${error}\n${usage}\n`);
      return 1;
    }
    let appId: string | null = null;
    if (typeof opts.a === 'string') {
      appId = matchApp(opts.a);
      if (!appId) {
        ctx.stderr.write(`Unable to find application named '${opts.a}'\n`);
        return 1;
      }
    } else if (opts.e || opts.t) appId = 'textedit';
    if (typeof opts.u === 'string') operands.push(opts.u);
    if (!operands.length) {
      if (appId) {
        wm.launch(appId);
        return 0;
      }
      ctx.stderr.write(`${usage}\nHelp: Open opens files from a shell.\n`);
      return 1;
    }
    let status = 0;
    for (const target of operands) {
      if (URL_RE.test(target)) {
        if (appId && appId !== 'safari') wm.launch(appId);
        else openURL(target);
        continue;
      }
      const path = ctx.resolve(target);
      const node = fs.stat(path);
      if (!node) {
        ctx.stderr.write(`The file ${path} does not exist.\n`);
        status = 1;
        continue;
      }
      if (opts.R) revealInFinder(path);
      else if (appId) wm.openPath(path, appId);
      else if (node.type === 'dir') wm.openWindow('finder', { path });
      else if (!wm.openPath(path) && kindOf(node) !== 'app') {
        ctx.stderr.write(`No application knows how to open ${path}.\n`);
        status = 1;
      }
    }
    return status;
  },
}; /** The `open` command: opens files, folders, apps and URLs from the shell. */

/**
 * Lists the application names offered when completing `open -a`.
 *
 * Starts from a fixed list of well-known app names and keeps only those that matchApp resolves
 * to an installed app. Multi-word names are returned with backslash-escaped spaces so the
 * completed word stays a single shell argument; the escapes are removed before matching.
 *
 * @returns {string[]} Completion candidates such as "Safari" or "System\\ Settings".
 *
 * @example
 * appNames(); // ['Finder', 'Safari', …, 'About\\ Me', 'System\\ Settings', 'Activity\\ Monitor']
 */
function appNames(): string[] {
  return ['Finder', 'Safari', 'Mail', 'Notes', 'Terminal', 'TextEdit', 'Preview', 'Calculator', 'Projects'].filter((n) => matchApp(n)).concat(
    ['About\\ Me', 'System\\ Settings', 'Activity\\ Monitor'].filter((n) => matchApp(n.replace(/\\ /g, ' '))),
  );
}

/* ───────────────────────── Editors ───────────────────────── */

const editor: CommandDef = {
  name: 'edit',
  aliases: ['vim', 'vi', 'nano', 'emacs', 'code', 'subl'],
  path: '/usr/bin',
  group: 'apps',
  summary: { en: 'edit a file in TextEdit (vim, nano, code…)', ko: 'TextEdit에서 파일 편집 (vim, nano, code…)' },
  usage: 'edit [file ...]',
  description: {
    en: 'Opens the file in TextEdit, creating it first if it does not exist. vim, vi, nano, emacs and code are aliases — there is no modal editing here, promise.',
    ko: '파일을 TextEdit에서 엽니다. 파일이 없으면 먼저 만듭니다. vim, vi, nano, emacs, code도 같은 명령입니다 — 모드 편집은 없으니 안심하세요.',
  },
  /**
   * Opens each file argument in TextEdit, creating missing files first.
   *
   * Arguments starting with "-" or "+" (editor flags such as `+42`) are ignored, and with no
   * files an empty TextEdit window opens. A folder is an error, except for `code` and `subl`,
   * which show it in Finder. A missing file is created empty when its parent folder exists and
   * is writable; otherwise the permission or "No such file or directory" error is printed and
   * the status becomes 1. When invoked as vim, vi, nano or emacs on a TTY, a dim note confirms
   * that the file opened in TextEdit.
   *
   * @param {CommandContext} ctx - Command context; `ctx.name` is the alias that was typed.
   * @returns {number} 0 when every file opened, 1 when any argument failed.
   * @throws {FSError} If the virtual file system rejects creating a missing file.
   *
   * @example
   * // $ vim notes.txt
   * editor.run(ctx); // creates notes.txt if needed, opens it in TextEdit, returns 0
   */
  run(ctx) {
    const files = ctx.args.filter((a) => !a.startsWith('-') && !a.startsWith('+'));
    if (!files.length) {
      wm.openWindow('textedit');
      return 0;
    }
    let status = 0;
    for (const f of files) {
      const path = ctx.resolve(f);
      const node = fs.stat(path);
      if (node?.type === 'dir') {
        if (ctx.name === 'code' || ctx.name === 'subl') {
          wm.openWindow('finder', { path });
          continue;
        }
        ctx.error(`${f}: is a directory`);
        status = 1;
        continue;
      }
      if (!node) {
        const parent = dirname(path);
        const denied = fs.isDir(parent) ? writeDenied(parent) : 'No such file or directory';
        if (denied) {
          ctx.error(`${f}: ${denied}`);
          status = 1;
          continue;
        }
        fs.writeFile(path, '');
      }
      wm.openPath(path, 'textedit');
      if (['vim', 'vi', 'nano', 'emacs'].includes(ctx.name) && ctx.stdout.isTTY) {
        ctx.print(c.dim(t({ en: `Opened “${f}” in TextEdit.`, ko: `“${f}” 파일을 TextEdit에서 열었습니다.` })));
      }
    }
    return status;
  },
}; /** The `edit` command and its editor aliases (vim, vi, nano, emacs, code, subl), all backed by TextEdit. */

/* ───────────────────────── Settings ───────────────────────── */

/**
 * Returns the current system settings.
 *
 * Reads a snapshot from the useSystem store, so every call sees the latest values without
 * subscribing to changes.
 *
 * @returns {Settings} The current settings (theme, locale, wallpaper, accent, volume, …).
 *
 * @example
 * settings().locale; // 'en'
 */
const settings = () => useSystem.getState().settings;

/**
 * Applies a partial settings change through the system store.
 *
 * Forwards the patch to useSystem's updateSettings action, which shallow-merges it into the
 * persisted settings; subscribed UI (desktop, windows, menu bar) re-renders immediately.
 *
 * @param {Partial<Settings>} patch - The settings fields to change.
 * @returns {void} Nothing.
 *
 * @example
 * update({ theme: 'dark' });
 */
const update = (patch: Parameters<ReturnType<typeof useSystem.getState>['updateSettings']>[0]) => useSystem.getState().updateSettings(patch);

const theme: CommandDef = {
  name: 'theme',
  path: '/usr/local/bin',
  group: 'apps',
  summary: { en: 'switch light / dark appearance', ko: '라이트 / 다크 모드 전환' },
  usage: 'theme [light | dark | auto | toggle]',
  /**
   * Returns the appearance keywords accepted by `theme`.
   *
   * The same list is offered for every argument position.
   *
   * @returns {string[]} The keywords light, dark, auto and toggle.
   *
   * @example
   * theme.complete?.(0, ['']); // ['light', 'dark', 'auto', 'toggle']
   */
  complete: () => ['light', 'dark', 'auto', 'toggle'],
  /**
   * Prints or changes the light/dark appearance.
   *
   * Without an argument it prints the stored setting, adding the effective appearance in
   * parentheses when the setting is "auto". "toggle" switches to the opposite of the effective
   * appearance (resolving "auto" through the system's dark-mode preference); "light", "dark"
   * and "auto" are stored as given. Anything else is a usage error.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the requested appearance.
   * @returns {number} 0 on success, 1 for an unknown appearance.
   *
   * @example
   * // $ theme toggle
   * theme.run(ctx); // prints "Appearance set to dark." and returns 0
   */
  run(ctx) {
    const arg = ctx.args[0];
    const s = useSystem.getState();
    const effective = s.settings.theme === 'auto' ? (s.prefersDark ? 'dark' : 'light') : s.settings.theme;
    if (!arg) {
      ctx.print(s.settings.theme === 'auto' ? `auto (${effective})` : s.settings.theme);
      return 0;
    }
    const next: ThemeSetting | null = arg === 'toggle' ? (effective === 'dark' ? 'light' : 'dark') : ['light', 'dark', 'auto'].includes(arg) ? (arg as ThemeSetting) : null;
    if (!next) return usageError(ctx, t({ en: `unknown appearance: ${arg}`, ko: `알 수 없는 화면 모드: ${arg}` }), 'theme [light | dark | auto | toggle]');
    update({ theme: next });
    const ko = { light: '라이트로', dark: '다크로', auto: '자동으로' } as const;
    ctx.print(t({ en: `Appearance set to ${next}.`, ko: `화면 모드를 ${ko[next]} 설정했습니다.` }));
    return 0;
  },
}; /** The `theme` command: shows or switches the light/dark appearance. */

const lang: CommandDef = {
  name: 'lang',
  path: '/usr/local/bin',
  group: 'apps',
  summary: { en: 'switch the system language (en / ko)', ko: '시스템 언어 전환 (en / ko)' },
  usage: 'lang [en | ko]',
  /**
   * Returns the locale codes accepted by `lang`.
   *
   * The same list is offered for every argument position.
   *
   * @returns {string[]} The supported locales, en and ko.
   *
   * @example
   * lang.complete?.(0, ['']); // ['en', 'ko']
   */
  complete: () => ['en', 'ko'],
  /**
   * Prints or changes the system language.
   *
   * Without an argument it prints the current locale. With "en" or "ko" it stores the locale in
   * the system settings, exports a matching `LANG` variable (en_US.UTF-8 or ko_KR.UTF-8) in the
   * current shell and confirms the change in the new language. Other values are a usage error.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the requested locale.
   * @returns {number} 0 on success, 1 for an unsupported language.
   *
   * @example
   * // $ lang ko
   * lang.run(ctx); // switches the OS to Korean and returns 0
   */
  run(ctx) {
    const arg = ctx.args[0];
    if (!arg) {
      ctx.print(settings().locale);
      return 0;
    }
    if (arg !== 'en' && arg !== 'ko') return usageError(ctx, t({ en: `unsupported language: ${arg}`, ko: `지원하지 않는 언어: ${arg}` }), 'lang [en | ko]');
    update({ locale: arg });
    ctx.shell.setVar('LANG', arg === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', true);
    ctx.print(arg === 'ko' ? '시스템 언어를 한국어로 변경했습니다.' : 'System language changed to English.');
    return 0;
  },
}; /** The `lang` command: shows or switches the system language. */

const wallpaper: CommandDef = {
  name: 'wallpaper',
  path: '/usr/local/bin',
  group: 'apps',
  summary: { en: 'list or change the desktop picture', ko: '데스크탑 사진 나열 또는 변경' },
  usage: 'wallpaper [id | next | image-file]',
  /**
   * Returns the built-in wallpaper ids plus the "next" keyword.
   *
   * The same list is offered for every argument position; image files are not suggested.
   *
   * @returns {string[]} Every WALLPAPERS id followed by "next".
   *
   * @example
   * wallpaper.complete?.(0, ['']); // ['hallasan', …, 'next']
   */
  complete: () => [...WALLPAPERS.map((w) => w.id), 'next'],
  /**
   * Lists the wallpapers or changes the desktop picture.
   *
   * Without an argument it lists every built-in wallpaper, marking the current one with "*"
   * (bold cyan on a TTY), and appends the current image path when a custom image is in use.
   * "next" cycles to the following built-in wallpaper. Otherwise the argument is matched
   * against built-in ids and English names (case-insensitive), then against an image file in
   * the virtual file system. Unknown values print an error plus the available ids.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the wallpaper id, "next" or an image path.
   * @returns {number} 0 on success, 1 when the argument is neither a wallpaper nor an image file.
   *
   * @example
   * // $ wallpaper ~/Pictures/photo.jpg
   * wallpaper.run(ctx); // sets the image as the desktop picture and returns 0
   */
  run(ctx) {
    const arg = ctx.args[0];
    const current = settings().wallpaper;
    if (!arg) {
      const tty = ctx.stdout.isTTY;
      const lines = WALLPAPERS.map((w) => {
        const on = w.id === current;
        const line = `${on ? '*' : ' '} ${padEnd(w.id, 10)} ${t(w.name)}`;
        return on && tty ? c.bold(c.cyan(line)) : line;
      });
      if (current.startsWith('/')) lines.push(`* ${current}`);
      ctx.print(lines.join('\n'));
      return 0;
    }
    if (arg === 'next') {
      const idx = WALLPAPERS.findIndex((w) => w.id === current);
      const next = WALLPAPERS[(idx + 1) % WALLPAPERS.length];
      update({ wallpaper: next.id });
      ctx.print(t(next.name));
      return 0;
    }
    const builtIn = WALLPAPERS.find((w) => w.id === arg || tr(w.name, 'en').toLowerCase() === arg.toLowerCase());
    if (builtIn) {
      update({ wallpaper: builtIn.id });
      return 0;
    }
    const node = fs.stat(ctx.resolve(arg));
    if (node && node.type === 'file' && kindOf(node) === 'image') {
      update({ wallpaper: node.path });
      return 0;
    }
    ctx.error(node ? t({ en: `${arg}: not an image`, ko: `${arg}: 이미지가 아닙니다` }) : t({ en: `${arg}: no such wallpaper or file`, ko: `${arg}: 해당 배경화면이나 파일이 없습니다` }));
    ctx.stderr.write(`${t({ en: 'Available:', ko: '사용 가능:' })} ${WALLPAPERS.map((w) => w.id).join(', ')}\n`);
    return 1;
  },
}; /** The `wallpaper` command: lists or changes the desktop picture. */

const accent: CommandDef = {
  name: 'accent',
  path: '/usr/local/bin',
  group: 'apps',
  summary: { en: 'change the accent color', ko: '강조 색상 변경' },
  usage: 'accent [color]',
  /**
   * Returns the accent color ids accepted by `accent`.
   *
   * The same list is offered for every argument position.
   *
   * @returns {string[]} Every ACCENT_COLORS id.
   *
   * @example
   * accent.complete?.(0, ['']); // ['blue', 'purple', …]
   */
  complete: () => ACCENT_COLORS.map((a) => a.id),
  /**
   * Lists the accent colors or changes the current one.
   *
   * Without an argument it lists every color id, marking with "*" the one whose color value
   * equals the stored accent. With an argument it looks up the id case-insensitively and
   * stores that color's value; unknown ids are a usage error listing the valid ids.
   *
   * @param {CommandContext} ctx - Command context; `ctx.args[0]` is the color id.
   * @returns {number} 0 on success, 1 for an unknown color.
   *
   * @example
   * // $ accent purple
   * accent.run(ctx); // sets the purple accent color and returns 0
   */
  run(ctx) {
    const arg = ctx.args[0];
    if (!arg) {
      const cur = settings().accent;
      ctx.print(ACCENT_COLORS.map((a) => `${a.color === cur ? '*' : ' '} ${a.id}`).join('\n'));
      return 0;
    }
    const found = ACCENT_COLORS.find((a) => a.id === arg.toLowerCase());
    if (!found) return usageError(ctx, t({ en: `unknown color: ${arg}`, ko: `알 수 없는 색상: ${arg}` }), `accent [${ACCENT_COLORS.map((a) => a.id).join(' | ')}]`);
    update({ accent: found.color });
    return 0;
  },
}; /** The `accent` command: lists or changes the system accent color. */

/* ───────────────────────── say ───────────────────────── */

/**
 * Speaks text aloud with the browser's speech synthesis and waits until it finishes.
 *
 * The utterance language is Korean when the text contains Hangul or the system locale is
 * Korean, English otherwise; its volume follows the system volume setting. The returned
 * promise settles when speech ends or errors, or when the command's abort signal fires (^C),
 * which cancels all queued speech. The abort listener is always removed afterwards.
 *
 * @async
 * @param {CommandContext} ctx - Command context providing the abort signal and stderr.
 * @param {string} text - The text to speak.
 * @param {number} rate - Speech rate multiplier, where 1 is the normal speed.
 * @returns {Promise<number>} 0 when speech finished, 130 when interrupted, 1 when speech
 *   synthesis is unavailable in this browser.
 *
 * @example
 * const status = await speak(ctx, 'Hello there', 1);
 * console.log(status); // 0
 */
async function speak(ctx: CommandContext, text: string, rate: number): Promise<number> {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) {
    ctx.error(t({ en: 'speech synthesis is not available in this browser', ko: '이 브라우저에서는 음성 합성을 사용할 수 없습니다' }));
    return 1;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /[ㄱ-힝]/.test(text) ? 'ko-KR' : settings().locale === 'ko' ? 'ko-KR' : 'en-US';
  u.rate = rate;
  u.volume = settings().volume;
  await new Promise<void>((resolve) => {
    /**
     * Settles the wait for the utterance.
     *
     * Detaches the abort listener so it cannot fire later, then resolves the pending promise.
     * Used for the utterance's end and error events and after a cancellation.
     *
     * @returns {void} Nothing.
     *
     * @example
     * u.onend = done;
     */
    const done = () => {
      ctx.signal.removeEventListener('abort', cancel);
      resolve();
    };
    /**
     * Stops speaking when the command is interrupted.
     *
     * Cancels every queued utterance in the speech synthesizer, then settles the wait via done().
     *
     * @returns {void} Nothing.
     *
     * @example
     * ctx.signal.addEventListener('abort', cancel, { once: true });
     */
    const cancel = () => {
      synth.cancel();
      done();
    };
    u.onend = done;
    u.onerror = done;
    ctx.signal.addEventListener('abort', cancel, { once: true });
    synth.speak(u);
  });
  return ctx.signal.aborted ? 130 : 0;
}

const say: CommandDef = {
  name: 'say',
  path: '/usr/bin',
  group: 'apps',
  summary: { en: 'convert text to audible speech', ko: '텍스트를 음성으로 읽기' },
  usage: 'say [-r rate] [message]',
  options: [['-r rate', { en: 'Speaking rate (words per minute, default 175)', ko: '말하기 속도 (분당 단어 수, 기본값 175)' }]],
  /**
   * Speaks a message, a file's contents or piped input aloud.
   *
   * The text is taken from `-f file` when given, otherwise from the operands, otherwise from
   * stdin; blank text exits immediately. `-r` sets the rate in words per minute (175 is normal
   * speed, invalid values fall back to 175), converted to a multiplier clamped to 0.3–4. The
   * `-v` and `-o` options are accepted for compatibility and ignored.
   *
   * @async
   * @param {CommandContext} ctx - Command context with the arguments, stdin and abort signal.
   * @returns {Promise<number>} 0 when finished or nothing to say, 130 when interrupted, 1 on a
   *   usage error, a missing file, or unavailable speech synthesis.
   *
   * @example
   * // $ say -r 220 "Welcome to my portfolio"
   * await say.run(ctx); // speaks the message slightly faster than normal and returns 0
   */
  async run(ctx) {
    const { opts, operands, error } = getopt(ctx.args, { flags: '', values: 'rvof' });
    if (error) return usageError(ctx, error, 'say [-v voice] [-r rate] [-o outfile] [-f file | message]');
    let text = operands.join(' ');
    if (typeof opts.f === 'string') {
      const node = fs.stat(ctx.resolve(opts.f));
      if (!node || node.type !== 'file') {
        ctx.error(`${opts.f}: No such file or directory`);
        return 1;
      }
      text = node.content ?? '';
    } else if (!text) text = ctx.stdin ?? '';
    if (!text.trim()) return 0;
    const wpm = typeof opts.r === 'string' ? Number(opts.r) || 175 : 175;
    return speak(ctx, text, Math.min(4, Math.max(0.3, wpm / 175)));
  },
}; /** The `say` command: reads text aloud with speech synthesis. */

export const APP_COMMANDS: CommandDef[] = [open, editor, theme, lang, wallpaper, accent, say]; /** Terminal commands that control apps and system settings, registered under the "apps" help group. */

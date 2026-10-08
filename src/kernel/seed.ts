/**
 * Initial file system contents, generated from src/data/portfolio.ts.
 *
 * When the portfolio data (or SEED_SCHEMA) changes, the new seed is merged into returning
 * visitors' file systems: seeded items they never touched are updated (or removed when the new
 * seed does not contain them), everything they created or changed is kept.
 */
import type { AppManifest, FSNode, Locale } from './types';
import { education, experience, osInfo, owner, projects, skills } from '@/data/portfolio';
import { HOME, PATHS, USER } from './constants';
import { WALLPAPERS } from './wallpapers';
import { fs, mimeFor, useFS } from './fs';
import { basename, dirname, extname, isWithin, join } from './path';
import { tr } from './i18n';

const SEED_SCHEMA = 6; /** Schema version hashed into the seed version; increment it after changing how this file builds the seed so returning visitors get the new seed merged in. */

/**
 * Hashes a string to a short, stable identifier.
 *
 * Uses the djb2 algorithm on UTF-16 code units with 32-bit wrap-around and returns the unsigned
 * result in base 36. Not cryptographic; only used to detect changes.
 *
 * @param {string} str - The string to hash.
 * @returns {string} The hash in base 36.
 *
 * @example
 * hash('hello'); // "4bj995"
 */
function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Computes the version identifier of the current seed.
 *
 * Hashes `SEED_SCHEMA` together with every piece of portfolio data the seed is generated from,
 * so editing src/data/portfolio.ts (or bumping the schema) yields a new version and triggers a
 * merge for returning visitors.
 *
 * @returns {string} The seed version string stored alongside the file system.
 *
 * @example
 * const outdated = useFS.getState().seedVersion !== currentSeedVersion();
 */
export function currentSeedVersion(): string {
  return hash(JSON.stringify({ SEED_SCHEMA, osInfo, owner, projects, skills, experience, education }));
}

/** Path → node map being assembled for a seed. */
type Draft = Record<string, FSNode>;

/**
 * Generates the initial file system tree for a locale.
 *
 * Builds the system folders (locked), wallpapers, a few /etc and /var files, one locked `.app`
 * file per visible registered app (its content is the app id), the home folder with its standard
 * folders, a folder with README, cover and link files for each project, sample notes,
 * the Desktop items and a few Pictures/Downloads files. Text is localized for `locale`. Every item
 * gets a distinct timestamp on a whole hour (starting at January 15 of `osInfo.year`) with
 * createdAt === modifiedAt, which is how `isPristineSeed` recognizes untouched seeded items.
 *
 * @param {Locale} locale - Language used for file names and contents.
 * @param {AppManifest[]} apps - The registered apps, used for /Applications and app names.
 * @returns {Draft} The complete path → node map.
 *
 * @example
 * fs.replaceAll(buildSeed('en', APPS), currentSeedVersion());
 */
function buildSeed(locale: Locale, apps: AppManifest[]): Draft {
  const d: Draft = {};
  const base = Date.UTC(osInfo.year, 0, 15, 9, 0, 0);
  let tick = 0;
  /**
   * Returns the next seed timestamp.
   *
   * The first call returns the base time and each later call one `SEED_TICK` (one hour) more, so
   * every seeded item has a distinct whole-hour timestamp.
   *
   * @returns {number} Millisecond timestamp for the next seeded item.
   *
   * @example
   * const t = ts();
   */
  const ts = () => base + (tick++) * SEED_TICK;
  /**
   * Localizes a string for the seed's locale.
   *
   * Shorthand for `tr(s, locale)` with the `locale` passed to `buildSeed`.
   *
   * @param {Parameters<typeof tr>[0]} s - The localized string.
   * @returns {string} The text in `locale`.
   *
   * @example
   * L(owner.bio);
   */
  const L = (s: Parameters<typeof tr>[0]) => tr(s, locale);

  /**
   * Adds a folder to the draft.
   *
   * Stamps it with the next seed timestamp (createdAt === modifiedAt); the root folder is named
   * "/" and every other folder after its last path segment.
   *
   * @param {string} path - Absolute path of the folder.
   * @param {FSNode['meta']} [meta] - Optional metadata (e.g. `{ locked: true }`).
   * @returns {void}
   *
   * @example
   * dir('/tmp', { locked: true });
   */
  const dir = (path: string, meta?: FSNode['meta']) => {
    const t = ts();
    d[path] = { path, name: path === '/' ? '/' : basename(path), type: 'dir', createdAt: t, modifiedAt: t, meta };
  };
  /**
   * Adds a text file to the draft.
   *
   * The MIME type is derived from the file name.
   *
   * @param {string} path - Absolute path of the file.
   * @param {string} content - Text content of the file.
   * @param {FSNode['meta']} [meta] - Optional metadata (lock flag, Desktop icon position…).
   * @returns {void}
   *
   * @example
   * file('/etc/hosts', '127.0.0.1\tlocalhost\n');
   */
  const file = (path: string, content: string, meta?: FSNode['meta']) => {
    const t = ts();
    d[path] = { path, name: basename(path), type: 'file', content, mime: mimeFor(path), createdAt: t, modifiedAt: t, meta };
  };
  /**
   * Adds a file backed by a URL (image, wallpaper…) to the draft.
   *
   * The node stores `src` instead of content and reports `bytes` as its size.
   *
   * @param {string} path - Absolute path of the file.
   * @param {string} src - URL of the file's data.
   * @param {number} [bytes=48000] - Reported file size in bytes.
   * @param {FSNode['meta']} [meta] - Optional metadata.
   * @returns {void}
   *
   * @example
   * asset(join(PATHS.pictures, 'avatar.jpg'), owner.avatar, 40_000);
   */
  const asset = (path: string, src: string, bytes = 48_000, meta?: FSNode['meta']) => {
    const t = ts();
    d[path] = { path, name: basename(path), type: 'file', src, bytes, mime: mimeFor(path), createdAt: t, modifiedAt: t, meta };
  };

  dir('/');
  for (const p of ['/Applications', '/System', '/System/Library', '/Library', '/Users', '/bin', '/etc', '/tmp', '/usr', '/usr/bin', '/var', '/var/log']) dir(p, { locked: true });
  dir('/System/Library/Desktop Pictures', { locked: true });
  for (const w of WALLPAPERS) {
    asset(`/System/Library/Desktop Pictures/${tr(w.name, 'en')}.${extname(w.light)}`, w.light, 64_000, { locked: true });
    if (w.dark) asset(`/System/Library/Desktop Pictures/${tr(w.name, 'en')} (Dark).${extname(w.dark)}`, w.dark, 64_000, { locked: true });
  }
  file(
    '/System/Library/SystemVersion.plist',
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>ProductName</key><string>${osInfo.name}</string>\n  <key>ProductVersion</key><string>${osInfo.version}</string>\n  <key>ProductBuildVersion</key><string>${osInfo.build}</string>\n</dict>\n</plist>\n`,
    { locked: true },
  );
  file('/etc/motd', `Welcome to ${osInfo.name} ${osInfo.version} (${L(osInfo.codename)})\nType 'help' to see available commands.\n`);
  file('/etc/hosts', '127.0.0.1\tlocalhost\n::1\tlocalhost\n');
  file('/etc/shells', '/bin/zsh\n/bin/bash\n/bin/sh\n');
  file('/var/log/system.log', `${new Date(base).toISOString()} kernel[0]: ${osInfo.name} ${osInfo.version} boot\n`);

  for (const app of apps) {
    if (app.hidden) continue;
    file(`/Applications/${tr(app.name, 'en')}.app`, app.id, { locked: true });
  }

  dir('/Users/Shared');
  dir(HOME);
  for (const p of [PATHS.desktop, PATHS.documents, PATHS.downloads, PATHS.pictures, PATHS.music, PATHS.trash, PATHS.projects, PATHS.notes]) dir(p);
  dir(join(HOME, 'Movies'));
  dir(join(HOME, 'Public'));
  file(
    join(HOME, '.zshrc'),
    `# ~/.zshrc — ${USER}\nexport PATH="/usr/local/bin:/usr/bin:/bin"\nalias ll="ls -la"\nalias cdp="cd ~/Documents/Projects && ls"\n`,
  );

  for (const p of projects) {
    const folder = join(PATHS.projects, p.name);
    dir(folder);
    const links = [p.links.demo && `- Demo: ${p.links.demo}`, p.links.github && `- GitHub: ${p.links.github}`, p.links.instagram && `- Instagram: ${p.links.instagram}`].filter(Boolean).join('\n');
    file(
      join(folder, 'README.md'),
      `# ${p.name}\n\n> ${L(p.tagline)}\n\n![cover](${p.cover})\n\n${L(p.description)}\n\n## ${locale === 'ko' ? '역할' : 'Role'}\n${L(p.role)}\n\n## ${locale === 'ko' ? '주요 내용' : 'Highlights'}\n${p.highlights.map((h) => `- ${L(h)}`).join('\n')}\n\n## ${locale === 'ko' ? '기술 스택' : 'Stack'}\n${p.tags.map((t) => `\`${t}\``).join(' ')}\n${links ? `\n## ${locale === 'ko' ? '링크' : 'Links'}\n${links}\n` : ''}`,
    );
    asset(join(folder, `cover.svg`), p.cover, 52_000);
    if (p.links.demo) file(join(folder, `${p.name}.webloc`), p.links.demo);
    if (p.links.github) file(join(folder, `GitHub.webloc`), p.links.github);
    if (p.links.instagram) file(join(folder, `Instagram.webloc`), p.links.instagram);
  }

  file(
    join(PATHS.notes, locale === 'ko' ? '아이디어.md' : 'Ideas.md'),
    locale === 'ko'
      ? '# 아이디어\n\n- 터미널에 `neofetch` 넣기 ✅\n- 윈도우 스냅 기능 ✅\n- 다음엔 멀티 데스크탑(Spaces)?\n'
      : '# Ideas\n\n- Add `neofetch` to the Terminal ✅\n- Window snapping ✅\n- Multiple desktops (Spaces) next?\n',
  );
  file(
    join(PATHS.notes, locale === 'ko' ? '방문자에게.md' : 'For Visitors.md'),
    locale === 'ko'
      ? '# 둘러보는 법\n\n1. Dock에서 앱을 클릭해 실행하세요.\n2. 윈도우의 제목 표시줄을 화면 위쪽/양옆으로 끌어 스냅해 보세요.\n3. ⌘K(Windows/Linux에서는 Ctrl+K)로 Spotlight 검색.\n4. 터미널에서 `help`를 입력해 보세요.\n\n모든 변경 사항은 이 브라우저에 저장됩니다.\n'
      : '# How to explore\n\n1. Click apps in the Dock to launch them.\n2. Drag a window title bar to the top / sides of the screen to snap it.\n3. ⌘K (Ctrl+K on Windows/Linux) opens Spotlight.\n4. Type `help` in the Terminal.\n\nEverything you change is saved in this browser.\n',
  );

  const readMe = locale === 'ko' ? '읽어보세요.md' : 'Read Me.md';
  /**
   * Returns an app's display name in the seed's locale.
   *
   * Uses the registered app's name, so files refer to apps by the names the Dock, Launchpad and
   * menu bar show; falls back to `fallback` when the app is not registered.
   *
   * @param {string} id - The app id.
   * @param {{ en: string; ko: string }} fallback - Name used when the app is not registered.
   * @returns {string} The localized app name.
   *
   * @example
   * const mail = appName('mail', { en: 'Mail', ko: '메일' });
   */
  const appName = (id: string, fallback: { en: string; ko: string }) => L(apps.find((a) => a.id === id)?.name ?? fallback);
  /**
   * Returns a Markdown link that opens an app through its `.app` file in /Applications.
   *
   * The link text is the app's localized name in bold; the target is the `.app` file named after
   * the app's English name (the name it is seeded under), wrapped in angle brackets so names with
   * spaces stay one link.
   *
   * @param {string} id - The app id.
   * @param {{ en: string; ko: string }} fallback - Names used when the app is not registered.
   * @returns {string} The Markdown link.
   *
   * @example
   * appLink('mail', { en: 'Mail', ko: '메일' }); // '[**메일**](</Applications/Mail.app>)'
   */
  const appLink = (id: string, fallback: { en: string; ko: string }) => `[**${appName(id, fallback)}**](</Applications/${tr(apps.find((a) => a.id === id)?.name ?? fallback, 'en')}.app>)`;
  const aboutMe = appLink('about-me', { en: 'About Me', ko: '내 소개' });
  const projectsApp = appLink('projects', { en: 'Projects', ko: '프로젝트' });
  const mail = appLink('mail', { en: 'Mail', ko: '메일' });
  file(
    join(PATHS.desktop, readMe),
    `# ${locale === 'ko' ? `${osInfo.name}에 오신 것을 환영합니다 👋` : `Welcome to ${osInfo.name} 👋`}\n\n${L(owner.bio)}\n\n---\n\n${locale === 'ko' ? '**바로가기**' : '**Quick links**'}\n\n- ${locale === 'ko' ? `${aboutMe} — 저에 대해` : `${aboutMe} — who I am`}\n- ${locale === 'ko' ? `${projectsApp} — 작업물` : `${projectsApp} — my work`}\n- ${locale === 'ko' ? `${mail} — 연락하기` : `${mail} — get in touch`}\n`,
    { x: 0, y: 0 },
  );
  const shot = projects[0]?.cover ?? '/projects/webos.svg';
  asset(join(PATHS.desktop, `Screenshot.${extname(shot)}`), shot, 52_000, { x: 0, y: 1 });

  for (const p of projects) asset(join(PATHS.pictures, `${p.id}.${extname(p.cover)}`), p.cover, 52_000);
  asset(join(PATHS.pictures, `avatar.${extname(owner.avatar)}`), owner.avatar, 40_000);
  if (owner.links.github) file(join(PATHS.downloads, 'GitHub.webloc'), owner.links.github);
  file(join(PATHS.downloads, 'todo.txt'), locale === 'ko' ? '- 포트폴리오 업데이트\n- 운동하기\n' : '- update portfolio\n- go for a run\n');

  return d;
}

const SEED_TICK = 3_600_000; /** Spacing of seed timestamps (one hour); seeded items are stamped on multiples of it. */

/**
 * Checks whether a node is a seeded item the visitor never changed.
 *
 * Seeded items are stamped on whole hours and keep createdAt === modifiedAt until they are
 * edited, renamed or moved; items visitors create, copy or import carry the current time, so they
 * almost never satisfy both conditions.
 *
 * @param {FSNode} n - The node to check.
 * @returns {boolean} True if the node is an untouched seeded item.
 *
 * @example
 * if (isPristineSeed(node)) next[path] = seed[path];
 */
function isPristineSeed(n: FSNode): boolean {
  return n.createdAt % SEED_TICK === 0 && n.modifiedAt === n.createdAt;
}

/**
 * Brings a returning visitor's file system up to date with a new seed without losing their work.
 *
 * - Seeded files they never touched are replaced by the new version (their metadata such as icon
 *   position, tags and pins wins over the seed's), or removed when the new seed does not contain
 *   them.
 * - New seeded items are added, except ones the visitor put in the Trash (matched through the
 *   trashed items' `trashedFrom`) and ones whose parent folder is missing.
 * - Seed paths are visited in sorted order so parents are added before their children.
 * - Existing folders get the seed's metadata merged in; items whose type differs from the seed
 *   are left alone.
 * - Seeded folders absent from the new seed are removed once nothing is left in them, deepest
 *   first.
 * - Everything else (their files, edited seeded files, the Trash) is kept as is.
 *
 * The input maps are not modified.
 *
 * @param {Record<string, FSNode>} current - The visitor's current path → node map.
 * @param {Record<string, FSNode>} seed - The newly generated seed.
 * @returns {Record<string, FSNode>} The merged path → node map.
 *
 * @example
 * fs.replaceAll(mergeSeed(useFS.getState().nodes, buildSeed('en', APPS)), currentSeedVersion());
 */
export function mergeSeed(current: Record<string, FSNode>, seed: Record<string, FSNode>): Record<string, FSNode> {
  const next: Record<string, FSNode> = { ...current };
  /**
   * Checks whether a path is an item inside the Trash (not the Trash folder itself).
   *
   * The merge never removes Trash items and reads their `trashedFrom` to skip re-adding seeded
   * items the visitor deleted.
   *
   * @param {string} p - The path to check.
   * @returns {boolean} True if the path is inside the Trash.
   *
   * @example
   * inTrash(PATHS.trash + '/old.txt'); // true
   */
  const inTrash = (p: string) => isWithin(p, PATHS.trash) && p !== PATHS.trash;
  const trashedFrom = new Set<string>();
  for (const p in current) if (inTrash(p) && current[p].meta?.trashedFrom) trashedFrom.add(current[p].meta!.trashedFrom!);

  for (const p in current) {
    const n = current[p];
    if (n.type === 'file' && !seed[p] && !inTrash(p) && isPristineSeed(n)) delete next[p];
  }
  for (const p of Object.keys(seed).sort()) {
    const s = seed[p];
    const cur = next[p];
    if (!cur) {
      if (trashedFrom.has(p)) continue;
      if (p !== '/' && next[dirname(p)]?.type !== 'dir') continue;
      next[p] = s;
    } else if (cur.type !== s.type) {
      continue;
    } else if (s.type === 'dir') {
      if (s.meta) next[p] = { ...cur, meta: { ...cur.meta, ...s.meta } };
    } else if (isPristineSeed(cur)) {
      const meta = s.meta || cur.meta ? { ...s.meta, ...cur.meta } : undefined;
      next[p] = { ...s, meta };
    }
  }
  const dirs = Object.keys(current).filter((p) => current[p].type === 'dir' && !seed[p] && !inTrash(p) && current[p].createdAt % SEED_TICK === 0 && p !== '/');
  for (const p of dirs.sort((a, b) => b.length - a.length)) {
    const prefix = p + '/';
    if (!Object.keys(next).some((k) => k.startsWith(prefix))) delete next[p];
  }
  return next;
}

/**
 * Makes sure the file system holds the current seed.
 *
 * Called during boot after the file system is hydrated. An empty file system (no root or home
 * folder) is replaced by a fresh seed. Otherwise the new seed is merged in with `mergeSeed` when
 * the stored seed version differs from the current one, and /Applications is always brought in
 * sync with the registered apps afterwards.
 *
 * @param {Locale} locale - Language used for newly seeded file names and contents.
 * @param {AppManifest[]} apps - The registered apps.
 * @returns {void}
 *
 * @example
 * ensureSeeded(useSystem.getState().settings.locale, APPS);
 */
export function ensureSeeded(locale: Locale, apps: AppManifest[]): void {
  const version = currentSeedVersion();
  const state = useFS.getState();
  if (!state.nodes['/'] || !state.nodes[HOME]) {
    fs.replaceAll(buildSeed(locale, apps), version);
    return;
  }
  if (state.seedVersion !== version) fs.replaceAll(mergeSeed(state.nodes, buildSeed(locale, apps)), version);
  syncApplications(apps);
}

/**
 * Keeps /Applications in sync with the registered apps.
 *
 * Removes every entry in /Applications that does not belong to a visible registered app and adds
 * a locked `.app` file (content = app id) for each visible app that is missing, stamped with the
 * current time. The store is only updated when something changed.
 *
 * @param {AppManifest[]} apps - The registered apps.
 * @returns {void}
 *
 * @example
 * syncApplications(APPS);
 */
function syncApplications(apps: AppManifest[]): void {
  const nodes = useFS.getState().nodes;
  const wanted = new Map(apps.filter((a) => !a.hidden).map((a) => [`/Applications/${tr(a.name, 'en')}.app`, a.id]));
  const next = { ...nodes };
  let changed = false;
  for (const p in nodes) {
    if (p.startsWith('/Applications/') && !wanted.has(p)) {
      delete next[p];
      changed = true;
    }
  }
  for (const [p, id] of wanted) {
    if (!next[p]) {
      const t = Date.now();
      next[p] = { path: p, name: basename(p), type: 'file', content: id, mime: 'application/x-app', createdAt: t, modifiedAt: t, meta: { locked: true } };
      changed = true;
    }
  }
  if (changed) useFS.setState({ nodes: next });
}

/**
 * Resets the file system to a fresh seed ("Erase All Content and Settings").
 *
 * Replaces the whole tree, discarding every visitor change, and stores the current seed version.
 *
 * @param {Locale} locale - Language used for the new seed.
 * @param {AppManifest[]} apps - The registered apps.
 * @returns {void}
 *
 * @example
 * eraseAll(useSystem.getState().settings.locale, APPS);
 */
export function eraseAll(locale: Locale, apps: AppManifest[]): void {
  fs.replaceAll(buildSeed(locale, apps), currentSeedVersion());
}

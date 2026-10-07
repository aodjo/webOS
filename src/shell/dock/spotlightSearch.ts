/**
 * Spotlight's search model: ranking and result building. Pure (reads the FS / registry / portfolio
 * data but has no side effects) so it can be unit-tested; Spotlight.tsx performs the actions.
 */
import { extname, fs, isWithin, listApps, stem, tr, type FSNode, type Locale, type LString } from '@/kernel';
import { projects, skills } from '@/data/portfolio';
import { calculate, convert } from './calc';

/** Result section, in display order (see GROUP_ORDER). */
export type GroupId = 'top' | 'apps' | 'calc' | 'convert' | 'portfolio' | 'settings' | 'docs' | 'web';

/** Fields shared by every Spotlight result. */
interface Base {
  /** Unique key. */
  id: string;
  /** Section the result is listed in. */
  group: GroupId;
  /**
   * Relevance, higher ranks first: about 0–100 for text matches (apps get +8), 1000 for
   * calculator/conversion results.
   */
  score: number;
  title: string;
  subtitle?: string;
}

/** One Spotlight result row; `kind` tells Spotlight.tsx what to do when it is opened. */
export type SpotlightResult =
  | (Base & { kind: 'app'; appId: string })
  | (Base & { kind: 'file'; path: string })
  | (Base & { kind: 'project'; projectId: string })
  | (Base & { kind: 'skill'; skill: string; category: LString; level: number })
  | (Base & { kind: 'setting'; pane: string })
  | (Base & { kind: 'calc'; expr: string; plain: string })
  | (Base & { kind: 'convert'; from: string; plain: string })
  | (Base & { kind: 'web'; query: string });

export const GROUP_LABELS: Record<GroupId, LString> = {
  top: { en: 'Top Hit', ko: '가장 일치하는 항목' },
  apps: { en: 'Applications', ko: '응용 프로그램' },
  calc: { en: 'Calculator', ko: '계산기' },
  convert: { en: 'Conversion', ko: '변환' },
  portfolio: { en: 'Portfolio', ko: '포트폴리오' },
  settings: { en: 'System Settings', ko: '시스템 설정' },
  docs: { en: 'Documents & Folders', ko: '문서 및 폴더' },
  web: { en: 'Web', ko: '웹' },
}; /** Localized section headings. */

const GROUP_ORDER: GroupId[] = ['top', 'apps', 'calc', 'convert', 'portfolio', 'settings', 'docs', 'web']; /** Order in which sections are listed. */
const GROUP_LIMIT: Partial<Record<GroupId, number>> = { apps: 8, portfolio: 6, settings: 5, docs: 10 }; /** Maximum results per section (unlisted sections are unlimited). */
const TOP_PRIORITY: Partial<Record<GroupId, number>> = { apps: 4, portfolio: 3, settings: 2, docs: 1 }; /** Tie-break priority when choosing the Top Hit among equal scores (higher wins). */

/* ───────────────────────── System Settings panes ───────────────────────── */

/** A System Settings pane that Spotlight can open. */
export interface SettingsPane {
  /** Pane id passed to the Settings app. */
  pane: string;
  name: LString;
  /** Extra search terms (English and Korean). */
  keywords: string[];
}

export const SETTINGS_PANES: SettingsPane[] = [
  { pane: 'wifi', name: 'Wi-Fi', keywords: ['wifi', 'wi-fi', 'wireless', 'network', 'internet', '와이파이', '네트워크', '인터넷', '무선'] },
  { pane: 'bluetooth', name: 'Bluetooth', keywords: ['bluetooth', 'devices', 'headphones', '블루투스', '기기'] },
  { pane: 'general', name: { en: 'General', ko: '일반' }, keywords: ['general', '일반'] },
  { pane: 'accessibility', name: { en: 'Accessibility', ko: '손쉬운 사용' }, keywords: ['accessibility', 'reduce motion', 'reduce transparency', 'animation', '손쉬운 사용', '동작 줄이기', '투명도 줄이기', '애니메이션'] },
  { pane: 'appearance', name: { en: 'Appearance', ko: '화면 모드' }, keywords: ['appearance', 'dark mode', 'light mode', 'theme', 'accent color', 'accent', '다크 모드', '라이트 모드', '테마', '화면 모드', '강조 색상'] },
  { pane: 'control-center', name: { en: 'Control Center', ko: '제어 센터' }, keywords: ['control center', 'menu bar', 'clock', '24-hour', 'seconds', '제어 센터', '메뉴 막대', '시계', '24시간'] },
  { pane: 'desktop-dock', name: { en: 'Desktop & Dock', ko: '데스크탑 및 Dock' }, keywords: ['dock', 'desktop', 'magnification', 'autohide', 'hide dock', 'dock position', 'hidden files', '독', '데스크탑', '확대', '자동으로 가리기', '숨김 파일'] },
  { pane: 'displays', name: { en: 'Displays', ko: '디스플레이' }, keywords: ['displays', 'display', 'brightness', 'night shift', 'resolution', 'screen', '디스플레이', '밝기', '나이트 시프트', '해상도', '화면'] },
  { pane: 'wallpaper', name: { en: 'Wallpaper', ko: '배경화면' }, keywords: ['wallpaper', 'background', 'desktop picture', '배경화면', '바탕화면', '배경'] },
  { pane: 'notifications', name: { en: 'Notifications', ko: '알림' }, keywords: ['notifications', 'alerts', 'banners', 'notification center', '알림', '배너', '알림 센터'] },
  { pane: 'sound', name: { en: 'Sound', ko: '사운드' }, keywords: ['sound', 'volume', 'audio', 'alert sound', '사운드', '음량', '소리', '경고음'] },
  { pane: 'focus', name: { en: 'Focus', ko: '집중 모드' }, keywords: ['focus', 'do not disturb', 'dnd', '집중 모드', '방해 금지', '방해금지'] },
  { pane: 'lock-screen', name: { en: 'Lock Screen', ko: '잠금 화면' }, keywords: ['lock screen', 'lock', 'sleep', 'screen saver', '잠금 화면', '잠금', '잠자기'] },
  { pane: 'users', name: { en: 'Users & Groups', ko: '사용자 및 그룹' }, keywords: ['users', 'password', 'account', 'avatar', 'login', '사용자', '암호', '비밀번호', '계정', '로그인'] },
  { pane: 'about', name: { en: 'About', ko: '정보' }, keywords: ['about', 'version', 'memory', 'serial', '정보', '버전', '메모리'] },
  { pane: 'software-update', name: { en: 'Software Update', ko: '소프트웨어 업데이트' }, keywords: ['software update', 'update', 'upgrade', '소프트웨어 업데이트', '업데이트'] },
  { pane: 'storage', name: { en: 'Storage', ko: '저장 공간' }, keywords: ['storage', 'disk', 'space', '저장 공간', '디스크', '용량'] },
  { pane: 'language', name: { en: 'Language & Region', ko: '언어 및 지역' }, keywords: ['language', 'region', 'locale', 'korean', 'english', '언어', '지역', '한국어', '영어'] },
  { pane: 'reset', name: { en: 'Transfer or Reset', ko: '전송 또는 재설정' }, keywords: ['reset', 'erase', 'factory', '재설정', '초기화', '지우기'] },
]; /** Searchable System Settings panes with their names and keywords. */

/* ───────────────────────── App aliases ───────────────────────── */

const APP_ALIASES: Record<string, string[]> = {
  finder: ['files', 'folders', 'explorer', '파일', '폴더'],
  safari: ['browser', 'web', 'internet', '브라우저', '인터넷'],
  mail: ['email', 'contact', 'message', '이메일', '연락', '메시지'],
  notes: ['memo', '노트'],
  'about-me': ['resume', 'cv', 'profile', 'bio', 'experience', '이력서', '프로필', '경력'],
  projects: ['portfolio', 'work', '포트폴리오', '작업'],
  terminal: ['shell', 'console', 'command line', 'bash', 'zsh', 'cli', '셸', '콘솔'],
  textedit: ['editor', 'text', 'write', '편집기', '텍스트'],
  preview: ['viewer', 'image', 'pdf', 'photo', '뷰어', '이미지', '사진'],
  calculator: ['calc', 'math', '수학'],
  settings: ['preferences', 'system preferences', 'control panel', 'config', '환경설정', '설정'],
  'activity-monitor': ['task manager', 'processes', 'cpu', 'memory', '작업 관리자', '프로세스'],
  minesweeper: ['game', 'mines', '게임'],
  welcome: ['help', 'tips', 'getting started', 'shortcuts', '도움말', '단축키'],
  launchpad: ['apps', 'applications', '앱', '응용 프로그램'],
}; /** Extra words that find an app by id (e.g. "browser" → Safari). */

/* ───────────────────────── Ranking ───────────────────────── */

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'; /** The 19 Hangul initial consonants in Unicode syllable order. */

/**
 * Extracts the initial consonants of Hangul syllables.
 *
 * Each precomposed syllable (U+AC00–U+D7A3) maps to its initial consonant, computed from its
 * offset in the syllable block (588 syllables per initial). Other characters pass through.
 *
 * @param {string} text - Text that may contain Hangul syllables.
 * @returns {string} The text with every syllable replaced by its initial consonant.
 *
 * @example
 * choseong('계산기'); // "ㄱㅅㄱ"
 */
export function choseong(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : ch;
  }
  return out;
}

/**
 * Tests whether a query consists only of Hangul consonant jamo and whitespace.
 *
 * Such queries are matched against the initial consonants of the candidate text (see
 * `choseong`) in addition to the regular text match.
 *
 * @param {string} q - The search query.
 * @returns {boolean} True for an initial-consonant query such as "ㄱㅅ".
 *
 * @example
 * isChoseongQuery('ㄱㅅ ㄱ'); // true
 */
const isChoseongQuery = (q: string) => /^[ㄱ-ㅎ\s]+$/.test(q);

/**
 * Scores how well a text matches a query, from 0 (no match) to 100 (exact).
 *
 * Both strings are lowercased and NFC-normalized. Tiers, best first: exact (100); prefix (80–90,
 * shorter texts score higher); a word prefix (75); substring (55); for Hangul consonant queries,
 * an initial-consonant prefix (70) or substring (50); initials of the words, e.g. "ss" → "System
 * Settings" (50); and, for queries of three or more characters, an in-order subsequence (20).
 *
 * @param {string} text - The candidate text.
 * @param {string} query - The search query.
 * @returns {number} The match score.
 *
 * @example
 * matchScore('Safari', 'saf');           // 88.5
 * matchScore('System Settings', 'ss');   // 50
 */
export function matchScore(text: string, query: string): number {
  const t = text.toLowerCase().normalize('NFC');
  const q = query.toLowerCase().normalize('NFC').trim();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90 - Math.min(10, (t.length - q.length) / 2);
  const words = t.split(/[\s\-_.()/&]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 75;
  if (t.includes(q)) return 55;
  if (isChoseongQuery(q)) {
    const c = choseong(t);
    const cq = q.replace(/\s+/g, '');
    if (c.replace(/\s+/g, '').startsWith(cq)) return 70;
    if (c.includes(cq)) return 50;
  }
  if (q.length >= 2 && !q.includes(' ') && words.length >= q.length && words.map((w) => w[0]).join('').startsWith(q)) return 50;
  if (q.length >= 3) {
    let i = 0;
    for (const ch of t) if (ch === q[i]) i++;
    if (i === q.length) return 20;
  }
  return 0;
}

/**
 * Returns the best `matchScore` of a query against several texts.
 *
 * Scores every text independently and keeps the maximum, starting from 0.
 *
 * @param {string[]} texts - Candidate texts (names, aliases, keywords…).
 * @param {string} q - The search query.
 * @returns {number} The highest score, or 0 when the list is empty.
 *
 * @example
 * bestScore(['Calculator', '계산기'], 'calc'); // 87
 */
const bestScore = (texts: string[], q: string) => texts.reduce((m, s) => Math.max(m, matchScore(s, q)), 0);

/* ───────────────────────── File filtering ───────────────────────── */

const EXCLUDED_ROOTS = ['/System', '/Applications', '/bin', '/usr', '/etc', '/var', '/tmp', '/private', '/dev']; /** System directories whose contents are never listed as documents. */

/**
 * Tells whether a file-system node may appear in Spotlight's document results.
 *
 * Excludes nodes marked hidden, any path with a dot-prefixed segment, and everything inside the
 * system directories in EXCLUDED_ROOTS.
 *
 * @param {FSNode} node - The node to check.
 * @returns {boolean} True when the node is searchable.
 *
 * @example
 * fs.search('resume', '/').filter(isSearchableFile);
 */
export function isSearchableFile(node: FSNode): boolean {
  if (node.meta?.hidden) return false;
  if (node.path.split('/').some((seg) => seg.startsWith('.'))) return false;
  return !EXCLUDED_ROOTS.some((r) => isWithin(node.path, r));
}

/* ───────────────────────── Build ───────────────────────── */

export const CATEGORY_LABELS: Record<string, LString> = {
  system: { en: 'System', ko: '시스템' },
  portfolio: { en: 'Portfolio', ko: '포트폴리오' },
  utility: { en: 'Utility', ko: '유틸리티' },
  game: { en: 'Game', ko: '게임' },
}; /** Localized app category names, used as the subtitle of apps without a description. */

const WEB_LABEL = { en: 'Search the Web for “{q}”', ko: '웹에서 “{q}” 검색' }; /** Title template of the web-search row; `{q}` is replaced by the query. */

/**
 * Builds the grouped, ordered Spotlight results for a query.
 *
 * Collects candidates from every source:
 * - a calculator result, or failing that a unit conversion (score 1000);
 * - apps, matched on their English and Korean names and (capped at 60) their aliases, with a +8
 *   bonus;
 * - portfolio projects by name, tags, tagline or id, and skills by name or category;
 * - System Settings panes by name or keywords;
 * - files and folders anywhere in the FS that pass `isSearchableFile`, matched on the name and,
 *   for files, the name without extension; ties prefer shallower paths, then newer files. The FS
 *   search limit is generous so excluded system paths cannot use up the budget before user files
 *   are reached.
 * The highest-scoring candidate becomes the Top Hit (ties broken by TOP_PRIORITY); it is dropped
 * when it scores below 40 unless it is a calculation. The remaining results are listed per group
 * in GROUP_ORDER, sorted by score and capped by GROUP_LIMIT, followed by a web-search row.
 *
 * @param {string} rawQuery - The text typed into Spotlight.
 * @param {Locale} locale - Locale used for titles and subtitles.
 * @returns {SpotlightResult[]} The results, or an empty array for a blank query.
 *
 * @example
 * const results = buildResults('saf', 'en');
 * results[0]; // { kind: 'app', group: 'top', appId: 'safari', ... }
 */
export function buildResults(rawQuery: string, locale: Locale): SpotlightResult[] {
  const q = rawQuery.trim();
  if (!q) return [];
  const out: SpotlightResult[] = [];

  const calc = calculate(q);
  if (calc) out.push({ kind: 'calc', id: 'calc', group: 'calc', score: 1000, title: calc.display, subtitle: q.replace(/^=/, '').trim(), expr: q, plain: calc.plain });
  const conv = calc ? null : convert(q);
  if (conv) out.push({ kind: 'convert', id: 'convert', group: 'convert', score: 1000, title: conv.to, subtitle: conv.from, from: conv.from, plain: conv.plain });

  for (const app of listApps()) {
    const names = typeof app.name === 'string' ? [app.name] : [app.name.en, app.name.ko];
    const nameScore = bestScore(names, q);
    const aliasScore = Math.min(60, bestScore(APP_ALIASES[app.id] ?? [], q));
    const score = Math.max(nameScore, aliasScore);
    if (score <= 0) continue;
    out.push({
      kind: 'app',
      id: `app:${app.id}`,
      group: 'apps',
      score: score + 8,
      title: tr(app.name, locale),
      subtitle: tr(app.description ?? CATEGORY_LABELS[app.category ?? 'utility'], locale),
      appId: app.id,
    });
  }

  for (const p of projects) {
    const score = Math.max(matchScore(p.name, q), Math.min(70, bestScore(p.tags, q)), Math.min(45, matchScore(tr(p.tagline, locale), q)), Math.min(30, matchScore(p.id, q)));
    if (score > 0) out.push({ kind: 'project', id: `project:${p.id}`, group: 'portfolio', score, title: p.name, subtitle: tr(p.tagline, locale), projectId: p.id });
  }
  for (const cat of skills) {
    for (const s of cat.items) {
      const score = Math.max(matchScore(s.name, q), Math.min(40, matchScore(tr(cat.category, locale), q)));
      if (score >= 40) out.push({ kind: 'skill', id: `skill:${s.name}`, group: 'portfolio', score: score - 5, title: s.name, subtitle: tr(cat.category, locale), skill: s.name, category: cat.category, level: s.level });
    }
  }

  for (const pane of SETTINGS_PANES) {
    const names = typeof pane.name === 'string' ? [pane.name] : [pane.name.en, pane.name.ko];
    const score = Math.max(bestScore(names, q), Math.min(65, bestScore(pane.keywords, q)));
    if (score >= 40) out.push({ kind: 'setting', id: `setting:${pane.pane}`, group: 'settings', score, title: tr(pane.name, locale), subtitle: tr(GROUP_LABELS.settings, locale), pane: pane.pane });
  }

  const files = fs
    .search(q, '/', 5000)
    .filter(isSearchableFile)
    .map((n) => ({ n, score: Math.max(matchScore(n.name, q), matchScore(n.type === 'dir' || !extname(n.name) ? n.name : stem(n.name), q)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || depth(a.n.path) - depth(b.n.path) || b.n.modifiedAt - a.n.modifiedAt);
  for (const { n, score } of files) out.push({ kind: 'file', id: `file:${n.path}`, group: 'docs', score, title: n.name, subtitle: n.path, path: n.path });

  let top: SpotlightResult | null = null;
  for (const r of out) {
    if (!top || r.score > top.score || (r.score === top.score && (TOP_PRIORITY[r.group] ?? 0) > (TOP_PRIORITY[top.group] ?? 0))) top = r;
  }
  if (top && top.score < 40 && top.kind !== 'calc') top = null;

  const grouped: SpotlightResult[] = [];
  if (top) grouped.push({ ...top, group: 'top' });
  for (const g of GROUP_ORDER) {
    if (g === 'top' || g === 'web') continue;
    const items = out.filter((r) => r.group === g && r !== top).sort((a, b) => b.score - a.score);
    grouped.push(...items.slice(0, GROUP_LIMIT[g] ?? items.length));
  }
  grouped.push({ kind: 'web', id: 'web', group: 'web', score: 0, title: tr(WEB_LABEL, locale).replace('{q}', q), query: q });
  return grouped;
}

/**
 * Counts the segments of a path so shallower files can rank first.
 *
 * Splits on "/" without filtering, so the empty segment before the leading slash is counted too.
 *
 * @param {string} p - An absolute path.
 * @returns {number} The number of "/"-separated segments (including the empty root segment).
 *
 * @example
 * depth('/Users/guest/Documents'); // 4
 */
function depth(p: string): number {
  return p.split('/').length;
}

/**
 * Builds the web-search URL for a query.
 *
 * Uses Google's `igu=1` mode, which can be shown inside the in-OS browser's iframe.
 *
 * @param {string} q - The search text.
 * @returns {string} The URL-encoded search URL.
 *
 * @example
 * webSearchURL('react hooks'); // "https://www.google.com/search?igu=1&q=react%20hooks"
 */
export function webSearchURL(q: string): string {
  return 'https://www.google.com/search?igu=1&q=' + encodeURIComponent(q);
}

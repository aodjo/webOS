/**
 * The Inbox the visitor finds: messages FROM the owner TO the visitor, generated from
 * src/data/portfolio.ts in the current language (so switching language re-localizes them).
 */
import { osInfo, owner, projects } from '@/data/portfolio';
import { tr, type Locale } from '@/kernel';
import type { MailMessage } from './types';

export const SEED_IDS = ['welcome', 'projects', 'contact', 'system'] as const; /** Ids of the seeded messages, in the order `buildSeedMessages` returns them. */
/** Id of one of the seeded messages. */
export type SeedId = (typeof SEED_IDS)[number];

export const SEED_DEFAULTS: Record<SeedId, { read: boolean; flagged: boolean }> = {
  welcome: { read: false, flagged: false },
  projects: { read: false, flagged: false },
  contact: { read: false, flagged: true },
  system: { read: false, flagged: false },
}; /** Initial read / flag state of each seeded message, used until the visitor changes it. */

export const SYSTEM_ADDRESS = `no-reply@${osInfo.name.toLowerCase()}.os`; /** Sender address of the system welcome message, derived from the OS name. */

const MIN = 60_000; /** One minute in milliseconds. */
const HOUR = 60 * MIN; /** One hour in milliseconds. */
const DAY = 24 * HOUR; /** One day in milliseconds. */

/**
 * Generates the seeded Inbox messages from the portfolio data.
 *
 * Builds four messages from the owner to the visitor (welcome, featured projects, contact
 * links, and a system message from the OS team), fully written
 * in the given locale. Dates are fixed offsets (minutes to a few days) before `seededAt`, so
 * the messages look like they arrived before the visitor's first visit. Featured projects
 * fall back to the first three projects, and only the owner links that are set are listed.
 * All messages start unread; the returned read / flagged / mailbox values are defaults that
 * the store overrides with the visitor's saved state.
 *
 * @param {Locale} locale - Language to write the messages in.
 * @param {number} seededAt - Timestamp the message dates are relative to.
 * @param {{ name: string }} me - The visitor, used as the recipient of every message.
 * @returns {MailMessage[]} The seeded messages in `SEED_IDS` order.
 *
 * @example
 * const msgs = buildSeedMessages('en', Date.now(), ME);
 * console.log(msgs.map((m) => m.id)); // ['welcome', 'projects', 'contact', 'system']
 */
export function buildSeedMessages(locale: Locale, seededAt: number, me: { name: string }): MailMessage[] {
  const ko = locale === 'ko';
  /**
   * Resolves a localized portfolio string in the locale being generated.
   *
   * Wraps `tr` with the `locale` argument of `buildSeedMessages`, so every message is
   * written in that locale regardless of the current UI language.
   *
   * @param {Parameters<typeof tr>[0]} s - A localized string, plain string or nullish value.
   * @returns {string} The text in `locale` (English fallback, empty for nullish input).
   *
   * @example
   * const name = L(owner.name);
   */
  const L = (s: Parameters<typeof tr>[0]) => tr(s, locale);
  const name = L(owner.name);
  const from = { name, email: owner.email };
  const to = [{ name: me.name, email: '' }];
  const sign = `\n\n${ko ? '감사합니다,' : 'Cheers,'}\n**${name}**  \n${L(owner.role)} · ${L(owner.location)}`;
  const featured = projects.filter((p) => p.featured);
  const showcase = featured.length ? featured : projects.slice(0, 3);
  const links = [
    owner.links.github && `- GitHub: [${owner.links.github.replace(/^https?:\/\//, '')}](${owner.links.github})`,
    owner.links.linkedin && `- LinkedIn: [${owner.links.linkedin.replace(/^https?:\/\//, '')}](${owner.links.linkedin})`,
    owner.links.blog && `- ${ko ? '블로그' : 'Blog'}: [${owner.links.blog.replace(/^https?:\/\//, '')}](${owner.links.blog})`,
    owner.links.website && `- ${ko ? '웹사이트' : 'Website'}: [${owner.links.website.replace(/^https?:\/\//, '')}](${owner.links.website})`,
  ].filter(Boolean);
  const bioFirst = L(owner.bio).split(/\n{2,}/)[0];

  const welcome: MailMessage = {
    id: 'welcome',
    seed: true,
    mailbox: 'inbox',
    from,
    to,
    date: seededAt - 3 * MIN,
    subject: ko ? '환영합니다 👋' : 'Welcome 👋',
    read: false,
    flagged: false,
    extra: 'welcome',
    body: ko
      ? `안녕하세요.\n\n**제 포트폴리오 사이트**에 방문해 주셔서 감사합니다. ${bioFirst}\n\n이곳은 일반적인 포트폴리오 사이트가 아니라 브라우저에서 동작하는 작은 운영체제입니다. 다음과 같이 둘러볼 수 있습니다.\n\n- **Dock**에서 앱을 실행하고, 창을 화면 가장자리로 끌어 붙일 수 있습니다.\n- **Finder**에서 만들거나 지운 파일은 **터미널**에도 그대로 반영됩니다. (\`ls ~/Documents\`)\n- **⌘K**로 Spotlight를 열어 무엇이든 검색할 수 있습니다.\n- 메뉴 막대와 키보드 단축키도 실제처럼 동작합니다.\n\n아래 버튼으로 바로 시작할 수 있습니다.${sign}`
      : `Hi there!\n\nThanks for stopping by **my portfolio site**. ${bioFirst}\n\nThis isn’t a regular portfolio site. It’s a tiny operating system running in your browser. Here’s how to explore:\n\n- Launch apps from the **Dock**, then drag windows to the screen edges to snap them.\n- Create or delete files in **Finder** and watch them show up in the **Terminal** (\`ls ~/Documents\`).\n- Press **⌘K** to open Spotlight and search for anything.\n- The menu bar and keyboard shortcuts work like the real thing.\n\nThe buttons below are a good place to start.${sign}`,
  };

  const projectsMsg: MailMessage = {
    id: 'projects',
    seed: true,
    mailbox: 'inbox',
    from,
    to,
    date: seededAt - 47 * MIN,
    subject: ko ? '제 주요 프로젝트를 소개합니다' : 'My featured projects',
    read: false,
    flagged: false,
    extra: 'projects',
    body: ko
      ? `대표 작업을 소개합니다.\n\n${showcase.map((p) => `- **${p.name}** (${p.year}): ${L(p.tagline)}`).join('\n')}\n\n카드를 누르면 **프로젝트** 앱에서 자세한 내용을 볼 수 있습니다. 소개 문서는 Finder의 \`~/Documents/Projects\`에도 있습니다.${sign}`
      : `Here’s the work I’m proudest of:\n\n${showcase.map((p) => `- **${p.name}** (${p.year}): ${L(p.tagline)}`).join('\n')}\n\nClick a card to see the details in the **Projects** app. The write-ups also live in Finder under \`~/Documents/Projects\`.${sign}`,
  };

  const contact: MailMessage = {
    id: 'contact',
    seed: true,
    mailbox: 'inbox',
    from,
    to,
    date: seededAt - (2 * DAY + 5 * HOUR),
    subject: ko ? '함께 일하기' : 'Let’s work together',
    read: false,
    flagged: true,
    extra: 'contact',
    body: ko
      ? `채용 제안, 협업, 개발 이야기 모두 환영합니다. 편하게 연락 주세요.\n\n- 이메일: [${owner.email}](mailto:${owner.email})\n${links.join('\n')}\n\n이 메시지에 **답장**하면 메일 창이 열리고, 보내기를 누르면 사용하시는 메일 앱으로 넘어갑니다.${sign}`
      : `Whether it’s a role, a collaboration, or just a chat about building software, my inbox is open.\n\n- Email: [${owner.email}](mailto:${owner.email})\n${links.join('\n')}\n\n**Reply** to this message to start writing; when you hit Send, it’s handed off to your own mail app.${sign}`,
  };

  const system: MailMessage = {
    id: 'system',
    seed: true,
    mailbox: 'inbox',
    from: { name: ko ? `${osInfo.name} 팀` : `${osInfo.name} Team`, email: SYSTEM_ADDRESS },
    to,
    date: seededAt - (4 * DAY + 3 * HOUR),
    subject: ko ? `${osInfo.name} 설정이 완료되었습니다 ✨` : `Your ${osInfo.name} is ready ✨`,
    read: false,
    flagged: false,
    extra: 'system',
    body: ko
      ? `**${L(osInfo.machine)}**을(를) 선택해 주셔서 감사합니다.\n\n| 항목 | 사양 |\n| --- | --- |\n| 칩 | ${osInfo.chip} |\n| 메모리 | ${osInfo.memory} |\n| 버전 | ${osInfo.name} ${osInfo.version} (${osInfo.build}) |\n\n**알아 두면 좋은 단축키**\n\n- ⌥W 윈도우 닫기 · ⌥Q 앱 종료 · ⌥M 최소화\n- ⌘K Spotlight · F3 Mission Control · F4 Launchpad\n- ⌃⌥←/→ 윈도우를 화면 절반으로\n\n재미있는 사실: 이 메일은 \`src/data/portfolio.ts\`에서 자동으로 만들어졌어요. 터미널에서 \`sudo\`를 입력해 보면… 아니, 하지 마세요. 🙃\n\n— ${osInfo.name} 팀`
      : `Thank you for choosing **${L(osInfo.machine)}**.\n\n| | |\n| --- | --- |\n| Chip | ${osInfo.chip} |\n| Memory | ${osInfo.memory} |\n| Version | ${osInfo.name} ${osInfo.version} (${osInfo.build}) |\n\n**Shortcuts worth knowing**\n\n- ⌥W close window · ⌥Q quit app · ⌥M minimize\n- ⌘K Spotlight · F3 Mission Control · F4 Launchpad\n- ⌃⌥←/→ tile a window to half the screen\n\nFun fact: this email was generated from \`src/data/portfolio.ts\`. Try typing \`sudo\` in the Terminal… actually, maybe don’t. 🙃\n\n— The ${osInfo.name} Team`,
  };

  return [welcome, projectsMsg, contact, system];
}

/**
 * Mail's reading view for one message: header (avatar, sender, date, recipients), markdown
 * body, the extra actions seeded messages carry (project cards, quick links).
 */
import { useState } from 'react';
import { ArrowRight, Copy, Flag, Keyboard, Monitor, PenLine, Reply, Terminal, User, FolderOpen, Globe } from 'lucide-react';
import { owner, projects } from '@/data/portfolio';
import { Button } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { OSLogo } from '@/icons';
import { formatDate, fs, showContextMenu, useLocale, useNode, useSystem, useT, wm, type LString } from '@/kernel';
import { GitHubMark, LinkedInMark } from '@/apps/safari/brands';
import { openCompose } from './compose';
import { A, copyAddress, displayName, initialsOf, openLink, reply } from './actions';
import { SYSTEM_ADDRESS } from './seed';
import { formatAddresses } from './store';
import type { MailMessage } from './types';
import styles from './Mail.module.css';

const V = {
  noSubject: { en: '(No Subject)', ko: '(제목 없음)' },
  draft: { en: 'This message is a draft.', ko: '이 메시지는 임시 저장된 메시지입니다.' },
  edit: { en: 'Edit Draft', ko: '임시 저장 메시지 편집' },
  openProjects: { en: 'Open Projects', ko: '프로젝트 열기' },
  aboutMe: { en: 'About Me', ko: '내 소개' },
  projects: { en: 'Projects', ko: '프로젝트' },
  terminal: { en: 'Terminal', ko: '터미널' },
  portfolio: { en: 'Portfolio in Safari', ko: 'Safari에서 포트폴리오 보기' },
  reply: { en: 'Reply', ko: '답장' },
  copyEmail: { en: 'Copy Email Address', ko: '이메일 주소 복사' },
  newEmail: { en: 'New Email', ko: '새로운 이메일' },
  shortcuts: { en: 'Keyboard Shortcuts', ko: '키보드 단축키' },
  aboutComputer: { en: 'About This Computer', ko: '이 컴퓨터에 관하여' },
  cc: { en: 'Cc', ko: '참조' },
  flagged: { en: 'Flagged', ko: '깃발 표시됨' },
} satisfies Record<string, LString>; /** Localized strings used by the message view. */

/**
 * Derives a stable hue for a sender's avatar circle.
 *
 * Runs a small multiplicative string hash over `key` modulo 360, so the same sender always
 * gets the same tint.
 *
 * @param {string} key - Sender identifier (usually the email address).
 * @returns {number} A hue in degrees, from 0 to 359.
 *
 * @example
 * const tint = `hsl(${avatarHue('ann@x.com')} 18% 66%)`;
 */
function avatarHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) % 360;
  return h;
}

/**
 * Round sender avatar shown in the message header.
 *
 * Messages from the system address show the OS logo on a dark disc. Messages from the owner,
 * who is the logged-in user, show the account picture from System Settings (falling back to
 * `owner.avatar`; a VFS path is resolved to a file URL), like a contact card in Mail. Everyone
 * else, and the owner when the picture fails to load, gets their initials on a tint derived
 * from their address.
 *
 * @param {Object} props - Component props.
 * @param {MailMessage['from']} props.from - The sender's address.
 * @param {number} [props.size=40] - Diameter in pixels; the font and logo scale with it.
 * @returns {JSX.Element} The avatar element (hidden from assistive technology).
 *
 * @example
 * <Avatar from={message.from} size={32} />
 */
export function Avatar({ from, size = 40 }: { from: MailMessage['from']; size?: number }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const account = useSystem((s) => s.settings.avatar) || owner.avatar;
  const accountNode = useNode(account.startsWith('/') ? account : null);
  const accountSrc = accountNode?.type === 'file' ? fs.getURL(accountNode.path) : account;
  const system = from.email === SYSTEM_ADDRESS;
  const photo = !system && !photoFailed && !!accountSrc && !!owner.email && from.email === owner.email ? accountSrc : null;
  const hue = avatarHue(from.email || from.name || 'me');
  return (
    <div
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.38, background: system ? 'linear-gradient(160deg, #3a3a3c, #1c1c1e)' : `linear-gradient(160deg, hsl(${hue} 18% 66%), hsl(${hue} 14% 46%))` }}
      aria-hidden
    >
      {system ? <OSLogo size={size * 0.5} color="#fff" /> : photo ? <img src={photo} alt="" draggable={false} onError={() => setPhotoFailed(true)} /> : initialsOf(from)}
    </div>
  );
}

/**
 * Grid of project cards for the "featured projects" message.
 *
 * Shows the projects marked `featured` in the portfolio data, or the first three projects when
 * none are featured. Clicking a card opens that project in the Projects app.
 *
 * @returns {JSX.Element} The card grid.
 *
 * @example
 * <ProjectCards />
 */
function ProjectCards() {
  const t = useT();
  const featured = projects.filter((p) => p.featured);
  const list = featured.length ? featured : projects.slice(0, 3);
  return (
    <div className={styles.projectCards}>
      {list.map((p) => (
        <button key={p.id} type="button" className={styles.projectCard} style={{ ['--c' as string]: p.color }} onClick={() => wm.launch('projects', { project: p.id })}>
          <span className={styles.projectCover}>
            <img src={p.cover} alt="" loading="lazy" />
          </span>
          <span className={styles.projectInfo}>
            <span className={styles.projectName}>
              {p.name} <span className={styles.projectYear}>{p.year}</span>
            </span>
            <span className={styles.projectTagline}>{t(p.tagline)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Extra actions rendered below the body of seeded messages.
 *
 * Chooses the content from `m.extra`: quick-launch buttons for the welcome message, project
 * cards for the projects message, reply/copy/social links for the contact message (GitHub and
 * LinkedIn only when the owner has those links), and shortcut/about buttons for the system
 * message. Other messages get nothing.
 *
 * @param {Object} props - Component props.
 * @param {MailMessage} props.m - The message being shown.
 * @returns {JSX.Element | null} The extra actions, or `null` when the message has none.
 *
 * @example
 * <Extras m={message} />
 */
function Extras({ m }: { m: MailMessage }) {
  const t = useT();
  switch (m.extra) {
    case 'welcome':
      return (
        <div className={styles.actions}>
          <Button onClick={() => wm.launch('about-me')}>
            <User size={13} /> {t(V.aboutMe)}
          </Button>
          <Button onClick={() => wm.launch('projects')}>
            <FolderOpen size={13} /> {t(V.projects)}
          </Button>
          <Button onClick={() => wm.launch('terminal')}>
            <Terminal size={13} /> {t(V.terminal)}
          </Button>
          <Button onClick={() => wm.openWindow('safari', { url: 'webos://portfolio' })}>
            <Globe size={13} /> {t(V.portfolio)}
          </Button>
        </div>
      );
    case 'projects':
      return (
        <>
          <ProjectCards />
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => wm.launch('projects')}>
              {t(V.openProjects)} <ArrowRight size={13} />
            </Button>
          </div>
        </>
      );
    case 'contact':
      return (
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => reply(m)}>
            <Reply size={13} /> {t(V.reply)}
          </Button>
          <Button onClick={() => copyAddress()}>
            <Copy size={13} /> {t(V.copyEmail)}
          </Button>
          {owner.links.github && (
            <Button onClick={() => openLink(owner.links.github)}>
              <GitHubMark size={13} /> GitHub
            </Button>
          )}
          {owner.links.linkedin && (
            <Button onClick={() => openLink(owner.links.linkedin)}>
              <LinkedInMark size={13} /> LinkedIn
            </Button>
          )}
        </div>
      );
    case 'system':
      return (
        <div className={styles.actions}>
          <Button onClick={() => wm.openWindow('welcome', { page: 'shortcuts' })}>
            <Keyboard size={13} /> {t(V.shortcuts)}
          </Button>
          <Button onClick={() => wm.launch('about-this-mac')}>
            <Monitor size={13} /> {t(V.aboutComputer)}
          </Button>
        </div>
      );
    default:
      return null;
  }
}

/**
 * Full reading view of a single message.
 *
 * Renders the header (avatar, sender, date, subject, recipients, flag), a draft bar with an
 * Edit Draft button for messages in Drafts, the markdown body (links open in Compose or
 * Safari), and the seeded extras. Clicking or right-clicking the sender
 * opens a menu to write to or copy their address.
 *
 * @param {Object} props - Component props.
 * @param {MailMessage} props.message - The message to show.
 * @returns {JSX.Element} The message article.
 *
 * @example
 * <MessageView message={selected} />
 */
export function MessageView({ message: m }: { message: MailMessage }) {
  const t = useT();
  const locale = useLocale();

  /**
   * Shows the sender's context menu at the pointer.
   *
   * Offers New Email (a compose window addressed to the sender) and Copy Email Address. Does
   * nothing when the sender has no email address.
   *
   * @param {React.MouseEvent} e - The click or contextmenu event that positions the menu.
   * @returns {void} Nothing.
   *
   * @example
   * <button onClick={senderMenu} onContextMenu={senderMenu}>Ann</button>
   */
  const senderMenu = (e: React.MouseEvent) => {
    if (!m.from.email) return;
    showContextMenu(e, [
      { label: V.newEmail, action: () => openCompose({ to: m.from.email }) },
      { label: V.copyEmail, action: () => copyAddress(m.from.email) },
    ]);
  };

  return (
    <article className={styles.message}>
      <header className={styles.msgHeader}>
        <Avatar from={m.from} />
        <div className={styles.msgMeta}>
          <div className={styles.msgFromRow}>
            <button type="button" className={styles.msgFrom} title={m.from.email} onClick={senderMenu} onContextMenu={senderMenu}>
              {displayName(m.from)}
            </button>
            <time className={styles.msgDate} dateTime={new Date(m.date).toISOString()}>
              {formatDate(m.date, locale, { dateStyle: 'medium', timeStyle: 'short' })}
            </time>
          </div>
          <div className={styles.msgSubject}>{m.subject || t(V.noSubject)}</div>
          <div className={styles.msgTo}>
            {t(A.to)}: {m.to.length ? m.to.map(displayName).join(', ') : '—'}
            {m.cc ? ` · ${t(V.cc)}: ${m.cc}` : ''}
          </div>
        </div>
        {m.flagged && <Flag size={14} className={styles.msgFlag} fill="currentColor" aria-label={t(V.flagged)} />}
      </header>

      {m.mailbox === 'drafts' && (
        <div className={styles.draftBar}>
          <span>{t(V.draft)}</span>
          <Button onClick={() => openCompose({ to: formatAddresses(m.to), subject: m.subject, body: m.body, draftId: m.id })}>
            <PenLine size={12} /> {t(V.edit)}
          </Button>
        </div>
      )}

      <div className={`${styles.msgBody} selectable`}>
        <Markdown source={m.body} onLinkClick={openLink} />
      </div>

      <Extras m={m} />

    </article>
  );
}

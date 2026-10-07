/**
 * Message-level actions shared by the viewer, the standalone message window and menus.
 */
import { owner } from '@/data/portfolio';
import { dialogs, formatDate, notify, t, useSystem, wm, type LString } from '@/kernel';
import { openCompose, parseMailto } from './compose';
import { ME, formatAddresses, useMail } from './store';
import type { Address, MailMessage } from './types';

export const A = {
  me: { en: 'Me', ko: '나' },
  wrote: { en: 'On {date}, {name} wrote:', ko: '{date}에 {name}님이 작성:' },
  forwarded: { en: 'Begin forwarded message:', ko: '전달된 메시지 시작:' },
  from: { en: 'From', ko: '보낸 사람' },
  to: { en: 'To', ko: '받는 사람' },
  subject: { en: 'Subject', ko: '제목' },
  date: { en: 'Date', ko: '날짜' },
  copied: { en: 'Email address copied', ko: '이메일 주소가 복사됨' },
  eraseTitle: { en: 'Are you sure you want to permanently erase the deleted messages in Trash?', ko: '휴지통에 있는 삭제된 메시지를 영구적으로 지우겠습니까?' },
  eraseOne: { en: 'Are you sure you want to permanently delete this message?', ko: '이 메시지를 영구적으로 삭제하겠습니까?' },
  eraseMsg: { en: 'You can’t undo this action.', ko: '이 동작은 실행 취소할 수 없습니다.' },
  erase: { en: 'Erase', ko: '지우기' },
  delete: { en: 'Delete', ko: '삭제' },
} satisfies Record<string, LString>; /** Localized strings for message actions, quoted headers and confirmation dialogs. */

/**
 * Returns the name to show for an address.
 *
 * Uses the name when present, otherwise the email. An address with neither (the visitor)
 * is shown as the localized "Me".
 *
 * @param {Address} a - The address to display.
 * @returns {string} The display name.
 *
 * @example
 * displayName({ name: '', email: 'bob@y.com' }); // 'bob@y.com'
 * displayName(ME); // 'Me'
 */
export function displayName(a: Address): string {
  if (!a.name && !a.email) return t(A.me);
  return a.name || a.email;
}

/**
 * Computes the avatar initials for an address.
 *
 * Takes the display name, replaces everything except letters, digits and whitespace with
 * spaces, then uses the first letters of the first and last words, or the first two
 * characters of a single word, uppercased.
 *
 * @param {Address} a - The address to compute initials for.
 * @returns {string} One or two uppercase characters, or "?" when the name has no letters or digits.
 *
 * @example
 * initialsOf({ name: 'Ann Lee', email: '' }); // 'AL'
 * initialsOf({ name: 'Ann', email: 'ann@x.com' }); // 'AN'
 */
export function initialsOf(a: Address): string {
  const name = displayName(a);
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
}

/**
 * Fills `{name}` placeholders in a template string.
 *
 * Placeholders without a matching entry in `vars` are replaced with an empty string.
 *
 * @param {string} s - The template text.
 * @param {Record<string, string>} vars - Placeholder values keyed by name.
 * @returns {string} The template with every placeholder substituted.
 *
 * @example
 * fmtVars('On {date}, {name} wrote:', { date: 'May 1', name: 'Ann' }); // 'On May 1, Ann wrote:'
 */
const fmtVars = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/**
 * Quotes a message body for a reply.
 *
 * Splits the body on newlines and prefixes every line, including empty ones, with "> " so
 * the whole original renders as a Markdown blockquote.
 *
 * @param {string} body - The original Markdown body.
 * @returns {string} The quoted body.
 *
 * @example
 * quote('Hi\nThere'); // '> Hi\n> There'
 */
const quote = (body: string) =>
  body
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

/**
 * Reads the current UI locale from the system settings store.
 *
 * Reads the store state directly instead of subscribing, so it can be used in plain
 * (non-React) action functions and always returns the locale at call time.
 *
 * @returns {Locale} The active locale.
 *
 * @example
 * formatDate(Date.now(), locale());
 */
const locale = () => useSystem.getState().settings.locale;

/**
 * Opens a compose window replying to a message.
 *
 * Addresses the reply to the sender, or, when the message was written by the visitor, back
 * to its original recipients. The subject gets a "Re: " prefix unless it already has one, and
 * the body starts with an "On {date}, {name} wrote:" header followed by the quoted original.
 *
 * @param {MailMessage} m - The message to reply to.
 * @returns {void}
 *
 * @example
 * reply(selectedMessage);
 */
export function reply(m: MailMessage): void {
  const to = m.from.email === ME.email && m.from.name === ME.name ? formatAddresses(m.to) : m.from.email;
  const header = fmtVars(t(A.wrote), { date: formatDate(m.date, locale()), name: displayName(m.from) });
  openCompose({ to, subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, body: `\n\n${header}\n\n${quote(m.body)}\n` });
}

/**
 * Opens a compose window forwarding a message.
 *
 * Leaves the recipient empty, adds a "Fwd: " prefix to the subject unless it already starts
 * with "Fwd:" or "Fw:", and puts a localized forwarded-message header (From, Subject, Date,
 * To) above the original body.
 *
 * @param {MailMessage} m - The message to forward.
 * @returns {void}
 *
 * @example
 * forward(selectedMessage);
 */
export function forward(m: MailMessage): void {
  const lines = [
    t(A.forwarded),
    '',
    `${t(A.from)}: ${displayName(m.from)}${m.from.email ? ` <${m.from.email}>` : ''}`,
    `${t(A.subject)}: ${m.subject}`,
    `${t(A.date)}: ${formatDate(m.date, locale())}`,
    `${t(A.to)}: ${m.to.map(displayName).join(', ')}`,
    '',
    m.body,
  ];
  openCompose({ to: '', subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`, body: `\n\n${lines.join('\n')}\n` });
}

/**
 * Copies an email address to the host clipboard.
 *
 * Shows a Mail notification once the copy succeeds. Clipboard failures, or a missing
 * Clipboard API, are silently ignored.
 *
 * @param {string} [email=owner.email] - The address to copy.
 * @returns {void}
 *
 * @example
 * copyAddress('ann@x.com');
 */
export function copyAddress(email: string = owner.email): void {
  void navigator.clipboard
    ?.writeText(email)
    .then(() => notify({ appId: 'mail', title: A.copied, body: email }))
    .catch(() => {});
}

/**
 * Opens a link clicked inside a message.
 *
 * mailto: links open a prefilled compose window; http(s): and webos: links open in Safari.
 * Any other scheme is ignored.
 *
 * @param {string} href - The link target.
 * @returns {void}
 *
 * @example
 * openLink('mailto:ann@x.com?subject=Hi');
 * openLink('https://example.com');
 */
export function openLink(href: string): void {
  if (href.startsWith('mailto:')) openCompose(parseMailto(href));
  else if (/^(https?:|webos:)/i.test(href)) wm.openWindow('safari', { url: href });
}

/**
 * Deletes a message the way Mail's Delete command does.
 *
 * A message outside the Trash is moved to the Trash immediately. A message already in the
 * Trash is permanently erased only after the visitor confirms in a destructive dialog.
 *
 * @async
 * @param {MailMessage} m - The message to delete.
 * @param {string} [windowId] - Window to attach the confirmation sheet to.
 * @returns {Promise<boolean>} True if the message left its mailbox, false if erasing was cancelled.
 *
 * @example
 * if (await deleteMessage(message, windowId)) wm.close(windowId);
 */
export async function deleteMessage(m: MailMessage, windowId?: string): Promise<boolean> {
  if (m.mailbox !== 'trash') {
    useMail.getState().trash(m.id);
    return true;
  }
  const ok = await dialogs.confirm({ windowId, appId: 'mail', title: A.eraseOne, message: A.eraseMsg, okLabel: A.delete, danger: true });
  if (ok) useMail.getState().erase(m.id);
  return ok;
}

/**
 * Permanently erases every message in the Trash after confirmation.
 *
 * Shows a destructive confirmation dialog and empties the Trash in the store only if the
 * visitor confirms.
 *
 * @async
 * @param {string} [windowId] - Window to attach the confirmation sheet to.
 * @returns {Promise<void>} Resolves once the dialog is answered.
 *
 * @example
 * void eraseTrash(windowId);
 */
export async function eraseTrash(windowId?: string): Promise<void> {
  const ok = await dialogs.confirm({ windowId, appId: 'mail', title: A.eraseTitle, message: A.eraseMsg, okLabel: A.erase, danger: true });
  if (ok) useMail.getState().eraseTrash();
}

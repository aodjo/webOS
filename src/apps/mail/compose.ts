/**
 * Entry point for opening a Mail compose window from anywhere (Safari "Email This Page",
 * the portfolio page, mailto: links…). It has no UI imports so callers stay light.
 */
import { owner } from '@/data/portfolio';
import { t, wm } from '@/kernel';

export const NEW_MESSAGE = { en: 'New Message', ko: '새로운 메시지' }; /** Default title of a compose window whose subject is empty. */

export const COMPOSE_WINDOW = { width: 640, height: 520, minWidth: 420, minHeight: 320 } as const; /** Size and minimum size of a compose window (smaller than the viewer). */

/** Arguments accepted by a compose window. */
export interface ComposeArgs {
  /** Recipient field text; defaults to the owner's email address. */
  to?: string;
  subject?: string;
  /** Initial body text in Markdown. */
  body?: string;
  /** Id of an existing draft to continue editing. */
  draftId?: string;
}

/**
 * Opens a new Mail compose window.
 *
 * Launches the Mail app (if needed) with `compose: true` window args so the app renders its
 * compose view. The recipient defaults to the portfolio owner's email address, and the window
 * title is the trimmed subject or the localized "New Message".
 *
 * @param {ComposeArgs} [args={}] - Initial recipient, subject, body and optional draft id.
 * @returns {string | null} The id of the opened window, or null if the window could not be opened.
 *
 * @example
 * openCompose({ subject: 'Hello', body: 'Nice portfolio!' });
 * openCompose(); // Blank message addressed to the owner
 */
export function openCompose(args: ComposeArgs = {}): string | null {
  const to = args.to ?? owner.email;
  return wm.openWindow('mail', { compose: true, ...args, to }, { ...COMPOSE_WINDOW, title: args.subject?.trim() || t(NEW_MESSAGE) });
}

/**
 * Converts a mailto: URL into compose window arguments.
 *
 * Parses the URL with the URL constructor, taking the decoded pathname as the recipient and
 * the `subject` / `body` query parameters as-is. Missing parts become undefined, and an
 * unparsable URL yields an empty object instead of throwing.
 *
 * @param {string} href - A mailto: URL such as `mailto:a@b.co?subject=Hi`.
 * @returns {ComposeArgs} The extracted recipient, subject and body.
 *
 * @example
 * parseMailto('mailto:ann@x.com?subject=Hi');
 * // { to: 'ann@x.com', subject: 'Hi', body: undefined }
 */
export function parseMailto(href: string): ComposeArgs {
  try {
    const u = new URL(href);
    return { to: decodeURIComponent(u.pathname) || undefined, subject: u.searchParams.get('subject') ?? undefined, body: u.searchParams.get('body') ?? undefined };
  } catch {
    return {};
  }
}

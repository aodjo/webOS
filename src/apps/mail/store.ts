/**
 * Mail state, persisted in localStorage ('webos.mail').
 *
 * Seeded messages are regenerated from portfolio data in the current language; only their
 * per-message state (read / flagged / mailbox) is stored. Messages the visitor writes (Sent,
 * Drafts) are stored in full.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setDockBadge, useLocale, useWM } from '@/kernel';
import { SEED_DEFAULTS, SEED_IDS, buildSeedMessages, type SeedId } from './seed';
import type { Address, MailboxId, MailMessage } from './types';

/** Stored state of one seeded message; unset fields fall back to the seed defaults. */
interface SeedState {
  read?: boolean;
  flagged?: boolean;
  /** Current mailbox; 'deleted' means the message was erased from the Trash. */
  mailbox?: MailboxId | 'deleted';
  trashedFrom?: MailboxId;
}

/** Message fields that can be changed after a message exists. */
type Patch = Partial<Pick<MailMessage, 'read' | 'flagged' | 'mailbox' | 'trashedFrom'>>;

/** Contents of the compose form, as typed by the visitor. */
export interface OutgoingMessage {
  /** Comma- or semicolon-separated recipient list. */
  to: string;
  cc?: string;
  subject: string;
  body: string;
}

/** Shape of the Mail store: persisted data plus the actions that mutate it. */
interface MailState {
  /** When this visitor first opened Mail; seeded messages are dated relative to it. */
  seededAt: number;
  /** Per-message state of the seeded messages, keyed by seed id. */
  seed: Partial<Record<SeedId, SeedState>>;
  /** Messages written by the visitor (sent and drafts), stored in full. */
  messages: MailMessage[];
  /** Timestamp of the last "Get Mail", or 0 if never checked. */
  lastChecked: number;
  /** Merges a patch into a message's state. */
  update: (id: string, patch: Patch) => void;
  /** Moves a message to the Trash, remembering where it came from. */
  trash: (id: string) => void;
  /** Permanently deletes a message. */
  erase: (id: string) => void;
  /** Permanently deletes every message in the Trash. */
  eraseTrash: () => void;
  /** Creates or updates a draft and returns its id. */
  saveDraft: (msg: OutgoingMessage, draftId?: string) => string;
  /** Files a sent message (dropping the draft it came from) and returns its id. */
  send: (msg: OutgoingMessage, draftId?: string) => string;
  /** Records the current time as the last mail check. */
  markChecked: () => void;
}

export const ME: Address = { name: '', email: '' }; /** The visitor's address; its empty name and email render as "Me". */

/**
 * Checks whether a message id belongs to a seeded message.
 *
 * Acts as a type guard so callers can index the `seed` state map with the narrowed id.
 *
 * @param {string} id - The message id to test.
 * @returns {id is SeedId} True if `id` is one of `SEED_IDS`.
 *
 * @example
 * isSeed('welcome'); // true
 * isSeed('mabc123'); // false
 */
const isSeed = (id: string): id is SeedId => (SEED_IDS as readonly string[]).includes(id);

/**
 * Generates a new id for a visitor-written message.
 *
 * Combines an "m" prefix, the current time in base 36 and four random base-36 characters,
 * which keeps ids unique and distinct from the seed ids.
 *
 * @returns {string} A new message id.
 *
 * @example
 * newId(); // e.g. 'mlx3k2f9a1b2'
 */
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Parses a recipient field into a list of addresses.
 *
 * Splits the text on commas and semicolons, drops empty parts, and recognizes the
 * `Name <email>` form (with optional quotes around the name). Any other part is taken
 * as a bare email address with an empty name; no validation is performed.
 *
 * @param {string} text - Recipient field text, e.g. `"Ann <ann@x.com>, bob@y.com"`.
 * @returns {Address[]} The parsed addresses in their original order.
 *
 * @example
 * parseAddresses('Ann <ann@x.com>; bob@y.com');
 * // [{ name: 'Ann', email: 'ann@x.com' }, { name: '', email: 'bob@y.com' }]
 */
export function parseAddresses(text: string): Address[] {
  return text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(part);
      return m ? { name: m[1].replace(/^"|"$/g, '').trim(), email: m[2].trim() } : { name: '', email: part };
    });
}

/**
 * Formats a list of addresses as recipient field text.
 *
 * Addresses with both a name and an email become `Name <email>`; otherwise whichever part is
 * present is used. Entries are joined with ", ", so the result round-trips through
 * `parseAddresses`.
 *
 * @param {Address[]} list - The addresses to format.
 * @returns {string} The comma-separated address list.
 *
 * @example
 * formatAddresses([{ name: 'Ann', email: 'ann@x.com' }, { name: '', email: 'bob@y.com' }]);
 * // 'Ann <ann@x.com>, bob@y.com'
 */
export const formatAddresses = (list: Address[]) => list.map((a) => (a.name && a.email ? `${a.name} <${a.email}>` : a.email || a.name)).join(', ');

/**
 * Checks whether a string looks like a single email address.
 *
 * Requires a local part, an "@", and a domain containing a dot, with no whitespace or
 * address-list punctuation (`<>(),;:"`) anywhere.
 *
 * @param {string} email - The address to validate.
 * @returns {boolean} True if the address is well formed.
 *
 * @example
 * isValidEmail('hello@example.com'); // true
 * isValidEmail('nope@'); // false
 */
export const isValidEmail = (email: string) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(email);

export const useMail = create<MailState>()(
  persist(
    (set) => ({
      seededAt: Date.now(),
      seed: {},
      messages: [],
      lastChecked: 0,

      /**
       * Merges a patch into a message's state.
       *
       * For a seeded message the patch is stored in its `seed` entry; for a visitor message
       * the matching entry in `messages` is replaced with the patched copy. Unknown ids are
       * ignored.
       *
       * @param {string} id - Id of the message to update.
       * @param {Patch} patch - Fields to change (read, flagged, mailbox, trashedFrom).
       * @returns {void}
       *
       * @example
       * useMail.getState().update('welcome', { read: true });
       */
      update: (id, patch) =>
        set((s) => {
          if (isSeed(id)) return { seed: { ...s.seed, [id]: { ...s.seed[id], ...patch } } };
          return { messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
        }),

      /**
       * Moves a message to the Trash.
       *
       * Records the mailbox it came from in `trashedFrom` so it can be put back. Messages
       * already in the Trash (or erased seeded messages) are left unchanged.
       *
       * @param {string} id - Id of the message to trash.
       * @returns {void}
       *
       * @example
       * useMail.getState().trash('projects');
       */
      trash: (id) =>
        set((s) => {
          if (isSeed(id)) {
            const cur = s.seed[id]?.mailbox ?? 'inbox';
            if (cur === 'trash' || cur === 'deleted') return s;
            return { seed: { ...s.seed, [id]: { ...s.seed[id], mailbox: 'trash', trashedFrom: cur } } };
          }
          return { messages: s.messages.map((m) => (m.id === id && m.mailbox !== 'trash' ? { ...m, mailbox: 'trash', trashedFrom: m.mailbox } : m)) };
        }),

      /**
       * Permanently deletes a message.
       *
       * Seeded messages cannot be removed from the generated set, so they are marked with
       * the 'deleted' mailbox and filtered out by `useAllMessages`; visitor messages are
       * removed from `messages`.
       *
       * @param {string} id - Id of the message to erase.
       * @returns {void}
       *
       * @example
       * useMail.getState().erase('contact');
       */
      erase: (id) =>
        set((s) => {
          if (isSeed(id)) return { seed: { ...s.seed, [id]: { ...s.seed[id], mailbox: 'deleted' } } };
          return { messages: s.messages.filter((m) => m.id !== id) };
        }),

      /**
       * Permanently deletes every message in the Trash.
       *
       * Marks trashed seeded messages as 'deleted' and drops trashed visitor messages.
       *
       * @returns {void}
       *
       * @example
       * useMail.getState().eraseTrash();
       */
      eraseTrash: () =>
        set((s) => {
          const seed = { ...s.seed };
          for (const id of SEED_IDS) if (seed[id]?.mailbox === 'trash') seed[id] = { ...seed[id], mailbox: 'deleted' };
          return { seed, messages: s.messages.filter((m) => m.mailbox !== 'trash') };
        }),

      /**
       * Creates or updates a draft.
       *
       * Builds a read, unflagged message in the Drafts mailbox from the compose form,
       * timestamped now. When `draftId` is given the existing draft with that id is replaced;
       * otherwise a new id is generated. The draft is appended after the other messages.
       *
       * @param {OutgoingMessage} msg - The compose form contents.
       * @param {string} [draftId] - Id of the draft to overwrite.
       * @returns {string} The draft's id.
       *
       * @example
       * const id = useMail.getState().saveDraft({ to: 'a@b.co', subject: 'Hi', body: 'Hello' });
       * useMail.getState().saveDraft({ to: 'a@b.co', subject: 'Hi!', body: 'Hello' }, id);
       */
      saveDraft: (msg, draftId) => {
        const id = draftId ?? newId();
        const draft: MailMessage = { id, mailbox: 'drafts', from: ME, to: parseAddresses(msg.to), cc: msg.cc, subject: msg.subject, body: msg.body, date: Date.now(), read: true, flagged: false };
        set((s) => ({ messages: [...s.messages.filter((m) => m.id !== id), draft] }));
        return id;
      },

      /**
       * Files a message in the Sent mailbox.
       *
       * Creates a new read, unflagged message from the compose form with a fresh id and the
       * current time, and removes the draft it was written from, if any. Nothing is actually
       * delivered; handing the message to a real mail client is up to the caller.
       *
       * @param {OutgoingMessage} msg - The compose form contents.
       * @param {string} [draftId] - Id of the draft being sent, which is removed.
       * @returns {string} The id of the sent message.
       *
       * @example
       * useMail.getState().send({ to: 'a@b.co', subject: 'Hi', body: 'Hello' }, draftId);
       */
      send: (msg, draftId) => {
        const id = newId();
        const sent: MailMessage = { id, mailbox: 'sent', from: ME, to: parseAddresses(msg.to), cc: msg.cc, subject: msg.subject, body: msg.body, date: Date.now(), read: true, flagged: false };
        set((s) => ({ messages: [...s.messages.filter((m) => m.id !== draftId), sent] }));
        return id;
      },

      /**
       * Records the current time as the last mail check.
       *
       * Sets `lastChecked` to `Date.now()`; the viewer sidebar uses it to show when mail was
       * last updated.
       *
       * @returns {void}
       *
       * @example
       * useMail.getState().markChecked();
       */
      markChecked: () => set({ lastChecked: Date.now() }),
    }),
    {
      name: 'webos.mail',
      version: 1,
      /**
       * Selects the part of the store that is persisted.
       *
       * Only data fields are written to localStorage; the action functions are recreated
       * on load.
       *
       * @param {MailState} s - The full store state.
       * @returns {Pick<MailState, 'seededAt' | 'seed' | 'messages' | 'lastChecked'>} The persisted fields.
       *
       * @example
       * partialize(useMail.getState()); // { seededAt, seed, messages, lastChecked }
       */
      partialize: (s) => ({ seededAt: s.seededAt, seed: s.seed, messages: s.messages, lastChecked: s.lastChecked }),
    },
  ),
); /** Zustand store holding all Mail state, persisted to localStorage under 'webos.mail'. */

/**
 * Returns every message (seeded and the visitor's), newest first.
 *
 * Regenerates the seeded messages from portfolio data in the current locale, overlays their
 * stored read / flagged / mailbox state, drops the ones erased from the Trash, then merges
 * in the visitor's messages and sorts by date descending. The result is memoized and
 * recomputed when the locale or the store data changes.
 *
 * @returns {MailMessage[]} All messages across every mailbox, sorted newest first.
 *
 * @example
 * const all = useAllMessages();
 * const inbox = all.filter((m) => m.mailbox === 'inbox');
 */
export function useAllMessages(): MailMessage[] {
  const locale = useLocale();
  const seededAt = useMail((s) => s.seededAt);
  const seed = useMail((s) => s.seed);
  const messages = useMail((s) => s.messages);
  return useMemo(() => {
    const seeded = buildSeedMessages(locale, seededAt, ME).flatMap((m): MailMessage[] => {
      const st = seed[m.id as SeedId];
      if (st?.mailbox === 'deleted') return [];
      return [{ ...m, read: st?.read ?? m.read, flagged: st?.flagged ?? m.flagged, mailbox: st?.mailbox ?? m.mailbox, trashedFrom: st?.trashedFrom }];
    });
    return [...seeded, ...messages].sort((a, b) => b.date - a.date);
  }, [locale, seededAt, seed, messages]);
}

/**
 * Counts the unread messages in the Inbox.
 *
 * Works directly on the stored state without generating the seeded messages: seeded
 * messages fall back to the Inbox and to their `SEED_DEFAULTS` read state when nothing is
 * stored for them.
 *
 * @param {Pick<MailState, 'seed' | 'messages'>} s - The Mail store state.
 * @returns {number} The number of unread Inbox messages.
 *
 * @example
 * const unread = unreadInboxCount(useMail.getState());
 */
export function unreadInboxCount(s: Pick<MailState, 'seed' | 'messages'>): number {
  let n = 0;
  for (const id of SEED_IDS) {
    const st = s.seed[id];
    if ((st?.mailbox ?? 'inbox') === 'inbox' && !(st?.read ?? SEED_DEFAULTS[id].read)) n++;
  }
  for (const m of s.messages) if (m.mailbox === 'inbox' && !m.read) n++;
  return n;
}

let shownBadge = -1; /** Unread count currently shown on the Mail Dock badge (-1 before the first sync). */

/**
 * Updates the Mail Dock badge with the unread Inbox count.
 *
 * Like macOS, the badge is shown only while the Mail process is running and is cleared when
 * the count is zero. It runs on every window-manager and Mail store change (subscribed once
 * when this module loads; the module lives for the whole session, so the subscriptions are
 * never removed) and skips the Dock update when the count is unchanged.
 *
 * @returns {void}
 *
 * @example
 * useMail.subscribe(syncBadge);
 */
function syncBadge(): void {
  const running = useWM.getState().processes.some((p) => p.appId === 'mail');
  const n = running ? unreadInboxCount(useMail.getState()) : 0;
  if (n === shownBadge) return;
  shownBadge = n;
  setDockBadge('mail', n || null);
}

useWM.subscribe(syncBadge);
useMail.subscribe(syncBadge);
syncBadge();

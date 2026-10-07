/** A real mailbox a message can be stored in. */
export type MailboxId = 'inbox' | 'sent' | 'drafts' | 'trash';
/** Mailboxes shown in the sidebar; "flagged" is a smart mailbox computed from the `flagged` flag. */
export type MailboxView = MailboxId | 'flagged';

/** A sender or recipient. An address with an empty name and email denotes the visitor ("Me"). */
export interface Address {
  name: string;
  email: string;
}

/** A file attached to a message. */
export interface Attachment {
  /** File name shown in the attachment chip. */
  name: string;
  /** How the attachment is resolved: `resume` maps to the resume file in the virtual FS. */
  kind: 'resume';
}

/** A single mail message, either seeded from portfolio data or written by the visitor. */
export interface MailMessage {
  id: string;
  /** True for messages generated from portfolio data; their content is localized on the fly and only their state is stored. */
  seed?: boolean;
  /** Mailbox the message currently lives in. */
  mailbox: MailboxId;
  from: Address;
  to: Address[];
  /** Raw Cc field text as typed in the compose window. */
  cc?: string;
  subject: string;
  /** Message body in Markdown. */
  body: string;
  /** Timestamp in milliseconds since the epoch. */
  date: number;
  read: boolean;
  flagged: boolean;
  /** Extra interactive UI rendered under the body of seeded messages. */
  extra?: 'welcome' | 'projects' | 'contact' | 'system';
  attachments?: Attachment[];
  /** Mailbox a trashed message came from, used by "Put Back". */
  trashedFrom?: MailboxId;
}

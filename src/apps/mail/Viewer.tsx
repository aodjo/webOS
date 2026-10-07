/**
 * The main Mail window: mailboxes sidebar, message list and reading pane.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, File as FileIcon, Flag, Forward, Inbox, Mail as MailIcon, MailOpen, Paperclip, Reply, Send, SquarePen, Trash2 } from 'lucide-react';
import { IconButton, SearchField } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import { fmt, formatDate, showContextMenu, useAppMenus, useLocale, useT, useWindowKeydown, wm, type LString, type MenuItem } from '@/kernel';
import { openCompose } from './compose';
import { MessageView } from './MessageView';
import { copyAddress, deleteMessage, displayName, eraseTrash, forward, reply } from './actions';
import { formatAddresses, useAllMessages, useMail } from './store';
import type { MailboxView, MailMessage } from './types';
import styles from './Mail.module.css';

const V = {
  favorites: { en: 'Favorites', ko: '즐겨찾기' },
  inbox: { en: 'Inbox', ko: '받은 편지함' },
  flagged: { en: 'Flagged', ko: '깃발 표시' },
  sent: { en: 'Sent', ko: '보낸 편지함' },
  drafts: { en: 'Drafts', ko: '임시 보관함' },
  trash: { en: 'Trash', ko: '휴지통' },
  count: { en: '{n} messages', ko: '{n}개의 메시지' },
  countUnread: { en: '{n} messages, {u} unread', ko: '{n}개의 메시지, {u}개 읽지 않음' },
  noMessages: { en: 'No Messages', ko: '메시지 없음' },
  noResults: { en: 'No Results', ko: '결과 없음' },
  noSelection: { en: 'No Message Selected', ko: '선택된 메시지 없음' },
  search: { en: 'Search', ko: '검색' },
  getMail: { en: 'Get Mail', ko: '메일 받기' },
  compose: { en: 'Compose New Message', ko: '새로운 메시지 작성' },
  delete: { en: 'Delete', ko: '삭제' },
  reply: { en: 'Reply', ko: '답장' },
  forward: { en: 'Forward', ko: '전달' },
  flag: { en: 'Flag', ko: '깃발 표시' },
  unflag: { en: 'Unflag', ko: '깃발 표시 해제' },
  markRead: { en: 'Mark as Read', ko: '읽은 상태로 표시' },
  markUnread: { en: 'Mark as Unread', ko: '읽지 않은 상태로 표시' },
  putBack: { en: 'Put Back', ko: '되돌려 놓기' },
  moveTo: { en: 'Move to', ko: '다음으로 이동' },
  openInWindow: { en: 'Open in New Window', ko: '새로운 윈도우에서 열기' },
  copySender: { en: 'Copy Sender Address', ko: '보낸 사람 주소 복사' },
  eraseDeleted: { en: 'Erase Deleted Items…', ko: '삭제된 항목 지우기…' },
  updated: { en: 'Updated Just Now', ko: '방금 업데이트됨' },
  file: { en: 'File', ko: '파일' },
  view: { en: 'View', ko: '보기' },
  mailbox: { en: 'Mailbox', ko: '메일상자' },
  message: { en: 'Message', ko: '메시지' },
  newMessage: { en: 'New Message', ko: '새로운 메시지' },
  newViewer: { en: 'New Viewer Window', ko: '새로운 뷰어 윈도우' },
  closeWindow: { en: 'Close Window', ko: '윈도우 닫기' },
  showMailboxes: { en: 'Show Mailboxes', ko: '메일상자 보기' },
  hideMailboxes: { en: 'Hide Mailboxes', ko: '메일상자 가리기' },
  goTo: { en: 'Go to Favorite Mailbox', ko: '즐겨찾는 메일상자로 이동' },
  sendAgain: { en: 'Send Again', ko: '다시 보내기' },
  editDraft: { en: 'Edit Draft', ko: '임시 저장 메시지 편집' },
  yesterday: { en: 'Yesterday', ko: '어제' },
  updatedAt: { en: 'Updated {time}', ko: '{time}에 업데이트됨' },
  back: { en: 'Back', ko: '뒤로' },
} satisfies Record<string, LString>; /** Localized strings for the viewer and message windows (labels, menus, empty states). */

const MAILBOXES: { id: MailboxView; label: LString; icon: typeof Inbox }[] = [
  { id: 'inbox', label: V.inbox, icon: Inbox },
  { id: 'flagged', label: V.flagged, icon: Flag },
  { id: 'sent', label: V.sent, icon: Send },
  { id: 'drafts', label: V.drafts, icon: FileIcon },
  { id: 'trash', label: V.trash, icon: Trash2 },
]; /** Sidebar mailboxes in display order; the index also defines the mod+1…mod+5 "Go to" shortcuts. */

/**
 * Checks whether a message belongs in a sidebar mailbox.
 *
 * The "flagged" smart mailbox contains every flagged message that is not in the Trash; any
 * other view matches the message's `mailbox` field.
 *
 * @param {MailMessage} m - The message to test.
 * @param {MailboxView} box - The mailbox view.
 * @returns {boolean} True if the message is listed in that mailbox.
 *
 * @example
 * const inbox = all.filter((m) => inMailbox(m, 'inbox'));
 */
const inMailbox = (m: MailMessage, box: MailboxView) => (box === 'flagged' ? m.flagged && m.mailbox !== 'trash' : m.mailbox === box);

const MAIL_MIME = 'application/x-webos-mail'; /** DataTransfer type carrying a message id when a row is dragged onto a sidebar mailbox. */
const DROP_TARGETS = new Set<MailboxView>(['inbox', 'flagged', 'trash']); /** Sidebar mailboxes that accept dropped messages. */

/**
 * Moves a message to a sidebar mailbox (drag and drop or the "Move to" menu).
 *
 * Dropping on the Trash trashes the message, dropping on Flagged flags it in place, and
 * dropping on the Inbox moves it there and clears its `trashedFrom`. Other targets are
 * ignored.
 *
 * @param {string} id - Id of the message to move.
 * @param {MailboxView} to - The target mailbox.
 * @returns {void}
 *
 * @example
 * moveMessage('welcome', 'trash');
 */
function moveMessage(id: string, to: MailboxView): void {
  const store = useMail.getState();
  if (to === 'trash') store.trash(id);
  else if (to === 'flagged') store.update(id, { flagged: true });
  else if (to === 'inbox') store.update(id, { mailbox: 'inbox', trashedFrom: undefined });
}

/**
 * Builds the plain-text preview shown under a message row.
 *
 * Strips Markdown from the body: code blocks, images, link targets (keeping link text),
 * blockquote and list markers, table rows and formatting characters, then collapses all
 * whitespace into single spaces.
 *
 * @param {string} body - The Markdown message body.
 * @returns {string} A single-line plain-text version of the body.
 *
 * @example
 * preview('**Hi** [there](https://x.com)\n- one'); // 'Hi there one'
 */
function preview(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\|.*\|$/gm, ' ')
    .replace(/[#*_`|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats a message date for the message list, like Mail.
 *
 * Compares calendar days in local time: today shows the time, yesterday shows the given
 * "Yesterday" label, the last week shows the weekday name, and anything older shows a short
 * numeric date.
 *
 * @param {number} ts - The message timestamp in milliseconds.
 * @param {'en' | 'ko'} locale - The UI locale used for formatting.
 * @param {string} yesterday - The localized "Yesterday" label.
 * @returns {string} The formatted date.
 *
 * @example
 * listDate(m.date, 'en', 'Yesterday'); // e.g. '9:41 AM', 'Yesterday', 'Monday' or '1/2/25'
 */
function listDate(ts: number, locale: 'en' | 'ko', yesterday: string): string {
  const d = new Date(ts);
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return formatDate(ts, locale, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return yesterday;
  if (days < 7) return formatDate(ts, locale, { weekday: 'long' });
  return formatDate(ts, locale, { year: '2-digit', month: 'numeric', day: 'numeric' });
}

/**
 * The main Mail window: mailboxes sidebar, message list and reading pane.
 *
 * Shows the messages of the selected mailbox, filtered by the search query, and the
 * selected message in the reader. The window title follows the selected mailbox. It installs
 * the File / View / Mailbox / Message menus, handles unmodified keys (↑/↓ selects,
 * Backspace/Delete deletes, Enter opens in a new window; Backspace/Delete and Enter are
 * left alone while focus is on a button or link so they act on that control), supports
 * dragging rows onto the Inbox, Flagged and Trash mailboxes, and simulates "Get Mail" with
 * a short spinning delay before recording the check time. On narrow layouts the reader
 * replaces the list and a Back button returns to it.
 *
 * @param {Object} props - Component props.
 * @param {string} props.windowId - Id of the window hosting the viewer.
 * @returns {JSX.Element} The viewer window contents.
 *
 * @example
 * <Viewer windowId={windowId} />
 */
export function Viewer({ windowId }: { windowId: string }) {
  const t = useT();
  const locale = useLocale();
  const all = useAllMessages();
  const lastChecked = useMail((s) => s.lastChecked);
  const [box, setBox] = useState<MailboxView>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sidebar, setSidebar] = useState(true);
  const [listFocused, setListFocused] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dropBox, setDropBox] = useState<MailboxView | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<MailboxView, number> = { inbox: 0, flagged: 0, sent: 0, drafts: 0, trash: 0 };
    for (const m of all) {
      if (m.mailbox === 'inbox' && !m.read) c.inbox++;
      if (m.mailbox === 'drafts') c.drafts++;
      if (inMailbox(m, 'flagged')) c.flagged++;
    }
    return c;
  }, [all]);

  const inBox = useMemo(() => all.filter((m) => inMailbox(m, box)), [all, box]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inBox;
    return inBox.filter((m) => [m.subject, m.body, m.from.name, m.from.email, formatAddresses(m.to)].some((s) => s.toLowerCase().includes(q)));
  }, [inBox, query]);
  const unreadHere = inBox.filter((m) => !m.read).length;

  const selected = list.find((m) => m.id === selectedId) ?? null;
  const selectedIndex = selected ? list.indexOf(selected) : -1;

  const boxLabel = t(MAILBOXES.find((b) => b.id === box)!.label);
  useEffect(() => wm.setTitle(windowId, boxLabel), [windowId, boxLabel]);

  useEffect(() => {
    if (!checking) return;
    const id = setTimeout(() => {
      setChecking(false);
      useMail.getState().markChecked();
    }, 900);
    return () => clearTimeout(id);
  }, [checking]);

  /**
   * Switches to another mailbox.
   *
   * Clears the selection and the search query along with the change.
   *
   * @param {MailboxView} b - The mailbox to show.
   * @returns {void}
   *
   * @example
   * selectBox('trash');
   */
  const selectBox = (b: MailboxView) => {
    setBox(b);
    setSelectedId(null);
    setQuery('');
  };

  /**
   * Selects a message in the list.
   *
   * Selecting an unread message marks it read (like macOS); re-selecting the message that is
   * already selected does not, so "Mark as Unread" on the current message sticks. After the
   * next frame the row is scrolled into view, which keeps it visible during keyboard
   * navigation. Does nothing when `m` is undefined.
   *
   * @param {MailMessage | undefined} m - The message to select.
   * @returns {void}
   *
   * @example
   * select(list[0]);
   */
  const select = (m: MailMessage | undefined) => {
    if (!m) return;
    setSelectedId(m.id);
    if (!m.read && m.id !== selectedId) useMail.getState().update(m.id, { read: true });
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${m.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  /**
   * Deletes the selected message.
   *
   * Moves it to the Trash (or erases it after confirmation when it is already there) and,
   * once the deletion goes through, selects the next message in the list, or the previous
   * one if it was the last, like Mail. Does nothing without a selection.
   *
   * @returns {void}
   *
   * @example
   * <IconButton onClick={removeSelected} />
   */
  const removeSelected = () => {
    if (!selected) return;
    const next = list[selectedIndex + 1] ?? list[selectedIndex - 1];
    void deleteMessage(selected, windowId).then((ok) => ok && setSelectedId(next?.id ?? null));
  };

  /**
   * Leaves the reader and returns to the message list (phone-width layout).
   *
   * Clears the selection and, after the next frame, scrolls the row that was selected
   * into view.
   *
   * @returns {void}
   *
   * @example
   * <IconButton label="Back" onClick={backToList} />
   */
  const backToList = () => {
    const id = selectedId;
    setSelectedId(null);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  /**
   * Opens a message in its own window.
   *
   * Drafts reopen in a compose window bound to the draft so edits update it; any other
   * message opens in a standalone message window titled with its subject.
   *
   * @param {MailMessage} m - The message to open.
   * @returns {void}
   *
   * @example
   * openInWindow(selected);
   */
  const openInWindow = (m: MailMessage) => {
    if (m.mailbox === 'drafts') openCompose({ to: formatAddresses(m.to), subject: m.subject, body: m.body, draftId: m.id });
    else wm.openWindow('mail', { messageId: m.id }, { width: 720, height: 560, title: m.subject });
  };

  /**
   * Builds the menu items for acting on a message.
   *
   * Used both for the row context menu and the Message menu: reply, forward, toggle read and
   * flagged, Put Back (only for trashed messages), Move to, Delete, Open in New Window and
   * Copy Sender Address (disabled when the sender has no email).
   *
   * @param {MailMessage} m - The message the items act on.
   * @returns {MenuItem[]} The menu items, including separators.
   *
   * @example
   * showContextMenu(e, messageItems(m));
   */
  const messageItems = (m: MailMessage): MenuItem[] => [
    { label: V.reply, shortcut: 'mod+alt+r', action: () => reply(m) },
    { label: V.forward, shortcut: 'mod+shift+f', action: () => forward(m) },
    { separator: true },
    { label: m.read ? V.markUnread : V.markRead, shortcut: 'mod+shift+u', action: () => useMail.getState().update(m.id, { read: !m.read }) },
    { label: m.flagged ? V.unflag : V.flag, shortcut: 'mod+shift+l', action: () => useMail.getState().update(m.id, { flagged: !m.flagged }) },
    { separator: true },
    ...(m.mailbox === 'trash' ? [{ label: V.putBack, action: () => useMail.getState().update(m.id, { mailbox: m.trashedFrom ?? 'inbox', trashedFrom: undefined }) }] : []),
    {
      label: V.moveTo,
      submenu: [
        { label: V.inbox, disabled: m.mailbox === 'inbox', action: () => moveMessage(m.id, 'inbox') },
        { label: V.trash, disabled: m.mailbox === 'trash', action: () => moveMessage(m.id, 'trash') },
      ],
    },
    { label: V.delete, shortcut: 'mod+backspace', danger: m.mailbox === 'trash', action: () => void deleteMessage(m, windowId) },
    { separator: true },
    { label: V.openInWindow, action: () => openInWindow(m) },
    { label: V.copySender, disabled: !m.from.email, action: () => copyAddress(m.from.email) },
  ];

  useWindowKeydown((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onControl = (e.target as HTMLElement | null)?.closest?.('button, a, [role="button"]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = selectedIndex === -1 ? (e.key === 'ArrowDown' ? 0 : list.length - 1) : selectedIndex + (e.key === 'ArrowDown' ? 1 : -1);
      select(list[Math.max(0, Math.min(list.length - 1, i))]);
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && selected && !onControl) {
      e.preventDefault();
      removeSelected();
    } else if (e.key === 'Enter' && selected && !onControl) {
      e.preventDefault();
      openInWindow(selected);
    }
  });

  useAppMenus(
    () => [
      {
        label: V.file,
        items: [
          { label: V.newMessage, shortcut: 'alt+n', action: () => openCompose() },
          { label: V.newViewer, shortcut: 'alt+shift+n', action: () => void wm.openWindow('mail') },
          { separator: true },
          { label: V.closeWindow, shortcut: 'alt+w', action: () => void wm.close(windowId) },
        ],
      },
      {
        label: V.view,
        items: [{ label: sidebar ? V.hideMailboxes : V.showMailboxes, shortcut: 'mod+shift+m', action: () => setSidebar((v) => !v) }],
      },
      {
        label: V.mailbox,
        items: [
          { label: V.getMail, action: () => setChecking(true) },
          { separator: true },
          {
            label: V.goTo,
            submenu: MAILBOXES.map((b, i) => ({ label: b.label, shortcut: `mod+${i + 1}`, checked: box === b.id, action: () => selectBox(b.id) })),
          },
          { separator: true },
          { label: V.eraseDeleted, disabled: !all.some((m) => m.mailbox === 'trash'), action: () => void eraseTrash(windowId) },
        ],
      },
      {
        label: V.message,
        items: selected
          ? [
              ...(selected.mailbox === 'drafts' ? [{ label: V.editDraft, action: () => openInWindow(selected) }, { separator: true }] : []),
              ...(selected.mailbox === 'sent' ? [{ label: V.sendAgain, action: () => openCompose({ to: formatAddresses(selected.to), subject: selected.subject, body: selected.body }) }, { separator: true }] : []),
              ...messageItems(selected),
            ]
          : [
              { label: V.reply, shortcut: 'mod+alt+r', disabled: true },
              { label: V.forward, shortcut: 'mod+shift+f', disabled: true },
              { label: V.delete, shortcut: 'mod+backspace', disabled: true },
            ],
      },
    ],
    [selected, sidebar, box, all, windowId, locale],
  );

  const subtitle = unreadHere && box !== 'sent' && box !== 'drafts' ? fmt(t(V.countUnread), { n: inBox.length, u: unreadHere }) : fmt(t(V.count), { n: inBox.length });

  /**
   * Shows a mailbox picker below the toolbar title.
   *
   * Anchors a context menu at the bottom-left corner of the clicked element and lists every
   * mailbox, with the current one checked.
   *
   * @param {React.MouseEvent} e - The click event on the title button.
   * @returns {void}
   *
   * @example
   * <button onClick={mailboxMenu}>Inbox</button>
   */
  const mailboxMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showContextMenu(
      { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} },
      MAILBOXES.map((b) => ({ label: b.label, checked: b.id === box, action: () => selectBox(b.id) })),
    );
  };

  return (
    <div className={`${styles.mail} ${sidebar ? '' : styles.noSidebar}`}>
      {sidebar && (
        <aside className={`ui-sidebar ${styles.sidebar}`} aria-label={t(V.mailbox)}>
          <div className={styles.sidebarTop} data-drag-region />
          <div className={styles.sidebarSection}>{t(V.favorites)}</div>
          <nav className={styles.mailboxes}>
            {MAILBOXES.map((b) => {
              const Icon = b.icon;
              const n = b.id === 'inbox' ? counts.inbox : b.id === 'drafts' ? counts.drafts : b.id === 'flagged' ? counts.flagged : 0;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`${styles.mailbox} ${box === b.id ? styles.mailboxActive : ''} ${dropBox === b.id ? styles.mailboxDrop : ''}`}
                  aria-current={box === b.id}
                  onClick={() => selectBox(b.id)}
                  onDragOver={(e) => {
                    if (!DROP_TARGETS.has(b.id) || !e.dataTransfer.types.includes(MAIL_MIME)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropBox(b.id);
                  }}
                  onDragLeave={() => setDropBox((d) => (d === b.id ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropBox(null);
                    const id = e.dataTransfer.getData(MAIL_MIME);
                    if (id) moveMessage(id, b.id);
                  }}
                >
                  <Icon size={15} className={b.id === 'flagged' ? styles.flagIcon : undefined} />
                  <span>{t(b.label)}</span>
                  {n > 0 && <span className={styles.count}>{n}</span>}
                </button>
              );
            })}
          </nav>
          {lastChecked > 0 && (
            <div className={styles.sidebarFoot}>
              {Date.now() - lastChecked < 60_000 ? t(V.updated) : fmt(t(V.updatedAt), { time: formatDate(lastChecked, locale, { hour: 'numeric', minute: '2-digit' }) })}
            </div>
          )}
        </aside>
      )}

      <div className={`${styles.main} ${selected ? styles.showReader : ''}`}>
        <div className={`ui-toolbar ${styles.toolbar}`} data-drag-region>
          {selected && (
            <GlassGroup className={styles.backButton}>
              <IconButton label={t(V.back)} onClick={backToList}>
                <ChevronLeft size={18} />
              </IconButton>
            </GlassGroup>
          )}
          <button type="button" className={styles.titleBlock} onClick={mailboxMenu} title={t(V.goTo)}>
            <span className={styles.title}>{boxLabel}</span>
            <span className={styles.subtitle}>{subtitle}</span>
          </button>
          <GlassGroup>
            <IconButton label={t(V.getMail)} onClick={() => setChecking(true)} className={checking ? styles.spinning : undefined}>
              <MailIcon size={16} />
            </IconButton>
            <IconButton label={t(V.compose)} onClick={() => openCompose()}>
              <SquarePen size={16} />
            </IconButton>
          </GlassGroup>
          <GlassGroup className={styles.messageAction}>
            <IconButton label={t(V.delete)} disabled={!selected} onClick={removeSelected}>
              <Trash2 size={16} />
            </IconButton>
          </GlassGroup>
          <GlassGroup className={styles.messageAction}>
            <IconButton label={t(V.reply)} disabled={!selected} onClick={() => selected && reply(selected)}>
              <Reply size={17} />
            </IconButton>
            <IconButton label={t(V.forward)} disabled={!selected} onClick={() => selected && forward(selected)}>
              <Forward size={17} />
            </IconButton>
            <IconButton
              label={t(selected?.flagged ? V.unflag : V.flag)}
              className={styles.optional}
              disabled={!selected}
              active={!!selected?.flagged}
              onClick={() => selected && useMail.getState().update(selected.id, { flagged: !selected.flagged })}
            >
              <Flag size={15} className={selected?.flagged ? styles.flagIcon : undefined} />
            </IconButton>
            <IconButton label={t(selected?.read === false ? V.markRead : V.markUnread)} className={styles.optional} disabled={!selected} onClick={() => selected && useMail.getState().update(selected.id, { read: !selected.read })}>
              <MailOpen size={16} />
            </IconButton>
          </GlassGroup>
          <div className={styles.toolbarSpacer} data-drag-region />
          <div className={styles.search}>
            <SearchField value={query} onChange={setQuery} placeholder={t(V.search)} style={{ width: '100%' }} />
          </div>
        </div>

        <div className={styles.split}>
          <div
            ref={listRef}
            className={`${styles.list} ${listFocused ? styles.listFocused : ''}`}
            role="listbox"
            aria-label={boxLabel}
            tabIndex={0}
            onFocus={() => setListFocused(true)}
            onBlur={() => setListFocused(false)}
          >
            {list.length === 0 ? (
              <div className="ui-empty">{t(query ? V.noResults : V.noMessages)}</div>
            ) : (
              list.map((m) => {
                const isSel = m.id === selectedId;
                const who = m.mailbox === 'sent' || m.mailbox === 'drafts' ? m.to.map(displayName).join(', ') || '—' : displayName(m.from);
                return (
                  <div
                    key={m.id}
                    data-id={m.id}
                    role="option"
                    aria-selected={isSel}
                    className={`${styles.row} ${isSel ? styles.rowSelected : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(MAIL_MIME, m.id);
                      e.dataTransfer.setData('text/plain', m.subject);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDropBox(null)}
                    onMouseDown={() => select(m)}
                    onDoubleClick={() => openInWindow(m)}
                    onContextMenu={(e) => {
                      select(m);
                      showContextMenu(e, messageItems(m));
                    }}
                  >
                    <div className={styles.rowGutter}>
                      {!m.read && <span className={styles.unread} aria-label={t(V.markUnread)} />}
                      {m.flagged && <Flag size={10} className={styles.rowFlag} fill="currentColor" />}
                    </div>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTop}>
                        <span className={`${styles.sender} ${m.read ? '' : styles.senderUnread}`}>{who}</span>
                        <span className={styles.rowDate}>{listDate(m.date, locale, t(V.yesterday))}</span>
                      </div>
                      <div className={styles.rowSubject}>
                        {m.attachments?.length ? <Paperclip size={11} /> : null}
                        <span>{m.subject || '—'}</span>
                      </div>
                      <div className={styles.rowPreview}>{preview(m.body)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className={styles.reader}>
            {selected ? (
              <div key={selected.id} className={styles.readerScroll}>
                <MessageView message={selected} windowId={windowId} />
              </div>
            ) : (
              <div className="ui-empty">
                <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-tertiary)' }}>{t(V.noSelection)}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A single message opened in its own window (double-click or Enter in the viewer).
 *
 * Looks the message up among all messages, keeps the window title in sync with its subject,
 * and offers reply, forward, flag and delete from the toolbar and the Message menu. Deleting
 * closes the window once the message is gone. If no message has `messageId` (for example
 * after it was erased), an empty state is shown and the actions are disabled.
 *
 * @param {Object} props - Component props.
 * @param {string} props.windowId - Id of the window hosting the message.
 * @param {string} props.messageId - Id of the message to show.
 * @returns {JSX.Element} The message window contents.
 *
 * @example
 * <MessageWindow windowId={windowId} messageId="welcome" />
 */
export function MessageWindow({ windowId, messageId }: { windowId: string; messageId: string }) {
  const t = useT();
  const all = useAllMessages();
  const m = all.find((x) => x.id === messageId);

  useEffect(() => {
    if (m) wm.setTitle(windowId, m.subject || '—');
  }, [windowId, m]);

  useAppMenus(
    () => [
      {
        label: V.message,
        items: m
          ? [
              { label: V.reply, shortcut: 'mod+alt+r', action: () => reply(m) },
              { label: V.forward, shortcut: 'mod+shift+f', action: () => forward(m) },
              { separator: true },
              { label: m.flagged ? V.unflag : V.flag, shortcut: 'mod+shift+l', action: () => useMail.getState().update(m.id, { flagged: !m.flagged }) },
              { label: V.delete, shortcut: 'mod+backspace', action: () => void deleteMessage(m, windowId).then((ok) => ok && wm.close(windowId)) },
            ]
          : [],
      },
    ],
    [m, windowId],
  );

  return (
    <div className={styles.messageWindow}>
      <div className={`ui-toolbar ${styles.toolbar} ${styles.inset}`} data-drag-region>
        <GlassGroup>
          <IconButton label={t(V.reply)} disabled={!m} onClick={() => m && reply(m)}>
            <Reply size={17} />
          </IconButton>
          <IconButton label={t(V.forward)} disabled={!m} onClick={() => m && forward(m)}>
            <Forward size={17} />
          </IconButton>
          <IconButton label={t(m?.flagged ? V.unflag : V.flag)} disabled={!m} active={!!m?.flagged} onClick={() => m && useMail.getState().update(m.id, { flagged: !m.flagged })}>
            <Flag size={15} className={m?.flagged ? styles.flagIcon : undefined} />
          </IconButton>
        </GlassGroup>
        <GlassGroup>
          <IconButton
            label={t(V.delete)}
            disabled={!m}
            onClick={() => m && void deleteMessage(m, windowId).then((ok) => ok && wm.close(windowId))}
          >
            <Trash2 size={16} />
          </IconButton>
        </GlassGroup>
        <div className={styles.toolbarSpacer} data-drag-region />
      </div>
      <div className={styles.readerScroll}>{m ? <MessageView message={m} windowId={windowId} /> : <div className="ui-empty">{t(V.noSelection)}</div>}</div>
    </div>
  );
}

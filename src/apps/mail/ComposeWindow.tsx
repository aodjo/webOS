/**
 * Mail compose window. "Send" files the message in Sent and hands it to the visitor's own mail
 * client through a mailto: link; closing a window with unsaved content asks whether to keep it
 * as a draft.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Paperclip, Send } from 'lucide-react';
import { owner } from '@/data/portfolio';
import { Button, IconButton } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import { dialogs, fmt, getApp, notify, useAppMenus, useBeforeClose, useT, useWindow, useWM, wm, type AppArgs, type LString } from '@/kernel';
import { COMPOSE_WINDOW, NEW_MESSAGE, openCompose } from './compose';
import { copyAddress } from './actions';
import { isValidEmail, parseAddresses, useMail } from './store';
import styles from './Mail.module.css';

const C = {
  to: { en: 'To:', ko: '받는 사람:' },
  cc: { en: 'Cc:', ko: '참조:' },
  subject: { en: 'Subject:', ko: '제목:' },
  send: { en: 'Send', ko: '보내기' },
  saveDraft: { en: 'Save', ko: '저장' },
  copyEmail: { en: 'Copy Email Address', ko: '이메일 주소 복사' },
  attach: { en: 'Attachments aren’t supported by mailto: links', ko: 'mailto: 링크로는 첨부 파일을 보낼 수 없습니다' },
  hint: {
    en: 'Send hands this message to your own email app. Prefer copying? The address is {email}.',
    ko: '보내기를 누르면 사용 중인 이메일 앱으로 메시지가 전달됩니다. 직접 보내려면 주소를 복사하세요: {email}',
  },
  bodyPlaceholder: { en: 'Write your message…', ko: '메시지를 작성하세요…' },
  file: { en: 'File', ko: '파일' },
  message: { en: 'Message', ko: '메시지' },
  newMessage: { en: 'New Message', ko: '새로운 메시지' },
  closeWindow: { en: 'Close Window', ko: '윈도우 닫기' },
  noRecipient: { en: 'This message has no recipients.', ko: '이 메시지에 받는 사람이 없습니다.' },
  noRecipientMsg: { en: 'Enter at least one email address in the To field.', ko: '받는 사람 필드에 이메일 주소를 하나 이상 입력하세요.' },
  badAddress: { en: 'The email address “{email}” is not valid.', ko: '“{email}”은(는) 유효한 이메일 주소가 아닙니다.' },
  badAddressMsg: { en: 'Check the address and try again.', ko: '주소를 확인한 다음 다시 시도하세요.' },
  noSubject: { en: 'This message has no subject.', ko: '이 메시지에 제목이 없습니다.' },
  noSubjectMsg: { en: 'Do you want to send it anyway?', ko: '그래도 보내겠습니까?' },
  sendAnyway: { en: 'Send', ko: '보내기' },
  sentTitle: { en: 'Message handed off to your mail app', ko: '메시지를 메일 앱으로 전달했습니다' },
  sentBody: { en: 'If nothing opened, write to {email} — click to copy the address.', ko: '아무것도 열리지 않았다면 {email}(으)로 보내 주세요. 클릭하면 주소가 복사됩니다.' },
  draftTitle: { en: 'Do you want to save this message as a draft?', ko: '이 메시지를 임시 저장하겠습니까?' },
  draftMsg: { en: 'You can finish it later from the Drafts mailbox.', ko: '나중에 임시 보관함에서 이어서 작성할 수 있습니다.' },
  delete: { en: 'Delete', ko: '삭제' },
  cancel: { en: 'Cancel', ko: '취소' },
  save: { en: 'Save', ko: '저장' },
} satisfies Record<string, LString>; /** Localized strings used by the compose window. */

/**
 * Coerces an untyped window argument to a string.
 *
 * Window args arrive as `unknown`; anything that is not a string becomes an empty string so it
 * can seed a controlled text field.
 *
 * @param {unknown} v - The raw argument value.
 * @returns {string} `v` itself when it is a string, otherwise `''`.
 *
 * @example
 * str(args.subject); // 'Hello' or '' when the arg is missing
 */
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Builds the mailto: URL that hands a message to the visitor's mail client.
 *
 * The To field is parsed into addresses and only their bare emails are kept (display names are
 * dropped). Cc, subject and body become URI-encoded query parameters and are omitted when empty;
 * Cc is passed through as typed (trimmed) rather than parsed.
 *
 * @param {string} to - Raw To field, e.g. "Ann <ann@x.com>, bob@y.com".
 * @param {string} cc - Raw Cc field.
 * @param {string} subject - Message subject.
 * @param {string} body - Plain-text message body.
 * @returns {string} A `mailto:` URL.
 *
 * @example
 * mailtoURL('ann@x.com', '', 'Hi', 'Hello');
 * // 'mailto:ann%40x.com?subject=Hi&body=Hello'
 */
function mailtoURL(to: string, cc: string, subject: string, body: string): string {
  const addr = parseAddresses(to)
    .map((a) => encodeURIComponent(a.email))
    .join(',');
  const params = [cc.trim() && `cc=${encodeURIComponent(cc.trim())}`, subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean);
  return `mailto:${addr}${params.length ? `?${params.join('&')}` : ''}`;
}

const AUTOSAVE_MS = 2000; /** Milliseconds typing has to pause before the message is autosaved to Drafts. */

/**
 * Shrinks a compose window that was opened at the mail viewer's size to the compose size.
 *
 * A compose window opened directly with `wm.openWindow('mail', { compose: true })` gets the
 * viewer's default size. When the window still has exactly that size (and is neither maximized
 * nor tiled), it is resized to `COMPOSE_WINDOW` around the same center. Windows of any other
 * size are left untouched.
 *
 * @param {string} windowId - Id of the compose window.
 * @returns {void} Nothing.
 *
 * @example
 * useLayoutEffect(() => fitComposeWindow(windowId), [windowId]);
 */
function fitComposeWindow(windowId: string): void {
  const win = useWM.getState().windows.find((w) => w.id === windowId);
  const viewer = getApp('mail')?.window;
  if (!win || !viewer || win.maximized || win.tiled || win.width !== viewer.width || win.height !== viewer.height) return;
  wm.update(windowId, {
    ...COMPOSE_WINDOW,
    x: Math.round(win.x + (win.width - COMPOSE_WINDOW.width) / 2),
    y: Math.round(win.y + (win.height - COMPOSE_WINDOW.height) / 2),
  });
}

/**
 * Opens a mailto: link without navigating the page away.
 *
 * Creates a temporary `<a>` element, clicks it so the browser hands the link to the system's
 * mail handler, and removes the element again.
 *
 * @param {string} href - The mailto: URL to open.
 * @returns {void} Nothing.
 *
 * @example
 * launchMailto('mailto:ann%40x.com?subject=Hi');
 */
function launchMailto(href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The compose window component.
 *
 * Fields start from the window args: a missing `to` means "write to the owner" (a string, even
 * an empty one, is used as given), and `draftId` continues editing an existing draft. On open,
 * focus goes once to the first empty field (To, then Subject), or to the start of the body
 * when both are filled, as when replying.
 *
 * Editing marks the window dirty; after `AUTOSAVE_MS` without typing the message is autosaved
 * to Drafts. Closing a dirty window asks whether to save or delete the draft; if all content was
 * erased, any autosaved draft is deleted without asking. Sending (Send button or
 * `mod+shift+d`) validates the recipients, files the message in Sent, opens the mailto: link
 * and force-closes the window. The window title follows the subject.
 *
 * @param {Object} props - Component props.
 * @param {string} props.windowId - Id of the window hosting this compose view.
 * @param {AppArgs} props.args - Window args (`to`, `subject`, `body`, `draftId`).
 * @returns {JSX.Element} The compose view.
 *
 * @example
 * <Compose windowId={windowId} args={{ compose: true, to: 'ann@x.com' }} />
 */
export function Compose({ windowId, args }: { windowId: string; args: AppArgs }) {
  const t = useT();
  const { focused } = useWindow();
  const [to, setTo] = useState(() => (typeof args.to === 'string' ? args.to : owner.email));
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(() => str(args.subject));
  const [body, setBody] = useState(() => str(args.body));
  const [dirty, setDirty] = useState(false);
  const draftId = useRef<string | undefined>(typeof args.draftId === 'string' ? args.draftId : undefined);
  const sent = useRef(false);
  const toRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = !!(subject.trim() || body.trim());

  useLayoutEffect(() => fitComposeWindow(windowId), [windowId]);

  useEffect(() => {
    const el = !to ? toRef.current : !subject ? subjectRef.current : bodyRef.current;
    el?.focus();
    if (el instanceof HTMLTextAreaElement) el.setSelectionRange(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => wm.setTitle(windowId, subject.trim() || t(NEW_MESSAGE)), [windowId, subject, t]);
  useEffect(() => wm.setDirty(windowId, dirty && hasContent), [windowId, dirty, hasContent]);

  /**
   * Creates a change handler for one of the text fields.
   *
   * The returned handler stores the field's new value with `setter` and marks the message
   * dirty, which enables autosave and the close-time draft prompt.
   *
   * @param {(v: string) => void} setter - State setter for the field.
   * @returns {(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void} The onChange handler.
   *
   * @example
   * <input value={cc} onChange={edit(setCc)} />
   */
  const edit = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setter(e.target.value);
    setDirty(true);
  };

  /**
   * Saves the current message to Drafts.
   *
   * Creates the draft on first save and updates the same draft afterwards (its id is kept in
   * `draftId`), then clears the dirty flag.
   *
   * @returns {void} Nothing.
   *
   * @example
   * saveDraft(); // adds or updates the message in the Drafts mailbox
   */
  const saveDraft = () => {
    draftId.current = useMail.getState().saveDraft({ to, cc, subject, body }, draftId.current);
    setDirty(false);
  };

  useEffect(() => {
    if (!dirty || !hasContent) return;
    const id = setTimeout(() => {
      if (!sent.current) draftId.current = useMail.getState().saveDraft({ to, cc, subject, body }, draftId.current);
    }, AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [to, cc, subject, body, dirty, hasContent]);

  /**
   * Validates and sends the message.
   *
   * Shows an alert sheet and stops when the To field has no addresses (refocusing it) or when
   * any To/Cc address is not a valid email; asks for confirmation when the subject is empty.
   * On success it files the message in Sent (replacing its draft), opens the mailto: link,
   * posts a notification whose click copies the owner's address, and force-closes the window
   * so no draft prompt appears.
   *
   * @async
   * @returns {Promise<void>} Resolves once the message is sent or sending was cancelled.
   *
   * @example
   * <Button onClick={() => void send()}>Send</Button>
   */
  const send = async () => {
    const recipients = parseAddresses(to);
    if (!recipients.length) {
      await dialogs.alert({ windowId, appId: 'mail', title: C.noRecipient, message: C.noRecipientMsg });
      toRef.current?.focus();
      return;
    }
    const bad = [...recipients, ...parseAddresses(cc)].find((a) => !isValidEmail(a.email));
    if (bad) {
      await dialogs.alert({ windowId, appId: 'mail', title: fmt(t(C.badAddress), { email: bad.email }), message: C.badAddressMsg });
      return;
    }
    if (!subject.trim()) {
      const ok = await dialogs.confirm({ windowId, appId: 'mail', title: C.noSubject, message: C.noSubjectMsg, okLabel: C.sendAnyway });
      if (!ok) return;
    }
    useMail.getState().send({ to, cc, subject, body }, draftId.current);
    sent.current = true;
    launchMailto(mailtoURL(to, cc, subject, body));
    notify({ appId: 'mail', title: C.sentTitle, body: fmt(t(C.sentBody), { email: owner.email }), onClick: () => copyAddress(owner.email) });
    void wm.close(windowId, { force: true });
  };

  useBeforeClose(async () => {
    if (sent.current || !dirty) return true;
    if (!hasContent) {
      if (draftId.current) useMail.getState().erase(draftId.current);
      return true;
    }
    const choice = await dialogs.alert({
      windowId,
      appId: 'mail',
      title: C.draftTitle,
      message: C.draftMsg,
      buttons: [
        { label: C.delete, value: 'delete', danger: true },
        { label: C.cancel, value: 'cancel', cancel: true },
        { label: C.save, value: 'save', primary: true },
      ],
    });
    if (choice === 'cancel') return false;
    if (choice === 'save') saveDraft();
    else if (draftId.current) useMail.getState().erase(draftId.current);
    return true;
  });

  useAppMenus(
    () => [
      {
        label: C.file,
        items: [
          { label: C.newMessage, shortcut: 'alt+n', action: () => openCompose() },
          { separator: true },
          { label: C.closeWindow, shortcut: 'alt+w', action: () => void wm.close(windowId) },
          { label: C.saveDraft, shortcut: 'mod+s', disabled: !hasContent, action: saveDraft },
        ],
      },
      {
        label: C.message,
        items: [
          { label: C.send, shortcut: 'mod+shift+d', action: () => void send() },
          { separator: true },
          { label: C.copyEmail, action: () => copyAddress(owner.email) },
        ],
      },
    ],
    [to, cc, subject, body, hasContent, dirty, windowId],
  );

  return (
    <div className={`${styles.compose} ${focused ? '' : styles.inactive}`}>
      <div className={`ui-toolbar ${styles.composeToolbar}`} data-drag-region>
        <Button variant="primary" size="large" className={styles.sendBtn} title={t(C.send)} onClick={() => void send()}>
          <Send size={14} />
          {t(C.send)}
        </Button>
        <div className={styles.composeTitle} data-drag-region>
          {subject.trim() || t(NEW_MESSAGE)}
        </div>
        <GlassGroup>
          <IconButton label={t(C.attach)} disabled>
            <Paperclip size={15} />
          </IconButton>
          <IconButton label={t(C.copyEmail)} onClick={() => copyAddress(owner.email)}>
            <Copy size={15} />
          </IconButton>
        </GlassGroup>
      </div>
      <div className={styles.fields}>
        <label className={styles.fieldRow}>
          <span>{t(C.to)}</span>
          <input ref={toRef} value={to} onChange={edit(setTo)} spellCheck={false} autoComplete="off" inputMode="email" />
        </label>
        <label className={styles.fieldRow}>
          <span>{t(C.cc)}</span>
          <input value={cc} onChange={edit(setCc)} spellCheck={false} autoComplete="off" inputMode="email" />
        </label>
        <label className={styles.fieldRow}>
          <span>{t(C.subject)}</span>
          <input ref={subjectRef} value={subject} onChange={edit(setSubject)} />
        </label>
      </div>
      <textarea ref={bodyRef} className={styles.composeBody} value={body} onChange={edit(setBody)} placeholder={t(C.bodyPlaceholder)} />
      <div className={styles.composeHint}>{fmt(t(C.hint), { email: owner.email })}</div>
    </div>
  );
}

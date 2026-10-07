/**
 * Users & Groups (name, picture, login password) and Lock Screen.
 *
 * The password is changed in an in-window sheet with masked fields (old → new → verify → hint),
 * like the real Change Password sheet. The login/lock screen enforces whatever is stored here.
 */
import { useRef, useState, type RefObject } from 'react';
import { ImagePlus, Lock } from 'lucide-react';
import { Button, Select, TextField } from '@/components/ui';
import { owner } from '@/data/portfolio';
import { dialogs, fmt, formatShortcut, HOME, PATHS, power, SYSTEM_SHORTCUTS, useSystem, useT, wm, type LString } from '@/kernel';
import { NavRow, onRadioGroupKeyDown, Pane, Row, Section, UserAvatar } from '../kit';
import { useNav } from '../nav';
import { setPrefs, usePrefs } from '../prefs';
import { BUILTIN_AVATARS, IMAGE_EXTENSIONS, isImagePath } from '../media';
import { NOT_A_CREDENTIAL, Sheet, SheetField } from '../sheet';
import s from './panes.module.css';

const S = {
  admin: { en: 'Admin', ko: '관리자' },
  account: { en: 'Account', ko: '계정' },
  fullName: { en: 'Full name', ko: '전체 이름' },
  accountName: { en: 'Account name', ko: '계정 이름' },
  homeFolder: { en: 'Home folder', ko: '홈 폴더' },
  showInFinder: { en: 'Show in Finder', ko: 'Finder에서 보기' },
  picture: { en: 'Picture', ko: '사진' },
  pictureFooter: { en: 'Your picture appears on the login and lock screens and in System Settings.', ko: '사진은 로그인 화면, 잠금 화면 및 시스템 설정에 표시됩니다.' },
  defaultPicture: { en: 'Default', ko: '기본' },
  custom: { en: 'Custom picture', ko: '사용자 지정 사진' },
  choose: { en: 'Choose…', ko: '선택…' },
  choosePicture: { en: 'Choose a Picture', ko: '사진 선택' },
  notImage: { en: 'This file isn’t a picture.', ko: '이 파일은 사진이 아닙니다.' },
  password: { en: 'Password', ko: '암호' },
  loginPassword: { en: 'Login password', ko: '로그인 암호' },
  hasPassword: { en: 'A password is required to log in and to unlock the screen.', ko: '로그인하거나 화면 잠금을 해제하려면 암호가 필요합니다.' },
  noPassword: { en: 'No password is set — anyone can log in.', ko: '암호가 설정되지 않았습니다 — 누구나 로그인할 수 있습니다.' },
  change: { en: 'Change Password…', ko: '암호 변경…' },
  set: { en: 'Set Password…', ko: '암호 설정…' },
  remove: { en: 'Remove Password…', ko: '암호 제거…' },
  hint: { en: 'Password hint', ko: '암호 힌트' },
  none: { en: 'None', ko: '없음' },

  sheetChange: { en: 'Change Password', ko: '암호 변경' },
  sheetSet: { en: 'Set Password', ko: '암호 설정' },
  sheetRemove: { en: 'Remove Password', ko: '암호 제거' },
  oldPassword: { en: 'Old password', ko: '이전 암호' },
  newPassword: { en: 'New password', ko: '새로운 암호' },
  verify: { en: 'Verify', ko: '확인' },
  hintRecommended: { en: 'Password hint (recommended)', ko: '암호 힌트(권장)' },
  wrongOld: { en: 'The old password you entered is incorrect.', ko: '입력한 이전 암호가 올바르지 않습니다.' },
  enterNew: { en: 'Enter a new password.', ko: '새로운 암호를 입력하십시오.' },
  mismatch: { en: 'The passwords don’t match.', ko: '암호가 일치하지 않습니다.' },
  hintHasPassword: { en: 'The password hint can’t contain the password.', ko: '암호 힌트에 암호를 포함할 수 없습니다.' },

  requirePassword: { en: 'Require password after the display sleeps', ko: '디스플레이가 잠자기 상태가 된 후 암호 요구' },
  immediately: { en: 'Immediately', ko: '즉시' },
  after5s: { en: 'After 5 seconds', ko: '5초 후' },
  after1m: { en: 'After 1 minute', ko: '1분 후' },
  after5m: { en: 'After 5 minutes', ko: '5분 후' },
  after1h: { en: 'After 1 hour', ko: '1시간 후' },
  lockNow: { en: 'Lock the screen now', ko: '지금 화면 잠그기' },
  lockButton: { en: 'Lock Screen Now', ko: '지금 화면 잠그기' },
  shortcut: { en: 'Shortcut: {keys}', ko: '단축키: {keys}' },
  requirePasswordSub: { en: 'Waking the display sooner than this skips the lock screen.', ko: '이 시간 안에 디스플레이를 깨우면 잠금 화면을 건너뜁니다.' },
  lockFooter: { en: 'Apps keep running while the screen is locked.', ko: '화면이 잠겨 있는 동안에도 앱은 계속 실행됩니다.' },
  on: { en: 'On', ko: '켬' },
  off: { en: 'Off', ko: '끔' },
}; /** Localized strings for the Users & Groups and Lock Screen panes. */

const lockShortcut: string | undefined = SYSTEM_SHORTCUTS.lockScreen; /** Lock Screen shortcut; only registered on Mac hosts, undefined elsewhere. */

/* ───────────────────────── Password sheet ───────────────────────── */

/** Which password sheet is open: "change" sets or changes the password, "remove" clears it. */
type SheetMode = 'change' | 'remove';

/**
 * Renders the Set, Change or Remove Password sheet.
 *
 * Shows the user's picture and name and, when a password is already set, an "Old password"
 * field. In "change" mode it adds new password, verify and (unmasked) hint fields, the hint
 * prefilled from settings. The title and submit label read "Set Password" when no password
 * exists, "Change Password" otherwise, and "Remove Password" in remove mode. Validation errors
 * appear in the sheet with a shake, and all fields are kept out of password-manager autofill.
 *
 * @param {Object} props - Component props.
 * @param {SheetMode} props.mode - Whether the sheet sets/changes or removes the password.
 * @param {() => void} props.onClose - Called after a successful submit or on cancel.
 * @returns {JSX.Element} The password sheet.
 *
 * @example
 * {sheet && <PasswordSheet mode={sheet} onClose={() => setSheet(null)} />}
 */
function PasswordSheet({ mode, onClose }: { mode: SheetMode; onClose: () => void }) {
  const t = useT();
  const current = useSystem((x) => x.settings.password);
  const currentHint = useSystem((x) => x.settings.passwordHint);
  const fullName = useSystem((x) => x.settings.fullName);
  const avatar = useSystem((x) => x.settings.avatar);
  const update = useSystem((x) => x.updateSettings);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const verifyRef = useRef<HTMLInputElement>(null);
  const hintRef = useRef<HTMLInputElement>(null);
  const [oldPw, setOldPw] = useState('');
  const [pw, setPw] = useState('');
  const [verify, setVerify] = useState('');
  const [hint, setHint] = useState(currentHint);
  const [error, setError] = useState<LString | null>(null);
  const [shake, setShake] = useState(0);
  const needsOld = current.length > 0;

  /**
   * Reports a validation error in the sheet.
   *
   * Shows the message, bumps the shake counter so the sheet replays its shake animation, and
   * focuses the offending field.
   *
   * @param {LString} msg - Localized error message.
   * @param {HTMLInputElement | null} field - The input to focus, if it is mounted.
   * @returns {void}
   *
   * @example
   * fail(S.mismatch, verifyRef.current);
   */
  const fail = (msg: LString, field: HTMLInputElement | null) => {
    setError(msg);
    setShake((n) => n + 1);
    field?.focus();
  };

  /**
   * Validates the sheet and applies the password change.
   *
   * When a password is already set, the old password must match (otherwise the old field is
   * cleared). In "remove" mode the password and hint are then cleared. In "change" mode the new
   * password must be non-empty and equal to the verify field (otherwise the verify field is
   * cleared), and a non-blank hint must not contain the password; the password and trimmed hint
   * are then saved. Each failure is reported through `fail`; success closes the sheet.
   *
   * @returns {void}
   *
   * @example
   * <Sheet onSubmit={submit} onCancel={onClose} />
   */
  const submit = () => {
    if (needsOld && oldPw !== current) {
      setOldPw('');
      return fail(S.wrongOld, oldRef.current);
    }
    if (mode === 'remove') {
      update({ password: '', passwordHint: '' });
      return onClose();
    }
    if (!pw) return fail(S.enterNew, newRef.current);
    if (pw !== verify) {
      setVerify('');
      return fail(S.mismatch, verifyRef.current);
    }
    if (hint.trim() && hint.includes(pw)) return fail(S.hintHasPassword, hintRef.current);
    update({ password: pw, passwordHint: hint.trim() });
    onClose();
  };

  const title = mode === 'remove' ? S.sheetRemove : needsOld ? S.sheetChange : S.sheetSet;

  /**
   * Renders a labelled text field bound to one piece of sheet state.
   *
   * The input is a password field unless `masked` is false, is kept out of password-manager
   * autofill, and clears the current error whenever its value changes.
   *
   * @param {LString} label - Localized field label.
   * @param {RefObject<HTMLInputElement | null>} ref - Ref attached to the input, used to focus it on errors.
   * @param {string} value - Current value.
   * @param {(v: string) => void} set - State setter called with the new value.
   * @param {boolean} [masked=true] - Whether the input hides what is typed.
   * @returns {JSX.Element} The sheet field.
   *
   * @example
   * field(S.hintRecommended, hintRef, hint, setHint, false);
   */
  const field = (label: LString, ref: RefObject<HTMLInputElement | null>, value: string, set: (v: string) => void, masked = true) => (
    <SheetField label={t(label)}>
      <TextField
        ref={ref}
        type={masked ? 'password' : 'text'}
        value={value}
        {...NOT_A_CREDENTIAL}
        onChange={(e) => {
          set(e.target.value);
          setError(null);
        }}
      />
    </SheetField>
  );

  return (
    <Sheet
      leading={<UserAvatar src={avatar} name={fullName} size={40} />}
      title={t(title)}
      subtitle={fullName}
      error={error ? t(error) : ''}
      shake={shake}
      submitLabel={t(title)}
      onSubmit={submit}
      onCancel={onClose}
    >
      {needsOld && field(S.oldPassword, oldRef, oldPw, setOldPw)}
      {mode === 'change' && (
        <>
          {field(S.newPassword, newRef, pw, setPw)}
          {field(S.verify, verifyRef, verify, setVerify)}
          {field(S.hintRecommended, hintRef, hint, setHint, false)}
        </>
      )}
    </Sheet>
  );
}

/* ───────────────────────── Users & Groups ───────────────────────── */

/**
 * Renders the Users & Groups settings pane.
 *
 * Shows the user header, an editable full name (saved on blur or Enter, reverted on Escape), the
 * read-only account name and home folder (with a "Show in Finder" button), and a picture picker
 * offering the owner's default picture, the built-in avatars, the current custom picture when it
 * is a file other than the default, and a "Choose…" button. The Password section offers Set or
 * Change and, when a password exists, Remove (each opening the password sheet) and shows the hint.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <UsersPane />
 */
export function UsersPane() {
  const t = useT();
  const { windowId } = useNav();
  const fullName = useSystem((x) => x.settings.fullName);
  const avatar = useSystem((x) => x.settings.avatar);
  const password = useSystem((x) => x.settings.password);
  const hint = useSystem((x) => x.settings.passwordHint);
  const update = useSystem((x) => x.updateSettings);
  const [sheet, setSheet] = useState<SheetMode | null>(null);

  /**
   * Saves the edited full name.
   *
   * Trims the value and updates settings only when the result is non-empty and differs from the
   * current name; a blank value is ignored.
   *
   * @param {string} value - The text typed in the name field.
   * @returns {void}
   *
   * @example
   * <TextField onBlur={(e) => commitName(e.currentTarget.value)} />
   */
  const commitName = (value: string) => {
    const name = value.trim();
    if (name && name !== fullName) update({ fullName: name });
  };

  /**
   * Lets the user choose a picture from the virtual file system as the account picture.
   *
   * Opens an Open panel as a sheet on this window, starting in ~/Pictures and filtered to image
   * extensions. A chosen image becomes the avatar; a chosen file that is not an image shows an
   * alert instead. Cancelling the panel does nothing.
   *
   * @async
   * @returns {Promise<void>} Resolves once the panel (and any alert) has been dismissed.
   *
   * @example
   * <button onClick={() => void choosePicture()}>Choose…</button>
   */
  const choosePicture = async () => {
    const path = await dialogs.open({ windowId, title: S.choosePicture, defaultDir: PATHS.pictures, extensions: IMAGE_EXTENSIONS });
    if (!path) return;
    if (isImagePath(path)) update({ avatar: path });
    else await dialogs.alert({ windowId, appId: 'settings', title: S.notImage });
  };

  const options = [
    { id: 'owner', src: owner.avatar, name: S.defaultPicture as LString },
    ...BUILTIN_AVATARS,
    ...(avatar.startsWith('/') && avatar !== owner.avatar ? [{ id: 'custom', src: avatar, name: S.custom as LString }] : []),
  ];

  return (
    <Pane>
      <Section>
        <div className={s.userHeader}>
          <UserAvatar src={avatar} name={fullName} size={64} />
          <div>
            <div className={s.userName}>{fullName}</div>
            <div className={s.userSub}>{t(S.admin)}</div>
          </div>
        </div>
      </Section>

      <Section title={t(S.account)}>
        <Row label={t(S.fullName)}>
          <TextField
            key={fullName}
            defaultValue={fullName}
            aria-label={t(S.fullName)}
            style={{ width: 200 }}
            onBlur={(e) => commitName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.currentTarget.value = fullName;
                e.currentTarget.blur();
              }
            }}
          />
        </Row>
        <Row label={t(S.accountName)}>
          <span className="selectable">{owner.handle}</span>
        </Row>
        <Row label={t(S.homeFolder)} sublabel={HOME}>
          <Button onClick={() => wm.openWindow('finder', { path: HOME })}>{t(S.showInFinder)}</Button>
        </Row>
      </Section>

      <Section title={t(S.picture)} footer={t(S.pictureFooter)}>
        <div className={s.avatarGrid} role="radiogroup" aria-label={t(S.picture)} onKeyDown={onRadioGroupKeyDown}>
          {options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={avatar === o.src} aria-label={t(o.name)} title={t(o.name)} className={s.avatarOption} onClick={() => update({ avatar: o.src })}>
              <UserAvatar src={o.src} name={fullName} size={44} />
            </button>
          ))}
          <button type="button" className={`${s.avatarOption} ${s.avatarChoose}`} onClick={() => void choosePicture()} aria-label={t(S.choosePicture)} title={t(S.choosePicture)}>
            <ImagePlus size={18} />
            <span>{t(S.choose)}</span>
          </button>
        </div>
      </Section>

      <Section title={t(S.password)}>
        <Row label={t(S.loginPassword)} sublabel={t(password ? S.hasPassword : S.noPassword)}>
          {password && (
            <Button onClick={() => setSheet('remove')} variant="danger">
              {t(S.remove)}
            </Button>
          )}
          <Button onClick={() => setSheet('change')}>{t(password ? S.change : S.set)}</Button>
        </Row>
        {password && <Row label={t(S.hint)}>{hint || t(S.none)}</Row>}
      </Section>

      {sheet && <PasswordSheet mode={sheet} onClose={() => setSheet(null)} />}
    </Pane>
  );
}

/* ───────────────────────── Lock Screen ───────────────────────── */

/**
 * Renders the Lock Screen settings pane.
 *
 * Offers the "require password after the display sleeps" delay (stored in prefs, with a note on
 * the grace period for any choice other than "Immediately"), a "Lock Screen Now" button with the
 * lock shortcut shown when the host defines one, and a row linking to Users & Groups that shows
 * whether a login password is set.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <LockScreenPane />
 */
export function LockScreenPane() {
  const t = useT();
  const { go } = useNav();
  const password = useSystem((x) => x.settings.password);
  const requireAfter = usePrefs((p) => p.requirePasswordAfter);

  return (
    <Pane>
      <Section footer={t(S.lockFooter)}>
        <Row label={t(S.requirePassword)} sublabel={requireAfter === 'immediately' ? undefined : t(S.requirePasswordSub)}>
          <Select
            value={requireAfter}
            onChange={(v) => setPrefs({ requirePasswordAfter: v })}
            options={[
              { value: 'immediately', label: t(S.immediately) },
              { value: '5s', label: t(S.after5s) },
              { value: '1m', label: t(S.after1m) },
              { value: '5m', label: t(S.after5m) },
              { value: '1h', label: t(S.after1h) },
            ]}
          />
        </Row>
        <Row label={t(S.lockNow)} sublabel={lockShortcut && fmt(t(S.shortcut), { keys: formatShortcut(lockShortcut) })}>
          <Button onClick={power.lock}>
            <Lock size={12} />
            {t(S.lockButton)}
          </Button>
        </Row>
      </Section>
      <Section title={t(S.loginPassword)}>
        <NavRow label={t(password ? S.change : S.set)} detail={t(password ? S.on : S.off)} onClick={() => go('users')} />
      </Section>
    </Pane>
  );
}

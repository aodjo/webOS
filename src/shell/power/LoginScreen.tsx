/**
 * Login window / lock screen (Liquid Glass controls over the blurred wallpaper).
 *
 * - 'login'  : shown after boot / log out.
 * - 'locked' : rendered over the running (inert) desktop; apps keep their state.
 *
 * Any key press focuses the password field. A wrong password shakes the field and clears it;
 * the right one (or anything when no password is set) plays the unlock transition and then
 * calls `onUnlock` once.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Wifi, WifiOff } from 'lucide-react';
import { useSystem } from '@/kernel/system';
import { useRefraction } from '@/components/Glass';
import { fmt, useLocale, useT } from '@/kernel/i18n';
import type { Locale } from '@/kernel/types';
import { Z } from '../layers';
import { LockBackdrop } from './LockBackdrop';
import { useImageURL, useWallpaperURL } from './images';
import { GlassClock } from './GlassClock';
import { useWallpaperLuminance } from '../menubar/wallpaperTone';
import styles from './LoginScreen.module.css';

const WHOLE_SCREEN = { x0: 0, y0: 0, x1: 1, y1: 1 }; /** Normalized region covering the whole screen, sampled for the wallpaper luminance. */

const S = {
  login: { en: 'Login Window', ko: '로그인 윈도우' },
  locked: { en: 'Lock Screen', ko: '잠금 화면' },
  password: { en: 'Password', ko: '암호' },
  enterPassword: { en: 'Enter Password', ko: '암호 입력' },
  touchId: { en: 'Touch ID or Enter Password', ko: 'Touch ID 또는 암호 입력' },
  logIn: { en: 'Log In', ko: '로그인' },
  unlock: { en: 'Unlock', ko: '잠금 해제' },
  showHint: { en: 'Show Password Hint', ko: '암호 힌트 보기' },
  hint: { en: 'Hint: {hint}', ko: '암호 힌트: {hint}' },
  incorrect: { en: 'Incorrect password', ko: '암호가 올바르지 않습니다.' },
  battery: { en: 'Battery {pct}%', ko: '배터리 {pct}%' },
  capsLock: { en: 'Caps Lock is on', ko: 'Caps Lock이 켜져 있음' },
  wifiOn: { en: 'Wi-Fi: On', ko: 'Wi-Fi: 켬' },
  wifiOff: { en: 'Wi-Fi: Off', ko: 'Wi-Fi: 끔' },
}; /** Localized strings for the login window and the lock screen. */

const UNLOCK_MS = 340; /** Length of the unlock transition (ms) before `onUnlock` fires. */
const AUTO_HINT_AFTER = 3; /** Number of wrong attempts after which the password hint is shown automatically. */

/**
 * Full-screen login window / lock screen.
 *
 * Draws the blurred wallpaper backdrop, a black scrim whose opacity grows with the wallpaper
 * luminance (up to 0.32, so the white text stays legible over bright pictures), the status
 * icons, the clock, the user's avatar and name, and the password form. The password capsule gets
 * edge refraction through `useRefraction`.
 *
 * A correct password (or any input when no password is set) starts the unlock transition and
 * `onUnlock` is called exactly once, UNLOCK_MS later. A wrong password clears and shakes the
 * field and counts the attempt; after AUTO_HINT_AFTER attempts (or via the "?" button) the
 * password hint replaces the caption. Printable keys, Backspace and Enter pressed anywhere focus
 * the password field, and Caps Lock is tracked for the ⇪ indicator. The password capsule stays
 * hidden (but focused) until something is typed, the avatar is clicked or an attempt failed;
 * Escape clears it and hides it again. Both modes look the same; power actions live in the menu
 * bar once the session is unlocked.
 *
 * @param {Object} props - Component props.
 * @param {'login' | 'locked'} props.mode - Whether this is the login window or the lock screen.
 * @param {() => void} props.onUnlock - Called once when the unlock transition has finished.
 * @returns {JSX.Element} The login / lock screen overlay.
 *
 * @example
 * <LoginScreen mode="locked" onUnlock={() => useSystem.getState().setPower('desktop')} />
 */
export function LoginScreen({ mode, onUnlock }: { mode: 'login' | 'locked'; onUnlock: () => void }) {
  const t = useT();
  const fullName = useSystem((s) => s.settings.fullName);
  const avatar = useSystem((s) => s.settings.avatar);
  const password = useSystem((s) => s.settings.password);
  const hint = useSystem((s) => s.settings.passwordHint);

  const [value, setValue] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [hintShown, setHintShown] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRefraction<HTMLDivElement>();
  const onUnlockRef = useRef(onUnlock);
  const unlockCalled = useRef(false);
  useEffect(() => {
    onUnlockRef.current = onUnlock;
  }, [onUnlock]);

  const needsPassword = password.length > 0;
  const canShowHint = needsPassword && hint.trim().length > 0;
  const showHint = canShowHint && (hintShown || attempts >= AUTO_HINT_AFTER);

  useEffect(() => {
    /**
     * Updates the Caps Lock indicator from a keyboard event.
     *
     * Reads the CapsLock modifier state; browsers without `getModifierState` report it as off.
     *
     * @param {KeyboardEvent} e - The window keydown or keyup event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keyup', trackCaps);
     */
    const trackCaps = (e: KeyboardEvent) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);
    /**
     * Redirects typing anywhere on the screen into the password field.
     *
     * Tracks Caps Lock, then focuses the password input for printable keys, Backspace and Enter.
     * Key presses with ⌘, ⌃ or ⌥ are ignored, and while a button has focus Space and Enter are
     * left to that button so they still activate it.
     *
     * @param {KeyboardEvent} e - The window keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey);
     */
    const onKey = (e: KeyboardEvent) => {
      trackCaps(e);
      const input = inputRef.current;
      if (!input || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      if (active === input) return;
      const onControl = active instanceof HTMLButtonElement;
      const printable = e.key.length === 1 && !(onControl && e.key === ' ');
      if (printable || e.key === 'Backspace' || (e.key === 'Enter' && !onControl)) input.focus();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', trackCaps);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', trackCaps);
    };
  }, []);

  useEffect(() => {
    if (!unlocking) return;
    const id = window.setTimeout(() => {
      if (unlockCalled.current) return;
      unlockCalled.current = true;
      onUnlockRef.current();
    }, UNLOCK_MS);
    return () => clearTimeout(id);
  }, [unlocking]);

  /**
   * Plays the "wrong password" shake animation on the form.
   *
   * Jiggles the form horizontally for 420 ms with the Web Animations API. Does nothing when
   * Reduce Motion is on (the system setting or the `prefers-reduced-motion` media query) or when
   * `Element.animate` is unavailable.
   *
   * @returns {void}
   *
   * @example
   * shake();
   */
  const shake = () => {
    const reduce = document.documentElement.dataset.reduceMotion === 'true' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !formRef.current?.animate) return;
    formRef.current.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-12px)' },
        { transform: 'translateX(10px)' },
        { transform: 'translateX(-8px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(-2px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
  };

  /**
   * Checks the entered password when the form is submitted.
   *
   * Prevents the native submission and ignores repeats while unlocking. A matching password (or
   * any input when no password is set) blurs the field and starts the unlock transition;
   * otherwise the field is cleared, the attempt counter is incremented and the form shakes.
   *
   * @param {FormEvent} e - The form submit event.
   * @returns {void}
   *
   * @example
   * <form onSubmit={submit}>…</form>
   */
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (unlocking) return;
    if (!needsPassword || value === password) {
      inputRef.current?.blur();
      setUnlocking(true);
      return;
    }
    setValue('');
    setAttempts((a) => a + 1);
    shake();
  };

  const lum = useWallpaperLuminance(WHOLE_SCREEN);
  const scrim = lum === null ? 0 : Math.min(0.32, Math.max(0, (lum - 0.22) * 0.55));
  const showArrow = !needsPassword || value.length > 0;
  const fieldShown = revealed || value.length > 0 || attempts > 0;
  const caption = showHint ? fmt(t(S.hint), { hint }) : t(S.touchId);

  return (
    <div
      className={styles.root}
      data-mode={mode}
      data-unlocking={unlocking || undefined}
      style={{ zIndex: Z.LOCK }}
      role="dialog"
      aria-modal="true"
      aria-label={t(mode === 'login' ? S.login : S.locked)}
    >
      <LockBackdrop clear={unlocking} />
      <div className={styles.scrim} style={{ background: `rgba(0, 0, 0, ${scrim.toFixed(3)})` }} aria-hidden="true" />

      <div className={styles.ui}>
        <StatusIcons />

        <header className={styles.clockArea}>
          <LockClock />
        </header>

        <div className={styles.user}>
          <button
            type="button"
            className={styles.userButton}
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => {
              setRevealed(true);
              inputRef.current?.focus();
            }}
          >
            <Avatar src={avatar} name={fullName} />
            <span className={styles.name}>{fullName}</span>
          </button>

          <form ref={formRef} className={styles.form} data-hidden={!fieldShown || undefined} onSubmit={submit} autoComplete="off">
            <div ref={fieldRef} className={`lg lg-clear lg-capsule ${styles.field}`} data-caps={capsLock || undefined}>
              {/* The data-*ignore attributes keep browser/extension password managers out of this simulated OS password field. */}
              <input
                ref={inputRef}
                className={styles.input}
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  setValue('');
                  setRevealed(false);
                }}
                placeholder={t(S.enterPassword)}
                aria-label={t(S.password)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
                autoFocus
                disabled={unlocking}
              />
              {capsLock && (
                <span className={styles.caps} role="img" aria-label={t(S.capsLock)} title={t(S.capsLock)}>
                  ⇪
                </span>
              )}
              <button
                type="submit"
                className={`lg lg-flat lg-circle lg-interactive ${styles.go} ${showArrow ? styles.goVisible : ''}`}
                aria-label={t(mode === 'login' ? S.logIn : S.unlock)}
                title={t(mode === 'login' ? S.logIn : S.unlock)}
                tabIndex={showArrow ? 0 : -1}
                disabled={unlocking}
              >
                <ArrowRight size={14} strokeWidth={2.6} />
              </button>
            </div>
            {canShowHint && (
              <button
                type="button"
                className={`lg lg-clear lg-circle lg-interactive ${styles.hintBtn}`}
                aria-label={t(S.showHint)}
                aria-pressed={showHint}
                title={t(S.showHint)}
                onClick={() => {
                  setHintShown((v) => !v);
                  inputRef.current?.focus();
                }}
              >
                ?
              </button>
            )}
          </form>
          <div className={styles.caption} aria-live="polite">
            {caption}
          </div>
          <div className={styles.srOnly} role="status">
            {attempts > 0 ? `${t(S.incorrect)} (${attempts})` : ''}
          </div>
        </div>

      </div>
    </div>
  );
}

/**
 * Derives up to two initials from a full name for the avatar placeholder.
 *
 * A single word yields its first two characters; several words yield the first character of the
 * first and the last word. Names are split by code point, so surrogate pairs stay intact. A blank
 * name yields '?'.
 *
 * @param {string} name - The user's full name.
 * @returns {string} The upper-cased initials.
 *
 * @example
 * initials('Jane Q. Doe'); // 'JD'
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const chars = parts.length === 1 ? [...parts[0]].slice(0, 2) : [[...parts[0]][0], [...parts[parts.length - 1]][0]];
  return chars.join('').toUpperCase();
}

/**
 * Circular user picture.
 *
 * `src` is resolved with
 * `useImageURL` (public asset or virtual FS image). When there is no URL or the image fails to
 * load, the user's initials are shown instead; the failure is remembered per URL, so a new
 * picture is tried again.
 *
 * @param {Object} props - Component props.
 * @param {string} props.src - Avatar setting: a public asset path or a virtual FS path.
 * @param {string} props.name - Full name used for the initials fallback.
 * @returns {JSX.Element} The avatar.
 *
 * @example
 * <Avatar src="/Users/guest/Pictures/me.png" name="Jane Doe" />
 */
function Avatar({ src, name }: { src: string; name: string }) {
  const url = useImageURL(src);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === url;
  return (
    <span className={styles.avatar}>
      {url && !failed ? <img src={url} alt="" draggable={false} onError={() => setFailedUrl(url)} /> : <span>{initials(name)}</span>}
    </span>
  );
}

/* ───────────────────────── Clock ───────────────────────── */

/**
 * Returns the current time, re-rendering once per second.
 *
 * Every tick schedules the next one at the following second boundary (plus 8 ms), so the
 * displayed minute flips exactly on time instead of drifting. The timer is cleared on unmount.
 *
 * @returns {Date} The current date and time.
 *
 * @example
 * const now = useNow();
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id = 0;
    /**
     * Schedules the next clock tick at the next second boundary.
     *
     * Updates `now` when the timer fires and then schedules itself again; the latest timer id is
     * kept so the effect cleanup can cancel it.
     *
     * @returns {void}
     *
     * @example
     * schedule();
     */
    const schedule = () => {
      id = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 1000 - (Date.now() % 1000) + 8);
    };
    schedule();
    return () => clearTimeout(id);
  }, []);
  return now;
}

/**
 * Formats the large lock screen time.
 *
 * 24-hour clocks pad the hour to two digits ("09:05"); 12-hour clocks show the hour without
 * padding and without an AM/PM suffix ("9:05", midnight and noon as "12").
 *
 * @param {Date} d - The time to format.
 * @param {boolean} h24 - Whether the 24-hour clock setting is on.
 * @returns {string} The formatted hours and minutes.
 *
 * @example
 * formatLockTime(new Date(2024, 0, 1, 21, 5), false); // '9:05'
 */
function formatLockTime(d: Date, h24: boolean): string {
  const m = String(d.getMinutes()).padStart(2, '0');
  const h = d.getHours();
  return h24 ? `${String(h).padStart(2, '0')}:${m}` : `${h % 12 || 12}:${m}`;
}

/**
 * Formats the date line above the lock screen clock.
 *
 * Uses Intl.DateTimeFormat with the weekday, month and day in the OS locale (ko-KR or en-US).
 *
 * @param {Date} d - The date to format.
 * @param {Locale} locale - The current OS locale.
 * @returns {string} The localized date, e.g. "Monday, January 1".
 *
 * @example
 * formatLockDate(new Date(2024, 0, 1), 'en'); // 'Monday, January 1'
 */
function formatLockDate(d: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}

/**
 * Date and large time display of the lock screen.
 *
 * Ticks every second via `useNow` and follows the locale and 24-hour clock settings. The time is
 * drawn as Liquid Glass digits by GlassClock, which refracts and frosts the desktop picture.
 *
 * @returns {JSX.Element} The date line and the glass clock.
 *
 * @example
 * <header><LockClock /></header>
 */
function LockClock() {
  const now = useNow();
  const locale = useLocale();
  const h24 = useSystem((s) => s.settings.clock24h);
  const wallpaper = useWallpaperURL();
  return (
    <>
      <div className={styles.date}>{formatLockDate(now, locale)}</div>
      <GlassClock text={formatLockTime(now, h24)} wallpaper={wallpaper} dateTime={now.toISOString()} />
    </>
  );
}

/* ───────────────────────── Status icons (top right) ───────────────────────── */

/** The part of the Battery Status API's BatteryManager read by the status icons. */
interface BatteryLike extends EventTarget {
  /** Charge level from 0 to 1. */
  level: number;
  /** Whether the battery is charging. */
  charging: boolean;
}

/**
 * Subscribes to the Battery Status API.
 *
 * Returns null where `navigator.getBattery` is unavailable or rejects, and until the first
 * reading arrives. Afterwards the level and charging state follow the battery's `levelchange`
 * and `chargingchange` events. Listeners are removed on unmount, and a promise that resolves
 * after unmount is ignored.
 *
 * @returns {{ level: number; charging: boolean } | null} Charge level (0–1) and charging state, or null.
 *
 * @example
 * const battery = useBattery();
 * if (battery) console.log(Math.round(battery.level * 100));
 */
function useBattery(): { level: number; charging: boolean } | null {
  const [state, setState] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery !== 'function') return;
    let battery: BatteryLike | null = null;
    let alive = true;
    /**
     * Copies the battery's current level and charging state into React state.
     *
     * Does nothing until the BatteryManager has been obtained.
     *
     * @returns {void}
     *
     * @example
     * b.addEventListener('levelchange', update);
     */
    const update = () => battery && setState({ level: battery.level, charging: battery.charging });
    nav
      .getBattery()
      .then((b) => {
        if (!alive) return;
        battery = b;
        update();
        b.addEventListener('levelchange', update);
        b.addEventListener('chargingchange', update);
      })
      .catch(() => {});
    return () => {
      alive = false;
      battery?.removeEventListener('levelchange', update);
      battery?.removeEventListener('chargingchange', update);
    };
  }, []);
  return state;
}

/**
 * Status icons in the top-right corner of the login / lock screen.
 *
 * Shows the current input source ('한' for Korean, 'A' otherwise), a battery gauge when the
 * Battery Status API is available (filled red at or below 20% while not charging, with a bolt
 * while charging) and the Wi-Fi state from the system settings.
 *
 * @returns {JSX.Element} The status icon row.
 *
 * @example
 * <StatusIcons />
 */
function StatusIcons() {
  const t = useT();
  const locale = useLocale();
  const wifi = useSystem((s) => s.settings.wifi);
  const battery = useBattery();
  const pct = battery ? Math.round(battery.level * 100) : 0;
  return (
    <div className={styles.status}>
      <span className={styles.inputSource} aria-hidden="true">
        {locale === 'ko' ? '한' : 'A'}
      </span>
      {battery && (
        <span className={styles.battery} role="img" aria-label={fmt(t(S.battery), { pct })} title={fmt(t(S.battery), { pct })}>
          <svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true">
            <rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.55" />
            <rect x="2" y="2" width={Math.max(1.5, 18 * battery.level)} height="8" rx="1.6" fill={battery.level <= 0.2 && !battery.charging ? '#ff453a' : 'currentColor'} />
            <path d="M23 4v4c.8-.3 1.3-1.1 1.3-2S23.8 4.3 23 4z" fill="currentColor" fillOpacity="0.55" />
            {battery.charging && <path d="M12.3 1.8 7.6 6.6h3l-1 3.6 4.7-4.8h-3z" fill="#fff" stroke="#000" strokeOpacity="0.35" strokeWidth="0.5" />}
          </svg>
        </span>
      )}
      <span role="img" aria-label={t(wifi ? S.wifiOn : S.wifiOff)} title={t(wifi ? S.wifiOn : S.wifiOff)}>
        {wifi ? <Wifi size={15} strokeWidth={2.2} /> : <WifiOff size={15} strokeWidth={2.2} />}
      </span>
    </div>
  );
}

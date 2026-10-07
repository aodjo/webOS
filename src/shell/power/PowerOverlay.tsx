/**
 * Full-screen visuals for the power states that are not a "screen" of their own:
 *  - off                               → black, power glyph, any key / click powers on
 *  - sleep                             → fades to black, any input wakes (to the lock screen)
 *  - shuttingDown / restarting / loggingOut → the screen fades to black (with a spinner for
 *    shut down / restart) while the kernel tears the session down.
 *
 * When one of these starts at the login window (not inside a session), the blurred wallpaper is
 * kept underneath the fade so the empty desktop mounted behind never flashes through.
 */
import { useEffect, useRef, useState } from 'react';
import { Power } from 'lucide-react';
import { useSystem } from '@/kernel/system';
import { REQUIRE_PASSWORD_DELAYS, usePrefs } from '@/apps/settings/prefs';
import { useT } from '@/kernel/i18n';
import type { PowerState } from '@/kernel/types';
import { Z } from '../layers';
import { LockBackdrop } from './LockBackdrop';
import { startedOutsideSession } from './session';
import styles from './PowerOverlay.module.css';

const S = {
  pressToStart: { en: 'Press any key or click to start', ko: '아무 키나 누르거나 클릭하여 시작하십시오' },
  powerOn: { en: 'Turn On', ko: '켜기' },
  asleep: { en: 'Sleeping. Press any key to wake.', ko: '잠자는 중입니다. 아무 키나 눌러 깨우십시오.' },
  shuttingDown: { en: 'Shutting down…', ko: '시스템 종료 중…' },
  restarting: { en: 'Restarting…', ko: '재시동 중…' },
  loggingOut: { en: 'Logging out…', ko: '로그아웃 중…' },
}; /** Localized strings for the power overlays. */

const INPUT_GRACE_MS = 700; /** Time (ms) after entering a state during which input is ignored, so the click or key that caused the state doesn't undo it. */
const WAKE_MOVE_PX = 24; /** Total mouse travel (px) that wakes the display from sleep. */

/**
 * Full-screen overlay for the power states that are not a screen of their own.
 *
 * Renders the "off" screen for 'off', the sleeping display for 'sleep' and the fade to black for
 * 'shuttingDown', 'restarting' and 'loggingOut'. Every other power state renders nothing.
 *
 * @param {Object} props - Component props.
 * @param {PowerState} props.power - The current power state.
 * @param {() => void} props.onWake - Called when input wakes a sleeping session that requires the password again.
 * @param {() => void} props.onPowerOn - Called when input powers the machine on from 'off'.
 * @returns {JSX.Element | null} The overlay for the state, or null.
 *
 * @example
 * <PowerOverlay power={power} onWake={() => setPower('locked')} onPowerOn={powerActions.powerOn} />
 */
export function PowerOverlay({ power, onWake, onPowerOn }: { power: PowerState; onWake: () => void; onPowerOn: () => void }) {
  switch (power) {
    case 'off':
      return <OffScreen onPowerOn={onPowerOn} />;
    case 'sleep':
      return <SleepScreen onWake={onWake} />;
    case 'shuttingDown':
    case 'restarting':
    case 'loggingOut':
      return <FadeToBlack kind={power} />;
    default:
      return null;
  }
}

const PAGE_KEYS = /^(.|Enter|Tab|Backspace|Delete|Escape|Arrow\w+)$/; /** Keys whose default action would do something on the page (typing, focus moves, scrolling…). */

/**
 * Calls a handler once on the first key press or click (and optionally mouse movement).
 *
 * Listens on the window in the capture phase. Input is only accepted after INPUT_GRACE_MS, and
 * the handler fires at most once per mount (or per change of `wakeOnMove`). Every key press is
 * swallowed: propagation stops so it never reaches the inert session behind, and the default
 * action of PAGE_KEYS is prevented unless ⌘, ⌃ or ⌥ is held, so browser shortcuts (⌘R, F11…)
 * keep working. Pointer presses are swallowed too. With `wakeOnMove`, more than WAKE_MOVE_PX of
 * accumulated pointer travel also fires. The latest `handler` is always the one called.
 *
 * @param {() => void} handler - Called on the first accepted input.
 * @param {{ wakeOnMove?: boolean }} [opts={}] - Options.
 * @param {boolean} [opts.wakeOnMove=false] - Whether pointer movement also fires the handler.
 * @returns {void}
 *
 * @example
 * useAnyInput(onPowerOn);
 * useAnyInput(wake, { wakeOnMove: true });
 */
function useAnyInput(handler: () => void, opts: { wakeOnMove?: boolean } = {}) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  const { wakeOnMove = false } = opts;

  useEffect(() => {
    let fired = false;
    let armed = false;
    let travelled = 0;
    let last: { x: number; y: number } | null = null;
    /**
     * Calls the current handler, once, if the grace period has passed.
     *
     * Does nothing until the INPUT_GRACE_MS timer has armed the listeners, and nothing after the
     * first call; the handler is read from the ref, so the latest one passed to the hook runs.
     *
     * @returns {void}
     *
     * @example
     * fire();
     */
    const fire = () => {
      if (!armed || fired) return;
      fired = true;
      ref.current();
    };
    /**
     * Swallows a key press and fires the handler.
     *
     * Stops propagation, and prevents the default action of PAGE_KEYS when no ⌘ / ⌃ / ⌥ modifier
     * is held.
     *
     * @param {KeyboardEvent} e - The captured keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKey, true);
     */
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (!e.metaKey && !e.ctrlKey && !e.altKey && PAGE_KEYS.test(e.key)) e.preventDefault();
      fire();
    };
    /**
     * Swallows a pointer press and fires the handler.
     *
     * Prevents the press's default action (focus changes, text selection) so it has no effect on
     * the page behind, then calls `fire`, which ignores presses during the grace period.
     *
     * @param {PointerEvent} e - The captured pointerdown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerdown', onPointerDown, true);
     */
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      fire();
    };
    /**
     * Accumulates pointer travel and fires the handler past WAKE_MOVE_PX.
     *
     * Movement before the grace period ends is not counted.
     *
     * @param {PointerEvent} e - The captured pointermove event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointermove', onMove, true);
     */
    const onMove = (e: PointerEvent) => {
      if (!armed) return;
      if (last) travelled += Math.hypot(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
      if (travelled > WAKE_MOVE_PX) fire();
    };
    const timer = window.setTimeout(() => {
      armed = true;
    }, INPUT_GRACE_MS);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    if (wakeOnMove) window.addEventListener('pointermove', onMove, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onMove, true);
    };
  }, [wakeOnMove]);
}

/**
 * Black "powered off" screen with a breathing power glyph.
 *
 * Any key press or click (after the input grace period) calls `onPowerOn`.
 *
 * @param {Object} props - Component props.
 * @param {() => void} props.onPowerOn - Called when input powers the machine on.
 * @returns {JSX.Element} The off screen.
 *
 * @example
 * <OffScreen onPowerOn={powerActions.powerOn} />
 */
function OffScreen({ onPowerOn }: { onPowerOn: () => void }) {
  const t = useT();
  useAnyInput(onPowerOn);
  return (
    <div className={`${styles.root} ${styles.off}`} style={{ zIndex: Z.POWER }} role="button" aria-label={t(S.powerOn)} tabIndex={-1}>
      <div className={styles.offContent}>
        <Power size={40} strokeWidth={1.6} className={styles.powerGlyph} aria-hidden="true" />
        <div className={styles.offText}>{t(S.pressToStart)}</div>
      </div>
    </div>
  );
}

/**
 * Sleeping display: fades to black and wakes on any input, including mouse movement.
 *
 * When sleep started at the login window, the blurred wallpaper stays underneath and waking
 * returns to the login window. Inside a session, waking within the "Require password after the
 * display sleeps" delay (System Settings → Lock Screen) goes straight back to the desktop;
 * otherwise `onWake` is called.
 *
 * @param {Object} props - Component props.
 * @param {() => void} props.onWake - Called when the wake requires the password again.
 * @returns {JSX.Element} The sleep overlay.
 *
 * @example
 * <SleepScreen onWake={() => setPower('locked')} />
 */
function SleepScreen({ onWake }: { onWake: () => void }) {
  const t = useT();
  const [atLogin] = useState(startedOutsideSession);
  const [sleptAt] = useState(() => Date.now());
  useAnyInput(() => {
    const { setPower } = useSystem.getState();
    if (atLogin) return setPower('login');
    const grace = REQUIRE_PASSWORD_DELAYS[usePrefs.getState().requirePasswordAfter] ?? 0;
    if (Date.now() - sleptAt < grace) setPower('desktop');
    else onWake();
  }, { wakeOnMove: true });
  return (
    <div className={`${styles.root} ${styles.sleep}`} style={{ zIndex: Z.POWER }} role="status" aria-label={t(S.asleep)}>
      {atLogin && <LockBackdrop />}
      <div className={styles.black} style={{ animationDuration: '400ms' }} />
    </div>
  );
}

/**
 * Fade to black shown while the session shuts down, restarts or logs out.
 *
 * Shut down and restart also show the 12-spoke spinner. When the transition started at the
 * login window, the blurred wallpaper stays underneath and the fade is shorter (450 ms instead of
 * 1000 ms).
 *
 * @param {Object} props - Component props.
 * @param {'shuttingDown' | 'restarting' | 'loggingOut'} props.kind - The transition in progress.
 * @returns {JSX.Element} The fade overlay.
 *
 * @example
 * <FadeToBlack kind="restarting" />
 */
function FadeToBlack({ kind }: { kind: 'shuttingDown' | 'restarting' | 'loggingOut' }) {
  const t = useT();
  const [atLogin] = useState(startedOutsideSession);
  return (
    <div className={`${styles.root} ${styles.busy}`} style={{ zIndex: Z.POWER }} role="status" aria-label={t(S[kind])}>
      {atLogin && <LockBackdrop />}
      <div className={styles.black} style={{ animationDuration: atLogin ? '450ms' : '1000ms' }} />
      {kind !== 'loggingOut' && <Spinner />}
    </div>
  );
}

/**
 * Classic 12-spoke activity indicator.
 *
 * Each spoke is rotated 30° further and slightly more opaque than the previous one; the CSS
 * rotates the whole indicator in 12 steps.
 *
 * @returns {JSX.Element} The spinner.
 *
 * @example
 * {busy && <Spinner />}
 */
function Spinner() {
  return (
    <div className={styles.spinner} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} style={{ transform: `rotate(${i * 30}deg)`, opacity: 0.18 + (i / 11) * 0.82 }} />
      ))}
    </div>
  );
}

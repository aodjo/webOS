/**
 * Boot screen shown while the OS starts: the owner's greeting decoding out of random characters,
 * then the logo and a progress bar on black, which fades out once the kernel reports the boot
 * I/O as done.
 */
import { useEffect, useRef, useState } from 'react';
import { owner } from '@/data/portfolio';
import { OSLogo } from '@/icons';
import { useSystem } from '@/kernel/system';
import { useT } from '@/kernel/i18n';
import { Z } from '../layers';
import { playStartupChime } from './chime';
import styles from './BootScreen.module.css';

const S = {
  starting: { en: 'Starting up', ko: '시동 중' },
}; /** Localized strings (the progress bar's accessible label). */

const FILL_MS = 2300; /** Time in ms for the bar to fill when nothing is holding it back. */
const START_DELAY_MS = 380; /** Time in ms the logo shows alone before the bar starts moving. */
const HOLD_AT = 0.85; /** Progress (0–1) the bar is capped at until the boot I/O is done. */
const MAX_SPEED = 1 / 0.5; /** Maximum catch-up speed in progress per second, so a late `ready` never makes the bar jump. */
const PAUSE_AT_END_MS = 260; /** Time in ms the full bar stays visible before the screen fades. */
const FADE_MS = 520; /** Duration in ms of the fade-out, after which `onDone` is called. */
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'; /** Characters cycled through while a greeting character is still scrambled. */
const SCRAMBLE_TICK_MS = 55; /** Time in ms between changes of a scrambled character. */
const DECODE_DELAY_MS = 450; /** Time in ms the greeting stays fully scrambled before the first character settles. */
const DECODE_STAGGER_MS = 38; /** Delay in ms between consecutive characters settling, left to right. */
const DECODE_JITTER_MS = 260; /** Upper bound in ms of the random extra delay added to each character. */
const GREETING_HOLD_MS = 900; /** Time in ms the decoded greeting stays before fading out. */
const GREETING_FADE_MS = 450; /** Duration in ms of the greeting's fade-out, after which the logo appears. */

/**
 * Picks a random character to show in place of a scrambled one.
 *
 * @returns {string} One character from `GLYPHS`.
 *
 * @example
 * randomGlyph(); // e.g. 'q'
 */
const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

/**
 * Plays the owner's greeting as if it were being decrypted, then reports completion.
 *
 * Every non-space character starts as a random glyph from `GLYPHS` that changes every
 * `SCRAMBLE_TICK_MS`. After `DECODE_DELAY_MS` the characters settle on their real value from
 * left to right, `DECODE_STAGGER_MS` apart plus a random jitter of up to `DECODE_JITTER_MS`.
 * Characters are written straight to the DOM from a `requestAnimationFrame` loop, so the effect
 * runs without re-rendering React; the rendered text is the first scramble, picked once, so a
 * re-render from the parent never overwrites characters that have already settled. Once all have settled, the greeting holds for
 * `GREETING_HOLD_MS`, fades out over `GREETING_FADE_MS` and calls `onDone` once. With reduced
 * motion the text is shown decoded right away. A pointer press or key press skips the effect.
 *
 * @param {Object} props - Component props.
 * @param {string} props.text - The greeting to decode.
 * @param {boolean} props.reduceMotion - Whether to skip the scramble and show the text as is.
 * @param {() => void} props.onDone - Called once after the greeting has faded out.
 * @returns {JSX.Element} The greeting line.
 *
 * @example
 * <DecodingGreeting text="Welcome!" reduceMotion={false} onDone={() => setPhase('running')} />
 */
function DecodingGreeting({ text, reduceMotion, onDone }: { text: string; reduceMotion: boolean; onDone: () => void }) {
  const chars = Array.from(text);
  const cellsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const settleAtRef = useRef<number[] | null>(null);
  const onDoneRef = useRef(onDone);
  const [fading, setFading] = useState(false);
  const [initial] = useState(() => chars.map((ch) => (ch === ' ' || reduceMotion ? ch : randomGlyph())));
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  settleAtRef.current ??= chars.map((_, i) => (reduceMotion ? 0 : DECODE_DELAY_MS + i * DECODE_STAGGER_MS + Math.random() * DECODE_JITTER_MS));

  useEffect(() => {
    if (fading) {
      const id = window.setTimeout(() => onDoneRef.current(), GREETING_FADE_MS);
      return () => clearTimeout(id);
    }
    const settleAt = settleAtRef.current!;
    const last = Math.max(0, ...settleAt);
    let raf = 0;
    let start: number | null = null;
    let lastTick = -1;
    let holdTimer = 0;

    /**
     * Updates the scrambled characters for one animation frame.
     *
     * Settled characters get their real value; the rest get a new random glyph whenever a new
     * scramble tick starts. When every character has settled the loop stops and the hold
     * timer before the fade-out starts.
     *
     * @param {number} now - The frame timestamp from `requestAnimationFrame`, in ms.
     * @returns {void}
     *
     * @example
     * raf = requestAnimationFrame(frame);
     */
    const frame = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      const tick = Math.floor(elapsed / SCRAMBLE_TICK_MS);
      chars.forEach((ch, i) => {
        const cell = cellsRef.current[i];
        if (!cell || ch === ' ') return;
        if (elapsed >= settleAt[i]) {
          if (cell.textContent !== ch) {
            cell.textContent = ch;
            cell.dataset.settled = '';
          }
        } else if (tick !== lastTick) cell.textContent = randomGlyph();
      });
      lastTick = tick;
      if (elapsed >= last) {
        holdTimer = window.setTimeout(() => setFading(true), GREETING_HOLD_MS);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    /**
     * Skips the rest of the greeting when the visitor presses a key or the pointer.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', skip);
     */
    const skip = () => setFading(true);
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(holdTimer);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [fading]);

  return (
    <p className={`${styles.greeting} ${fading ? styles.fading : ''}`} style={{ transitionDuration: `${GREETING_FADE_MS}ms` }} aria-label={text}>
      {chars.map((_, i) => (
        <span key={i} ref={(el) => void (cellsRef.current[i] = el)} className={styles.glyph} aria-hidden="true">
          {initial[i]}
        </span>
      ))}
    </p>
  );
}

/**
 * Sinusoidal ease-in-out curve.
 *
 * Maps linear time to `0.5 - cos(π·x) / 2`, giving the bar's time-based target a gentle
 * start and finish. Inputs outside 0–1 are not clamped.
 *
 * @param {number} x - Linear progress, 0–1.
 * @returns {number} Eased progress, 0–1 (slow at both ends, fastest in the middle).
 *
 * @example
 * easeInOutSine(0.5); // 0.5
 * easeInOutSine(0.25); // ≈ 0.146
 */
const easeInOutSine = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;

/**
 * Full-screen boot screen: the owner's greeting, then the OS logo and a progress bar on black.
 *
 * When `owner.bootGreeting` is set, it first plays `DecodingGreeting` and shows the logo only
 * after the greeting has faded out. The startup chime plays once, together with the logo, when
 * the startup sound setting is on. The bar is
 * animated by a `requestAnimationFrame` loop that writes its transform and `aria-valuenow`
 * straight to the DOM, so it moves at display rate without re-rendering React. It eases
 * towards a time-based target, is capped at `HOLD_AT` until `ready` is true, then catches up
 * at no more than `MAX_SPEED`. Once full, the screen pauses for `PAUSE_AT_END_MS`, fades out
 * over `FADE_MS` and calls `onDone` exactly once. Animation progress lives in refs, which
 * survive StrictMode's mount → unmount → mount, so the bar resumes instead of restarting.
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.ready - Whether the boot I/O has finished; releases the bar past `HOLD_AT`.
 * @param {() => void} props.onDone - Called once after the fade-out completes.
 * @returns {JSX.Element} The boot screen overlay.
 *
 * @example
 * {power === 'booting' && <BootScreen ready={bootReady} onDone={() => setPower('login')} />}
 */
export function BootScreen({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const t = useT();
  const fillRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(ready);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    readyRef.current = ready;
    onDoneRef.current = onDone;
  }, [ready, onDone]);

  const startRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const doneCalled = useRef(false);
  const chimed = useRef(false);

  const greeting = owner.bootGreeting.trim();
  const reduceMotion = useSystem((st) => st.settings.reduceMotion);
  const [phase, setPhase] = useState<'greeting' | 'running' | 'complete' | 'fading'>(greeting ? 'greeting' : 'running');

  useEffect(() => {
    if (phase === 'greeting' || chimed.current) return;
    chimed.current = true;
    const { startupSound, volume } = useSystem.getState().settings;
    if (startupSound) playStartupChime(volume);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    let raf = 0;
    let last: number | null = null;
    let lastAria = -1;

    /**
     * Advances the progress bar by one animation frame.
     *
     * All timing uses the frame timestamps (one clock), measured from the first frame. The
     * time-based target is held at `HOLD_AT` until `ready`, and progress moves towards it at
     * no more than `MAX_SPEED` (frame steps are capped at 50 ms). The fill transform and
     * `aria-valuenow` are written directly to the DOM, the latter only when the rounded
     * percentage changes. When the bar is full and the boot is ready, the phase becomes
     * `complete` and the loop stops; otherwise the next frame is scheduled.
     *
     * @param {number} now - The frame timestamp from `requestAnimationFrame`, in ms.
     * @returns {void}
     *
     * @example
     * raf = requestAnimationFrame(frame);
     */
    const frame = (now: number) => {
      startRef.current ??= now;
      const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const elapsed = now - startRef.current - START_DELAY_MS;
      let target = elapsed <= 0 ? 0 : easeInOutSine(Math.min(1, elapsed / FILL_MS));
      if (!readyRef.current) target = Math.min(target, HOLD_AT);

      const p = progressRef.current;
      const next = target > p ? p + Math.min(target - p, MAX_SPEED * dt) : p;
      progressRef.current = next;
      if (fillRef.current) fillRef.current.style.transform = `translateX(${(next - 1) * 100}%)`;
      const pct = Math.round(next * 100);
      if (pct !== lastAria && barRef.current) {
        barRef.current.setAttribute('aria-valuenow', String(pct));
        lastAria = pct;
      }

      if (next >= 0.9995 && readyRef.current) {
        setPhase('complete');
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (phase === 'complete') {
      const id = window.setTimeout(() => setPhase('fading'), PAUSE_AT_END_MS);
      return () => clearTimeout(id);
    }
    if (phase === 'fading') {
      const id = window.setTimeout(() => {
        if (doneCalled.current) return;
        doneCalled.current = true;
        onDoneRef.current();
      }, FADE_MS);
      return () => clearTimeout(id);
    }
  }, [phase]);

  if (phase === 'greeting') {
    return (
      <div className={styles.root} style={{ zIndex: Z.POWER }}>
        <DecodingGreeting text={greeting} reduceMotion={reduceMotion} onDone={() => setPhase('running')} />
      </div>
    );
  }

  return (
    <div className={styles.root} style={{ zIndex: Z.POWER }}>
      <div className={`${styles.content} ${phase === 'fading' ? styles.fading : ''}`} style={{ transitionDuration: `${FADE_MS}ms` }}>
        <div className={styles.logo}>
          <OSLogo size={80} color="#fff" />
        </div>
        <div ref={barRef} className={styles.track} role="progressbar" aria-label={t(S.starting)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
          <div ref={fillRef} className={styles.fill} />
        </div>
      </div>
    </div>
  );
}

/**
 * Boot screen shown while the OS starts: a progress bar on black under the owner's greeting,
 * which scrambles into random characters, collapses to the logo's size and turns into the logo.
 * The screen fades out once the kernel reports the boot I/O as done.
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
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'; /** Characters cycled through while a greeting character is scrambled. */
const SCRAMBLE_TICK_MS = 45; /** Time in ms between changes of a scrambled character. */
const GREETING_READ_MS = 600; /** Time in ms the greeting stays readable before it starts to scramble. */
const SCRAMBLE_SPREAD_MS = 280; /** Window in ms over which the characters start scrambling, in random order. */
const COLLAPSE_START_MS = 850; /** Time in ms at which scrambled characters start dropping out. */
const COLLAPSE_MS = 520; /** Time in ms over which characters drop out, from the ends towards the middle. */
const KEEP_CHARS = 5; /** Number of middle characters left when the greeting reaches the logo's size. */
const MORPH_AT_MS = 1450; /** Time in ms at which the leftover characters give way to the logo. */

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
 * The owner's greeting, scrambling and collapsing into the logo's place.
 *
 * The greeting is first shown as is. After `GREETING_READ_MS` its characters start scrambling
 * in random order (spread over `SCRAMBLE_SPREAD_MS`) into random glyphs from `GLYPHS` that change
 * every `SCRAMBLE_TICK_MS`. From `COLLAPSE_START_MS` the characters drop out over `COLLAPSE_MS`,
 * farthest from the middle first, until `KEEP_CHARS` remain, about as wide as the logo. At
 * `MORPH_AT_MS` the rest fades away and `onMorph` is called so the logo can appear in its place.
 * Characters are written straight to the DOM from a `requestAnimationFrame` loop; the rendered
 * text is picked once, so a re-render from the parent never undoes those writes. The schedule
 * lives in refs, so StrictMode's remount continues it instead of restarting.
 *
 * @param {Object} props - Component props.
 * @param {string} props.text - The greeting to show.
 * @param {() => void} props.onMorph - Called once when the logo should take over.
 * @returns {JSX.Element} The greeting line.
 *
 * @example
 * <GreetingMorph text="Welcome!" onMorph={() => setLogoShown(true)} />
 */
function GreetingMorph({ text, onMorph }: { text: string; onMorph: () => void }) {
  const [chars] = useState(() => Array.from(text));
  const cellsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const onMorphRef = useRef(onMorph);
  const startRef = useRef<number | null>(null);
  const [morphing, setMorphing] = useState(false);
  useEffect(() => {
    onMorphRef.current = onMorph;
  }, [onMorph]);

  const [schedule] = useState(() => {
    const n = chars.length;
    const mid = (n - 1) / 2;
    const order = chars.map((_, i) => i).sort((x, y) => Math.abs(y - mid) - Math.abs(x - mid));
    const drops = Math.max(0, n - KEEP_CHARS);
    const goneAt = new Array<number>(n).fill(Infinity);
    order.slice(0, drops).forEach((i, rank) => (goneAt[i] = COLLAPSE_START_MS + (rank / Math.max(1, drops)) * COLLAPSE_MS));
    const scrambleAt = chars.map(() => GREETING_READ_MS + Math.random() * SCRAMBLE_SPREAD_MS);
    return { scrambleAt, goneAt };
  });

  useEffect(() => {
    if (morphing) return;
    let raf = 0;
    let lastTick = -1;

    /**
     * Advances the scramble and collapse by one animation frame.
     *
     * Hides characters whose drop time has passed, gives scrambling characters a new random
     * glyph on every new scramble tick, and switches to the morph once `MORPH_AT_MS` is reached.
     *
     * @param {number} now - The frame timestamp from `requestAnimationFrame`, in ms.
     * @returns {void}
     *
     * @example
     * raf = requestAnimationFrame(frame);
     */
    const frame = (now: number) => {
      startRef.current ??= now;
      const elapsed = now - startRef.current;
      const tick = Math.floor(elapsed / SCRAMBLE_TICK_MS);
      chars.forEach((ch, i) => {
        const cell = cellsRef.current[i];
        if (!cell) return;
        if (elapsed >= schedule.goneAt[i]) {
          if (!('gone' in cell.dataset)) cell.dataset.gone = '';
        } else if (ch !== ' ' && elapsed >= schedule.scrambleAt[i] && tick !== lastTick) {
          cell.textContent = randomGlyph();
          cell.dataset.scrambled = '';
        }
      });
      lastTick = tick;
      if (elapsed >= MORPH_AT_MS) {
        setMorphing(true);
        onMorphRef.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [chars, schedule, morphing]);

  return (
    <p className={`${styles.greeting} ${morphing ? styles.morphing : ''}`} aria-label={text}>
      {chars.map((ch, i) => (
        <span key={i} ref={(el) => void (cellsRef.current[i] = el)} className={styles.glyph} aria-hidden="true">
          {ch === ' ' ? '\u00a0' : ch}
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
 * Full-screen boot screen with the OS logo and a progress bar on black.
 *
 * When `owner.bootGreeting` is set (and Reduce Motion is off), `GreetingMorph` plays in the
 * logo's place first and the logo appears when it morphs; the bar's fill time is stretched by
 * `MORPH_AT_MS` so the logo still shows for a while before the screen fades. The startup chime
 * plays once, together with the logo, when the startup sound setting is on. The bar is
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

  const reduceMotion = useSystem((st) => st.settings.reduceMotion);
  const [greeting] = useState(() => (reduceMotion ? '' : owner.bootGreeting.trim()));
  const [logoShown, setLogoShown] = useState(!greeting);
  const fillMs = FILL_MS + (greeting ? MORPH_AT_MS : 0);
  const [phase, setPhase] = useState<'running' | 'complete' | 'fading'>('running');

  useEffect(() => {
    if (!logoShown || chimed.current) return;
    chimed.current = true;
    const { startupSound, volume } = useSystem.getState().settings;
    if (startupSound) playStartupChime(volume);
  }, [logoShown]);

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
      let target = elapsed <= 0 ? 0 : easeInOutSine(Math.min(1, elapsed / fillMs));
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
  }, [phase, fillMs]);

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

  return (
    <div className={styles.root} style={{ zIndex: Z.POWER }}>
      <div className={`${styles.content} ${phase === 'fading' ? styles.fading : ''}`} style={{ transitionDuration: `${FADE_MS}ms` }}>
        <div className={styles.logoSlot}>
          {greeting && <GreetingMorph text={greeting} onMorph={() => setLogoShown(true)} />}
          {logoShown && (
            <div className={styles.logo}>
              <OSLogo size={80} color="#fff" />
            </div>
          )}
        </div>
        <div ref={barRef} className={styles.track} role="progressbar" aria-label={t(S.starting)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
          <div ref={fillRef} className={styles.fill} />
        </div>
      </div>
    </div>
  );
}

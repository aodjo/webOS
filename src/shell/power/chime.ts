/**
 * Startup chime, synthesized with Web Audio (no audio assets).
 *
 * Browsers only allow audio after a user gesture, so on a cold page load the chime is skipped
 * silently; after Restart / power-on (which are clicks or key presses) it plays.
 */

/** Constructor of the Web Audio context (standard or WebKit-prefixed). */
type AudioCtor = typeof AudioContext;

/**
 * Finds the Web Audio context constructor.
 *
 * Prefers the standard `AudioContext` and falls back to the WebKit-prefixed one. Returns null
 * outside a browser or when Web Audio is unsupported.
 *
 * @returns {AudioCtor | null} The AudioContext constructor, or null.
 *
 * @example
 * const Ctor = audioCtor();
 * if (Ctor) new Ctor();
 */
function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Tells whether the page may start audio without being blocked.
 *
 * Uses `navigator.userActivation.hasBeenActive` (the page has received a user gesture). Browsers
 * without the User Activation API are assumed to allow audio.
 *
 * @returns {boolean} True when audio can start.
 *
 * @example
 * if (canPlayAudio()) playStartupChime(0.8);
 */
function canPlayAudio(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

const CHIME_NOTES = [92.5, 185.0, 277.18, 369.99, 466.16]; /** Frequencies (Hz) of the warm F♯-major chord played by the startup chime. */
const CHIME_LENGTH = 3.2; /** Duration of the chime in seconds, from attack to the end of the tail. */

/**
 * Plays the startup chime.
 *
 * Builds a short Web Audio graph: two voices per note of CHIME_NOTES (detuned by ±6 cents to
 * widen the chord; a sine for the root, triangles above it), each with a soft 35 ms attack, a
 * decay to 45% by 0.6 s and a long exponential tail, all through a low-pass filter that closes
 * from 2600 Hz to 900 Hz into a master gain scaled by `volume`. The context is resumed if it
 * starts suspended and closed shortly after the chime ends. Nothing plays when the volume is
 * zero, Web Audio is unavailable or the page has not had a user gesture yet; audio errors are
 * swallowed.
 *
 * @param {number} volume - Output volume from 0 to 1 (values above 1 are clamped).
 * @returns {void}
 *
 * @example
 * if (startupSound) playStartupChime(volume);
 */
export function playStartupChime(volume: number): void {
  if (volume <= 0 || !canPlayAudio()) return;
  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const t0 = ctx.currentTime + 0.05;

    const master = ctx.createGain();
    master.gain.value = Math.min(1, volume) * 0.32;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, t0);
    filter.frequency.exponentialRampToValueAtTime(900, t0 + CHIME_LENGTH);
    filter.connect(master);
    master.connect(ctx.destination);

    CHIME_NOTES.forEach((freq, i) => {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const env = ctx.createGain();
        const peak = (i === 0 ? 0.5 : 0.22) / 2;
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(peak, t0 + 0.035);
        env.gain.exponentialRampToValueAtTime(peak * 0.45, t0 + 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + CHIME_LENGTH);
        osc.connect(env).connect(filter);
        osc.start(t0);
        osc.stop(t0 + CHIME_LENGTH + 0.05);
      }
    });

    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    window.setTimeout(() => void ctx.close().catch(() => {}), (CHIME_LENGTH + 0.4) * 1000);
  } catch {
    /* Audio is optional: a failure to build the graph leaves the boot silent. */
  }
}

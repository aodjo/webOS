/**
 * Alert sounds, synthesized with Web Audio. Each sound is a few short tones with an exponential
 * decay envelope; `playAlertSound` is only called from user gestures, so audio is never blocked.
 */

/** One oscillator note within an alert sound. */
interface Tone {
  /** Start offset (s). */
  at: number;
  /** Duration (s). */
  dur: number;
  /** Start frequency (Hz). */
  from: number;
  /** Frequency (Hz) to glide to exponentially by the end of the tone. */
  to?: number;
  /** Oscillator waveform (default `sine`). */
  type?: OscillatorType;
  /** Peak envelope gain (default 0.8). */
  gain?: number;
}

/** A selectable alert sound. */
export interface AlertSound {
  id: string;
  name: string;
  tones: Tone[];
}

export const ALERT_SOUNDS: AlertSound[] = [
  { id: 'boop', name: 'Boop', tones: [{ at: 0, dur: 0.18, from: 640, to: 420 }] },
  {
    id: 'breeze',
    name: 'Breeze',
    tones: [
      { at: 0, dur: 0.42, from: 700, to: 1060, gain: 0.55 },
      { at: 0.04, dur: 0.4, from: 1400, to: 2120, gain: 0.16 },
    ],
  },
  {
    id: 'bubble',
    name: 'Bubble',
    tones: [
      { at: 0, dur: 0.11, from: 320, to: 980 },
      { at: 0.09, dur: 0.12, from: 520, to: 1300, gain: 0.55 },
    ],
  },
  {
    id: 'crystal',
    name: 'Crystal',
    tones: [
      { at: 0, dur: 0.8, from: 1568, gain: 0.45 },
      { at: 0, dur: 0.7, from: 2349, gain: 0.2 },
      { at: 0.07, dur: 0.6, from: 3136, gain: 0.12 },
    ],
  },
  {
    id: 'funk',
    name: 'Funk',
    tones: [
      { at: 0, dur: 0.09, from: 220, type: 'square', gain: 0.18 },
      { at: 0.11, dur: 0.14, from: 330, type: 'square', gain: 0.18 },
    ],
  },
  { id: 'pebble', name: 'Pebble', tones: [{ at: 0, dur: 0.09, from: 1250, to: 820, type: 'triangle' }] },
  {
    id: 'pluck',
    name: 'Pluck',
    tones: [
      { at: 0, dur: 0.32, from: 880, type: 'triangle' },
      { at: 0, dur: 0.22, from: 1760, gain: 0.18 },
    ],
  },
  {
    id: 'pong',
    name: 'Pong',
    tones: [
      { at: 0, dur: 0.1, from: 980, type: 'square', gain: 0.16 },
      { at: 0.13, dur: 0.15, from: 740, type: 'square', gain: 0.16 },
    ],
  },
  { id: 'sonar', name: 'Sonar', tones: [{ at: 0, dur: 0.95, from: 1046, to: 1010, gain: 0.6 }] },
  { id: 'submerge', name: 'Submerge', tones: [{ at: 0, dur: 0.5, from: 900, to: 170 }] },
]; /** Alert sounds offered in the Sound pane; the first one is the fallback for unknown ids. */

let ctx: AudioContext | null = null; /** Shared AudioContext, created lazily on first playback. */

/**
 * Returns the shared AudioContext, creating it on first use.
 *
 * Uses the standard `AudioContext` or the prefixed `webkitAudioContext`. When neither exists
 * or construction throws, null is returned (and creation is retried on the next call).
 *
 * @returns {AudioContext | null} The audio context, or null when Web Audio is unavailable.
 *
 * @example
 * const ac = context();
 * if (ac) console.log(ac.sampleRate);
 */
function context(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Plays an alert sound at the given volume.
 *
 * Unknown ids fall back to the first sound, and a volume of 0 or less plays nothing. Each
 * tone gets its own oscillator (with an optional exponential frequency glide) feeding a gain
 * envelope that attacks in 6 ms and decays exponentially to silence at the tone's end; all
 * envelopes share a master gain of `min(1, volume) * 0.5`. A suspended context is resumed
 * first, and the master node is disconnected shortly after the last tone ends. Any Web Audio
 * error is swallowed because sound is optional.
 *
 * @param {string} id - Id of an entry in `ALERT_SOUNDS`.
 * @param {number} volume - Output volume from 0 to 1.
 * @returns {void}
 *
 * @example
 * playAlertSound('pebble', 0.6);
 */
export function playAlertSound(id: string, volume: number): void {
  const sound = ALERT_SOUNDS.find((s) => s.id === id) ?? ALERT_SOUNDS[0];
  if (volume <= 0) return;
  const ac = context();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') void ac.resume().catch(() => {});
    const t0 = ac.currentTime + 0.01;
    const master = ac.createGain();
    master.gain.value = Math.min(1, volume) * 0.5;
    master.connect(ac.destination);
    let end = 0;
    for (const tone of sound.tones) {
      const osc = ac.createOscillator();
      osc.type = tone.type ?? 'sine';
      const start = t0 + tone.at;
      const stop = start + tone.dur;
      osc.frequency.setValueAtTime(tone.from, start);
      if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, stop);
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(tone.gain ?? 0.8, start + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, stop);
      osc.connect(env).connect(master);
      osc.start(start);
      osc.stop(stop + 0.02);
      end = Math.max(end, stop);
    }
    window.setTimeout(() => master.disconnect(), (end - ac.currentTime + 0.2) * 1000);
  } catch {
    /* Audio is optional. */
  }
}

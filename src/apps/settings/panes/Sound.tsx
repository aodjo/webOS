/**
 * Sound: output volume (with audible feedback), the alert sound and the startup chime.
 */
import { useEffect, useRef } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useSystem, useT } from '@/kernel';
import { CheckRow, LabeledSlider, onRadioGroupKeyDown, Pane, Row, Section, SwitchRow } from '../kit';
import { setPrefs, usePrefs } from '../prefs';
import { ALERT_SOUNDS, playAlertSound } from '../sounds';

const S = {
  output: { en: 'Output', ko: '출력' },
  outputVolume: { en: 'Output volume', ko: '출력 음량' },
  outputDevice: { en: 'Output device', ko: '출력 기기' },
  speakers: { en: 'Built-in Speakers', ko: '내장 스피커' },
  muted: { en: 'Muted', ko: '음소거됨' },
  effects: { en: 'Sound Effects', ko: '사운드 효과' },
  startup: { en: 'Play sound on startup', ko: '시동 시 사운드 재생' },
  feedback: { en: 'Play feedback when volume is changed', ko: '음량 변경 시 피드백 재생' },
  alertSound: { en: 'Alert Sound', ko: '경고음' },
  alertFooter: { en: 'Click a sound to hear it at the current output volume.', ko: '사운드를 클릭하면 현재 출력 음량으로 들을 수 있습니다.' },
}; /** Localized strings for the Sound pane. */

const FEEDBACK_DELAY_MS = 160; /** Milliseconds the volume slider must stay still before the feedback sound plays. */

/**
 * Renders the Sound settings pane.
 *
 * Shows the output volume slider (with a percentage or "Muted" sublabel and an end icon that
 * reflects the level), the output device (AirPods Pro when Bluetooth is on and they are
 * connected, otherwise the built-in speakers), switches for the startup chime and volume
 * feedback, and the alert sound list, where choosing a sound saves it and plays it at the current
 * volume. A pending feedback sound is cancelled on unmount.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <SoundPane />
 */
export function SoundPane() {
  const t = useT();
  const volume = useSystem((x) => x.settings.volume);
  const alertSound = useSystem((x) => x.settings.alertSound);
  const startupSound = useSystem((x) => x.settings.startupSound);
  const bluetooth = useSystem((x) => x.settings.bluetooth);
  const update = useSystem((x) => x.updateSettings);
  const airpods = usePrefs((p) => !!p.btConnected.airpods);
  const feedback = usePrefs((p) => p.volumeFeedback);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * Sets the output volume and plays audible feedback when enabled.
   *
   * Saves the volume immediately. When volume feedback is on, the current alert sound plays at
   * the new volume once the slider has been still for {@link FEEDBACK_DELAY_MS} ms; every change
   * restarts that delay, so a drag plays the sound only once, when it settles.
   *
   * @param {number} v - New volume from 0 to 1.
   * @returns {void}
   *
   * @example
   * <LabeledSlider value={volume} min={0} max={1} onChange={setVolume} />
   */
  const setVolume = (v: number) => {
    update({ volume: v });
    if (!feedback) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => playAlertSound(useSystem.getState().settings.alertSound, v), FEEDBACK_DELAY_MS);
  };

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <Pane>
      <Section title={t(S.output)}>
        <Row label={t(S.outputVolume)} sublabel={volume === 0 ? t(S.muted) : `${Math.round(volume * 100)}%`}>
          <LabeledSlider inline value={volume} min={0} max={1} onChange={setVolume} label={t(S.outputVolume)} start={<VolumeX size={13} />} end={<VolumeIcon size={15} />} width={230} />
        </Row>
        <Row label={t(S.outputDevice)}>{bluetooth && airpods ? 'AirPods Pro' : t(S.speakers)}</Row>
      </Section>

      <Section title={t(S.effects)}>
        <SwitchRow label={t(S.startup)} checked={startupSound} onChange={(v) => update({ startupSound: v })} />
        <SwitchRow label={t(S.feedback)} checked={feedback} onChange={(v) => setPrefs({ volumeFeedback: v })} />
      </Section>

      <Section title={t(S.alertSound)} footer={t(S.alertFooter)}>
        <div role="radiogroup" aria-label={t(S.alertSound)} onKeyDown={onRadioGroupKeyDown}>
          {ALERT_SOUNDS.map((snd) => (
            <CheckRow
              key={snd.id}
              label={snd.name}
              checked={alertSound === snd.id}
              onSelect={() => {
                update({ alertSound: snd.id });
                playAlertSound(snd.id, volume);
              }}
            />
          ))}
        </div>
      </Section>
    </Pane>
  );
}

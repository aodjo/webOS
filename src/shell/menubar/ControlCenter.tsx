/**
 * Control Center, dropping from the top-right under the menu bar:
 * Wi-Fi, Bluetooth, AirDrop, Now Playing, Focus, Stage Manager, Screen Mirroring, Display,
 * Sound, and a row of controls (Dark Mode, Night Shift, Calculator, Activity Monitor). Wi-Fi,
 * Bluetooth, Focus, brightness, theme, Night Shift and volume are real system settings shared
 * with System Settings.
 *
 * macOS 26 layout: no enclosing panel; every control is its own Liquid Glass shape on a 4-column
 * grid of circles — circles for single toggles, capsules two cells wide, a square Now Playing
 * tile and full-width slider modules. Toggles turn into solid white circles with an accent glyph
 * when on. Each control's content is white over a dark part of the desktop picture and dark
 * over a bright one.
 */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Activity, Bluetooth, Calculator, Contrast, FastForward, Moon, Music, NotebookPen, Play, Rewind, SquareTerminal, Sun, SunDim, Sunset, Volume, Volume1, Volume2, VolumeX, Wifi } from 'lucide-react';
import type { LString, Settings } from '@/kernel/types';
import { useSystem, useIsDark } from '@/kernel/system';
import { wm } from '@/kernel/wm';
import { useUI } from '@/kernel/ui';
import { useT } from '@/kernel/i18n';
import { MENU_BAR_HEIGHT } from '@/kernel/constants';
import { usePrefs } from '@/apps/settings/prefs';
import { playAlertSound } from '@/apps/settings/sounds';
import { Z } from '../layers';
import { useCloseOnSessionEnd, useDismiss, usePresence } from './hooks';
import { toggleStatus, useStatus, useWifiNetwork } from './status';
import { AirDropGlyph, MirroringGlyph, StageManagerGlyph } from './glyphs';
import { useAdaptiveTone } from './adaptiveTone';
import styles from './ControlCenter.module.css';

const S = {
  title: { en: 'Control Center', ko: '제어 센터' },
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  airDrop: 'AirDrop',
  on: { en: 'On', ko: '켬' },
  off: { en: 'Off', ko: '끔' },
  contactsOnly: { en: 'Contacts Only', ko: '연락처만' },
  connecting: { en: 'Connecting…', ko: '연결 중…' },
  notConnected: { en: 'Not Connected', ko: '연결되지 않음' },
  focus: { en: 'Focus', ko: '집중 모드' },
  dnd: { en: 'Do Not Disturb', ko: '방해 금지 모드' },
  stageManager: { en: 'Stage Manager', ko: '스테이지 매니저' },
  mirroring: { en: 'Screen Mirroring', ko: '화면 미러링' },
  display: { en: 'Display', ko: '디스플레이' },
  brightness: { en: 'Display brightness', ko: '디스플레이 밝기' },
  darkMode: { en: 'Dark Mode', ko: '다크 모드' },
  nightShift: 'Night Shift',
  sound: { en: 'Sound', ko: '사운드' },
  volume: { en: 'Output volume', ko: '출력 음량' },
  notPlaying: { en: 'Not Playing', ko: '재생 중 아님' },
  play: { en: 'Play', ko: '재생' },
  previous: { en: 'Previous', ko: '이전' },
  next: { en: 'Next', ko: '다음' },
  calculator: { en: 'Calculator', ko: '계산기' },
  activityMonitor: { en: 'Activity Monitor', ko: '활성 상태 보기' },
  terminal: { en: 'Terminal', ko: '터미널' },
  quickNote: { en: 'Quick Note', ko: '빠른 메모' },
} satisfies Record<string, LString>; /** Localized strings used by Control Center. */

/**
 * Joins class names, skipping falsy entries.
 *
 * Lets conditional classes be written inline as `cond && styles.x`.
 *
 * @param {...(string | false | null | undefined)} c - Class names or falsy placeholders.
 * @returns {string} The truthy class names separated by single spaces.
 *
 * @example
 * cx(styles.circle, on && styles.circleOn); // 'circle circleOn' when on, 'circle' otherwise
 */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const TILE = 'lg'; /** Class names of a Control Center shape: regular Liquid Glass (styles/glass.css). */

/**
 * Writes a slider-driven system setting, skipping no-op writes.
 *
 * Settings are persisted on every change, so the store is only updated when the new value
 * differs from the current one.
 *
 * @param {K} key - The setting to write ('brightness' or 'volume').
 * @param {Settings[K]} value - The new value.
 * @returns {void}
 *
 * @example
 * setSetting('volume', 0.5);
 */
function setSetting<K extends 'brightness' | 'volume'>(key: K, value: Settings[K]): void {
  const s = useSystem.getState();
  if (s.settings[key] !== value) s.updateSettings({ [key]: value } as Pick<Settings, K>);
}

/**
 * Plays the volume-change feedback sound.
 *
 * Follows the System Settings → Sound preference "Play feedback when volume is changed": does
 * nothing while it is off, otherwise plays the selected alert sound at the current volume.
 *
 * @returns {void}
 *
 * @example
 * playVolumeFeedback();
 */
function playVolumeFeedback(): void {
  if (!usePrefs.getState().volumeFeedback) return;
  const { alertSound, volume } = useSystem.getState().settings;
  playAlertSound(alertSound, volume);
}

/**
 * The Control Center slider.
 *
 * A thin capsule track between a glyph at each end, filled up to the value (the `--frac` CSS
 * variable, 0–1); it thickens while hovered or dragged. A primary press captures the pointer and
 * applies the value under it at once; drag moves are coalesced to at most one
 * `onChange` per animation frame, since pointer events can arrive faster than frames. Releasing
 * flushes the pending value and calls `onCommit`; a cancelled pointer flushes without
 * committing. Arrow keys move by `step` of the range and Home/End jump to the ends, each key
 * press committing immediately. ARIA values are reported as a 0–100 percentage.
 *
 * @param {Object} props - Slider properties.
 * @param {number} props.value - Current value.
 * @param {number} [props.min=0] - Lowest value.
 * @param {number} [props.max=1] - Highest value.
 * @param {number} [props.step=0.0625] - Keyboard step as a fraction of the range.
 * @param {string} props.label - Accessible label.
 * @param {ReactNode} props.icon - Glyph shown at the left end of the track.
 * @param {ReactNode} props.iconEnd - Glyph shown at the right end of the track.
 * @param {(v: number) => void} props.onChange - Called with each new value.
 * @param {() => void} [props.onCommit] - Called when a drag ends or after a keyboard change.
 * @returns {JSX.Element} The slider element.
 *
 * @example
 * <CCSlider value={volume} label="Output volume" icon={<Volume size={14} />} iconEnd={<Volume2 size={14} />} onChange={setVolume} />
 */
function CCSlider(props: { value: number; min?: number; max?: number; step?: number; label: string; icon: ReactNode; iconEnd: ReactNode; onChange: (v: number) => void; onCommit?: () => void }) {
  const { value, min = 0, max = 1, step = 0.0625, label, icon, iconEnd, onChange, onCommit } = props;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const change = useRef(onChange);
  useLayoutEffect(() => {
    change.current = onChange;
  });

  /**
   * Applies the pending drag value now.
   *
   * Cancels any scheduled animation frame, clears the pending value and, if there was one,
   * passes it to the latest `onChange`.
   *
   * @returns {void}
   *
   * @example
   * flush();
   */
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const v = pending.current;
    pending.current = null;
    if (v !== null) change.current(v);
  };

  /**
   * Queues a drag value for the next animation frame.
   *
   * Replaces any value already pending and requests a frame only when none is scheduled, so at
   * most one value per frame reaches `onChange`.
   *
   * @param {number} v - The value to apply.
   * @returns {void}
   *
   * @example
   * schedule(fromX(e.clientX));
   */
  const schedule = (v: number) => {
    pending.current = v;
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /**
   * Converts a pointer x coordinate to a slider value.
   *
   * Maps the pointer position across the track linearly onto `min`..`max`, clamped to the range.
   * Returns the current value while the track is not mounted.
   *
   * @param {number} clientX - Pointer x in viewport coordinates.
   * @returns {number} The value under the pointer.
   *
   * @example
   * const v = fromX(e.clientX);
   */
  const fromX = (clientX: number) => {
    const el = ref.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / (r.width || 1)));
    return min + f * (max - min);
  };

  /**
   * Starts a drag on a primary-button press.
   *
   * Captures the pointer, so moves outside the track keep updating it, and applies the value
   * under the pointer immediately. Other buttons are ignored.
   *
   * @param {PointerEvent<HTMLDivElement>} e - The pointer-down event.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    onChange(fromX(e.clientX));
  };

  /**
   * Follows the pointer while dragging.
   *
   * Schedules the value under the pointer for the next frame; does nothing when no drag is active.
   *
   * @param {PointerEvent<HTMLDivElement>} e - The pointer-move event.
   * @returns {void}
   *
   * @example
   * <div onPointerMove={onPointerMove} />
   */
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) schedule(fromX(e.clientX));
  };

  /**
   * Ends a drag.
   *
   * Releases the pointer capture, applies any pending value and calls `onCommit`. Does nothing
   * when no drag is active.
   *
   * @param {PointerEvent<HTMLDivElement>} e - The pointer-up event.
   * @returns {void}
   *
   * @example
   * <div onPointerUp={onPointerUp} />
   */
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    flush();
    onCommit?.();
  };

  /**
   * Aborts a drag when the browser cancels the pointer.
   *
   * Stops dragging and applies any pending value without calling `onCommit`.
   *
   * @returns {void}
   *
   * @example
   * <div onPointerCancel={onPointerCancel} />
   */
  const onPointerCancel = () => {
    dragging.current = false;
    flush();
  };

  /**
   * Adjusts the value from the keyboard.
   *
   * ArrowRight/ArrowUp and ArrowLeft/ArrowDown move by `step` of the range; Home and End jump to
   * `min` and `max`. A handled key is prevented and stopped from propagating, then the clamped
   * value is applied and committed at once. Other keys are left alone.
   *
   * @param {KeyboardEvent<HTMLDivElement>} e - The key-down event.
   * @returns {void}
   *
   * @example
   * <div onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step * (max - min);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step * (max - min);
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(Math.min(max, Math.max(min, next)));
    onCommit?.();
  };

  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderIcon} aria-hidden="true">
        {icon}
      </span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        aria-valuetext={`${Math.round(frac * 100)}%`}
        className={styles.slider}
        style={{ ['--frac' as string]: frac }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <div className={styles.sliderTrack}>
          <div className={styles.sliderFill} />
        </div>
      </div>
      <span className={styles.sliderIcon} aria-hidden="true">
        {iconEnd}
      </span>
    </div>
  );
}

/**
 * A round Control Center toggle.
 *
 * A glass circle with a glyph that turns into a solid circle (white with an accent glyph, or
 * the accent colour with a white glyph over bright pictures) while `on`. The label is visually
 * hidden but names the switch for assistive technology and is shown as a tooltip.
 *
 * @param {Object} props - Toggle properties.
 * @param {ReactNode} props.icon - Glyph inside the circle.
 * @param {string} props.label - Accessible name and tooltip.
 * @param {boolean} props.on - Whether the toggle is on.
 * @param {() => void} props.onClick - Called when the circle is clicked.
 * @param {string} [props.className] - Extra class, e.g. for grid placement.
 * @returns {JSX.Element} The toggle button.
 *
 * @example
 * <CircleToggle icon={<Bluetooth size={22} />} label="Bluetooth" on={bluetooth} onClick={toggle} />
 */
function CircleToggle({ icon, label, on, onClick, className }: { icon: ReactNode; label: string; on: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={label} data-lg-optics className={cx(TILE, 'lg-circle', styles.shape, styles.circle, on && styles.on, className)} onClick={onClick}>
      {icon}
      <span className={styles.srOnly}>{label}</span>
    </button>
  );
}

/**
 * A round Control Center button that runs an action (no on/off state).
 *
 * @param {Object} props - Button properties.
 * @param {ReactNode} props.icon - Glyph inside the circle.
 * @param {string} props.label - Accessible name and tooltip.
 * @param {() => void} props.onClick - Called when the circle is clicked.
 * @returns {JSX.Element} The button.
 *
 * @example
 * <CircleButton icon={<Calculator size={22} />} label="Calculator" onClick={() => wm.launch('calculator')} />
 */
function CircleButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} data-lg-optics className={cx(TILE, 'lg-circle', styles.shape, styles.circle)} onClick={onClick}>
      {icon}
    </button>
  );
}

/**
 * A two-cell capsule toggle: a circle glyph followed by a label and a status line.
 *
 * The inner circle turns solid white with an accent glyph while `on` (the accent colour with a
 * white glyph on frosted glass over bright pictures). The status line is omitted when
 * `sub` is empty.
 *
 * @param {Object} props - Toggle properties.
 * @param {ReactNode} props.icon - Glyph inside the circle.
 * @param {string} props.label - Main label.
 * @param {string} [props.sub] - Status text under the label.
 * @param {boolean} props.on - Whether the toggle is on.
 * @param {() => void} props.onClick - Called when the capsule is clicked.
 * @returns {JSX.Element} The capsule button.
 *
 * @example
 * <CapsuleToggle icon={<Wifi size={18} />} label="Wi-Fi" sub="Home" on={wifi} onClick={toggleWifi} />
 */
function CapsuleToggle({ icon, label, sub, on, onClick }: { icon: ReactNode; label: string; sub?: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} data-lg-optics className={cx(TILE, 'lg-capsule', styles.shape, styles.capsule)} onClick={onClick}>
      <span className={cx(styles.capsuleIcon, on && styles.on)}>{icon}</span>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {sub && <span className={styles.rowSub}>{sub}</span>}
      </span>
    </button>
  );
}

/**
 * The Control Center controls.
 *
 * Lays out, on a 4-column grid: Wi-Fi, Bluetooth and AirDrop capsules stacked on the left with
 * a square Now Playing tile and the Stage Manager and Screen Mirroring circles on the right;
 * Dark Mode and Night Shift circles beside the Focus capsule; the Display module (brightness
 * from 0.3 to 1); the Sound module (volume, whose speaker glyph follows the level, playing the
 * feedback sound on commit); and a row of circles that open Calculator, Activity Monitor,
 * Terminal and Notes. Wi-Fi, Bluetooth, Do Not
 * Disturb, theme, Night Shift, brightness and volume are system settings; AirDrop, Stage Manager
 * and Screen Mirroring live in the menu bar status store. Slider values are rounded to
 * hundredths before they are written. The Wi-Fi capsule shows "Connecting…", the joined network
 * or "Not Connected" while Wi-Fi is on.
 *
 * @returns {JSX.Element} The control grid.
 *
 * @example
 * <div className={styles.content}><Modules /></div>
 */
function Modules() {
  const t = useT();
  const wifi = useSystem((s) => s.settings.wifi);
  const bluetooth = useSystem((s) => s.settings.bluetooth);
  const dnd = useSystem((s) => s.settings.doNotDisturb);
  const brightness = useSystem((s) => s.settings.brightness);
  const volume = useSystem((s) => s.settings.volume);
  const nightShift = useSystem((s) => s.settings.nightShift);
  const update = useSystem((s) => s.updateSettings);
  const dark = useIsDark();
  const network = useWifiNetwork();
  const connecting = useStatus((s) => s.connecting);
  const airDrop = useStatus((s) => s.airDrop);
  const stageManager = useStatus((s) => s.stageManager);
  const mirroring = useStatus((s) => s.mirroring);

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.34 ? Volume : volume < 0.67 ? Volume1 : Volume2;

  return (
    <div className={styles.grid}>
      <CapsuleToggle
        icon={<Wifi size={18} strokeWidth={2.4} />}
        label={t(S.wifi)}
        sub={wifi ? (connecting ? t(S.connecting) : network ?? t(S.notConnected)) : t(S.off)}
        on={wifi}
        onClick={() => update({ wifi: !wifi })}
      />
      <section data-lg-optics className={cx(TILE, styles.shape, styles.nowPlaying)} aria-label={t(S.notPlaying)}>
        <span className={styles.art}>
          <Music size={20} strokeWidth={2} />
        </span>
        <span className={styles.npTitle}>{t(S.notPlaying)}</span>
        <span className={styles.npControls}>
          <button type="button" className={styles.npBtn} aria-label={t(S.previous)} disabled>
            <Rewind size={20} fill="currentColor" strokeWidth={0} />
          </button>
          <button type="button" className={styles.npBtn} aria-label={t(S.play)} disabled>
            <Play size={22} fill="currentColor" strokeWidth={0} />
          </button>
          <button type="button" className={styles.npBtn} aria-label={t(S.next)} disabled>
            <FastForward size={20} fill="currentColor" strokeWidth={0} />
          </button>
        </span>
      </section>
      <CapsuleToggle icon={<Bluetooth size={18} strokeWidth={2.4} />} label={t(S.bluetooth)} sub={t(bluetooth ? S.on : S.off)} on={bluetooth} onClick={() => update({ bluetooth: !bluetooth })} />
      <CapsuleToggle icon={<AirDropGlyph size={18} />} label={t(S.airDrop)} sub={t(airDrop ? S.contactsOnly : S.off)} on={airDrop} onClick={() => toggleStatus('airDrop')} />
      <CircleToggle icon={<StageManagerGlyph size={24} />} label={t(S.stageManager)} on={stageManager} onClick={() => toggleStatus('stageManager')} />
      <CircleToggle icon={<MirroringGlyph size={24} />} label={t(S.mirroring)} on={mirroring} onClick={() => toggleStatus('mirroring')} />

      <CircleToggle icon={<Contrast size={22} strokeWidth={2.2} />} label={t(S.darkMode)} on={dark} onClick={() => update({ theme: dark ? 'light' : 'dark' })} />
      <CircleToggle icon={<Sunset size={22} strokeWidth={2.2} />} label={t(S.nightShift)} on={nightShift} onClick={() => update({ nightShift: !nightShift })} />
      <CapsuleToggle icon={<Moon size={18} strokeWidth={2.4} fill="currentColor" />} label={t(S.focus)} sub={dnd ? t(S.dnd) : undefined} on={dnd} onClick={() => update({ doNotDisturb: !dnd })} />

      <section data-lg-optics className={cx(TILE, styles.shape, styles.module)} aria-label={t(S.display)}>
        <div className={styles.moduleTitle}>{t(S.display)}</div>
        <CCSlider
          value={brightness}
          min={0.3}
          max={1}
          label={t(S.brightness)}
          icon={<SunDim size={16} strokeWidth={2.2} />}
          iconEnd={<Sun size={18} strokeWidth={2.2} />}
          onChange={(v) => setSetting('brightness', Math.round(v * 100) / 100)}
        />
      </section>

      <section data-lg-optics className={cx(TILE, styles.shape, styles.module)} aria-label={t(S.sound)}>
        <div className={styles.moduleTitle}>{t(S.sound)}</div>
        <CCSlider
          value={volume}
          label={t(S.volume)}
          icon={<Volume size={16} strokeWidth={2.2} />}
          iconEnd={<VolumeIcon size={18} strokeWidth={2.2} />}
          onChange={(v) => setSetting('volume', Math.round(v * 100) / 100)}
          onCommit={playVolumeFeedback}
        />
      </section>

      <CircleButton icon={<Calculator size={22} strokeWidth={2.2} />} label={t(S.calculator)} onClick={() => wm.launch('calculator')} />
      <CircleButton icon={<Activity size={22} strokeWidth={2.2} />} label={t(S.activityMonitor)} onClick={() => wm.launch('activity-monitor')} />
      <CircleButton icon={<SquareTerminal size={22} strokeWidth={2.2} />} label={t(S.terminal)} onClick={() => wm.launch('terminal')} />
      <CircleButton icon={<NotebookPen size={22} strokeWidth={2.2} />} label={t(S.quickNote)} onClick={() => wm.launch('notes')} />
    </div>
  );
}

/**
 * The Control Center panel, dropping from the top-right under the menu bar.
 *
 * Shown while the UI store's `controlCenter` flag is set and kept mounted (inert) for 180 ms
 * after it clears so the exit animation can play. A pointer-down outside the panel, except on
 * the menu bar's toggle (`[data-cc-toggle]`, which toggles it itself), or Escape closes it, as
 * does the session leaving the desktop (lock, sleep, log out). The controls scroll inside the
 * panel on short screens. Each control picks its content tone (`data-tone`) from what lies right
 * behind it: a window, or the luminance of the desktop picture.
 *
 * @returns {JSX.Element | null} The panel, or null while it is not mounted.
 *
 * @example
 * <ControlCenter />
 */
export function ControlCenter() {
  const t = useT();
  const open = useUI((s) => s.controlCenter);
  const { mounted, closing } = usePresence(open, 180);
  const ref = useRef<HTMLDivElement | null>(null);

  /**
   * Closes the Control Center.
   *
   * Clears the `controlCenter` flag in the UI store; the panel then plays its exit animation.
   *
   * @returns {void}
   *
   * @example
   * close();
   */
  const close = () => useUI.getState().set({ controlCenter: false });
  useDismiss(open, ref, close, '[data-cc-toggle]');
  useCloseOnSessionEnd(open, close);

  useAdaptiveTone(ref, `.${styles.shape}`, mounted);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t(S.title)}
      className={cx(styles.panel, closing && styles.closing)}
      style={{ zIndex: Z.PANELS, top: MENU_BAR_HEIGHT + 4 }}
      inert={closing || undefined}
    >
      {/* The controls scroll here when they are taller than the panel's max-height (short screens). */}
      <div className={styles.content}>
        <Modules />
      </div>
    </div>
  );
}

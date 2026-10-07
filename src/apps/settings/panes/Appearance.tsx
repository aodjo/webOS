/**
 * Settings panes for Appearance (theme + accent color), Accessibility, and Control Center
 * (menu bar clock).
 */
import { useMemo } from 'react';
import { Accessibility } from 'lucide-react';
import { ACCENT_COLORS, useSystem, useT, type Locale, type ThemeSetting } from '@/kernel';
import { Hero, onRadioGroupKeyDown, Pane, Row, Section, SwitchRow } from '../kit';
import { useNow } from '../hooks';
import s from './panes.module.css';

const S = {
  appearance: { en: 'Appearance', ko: '화면 모드' },
  accent: { en: 'Accent color', ko: '강조 색상' },
  reduceTransparency: { en: 'Reduce transparency', ko: '투명도 줄이기' },
  reduceTransparencySub: {
    en: 'Replaces the blur and translucency of menus, the menu bar, the Dock and sidebars with solid colors.',
    ko: '메뉴, 메뉴 막대, Dock 및 사이드바의 흐림 효과와 투명도를 불투명한 색상으로 바꿉니다.',
  },
  autoSub: { en: 'Follows your device’s light or dark setting.', ko: '기기의 라이트 또는 다크 설정을 따릅니다.' },

  accessibility: { en: 'Accessibility', ko: '손쉬운 사용' },
  accessibilityDesc: {
    en: 'Personalize your computer to suit your vision and motion needs.',
    ko: '시각 및 동작에 관한 필요에 맞게 컴퓨터를 개인화합니다.',
  },
  display: { en: 'Display', ko: '디스플레이' },
  motion: { en: 'Motion', ko: '동작' },
  reduceMotion: { en: 'Reduce motion', ko: '동작 줄이기' },
  reduceMotionSub: {
    en: 'Reduces the motion of the user interface, including window animations, Launchpad and Mission Control.',
    ko: '윈도우 애니메이션, Launchpad 및 Mission Control을 포함한 사용자 인터페이스의 움직임을 줄입니다.',
  },
  browserPrefersReduced: {
    en: 'Your device also asks for reduced motion, so animations are minimized either way.',
    ko: '기기에서도 동작 줄이기를 요청하고 있으므로 애니메이션이 최소화됩니다.',
  },

  clock: { en: 'Clock Options', ko: '시계 옵션' },
  preview: { en: 'Menu bar preview', ko: '메뉴 막대 미리보기' },
  h24: { en: 'Use a 24-hour clock', ko: '24시간 시계 사용' },
  seconds: { en: 'Display the time with seconds', ko: '초 단위로 시간 표시' },
  clockFooter: { en: 'The clock in the menu bar and on the lock screen updates instantly.', ko: '메뉴 막대와 잠금 화면의 시계가 즉시 업데이트됩니다.' },
}; /** Localized strings of the Appearance, Accessibility and Control Center panes. */

const THEMES: { id: ThemeSetting; name: { en: string; ko: string } }[] = [
  { id: 'auto', name: { en: 'Auto', ko: '자동' } },
  { id: 'light', name: { en: 'Light', ko: '라이트' } },
  { id: 'dark', name: { en: 'Dark', ko: '다크' } },
]; /** Theme choices shown as preview tiles, in display order. */

/**
 * Miniature desktop preview illustrating a theme choice.
 *
 * Draws a tiny window (traffic lights, sidebar, content lines with an accent bar) in light or
 * dark colors. The "auto" tile shows the light scene with a dark scene clipped to its right half.
 * Purely decorative, so it is hidden from assistive technology.
 *
 * @param {Object} props - Component props.
 * @param {ThemeSetting} props.variant - Theme the tile represents ('auto', 'light' or 'dark').
 * @returns {JSX.Element} The preview tile.
 *
 * @example
 * <ThemeTile variant="auto" />
 */
function ThemeTile({ variant }: { variant: ThemeSetting }) {
  /**
   * Renders one mini window scene in the given color mode.
   *
   * The mode is exposed as `data-mode`, which the stylesheet uses to pick light or dark colors.
   *
   * @param {'light' | 'dark'} mode - Color mode of the scene.
   * @returns {JSX.Element} The scene element.
   *
   * @example
   * scene('dark');
   */
  const scene = (mode: 'light' | 'dark') => (
    <div className={s.tileScene} data-mode={mode}>
      <div className={s.tileWindow}>
        <div className={s.tileBar}>
          <i />
          <i />
          <i />
        </div>
        <div className={s.tileBody}>
          <div className={s.tileSidebar} />
          <div className={s.tileContent}>
            <span className={s.tileAccent} />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <span className={s.tile} aria-hidden="true">
      {variant === 'dark' ? scene('dark') : scene('light')}
      {variant === 'auto' && <div className={s.tileHalf}>{scene('dark')}</div>}
    </span>
  );
}

/**
 * Appearance pane: theme, accent color and reduced transparency.
 *
 * The theme tiles and accent dots are radio groups navigable with the arrow keys. Every choice
 * writes straight to the system settings, so it applies across the OS immediately. The selected
 * accent is named after its preset (matched case-insensitively), or shown as its raw color value
 * when it matches none.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <AppearancePane />
 */
export function AppearancePane() {
  const t = useT();
  const theme = useSystem((st) => st.settings.theme);
  const accent = useSystem((st) => st.settings.accent);
  const reduceTransparency = useSystem((st) => st.settings.reduceTransparency);
  const update = useSystem((st) => st.updateSettings);
  const accentName = ACCENT_COLORS.find((a) => a.color.toLowerCase() === accent.toLowerCase())?.name;

  return (
    <Pane>
      <Section>
        <Row label={t(S.appearance)} sublabel={theme === 'auto' ? t(S.autoSub) : undefined}>
          <div className={s.tiles} role="radiogroup" aria-label={t(S.appearance)} onKeyDown={onRadioGroupKeyDown}>
            {THEMES.map((th) => (
              <button key={th.id} type="button" role="radio" aria-checked={theme === th.id} className={s.tileBtn} onClick={() => update({ theme: th.id })}>
                <ThemeTile variant={th.id} />
                <span className={s.tileLabel}>{t(th.name)}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label={t(S.accent)}>
          <div className={s.accentWrap}>
            <div className={s.accents} role="radiogroup" aria-label={t(S.accent)} onKeyDown={onRadioGroupKeyDown}>
              {ACCENT_COLORS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.color.toLowerCase() === accent.toLowerCase()}
                  aria-label={t(a.name)}
                  title={t(a.name)}
                  className={s.accentDot}
                  style={{ background: a.color }}
                  onClick={() => update({ accent: a.color })}
                />
              ))}
            </div>
            <span className={s.accentName}>{accentName ? t(accentName) : accent}</span>
          </div>
        </Row>
      </Section>
      <Section>
        <SwitchRow label={t(S.reduceTransparency)} sublabel={t(S.reduceTransparencySub)} checked={reduceTransparency} onChange={(v) => update({ reduceTransparency: v })} />
      </Section>
    </Pane>
  );
}

/* ───────────────────────── Accessibility ───────────────────────── */

/**
 * Accessibility pane: reduce motion and reduce transparency switches.
 *
 * When the device itself requests reduced motion (`prefers-reduced-motion`, read once on mount),
 * a footnote explains that animations are minimized regardless of the switch.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <AccessibilityPane />
 */
export function AccessibilityPane() {
  const t = useT();
  const reduceMotion = useSystem((st) => st.settings.reduceMotion);
  const reduceTransparency = useSystem((st) => st.settings.reduceTransparency);
  const update = useSystem((st) => st.updateSettings);
  const devicePrefersReduced = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);

  return (
    <Pane>
      <Hero icon={Accessibility} color="#0a84ff" title={t(S.accessibility)} description={t(S.accessibilityDesc)} />
      <Section title={t(S.motion)} footer={devicePrefersReduced ? t(S.browserPrefersReduced) : undefined}>
        <SwitchRow label={t(S.reduceMotion)} sublabel={t(S.reduceMotionSub)} checked={reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
      </Section>
      <Section title={t(S.display)}>
        <SwitchRow label={t(S.reduceTransparency)} sublabel={t(S.reduceTransparencySub)} checked={reduceTransparency} onChange={(v) => update({ reduceTransparency: v })} />
      </Section>
    </Pane>
  );
}

/* ───────────────────────── Control Center ───────────────────────── */

/**
 * Formats a date the way the menu bar clock shows it.
 *
 * Produces a short date and the time separated by two spaces, using the Korean or US English
 * locale. Commas are stripped from the date part, matching the macOS menu bar. The time uses a
 * 24-hour (0–23) or 12-hour cycle and optionally includes seconds.
 *
 * @param {Date} d - The moment to format.
 * @param {Locale} locale - UI locale ('en' or 'ko').
 * @param {boolean} h24 - Use the 24-hour clock.
 * @param {boolean} seconds - Include seconds.
 * @returns {string} The clock text, e.g. "Sat Oct 3  9:41 AM".
 *
 * @example
 * menuBarClock(new Date(), 'en', false, false); // e.g. "Sat Oct 3  9:41 AM"
 */
function menuBarClock(d: Date, locale: Locale, h24: boolean, seconds: boolean): string {
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  const date = new Intl.DateTimeFormat(tag, locale === 'ko' ? { month: 'long', day: 'numeric', weekday: 'short' } : { weekday: 'short', month: 'short', day: 'numeric' })
    .format(d)
    .replace(/,/g, '');
  const time = new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined, hourCycle: h24 ? 'h23' : 'h12' }).format(d);
  return `${date}  ${time}`;
}

/**
 * Control Center pane: menu bar clock options with a live preview.
 *
 * The preview re-renders every second (`useNow`) and is formatted like the menu bar clock,
 * and the switches toggle the 24-hour clock and seconds display in the system settings.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <ControlCenterPane />
 */
export function ControlCenterPane() {
  const t = useT();
  const now = useNow();
  const locale = useSystem((st) => st.settings.locale);
  const h24 = useSystem((st) => st.settings.clock24h);
  const seconds = useSystem((st) => st.settings.showSeconds);
  const update = useSystem((st) => st.updateSettings);

  return (
    <Pane>
      <Section title={t(S.clock)} footer={t(S.clockFooter)}>
        <Row label={t(S.preview)}>
          <span className={s.clockPreview}>{menuBarClock(now, locale, h24, seconds)}</span>
        </Row>
        <SwitchRow label={t(S.h24)} checked={h24} onChange={(v) => update({ clock24h: v })} />
        <SwitchRow label={t(S.seconds)} checked={seconds} onChange={(v) => update({ showSeconds: v })} />
      </Section>
    </Pane>
  );
}

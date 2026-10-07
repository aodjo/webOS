/**
 * Building blocks for System Settings panes: macOS "inset grouped" forms (Tahoe: rounded 14px cards
 * with a subtle rim and inset hairline separators, label on the left and control on the right),
 * pane icons, hero headers.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Slider, Switch } from '@/components/ui';
import { useImageURL } from './media';
import s from './kit.module.css';

/* ───────────────────────── Keyboard ───────────────────────── */

const RADIO_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }; /** Selection step for each arrow key in a radio group (+1 next, −1 previous). */

/**
 * Keyboard handler for a `role="radiogroup"` container.
 *
 * The arrow keys move focus to the previous/next enabled `role="radio"` descendant and select it
 * by clicking it, wrapping around at either end, as in macOS and the ARIA radio group pattern.
 * Keys combined with ⌥/⌘/Ctrl, other keys, and key presses while focus is not on one of the
 * radios are ignored (and not prevented).
 *
 * @param {KeyboardEvent<HTMLElement>} e - The keydown event of the radio group element.
 * @returns {void}
 *
 * @example
 * <div role="radiogroup" onKeyDown={onRadioGroupKeyDown}>
 *   {options.map((o) => <button key={o.id} role="radio" aria-checked={o.id === value} />)}
 * </div>
 */
export function onRadioGroupKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const step = RADIO_STEP[e.key];
  if (!step || e.altKey || e.metaKey || e.ctrlKey) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)')];
  const at = radios.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

/* ───────────────────────── Icons ───────────────────────── */

/**
 * Colored rounded-square icon with a white glyph, used in the sidebar and in rows.
 *
 * Uses Tahoe proportions: the corner radius is 27% of the size (22px → 6px) and the background
 * layers a soft white top sheen over a gradient from a lightened tint of `color` to `color`.
 * Large icons (over 32px) get a thinner glyph stroke. Hidden from assistive technology.
 *
 * @param {Object} props - Component props.
 * @param {LucideIcon} props.icon - Lucide glyph drawn in white.
 * @param {string} props.color - Background color (any CSS color).
 * @param {number} [props.size=20] - Edge length in pixels.
 * @returns {JSX.Element} The icon element.
 *
 * @example
 * <PaneIcon icon={Wifi} color="#0a84ff" size={22} />
 */
export function PaneIcon({ icon: Icon, color, size = 20 }: { icon: LucideIcon; color: string; size?: number }) {
  return (
    <span
      className={s.paneIcon}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0) 58%), linear-gradient(180deg, color-mix(in srgb, ${color} 80%, white), ${color})`,
      }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.62)} strokeWidth={size > 32 ? 1.8 : 2.2} color="#fff" />
    </span>
  );
}

/**
 * Builds up to two uppercase initials from a person's name.
 *
 * A single word yields its first two characters; several words yield the first character of
 * the first and last words. Characters are split by code point, so emoji and other non-BMP
 * characters are not cut in half. An empty name yields "?".
 *
 * @param {string} name - Full name to abbreviate.
 * @returns {string} The initials, e.g. "JD" for "Jane Doe".
 *
 * @example
 * initials('Jane Doe'); // "JD"
 * initials('aodjo');    // "AO"
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const chars = parts.length === 1 ? [...parts[0]].slice(0, 2) : [[...parts[0]][0], [...parts[parts.length - 1]][0]];
  return chars.join('').toUpperCase();
}

/**
 * Round profile picture with an initials fallback.
 *
 * Resolves `src` with `useImageURL` (so FS paths work and stay live). If the image fails to
 * load, the failing URL is remembered and the initials of `name` are shown instead; a new URL
 * gets a fresh attempt. Hidden from assistive technology.
 *
 * @param {Object} props - Component props.
 * @param {string} props.src - Avatar setting value (FS path, asset URL or data URL).
 * @param {string} props.name - User's name, used for the initials fallback.
 * @param {number} props.size - Diameter in pixels.
 * @returns {JSX.Element} The avatar element.
 *
 * @example
 * <UserAvatar src={settings.avatar} name={settings.fullName} size={34} />
 */
export function UserAvatar({ src, name, size }: { src: string; name: string; size: number }) {
  const url = useImageURL(src);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className={s.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {url && failedUrl !== url ? <img src={url} alt="" draggable={false} onError={() => setFailedUrl(url)} /> : initials(name)}
    </span>
  );
}

/**
 * Small spinning activity indicator made of 12 spokes.
 *
 * Each spoke is rotated 30° further and progressively more opaque; the CSS animation rotates
 * the whole indicator in 12 discrete steps, like the macOS spinner. Hidden from assistive
 * technology.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=16] - Edge length in pixels.
 * @returns {JSX.Element} The spinner element.
 *
 * @example
 * {loading && <ActivityIndicator size={14} />}
 */
export function ActivityIndicator({ size = 16 }: { size?: number }) {
  return (
    <span className={s.spinner} style={{ width: size, height: size }} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} style={{ transform: `rotate(${i * 30}deg)`, opacity: 0.15 + (i / 11) * 0.85 }} />
      ))}
    </span>
  );
}

/* ───────────────────────── Layout ───────────────────────── */

/**
 * Root container of a settings pane that stacks its sections vertically with consistent spacing.
 *
 * Renders a plain `div` with the pane layout class; the spacing between sections comes from the
 * stylesheet, so panes only need to list their `Hero`, `Section` and `ButtonBar` children.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.children - The pane's sections.
 * @returns {JSX.Element} The pane wrapper.
 *
 * @example
 * <Pane>
 *   <Section title="Clock">…</Section>
 * </Pane>
 */
export function Pane({ children }: { children: ReactNode }) {
  return <div className={s.pane}>{children}</div>;
}

/**
 * Card at the top of a pane with a big centered icon, a title and an optional description.
 *
 * Used by panes such as General and Accessibility. The description is omitted when falsy.
 *
 * @param {Object} props - Component props.
 * @param {LucideIcon} props.icon - Glyph shown in the 56px pane icon.
 * @param {string} props.color - Background color of the icon.
 * @param {ReactNode} props.title - Heading text.
 * @param {ReactNode} [props.description] - Explanatory text under the title.
 * @returns {JSX.Element} The hero card.
 *
 * @example
 * <Hero icon={Accessibility} color="#0a84ff" title={t(S.title)} description={t(S.desc)} />
 */
export function Hero({ icon, color, title, description }: { icon: LucideIcon; color: string; title: ReactNode; description?: ReactNode }) {
  return (
    <div className={`${s.group} ${s.hero}`}>
      <PaneIcon icon={icon} color={color} size={56} />
      <div className={s.heroTitle}>{title}</div>
      {description && <div className={s.heroText}>{description}</div>}
    </div>
  );
}

/**
 * Titled section of a pane that wraps its rows in an inset-grouped card.
 *
 * Renders a header row when `title` or `aside` is given (title on the left, `aside` on the
 * right), the children inside a rounded card (or bare when `plain` is set), and an optional
 * footnote under the card.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} [props.title] - Section heading.
 * @param {ReactNode} [props.footer] - Small explanatory text under the card.
 * @param {ReactNode} [props.aside] - Extra content aligned to the right of the heading.
 * @param {ReactNode} props.children - The section's rows.
 * @param {boolean} [props.plain] - Render the children without the card background.
 * @returns {JSX.Element} The section element.
 *
 * @example
 * <Section title="Clock Options" footer="Changes apply instantly.">
 *   <SwitchRow label="Use a 24-hour clock" checked={h24} onChange={setH24} />
 * </Section>
 */
export function Section({ title, footer, aside, children, plain }: { title?: ReactNode; footer?: ReactNode; aside?: ReactNode; children: ReactNode; plain?: boolean }) {
  return (
    <section className={s.section}>
      {(title || aside) && (
        <div className={s.sectionHeader}>
          {title && <h3 className={s.sectionTitle}>{title}</h3>}
          {aside}
        </div>
      )}
      {plain ? children : <div className={s.group}>{children}</div>}
      {footer && <div className={s.footer}>{footer}</div>}
    </section>
  );
}

/**
 * Right-aligned row of buttons placed under a section (e.g. "Advanced…", "?").
 *
 * Pulled up with a negative top margin so it sits close to the card above it.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.children - The buttons.
 * @returns {JSX.Element} The button bar.
 *
 * @example
 * <ButtonBar>
 *   <Button onClick={openAdvanced}>Advanced…</Button>
 * </ButtonBar>
 */
export function ButtonBar({ children }: { children: ReactNode }) {
  return <div className={s.buttonBar}>{children}</div>;
}

/* ───────────────────────── Rows ───────────────────────── */

/** Props of a form row. */
interface RowProps {
  /** Main label on the left. */
  label: ReactNode;
  /** Secondary text under the label. */
  sublabel?: ReactNode;
  /** Leading visual (PaneIcon, avatar…). */
  leading?: ReactNode;
  /** Control shown on the right (or below when `stacked`). */
  children?: ReactNode;
  /** Extra class names for the row. */
  className?: string;
  /** Stack the control below the label (wide controls like tiles or sliders). */
  stacked?: boolean;
}

/**
 * One row of an inset-grouped form: label (and sublabel) on the left, control on the right.
 *
 * An optional leading visual is drawn before the label, which also shifts the hairline
 * separator to start after it. With `stacked`, the control wraps onto its own full-width line
 * below the label. The control column is omitted when `children` is `undefined`.
 *
 * @param {RowProps} props - Component props.
 * @param {ReactNode} props.label - Main label.
 * @param {ReactNode} [props.sublabel] - Secondary text under the label.
 * @param {ReactNode} [props.leading] - Leading visual such as a `PaneIcon`.
 * @param {ReactNode} [props.children] - The control.
 * @param {string} [props.className=''] - Extra class names.
 * @param {boolean} [props.stacked] - Put the control under the label.
 * @returns {JSX.Element} The row element.
 *
 * @example
 * <Row label="Accent color">
 *   <AccentPicker />
 * </Row>
 */
export function Row({ label, sublabel, leading, children, className = '', stacked }: RowProps) {
  return (
    <div className={`${s.row} ${leading ? s.hasLeading : ''} ${stacked ? s.stacked : ''} ${className}`}>
      {leading}
      <div className={s.label}>
        <div className={s.labelText}>{label}</div>
        {sublabel && <div className={s.sublabel}>{sublabel}</div>}
      </div>
      {children !== undefined && <div className={s.control}>{children}</div>}
    </div>
  );
}

/**
 * Form row with an on/off switch on the right.
 *
 * The label doubles as the switch's accessible name. When disabled, the switch is disabled and
 * the label is dimmed.
 *
 * @param {Object} props - Component props.
 * @param {string} props.label - Row label and accessible name of the switch.
 * @param {ReactNode} [props.sublabel] - Secondary text under the label.
 * @param {ReactNode} [props.leading] - Leading visual such as a `PaneIcon`.
 * @param {boolean} props.checked - Whether the switch is on.
 * @param {(v: boolean) => void} props.onChange - Called with the new state when toggled.
 * @param {boolean} [props.disabled] - Disable the switch and dim the label.
 * @returns {JSX.Element} The switch row.
 *
 * @example
 * <SwitchRow label="Reduce motion" checked={reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
 */
export function SwitchRow({ label, sublabel, leading, checked, onChange, disabled }: { label: string; sublabel?: ReactNode; leading?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row label={label} sublabel={sublabel} leading={leading} className={disabled ? s.disabled : ''}>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </Row>
  );
}

/**
 * Clickable row that navigates somewhere, with a chevron on the right.
 *
 * Rendered as a button. An optional pane icon leads the row (gray when no color is given), and
 * an optional detail value appears before the chevron.
 *
 * @param {Object} props - Component props.
 * @param {LucideIcon} [props.icon] - Glyph for the leading pane icon.
 * @param {string} [props.color] - Background color of the leading icon (defaults to `var(--gray)`).
 * @param {ReactNode} props.label - Row label.
 * @param {ReactNode} [props.detail] - Current value shown before the chevron.
 * @param {() => void} props.onClick - Called when the row is activated.
 * @returns {JSX.Element} The navigation row.
 *
 * @example
 * <NavRow icon={Info} color="#8e8e93" label="About" onClick={() => go('about')} />
 */
export function NavRow({ icon, color, label, detail, onClick }: { icon?: LucideIcon; color?: string; label: ReactNode; detail?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={`${s.row} ${s.navRow} ${icon ? s.hasLeading : ''}`} onClick={onClick}>
      {icon && <PaneIcon icon={icon} color={color ?? 'var(--gray)'} />}
      <span className={s.label}>
        <span className={s.labelText}>{label}</span>
      </span>
      <span className={s.control}>
        {detail}
        <ChevronRight size={14} className={s.chevron} />
      </span>
    </button>
  );
}

/**
 * Selectable list row with a trailing checkmark, using radio semantics.
 *
 * Rendered as a `role="radio"` button whose `aria-checked` follows `checked`; the checkmark
 * fades and scales in when checked. Place several inside a `role="radiogroup"` with
 * `onRadioGroupKeyDown` for arrow-key selection.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.label - Row label.
 * @param {ReactNode} [props.sublabel] - Secondary text under the label.
 * @param {ReactNode} [props.leading] - Leading visual.
 * @param {boolean} props.checked - Whether this option is selected.
 * @param {() => void} props.onSelect - Called when the row is activated.
 * @param {ReactNode} [props.trailing] - Extra content shown before the checkmark.
 * @returns {JSX.Element} The radio row.
 *
 * @example
 * <CheckRow label="English" checked={locale === 'en'} onSelect={() => update({ locale: 'en' })} />
 */
export function CheckRow({ label, sublabel, leading, checked, onSelect, trailing }: { label: ReactNode; sublabel?: ReactNode; leading?: ReactNode; checked: boolean; onSelect: () => void; trailing?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className={`${s.row} ${s.navRow} ${leading ? s.hasLeading : ''}`} onClick={onSelect}>
      {leading}
      <span className={s.label}>
        <span className={s.labelText}>{label}</span>
        {sublabel && <span className={s.sublabel}>{sublabel}</span>}
      </span>
      <span className={s.control}>
        {trailing}
        <span className={s.check} data-on={checked || undefined} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.2 6.4 4.9 9 9.8 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
    </button>
  );
}

/**
 * Horizontal usage bar made of colored segments.
 *
 * Each segment with a positive value becomes a flex item whose `flex-grow` is its share of
 * `total`, so widths are proportional and animate when values change. Zero or negative
 * segments are skipped; the unfilled remainder shows the bar's track. Exposed as a single image
 * with `label` as its accessible name.
 *
 * @param {Object} props - Component props.
 * @param {{ key: string; value: number; color: string; title?: string }[]} props.segments - Bar
 *   segments with their size, color and optional hover title.
 * @param {number} props.total - Value that corresponds to the full bar width.
 * @param {number} [props.height=20] - Bar height in pixels.
 * @param {string} [props.label] - Accessible description of the bar.
 * @returns {JSX.Element} The usage bar.
 *
 * @example
 * <UsageBar total={quota} segments={[{ key: 'apps', value: 1200, color: 'var(--red)' }]} label="Storage" />
 */
export function UsageBar({ segments, total, height = 20, label }: { segments: { key: string; value: number; color: string; title?: string }[]; total: number; height?: number; label?: string }) {
  return (
    <div className={s.usageBar} style={{ height }} role="img" aria-label={label}>
      {segments.map((seg) =>
        seg.value > 0 ? <span key={seg.key} title={seg.title} style={{ flexGrow: total > 0 ? seg.value / total : 0, background: seg.color }} /> : null,
      )}
    </div>
  );
}

/**
 * Wrapping legend of colored dots with labels, typically shown under a `UsageBar`.
 *
 * Each entry renders a small dot filled with its `color` followed by its label; entries flow
 * onto further lines when they do not fit the available width.
 *
 * @param {Object} props - Component props.
 * @param {{ key: string; color: string; label: ReactNode }[]} props.items - Legend entries.
 * @returns {JSX.Element} The legend element.
 *
 * @example
 * <Legend items={[{ key: 'apps', color: 'var(--red)', label: 'Applications' }]} />
 */
export function Legend({ items }: { items: { key: string; color: string; label: ReactNode }[] }) {
  return (
    <div className={s.legend}>
      {items.map((it) => (
        <span key={it.key} className={s.legendItem}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Slider with small captions or icons at its ends, like macOS settings sliders.
 *
 * The value passed to the slider is clamped to `[min, max]`. By default `start`/`end` are text
 * captions under the slider's ends (hidden from assistive technology); with `inline` they are
 * placed beside the slider instead (for icons). When disabled, the slider is dimmed and made
 * `inert`, so it cannot be focused or used.
 *
 * @param {Object} props - Component props.
 * @param {number} props.value - Current value.
 * @param {number} props.min - Minimum value.
 * @param {number} props.max - Maximum value.
 * @param {number} [props.step=0.01] - Value increment.
 * @param {(v: number) => void} props.onChange - Called with the new value when the user moves the slider.
 * @param {string} props.label - Accessible name of the slider.
 * @param {ReactNode} [props.start] - Caption or icon for the minimum end.
 * @param {ReactNode} [props.end] - Caption or icon for the maximum end.
 * @param {number} [props.width=210] - Width of the whole control in pixels.
 * @param {boolean} [props.disabled] - Dim the slider and make it inert.
 * @param {boolean} [props.inline] - Put `start`/`end` beside the slider instead of under it.
 * @returns {JSX.Element} The labeled slider.
 *
 * @example
 * <LabeledSlider value={speed} min={0} max={1} onChange={setSpeed} label="Speed" start="Slow" end="Fast" />
 */
export function LabeledSlider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  label,
  start,
  end,
  width = 210,
  disabled,
  inline,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  start?: ReactNode;
  end?: ReactNode;
  width?: number;
  disabled?: boolean;
  /** Put the end captions beside the slider (icons) instead of under it (text). */
  inline?: boolean;
}) {
  return (
    <div className={`${s.slider} ${inline ? s.sliderInline : ''} ${disabled ? s.sliderDisabled : ''}`} style={{ width }} inert={disabled || undefined}>
      {inline && start}
      <Slider value={Math.min(max, Math.max(min, value))} min={min} max={max} step={step} onChange={onChange} label={label} />
      {inline && end}
      {!inline && (start || end) && (
        <div className={s.sliderCaptions} aria-hidden="true">
          <span>{start}</span>
          <span>{end}</span>
        </div>
      )}
    </div>
  );
}

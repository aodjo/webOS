/**
 * Menu bar / Control Center glyphs that lucide doesn't have (drawn to match the macOS templates).
 * All use `currentColor` so they follow the menu bar text color in light and dark mode.
 */
import { useId, type ReactNode } from 'react';
import { Moon, Wifi, WifiHigh, WifiLow } from 'lucide-react';

/**
 * Turns a React `useId()` value into a string usable as an SVG element id.
 *
 * Strips every character other than ASCII letters, digits, `_` and `-`, so the id can be
 * referenced safely from `url(#id)` whatever separator characters `useId()` produces.
 *
 * @param {string} id - The raw id from `useId()`.
 * @returns {string} The sanitized id.
 *
 * @example
 * const mask = safeId(useId());
 * safeId(':r3:'); // "r3"
 */
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * Draws the Control Center glyph: two stacked toggle switches.
 *
 * The first switch has its knob on the right, the second on the left. Height is 7/8 of `size`.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=16] - Width in pixels.
 * @returns {JSX.Element} The glyph SVG.
 *
 * @example
 * <ControlCenterGlyph size={16} />
 */
export function ControlCenterGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.875} viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="14.5" height="5.5" rx="2.75" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12.5" cy="3.5" r="1.75" fill="currentColor" />
      <rect x="0.75" y="7.75" width="14.5" height="5.5" rx="2.75" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="3.5" cy="10.5" r="1.75" fill="currentColor" />
    </svg>
  );
}

/**
 * Draws the battery glyph: an outline with a level fill and an optional charging bolt.
 *
 * The fill width scales with `level` (clamped to 0–1) and never drops below a thin sliver. While
 * charging, a mask cuts a slightly enlarged bolt out of the fill and the bolt itself is drawn on
 * top, leaving a gap around it. A low battery fills in red instead of `currentColor`.
 *
 * @param {Object} props - Component props.
 * @param {number} props.level - Charge level from 0 to 1.
 * @param {boolean} props.charging - Whether to draw the charging bolt.
 * @param {boolean} props.low - Whether to draw the fill in red.
 * @returns {JSX.Element} The 26×12 glyph SVG.
 *
 * @example
 * <BatteryGlyph level={0.42} charging={false} low={false} />
 */
export function BatteryGlyph({ level, charging, low }: { level: number; charging: boolean; low: boolean }) {
  const mask = safeId(useId());
  const w = Math.max(1.5, 17.5 * Math.min(1, Math.max(0, level)));
  const bolt = 'M12.4 1.6 7.4 7.1h3.1l-.9 3.3 5-5.5h-3.1z';
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
      {charging && (
        <mask id={mask}>
          <rect width="26" height="12" fill="#fff" />
          <path d={bolt} fill="#000" stroke="#000" strokeWidth="2.2" strokeLinejoin="round" />
        </mask>
      )}
      <rect x="0.6" y="0.6" width="21.8" height="10.8" rx="3.2" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.1" />
      <path d="M23.6 4.1v3.8a1.9 1.9 0 0 0 0-3.8z" fill="currentColor" fillOpacity="0.45" />
      <rect x="2.2" y="2.2" width={w} height="7.6" rx="1.7" style={{ fill: low ? 'var(--red)' : 'currentColor' }} mask={charging ? `url(#${mask})` : undefined} />
      {charging && <path d={bolt} fill="currentColor" />}
    </svg>
  );
}

/**
 * Draws the input source badge: a filled rounded square with the letter knocked out.
 *
 * The letter is cut out through an SVG mask so the background shows through it. A single Latin
 * letter is drawn at 11px, anything else (e.g. "가") at 10px.
 *
 * @param {Object} props - Component props.
 * @param {string} props.letter - The character(s) identifying the input source, e.g. "A".
 * @returns {JSX.Element} The 17×15 glyph SVG.
 *
 * @example
 * <InputSourceGlyph letter="가" />
 */
export function InputSourceGlyph({ letter }: { letter: string }) {
  const mask = safeId(useId());
  return (
    <svg width="17" height="15" viewBox="0 0 17 15" aria-hidden="true">
      <mask id={mask}>
        <rect width="17" height="15" rx="3.5" fill="#fff" />
        <text x="8.5" y="11.3" textAnchor="middle" fontSize={letter.length === 1 && /[a-z]/i.test(letter) ? 11 : 10} fontWeight="700" fill="#000" style={{ fontFamily: 'var(--font)' }}>
          {letter}
        </text>
      </mask>
      <rect width="17" height="15" rx="3.5" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}

/**
 * Draws the AirDrop glyph: concentric arcs around a dot.
 *
 * Stroked outline icon in `currentColor`.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=14] - Width and height in pixels.
 * @returns {JSX.Element} The glyph SVG.
 *
 * @example
 * <AirDropGlyph size={14} />
 */
export function AirDropGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M3.2 12.2A6.5 6.5 0 1 1 12.8 12.2" />
      <path d="M5.3 10.4a3.6 3.6 0 1 1 5.4 0" />
      <circle cx="8" cy="8.4" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Draws the Stage Manager glyph: a main window with recent-app strips on the left.
 *
 * Stroked outline icon in `currentColor`.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=18] - Width and height in pixels.
 * @returns {JSX.Element} The glyph SVG.
 *
 * @example
 * <StageManagerGlyph size={18} />
 */
export function StageManagerGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="6.5" y="1.7" width="12.3" height="12.6" rx="2" />
      <path d="M1.5 3.5h2.4M1.5 8h2.4M1.5 12.5h2.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Draws the Screen Mirroring glyph: two overlapping displays.
 *
 * Stroked outline icon in `currentColor`.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=18] - Width and height in pixels.
 * @returns {JSX.Element} The glyph SVG.
 *
 * @example
 * <MirroringGlyph size={18} />
 */
export function MirroringGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.2" y="1.2" width="12" height="8.6" rx="1.6" />
      <path d="M6.8 12.2v1.4a1.6 1.6 0 0 0 1.6 1.6h8.8a1.6 1.6 0 0 0 1.6-1.6V7.2a1.6 1.6 0 0 0-1.6-1.6h-1.6" />
    </svg>
  );
}

/**
 * Renders the round 24px badge in front of a status-menu row (network, Focus mode).
 *
 * Centers its children in a filled circle with the given background and foreground colors.
 *
 * @param {Object} props - Component props.
 * @param {string} props.background - CSS background of the circle.
 * @param {string} props.color - CSS color for the content (icons use `currentColor`).
 * @param {ReactNode} props.children - The icon to show inside the circle.
 * @returns {JSX.Element} The badge element.
 *
 * @example
 * <RowBadge background="var(--accent)" color="var(--accent-contrast)"><Wifi size={13} /></RowBadge>
 */
function RowBadge({ background, color, children }: { background: string; color: string; children: ReactNode }) {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background,
        color,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Renders the round badge in front of a network name in the Wi-Fi menu.
 *
 * Picks the Wi-Fi icon with 3, 2 or 1 bars from `strength`. The connected network uses the
 * accent color; others use the neutral active background.
 *
 * @param {Object} props - Component props.
 * @param {1 | 2 | 3} props.strength - Signal strength in bars.
 * @param {boolean} props.active - Whether this is the connected network.
 * @returns {JSX.Element} The badge element.
 *
 * @example
 * <NetworkBadge strength={3} active />
 */
export function NetworkBadge({ strength, active }: { strength: 1 | 2 | 3; active: boolean }) {
  const Icon = strength === 3 ? Wifi : strength === 2 ? WifiHigh : WifiLow;
  return (
    <RowBadge background={active ? 'var(--accent)' : 'var(--active)'} color={active ? 'var(--accent-contrast)' : 'var(--text)'}>
      <Icon size={13} strokeWidth={2.4} />
    </RowBadge>
  );
}

/**
 * Renders the round badge of a Focus mode.
 *
 * Shows a filled moon: white on purple when the Focus mode is on, text-colored on the neutral
 * active background when it is off.
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.active - Whether the Focus mode is on.
 * @returns {JSX.Element} The badge element.
 *
 * @example
 * <FocusBadge active={dndOn} />
 */
export function FocusBadge({ active }: { active: boolean }) {
  return (
    <RowBadge background={active ? 'var(--purple)' : 'var(--active)'} color={active ? 'var(--text-on-accent)' : 'var(--text)'}>
      <Moon size={13} strokeWidth={2.4} fill="currentColor" />
    </RowBadge>
  );
}

/** Laptop / display illustrations whose screen shows the current wallpaper. */
import { useId } from 'react';

/**
 * Returns a per-instance id that is safe inside SVG `url(#…)` references.
 *
 * Wraps React's `useId()` and strips every character other than letters, digits, "_" and "-",
 * because the punctuation React puts in its ids is not valid in a `url(#…)` fragment. Prefixing
 * clip-path and gradient ids with it lets several illustrations render on the same page without
 * their definitions colliding.
 *
 * @returns {string} A sanitized id unique to the calling component instance.
 *
 * @example
 * const id = useSvgId();
 * <clipPath id={`${id}-screen`} />
 */
const useSvgId = () => useId().replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * Renders a laptop illustration whose screen shows a wallpaper image.
 *
 * Draws a decorative (`aria-hidden`) SVG laptop on a 200×120 viewBox: a dark bezel with a camera
 * notch over a gradient-filled base. The wallpaper is an `<image>` clipped to the rounded screen
 * rectangle and scaled to cover it (`xMidYMid slice`). The height follows the viewBox ratio.
 *
 * @param {Object} props - Component props.
 * @param {string} props.wallpaper - URL of the image shown on the screen.
 * @param {number} [props.width=200] - Rendered width in pixels.
 * @returns {JSX.Element} The laptop SVG.
 *
 * @example
 * <LaptopArt wallpaper={useWallpaperURL(wallpaper, dark)} width={210} />
 */
export function LaptopArt({ wallpaper, width = 200 }: { wallpaper: string; width?: number }) {
  const id = useSvgId();
  return (
    <svg width={width} viewBox="0 0 200 120" aria-hidden="true" style={{ display: 'block', filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.22))' }}>
      <defs>
        <clipPath id={`${id}-screen`}>
          <rect x="27" y="8" width="146" height="92" rx="2.5" />
        </clipPath>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9dade" />
          <stop offset="0.55" stopColor="#b7b8bd" />
          <stop offset="1" stopColor="#8d8e93" />
        </linearGradient>
      </defs>
      <rect x="22" y="3" width="156" height="102" rx="8" fill="#151517" stroke="#9a9a9f" strokeOpacity="0.55" strokeWidth="1" />
      <image href={wallpaper} x="27" y="8" width="146" height="92" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-screen)`} />
      <rect x="92.5" y="8" width="15" height="3.4" rx="1.7" fill="#151517" />
      <path d="M4 105h192v3.2c0 3.2-2.6 5.8-5.8 5.8H9.8C6.6 114 4 111.4 4 108.2z" fill={`url(#${id}-base)`} />
      <path d="M84 105h32c0 1.5-1.2 2.5-2.7 2.5H86.7c-1.5 0-2.7-1-2.7-2.5z" fill="#000" opacity="0.22" />
    </svg>
  );
}

/**
 * Renders an external display illustration whose screen shows a wallpaper image.
 *
 * Draws a decorative (`aria-hidden`) SVG monitor on a 180×140 viewBox: a dark bezel with a light
 * chin, standing on a gradient-filled stand and a flat foot. The wallpaper is an `<image>` clipped
 * to the rounded screen rectangle and scaled to cover it (`xMidYMid slice`). The height follows
 * the viewBox ratio.
 *
 * @param {Object} props - Component props.
 * @param {string} props.wallpaper - URL of the image shown on the screen.
 * @param {number} [props.width=180] - Rendered width in pixels.
 * @returns {JSX.Element} The display SVG.
 *
 * @example
 * <DisplayArt wallpaper={url} width={170} />
 */
export function DisplayArt({ wallpaper, width = 180 }: { wallpaper: string; width?: number }) {
  const id = useSvgId();
  return (
    <svg width={width} viewBox="0 0 180 140" aria-hidden="true" style={{ display: 'block', filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.2))' }}>
      <defs>
        <clipPath id={`${id}-screen`}>
          <rect x="8" y="8" width="164" height="94" rx="2" />
        </clipPath>
        <linearGradient id={`${id}-stand`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9cacf" />
          <stop offset="1" stopColor="#9c9da2" />
        </linearGradient>
      </defs>
      <path d="M76 110h28l5 22H71z" fill={`url(#${id}-stand)`} />
      <rect x="62" y="130" width="56" height="5" rx="2" fill="#a9aaaf" />
      <rect x="3" y="3" width="174" height="110" rx="6" fill="#151517" stroke="#9a9a9f" strokeOpacity="0.55" />
      <image href={wallpaper} x="8" y="8" width="164" height="94" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-screen)`} />
      <path d="M3 102h174v5a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6z" fill="#d4d5d9" />
    </svg>
  );
}

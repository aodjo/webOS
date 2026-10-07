/**
 * The small icon Safari shows for a page (tabs, sidebar, history, suggestions, Reading List).
 */
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { owner } from '@/data/portfolio';
import { PORTFOLIO_URL, kindOfURL } from './url';
import styles from './SiteIcon.module.css';

/**
 * Returns the picture that stands for a page.
 *
 * The portfolio page uses the owner's avatar; web sites use their own `/favicon.ico`, loaded from
 * the site itself; other pages have none.
 *
 * @param {string} url - The page URL.
 * @returns {string | null} The image URL, or null when there is no picture.
 *
 * @example
 * faviconFor('https://github.com/aodjo'); // 'https://github.com/favicon.ico'
 */
export function faviconFor(url: string): string | null {
  if (url === PORTFOLIO_URL) return owner.avatar || null;
  if (kindOfURL(url) !== 'web') return null;
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/**
 * Renders a page's icon at a given size.
 *
 * Shows the picture from faviconFor (round for the owner's photo); when there is none or it
 * fails to load, a globe glyph is drawn instead. The failure is remembered per URL, so a new
 * page tries again.
 *
 * @param {Object} props - Component props.
 * @param {string} props.url - The page URL.
 * @param {number} props.size - Width and height in px.
 * @returns {JSX.Element} The icon (hidden from assistive technology).
 *
 * @example
 * <SiteIcon url={tabURL} size={16} />
 */
export function SiteIcon({ url, size }: { url: string; size: number }) {
  const src = faviconFor(url);
  const [failed, setFailed] = useState<string | null>(null);
  const photo = url === PORTFOLIO_URL;
  return (
    <span className={`${styles.icon} ${photo ? styles.photo : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      {src && failed !== src ? <img src={src} alt="" draggable={false} onError={() => setFailed(src)} /> : <Globe size={Math.round(size * 0.85)} strokeWidth={1.8} />}
    </span>
  );
}

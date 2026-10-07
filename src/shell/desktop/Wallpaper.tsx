/**
 * Desktop picture. A built-in wallpaper id (with light/dark variants) or an image file from the
 * virtual FS. The new picture is preloaded, then crossfaded over the previous one.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { fs, useIsDark, useNode, useSystem, wallpaperURL } from '@/kernel';
import styles from './Desktop.module.css';

/**
 * Wraps a URL in a CSS `url()` value.
 *
 * The URL is JSON-quoted so data URLs and paths containing spaces, quotes or parentheses stay
 * valid inside the CSS function.
 *
 * @param {string} u - Image URL.
 * @returns {string} A CSS `url("…")` value.
 *
 * @example
 * cssUrl('/wallpapers/sky.jpg'); // 'url("/wallpapers/sky.jpg")'
 */
const cssUrl = (u: string) => `url(${JSON.stringify(u)})`;

/**
 * Desktop picture that crossfades whenever the wallpaper changes.
 *
 * Resolves the wallpaper setting to a URL: a built-in id uses its light or dark variant, and an
 * absolute path uses that image file's URL, falling back to the default wallpaper while the file
 * is missing. Subscribing to the file's node re-resolves the picture when the file appears,
 * changes or goes away. A new URL is preloaded first; once it has loaded (or failed) it is
 * added as a layer that fades in over the previous one, and the older layer is removed when the
 * fade animation ends. Wrapped in `memo`, so it re-renders only through its own subscriptions.
 *
 * @returns {JSX.Element} The wallpaper container.
 *
 * @example
 * <Wallpaper />
 */
export const Wallpaper = memo(function Wallpaper() {
  const wallpaper = useSystem((s) => s.settings.wallpaper);
  const dark = useIsDark();
  const node = useNode(wallpaper.startsWith('/') ? wallpaper : null);
  const url = wallpaperURL(wallpaper, dark, () => (node?.type === 'file' ? fs.getURL(node.path) : null));

  const [layers, setLayers] = useState(() => [{ id: 0, url }]);
  const nextId = useRef(1);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    /**
     * Adds the preloaded picture as the new top layer.
     *
     * Keeps only the current top layer beneath it, so at most two layers crossfade, and skips
     * the update when the URL is already on top or the effect has been cleaned up.
     *
     * @returns {void}
     *
     * @example
     * img.onload = show;
     */
    const show = () => {
      if (cancelled) return;
      setLayers((ls) => (ls[ls.length - 1].url === url ? ls : [...ls.slice(-1), { id: nextId.current++, url }]));
    };
    img.onload = show;
    img.onerror = show;
    img.src = url;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  return (
    <div className={styles.wallpaper} aria-hidden>
      {layers.map((l, i) => (
        <div
          key={l.id}
          className={`${styles.wallpaperLayer} ${i > 0 ? styles.wallpaperFadeIn : ''}`}
          style={{ backgroundImage: cssUrl(l.url) }}
          onAnimationEnd={i > 0 ? () => setLayers((ls) => ls.slice(-1)) : undefined}
        />
      ))}
    </div>
  );
});

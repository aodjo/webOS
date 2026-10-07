/**
 * Background of the lock and login screens, built from the current wallpaper.
 */
import styles from './LockBackdrop.module.css';
import { useWallpaperURL } from './images';

/**
 * Renders the lock/login screen backdrop.
 *
 * Stacks three layers over black: the sharp wallpaper, a blurred and slightly zoomed copy of
 * it (kept transparent by the stylesheet, so the picture shows sharp), and a top/bottom
 * darkening scrim. When `clear` is set, the scrim fades out and the blurred layer scales back
 * to normal (opacity and transform only), leaving the sharp wallpaper exactly where the
 * desktop draws it, so unlocking hands over to the desktop without a visible jump. The
 * backdrop is hidden from assistive technology.
 *
 * @param {Object} props - Component props.
 * @param {boolean} [props.clear=false] - Fades out the scrim to reveal the bare sharp wallpaper.
 * @returns {JSX.Element} The backdrop layers.
 *
 * @example
 * <LockBackdrop clear={unlocking} />
 */
export function LockBackdrop({ clear = false }: { clear?: boolean }) {
  const url = useWallpaperURL();
  const bg = { backgroundImage: `url(${JSON.stringify(url)})` };
  return (
    <div className={`${styles.root} ${clear ? styles.clear : ''}`} aria-hidden="true">
      <div className={styles.sharp} style={bg} />
      <div className={styles.blurred} style={bg} />
      <div className={styles.scrim} />
    </div>
  );
}

/**
 * Reactive image URLs for the power screens (wallpaper + avatar). Both settings can point at a
 * public asset or at a file in the virtual FS, so the FS node is subscribed to for live updates.
 */
import { useMemo } from 'react';
import { fs, useNode } from '@/kernel/fs';
import { useIsDark, useSystem } from '@/kernel/system';
import { wallpaperURL } from '@/kernel/wallpapers';

/**
 * Returns the path when it is a virtual FS path, otherwise null.
 *
 * Virtual FS paths are absolute (start with '/'); anything else is a built-in id or a URL and
 * must not be looked up in the FS.
 *
 * @param {string} p - A setting value: FS path, built-in id or URL.
 * @returns {string | null} The FS path, or null.
 *
 * @example
 * fsPathOrNull('/Users/guest/Pictures/me.png'); // '/Users/guest/Pictures/me.png'
 */
const fsPathOrNull = (p: string) => (p.startsWith('/') ? p : null);

/**
 * Resolves the wallpaper setting to an image URL, the same way the desktop does.
 *
 * A built-in wallpaper id resolves to its light or dark variant according to the current
 * appearance; an FS path resolves to that file's URL, falling back to the default wallpaper when
 * the file doesn't exist. Re-renders when the setting, the appearance or the FS node changes.
 *
 * @returns {string} The wallpaper image URL.
 *
 * @example
 * const url = useWallpaperURL();
 * return <img src={url} alt="" />;
 */
export function useWallpaperURL(): string {
  const value = useSystem((s) => s.settings.wallpaper);
  const dark = useIsDark();
  const node = useNode(fsPathOrNull(value));
  return useMemo(
    () => wallpaperURL(value, dark, () => (node && node.type === 'file' ? fs.getURL(node.path) : null)),
    [value, dark, node],
  );
}

/**
 * Resolves an image setting (public asset path or FS image path) to a URL.
 *
 * When the path names an existing file in the virtual FS, that file's URL is returned and kept
 * up to date as the node changes; otherwise the raw value is returned unchanged.
 *
 * @param {string} path - A public asset path / URL or a virtual FS path.
 * @returns {string} A URL usable as an image source.
 *
 * @example
 * const url = useImageURL(avatar);
 */
export function useImageURL(path: string): string {
  const node = useNode(fsPathOrNull(path));
  return useMemo(() => (node && node.type === 'file' ? fs.getURL(node.path) : path), [node, path]);
}

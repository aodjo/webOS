/**
 * Image helpers: settings like the wallpaper and avatar hold either a public asset path, a
 * built-in id or a path in the virtual FS. These hooks resolve them to URLs and stay reactive
 * to FS changes.
 */
import { useMemo } from 'react';
import { fs, useNode, WALLPAPERS, wallpaperURL, basename, kindOf, type LString } from '@/kernel';

/**
 * Returns the value when it looks like an absolute virtual-FS path, otherwise `null`.
 *
 * Used to subscribe to an FS node only for FS-backed values; passing `null` to `useNode`
 * subscribes to nothing.
 *
 * @param {string} p - A setting value (FS path, asset URL or built-in id).
 * @returns {string | null} The path if it starts with "/", else `null`.
 *
 * @example
 * fsPathOrNull('/Users/me/Pictures/cat.png'); // "/Users/me/Pictures/cat.png"
 * fsPathOrNull('hallasan');                   // null
 */
const fsPathOrNull = (p: string) => (p.startsWith('/') ? p : null);

/**
 * Resolves an image setting value to a URL usable in `<img src>`.
 *
 * When the value is a path to an existing file in the virtual FS, returns that file's URL
 * (`fs.getURL`) and updates when the file changes. Any other value (a public asset path, a data
 * URL, or an FS path that no longer exists) is returned unchanged.
 *
 * @param {string} path - The image setting value.
 * @returns {string} A URL for the image.
 *
 * @example
 * const url = useImageURL(settings.avatar);
 * return <img src={url} alt="" />;
 */
export function useImageURL(path: string): string {
  const node = useNode(fsPathOrNull(path));
  return useMemo(() => (node && node.type === 'file' ? fs.getURL(node.path) : path), [node, path]);
}

/**
 * Resolves a wallpaper setting value to an image URL for the given appearance.
 *
 * Delegates to `wallpaperURL`, supplying a resolver that returns the URL of the FS file when the
 * value is an existing FS image. Built-in ids pick their dark or light variant, and missing FS
 * files or unknown ids fall back to the default wallpaper. Re-renders when the FS node changes.
 *
 * @param {string} value - The `settings.wallpaper` value (built-in id or FS path).
 * @param {boolean} dark - Whether the dark variant of a built-in wallpaper should be used.
 * @returns {string} The wallpaper image URL.
 *
 * @example
 * const url = useWallpaperURL(settings.wallpaper, isDark);
 * return <div style={{ backgroundImage: `url(${url})` }} />;
 */
export function useWallpaperURL(value: string, dark: boolean): string {
  const node = useNode(fsPathOrNull(value));
  return useMemo(() => wallpaperURL(value, dark, () => (node && node.type === 'file' ? fs.getURL(node.path) : null)), [value, dark, node]);
}

/**
 * Returns the display name of a wallpaper setting value.
 *
 * FS paths are named after their file name; built-in ids use the wallpaper's localized name;
 * unknown ids are returned as-is.
 *
 * @param {string} value - The `settings.wallpaper` value (built-in id or FS path).
 * @returns {LString} The name to show (a plain string for files and unknown ids).
 *
 * @example
 * t(wallpaperName('/Users/me/Pictures/beach.jpg')); // "beach.jpg"
 */
export function wallpaperName(value: string): LString {
  if (value.startsWith('/')) return basename(value);
  return WALLPAPERS.find((w) => w.id === value)?.name ?? value;
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']; /** File extensions accepted by the image open panels in Settings. */

/**
 * Tells whether a virtual-FS path points to an image file.
 *
 * Looks the path up with `fs.stat` (which never throws) and checks that it is a file whose kind
 * is "image".
 *
 * @param {string} path - Absolute path in the virtual FS.
 * @returns {boolean} `true` if the node exists, is a file and is an image.
 *
 * @example
 * if (isImagePath(picked)) update({ wallpaper: picked });
 */
export function isImagePath(path: string): boolean {
  const n = fs.stat(path);
  return !!n && n.type === 'file' && kindOf(n) === 'image';
}

/**
 * Builds a built-in profile picture as an SVG data URL.
 *
 * Draws a 100×100 square with a vertical gradient from `from` to `to` and a centered emoji
 * glyph, so the built-in avatars need no extra asset files. The SVG is URI-encoded into a
 * `data:image/svg+xml` URL.
 *
 * @param {string} from - Gradient color at the top.
 * @param {string} to - Gradient color at the bottom.
 * @param {string} glyph - Emoji drawn in the middle.
 * @returns {string} A data URL of the generated SVG.
 *
 * @example
 * const src = avatarSVG('#ffd38a', '#ff9f43', '🐱');
 */
function avatarSVG(from: string, to: string, glyph: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#g)"/>` +
    `<text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="52" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${glyph}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const BUILTIN_AVATARS: { id: string; src: string; name: LString }[] = [
  { id: 'cat', src: avatarSVG('#ffd38a', '#ff9f43', '🐱'), name: { en: 'Cat', ko: '고양이' } },
  { id: 'rocket', src: avatarSVG('#8ec5ff', '#3a7bfd', '🚀'), name: { en: 'Rocket', ko: '로켓' } },
  { id: 'cactus', src: avatarSVG('#b6f0a8', '#36b37e', '🌵'), name: { en: 'Cactus', ko: '선인장' } },
  { id: 'headphones', src: avatarSVG('#f6b3ff', '#a24bff', '🎧'), name: { en: 'Headphones', ko: '헤드폰' } },
  { id: 'tangerine', src: avatarSVG('#fff1a8', '#ffc53d', '🍊'), name: { en: 'Tangerine', ko: '귤' } },
  { id: 'mountain', src: avatarSVG('#c9d6ff', '#7f8cff', '🏔️'), name: { en: 'Mountain', ko: '산' } },
]; /** Built-in profile pictures offered in Users & Groups (generated SVG data URLs). */

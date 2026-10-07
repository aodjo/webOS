import type { LString } from './types';

/** A built-in desktop wallpaper. */
export interface Wallpaper {
  id: string;
  name: LString;
  /** Public asset path of the light-mode image. */
  light: string;
  /** Public asset path of the dark-mode image; `light` is used in dark mode when absent. */
  dark?: string;
}

export const WALLPAPERS: Wallpaper[] = [
  { id: 'flow', name: { en: 'Flow', ko: '물결' }, light: '/wallpapers/flow-light.jpg', dark: '/wallpapers/flow-dark.jpg' },
  { id: 'hallasan', name: { en: 'Hallasan', ko: '한라산' }, light: '/wallpapers/hallasan-light.svg', dark: '/wallpapers/hallasan-dark.svg' },
  { id: 'jeju', name: { en: 'Jeju Sea', ko: '제주 바다' }, light: '/wallpapers/jeju-light.svg', dark: '/wallpapers/jeju-dark.svg' },
  { id: 'aurora', name: { en: 'Aurora', ko: '오로라' }, light: '/wallpapers/aurora-light.svg', dark: '/wallpapers/aurora-dark.svg' },
  { id: 'seoul', name: { en: 'Seoul Night', ko: '서울의 밤' }, light: '/wallpapers/seoul-light.svg', dark: '/wallpapers/seoul-dark.svg' },
  { id: 'bloom', name: { en: 'Bloom', ko: '블룸' }, light: '/wallpapers/bloom-light.svg', dark: '/wallpapers/bloom-dark.svg' },
  { id: 'graphite', name: { en: 'Graphite', ko: '그래파이트' }, light: '/wallpapers/graphite-light.svg', dark: '/wallpapers/graphite-dark.svg' },
]; /** Built-in wallpapers (images in /public/wallpapers), each with a light and a dark variant. */

export const DEFAULT_WALLPAPER = 'flow'; /** Id of the default wallpaper, also the fallback for unknown ids and unresolvable image paths. */

/**
 * Resolves the `settings.wallpaper` value to an image URL.
 *
 * The value is either a built-in wallpaper id or an absolute FS path to an image (set from
 * Finder → "Set Desktop Picture" or Settings). A path is turned into a URL by `resolveFsPath`;
 * when that yields nothing (e.g. the file was deleted), or the id is unknown, the default
 * wallpaper is used. Built-in wallpapers return their dark variant in dark mode when they have one.
 *
 * @param {string} value - The wallpaper setting: a built-in id or an absolute FS path.
 * @param {boolean} dark - Whether dark mode is active.
 * @param {(p: string) => string | null} resolveFsPath - Maps an FS path to a displayable URL,
 *   or null when the path cannot be shown.
 * @returns {string} URL of the image to show on the desktop.
 *
 * @example
 * const url = wallpaperURL(settings.wallpaper, dark, (p) => (fs.stat(p)?.type === 'file' ? fs.getURL(p) : null));
 */
export function wallpaperURL(value: string, dark: boolean, resolveFsPath: (p: string) => string | null): string {
  if (value.startsWith('/')) {
    const url = resolveFsPath(value);
    if (url) return url;
  }
  const wp = WALLPAPERS.find((w) => w.id === value) ?? WALLPAPERS.find((w) => w.id === DEFAULT_WALLPAPER)!;
  return dark ? wp.dark ?? wp.light : wp.light;
}

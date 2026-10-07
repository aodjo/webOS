/**
 * Picks the menu bar's foreground (light or dark glyphs) from the wallpaper behind it, like the
 * transparent macOS 26 menu bar.
 *
 * The strip of the desktop picture under the bar — cropped exactly as the desktop draws it
 * (`background-size: cover`, centered) — is drawn into a tiny canvas and its mean relative
 * luminance decides. Wallpapers are same-origin files or data:/blob: URLs, so the canvas stays
 * readable; anything else (a tainted canvas, a picture that fails to load, no canvas at all)
 * yields `null` and the caller falls back to the theme.
 */
import { useEffect, useState } from 'react';
import { fs, useIsDark, useNode, useSystem, wallpaperURL } from '@/kernel';
import { MENU_BAR_HEIGHT } from '@/kernel/constants';

/** Glyph color of the menu bar: `light` glyphs for dark wallpapers, `dark` glyphs for bright ones. */
export type BarForeground = 'light' | 'dark';

const SAMPLE_W = 64; /** Width in px of the canvas the sampled wallpaper strip is scaled into. */
const SAMPLE_H = 4; /** Height in px of the canvas the sampled wallpaper strip is scaled into. */

export const DARK_GLYPHS_ABOVE = 0.22; /** Luminance above which dark glyphs win; set above the ≈ 0.18 equal-contrast point because light glyphs get a dark halo. */

/**
 * Converts an 8-bit sRGB channel to linear light.
 *
 * Applies the sRGB transfer function (linear segment below 0.04045, 2.4 power curve above),
 * as required for the relative-luminance formula.
 *
 * @param {number} c - Channel value, 0–255.
 * @returns {number} Linear channel intensity, 0–1.
 *
 * @example
 * toLinear(255); // 1
 * toLinear(128); // ≈ 0.216
 */
const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/**
 * Computes the mean relative luminance of RGBA pixel data.
 *
 * Each pixel's luminance (Rec. 709 weights on linearized channels) is weighted by its alpha,
 * so fully transparent pixels are ignored and translucent ones count partially. A trailing
 * incomplete pixel is skipped.
 *
 * @param {ArrayLike<number>} data - Flat RGBA bytes (e.g. `ImageData.data`).
 * @returns {number | null} Mean luminance (0–1), or null when every pixel is transparent.
 *
 * @example
 * meanLuminance([255, 255, 255, 255, 0, 0, 0, 255]); // 0.5
 * meanLuminance([0, 0, 0, 0]); // null
 */
export function meanLuminance(data: ArrayLike<number>): number | null {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a <= 0) continue;
    sum += a * (0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2]));
    weight += a;
  }
  return weight > 0 ? sum / weight : null;
}

/**
 * Picks the menu bar glyph color for a background luminance.
 *
 * Compares against `DARK_GLYPHS_ABOVE`; a luminance exactly at the threshold still gets
 * light glyphs.
 *
 * @param {number} luminance - Mean relative luminance (0–1) of the wallpaper under the bar.
 * @returns {BarForeground} `dark` above `DARK_GLYPHS_ABOVE`, otherwise `light`.
 *
 * @example
 * foregroundFor(0.9); // 'dark'
 * foregroundFor(0.05); // 'light'
 */
export function foregroundFor(luminance: number): BarForeground {
  return luminance > DARK_GLYPHS_ABOVE ? 'dark' : 'light';
}

/**
 * Maps the strip under the menu bar to a source rectangle in the wallpaper image.
 *
 * The desktop draws the wallpaper with `background-size: cover; background-position: center`,
 * so the image is scaled by the larger of the two viewport/image ratios and the overflow is
 * cropped equally on both sides. The result is the part of the image (in image px) that lies
 * under the top `barH` px of the viewport; its height is at least 1 px.
 *
 * @param {number} iw - Natural image width in px.
 * @param {number} ih - Natural image height in px.
 * @param {number} vw - Viewport width in CSS px.
 * @param {number} vh - Viewport height in CSS px.
 * @param {number} barH - Menu bar height in CSS px.
 * @returns {{ sx: number; sy: number; sw: number; sh: number }} Source rectangle for `drawImage`.
 *
 * @example
 * coverStrip(2880, 1800, 1440, 900, 26); // { sx: 0, sy: 0, sw: 2880, sh: 52 }
 */
export function coverStrip(iw: number, ih: number, vw: number, vh: number, barH: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(vw / iw, vh / ih);
  const sw = Math.min(iw, vw / scale);
  const visibleH = Math.min(ih, vh / scale);
  return { sx: (iw - sw) / 2, sy: (ih - visibleH) / 2, sw, sh: Math.max(1, Math.min(visibleH, barH / scale)) };
}

/** A rectangle of the viewport, in fractions (0–1) of its width (`x0`, `x1`) and height (`y0`, `y1`). */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Maps a viewport region to a source rectangle in the wallpaper image.
 *
 * Uses the same `cover` scaling and centering as `coverStrip`, then converts the region's
 * fractional corners to image px. The rectangle is clamped to the image bounds and is at
 * least 1 px wide and tall.
 *
 * @param {number} iw - Natural image width in px.
 * @param {number} ih - Natural image height in px.
 * @param {number} vw - Viewport width in CSS px.
 * @param {number} vh - Viewport height in CSS px.
 * @param {Region} r - The viewport region, in fractions of the viewport size.
 * @returns {{ sx: number; sy: number; sw: number; sh: number }} Source rectangle for `drawImage`.
 *
 * @example
 * coverRect(2880, 1800, 1440, 900, { x0: 0, y0: 0, x1: 1, y1: 1 }); // { sx: 0, sy: 0, sw: 2880, sh: 1800 }
 */
export function coverRect(iw: number, ih: number, vw: number, vh: number, r: Region): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(vw / iw, vh / ih);
  const ox = (iw - vw / scale) / 2;
  const oy = (ih - vh / scale) / 2;
  const sx = Math.max(0, ox + (r.x0 * vw) / scale);
  const sy = Math.max(0, oy + (r.y0 * vh) / scale);
  return { sx, sy, sw: Math.max(1, Math.min(iw - sx, ((r.x1 - r.x0) * vw) / scale)), sh: Math.max(1, Math.min(ih - sy, ((r.y1 - r.y0) * vh) / scale)) };
}

/**
 * Measures the mean luminance of the wallpaper under a viewport region.
 *
 * Draws the matching part of the image (the strip under the menu bar when no region is given)
 * scaled into a `SAMPLE_W`×`SAMPLE_H` canvas and averages its pixels. An image without an
 * intrinsic size (some SVGs) is sampled as a whole. Errors from a tainted (cross-origin)
 * canvas or missing 2D canvas support are caught.
 *
 * @param {HTMLImageElement} img - The loaded wallpaper image.
 * @param {number} vw - Viewport width in CSS px.
 * @param {number} vh - Viewport height in CSS px.
 * @param {Region} [region] - Viewport region to sample; defaults to the strip under the menu bar.
 * @returns {number | null} Mean relative luminance (0–1), or null when the pixels can't be read.
 *
 * @example
 * const lum = sample(img, window.innerWidth, window.innerHeight);
 * if (lum !== null) setForeground(foregroundFor(lum));
 */
function sample(img: HTMLImageElement, vw: number, vh: number, region?: Region): number | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    if (img.naturalWidth && img.naturalHeight) {
      const r = region ? coverRect(img.naturalWidth, img.naturalHeight, vw, vh, region) : coverStrip(img.naturalWidth, img.naturalHeight, vw, vh, MENU_BAR_HEIGHT);
      ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, SAMPLE_W, SAMPLE_H);
    } else {
      ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
    }
    return meanLuminance(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
  } catch {
    return null;
  }
}

/**
 * Tracks the viewport size for wallpaper sampling.
 *
 * Both dimensions are rounded to multiples of 16 px (minimum 1) so tiny resizes don't trigger
 * a resample, and the state is updated only 200 ms after the last `resize` event. The listener
 * and any pending timer are removed on unmount.
 *
 * @returns {{ w: number; h: number }} The rounded viewport width and height in CSS px.
 *
 * @example
 * const { w, h } = useViewport();
 * const lum = sample(img, w, h);
 */
function useViewport(): { w: number; h: number } {
  /**
   * Reads the current window size rounded to multiples of 16 px.
   *
   * Used both as the lazy initial state and when a debounced resize commits, so the two
   * always round the same way.
   *
   * @returns {{ w: number; h: number }} The rounded viewport width and height (at least 1).
   *
   * @example
   * const [size, setSize] = useState(read);
   */
  const read = () => ({ w: Math.max(1, Math.round(window.innerWidth / 16) * 16), h: Math.max(1, Math.round(window.innerHeight / 16) * 16) });
  const [size, setSize] = useState(read);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    /**
     * Debounces window resizes, committing the new rounded size 200 ms after the last one.
     *
     * Keeps the previous state object when the rounded size is unchanged, so no re-render
     * or resample happens.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('resize', onResize);
     */
    const onResize = () => {
      clearTimeout(id);
      id = setTimeout(() => {
        const next = read();
        setSize((s) => (s.w === next.w && s.h === next.h ? s : next));
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(id);
    };
  }, []);
  return size;
}

/**
 * Picks the menu bar glyph color for the current desktop picture.
 *
 * Samples the wallpaper under the menu bar via `useWallpaperLuminance` and keeps the previous
 * answer while a new picture loads, so the bar doesn't flicker. `dim` scales the sampled
 * luminance to account for a shade drawn over the wallpaper under the bar (e.g. Mission
 * Control's darkened backdrop).
 *
 * @param {number} [dim=1] - Luminance multiplier for an overlay shade; 1 is the bare desktop.
 * @returns {BarForeground | null} The glyph color, or null while unknown or when the picture
 *   can't be sampled (callers then fall back to the theme).
 *
 * @example
 * const sampled = useWallpaperForeground(missionControlOpen ? MISSION_CONTROL_DIM : 1);
 * const foreground = sampled ?? (dark ? 'light' : 'dark');
 */
export function useWallpaperForeground(dim = 1): BarForeground | null {
  const lum = useWallpaperLuminance();
  return lum === null ? null : foregroundFor(lum * dim);
}

/**
 * Measures the luminance of the desktop picture under a viewport region.
 *
 * Resolves the wallpaper URL the same way the desktop does (a built-in id with its light/dark
 * variant, or a file in the virtual FS, re-resolved when that file changes), loads it into an
 * off-screen image, and samples it whenever the image, the rounded viewport size or the
 * region changes. Callers use it to keep text drawn straight on the wallpaper legible (menu
 * bar, desktop icon labels, lock screen). The region is compared by its coordinates, so an
 * inline object literal does not cause resampling on every render.
 *
 * @param {Region} [region] - Viewport region to sample; defaults to the strip under the menu bar.
 * @returns {number | null} Mean relative luminance (0–1), or null while unknown, after a load
 *   error, or when the picture can't be sampled.
 *
 * @example
 * const iconAreaLum = useWallpaperLuminance({ x0: 0.7, y0: 0.03, x1: 1, y1: 0.65 });
 * const labelTone = iconAreaLum !== null && iconAreaLum > 0.3 ? 'dark' : 'light';
 */
export function useWallpaperLuminance(region?: Region): number | null {
  const rx0 = region?.x0;
  const ry0 = region?.y0;
  const rx1 = region?.x1;
  const ry1 = region?.y1;
  const wallpaper = useSystem((s) => s.settings.wallpaper);
  const dark = useIsDark();
  const node = useNode(wallpaper.startsWith('/') ? wallpaper : null);
  const url = wallpaperURL(wallpaper, dark, () => {
    if (node?.type !== 'file') return null;
    try {
      return fs.getURL(node.path);
    } catch {
      return null;
    }
  });
  const { w, h } = useViewport();
  const [img, setImg] = useState<{ url: string; el: HTMLImageElement } | null>(null);
  const [lum, setLum] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = new Image();
    el.decoding = 'async';
    el.onload = () => {
      if (!cancelled) setImg({ url, el });
    };
    el.onerror = () => {
      if (!cancelled) setLum(null);
    };
    el.src = url;
    return () => {
      cancelled = true;
      el.onload = null;
      el.onerror = null;
    };
  }, [url]);

  useEffect(() => {
    const r = rx0 === undefined ? undefined : { x0: rx0, y0: ry0!, x1: rx1!, y1: ry1! };
    if (img && img.url === url) setLum(sample(img.el, w, h, r));
  }, [img, url, w, h, rx0, ry0, rx1, ry1]);

  return lum;
}

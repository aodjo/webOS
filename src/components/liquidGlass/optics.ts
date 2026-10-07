/**
 * Optics for Liquid Glass surfaces: lens displacement, specular rim light and edge light-bleed
 * masks, rendered into small images that an SVG filter applies to the backdrop.
 *
 * The glass is modelled as a slab whose rim (the "bezel") is a convex squircle bulge. A view ray
 * hitting the bulge is refracted (Snell's law, n = 1.5) and lands on the backdrop further toward
 * the centre, which is what makes content bend and concentrate along the edges while the flat
 * middle stays clear.
 */

export interface LensParams {
  /** Element size in CSS px. */
  width: number;
  height: number;
  /** Corner radius in CSS px (clamped to half the shortest side). */
  radius: number;
  /** Width of the curved rim in px. */
  bezel: number;
  /** Height of the bulge relative to the bezel width (0–1). */
  thickness: number;
  /** Refractive index of the glass. */
  ior: number;
}

export interface LensMaps {
  /** Displacement map: R/G encode x/y offsets (128 = none). */
  displacement: string;
  /** feDisplacementMap scale that reproduces the computed offsets in px. */
  scale: number;
  /** White specular rim light with alpha = intensity. */
  specular: string;
  /** Alpha mask of the band where backdrop light bleeds into the glass. */
  edge: string;
}

const PROFILE_SAMPLES = 128; /** Resolution of the 1-D refraction profile across the bezel. */
const MAX_MAP = 640; /** Longest side of a generated map; larger surfaces use a stretched map. */
const LIGHT = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }; /** Key light direction (from the top-left). */

/**
 * Height of the convex squircle bulge at a position across the bezel.
 *
 * Uses y = (1 − (1 − x)^4)^(1/4), which rises steeply at the outer edge and flattens smoothly
 * toward the inside, so refraction stays strong at the rim and fades without a visible seam.
 *
 * @param {number} x - Position across the bezel, 0 at the outer edge and 1 where it meets the flat top.
 * @returns {number} Normalized surface height between 0 and 1.
 *
 * @example
 * squircleHeight(1); // 1 (flat top)
 */
export function squircleHeight(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return Math.pow(1 - Math.pow(1 - t, 4), 0.25);
}

/**
 * Lateral offset of the refracted ray at each sample across the bezel.
 *
 * For every sample the surface slope gives the incidence angle of a ray looking straight down;
 * Snell's law gives the refracted angle, and the ray's travel through the remaining glass height
 * turns the angular deviation into a sideways offset in px. The offsets point toward the inside
 * of the shape.
 *
 * @param {number} bezel - Bezel width in px.
 * @param {number} thickness - Bulge height relative to the bezel width.
 * @param {number} ior - Refractive index of the glass.
 * @returns {{ offsets: Float32Array, max: number }} Offsets in px per sample and their maximum.
 *
 * @example
 * const { max } = refractionProfile(16, 0.9, 1.5);
 */
export function refractionProfile(bezel: number, thickness: number, ior: number): { offsets: Float32Array; max: number } {
  const offsets = new Float32Array(PROFILE_SAMPLES);
  const height = bezel * thickness;
  const dx = 1 / PROFILE_SAMPLES;
  let max = 0;
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const x = (i + 0.5) / PROFILE_SAMPLES;
    const slope = ((squircleHeight(x + dx) - squircleHeight(x - dx)) / (2 * dx)) * (height / bezel);
    const incidence = Math.atan(Math.abs(slope));
    const refracted = Math.asin(Math.sin(incidence) / ior);
    const travel = height * squircleHeight(x) + height * 0.25;
    const offset = travel * Math.tan(incidence - refracted);
    offsets[i] = offset;
    if (offset > max) max = offset;
  }
  return { offsets, max };
}

/**
 * Signed distance from a point to a rounded rectangle centred on the origin.
 *
 * Negative inside the shape, positive outside, zero on the outline.
 *
 * @param {number} px - Point x relative to the centre.
 * @param {number} py - Point y relative to the centre.
 * @param {number} hw - Half width of the rectangle.
 * @param {number} hh - Half height of the rectangle.
 * @param {number} r - Corner radius.
 * @returns {number} Signed distance in px.
 *
 * @example
 * sdRoundRect(0, 0, 50, 20, 10); // -20
 */
export function sdRoundRect(px: number, py: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Renders the displacement, specular and edge maps for one surface.
 *
 * Walks every pixel of the (possibly downscaled) map, finds its distance to the outline and the
 * outward normal from the SDF gradient, then writes: the refracted offset along the inward normal
 * (displacement), a rim light whose intensity follows how much the bulge faces the key light plus
 * a weaker bounce on the opposite rim (specular), and a soft band hugging the edge (edge mask).
 * Returns empty strings when no 2D canvas is available.
 *
 * @param {LensParams} p - Surface geometry and glass properties.
 * @returns {LensMaps} Data URLs of the three maps and the displacement scale in px.
 *
 * @example
 * const maps = renderLensMaps({ width: 300, height: 60, radius: 30, bezel: 14, thickness: 0.9, ior: 1.5 });
 */
export function renderLensMaps(p: LensParams): LensMaps {
  const k = Math.min(1, MAX_MAP / Math.max(p.width, p.height));
  const cw = Math.max(2, Math.round(p.width * k));
  const ch = Math.max(2, Math.round(p.height * k));
  /**
   * Creates a canvas the size of the (possibly downscaled) map.
   *
   * @returns {HTMLCanvasElement} A blank canvas.
   *
   * @example
   * const canvas = make();
   */
  const make = () => {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return c;
  };
  const dCanvas = make();
  const sCanvas = make();
  const eCanvas = make();
  const dCtx = dCanvas.getContext('2d');
  const sCtx = sCanvas.getContext('2d');
  const eCtx = eCanvas.getContext('2d');
  if (!dCtx || !sCtx || !eCtx) return { displacement: '', scale: 0, specular: '', edge: '' };

  const hw = p.width / 2;
  const hh = p.height / 2;
  const r = Math.min(p.radius, hw, hh);
  const bezel = Math.max(1, Math.min(p.bezel, hw, hh));
  const { offsets, max } = refractionProfile(bezel, p.thickness, p.ior);
  const scale = Math.max(1, max * 2);
  const bleedBand = bezel * 1.6;
  const d = dCtx.createImageData(cw, ch);
  const s = sCtx.createImageData(cw, ch);
  const e = eCtx.createImageData(cw, ch);
  const g = 0.75;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const px = (x + 0.5) / k - hw;
      const py = (y + 0.5) / k - hh;
      const dist = -sdRoundRect(px, py, hw, hh, r);
      const i = (y * cw + x) * 4;
      let ox = 0;
      let oy = 0;
      let spec = 0;
      let edge = 0;
      if (dist > 0 && dist < bleedBand) {
        const gx = sdRoundRect(px + g, py, hw, hh, r) - sdRoundRect(px - g, py, hw, hh, r);
        const gy = sdRoundRect(px, py + g, hw, hh, r) - sdRoundRect(px, py - g, hw, hh, r);
        const len = Math.hypot(gx, gy) || 1;
        const nx = gx / len;
        const ny = gy / len;
        if (dist < bezel) {
          const t = dist / bezel;
          const offset = offsets[Math.min(PROFILE_SAMPLES - 1, Math.floor(t * PROFILE_SAMPLES))];
          ox = (-nx * offset) / scale;
          oy = (-ny * offset) / scale;
          const facing = nx * LIGHT.x + ny * LIGHT.y;
          const steep = 1 - squircleHeight(t);
          const key = Math.pow(Math.max(0, facing), 1.6);
          const bounce = Math.pow(Math.max(0, -facing), 2.2) * 0.55;
          const rim = Math.max(0, 1 - dist / 1.6);
          spec = Math.min(1, (key + bounce) * Math.pow(steep, 0.7) * 0.9 + rim * (0.35 + 0.45 * Math.max(key, bounce)));
        }
        const u = dist / bleedBand;
        edge = Math.pow(1 - u, 2.2);
      }
      d.data[i] = Math.round(128 + ox * 127);
      d.data[i + 1] = Math.round(128 + oy * 127);
      d.data[i + 2] = 128;
      d.data[i + 3] = 255;
      s.data[i] = 255;
      s.data[i + 1] = 255;
      s.data[i + 2] = 255;
      s.data[i + 3] = Math.round(spec * 255);
      e.data[i] = 255;
      e.data[i + 1] = 255;
      e.data[i + 2] = 255;
      e.data[i + 3] = Math.round(edge * 255);
    }
  }
  dCtx.putImageData(d, 0, 0);
  sCtx.putImageData(s, 0, 0);
  eCtx.putImageData(e, 0, 0);
  return { displacement: dCanvas.toDataURL('image/png'), scale, specular: sCanvas.toDataURL('image/png'), edge: eCanvas.toDataURL('image/png') };
}

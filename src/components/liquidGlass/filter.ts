/**
 * SVG filters that render Liquid Glass on the backdrop (used through `backdrop-filter: url(#…)`,
 * which only Chromium supports). One <filter> is shared by every surface with the same size,
 * corner radius and look.
 *
 * Pipeline: refract the backdrop through the lens map (optionally per colour channel for a faint
 * dispersion), frost it lightly, saturate and brighten it, let a blurred, saturated copy of the
 * backdrop bleed into the rim, then add the specular rim light.
 */
import { renderLensMaps } from './optics';

export type GlassLookName = 'regular' | 'clear' | 'thick' | 'menu' | 'control';

export interface GlassLook {
  /** Frost (Gaussian blur) of the refracted backdrop, in px. */
  blur: number;
  /** Saturation multiplier of the backdrop. */
  saturation: number;
  /** Brightness multiplier of the backdrop. */
  brightness: number;
  /** Strength (0–1) of the colour that bleeds from the backdrop into the rim. */
  bleed: number;
  /** Blur of the bled colour, in px. */
  bleedBlur: number;
  /** Opacity (0–1) of the specular rim light. */
  specular: number;
  /** Relative per-channel spread of the refraction (0 = none). */
  dispersion: number;
  /** Multiplier of the lens strength. */
  lens: number;
}

export const LOOKS: Record<GlassLookName, GlassLook> = {
  regular: { blur: 3, saturation: 1.7, brightness: 1.06, bleed: 0.55, bleedBlur: 10, specular: 0.85, dispersion: 0.05, lens: 1 },
  clear: { blur: 1, saturation: 1.5, brightness: 1.08, bleed: 0.45, bleedBlur: 8, specular: 0.9, dispersion: 0.06, lens: 1.1 },
  thick: { blur: 12, saturation: 1.8, brightness: 1.02, bleed: 0.4, bleedBlur: 14, specular: 0.7, dispersion: 0, lens: 0.9 },
  menu: { blur: 9, saturation: 1.9, brightness: 1.04, bleed: 0.45, bleedBlur: 12, specular: 0.75, dispersion: 0, lens: 0.9 },
  control: { blur: 2, saturation: 1.6, brightness: 1.06, bleed: 0.5, bleedBlur: 8, specular: 0.8, dispersion: 0.04, lens: 1 },
}; /** Filter settings for each glass look; thicker looks frost more and refract less. */

const SVG_NS = 'http://www.w3.org/2000/svg'; /** Namespace for created SVG elements. */
const RELEASE_DELAY_MS = 4000; /** How long an unused filter is kept for elements that come back at the same size. */

interface FilterEntry {
  id: string;
  el: SVGFilterElement;
  refs: number;
}

const filters = new Map<string, FilterEntry>(); /** Live filters keyed by size, radius and look. */
let defs: SVGDefsElement | null = null; /** Shared <defs> that holds every glass filter. */
let seq = 0; /** Counter for unique filter ids. */

/**
 * Returns the hidden <defs> element that stores the glass filters, creating it on first use.
 *
 * The <svg> host is zero-sized, absolutely positioned and appended to <body> once.
 *
 * @returns {SVGDefsElement} The shared definitions element.
 *
 * @example
 * filterDefs().appendChild(filter);
 */
function filterDefs(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

/**
 * Creates an SVG element with the given attributes.
 *
 * @param {string} tag - Element name in the SVG namespace.
 * @param {Record<string, string | number>} attrs - Attributes to set.
 * @param {Element[]} [children=[]] - Child elements to append.
 * @returns {SVGElement} The new element.
 *
 * @example
 * svgEl('feGaussianBlur', { stdDeviation: 4 });
 */
function svgEl(tag: string, attrs: Record<string, string | number>, children: Element[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(c);
  return el;
}

/**
 * Builds a feComponentTransfer that scales RGB linearly (slope/intercept) or alpha (alphaSlope).
 *
 * @param {string} input - Name of the input result.
 * @param {string} result - Name of the produced result.
 * @param {{ slope?: number, intercept?: number, alphaSlope?: number }} opts - Transfer settings.
 * @returns {SVGElement} The transfer primitive.
 *
 * @example
 * transfer('a', 'b', { alphaSlope: 0.5 });
 */
function transfer(input: string, result: string, opts: { slope?: number; intercept?: number; alphaSlope?: number }): SVGElement {
  const funcs: SVGElement[] = [];
  if (opts.slope !== undefined) {
    for (const ch of ['R', 'G', 'B']) funcs.push(svgEl(`feFunc${ch}`, { type: 'linear', slope: opts.slope, intercept: opts.intercept ?? 0 }));
  }
  if (opts.alphaSlope !== undefined) funcs.push(svgEl('feFuncA', { type: 'linear', slope: opts.alphaSlope }));
  return svgEl('feComponentTransfer', { in: input, result }, funcs);
}

/**
 * Assembles the full glass filter for one surface.
 *
 * Renders the lens maps for the size, then chains refraction (three channel-shifted passes when
 * the look has dispersion), frost, saturation/brightness, the edge light bleed and the specular
 * rim. The filter region matches the element box exactly (userSpaceOnUse, 0,0 → w,h). Returns
 * null when the maps cannot be rendered.
 *
 * @param {string} id - Id for the <filter> element.
 * @param {number} w - Width in px.
 * @param {number} h - Height in px.
 * @param {number} r - Corner radius in px.
 * @param {GlassLook} look - Visual settings.
 * @param {LensTuning} [tuning={}] - Optional cap on the bezel width and lens strength multiplier.
 * @returns {SVGFilterElement | null} The filter element, not yet attached.
 *
 * @example
 * const f = buildFilter('lg-1', 300, 60, 30, LOOKS.regular);
 */
function buildFilter(id: string, w: number, h: number, r: number, look: GlassLook, tuning: LensTuning = {}): SVGFilterElement | null {
  const shortest = Math.min(w, h);
  const bezel = Math.max(5, Math.min(tuning.bezel ?? 28, shortest * 0.24));
  const thickness = Math.min(1.1, 0.75 + shortest / 600);
  const maps = renderLensMaps({ width: w, height: h, radius: r, bezel, thickness, ior: 1.5 });
  if (!maps.displacement) return null;
  const scale = maps.scale * look.lens * (tuning.strength ?? 1);
  /**
   * Builds an feImage that stretches a map over the whole filter region.
   *
   * @param {string} href - Data URL of the map.
   * @param {string} result - Name of the produced result.
   * @returns {SVGElement} The feImage primitive.
   *
   * @example
   * image(maps.edge, 'edgeMask');
   */
  const image = (href: string, result: string) => svgEl('feImage', { href, x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result });
  /**
   * Builds an feDisplacementMap that bends the backdrop through the lens map.
   *
   * @param {number} s - Displacement scale in px.
   * @param {string} result - Name of the produced result.
   * @returns {SVGElement} The feDisplacementMap primitive.
   *
   * @example
   * displace(scale, 'refracted');
   */
  const displace = (s: number, result: string) => svgEl('feDisplacementMap', { in: 'SourceGraphic', in2: 'lensMap', scale: s, xChannelSelector: 'R', yChannelSelector: 'G', result });
  const prims: SVGElement[] = [image(maps.displacement, 'lensMap')];

  if (look.dispersion > 0) {
    prims.push(
      displace(scale * (1 + look.dispersion), 'dR'),
      displace(scale, 'dG'),
      displace(scale * (1 - look.dispersion), 'dB'),
      svgEl('feColorMatrix', { in: 'dR', type: 'matrix', values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'cR' }),
      svgEl('feColorMatrix', { in: 'dG', type: 'matrix', values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'cG' }),
      svgEl('feColorMatrix', { in: 'dB', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'cB' }),
      svgEl('feBlend', { in: 'cR', in2: 'cG', mode: 'screen', result: 'cRG' }),
      svgEl('feBlend', { in: 'cRG', in2: 'cB', mode: 'screen', result: 'refracted' }),
    );
  } else {
    prims.push(displace(scale, 'refracted'));
  }

  prims.push(
    svgEl('feGaussianBlur', { in: 'refracted', stdDeviation: look.blur, result: 'frostedRaw' }),
    svgEl('feComposite', { in: 'frostedRaw', in2: 'refracted', operator: 'over', result: 'frosted' }),
    svgEl('feColorMatrix', { in: 'frosted', type: 'saturate', values: look.saturation, result: 'saturated' }),
    transfer('saturated', 'base', { slope: look.brightness }),
    svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: look.bleedBlur, result: 'bleedBlur' }),
    svgEl('feColorMatrix', { in: 'bleedBlur', type: 'saturate', values: 2.6, result: 'bleedSat' }),
    transfer('bleedSat', 'bleedLit', { slope: 1.4, intercept: 0.05 }),
    image(maps.edge, 'edgeMask'),
    svgEl('feComposite', { in: 'bleedLit', in2: 'edgeMask', operator: 'in', result: 'bleedBand' }),
    transfer('bleedBand', 'bleed', { alphaSlope: look.bleed }),
    svgEl('feBlend', { in: 'bleed', in2: 'base', mode: 'screen', result: 'lit' }),
    image(maps.specular, 'specMap'),
    transfer('specMap', 'spec', { alphaSlope: look.specular }),
    svgEl('feBlend', { in: 'spec', in2: 'lit', mode: 'screen' }),
  );

  return svgEl(
    'filter',
    { id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' },
    prims,
  ) as SVGFilterElement;
}

export interface LensTuning {
  /** Upper bound for the bezel width in px (default 28). */
  bezel?: number;
  /** Multiplier of the lens strength (default 1). */
  strength?: number;
}

export interface FilterHandle {
  id: string;
  release: () => void;
}

/**
 * Gets (or creates) the shared glass filter for a size, radius and look.
 *
 * Filters are reference counted; releasing the last reference removes the filter after a short
 * delay so an element that returns at the same size reuses it instead of re-rendering the maps.
 *
 * @param {number} w - Width in px (callers round it so near-identical sizes share a filter).
 * @param {number} h - Height in px.
 * @param {number} r - Corner radius in px.
 * @param {GlassLookName} lookName - Which look to render.
 * @param {LensTuning} [tuning={}] - Optional bezel cap and lens strength.
 * @returns {FilterHandle | null} The filter id and a release function, or null when it cannot be built.
 *
 * @example
 * const handle = acquireGlassFilter(300, 60, 30, 'regular');
 * el.style.backdropFilter = `url(#${handle.id})`;
 * handle.release();
 */
export function acquireGlassFilter(w: number, h: number, r: number, lookName: GlassLookName, tuning: LensTuning = {}): FilterHandle | null {
  const key = `${w}x${h}r${r}:${lookName}:${tuning.bezel ?? ''}:${tuning.strength ?? ''}`;
  let entry = filters.get(key);
  if (!entry) {
    const id = `lg-glass-${++seq}`;
    const el = buildFilter(id, w, h, r, LOOKS[lookName], tuning);
    if (!el) return null;
    filterDefs().appendChild(el);
    entry = { id, el, refs: 0 };
    filters.set(key, entry);
  }
  entry.refs++;
  const held = entry;
  let released = false;
  return {
    id: held.id,
    /**
     * Drops this handle's reference to the filter (idempotent).
     *
     * When no references remain the filter is removed after RELEASE_DELAY_MS unless it was
     * acquired again in the meantime.
     *
     * @returns {void}
     *
     * @example
     * handle.release();
     */
    release: () => {
      if (released) return;
      released = true;
      held.refs--;
      if (held.refs > 0) return;
      setTimeout(() => {
        if (held.refs > 0) return;
        held.el.remove();
        if (filters.get(key) === held) filters.delete(key);
      }, RELEASE_DELAY_MS);
    },
  };
}

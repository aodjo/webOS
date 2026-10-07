/**
 * Building blocks shared by every icon: per-instance SVG ids, the squircle outline and the
 * Liquid Glass app-icon frame: floating shadow, upper-half sheen and inner glow, glass-thickness
 * bevel, specular rim and hairline edge.
 *
 * Every icon draws in a 100×100 viewBox and renders exactly `size`×`size` px.
 */
import { useId, type FC, type ReactNode } from 'react';

/** Component signature shared by every icon: renders a `size`×`size` px SVG. */
export type IconFC = FC<{ size: number }>;

export const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif"; /** System font stack for text drawn inside icons (labels, badges). */

/**
 * Unique, CSS-safe id generator for one icon instance, so gradients/filters of several icons on
 * the same page never clash. `ids('bg')` → an id, `ids.url('bg')` → `url(#…)`.
 */
export interface IconIds {
  (name: string): string;
  url(name: string): string;
}

/**
 * Creates the id generator for one icon instance.
 *
 * Derives a base id from React's `useId()`, stripping every character outside
 * `[a-zA-Z0-9_-]` (useId output may contain ":", "«" or "»", which are awkward inside
 * `url(#…)` references) and prefixing it with "i" so it never starts with a digit. The
 * returned function suffixes that base with a local name; its `url` method wraps the same id
 * in a `url(#…)` paint reference. Must be called during render like any other hook.
 *
 * @returns {IconIds} Id generator scoped to the calling component instance.
 *
 * @example
 * const ids = useIconIds();
 * <linearGradient id={ids('bg')} />
 * <path fill={ids.url('bg')} />
 */
export function useIconIds(): IconIds {
  const base = 'i' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  /**
   * Builds the instance-unique id for a local name.
   *
   * Joins the sanitized per-instance base and the name with a hyphen.
   *
   * @param {string} name - Local name of the gradient, filter or clip path.
   * @returns {string} The unique id.
   *
   * @example
   * ids('bg'); // 'ir1-bg'
   */
  const ids = ((name: string) => `${base}-${name}`) as IconIds;
  /**
   * Builds a paint reference to the instance-unique id for a local name.
   *
   * Wraps the same id that `ids(name)` returns in `url(#…)`.
   *
   * @param {string} name - Local name of the gradient, filter or clip path.
   * @returns {string} A `url(#…)` reference usable as fill, stroke, filter or clipPath.
   *
   * @example
   * ids.url('bg'); // 'url(#ir1-bg)'
   */
  ids.url = (name: string) => `url(#${base}-${name})`;
  return ids;
}

/**
 * Rounds a number to three decimal places.
 *
 * Keeps generated SVG path data and attribute values short without visible loss of precision.
 *
 * @param {number} n - Value to round.
 * @returns {number} `n` rounded to the nearest 0.001.
 *
 * @example
 * r3(1.23456); // 1.235
 */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Converts a screen-pixel stroke width into viewBox units for an icon of a given size.
 *
 * Every icon draws in a 100×100 viewBox, so one unit is `size / 100` px. The result is the
 * width that renders as `px` screen pixels at `size`, which keeps outlines visible at 16px
 * without getting heavy at 128px. It is clamped so it is never thinner than `min` units, and
 * sizes below 1 are treated as 1.
 *
 * @param {number} size - Rendered icon size in px.
 * @param {number} [px=0.75] - Desired on-screen stroke width in px.
 * @param {number} [min=0.6] - Minimum width in viewBox units.
 * @returns {number} Stroke width in viewBox units, rounded to three decimals.
 *
 * @example
 * hairline(16); // 4.688
 * hairline(128); // 0.6
 */
export function hairline(size: number, px = 0.75, min = 0.6): number {
  return r3(Math.max(min, (100 / Math.max(size, 1)) * px));
}

/**
 * Builds the SVG path of a rounded rectangle with continuous ("squircle") corners.
 *
 * Uses Figma's corner-smoothing construction: each corner is a cubic → circular arc → cubic
 * blend, so curvature ramps up gradually instead of jumping like a plain `rx` corner. The
 * radius is clamped to half the shorter side, and the smoothed corner length
 * `(1 + smoothing) × r` is clamped the same way. The seven control points of one corner
 * (cubic, arc end, cubic) are computed once in a local frame where u runs along the incoming
 * edge and v along the outgoing one; each corner (top-right, bottom-right, bottom-left,
 * top-left, clockwise) is then described by its vertex plus the unit vectors of those two
 * edges, and the local points are mapped onto it. Coordinates are rounded to three decimals.
 *
 * @param {number} x - Left edge of the box.
 * @param {number} y - Top edge of the box.
 * @param {number} w - Width of the box.
 * @param {number} h - Height of the box.
 * @param {number} r - Nominal corner radius.
 * @param {number} [smoothing=0.6] - Corner smoothing: 0 = plain rounded rect, 0.6 ≈ Apple's icon mask.
 * @returns {string} Closed SVG path data (`M … Z`).
 *
 * @example
 * const d = squirclePath(10, 20, 80, 60, 18);
 * <path d={d} />
 */
export function squirclePath(x: number, y: number, w: number, h: number, r: number, smoothing = 0.6): string {
  const budget = Math.min(w, h) / 2;
  r = Math.min(r, budget);
  const p = Math.min((1 + smoothing) * r, budget);
  const arcMeasure = 90 * (1 - smoothing);
  const rad = Math.PI / 180;
  const arcLen = Math.sin((arcMeasure / 2) * rad) * r * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3p4 = r * Math.tan((alpha / 2) * rad);
  const beta = 45 * smoothing;
  const c = p3p4 * Math.cos(beta * rad);
  const d = c * Math.tan(beta * rad);
  const b = (p - arcLen - c - d) / 3;
  const a = 2 * b;

  const local: Array<[number, number]> = [
    [a, 0], [a + b, 0], [a + b + c, d],
    [a + b + c + arcLen, d + arcLen],
    [p, d + arcLen + c], [p, d + arcLen + b + c], [p, p],
  ];
  const corners: Array<[number, number, number, number, number, number]> = [
    [x + w, y, 1, 0, 0, 1],
    [x + w, y + h, 0, 1, -1, 0],
    [x, y + h, -1, 0, 0, -1],
    [x, y, 0, -1, 1, 0],
  ];

  let path = '';
  corners.forEach(([vx, vy, e1x, e1y, e2x, e2y], i) => {
    /**
     * Maps a corner-local point to an absolute "x y" coordinate pair.
     *
     * The local origin lies `p` before the corner vertex on the incoming edge; u advances along
     * the incoming edge direction and v along the outgoing edge direction.
     *
     * @param {[number, number]} point - Local `[u, v]` coordinates.
     * @returns {string} Absolute coordinates formatted for SVG path data.
     *
     * @example
     * pt([0, 0]); // where this corner's curve leaves the incoming edge
     */
    const pt = ([u, v]: [number, number]) => `${r3(vx + (u - p) * e1x + v * e2x)} ${r3(vy + (u - p) * e1y + v * e2y)}`;
    path += `${i === 0 ? 'M' : 'L'}${pt([0, 0])}`;
    path += `C${pt(local[0])} ${pt(local[1])} ${pt(local[2])}`;
    path += `A${r3(r)} ${r3(r)} 0 0 1 ${pt(local[3])}`;
    path += `C${pt(local[4])} ${pt(local[5])} ${pt(local[6])}`;
  });
  return path + 'Z';
}

export const BODY = { x: 9.75, y: 9.75, size: 80.5 } as const; /** Squircle body box on the macOS icon grid: it covers ~80.5% of the canvas (824 of 1024). */
export const SQUIRCLE = squirclePath(BODY.x, BODY.y, BODY.size, BODY.size, 18.1); /** Path data of the app-icon squircle filling {@link BODY}. */

export const GLASS_MIN = 24; /** Smallest icon size (px) that gets fine Liquid Glass highlights (specular rims, glyph edges, glints); below it they would only blur the silhouette. */

/**
 * Renders the `<svg>` root shared by all icons.
 *
 * Sets a 100×100 viewBox, renders exactly `size`×`size` px, never shrinks inside flex
 * layouts, and is hidden from assistive technology because the surrounding UI provides the
 * label.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered width and height in px.
 * @param {ReactNode} props.children - SVG content drawn in viewBox units.
 * @returns {JSX.Element} The SVG element.
 *
 * @example
 * <IconSvg size={32}><circle cx="50" cy="50" r="40" /></IconSvg>
 */
export function IconSvg({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      {children}
    </svg>
  );
}

/** Props of {@link AppIconFrame}. */
interface AppIconFrameProps {
  /** Rendered width and height in px. */
  size: number;
  /** Paint for the squircle body: a color or `ids.url('…')` of a gradient declared in `defs`. */
  fill: string;
  /** Extra gradients/filters appended to the frame's `<defs>`. */
  defs?: ReactNode;
  /** Glyph, clipped to the squircle. */
  children?: ReactNode;
  /** Glyph drawn above the clip/sheen (may overhang the squircle). */
  overlay?: ReactNode;
  /** Glass light: upper-half sheen + inner glow pooled under the top edge. Defaults to true. */
  sheen?: boolean;
  /**
   * Opacity of the light inner bevel, the glass slab's thickness (strongest along the top edge,
   * faint down the sides). Dark icons raise it so their silhouette still reads on a dark Dock /
   * Launchpad.
   */
  rim?: number;
}

/**
 * Renders the Liquid Glass app-icon chrome around a glyph.
 *
 * Draws, bottom to top: a soft two-layer floating shadow under the squircle, the body painted
 * with `fill`, the glyph layer clipped to the squircle, the glass light (an upper-half sheen
 * with a soft glow pooled under the top edge and a faint darkening toward the base), a broad
 * light bevel whose strength follows `rim`, a thin specular rim and a dark hairline edge, then
 * the unclipped `overlay`. The specular rim uses a diagonal gradient across the body (offset 0
 * at the top-left corner, 0.5 at the other two corners, 1 at the bottom-right), so it is bright
 * along the top-left edge, fades out, and returns as a softer bounce at the bottom-right. Bevel
 * and rim are strokes centered on the outline and clipped to the squircle, so only their inner
 * half shows and the silhouette stays crisp. The specular rim is dropped below
 * {@link GLASS_MIN} px, and the bevel is drawn thinner there.
 *
 * @param {AppIconFrameProps} props - Component props.
 * @param {number} props.size - Rendered width and height in px.
 * @param {string} props.fill - Paint for the squircle body.
 * @param {ReactNode} [props.defs] - Extra gradients/filters appended to `<defs>`.
 * @param {ReactNode} [props.children] - Glyph clipped to the squircle.
 * @param {ReactNode} [props.overlay] - Glyph drawn above everything, unclipped.
 * @param {boolean} [props.sheen=true] - Whether to draw the sheen and inner glow.
 * @param {number} [props.rim=0.14] - Opacity of the inner bevel; 0 omits it.
 * @returns {JSX.Element} The complete app icon SVG.
 *
 * @example
 * const ids = useIconIds();
 * <AppIconFrame size={64} fill={ids.url('bg')} defs={<VGrad id={ids('bg')} from="#6cf" to="#06c" />} />
 */
export function AppIconFrame({ size, fill, defs, children, overlay, sheen = true, rim = 0.14 }: AppIconFrameProps) {
  const ids = useIconIds();
  const fine = size >= GLASS_MIN;
  const { x, y, size: s } = BODY;
  return (
    <IconSvg size={size}>
      <defs>
        <filter id={ids('shadow')} x="-20%" y="-20%" width="140%" height="145%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="0.4" stdDeviation="0.45" floodColor="#000" floodOpacity="0.2" />
          <feDropShadow dx="0" dy="1.8" stdDeviation="1.9" floodColor="#000" floodOpacity="0.18" />
        </filter>
        <clipPath id={ids('clip')}>
          <path d={SQUIRCLE} />
        </clipPath>
        <linearGradient id={ids('sheen')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="0.24" stopColor="#fff" stopOpacity="0.07" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.07" />
        </linearGradient>
        <radialGradient id={ids('glow')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids('rim')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={r3(Math.min(1, rim * 1.3))} />
          <stop offset="0.2" stopColor="#fff" stopOpacity={r3(rim * 0.7)} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={r3(rim * 0.3)} />
          <stop offset="1" stopColor="#fff" stopOpacity={r3(rim * 0.6)} />
        </linearGradient>
        {fine && (
          <linearGradient id={ids('spec')} x1={x} y1={y} x2={x + s} y2={y + s} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="0.16" stopColor="#fff" stopOpacity="0.8" />
            <stop offset="0.38" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="0.66" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="0.86" stopColor="#fff" stopOpacity="0.24" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
          </linearGradient>
        )}
        {defs}
      </defs>
      <path d={SQUIRCLE} fill={fill} filter={ids.url('shadow')} />
      {children && <g clipPath={ids.url('clip')}>{children}</g>}
      {sheen && (
        <g clipPath={ids.url('clip')} pointerEvents="none">
          <path d={SQUIRCLE} fill={ids.url('sheen')} />
          <ellipse cx="50" cy="13" rx="48" ry="32" fill={ids.url('glow')} />
        </g>
      )}
      {/* Strokes centered on the clipped outline show only their inner half: light inside the glass, not a border. */}
      <g clipPath={ids.url('clip')} fill="none" pointerEvents="none">
        {rim > 0 && <path d={SQUIRCLE} stroke={ids.url('rim')} strokeWidth={hairline(size, fine ? 2.6 : 1.6, 1.6)} />}
        {fine && <path d={SQUIRCLE} stroke={ids.url('spec')} strokeWidth={hairline(size, 1.5, 1.2)} />}
      </g>
      <path d={SQUIRCLE} fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="0.5" />
      {overlay}
    </IconSvg>
  );
}

/**
 * Renders a Liquid Glass specular edge for a glyph layer.
 *
 * Draws a thin specular line just inside each shape, bright along its top-left, fading out, with
 * a faint bounce at the bottom-right. The shapes are used twice: as a clip path and as stroked
 * outlines inside that clip, so only the inner half of each stroke shows. Pass bare shapes
 * (geometry only, no fill/stroke), placed exactly like the glyph they light (same transforms).
 * Renders nothing below `min` px, where the line would only muddy small artwork.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered icon size in px.
 * @param {ReactNode} props.children - Bare shapes matching the glyph's geometry.
 * @param {number} [props.opacity=0.85] - Peak opacity of the highlight.
 * @param {number} [props.min=GLASS_MIN] - Smallest icon size (px) that gets the edge.
 * @returns {JSX.Element | null} The edge group, or null when `size` is below `min`.
 *
 * @example
 * <GlassEdge size={size}><circle cx="50" cy="50" r="20" /></GlassEdge>
 */
export function GlassEdge({ size, children, opacity = 0.85, min = GLASS_MIN }: { size: number; children: ReactNode; opacity?: number; min?: number }) {
  const ids = useIconIds();
  if (size < min) return null;
  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={ids('clip')}>{children}</clipPath>
        <linearGradient id={ids('edge')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={r3(opacity)} />
          <stop offset="0.3" stopColor="#fff" stopOpacity={r3(opacity * 0.5)} />
          <stop offset="0.6" stopColor="#fff" stopOpacity={r3(opacity * 0.08)} />
          <stop offset="1" stopColor="#fff" stopOpacity={r3(opacity * 0.4)} />
        </linearGradient>
      </defs>
      <g clipPath={ids.url('clip')} fill="none" stroke={ids.url('edge')} strokeWidth={hairline(size, 1.4, 1)}>
        {children}
      </g>
    </g>
  );
}

/**
 * Renders a two-stop linear gradient definition.
 *
 * Runs top to bottom by default; the direction can be changed through the bounding-box
 * coordinates `x1`/`y1`/`x2`/`y2`. Place it inside `<defs>`.
 *
 * @param {Object} props - Component props.
 * @param {string} props.id - Gradient id, usually from {@link useIconIds}.
 * @param {string} props.from - Color at the start.
 * @param {string} props.to - Color at the end.
 * @param {number} [props.x1=0] - Start x in bounding-box units.
 * @param {number} [props.y1=0] - Start y in bounding-box units.
 * @param {number} [props.x2=0] - End x in bounding-box units.
 * @param {number} [props.y2=1] - End y in bounding-box units.
 * @returns {JSX.Element} The `<linearGradient>` element.
 *
 * @example
 * <VGrad id={ids('bg')} from="#a3dcff" to="#6abcf7" />
 */
export function VGrad({ id, from, to, x1 = 0, y1 = 0, x2 = 0, y2 = 1 }: { id: string; from: string; to: string; x1?: number; y1?: number; x2?: number; y2?: number }) {
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      <stop offset="0" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </linearGradient>
  );
}

/**
 * Computes a point on a circle.
 *
 * Angles are in degrees with 0° pointing along +x and increasing clockwise on screen (SVG's y
 * axis points down). Coordinates are rounded to three decimals.
 *
 * @param {number} cx - Center x.
 * @param {number} cy - Center y.
 * @param {number} r - Radius.
 * @param {number} deg - Angle in degrees.
 * @returns {[number, number]} The `[x, y]` point.
 *
 * @example
 * polar(50, 50, 10, 90); // [50, 60]
 */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r3(cx + r * Math.cos(a)), r3(cy + r * Math.sin(a))];
}

/**
 * Builds the SVG path of a gear outline.
 *
 * Places `teeth` trapezoid teeth evenly around (cx, cy), each rising from radius `rIn` to
 * `rOut`. `top` and `base` are the fractions of one tooth pitch covered by a tooth's tip and
 * root; tips and the gaps between teeth are circular arcs. `phase` rotates the first tooth.
 *
 * @param {number} cx - Center x.
 * @param {number} cy - Center y.
 * @param {number} rIn - Root radius.
 * @param {number} rOut - Tip radius.
 * @param {number} teeth - Number of teeth.
 * @param {number} [top=0.3] - Fraction of the pitch covered by a tooth's tip.
 * @param {number} [base=0.5] - Fraction of the pitch covered by a tooth's root.
 * @param {number} [phase=0] - Angle in degrees of the first tooth's center.
 * @returns {string} Closed SVG path data.
 *
 * @example
 * <path d={gearPath(12, 12, 6.3, 8.6, 8)} />
 */
export function gearPath(cx: number, cy: number, rIn: number, rOut: number, teeth: number, top = 0.3, base = 0.5, phase = 0): string {
  const pitch = 360 / teeth;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const mid = phase + i * pitch;
    const pts = [
      polar(cx, cy, rIn, mid - (pitch * base) / 2),
      polar(cx, cy, rOut, mid - (pitch * top) / 2),
      polar(cx, cy, rOut, mid + (pitch * top) / 2),
      polar(cx, cy, rIn, mid + (pitch * base) / 2),
    ];
    const next = polar(cx, cy, rIn, mid + pitch - (pitch * base) / 2);
    d += `${i === 0 ? 'M' : 'L'}${pts[0].join(' ')}`;
    d += `L${pts[1].join(' ')}A${rOut} ${rOut} 0 0 1 ${pts[2].join(' ')}L${pts[3].join(' ')}`;
    d += `A${rIn} ${rIn} 0 0 1 ${next.join(' ')}`;
  }
  return d + 'Z';
}

/**
 * Builds the SVG path of a four-point "sparkle" star.
 *
 * The points sit `r` above, right, below and left of (cx, cy) and are joined by quadratic
 * curves whose control points pull toward the center; a smaller `waist` gives a slimmer star.
 *
 * @param {number} cx - Center x.
 * @param {number} cy - Center y.
 * @param {number} r - Distance from the center to each point.
 * @param {number} [waist=0.28] - Thickness of the star relative to `r`.
 * @returns {string} Closed SVG path data.
 *
 * @example
 * <path d={sparklePath(19, 5.2, 3.3)} fill="currentColor" />
 */
export function sparklePath(cx: number, cy: number, r: number, waist = 0.28): string {
  const w = r * waist;
  return (
    `M${cx} ${cy - r}` +
    `Q${cx + w * 0.35} ${cy - w * 0.35} ${cx + r} ${cy}` +
    `Q${cx + w * 0.35} ${cy + w * 0.35} ${cx} ${cy + r}` +
    `Q${cx - w * 0.35} ${cy + w * 0.35} ${cx - r} ${cy}` +
    `Q${cx - w * 0.35} ${cy - w * 0.35} ${cx} ${cy - r}Z`
  );
}

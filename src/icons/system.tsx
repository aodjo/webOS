/**
 * System icons that are not squircle app icons: the wire-mesh glass Trash (empty / full), the
 * startup disk and the OS logo mark.
 */
import { GLASS_MIN, IconSvg, VGrad, hairline, useIconIds, type IconFC } from './shared';

/* ───────────────────────── Trash ───────────────────────── */

const TOP = { cy: 21, rx: 34, ry: 7.5 }; /** Elliptical rim of the bin (truncated cone seen slightly from above), in viewBox units. */
const BASE = { cy: 87, rx: 25.5, ry: 4.5 }; /** Smaller ellipse at the base of the bin, in viewBox units. */

/**
 * Linearly interpolates between two numbers.
 *
 * Returns `a` at `t = 0`, `b` at `t = 1` and values in between for fractional `t`; `t` is not
 * clamped, so values outside 0–1 extrapolate.
 *
 * @param {number} a - Value at `t = 0`.
 * @param {number} b - Value at `t = 1`.
 * @param {number} t - Interpolation factor.
 * @returns {number} The interpolated value.
 *
 * @example
 * lerp(TOP.rx, BASE.rx, 0.5); // 29.75
 */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Rounds a number to two decimal places.
 *
 * Keeps the generated SVG path strings short without visible precision loss.
 *
 * @param {number} n - Number to round.
 * @returns {number} `n` rounded to the nearest hundredth.
 *
 * @example
 * r2(12.3456); // 12.35
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

const BIN_BODY =
  `M${50 - TOP.rx} ${TOP.cy}L${50 - BASE.rx} ${BASE.cy}` +
  `A${BASE.rx} ${BASE.ry} 0 0 0 ${50 + BASE.rx} ${BASE.cy}` +
  `L${50 + TOP.rx} ${TOP.cy}A${TOP.rx} ${TOP.ry} 0 0 1 ${50 - TOP.rx} ${TOP.cy}Z`; /** Closed outline of the bin body. */
const RIM_BACK = `M${50 - TOP.rx} ${TOP.cy}A${TOP.rx} ${TOP.ry} 0 0 1 ${50 + TOP.rx} ${TOP.cy}`; /** Back half of the rim, drawn behind the papers and the body. */
const RIM_FRONT = `M${50 + TOP.rx} ${TOP.cy}A${TOP.rx} ${TOP.ry} 0 0 1 ${50 - TOP.rx} ${TOP.cy}`; /** Front half of the rim, drawn over the body. */
const BASE_FRONT = `M${50 - BASE.rx} ${BASE.cy}A${BASE.rx} ${BASE.ry} 0 0 0 ${50 + BASE.rx} ${BASE.cy}`; /** Front half of the base ring. */

/**
 * Returns a point on the front half of the bin's surface.
 *
 * The rim and base ellipses are interpolated at height `t`, and the point is placed on the front
 * half of the resulting ellipse at the horizontal position given by `c`.
 *
 * @param {number} t - Height on the bin: 0 = rim, 1 = base.
 * @param {number} c - Negated cosine of the angle around the bin: -1 = left edge, 1 = right edge.
 * @returns {string} The point as an `"x y"` SVG coordinate pair.
 *
 * @example
 * binPoint(0, -0.64); // "28.24 26.76"
 */
function binPoint(t: number, c: number): string {
  const rx = lerp(TOP.rx, BASE.rx, t);
  const ry = lerp(TOP.ry, BASE.ry, t);
  return `${r2(50 + rx * c)} ${r2(lerp(TOP.cy, BASE.cy, t) + ry * Math.sqrt(1 - c * c))}`;
}

/**
 * Builds the SVG path of the wire mesh covering the front of the bin.
 *
 * Vertical wires are spaced evenly in angle around the front half, so they bunch up towards the
 * sides as the cone turns away; each runs straight from the rim to the base. Horizontal wires are
 * the front halves of the ellipses interpolated between the rim and the base.
 *
 * @param {number} cols - Number of vertical wires.
 * @param {number} rows - Number of horizontal bands (`rows - 1` wires are drawn between rim and base).
 * @returns {string} SVG path data for all wires.
 *
 * @example
 * const d = binMesh(11, 8);
 * <path d={d} fill="none" stroke="#fff" />;
 */
function binMesh(cols: number, rows: number): string {
  let d = '';
  for (let i = 0; i < cols; i++) {
    const c = Math.cos((Math.PI * (i + 0.5)) / cols);
    const s = Math.sin((Math.PI * (i + 0.5)) / cols);
    d += `M${r2(50 - TOP.rx * c)} ${r2(TOP.cy + TOP.ry * s)}L${r2(50 - BASE.rx * c)} ${r2(BASE.cy + BASE.ry * s)}`;
  }
  for (let j = 1; j < rows; j++) {
    const t = j / rows;
    const cy = r2(lerp(TOP.cy, BASE.cy, t));
    const rx = r2(lerp(TOP.rx, BASE.rx, t));
    const ry = r2(lerp(TOP.ry, BASE.ry, t));
    d += `M${r2(50 - rx)} ${cy}A${rx} ${ry} 0 0 0 ${r2(50 + rx)} ${cy}`;
  }
  return d;
}

const BIN_MESH = { large: binMesh(17, 13), medium: binMesh(11, 8), small: binMesh(7, 5) }; /** Wire mesh per size class: smaller sizes get fewer, thicker wires so it doesn't blur. */

/**
 * Builds a vertical glass reflection band running down the front of the bin.
 *
 * The band is a quadrilateral between two horizontal positions on the rim and the same two
 * positions on the base, so it follows the taper of the cone.
 *
 * @param {number} c0 - Start position (negated cosine, -1 left … 1 right).
 * @param {number} c1 - End position (negated cosine, -1 left … 1 right).
 * @returns {string} Closed SVG path data for the band.
 *
 * @example
 * const d = streak(-0.64, -0.46);
 */
const streak = (c0: number, c1: number) => `M${binPoint(0, c0)}L${binPoint(0, c1)}L${binPoint(1, c1)}L${binPoint(1, c0)}Z`;
const BIN_STREAK = streak(-0.64, -0.46); /** Bright glass reflection left of center. */
const BIN_BOUNCE = streak(0.56, 0.68); /** Faint bounced reflection on the right. */

/**
 * Builds an arc segment along the front of the rim.
 *
 * Draws part of the rim ellipse between two horizontal positions; used for the specular glints
 * on the rim tube.
 *
 * @param {number} c0 - Start position (negated cosine, -1 left … 1 right).
 * @param {number} c1 - End position (negated cosine, -1 left … 1 right).
 * @returns {string} SVG path data for the arc.
 *
 * @example
 * const d = rimArc(-0.97, -0.58);
 */
const rimArc = (c0: number, c1: number) => `M${binPoint(0, c0)}A${TOP.rx} ${TOP.ry} 0 0 0 ${binPoint(0, c1)}`;
const RIM_GLINT = rimArc(-0.97, -0.58); /** Specular glint on the top of the front rim (top-left). */
const RIM_BOUNCE = rimArc(0.6, 0.94); /** Specular glint on the underside of the front rim (bottom-right). */

const PAPERS = [
  {
    outline: 'M25.5 21L27 13.5L32 9L38.5 8L44.5 11.5L47 17.5L45 24L38 27L30 26Z',
    creases: 'M32 9L35 16L30 26M35 16L44.5 11.5M35 16L41 21L47 17.5',
  },
  {
    outline: 'M63 22L64.5 15L70 11.5L76 13L79.5 18.5L77.5 24.5L70.5 27L65 26Z',
    creases: 'M70 11.5L70.5 19L65 26M70.5 19L79.5 18.5',
  },
  {
    outline: 'M44 18L46.5 10L52.5 5.5L60 5L66.5 8.5L69 15L67 21.5L60 25L51 23.5Z',
    creases: 'M52.5 5.5L56.5 13.5L51 23.5M56.5 13.5L66.5 8.5M56.5 13.5L62 18.5L69 15',
  },
]; /** Crumpled paper balls poking out of a full bin: outline and crease lines of each. */

/**
 * Renders the glass wire-mesh Trash bin, empty or full.
 *
 * Layers, back to front: floor shadow, dark inside, back rim, paper balls (when full), tinted
 * glass body, wire mesh (a dark and a light stroke), shading, reflections, side edges, base ring
 * and front rim. The mesh density follows the rendered size (see `BIN_MESH`); wire widths are
 * fixed at 48 px and up, and about one screen pixel (via `hairline`) below that. Rim glints are
 * only drawn at `GLASS_MIN` px and larger.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered size in px.
 * @param {boolean} props.full - Whether to draw paper balls in the bin.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <TrashBin size={64} full={fs.trashCount() > 0} />
 */
function TrashBin({ size, full }: { size: number; full: boolean }) {
  const ids = useIconIds();
  const fine = size >= GLASS_MIN;
  const mesh = size >= 48 ? BIN_MESH.large : fine ? BIN_MESH.medium : BIN_MESH.small;
  const wire = size >= 48 ? { dark: 1.7, light: 0.95 } : { dark: hairline(size, 0.95, 1.7), light: hairline(size, 0.55, 0.95) };
  return (
    <IconSvg size={size}>
      <defs>
        <radialGradient id={ids('floor')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.3" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <VGrad id={ids('inside')} from="rgba(52,56,62,0.62)" to="rgba(120,126,134,0.42)" />
        <linearGradient id={ids('body')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5b6068" stopOpacity="0.5" />
          <stop offset="0.4" stopColor="#9aa0a8" stopOpacity="0.3" />
          <stop offset="1" stopColor="#50555d" stopOpacity="0.52" />
        </linearGradient>
        <linearGradient id={ids('shade')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.16" />
          <stop offset="0.38" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id={ids('rim')} x1="16" y1="0" x2="84" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c4c8ce" />
          <stop offset="0.4" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b9bec5" />
        </linearGradient>
        <VGrad id={ids('paper')} from="#ffffff" to="#dfe1e6" x1={0} y1={0} x2={1} y2={1} />
        <linearGradient id={ids('streak')} x1="0" y1={TOP.cy} x2="0" y2={BASE.cy} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.26" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.06" />
        </linearGradient>
      </defs>

      <ellipse cx="50" cy="89.5" rx="31" ry="5" fill={ids.url('floor')} />
      <ellipse cx="50" cy={TOP.cy} rx={TOP.rx - 1.4} ry={TOP.ry - 1} fill={ids.url('inside')} />
      <path d={RIM_BACK} fill="none" stroke="#000" strokeOpacity="0.28" strokeWidth="4.2" />
      <path d={RIM_BACK} fill="none" stroke={ids.url('rim')} strokeWidth="3" />

      {full &&
        PAPERS.map((p) => (
          <g key={p.outline}>
            <path d={p.outline} fill={ids.url('paper')} stroke="#9ea3aa" strokeWidth="0.6" strokeLinejoin="round" />
            <path d={p.creases} fill="none" stroke="#bfc3c9" strokeWidth="0.6" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}

      <path d={BIN_BODY} fill={ids.url('body')} />
      <path d={mesh} fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth={wire.dark} />
      <path d={mesh} fill="none" stroke="#f3f5f7" strokeOpacity="0.92" strokeWidth={wire.light} />
      <path d={BIN_BODY} fill={ids.url('shade')} />
      <path d={BIN_STREAK} fill={ids.url('streak')} />
      <path d={BIN_BOUNCE} fill={ids.url('streak')} fillOpacity="0.4" />
      <path
        d={`M${50 - TOP.rx} ${TOP.cy}L${50 - BASE.rx} ${BASE.cy}M${50 + TOP.rx} ${TOP.cy}L${50 + BASE.rx} ${BASE.cy}`}
        stroke="#000"
        strokeOpacity="0.25"
        strokeWidth="0.8"
      />
      <path d={BASE_FRONT} fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="3.6" />
      <path d={BASE_FRONT} fill="none" stroke="#d5d8dd" strokeWidth="2.5" />
      <path d={RIM_FRONT} fill="none" stroke="#000" strokeOpacity="0.3" strokeWidth="4.2" />
      <path d={RIM_FRONT} fill="none" stroke={ids.url('rim')} strokeWidth="3" />
      {fine && (
        <g fill="none" stroke="#fff" strokeLinecap="round">
          <path d={`M${50 - TOP.rx + 4} ${TOP.cy + 3.6}A${TOP.rx} ${TOP.ry} 0 0 0 ${50 + 6} ${TOP.cy + TOP.ry}`} strokeOpacity="0.8" strokeWidth="0.7" />
          {/* Offset onto the upper / lower half of the 3-unit rim tube. */}
          <path d={RIM_GLINT} strokeOpacity="0.95" strokeWidth="1.1" transform="translate(0 -0.75)" />
          <path d={RIM_BOUNCE} strokeOpacity="0.5" strokeWidth="1.1" transform="translate(0 0.75)" />
        </g>
      )}
    </IconSvg>
  );
}

/**
 * Renders the empty Trash icon.
 *
 * Thin wrapper around `TrashBin` with no paper balls.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered size in px.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <TrashIcon size={48} />
 */
export const TrashIcon: IconFC = ({ size }) => <TrashBin size={size} full={false} />;

/**
 * Renders the full Trash icon.
 *
 * Thin wrapper around `TrashBin` with crumpled paper balls poking out of the top.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered size in px.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <TrashFullIcon size={48} />
 */
export const TrashFullIcon: IconFC = ({ size }) => <TrashBin size={size} full />;

/* ───────────────────────── Startup disk ───────────────────────── */

const DRIVE = 'M14 30H86Q93 30 93 37V71Q93 78 86 78H14Q7 78 7 71V37Q7 30 14 30Z'; /** Rounded-rectangle outline of the drive case. */

/**
 * Renders the startup disk (internal hard drive) icon.
 *
 * A light aluminium case with a lighter top face, a dotted vent line and a green activity LED,
 * over a soft floor shadow. The outline stroke is stronger below 32 px and uses `hairline` so the
 * light case keeps a visible edge on light backgrounds at sidebar and list sizes.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered size in px.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <HardDriveIcon size={16} />
 */
export const HardDriveIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <IconSvg size={size}>
      <defs>
        <VGrad id={ids('top')} from="#fbfbfc" to="#d9dbdf" />
        <VGrad id={ids('front')} from="#c9ccd1" to="#9da1a8" />
      </defs>
      <ellipse cx="50" cy="79" rx="42" ry="4" fill="#000" fillOpacity="0.14" />
      <path d={DRIVE} fill="#000" fillOpacity="0.22" transform="translate(0 0.8)" />
      <path d={DRIVE} fill={ids.url('front')} />
      <path d="M14 30H86Q93 30 93 37V58H7V37Q7 30 14 30Z" fill={ids.url('top')} />
      <path d="M7.5 58H92.5" stroke="#7d8189" strokeOpacity="0.55" strokeWidth="0.8" />
      <path d="M14 30.6H86" stroke="#fff" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M16 68H52" stroke="#7d8189" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.1 3" />
      <circle cx="82" cy="68" r="2.3" fill="#34d058" />
      <circle cx="82" cy="68" r="2.3" fill="none" stroke="#1d7a33" strokeOpacity="0.5" strokeWidth="0.5" />
      {/* Light case on a light window: keep a visible edge at sidebar / list sizes. */}
      <path d={DRIVE} fill="none" stroke="#000" strokeOpacity={size < 32 ? 0.3 : 0.16} strokeWidth={hairline(size, 0.75, 0.5)} />
    </IconSvg>
  );
};

/* ───────────────────────── OS logo ───────────────────────── */

/**
 * Renders the webOS logo mark.
 *
 * "Hallasan": a shield volcano with a shallow summit crater, rising inside a round frame. It is
 * monochrome (painted with `color`) and built from one stroke and one solid shape on a 24-unit
 * grid, so it stays crisp from the 14 px menu bar up to the 80 px boot screen.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered size in px.
 * @param {string} [props.color='currentColor'] - Fill and stroke color.
 * @returns {JSX.Element} The logo SVG.
 *
 * @example
 * <OSLogo size={14} />
 * <OSLogo size={80} color="#fff" />
 */
export function OSLogo({ size, color = 'currentColor' }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10.1" fill="none" stroke={color} strokeWidth="1.9" />
      <path
        d="M2.14 14.2C6 13.6 8.7 10.4 10.2 7.3C11 7.75 13 7.75 13.8 7.3C15.3 10.4 18 13.6 21.86 14.2A10.1 10.1 0 0 1 2.14 14.2Z"
        fill={color}
      />
    </svg>
  );
}

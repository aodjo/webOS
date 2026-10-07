/**
 * App icons — original artwork in the macOS 26 "Tahoe" Liquid Glass finish (squircle, luminous
 * gradients, specular rim from AppIconFrame, glass edges on the main glyph layers).
 * Every component renders a `size`×`size` px SVG drawn in a 100×100 viewBox.
 */
import { AppIconFrame, GlassEdge, VGrad, gearPath, polar, sparklePath, squirclePath, useIconIds, type IconFC } from './shared';

const FINDER_PROFILE =
  'M56.5 0C55.2 13 54.6 24 53.4 32.5C52.6 38.6 48.4 45.2 45.3 49.6C44.4 50.9 45 52.2 46.6 52.4L51.6 53.1' +
  'C51.1 64 51.6 78 54 100H100V0Z'; /** Right (darker) half of the Finder face; its left edge traces a forehead → nose → chin profile. */

/**
 * Finder app icon.
 *
 * A two-tone face on the squircle: a light-blue left half and a darker right half whose edge
 * forms the profile, with two eyes and a smile drawn across both halves.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <FinderIcon size={64} />
 */
export const FinderIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('l')}
      defs={
        <>
          <VGrad id={ids('l')} from="#a6e6ff" to="#3eaaf5" />
          <VGrad id={ids('r')} from="#3d8ff7" to="#1452dc" />
        </>
      }
    >
      <path d={FINDER_PROFILE} fill={ids.url('r')} />
      <path d={FINDER_PROFILE} fill="none" stroke="#0b3fa8" strokeOpacity="0.25" strokeWidth="0.8" transform="translate(-0.4 0)" />
      <rect x="31" y="30" width="5.4" height="13.5" rx="2.7" fill="#14264a" />
      <rect x="63.6" y="30" width="5.4" height="13.5" rx="2.7" fill="#0d1d3d" />
      <path d="M26.5 64.5C36 73.8 64 73.8 73.5 64.5" fill="none" stroke="#14264a" strokeWidth="3.6" strokeLinecap="round" />
    </AppIconFrame>
  );
};

const LAUNCHPAD_COLORS = ['#ff5a52', '#ff9f0a', '#ffd60a', '#34c759', '#2ac9c9', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f']; /** Launchpad tile colors in row-major order (also used as the tiles' React keys). */
const LAUNCHPAD_TILES = LAUNCHPAD_COLORS.map((color, i) => ({
  color,
  d: squirclePath(24 + (i % 3) * 19, 24 + Math.floor(i / 3) * 19, 14, 14, 3.8),
})); /** Launchpad's 3×3 tile grid: a 14-unit squircle path and color per tile, on a 19-unit pitch starting at (24, 24). */

/**
 * Launchpad app icon.
 *
 * A 3×3 grid of colored squircle tiles on a silver background, each with a drop shadow and a
 * gloss gradient. The tiles get a glass edge only when rendered at 40px or larger.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <LaunchpadIcon size={64} />
 */
export const LaunchpadIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#e4e6ea" to="#9a9ea7" />
          <VGrad id={ids('gloss')} from="rgba(255,255,255,0.3)" to="rgba(255,255,255,0)" />
        </>
      }
    >
      {LAUNCHPAD_TILES.map((t) => (
        <g key={t.color}>
          <path d={t.d} fill="#000" fillOpacity="0.16" transform="translate(0 0.9)" />
          <path d={t.d} fill={t.color} />
          <path d={t.d} fill={ids.url('gloss')} />
        </g>
      ))}
      <GlassEdge size={size} min={40}>
        {LAUNCHPAD_TILES.map((t) => (
          <path key={t.color} d={t.d} />
        ))}
      </GlassEdge>
    </AppIconFrame>
  );
};

const SAFARI_TICKS = (() => {
  let minor = '';
  let major = '';
  for (let i = 0; i < 72; i++) {
    const deg = i * 5;
    const isMajor = i % 6 === 0;
    const [x1, y1] = polar(50, 50, isMajor ? 25 : 27.4, deg);
    const [x2, y2] = polar(50, 50, 30, deg);
    const seg = `M${x1} ${y1}L${x2} ${y2}`;
    if (isMajor) major += seg;
    else minor += seg;
  }
  return { minor, major };
})(); /** Safari compass ticks as two path strings: 72 ticks every 5°, every sixth (each 30°) a longer major tick. */

/**
 * Safari app icon.
 *
 * A blue compass dial with white tick marks and a red/white needle pointing to the upper right,
 * on a white squircle. The dial's rim gets a glass edge from 24px up.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <SafariIcon size={64} />
 */
export const SafariIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#ffffff" to="#d9dbe1" />
          <VGrad id={ids('dial')} from="#2fd0ff" to="#1058e6" />
          <VGrad id={ids('red')} from="#ff6a5f" to="#d61f14" x1={1} y1={0} x2={0} y2={1} />
          <VGrad id={ids('white')} from="#ffffff" to="#cfd3da" x1={1} y1={0} x2={0} y2={1} />
        </>
      }
    >
      <circle cx="50" cy="50.6" r="33" fill="#000" fillOpacity="0.12" />
      <circle cx="50" cy="50" r="33" fill="#c8ccd3" />
      <circle cx="50" cy="50" r="31.6" fill={ids.url('dial')} />
      <GlassEdge size={size}>
        <circle cx="50" cy="50" r="33" />
      </GlassEdge>
      <path d={SAFARI_TICKS.minor} stroke="#fff" strokeOpacity="0.75" strokeWidth="0.7" />
      <path d={SAFARI_TICKS.major} stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      <g transform="translate(0.8 1.2)" fill="#000" fillOpacity="0.22">
        <path d="M68.4 31.6L53.2 53.2L46.8 46.8Z" />
        <path d="M31.6 68.4L53.2 53.2L46.8 46.8Z" />
      </g>
      <path d="M68.4 31.6L53.2 53.2L46.8 46.8Z" fill={ids.url('red')} />
      <path d="M31.6 68.4L53.2 53.2L46.8 46.8Z" fill={ids.url('white')} />
      <circle cx="50" cy="50" r="1.7" fill="#e9ebef" stroke="#8d939c" strokeWidth="0.4" />
    </AppIconFrame>
  );
};

/**
 * Mail app icon.
 *
 * A white envelope with its flap and side folds on a blue gradient, lifted by a soft shadow.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <MailIcon size={64} />
 */
export const MailIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#5fd0ff" to="#1368ee" />
          <VGrad id={ids('env')} from="#ffffff" to="#e2ebf8" />
        </>
      }
    >
      <rect x="20" y="31.5" width="60" height="41" rx="5" fill="#062c7a" fillOpacity="0.25" transform="translate(0 1.6)" />
      <rect x="20" y="31.5" width="60" height="41" rx="5" fill={ids.url('env')} />
      <path d="M23 69.5L42.5 52.5M77 69.5L57.5 52.5" stroke="#c9d7ec" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M22.5 34L50 55.5L77.5 34" fill="none" stroke="#a9bfdf" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </AppIconFrame>
  );
};

/**
 * Notes app icon.
 *
 * A notepad page: a yellow band across the top, a dotted perforation line and ruled lines below.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <NotesIcon size={64} />
 */
export const NotesIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('paper')}
      defs={
        <>
          <VGrad id={ids('paper')} from="#ffffff" to="#efeff1" />
          <VGrad id={ids('band')} from="#ffe375" to="#f7c21b" />
        </>
      }
    >
      <rect x="0" y="0" width="100" height="31" fill={ids.url('band')} />
      <rect x="0" y="31" width="100" height="1.2" fill="#000" fillOpacity="0.08" />
      <path d="M14 36.5H86" stroke="#bdbdc2" strokeWidth="1.3" strokeDasharray="0.1 3.2" strokeLinecap="round" />
      <path d="M0 47.5H100M0 58.5H100M0 69.5H100M0 80.5H100" stroke="#d6d6da" strokeWidth="1" />
    </AppIconFrame>
  );
};

/**
 * About Me app icon.
 *
 * A profile card with a round avatar and text lines on a warm orange-to-pink gradient.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <AboutMeIcon size={64} />
 */
export const AboutMeIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#ffbb4d" to="#ff4f86" x1={0.2} y1={0} x2={0.8} y2={1} />
          <VGrad id={ids('avatar')} from="#ffc48a" to="#ff6f8e" />
          {/* Frosted card: white fading to a faint warm tint toward the bottom. */}
          <VGrad id={ids('card')} from="#ffffff" to="#fff0f3" />
        </>
      }
    >
      <rect x="18" y="28" width="64" height="45" rx="6.5" fill="#7a1230" fillOpacity="0.22" transform="translate(0 1.8)" />
      <rect x="18" y="28" width="64" height="45" rx="6.5" fill={ids.url('card')} />
      <circle cx="36" cy="50.5" r="11.5" fill={ids.url('avatar')} />
      <circle cx="36" cy="46.6" r="4.6" fill="#fff" />
      <path d="M28 58.3C29.6 53.6 32.6 52.6 36 52.6C39.4 52.6 42.4 53.6 44 58.3C42 60.6 39.2 62 36 62C32.8 62 30 60.6 28 58.3Z" fill="#fff" />
      <rect x="52" y="42.2" width="21" height="4.6" rx="2.3" fill="#ff8a6e" />
      <rect x="52" y="50.4" width="17" height="3.6" rx="1.8" fill="#e3e3e8" />
      <rect x="52" y="57.2" width="19.5" height="3.6" rx="1.8" fill="#e3e3e8" />
    </AppIconFrame>
  );
};

/**
 * Projects app icon.
 *
 * A stack of three cards with purple sparkles on a purple gradient. One extra white sparkle is
 * drawn in the frame's overlay so it can overhang the top-right corner of the squircle; the
 * large sparkle gets a glass edge from 40px up.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <ProjectsIcon size={64} />
 */
export const ProjectsIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#c06cff" to="#4b3cf0" x1={0.15} y1={0} x2={0.85} y2={1} />
          <VGrad id={ids('card')} from="#ffffff" to="#ebe7ff" />
          <VGrad id={ids('star')} from="#b46bff" to="#5b3df5" />
        </>
      }
      overlay={<path d={sparklePath(74.5, 24.5, 6.2)} fill="#fff" fillOpacity="0.95" />}
    >
      <rect x="27" y="22" width="46" height="38" rx="6" fill="#fff" fillOpacity="0.3" transform="rotate(-11 50 41)" />
      <rect x="25.5" y="26" width="49" height="40" rx="6.5" fill="#fff" fillOpacity="0.55" transform="rotate(-4.5 50 46)" />
      <rect x="23" y="32" width="54" height="44" rx="7" fill="#2a0f8f" fillOpacity="0.25" transform="translate(0 1.8)" />
      <rect x="23" y="32" width="54" height="44" rx="7" fill={ids.url('card')} />
      <path d={sparklePath(47, 55, 12.5)} fill={ids.url('star')} />
      <GlassEdge size={size} min={40} opacity={0.7}>
        <path d={sparklePath(47, 55, 12.5)} />
      </GlassEdge>
      <path d={sparklePath(62.5, 44.5, 4.6)} fill={ids.url('star')} />
      <path d={sparklePath(61, 66, 3.2)} fill={ids.url('star')} fillOpacity="0.7" />
    </AppIconFrame>
  );
};

/**
 * Terminal app icon.
 *
 * A dark terminal window with a gray title bar, a `>` prompt and a green cursor. Uses a stronger
 * rim (0.3) so the dark silhouette still reads against a dark Dock or Launchpad.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <TerminalIcon size={64} />
 */
export const TerminalIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      rim={0.3}
      defs={
        <>
          <VGrad id={ids('bg')} from="#36363a" to="#141416" />
          <VGrad id={ids('bar')} from="#5c5c61" to="#45454a" />
        </>
      }
    >
      <rect x="0" y="0" width="100" height="23.5" fill={ids.url('bar')} />
      <rect x="0" y="23.5" width="100" height="0.8" fill="#000" fillOpacity="0.55" />
      <path d="M25.5 39.5L37 48.5L25.5 57.5" fill="none" stroke="#ececee" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="41.5" y="54" width="15.5" height="4.6" rx="1.2" fill="#3ce06a" />
    </AppIconFrame>
  );
};

const TEXT_LINES = [27, 33.5, 40, 46.5, 53, 59.5, 66].map((y, i) => ({ y, w: [20, 34, 31, 34, 26, 33, 18][i] })); /** Y position and length of each text line on the TextEdit page, top to bottom. */

/**
 * TextEdit app icon.
 *
 * A tilted sheet of paper with text lines (the first one heavier, like a heading) and a fountain
 * pen laid across it. The pen is drawn in the frame's overlay so it can extend past the squircle.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <TextEditIcon size={64} />
 */
export const TextEditIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#eaf0f7" to="#bcc6d4" />
          <VGrad id={ids('barrel')} from="#4a4a4f" to="#141416" x1={0} y1={0} x2={1} y2={0} />
          <VGrad id={ids('nib')} from="#f8de86" to="#c08f24" x1={0} y1={0} x2={1} y2={0} />
        </>
      }
      overlay={
        <g transform="translate(55 57) rotate(38)">
          <rect x="-6.5" y="-44" width="13" height="30" rx="4" fill="#000" fillOpacity="0.2" transform="translate(1.6 0.6)" />
          <path d="M-5.8 -13L5.8 -13L6.4 -4C6.4 2 2.7 7 0 12.5C-2.7 7 -6.4 2 -6.4 -4Z" fill={ids.url('nib')} stroke="#8a6414" strokeWidth="0.5" />
          <path d="M0 12.2V-2.4" stroke="#6b4b0c" strokeWidth="0.9" strokeLinecap="round" />
          <circle cx="0" cy="-4" r="1.6" fill="#6b4b0c" />
          <rect x="-6.6" y="-17" width="13.2" height="4.6" rx="1" fill={ids.url('nib')} />
          <rect x="-6.5" y="-44" width="13" height="27.5" rx="4" fill={ids.url('barrel')} />
          <rect x="-3.6" y="-41.5" width="2" height="22" rx="1" fill="#fff" fillOpacity="0.25" />
        </g>
      }
    >
      <g transform="rotate(-7 47 48)">
        <rect x="23" y="17" width="48" height="63" rx="2.5" fill="#1b2a40" fillOpacity="0.18" transform="translate(0.6 1.6)" />
        <rect x="23" y="17" width="48" height="63" rx="2.5" fill="#fff" />
        {TEXT_LINES.map((l, i) => (
          <path key={l.y} d={`M29.5 ${l.y}H${29.5 + l.w}`} stroke={i === 0 ? '#8c96a6' : '#c3c9d3'} strokeWidth={i === 0 ? 2.6 : 1.8} strokeLinecap="round" />
        ))}
      </g>
    </AppIconFrame>
  );
};

/**
 * Preview app icon.
 *
 * Two overlapping, tilted photos (a sunset and a green landscape) on a blue gradient, with a
 * magnifying glass drawn in the frame's overlay so it can overhang the squircle.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <PreviewIcon size={64} />
 */
export const PreviewIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#8fd8ff" to="#2b7fe0" />
          <VGrad id={ids('sunset')} from="#ffd36e" to="#ff6f61" />
          <VGrad id={ids('sky')} from="#5dbcff" to="#d3eeff" />
          <VGrad id={ids('rim')} from="#4a4a4f" to="#18181a" />
        </>
      }
      overlay={
        <g>
          <circle cx="58.5" cy="60.5" r="12.5" fill="#e8f6ff" fillOpacity="0.35" />
          <path d="M67.8 69.8L76.5 78.5" stroke="#000" strokeOpacity="0.2" strokeWidth="7" strokeLinecap="round" transform="translate(0.6 1)" />
          <path d="M67.8 69.8L76.5 78.5" stroke={ids.url('rim')} strokeWidth="6.4" strokeLinecap="round" />
          <circle cx="58.5" cy="60.5" r="12.5" fill="none" stroke={ids.url('rim')} strokeWidth="4" />
          <path d="M51 56A8.6 8.6 0 0 1 58.5 51.4" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      }
    >
      <g transform="rotate(-12 43 40)">
        <rect x="20" y="22" width="46" height="36" rx="2" fill="#0a3d7a" fillOpacity="0.2" transform="translate(0.5 1.4)" />
        <rect x="20" y="22" width="46" height="36" rx="2" fill="#fff" />
        <rect x="23" y="25" width="40" height="30" rx="0.8" fill={ids.url('sunset')} />
        <path d="M23 55L35 41L44 50L51 44L63 55Z" fill="#7a3d6b" fillOpacity="0.7" />
      </g>
      <g transform="rotate(6 53 51)">
        <rect x="27" y="32" width="52" height="40" rx="2" fill="#0a3d7a" fillOpacity="0.22" transform="translate(0.5 1.6)" />
        <rect x="27" y="32" width="52" height="40" rx="2" fill="#fff" />
        <rect x="30" y="35" width="46" height="34" rx="0.8" fill={ids.url('sky')} />
        <circle cx="66" cy="43" r="3.6" fill="#ffd54a" />
        <path d="M30 69L42 52L49 60L58 48L76 69Z" fill="#34a866" />
        <path d="M58 48L63.5 55.5L60 54.2L57 57L54.4 53.4Z" fill="#fff" fillOpacity="0.85" />
      </g>
    </AppIconFrame>
  );
};

const CALC_GRID = [28.6, 42.87, 57.13, 71.4]; /** Key centers of the 4×4 Calculator grid, used for both rows and columns. */
const CALC_OPS = [
  <g key="div">
    <path d="M-3.2 0H3.2" />
    <circle cx="0" cy="-2.6" r="0.9" fill="#fff" stroke="none" />
    <circle cx="0" cy="2.6" r="0.9" fill="#fff" stroke="none" />
  </g>,
  <path key="mul" d="M-2.4 -2.4L2.4 2.4M2.4 -2.4L-2.4 2.4" />,
  <path key="sub" d="M-3.2 0H3.2" />,
  <path key="add" d="M-3.2 0H3.2M0 -3.2V3.2" />,
]; /** Operator glyphs for the orange column (÷ × − +, top to bottom), each centered at (0, 0) and stroked by the parent group. */

/**
 * Calculator app icon.
 *
 * A 4×4 grid of round keys on a dark background: a light top row, dark digit keys and an orange
 * operator column showing ÷ × − +. The keys get a glass edge from 48px up, and the stronger rim
 * (0.3) keeps the dark silhouette visible.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <CalculatorIcon size={64} />
 */
export const CalculatorIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      rim={0.3}
      defs={
        <>
          <VGrad id={ids('bg')} from="#4b4b4f" to="#1c1c1e" />
          <VGrad id={ids('light')} from="#e3e3e5" to="#a6a6aa" />
          <VGrad id={ids('dark')} from="#727277" to="#4c4c51" />
          <VGrad id={ids('op')} from="#ffbc4d" to="#ff8a00" />
        </>
      }
    >
      {CALC_GRID.map((cy, row) =>
        CALC_GRID.map((cx, col) => {
          const op = col === 3;
          const fill = op ? ids.url('op') : row === 0 ? ids.url('light') : ids.url('dark');
          return (
            <g key={`${row}-${col}`}>
              <circle cx={cx} cy={cy + 0.7} r="6.1" fill="#000" fillOpacity="0.35" />
              <circle cx={cx} cy={cy} r="6.1" fill={fill} />
              {op && (
                <g transform={`translate(${cx} ${cy})`} stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none">
                  {CALC_OPS[row]}
                </g>
              )}
            </g>
          );
        }),
      )}
      <GlassEdge size={size} min={48} opacity={0.7}>
        {CALC_GRID.map((cy) => CALC_GRID.map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6.1" />))}
      </GlassEdge>
    </AppIconFrame>
  );
};

const SETTINGS_OUTER = gearPath(50, 50, 30.8, 34.6, 36, 0.36, 0.56); /** Outline of the outer 36-tooth gear of the System Settings icon. */
const SETTINGS_INNER = gearPath(50, 50, 19.5, 24.2, 12, 0.42, 0.62, 15); /** Outline of the inner 12-tooth gear, its teeth offset by 15°. */
const SETTINGS_SPOKES = [0, 60, 120, 180, 240, 300]; /** Rotation angles, in degrees, of the six spokes between the inner gear and the hub. */

/**
 * System Settings app icon.
 *
 * A steel gear inside a gear: the outer gear (with a glass edge from 32px up), a dark well, the
 * inner gear, six spokes and a central hub, each layer with its own drop shadow.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <SettingsIcon size={64} />
 */
export const SettingsIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#94959b" to="#46474c" />
          <VGrad id={ids('steel')} from="#fbfbfc" to="#a9aab0" />
          <VGrad id={ids('steel2')} from="#ececf0" to="#94959b" />
          <VGrad id={ids('well')} from="#2f3035" to="#5b5c62" />
        </>
      }
    >
      <path d={SETTINGS_OUTER} fill="#000" fillOpacity="0.25" transform="translate(0 1.2)" />
      <path d={SETTINGS_OUTER} fill={ids.url('steel')} />
      <GlassEdge size={size} min={32}>
        <path d={SETTINGS_OUTER} />
      </GlassEdge>
      <circle cx="50" cy="50" r="27.6" fill={ids.url('well')} />
      <path d={SETTINGS_INNER} fill="#000" fillOpacity="0.3" transform="translate(0 1)" />
      <path d={SETTINGS_INNER} fill={ids.url('steel2')} />
      <circle cx="50" cy="50" r="15.2" fill="#55565c" />
      {SETTINGS_SPOKES.map((deg) => (
        <rect key={deg} x="48.2" y="34" width="3.6" height="16" rx="1" fill="#c9cacf" transform={`rotate(${deg} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="8.4" fill={ids.url('steel')} />
      <circle cx="50" cy="50" r="3.3" fill="#3a3b40" />
    </AppIconFrame>
  );
};

/**
 * Builds the path of one Activity Monitor graph line.
 *
 * Spreads the samples evenly across x = 18…82 (the width of the icon's graph screen), rounds
 * each x to two decimals and joins the points with straight segments. Needs at least two
 * samples; with a single one the x coordinate is NaN.
 *
 * @param {number[]} ys - Y coordinate of each sample, left to right.
 * @returns {string} SVG path data: an `M` to the first sample, then an `L` to each following one.
 *
 * @example
 * graph([60, 40, 50]); // 'M18 60L50 40L82 50'
 */
const graph = (ys: number[]) => ys.map((y, i) => `${i === 0 ? 'M' : 'L'}${Math.round((18 + (64 * i) / (ys.length - 1)) * 100) / 100} ${y}`).join('');
const AM_GREEN = graph([67, 61, 64, 53, 57, 42, 48, 36, 45, 39, 50, 31]); /** Green graph line of the Activity Monitor icon, also closed into the filled area beneath it. */
const AM_RED = graph([73, 71, 74, 65, 69, 63, 67, 59, 64, 61, 56, 58]); /** Red graph line of the Activity Monitor icon, drawn behind the green one. */
const AM_GRID =
  [26, 34, 42, 50, 58, 66, 74].map((x) => `M${x} 21V79`).join('') + [31, 41, 51, 61, 71].map((y) => `M18 ${y}H82`).join(''); /** Activity Monitor screen grid: vertical lines every 8 units and horizontal lines every 10 units. */

/**
 * Activity Monitor app icon.
 *
 * A dark screen showing a green grid, a red graph line and a green graph line with a filled area,
 * all clipped to the screen's rounded rectangle. Uses the stronger rim (0.3) for the dark body.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <ActivityMonitorIcon size={64} />
 */
export const ActivityMonitorIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      rim={0.3}
      defs={
        <>
          <VGrad id={ids('bg')} from="#5d5d62" to="#28282b" />
          <VGrad id={ids('area')} from="rgba(50,215,75,0.45)" to="rgba(50,215,75,0)" />
          <clipPath id={ids('screen')}>
            <rect x="18" y="21" width="64" height="58" rx="5" />
          </clipPath>
        </>
      }
    >
      <rect x="18" y="21" width="64" height="58" rx="5" fill="#070907" />
      <g clipPath={ids.url('screen')}>
        <path d={AM_GRID} stroke="#2a5a33" strokeOpacity="0.55" strokeWidth="0.6" />
        <path d={`${AM_GREEN}L82 79H18Z`} fill={ids.url('area')} />
        <path d={AM_RED} fill="none" stroke="#ff453a" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
        <path d={AM_GREEN} fill="none" stroke="#3be25a" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </g>
      <rect x="18" y="21" width="64" height="58" rx="5" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="0.8" />
      <GlassEdge size={size} opacity={0.45}>
        <rect x="18" y="21" width="64" height="58" rx="5" />
      </GlassEdge>
    </AppIconFrame>
  );
};

/**
 * About This Computer app icon.
 *
 * A laptop with a colorful wallpaper on its screen, on a blue gradient. The screen gets a glass
 * edge from 24px up.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <AboutThisMacIcon size={64} />
 */
export const AboutThisMacIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#73c2ff" to="#1f5fd6" />
          <VGrad id={ids('lid')} from="#eeeff2" to="#b7b9bf" />
          <VGrad id={ids('base')} from="#f4f5f7" to="#a2a5ab" />
          <VGrad id={ids('wall')} from="#ffb35c" to="#7a5cff" x1={0} y1={0} x2={1} y2={1} />
        </>
      }
    >
      <rect x="24" y="25" width="52" height="36" rx="3.2" fill="#062a6b" fillOpacity="0.25" transform="translate(0 1.4)" />
      <rect x="24" y="25" width="52" height="36" rx="3.2" fill={ids.url('lid')} />
      <rect x="26.6" y="27.6" width="46.8" height="30.8" rx="1.6" fill="#111113" />
      <rect x="28.2" y="29.2" width="43.6" height="27.6" rx="0.6" fill={ids.url('wall')} />
      <GlassEdge size={size} opacity={0.5}>
        <rect x="26.6" y="27.6" width="46.8" height="30.8" rx="1.6" />
      </GlassEdge>
      <path d="M28.2 56.8L41 45L49 51.5L58.5 42L71.8 54.5V56.8Z" fill="#fff" fillOpacity="0.28" />
      <path d="M14 62H86L88.5 66.2C89 67.2 88.3 68.4 87 68.4H13C11.7 68.4 11 67.2 11.5 66.2Z" fill="#062a6b" fillOpacity="0.25" transform="translate(0 1.2)" />
      <path d="M14 62H86L88.5 66.2C89 67.2 88.3 68.4 87 68.4H13C11.7 68.4 11 67.2 11.5 66.2Z" fill={ids.url('base')} />
      <rect x="43" y="62" width="14" height="2" rx="1" fill="#8e9097" />
    </AppIconFrame>
  );
};

const BULB = 'M50 27C40.6 27 33 34.4 33 44C33 50.5 36.6 54.4 39.6 57.9C41.4 60 42.4 62 42.4 64.5H57.6C57.6 62 58.6 60 60.4 57.9C63.4 54.4 67 50.5 67 44C67 34.4 59.4 27 50 27Z'; /** Glass outline of the Tips light bulb, from the dome down to the top of the screw base. */
const BULB_RAYS = [-150, -115, -90, -65, -30]
  .map((deg) => {
    const [x1, y1] = polar(50, 44, 22.5, deg);
    const [x2, y2] = polar(50, 44, 28, deg);
    return `M${x1} ${y1}L${x2} ${y2}`;
  })
  .join(''); /** Five rays fanned above the bulb, between radii 22.5 and 28 around the dome's center (50, 44). */

/**
 * Tips app icon.
 *
 * A glowing light bulb with a filament, a highlight and a screw base, with rays fanned above it,
 * on a yellow-to-orange gradient.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <WelcomeIcon size={64} />
 */
export const WelcomeIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#ffd84a" to="#ff8f1f" />
          <VGrad id={ids('glass')} from="#ffffff" to="#fff2cf" />
        </>
      }
    >
      <path d={BULB_RAYS} stroke="#fff" strokeOpacity="0.9" strokeWidth="2.6" strokeLinecap="round" />
      <path d={BULB} fill="#a34b00" fillOpacity="0.22" transform="translate(0 1.4)" />
      <path d={BULB} fill={ids.url('glass')} />
      <path d="M45.6 63.8V54.5M54.4 63.8V54.5M45.6 54.5Q47.8 49 50 54.5Q52.2 60 54.4 54.5" fill="none" stroke="#ff9d1c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M39.2 41A11.2 11.2 0 0 1 47 32.6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="42.4" y="66.2" width="15.2" height="3.8" rx="1.9" fill="#f5efe4" />
      <rect x="43.2" y="71.2" width="13.6" height="3.8" rx="1.9" fill="#ebe3d4" />
      <path d="M46 76.4H54C53.4 79 51.9 80.2 50 80.2C48.1 80.2 46.6 79 46 76.4Z" fill="#ddd3c1" />
    </AppIconFrame>
  );
};

const MINE_SPIKES = [0, 45, 90, 135]
  .map((deg) => {
    const [x1, y1] = polar(44, 58, 20.5, deg);
    const [x2, y2] = polar(44, 58, 20.5, deg + 180);
    return `M${x1} ${y1}L${x2} ${y2}`;
  })
  .join(''); /** Four lines through the mine's center (44, 58) at 45° steps, forming its eight spikes. */
const MINE_TILES = Array.from({ length: 25 }, (_, i) => ({ x: (i % 5) * 20, y: Math.floor(i / 5) * 20, on: (i + Math.floor(i / 5)) % 2 === 0 })).filter((t) => t.on); /** Lighter cells of the Minesweeper background: columns 0, 2 and 4 of a 5×5 grid of 20-unit cells, in every row, which draws vertical stripes. */

/**
 * Minesweeper app icon.
 *
 * A black spiked mine with a highlight and a red flag on a green gradient crossed by lighter
 * vertical stripes. The mine's body gets a glass edge from 24px up.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <MinesweeperIcon size={64} />
 */
export const MinesweeperIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#62e38c" to="#0b9a8a" />
          <radialGradient id={ids('mine')} cx="0.36" cy="0.34" r="0.75">
            <stop offset="0" stopColor="#6e6e74" />
            <stop offset="0.55" stopColor="#1f1f22" />
            <stop offset="1" stopColor="#000" />
          </radialGradient>
          <VGrad id={ids('flag')} from="#ff6257" to="#d81f15" />
        </>
      }
    >
      {MINE_TILES.map((t) => (
        <rect key={`${t.x}-${t.y}`} x={t.x} y={t.y} width="20" height="20" fill="#fff" fillOpacity="0.08" />
      ))}
      <ellipse cx="45" cy="80.5" rx="15" ry="2.6" fill="#003d33" fillOpacity="0.25" />
      <path d={MINE_SPIKES} stroke="#111" strokeWidth="3.8" strokeLinecap="round" />
      <circle cx="44" cy="58" r="14.6" fill={ids.url('mine')} />
      <GlassEdge size={size} opacity={0.6}>
        <circle cx="44" cy="58" r="14.6" />
      </GlassEdge>
      <circle cx="38.6" cy="52.4" r="3.4" fill="#fff" fillOpacity="0.85" />
      <path d="M67.5 21.5V47.5" stroke="#26262a" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M60.5 50.5C60.5 47.4 63.6 46 67.5 46C71.4 46 74.5 47.4 74.5 50.5Z" fill="#26262a" />
      <path d="M68.6 20.6C72.6 21.4 77.4 23.6 82 27.4C77.6 30.2 72.8 32.4 68.6 33.6Z" fill={ids.url('flag')} />
    </AppIconFrame>
  );
};

const BLUEPRINT_GRID = Array.from({ length: 9 }, (_, i) => 10 + i * 10)
  .map((v) => `M${v} 0V100M0 ${v}H100`)
  .join(''); /** Blueprint grid behind the generic app icon: lines every 10 units in both directions. */

/**
 * Generic app icon, used for .app bundles with no icon of their own.
 *
 * A ruler and a pencil leaning together into an "A", with a brush as the crossbar, over a
 * blueprint grid and a dashed circle on a blue gradient.
 *
 * @param {Object} props - Icon props.
 * @param {number} props.size - Rendered width and height in pixels.
 * @returns {JSX.Element} The icon SVG.
 *
 * @example
 * <GenericAppIcon size={64} />
 */
export const GenericAppIcon: IconFC = ({ size }) => {
  const ids = useIconIds();
  return (
    <AppIconFrame
      size={size}
      fill={ids.url('bg')}
      defs={
        <>
          <VGrad id={ids('bg')} from="#4f8fe0" to="#1d4f9c" />
          <VGrad id={ids('pencil')} from="#ffd75e" to="#f2a516" x1={0} y1={0} x2={1} y2={0} />
          <VGrad id={ids('ruler')} from="#f4f5f7" to="#c4c8cf" x1={0} y1={0} x2={1} y2={0} />
        </>
      }
    >
      <path d={BLUEPRINT_GRID} stroke="#fff" strokeOpacity="0.14" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="29" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="3 2.4" />
      {/* Ruler (right leg) and pencil (left leg) lean together into an "A". */}
      <g transform="translate(9 0) rotate(-20 50 50)">
        <rect x="46" y="20" width="8" height="60" rx="1" fill={ids.url('ruler')} />
        <path d="M46 27H49.5M46 33H48.5M46 39H49.5M46 45H48.5M46 51H49.5M46 57H48.5M46 63H49.5M46 69H48.5M46 75H49.5" stroke="#6b7280" strokeWidth="0.7" />
      </g>
      <g transform="translate(-9 0) rotate(20 50 50)">
        <rect x="45.5" y="26" width="9" height="46" fill={ids.url('pencil')} />
        <path d="M48.5 26V72" stroke="#000" strokeOpacity="0.12" strokeWidth="0.8" />
        <rect x="45.5" y="20.5" width="9" height="6" rx="1.4" fill="#ff8fa3" />
        <path d="M45.5 72H54.5L50 81Z" fill="#f2d3a8" />
        <path d="M48.4 77.7H51.6L50 81Z" fill="#333" />
      </g>
      {/* Brush lying across both legs as the crossbar of the "A". */}
      <g transform="rotate(-6 50 62)">
        <rect x="26" y="60" width="36" height="4.2" rx="2.1" fill="#9a5b2c" />
        <rect x="61" y="59.2" width="6" height="5.8" rx="0.8" fill="#c0c4cb" />
        <path d="M67 59.4C71 59.6 74 61 75.5 62.1C74 63.2 71 64.6 67 64.8Z" fill="#26262a" />
      </g>
    </AppIconFrame>
  );
};

/**
 * The lock screen clock drawn as Liquid Glass digits (macOS 26 lock screen).
 *
 * The digits are an SVG <text> rendered through a filter that turns the glyph shape into a slab
 * of milky glass: the glyph outline is softened into a height map whose slope (Sobel) bends the
 * desktop picture along the edges, the bent picture is frosted and mixed mostly toward white, a
 * thin line of light runs along the top-left edges with a weaker bounce on the bottom-right
 * edges, and a faint shadow separates the digits from bright pictures. The desktop picture is
 * placed in the filter exactly where the lock screen draws it (`cover`, centred on the
 * viewport), so what shows through lines up with the backdrop.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useSystem } from '@/kernel/system';
import styles from './GlassClock.module.css';

const WIDTH = 820; /** Width of the clock canvas in px (wide enough for "12:59" at the font size). */
const HEIGHT = 168; /** Height of the clock canvas in px, including room for the shadow. */
const FONT_SIZE = 136; /** Size of the digits in px. */
const BASELINE = 134; /** Baseline of the digits inside the canvas. */
const BEVEL = 2.5; /** Blur radius that rounds the glyph edges into a bevel (px). */
const LENS = 22; /** Strength of the refraction along the bevel (feDisplacementMap scale, px). */
const MILK = 0.74; /** White lift added to the frosted picture (0 = clear glass, 1 = opaque white). */
const TRANSMIT = 0.3; /** Share of the frosted picture that shows through the milky glass. */

interface Placement {
  left: number;
  top: number;
  vw: number;
  vh: number;
}

/**
 * Renders the time as glass digits over the desktop picture.
 *
 * Measures where the SVG sits in the viewport after every render (the clock re-renders each
 * second, and the lock screen animates in) and feeds that offset to the filter's feImage so the
 * picture inside the digits lines up with the backdrop. Exposes the time to assistive technology
 * through `role="img"` and `aria-label`. With Reduce Transparency the digits are plain white text.
 *
 * @param {Object} props - Component props.
 * @param {string} props.text - The time to show, e.g. "9:41".
 * @param {string} props.wallpaper - URL of the desktop picture behind the lock screen.
 * @param {string} props.dateTime - Machine-readable time for the label's <time> element.
 * @returns {JSX.Element} The glass clock.
 *
 * @example
 * <GlassClock text="9:41" wallpaper="/wallpapers/flow-light.jpg" dateTime={now.toISOString()} />
 */
export function GlassClock({ text, wallpaper, dateTime }: { text: string; wallpaper: string; dateTime: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const filterId = `glass-clock-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const reduce = useSystem((s) => s.settings.reduceTransparency);
  const [place, setPlace] = useState<Placement>({ left: 0, top: 0, vw: 1440, vh: 900 });

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const scale = r.width / WIDTH || 1;
    const next = { left: Math.round(r.left / scale), top: Math.round(r.top / scale), vw: Math.round(window.innerWidth / scale), vh: Math.round(window.innerHeight / scale) };
    setPlace((p) => (p.left === next.left && p.top === next.top && p.vw === next.vw && p.vh === next.vh ? p : next));
  });

  return (
    <time className={styles.clock} dateTime={dateTime} aria-label={text}>
      <svg ref={svgRef} className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} aria-hidden="true">
        {!reduce && (
          <defs>
            <filter id={filterId} x="0" y="0" width={WIDTH} height={HEIGHT} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
              <feImage href={wallpaper} x={-place.left} y={-place.top} width={place.vw} height={place.vh} preserveAspectRatio="xMidYMid slice" result="wall" />

              <feGaussianBlur in="SourceAlpha" stdDeviation={BEVEL} result="height" />
              <feColorMatrix in="height" type="matrix" values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1" result="heightGray" />
              <feConvolveMatrix in="heightGray" order="3" kernelMatrix="1 0 -1  2 0 -2  1 0 -1" divisor="1.6" bias="0.5" edgeMode="duplicate" preserveAlpha="true" result="slopeX" />
              <feConvolveMatrix in="heightGray" order="3" kernelMatrix="1 2 1  0 0 0  -1 -2 -1" divisor="1.6" bias="0.5" edgeMode="duplicate" preserveAlpha="true" result="slopeY" />
              <feColorMatrix in="slopeX" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="slopeR" />
              <feColorMatrix in="slopeY" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1" result="slopeG" />
              <feComposite in="slopeR" in2="slopeG" operator="arithmetic" k2="1" k3="1" result="normals" />
              <feDisplacementMap in="wall" in2="normals" scale={LENS} xChannelSelector="R" yChannelSelector="G" result="bent" />

              <feGaussianBlur in="bent" stdDeviation="3" result="frosted" />
              <feColorMatrix in="frosted" type="saturate" values="1.25" result="saturated" />
              <feComponentTransfer in="saturated" result="milky">
                <feFuncR type="linear" slope={TRANSMIT} intercept={MILK} />
                <feFuncG type="linear" slope={TRANSMIT} intercept={MILK} />
                <feFuncB type="linear" slope={TRANSMIT} intercept={MILK + 0.02} />
              </feComponentTransfer>
              <feComposite in="milky" in2="SourceAlpha" operator="in" result="glass" />

              <feOffset in="SourceAlpha" dx="1.2" dy="1.2" result="shiftIn" />
              <feComposite in="SourceAlpha" in2="shiftIn" operator="out" result="keyBand" />
              <feGaussianBlur in="keyBand" stdDeviation="0.4" result="keySoft" />
              <feFlood floodColor="#fff" floodOpacity="0.85" result="keyColor" />
              <feComposite in="keyColor" in2="keySoft" operator="in" result="keyLight" />
              <feOffset in="SourceAlpha" dx="-1" dy="-1" result="shiftOut" />
              <feComposite in="SourceAlpha" in2="shiftOut" operator="out" result="bounceBand" />
              <feGaussianBlur in="bounceBand" stdDeviation="0.4" result="bounceSoft" />
              <feFlood floodColor="#fff" floodOpacity="0.45" result="bounceColor" />
              <feComposite in="bounceColor" in2="bounceSoft" operator="in" result="bounceLight" />

              <feGaussianBlur in="SourceAlpha" stdDeviation="10" result="shadowBlur" />
              <feOffset in="shadowBlur" dy="3" result="shadowOffset" />
              <feFlood floodColor="#0a1a40" floodOpacity="0.14" result="shadowColor" />
              <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="shadow" />

              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="glass" />
                <feMergeNode in="keyLight" />
                <feMergeNode in="bounceLight" />
              </feMerge>
            </filter>
          </defs>
        )}
        <text
          x={WIDTH / 2}
          y={BASELINE}
          textAnchor="middle"
          className={styles.digits}
          fontSize={FONT_SIZE}
          filter={reduce ? undefined : `url(#${filterId})`}
        >
          {text}
        </text>
      </svg>
    </time>
  );
}

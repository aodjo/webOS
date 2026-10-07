/** Sidebar glyphs lucide doesn't have, drawn in the same 24×24 stroke style. */
import type { ReactNode, SVGProps } from 'react';

/** Props of a glyph: pixel size, class name and any other SVG attribute except width/height. */
type GlyphProps = { size?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

/**
 * Shared SVG frame for the glyphs.
 *
 * Renders a square 24×24 viewBox with lucide's stroke settings (current color, 1.8 width,
 * round caps and joins), hidden from assistive technology. Extra props are forwarded to the
 * `<svg>` element.
 *
 * @param {GlyphProps & { children: ReactNode }} props - Glyph props plus the SVG content.
 * @param {number} [props.size=16] - Width and height in pixels.
 * @param {ReactNode} props.children - Paths drawn inside the frame.
 * @returns {JSX.Element} The SVG element.
 *
 * @example
 * <Svg size={20}><path d="M4 6.5h16" /></Svg>
 */
function Svg({ size = 16, children, ...rest }: GlyphProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

/**
 * Empty trash can glyph.
 *
 * Draws a lid, handle and a can with two vertical ribs.
 *
 * @param {GlyphProps} props - Size, class name and other SVG attributes.
 * @returns {JSX.Element} The trash can icon.
 *
 * @example
 * <TrashEmptyGlyph size={16} />
 */
export function TrashEmptyGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6 6.5l1 12.6c.1 1 .9 1.9 2 1.9h6c1.1 0 1.9-.9 2-1.9l1-12.6" />
      <path d="M10 10.5v6.5M14 10.5v6.5" />
    </Svg>
  );
}

/**
 * Full trash can glyph.
 *
 * Draws a trash can with crumpled paper sticking out of the top instead of a lid.
 *
 * @param {GlyphProps} props - Size, class name and other SVG attributes.
 * @returns {JSX.Element} The full trash can icon.
 *
 * @example
 * {trashCount > 0 ? <TrashFullGlyph /> : <TrashEmptyGlyph />}
 */
export function TrashFullGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M4 9h16" />
      <path d="M6 9l.9 10.1c.1 1 .9 1.9 2 1.9h6.2c1.1 0 1.9-.9 2-1.9L18 9" />
      <path d="M8 9l1.2-4.2 3 1.4 2.3-3 2 3.2L15.8 9" />
      <path d="M10 12.5v5M14 12.5v5" />
    </Svg>
  );
}

/**
 * Creates an icon component that draws a filled color dot.
 *
 * Used for tag entries in menus and the sidebar, where an icon component (not an element) is
 * expected. The returned component draws a circle filled with `color`.
 *
 * @param {string} color - CSS color of the dot, e.g. `var(--red)`.
 * @returns {(props: { size?: number; className?: string }) => JSX.Element} An icon component.
 *
 * @example
 * const RedDot = tagDot('var(--red)');
 * <RedDot size={10} />
 */
export function tagDot(color: string) {
  /**
   * Filled color dot icon.
   *
   * Draws a 12×12 viewBox with a circle of radius 5 filled with the `color` captured by
   * `tagDot`, scaled to `size` and hidden from assistive technology.
   *
   * @param {Object} props - Icon props.
   * @param {number} [props.size=12] - Width and height in pixels.
   * @param {string} [props.className] - Class name for the `<svg>` element.
   * @returns {JSX.Element} The dot.
   *
   * @example
   * <TagDot size={12} />
   */
  return function TagDot({ size = 12, className }: { size?: number; className?: string }) {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" className={className} aria-hidden="true">
        <circle cx="6" cy="6" r="5" style={{ fill: color }} />
      </svg>
    );
  };
}

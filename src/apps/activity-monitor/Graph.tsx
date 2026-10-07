/**
 * Activity Monitor history graph: stacked area chart of the last N samples, newest on the right.
 */
import type { CSSProperties } from 'react';
import styles from './ActivityMonitor.module.css';

/** Props of {@link Graph}. */
interface Props {
  /** One array per series (bottom of the stack first), oldest sample first. */
  series: number[][];
  /** CSS color per series, in the same order as `series` (CSS variables allowed). */
  colors: string[];
  /** Value mapped to the top of the chart; larger stacked values are clipped. */
  max: number;
  /** Number of sample slots across the width. */
  samples?: number;
  /** Accessible label for the figure and the SVG. */
  label: string;
  /** Optional caption shown above the chart. */
  title?: string;
}

/**
 * Renders a stacked area chart of recent samples.
 *
 * The SVG viewBox is `samples - 1` units wide and 100 units tall and stretches to its
 * container. The newest sample sits on the right edge, so a short history only fills the
 * right part of the chart. Each series is stacked on top of the previous ones: its area spans
 * from the running total below it to the new total, and its top edge is also drawn as a line.
 * Values are scaled against `max` (treated as 1 when 0) and clamped to the chart height.
 * Nothing is plotted until there are at least two samples. Series colors are passed through
 * the `--series` CSS custom property because `var()` is not resolved inside SVG presentation
 * attributes.
 *
 * @param {Props} props - Component props.
 * @param {number[][]} props.series - One array per series (bottom of the stack first), oldest sample first.
 * @param {string[]} props.colors - CSS color for each series.
 * @param {number} props.max - Value that maps to the top of the chart.
 * @param {number} [props.samples=60] - Number of sample slots across the width.
 * @param {string} props.label - Accessible label for the chart.
 * @param {string} [props.title] - Optional visible caption.
 * @returns {JSX.Element} The chart wrapped in a `<figure>`.
 *
 * @example
 * <Graph series={[sys, user]} colors={['var(--red)', 'var(--blue)']} max={100} label="CPU LOAD" />
 */
export function Graph({ series, colors, max, samples = 60, label, title }: Props) {
  const n = Math.max(0, ...series.map((s) => s.length));
  const W = samples - 1;
  /**
   * Maps a sample index to an x coordinate, aligning the newest sample to the right edge.
   *
   * Each sample is one viewBox unit apart; with fewer than `samples` points the oldest one
   * lands to the right of x = 0.
   *
   * @param {number} i - Sample index (0 = oldest).
   * @returns {number} X coordinate in viewBox units.
   *
   * @example
   * x(n - 1); // W
   */
  const x = (i: number) => W - (n - 1 - i);
  /**
   * Maps a value to a y coordinate, with `max` at the top and 0 at the bottom.
   *
   * The value is scaled to a 0–100 range against `max` (1 when `max` is 0), clamped, and
   * inverted because SVG y grows downward.
   *
   * @param {number} v - Stacked value to plot.
   * @returns {number} Y coordinate in viewBox units, clamped to 0–100.
   *
   * @example
   * y(max); // 0
   */
  const y = (v: number) => 100 - Math.min(100, Math.max(0, (v / (max || 1)) * 100));

  const paths: { area: string; line: string; color: string }[] = [];
  if (n >= 2) {
    const base = new Array<number>(n).fill(0);
    series.forEach((s, k) => {
      const top = base.map((b, i) => b + (s[i] ?? 0));
      const upper = top.map((v, i) => `${x(i)},${y(v)}`);
      const lower = base.map((v, i) => `${x(i)},${y(v)}`).reverse();
      paths.push({ area: `M${upper.join('L')}L${lower.join('L')}Z`, line: `M${upper.join('L')}`, color: colors[k] });
      top.forEach((v, i) => (base[i] = v));
    });
  }

  return (
    <figure className={styles.graph} aria-label={label}>
      {title && <figcaption className={styles.graphTitle}>{title}</figcaption>}
      <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" className={styles.graphSvg} role="img" aria-label={label}>
        {[25, 50, 75].map((g) => (
          <line key={g} x1={0} x2={W} y1={g} y2={g} className={styles.gridLine} vectorEffect="non-scaling-stroke" />
        ))}
        {/* Colors go through CSS: var() isn't resolved in SVG presentation attributes. */}
        {paths.map((p, i) => (
          <g key={i} style={{ '--series': p.color } as CSSProperties}>
            <path d={p.area} className={styles.graphArea} />
            <path d={p.line} className={styles.graphLine} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
    </figure>
  );
}

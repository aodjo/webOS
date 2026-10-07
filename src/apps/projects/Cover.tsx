import { forwardRef, useState, type CSSProperties } from 'react';
import type { Project } from '@/data/portfolio';
import styles from './Cover.module.css';

/**
 * Renders a project's cover image on top of a gradient in the project's color.
 *
 * The container paints a gradient from `project.color` (exposed as the `--c` custom property), so
 * the gradient shows while the image loads. If the image fails to load, the failed URL is
 * remembered and the image is replaced by the project's initials (first letters of up to two
 * words); a different `project.cover` URL resets that state and tries the image again. The ref is
 * forwarded to the container element so callers can measure it for shared-element transitions.
 *
 * @param {Object} props - Component props.
 * @param {Project} props.project - Project whose cover, color and name are shown.
 * @param {string} [props.className=''] - Extra class names appended to the container.
 * @param {boolean} [props.eager] - Load the image eagerly instead of lazily.
 * @param {CSSProperties} [props.style] - Inline styles merged into the container style.
 * @param {React.ForwardedRef<HTMLDivElement>} ref - Ref forwarded to the container `div`.
 * @returns {JSX.Element} The cover element.
 *
 * @example
 * <ProjectCover ref={coverRef} project={project} className={styles.cardCover} eager />
 */
export const ProjectCover = forwardRef<HTMLDivElement, { project: Project; className?: string; eager?: boolean; style?: CSSProperties }>(function ProjectCover(
  { project, className = '', eager, style },
  ref,
) {
  const [failed, setFailed] = useState<string | null>(null);
  const broken = failed === project.cover;
  const initials = project.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div ref={ref} className={`${styles.cover} ${className}`} style={{ ...style, ['--c' as string]: project.color }}>
      {broken ? (
        <span className={styles.fallback} aria-hidden="true">
          {initials}
        </span>
      ) : (
        <img src={project.cover} alt="" draggable={false} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(project.cover)} />
      )}
    </div>
  );
});

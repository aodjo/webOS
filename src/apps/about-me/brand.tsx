/**
 * Brand marks drawn as inline SVG, since lucide-react v1 has no brand icons.
 * Shared by the About Me and Projects apps.
 */

/**
 * Renders the GitHub logo as an inline SVG icon.
 *
 * Draws the GitHub mark on a 16x16 view box and fills it with `currentColor`,
 * so the icon takes on the text color of its parent in both light and dark
 * themes. The SVG is `aria-hidden` because it is decorative; the enclosing
 * link or button provides the accessible label.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=16] - Rendered width and height in CSS pixels.
 * @returns {JSX.Element} The GitHub logo `<svg>` element.
 *
 * @example
 * <button onClick={() => openURL(github)}>
 *   <GitHubMark size={14} /> Source
 * </button>
 */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * Renders the LinkedIn logo as an inline SVG icon.
 *
 * Draws the LinkedIn "in" mark on a 16x16 view box and fills it with
 * `currentColor`, so the icon takes on the text color of its parent in both
 * light and dark themes. The SVG is `aria-hidden` because it is decorative;
 * the enclosing link or button provides the accessible label.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=16] - Rendered width and height in CSS pixels.
 * @returns {JSX.Element} The LinkedIn logo `<svg>` element.
 *
 * @example
 * const icon = <LinkedInMark size={12} />;
 * // <svg width="12" height="12" ...>
 */
export function LinkedInMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.63 0H2.37A2.37 2.37 0 0 0 0 2.37v11.26A2.37 2.37 0 0 0 2.37 16h11.26A2.37 2.37 0 0 0 16 13.63V2.37A2.37 2.37 0 0 0 13.63 0ZM4.9 13.4H2.53V6.03H4.9Zm-1.19-8.4a1.37 1.37 0 1 1 0-2.74 1.37 1.37 0 0 1 0 2.74ZM13.47 13.4H11.1V9.82c0-.85-.02-1.95-1.19-1.95-1.19 0-1.37.93-1.37 1.89v3.64H6.18V6.03h2.27v1h.03c.32-.6 1.09-1.23 2.24-1.23 2.4 0 2.84 1.58 2.84 3.63Z" />
    </svg>
  );
}

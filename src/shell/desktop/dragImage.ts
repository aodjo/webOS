/**
 * Custom HTML5 drag image for desktop icons: clones of every dragged icon, laid out as they are on
 * screen, plus a red count badge for multiple items (like Finder).
 */
import type { DragEvent } from 'react';

const MAX_ICONS = 16; /** Maximum number of icon clones drawn in the drag image. */

/**
 * Sets a Finder-style drag image for one or more desktop icons.
 *
 * Picks the anchor icon plus the icons closest to it (at most `MAX_ICONS`, so the image stays a
 * sensible size), clones them into an off-screen container at their on-screen offsets, and adds
 * a red count badge beside the anchor when more than one item is dragged. The pointer keeps its
 * position relative to the icons. The browser snapshots the container synchronously inside
 * `setDragImage`, so it is removed again on the next task. Does nothing when the browser has no
 * `setDragImage` or when `elements` is empty.
 *
 * @param {DragEvent} e - The dragstart event whose drag image is replaced.
 * @param {HTMLElement[]} elements - The icon elements being dragged.
 * @param {HTMLElement} anchor - The icon the drag started on.
 * @returns {void}
 *
 * @example
 * setIconsDragImage(e, paths.map((p) => iconEls.get(p)!), e.currentTarget);
 */
export function setIconsDragImage(e: DragEvent, elements: HTMLElement[], anchor: HTMLElement): void {
  const dt = e.dataTransfer;
  if (!dt?.setDragImage || !elements.length) return;
  const anchorRect = anchor.getBoundingClientRect();
  const picked = elements
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => Math.hypot(a.r.left - anchorRect.left, a.r.top - anchorRect.top) - Math.hypot(b.r.left - anchorRect.left, b.r.top - anchorRect.top))
    .slice(0, MAX_ICONS);
  const minX = Math.min(...picked.map((p) => p.r.left));
  const minY = Math.min(...picked.map((p) => p.r.top));
  const maxX = Math.max(...picked.map((p) => p.r.right));
  const maxY = Math.max(...picked.map((p) => p.r.bottom));

  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    width: `${maxX - minX}px`,
    height: `${maxY - minY}px`,
    pointerEvents: 'none',
  });
  for (const { el, r } of picked) {
    const clone = el.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, { transform: 'none', left: `${r.left - minX}px`, top: `${r.top - minY}px`, opacity: '0.82', transition: 'none' });
    ghost.appendChild(clone);
  }
  if (elements.length > 1) {
    const badge = document.createElement('div');
    badge.textContent = String(elements.length);
    Object.assign(badge.style, {
      position: 'absolute',
      left: `${anchorRect.left - minX + anchorRect.width / 2 + 22}px`,
      top: `${anchorRect.top - minY}px`,
      minWidth: '20px',
      height: '20px',
      padding: '0 6px',
      borderRadius: '10px',
      background: '#ff3b30',
      color: '#fff',
      font: '600 12px/20px -apple-system, BlinkMacSystemFont, sans-serif',
      textAlign: 'center',
      boxShadow: '0 1px 3px rgba(0,0,0,.35)',
    });
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);
  dt.setDragImage(ghost, e.clientX - minX, e.clientY - minY);
  setTimeout(() => ghost.remove(), 0);
}

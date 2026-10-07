/**
 * Static thumbnails of minimized windows for their Dock tiles (macOS shows the window's content).
 *
 * When a window is minimized its DOM is still on screen (the minimize state is observed
 * synchronously, before React re-renders), so it is deep-cloned once, the live state the clone
 * would lose (canvas pixels, form values, scroll offsets) is copied over, and anything active is
 * neutralized (iframes/media are replaced by placeholders, the clone is inert). Best effort: windows
 * are found by their `data-window-id` attribute; without it the Dock falls back to a drawn window
 * tile.
 */

/** A captured window clone ready to be mounted in a Dock tile. */
interface Snapshot {
  el: HTMLElement;
  /** Scroll offsets to re-apply once the clone is attached (detached nodes can't scroll). */
  scroll: [HTMLElement, number, number][];
}

const snapshots = new Map<string, Snapshot>(); /** Captured snapshots keyed by window id. */

const MEDIA = new Set(['IFRAME', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED']); /** Tag names replaced by inert placeholders in a snapshot. */

/**
 * Finds a window's root element in the document by its `data-window-id` attribute.
 *
 * The id is escaped with `CSS.escape` when available (falling back to escaping double quotes) so
 * it is safe inside the attribute selector.
 *
 * @param {string} id - The window id.
 * @returns {HTMLElement | null} The window element, or null when absent or outside a DOM.
 *
 * @example
 * const el = findWindowElement('win-3');
 */
function findWindowElement(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  return document.querySelector<HTMLElement>(`[data-window-id="${esc}"]`);
}

/**
 * Captures a static clone of a window's DOM to use as its Dock thumbnail.
 *
 * Walks the original and the clone in parallel and, per element:
 * - records non-zero scroll offsets (re-applied by `mountSnapshot`);
 * - redraws canvases into the clone (a canvas that cannot be drawn, e.g. a zero-sized one, is left
 *   blank);
 * - copies input, textarea and select state; cloned inputs lose their `name` so a cloned checked
 *   radio doesn't uncheck the original in the same group, and file inputs keep no value because
 *   they reject programmatic values;
 * - replaces iframes and media with same-sized placeholder boxes;
 * - strips `id` (except on SVG elements, whose ids are referenced internally), `autofocus` and
 *   `data-window-id` so the clone can't collide with the live window.
 * The clone is then pinned to the top-left at `width` × `height`, made inert and aria-hidden, and
 * stored under `id`, replacing any earlier snapshot. Does nothing when the window isn't found or
 * the size is not positive; any error during cloning is swallowed.
 *
 * @param {string} id - The window id.
 * @param {number} width - Window width in px.
 * @param {number} height - Window height in px.
 * @returns {void}
 *
 * @example
 * captureWindow(win.id, win.width, win.height);
 */
export function captureWindow(id: string, width: number, height: number): void {
  const src = findWindowElement(id);
  if (!src || width <= 0 || height <= 0) return;
  try {
    const clone = src.cloneNode(true) as HTMLElement;
    const a = [src, ...Array.from(src.querySelectorAll<HTMLElement>('*'))];
    const b = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
    const scroll: Snapshot['scroll'] = [];
    for (let i = 0; i < a.length && i < b.length; i++) {
      const s = a[i];
      const c = b[i];
      if (s.scrollTop || s.scrollLeft) scroll.push([c, s.scrollTop, s.scrollLeft]);
      if (s instanceof HTMLCanvasElement && c instanceof HTMLCanvasElement) {
        try {
          c.getContext('2d')?.drawImage(s, 0, 0);
        } catch {
          /* zero-sized or unsupported canvas: left blank */
        }
      } else if (s instanceof HTMLInputElement && c instanceof HTMLInputElement) {
        c.removeAttribute('name');
        if (s.type !== 'file') c.value = s.value;
        c.checked = s.checked;
      } else if (s instanceof HTMLTextAreaElement && c instanceof HTMLTextAreaElement) {
        c.value = s.value;
      } else if (s instanceof HTMLSelectElement && c instanceof HTMLSelectElement) {
        c.selectedIndex = s.selectedIndex;
      } else if (MEDIA.has(s.tagName)) {
        const ph = document.createElement('div');
        ph.className = s.className;
        ph.style.cssText = `width:${s.offsetWidth}px;height:${s.offsetHeight}px;background:var(--content-bg)`;
        c.replaceWith(ph);
        continue;
      }
      if (!(c instanceof SVGElement)) c.removeAttribute('id');
      c.removeAttribute('autofocus');
      c.removeAttribute('data-window-id');
    }
    Object.assign(clone.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      right: 'auto',
      bottom: 'auto',
      margin: '0',
      width: `${width}px`,
      height: `${height}px`,
      transform: 'none',
      opacity: '1',
      visibility: 'visible',
      display: '',
      pointerEvents: 'none',
      transition: 'none',
      animation: 'none',
      zIndex: 'auto',
    });
    clone.setAttribute('inert', '');
    clone.setAttribute('aria-hidden', 'true');
    snapshots.set(id, { el: clone, scroll });
  } catch {
    /* thumbnails are best effort: no snapshot is stored */
  }
}

/**
 * Attaches the snapshot of a window into a host element, scaled down.
 *
 * Applies a top-left-origin `scale()` transform, appends the clone, then re-applies the recorded
 * scroll offsets (they only take effect once the clone is in the document).
 *
 * @param {string} id - The window id.
 * @param {HTMLElement} host - Element that receives the clone.
 * @param {number} scale - Scale factor applied to the clone.
 * @returns {(() => void) | null} A function that detaches the clone again, or null when no
 *   snapshot exists for `id`.
 *
 * @example
 * const detach = mountSnapshot(win.id, tileRef.current, 0.2);
 * return () => detach?.();
 */
export function mountSnapshot(id: string, host: HTMLElement, scale: number): (() => void) | null {
  const snap = snapshots.get(id);
  if (!snap) return null;
  snap.el.style.transformOrigin = '0 0';
  snap.el.style.transform = `scale(${scale})`;
  host.appendChild(snap.el);
  for (const [el, top, left] of snap.scroll) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  return () => snap.el.remove();
}

/**
 * Tells whether a snapshot has been captured for a window.
 *
 * Only checks the in-memory snapshot map; it does not look at whether the clone is mounted.
 *
 * @param {string} id - The window id.
 * @returns {boolean} True when `captureWindow` stored a snapshot for `id`.
 *
 * @example
 * if (!hasSnapshot(win.id)) drawFallbackTile();
 */
export function hasSnapshot(id: string): boolean {
  return snapshots.has(id);
}

/**
 * Discards a window's snapshot, detaching its clone if it is mounted.
 *
 * Removes the clone from the DOM and deletes the map entry; calling it for a window without a
 * snapshot does nothing.
 *
 * @param {string} id - The window id.
 * @returns {void}
 *
 * @example
 * dropSnapshot(win.id); // after the window is restored or closed
 */
export function dropSnapshot(id: string): void {
  snapshots.get(id)?.el.remove();
  snapshots.delete(id);
}

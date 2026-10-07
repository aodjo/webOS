import { useEffect, useState } from 'react';

/** Lifecycle phase of an overlay: hidden, shown, or playing its exit animation. */
type Phase = 'closed' | 'open' | 'closing';

/**
 * Keeps an overlay mounted for `exitMs` after `open` turns false so it can play its exit animation.
 *
 * Uses the "adjust state while rendering" pattern: the phase is updated during render when `open`
 * changes, so the overlay never unmounts for a frame between `open` flipping and the closing phase
 * starting. A timeout then moves "closing" to "closed"; reopening during the exit cancels it.
 *
 * @param {boolean} open - Whether the overlay should be visible.
 * @param {number} exitMs - Duration of the exit animation in milliseconds.
 * @returns {{ mounted: boolean; closing: boolean }} `mounted` while open or animating out;
 *   `closing` while the exit animation should play.
 *
 * @example
 * const { mounted, closing } = usePresence(isOpen, 180);
 * if (!mounted) return null;
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed');
  if (open && phase !== 'open') setPhase('open');
  else if (!open && phase === 'open') setPhase('closing');

  useEffect(() => {
    if (phase !== 'closing') return;
    const t = setTimeout(() => setPhase('closed'), exitMs);
    return () => clearTimeout(t);
  }, [phase, exitMs]);

  return { mounted: open || phase !== 'closed', closing: !open && phase === 'closing' };
}

import { useEffect, useState } from 'react';

/**
 * Tracks the browser window's inner size reactively.
 *
 * Subscribes to `resize` and re-renders only when the width or height actually changed.
 *
 * @returns {{ w: number; h: number }} The current `window.innerWidth` and `window.innerHeight`.
 *
 * @example
 * const { w, h } = useViewport();
 * const isPhone = w < 600;
 */
export function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    /**
     * Stores the new window size, keeping the previous object when nothing changed.
     *
     * Returning the previous state object for an unchanged size lets React skip the re-render.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('resize', on);
     */
    const on = () => setVp((prev) => (prev.w === window.innerWidth && prev.h === window.innerHeight ? prev : { w: window.innerWidth, h: window.innerHeight }));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

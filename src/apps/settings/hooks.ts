/** React hooks shared by several panes (live clock, screen metrics, storage usage). */
import { useEffect, useMemo, useState } from 'react';
import { fileSizeOf, useFS } from '@/kernel';
import { computeStorage, type StorageStats } from './storageStats';

/**
 * Returns the current time, re-rendering on every second boundary.
 *
 * Instead of a drifting `setInterval`, each tick schedules a timeout for the remaining
 * milliseconds of the current second (plus 8ms of slack), so updates land just after the
 * wall-clock second changes. The pending timeout is cleared on unmount.
 *
 * @returns {Date} The current date/time, refreshed once per second.
 *
 * @example
 * const now = useNow();
 * return <span>{now.toLocaleTimeString()}</span>;
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id = 0;
    /**
     * Arms a timeout for the next second boundary that updates `now` and re-arms itself.
     *
     * Stores the timeout id in the effect's `id` variable so the cleanup can cancel the
     * currently pending timeout.
     *
     * @returns {void}
     *
     * @example
     * schedule();
     */
    const schedule = () => {
      id = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 1000 - (Date.now() % 1000) + 8);
    };
    schedule();
    return () => clearTimeout(id);
  }, []);
  return now;
}

/** Physical screen and browser viewport metrics. */
export interface ScreenInfo {
  /** Screen width in CSS pixels. */
  screenW: number;
  /** Screen height in CSS pixels. */
  screenH: number;
  /** Viewport (window inner) width in CSS pixels. */
  viewW: number;
  /** Viewport (window inner) height in CSS pixels. */
  viewH: number;
  /** Device pixel ratio (1 when the browser does not report one). */
  dpr: number;
}

/**
 * Reads the current screen and viewport metrics from the browser.
 *
 * Combines `screen.width/height`, `window.innerWidth/innerHeight` and `window.devicePixelRatio`
 * (falling back to 1) into a fresh `ScreenInfo` object.
 *
 * @returns {ScreenInfo} A snapshot of the current metrics.
 *
 * @example
 * const { screenW, dpr } = readScreen();
 */
function readScreen(): ScreenInfo {
  return { screenW: screen.width, screenH: screen.height, viewW: window.innerWidth, viewH: window.innerHeight, dpr: window.devicePixelRatio || 1 };
}

/**
 * Returns the real screen and viewport metrics, kept up to date on resize and zoom.
 *
 * Listens to the window `resize` event (which also fires when the page zoom, and therefore the
 * device pixel ratio, changes) and re-reads the metrics. The previous object is kept when no
 * value changed, so consumers do not re-render needlessly.
 *
 * @returns {ScreenInfo} The current screen and viewport metrics.
 *
 * @example
 * const { viewW, viewH, dpr } = useScreenInfo();
 * const resolution = `${viewW * dpr} × ${viewH * dpr}`;
 */
export function useScreenInfo(): ScreenInfo {
  const [info, setInfo] = useState(readScreen);
  useEffect(() => {
    /**
     * Re-reads the screen metrics and stores them only if any field differs.
     *
     * Compares every `ScreenInfo` field of the fresh snapshot with the stored one and returns the
     * previous object from the state updater when nothing changed, so React bails out of the
     * re-render.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('resize', update);
     */
    const update = () => setInfo((prev) => {
      const next = readScreen();
      return prev.screenW === next.screenW && prev.screenH === next.screenH && prev.viewW === next.viewW && prev.viewH === next.viewH && prev.dpr === next.dpr ? prev : next;
    });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return info;
}

/**
 * Returns the storage breakdown of the virtual file system.
 *
 * Subscribes to the FS node map and recomputes the per-category totals with `computeStorage`
 * whenever any node changes.
 *
 * @returns {StorageStats} Byte totals per storage category for the whole virtual FS.
 *
 * @example
 * const stats = useFSStorage();
 * console.log(stats.total);
 */
export function useFSStorage(): StorageStats {
  const nodes = useFS((s) => s.nodes);
  return useMemo(() => computeStorage(Object.values(nodes), fileSizeOf), [nodes]);
}

/** Origin storage usage as reported by the browser's StorageManager. */
export interface BrowserStorage {
  /** Bytes used by this origin. */
  usage: number;
  /** Bytes available to this origin. */
  quota: number;
  /** Whether storage is persistent (exempt from eviction), or `null` when unknown. */
  persisted: boolean | null;
}

/**
 * Returns the browser's storage estimate for this origin, with a manual refresh.
 *
 * Calls `navigator.storage.estimate()` and `navigator.storage.persisted()` and stores the
 * combined result. It re-measures whenever the virtual FS changes, waiting 500ms first because
 * the FS persists to IndexedDB with a short debounce and the estimate should include that write;
 * calling `refresh` forces another measurement. Results that arrive after unmount (or after a
 * newer measurement started) are discarded, and errors are ignored. `data` stays `null` when the
 * StorageManager API is unavailable.
 *
 * @returns {{ data: BrowserStorage | null; refresh: () => void }} The latest estimate (or `null`
 *   before the first measurement / when unsupported) and a function that triggers a re-read.
 *
 * @example
 * const { data, refresh } = useBrowserStorage();
 * if (data) console.log(`${data.usage} of ${data.quota} bytes`);
 */
export function useBrowserStorage(): { data: BrowserStorage | null; refresh: () => void } {
  const nodes = useFS((s) => s.nodes);
  const [data, setData] = useState<BrowserStorage | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const storage = navigator.storage;
    if (!storage?.estimate) return;
    let alive = true;
    const id = window.setTimeout(() => {
      Promise.all([storage.estimate(), storage.persisted ? storage.persisted() : Promise.resolve(null)])
        .then(([est, persisted]) => {
          if (alive) setData({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
        })
        .catch(() => {});
    }, 500);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [nodes, tick]);
  return { data, refresh: () => setTick((n) => n + 1) };
}

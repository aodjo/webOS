/**
 * Real measurements from the browser, used by Activity Monitor: frame rate, main-thread long
 * tasks, writes to the virtual FS (attributed to the active app), bytes transferred by the page,
 * battery, storage quota and network connection info.
 *
 * The monitor is reference-counted: it only runs while an Activity Monitor window is open.
 */
import { useEffect, useState } from 'react';
import { fileSizeOf, useFS, useWM, type FSNode } from '@/kernel';

/* ───────────────────────── Non-standard browser APIs ───────────────────────── */

/** Subset of the Battery Status API object returned by `navigator.getBattery()`. */
interface BatteryManager extends EventTarget {
  charging: boolean;
  level: number;
  chargingTime: number;
  dischargingTime: number;
}

/** Subset of the Network Information API exposed as `navigator.connection`. */
interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
}

/** `Navigator` extended with the optional, non-standard APIs read by this module. */
type NavigatorExtras = Navigator & {
  getBattery?: () => Promise<BatteryManager>;
  connection?: NetworkInformation;
  deviceMemory?: number;
};

/** JavaScript heap usage, in bytes. */
export interface HeapInfo {
  /** Heap currently in use. */
  used: number;
  /** Heap currently allocated. */
  total: number;
  /** Maximum heap size the engine allows. */
  limit: number;
}

/**
 * Reads the JavaScript heap usage of the page.
 *
 * Uses the non-standard `performance.memory` object (Chromium only). Browsers without it
 * yield null.
 *
 * @returns {HeapInfo | null} Used, allocated and maximum heap size in bytes, or null when unavailable.
 *
 * @example
 * const heap = readHeap();
 * if (heap) console.log(heap.used / heap.limit); // e.g. 0.012
 */
export function readHeap(): HeapInfo | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return mem ? { used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapSizeLimit } : null;
}

/**
 * Returns the approximate device RAM reported by the browser.
 *
 * Reads the non-standard `navigator.deviceMemory` (Chromium), which is a coarse, capped value
 * in gigabytes.
 *
 * @returns {number | null} Device memory in GB, or null when the browser does not expose it.
 *
 * @example
 * deviceMemoryGB(); // 8
 */
export const deviceMemoryGB = (): number | null => (navigator as NavigatorExtras).deviceMemory ?? null;

/**
 * Returns the number of logical CPU cores.
 *
 * Uses `navigator.hardwareConcurrency`, falling back to 4 when it is missing or 0, and never
 * returns less than 1.
 *
 * @returns {number} Logical core count (at least 1).
 *
 * @example
 * const perCore = totalCpu / cpuCores();
 */
export const cpuCores = (): number => Math.max(1, navigator.hardwareConcurrency || 4);

/* ───────────────────────── Monitor ───────────────────────── */

/**
 * Estimates the storage footprint of a virtual FS node.
 *
 * Directories count as one 4 KiB block; files count their content size with a 4 KiB minimum,
 * mimicking block-based disk accounting.
 *
 * @param {FSNode} n - The file or directory node.
 * @returns {number} Estimated size in bytes (at least 4096).
 *
 * @example
 * nodeBytes(useFS.getState().nodes['/Users/me/notes.txt']); // 4096 for a small file
 */
function nodeBytes(n: FSNode): number {
  return n.type === 'dir' ? 4096 : Math.max(4096, fileSizeOf(n));
}

/**
 * Reference-counted collector of live browser metrics.
 *
 * While at least one consumer holds a reference it tracks the frame rate, long-task time,
 * virtual FS writes per app and network transfer; the cumulative counters keep growing across
 * start/stop cycles.
 *
 * @example
 * const m = new Monitor();
 * m.start();
 * console.log(m.fps, m.busyMs);
 */
class Monitor {
  private refs = 0;
  private raf = 0;
  private frames = 0;
  private frameWindowStart = 0;
  private observers: PerformanceObserver[] = [];
  private unsubFS: (() => void) | null = null;
  /**
   * When observation last stopped. Observers replay buffered entries on every start; entries that
   * finished before this were already counted during an earlier session.
   */
  private stoppedAt = -Infinity;

  /** Frames per second measured over the last full second (0 while stopped). */
  fps = 0;
  /** Cumulative long-task time (ms). */
  busyMs = 0;
  /** FS store updates while monitoring. */
  fsWrites = 0;
  /** Estimated bytes written to the virtual FS, keyed by the app that was active at the time. */
  fsBytesByApp: Record<string, number> = {};
  /** Estimated total bytes written to the virtual FS. */
  fsBytes = 0;
  /** Bytes transferred by all resource requests of the page. */
  netBytes = 0;
  /** Number of resource requests made by the page. */
  netRequests = 0;
  /** Bytes transferred by iframe requests (Safari tabs). */
  frameBytes = 0;
  /** Number of iframe requests (Safari tabs). */
  frameRequests = 0;

  /**
   * Starts collecting metrics, or adds a reference when already running.
   *
   * Only the first reference installs anything: a requestAnimationFrame loop that updates
   * `fps` about once per second, PerformanceObservers for `longtask` entries (summed into
   * `busyMs`) and `resource` entries (summed into `netBytes` / `netRequests`, and also into
   * `frameBytes` / `frameRequests` for iframes), and a subscription to the FS store that
   * estimates the bytes of every changed or removed node and attributes them to the active app.
   * Buffered entries that ended before the last `stop()` are skipped. Cross-origin responses
   * without Timing-Allow-Origin report 0 bytes, so those are estimated (180 kB per iframe,
   * 2 kB per other resource).
   *
   * @returns {void} Nothing.
   *
   * @example
   * monitor.start();
   * // ...read monitor.fps, monitor.busyMs, monitor.netBytes...
   * monitor.stop();
   */
  start(): void {
    if (this.refs++ > 0) return;
    this.frameWindowStart = performance.now();
    /**
     * Counts one animation frame and refreshes the frame-rate estimate.
     *
     * Once at least one second has passed since the current measurement window began, stores
     * the rounded frames per second in `fps` and starts a new window. Always schedules itself
     * for the next frame.
     *
     * @param {number} now - High-resolution frame timestamp from requestAnimationFrame.
     * @returns {void} Nothing.
     *
     * @example
     * this.raf = requestAnimationFrame(tick);
     */
    const tick = (now: number) => {
      this.frames++;
      const elapsed = now - this.frameWindowStart;
      if (elapsed >= 1000) {
        this.fps = Math.round((this.frames * 1000) / elapsed);
        this.frames = 0;
        this.frameWindowStart = now;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);

    /**
     * Tells whether a performance entry has not been counted by an earlier session.
     *
     * Buffered entries are replayed on every start; those that finished at or before
     * `stoppedAt` were already counted and are ignored.
     *
     * @param {PerformanceEntry} e - The entry to check.
     * @returns {boolean} True when the entry ended after the last stop.
     *
     * @example
     * if (fresh(entry)) this.busyMs += entry.duration;
     */
    const fresh = (e: PerformanceEntry) => e.startTime + e.duration > this.stoppedAt;
    this.observe('longtask', (list) => {
      for (const e of list.getEntries()) if (fresh(e)) this.busyMs += e.duration;
    });
    this.observe('resource', (list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (!fresh(e)) continue;
        const bytes = e.transferSize || e.encodedBodySize || (e.initiatorType === 'iframe' ? 180_000 : 2_000);
        this.netBytes += bytes;
        this.netRequests++;
        if (e.initiatorType === 'iframe') {
          this.frameBytes += bytes;
          this.frameRequests++;
        }
      }
    });

    this.unsubFS = useFS.subscribe((state, prev) => {
      if (state.nodes === prev.nodes) return;
      let bytes = 0;
      for (const k in state.nodes) if (state.nodes[k] !== prev.nodes[k]) bytes += nodeBytes(state.nodes[k]);
      for (const k in prev.nodes) if (!(k in state.nodes)) bytes += 4096;
      const app = useWM.getState().activeAppId;
      this.fsWrites++;
      this.fsBytes += bytes;
      this.fsBytesByApp = { ...this.fsBytesByApp, [app]: (this.fsBytesByApp[app] ?? 0) + bytes };
    });
  }

  /**
   * Releases one reference and stops collecting when none remain.
   *
   * On the last release it cancels the frame loop, disconnects every observer, unsubscribes
   * from the FS store, records the stop time in `stoppedAt` and resets `fps` to 0. Cumulative
   * counters keep their values.
   *
   * @returns {void} Nothing.
   *
   * @example
   * useEffect(() => {
   *   monitor.start();
   *   return () => monitor.stop();
   * }, []);
   */
  stop(): void {
    if (--this.refs > 0) return;
    cancelAnimationFrame(this.raf);
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    this.unsubFS?.();
    this.unsubFS = null;
    this.stoppedAt = performance.now();
    this.fps = 0;
  }

  /**
   * Registers a buffered PerformanceObserver for one entry type when the browser supports it.
   *
   * Does nothing when PerformanceObserver is missing or the type is not listed in
   * `supportedEntryTypes`; errors raised while observing are swallowed. Created observers are
   * kept so `stop()` can disconnect them.
   *
   * @param {string} type - Performance entry type, e.g. 'longtask' or 'resource'.
   * @param {PerformanceObserverCallback} cb - Called with each batch of observed entries.
   * @returns {void} Nothing.
   *
   * @example
   * this.observe('longtask', (list) => console.log(list.getEntries().length));
   */
  private observe(type: string, cb: PerformanceObserverCallback): void {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    try {
      const o = new PerformanceObserver(cb);
      o.observe({ type, buffered: true });
      this.observers.push(o);
    } catch {
      /* unsupported entry type */
    }
  }
}

export const monitor = new Monitor(); /** Shared metrics collector; each Activity Monitor window holds one reference while mounted. */

/* ───────────────────────── Hooks ───────────────────────── */

/** Battery status snapshot (Battery Status API semantics). */
export interface BatteryInfo {
  /** Charge level from 0 to 1. */
  level: number;
  charging: boolean;
  /** Seconds until fully charged (Infinity when unknown or not charging). */
  chargingTime: number;
  /** Seconds until empty (Infinity when unknown or charging). */
  dischargingTime: number;
}

/**
 * Reads the device battery status and keeps it up to date.
 *
 * Uses the non-standard `navigator.getBattery()` (Chromium). The value is undefined while the
 * battery manager is loading, null when the API is missing or the request fails, and otherwise
 * a snapshot refreshed on every level, charging and time change event. Listeners are removed
 * and late results are ignored after unmount.
 *
 * @returns {BatteryInfo | null | undefined} Battery snapshot, null when unavailable, or undefined while loading.
 *
 * @example
 * const battery = useBattery();
 * if (battery) console.log(`${Math.round(battery.level * 100)}%`); // "87%"
 */
export function useBattery(): BatteryInfo | null | undefined {
  const [info, setInfo] = useState<BatteryInfo | null | undefined>(undefined);
  useEffect(() => {
    const nav = navigator as NavigatorExtras;
    if (!nav.getBattery) {
      setInfo(null);
      return;
    }
    let battery: BatteryManager | null = null;
    let cancelled = false;
    /**
     * Copies the battery manager's current state into React state.
     *
     * Does nothing until the battery manager has resolved.
     *
     * @returns {void | null} Nothing; null when the battery manager is not available yet.
     *
     * @example
     * b.addEventListener('levelchange', update);
     */
    const update = () => battery && setInfo({ level: battery.level, charging: battery.charging, chargingTime: battery.chargingTime, dischargingTime: battery.dischargingTime });
    const events = ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'];
    nav
      .getBattery()
      .then((b) => {
        if (cancelled) return;
        battery = b;
        update();
        for (const ev of events) b.addEventListener(ev, update);
      })
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
      if (battery) for (const ev of events) battery.removeEventListener(ev, update);
    };
  }, []);
  return info;
}

/** Online state plus the optional Network Information API fields. */
export interface ConnectionInfo {
  online: boolean;
  /** Effective connection class, e.g. '4g'. */
  effectiveType?: string;
  /** Estimated downlink bandwidth in Mbps. */
  downlink?: number;
  /** Estimated round-trip time in ms. */
  rtt?: number;
  saveData?: boolean;
  type?: string;
}

/**
 * Tracks the browser's network connection state.
 *
 * Combines `navigator.onLine` with the non-standard `navigator.connection` and re-reads both on
 * the window `online` / `offline` events and on the connection's `change` event. Fields the
 * browser does not expose stay undefined.
 *
 * @returns {ConnectionInfo} The current connection snapshot.
 *
 * @example
 * const { online, rtt } = useConnection();
 * console.log(online ? `${rtt} ms` : 'Offline');
 */
export function useConnection(): ConnectionInfo {
  /**
   * Builds a connection snapshot from the navigator.
   *
   * Reads `navigator.onLine` and copies the Network Information fields from
   * `navigator.connection`; each field is undefined when the browser does not expose it.
   *
   * @returns {ConnectionInfo} Online flag plus whatever Network Information fields exist.
   *
   * @example
   * const [info, setInfo] = useState(read);
   */
  const read = (): ConnectionInfo => {
    const c = (navigator as NavigatorExtras).connection;
    return { online: navigator.onLine, effectiveType: c?.effectiveType, downlink: c?.downlink, rtt: c?.rtt, saveData: c?.saveData, type: c?.type };
  };
  const [info, setInfo] = useState(read);
  useEffect(() => {
    /**
     * Stores a fresh connection snapshot in state.
     *
     * Registered for the window `online` / `offline` events and the connection's `change`
     * event, and re-reads the whole snapshot each time.
     *
     * @returns {void} Nothing.
     *
     * @example
     * window.addEventListener('online', update);
     */
    const update = () => setInfo(read());
    const c = (navigator as NavigatorExtras).connection;
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    c?.addEventListener('change', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      c?.removeEventListener('change', update);
    };
  }, []);
  return info;
}

/** Origin storage usage and quota, in bytes. */
export interface StorageInfo {
  usage: number;
  quota: number;
}

/**
 * Polls the origin's storage usage and quota.
 *
 * Calls `navigator.storage.estimate()` immediately and then every `everyMs` milliseconds. The
 * value is undefined until the first estimate arrives, and null when the API is missing or an
 * estimate fails. The interval restarts when `everyMs` changes and is cleared on unmount.
 *
 * @param {number} [everyMs=10000] - Polling interval in milliseconds.
 * @returns {StorageInfo | null | undefined} Usage and quota, null when unavailable, or undefined while loading.
 *
 * @example
 * const storage = useStorageEstimate(5000);
 * if (storage) console.log(storage.usage / storage.quota);
 */
export function useStorageEstimate(everyMs = 10_000): StorageInfo | null | undefined {
  const [info, setInfo] = useState<StorageInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!navigator.storage?.estimate) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    /**
     * Requests one storage estimate and stores it unless the effect was cleaned up.
     *
     * Failures store null instead of rejecting.
     *
     * @returns {Promise<false | void>} Settles once the estimate has been handled.
     *
     * @example
     * const id = setInterval(load, everyMs);
     */
    const load = () =>
      navigator.storage
        .estimate()
        .then((e) => !cancelled && setInfo({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
        .catch(() => !cancelled && setInfo(null));
    void load();
    const id = setInterval(load, everyMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [everyMs]);
  return info;
}

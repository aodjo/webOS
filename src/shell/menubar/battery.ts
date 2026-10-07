/**
 * Real battery state from the Battery Status API (Chromium), with a plausible "on AC, 100%"
 * fallback for browsers that don't expose it.
 */
import { useEffect, useState } from 'react';

/** The subset of the Battery Status API's `BatteryManager` used here. */
interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

/** `Navigator` with the optional, Chromium-only `getBattery()` method. */
type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

/** Battery state exposed to the menu bar and Control Center. */
export interface BatteryState {
  /** False when the API is unavailable and the values are the fallback. */
  supported: boolean;
  /** Charge level from 0 (empty) to 1 (full). */
  level: number;
  /** True while the device is plugged in. */
  charging: boolean;
  /** Seconds until full (0 when full, Infinity when unknown). */
  chargingTime: number;
  /** Seconds until empty (Infinity when charging/unknown). */
  dischargingTime: number;
}

const FALLBACK: BatteryState = { supported: false, level: 1, charging: true, chargingTime: 0, dischargingTime: Infinity }; /** State reported when the Battery Status API is unavailable: fully charged and plugged in. */
const EVENTS = ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'] as const; /** BatteryManager events that trigger a state refresh. */

/**
 * Tracks the device's battery state.
 *
 * Starts with `FALLBACK` and, when `navigator.getBattery()` exists, replaces it with the real
 * values and re-reads them on every `EVENTS` change. If the API is missing or `getBattery()`
 * rejects (e.g. because of a permissions policy), the fallback stays. Listeners are removed on
 * unmount, and a manager resolved after unmount is ignored.
 *
 * @returns {BatteryState} The current battery state.
 *
 * @example
 * const { level, charging, supported } = useBattery();
 */
export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>(FALLBACK);
  useEffect(() => {
    const nav = typeof navigator !== 'undefined' ? (navigator as NavigatorWithBattery) : null;
    if (!nav || typeof nav.getBattery !== 'function') return;
    let bm: BatteryManagerLike | null = null;
    let cancelled = false;
    /**
     * Copies the battery manager's current values into state.
     *
     * Does nothing until the manager has been resolved. Used both for the initial read and as
     * the listener for every battery event.
     *
     * @returns {void}
     *
     * @example
     * b.addEventListener('levelchange', read);
     */
    const read = () => {
      if (!bm) return;
      setState({ supported: true, level: bm.level, charging: bm.charging, chargingTime: bm.chargingTime, dischargingTime: bm.dischargingTime });
    };
    nav
      .getBattery()
      .then((b) => {
        if (cancelled) return;
        bm = b;
        read();
        for (const ev of EVENTS) b.addEventListener(ev, read);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (bm) for (const ev of EVENTS) bm.removeEventListener(ev, read);
    };
  }, []);
  return state;
}

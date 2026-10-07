/**
 * Remembers which power state the system came from, so transitional screens (sleep, restart,
 * shut down) can tell whether they started at the login window or inside a user session.
 *
 * Example: sleeping from the login window must wake back to the login window — not to the lock
 * screen, which would skip the session start-up.
 */
import { useSystem } from '@/kernel/system';
import type { PowerState } from '@/kernel/types';

let current: PowerState = useSystem.getState().power; /** The power state the system is in now. */
let origin: PowerState = current; /** The power state the system was in before `current`. */

/* On every power state change, the previous state becomes the origin. */
useSystem.subscribe((s) => {
  if (s.power === current) return;
  origin = current;
  current = s.power;
});

/**
 * Returns the power state the system was in before the current one.
 *
 * Tracked by a module-level subscription to the system store, so it is valid from the first
 * transition after this module loads.
 *
 * @returns {PowerState} The previous power state.
 *
 * @example
 * if (powerOrigin() === 'desktop') console.log('came from a session');
 */
export function powerOrigin(): PowerState {
  return origin;
}

/**
 * Tells whether the current (transitional) state was entered from outside a user session.
 *
 * True when the previous state was the login window, off or booting.
 *
 * @returns {boolean} True when no user session was running before the current state.
 *
 * @example
 * const [atLogin] = useState(startedOutsideSession);
 */
export function startedOutsideSession(): boolean {
  return origin === 'login' || origin === 'off' || origin === 'booting';
}

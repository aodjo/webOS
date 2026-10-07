/**
 * System Settings state that is not part of the kernel `Settings` (simulated hardware such as
 * Wi-Fi networks and Bluetooth devices, plus a few per-viewer preferences). Persisted to
 * localStorage so it survives reloads like the rest of the OS.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { owner } from '@/data/portfolio';

/** When notification previews are shown: always, only while unlocked, or never. */
export type NotificationPreviews = 'always' | 'unlocked' | 'never';

/** Persisted System Settings preferences. */
export interface SettingsPrefs {
  /** Last pane shown, reopened the next time System Settings launches. */
  lastPane: string;
  /** SSID of the joined Wi-Fi network (null = not connected). */
  wifiNetwork: string | null;
  /** SSIDs of remembered networks, joined without asking for a password again. */
  knownNetworks: string[];
  /** Bluetooth device id → connected. */
  btConnected: Record<string, boolean>;
  /** Show suggested and recent apps in the Dock. */
  showRecentApps: boolean;
  /** Key of `REQUIRE_PASSWORD_DELAYS` used when the display wakes. */
  requirePasswordAfter: string;
  /** When notification previews are shown. */
  notificationPreviews: NotificationPreviews;
  /** Allow notifications while the lock screen is showing. */
  notifyOnLockScreen: boolean;
  /** Play the alert sound as feedback when the output volume changes. */
  volumeFeedback: boolean;
}

export const HOME_NETWORK = `${owner.handle}-5G`; /** SSID of the simulated home network, derived from the owner's handle. */

export const REQUIRE_PASSWORD_DELAYS: Record<string, number> = {
  immediately: 0,
  '5s': 5_000,
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
}; /** Grace period in ms per "Require password" option; waking within it skips the lock screen. */

export const DEFAULT_PREFS: SettingsPrefs = {
  lastPane: 'appearance',
  wifiNetwork: HOME_NETWORK,
  knownNetworks: [HOME_NETWORK],
  btConnected: { keyboard: true, airpods: false, mouse: false },
  showRecentApps: true,
  requirePasswordAfter: 'immediately',
  notificationPreviews: 'unlocked',
  notifyOnLockScreen: true,
  volumeFeedback: true,
}; /** Initial preferences, also restored by "Erase All Content and Settings". */

/** Preferences store shape: the persisted values plus the action that patches them. */
interface PrefsStore extends SettingsPrefs {
  /** Shallow-merges a partial update into the store. */
  setPrefs: (patch: Partial<SettingsPrefs>) => void;
}

export const usePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      /**
       * Merges a partial preferences update into the store.
       *
       * Delegates to zustand's `set`, which shallow-merges the patch; the persist middleware
       * then writes the new state to localStorage.
       *
       * @param {Partial<SettingsPrefs>} patch - Fields to overwrite.
       * @returns {void}
       *
       * @example
       * usePrefs.getState().setPrefs({ showRecentApps: false });
       */
      setPrefs: (patch) => set(patch),
    }),
    {
      name: 'webos.settings-app',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      /**
       * Selects the part of the store that is written to localStorage.
       *
       * Drops the `setPrefs` action so only plain preference values are serialized.
       *
       * @param {PrefsStore} state - The full store state.
       * @returns {SettingsPrefs} The preference values without the action.
       *
       * @example
       * const saved = usePrefs.persist.getOptions().partialize?.(usePrefs.getState());
       * // saved has every preference field but no `setPrefs`
       */
      partialize: ({ setPrefs: _setPrefs, ...rest }) => rest,
    },
  ),
); /** Zustand store holding the System Settings preferences, persisted under `webos.settings-app`. */

/**
 * Updates System Settings preferences from outside React.
 *
 * Convenience wrapper around the store's `setPrefs` action; the patch is shallow-merged
 * and persisted immediately.
 *
 * @param {Partial<SettingsPrefs>} patch - Fields to overwrite.
 * @returns {void}
 *
 * @example
 * setPrefs({ wifiNetwork: null });
 */
export const setPrefs = (patch: Partial<SettingsPrefs>) => usePrefs.getState().setPrefs(patch);

/**
 * Restores every System Settings preference to its default.
 *
 * Merges `DEFAULT_PREFS` over the current state with `setState`, so every preference value is
 * overwritten while the `setPrefs` action stays in place. Used by "Erase All Content and Settings".
 *
 * @returns {void}
 *
 * @example
 * resetPrefs();
 * usePrefs.getState().lastPane; // 'appearance'
 */
export function resetPrefs(): void {
  usePrefs.setState(DEFAULT_PREFS);
}

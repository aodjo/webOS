import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale, PowerState, Settings } from './types';
import { owner } from '@/data/portfolio';
import { DEFAULT_WALLPAPER } from './wallpapers';

/**
 * Detects the default locale from the browser language.
 *
 * Returns Korean when `navigator.language` starts with "ko" and English otherwise (including
 * when `navigator` is unavailable).
 *
 * @returns {Locale} The detected locale.
 *
 * @example
 * const locale = detectLocale(); // "ko" in a Korean browser
 */
const detectLocale = (): Locale =>
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';

export const DEFAULT_DOCK: string[] = [
  'finder',
  'launchpad',
  'safari',
  'mail',
  'notes',
  'about-me',
  'projects',
  'terminal',
  'textedit',
  'calculator',
  'settings',
]; /** App ids pinned to the Dock by default, in Dock order. */

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  accent: '#0a84ff',
  wallpaper: DEFAULT_WALLPAPER,
  dockSize: 52,
  dockMagnification: false,
  dockMagnifiedSize: 80,
  dockPosition: 'bottom',
  dockAutohide: false,
  dockPinned: DEFAULT_DOCK,
  locale: detectLocale(),
  brightness: 1,
  volume: 0.6,
  nightShift: false,
  wifi: true,
  bluetooth: true,
  doNotDisturb: false,
  reduceMotion: false,
  reduceTransparency: false,
  clock24h: false,
  showSeconds: false,
  showHiddenFiles: false,
  fullName: typeof owner.name === 'string' ? owner.name : owner.name.en,
  avatar: owner.avatar,
  password: '',
  passwordHint: '',
  startupSound: true,
  alertSound: 'boop',
  mutedApps: [],
  firstRun: true,
}; /** Factory settings; the locale follows the browser, the name and avatar come from the portfolio owner, and Dock magnification is off as on macOS. */

export const ACCENT_COLORS: { id: string; color: string; name: { en: string; ko: string } }[] = [
  { id: 'blue', color: '#0a84ff', name: { en: 'Blue', ko: '파란색' } },
  { id: 'purple', color: '#bf5af2', name: { en: 'Purple', ko: '보라색' } },
  { id: 'pink', color: '#ff375f', name: { en: 'Pink', ko: '분홍색' } },
  { id: 'red', color: '#ff453a', name: { en: 'Red', ko: '빨간색' } },
  { id: 'orange', color: '#ff9f0a', name: { en: 'Orange', ko: '주황색' } },
  { id: 'yellow', color: '#ffd60a', name: { en: 'Yellow', ko: '노란색' } },
  { id: 'green', color: '#30d158', name: { en: 'Green', ko: '초록색' } },
  { id: 'graphite', color: '#8e8e93', name: { en: 'Graphite', ko: '흑연색' } },
]; /** Accent colors offered in System Settings (macOS palette). */

interface SystemState {
  /** Current power/session state (booting, login, desktop, locked…). */
  power: PowerState;
  /** User settings; the only part of the state that is persisted. */
  settings: Settings;
  /** Whether the host prefers a dark color scheme (applies when the theme is 'auto'). */
  prefersDark: boolean;
  /** Millisecond timestamp of the current boot. */
  bootedAt: number;
  /** Millisecond timestamp of the current login (0 until the first login). */
  loggedInAt: number;

  setPower: (p: PowerState) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  setPrefersDark: (v: boolean) => void;
}

export const useSystem = create<SystemState>()(
  persist(
    (set) => ({
      power: 'booting',
      settings: DEFAULT_SETTINGS,
      prefersDark: typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
      bootedAt: Date.now(),
      loggedInAt: 0,

      /**
       * Changes the power state.
       *
       * Entering 'booting' records a new boot time; going from 'login' to 'desktop' records the
       * login time.
       *
       * @param {PowerState} power - The new power state.
       * @returns {void}
       *
       * @example
       * useSystem.getState().setPower('locked');
       */
      setPower: (power) =>
        set((s) => ({
          power,
          bootedAt: power === 'booting' ? Date.now() : s.bootedAt,
          loggedInAt: power === 'desktop' && s.power === 'login' ? Date.now() : s.loggedInAt,
        })),
      /**
       * Merges a partial update into the settings.
       *
       * Replaces the settings object with a shallow copy that has the given keys overwritten;
       * the persist middleware then saves it.
       *
       * @param {Partial<Settings>} patch - The settings to change.
       * @returns {void}
       *
       * @example
       * useSystem.getState().updateSettings({ theme: 'dark' });
       */
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      /**
       * Restores the default settings.
       *
       * The locale is detected again from the browser rather than taken from the defaults
       * computed at load time.
       *
       * @returns {void}
       *
       * @example
       * useSystem.getState().resetSettings();
       */
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS, locale: detectLocale() } }),
      /**
       * Records whether the host prefers a dark color scheme (used when the theme is 'auto').
       *
       * The shell calls it on startup and whenever the host's `prefers-color-scheme` media query
       * changes; the value is not persisted.
       *
       * @param {boolean} prefersDark - True if the host prefers dark mode.
       * @returns {void}
       *
       * @example
       * useSystem.getState().setPrefersDark(media.matches);
       */
      setPrefersDark: (prefersDark) => set({ prefersDark }),
    }),
    {
      name: 'webos.system',
      version: 3,
      /**
       * Selects the part of the state that is persisted.
       *
       * Only `settings` is stored; power state, boot/login times and the dark-mode preference are
       * recomputed on every load.
       *
       * @param {SystemState} s - The full state.
       * @returns {{ settings: Settings }} Only the settings.
       *
       * @example
       * partialize(useSystem.getState()); // { settings: {...} }
       */
      partialize: (s) => ({ settings: s.settings }),
      /**
       * Upgrades persisted state from an older storage version.
       *
       * Settings stored with a version below 2 get Dock magnification turned off, and the placeholder
       * display names ("Aodjo" / "아오드조") are replaced with the default full name. Below version 3
       * the former default wallpaper ("hallasan") is replaced with the current default. The persisted
       * object is modified in place.
       *
       * @param {unknown} persisted - The stored state.
       * @param {number} version - The storage version the state was written with.
       * @returns {SystemState} The upgraded state.
       *
       * @example
       * migrate({ settings: { dockMagnification: true } }, 1);
       */
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as { settings?: Partial<Settings> };
        if (version < 2 && p.settings) {
          p.settings.dockMagnification = false;
          if (p.settings.fullName === 'Aodjo' || p.settings.fullName === '아오드조') p.settings.fullName = DEFAULT_SETTINGS.fullName;
        }
        if (version < 3 && p.settings?.wallpaper === 'hallasan') p.settings.wallpaper = DEFAULT_WALLPAPER;
        return p as unknown as SystemState;
      },
      /**
       * Combines the stored state with the initial state on rehydration.
       *
       * Stored settings are layered over `DEFAULT_SETTINGS`, so settings missing from storage get
       * their default values; everything else comes from the current in-memory state.
       *
       * @param {unknown} persisted - The stored (migrated) state.
       * @param {SystemState} current - The current in-memory state.
       * @returns {SystemState} The merged state.
       *
       * @example
       * merge({ settings: { theme: 'dark' } }, useSystem.getState());
       */
      merge: (persisted, current) => {
        const p = persisted as Partial<SystemState> | undefined;
        return { ...current, settings: { ...DEFAULT_SETTINGS, ...(p?.settings ?? {}) } };
      },
    },
  ),
); /** System store: power state, settings (persisted in localStorage as "webos.system"), dark-mode preference and boot/login times. */

/**
 * React hook returning whether the UI is currently in dark mode.
 *
 * True when the theme is 'dark', or when it is 'auto' and the host prefers a dark color scheme.
 * Re-renders the component when either changes.
 *
 * @returns {boolean} True if dark mode is in effect.
 *
 * @example
 * const dark = useIsDark();
 */
export function useIsDark(): boolean {
  return useSystem((s) => s.settings.theme === 'dark' || (s.settings.theme === 'auto' && s.prefersDark));
}

/**
 * Returns whether the UI is currently in dark mode (non-React version of `useIsDark`).
 *
 * Reads the store once without subscribing.
 *
 * @returns {boolean} True if dark mode is in effect.
 *
 * @example
 * const color = isDark() ? '#fff' : '#000';
 */
export function isDark(): boolean {
  const s = useSystem.getState();
  return s.settings.theme === 'dark' || (s.settings.theme === 'auto' && s.prefersDark);
}

/* ───────────── Power actions ───────────── */

export const power = {
  /**
   * Locks the screen; apps keep running.
   *
   * Sets the power state to 'locked', which shows the lock screen over the running session.
   *
   * @returns {void}
   *
   * @example
   * power.lock();
   */
  lock: () => useSystem.getState().setPower('locked'),
  /**
   * Puts the computer to sleep.
   *
   * Shows a black screen; any input wakes it to the lock screen.
   *
   * @returns {void}
   *
   * @example
   * power.sleep();
   */
  sleep: () => useSystem.getState().setPower('sleep'),
  /**
   * Logs out: quits all apps and returns to the login window.
   *
   * Sets the power state to 'loggingOut'; after the fade-out the shell kills every process and
   * switches to 'login'.
   *
   * @returns {void}
   *
   * @example
   * power.logOut();
   */
  logOut: () => useSystem.getState().setPower('loggingOut'),
  /**
   * Restarts the computer (shutdown sequence followed by a new boot).
   *
   * Sets the power state to 'restarting'; after the fade-out the shell kills every process and
   * switches to 'booting'.
   *
   * @returns {void}
   *
   * @example
   * power.restart();
   */
  restart: () => useSystem.getState().setPower('restarting'),
  /**
   * Shuts the computer down.
   *
   * Sets the power state to 'shuttingDown'; after the fade-out the shell kills every process and
   * switches to 'off'.
   *
   * @returns {void}
   *
   * @example
   * power.shutDown();
   */
  shutDown: () => useSystem.getState().setPower('shuttingDown'),
  /**
   * Presses the power button while the computer is off, starting a new boot.
   *
   * Sets the power state to 'booting', which also records a new boot time.
   *
   * @returns {void}
   *
   * @example
   * power.powerOn();
   */
  powerOn: () => useSystem.getState().setPower('booting'),
}; /** Power actions used by the logo menu, the login screen, Settings and other apps; each one sets the matching power state, which the shell's power screens act on. */

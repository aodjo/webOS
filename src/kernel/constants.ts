/**
 * System-wide constants: the user account, well-known folder paths and shell layout metrics.
 */
import { owner, osInfo } from '@/data/portfolio';

export const USER = owner.handle; /** Short user name of the single account, taken from the portfolio owner's handle. */
export const HOME = `/Users/${USER}`; /** Absolute path of the user's home folder. */
export const HOSTNAME = `${USER}-${osInfo.machineShort}`; /** Machine host name used in the terminal prompt and shown in Settings. */

export const PATHS = {
  home: HOME,
  desktop: `${HOME}/Desktop`,
  documents: `${HOME}/Documents`,
  downloads: `${HOME}/Downloads`,
  pictures: `${HOME}/Pictures`,
  music: `${HOME}/Music`,
  projects: `${HOME}/Documents/Projects`,
  notes: `${HOME}/Documents/Notes`,
  trash: `${HOME}/.Trash`,
  applications: '/Applications',
} as const; /** Absolute paths of the well-known folders (home, Desktop, Trash, the folders backing Notes and Projects, …). */

export const MENU_BAR_HEIGHT = 26; /** Height of the menu bar in px. */
export const DOCK_MARGIN = 6; /** Gap between the dock and the screen edge in px. */
export const DOCK_PADDING = 8; /** Extra padding inside the dock around icons in px. */

export const COMPACT_BREAKPOINT = 768; /** Viewport width in px below which windows open full-screen (phones). */
export const COMPACT_HEIGHT_BREAKPOINT = 500; /** Viewport height in px below which the layout is compact too (phone landscape). */

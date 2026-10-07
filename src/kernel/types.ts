/**
 * Shared kernel types: localized strings, file system nodes, app manifests, windows, menus,
 * power states, settings and notifications.
 */
import type { ComponentType, LazyExoticComponent } from 'react';

/* ───────────────────────── i18n ───────────────────────── */

/** A supported UI language. */
export type Locale = 'en' | 'ko';
/** A user-facing string. Either a plain string (same in all locales) or a per-locale record. */
export type LString = string | { en: string; ko: string };

/* ───────────────────────── File system ───────────────────────── */

/** Kind of a file system node. */
export type FSNodeType = 'file' | 'dir';

/** Optional per-node metadata stored alongside a file system node. */
export interface FSNodeMeta {
  /** Desktop icon position (only meaningful for children of ~/Desktop). */
  x?: number;
  y?: number;
  /** Original location of an item that was moved to the Trash. */
  trashedFrom?: string;
  /** Desktop cell an item had before it was trashed (restored by Put Back). */
  trashedCell?: { x: number; y: number };
  /** System items cannot be renamed / deleted / moved. */
  locked?: boolean;
  /** Finder color tag. */
  tag?: string;
  /** Pinned note (Notes app). */
  pinned?: boolean;
  /** Hidden from Finder unless "show hidden files" (dotfiles are hidden automatically). */
  hidden?: boolean;
  /** Per-file "Open with" app id chosen in Get Info (overrides the default handler). */
  openWith?: string;
}

/** A file or folder in the virtual file system. */
export interface FSNode {
  /** Absolute normalized path, e.g. "/Users/aodjo/Desktop/Notes.txt". Root is "/". */
  path: string;
  name: string;
  type: FSNodeType;
  /** Text content for text files. */
  content?: string;
  /**
   * For binary/url-backed files (images, pdf…): a data: URL, a public asset path
   * ("/wallpapers/x.svg") or an http(s) URL.
   */
  src?: string;
  /** Size in bytes for src-backed files (text files compute size from content). */
  bytes?: number;
  mime?: string;
  createdAt: number;
  modifiedAt: number;
  meta?: FSNodeMeta;
}

/** POSIX-style error codes carried by file system errors. */
export type FSErrorCode = 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EPERM' | 'EINVAL';

/* ───────────────────────── Apps & windows ───────────────────────── */

/** Arguments a window is opened with. */
export interface AppArgs {
  /** File or folder path to open. */
  path?: string;
  /** Arbitrary app-specific data. */
  [key: string]: unknown;
}

/** A screen rectangle in px. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default size and chrome of an app's windows. */
export interface WindowOptions {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  /** Defaults to true. */
  resizable?: boolean;
  /** Defaults to true. Zoom (green) button enabled. */
  maximizable?: boolean;
  /**
   * 'standard'  – 28px titlebar with centered title, content below.
   * 'overlay'   – traffic lights float over the top-left of the content; the app draws its own
   *               toolbar (unified toolbar look). Mark draggable areas with `data-drag-region`
   *               and leave ~80px of left padding for the traffic lights.
   */
  titlebar?: 'standard' | 'overlay';
  /**
   * Window background is translucent (vibrancy). App content should be transparent where it
   * wants the blur.
   */
  vibrancy?: boolean;
}

/** Props passed to an app's window component. */
export interface AppProps {
  windowId: string;
  pid: number;
  args: AppArgs;
}

/** Group an app is listed under. */
export type AppCategory = 'system' | 'portfolio' | 'utility' | 'game';

/** Static description of an app, registered with the kernel. */
export interface AppManifest {
  id: string;
  name: LString;
  description?: LString;
  /** Squircle app icon (macOS Big Sur+ style). Must render a square of `size` px. */
  icon: ComponentType<{ size: number }>;
  /** Lazy-loaded window content. Omitted for pseudo apps that only use `onLaunch`. */
  component?: LazyExoticComponent<ComponentType<AppProps>> | ComponentType<AppProps>;
  window?: WindowOptions;
  /** Re-launching focuses the existing window instead of opening a new one. */
  singleWindow?: boolean;
  /** File extensions (lowercase, no dot) this app opens. Use 'dir' for folders. */
  opens?: string[];
  category?: AppCategory;
  /** Not shown in Launchpad / Spotlight / /Applications. */
  hidden?: boolean;
  /** Cannot be quit (Finder). */
  persistent?: boolean;
  /** Pseudo apps (e.g. Launchpad) run this instead of opening a window. */
  onLaunch?: () => void;
  /** Bundle identifier shown in Activity Monitor / Get Info. */
  bundleId?: string;
  version?: string;
}

/** Live state of one window managed by the window manager. */
export interface WindowState {
  id: string;
  pid: number;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable: boolean;
  maximizable: boolean;
  titlebar: 'standard' | 'overlay';
  vibrancy: boolean;
  minimized: boolean;
  maximized: boolean;
  tiled: 'left' | 'right' | null;
  /** Bounds to go back to after un-maximizing / un-tiling. */
  restoreBounds: Bounds | null;
  z: number;
  args: AppArgs;
  /**
   * Unsaved changes: shows a dot in the close button and "Edited" after the title. Log out,
   * restart and shut down close dirty windows first so their before-close handlers can ask.
   */
  dirty: boolean;
  createdAt: number;
  /**
   * Incremented every time args are replaced so apps can react (e.g. a singleWindow app asked
   * to open another file).
   */
  argsVersion: number;
  /**
   * True while the title is the app's localized name as set by `openWindow`. Such titles follow
   * UI language changes; `wm.setTitle` clears the flag.
   */
  defaultTitle?: boolean;
  /**
   * Maximized by the window manager (not by the user) because the screen was too small for the
   * window (compact viewport, or a fixed-size window larger than the workspace). Such windows go
   * back to `restoreBounds` once the screen is big enough again.
   */
  autoMaximized?: boolean;
}

/** A running app. There is at most one process per app. */
export interface Process {
  pid: number;
  appId: string;
  startedAt: number;
  hidden: boolean;
}

/* ───────────────────────── Menus ───────────────────────── */

/** One entry of a menu (command, separator or submenu). */
export interface MenuItem {
  label?: LString;
  /**
   * Keyboard shortcut, e.g. "mod+s", "mod+shift+n", "alt+w", "mod+backspace", "f3".
   * "mod" is ⌘ on macOS hosts and Ctrl elsewhere. The global keyboard handler triggers the
   * action of the focused window's menu item that matches.
   */
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
  /** Optional leading icon (rendered small). */
  icon?: ComponentType<{ size?: number; className?: string }>;
  danger?: boolean;
}

/** A top-level menu-bar menu contributed by an app. */
export interface MenuDef {
  label: LString;
  items: MenuItem[];
  /**
   * 'file': this menu takes the place of the File menu (first after the app menu) and no default
   * File menu is added — e.g. Terminal's "Shell" menu.
   */
  role?: 'file';
}

/* ───────────────────────── System ───────────────────────── */

/** Phase of the simulated machine's power / session lifecycle. */
export type PowerState =
  | 'off'
  | 'booting'
  | 'login'
  | 'desktop'
  | 'locked'
  | 'sleep'
  | 'shuttingDown'
  | 'restarting'
  | 'loggingOut';

/** Appearance setting; 'auto' follows the host's color scheme. */
export type ThemeSetting = 'light' | 'dark' | 'auto';
/** Screen edge the Dock is attached to. */
export type DockPosition = 'bottom' | 'left' | 'right';

/** Persisted user preferences (System Settings). */
export interface Settings {
  theme: ThemeSetting;
  accent: string;
  /** Wallpaper: a wallpaper id from the built-in list or an absolute FS path to an image. */
  wallpaper: string;
  dockSize: number;
  dockMagnification: boolean;
  dockMagnifiedSize: number;
  dockPosition: DockPosition;
  dockAutohide: boolean;
  /** App ids pinned to the Dock (order matters). */
  dockPinned: string[];
  locale: Locale;
  /** Display brightness, from 0.3 to 1. */
  brightness: number;
  /** Output volume, from 0 to 1. */
  volume: number;
  nightShift: boolean;
  wifi: boolean;
  bluetooth: boolean;
  doNotDisturb: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  clock24h: boolean;
  showSeconds: boolean;
  showHiddenFiles: boolean;
  fullName: string;
  /** Avatar image path (public asset or FS path). */
  avatar: string;
  /** Empty string = no password. */
  password: string;
  /** Shown on the login screen after a wrong password. Empty = no hint. */
  passwordHint: string;
  /** Play the startup chime when booting. */
  startupSound: boolean;
  /** Id of the alert sound chosen in System Settings → Sound. */
  alertSound: string;
  /** App ids whose notification banners are turned off (System Settings → Notifications). */
  mutedApps: string[];
  /** Show the Welcome window on next login. */
  firstRun: boolean;
}

/** A notification posted by an app (banner + Notification Center entry). */
export interface Notification {
  id: string;
  appId: string;
  title: LString;
  body?: LString;
  createdAt: number;
  read: boolean;
  /** Called when the banner/notification is clicked. */
  onClick?: () => void;
}

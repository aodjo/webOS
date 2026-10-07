/**
 * Kernel public API. Apps and shell components import from '@/kernel'.
 */
export * from './types';
export * from './constants';
export * from './path';
export { fs, FSError, useFS, useNode, useDir, useTrashCount, whenFSReady, onBeforePersist, isPersistenceAvailable, kindOf, isTextFile, mimeFor, sortNodes, fileSizeOf } from './fs';
export type { FileKind, SortKey } from './fs';
export { wm, useWM, getWorkspace, isCompact, selectFocusedWindow, selectIsRunning } from './wm';
export { getApp, listApps, defaultAppFor, appsThatOpen, registerApps } from './registry';
export { useSystem, useIsDark, isDark, power, DEFAULT_SETTINGS, ACCENT_COLORS, DEFAULT_DOCK } from './system';
export { tr, t, useT, useLocale, fmt, formatBytes, formatDate, localizePeriod, COMMON } from './i18n';
export { useUI, showContextMenu, closeContextMenu, dockAnchors, useBadges, setDockBadge, keyboardBusy } from './ui';
export { useMenus, setWindowMenus, formatShortcut, matchShortcut, eventToShortcut, findShortcutItem, isMacHost } from './menus';
export { notify, useNotifications, dismissBanner, removeNotification, clearNotifications, markAllRead } from './notifications';
export { dialogs, useDialogs, dismissDialog } from './dialogs';
export type { DialogRequest, DialogButton, AlertRequest, PromptRequest, SavePanelRequest, OpenPanelRequest } from './dialogs';
export { WindowContext, useWindow, useAppMenus, useBeforeClose, useArgsChange, useWindowKeydown } from './hooks';
export { fileClipboard, useFileClipboard, DRAG_MIME, setDragPaths, getDragPaths, hasDragPaths, hasHostFiles } from './clipboard';
export { importHostFiles, downloadFile, pickHostFiles } from './io';
export { WALLPAPERS, DEFAULT_WALLPAPER, wallpaperURL } from './wallpapers';
export type { Wallpaper } from './wallpapers';
export { ensureSeeded, eraseAll } from './seed';
export { buildMenuBar, buildLogoMenu, buildGlobalShortcuts, confirmPower, SYSTEM_SHORTCUTS } from './systemMenus';
export {
  openGetInfo,
  revealInFinder,
  openPaths,
  trashPaths,
  emptyTrashWithConfirm,
  putBack,
  newFolder,
  duplicatePaths,
  renamePath,
  dotNameError,
  dropInto,
  pasteInto,
  setDesktopPicture,
  fileContextMenu,
  showFSError,
} from './actions';
export { lazyApp, isChunkLoadError } from './lazyApp';
export type { RetryableApp } from './lazyApp';

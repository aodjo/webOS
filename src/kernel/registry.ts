import type { AppManifest } from './types';
import { extname } from './path';

const apps = new Map<string, AppManifest>(); /** Registered app manifests keyed by app id. */
let ordered: AppManifest[] = []; /** Registered manifests in registration order (rebuilt by `registerApps`). */

/**
 * Registers the app manifests.
 *
 * Adds each manifest to the registry (a later manifest with the same id replaces the earlier one)
 * and rebuilds the ordered list. Called once at startup from src/apps/index.ts.
 *
 * @param {AppManifest[]} list - The manifests to register.
 * @returns {void}
 *
 * @example
 * registerApps([finderManifest, notesManifest]);
 */
export function registerApps(list: AppManifest[]): void {
  for (const m of list) apps.set(m.id, m);
  ordered = [...apps.values()];
}

/**
 * Looks up an app manifest by id.
 *
 * Reads the registry filled by `registerApps`; hidden apps are found as well.
 *
 * @param {string} id - The app id, e.g. "finder".
 * @returns {AppManifest | undefined} The manifest, or undefined if no such app is registered.
 *
 * @example
 * const name = getApp('notes')?.name;
 */
export function getApp(id: string): AppManifest | undefined {
  return apps.get(id);
}

/**
 * Lists the registered apps in registration order.
 *
 * Apps marked `hidden` are left out unless `includeHidden` is set.
 *
 * @param {Object} [opts={}] - Options.
 * @param {boolean} [opts.includeHidden] - Include hidden apps as well.
 * @returns {AppManifest[]} The registered manifests.
 *
 * @example
 * const visible = listApps();
 * const all = listApps({ includeHidden: true });
 */
export function listApps(opts: { includeHidden?: boolean } = {}): AppManifest[] {
  return opts.includeHidden ? ordered : ordered.filter((a) => !a.hidden);
}

const DEFAULT_HANDLERS: Record<string, string> = {
  dir: 'finder',
  txt: 'textedit',
  md: 'preview',
  markdown: 'preview',
  pdf: 'preview',
  png: 'preview',
  jpg: 'preview',
  jpeg: 'preview',
  gif: 'preview',
  webp: 'preview',
  svg: 'preview',
  avif: 'preview',
  mp3: 'preview',
  wav: 'preview',
  m4a: 'preview',
  mp4: 'preview',
  webm: 'preview',
  mov: 'preview',
  webloc: 'safari',
  url: 'safari',
  html: 'safari',
  htm: 'safari',
}; /** Preferred default app per extension ('dir' for folders); takes precedence over registration order. */

/**
 * Picks the app that should open a file or folder by default.
 *
 * Uses the preferred handler from `DEFAULT_HANDLERS` when that app is registered, otherwise the
 * first registered app whose `opens` list contains the extension. Folders fall back to Finder and
 * unknown extensions to TextEdit (if registered), the safest choice for arbitrary content.
 *
 * @param {string} nameOrDir - File name or path (ignored when `isDir` is true).
 * @param {boolean} [isDir=false] - True if the item is a folder.
 * @returns {string | undefined} The app id, or undefined if no app can open it.
 *
 * @example
 * defaultAppFor('Resume.md'); // "preview"
 * defaultAppFor('/Users/guest/Desktop', true); // "finder"
 */
export function defaultAppFor(nameOrDir: string, isDir = false): string | undefined {
  const ext = isDir ? 'dir' : extname(nameOrDir);
  const preferred = DEFAULT_HANDLERS[ext];
  if (preferred && apps.has(preferred)) return preferred;
  for (const m of ordered) if (m.opens?.includes(ext)) return m.id;
  return isDir ? 'finder' : apps.has('textedit') ? 'textedit' : undefined;
}

/**
 * Lists every app that declares it can open a file or folder (for "Open With").
 *
 * Matches the extension against each app's `opens` list; for files, apps that declare "*" are
 * included as well.
 *
 * @param {string} nameOrDir - File name or path (ignored when `isDir` is true).
 * @param {boolean} [isDir=false] - True if the item is a folder.
 * @returns {AppManifest[]} The matching apps in registration order.
 *
 * @example
 * const choices = appsThatOpen('photo.png').map((a) => a.id);
 */
export function appsThatOpen(nameOrDir: string, isDir = false): AppManifest[] {
  const ext = isDir ? 'dir' : extname(nameOrDir);
  return ordered.filter((m) => m.opens?.includes(ext) || (!isDir && m.opens?.includes('*')));
}

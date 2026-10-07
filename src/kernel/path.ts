import { HOME } from './constants';

/**
 * Normalizes a path to an absolute, canonical form.
 *
 * Collapses repeated slashes, drops "." segments, resolves ".." against the previous segment
 * (".." at the root stays at the root) and strips the trailing slash. The result always starts
 * with "/", even when the input is relative.
 *
 * @param {string} p - The path to normalize.
 * @returns {string} The normalized absolute path.
 *
 * @example
 * normalize('/Users//guest/./Documents/../Desktop/'); // "/Users/guest/Desktop"
 */
export function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

/**
 * Resolves a path against a working directory.
 *
 * Expands a leading "~" to the home directory; absolute paths are only normalized, relative ones
 * are joined to `cwd` first.
 *
 * @param {string} cwd - The current working directory (absolute).
 * @param {string} p - The path to resolve (absolute, relative or "~"-prefixed).
 * @returns {string} The resolved, normalized absolute path.
 *
 * @example
 * resolve('/Users/guest', '../Shared'); // "/Users/Shared"
 */
export function resolve(cwd: string, p: string): string {
  if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
  if (p.startsWith('/')) return normalize(p);
  return normalize(cwd + '/' + p);
}

/**
 * Joins path segments into one normalized absolute path.
 *
 * Concatenates the segments with "/" and passes the result through `normalize`, so duplicate
 * slashes, "." and ".." segments are resolved and the result always starts with "/".
 *
 * @param {...string} parts - The segments to join.
 * @returns {string} The joined, normalized path.
 *
 * @example
 * join('/Users/guest', 'Documents', 'Resume.md'); // "/Users/guest/Documents/Resume.md"
 */
export function join(...parts: string[]): string {
  return normalize(parts.join('/'));
}

/**
 * Returns the parent directory of a path.
 *
 * The parent of "/" and of top-level entries is "/".
 *
 * @param {string} p - The path.
 * @returns {string} The normalized parent directory.
 *
 * @example
 * dirname('/Users/guest/Desktop'); // "/Users/guest"
 */
export function dirname(p: string): string {
  const n = normalize(p);
  if (n === '/') return '/';
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

/**
 * Returns the last segment of a path.
 *
 * The base name of "/" is "/".
 *
 * @param {string} p - The path.
 * @returns {string} The file or folder name.
 *
 * @example
 * basename('/Users/guest/notes.txt'); // "notes.txt"
 */
export function basename(p: string): string {
  const n = normalize(p);
  if (n === '/') return '/';
  return n.slice(n.lastIndexOf('/') + 1);
}

/**
 * Returns the lowercase extension of a path, without the dot.
 *
 * Returns "" when the name has no extension. Dotfiles such as ".zshrc" have no extension.
 *
 * @param {string} p - The path or file name.
 * @returns {string} The lowercase extension, or "".
 *
 * @example
 * extname('/tmp/Photo.JPG'); // "jpg"
 */
export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  if (i <= 0) return '';
  return b.slice(i + 1).toLowerCase();
}

/**
 * Returns the file name without its extension.
 *
 * Dotfiles such as ".zshrc" are returned unchanged.
 *
 * @param {string} p - The path or file name.
 * @returns {string} The base name without the extension.
 *
 * @example
 * stem('/tmp/archive.tar.gz'); // "archive.tar"
 */
export function stem(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? b : b.slice(0, i);
}

/**
 * Checks whether a path is a directory or lies inside it.
 *
 * Both paths are normalized first; every path is within "/".
 *
 * @param {string} child - The path to test.
 * @param {string} parent - The containing directory.
 * @returns {boolean} True if `child` equals `parent` or is a descendant of it.
 *
 * @example
 * isWithin('/Users/guest/Desktop/a.txt', '/Users/guest'); // true
 */
export function isWithin(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || (p === '/' ? true : c.startsWith(p + '/'));
}

/**
 * Shortens a path for display by replacing the home directory with "~".
 *
 * Paths outside the home directory are returned unchanged.
 *
 * @param {string} p - The absolute path.
 * @returns {string} The display path.
 *
 * @example
 * tildify(HOME + '/Desktop'); // "~/Desktop"
 */
export function tildify(p: string): string {
  if (p === HOME) return '~';
  if (p.startsWith(HOME + '/')) return '~' + p.slice(HOME.length);
  return p;
}

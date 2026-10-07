/**
 * Pure URL helpers for Safari: address-field parsing, display text, framing heuristics and
 * letter icons.
 */

export const START_URL = 'webos://start'; /** Internal URL of the Safari Start Page. */
export const PORTFOLIO_URL = 'webos://portfolio'; /** Internal URL of the owner's portfolio homepage. */
export const HISTORY_URL = 'webos://history'; /** Internal URL of the full browsing-history page. */

/**
 * Builds a Google search URL for a query.
 *
 * The URL carries `igu=1`, the parameter under which Google allows its search results to be
 * shown inside an iframe. The query is URI-component encoded.
 *
 * @param {string} q - The search terms as typed.
 * @returns {string} A `https://www.google.com/search?igu=1&q=…` URL.
 *
 * @example
 * searchURL('react hooks');
 * // 'https://www.google.com/search?igu=1&q=react%20hooks'
 */
export const searchURL = (q: string) => `https://www.google.com/search?igu=1&q=${encodeURIComponent(q)}`;

/** How Safari handles a URL: a React-rendered `webos://` page, a framed web page, an FS file or a blank tab. */
export type URLKind = 'internal' | 'web' | 'file' | 'blank';

/**
 * Tells whether a URL is a `mailto:` link.
 *
 * Safari hands such links to Mail instead of loading them in a tab. The scheme check is
 * case-insensitive.
 *
 * @param {string} url - The URL to test.
 * @returns {boolean} `true` when the URL starts with `mailto:`.
 *
 * @example
 * isMailto('MAILTO:hi@example.com'); // true
 */
export const isMailto = (url: string) => /^mailto:/i.test(url);

/**
 * Classifies a URL by how Safari renders it.
 *
 * `webos://` URLs are internal React pages, `file://` URLs point into the virtual file system,
 * `about:blank` is an empty tab, and everything else is treated as a web page.
 *
 * @param {string} url - The URL to classify.
 * @returns {URLKind} The URL's kind.
 *
 * @example
 * kindOfURL('webos://start'); // 'internal'
 * kindOfURL('https://example.com'); // 'web'
 */
export function kindOfURL(url: string): URLKind {
  if (url.startsWith('webos://')) return 'internal';
  if (url.startsWith('file://')) return 'file';
  if (url === 'about:blank') return 'blank';
  return 'web';
}

/**
 * Extracts the file-system path from a `file://` URL.
 *
 * Strips the `file://` prefix and percent-decodes the rest with `decodeURI`. Typed URLs may
 * contain malformed %-escapes; when decoding fails the raw text is returned as typed.
 *
 * @param {string} url - A `file://` URL.
 * @returns {string} The decoded absolute FS path.
 *
 * @example
 * filePathOf('file:///Users/me/My%20Page.html'); // '/Users/me/My Page.html'
 */
export function filePathOf(url: string): string {
  const raw = url.slice('file://'.length);
  try {
    return decodeURI(raw);
  } catch {
    return raw;
  }
}

/**
 * Builds a `file://` URL for a file-system path.
 *
 * The path is encoded with `encodeURI`, so slashes stay intact while spaces and other unsafe
 * characters are percent-escaped. It is the inverse of {@link filePathOf}.
 *
 * @param {string} path - Absolute FS path.
 * @returns {string} The `file://` URL.
 *
 * @example
 * fileURL('/Users/me/My Page.html'); // 'file:///Users/me/My%20Page.html'
 */
export const fileURL = (path: string) => `file://${encodeURI(path)}`;

/**
 * Turns address-field input into a navigable URL, like Safari's smart search field.
 *
 * The input is trimmed; blank input yields `null`. `about:blank` and `webos://` URLs are
 * normalized to lower case, `file://` and `mailto:` URLs are kept as typed, and `http(s)://`
 * URLs are normalized through `URL`. Text containing whitespace is searched for. `localhost`
 * and IPv4 addresses (with optional port/path) get `http://`. Text shaped like `name.tld`,
 * optionally followed by a port and path/query/fragment, gets `https://`; the pattern excludes
 * a colon before the dot, so other schemes such as `javascript:` or `data:` never match and
 * are searched for instead. Anything that fails URL parsing also becomes a Google search.
 *
 * @param {string} raw - The text typed into the address field.
 * @returns {string | null} The URL to load, or `null` when the input is empty.
 *
 * @example
 * parseInput('example.com'); // 'https://example.com/'
 * parseInput('localhost:3000'); // 'http://localhost:3000'
 * parseInput('react hooks'); // Google search URL
 */
export function parseInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'about:blank') return 'about:blank';
  if (lower.startsWith('webos://')) return lower;
  if (lower.startsWith('file://')) return text;
  if (lower.startsWith('mailto:')) return text;
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).href;
    } catch {
      return searchURL(text);
    }
  }
  if (/\s/.test(text)) return searchURL(text);
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(text)) return `http://${text}`;
  if (/^[^\s/:?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) {
    try {
      return new URL(`https://${text}`).href;
    } catch {
      return searchURL(text);
    }
  }
  return searchURL(text);
}

/**
 * Returns the hostname of a URL.
 *
 * Parses the URL with `URL`; unparsable input yields an empty string instead of throwing.
 *
 * @param {string} url - The URL to inspect.
 * @returns {string} The hostname, or `''` when the URL cannot be parsed.
 *
 * @example
 * hostOf('https://www.github.com/aodjo'); // 'www.github.com'
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Returns the host as shown in the unfocused address field.
 *
 * Takes {@link hostOf} and strips a leading `www.` or `m.` label.
 *
 * @param {string} url - The URL to display.
 * @returns {string} The shortened host, or `''` for unparsable URLs.
 *
 * @example
 * displayHost('https://www.github.com/aodjo'); // 'github.com'
 */
export function displayHost(url: string): string {
  return hostOf(url).replace(/^(www|m)\./, '');
}

/**
 * Tells whether a URL uses HTTPS.
 *
 * Used to decide whether the address field shows the secure-connection indicator.
 *
 * @param {string} url - The URL to test.
 * @returns {boolean} `true` when the URL starts with `https://`.
 *
 * @example
 * isSecure('https://example.com'); // true
 */
export const isSecure = (url: string) => url.startsWith('https://');

/**
 * Extracts the query from a Google search URL.
 *
 * Matches any `google.*` host (including subdomains) with the `/search` path and returns its
 * `q` parameter, so the address field can show the search terms instead of the URL. Other URLs
 * and unparsable input yield `null`.
 *
 * @param {string} url - The URL to inspect.
 * @returns {string | null} The search query, or `null` when the URL is not a Google search.
 *
 * @example
 * searchQueryOf(searchURL('a b')); // 'a b'
 * searchQueryOf('https://example.com/search?q=1'); // null
 */
export function searchQueryOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/search') return u.searchParams.get('q');
  } catch {
    /* not a URL */
  }
  return null;
}

/* ───────────────────────── Framing ───────────────────────── */

/**
 * Tells whether a URL is a page of this OS itself.
 *
 * Framing such a page would boot a second copy of the OS against the same storage, so these
 * URLs are rendered without an iframe. A same-origin URL counts as "self" when its path has no
 * file extension or ends in `.htm`/`.html`; other static files of the site (images, PDFs…) can
 * be framed. Always `false` outside a browser or for unparsable URLs.
 *
 * @param {string} url - The URL to test.
 * @returns {boolean} `true` when the URL would load the OS's own app shell.
 *
 * @example
 * isSelf(`${location.origin}/`); // true
 * isSelf(`${location.origin}/resume.pdf`); // false
 */
export function isSelf(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(url);
    if (u.origin !== window.location.origin) return false;
    return !/\.[a-z0-9]{1,6}$/i.test(u.pathname) || /\.html?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

const BLOCKED_HOSTS = [
  'github.com',
  'gist.github.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'threads.net',
  'reddit.com',
  'stackoverflow.com',
  'apple.com',
  'naver.com',
  'kakao.com',
  'medium.com',
  'notion.so',
  'figma.com',
  'vercel.com',
  'netlify.com',
  'npmjs.com',
  'mail.google.com',
  'accounts.google.com',
  'drive.google.com',
  'docs.google.com',
]; /** Hosts (and their subdomains) known to send X-Frame-Options / frame-ancestors headers that block embedding. */

const FRAMABLE_HOSTS = ['example.com', 'example.org', 'example.net', 'wikipedia.org', 'wikimedia.org', 'openstreetmap.org', 'player.vimeo.com', 'archive.org', 'info.cern.ch']; /** Hosts (and their subdomains) known to render inside an iframe. */

/**
 * Tells whether a host is in a host list or is a subdomain of one of its entries.
 *
 * Compares exactly or by a `.<entry>` suffix, so `en.m.wikipedia.org` matches `wikipedia.org`
 * while a look-alike such as `notwikipedia.org` does not.
 *
 * @param {string} host - The hostname to test.
 * @param {string[]} list - Base hostnames to match against.
 * @returns {boolean} `true` when `host` equals an entry or ends with `.<entry>`.
 *
 * @example
 * hostMatches('en.m.wikipedia.org', ['wikipedia.org']); // true
 */
const hostMatches = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

/**
 * Tells whether a hostname belongs to Google.
 *
 * Matches `google.<tld>` (including multi-part TLDs such as `google.co.kr`) and any subdomain.
 *
 * @param {string} host - The hostname to test.
 * @returns {boolean} `true` for Google hosts.
 *
 * @example
 * isGoogle('www.google.co.kr'); // true
 */
function isGoogle(host: string): boolean {
  return /(^|\.)google\.[a-z.]+$/.test(host);
}

/**
 * Tells whether a URL will certainly refuse to load inside a frame.
 *
 * Google pages only frame when they carry `igu=1` (search results and the homepage), so any
 * Google URL without it is blocked, as are the Google hosts listed in `BLOCKED_HOSTS`. YouTube
 * only frames its `/embed/` player. All other hosts are checked against `BLOCKED_HOSTS`.
 * Unparsable URLs are not considered blocked.
 *
 * @param {string} url - The URL to test.
 * @returns {boolean} `true` when the site is known to block embedding.
 *
 * @example
 * isKnownBlocked('https://github.com/aodjo'); // true
 * isKnownBlocked('https://www.youtube.com/embed/1'); // false
 */
export function isKnownBlocked(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (isGoogle(host)) {
    try {
      return new URL(url).searchParams.get('igu') !== '1' || hostMatches(host, BLOCKED_HOSTS);
    } catch {
      return true;
    }
  }
  if ((host === 'www.youtube.com' || host === 'youtube.com') && !new URL(url).pathname.startsWith('/embed/')) return true;
  return hostMatches(host, BLOCKED_HOSTS);
}

/**
 * Tells whether a URL is known to render inside a frame.
 *
 * Known-framable pages never show the "some websites can't be displayed" hint after they load.
 * URLs without a host and same-origin URLs count as framable, Google URLs are framable when
 * they are not {@link isKnownBlocked}, YouTube URLs when they use the `/embed/` player, and
 * everything else is checked against `FRAMABLE_HOSTS`.
 *
 * @param {string} url - The URL to test.
 * @returns {boolean} `true` when the page is known to frame correctly.
 *
 * @example
 * isKnownFramable('https://en.m.wikipedia.org/'); // true
 * isKnownFramable('https://some-site.dev/'); // false
 */
export function isKnownFramable(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (typeof window !== 'undefined' && url.startsWith(window.location.origin)) return true;
  if (isGoogle(host)) return !isKnownBlocked(url);
  if ((host === 'www.youtube.com' || host === 'youtube.com') && url.includes('/embed/')) return true;
  return hostMatches(host, FRAMABLE_HOSTS);
}

/**
 * Extracts the GitHub profile or repository a URL points at.
 *
 * Used for the GitHub preview card shown instead of the (unframable) GitHub page. Only
 * `github.com` / `www.github.com` URLs match. The first path segment must be a valid GitHub
 * user name (1–39 letters, digits or hyphens); the second segment is returned as the repo when
 * it is a valid repository name, and dropped otherwise.
 *
 * @param {string} url - The URL to inspect.
 * @returns {{ user: string; repo?: string } | null} The user and optional repo, or `null` when
 *   the URL is not a GitHub profile/repository URL.
 *
 * @example
 * githubTarget('https://github.com/aodjo/webos/tree/main'); // { user: 'aodjo', repo: 'webos' }
 * githubTarget('https://example.com/aodjo'); // null
 */
export function githubTarget(url: string): { user: string; repo?: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
    const [user, repo] = u.pathname.split('/').filter(Boolean);
    if (!user || !/^[a-z0-9-]{1,39}$/i.test(user)) return null;
    if (repo && !/^[\w.-]{1,100}$/.test(repo)) return { user };
    return { user, repo };
  } catch {
    return null;
  }
}

/* ───────────────────────── Link files ───────────────────────── */

/**
 * Reads the URL stored in a link file.
 *
 * Understands three formats, tried in order: a Windows `.url` INI file (`URL=…` line), a
 * `.webloc` property list (the first `<string>` element, with XML entities unescaped), and a
 * plain-text file whose first whitespace-separated token is the URL.
 *
 * @param {string} content - The file's text content.
 * @returns {string | null} The URL, or `null` when the file is empty.
 *
 * @example
 * parseLinkFile('[InternetShortcut]\nURL=https://a.dev/x\n'); // 'https://a.dev/x'
 */
export function parseLinkFile(content: string): string | null {
  const ini = /^\s*URL\s*=\s*(\S+)/im.exec(content);
  if (ini) return ini[1];
  const plist = /<string>\s*([^<\s]+)\s*<\/string>/i.exec(content);
  if (plist) return plist[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const first = content.trim().split(/\s+/)[0];
  return first || null;
}

/**
 * Builds the contents of a macOS `.webloc` file for a URL.
 *
 * Produces an XML property list with a single `URL` key; `&` and `<` in the URL are escaped so
 * {@link parseLinkFile} can read it back unchanged.
 *
 * @param {string} url - The URL to store.
 * @returns {string} The plist XML text.
 *
 * @example
 * fs.writeFile('/Users/me/Desktop/Example.webloc', weblocContent('https://example.com'));
 */
export function weblocContent(url: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>${url.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>\n</dict>\n</plist>\n`;
}

/* ───────────────────────── Letter icons ───────────────────────── */

const TILE_COLORS = ['#ff453a', '#ff9f0a', '#30d158', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#64d2ff', '#ac8e68', '#32ade6', '#34c759', '#8e8e93']; /** Background colors a letter icon is picked from. */

/**
 * Computes a small non-negative string hash.
 *
 * A Java-style `h * 31 + charCode` rolling hash kept in 32-bit integer range, then made
 * non-negative. It is deterministic, so the same input always maps to the same value.
 *
 * @param {string} s - The string to hash.
 * @returns {number} A non-negative integer.
 *
 * @example
 * TILE_COLORS[hash('github.com') % TILE_COLORS.length];
 */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Builds the deterministic letter icon used for a site's tile.
 *
 * The letter is the first letter or digit of the title (falling back to the display host, then
 * the URL), upper-cased, or `?` when there is none. The color is chosen by hashing the display
 * host (or the title when there is no host), so every page of a site shares one color.
 *
 * @param {string} title - The page or bookmark title.
 * @param {string} url - The page URL.
 * @returns {{ letter: string; color: string }} The tile letter and its background color.
 *
 * @example
 * letterIcon('GitHub', 'https://github.com/x'); // { letter: 'G', color: '#…' }
 */
export function letterIcon(title: string, url: string): { letter: string; color: string } {
  const host = displayHost(url);
  const source = (title || host || url).replace(/^[^\p{L}\p{N}]+/u, '');
  const letter = (source[0] ?? '?').toUpperCase();
  return { letter, color: TILE_COLORS[hash(host || title) % TILE_COLORS.length] };
}

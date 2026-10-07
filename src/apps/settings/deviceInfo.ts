/**
 * Real information about the visitor's browser and device, shown in About and Displays.
 * The user-agent parsers are pure functions (covered by deviceInfo.test.ts).
 */

/** Browser identity parsed from a user-agent string. */
export interface BrowserInfo {
  /** Human-readable browser name, e.g. "Chrome" or "Naver Whale". */
  name: string;
  /** Shortened version ("141", "18.1"), or '' when unknown. */
  version: string;
  /** Rendering engine family. */
  engine: 'Blink' | 'Gecko' | 'WebKit' | 'Unknown';
}

/**
 * Shortens a dotted or underscored version string for display.
 *
 * Splits on "." or "_" and keeps only the major component, plus the minor component when
 * `keepMinor` is set and the minor part is present and not "0".
 * "18.1.0" → "18.1", "131.0" → "131", "141.0.7390.55" → "141".
 *
 * @param {string} v - Raw version string such as "141.0.7390.55" or "18_1".
 * @param {boolean} keepMinor - Whether a non-zero minor version should be kept.
 * @returns {string} The shortened version, or '' when the input has no major part.
 *
 * @example
 * shortVersion('18.1.0', true);       // "18.1"
 * shortVersion('141.0.7390.55', false); // "141"
 */
function shortVersion(v: string, keepMinor: boolean): string {
  const [major, minor] = v.split(/[._]/);
  if (!major) return '';
  return keepMinor && minor && minor !== '0' ? `${major}.${minor}` : major;
}

const BROWSERS: { re: RegExp; name: string; keepMinor?: boolean }[] = [
  { re: /Edg(?:e|A|iOS)?\/([\d.]+)/, name: 'Microsoft Edge' },
  { re: /Whale\/([\d.]+)/, name: 'Naver Whale' },
  { re: /SamsungBrowser\/([\d.]+)/, name: 'Samsung Internet', keepMinor: true },
  { re: /(?:OPR|OPT)\/([\d.]+)/, name: 'Opera' },
  { re: /Vivaldi\/([\d.]+)/, name: 'Vivaldi', keepMinor: true },
  { re: /YaBrowser\/([\d.]+)/, name: 'Yandex Browser', keepMinor: true },
  { re: /(?:Firefox|FxiOS)\/([\d.]+)/, name: 'Firefox', keepMinor: true },
  { re: /CriOS\/([\d.]+)/, name: 'Chrome' },
  { re: /Chrome\/([\d.]+)/, name: 'Chrome' },
  { re: /Version\/([\d.]+).*Safari\//, name: 'Safari', keepMinor: true },
]; /** Ordered UA patterns: forks precede Chrome and Chrome precedes Safari, as their UAs contain the later tokens. */

/**
 * Identifies the browser, its version and its rendering engine from a user-agent string.
 *
 * Tries the `BROWSERS` patterns in order and returns the first match. The engine is WebKit for
 * every browser on iOS/iPadOS (all of them must use WebKit there) and for Safari, Gecko for
 * Firefox, and Blink otherwise. A UA with no known token falls back to a generic "WebKit"
 * entry when it mentions AppleWebKit, else to "Unknown".
 *
 * @param {string} ua - The user-agent string (usually `navigator.userAgent`).
 * @returns {BrowserInfo} The detected browser name, short version and engine.
 *
 * @example
 * parseBrowser(navigator.userAgent);
 * // { name: 'Chrome', version: '141', engine: 'Blink' }
 */
export function parseBrowser(ua: string): BrowserInfo {
  const ios = /iPhone|iPad|iPod/.test(ua);
  for (const b of BROWSERS) {
    const m = ua.match(b.re);
    if (!m) continue;
    let engine: BrowserInfo['engine'] = 'Blink';
    if (ios || b.name === 'Safari') engine = 'WebKit';
    else if (b.name === 'Firefox') engine = 'Gecko';
    return { name: b.name, version: shortVersion(m[1], !!b.keepMinor), engine };
  }
  if (/AppleWebKit/.test(ua)) return { name: 'WebKit', version: '', engine: 'WebKit' };
  return { name: 'Unknown', version: '', engine: 'Unknown' };
}

/**
 * Identifies the operating system from a user-agent string.
 *
 * Android and iOS include their version ("Android 14", "iOS 18.1"). iPads are detected either by
 * an "iPad" token or by a "Macintosh" UA on a touch device (iPadOS requests desktop sites with a
 * Mac UA), the latter without a version. macOS is reported without a version because browsers
 * freeze the macOS UA version at 10.15.7, so the number would be misleading. Windows, ChromeOS
 * and Linux are reported by name only.
 *
 * @param {string} ua - The user-agent string (usually `navigator.userAgent`).
 * @param {number} [maxTouchPoints=0] - `navigator.maxTouchPoints`, used to tell iPads from Macs.
 * @returns {string} A display name such as "macOS", "iOS 18.1", "iPadOS" or "Unknown".
 *
 * @example
 * parseOS(navigator.userAgent, navigator.maxTouchPoints); // "macOS"
 */
export function parseOS(ua: string, maxTouchPoints = 0): string {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Android ([\d.]+)/))) return `Android ${shortVersion(m[1], false)}`;
  if ((m = ua.match(/(?:iPhone|CPU) OS ([\d_]+)/)) && /iPhone|iPod/.test(ua)) return `iOS ${shortVersion(m[1], true)}`;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
    m = ua.match(/OS ([\d_]+)/);
    return m && /iPad/.test(ua) ? `iPadOS ${shortVersion(m[1], true)}` : 'iPadOS';
  }
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

/**
 * Rounds a measured refresh rate to the nearest common display panel rate.
 *
 * Picks the closest value from a fixed list of common rates (30–360 Hz). If that value is within
 * 6 Hz of the measurement it is returned; otherwise the measurement is simply rounded, so unusual
 * rates are not forced onto an unrelated standard value.
 *
 * @param {number} hz - The measured refresh rate in hertz.
 * @returns {number} The snapped common rate, or `Math.round(hz)` when none is close enough.
 *
 * @example
 * roundRefreshRate(59.7);  // 60
 * roundRefreshRate(200);   // 200
 */
export function roundRefreshRate(hz: number): number {
  const common = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
  let best = common[0];
  for (const c of common) if (Math.abs(c - hz) < Math.abs(best - hz)) best = c;
  return Math.abs(best - hz) <= 6 ? best : Math.round(hz);
}

/**
 * Measures the display refresh rate by timing animation frames.
 *
 * Counts `requestAnimationFrame` callbacks for `sampleMs` milliseconds, starting the clock at the
 * first frame, and converts the frame count into a rate rounded with `roundRefreshRate`. Setting
 * `signal.cancelled` stops the measurement at the next frame and resolves `null`. Resolves `null`
 * immediately when `requestAnimationFrame` is unavailable. Frames are throttled in background
 * tabs, so the result is only meaningful while the page is visible.
 *
 * @param {{ cancelled: boolean }} signal - Mutable flag the caller sets to abort the measurement.
 * @param {number} [sampleMs=600] - How long to sample frames, in milliseconds.
 * @returns {Promise<number | null>} The refresh rate in Hz, or `null` if cancelled or unsupported.
 *
 * @example
 * const signal = { cancelled: false };
 * measureRefreshRate(signal).then((hz) => setHz(hz));
 * // later, on unmount: signal.cancelled = true;
 */
export function measureRefreshRate(signal: { cancelled: boolean }, sampleMs = 600): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') return resolve(null);
    let frames = 0;
    let first = 0;
    /**
     * Animation-frame callback that counts frames until the sample window has elapsed.
     *
     * Records the first frame's timestamp as the start, counts every later frame, and resolves
     * the outer promise once `sampleMs` has passed (or `null` when cancelled); otherwise it
     * schedules itself for the next frame.
     *
     * @param {number} now - The frame timestamp passed by `requestAnimationFrame`.
     * @returns {void}
     *
     * @example
     * requestAnimationFrame(tick);
     */
    const tick = (now: number) => {
      if (signal.cancelled) return resolve(null);
      if (!first) first = now;
      else frames++;
      if (now - first >= sampleMs) return resolve(frames > 0 ? roundRefreshRate((frames * 1000) / (now - first)) : null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Derives a stable, fake serial number from a seed string.
 *
 * Hashes the seed with 32-bit FNV-1a, then expands the hash into 8 characters from an alphabet
 * without the ambiguous letters I and O, mixing the state between characters. The same seed
 * always yields the same serial, and the result is prefixed with "PB".
 *
 * @param {string} seed - Any string to derive the serial from (e.g. the owner handle).
 * @returns {string} A 10-character serial such as "PBUPPGDUKB".
 *
 * @example
 * serialNumber('aodjo'); // "PBUPPGDUKB"
 */
export function serialNumber(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let out = '';
  let x = h >>> 0;
  for (let i = 0; i < 8; i++) {
    out += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length) ^ Math.imul(x, 31 + i);
    x >>>= 0;
  }
  return `PB${out}`;
}

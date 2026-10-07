/**
 * About This Computer: a laptop drawing with the current wallpaper on its screen, the spec
 * sheet from the portfolio data, and live facts about the visitor's session (uptime, browser,
 * CPU cores, device memory and display).
 */
import { useEffect, useState } from 'react';
import type { AppProps, LString } from '@/kernel/types';
import { useSystem, useIsDark } from '@/kernel/system';
import { fs, useNode } from '@/kernel/fs';
import { wm } from '@/kernel/wm';
import { useLocale, useT } from '@/kernel/i18n';
import { wallpaperURL } from '@/kernel/wallpapers';
import { owner, osInfo } from '@/data/portfolio';
import { Button } from '@/components/ui';
import { browserName, formatUptime, screenInches, serialNumber } from './info';
import styles from './AboutThisMac.module.css';

const S = {
  chip: { en: 'Chip', ko: '칩' },
  memory: { en: 'Memory', ko: '메모리' },
  startupDisk: { en: 'Startup disk', ko: '시동 디스크' },
  serial: { en: 'Serial number', ko: '일련번호' },
  uptime: { en: 'Uptime', ko: '가동 시간' },
  host: { en: 'Host', ko: '호스트' },
  display: { en: 'Display', ko: '디스플레이' },
  cores: { en: '{n} cores', ko: '{n}코어' },
  moreInfo: { en: 'More Info…', ko: '추가 정보…' },
  rights: { en: '™ and © {year} {name}.\nAll rights reserved.', ko: '™ 및 © {year} {name}.\n모든 권리 보유.' },
  size: { en: '{n}-inch, {year}', ko: '{n}형, {year}년' },
} satisfies Record<string, LString>; /** Localized labels and templates; `{name}` placeholders are filled in with `fill`. */

/**
 * Fills `{name}` placeholders in a template string.
 *
 * Replaces every `{key}` with the matching value from `vars`; keys without a value become an
 * empty string.
 *
 * @param {string} s - Template text.
 * @param {Record<string, string | number>} vars - Values for the placeholders.
 * @returns {string} The template with all placeholders replaced.
 *
 * @example
 * fill('{n} cores', { n: 8 }); // "8 cores"
 */
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/**
 * Resolves a virtual file path to a URL for the laptop screen image.
 *
 * Returns the file's URL from the virtual file system, or null when the path is missing or is
 * a folder, so a removed custom wallpaper falls back to the default one.
 *
 * @param {string} p - Absolute path in the virtual file system.
 * @returns {string | null} A URL usable as an image source, or null.
 *
 * @example
 * wallpaperURL(wallpaper, dark, resolveFsPath);
 */
const resolveFsPath = (p: string): string | null => {
  try {
    return fs.getURL(p);
  } catch {
    return null;
  }
};

/** Facts about the visitor's browser and display, as shown in the spec sheet. */
interface HostInfo {
  /** Browser name and version, e.g. "Chrome 141". */
  browser: string;
  /** Logical CPU cores, or 0 when unknown. */
  cores: number;
  /** Device memory in GB (Chromium only, rounded down and capped by the browser), or null. */
  memory: number | null;
  /** Screen width in CSS pixels. */
  screenW: number;
  /** Screen height in CSS pixels. */
  screenH: number;
  /** Device pixel ratio. */
  dpr: number;
}

/**
 * Reads the visitor's browser and display facts.
 *
 * Collects the browser name from the user agent, the core count, the Chromium-only
 * `navigator.deviceMemory`, the screen size (falling back to the viewport size when
 * `window.screen` is unavailable) and the device pixel ratio (1 when unknown).
 *
 * @returns {HostInfo} A snapshot of the host's facts.
 *
 * @example
 * const [host, setHost] = useState(readHost);
 */
function readHost(): HostInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    browser: browserName(nav.userAgent),
    cores: nav.hardwareConcurrency || 0,
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    screenW: window.screen?.width ?? window.innerWidth,
    screenH: window.screen?.height ?? window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  };
}

/**
 * Returns the current time and re-renders the component on a fixed interval.
 *
 * Stores `Date.now()` in state and refreshes it every `ms` milliseconds, which keeps
 * time-based text such as the uptime current. The interval restarts when `ms` changes and is
 * cleared on unmount.
 *
 * @param {number} ms - Refresh interval in milliseconds.
 * @returns {number} The timestamp of the latest tick, in milliseconds since the epoch.
 *
 * @example
 * const now = useTick(15000);
 */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * The About This Computer window.
 *
 * Draws a laptop whose screen shows the current wallpaper for the active appearance, followed
 * by the machine name, a size and year line, and a spec sheet: chip, memory, startup disk, a
 * serial number derived from the owner and build, OS version, uptime since boot, host browser
 * details and display resolution. A custom wallpaper file is subscribed to with `useNode` so the
 * screen updates when that file changes. The uptime refreshes every 15 seconds, and the host
 * facts are read again on window resize because moving to another display or zooming changes
 * them. "More Info…" opens the About pane of Settings.
 *
 * @param {AppProps} _ - Window props; not used by this app.
 * @returns {JSX.Element} The window content.
 *
 * @example
 * wm.launch('about-this-mac');
 */
export default function AboutThisMac(_: AppProps) {
  const t = useT();
  const locale = useLocale();
  const dark = useIsDark();
  const wallpaper = useSystem((s) => s.settings.wallpaper);
  const bootedAt = useSystem((s) => s.bootedAt);
  useNode(wallpaper.startsWith('/') ? wallpaper : null);
  const now = useTick(15000);
  const [host, setHost] = useState(readHost);

  useEffect(() => {
    /**
     * Refreshes the host facts after the window is resized.
     *
     * Reads the screen size and pixel ratio again, since moving the browser to another
     * display or zooming the page changes them.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('resize', onResize);
     */
    const onResize = () => setHost(readHost());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const screenSrc = wallpaperURL(wallpaper, dark, resolveFsPath);
  const ownerName = t(owner.name);
  const hostText = [host.browser, host.cores ? fill(t(S.cores), { n: host.cores }) : null, host.memory ? `${host.memory} GB` : null].filter(Boolean).join(' · ');
  const dpr = Math.round(host.dpr * 100) / 100;
  const displayText = `${host.screenW} × ${host.screenH}${dpr !== 1 ? ` @${dpr}x` : ''}`;

  const rows: [string, string][] = [
    [t(S.chip), osInfo.chip],
    [t(S.memory), osInfo.memory],
    [t(S.startupDisk), `${osInfo.name} HD`],
    [t(S.serial), serialNumber(`${owner.handle}|${osInfo.build}|${osInfo.machineShort}`)],
    [osInfo.name, `${t(osInfo.codename)} ${osInfo.version}`],
    [t(S.uptime), formatUptime(now - bootedAt, locale)],
    [t(S.host), hostText],
    [t(S.display), displayText],
  ];

  return (
    <div className={styles.root} data-drag-region>
      <div className={styles.device} aria-hidden="true">
        <div className={styles.lid}>
          <div className={styles.screen}>
            <img src={screenSrc} alt="" draggable={false} />
            <span className={styles.notch} />
          </div>
        </div>
        <div className={styles.base}>
          <span className={styles.lip} />
        </div>
      </div>

      <h1 className={styles.name}>{t(osInfo.machine)}</h1>
      <div className={styles.year}>{fill(t(S.size), { n: screenInches(host.screenW), year: osInfo.year })}</div>

      <dl className={styles.specs}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt>{label}</dt>
            <dd className="selectable" data-no-drag>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <Button className={styles.more} onClick={() => wm.launch('settings', { pane: 'about' })}>
        {t(S.moreInfo)}
      </Button>

      <p className={styles.legal}>{fill(t(S.rights), { year: osInfo.year, name: ownerName })}</p>
    </div>
  );
}

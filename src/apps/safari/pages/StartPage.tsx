/**
 * webos://start — the Safari Start Page: Favorites, Frequently Visited, Privacy Report and
 * Reading List over a blurred copy of the desktop picture, laid out as Liquid Glass tiles.
 */
import { useMemo, type CSSProperties } from 'react';
import { Glasses, ShieldCheck } from 'lucide-react';
import { osInfo } from '@/data/portfolio';
import { fmt, fs, showContextMenu, useIsDark, useLocale, useSystem, useT, wallpaperURL } from '@/kernel';
import { buildFavorites, frequentlyVisited, useSafari, type Favorite } from '../store';
import { S } from '../strings';
import { displayHost, kindOfURL, letterIcon } from '../url';
import { linkMenu, type PageAPI } from './api';
import styles from './Pages.module.css';

const P = {
  frequent: { en: 'Frequently Visited', ko: '자주 방문한 사이트' },
  privacy: { en: 'Privacy Report', ko: '개인정보 보호 리포트' },
  privacyBody: {
    en: `In the last seven days, ${osInfo.name} has prevented {n} trackers from profiling you.`,
    ko: `지난 7일 동안 ${osInfo.name}가 추적기 {n}개가 사용자의 프로파일을 생성하지 못하도록 차단했습니다.`,
  },
  readingEmpty: {
    en: 'Pages you add to your Reading List appear here. Use the Share button or ⇧⌘D.',
    ko: '읽기 목록에 추가한 페이지가 여기에 표시됩니다. 공유 버튼이나 ⇧⌘D를 사용해 보세요.',
  },
}; /** Localized strings used only by the Start Page. */

/**
 * A Liquid Glass tile linking to a site, used by the Favorites and Frequently Visited grids.
 *
 * Shows the site's title and, for web URLs, its display host, with the URL as tooltip. The
 * large variant is a favorites tile; the small variant uses a thicker glass.
 *
 * @param {Object} props - Component props.
 * @param {string} props.title - Label of the tile.
 * @param {string} props.url - Target URL.
 * @param {() => void} props.onOpen - Called when the tile is clicked.
 * @param {(e: React.MouseEvent) => void} props.onMenu - Called on right-click to show a context menu.
 * @param {'large' | 'small'} [props.size='large'] - Tile variant.
 * @returns {JSX.Element} The tile button.
 *
 * @example
 * <Tile title={f.title} url={f.url} onOpen={() => api.navigate(f.url)} onMenu={favMenu(f)} />
 */
export function Tile({ title, url, onOpen, onMenu, size = 'large' }: { title: string; url: string; onOpen: () => void; onMenu: (e: React.MouseEvent) => void; size?: 'large' | 'small' }) {
  return (
    <button type="button" className={size === 'large' ? `lg lg-interactive ${styles.tile}` : `lg lg-thick lg-interactive ${styles.tileSmall}`} title={url} onClick={onOpen} onContextMenu={onMenu}>
      <span className={styles.tileLabel}>{title}</span>
      {kindOfURL(url) === 'web' && <span className={styles.tileHost}>{displayHost(url)}</span>}
    </button>
  );
}

/**
 * The Safari Start Page (`webos://start`).
 *
 * Renders, over a blurred copy of the current wallpaper (light/dark variant; wallpapers stored
 * in the file system are resolved through `fs.getURL`), four sections: Favorites (built-in
 * favorites plus bookmarks), Frequently Visited (history minus favorites and internal pages;
 * hidden when empty), a Privacy Report and the Reading List. The Privacy Report count is a
 * stable, decorative number: 17 plus 3 for every web visit in the last seven days. Every tile
 * has a link context menu; user favorites and Reading List items add a remove action, and
 * opening a Reading List item marks it as read.
 *
 * @param {Object} props - Component props.
 * @param {PageAPI} props.api - Navigation API of the hosting tab.
 * @returns {JSX.Element} The Start Page.
 *
 * @example
 * <StartPage api={api} />
 */
export function StartPage({ api }: { api: PageAPI }) {
  const t = useT();
  const locale = useLocale();
  const dark = useIsDark();
  const wallpaper = useSystem((s) => s.settings.wallpaper);
  const bookmarks = useSafari((s) => s.bookmarks);
  const history = useSafari((s) => s.history);
  const readingList = useSafari((s) => s.readingList);
  const removeBookmark = useSafari((s) => s.removeBookmark);
  const removeFromReadingList = useSafari((s) => s.removeFromReadingList);
  const markRead = useSafari((s) => s.markRead);

  const favorites = useMemo(() => buildFavorites(locale, bookmarks), [locale, bookmarks]);
  const frequent = useMemo(() => frequentlyVisited(history, new Set(favorites.map((f) => f.url))), [history, favorites]);
  const background = wallpaperURL(wallpaper, dark, (p) => (fs.stat(p)?.type === 'file' ? fs.getURL(p) : null));

  const trackers = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const visits = history.filter((h) => h.ts > weekAgo && kindOfURL(h.url) === 'web').length;
    return 17 + visits * 3;
  }, [history]);

  /**
   * Creates the context-menu handler for a favorite tile.
   *
   * The menu is the standard link menu; favorites that are not built in also get a
   * "Remove from Favorites" item that deletes the bookmark.
   *
   * @param {Favorite} f - The favorite the tile shows.
   * @returns {(e: React.MouseEvent) => void} A `contextmenu` handler that opens the menu.
   *
   * @example
   * <Tile title={f.title} url={f.url} onOpen={() => api.navigate(f.url)} onMenu={favMenu(f)} />
   */
  const favMenu = (f: Favorite) => (e: React.MouseEvent) =>
    showContextMenu(e, linkMenu(api, f.url, f.builtin ? [] : [{ label: S.removeFavorite, action: () => removeBookmark(f.url) }]));

  return (
    <div className={styles.start}>
      <div className={styles.startBg} style={{ backgroundImage: `url("${background}")` }} aria-hidden />
      <div className={styles.startScroll}>
        <div className={styles.startInner}>
          <section>
            <h2 className={styles.sectionTitle}>{t(S.favorites)}</h2>
            <div className={styles.tileGrid}>
              {favorites.map((f) => (
                <Tile key={f.url} title={f.title} url={f.url} onOpen={() => api.navigate(f.url)} onMenu={favMenu(f)} />
              ))}
            </div>
          </section>

          {frequent.length > 0 && (
            <section>
              <h2 className={styles.sectionTitle}>{t(P.frequent)}</h2>
              <div className={styles.smallGrid}>
                {frequent.map((h) => (
                  <Tile key={h.url} size="small" title={h.title} url={h.url} onOpen={() => api.navigate(h.url)} onMenu={(e) => showContextMenu(e, linkMenu(api, h.url))} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className={styles.sectionTitle}>{t(P.privacy)}</h2>
            <div className={`lg lg-thick ${styles.privacy}`}>
              <ShieldCheck size={26} className={styles.privacyIcon} />
              <span className={styles.privacyCount}>{trackers}</span>
              <p>{fmt(t(P.privacyBody), { n: trackers })}</p>
            </div>
          </section>

          <section>
            <h2 className={styles.sectionTitle}>{t(S.readingList)}</h2>
            {readingList.length === 0 ? (
              <div className={`lg lg-thick ${styles.readingEmpty}`}>
                <Glasses size={18} />
                <span>{t(P.readingEmpty)}</span>
              </div>
            ) : (
              <div className={styles.readingGrid}>
                {readingList.map((r) => {
                  const li = letterIcon(r.title, r.url);
                  return (
                    <button
                      key={r.url}
                      type="button"
                      className={`lg lg-thick lg-interactive ${styles.readingCard}`}
                      onClick={() => {
                        markRead(r.url);
                        api.navigate(r.url);
                      }}
                      onContextMenu={(e) => showContextMenu(e, linkMenu(api, r.url, [{ label: S.removeReading, action: () => removeFromReadingList(r.url) }]))}
                    >
                      <span className={styles.readingThumb} style={{ '--tile': li.color } as CSSProperties}>
                        {li.letter}
                      </span>
                      <span className={styles.readingText}>
                        <span className={styles.readingTitle}>
                          {!r.read && <span className={styles.unreadDot} aria-hidden />}
                          {r.title}
                        </span>
                        <span className={styles.readingHost}>{kindOfURL(r.url) === 'web' ? displayHost(r.url) : r.url}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

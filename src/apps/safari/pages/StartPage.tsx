/**
 * webos://start — the Safari Start Page (macOS 26): Favorites as icon tiles, the Privacy Report
 * and the Reading List over a blurred copy of the desktop picture.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Glasses, ShieldHalf } from 'lucide-react';
import { fmt, fs, showContextMenu, useIsDark, useLocale, useSystem, useT, wallpaperURL } from '@/kernel';
import { buildFavorites, useSafari, type Favorite } from '../store';
import { S } from '../strings';
import { displayHost, kindOfURL, letterIcon } from '../url';
import { linkMenu, type PageAPI } from './api';
import { faviconFor, SiteIcon } from '../SiteIcon';
import styles from './Pages.module.css';

const P = {
  privacy: { en: 'Privacy Report', ko: '개인정보 보호 리포트' },
  privacyBody: { en: 'Safari prevents trackers from profiling you.', ko: 'Safari가 사용자를 프로파일링하려는 트래커를 차단합니다.' },
  last30: { en: 'Last 30 days', ko: '지난 30일' },
  blocked: { en: 'Trackers prevented from profiling you', ko: '사용자를 프로파일링하려는 트래커를 차단함' },
  contacted: { en: 'Websites that contacted trackers', ko: '트래커에 접촉한 웹사이트' },
  topTracker: { en: 'Most contacted tracker', ko: '가장 많이 접촉한 트래커' },
  topTrackerBody: {
    en: 'google.com was prevented from profiling you across {n} websites.',
    ko: '{n}개의 웹사이트에서 google.com이(가) 사용자를 프로파일링하려는 시도를 차단했습니다.',
  },
  readingEmpty: {
    en: 'Pages you add to your Reading List appear here. Use the Share button or ⇧⌘D.',
    ko: '읽기 목록에 추가한 페이지가 여기에 표시됩니다. 공유 버튼이나 ⇧⌘D를 사용해 보세요.',
  },
}; /** Localized strings used only by the Start Page. */

/**
 * A favorite shown as an app-like icon tile with its name underneath.
 *
 * The tile shows the site's icon on white (the owner's avatar fills the tile for the portfolio
 * page); when there is no icon or it fails to load, a flat coloured tile with the site's first
 * letter is shown instead. The URL is the tooltip.
 *
 * @param {Object} props - Component props.
 * @param {Favorite} props.fav - The favorite.
 * @param {() => void} props.onOpen - Called when the tile is clicked.
 * @param {(e: React.MouseEvent) => void} props.onMenu - Called on right-click to show a context menu.
 * @returns {JSX.Element} The tile button.
 *
 * @example
 * <FavoriteTile fav={f} onOpen={() => api.navigate(f.url)} onMenu={favMenu(f)} />
 */
function FavoriteTile({ fav, onOpen, onMenu }: { fav: Favorite; onOpen: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const icon = faviconFor(fav.url);
  const [failed, setFailed] = useState(false);
  const li = letterIcon(fav.title, fav.url);
  const internal = kindOfURL(fav.url) === 'internal';
  return (
    <button type="button" className={styles.fav} title={fav.url} onClick={onOpen} onContextMenu={onMenu}>
      {icon && !failed ? (
        <span className={`${styles.favIcon} ${internal ? styles.favPhoto : ''}`}>
          <img src={icon} alt="" draggable={false} onError={() => setFailed(true)} />
        </span>
      ) : (
        <span className={`${styles.favIcon} ${styles.favLetter}`} style={{ '--tile': li.color } as CSSProperties}>
          {li.letter}
        </span>
      )}
      <span className={styles.favLabel}>{fav.title}</span>
    </button>
  );
}

/**
 * The Safari Start Page (`webos://start`).
 *
 * Renders, over a blurred copy of the current wallpaper (light/dark variant; wallpapers stored
 * in the file system are resolved through `fs.getURL`), Favorites as icon tiles (built-in
 * favorites plus bookmarks), the Privacy Report and the Reading List. The Privacy Report numbers
 * are stable, decorative values derived from the number of web visits in the last 30 days.
 * Favorites and Reading List items have a link context menu; user favorites and Reading List
 * items add a remove action, and opening a Reading List item marks it as read.
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
  const history = useSafari((s) => s.history);
  const bookmarks = useSafari((s) => s.bookmarks);
  const removeBookmark = useSafari((s) => s.removeBookmark);
  const readingList = useSafari((s) => s.readingList);
  const removeFromReadingList = useSafari((s) => s.removeFromReadingList);
  const markRead = useSafari((s) => s.markRead);

  const background = wallpaperURL(wallpaper, dark, (p) => (fs.stat(p)?.type === 'file' ? fs.getURL(p) : null));

  const favorites = useMemo(() => buildFavorites(locale, bookmarks), [locale, bookmarks]);
  const report = useMemo(() => {
    const monthAgo = Date.now() - 30 * 86_400_000;
    const visits = history.filter((h) => h.ts > monthAgo && kindOfURL(h.url) === 'web').length;
    return { trackers: 17 + visits * 3, contacted: Math.min(80, 42 + visits * 2), sites: 4 + visits };
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
   * <FavoriteTile fav={f} onOpen={() => api.navigate(f.url)} onMenu={favMenu(f)} />
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
            <div className={styles.favGrid}>
              {favorites.map((f) => (
                <FavoriteTile key={f.url} fav={f} onOpen={() => api.navigate(f.url)} onMenu={favMenu(f)} />
              ))}
            </div>
          </section>

          <section>
            <h2 className={styles.sectionTitle}>{t(P.privacy)}</h2>
            <div className={`lg lg-thick ${styles.privacy}`}>
              <div className={styles.privacyIntro}>
                <ShieldHalf size={44} strokeWidth={1.6} className={styles.privacyIcon} />
                <p>{t(P.privacyBody)}</p>
              </div>
              <div className={styles.privacyStats}>
                <span className={styles.privacyPeriod}>{t(P.last30)}</span>
                <div className={styles.privacyStat}>
                  <span>{t(P.blocked)}</span>
                  <b>{report.trackers}</b>
                </div>
                <div className={styles.privacyStat}>
                  <span>{t(P.contacted)}</span>
                  <b>{report.contacted}%</b>
                </div>
                <div className={`${styles.privacyStat} ${styles.privacyWide}`}>
                  <span>{t(P.topTracker)}</span>
                  <b>{fmt(t(P.topTrackerBody), { n: report.sites })}</b>
                </div>
              </div>
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
                      <span className={styles.readingThumb}>
                        <SiteIcon url={r.url} size={28} />
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

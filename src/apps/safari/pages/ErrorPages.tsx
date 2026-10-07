/**
 * Pages Safari renders instead of (or over) a frame: sites that refuse framing, load
 * timeouts, missing files or unknown internal pages, and the "you're already here" page
 * for the OS's own URL. Blocked GitHub URLs also get a live preview built from the
 * public GitHub REST API, which allows cross-origin requests.
 */
import { useEffect, useState } from 'react';
import { Compass, ExternalLink, FileX, GitFork, MapPin, RotateCw, Star, Users } from 'lucide-react';
import { osInfo } from '@/data/portfolio';
import { Button } from '@/components/ui';
import { fmt, formatDate, useLocale, useT } from '@/kernel';
import { GitHubMark } from '../brands';
import { S } from '../strings';
import { START_URL, displayHost, githubTarget } from '../url';
import { openExternal, type PageAPI } from './api';
import styles from './Pages.module.css';

const P = {
  blockedTitle: { en: 'This website can’t be shown here', ko: '이 웹 사이트는 여기에 표시할 수 없음' },
  blockedBody: {
    en: `“{host}” doesn’t allow other websites to display its pages inside a frame, so it can’t open inside ${osInfo.name}. You can open it in a new browser tab instead.`,
    ko: `“{host}”은(는) 다른 웹 사이트가 자신의 페이지를 프레임 안에 표시하는 것을 허용하지 않기 때문에 ${osInfo.name} 안에서 열 수 없습니다. 대신 새로운 브라우저 탭에서 열 수 있습니다.`,
  },
  timeoutTitle: { en: 'Safari Can’t Open the Page', ko: 'Safari가 페이지를 열 수 없음' },
  timeoutBody: {
    en: `Safari can’t open the page “{url}” because the server isn’t responding, or the site doesn’t allow being displayed inside ${osInfo.name}.`,
    ko: `서버가 응답하지 않거나 사이트가 ${osInfo.name} 안에서 표시되는 것을 허용하지 않기 때문에 Safari가 “{url}” 페이지를 열 수 없습니다.`,
  },
  retry: { en: 'Try Again', ko: '다시 시도' },
  notFoundTitle: { en: 'Safari Can’t Find the Page', ko: 'Safari가 페이지를 찾을 수 없음' },
  notFoundBody: { en: 'The page “{url}” doesn’t exist.', ko: '“{url}” 페이지가 존재하지 않습니다.' },
  fileTitle: { en: 'Safari Can’t Find the File', ko: 'Safari가 파일을 찾을 수 없음' },
  fileBody: { en: 'The file “{url}” couldn’t be found. It may have been moved, renamed or deleted.', ko: '“{url}” 파일을 찾을 수 없습니다. 이동되었거나, 이름이 변경되었거나, 삭제되었을 수 있습니다.' },
  homeTitle: { en: 'You’re already here 👋', ko: '이미 여기에 계시네요 👋' },
  homeBody: {
    en: `This is ${osInfo.name} itself. Opening it inside itself would create a tiny universe — and two copies fighting over the same files. Try another website!`,
    ko: `여기가 바로 ${osInfo.name}입니다. 자기 자신 안에서 열면 작은 우주가 생기고, 두 개의 복사본이 같은 파일을 두고 다투게 됩니다. 다른 웹 사이트를 열어 보세요!`,
  },
  goStart: { en: 'Go to Start Page', ko: '시작 페이지로 이동' },
  viewOnGitHub: { en: 'View on GitHub', ko: 'GitHub에서 보기' },
  repos: { en: 'repositories', ko: '저장소' },
  followers: { en: 'followers', ko: '팔로워' },
  following: { en: 'following', ko: '팔로잉' },
  recentRepos: { en: 'Recently updated', ko: '최근 업데이트됨' },
  updated: { en: 'Updated {date}', ko: '{date}에 업데이트됨' },
  preview: { en: 'Preview from the GitHub API', ko: 'GitHub API 미리보기' },
}; /** Localized strings for the error pages and the GitHub preview; `{host}`, `{url}` and `{date}` are filled in with `fmt`. */

/**
 * Centered icon, title, body and optional action row shared by every error page.
 *
 * Renders the icon (when given) above an `<h1>` title and a paragraph body. The actions container
 * is only emitted when `children` is provided, so pages without buttons get no empty
 * row below the text.
 *
 * @param {Object} props - Component props.
 * @param {React.ReactNode} [props.icon] - Artwork shown above the title.
 * @param {string} props.title - Localized heading text.
 * @param {string} props.body - Localized explanatory paragraph.
 * @param {React.ReactNode} [props.children] - Action buttons laid out in a row below the body.
 * @returns {JSX.Element} The error content block.
 *
 * @example
 * <ErrorShell icon={<Compass size={56} />} title={t(P.notFoundTitle)} body={message}>
 *   <Button onClick={retry}>Try Again</Button>
 * </ErrorShell>
 */
function ErrorShell({ icon, title, body, children }: { icon?: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className={styles.error}>
      {icon && <div className={styles.errorIcon}>{icon}</div>}
      <h1 className={styles.errorTitle}>{title}</h1>
      <p className={styles.errorBody}>{body}</p>
      {children && <div className={styles.errorActions}>{children}</div>}
    </div>
  );
}

/**
 * Page shown when a framed website did not finish loading in time.
 *
 * Explains that the server is not responding or refuses to be embedded, and offers a
 * "Try Again" button that calls `onRetry` plus a primary button that opens the URL in a
 * real browser tab through `openExternal`.
 *
 * @param {Object} props - Component props.
 * @param {string} props.url - URL that failed to load; interpolated into the message.
 * @param {() => void} props.onRetry - Called when the user clicks "Try Again".
 * @returns {JSX.Element} The full-size timeout page.
 *
 * @example
 * <TimeoutPage url="https://example.com" onRetry={() => dispatch({ type: 'reload', id })} />
 */
export function TimeoutPage({ url, onRetry }: { url: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className={styles.errorPage}>
      <ErrorShell icon={<Compass size={56} strokeWidth={1.2} />} title={t(P.timeoutTitle)} body={fmt(t(P.timeoutBody), { url })}>
        <Button onClick={onRetry}>
          <RotateCw size={12} /> {t(P.retry)}
        </Button>
        <Button variant="primary" onClick={() => openExternal(url)}>
          {t(S.openInBrowser)} <ExternalLink size={12} />
        </Button>
      </ErrorShell>
    </div>
  );
}

/**
 * Page shown for a missing file or an unknown internal page.
 *
 * With `file` set it shows a crossed-out file icon and the "can't find the file"
 * wording (used for `file://` URLs whose file is missing); otherwise it shows a
 * compass icon and the generic "page doesn't exist" message. No actions are offered.
 *
 * @param {Object} props - Component props.
 * @param {string} props.url - URL or file path quoted in the message.
 * @param {boolean} [props.file] - Use the missing-file icon and wording instead of the missing-page ones.
 * @returns {JSX.Element} The full-size not-found page.
 *
 * @example
 * <NotFoundPage url="webos://nope" />
 * <NotFoundPage url="/Users/guest/Desktop/gone.txt" file />
 */
export function NotFoundPage({ url, file }: { url: string; file?: boolean }) {
  const t = useT();
  return (
    <div className={styles.errorPage}>
      <ErrorShell icon={file ? <FileX size={52} strokeWidth={1.2} /> : <Compass size={56} strokeWidth={1.2} />} title={t(file ? P.fileTitle : P.notFoundTitle)} body={fmt(t(file ? P.fileBody : P.notFoundBody), { url })} />
    </div>
  );
}

/**
 * Page shown when Safari is pointed at the OS's own URL.
 *
 * Instead of loading the OS inside itself, it shows a spinning "∞" badge with a short
 * explanation and a primary button that navigates the tab to the start page.
 *
 * @param {Object} props - Component props.
 * @param {PageAPI} props.api - Tab API used to navigate to `START_URL`.
 * @returns {JSX.Element} The full-size "you're already here" page.
 *
 * @example
 * <HomeAgainPage api={api} />
 */
export function HomeAgainPage({ api }: { api: PageAPI }) {
  const t = useT();
  return (
    <div className={styles.errorPage}>
      <ErrorShell icon={<span className={styles.inception}>∞</span>} title={t(P.homeTitle)} body={t(P.homeBody)}>
        <Button variant="primary" onClick={() => api.navigate(START_URL)}>
          {t(P.goStart)}
        </Button>
      </ErrorShell>
    </div>
  );
}

/**
 * Page shown when a website refuses to be displayed inside a frame.
 *
 * GitHub URLs show the GitHub mark above the message; other sites show no icon. The primary button opens the URL in a real browser
 * tab. For GitHub user or repository URLs a `GitHubPreview` is rendered below the
 * message; it is keyed by `user/repo`, so switching to another target remounts it and
 * starts a fresh fetch.
 *
 * @param {Object} props - Component props.
 * @param {string} props.url - The URL that refused framing.
 * @param {PageAPI} props.api - Tab API forwarded to the GitHub preview for in-tab navigation.
 * @returns {JSX.Element} The full-size blocked page, optionally followed by the GitHub preview.
 *
 * @example
 * <BlockedPage url="https://github.com/octocat" api={api} />
 */
export function BlockedPage({ url, api }: { url: string; api: PageAPI }) {
  const t = useT();
  const host = displayHost(url);
  const gh = githubTarget(url);
  return (
    <div className={styles.errorPage}>
      <ErrorShell
        icon={gh ? <GitHubMark size={52} /> : undefined}
        title={t(P.blockedTitle)}
        body={fmt(t(P.blockedBody), { host })}
      >
        <Button variant="primary" onClick={() => openExternal(url)}>
          {t(S.openInBrowser)} <ExternalLink size={12} />
        </Button>
      </ErrorShell>
      {gh && <GitHubPreview key={`${gh.user}/${gh.repo ?? ''}`} user={gh.user} repo={gh.repo} api={api} />}
    </div>
  );
}

/* ───────────────────────── GitHub preview ───────────────────────── */

/** The fields of a GitHub REST API user object that the preview displays. */
interface GHUser {
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  location: string | null;
  html_url: string;
}

/** The fields of a GitHub REST API repository object that the preview displays. */
interface GHRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  updated_at: string;
  fork: boolean;
}

const ghCache = new Map<string, unknown>(); /** Successful GitHub API responses keyed by request path, held for the session so revisiting a page does not spend rate limit. */

/**
 * Fetches a GitHub REST API path as JSON, with an in-memory session cache.
 *
 * Returns the cached value when the same path was fetched successfully before;
 * otherwise requests `https://api.github.com{path}` with the GitHub JSON media type,
 * stores the parsed body in `ghCache` and returns it. Failed responses are not cached,
 * so a later visit retries them.
 *
 * @async
 * @param {string} path - API path including any query string, e.g. `/users/octocat`.
 * @param {AbortSignal} signal - Signal that cancels the request.
 * @returns {Promise<T>} The parsed JSON response body.
 * @throws {Error} `GitHub <status>` when the response status is not OK.
 * @throws {DOMException} An `AbortError` when `signal` is aborted (network failures reject with a `TypeError`).
 *
 * @example
 * const user = await ghFetch<GHUser>('/users/octocat', ctrl.signal);
 * console.log(user.public_repos);
 */
async function ghFetch<T>(path: string, signal: AbortSignal): Promise<T> {
  if (ghCache.has(path)) return ghCache.get(path) as T;
  const res = await fetch(`https://api.github.com${path}`, { signal, headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = (await res.json()) as T;
  ghCache.set(path, data);
  return data;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  Rust: '#dea584',
  Go: '#00add8',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Swift: '#f05138',
  Kotlin: '#a97bff',
  Java: '#b07219',
  Shell: '#89e051',
}; /** GitHub's language colors for the dot in repository cards; languages not listed fall back to gray. */

/**
 * Live summary card of a GitHub user or repository, loaded from the public REST API.
 *
 * On mount, and whenever `user` or `repo` changes, it fetches in parallel through
 * `ghFetch`: the user profile plus either the given repository or the six most
 * recently updated repositories (forks are dropped from that list). Requests are
 * aborted on unmount or when the props change; aborts are ignored, while any other
 * failure hides the card entirely. A shimmering placeholder is shown while loading.
 * Cards in the recent list navigate the current tab to the repository URL; the
 * single-repository card and the "View on GitHub" button open GitHub in a real
 * browser tab.
 *
 * @param {Object} props - Component props.
 * @param {string} props.user - GitHub login to show.
 * @param {string} [props.repo] - Repository name; when set, that repository replaces the recent list.
 * @param {PageAPI} props.api - Tab API used to navigate to a repository from the recent list.
 * @returns {JSX.Element | null} The preview card, a loading placeholder, or null after a failed fetch.
 *
 * @example
 * <GitHubPreview user="octocat" repo="Hello-World" api={api} />
 */
function GitHubPreview({ user, repo, api }: { user: string; repo?: string; api: PageAPI }) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<{ user: GHUser; repos: GHRepo[]; repo?: GHRepo } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      ghFetch<GHUser>(`/users/${user}`, ctrl.signal),
      repo ? Promise.resolve([] as GHRepo[]) : ghFetch<GHRepo[]>(`/users/${user}/repos?sort=updated&per_page=6`, ctrl.signal),
      repo ? ghFetch<GHRepo>(`/repos/${user}/${repo}`, ctrl.signal) : Promise.resolve(undefined),
    ])
      .then(([u, repos, r]) => setData({ user: u, repos: repos.filter((x) => !x.fork).slice(0, 6), repo: r }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setFailed(true);
      });
    return () => ctrl.abort();
  }, [user, repo]);

  if (failed) return null;
  if (!data) return <div className={`${styles.gh} ${styles.ghLoading}`} aria-busy />;

  const { user: u, repos, repo: r } = data;
  /**
   * Renders one repository as a clickable card.
   *
   * The compact variant shows the short name and navigates the tab to the repository
   * URL. The big variant shows `owner/name` plus the localized last-update date, and
   * opens the repository in a real browser tab. Both show the description, a language
   * dot colored from `LANG_COLORS` (gray when unknown), stars and forks.
   *
   * @param {GHRepo} x - Repository data from the API.
   * @param {boolean} [big=false] - Render the large single-repository variant.
   * @returns {JSX.Element} A `<button>` keyed by the repository's full name.
   *
   * @example
   * repos.map((x) => repoCard(x));
   * repoCard(r, true);
   */
  const repoCard = (x: GHRepo, big = false) => (
    <button key={x.full_name} type="button" className={big ? styles.ghRepoBig : styles.ghRepo} onClick={() => (big ? openExternal(x.html_url) : api.navigate(x.html_url))}>
      <span className={styles.ghRepoName}>{big ? x.full_name : x.name}</span>
      {x.description && <span className={styles.ghRepoDesc}>{x.description}</span>}
      <span className={styles.ghRepoMeta}>
        {x.language && (
          <span>
            <i style={{ background: LANG_COLORS[x.language] ?? 'var(--gray)' }} />
            {x.language}
          </span>
        )}
        <span>
          <Star size={11} /> {x.stargazers_count}
        </span>
        <span>
          <GitFork size={11} /> {x.forks_count}
        </span>
        {big && <span>{fmt(t(P.updated), { date: formatDate(Date.parse(x.updated_at), locale, { dateStyle: 'medium' }) })}</span>}
      </span>
    </button>
  );

  return (
    <div className={styles.gh}>
      <div className={styles.ghHeader}>
        <img src={u.avatar_url} alt="" className={styles.ghAvatar} referrerPolicy="no-referrer" />
        <div className={styles.ghWho}>
          <div className={styles.ghName}>{u.name ?? u.login}</div>
          <div className={styles.ghLogin}>@{u.login}</div>
          {u.bio && <div className={styles.ghBio}>{u.bio}</div>}
          <div className={styles.ghStats}>
            <span>
              <Users size={12} /> <b>{u.followers}</b> {t(P.followers)} · <b>{u.following}</b> {t(P.following)}
            </span>
            <span>
              <b>{u.public_repos}</b> {t(P.repos)}
            </span>
            {u.location && (
              <span>
                <MapPin size={12} /> {u.location}
              </span>
            )}
          </div>
        </div>
        <Button onClick={() => openExternal(r?.html_url ?? u.html_url)}>
          <GitHubMark size={13} /> {t(P.viewOnGitHub)}
        </Button>
      </div>
      {r && repoCard(r, true)}
      {!r && repos.length > 0 && (
        <>
          <div className={styles.ghSection}>{t(P.recentRepos)}</div>
          <div className={styles.ghRepos}>{repos.map((x) => repoCard(x))}</div>
        </>
      )}
      <div className={styles.ghFoot}>{t(P.preview)}</div>
    </div>
  );
}

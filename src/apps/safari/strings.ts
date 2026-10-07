import { osInfo } from '@/data/portfolio';
import { basename, tr, type Locale, type LString } from '@/kernel';
import { HISTORY_URL, PORTFOLIO_URL, START_URL, displayHost, filePathOf, kindOfURL, searchQueryOf } from './url';
import { ownerName } from './store';

export const S = {
  file: { en: 'File', ko: '파일' },
  view: { en: 'View', ko: '보기' },
  history: { en: 'History', ko: '방문 기록' },
  bookmarks: { en: 'Bookmarks', ko: '책갈피' },
  window: { en: 'Window', ko: '윈도우' },
  newWindow: { en: 'New Window', ko: '새로운 윈도우' },
  newTab: { en: 'New Tab', ko: '새로운 탭' },
  openLocation: { en: 'Open Location…', ko: '위치 열기…' },
  openFile: { en: 'Open File…', ko: '파일 열기…' },
  closeTab: { en: 'Close Tab', ko: '탭 닫기' },
  closeWindow: { en: 'Close Window', ko: '윈도우 닫기' },
  closeOtherTabs: { en: 'Close Other Tabs', ko: '다른 탭 닫기' },
  saveAs: { en: 'Save As…', ko: '다른 이름으로 저장…' },
  share: { en: 'Share', ko: '공유' },
  copyLink: { en: 'Copy Link', ko: '링크 복사' },
  openInBrowser: { en: 'Open in New Browser Tab', ko: '새로운 브라우저 탭에서 열기' },
  emailPage: { en: 'Email This Page', ko: '이 페이지를 이메일로 보내기' },
  showSidebar: { en: 'Show Sidebar', ko: '사이드바 보기' },
  hideSidebar: { en: 'Hide Sidebar', ko: '사이드바 가리기' },
  stop: { en: 'Stop', ko: '중단' },
  reload: { en: 'Reload Page', ko: '페이지 다시 로드' },
  actualSize: { en: 'Actual Size', ko: '실제 크기' },
  zoomIn: { en: 'Zoom In', ko: '확대' },
  zoomOut: { en: 'Zoom Out', ko: '축소' },
  back: { en: 'Back', ko: '뒤로' },
  forward: { en: 'Forward', ko: '앞으로' },
  home: { en: 'Home', ko: '홈' },
  showAllHistory: { en: 'Show All History', ko: '모든 방문 기록 보기' },
  reopenTab: { en: 'Reopen Last Closed Tab', ko: '마지막으로 닫은 탭 다시 열기' },
  clearHistory: { en: 'Clear History…', ko: '방문 기록 지우기…' },
  addBookmark: { en: 'Add Bookmark', ko: '책갈피 추가' },
  addReadingList: { en: 'Add to Reading List', ko: '읽기 목록에 추가' },
  favorites: { en: 'Favorites', ko: '즐겨찾기' },
  readingList: { en: 'Reading List', ko: '읽기 목록' },
  tabs: { en: 'Tabs', ko: '탭' },
  prevTab: { en: 'Show Previous Tab', ko: '이전 탭 보기' },
  nextTab: { en: 'Show Next Tab', ko: '다음 탭 보기' },
  startPage: { en: 'Start Page', ko: '시작 페이지' },
  portfolio: { en: 'Portfolio', ko: '포트폴리오' },
  untitled: { en: 'Untitled', ko: '제목 없음' },
  searchPlaceholder: { en: 'Search or enter website name', ko: '검색 또는 웹 사이트 이름 입력' },
  searchGoogle: { en: 'Search Google for “{q}”', ko: 'Google에서 “{q}” 검색' },
  goTo: { en: 'Go to “{q}”', ko: '“{q}”(으)로 이동' },
  topHits: { en: 'Top Hits', ko: '가장 일치하는 항목' },
  sidebar: { en: 'Sidebar', ko: '사이드바' },
  tabOverview: { en: 'Show Tab Overview', ko: '탭 개요 보기' },
  remove: { en: 'Remove', ko: '제거' },
  removeFavorite: { en: 'Remove from Favorites', ko: '즐겨찾기에서 제거' },
  removeReading: { en: 'Remove Item', ko: '항목 제거' },
  open: { en: 'Open', ko: '열기' },
  openNewTab: { en: 'Open in New Tab', ko: '새로운 탭에서 열기' },
  openNewWindow: { en: 'Open in New Window', ko: '새로운 윈도우에서 열기' },
  frameHint: {
    en: `Some websites can’t be displayed inside ${osInfo.name}.`,
    ko: `일부 웹 사이트는 ${osInfo.name} 안에서 표시할 수 없습니다.`,
  },
  frameHintAction: { en: 'Open in a new browser tab', ko: '새로운 브라우저 탭에서 열기' },
  dismiss: { en: 'Dismiss', ko: '닫기' },
  bookmarkAdded: { en: 'Added to Favorites', ko: '즐겨찾기에 추가됨' },
  readingAdded: { en: 'Added to Reading List', ko: '읽기 목록에 추가됨' },
  saveWebloc: { en: 'Save web location as', ko: '웹 위치를 다음으로 저장' },
  clearHistoryTitle: { en: 'Are you sure you want to clear all history?', ko: '모든 방문 기록을 지우겠습니까?' },
  clearHistoryMsg: { en: 'This also clears your Frequently Visited sites.', ko: '자주 방문한 사이트도 함께 지워집니다.' },
  clear: { en: 'Clear History', ko: '방문 기록 지우기' },
} satisfies Record<string, LString>; /** Localized strings shared by Safari's menus, toolbar, sidebar and internal pages. */

/**
 * Returns the title shown for a URL in the tab, window title and history.
 *
 * Internal pages get their localized names (the portfolio page is titled with the owner's
 * name), and unknown `webos://` URLs show the URL itself. `file://` URLs show the file name,
 * blank tabs "Untitled". Google searches show "<query> - Google"; other web pages show their
 * display host, or the URL when it has no host.
 *
 * @param {string} url - The URL to title.
 * @param {Locale} locale - Locale for the localized titles.
 * @returns {string} The display title.
 *
 * @example
 * titleFor('webos://start', 'en'); // 'Start Page'
 * titleFor('https://www.github.com/aodjo', 'en'); // 'github.com'
 */
export function titleFor(url: string, locale: Locale): string {
  switch (kindOfURL(url)) {
    case 'internal':
      if (url === START_URL) return tr(S.startPage, locale);
      if (url === PORTFOLIO_URL) return `${ownerName(locale)} — ${tr(S.portfolio, locale)}`;
      if (url === HISTORY_URL) return tr(S.history, locale);
      return url;
    case 'file':
      return basename(filePathOf(url));
    case 'blank':
      return tr(S.untitled, locale);
    default: {
      const q = searchQueryOf(url);
      if (q) return `${q} - Google`;
      return displayHost(url) || url;
    }
  }
}

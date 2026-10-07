/** Localized Finder strings and the color tag definitions. */
import type { LString } from '@/kernel';

export const S = {
  // Sidebar
  sidebar: { en: 'Sidebar', ko: '사이드바' },
  favorites: { en: 'Favorites', ko: '즐겨찾기' },
  locations: { en: 'Locations', ko: '위치' },
  tags: { en: 'Tags', ko: '태그' },
  recents: { en: 'Recents', ko: '최근 항목' },
  applications: { en: 'Applications', ko: '응용 프로그램' },
  desktop: { en: 'Desktop', ko: '데스크탑' },
  documents: { en: 'Documents', ko: '문서' },
  downloads: { en: 'Downloads', ko: '다운로드' },
  pictures: { en: 'Pictures', ko: '사진' },
  music: { en: 'Music', ko: '음악' },
  movies: { en: 'Movies', ko: '동영상' },
  publicFolder: { en: 'Public', ko: '공개' },
  shared: { en: 'Shared', ko: '공유' },
  system: { en: 'System', ko: '시스템' },
  library: { en: 'Library', ko: '라이브러리' },
  users: { en: 'Users', ko: '사용자' },
  trash: { en: 'Trash', ko: '휴지통' },
  computer: { en: 'Computer', ko: '컴퓨터' },
  resizeSidebar: { en: 'Resize sidebar', ko: '사이드바 크기 조절' },

  // Toolbar
  back: { en: 'Back', ko: '뒤로' },
  forward: { en: 'Forward', ko: '앞으로' },
  backForward: { en: 'Back/Forward', ko: '뒤로/앞으로' },
  groupSort: { en: 'Change the item grouping and sorting', ko: '항목 그룹 및 정렬 방식 변경' },
  actions: { en: 'Perform tasks with the selected items', ko: '선택한 항목으로 작업 수행' },
  search: { en: 'Search', ko: '검색' },
  searchLabel: { en: 'Search:', ko: '검색:' },
  thisComputer: { en: 'This Computer', ko: '이 컴퓨터' },

  // Views
  asIcons: { en: 'as Icons', ko: '아이콘으로' },
  asList: { en: 'as List', ko: '목록으로' },
  asColumns: { en: 'as Columns', ko: '계층으로' },
  asGallery: { en: 'as Gallery', ko: '갤러리로' },
  icons: { en: 'Icons', ko: '아이콘' },
  list: { en: 'List', ko: '목록' },
  columns: { en: 'Columns', ko: '계층' },
  gallery: { en: 'Gallery', ko: '갤러리' },
  viewAs: { en: 'View', ko: '보기' },
  sortBy: { en: 'Sort By', ko: '정렬 기준' },
  name: { en: 'Name', ko: '이름' },
  kind: { en: 'Kind', ko: '종류' },
  dateModified: { en: 'Date Modified', ko: '수정일' },
  size: { en: 'Size', ko: '크기' },
  where: { en: 'Where', ko: '위치' },
  ascending: { en: 'Ascending', ko: '오름차순' },
  descending: { en: 'Descending', ko: '내림차순' },
  expand: { en: 'Expand', ko: '펼치기' },
  resizeColumn: { en: 'Resize column', ko: '열 크기 조절' },
  collapse: { en: 'Collapse', ko: '접기' },
  noResults: { en: 'No Results', ko: '결과 없음' },
  noRecents: { en: 'No recent files', ko: '최근 파일 없음' },
  iconSize: { en: 'Icon size', ko: '아이콘 크기' },
  information: { en: 'Information', ko: '정보' },
  created: { en: 'Created', ko: '생성일' },
  modified: { en: 'Modified', ko: '수정일' },
  more: { en: 'More…', ko: '더 보기…' },
  noSelection: { en: 'No Selection', ko: '선택 항목 없음' },

  // Trash banner
  empty: { en: 'Empty', ko: '비우기' },

  // Menus
  file: { en: 'File', ko: '파일' },
  edit: { en: 'Edit', ko: '편집' },
  view: { en: 'View', ko: '보기' },
  go: { en: 'Go', ko: '이동' },
  newFinderWindow: { en: 'New Finder Window', ko: '새로운 Finder 윈도우' },
  newFolder: { en: 'New Folder', ko: '새로운 폴더' },
  newFolderWithSelection: { en: 'New Folder with Selection', ko: '선택 항목으로 새로운 폴더 만들기' },
  open: { en: 'Open', ko: '열기' },
  openWith: { en: 'Open With', ko: '다음으로 열기' },
  openInNewWindow: { en: 'Open in New Window', ko: '새로운 윈도우에서 열기' },
  closeWindow: { en: 'Close Window', ko: '윈도우 닫기' },
  getInfo: { en: 'Get Info', ko: '정보 가져오기' },
  rename: { en: 'Rename', ko: '이름 변경' },
  duplicate: { en: 'Duplicate', ko: '복제' },
  quickLook: { en: 'Quick Look', ko: '훑어보기' },
  moveToTrash: { en: 'Move to Trash', ko: '휴지통으로 이동' },
  deleteImmediately: { en: 'Delete Immediately…', ko: '즉시 삭제…' },
  putBack: { en: 'Put Back', ko: '되돌려 놓기' },
  emptyTrash: { en: 'Empty Trash', ko: '휴지통 비우기' },
  download: { en: 'Download to This Computer', ko: '이 컴퓨터로 다운로드' },
  importFiles: { en: 'Import Files…', ko: '파일 가져오기…' },
  find: { en: 'Find', ko: '찾기' },
  showInEnclosingFolder: { en: 'Show in Enclosing Folder', ko: '상위 폴더에서 보기' },
  undo: { en: 'Undo', ko: '실행 취소' },
  redo: { en: 'Redo', ko: '실행 복귀' },
  cut: { en: 'Cut', ko: '오려두기' },
  copy: { en: 'Copy', ko: '복사하기' },
  selectAll: { en: 'Select All', ko: '전체 선택' },
  hideSidebar: { en: 'Hide Sidebar', ko: '사이드바 가리기' },
  showSidebar: { en: 'Show Sidebar', ko: '사이드바 보기' },
  showPathBar: { en: 'Show Path Bar', ko: '경로 막대 보기' },
  hidePathBar: { en: 'Hide Path Bar', ko: '경로 막대 가리기' },
  showStatusBar: { en: 'Show Status Bar', ko: '상태 막대 보기' },
  hideStatusBar: { en: 'Hide Status Bar', ko: '상태 막대 가리기' },
  showHiddenFiles: { en: 'Show Hidden Files', ko: '숨김 파일 보기' },
  enclosingFolder: { en: 'Enclosing Folder', ko: '상위 폴더' },
  home: { en: 'Home', ko: '홈' },
  recentFolders: { en: 'Recent Folders', ko: '최근 사용한 폴더' },
  clearMenu: { en: 'Clear Menu', ko: '메뉴 지우기' },
  goToFolder: { en: 'Go to Folder…', ko: '폴더로 이동…' },
  goToFolderTitle: { en: 'Go to the folder:', ko: '폴더로 이동:' },
  goToFolderPlaceholder: { en: '~/Documents', ko: '~/Documents' },
  goButton: { en: 'Go', ko: '이동' },
  folderNotFound: { en: 'The folder can’t be found.', ko: '폴더를 찾을 수 없습니다.' },
  tagsMenu: { en: 'Tags', ko: '태그' },
  noTag: { en: 'None', ko: '없음' },

  // Undo labels
  undoMove: { en: 'Move', ko: '이동' },
  undoCopy: { en: 'Copy', ko: '복사하기' },
  undoRename: { en: 'Rename', ko: '이름 변경' },
  undoTrash: { en: 'Move to Trash', ko: '휴지통으로 이동' },
  undoNewFolder: { en: 'New Folder', ko: '새로운 폴더' },
  undoDuplicate: { en: 'Duplicate', ko: '복제' },
  undoPutBack: { en: 'Put Back', ko: '되돌려 놓기' },
  undoTag: { en: 'Set Tag', ko: '태그 설정' },

  // Quick Look
  closeQuickLook: { en: 'Close', ko: '닫기' },
  folderOf: { en: 'Folder', ko: '폴더' },

  // Get Info
  general: { en: 'General:', ko: '일반:' },
  nameExt: { en: 'Name & Extension:', ko: '이름 및 확장자:' },
  openWithSection: { en: 'Open with:', ko: '다음으로 열기:' },
  previewSection: { en: 'Preview:', ko: '미리보기:' },
  sharing: { en: 'Sharing & Permissions:', ko: '공유 및 권한:' },
  kindLabel: { en: 'Kind:', ko: '종류:' },
  sizeLabel: { en: 'Size:', ko: '크기:' },
  whereLabel: { en: 'Where:', ko: '위치:' },
  createdLabel: { en: 'Created:', ko: '생성일:' },
  modifiedLabel: { en: 'Modified:', ko: '수정일:' },
  versionLabel: { en: 'Version:', ko: '버전:' },
  capacityLabel: { en: 'Capacity:', ko: '용량:' },
  availableLabel: { en: 'Available:', ko: '사용 가능:' },
  usedLabel: { en: 'Used:', ko: '사용됨:' },
  tagsLabel: { en: 'Tags:', ko: '태그:' },
  locked: { en: 'Locked', ko: '잠금' },
  readWrite: { en: 'You can read and write', ko: '읽기 및 쓰기 가능' },
  readOnly: { en: 'You can only read', ko: '읽기만 가능' },
  openWithHint: { en: 'Use this application to open this document.', ko: '이 응용 프로그램을 사용하여 이 문서를 엽니다.' },
  defaultSuffix: { en: '(default)', ko: '(기본)' },
  infoTitle: { en: '{name} Info', ko: '{name} 정보' },
  modifiedInline: { en: 'Modified: {date}', ko: '수정일: {date}' },
  volume: { en: 'Volume', ko: '볼륨' },
  searchingTitle: { en: 'Searching “{q}”', ko: '“{q}” 검색 중' },
} satisfies Record<string, LString>; /** Finder string table: every user-visible string in English and Korean, grouped by where it appears. */

export const TAG_COLORS: { id: string; color: string; name: LString }[] = [
  { id: 'red', color: 'var(--red)', name: { en: 'Red', ko: '빨간색' } },
  { id: 'orange', color: 'var(--orange)', name: { en: 'Orange', ko: '주황색' } },
  { id: 'yellow', color: 'var(--yellow)', name: { en: 'Yellow', ko: '노란색' } },
  { id: 'green', color: 'var(--green)', name: { en: 'Green', ko: '초록색' } },
  { id: 'blue', color: 'var(--blue)', name: { en: 'Blue', ko: '파란색' } },
  { id: 'purple', color: 'var(--purple)', name: { en: 'Purple', ko: '보라색' } },
  { id: 'gray', color: 'var(--gray)', name: { en: 'Gray', ko: '회색' } },
]; /** Color tags offered in Finder, in menu order: tag id, swatch color (CSS variable) and localized name. */

/**
 * Looks up the swatch color of a tag.
 *
 * Searches `TAG_COLORS` for the id and returns its CSS color. A missing id or an id that is
 * not in the list yields undefined, so callers can skip drawing the tag dot.
 *
 * @param {string | undefined} id - Tag id from an item's meta, or undefined for an untagged item.
 * @returns {string | undefined} The CSS color of the tag, or undefined when untagged or unknown.
 *
 * @example
 * tagColor('red'); // 'var(--red)'
 * tagColor(undefined); // undefined
 */
export function tagColor(id: string | undefined): string | undefined {
  return id ? TAG_COLORS.find((c) => c.id === id)?.color : undefined;
}

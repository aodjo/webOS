/**
 * Data for the keyboard shortcuts reference shown by Tips → Keyboard Shortcuts.
 *
 * The rows mirror the shortcuts the shell, Finder and the document apps register (systemMenus.ts
 * and each app's menus). System-wide commands read their keys from SYSTEM_SHORTCUTS, which differ
 * between Mac and other hosts.
 */
import { SYSTEM_SHORTCUTS } from '@/kernel';

type L = { en: string; ko: string };

/** One line of the reference: a localized label and the keys that trigger it. */
export interface ShortcutRow {
  label: L;
  /** Shortcuts in MenuItem.shortcut syntax. */
  keys: string[];
  /** How multiple keys relate: alternatives ("or", default) or one per action ("/"). */
  join?: 'or' | 'slash';
}

/** A titled section of the reference. */
export interface ShortcutGroup {
  /** Identifies the section; used as its React key and to pick its heading icon. */
  id: 'system' | 'windows' | 'finder' | 'text';
  title: L;
  rows: ShortcutRow[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'system',
    title: { en: 'System', ko: '시스템' },
    rows: [
      { label: { en: 'Spotlight search', ko: 'Spotlight 검색' }, keys: [SYSTEM_SHORTCUTS.spotlight] },
      { label: { en: 'Mission Control', ko: 'Mission Control' }, keys: [SYSTEM_SHORTCUTS.missionControl] },
      { label: { en: 'Launchpad', ko: 'Launchpad' }, keys: [SYSTEM_SHORTCUTS.launchpad] },
      { label: { en: 'Show Desktop', ko: '데스크탑 보기' }, keys: [SYSTEM_SHORTCUTS.showDesktop] },
      { label: { en: 'System Settings', ko: '시스템 설정' }, keys: ['mod+,'] },
      { label: { en: 'Force Quit Applications', ko: '응용 프로그램 강제 종료' }, keys: [SYSTEM_SHORTCUTS.forceQuit] },
      // Only bound on Mac hosts (elsewhere the chord would shadow app shortcuts).
      ...(SYSTEM_SHORTCUTS.lockScreen ? [{ label: { en: 'Lock Screen', ko: '화면 잠금' }, keys: [SYSTEM_SHORTCUTS.lockScreen] }] : []),
    ],
  },
  {
    id: 'windows',
    title: { en: 'Apps & Windows', ko: '앱 및 윈도우' },
    rows: [
      { label: { en: 'Switch apps', ko: '앱 전환' }, keys: ['alt+tab'] },
      { label: { en: 'New window or document', ko: '새로운 윈도우 또는 문서' }, keys: ['alt+n'] },
      { label: { en: 'Close window', ko: '윈도우 닫기' }, keys: ['alt+w'] },
      { label: { en: 'Minimize window', ko: '윈도우 최소화' }, keys: ['alt+m'] },
      { label: { en: 'Cycle through windows', ko: '윈도우 순환' }, keys: ['mod+`'] },
      { label: { en: 'Hide app', ko: '앱 가리기' }, keys: ['alt+h'] },
      { label: { en: 'Hide others', ko: '기타 가리기' }, keys: ['alt+shift+h'] },
      { label: { en: 'Quit app', ko: '앱 종료' }, keys: ['alt+q'] },
      { label: { en: 'Tile window to the left', ko: '윈도우를 왼쪽에 배치' }, keys: [SYSTEM_SHORTCUTS.tileLeft] },
      { label: { en: 'Tile window to the right', ko: '윈도우를 오른쪽에 배치' }, keys: [SYSTEM_SHORTCUTS.tileRight] },
      { label: { en: 'Fill screen', ko: '화면 채우기' }, keys: [SYSTEM_SHORTCUTS.fillScreen] },
    ],
  },
  {
    id: 'finder',
    title: { en: 'Finder', ko: 'Finder' },
    rows: [
      { label: { en: 'Quick Look', ko: '훑어보기' }, keys: ['space'] },
      { label: { en: 'Open', ko: '열기' }, keys: ['mod+o'] },
      { label: { en: 'Get Info', ko: '정보 가져오기' }, keys: ['mod+i'] },
      { label: { en: 'Duplicate', ko: '복제' }, keys: ['mod+d'] },
      { label: { en: 'Move to Trash', ko: '휴지통으로 이동' }, keys: ['mod+backspace'] },
      { label: { en: 'Delete immediately', ko: '즉시 삭제' }, keys: ['mod+alt+backspace'] },
      { label: { en: 'Empty Trash (on the desktop)', ko: '휴지통 비우기(데스크탑에서)' }, keys: ['mod+shift+backspace'] },
      { label: { en: 'New folder', ko: '새로운 폴더' }, keys: ['alt+shift+n'] },
      { label: { en: 'Find', ko: '찾기' }, keys: ['mod+f'] },
      { label: { en: 'Go to Folder', ko: '폴더로 이동' }, keys: ['mod+shift+g'] },
      { label: { en: 'Back / Forward', ko: '뒤로 / 앞으로' }, keys: ['mod+[', 'mod+]'], join: 'slash' },
      { label: { en: 'Enclosing folder', ko: '상위 폴더' }, keys: ['mod+up'] },
      { label: { en: 'View as icons, list, columns, gallery', ko: '아이콘, 목록, 계층, 갤러리로 보기' }, keys: ['mod+1', 'mod+2', 'mod+3', 'mod+4'], join: 'slash' },
      { label: { en: 'Show hidden files', ko: '숨김 파일 보기' }, keys: ['mod+shift+.'] },
    ],
  },
  {
    id: 'text',
    title: { en: 'Text & Documents', ko: '텍스트 및 문서' },
    rows: [
      { label: { en: 'Copy', ko: '복사하기' }, keys: ['mod+c'] },
      { label: { en: 'Cut', ko: '오려두기' }, keys: ['mod+x'] },
      { label: { en: 'Paste', ko: '붙여넣기' }, keys: ['mod+v'] },
      { label: { en: 'Undo', ko: '실행 취소' }, keys: ['mod+z'] },
      { label: { en: 'Redo', ko: '실행 복귀' }, keys: ['mod+shift+z'] },
      { label: { en: 'Select all', ko: '전체 선택' }, keys: ['mod+a'] },
      { label: { en: 'Find', ko: '찾기' }, keys: ['mod+f'] },
      { label: { en: 'Open…', ko: '열기…' }, keys: ['mod+o'] },
      { label: { en: 'Save', ko: '저장' }, keys: ['mod+s'] },
      { label: { en: 'Save As…', ko: '다른 이름으로 저장…' }, keys: ['mod+shift+s'] },
    ],
  },
]; /** Every section of the keyboard shortcuts reference, in display order. */

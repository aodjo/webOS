/**
 * Registry of every System Settings pane: id (used by `args.pane`), name, icon, sidebar group
 * and search keywords, plus lookup helpers.
 */
import type { ComponentType } from 'react';
import {
  Accessibility,
  Bell,
  Bluetooth,
  Dock,
  Globe,
  HardDrive,
  Image,
  Info,
  Lock,
  Moon,
  RefreshCw,
  RotateCcw,
  Settings as Gear,
  SlidersHorizontal,
  Sun,
  SunMoon,
  Users,
  Volume2,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { LString } from '@/kernel/types';
import { WifiPane, BluetoothPane } from './panes/Network';
import { AboutPane, GeneralPane, LanguagePane, ResetPane, SoftwareUpdatePane } from './panes/General';
import { StoragePane } from './panes/Storage';
import { AccessibilityPane, AppearancePane, ControlCenterPane } from './panes/Appearance';
import { DesktopDockPane, DisplaysPane, WallpaperPane } from './panes/Desktop';
import { SoundPane } from './panes/Sound';
import { FocusPane, NotificationsPane } from './panes/Notifications';
import { LockScreenPane, UsersPane } from './panes/Users';
import { searchPanes } from './search';

/** Definition of one System Settings pane. */
export interface PaneDef {
  /** Stable id, accepted in `args.pane` and stored as the last pane. */
  id: string;
  name: LString;
  icon: LucideIcon;
  /** Background color of the sidebar icon tile. */
  color: string;
  /** Sidebar group. Panes without a group are opened from their `parent` (General). */
  group?: number;
  /** Id of the pane that links to this one when it has no sidebar group. */
  parent?: string;
  /** Extra search terms (English and Korean) matched by the sidebar search field. */
  keywords: string[];
  /** Component rendered in the detail area. */
  component: ComponentType;
}

export const PANES: PaneDef[] = [
  { id: 'wifi', name: 'Wi-Fi', icon: Wifi, color: '#0a84ff', group: 1, keywords: ['network', 'internet', 'wireless', 'wlan', '네트워크', '인터넷', '무선'], component: WifiPane },
  { id: 'bluetooth', name: 'Bluetooth', icon: Bluetooth, color: '#0a84ff', group: 1, keywords: ['devices', 'airpods', 'keyboard', 'mouse', 'headphones', '기기', '키보드', '마우스', '헤드폰'], component: BluetoothPane },

  { id: 'general', name: { en: 'General', ko: '일반' }, icon: Gear, color: '#8e8e93', group: 2, keywords: ['general', '일반'], component: GeneralPane },
  { id: 'accessibility', name: { en: 'Accessibility', ko: '손쉬운 사용' }, icon: Accessibility, color: '#0a84ff', group: 2, keywords: ['motion', 'animation', 'transparency', '동작', '애니메이션', '투명도'], component: AccessibilityPane },
  { id: 'appearance', name: { en: 'Appearance', ko: '화면 모드' }, icon: SunMoon, color: '#3a3a3c', group: 2, keywords: ['dark mode', 'light mode', 'theme', 'accent', 'color', '다크 모드', '라이트 모드', '테마', '강조 색상', '색상'], component: AppearancePane },
  { id: 'control-center', name: { en: 'Control Center', ko: '제어 센터' }, icon: SlidersHorizontal, color: '#8e8e93', group: 2, keywords: ['clock', 'menu bar', '24-hour', 'seconds', 'time', '시계', '메뉴 막대', '24시간', '초', '시간'], component: ControlCenterPane },
  { id: 'desktop-dock', name: { en: 'Desktop & Dock', ko: '데스크탑 및 Dock' }, icon: Dock, color: '#3a3a3c', group: 2, keywords: ['dock', 'magnification', 'hidden files', 'autohide', '확대', '숨김 파일', '자동으로 가리기'], component: DesktopDockPane },
  { id: 'displays', name: { en: 'Displays', ko: '디스플레이' }, icon: Sun, color: '#0a84ff', group: 2, keywords: ['brightness', 'night shift', 'resolution', 'screen', 'refresh rate', '밝기', '해상도', '화면', '재생률'], component: DisplaysPane },
  { id: 'wallpaper', name: { en: 'Wallpaper', ko: '배경화면' }, icon: Image, color: '#32ade6', group: 2, keywords: ['background', 'desktop picture', 'photo', '바탕화면', '배경', '사진'], component: WallpaperPane },

  { id: 'notifications', name: { en: 'Notifications', ko: '알림' }, icon: Bell, color: '#ff3b30', group: 3, keywords: ['alerts', 'banners', 'notification center', '배너', '알림 센터'], component: NotificationsPane },
  { id: 'sound', name: { en: 'Sound', ko: '사운드' }, icon: Volume2, color: '#ff2d55', group: 3, keywords: ['volume', 'alert sound', 'output', 'startup chime', 'speaker', '음량', '경고음', '출력', '시동음', '스피커'], component: SoundPane },
  { id: 'focus', name: { en: 'Focus', ko: '집중 모드' }, icon: Moon, color: '#5e5ce6', group: 3, keywords: ['do not disturb', 'dnd', '방해 금지', '방해금지'], component: FocusPane },

  { id: 'lock-screen', name: { en: 'Lock Screen', ko: '잠금 화면' }, icon: Lock, color: '#3a3a3c', group: 4, keywords: ['lock', 'password', 'sleep', 'screen saver', '잠금', '암호', '잠자기'], component: LockScreenPane },
  { id: 'users', name: { en: 'Users & Groups', ko: '사용자 및 그룹' }, icon: Users, color: '#0a84ff', group: 4, keywords: ['account', 'password', 'avatar', 'picture', 'name', 'login', '계정', '암호', '사진', '이름', '로그인'], component: UsersPane },

  { id: 'about', name: { en: 'About', ko: '정보' }, icon: Info, color: '#8e8e93', parent: 'general', keywords: ['about', 'computer', 'chip', 'memory', 'serial', 'browser', 'version', '컴퓨터', '칩', '메모리', '일련 번호', '브라우저', '버전'], component: AboutPane },
  { id: 'software-update', name: { en: 'Software Update', ko: '소프트웨어 업데이트' }, icon: RefreshCw, color: '#8e8e93', parent: 'general', keywords: ['update', 'upgrade', 'version', '업데이트', '버전'], component: SoftwareUpdatePane },
  { id: 'storage', name: { en: 'Storage', ko: '저장 공간' }, icon: HardDrive, color: '#8e8e93', parent: 'general', keywords: ['disk', 'space', 'quota', 'trash', 'indexeddb', '디스크', '용량', '휴지통'], component: StoragePane },
  { id: 'language', name: { en: 'Language & Region', ko: '언어 및 지역' }, icon: Globe, color: '#0a84ff', parent: 'general', keywords: ['language', 'region', 'locale', 'korean', 'english', '한국어', '영어', '언어', '지역'], component: LanguagePane },
  { id: 'reset', name: { en: 'Transfer or Reset', ko: '전송 또는 재설정' }, icon: RotateCcw, color: '#8e8e93', parent: 'general', keywords: ['erase', 'reset', 'factory', 'wipe', '지우기', '초기화', '재설정'], component: ResetPane },
]; /** Every pane in sidebar order; search results keep this order among equal scores. */

const BY_ID = new Map(PANES.map((p) => [p.id, p])); /** Pane lookup by id. */

const ALIASES: Record<string, string> = {
  network: 'wifi',
  'wi-fi': 'wifi',
  dock: 'desktop-dock',
  desktop: 'wallpaper',
  background: 'wallpaper',
  display: 'displays',
  notification: 'notifications',
  dnd: 'focus',
  password: 'users',
  user: 'users',
  account: 'users',
  'language-region': 'language',
  'software-updates': 'software-update',
  update: 'software-update',
  theme: 'appearance',
}; /** Friendly aliases accepted in `args.pane` (e.g. from other apps) → canonical pane id. */

export const DEFAULT_PANE = 'appearance'; /** Pane shown when no valid pane is requested or remembered. */

/**
 * Resolves a requested pane id or alias to its definition.
 *
 * The value is trimmed and lowercased, then looked up first as a pane id and then through
 * `ALIASES`. Non-string values (e.g. a missing `args.pane`) resolve to nothing.
 *
 * @param {unknown} value - Requested pane id or alias, typically from window args or prefs.
 * @returns {PaneDef | undefined} The matching pane, or undefined when nothing matches.
 *
 * @example
 * resolvePane(' Dock ')?.id; // 'desktop-dock'
 * resolvePane(42); // undefined
 */
export function resolvePane(value: unknown): PaneDef | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim().toLowerCase();
  return BY_ID.get(id) ?? BY_ID.get(ALIASES[id] ?? '');
}

/**
 * Returns the pane with the given id, falling back to the default pane.
 *
 * Unlike `resolvePane`, aliases are not accepted; an unknown id yields the `DEFAULT_PANE`
 * definition so callers always get something to render.
 *
 * @param {string} id - Exact pane id.
 * @returns {PaneDef} The matching pane or the default pane.
 *
 * @example
 * getPane('sound').id; // 'sound'
 * getPane('nope').id; // 'appearance'
 */
export function getPane(id: string): PaneDef {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_PANE)!;
}

export const SIDEBAR_GROUPS: PaneDef[][] = [1, 2, 3, 4].map((g) => PANES.filter((p) => p.group === g)); /** Sidebar sections: panes of groups 1–4 in registry order. */

/**
 * Searches all registered panes.
 *
 * Delegates to `searchPanes`, matching names in every language and keywords, ranked by
 * relevance and then by registry order.
 *
 * @param {string} query - Search text typed by the user.
 * @returns {PaneDef[]} Matching panes, best first; empty for a blank query.
 *
 * @example
 * findPanes('dark').map((p) => p.id); // ['appearance']
 */
export function findPanes(query: string): PaneDef[] {
  return searchPanes(PANES, query);
}

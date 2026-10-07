/**
 * App registry. Every app lives in src/apps/<id>/ and default-exports its window component
 * from index.tsx, which is lazy-loaded on first launch. Importing this module registers every
 * manifest with the kernel; add a new app by appending its manifest to `APPS`.
 */
import type { AppManifest } from '@/kernel/types';
import { registerApps } from '@/kernel/registry';
import { lazyApp } from '@/kernel/lazyApp';
import { useUI } from '@/kernel/ui';
import * as I from '@/icons';

const TEXT_EXT = ['txt', 'md', 'markdown', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'xml', 'plist', 'csv', 'log', 'sh', 'py', 'yml', 'yaml', 'webloc', 'url', '']; /** File extensions TextEdit opens; the empty string matches files without an extension. */

export const APPS: AppManifest[] = [
  {
    id: 'finder',
    name: 'Finder',
    icon: I.FinderIcon,
    component: lazyApp(() => import('./finder'), 'finder'),
    window: { width: 920, height: 560, minWidth: 520, minHeight: 300, titlebar: 'overlay', vibrancy: true },
    opens: ['dir'],
    persistent: true,
    category: 'system',
    bundleId: 'com.webos.finder',
  },
  {
    id: 'launchpad',
    name: 'Launchpad',
    icon: I.LaunchpadIcon,
    /**
     * Toggles the Launchpad overlay instead of opening a window.
     *
     * Launchpad is a pseudo app with no window component: launching it flips the
     * `launchpad` flag in the UI store, so launching it again hides the overlay.
     *
     * @returns {void} Nothing.
     *
     * @example
     * wm.launch('launchpad'); // shows Launchpad, or hides it when already visible
     */
    onLaunch: () => useUI.getState().set({ launchpad: !useUI.getState().launchpad }),
    category: 'system',
  },
  {
    id: 'safari',
    name: 'Safari',
    description: { en: 'Browse the web', ko: '웹 브라우징' },
    icon: I.SafariIcon,
    component: lazyApp(() => import('./safari'), 'safari'),
    window: { width: 1080, height: 700, minWidth: 480, minHeight: 320, titlebar: 'overlay' },
    opens: ['webloc', 'url', 'html', 'htm'],
    category: 'utility',
    bundleId: 'com.webos.safari',
  },
  {
    id: 'mail',
    name: { en: 'Mail', ko: '메일' },
    description: { en: 'Get in touch', ko: '연락하기' },
    icon: I.MailIcon,
    component: lazyApp(() => import('./mail'), 'mail'),
    window: { width: 980, height: 620, minWidth: 620, minHeight: 360, titlebar: 'overlay' },
    category: 'portfolio',
    bundleId: 'com.webos.mail',
  },
  {
    id: 'notes',
    name: { en: 'Notes', ko: '메모' },
    icon: I.NotesIcon,
    component: lazyApp(() => import('./notes'), 'notes'),
    window: { width: 880, height: 560, minWidth: 520, minHeight: 300, titlebar: 'overlay' },
    singleWindow: true,
    category: 'utility',
    bundleId: 'com.webos.notes',
  },
  {
    id: 'about-me',
    name: { en: 'About Me', ko: '내 소개' },
    description: { en: 'Who I am', ko: '저에 대해' },
    icon: I.AboutMeIcon,
    component: lazyApp(() => import('./about-me'), 'about-me'),
    window: { width: 780, height: 580, minWidth: 520, minHeight: 400, titlebar: 'overlay' },
    singleWindow: true,
    category: 'portfolio',
    bundleId: 'com.webos.aboutme',
  },
  {
    id: 'projects',
    name: { en: 'Projects', ko: '프로젝트' },
    description: { en: 'Things I built', ko: '작업물' },
    icon: I.ProjectsIcon,
    component: lazyApp(() => import('./projects'), 'projects'),
    window: { width: 1020, height: 660, minWidth: 560, minHeight: 400, titlebar: 'overlay' },
    singleWindow: true,
    category: 'portfolio',
    bundleId: 'com.webos.projects',
  },
  {
    id: 'terminal',
    name: { en: 'Terminal', ko: '터미널' },
    icon: I.TerminalIcon,
    component: lazyApp(() => import('./terminal'), 'terminal'),
    window: { width: 720, height: 460, minWidth: 360, minHeight: 200 },
    opens: ['sh'],
    category: 'utility',
    bundleId: 'com.webos.terminal',
  },
  {
    id: 'textedit',
    name: { en: 'TextEdit', ko: '텍스트 편집기' },
    icon: I.TextEditIcon,
    component: lazyApp(() => import('./textedit'), 'textedit'),
    window: { width: 720, height: 560, minWidth: 360, minHeight: 240 },
    opens: TEXT_EXT,
    category: 'utility',
    bundleId: 'com.webos.textedit',
  },
  {
    id: 'preview',
    name: { en: 'Preview', ko: '미리보기' },
    icon: I.PreviewIcon,
    component: lazyApp(() => import('./preview'), 'preview'),
    window: { width: 780, height: 580, minWidth: 320, minHeight: 240 },
    opens: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'pdf', 'md', 'markdown', 'mp3', 'wav', 'm4a', 'mp4', 'webm', 'mov'],
    category: 'utility',
    bundleId: 'com.webos.preview',
  },
  {
    id: 'calculator',
    name: { en: 'Calculator', ko: '계산기' },
    icon: I.CalculatorIcon,
    component: lazyApp(() => import('./calculator'), 'calculator'),
    window: { width: 232, height: 380, resizable: false, maximizable: false, titlebar: 'overlay' },
    singleWindow: true,
    category: 'utility',
    bundleId: 'com.webos.calculator',
  },
  {
    id: 'settings',
    name: { en: 'System Settings', ko: '시스템 설정' },
    icon: I.SettingsIcon,
    component: lazyApp(() => import('./settings'), 'settings'),
    window: { width: 760, height: 580, minWidth: 640, minHeight: 420, maximizable: false, titlebar: 'overlay', vibrancy: true },
    singleWindow: true,
    category: 'system',
    bundleId: 'com.webos.settings',
  },
  {
    id: 'activity-monitor',
    name: { en: 'Activity Monitor', ko: '활성 상태 보기' },
    icon: I.ActivityMonitorIcon,
    component: lazyApp(() => import('./activity-monitor'), 'activity-monitor'),
    window: { width: 820, height: 520, minWidth: 560, minHeight: 300, titlebar: 'overlay' },
    singleWindow: true,
    category: 'system',
    bundleId: 'com.webos.activitymonitor',
  },
  {
    id: 'minesweeper',
    name: { en: 'Minesweeper', ko: '지뢰 찾기' },
    icon: I.MinesweeperIcon,
    component: lazyApp(() => import('./minesweeper'), 'minesweeper'),
    window: { width: 330, height: 430, resizable: false, maximizable: false },
    singleWindow: true,
    category: 'game',
    bundleId: 'com.webos.minesweeper',
  },
  {
    id: 'welcome',
    name: { en: 'Tips', ko: '팁' },
    description: { en: 'Getting started', ko: '시작하기' },
    icon: I.WelcomeIcon,
    component: lazyApp(() => import('./welcome'), 'welcome'),
    window: { width: 680, height: 500, resizable: false, maximizable: false, titlebar: 'overlay' },
    singleWindow: true,
    category: 'system',
    bundleId: 'com.webos.tips',
  },
  {
    id: 'about-this-mac',
    name: { en: 'About This Computer', ko: '이 컴퓨터에 관하여' },
    icon: I.AboutThisMacIcon,
    component: lazyApp(() => import('./about-this-mac'), 'about-this-mac'),
    window: { width: 300, height: 440, resizable: false, maximizable: false, titlebar: 'overlay' },
    singleWindow: true,
    hidden: true,
    category: 'system',
    bundleId: 'com.webos.about',
  },
]; /** Manifests of every built-in app; their order here is the order `listApps()` returns them in. */

registerApps(APPS);

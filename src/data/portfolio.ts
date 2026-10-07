/**
 * PORTFOLIO DATA — edit this file to make the OS yours.
 *
 * Every user-facing string can be a plain string or { en, ko }. Everything else in the OS
 * (Finder files, Terminal commands, About Me, Projects, Mail, Spotlight…) is generated from
 * this file.
 */
import type { LString } from '@/kernel/types';

export const osInfo = {
  /** OS name shown in About This Computer, System Settings, the startup disk name, Mail and Terminal `uname`. */
  name: 'webOS',
  version: '1.0',
  codename: { en: 'Hallasan', ko: '한라산' } as LString,
  build: '26A1002',
  machine: { en: 'Portfolio Book Pro', ko: 'Portfolio Book Pro' } as LString,
  machineShort: 'PortfolioBook',
  chip: 'React 19 · TypeScript',
  memory: '16 GB',
  year: 2026,
}; /** Identity and simulated hardware specs of the OS, shown in About This Computer, System Settings and Terminal commands such as `uname`. */

export const owner = {
  /** Unix user name, used for the home folder (/Users/<handle>) and the shell prompt. */
  handle: 'aodjo',
  name: 'aod_jo' as LString,
  role: { en: 'Frontend Engineer', ko: '프론트엔드 엔지니어' } as LString,
  location: { en: 'Seoul, South Korea', ko: '대한민국 서울' } as LString,
  /** One-line summary used as the About Me headline and shown in Tips, the Safari portfolio page, the résumé and Terminal `about`. */
  tagline: {
    en: 'I build interfaces that feel like real software.',
    ko: '진짜 소프트웨어처럼 느껴지는 인터페이스를 만듭니다.',
  } as LString,
  /** Longer bio, written in Markdown; the welcome email quotes only its first paragraph. */
  bio: {
    en:
      "Hi, I'm a frontend engineer who loves the details — window physics, keyboard shortcuts, the 200ms that make an animation feel right.\n\n" +
      'This website is itself my portfolio: a small operating system that runs entirely in your browser. Poke around — open Finder, try the Terminal, drag files to the Trash.',
    ko:
      '안녕하세요! 디테일을 사랑하는 프론트엔드 엔지니어입니다 — 창이 움직이는 물리감, 키보드 단축키, 애니메이션을 자연스럽게 만드는 200ms 같은 것들이요.\n\n' +
      '이 웹사이트 자체가 제 포트폴리오입니다: 브라우저 안에서 완전히 동작하는 작은 운영체제예요. Finder를 열고, 터미널을 써보고, 파일을 휴지통에 끌어다 놓아보세요.',
  } as LString,
  /** Contact address used as the sender in Mail and in the résumé and contact links. TODO: replace with your real contact info. */
  email: 'hello@example.com',
  /** Profile URLs; leave a field empty to hide that link. */
  links: {
    github: 'https://github.com/aodjo',
    linkedin: '',
    blog: '',
    website: '',
  },
  avatar: '/avatar.svg',
  resume: '/resume.pdf',
}; /** The portfolio owner's profile: identity, bio, contact details, links, avatar and résumé paths. */

/** One skill and its proficiency. */
export interface Skill {
  name: string;
  /** Proficiency on a 1–5 scale. */
  level: number;
}

export const skills: { category: LString; items: Skill[] }[] = [
  {
    category: { en: 'Languages', ko: '언어' },
    items: [
      { name: 'TypeScript', level: 5 },
      { name: 'JavaScript', level: 5 },
      { name: 'HTML / CSS', level: 5 },
      { name: 'Python', level: 3 },
    ],
  },
  {
    category: { en: 'Frontend', ko: '프론트엔드' },
    items: [
      { name: 'React', level: 5 },
      { name: 'Next.js', level: 4 },
      { name: 'Zustand', level: 4 },
      { name: 'Vite', level: 4 },
      { name: 'Tailwind CSS', level: 4 },
    ],
  },
  {
    category: { en: 'Backend & Infra', ko: '백엔드 & 인프라' },
    items: [
      { name: 'Node.js', level: 4 },
      { name: 'Cloudflare Workers', level: 3 },
      { name: 'PostgreSQL', level: 3 },
    ],
  },
  {
    category: { en: 'Tools', ko: '도구' },
    items: [
      { name: 'Git', level: 5 },
      { name: 'Figma', level: 4 },
      { name: 'Vitest / Playwright', level: 4 },
    ],
  },
]; /** Skills grouped by category, shown in About Me, the Safari portfolio page, the résumé and Terminal `skills`, and searchable from Spotlight. */

/** One job in the work history. */
export interface Experience {
  company: LString;
  role: LString;
  /** Date range such as '2024 — Present'; the word 'Present' is localized when displayed. */
  period: string;
  description: LString;
  highlights: LString[];
}

export const experience: Experience[] = [
  {
    company: { en: 'Example Corp.', ko: '예시 주식회사' },
    role: { en: 'Frontend Engineer', ko: '프론트엔드 엔지니어' },
    period: '2024 — Present',
    description: {
      en: 'Building the design system and the customer dashboard.',
      ko: '디자인 시스템과 고객 대시보드를 만들고 있습니다.',
    },
    highlights: [
      { en: 'Cut dashboard load time by 48% with route-level code splitting.', ko: '라우트 단위 코드 스플리팅으로 대시보드 로딩 시간 48% 단축.' },
      { en: 'Led migration of 120+ components to the new design system.', ko: '120개 이상의 컴포넌트를 새 디자인 시스템으로 마이그레이션 주도.' },
    ],
  },
  {
    company: { en: 'Startup Studio', ko: '스타트업 스튜디오' },
    role: { en: 'Web Developer (Intern)', ko: '웹 개발자 (인턴)' },
    period: '2023 — 2024',
    description: {
      en: 'Shipped marketing sites and internal tools for early-stage products.',
      ko: '초기 단계 제품의 마케팅 사이트와 사내 도구를 개발했습니다.',
    },
    highlights: [
      { en: 'Built 6 landing pages with Lighthouse 95+ scores.', ko: 'Lighthouse 95점 이상의 랜딩 페이지 6개 제작.' },
    ],
  },
]; /** Work history, newest first (the résumé email presents the first entry as the current job); shown in About Me, the résumé, the Safari portfolio page and Terminal `experience`. TODO: replace with your real experience. */

export const education: { school: LString; degree: LString; period: string }[] = [
  {
    school: { en: 'Example University', ko: '예시대학교' },
    degree: { en: 'B.S. Computer Science', ko: '컴퓨터공학 학사' },
    period: '2019 — 2025',
  },
]; /** Schools and degrees, shown in About Me, the résumé, the Safari portfolio page and Terminal `experience`. */

/** One portfolio project, shown in the Projects app, Finder, Spotlight and Mail. */
export interface Project {
  /** Unique slug that identifies the project (e.g. when Mail or Spotlight opens it in the Projects app) and names its cover copy ~/Pictures/<id>.svg. */
  id: string;
  name: string;
  year: number;
  tagline: LString;
  /** Longer description, written in Markdown. */
  description: LString;
  role: LString;
  tags: string[];
  /** Public asset path of the cover image. */
  cover: string;
  /** Accent color painted behind the cover (the `--c` CSS variable) in the Projects app, Mail and Spotlight. */
  color: string;
  links: { demo?: string; github?: string };
  highlights: LString[];
  /** Shows the project in the Projects hero carousel and the featured-projects email. */
  featured?: boolean;
}

export const projects: Project[] = [
  {
    id: 'webos',
    name: 'webOS',
    year: 2026,
    tagline: { en: 'A macOS-like operating system that runs in the browser — this website.', ko: '브라우저에서 동작하는 macOS 스타일 운영체제 — 바로 이 웹사이트.' },
    description: {
      en:
        'A portfolio disguised as an operating system. It has a real window manager (drag, resize, snap, minimize to the Dock), ' +
        'a persistent virtual file system stored in IndexedDB, a Unix-like shell, and a dozen apps that all talk to the same kernel.',
      ko:
        '운영체제의 모습을 한 포트폴리오입니다. 실제 윈도우 매니저(드래그, 리사이즈, 스냅, Dock으로 최소화), ' +
        'IndexedDB에 저장되는 영구 가상 파일 시스템, 유닉스 스타일 셸, 그리고 같은 커널을 공유하는 십여 개의 앱이 있습니다.',
    },
    role: { en: 'Solo — design & engineering', ko: '1인 — 디자인 & 개발' },
    tags: ['React', 'TypeScript', 'Zustand', 'IndexedDB', 'Vite'],
    cover: '/projects/webos.svg',
    color: '#0a84ff',
    links: { github: 'https://github.com/aodjo' },
    highlights: [
      { en: 'Window manager with edge tiling, z-ordering and minimize animations', ko: '엣지 타일링, z-순서, 최소화 애니메이션을 갖춘 윈도우 매니저' },
      { en: 'Virtual file system shared by Finder, Terminal and every app', ko: 'Finder, 터미널, 모든 앱이 공유하는 가상 파일 시스템' },
      { en: 'Bilingual UI (English / 한국어) switchable at runtime', ko: '런타임에 전환 가능한 이중 언어 UI (English / 한국어)' },
    ],
    featured: true,
  },
  {
    id: 'pixel-board',
    name: 'Pixel Board',
    year: 2025,
    tagline: { en: 'Real-time collaborative pixel canvas.', ko: '실시간 협업 픽셀 캔버스.' },
    description: {
      en: 'A multiplayer canvas where thousands of users place pixels together. Built on WebSockets with optimistic updates and a CRDT-based merge strategy.',
      ko: '수천 명의 사용자가 함께 픽셀을 찍는 멀티플레이어 캔버스. 낙관적 업데이트와 CRDT 기반 병합 전략을 사용한 WebSocket 기반 서비스입니다.',
    },
    role: { en: 'Frontend lead', ko: '프론트엔드 리드' },
    tags: ['Canvas', 'WebSocket', 'CRDT', 'Cloudflare'],
    cover: '/projects/pixel-board.svg',
    color: '#ff375f',
    links: {},
    highlights: [
      { en: '60fps rendering of a 1000×1000 canvas', ko: '1000×1000 캔버스 60fps 렌더링' },
      { en: 'Conflict-free merges across regions', ko: '리전 간 충돌 없는 병합' },
    ],
    featured: true,
  },
  {
    id: 'budget-buddy',
    name: 'Budget Buddy',
    year: 2024,
    tagline: { en: 'A personal finance tracker with natural-language input.', ko: '자연어로 입력하는 개인 가계부.' },
    description: {
      en: 'Type "coffee 4500 yesterday" and it just works. Offline-first PWA with charts, budgets and CSV export.',
      ko: '"어제 커피 4500"이라고 입력하면 끝. 차트, 예산, CSV 내보내기를 지원하는 오프라인 우선 PWA입니다.',
    },
    role: { en: 'Solo', ko: '1인 개발' },
    tags: ['PWA', 'React', 'IndexedDB', 'Charts'],
    cover: '/projects/budget-buddy.svg',
    color: '#30d158',
    links: {},
    highlights: [
      { en: 'Works fully offline', ko: '완전한 오프라인 동작' },
      { en: 'Natural-language parser with 95% accuracy on test set', ko: '테스트 셋 기준 95% 정확도의 자연어 파서' },
    ],
  },
  {
    id: 'type-racer',
    name: 'Type Racer KR',
    year: 2023,
    tagline: { en: 'Typing game that understands Hangul composition.', ko: '한글 조합을 이해하는 타자 게임.' },
    description: {
      en: 'A typing speed game that correctly measures Korean typing by decomposing syllables into jamo in real time.',
      ko: '음절을 실시간으로 자모 단위로 분해해 한글 타자 속도를 정확하게 측정하는 타자 게임입니다.',
    },
    role: { en: 'Solo', ko: '1인 개발' },
    tags: ['TypeScript', 'Hangul', 'Game'],
    cover: '/projects/type-racer.svg',
    color: '#ff9f0a',
    links: {},
    highlights: [
      { en: 'Jamo-level accuracy tracking', ko: '자모 단위 정확도 측정' },
    ],
  },
]; /** Portfolio projects; each also gets a Finder folder ~/Documents/Projects/<name>, and the first one's cover becomes the Desktop screenshot. TODO: replace with your real projects. */

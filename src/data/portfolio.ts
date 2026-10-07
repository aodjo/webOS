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
  role: { en: 'Full-stack Engineer', ko: '풀스택 엔지니어' } as LString,
  location: { en: 'Seoul, South Korea', ko: '대한민국 서울' } as LString,
  /** One-line summary used as the About Me headline and shown in Tips, the Safari portfolio page, the résumé and Terminal `about`. */
  tagline: {
    en: 'I build products end to end, from the interface to the server.',
    ko: '화면부터 서버까지, 제품을 처음부터 끝까지 만듭니다.',
  } as LString,
  /** Longer bio, written in Markdown; the welcome email quotes only its first paragraph. */
  bio: {
    en:
      'I first started programming in fifth grade and have been building programs and websites ever since. ' +
      "I completed the Information Security Gifted Education Program at Mokpo National University, and I'm now studying in the Department of Software at Sunrin Internet High School.",
    ko:
      '저는 초등학교 5학년 때 프로그래밍을 처음 접하고 계속하여 프로그램과 웹사이트를 제작하고 있어요. ' +
      '지금은 **목포대학교 정보보호영재원**을 수료하고, **선린인터넷고등학교 소프트웨어과**에 재학하면서 열심히 공부하고 있어요.'
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
  avatar: '/avatar.jpg',
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

export const experience: Experience[] = []; /** Work history, newest first (the résumé email presents the first entry as the current job); shown in About Me, the résumé, the Safari portfolio page and Terminal `experience`. Leave it empty to show only awards. */

/** One award or competition entry. */
export interface Award {
  /** Month of the event as 'YYYY.MM'. */
  date: string;
  title: LString;
  /** Division, team or entry name, e.g. "Youth division". */
  detail?: LString;
  /** Placing, e.g. "1st place"; omit for an entry without a placing. */
  result?: LString;
  /** Page about the event. */
  href?: string;
}

export const awards: Award[] = [
  {
    date: '2026.02',
    title: 'Grizzly Hacks II',
    detail: { en: 'Entered with BSD', ko: 'BSD로 참가' },
    result: { en: '1st place', ko: '1위' },
    href: 'https://grizzly-hacks-ii.devpost.com/',
  },
  {
    date: '2026.02',
    title: { en: 'JoCoding × OpenAI × Primer AI Hackathon', ko: '조코딩 x OpenAI x Primer AI 해커톤' },
    detail: { en: 'Entered with Gitfle', ko: 'Gitfle로 참가' },
    href: 'https://hack.primer.kr/rounds/8',
  },
  {
    date: '2025.12',
    title: { en: '1st Gamgyul CTF', ko: '제1회 감귤 CTF' },
    detail: { en: 'Youth division', ko: '청소년부' },
    result: { en: '3rd place', ko: '3위' },
    href: 'https://dreamhack.io/ctf/766',
  },
  {
    date: '2025.11',
    title: 'Layer7 CTF 2025',
    detail: { en: 'Youth division', ko: '청소년부' },
    result: { en: '1st place', ko: '1위' },
  },
  {
    date: '2025.10',
    title: { en: '11th KERIS Information Security Competition, team', ko: '제11회 정보보안경진대회 (KERIS) 단체전' },
    result: { en: '2nd place', ko: '2위' },
  },
  {
    date: '2025.10',
    title: { en: '11th KERIS Information Security Competition, individual', ko: '제11회 정보보안경진대회 (KERIS) 개인전' },
    result: { en: '4th place', ko: '4위' },
  },
]; /** Awards and competitions, newest first; shown in About Me, the résumé, the Safari portfolio page and Terminal `experience`. */

export const education: { school: LString; degree: LString; period: string }[] = [
  {
    school: { en: 'Sunrin Internet High School', ko: '선린인터넷고등학교' },
    degree: { en: 'Department of Software (class 121)', ko: '소프트웨어과 (121기)' },
    period: '2026 — Present',
  },
  {
    school: { en: 'Namak Middle School', ko: '전남 남악중학교' },
    degree: { en: 'Graduated', ko: '졸업' },
    period: '2026',
  },
  {
    school: { en: 'Mokpo National University Information Security Gifted Education Center', ko: '목포대학교 정보보호영재교육원' },
    degree: { en: 'Completed the advanced course', ko: '심화과정 수료' },
    period: '2025',
  },
]; /** Schools and programs, newest first, shown in About Me, the résumé, the Safari portfolio page and Terminal `experience`. */

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
    tagline: { en: 'A macOS-style operating system that runs in the browser.', ko: '브라우저에서 동작하는 macOS 스타일 운영체제.' },
    description: {
      en:
        'A portfolio disguised as an operating system. It has a real window manager (drag, resize, snap, minimize to the Dock), ' +
        'a persistent virtual file system stored in IndexedDB, a Unix-like shell, and a dozen apps that all talk to the same kernel.',
      ko:
        '운영체제의 모습을 한 포트폴리오입니다. 실제 윈도우 매니저(드래그, 리사이즈, 스냅, Dock으로 최소화), ' +
        'IndexedDB에 저장되는 영구 가상 파일 시스템, 유닉스 스타일 셸, 그리고 같은 커널을 공유하는 십여 개의 앱이 있습니다.',
    },
    role: { en: 'Solo, design and engineering', ko: '1인 디자인 및 개발' },
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
]; /** Portfolio projects; each also gets a Finder folder ~/Documents/Projects/<name>, and the first one's cover becomes the Desktop screenshot. TODO: replace with your real projects. */

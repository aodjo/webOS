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
  /** One-line summary used as the About Me headline and shown in Tips, the Safari portfolio page and Terminal `about`. */
  tagline: { en: 'Hello! 👋', ko: '안녕하세요! 👋' } as LString,
  /** Longer bio, written in Markdown; the welcome email quotes only its first paragraph. */
  bio: {
    en:
      'I first started programming in fifth grade and have been building programs and websites ever since. ' +
      "I completed the Information Security Gifted Education Program at Mokpo National University, and I'm now studying in the Department of Software at Sunrin Internet High School.",
    ko:
      '저는 초등학교 5학년 때 프로그래밍을 처음 접하고 계속하여 프로그램과 웹사이트를 제작하고 있어요. ' +
      '지금은 **목포대학교 정보보호영재원**을 수료하고, **선린인터넷고등학교 소프트웨어과**에 재학하면서 열심히 공부하고 있어요.'
  } as LString,
  /** Contact address used as the sender in Mail and in the contact links. */
  email: 'me@junx.dev',
  /** Profile URLs; leave a field empty to hide that link. */
  links: {
    github: 'https://github.com/aodjo',
    linkedin: '',
    blog: '',
    website: '',
  },
  avatar: '/avatar.jpg',
  /** Greeting decoded character by character on the boot screen before the logo appears; leave empty to skip it. */
  bootGreeting: "Welcome to Junsung Lee's portfolio!",
}; /** The portfolio owner's profile: identity, bio, contact details, links, avatar and boot greeting. */

/** One skill. */
export interface Skill {
  name: string;
}

export const skills: { category: LString; items: Skill[] }[] = [
  {
    category: { en: 'Languages', ko: '언어' },
    items: [{ name: 'TypeScript' }, { name: 'JavaScript' }, { name: 'HTML / CSS' }, { name: 'Python' }],
  },
  {
    category: { en: 'Frontend', ko: '프론트엔드' },
    items: [{ name: 'React' }, { name: 'Next.js' }, { name: 'Zustand' }, { name: 'Vite' }, { name: 'Tailwind CSS' }],
  },
  {
    category: { en: 'Backend & Infra', ko: '백엔드 & 인프라' },
    items: [{ name: 'Node.js' }, { name: 'Cloudflare Workers' }, { name: 'PostgreSQL' }],
  },
  {
    category: { en: 'Tools', ko: '도구' },
    items: [{ name: 'Git' }, { name: 'Figma' }, { name: 'Vitest / Playwright' }],
  },
]; /** Skills grouped by category, shown in About Me, the Safari portfolio page and Terminal `skills`, and searchable from Spotlight. */

/** One job in the work history. */
export interface Experience {
  company: LString;
  role: LString;
  /** Date range such as '2024 — Present'; the word 'Present' is localized when displayed. */
  period: string;
  description: LString;
  highlights: LString[];
}

export const experience: Experience[] = []; /** Work history, newest first; shown in About Me, the Safari portfolio page and Terminal `experience`. Leave it empty to show only awards. */

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
    date: '2026.10',
    title: { en: '2026 National Park Satellite Monitoring AI Challenge, Track 3', ko: '2026 국립공원 위성 모니터링 AI 챌린지, 주제 3' },
    detail: { en: 'Entered as aod_jo', ko: 'aod_jo로 참가했어요.' },
    href: 'https://aifactory.space/ko/competitions/9306',
  },
  {
    date: '2026.10',
    title: { en: '2026 National Park Satellite Monitoring AI Challenge, Track 4', ko: '2026 국립공원 위성 모니터링 AI 챌린지, 주제 4' },
    detail: { en: 'Entered as aod_jo', ko: 'aod_jo로 참가했어요.' },
    href: 'https://aifactory.space/ko/competitions/9307',
  },
  {
    date: '2026.10',
    title: { en: '5th Korea High School AI & SW Development Contest 2026', ko: '제5회 2026 대한민국 고등학생 AI·SW 개발 공모전' },
    detail: { en: 'Entered with team Knock', ko: '팀 노크로 참가했어요.' },
    href: 'https://www.sw.or.kr/site/sw/ex/board/View.do?cbIdx=292&bcIdx=66137&searchExt1=',
  },
  {
    date: '2026.02',
    title: 'Grizzly Hacks II',
    detail: { en: 'Entered with team BSD', ko: '팀 BSD로 참가했어요.' },
    result: { en: '1st place', ko: '1위' },
    href: 'https://grizzly-hacks-ii.devpost.com/',
  },
  {
    date: '2026.02',
    title: { en: 'JoCoding × OpenAI × Primer AI Hackathon', ko: '조코딩 x OpenAI x Primer AI 해커톤' },
    detail: { en: 'Entered with team Gitfle', ko: '팀 Gitfle로 참가했어요.' },
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
]; /** Awards and competitions, newest first; shown in About Me, the Safari portfolio page and Terminal `experience`. */

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
]; /** Schools and programs, newest first, shown in About Me, the Safari portfolio page and Terminal `experience`. */

/** One portfolio project, shown in the Projects app, Finder, Spotlight and Mail. */
export interface Project {
  /** Unique slug that identifies the project (e.g. when Mail or Spotlight opens it in the Projects app) and names its cover copy ~/Pictures/<id>.<ext>. */
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
  {
    id: 'hankari',
    name: 'Hankari',
    year: 2026,
    tagline: { en: 'Find KakaoTalk bots and request an invite, all in one place.', ko: '카카오톡 봇을 찾고 초대 신청까지 한 번에.' },
    description: {
      en:
        'Hankari (한카리) is a directory of Korean KakaoTalk bots. Visitors search bots by name, command or open chat room, browse them by category, ' +
        'and send an invite request for their own chat room. Monthly rankings, featured bots and an open chat room directory help people discover new bots, ' +
        'and bot developers get an API and documentation under Hankari Devs.',
      ko:
        '한카리는 한국 카카오톡 봇 디렉터리입니다. 봇 이름, 명령어, 오픈채팅방으로 검색하고 카테고리별로 둘러본 뒤 내 채팅방으로 초대 신청을 보낼 수 있습니다. ' +
        '이번 달 랭킹, 추천 봇, 오픈채팅방 목록으로 새 봇을 발견할 수 있고, 봇 개발자를 위한 API와 문서(한카리 Devs)도 제공합니다.',
    },
    role: { en: 'Planning and full-stack development', ko: '기획 및 풀스택 개발' },
    tags: ['KakaoTalk', 'Web', 'API'],
    cover: '/projects/hankari.jpg',
    color: '#ffcc00',
    links: { demo: 'https://hankari.dev/' },
    highlights: [
      { en: 'Bot search by name, command or open chat room', ko: '봇 이름·명령어·오픈채팅방 검색' },
      { en: 'Categories: room management, utilities, attendance and levels, chat statistics, games', ko: '방 관리, 유틸리티, 출석·레벨, 채팅 통계, 게임 등 카테고리' },
      { en: 'Invite requests, monthly heart rankings and an open chat room directory', ko: '초대 신청, 이번 달 하트 랭킹, 오픈채팅방 목록' },
      { en: 'Developer API and documentation (Hankari Devs)', ko: '개발자용 API와 문서 (한카리 Devs)' },
    ],
    featured: true,
  },
  {
    id: 'reprise',
    name: 'Reprise',
    year: 2026,
    tagline: { en: 'A lightweight menu bar music controller for macOS.', ko: 'macOS용 가벼운 메뉴 막대 음악 컨트롤러.' },
    description: {
      en:
        'Reprise puts whatever you are listening to one click away: album art, title and artist, a scrubbable progress bar and playback controls in a single menu bar panel, ' +
        'with time-synced lyrics in the panel and in the menu bar. It follows Apple Music, Spotify and YouTube Music (through a browser extension) automatically, ' +
        'with no account, no API keys and no relay server. Built natively with SwiftUI and released under GPLv3.',
      ko:
        'Reprise는 지금 듣는 음악을 클릭 한 번 거리에 둡니다. 앨범 아트, 곡 제목과 아티스트, 탐색 가능한 진행 막대, 재생 컨트롤을 메뉴 막대 패널 하나에 담고, ' +
        '싱크 가사를 패널과 메뉴 막대에 보여 줍니다. Apple Music, Spotify, YouTube Music(브라우저 확장 프로그램)을 자동으로 따라가며, 계정이나 API 키, 중계 서버가 필요 없습니다. ' +
        'SwiftUI로 만든 네이티브 앱이며 GPLv3로 공개되어 있습니다.',
    },
    role: { en: 'Design and development', ko: '디자인 및 개발' },
    tags: ['Swift', 'SwiftUI', 'macOS', 'JavaScript'],
    cover: '/projects/reprise.jpg',
    color: '#8b5cf6',
    links: { github: 'https://github.com/aodjo/reprise' },
    highlights: [
      { en: 'One control for Apple Music, Spotify and YouTube Music, following whichever is playing', ko: 'Apple Music·Spotify·YouTube Music을 재생 중인 앱에 맞춰 자동으로 제어' },
      { en: 'Time-synced lyrics in the panel and in the menu bar', ko: '패널과 메뉴 막대에 표시되는 싱크 가사' },
      { en: 'Customisable title format, album art style, carousel and panel theme (including Liquid)', ko: '제목 형식, 앨범 아트 스타일, 캐러셀, 패널 테마(Liquid 포함) 설정' },
      { en: 'Distributed through Homebrew and GitHub Releases', ko: 'Homebrew와 GitHub Releases로 배포' },
    ],
    featured: true,
  },
  {
    id: 'mactree',
    name: 'MacTree',
    year: 2026,
    tagline: { en: 'A fast disk usage analyzer for macOS, like WizTree.', ko: 'WizTree처럼 빠른 macOS용 디스크 분석기.' },
    description: {
      en:
        'MacTree shows at a glance where your disk space goes. It scans a whole disk quickly with many threads at once (about 6.7 million items in roughly 25 seconds on an M5 Pro Mac) ' +
        'and presents the result as a folder tree, a size-sorted file list, per-extension statistics and a cushion treemap you can zoom up to 10,000×. ' +
        'Files can be moved to the Trash or marked and deleted in one go, and allocated size is the default so sparse files and cloud-only files do not mislead you.',
      ko:
        'MacTree는 디스크 공간을 어디에 쓰고 있는지 한눈에 보여 줍니다. 여러 스레드로 디스크 전체를 빠르게 스캔하고(M5 Pro Mac에서 약 670만 항목을 약 25초), ' +
        '폴더 트리, 크기순 파일 목록, 확장자별 통계, 최대 10,000배까지 확대되는 쿠션 트리맵으로 보여 줍니다. ' +
        '휴지통으로 보내거나 여러 항목을 표시해 한 번에 삭제할 수 있고, 기본값이 할당 크기라서 희소 파일이나 iCloud 전용 파일에 속지 않습니다.',
    },
    role: { en: 'Design and development', ko: '디자인 및 개발' },
    tags: ['Swift', 'macOS'],
    cover: '/projects/mactree.jpg',
    color: '#10b981',
    links: { github: 'https://github.com/aodjo/macTree' },
    highlights: [
      { en: 'Multi-threaded scan: about 6.7 million items in roughly 25 seconds', ko: '멀티스레드 스캔: 약 670만 항목을 약 25초에' },
      { en: 'Cushion treemap with pointer-centred zoom up to 10,000×', ko: '포인터 중심 확대(최대 10,000배) 쿠션 트리맵' },
      { en: 'File search with wildcards, per-extension statistics and CSV export', ko: '와일드카드 파일 검색, 확장자별 통계, CSV 내보내기' },
      { en: 'Signed and notarized, distributed through Homebrew with a `mactree` command', ko: '서명·공증된 빌드, Homebrew 배포와 `mactree` 명령' },
    ],
    featured: true,
  },
  {
    id: 'junlang',
    name: 'Junlang',
    year: 2026,
    tagline: { en: 'A Turing-complete esoteric programming language.', ko: '튜링 완전한 난해한 프로그래밍 언어.' },
    description: {
      en:
        'Junlang (준랭) is a Turing-complete esoteric programming language, made for a classmate as a deliberately cryptic puzzle rather than a productive tool. ' +
        'The interpreter is written in C#: a lexer and parser build an AST that is compiled to bytecode and run on a virtual machine with exact fraction arithmetic. ' +
        'It comes with Korean and English documentation built with VitePress and a VS Code extension for syntax highlighting.',
      ko:
        '준랭은 튜링 완전한 난해한 프로그래밍 언어로, 생산성 대신 지능을 시험하는 퍼즐처럼 친구를 위해 만들었습니다. ' +
        'C#으로 만든 인터프리터는 렉서와 파서로 AST를 만들고 바이트코드로 컴파일해 분수를 정확히 다루는 가상 머신에서 실행합니다. ' +
        'VitePress로 만든 한국어·영어 문서와 구문 강조를 위한 VS Code 확장도 함께 제공합니다.',
    },
    role: { en: 'Language design and implementation', ko: '언어 설계 및 구현' },
    tags: ['C#', 'Compiler', 'VitePress', 'VS Code'],
    cover: '/projects/junlang.jpg',
    color: '#4f46e5',
    links: { demo: 'https://junlang.junx.dev/', github: 'https://github.com/aodjo/junlang' },
    highlights: [
      { en: 'Lexer, parser, bytecode compiler and virtual machine in C#', ko: 'C# 렉서, 파서, 바이트코드 컴파일러, 가상 머신' },
      { en: 'Exact fraction values, conditionals, loops and I/O', ko: '정확한 분수 값, 조건문, 반복문, 입출력' },
      { en: 'Bilingual documentation site with examples (Fibonacci, GCD)', ko: '예제(피보나치, 최대공약수)가 있는 한·영 문서 사이트' },
      { en: 'VS Code extension with a TextMate grammar', ko: 'TextMate 문법을 쓰는 VS Code 확장' },
    ],
  },
]; /** Portfolio projects; each also gets a Finder folder ~/Documents/Projects/<name>, and the first one's cover becomes the Desktop screenshot. TODO: replace with your real projects. */

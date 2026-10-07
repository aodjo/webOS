import { beforeAll, describe, expect, it } from 'vitest';
import { APPS } from '@/apps';
import { ensureSeeded, fs, PATHS } from '@/kernel';
import { projects } from '@/data/portfolio';
import { buildResults, choseong, isSearchableFile, matchScore } from './spotlightSearch';

beforeAll(() => {
  ensureSeeded('en', APPS);
  fs.sudo(() => fs.mkdir('/System/Library', { recursive: true }));
  fs.writeFile(`${PATHS.documents}/Resume Draft.md`, '# Resume\n\nHello');
  fs.sudo(() => fs.writeFile('/System/Library/resume-system.txt', 'hidden'));
  fs.writeFile(`${PATHS.documents}/.resume-secret`, 'dotfile');
});

describe('matchScore', () => {
  it('ranks exact > prefix > word prefix > substring > fuzzy', () => {
    const exact = matchScore('Safari', 'safari');
    const prefix = matchScore('Safari', 'saf');
    const word = matchScore('System Settings', 'set');
    const sub = matchScore('Calculator', 'cula');
    const fuzzy = matchScore('Activity Monitor', 'acmn');
    expect(exact).toBe(100);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(matchScore('Safari', 'xyz')).toBe(0);
  });

  it('matches initials and Hangul initial consonants', () => {
    expect(matchScore('System Settings', 'ss')).toBeGreaterThan(0);
    expect(choseong('계산기')).toBe('ㄱㅅㄱ');
    expect(matchScore('계산기', 'ㄱㅅ')).toBeGreaterThan(0);
  });
});

describe('buildResults', () => {
  it('returns nothing for an empty query', () => {
    expect(buildResults('  ', 'en')).toEqual([]);
  });

  it('puts the best app match first and the web search last', () => {
    const r = buildResults('saf', 'en');
    expect(r[0]).toMatchObject({ group: 'top', kind: 'app', appId: 'safari' });
    expect(r[r.length - 1]).toMatchObject({ kind: 'web', group: 'web' });
  });

  it('finds apps by their Korean name and aliases', () => {
    expect(buildResults('계산기', 'ko')[0]).toMatchObject({ kind: 'app', appId: 'calculator' });
    expect(buildResults('browser', 'en').some((x) => x.kind === 'app' && x.appId === 'safari')).toBe(true);
  });

  it('evaluates math as the top hit', () => {
    expect(buildResults('2+2*3', 'en')[0]).toMatchObject({ kind: 'calc', group: 'top', title: '8' });
  });

  it('finds settings panes, projects and skills', () => {
    expect(buildResults('dark mode', 'en').some((x) => x.kind === 'setting' && x.pane === 'appearance')).toBe(true);
    expect(buildResults('wallpaper', 'en').some((x) => x.kind === 'setting' && x.pane === 'wallpaper')).toBe(true);
    expect(buildResults(projects[0].name.toLowerCase(), 'en').some((x) => x.kind === 'project' && x.projectId === projects[0].id)).toBe(true);
    expect(buildResults('typescript', 'en').some((x) => x.kind === 'skill')).toBe(true);
  });

  it('searches files but skips /System and hidden items', () => {
    const paths = buildResults('resume', 'en').flatMap((x) => (x.kind === 'file' ? [x.path] : []));
    expect(paths).toContain(`${PATHS.documents}/Resume Draft.md`);
    expect(paths.some((p) => p.startsWith('/System') || p.includes('/.'))).toBe(false);
    expect(isSearchableFile(fs.stat('/System/Library/resume-system.txt')!)).toBe(false);
  });
});

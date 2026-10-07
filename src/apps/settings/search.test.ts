import { describe, expect, it } from 'vitest';
import { scorePane, searchPanes, type Searchable } from './search';

const panes: Searchable[] = [
  { id: 'wifi', name: 'Wi-Fi', keywords: ['network', 'internet', '네트워크'] },
  { id: 'appearance', name: { en: 'Appearance', ko: '화면 모드' }, keywords: ['dark mode', 'accent', '다크 모드'] },
  { id: 'displays', name: { en: 'Displays', ko: '디스플레이' }, keywords: ['brightness', 'night shift', '밝기'] },
  { id: 'desktop-dock', name: { en: 'Desktop & Dock', ko: '데스크탑 및 Dock' }, keywords: ['magnification'] },
]; /** Small fixture of panes with English/Korean names and keywords, in display order. */

describe('searchPanes', () => {
  it('matches English and Korean names regardless of the current locale', () => {
    expect(searchPanes(panes, 'appear').map((p) => p.id)).toEqual(['appearance']);
    expect(searchPanes(panes, '화면').map((p) => p.id)).toEqual(['appearance']);
  });

  it('matches keywords', () => {
    expect(searchPanes(panes, 'dark').map((p) => p.id)).toEqual(['appearance']);
    expect(searchPanes(panes, '밝기').map((p) => p.id)).toEqual(['displays']);
    expect(searchPanes(panes, 'internet').map((p) => p.id)).toEqual(['wifi']);
  });

  it('ranks name prefixes above substrings and keywords', () => {
    expect(searchPanes(panes, 'd').map((p) => p.id)).toEqual(['displays', 'desktop-dock', 'appearance']);
  });

  it('is case- and whitespace-insensitive and empty for blank queries', () => {
    expect(scorePane(panes[0], '  WI-fi ')).toBeGreaterThan(0);
    expect(searchPanes(panes, '   ')).toEqual([]);
    expect(searchPanes(panes, 'zzz')).toEqual([]);
  });
});

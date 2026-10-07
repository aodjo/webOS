import { describe, expect, it } from 'vitest';
import { displayHost, fileURL, filePathOf, githubTarget, isKnownBlocked, isKnownFramable, letterIcon, parseInput, parseLinkFile, searchQueryOf, searchURL, weblocContent } from './url';

describe('safari url helpers', () => {
  it('parses address-field input', () => {
    expect(parseInput('example.com')).toBe('https://example.com/');
    expect(parseInput('  en.m.wikipedia.org/wiki/Seoul ')).toBe('https://en.m.wikipedia.org/wiki/Seoul');
    expect(parseInput('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    expect(parseInput('HTTPS://Example.com')).toBe('https://example.com/');
    expect(parseInput('localhost:5173')).toBe('http://localhost:5173');
    expect(parseInput('react hooks')).toBe(searchURL('react hooks'));
    expect(parseInput('typescript')).toBe(searchURL('typescript'));
    expect(parseInput('webos://Start')).toBe('webos://start');
    expect(parseInput('javascript:alert(1)')).toBe(searchURL('javascript:alert(1)'));
    expect(parseInput('data:text/html,hi')).toBe(searchURL('data:text/html,hi'));
    expect(parseInput('mailto:hi@example.com?subject=Hi')).toBe('mailto:hi@example.com?subject=Hi');
    expect(parseInput('   ')).toBeNull();
  });

  it('formats hosts and search queries', () => {
    expect(displayHost('https://www.github.com/aodjo')).toBe('github.com');
    expect(displayHost('https://en.m.wikipedia.org/wiki/X')).toBe('en.m.wikipedia.org');
    expect(searchQueryOf(searchURL('a b'))).toBe('a b');
    expect(searchQueryOf('https://example.com/search?q=1')).toBeNull();
  });

  it('knows which sites refuse framing', () => {
    expect(isKnownBlocked('https://github.com/aodjo')).toBe(true);
    expect(isKnownBlocked('https://www.google.com/')).toBe(true);
    expect(isKnownBlocked(searchURL('x'))).toBe(false);
    expect(isKnownBlocked('https://www.youtube.com/watch?v=1')).toBe(true);
    expect(isKnownBlocked('https://www.youtube.com/embed/1')).toBe(false);
    expect(isKnownBlocked('https://example.com')).toBe(false);
    expect(isKnownFramable('https://en.m.wikipedia.org/')).toBe(true);
    expect(isKnownFramable('https://some-site.dev/')).toBe(false);
  });

  it('extracts GitHub targets', () => {
    expect(githubTarget('https://github.com/aodjo')).toEqual({ user: 'aodjo', repo: undefined });
    expect(githubTarget('https://github.com/aodjo/webos/tree/main')).toEqual({ user: 'aodjo', repo: 'webos' });
    expect(githubTarget('https://example.com/aodjo')).toBeNull();
  });

  it('reads link files', () => {
    expect(parseLinkFile('https://example.com\n')).toBe('https://example.com');
    expect(parseLinkFile('[InternetShortcut]\nURL=https://a.dev/x\n')).toBe('https://a.dev/x');
    expect(parseLinkFile(weblocContent('https://b.dev/?q=1&r=2'))).toBe('https://b.dev/?q=1&r=2');
  });

  it('round-trips file URLs and makes stable letter icons', () => {
    expect(filePathOf(fileURL('/Users/me/My Page.html'))).toBe('/Users/me/My Page.html');
    expect(filePathOf('file:///tmp/100%zz.html')).toBe('/tmp/100%zz.html');
    const a = letterIcon('GitHub', 'https://github.com/x');
    expect(a.letter).toBe('G');
    expect(letterIcon('GitHub', 'https://github.com/y').color).toBe(a.color);
  });
});

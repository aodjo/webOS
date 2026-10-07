import { describe, expect, it } from 'vitest';
import { fs } from '@/kernel';
import { classifyLink, renderMarkdown, resolveImageSrc } from './Markdown';

describe('renderMarkdown', () => {
  it('escapes raw HTML instead of injecting it', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nhi <b onclick="x()">bold</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b ');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b onclick=&quot;x()&quot;&gt;');
  });

  it('drops unsafe link schemes but keeps the text', () => {
    const html = renderMarkdown('[evil](javascript:alert(1)) [ok](https://example.com "T")');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('evil');
    expect(html).toContain('<a href="https://example.com" title="T">ok</a>');
  });

  it('renders GFM task lists, tables and heading anchors', () => {
    const html = renderMarkdown('# Hello World\n\n## Hello World\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('data-anchor="hello-world"');
    expect(html).toContain('data-anchor="hello-world-1"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('checked');
    expect(html).toContain('<table>');
  });

  it('escapes code blocks', () => {
    expect(renderMarkdown('```html\n<div>"x"</div>\n```')).toContain('&lt;div&gt;');
  });
});

describe('links & images', () => {
  it('classifies links', () => {
    expect(classifyLink('https://a.com')).toEqual({ kind: 'external', href: 'https://a.com' });
    expect(classifyLink('mailto:me@x.com?subject=hi')).toEqual({ kind: 'mail', address: 'me@x.com' });
    expect(classifyLink('#Intro')).toEqual({ kind: 'anchor', id: 'Intro' });
    expect(classifyLink('../Notes/My%20Note.md', '/Users/a/Documents/Projects')).toEqual({ kind: 'path', path: '/Users/a/Documents/Notes/My Note.md' });
    expect(classifyLink('data:text/html,<script>')).toBeNull();
    expect(classifyLink('vbscript:x')).toBeNull();
  });

  it('resolves image sources', () => {
    expect(resolveImageSrc('https://x.com/a.png')).toBe('https://x.com/a.png');
    expect(resolveImageSrc('/projects/webos.svg')).toBe('/projects/webos.svg');
    expect(resolveImageSrc('javascript:alert(1)')).toBeNull();
    expect(resolveImageSrc('data:text/html,hi')).toBeNull();
    expect(resolveImageSrc('missing.png', '/nowhere')).toBeNull();
  });

  it('resolves relative images through the virtual FS', () => {
    fs.replaceAll(
      {
        '/': { path: '/', name: '/', type: 'dir', createdAt: 0, modifiedAt: 0 },
        '/docs': { path: '/docs', name: 'docs', type: 'dir', createdAt: 0, modifiedAt: 0 },
        '/docs/cover.svg': { path: '/docs/cover.svg', name: 'cover.svg', type: 'file', src: '/projects/cover.svg', createdAt: 0, modifiedAt: 0 },
      },
      'test',
    );
    expect(resolveImageSrc('cover.svg', '/docs')).toBe('/projects/cover.svg');
    expect(renderMarkdown('![c](./cover.svg)', { baseDir: '/docs' })).toContain('src="/projects/cover.svg"');
  });
});

describe('<Markdown>', () => {
  it('re-renders when a referenced image file appears in the FS', async () => {
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { Markdown } = await import('./Markdown');
    fs.replaceAll(
      {
        '/': { path: '/', name: '/', type: 'dir', createdAt: 0, modifiedAt: 0 },
        '/docs': { path: '/docs', name: 'docs', type: 'dir', createdAt: 0, modifiedAt: 0 },
      },
      'test',
    );
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(Markdown, { source: '![Cover](cover.svg)\n\n- [x] done', baseDir: '/docs' })));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('Cover');
    expect(host.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).toBeTruthy();

    act(() => void fs.sudo(() => fs.writeFile('/docs/cover.svg', '', { src: '/projects/cover.svg' })));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/projects/cover.svg');
    act(() => root.unmount());
  });
});

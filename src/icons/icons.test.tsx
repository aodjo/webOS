import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { useFS } from '@/kernel/fs';
import { registerApps } from '@/kernel/registry';
import { HOME, PATHS } from '@/kernel/constants';
import type { FSNode } from '@/kernel/types';
import * as I from './index';
import type { FileIconNode } from './index';
import { svgAspect } from './files';
import { hairline } from './shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; /** Tells React that updates are wrapped in act(), so client renders apply synchronously without warnings. */

const APP_ICONS = {
  FinderIcon: I.FinderIcon,
  LaunchpadIcon: I.LaunchpadIcon,
  SafariIcon: I.SafariIcon,
  MailIcon: I.MailIcon,
  NotesIcon: I.NotesIcon,
  AboutMeIcon: I.AboutMeIcon,
  ProjectsIcon: I.ProjectsIcon,
  TerminalIcon: I.TerminalIcon,
  TextEditIcon: I.TextEditIcon,
  PreviewIcon: I.PreviewIcon,
  CalculatorIcon: I.CalculatorIcon,
  SettingsIcon: I.SettingsIcon,
  ActivityMonitorIcon: I.ActivityMonitorIcon,
  AboutThisMacIcon: I.AboutThisMacIcon,
  WelcomeIcon: I.WelcomeIcon,
  MinesweeperIcon: I.MinesweeperIcon,
  GenericAppIcon: I.GenericAppIcon,
  TrashIcon: I.TrashIcon,
  TrashFullIcon: I.TrashFullIcon,
  HardDriveIcon: I.HardDriveIcon,
} satisfies Record<string, FC<{ size: number }>>; /** Icon components that take only a `size` prop, keyed by export name. */

/**
 * Makes rendered icon markup comparable across renders.
 *
 * Replaces the per-instance id prefix produced by `useIconIds` (an "i" followed by the
 * sanitized React id and a hyphen) with "ID-", since each render gets different ids.
 *
 * @param {string} html - Static markup.
 * @returns {string} The markup with instance ids normalized.
 *
 * @example
 * normalizeIds('<g id="ir1-clip">'); // '<g id="ID-clip">'
 */
const normalizeIds = (html: string) => html.replace(/\bi[A-Za-z0-9_]+-(?=[a-zA-Z])/g, 'ID-');
/**
 * Renders an element to static markup with instance ids normalized.
 *
 * Lets two separately rendered icons be compared for identical artwork.
 *
 * @param {React.ReactElement} el - Element to render.
 * @returns {string} Comparable static markup.
 *
 * @example
 * expect(html(<I.FileIcon node={dir('/')} size={64} />)).toBe(html(<I.HardDriveIcon size={64} />));
 */
const html = (el: React.ReactElement) => normalizeIds(renderToStaticMarkup(el));
/**
 * Builds a file node under /tmp for FileIcon.
 *
 * The path is `/tmp/<name>`; `extra` is spread last so it can override any field.
 *
 * @param {string} name - File name.
 * @param {Partial<FileIconNode>} [extra={}] - Fields to add or override, such as `src` or `content`.
 * @returns {FileIconNode} The file node.
 *
 * @example
 * file('cover.png', { src: '/projects/cover.png' });
 */
const file = (name: string, extra: Partial<FileIconNode> = {}): FileIconNode => ({ type: 'file', name, path: `/tmp/${name}`, ...extra });
/**
 * Builds a directory node for a path.
 *
 * The name is the last path segment, or "/" for the root.
 *
 * @param {string} path - Absolute directory path.
 * @returns {FileIconNode} The directory node.
 *
 * @example
 * dir(PATHS.desktop);
 */
const dir = (path: string): FileIconNode => ({ type: 'dir', name: path.split('/').pop() || '/', path });

/**
 * Replaces the file-system store with a minimal hydrated tree.
 *
 * Creates "/", "/Users", the home folder and the Trash, plus `trashItems` empty text files in
 * the Trash, and sets the store state directly so subscribed components re-render.
 *
 * @param {number} [trashItems=0] - Number of files to put in the Trash.
 * @returns {void}
 *
 * @example
 * act(() => seedFS(1));
 */
function seedFS(trashItems = 0) {
  const nodes: Record<string, FSNode> = {};
  for (const p of ['/', '/Users', HOME, PATHS.trash]) nodes[p] = { path: p, name: p, type: 'dir', createdAt: 1, modifiedAt: 1 };
  for (let i = 0; i < trashItems; i++) {
    const p = `${PATHS.trash}/junk${i}.txt`;
    nodes[p] = { path: p, name: `junk${i}.txt`, type: 'file', content: '', createdAt: 1, modifiedAt: 1 };
  }
  useFS.setState({ nodes, seedVersion: 'test', hydrated: true });
}

let errorSpy: ReturnType<typeof vi.spyOn>; /** Spy on console.error; each test fails if it was called, so React warnings surface as failures. */
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error');
  seedFS();
});
afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

describe('squirclePath', () => {
  it('builds a closed continuous-corner outline inside its box', () => {
    const d = I.squirclePath(10, 20, 80, 60, 18);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/A/g)).toHaveLength(4);
    expect(d.match(/C/g)).toHaveLength(8);
    // Every coordinate stays within the box (radii and arc flags are small positives).
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nums)).toBeLessThanOrEqual(90 + 1e-6);
  });
});

describe('svgAspect', () => {
  it('prefers absolute width/height, then the viewBox', () => {
    expect(svgAspect('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 10 10">')).toBe(1.6);
    expect(svgAspect('<svg width="100%" height="100%" viewBox="0 0 4 3"/>')).toBeCloseTo(4 / 3);
    expect(svgAspect("<svg viewBox='0,0,20,10'></svg>")).toBe(2);
    expect(svgAspect('<svg></svg>')).toBeUndefined();
    expect(svgAspect('<svg viewBox="0 0 0 10"/>')).toBeUndefined();
    expect(svgAspect('plain text')).toBeUndefined();
  });
});

describe('hairline', () => {
  it('keeps outlines about the same on-screen width at every size', () => {
    expect(hairline(16)).toBeCloseTo(4.688, 2);
    expect(hairline(128)).toBeCloseTo(0.6, 2); // clamped to the 0.6-unit minimum
  });
});

describe('app icons', () => {
  it.each(Object.entries(APP_ICONS))('%s renders a size×size svg with resolvable paint references', (_, Icon) => {
    const out = renderToStaticMarkup(<Icon size={48} />);
    expect(out).toMatch(/^<svg[^>]* width="48" height="48"/);
    const ids = new Set([...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const [, ref] of out.matchAll(/url\(#([^)]+)\)/g)) expect(ids.has(ref)).toBe(true);
  });

  it('keeps paint references resolvable on both sides of the size thresholds for fine highlights', () => {
    const icons: Array<(size: number) => React.ReactElement> = [
      ...Object.values(APP_ICONS).map((Icon) => (size: number) => <Icon size={size} />),
      (size) => <I.FolderIcon size={size} glyph="downloads" />,
      (size) => <I.DocumentIcon size={size} name="a.pdf" />,
    ];
    for (const size of [16, 20, 23, 24, 28, 32, 40, 47, 48, 128]) {
      for (const render of icons) {
        const out = renderToStaticMarkup(render(size));
        const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(ids).size).toBe(ids.length);
        for (const [, ref] of out.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref);
      }
    }
  });

  it('gives every instance its own gradient ids', () => {
    const out = renderToStaticMarkup(
      <>
        <I.FinderIcon size={32} />
        <I.FinderIcon size={64} />
        <I.FileIcon node={dir(PATHS.desktop)} size={64} />
        <I.FileIcon node={dir(PATHS.documents)} size={64} />
      </>,
    );
    const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('OSLogo follows the given color', () => {
    expect(renderToStaticMarkup(<I.OSLogo size={14} />)).toContain('currentColor');
    const red = renderToStaticMarkup(<I.OSLogo size={80} color="#f00" />);
    expect(red).toContain('width="80"');
    expect(red).not.toContain('currentColor');
  });
});

describe('FileIcon', () => {
  it('uses the startup disk for "/" and folder glyphs for special folders', () => {
    expect(html(<I.FileIcon node={dir('/')} size={64} />)).toBe(html(<I.HardDriveIcon size={64} />));
    expect(html(<I.FileIcon node={dir(PATHS.desktop)} size={64} />)).toBe(html(<I.FolderIcon size={64} glyph="desktop" />));
    expect(html(<I.FileIcon node={dir(`${HOME}/Movies`)} size={64} />)).toBe(html(<I.FolderIcon size={64} glyph="movies" />));
    expect(html(<I.FileIcon node={dir(PATHS.applications)} size={64} />)).toBe(html(<I.FolderIcon size={64} glyph="applications" />));
    expect(html(<I.FileIcon node={dir(`${PATHS.projects}/webOS`)} size={64} />)).toBe(html(<I.FolderIcon size={64} />));
    expect(I.folderGlyphFor('/System')).toBe('system');
    expect(I.folderGlyphFor(PATHS.home)).toBe('home');
  });

  it('uses the bin for the Trash folder', () => {
    // Server rendering reads the store's initial snapshot; the live empty → full switch is
    // covered by the client-side Thumbnail suite.
    expect(html(<I.FileIcon node={dir(PATHS.trash)} size={64} />)).toBe(html(<I.TrashIcon size={64} />));
  });

  it('renders the registered app icon for .app bundles', () => {
    registerApps([
      { id: 'finder', name: 'Finder', icon: I.FinderIcon },
      { id: 'notes', name: { en: 'Notes', ko: '메모' }, icon: I.NotesIcon },
    ]);
    expect(html(<I.FileIcon node={file('Finder.app', { content: 'finder\n' })} size={64} />)).toBe(html(<I.FinderIcon size={64} />));
    expect(html(<I.FileIcon node={file('Notes.app')} size={64} />)).toBe(html(<I.NotesIcon size={64} />));
    expect(html(<I.FileIcon node={file('Mystery.app', { content: 'nope' })} size={64} />)).toBe(html(<I.GenericAppIcon size={64} />));
  });

  it('renders image thumbnails lazily and falls back to a document page', () => {
    const thumb = renderToStaticMarkup(<I.FileIcon node={file('cover.png', { src: '/projects/cover.png' })} size={64} />);
    expect(thumb).toContain('<img');
    expect(thumb).toContain('loading="lazy"');
    expect(thumb).toContain('draggable="false"');
    const svgText = renderToStaticMarkup(<I.FileIcon node={file('logo.svg', { content: '<svg xmlns="http://www.w3.org/2000/svg"/>' })} size={64} />);
    expect(svgText).toContain('src="data:image/svg+xml');
    expect(html(<I.FileIcon node={file('empty.png')} size={64} />)).toBe(html(<I.DocumentIcon size={64} name="empty.png" />));
  });

  it('labels documents by kind', () => {
    expect(renderToStaticMarkup(<I.FileIcon node={file('a.pdf')} size={64} />)).toContain('>PDF<');
    expect(renderToStaticMarkup(<I.FileIcon node={file('a.md')} size={64} />)).toContain('>MD<');
    expect(renderToStaticMarkup(<I.FileIcon node={file('a.ts')} size={64} />)).toContain('>TS<');
    expect(renderToStaticMarkup(<I.FileIcon node={file('design.sketchfile')} size={64} />)).toContain('>SKET<');
    // Labels are dropped at list-view sizes.
    expect(renderToStaticMarkup(<I.FileIcon node={file('a.pdf')} size={16} />)).not.toContain('>PDF<');
  });
});

describe('Thumbnail', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('fits the image into the box keeping its aspect ratio', () => {
    act(() => root.render(<I.FileIcon node={file('wide.png', { src: '/wide.png' })} size={64} />));
    const img = host.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 400 });
    Object.defineProperty(img, 'naturalHeight', { value: 200 });
    act(() => img.dispatchEvent(new Event('load')));
    const frame = img.parentElement!;
    expect(frame.style.width).toBe('56px');
    expect(frame.style.height).toBe('28px');
  });

  it('falls back to a document icon when the image fails to load', () => {
    act(() => root.render(<I.FileIcon node={file('broken.png', { src: '/missing.png' })} size={64} />));
    act(() => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
  });

  it('shows the generic image page until the picture has loaded', () => {
    act(() => root.render(<I.FileIcon node={file('slow.png', { src: '/slow.png' })} size={64} />));
    expect(host.querySelectorAll('svg')).toHaveLength(1);
    const img = host.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 200 });
    act(() => img.dispatchEvent(new Event('load')));
    expect(host.querySelector('svg')).toBeNull();
  });

  it('reads the proportions of an SVG without intrinsic size from its source', () => {
    // jsdom reports naturalWidth/Height = 0, like a browser does for a viewBox-only SVG.
    const wide = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><title>ü</title></svg>';
    act(() => root.render(<I.FileIcon node={file('wide.svg', { content: wide })} size={64} />));
    let img = host.querySelector('img')!;
    act(() => img.dispatchEvent(new Event('load')));
    expect(parseFloat(img.parentElement!.style.width)).toBe(56);
    expect(parseFloat(img.parentElement!.style.height)).toBeCloseTo(56 / 3);

    const tall = `data:image/svg+xml;base64,${btoa('<?xml version="1.0"?><svg viewBox="0 0 100 200"></svg>')}`;
    act(() => root.render(<I.FileIcon node={file('tall.svg', { src: tall })} size={64} />));
    img = host.querySelector('img')!;
    act(() => img.dispatchEvent(new Event('load')));
    expect(img.parentElement!.style.width).toBe('28px');
    expect(img.parentElement!.style.height).toBe('56px');
  });

  it('switches the Trash icon live when items are trashed', () => {
    const paper = '#9ea3aa'; // stroke color of the crumpled paper drawn only in the full bin
    act(() => root.render(<I.FileIcon node={dir(PATHS.trash)} size={64} />));
    expect(host.innerHTML).not.toContain(paper);
    act(() => seedFS(1));
    expect(host.innerHTML).toContain(paper);
  });
});

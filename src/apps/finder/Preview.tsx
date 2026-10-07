import { useState } from 'react';
import type { FSNode } from '@/kernel';
import { dirname, fs, isTextFile, kindOf } from '@/kernel';
import { FileIcon } from '@/icons';
import { Markdown } from '@/components/Markdown';
import s from './Preview.module.css';

const MAX_TEXT = 200_000; /** Maximum number of characters of a text or markdown file rendered in a full preview. */

/**
 * Resolves a URL that media elements can load for a file.
 *
 * Delegates to `fs.getURL` (the file's `src`, or a data: URL of its text content) and swallows
 * its errors, e.g. for folders or missing nodes.
 *
 * @param {FSNode} node - File to resolve.
 * @returns {string | null} The URL, or null when none can be produced.
 *
 * @example
 * const url = urlOf(node);
 * if (url) img.src = url;
 */
function urlOf(node: FSNode): string | null {
  try {
    return fs.getURL(node.path);
  } catch {
    return null;
  }
}

/**
 * Fallback preview showing only the item's large icon, centered.
 *
 * Used for folders, apps, unsupported kinds and images that fail to load.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - Item whose icon is shown.
 * @param {number} props.size - Icon size in pixels.
 * @returns {JSX.Element} The centered icon.
 *
 * @example
 * <BigIcon node={node} size={160} />
 */
function BigIcon({ node, size }: { node: FSNode; size: number }) {
  return (
    <div className={s.iconOnly}>
      <FileIcon node={node} size={size} />
    </div>
  );
}

/**
 * Image preview that falls back to the file icon when the image cannot be shown.
 *
 * Renders the image contained in the pane ('full' adds padding, 'thumb' adds a drop shadow).
 * The URL that failed to load is kept in state and compared with the current one, so a later
 * valid file renders again without needing an effect to reset the error.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - Image file to preview.
 * @param {'full' | 'thumb'} props.variant - Full-size (Quick Look) or thumbnail (Get Info, column
 *   and gallery previews) layout.
 * @param {number} props.iconSize - Icon size used for the fallback.
 * @returns {JSX.Element} The image, or the large icon when there is no URL or it failed to load.
 *
 * @example
 * <ImagePreview node={node} variant="full" iconSize={160} />
 */
function ImagePreview({ node, variant, iconSize }: { node: FSNode; variant: 'full' | 'thumb'; iconSize: number }) {
  const url = urlOf(node);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <BigIcon node={node} size={iconSize} />;
  return (
    <div className={variant === 'full' ? s.imageFull : s.imageThumb}>
      <img src={url} alt={node.name} draggable={false} onError={() => setFailed(url)} />
    </div>
  );
}

/**
 * Miniature document "page" showing the first lines of a text file.
 *
 * Keeps at most the first 40 lines and 2400 characters, rendered in a scaled-down white page
 * (see `.page` in Preview.module.css). It is decorative and hidden from assistive technology.
 *
 * @param {Object} props - Component props.
 * @param {string} props.text - Full text content of the file.
 * @returns {JSX.Element} The page thumbnail.
 *
 * @example
 * <PageThumb text={node.content ?? ''} />
 */
function PageThumb({ text }: { text: string }) {
  return (
    <div className={s.page} aria-hidden="true">
      <pre>{text.split('\n').slice(0, 40).join('\n').slice(0, 2400)}</pre>
    </div>
  );
}

/**
 * Tells whether Quick Look can show an item's content rather than just its icon.
 *
 * Mirrors the 'full' layout of FilePreview: images, Markdown, plain text and code with text
 * content, web locations, and PDF, video and audio files with a URL have a content preview;
 * folders, apps and every other file fall back to the big icon.
 *
 * @param {FSNode} node - The item to check.
 * @returns {boolean} True when the 'full' preview shows the item's content.
 *
 * @example
 * hasContentPreview(fs.stat('/Users/aodjo/Pictures/cat.png')!); // true
 */
export function hasContentPreview(node: FSNode): boolean {
  const kind = kindOf(node);
  if (node.type === 'dir' || kind === 'app') return false;
  if (kind === 'image' || kind === 'link') return true;
  if ((kind === 'markdown' || kind === 'text' || kind === 'code') && isTextFile(node)) return true;
  return !!urlOf(node) && (kind === 'pdf' || kind === 'video' || kind === 'audio');
}

/**
 * Preview of any file system item in a 'full' or 'thumb' layout.
 *
 * Quick Look uses the interactive 'full' layout; Get Info, the column-view preview pane and the
 * gallery stage use the static 'thumb' layout. Folders and apps show their large icon and images
 * use `ImagePreview` in both variants. The 'thumb' variant shows text files (except web
 * locations) as a miniature page and everything else as an icon. The 'full' variant renders
 * markdown with `Markdown` (relative links resolved against the file's folder), text and code as
 * a focusable, selectable `<pre>` (both capped at `MAX_TEXT` characters), web locations as their
 * icon plus URL, PDFs in an iframe, and video and audio with native controls; anything else
 * falls back to the icon.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - Item to preview.
 * @param {'full' | 'thumb'} props.variant - Layout: interactive full-size preview or static thumbnail.
 * @param {number} [props.iconSize=variant === 'full' ? 160 : 112] - Size of the icon used for
 *   icon-only previews.
 * @returns {JSX.Element} The preview element.
 *
 * @example
 * <FilePreview node={node} variant="full" />
 * <FilePreview node={node} variant="thumb" iconSize={96} />
 */
export function FilePreview({ node, variant, iconSize = variant === 'full' ? 160 : 112 }: { node: FSNode; variant: 'full' | 'thumb'; iconSize?: number }) {
  const kind = kindOf(node);
  if (node.type === 'dir' || kind === 'app') return <BigIcon node={node} size={iconSize} />;
  if (kind === 'image') return <ImagePreview node={node} variant={variant} iconSize={iconSize} />;
  const text = isTextFile(node) ? (node.content ?? '') : null;

  if (variant === 'thumb') {
    if (text !== null && kind !== 'link') return <PageThumb text={text} />;
    return <BigIcon node={node} size={iconSize} />;
  }

  const url = urlOf(node);
  if (kind === 'markdown' && text !== null) {
    return (
      <div className={s.doc}>
        <Markdown source={text.slice(0, MAX_TEXT)} baseDir={dirname(node.path)} className={s.markdown} />
      </div>
    );
  }
  if ((kind === 'text' || kind === 'code') && text !== null) {
    return (
      <pre className={`${s.code} selectable`} tabIndex={0}>
        {text.slice(0, MAX_TEXT)}
      </pre>
    );
  }
  if (kind === 'link') {
    return (
      <div className={s.iconOnly}>
        <FileIcon node={node} size={iconSize} />
        <div className={`${s.url} selectable`}>{(text ?? '').trim()}</div>
      </div>
    );
  }
  if (url && kind === 'pdf') return <iframe className={s.frame} src={url} title={node.name} />;
  if (url && kind === 'video') return <video className={s.video} src={url} controls playsInline />;
  if (url && kind === 'audio') {
    return (
      <div className={s.iconOnly}>
        <FileIcon node={node} size={iconSize} />
        <audio className={s.audio} src={url} controls />
      </div>
    );
  }
  return <BigIcon node={node} size={iconSize} />;
}

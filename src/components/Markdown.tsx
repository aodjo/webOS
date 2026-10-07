/**
 * Shared Markdown renderer (marked + GFM).
 *
 * Raw HTML in the source is always escaped (shown as text), link/image URLs are restricted to safe
 * schemes, and relative image paths are resolved against `baseDir` in the virtual file system.
 * Images that live in the FS re-render when those files change. Clicks on links are intercepted so
 * they open inside the OS: web links in Safari, mailto: in Mail, file paths with their default app,
 * `#anchors` scroll within the document.
 */
import { useCallback, useContext, useMemo, type MouseEvent } from 'react';
import { Marked, type Token, type Tokens } from 'marked';
import { WindowContext, basename, dialogs, fs, resolve as resolvePath, t, useFS, useLocale, wm, type FSNode } from '@/kernel';
import { openCompose, parseMailto } from '@/apps/mail/compose';
import styles from './Markdown.module.css';

/* ───────────────────────── Escaping & URL safety ───────────────────────── */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }; /** HTML entity for each character that must be escaped in text and attribute values. */

/**
 * Escape a string for safe insertion into HTML text or a quoted attribute.
 *
 * Replaces `&`, `<`, `>`, `"` and `'` with their HTML entities so the result can never open a
 * tag or break out of an attribute value.
 *
 * @param {string} s - The raw text to escape.
 * @returns {string} The escaped text.
 *
 * @example
 * escapeHtml('<b>"hi"</b>'); // '&lt;b&gt;&quot;hi&quot;&lt;/b&gt;'
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Percent-decode a URL component without throwing.
 *
 * Wraps `decodeURIComponent`; malformed escape sequences (e.g. a lone `%`) return the input
 * unchanged instead of raising a `URIError`.
 *
 * @param {string} s - The possibly percent-encoded text.
 * @returns {string} The decoded text, or `s` itself when it cannot be decoded.
 *
 * @example
 * safeDecode('My%20Notes.md'); // 'My Notes.md'
 * safeDecode('100%');          // '100%'
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i; /** Matches a leading URL scheme (`https:`, `mailto:`, `javascript:` …) and captures its name. */

/** Where a link in a rendered document leads, as decided by `classifyLink`. */
type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'mail'; address: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'path'; path: string };

/**
 * Classify a link href found in a markdown document.
 *
 * `#id` hrefs are in-document anchors, `http(s):` and protocol-relative (`//host`) hrefs are
 * external web links, and `mailto:` hrefs are mail addresses (query part dropped). Any other
 * scheme (`javascript:`, `data:`, `file:` …) is rejected. Everything else is a virtual-FS path:
 * the query and fragment are stripped, percent-escapes are decoded, and the result is resolved
 * from the root when it starts with `/` or `~`, otherwise against `baseDir` (or `/`).
 *
 * @param {string} href - The raw href from the markdown source or the rendered `<a>`.
 * @param {string} [baseDir] - Folder that relative paths are resolved against.
 * @returns {LinkTarget | null} The link's target, or null for empty hrefs and unsafe schemes.
 *
 * @example
 * classifyLink('https://example.com');      // { kind: 'external', href: 'https://example.com' }
 * classifyLink('notes.md', '/Users/me');    // { kind: 'path', path: '/Users/me/notes.md' }
 * classifyLink('javascript:alert(1)');      // null
 */
export function classifyLink(href: string, baseDir?: string): LinkTarget | null {
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith('#')) return { kind: 'anchor', id: safeDecode(h.slice(1)) };
  if (h.startsWith('//')) return { kind: 'external', href: `https:${h}` };
  const scheme = SCHEME.exec(h)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') return { kind: 'external', href: h };
  if (scheme === 'mailto') return { kind: 'mail', address: safeDecode(h.slice(7).split('?')[0]) };
  if (scheme) return null;
  const raw = safeDecode(h.split(/[?#]/)[0]);
  if (!raw) return null;
  if (raw.startsWith('/') || raw.startsWith('~')) return { kind: 'path', path: resolvePath('/', raw) };
  return { kind: 'path', path: resolvePath(baseDir ?? '/', raw) };
}

/**
 * Compute the virtual-FS path an image reference points at.
 *
 * URLs with a scheme and protocol-relative URLs are not FS paths. The query and fragment are
 * stripped and percent-escapes decoded; absolute and `~` paths resolve from the root, relative
 * paths resolve against `baseDir` (and yield null when there is no base folder).
 *
 * @param {string} src - The image source from the markdown.
 * @param {string} [baseDir] - Folder that relative paths are resolved against.
 * @returns {string | null} The absolute FS path, or null when `src` is not an FS reference.
 *
 * @example
 * imageFSPath('img/cat.png', '/Users/me/Docs'); // '/Users/me/Docs/img/cat.png'
 * imageFSPath('https://x.dev/cat.png');         // null
 */
function imageFSPath(src: string, baseDir?: string): string | null {
  const s = src.trim();
  if (!s || s.startsWith('//') || SCHEME.test(s)) return null;
  const raw = safeDecode(s.split(/[?#]/)[0]);
  if (!raw) return null;
  if (raw.startsWith('/') || raw.startsWith('~')) return resolvePath('/', raw);
  return baseDir ? resolvePath(baseDir, raw) : null;
}

/**
 * Resolve a markdown image reference to a URL usable in `<img src>`.
 *
 * - `http(s):`, `data:image/` and `blob:` URLs are returned as-is; protocol-relative URLs get `https:`.
 * - Absolute, `~` and relative paths that name an existing FS file return that file's object URL
 *   (`fs.getURL`); a failure to create the URL yields null.
 * - Absolute paths that are not in the FS are treated as public assets served by the site
 *   (e.g. `/projects/x.svg`) and returned unchanged.
 *
 * @param {string} src - The image source from the markdown.
 * @param {string} [baseDir] - Folder that relative paths are resolved against.
 * @returns {string | null} A safe image URL, or null when the image can't be resolved or uses an unsafe scheme.
 *
 * @example
 * resolveImageSrc('https://x.dev/a.png');           // 'https://x.dev/a.png'
 * resolveImageSrc('photo.jpg', '/Users/me/Pictures'); // 'blob:…' when the file exists
 */
export function resolveImageSrc(src: string, baseDir?: string): string | null {
  const s = src.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s) || /^blob:/i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  const path = imageFSPath(s, baseDir);
  if (path && fs.stat(path)?.type === 'file') {
    try {
      return fs.getURL(path);
    } catch {
      return null;
    }
  }
  return s.startsWith('/') ? s : null;
}

/* ───────────────────────── marked setup ───────────────────────── */

const S = {
  done: { en: 'Completed', ko: '완료됨' },
  todo: { en: 'Not completed', ko: '완료되지 않음' },
  /**
   * Build the alert title shown when a linked file does not exist.
   *
   * Interpolates the file name into both locales of the message.
   *
   * @param {string} name - Base name of the missing file.
   * @returns {{ en: string; ko: string }} The localized alert title.
   *
   * @example
   * t(S.missingTitle('notes.md'));
   */
  missingTitle: (name: string) => ({ en: `The file “${name}” couldn’t be opened because there is no such file.`, ko: `“${name}” 파일이 존재하지 않기 때문에 열 수 없습니다.` }),
  /**
   * Build the alert title shown when no application can open a linked file.
   *
   * Interpolates the file name into both locales of the message.
   *
   * @param {string} name - Base name of the file that could not be opened.
   * @returns {{ en: string; ko: string }} The localized alert title.
   *
   * @example
   * t(S.noApp('archive.xyz'));
   */
  noApp: (name: string) => ({ en: `There is no application set to open “${name}”.`, ko: `“${name}” 파일을 열도록 설정된 응용 프로그램이 없습니다.` }),
}; /** Localized strings: task checkbox labels and the alert titles for links that can't be opened. */

let ctx: { baseDir?: string; slugs: Map<string, number> } = { slugs: new Map() }; /** Per-render context read by the renderer hooks: the base folder and the heading slugs used so far (safe as a module variable because marked renders synchronously). */

/**
 * Turn heading text into an anchor slug.
 *
 * Lowercases the text, drops HTML entities and every character that is not a letter, digit,
 * whitespace, `_` or `-` (Unicode-aware, so Korean headings keep their letters), and joins
 * words with `-`. An empty result becomes `section`.
 *
 * @param {string} text - Plain heading text.
 * @returns {string} The slug.
 *
 * @example
 * slugBase('Hello, World!'); // 'hello-world'
 */
function slugBase(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/&[a-z]+;|&#\d+;/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

/**
 * Produce a unique anchor slug for a heading in the document being rendered.
 *
 * Counts each base slug in `ctx.slugs`; the first heading gets the bare slug and repeats get
 * `-1`, `-2` … appended (GitHub style). Mutates the per-render context.
 *
 * @param {string} text - Plain heading text.
 * @returns {string} A slug unique within the current render.
 *
 * @example
 * slugify('Intro'); // 'intro'
 * slugify('Intro'); // 'intro-1'
 */
function slugify(text: string): string {
  const base = slugBase(text);
  const n = ctx.slugs.get(base) ?? 0;
  ctx.slugs.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

const md = new Marked({ gfm: true, breaks: false }); /** The shared marked instance (GitHub-flavored, single newlines are not line breaks) with the sanitizing renderer below. */

md.use({
  renderer: {
    /**
     * Render raw HTML from the source as literal text.
     *
     * Raw HTML is never injected: it is escaped. Block-level HTML becomes a paragraph styled
     * as raw HTML (trailing newlines trimmed); inline HTML is returned escaped in place.
     *
     * @param {Tokens.HTML | Tokens.Tag} token - The HTML token.
     * @param {string} token.text - The raw HTML source.
     * @param {boolean} token.block - Whether the HTML is a block element.
     * @returns {string} The escaped HTML string.
     *
     * @example
     * md.parse('<script>x</script>'); // '<p class="…rawHtml">&lt;script&gt;x&lt;/script&gt;</p>'
     */
    html({ text, block }: Tokens.HTML | Tokens.Tag) {
      const esc = escapeHtml(text);
      return block ? `<p class="${styles.rawHtml}">${esc.replace(/\n+$/, '')}</p>\n` : esc;
    },
    /**
     * Render a heading with an anchor slug.
     *
     * The heading's plain text (rendered with the text renderer) is slugified and stored in
     * `data-anchor`, which the click handler uses to scroll to `#anchor` links.
     *
     * @param {Tokens.Heading} token - The heading token.
     * @param {Token[]} token.tokens - Inline tokens of the heading.
     * @param {number} token.depth - Heading level (1–6).
     * @returns {string} The `<hN data-anchor="…">` element.
     *
     * @example
     * md.parse('## Getting Started'); // '<h2 data-anchor="getting-started">Getting Started</h2>\n'
     */
    heading({ tokens, depth }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      const plain = this.parser.parseInline(tokens, this.parser.textRenderer);
      return `<h${depth} data-anchor="${escapeHtml(slugify(plain))}">${inner}</h${depth}>\n`;
    },
    /**
     * Render a link, dropping it when its href is unsafe.
     *
     * Links that `classifyLink` rejects render as their content only. Safe links keep their
     * escaped, trimmed href and optional title; autolinks render their escaped text.
     *
     * @param {Tokens.Link} token - The link token.
     * @param {string} token.href - The link target.
     * @param {string | null} [token.title] - Optional link title.
     * @param {Token[]} token.tokens - Inline tokens of the link text.
     * @param {string} token.text - Raw link text.
     * @param {boolean} [token.autolink] - Whether the link is a bare autolinked URL.
     * @returns {string} The `<a>` element, or just the link content.
     *
     * @example
     * md.parse('[x](javascript:alert(1))'); // '<p>x</p>\n'
     */
    link({ href, title, tokens, text, autolink }: Tokens.Link) {
      const inner = autolink ? escapeHtml(text) : this.parser.parseInline(tokens);
      if (!classifyLink(href, ctx.baseDir)) return inner;
      const tt = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href.trim())}"${tt}>${inner}</a>`;
    },
    /**
     * Render an image with a resolved, safe source.
     *
     * The source goes through `resolveImageSrc`; images that can't be resolved render as a
     * "broken image" span showing the alt text (or the file name) with the original href as
     * its tooltip. Resolved images load lazily and decode asynchronously.
     *
     * @param {Tokens.Image} token - The image token.
     * @param {string} token.href - The image source.
     * @param {string | null} [token.title] - Optional image title.
     * @param {string} token.text - The alt text.
     * @returns {string} The `<img>` element or the broken-image placeholder.
     *
     * @example
     * md.parse('![Cat](cat.png)'); // '<p><img src="blob:…" alt="Cat" loading="lazy" decoding="async"></p>\n'
     */
    image({ href, title, text }: Tokens.Image) {
      const src = resolveImageSrc(href, ctx.baseDir);
      const alt = escapeHtml(text);
      if (!src) return `<span class="${styles.brokenImage}" title="${escapeHtml(href)}">${alt || escapeHtml(basename(href) || href)}</span>`;
      const tt = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(src)}" alt="${alt}"${tt} loading="lazy" decoding="async">`;
    },
    /**
     * Render an ordered or unordered list.
     *
     * Emits `start` only for ordered lists that don't start at 1, and adds the task-list class
     * when any item is a GFM task item.
     *
     * @param {Tokens.List} token - The list token.
     * @returns {string} The `<ol>` / `<ul>` element with its items.
     *
     * @example
     * md.parse('3. a\n4. b'); // '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>\n'
     */
    list(token: Tokens.List) {
      let body = '';
      for (const item of token.items) body += this.listitem(item);
      const tag = token.ordered ? 'ol' : 'ul';
      const start = token.ordered && token.start !== '' && token.start !== 1 ? ` start="${token.start}"` : '';
      const cls = token.items.some((i) => i.task) ? ` class="${styles.taskList}"` : '';
      return `<${tag}${start}${cls}>\n${body}</${tag}>\n`;
    },
    /**
     * Render one list item.
     *
     * Task items get the task class, plus the done class when they are checked.
     *
     * @param {Tokens.ListItem} item - The list item token.
     * @returns {string} The `<li>` element.
     *
     * @example
     * md.parse('- [x] ship it'); // '<ul class="…taskList">\n<li class="…task …done">…</li>\n</ul>\n'
     */
    listitem(item: Tokens.ListItem) {
      const body = this.parser.parse(item.tokens);
      if (!item.task) return `<li>${body}</li>\n`;
      return `<li class="${styles.task}${item.checked ? ` ${styles.done}` : ''}">${body}</li>\n`;
    },
    /**
     * Render a GFM task checkbox.
     *
     * The checkbox is disabled (read-only) and carries a localized "Completed" /
     * "Not completed" aria-label in the current locale.
     *
     * @param {Tokens.Checkbox} token - The checkbox token.
     * @param {boolean} token.checked - Whether the task is done.
     * @returns {string} The `<input type="checkbox">` element followed by a space.
     *
     * @example
     * md.parse('- [ ] todo'); // '…<input type="checkbox" class="…check" disabled aria-label="Not completed"> todo…'
     */
    checkbox({ checked }: Tokens.Checkbox) {
      return `<input type="checkbox" class="${styles.check}" disabled${checked ? ' checked' : ''} aria-label="${escapeHtml(t(checked ? S.done : S.todo))}"> `;
    },
  },
});

/**
 * Tokenize markdown source without throwing.
 *
 * Runs the shared marked lexer on the source; any exception from the lexer is caught and
 * reported as null so callers can fall back to showing the escaped source.
 *
 * @param {string} source - The markdown text.
 * @returns {Token[] | null} The marked token list, or null when the lexer fails.
 *
 * @example
 * const tokens = lex('# Title');
 */
function lex(source: string): Token[] | null {
  try {
    return md.lexer(source);
  } catch {
    return null;
  }
}

/**
 * Render a token list to sanitized HTML.
 *
 * Sets up the per-render context (base folder, fresh slug counter) for the renderer hooks and
 * always resets it afterwards. When lexing failed (`tokens` is null) or the parser throws, the
 * escaped source is shown in a `<pre>` instead.
 *
 * @param {Token[] | null} tokens - Tokens from `lex`, or null when lexing failed.
 * @param {string} source - The original markdown, used for the fallback.
 * @param {string} [baseDir] - Folder that relative image/link paths are resolved against.
 * @returns {string} The HTML string.
 *
 * @example
 * renderTokens(lex(src), src, '/Users/me/Documents');
 */
function renderTokens(tokens: Token[] | null, source: string, baseDir?: string): string {
  if (!tokens) return `<pre>${escapeHtml(source)}</pre>`;
  ctx = { baseDir, slugs: new Map() };
  try {
    return md.parser(tokens);
  } catch {
    return `<pre>${escapeHtml(source)}</pre>`;
  } finally {
    ctx = { slugs: new Map() };
  }
}

/**
 * Collect the FS paths referenced by a document's images.
 *
 * Walks every token (including nested ones) and keeps the distinct FS paths of image tokens,
 * so the view can re-render when one of those files changes.
 *
 * @param {Token[] | null} tokens - Tokens from `lex`.
 * @param {string} [baseDir] - Folder that relative image paths are resolved against.
 * @returns {string[]} Unique absolute FS paths (empty when `tokens` is null).
 *
 * @example
 * imagePaths(lex('![a](a.png) ![b](https://x.dev/b.png)'), '/Docs'); // ['/Docs/a.png']
 */
function imagePaths(tokens: Token[] | null, baseDir?: string): string[] {
  if (!tokens) return [];
  const out = new Set<string>();
  md.walkTokens(tokens, (tok) => {
    if (tok.type !== 'image') return;
    const p = imageFSPath((tok as Tokens.Image).href, baseDir);
    if (p) out.add(p);
  });
  return [...out];
}

/**
 * Build a change stamp for an FS node.
 *
 * Combines the node type and modification time, so the stamp changes whenever the file is
 * created, deleted, replaced or modified.
 *
 * @param {FSNode | undefined} n - The node, or undefined when the path doesn't exist.
 * @returns {string} The stamp, or `-` for a missing node.
 *
 * @example
 * stamp(state.nodes['/Users/me/cat.png']); // 'file1730000000000'
 */
const stamp = (n: FSNode | undefined) => (n ? `${n.type}${n.modifiedAt}` : '-');

/**
 * Render markdown to a sanitized HTML string.
 *
 * Raw HTML is escaped, unsafe link/image URLs are dropped, and relative paths are resolved
 * against `opts.baseDir`. Never throws: unparsable input is returned as escaped `<pre>` text.
 *
 * @param {string} source - The markdown text.
 * @param {Object} [opts={}] - Rendering options.
 * @param {string} [opts.baseDir] - Folder that relative image/link paths are resolved against.
 * @returns {string} The HTML string.
 *
 * @example
 * renderMarkdown('**Hi** <b>x</b>'); // '<p><strong>Hi</strong> &lt;b&gt;x&lt;/b&gt;</p>\n'
 */
export function renderMarkdown(source: string, opts: { baseDir?: string } = {}): string {
  return renderTokens(lex(source), source, opts.baseDir);
}

/* ───────────────────────── Component ───────────────────────── */

/** Props of the `Markdown` component. */
export interface MarkdownProps {
  /** The markdown text to render. */
  source: string;
  /** Extra class name for the container. */
  className?: string;
  /** Called for web (http/https) and mailto links instead of opening Safari / Mail. */
  onLinkClick?: (href: string) => void;
  /** Folder that relative image/link paths are resolved against (usually the document's folder). */
  baseDir?: string;
}

/**
 * Render a markdown document as selectable, sanitized HTML inside the OS.
 *
 * The source is tokenized once per change and rendered with `renderTokens`. The rendered HTML
 * is memoized on the tokens, the base folder, the locale (localized checkbox labels) and a
 * primitive key built from the FS stamps of every referenced image, so the view re-renders
 * (with fresh image URLs) only when one of those files changes. Link clicks — and middle
 * clicks, so the raw href never opens in a new browser tab — are handled by `activate`.
 *
 * @param {MarkdownProps} props - Component props.
 * @param {string} props.source - The markdown text.
 * @param {string} [props.className] - Extra class name for the container.
 * @param {(href: string) => void} [props.onLinkClick] - Handler for web and mailto links.
 * @param {string} [props.baseDir] - Folder that relative paths are resolved against.
 * @returns {JSX.Element} The rendered document.
 *
 * @example
 * <Markdown source={text} baseDir="/Users/me/Documents" />
 */
export function Markdown({ source, className, onLinkClick, baseDir }: MarkdownProps) {
  const locale = useLocale();
  const windowId = useContext(WindowContext)?.id;
  const tokens = useMemo(() => lex(source), [source]);
  const images = useMemo(() => imagePaths(tokens, baseDir), [tokens, baseDir]);
  const imagesKey = useFS((s) => (images.length ? images.map((p) => stamp(s.nodes[p])).join('|') : ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => renderTokens(tokens, source, baseDir), [tokens, source, baseDir, imagesKey, locale]);

  /**
   * Open the link under a click inside the OS.
   *
   * Ignores already-handled events and clicks outside an `<a>` of this document; otherwise
   * prevents the browser navigation and dispatches on `classifyLink`:
   * - `anchor`: smooth-scrolls to the heading whose `data-anchor` matches the id as written,
   *   lowercased, or slugified.
   * - `external`: calls `onLinkClick`, or opens the URL in Safari.
   * - `mail`: calls `onLinkClick` with the href, or opens a Mail compose window.
   * - `path`: opens existing FS paths with their default app (alerting when no app can open
   *   it); absolute paths that are not in the FS are public assets of the site and open in
   *   Safari; any other missing path shows a "no such file" alert (as a sheet on this window).
   * Unsafe hrefs do nothing.
   *
   * @param {MouseEvent<HTMLDivElement>} e - The click or aux-click event on the container.
   * @returns {void}
   *
   * @example
   * <div onClick={activate} onAuxClick={(e) => e.button === 1 && activate(e)} />
   */
  const activate = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented) return;
      const a = (e.target as HTMLElement).closest('a');
      if (!a || !e.currentTarget.contains(a)) return;
      e.preventDefault();
      const href = a.getAttribute('href') ?? '';
      const target = classifyLink(href, baseDir);
      if (!target) return;
      switch (target.kind) {
        case 'anchor': {
          const wanted = [target.id, target.id.toLowerCase(), slugBase(target.id)];
          const heads = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-anchor]')];
          const el = wanted.map((id) => heads.find((h) => h.dataset.anchor === id)).find(Boolean);
          el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          return;
        }
        case 'external':
          if (onLinkClick) onLinkClick(target.href);
          else wm.openWindow('safari', { url: target.href });
          return;
        case 'mail':
          if (onLinkClick) onLinkClick(href);
          else openCompose(parseMailto(href.trim()));
          return;
        case 'path': {
          if (fs.exists(target.path)) {
            if (!wm.openPath(target.path)) void dialogs.alert({ windowId, title: S.noApp(basename(target.path)) });
          } else if (href.trim().startsWith('/')) {
            wm.openWindow('safari', { url: new URL(href.trim(), window.location.origin).href });
          } else {
            void dialogs.alert({ windowId, title: S.missingTitle(basename(target.path)) });
          }
        }
      }
    },
    [baseDir, onLinkClick, windowId],
  );

  return (
    <div
      className={`${styles.md} selectable${className ? ` ${className}` : ''}`}
      onClick={activate}
      onAuxClick={(e) => e.button === 1 && activate(e)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default Markdown;

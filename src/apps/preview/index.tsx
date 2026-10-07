import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { FilePenLine, Info, Music, PanelLeft, RotateCcw, RotateCw, Share, ZoomIn, ZoomOut, FileX } from 'lucide-react';
import {
  COMMON,
  PATHS,
  basename,
  dialogs,
  dirname,
  downloadFile,
  fileClipboard,
  fs,
  getDragPaths,
  hasDragPaths,
  hasHostFiles,
  importHostFiles,
  isWithin,
  kindOf,
  normalize,
  revealInFinder,
  showContextMenu,
  stem,
  tildify,
  trashPaths,
  useAppMenus,
  useDir,
  useNode,
  useT,
  useWM,
  useWindowKeydown,
  wm,
  type AppProps,
  type FileKind,
  type FSNode,
  type LString,
  type MenuDef,
  type MenuItem,
} from '@/kernel';
import { Button, EmptyState } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import { Markdown } from '@/components/Markdown';
import { PreviewIcon } from '@/icons';
import { findMovedFile, identityOf, type FileIdentity } from '../textedit/fileTracking';
import { ImageView, type ImageViewHandle } from './ImageView';
import { Inspector } from './Inspector';
import styles from './Preview.module.css';

const S = {
  appName: { en: 'Preview', ko: '미리보기' },
  open: { en: 'Open…', ko: '열기…' },
  close: { en: 'Close', ko: '닫기' },
  openWithTextEdit: { en: 'Open in TextEdit', ko: '텍스트 편집기에서 열기' },
  showInFinder: { en: 'Show in Finder', ko: 'Finder에서 보기' },
  download: { en: 'Download to This Computer', ko: '이 컴퓨터로 다운로드' },
  copyFile: { en: 'Copy File', ko: '파일 복사하기' },
  moveToTrash: COMMON.moveToTrash,
  view: COMMON.view,
  showSidebar: { en: 'Show Sidebar', ko: '사이드바 보기' },
  hideSidebar: { en: 'Hide Sidebar', ko: '사이드바 가리기' },
  actualSize: { en: 'Actual Size', ko: '실제 크기' },
  zoomToFit: { en: 'Zoom to Fit', ko: '윈도우에 맞게 확대/축소' },
  zoomIn: { en: 'Zoom In', ko: '확대' },
  zoomOut: { en: 'Zoom Out', ko: '축소' },
  go: COMMON.go,
  previous: { en: 'Previous', ko: '이전' },
  next: { en: 'Next', ko: '다음' },
  tools: { en: 'Tools', ko: '도구' },
  rotateLeft: { en: 'Rotate Left', ko: '왼쪽으로 회전' },
  rotateRight: { en: 'Rotate Right', ko: '오른쪽으로 회전' },
  zoomGroup: { en: 'Zoom', ko: '확대/축소' },
  rotateGroup: { en: 'Rotate', ko: '회전' },
  showInspector: { en: 'Show Inspector', ko: '속성 보기' },
  hideInspector: { en: 'Hide Inspector', ko: '속성 가리기' },
  share: { en: 'Share', ko: '공유' },
  thumbnails: { en: 'Thumbnails', ko: '축소판' },
  emptyTitle: { en: 'No document open', ko: '열린 문서 없음' },
  emptyMsg: { en: 'Open an image, PDF, markdown, audio or video file.', ko: '이미지, PDF, Markdown, 오디오 또는 동영상 파일을 여십시오.' },
  missingTitle: { en: 'The file couldn’t be opened.', ko: '파일을 열 수 없습니다.' },
  /**
   * Builds the message shown when the window's file cannot be found.
   *
   * Inserts the file name, in quotes, into both the English and the Korean message.
   *
   * @param {string} n - Name of the missing file.
   * @returns {LString} The localized message.
   *
   * @example
   * t(S.missingMsg('cat.png')); // '“cat.png” no longer exists.'
   */
  missingMsg: (n: string) => ({ en: `“${n}” no longer exists.`, ko: `“${n}” 파일이 더 이상 존재하지 않습니다.` }),
  unsupportedTitle: { en: 'Preview can’t show this file.', ko: '미리보기에서 이 파일을 볼 수 없습니다.' },
  /**
   * Builds the message shown when the window's file is of a kind Preview cannot render.
   *
   * Inserts the file name, in quotes, into both the English and the Korean message.
   *
   * @param {string} n - Name of the unsupported file.
   * @returns {LString} The localized message.
   *
   * @example
   * t(S.unsupportedMsg('data.bin')); // '“data.bin” isn’t a document Preview can open.'
   */
  unsupportedMsg: (n: string) => ({ en: `“${n}” isn’t a document Preview can open.`, ko: `“${n}”은(는) 미리보기에서 열 수 있는 문서가 아닙니다.` }),
  kinds: {
    image: { en: 'Image', ko: '이미지' },
    pdf: { en: 'PDF document', ko: 'PDF 문서' },
    markdown: { en: 'Markdown document', ko: 'Markdown 문서' },
    audio: { en: 'Audio', ko: '오디오' },
    video: { en: 'Movie', ko: '동영상' },
    text: { en: 'Plain text document', ko: '일반 텍스트 문서' },
    code: { en: 'Source code', ko: '소스 코드' },
    other: { en: 'Document', ko: '문서' },
  } satisfies Record<string, LString>,
}; /** Localized strings for Preview's menus, toolbar, empty states and file kind labels. */

const MEDIA_KINDS: FileKind[] = ['image', 'pdf', 'audio', 'video']; /** Kinds rendered from a URL; text kinds render the file content directly. */

const OPENS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'pdf', 'md', 'markdown', 'mp3', 'wav', 'm4a', 'mp4', 'webm', 'mov']; /** File extensions offered by the Open panel. */

/**
 * Returns the localized kind label shown in the inspector.
 *
 * Looks the kind up in `S.kinds` and falls back to the generic "Document" label for kinds
 * without a dedicated entry.
 *
 * @param {FileKind} kind - The file kind.
 * @returns {LString} The localized kind label.
 *
 * @example
 * t(kindLabel('pdf')); // 'PDF document'
 */
function kindLabel(kind: FileKind): LString {
  return (S.kinds as Record<string, LString>)[kind] ?? S.kinds.other;
}

/**
 * Stores a Preview window's current document path in its window args.
 *
 * Looks the window up in the window manager and, when its `args.path` differs from `path`,
 * replaces its args with a copy that holds the new path. openDocument relies on these args to
 * find a Preview window that already shows a file. Passing null clears the path.
 *
 * @param {string} windowId - The Preview window to update.
 * @param {string | null} path - The document path, or null for no document.
 * @returns {void}
 *
 * @example
 * rememberPath(windowId, `${PATHS.pictures}/cat.png`);
 */
function rememberPath(windowId: string, path: string | null): void {
  const w = useWM.getState().windows.find((x) => x.id === windowId);
  if (w && w.args.path !== (path ?? undefined)) wm.update(windowId, { args: { ...w.args, path: path ?? undefined } });
}

/**
 * Returns a URL for a media file's bytes.
 *
 * Only media kinds (image, PDF, audio, video) get a URL; other kinds and nodes whose URL cannot
 * be read yield null. PDFs stored as data: URLs are fetched and re-exposed as blob: URLs because
 * browsers refuse to show data: PDFs inside frames. Until that conversion finishes the hook
 * returns null, and the blob URL is revoked when the source changes or the component unmounts.
 *
 * @param {FSNode | undefined} node - The file to expose, or undefined when none is open.
 * @param {FileKind | null} kind - The file's kind, or null when unknown.
 * @returns {string | null} A URL usable in <img>, <iframe>, <audio> or <video>, or null.
 *
 * @example
 * const url = useFileURL(file, file ? kindOf(file) : null);
 * return url ? <iframe src={url} /> : null;
 */
function useFileURL(node: FSNode | undefined, kind: FileKind | null): string | null {
  const direct = useMemo(() => {
    if (!node || node.type !== 'file' || !kind || !MEDIA_KINDS.includes(kind)) return null;
    try {
      return fs.getURL(node.path);
    } catch {
      return null;
    }
  }, [node, kind]);
  const needsBlob = kind === 'pdf' && !!direct?.startsWith('data:');
  const [blob, setBlob] = useState<{ from: string; url: string } | null>(null);

  useEffect(() => {
    if (!needsBlob || !direct) return;
    let url: string | null = null;
    let cancelled = false;
    void fetch(direct)
      .then((r) => r.blob())
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
        setBlob({ from: direct, url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [needsBlob, direct]);

  if (!needsBlob) return direct;
  return blob?.from === direct ? blob.url : null;
}

interface ThumbnailsProps {
  images: FSNode[];
  current: string | null;
  label: string;
  listRef: RefObject<HTMLElement | null>;
  onPick: (path: string) => void;
}

/**
 * Thumbnail sidebar listing the images in the current file's folder.
 *
 * Each image is a button with a lazily loaded preview and its name; the current image is marked
 * with `aria-current` and `data-selected`, which Preview uses to scroll it into view. Images whose
 * URL cannot be read show an empty frame. The component is wrapped in `memo` so zooming or
 * panning the image, which re-renders Preview, does not rebuild every thumbnail URL.
 *
 * @param {Object} props - Component props.
 * @param {FSNode[]} props.images - Image files to list, in folder order.
 * @param {string | null} props.current - Path of the image being shown.
 * @param {string} props.label - Accessible label of the sidebar.
 * @param {RefObject<HTMLElement | null>} props.listRef - Receives the sidebar's <nav> element.
 * @param {(path: string) => void} props.onPick - Called with the path of a clicked thumbnail.
 * @returns {JSX.Element} The sidebar navigation element.
 *
 * @example
 * <Thumbnails images={images} current={path} label="Thumbnails" listRef={sidebarRef} onPick={navigate} />
 */
const Thumbnails = memo(function Thumbnails({ images, current, label, listRef, onPick }: ThumbnailsProps) {
  return (
    <nav ref={listRef} className={styles.sidebar} aria-label={label}>
      {images.map((img) => {
        const selected = img.path === current;
        let src: string | undefined;
        try {
          src = fs.getURL(img.path);
        } catch {
          src = undefined;
        }
        return (
          <button key={img.path} type="button" className={`${styles.thumb} ${selected ? styles.thumbSelected : ''}`} aria-current={selected} data-selected={selected || undefined} onClick={() => onPick(img.path)} title={img.name}>
            <span className={styles.thumbImage}>{src && <img src={src} alt="" loading="lazy" draggable={false} />}</span>
            <span className={styles.thumbLabel}>{img.name}</span>
          </button>
        );
      })}
    </nav>
  );
});

/**
 * Preview app window: a viewer for images, PDFs, markdown, text, source code, audio and video.
 *
 * Opens the file at `args.path`, or shows an empty state with an Open button, and picks a
 * renderer from the file kind. Images use ImageView (fit/zoom/pan/rotate) with a thumbnail
 * sidebar of the images in the same folder and ←/↑ and →/↓ navigation; PDFs render in an
 * iframe, covered by a shield while the window is unfocused so the first click focuses it;
 * markdown, plain text and source code render on a zoomable paper page that updates live when
 * the file changes; audio and video use native controls. When another app renames or moves the
 * file, the window follows it through the file's identity and the FS move journal (moves into
 * the Trash are ignored), and the current path is stored in the window args. The window title
 * shows the file name. It contributes File, View, Go and Tools menus, a toolbar with zoom,
 * rotate, inspector and share buttons, and accepts dropped files. The image zoom percentage is
 * only reported back while the inspector is open, so a pinch does not re-render Preview on
 * every frame.
 *
 * @param {Object} props - Standard app props (AppProps).
 * @param {string} props.windowId - Id of the window this instance renders in.
 * @param {AppArgs} props.args - Window arguments; `args.path` is the file to open.
 * @returns {JSX.Element} The Preview window content.
 *
 * @example
 * wm.openWindow('preview', { path: `${PATHS.pictures}/cat.png` });
 */
export default function Preview({ windowId, args }: AppProps) {
  const t = useT();
  const focused = useWM((s) => s.focusedId === windowId);
  const [path, setPath] = useState<string | null>(() => (typeof args.path === 'string' ? normalize(args.path) : null));
  const node = useNode(path);
  const file = node?.type === 'file' ? node : undefined;
  const kind = file ? kindOf(file) : null;
  const url = useFileURL(file, kind);

  const [sidebar, setSidebar] = useState<boolean | null>(null);
  const [inspector, setInspector] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [zoomPct, setZoomPct] = useState<number | null>(null);
  const [textScale, setTextScale] = useState(1);
  const [dropping, setDropping] = useState(false);
  const imageRef = useRef<ImageViewHandle>(null);
  const identity = useRef<FileIdentity | null>(file ? identityOf(file) : null);

  useEffect(() => {
    if (file) {
      identity.current = identityOf(file);
      return;
    }
    if (!path || !identity.current) return;
    const moved = findMovedFile(identity.current, path);
    if (moved && !isWithin(moved.path, PATHS.trash)) {
      setPath(moved.path);
      rememberPath(windowId, moved.path);
    }
  }, [file, path, windowId]);

  useEffect(() => {
    wm.setTitle(windowId, path ? basename(path) : t(S.appName));
  }, [windowId, path, t]);

  const folder = path ? dirname(path) : null;
  const siblings = useDir(kind === 'image' ? folder : null);
  const images = useMemo(() => siblings.filter((n) => n.type === 'file' && kindOf(n) === 'image'), [siblings]);
  const index = images.findIndex((n) => n.path === path);
  const sidebarVisible = kind === 'image' && (sidebar ?? images.length > 1);

  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sidebarRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [path, sidebarVisible]);

  /**
   * Shows another file in this window.
   *
   * Switches the displayed path, clears the dimensions reported for the previous file and stores
   * the new path in the window args.
   *
   * @param {string} p - Path of the file to show.
   * @returns {void}
   *
   * @example
   * navigate(images[0].path);
   */
  const navigate = useCallback(
    (p: string) => {
      setPath(p);
      setDimensions(null);
      rememberPath(windowId, p);
    },
    [windowId],
  );

  /**
   * Shows the previous or next image in the folder, wrapping around at either end.
   *
   * Does nothing when the folder has fewer than two images or the current file is not one of
   * them.
   *
   * @param {1 | -1} dir - 1 for the next image, -1 for the previous one.
   * @returns {void}
   *
   * @example
   * step(1);
   */
  const step = useCallback(
    (dir: 1 | -1) => {
      if (images.length < 2 || index < 0) return;
      navigate(images[(index + dir + images.length) % images.length].path);
    },
    [images, index, navigate],
  );

  useWindowKeydown((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || kind !== 'image') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    }
  });

  /**
   * Opens a document, reusing windows where possible.
   *
   * Normalizes the path, then focuses an existing Preview window that already shows it;
   * otherwise loads it into this window when this window has no file (empty or missing), or
   * opens a new Preview window for it.
   *
   * @param {string} p - Path of the document to open.
   * @returns {void}
   *
   * @example
   * openDocument(`${PATHS.pictures}/cat.png`);
   */
  const openDocument = useCallback(
    (p: string) => {
      const target = normalize(p);
      const existing = useWM.getState().windows.find((w) => w.appId === 'preview' && w.args.path === target);
      if (existing) wm.focus(existing.id);
      else if (!path || !file) navigate(target);
      else wm.openWindow('preview', { path: target });
    },
    [path, file, navigate],
  );

  /**
   * Shows the Open panel as a sheet on this window and opens the chosen document.
   *
   * The panel starts in the current file's folder when that folder still exists, otherwise in
   * ~/Pictures, and only offers the extensions in OPENS. Cancelling does nothing.
   *
   * @async
   * @returns {Promise<void>} Resolves after the panel closes and any chosen file is opened.
   *
   * @example
   * void openPanel();
   */
  const openPanel = useCallback(async () => {
    const p = await dialogs.open({ windowId, defaultDir: folder && fs.isDir(folder) ? folder : PATHS.pictures, extensions: OPENS });
    if (p) openDocument(p);
  }, [windowId, folder, openDocument]);

  /**
   * Moves the current file to the Trash and shows what comes next.
   *
   * For an image with siblings, the next image is shown right away so the "missing file" state
   * never flashes, except when the file is already in the Trash, where deleting it asks for
   * confirmation first. If the file still exists afterwards (the deletion was cancelled or
   * failed), the window returns to it; otherwise it shows the next image, or closes when there
   * is none. Does nothing when no file is open.
   *
   * @async
   * @returns {Promise<void>} Resolves once the file has been trashed and the view updated.
   *
   * @example
   * void moveToTrash();
   */
  const moveToTrash = useCallback(async () => {
    if (!file) return;
    const nextImage = kind === 'image' && images.length > 1 ? images[(index + 1) % images.length].path : null;
    const target = file.path;
    const eager = !!nextImage && !isWithin(target, PATHS.trash);
    if (eager) navigate(nextImage);
    await trashPaths([target], windowId);
    if (fs.exists(target)) {
      if (eager) navigate(target);
      return;
    }
    if (nextImage) navigate(nextImage);
    else void wm.close(windowId, { force: true });
  }, [file, kind, images, index, windowId, navigate]);

  /**
   * Runs a zoom command for the current document.
   *
   * Images delegate to the ImageView handle. Markdown, text and code change the paper's text
   * scale by 10% per step, clamped to 0.6–3×, while "actual" and "fit" reset it to 1. Other
   * kinds ignore the command.
   *
   * @param {'in' | 'out' | 'actual' | 'fit'} op - The zoom command.
   * @returns {void}
   *
   * @example
   * zoom('in');
   */
  const zoom = useCallback(
    (op: 'in' | 'out' | 'actual' | 'fit') => {
      if (kind === 'image') {
        const v = imageRef.current;
        if (op === 'in') v?.zoomIn();
        else if (op === 'out') v?.zoomOut();
        else if (op === 'actual') v?.actualSize();
        else v?.zoomToFit();
      } else if (kind === 'markdown' || kind === 'text' || kind === 'code') {
        setTextScale((s) => (op === 'in' ? Math.min(3, s * 1.1) : op === 'out' ? Math.max(0.6, s / 1.1) : 1));
      }
    },
    [kind],
  );

  /**
   * Opens the Share menu just below the toolbar button.
   *
   * Offers downloading the file to the host computer, copying it to the file clipboard and
   * revealing it in Finder. Does nothing when no file is open.
   *
   * @param {ReactMouseEvent<HTMLButtonElement>} e - Click event of the Share button.
   * @returns {void}
   *
   * @example
   * <button onClick={shareMenu} />
   */
  const shareMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!file) return;
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {}, stopPropagation: () => {} }, [
      { label: S.download, action: () => downloadFile(file.path) },
      { label: S.copyFile, action: () => fileClipboard.copy([file.path]) },
      { separator: true },
      { label: S.showInFinder, action: () => revealInFinder(file.path) },
    ]);
  };

  const zoomable = kind === 'image' || kind === 'markdown' || kind === 'text' || kind === 'code';
  const textual = kind === 'markdown' || kind === 'text' || kind === 'code';
  const api = useRef({ openPanel, moveToTrash, zoom, step });
  useLayoutEffect(() => {
    api.current = { openPanel, moveToTrash, zoom, step };
  });

  useAppMenus((): MenuDef[] => {
    /**
     * Returns the latest command callbacks.
     *
     * Menu actions call through the `api` ref, which a layout effect refreshes on every render,
     * so the menus always run the current callbacks without being rebuilt when they change.
     *
     * @returns {typeof api.current} The current openPanel, moveToTrash, zoom and step callbacks.
     *
     * @example
     * a().zoom('in');
     */
    const a = () => api.current;
    const sep: MenuItem = { separator: true };
    const p = file?.path;
    return [
      {
        label: COMMON.file,
        items: [
          { label: S.open, shortcut: 'mod+o', action: () => void a().openPanel() },
          sep,
          { label: S.close, shortcut: 'alt+w', action: () => void wm.close(windowId) },
          sep,
          { label: S.openWithTextEdit, disabled: !p || !textual, action: () => p && wm.openPath(p, 'textedit') },
          { label: S.showInFinder, disabled: !p, action: () => p && revealInFinder(p) },
          { label: S.download, disabled: !p, action: () => p && downloadFile(p) },
          sep,
          { label: S.moveToTrash, shortcut: 'mod+backspace', disabled: !p || fs.isProtected(p), action: () => void a().moveToTrash() },
        ],
      },
      {
        label: S.view,
        items: [
          { label: sidebarVisible ? S.hideSidebar : S.showSidebar, shortcut: 'mod+alt+s', disabled: kind !== 'image', action: () => setSidebar(!sidebarVisible) },
          sep,
          { label: S.actualSize, shortcut: 'mod+0', disabled: !zoomable, action: () => a().zoom('actual') },
          { label: S.zoomToFit, shortcut: 'mod+9', disabled: kind !== 'image', action: () => a().zoom('fit') },
          { label: S.zoomIn, shortcut: 'mod+=', disabled: !zoomable, action: () => a().zoom('in') },
          { label: S.zoomOut, shortcut: 'mod+-', disabled: !zoomable, action: () => a().zoom('out') },
        ],
      },
      {
        label: S.go,
        items: [
          { label: S.previous, disabled: images.length < 2 || kind !== 'image', action: () => a().step(-1) },
          { label: S.next, disabled: images.length < 2 || kind !== 'image', action: () => a().step(1) },
        ],
      },
      {
        label: S.tools,
        items: [
          { label: S.rotateLeft, shortcut: 'mod+[', disabled: kind !== 'image', action: () => imageRef.current?.rotate(-1) },
          { label: S.rotateRight, shortcut: 'mod+]', disabled: kind !== 'image', action: () => imageRef.current?.rotate(1) },
          sep,
          { label: inspector ? S.hideInspector : S.showInspector, shortcut: 'mod+i', disabled: !file, action: () => setInspector((v) => !v) },
        ],
      },
    ];
  }, [t, windowId, file, kind, sidebarVisible, zoomable, textual, images.length, inspector]);

  /**
   * Accepts drags that carry virtual file paths or files from the host computer.
   *
   * Marks the drop as a copy and turns on the drop highlight; other drags are ignored.
   *
   * @param {DragEvent} e - Drag-over event on the window content.
   * @returns {void}
   *
   * @example
   * <div onDragOver={onDragOver} />
   */
  const onDragOver = (e: DragEvent) => {
    if (!hasDragPaths(e) && !hasHostFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropping) setDropping(true);
  };
  /**
   * Opens dropped files.
   *
   * Files dragged from the host computer are imported into ~/Downloads first. Folders are
   * skipped; the first file goes through openDocument (loading into this window when it has no
   * file) and every other file opens with Preview in its own window.
   *
   * @async
   * @param {DragEvent} e - Drop event on the window content.
   * @returns {Promise<void>} Resolves once the files have been imported and opened.
   *
   * @example
   * <div onDrop={(e) => void onDrop(e)} />
   */
  const onDrop = async (e: DragEvent) => {
    if (!hasDragPaths(e) && !hasHostFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const paths = hasDragPaths(e) ? getDragPaths(e) : (await importHostFiles(e.dataTransfer.files, PATHS.downloads)).created;
    const [first, ...rest] = paths.filter((p) => fs.stat(p)?.type === 'file');
    if (first) openDocument(first);
    for (const p of rest) wm.openPath(p, 'preview');
  };

  const name = path ? basename(path) : '';
  let content;
  if (!path) {
    content = (
      <EmptyState
        icon={<PreviewIcon size={64} />}
        title={t(S.emptyTitle)}
        subtitle={
          <div className={styles.emptyBody}>
            <span>{t(S.emptyMsg)}</span>
            <Button variant="primary" onClick={() => void openPanel()}>
              {t(S.open)}
            </Button>
          </div>
        }
      />
    );
  } else if (!file) {
    content = (
      <EmptyState
        icon={<FileX size={44} strokeWidth={1.2} />}
        title={t(S.missingTitle)}
        subtitle={
          <div className={styles.emptyBody}>
            <span>{t(S.missingMsg(name))}</span>
            <Button onClick={() => void openPanel()}>{t(S.open)}</Button>
          </div>
        }
      />
    );
  } else if (kind === 'image' && url) {
    content = (
      <ImageView
        key={file.path}
        ref={imageRef}
        src={url}
        alt={name}
        vector={file.name.toLowerCase().endsWith('.svg')}
        onDimensions={setDimensions}
        onZoomChange={inspector ? setZoomPct : undefined}
      />
    );
  } else if (kind === 'pdf') {
    content = url ? (
      <div className={styles.pdfWrap}>
        <iframe className={styles.pdf} src={url} title={name} />
        {/* Clicks inside the frame never reach this document: let the first click focus the window. */}
        {!focused && <div className={styles.frameShield} aria-hidden />}
      </div>
    ) : (
      <div className={styles.pdfLoading} />
    );
  } else if (kind === 'markdown' || kind === 'text' || kind === 'code') {
    content = (
      <div className={styles.paperScroll}>
        <article className={styles.paper} style={{ fontSize: `${14 * textScale}px` }}>
          {kind === 'markdown' ? (
            <Markdown source={file.content ?? ''} baseDir={dirname(file.path)} className={styles.paperMd} />
          ) : (
            <pre className={`${styles.plain} selectable`}>{file.content ?? ''}</pre>
          )}
        </article>
      </div>
    );
  } else if (kind === 'audio' && url) {
    content = (
      <div className={styles.audio}>
        <div className={styles.artwork} aria-hidden>
          <Music size={72} strokeWidth={1.4} />
        </div>
        <div className={styles.audioMeta}>
          <strong>{stem(file.name)}</strong>
          <span>{tildify(dirname(file.path))}</span>
        </div>
        <audio key={file.path} className={styles.audioControls} src={url} controls preload="metadata" />
      </div>
    );
  } else if (kind === 'video' && url) {
    content = (
      <div className={styles.video}>
        <video key={file.path} src={url} controls playsInline preload="metadata" onLoadedMetadata={(e) => setDimensions({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })} />
      </div>
    );
  } else {
    content = (
      <EmptyState
        icon={<FileX size={44} strokeWidth={1.2} />}
        title={t(S.unsupportedTitle)}
        subtitle={
          <div className={styles.emptyBody}>
            <span>{t(S.unsupportedMsg(name))}</span>
            <Button onClick={() => downloadFile(file.path)}>{t(S.download)}</Button>
          </div>
        }
      />
    );
  }

  return (
    <div className={`${styles.root} ${dropping ? styles.dropping : ''}`} onDragOver={onDragOver} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)} onDrop={(e) => void onDrop(e)}>
      {file && (
        <div className={styles.toolbar}>
          <GlassGroup>
            <button type="button" className={`ui-icon-btn ${styles.toolBtn} ${sidebarVisible ? 'active' : ''}`} aria-label={t(sidebarVisible ? S.hideSidebar : S.showSidebar)} title={t(sidebarVisible ? S.hideSidebar : S.showSidebar)} disabled={kind !== 'image'} onClick={() => setSidebar(!sidebarVisible)}>
              <PanelLeft size={16} />
            </button>
          </GlassGroup>
          <div className={styles.toolbarSpacer} />
          {zoomable && (
            <GlassGroup label={t(S.zoomGroup)}>
              <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.zoomOut)} title={t(S.zoomOut)} onClick={() => zoom('out')}>
                <ZoomOut size={16} />
              </button>
              <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.zoomIn)} title={t(S.zoomIn)} onClick={() => zoom('in')}>
                <ZoomIn size={16} />
              </button>
            </GlassGroup>
          )}
          {kind === 'image' && (
            <GlassGroup label={t(S.rotateGroup)}>
              <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.rotateLeft)} title={t(S.rotateLeft)} onClick={() => imageRef.current?.rotate(-1)}>
                <RotateCcw size={16} />
              </button>
              <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.rotateRight)} title={t(S.rotateRight)} onClick={() => imageRef.current?.rotate(1)}>
                <RotateCw size={16} />
              </button>
            </GlassGroup>
          )}
          {textual && (
            <GlassGroup>
              <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.openWithTextEdit)} title={t(S.openWithTextEdit)} onClick={() => wm.openPath(file.path, 'textedit')}>
                <FilePenLine size={16} />
              </button>
            </GlassGroup>
          )}
          <GlassGroup>
            <button type="button" className={`ui-icon-btn ${styles.toolBtn} ${inspector ? 'active' : ''}`} aria-label={t(inspector ? S.hideInspector : S.showInspector)} title={t(inspector ? S.hideInspector : S.showInspector)} aria-pressed={inspector} onClick={() => setInspector((v) => !v)}>
              <Info size={16} />
            </button>
          </GlassGroup>
          <GlassGroup>
            <button type="button" className={`ui-icon-btn ${styles.toolBtn}`} aria-label={t(S.share)} title={t(S.share)} aria-haspopup="menu" onClick={shareMenu}>
              <Share size={16} />
            </button>
          </GlassGroup>
        </div>
      )}

      <div className={styles.main}>
        {sidebarVisible && <Thumbnails images={images} current={path} label={t(S.thumbnails)} listRef={sidebarRef} onPick={navigate} />}
        <div className={`${styles.content} ${kind === 'video' ? styles.dark : ''}`}>{content}</div>
        {inspector && file && kind && <Inspector node={file} kindLabel={kindLabel(kind)} dimensions={dimensions} zoom={kind === 'image' ? zoomPct : null} onClose={() => setInspector(false)} />}
      </div>
    </div>
  );
}

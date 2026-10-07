/**
 * Finder file icons: folders (with embossed glyphs for special folders), document pages per file
 * kind, live image thumbnails, .app bundles and the startup disk.
 */
import { createElement, useMemo, useState, type ReactNode } from 'react';
import type { FSNode } from '@/kernel/types';
import { PATHS, HOME } from '@/kernel/constants';
import { extname, stem } from '@/kernel/path';
import { kindOf, useTrashCount, type FileKind } from '@/kernel/fs';
import { getApp, listApps } from '@/kernel/registry';
import { FONT, GLASS_MIN, IconSvg, VGrad, gearPath, hairline, sparklePath, useIconIds, type IconIds } from './shared';
import { GenericAppIcon } from './apps';
import { HardDriveIcon, TrashFullIcon, TrashIcon } from './system';
import styles from './FileIcon.module.css';

/**
 * The part of a file-system node that {@link FileIcon} reads: type, name and path, plus the
 * optional image URL (`src`) and text content (SVG source, or the app id of an .app bundle).
 */
export type FileIconNode = Pick<FSNode, 'type' | 'name' | 'path'> & Partial<Pick<FSNode, 'src' | 'content'>>;

const DETAIL_MIN = 28; /** Smallest document icon size (px) drawn with fine text lines and strokes; smaller sizes use fewer, bolder lines. */
const LABEL_MIN = 40; /** Smallest document icon size (px) that shows text labels (extension, "PDF", badges); below it they would only render as noise. */

/* ───────────────────────── Folder glyphs ───────────────────────── */

/** Names of the glyphs embossed on special folders. */
export type FolderGlyph =
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'pictures'
  | 'music'
  | 'movies'
  | 'public'
  | 'applications'
  | 'projects'
  | 'notes'
  | 'library'
  | 'system'
  | 'users';

const GLYPHS: Record<FolderGlyph, ReactNode> = {
  home: <path d="M3.5 11.2L12 4L20.5 11.2M6 9.4V19.5H18V9.4M10 19.5V14.5H14V19.5" />,
  desktop: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.8" />
      <path d="M12 16.5V20M8.5 20H15.5" />
    </>
  ),
  documents: <path d="M7 3.5H13.5L18 8V20.5H7ZM13.5 3.5V8H18M9.8 12H15.2M9.8 15.5H15.2" />,
  downloads: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V16M8.6 12.7L12 16.1L15.4 12.7" />
    </>
  ),
  pictures: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="M3.8 17L9 12.6L12.4 15.4L15.6 12.4L20.2 16.6" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6.6L19 4.6V15.6" />
      <circle cx="6.9" cy="18" r="2.2" fill="currentColor" />
      <circle cx="16.9" cy="15.6" r="2.2" fill="currentColor" />
    </>
  ),
  movies: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 4V20M16 4V20M4 8H8M4 12H8M4 16H8M16 8H20M16 12H20M16 16H20" />
    </>
  ),
  public: (
    <>
      <circle cx="12" cy="9" r="2.6" />
      <path d="M7.6 18.5C7.6 14.6 16.4 14.6 16.4 18.5M6 5.8Q3.6 9 6 12.2M18 5.8Q20.4 9 18 12.2" />
    </>
  ),
  applications: <path d="M6.6 19.5L13.2 5M17.4 19.5L10.8 5M5.2 14.6H18.8" />,
  projects: (
    <>
      <path d="M4 10.2L10.5 6.7L17 10.2L10.5 13.7ZM4 14L10.5 17.5L17 14M4 17.8L10.5 21.3L17 17.8" />
      <path d={sparklePath(19, 5.2, 3.3, 0.3)} fill="currentColor" stroke="none" />
    </>
  ),
  notes: <path d="M15.2 5.3L18.7 8.8L8.6 18.9H5.1V15.4ZM13 7.5L16.5 11" />,
  library: <path d="M3.5 9L12 4L20.5 9ZM3.5 20H20.5M6.5 11.2V17.5M10.2 11.2V17.5M13.8 11.2V17.5M17.5 11.2V17.5" />,
  system: (
    <>
      <path d={gearPath(12, 12, 6.3, 8.6, 8, 0.34, 0.52)} />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="2.8" />
      <path d="M3.5 19C3.5 14.4 14.5 14.4 14.5 19" />
      <circle cx="16.3" cy="9.6" r="2.2" />
      <path d="M16 14.2C18.6 14.1 20.5 15.7 20.5 18.6" />
    </>
  ),
}; /** Folder glyph artwork, drawn in a 24×24 box as stroked outlines; `currentColor` is the emboss color. */

const SPECIAL_FOLDERS: Record<string, FolderGlyph> = {
  [PATHS.home]: 'home',
  [PATHS.desktop]: 'desktop',
  [PATHS.documents]: 'documents',
  [PATHS.downloads]: 'downloads',
  [PATHS.pictures]: 'pictures',
  [PATHS.music]: 'music',
  [`${HOME}/Movies`]: 'movies',
  [`${HOME}/Public`]: 'public',
  [`${HOME}/Library`]: 'library',
  [PATHS.applications]: 'applications',
  [PATHS.projects]: 'projects',
  [PATHS.notes]: 'notes',
  '/Library': 'library',
  '/System/Library': 'library',
  '/System': 'system',
  '/Users': 'users',
  '/Users/Shared': 'users',
}; /** Exact folder paths that get an embossed glyph, mapped to that glyph. */

/**
 * Looks up the glyph Finder shows on a special folder.
 *
 * Matches the exact path against the known special folders (home, Desktop, Downloads,
 * Applications, /System, …); subfolders of them do not inherit the glyph.
 *
 * @param {string} path - Absolute folder path.
 * @returns {FolderGlyph | undefined} The glyph name, or undefined for an ordinary folder.
 *
 * @example
 * folderGlyphFor('/System'); // 'system'
 */
export function folderGlyphFor(path: string): FolderGlyph | undefined {
  return SPECIAL_FOLDERS[path];
}

/* ───────────────────────── Folder ───────────────────────── */

const FOLDER_BACK = 'M10.5 19H35.2Q37.8 19 39.5 20.8L43 24.5H89.5Q93 24.5 93 28V80.5Q93 84 89.5 84H10.5Q7 84 7 80.5V22.5Q7 19 10.5 19Z'; /** Outline of the folder's back panel including the tab, in 100×100 units. */
const FOLDER_FRONT = 'M10.2 31H89.8Q93 31 93 34.2V80.5Q93 84 89.5 84H10.5Q7 84 7 80.5V34.2Q7 31 10.2 31Z'; /** Outline of the folder's front panel, in 100×100 units. */

/**
 * Renders the macOS blue folder icon, optionally with an embossed glyph on its face.
 *
 * Layers a darker back panel with its tab, the lighter front panel, each over a faint offset
 * shadow, and a Liquid Glass gloss: light pooled on the upper front, a bright top edge on the
 * front panel and, from {@link GLASS_MIN} px, a softer one along the tab. The edges are strokes
 * centered on the panel outline and clipped to it, so only the inner half shows as a lit edge.
 * The glyph is drawn twice, a white copy offset downward under a blue one, to look embossed; it
 * is omitted below 20px and drawn with heavier strokes below 48px.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered width and height in px.
 * @param {FolderGlyph} [props.glyph] - Glyph embossed on the front panel.
 * @returns {JSX.Element} The folder SVG.
 *
 * @example
 * <FolderIcon size={64} glyph="downloads" />
 */
export function FolderIcon({ size, glyph }: { size: number; glyph?: FolderGlyph }) {
  const ids = useIconIds();
  const showGlyph = glyph && size >= 20;
  const fine = size >= GLASS_MIN;
  const edge = hairline(size, 1.6, 1.4);
  return (
    <IconSvg size={size}>
      <defs>
        <VGrad id={ids('back')} from="#5db3f6" to="#3d95e6" />
        <VGrad id={ids('front')} from="#a3dcff" to="#6abcf7" />
        <linearGradient id={ids('gloss')} x1="0" y1="31" x2="0" y2="84" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="0.2" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id={ids('frontEdge')} x1="0" y1="31" x2="0" y2="84" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.92" />
          <stop offset="0.05" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="0.16" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
        <clipPath id={ids('frontClip')}>
          <path d={FOLDER_FRONT} />
        </clipPath>
        {fine && (
          <>
            <linearGradient id={ids('backEdge')} x1="0" y1="19" x2="0" y2="84" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="0.12" stopColor="#fff" stopOpacity="0.28" />
              <stop offset="0.18" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={ids('backClip')}>
              <path d={FOLDER_BACK} />
            </clipPath>
          </>
        )}
      </defs>
      <path d={FOLDER_BACK} fill="#0a4a8c" fillOpacity="0.18" transform="translate(0 1)" />
      <path d={FOLDER_BACK} fill={ids.url('back')} />
      {fine && <path d={FOLDER_BACK} fill="none" stroke={ids.url('backEdge')} strokeWidth={edge} clipPath={ids.url('backClip')} />}
      <path d={FOLDER_FRONT} fill="#0a4a8c" fillOpacity="0.2" transform="translate(0 -0.8)" />
      <path d={FOLDER_FRONT} fill={ids.url('front')} />
      <path d={FOLDER_FRONT} fill={ids.url('gloss')} />
      <path d={FOLDER_FRONT} fill="none" stroke={ids.url('frontEdge')} strokeWidth={edge} clipPath={ids.url('frontClip')} />
      <path d={FOLDER_FRONT} fill="none" stroke="#1f6fbf" strokeOpacity="0.28" strokeWidth="0.6" />
      {showGlyph && (
        <g transform="translate(36 44) scale(1.1667)" fill="none" strokeWidth={size < 48 ? 2.3 : 1.85} strokeLinecap="round" strokeLinejoin="round">
          <g color="#fff" stroke="currentColor" opacity="0.55" transform="translate(0 0.75)">
            {GLYPHS[glyph]}
          </g>
          <g color="#2c7fd0" stroke="currentColor" opacity="0.82">
            {GLYPHS[glyph]}
          </g>
        </g>
      )}
    </IconSvg>
  );
}

/* ───────────────────────── Documents ───────────────────────── */

const PAGE = 'M22 7H63L81 25V90Q81 93 78 93H22Q19 93 19 90V10Q19 7 22 7Z'; /** Outline of a document page with its top-right corner cut off, in 100×100 units. */
const FLAP = 'M63 7V21.5Q63 25 66.5 25H81Z'; /** Folded-over corner drawn over the page's cut-off corner. */

/**
 * Draws ragged text lines on a document page.
 *
 * Emits one path of rounded horizontal strokes starting at x = 27, from `y0` down to `y1`
 * inclusive. Line widths cycle through a fixed list so the right edge looks like real text. In
 * detail mode the lines are thinner and closer together (6 units apart instead of 10).
 *
 * @param {number} y0 - Y of the first line.
 * @param {number} y1 - Largest y a line may be drawn at.
 * @param {boolean} detail - Whether to draw the fine, dense variant.
 * @param {string} [color='#c6c8cd'] - Stroke color.
 * @returns {ReactNode} A single `<path>` with all lines.
 *
 * @example
 * {lines(31, 67, size >= DETAIL_MIN)}
 */
function lines(y0: number, y1: number, detail: boolean, color = '#c6c8cd'): ReactNode {
  const step = detail ? 6 : 10;
  const widths = detail ? [46, 40, 44, 31, 46, 42, 36, 45, 27, 40, 44] : [44, 34, 44, 28, 40];
  let d = '';
  for (let y = y0, i = 0; y <= y1; y += step, i++) d += `M27 ${y}H${27 + widths[i % widths.length]}`;
  return <path d={d} stroke={color} strokeWidth={detail ? 2.3 : 4} strokeLinecap="round" />;
}

const CODE_COLORS: Record<string, [string, string, string]> = {
  js: ['#f0c419', '#3d3000', '#c99a00'],
  jsx: ['#f0c419', '#3d3000', '#c99a00'],
  ts: ['#3178c6', '#fff', '#3178c6'],
  tsx: ['#3178c6', '#fff', '#3178c6'],
  json: ['#6e7781', '#fff', '#6e7781'],
  css: ['#7b4fd6', '#fff', '#7b4fd6'],
  html: ['#e5532d', '#fff', '#e5532d'],
  htm: ['#e5532d', '#fff', '#e5532d'],
  sh: ['#2f9e44', '#fff', '#2f9e44'],
  py: ['#3572a5', '#fff', '#3572a5'],
  yml: ['#cb3837', '#fff', '#cb3837'],
  yaml: ['#cb3837', '#fff', '#cb3837'],
  xml: ['#f08a24', '#fff', '#e07a14'],
  plist: ['#8e8e93', '#fff', '#76767b'],
}; /** Code file colors per extension: [badge, badge text, `</>` glyph]. */

/**
 * Turns a file extension into a short label.
 *
 * Upper-cases the extension and keeps at most four characters.
 *
 * @param {string} ext - Lower-case file extension without the dot.
 * @returns {string} The label text.
 *
 * @example
 * short('sketchfile'); // 'SKET'
 */
const short = (ext: string) => ext.toUpperCase().slice(0, 4);

/**
 * Renders a bold text label centered near the bottom of a document page.
 *
 * Used for file extensions and kind names ("MD") on document icons.
 *
 * @param {Object} props - Component props.
 * @param {string} props.text - Label text.
 * @param {string} [props.color='#7a7a80'] - Text color.
 * @returns {JSX.Element} The SVG `<text>` element.
 *
 * @example
 * <Label text="TXT" />
 */
function Label({ text, color = '#7a7a80' }: { text: string; color?: string }) {
  return (
    <text x="50" y="86" textAnchor="middle" fontFamily={FONT} fontSize="12" fontWeight="700" letterSpacing="0.4" fill={color}>
      {text}
    </text>
  );
}

/**
 * Renders a colored pill badge with centered text near the bottom of a document page.
 *
 * The pill's width grows with the number of characters so the text always fits.
 *
 * @param {Object} props - Component props.
 * @param {string} props.text - Badge text.
 * @param {string} props.bg - Pill fill color.
 * @param {string} props.fg - Text color.
 * @returns {JSX.Element} The pill shape and its text.
 *
 * @example
 * <Pill text="TS" bg="#3178c6" fg="#fff" />
 */
function Pill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  const w = 12 + text.length * 7.4;
  return (
    <>
      <rect x={50 - w / 2} y="73" width={w} height="13.5" rx="6.75" fill={bg} />
      <text x="50" y="83.1" textAnchor="middle" fontFamily={FONT} fontSize="9.6" fontWeight="700" letterSpacing="0.3" fill={fg}>
        {text}
      </text>
    </>
  );
}

/**
 * Draws the kind-specific artwork on a document page.
 *
 * Text and markdown get ragged lines, code a `</>` glyph with a language-colored badge, PDF a
 * red band, links a globe, audio a note, video a film frame, archives a zipper and images a
 * small landscape; other kinds only get an extension label. Labels are drawn only when
 * `labels` is set; without them a code file's badge is a plain pill with no text. Gradients
 * are referenced through `ids` and must be declared by the caller (see {@link KIND_GRADIENTS}).
 *
 * @param {FileKind} kind - Kind of the file.
 * @param {string} ext - Lower-case extension, or '' when the name has none.
 * @param {boolean} detail - Whether to use fine lines.
 * @param {boolean} labels - Whether to draw text labels.
 * @param {IconIds} ids - Id generator of the enclosing icon instance.
 * @returns {ReactNode} The artwork, or null when there is nothing to draw.
 *
 * @example
 * {docBody('code', 'ts', true, true, ids)}
 */
function docBody(kind: FileKind, ext: string, detail: boolean, labels: boolean, ids: IconIds): ReactNode {
  switch (kind) {
    case 'text':
      return (
        <>
          {lines(31, ext ? 67 : 80, detail)}
          {labels && ext && <Label text={short(ext)} />}
        </>
      );
    case 'markdown':
      return (
        <>
          <path d="M27 31H52" stroke="#9fa2a9" strokeWidth={detail ? 3.4 : 5} strokeLinecap="round" />
          {lines(detail ? 39 : 43, 67, detail)}
          {labels && <Label text="MD" color="#6a6a70" />}
        </>
      );
    case 'code': {
      const [bg, fg, glyph] = CODE_COLORS[ext] ?? ['#8e8e93', '#fff', '#76767b'];
      return (
        <>
          <path
            d="M38.5 38L29.5 48L38.5 58M61.5 38L70.5 48L61.5 58M54 34.5L46 61.5"
            fill="none"
            stroke={glyph}
            strokeWidth={detail ? 3.6 : 5.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {labels ? <Pill text={short(ext)} bg={bg} fg={fg} /> : <rect x="32" y="72" width="36" height="12" rx="6" fill={bg} />}
        </>
      );
    }
    case 'pdf':
      return (
        <>
          {lines(29, 53, detail)}
          <rect x="19" y="60" width="62" height="16" fill={ids.url('pdf')} />
          {labels && (
            <text x="50" y="72.2" textAnchor="middle" fontFamily={FONT} fontSize="11.5" fontWeight="800" letterSpacing="1" fill="#fff">
              PDF
            </text>
          )}
        </>
      );
    case 'link':
      return (
        <>
          <circle cx="50" cy="51" r="18" fill="#0a4fb8" fillOpacity="0.2" transform="translate(0 1)" />
          <circle cx="50" cy="51" r="18" fill={ids.url('globe')} />
          <g fill="none" stroke="#fff" strokeOpacity="0.92" strokeWidth={detail ? 1.5 : 2.6}>
            <ellipse cx="50" cy="51" rx="7.6" ry="18" />
            <path d="M32 51H68M34.6 41.6Q50 45.4 65.4 41.6M34.6 60.4Q50 56.6 65.4 60.4M50 33V69" />
          </g>
        </>
      );
    case 'audio':
      return (
        <>
          <path d="M42 64V40L63 35V58" fill="none" stroke={ids.url('accent')} strokeWidth="3.4" strokeLinejoin="round" />
          <path d="M42 40L63 35" stroke={ids.url('accent')} strokeWidth="6" />
          <ellipse cx="37.5" cy="64.5" rx="5.6" ry="4.4" transform="rotate(-20 37.5 64.5)" fill={ids.url('accent')} />
          <ellipse cx="58.5" cy="58.5" rx="5.6" ry="4.4" transform="rotate(-20 58.5 58.5)" fill={ids.url('accent')} />
          {labels && <Label text={short(ext)} />}
        </>
      );
    case 'video':
      return (
        <>
          <rect x="29" y="35" width="42" height="31" rx="3.5" fill="#2c2c2e" />
          <path d="M33 38.5H36M39.5 38.5H42.5M46 38.5H49M52.5 38.5H55.5M59 38.5H62M65.5 38.5H67M33 62.5H36M39.5 62.5H42.5M46 62.5H49M52.5 62.5H55.5M59 62.5H62M65.5 62.5H67" stroke="#fff" strokeOpacity="0.85" strokeWidth="2" />
          <path d="M45.5 44.5L57 50.5L45.5 56.5Z" fill="#fff" />
          {labels && <Label text={short(ext)} />}
        </>
      );
    case 'archive': {
      let teeth = '';
      for (let y = 8.5, i = 0; y < 50; y += 3.6, i++) teeth += i % 2 ? `M50 ${y}h4.2` : `M45.8 ${y}h4.2`;
      return (
        <>
          <path d={teeth} stroke="#8e8e93" strokeWidth="2.2" />
          <rect x="44.5" y="50" width="11" height="17" rx="2.6" fill={ids.url('zip')} stroke="#77777c" strokeWidth="0.7" />
          <rect x="47.6" y="56.5" width="4.8" height="7" rx="1.6" fill="#fff" />
          {labels && <Label text={short(ext)} />}
        </>
      );
    }
    case 'image':
      return (
        <>
          <rect x="28" y="33" width="44" height="33" rx="3" fill={ids.url('sky')} />
          <circle cx="62" cy="41.5" r="3.6" fill="#ffd54a" />
          <path d="M28 63L39.5 48.5L47 56.5L55 46.5L72 63V63Q72 66 69 66H31Q28 66 28 63Z" fill="#3aa865" />
          {labels && <Label text={short(ext)} />}
        </>
      );
    default:
      return labels && ext ? <Label text={short(ext)} /> : null;
  }
}

const KIND_GRADIENTS: Partial<Record<FileKind, Array<[id: string, from: string, to: string]>>> = {
  pdf: [['pdf', '#ff5a4f', '#d8281d']],
  link: [['globe', '#5ccaff', '#0a66e8']],
  audio: [['accent', '#ff6a8e', '#ff2d55']],
  archive: [['zip', '#e1e1e6', '#a0a0a6']],
  image: [['sky', '#7fcbff', '#d8f0ff']],
}; /** Gradients each document kind's artwork references, as [local id, from, to]; only the current kind's are declared. */

/**
 * Renders a white document page with a folded corner, decorated for the file's kind.
 *
 * The kind is derived from the file name's extension. The page and flap get a soft offset
 * shadow and a hairline edge of about 0.75 screen px, so a white page still stands out on a
 * white Finder window at list-view sizes; the edge is a little darker below
 * {@link DETAIL_MIN} px. Only the gradients the kind's artwork uses are declared.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered width and height in px.
 * @param {string} props.name - File name, used for its extension.
 * @returns {JSX.Element} The document SVG.
 *
 * @example
 * <DocumentIcon size={64} name="resume.pdf" />
 */
export function DocumentIcon({ size, name }: { size: number; name: string }) {
  const ids = useIconIds();
  const ext = extname(name);
  const kind = kindOf({ type: 'file', name });
  const detail = size >= DETAIL_MIN;
  const labels = size >= LABEL_MIN;
  const edge = hairline(size);
  const edgeOpacity = detail ? 0.2 : 0.3;
  return (
    <IconSvg size={size}>
      <defs>
        <VGrad id={ids('flap')} from="#fbfbfc" to="#d6d7dc" x1={0} y1={0} x2={1} y2={1} />
        {KIND_GRADIENTS[kind]?.map(([id, from, to]) => <VGrad key={id} id={ids(id)} from={from} to={to} />)}
      </defs>
      <path d={PAGE} fill="#000" fillOpacity="0.12" transform="translate(0 1)" />
      <path d={PAGE} fill="#fff" stroke="#000" strokeOpacity={edgeOpacity} strokeWidth={edge} strokeLinejoin="round" />
      {docBody(kind, ext, detail, labels, ids)}
      <path d={FLAP} fill="#000" fillOpacity="0.08" transform="translate(-0.8 1.2)" />
      <path d={FLAP} fill={ids.url('flap')} stroke="#000" strokeOpacity={edgeOpacity} strokeWidth={edge} strokeLinejoin="round" />
    </IconSvg>
  );
}

/* ───────────────────────── Image thumbnails ───────────────────────── */

/**
 * Reads the width / height ratio of an SVG document from its source.
 *
 * Finds the first `<svg>` start tag and uses its `width`/`height` attributes when both are
 * absolute lengths (not percentages), otherwise its `viewBox`. Needed because an SVG with only
 * a viewBox has no intrinsic size, so a loaded `<img>` reports 0×0 (or a 300×150 default)
 * instead of its real proportions.
 *
 * @param {string} source - SVG markup (at least up to the end of the root start tag).
 * @returns {number | undefined} The aspect ratio, or undefined when no positive, finite size
 *   can be read.
 *
 * @example
 * svgAspect('<svg viewBox="0 0 300 100">'); // 3
 */
export function svgAspect(source: string): number | undefined {
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (!tag) return undefined;
  /**
   * Reads one attribute value from the root `<svg>` start tag.
   *
   * Matches the attribute name case-insensitively with single or double quotes and trims the
   * value.
   *
   * @param {string} name - Attribute name.
   * @returns {string | undefined} The trimmed value, or undefined when the attribute is absent.
   *
   * @example
   * attr('viewBox'); // '0 0 300 100'
   */
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]?.trim();
  const w = attr('width');
  const h = attr('height');
  if (w && h && !w.endsWith('%') && !h.endsWith('%')) {
    const ratio = parseFloat(w) / parseFloat(h);
    if (Number.isFinite(ratio) && ratio > 0) return ratio;
  }
  const vb = attr('viewBox')?.split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0) return vb[2] / vb[3];
  return undefined;
}

const SVG_HEAD = 4096; /** Number of data: URL payload characters decoded when sniffing an SVG's size; the root <svg> tag sits within the first few KB. */

/**
 * Reads the aspect ratio of an inline SVG image from its `data:image/svg+xml,…` URL.
 *
 * Decodes only the first {@link SVG_HEAD} characters of the payload and passes them to
 * {@link svgAspect}. A base64 payload is trimmed to a multiple of four characters before
 * `atob`, and a decoding error yields undefined. A percent-encoded payload has only its ASCII
 * escapes decoded (others become "?"): those are all the attributes need, and unlike
 * `decodeURIComponent` this cannot throw on a multi-byte sequence cut off by the slice.
 *
 * @param {string} src - Image URL.
 * @returns {number | undefined} The aspect ratio, or undefined for other URLs or when it cannot
 *   be read.
 *
 * @example
 * dataUrlSvgAspect(`data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 100 200"/>')}`); // 0.5
 */
function dataUrlSvgAspect(src: string): number | undefined {
  const m = /^data:image\/svg\+xml([^,]*),/i.exec(src);
  if (!m) return undefined;
  const body = src.slice(m[0].length, m[0].length + SVG_HEAD);
  if (/;base64/i.test(m[1])) {
    try {
      return svgAspect(atob(body.slice(0, body.length - (body.length % 4))));
    } catch {
      return undefined;
    }
  }
  return svgAspect(body.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => {
    const code = parseInt(hex, 16);
    return code < 0x80 ? String.fromCharCode(code) : '?';
  }));
}

/**
 * Renders a picture fitted into the icon box with a white mat, keeping its aspect ratio.
 *
 * The `<img>` loads lazily, so until it has loaded (possibly not until scrolled into view)
 * `fallback` is shown while the frame stays laid out but transparent; if loading fails, only
 * `fallback` is rendered. The aspect ratio comes from the data: URL's SVG source when
 * readable, else from the image's natural size, else 1. The load result is stored together
 * with its `src`, so a changed image never reuses a stale ratio. The longer side fills the box
 * minus a ~6% margin, and the mat width scales with `size`.
 *
 * @param {Object} props - Component props.
 * @param {string} props.src - Image URL.
 * @param {number} props.size - Rendered width and height of the box in px.
 * @param {ReactNode} props.fallback - Icon shown while loading and on error.
 * @returns {JSX.Element} The thumbnail box, or the fallback after a load error.
 *
 * @example
 * <Thumbnail src="/projects/cover.png" size={64} fallback={<DocumentIcon size={64} name="cover.png" />} />
 */
function Thumbnail({ src, size, fallback }: { src: string; size: number; fallback: ReactNode }) {
  const [loaded, setLoaded] = useState<{ src: string; ratio: number } | { src: string; failed: true } | null>(null);
  const hint = useMemo(() => dataUrlSvgAspect(src), [src]);
  const current = loaded?.src === src ? loaded : null;
  if (current && 'failed' in current) return <>{fallback}</>;

  const mat = Math.max(1, Math.round(size / 28));
  const avail = size - 2 * Math.max(1, Math.round(size * 0.06));
  const ratio = current?.ratio ?? 1;
  const width = ratio >= 1 ? avail : Math.max(mat * 2 + 2, avail * ratio);
  const height = ratio >= 1 ? Math.max(mat * 2 + 2, avail / ratio) : avail;

  return (
    <span className={styles.box} style={{ width: size, height: size }} aria-hidden="true">
      {!current && <span className={styles.placeholder}>{fallback}</span>}
      <span className={`${styles.frame} ${current ? '' : styles.pending}`} style={{ width, height, borderWidth: mat }}>
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            setLoaded({ src, ratio: hint ?? (w > 0 && h > 0 ? w / h : 1) });
          }}
          onError={() => setLoaded({ src, failed: true })}
        />
      </span>
    </span>
  );
}

/**
 * Renders a thumbnail for an SVG file stored as text (no `src`).
 *
 * Turns the source into a percent-encoded `data:image/svg+xml` URL (memoized per content) and
 * shows it through {@link Thumbnail}, with the generic document page as fallback.
 *
 * @param {Object} props - Component props.
 * @param {string} props.content - SVG markup.
 * @param {number} props.size - Rendered width and height in px.
 * @param {string} props.name - File name, used for the fallback icon.
 * @returns {JSX.Element} The thumbnail.
 *
 * @example
 * <SvgSourceThumbnail content={node.content} size={64} name="logo.svg" />
 */
function SvgSourceThumbnail({ content, size, name }: { content: string; size: number; name: string }) {
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`, [content]);
  return <Thumbnail src={src} size={size} fallback={<DocumentIcon size={size} name={name} />} />;
}

/* ───────────────────────── .app bundles & Trash ───────────────────────── */

/**
 * Resolves the registered app an .app bundle file stands for.
 *
 * Uses the file's trimmed content as an app id first; failing that, matches the file name
 * without its extension against every registered app's name (including hidden apps), in
 * either language when the name is localized.
 *
 * @param {FileIconNode} node - The .app file.
 * @returns {AppManifest | undefined} The app, or undefined when none matches.
 *
 * @example
 * appForBundle({ type: 'file', name: 'Notes.app', path: '/Applications/Notes.app' })?.icon;
 */
function appForBundle(node: FileIconNode) {
  const byId = node.content ? getApp(node.content.trim()) : undefined;
  if (byId) return byId;
  const name = stem(node.name);
  return listApps({ includeHidden: true }).find((a) =>
    typeof a.name === 'string' ? a.name === name : a.name.en === name || a.name.ko === name,
  );
}

/**
 * Renders the Trash folder's icon.
 *
 * Subscribes to the number of items in the Trash and shows the full bin while it has any,
 * like the Dock's Trash, re-rendering when items are trashed or emptied.
 *
 * @param {Object} props - Component props.
 * @param {number} props.size - Rendered width and height in px.
 * @returns {JSX.Element} The empty or full Trash icon.
 *
 * @example
 * <TrashFolderIcon size={64} />
 */
function TrashFolderIcon({ size }: { size: number }) {
  const full = useTrashCount() > 0;
  return full ? <TrashFullIcon size={size} /> : <TrashIcon size={size} />;
}

/* ───────────────────────── FileIcon ───────────────────────── */

/**
 * Renders the Finder icon for any file-system node.
 *
 * Directories: "/" shows the startup disk, the Trash shows an empty or full bin, and other
 * folders the blue folder with their special-folder glyph, if any. .app bundles show the
 * registered app's icon (or the generic app icon). Images show a live thumbnail from `src`, or
 * from the source of a text SVG file, falling back to a document page when neither exists.
 * Everything else is a document page decorated for its kind. Always `size`×`size` px.
 *
 * @param {Object} props - Component props.
 * @param {FileIconNode} props.node - The node to draw.
 * @param {number} props.size - Rendered width and height in px.
 * @returns {JSX.Element} The icon element.
 *
 * @example
 * <FileIcon node={node} size={64} />
 */
export function FileIcon({ node, size }: { node: FileIconNode; size: number }) {
  if (node.type === 'dir') {
    if (node.path === '/') return <HardDriveIcon size={size} />;
    if (node.path === PATHS.trash) return <TrashFolderIcon size={size} />;
    return <FolderIcon size={size} glyph={folderGlyphFor(node.path)} />;
  }

  const kind = kindOf(node);
  if (kind === 'app') {
    const app = appForBundle(node);
    return createElement(app?.icon ?? GenericAppIcon, { size });
  }
  if (kind === 'image') {
    const fallback = <DocumentIcon size={size} name={node.name} />;
    if (node.src) return <Thumbnail src={node.src} size={size} fallback={fallback} />;
    if (extname(node.name) === 'svg' && node.content?.trim().length) return <SvgSourceThumbnail content={node.content} size={size} name={node.name} />;
    return fallback;
  }
  return <DocumentIcon size={size} name={node.name} />;
}

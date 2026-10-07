/**
 * Spotlight (⌘K / Ctrl+Space): a Tahoe-style floating Liquid Glass search capsule. Searches
 * applications, the whole virtual file system, portfolio projects & skills and System Settings
 * panes, evaluates math and unit conversions, and falls back to a web search. Results are grouped,
 * keyboard-navigable and previewed in a side pane, in a separate thick-glass panel under the bar.
 */
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import {
  fmt,
  formatBytes,
  formatDate,
  fs,
  getApp,
  isMacHost,
  isTextFile,
  join,
  kindOf,
  revealInFinder,
  tildify,
  useFS,
  useLocale,
  useT,
  useUI,
  useWM,
  wm,
  PATHS,
  type FileKind,
  type LString,
} from '@/kernel';
import { AboutMeIcon, CalculatorIcon, FileIcon, SafariIcon, SettingsIcon } from '@/icons';
import { useRefraction } from '@/components/Glass';
import { projects } from '@/data/portfolio';
import { Z } from '../layers';
import { usePresence } from './usePresence';
import { appBundlePath } from './dockMenus';
import { handBackFocus } from './focus';
import { buildResults, CATEGORY_LABELS, GROUP_LABELS, webSearchURL, type GroupId, type SpotlightResult } from './spotlightSearch';
import s from './Spotlight.module.css';

const S = {
  spotlight: { en: 'Spotlight', ko: 'Spotlight' },
  placeholder: { en: 'Spotlight Search', ko: 'Spotlight 검색' },
  results: { en: 'Search results', ko: '검색 결과' },
  copied: { en: 'Copied to Clipboard', ko: '클립보드에 복사됨' },
  enterToCopy: { en: 'Press Return to copy the result', ko: 'Return 키를 눌러 결과 복사' },
  running: { en: 'Running', ko: '실행 중' },
  version: { en: 'Version', ko: '버전' },
  category: { en: 'Category', ko: '카테고리' },
  kind: { en: 'Kind', ko: '종류' },
  size: { en: 'Size', ko: '크기' },
  contents: { en: 'Contents', ko: '내용' },
  items: { en: '{n} items', ko: '{n}개 항목' },
  modified: { en: 'Modified', ko: '수정일' },
  where: { en: 'Where', ko: '위치' },
  application: { en: 'Application', ko: '응용 프로그램' },
  project: { en: 'Project', ko: '프로젝트' },
  skill: { en: 'Skill', ko: '기술' },
  role: { en: 'Role', ko: '역할' },
  year: { en: 'Year', ko: '연도' },
  settingsHint: { en: 'Opens this pane in System Settings', ko: '시스템 설정에서 이 패널 열기' },
  webTitle: { en: 'Search the Web', ko: '웹 검색' },
  webHint: { en: 'Opens Google in Safari', ko: 'Safari에서 Google 검색 열기' },
} satisfies Record<string, LString>; /** Localized strings used by the Spotlight panel and its preview pane. */

const KIND_LABELS: Record<FileKind, LString> = {
  folder: { en: 'Folder', ko: '폴더' },
  app: { en: 'Application', ko: '응용 프로그램' },
  text: { en: 'Plain Text Document', ko: '일반 텍스트 문서' },
  markdown: { en: 'Markdown Document', ko: 'Markdown 문서' },
  image: { en: 'Image', ko: '이미지' },
  pdf: { en: 'PDF Document', ko: 'PDF 문서' },
  audio: { en: 'Audio', ko: '오디오' },
  video: { en: 'Movie', ko: '동영상' },
  link: { en: 'Web Location', ko: '웹 위치' },
  code: { en: 'Source Code', ko: '소스 코드' },
  archive: { en: 'ZIP Archive', ko: 'ZIP 아카이브' },
  unknown: { en: 'Document', ko: '문서' },
}; /** Finder-style kind names for each file kind, shown in the inline hint and the preview metadata. */

const BAR_REFRACTION = { bezel: 14, scale: 26 }; /** Edge lensing of the search capsule (applied in Chromium only; see components/Glass.tsx). */

let lastQuery = ''; /** Last typed query; it survives closing and reopening Spotlight for the rest of the session. */

/**
 * Renders the Spotlight overlay while it is open or playing its exit animation.
 *
 * Reads the `spotlight` flag from the UI store and uses `usePresence` to keep the panel mounted
 * for 140ms after the flag turns off, so the closing animation can finish before unmount.
 *
 * @returns {JSX.Element | null} The Spotlight panel, or null when it is fully closed.
 *
 * @example
 * <Spotlight />
 */
export function Spotlight() {
  const open = useUI((st) => st.spotlight);
  const { mounted, closing } = usePresence(open, 140);
  if (!mounted) return null;
  return <SpotlightPanel closing={closing} />;
}

/**
 * Closes Spotlight.
 *
 * Clears the `spotlight` flag in the UI store; `Spotlight` then plays the exit animation and
 * unmounts the panel.
 *
 * @returns {void}
 *
 * @example
 * close();
 */
function close() {
  useUI.getState().set({ spotlight: false });
}

/**
 * Copies text to the host clipboard.
 *
 * Uses the async Clipboard API when available (failures are ignored). Otherwise it selects the
 * text in an off-screen read-only textarea, runs `document.execCommand('copy')`, removes the
 * textarea and restores focus to the previously active element.
 *
 * @param {string} text - The text to copy.
 * @returns {void}
 *
 * @example
 * copyText('42');
 */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {}
  ta.remove();
  active?.focus({ preventScroll: true });
}

/**
 * Returns a label describing what kind of thing a result is.
 *
 * Used for the inline completion hint ("Safari — Application"). Apps, projects, skills and
 * settings panes get a fixed label; files are labelled by their Finder kind (looked up in the
 * file system, null if the file does not exist); web, calculation and conversion results have
 * no label.
 *
 * @param {SpotlightResult} r - The search result.
 * @returns {LString | null} The localizable kind label, or null when there is none.
 *
 * @example
 * const k = kindLabel(selected);
 * console.log(k && t(k)); // "Application"
 */
function kindLabel(r: SpotlightResult): LString | null {
  switch (r.kind) {
    case 'app':
      return S.application;
    case 'file': {
      const n = fs.stat(r.path);
      return n ? KIND_LABELS[kindOf(n)] : null;
    }
    case 'project':
      return S.project;
    case 'skill':
      return S.skill;
    case 'setting':
      return GROUP_LABELS.settings;
    default:
      return null;
  }
}

/**
 * The Spotlight search panel: a glass search capsule with grouped results and a preview pane.
 *
 * Results are built from a deferred copy of the query so typing stays responsive, and are
 * rebuilt when the file system changes. The selection resets to the top hit whenever the
 * deferred query changes and is clamped to the result count. The input acts as a combobox:
 * ↑/↓ move the selection, Tab/⇧Tab jump between result groups, Return opens the selected
 * result (with ⌘ on Mac or Ctrl elsewhere it reveals it in Finder instead) and Escape clears
 * the query, then closes. A ghost overlay behind the input shows an inline completion after
 * the typed text ("saf|ari — Application") or the calculation result ("2+2 = 4"); it is
 * skipped for queries longer than 40 characters (the field scrolls and the overlay would
 * drift), while the results still belong to an older query, and after a copy. On open (also
 * when reopened during the exit animation) the remembered query is focused and selected so
 * typing replaces it; on close, keyboard focus is handed back as soon as the exit animation
 * starts. Clicking the backdrop closes Spotlight.
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.closing - Whether the exit animation is playing; keyboard focus is then handed back.
 * @returns {JSX.Element} The Spotlight overlay with its backdrop, search bar and results.
 *
 * @example
 * <SpotlightPanel closing={false} />
 */
function SpotlightPanel({ closing }: { closing: boolean }) {
  const t = useT();
  const locale = useLocale();
  const uid = useId();
  const [query, setQueryState] = useState(lastQuery);
  const deferred = useDeferredValue(query);
  const nodes = useFS((st) => st.nodes);
  // `nodes` is a dependency so results refresh when files change while Spotlight is open.
  const results = useMemo(() => buildResults(deferred, locale), [deferred, locale, nodes]);

  const [sel, setSel] = useState(0);
  const [selFor, setSelFor] = useState(deferred);
  if (selFor !== deferred) {
    setSelFor(deferred);
    setSel(0);
  }
  const index = Math.min(sel, Math.max(0, results.length - 1));
  const selected = results[index] as SpotlightResult | undefined;

  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prevFocus] = useState(() => (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null));
  const barRef = useRefraction<HTMLDivElement>(BAR_REFRACTION);

  /**
   * Updates the query.
   *
   * Also remembers it in `lastQuery` for the next time Spotlight opens, clears the "Copied to
   * Clipboard" state and cancels the pending close scheduled after a copy.
   *
   * @param {string} v - The new query text.
   * @returns {void}
   *
   * @example
   * setQuery('');
   */
  const setQuery = (v: string) => {
    lastQuery = v;
    setQueryState(v);
    setCopied(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (closing) {
      handBackFocus(prevFocus, rootRef.current);
      return;
    }
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [closing, prevFocus]);

  // Keeps the selected row visible by scrolling only the list (scrollIntoView could also scroll
  // ancestors). The list is the rows' offsetParent, so offsetTop is in scrolled-content
  // coordinates; selecting the first row of a group also reveals the group's header.
  useEffect(() => {
    const list = listRef.current;
    const row = rowRefs.current.get(index);
    if (!list || !row) return;
    const prev = row.previousElementSibling as HTMLElement | null;
    const top = prev && prev.getAttribute('role') !== 'option' ? prev.offsetTop : row.offsetTop;
    const bottom = row.offsetTop + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 4);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 6;
  }, [index, results]);

  const groups = useMemo(() => {
    const out: { id: GroupId; items: { r: SpotlightResult; i: number }[] }[] = [];
    results.forEach((r, i) => {
      let g = out[out.length - 1];
      if (!g || g.id !== r.group) out.push((g = { id: r.group, items: [] }));
      g.items.push({ r, i });
    });
    return out;
  }, [results]);

  /**
   * Closes Spotlight (and Launchpad, if open) and then runs an action.
   *
   * The overlays are closed first so the window opened by `fn` can take keyboard focus.
   *
   * @param {() => void} fn - The action to run, such as launching an app or opening a file.
   * @returns {void}
   *
   * @example
   * launchAndClose(() => wm.launch('safari'));
   */
  const launchAndClose = (fn: () => void) => {
    useUI.getState().set({ spotlight: false, launchpad: false });
    fn();
  };

  /**
   * Opens a result, or reveals it in Finder.
   *
   * Apps are launched, files opened with their default app, projects opened in the Projects app,
   * skills in About Me's Skills tab, settings panes in System Settings and web results as a
   * Google search in Safari. With `reveal`, apps, files and projects are shown in Finder instead
   * (an app's bundle in /Applications, a project's folder in ~/Documents/Projects, seeded from
   * the portfolio data) when that item exists. Calculation and conversion results copy their
   * plain value to the clipboard, show "Copied to Clipboard" and close Spotlight after 650ms.
   *
   * @param {SpotlightResult} r - The result to activate.
   * @param {boolean} [reveal=false] - Reveal the item in Finder instead of opening it.
   * @returns {void}
   *
   * @example
   * activate(selected, e.metaKey);
   */
  const activate = (r: SpotlightResult, reveal = false) => {
    switch (r.kind) {
      case 'app': {
        const bundle = appBundlePath(r.appId);
        return launchAndClose(() => (reveal && bundle && fs.exists(bundle) ? revealInFinder(bundle) : wm.launch(r.appId)));
      }
      case 'file':
        return launchAndClose(() => (reveal ? revealInFinder(r.path) : wm.openPath(r.path)));
      case 'project': {
        const name = projects.find((p) => p.id === r.projectId)?.name;
        const folder = name ? join(PATHS.projects, name) : null;
        return launchAndClose(() => (reveal && folder && fs.exists(folder) ? revealInFinder(folder) : wm.launch('projects', { project: r.projectId })));
      }
      case 'skill':
        return launchAndClose(() => wm.launch('about-me', { tab: 'skills' }));
      case 'setting':
        return launchAndClose(() => wm.launch('settings', { pane: r.pane }));
      case 'web':
        return launchAndClose(() => wm.launch('safari', { url: webSearchURL(r.query) }));
      case 'calc':
      case 'convert':
        copyText(r.plain);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(close, 650);
        return;
    }
  };

  /**
   * Handles keyboard navigation in the search field.
   *
   * ↑/↓ move the selection; Tab and ⇧Tab jump to the first result of the next or previous group
   * (wrapping) while focus stays in the field; Return activates the selection, revealing it in
   * Finder when ⌘ (Mac) or Ctrl (elsewhere) is held; Escape clears the query or, when it is
   * already empty, closes Spotlight. If the deferred results still belong to an older query
   * (fast typing), Return acts on the top hit for the current query instead. These keys never
   * reach the global shortcut dispatcher, and events fired during IME composition are ignored.
   *
   * @param {ReactKeyboardEvent<HTMLInputElement>} e - The keydown event from the search input.
   * @returns {void}
   *
   * @example
   * <input onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const n = results.length;
    if (['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].includes(e.key)) e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n) setSel(Math.min(n - 1, index + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (n) setSel(Math.max(0, index - 1));
        return;
      case 'Tab': {
        e.preventDefault();
        if (!n) return;
        const gi = groups.findIndex((g) => g.items.some((x) => x.i === index));
        const next = groups[(gi + (e.shiftKey ? -1 : 1) + groups.length) % groups.length];
        setSel(next.items[0].i);
        return;
      }
      case 'Enter': {
        e.preventDefault();
        const target = deferred === query ? selected : buildResults(query, locale)[0];
        if (target) activate(target, isMacHost ? e.metaKey : e.ctrlKey);
        return;
      }
      case 'Escape':
        e.preventDefault();
        if (query) setQuery('');
        else close();
        return;
    }
  };

  let ghostRest = '';
  let ghostHint = '';
  if (selected && query && deferred === query && query.length <= 40 && !copied) {
    if (selected.kind === 'calc') ghostHint = ` = ${selected.title}`;
    else if (selected.kind === 'convert') ghostHint = ` = ${selected.title}`;
    else if (selected.kind !== 'web') {
      const k = kindLabel(selected);
      if (selected.title.toLowerCase().startsWith(query.toLowerCase())) {
        ghostRest = selected.title.slice(query.length);
        ghostHint = k ? ` — ${t(k)}` : '';
      } else ghostHint = ` — ${selected.title}`;
    }
  }

  const listId = `${uid}-list`;
  /**
   * Builds the DOM id of a result option.
   *
   * Ids are prefixed with this panel's `useId` value so they are unique on the page; the input's
   * `aria-activedescendant` points at the selected option through this id.
   *
   * @param {number} i - Index of the result in the flat result list.
   * @returns {string} The option element id.
   *
   * @example
   * <div id={optId(3)} role="option" />
   */
  const optId = (i: number) => `${uid}-opt-${i}`;
  const hasResults = results.length > 0;

  return (
    <div ref={rootRef} className={`${s.root} ${closing ? s.rootClosing : ''}`} style={{ zIndex: Z.SPOTLIGHT }}>
      {/* preventDefault on mousedown: the dismissing click must not blur the focus being handed back. */}
      <div className={s.backdrop} onPointerDown={close} onMouseDown={(e) => e.preventDefault()} aria-hidden />
      <div className={`${s.panel} ${closing ? s.closing : ''}`} role="dialog" aria-modal="true" aria-label={t(S.spotlight)}>
        <div ref={barRef} className={`lg lg-float lg-capsule ${s.bar}`}>
          <Search className={s.magnifier} size={20} strokeWidth={1.9} aria-hidden />
          <div className={s.field}>
            {(ghostRest || ghostHint) && (
              <div className={s.ghost} aria-hidden>
                <span className={s.ghostTyped}>{query}</span>
                <span className={s.ghostRest}>{ghostRest}</span>
                <span className={s.ghostHint}>{ghostHint}</span>
              </div>
            )}
            <input
              ref={inputRef}
              className={s.input}
              value={query}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              placeholder={t(S.placeholder)}
              aria-label={t(S.placeholder)}
              role="combobox"
              aria-expanded={hasResults}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={selected ? optId(index) : undefined}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          {selected && (
            <span className={s.barIcon} aria-hidden>
              <ResultIcon r={selected} size={24} />
            </span>
          )}
        </div>

        {hasResults && (
          <div className={`lg lg-thick lg-float ${s.body}`}>
            <div ref={listRef} className={s.list} id={listId} role="listbox" aria-label={t(S.results)}>
              {groups.map((g) => (
                <div key={g.id} role="group" aria-labelledby={`${uid}-g-${g.id}`}>
                  <div className={s.groupHeader} id={`${uid}-g-${g.id}`}>
                    {t(GROUP_LABELS[g.id])}
                  </div>
                  {g.items.map(({ r, i }) => (
                    <div
                      key={r.id}
                      id={optId(i)}
                      ref={(el) => {
                        if (el) rowRefs.current.set(i, el);
                        else rowRefs.current.delete(i);
                      }}
                      role="option"
                      aria-selected={i === index}
                      className={`${s.row} ${g.id === 'top' ? s.topRow : ''} ${i === index ? s.selected : ''}`}
                      onMouseMove={() => i !== index && setSel(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => activate(r, isMacHost ? e.metaKey : e.ctrlKey)}
                    >
                      <span className={s.rowIcon}>
                        <ResultIcon r={r} size={g.id === 'top' ? 28 : 18} />
                      </span>
                      <span className={s.rowTitle}>{r.kind === 'calc' || r.kind === 'convert' ? `= ${r.title}` : r.title}</span>
                      {r.subtitle && <span className={s.rowSub}>{r.kind === 'file' ? tildify(r.subtitle) : r.subtitle}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className={s.preview}>{selected && <Preview key={selected.id} r={selected} copied={copied} />}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Icons ───────────────────────── */

/**
 * Draws the icon for a search result.
 *
 * Apps use their app icon, files their file-type icon (nothing if the file does not exist),
 * projects a cover thumbnail, skills the About Me icon, settings the System Settings icon,
 * calculations and conversions the Calculator icon and web searches the Safari icon.
 *
 * @param {Object} props - Component props.
 * @param {SpotlightResult} props.r - The search result.
 * @param {number} props.size - Icon size in pixels.
 * @returns {JSX.Element | null} The icon, or null when the app or file cannot be found.
 *
 * @example
 * <ResultIcon r={selected} size={24} />
 */
function ResultIcon({ r, size }: { r: SpotlightResult; size: number }) {
  switch (r.kind) {
    case 'app': {
      const Icon = getApp(r.appId)?.icon;
      return Icon ? <Icon size={size} /> : null;
    }
    case 'file': {
      const node = fs.stat(r.path);
      return node ? <FileIcon node={node} size={size} /> : null;
    }
    case 'project': {
      const p = projects.find((x) => x.id === r.projectId);
      return <ProjectThumb cover={p?.cover} color={p?.color} size={size} />;
    }
    case 'skill':
      return <AboutMeIcon size={size} />;
    case 'setting':
      return <SettingsIcon size={size} />;
    case 'calc':
    case 'convert':
      return <CalculatorIcon size={size} />;
    case 'web':
      return <SafariIcon size={size} />;
  }
}

/**
 * Draws a project's cover thumbnail.
 *
 * A rounded tile filled with the project color, with the cover image on top. If the image fails
 * to load it is dropped and only the color tile remains. `wide` makes the tile 1.6 times wider
 * than it is tall.
 *
 * @param {Object} props - Component props.
 * @param {string} [props.cover] - URL of the cover image.
 * @param {string} [props.color] - CSS background color behind the cover.
 * @param {number} props.size - Tile height in pixels (and width unless `wide`).
 * @param {boolean} [props.wide] - Use a 1.6:1 landscape tile instead of a square one.
 * @returns {JSX.Element} The thumbnail element.
 *
 * @example
 * <ProjectThumb cover={p.cover} color={p.color} size={96} wide />
 */
function ProjectThumb({ cover, color, size, wide }: { cover?: string; color?: string; size: number; wide?: boolean }) {
  const [broken, setBroken] = useState(false);
  const w = wide ? Math.round(size * 1.6) : size;
  return (
    <span className={s.thumb} style={{ width: w, height: size, background: color, borderRadius: Math.max(4, size * 0.18) }}>
      {cover && !broken && <img src={cover} alt="" draggable={false} onError={() => setBroken(true)} />}
    </span>
  );
}

/* ───────────────────────── Preview pane ───────────────────────── */

/**
 * Renders a label/value metadata list for the preview pane.
 *
 * Each row becomes a `<dt>`/`<dd>` pair in a two-column grid with right-aligned labels; values
 * are truncated with an ellipsis. Labels are used as React keys, so they must be unique.
 *
 * @param {Object} props - Component props.
 * @param {[string, string][]} props.rows - Pairs of already-localized label and value.
 * @returns {JSX.Element} The description list.
 *
 * @example
 * <Meta rows={[['Kind', 'Folder'], ['Where', '~/Documents']]} />
 */
function Meta({ rows }: { rows: [string, string][] }) {
  return (
    <dl className={s.meta}>
      {rows.map(([k, v]) => (
        <div key={k} className={s.metaRow}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Renders the preview pane for the selected result.
 *
 * Apps show their icon, description, a "Running" badge while the app has a process, and
 * kind/category/version metadata; files delegate to `FilePreview`; projects show the cover,
 * tagline, tags, role and year; skills show their category; settings panes and web
 * searches show what activating them will do; calculations and conversions show the
 * expression, the result and a copy hint that turns into "Copied to Clipboard" after copying.
 *
 * @param {Object} props - Component props.
 * @param {SpotlightResult} props.r - The selected result.
 * @param {boolean} props.copied - Whether the calculation result has just been copied.
 * @returns {JSX.Element | null} The preview content, or null when the app or project is unknown.
 *
 * @example
 * <Preview key={selected.id} r={selected} copied={copied} />
 */
function Preview({ r, copied }: { r: SpotlightResult; copied: boolean }) {
  const t = useT();
  const running = useWM((st) => r.kind === 'app' && st.processes.some((p) => p.appId === r.appId));

  switch (r.kind) {
    case 'app': {
      const app = getApp(r.appId);
      if (!app) return null;
      const Icon = app.icon;
      const rows: [string, string][] = [[t(S.kind), t(S.application)]];
      if (app.category) rows.push([t(S.category), t(CATEGORY_LABELS[app.category])]);
      if (app.version) rows.push([t(S.version), app.version]);
      return (
        <div className={s.pv}>
          <Icon size={88} />
          <div className={s.pvTitle}>{t(app.name)}</div>
          {app.description && <div className={s.pvSub}>{t(app.description)}</div>}
          {running && <div className={s.pvBadge}>{t(S.running)}</div>}
          <Meta rows={rows} />
        </div>
      );
    }
    case 'file':
      return <FilePreview path={r.path} />;
    case 'project': {
      const p = projects.find((x) => x.id === r.projectId);
      if (!p) return null;
      return (
        <div className={s.pv}>
          <ProjectThumb cover={p.cover} color={p.color} size={96} wide />
          <div className={s.pvTitle}>{p.name}</div>
          <div className={s.pvSub}>{t(p.tagline)}</div>
          <div className={s.tags}>
            {p.tags.map((tag) => (
              <span key={tag} className="ui-badge">
                {tag}
              </span>
            ))}
          </div>
          <Meta
            rows={[
              [t(S.role), t(p.role)],
              [t(S.year), String(p.year)],
            ]}
          />
        </div>
      );
    }
    case 'skill':
      return (
        <div className={s.pv}>
          <AboutMeIcon size={72} />
          <div className={s.pvTitle}>{r.skill}</div>
          <div className={s.pvSub}>{t(r.category)}</div>
        </div>
      );
    case 'setting':
      return (
        <div className={s.pv}>
          <SettingsIcon size={72} />
          <div className={s.pvTitle}>{r.title}</div>
          <div className={s.pvSub}>{t(S.settingsHint)}</div>
        </div>
      );
    case 'calc':
    case 'convert':
      return (
        <div className={`${s.pv} ${s.pvCalc}`}>
          <div className={s.calcExpr}>{r.kind === 'calc' ? r.subtitle : r.from}</div>
          <div className={s.calcValue}>= {r.title}</div>
          <div className={`${s.pvSub} ${copied ? s.copied : ''}`}>{t(copied ? S.copied : S.enterToCopy)}</div>
        </div>
      );
    case 'web':
      return (
        <div className={s.pv}>
          <SafariIcon size={72} />
          <div className={s.pvTitle}>{t(S.webTitle)}</div>
          <div className={s.pvSub}>“{r.query}”</div>
          <div className={s.pvHint}>{t(S.webHint)}</div>
        </div>
      );
  }
}

/**
 * Renders the preview of a file or folder.
 *
 * Subscribes to the node so the preview follows file system changes. Images show the picture
 * itself (falling back to the file icon if it cannot be loaded); text files show their first
 * lines (at most 1500 characters and 14 lines, so a large file is never pushed into the DOM).
 * The metadata lists the kind, the item count for folders (hidden items excluded; a folder that
 * cannot be read counts as empty) or the size for files, the modification date and the
 * containing folder.
 *
 * @param {Object} props - Component props.
 * @param {string} props.path - Absolute path of the file or folder.
 * @returns {JSX.Element | null} The preview content, or null when the path does not exist.
 *
 * @example
 * <FilePreview path={r.path} />
 */
function FilePreview({ path }: { path: string }) {
  const t = useT();
  const locale = useLocale();
  const node = useFS((st) => st.nodes[path]);
  const [broken, setBroken] = useState<string | null>(null);
  if (!node) return null;
  const kind = kindOf(node);
  const rows: [string, string][] = [[t(S.kind), t(KIND_LABELS[kind])]];
  if (node.type === 'dir') {
    let count = 0;
    try {
      count = fs.readdir(path).filter((c) => !c.name.startsWith('.')).length;
    } catch {}
    rows.push([t(S.contents), fmt(t(S.items), { n: count })]);
  } else rows.push([t(S.size), formatBytes(fs.size(path), locale)]);
  rows.push([t(S.modified), formatDate(node.modifiedAt, locale)]);
  rows.push([t(S.where), tildify(path.slice(0, path.lastIndexOf('/')) || '/')]);

  let visual = <FileIcon node={node} size={80} />;
  if (kind === 'image' && broken !== path) {
    let url = '';
    try {
      url = fs.getURL(path);
    } catch {}
    if (url) visual = <img className={s.pvImage} src={url} alt="" draggable={false} onError={() => setBroken(path)} />;
  }
  const text = isTextFile(node) ? (node.content ?? '').slice(0, 1500).split('\n').slice(0, 14).join('\n') : '';

  return (
    <div className={s.pv}>
      {visual}
      <div className={s.pvTitle}>{node.name}</div>
      {text.trim() && <pre className={s.pvText}>{text}</pre>}
      <Meta rows={rows} />
    </div>
  );
}

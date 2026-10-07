import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  COMMON,
  HOME,
  PATHS,
  basename,
  dialogs,
  dirname,
  fs,
  getDragPaths,
  hasDragPaths,
  hasHostFiles,
  importHostFiles,
  isMacHost,
  showContextMenu,
  showFSError,
  t as translate,
  useAppMenus,
  useBeforeClose,
  useMenus,
  useT,
  useWM,
  useWindow,
  wm,
  type AppProps,
  type LString,
  type MenuDef,
  type MenuItem,
} from '@/kernel';
import { TerminalSession } from './session';
import { charWidth, parseAnsi, type Segment } from './shell/ansi';
import { escapeWord } from './shell/completion';
import s from './Terminal.module.css';

const S = {
  shell: { en: 'Shell', ko: '셸' },
  exportText: { en: 'Export Text As…', ko: '다른 이름으로 텍스트 내보내기…' },
  clearScrollback: { en: 'Clear Scrollback', ko: '스크롤백 지우기' },
  clearScreen: { en: 'Clear Screen', ko: '화면 지우기' },
  bigger: { en: 'Bigger', ko: '크게' },
  smaller: { en: 'Smaller', ko: '작게' },
  defaultSize: { en: 'Default Font Size', ko: '기본 서체 크기' },
  profiles: { en: 'Profiles', ko: '프로파일' },
  terminate: { en: 'Terminate', ko: '종료' },
  confirmTitle: { en: 'Do you want to terminate running processes in this window?', ko: '이 윈도우에서 실행 중인 프로세스를 종료하겠습니까?' },
  savedOutput: { en: 'Terminal Saved Output.txt', ko: '터미널 저장된 출력.txt' },
  inputLabel: { en: 'Terminal input', ko: '터미널 입력' },
  outputLabel: { en: 'Terminal output', ko: '터미널 출력' },
} satisfies Record<string, LString>; /** Localized strings for the Terminal menus, dialogs and accessibility labels. */

/**
 * Build the close-confirmation message listing the running processes.
 *
 * Shown by the before-close handler when the window still has foreground or background
 * processes.
 *
 * @param {string} name - Comma-separated process names (e.g. "sleep, ping").
 * @returns {LString} The localized message.
 *
 * @example
 * const msg = confirmMessage('sleep, ping');
 * console.log(msg.en); // 'Closing this window will terminate the running processes: sleep, ping.'
 */
const confirmMessage = (name: string): LString => ({
  en: `Closing this window will terminate the running processes: ${name}.`,
  ko: `이 윈도우를 닫으면 실행 중인 프로세스가 종료됩니다: ${name}.`,
});

/** Identifier of a terminal color profile; matches the `data-profile` attribute styled in the CSS module. */
type ProfileId = 'basic' | 'pro' | 'homebrew';

const PROFILES: { id: ProfileId; name: LString }[] = [
  { id: 'basic', name: { en: 'Basic', ko: '기본' } },
  { id: 'pro', name: 'Pro' },
  { id: 'homebrew', name: 'Homebrew' },
]; /** Profiles listed in View ▸ Profiles, in menu order. */

const PROFILE_KEY = 'webos.terminal.profile'; /** localStorage key that remembers the chosen profile across windows and reloads. */
const DEFAULT_FONT_SIZE = 12; /** Font size in px for new windows and View ▸ Default Font Size. */
const MIN_FONT_SIZE = 9; /** Smallest font size in px reachable with View ▸ Smaller. */
const MAX_FONT_SIZE = 28; /** Largest font size in px reachable with View ▸ Bigger. */
const LINE_HEIGHT = 1.25; /** Line height as a multiple of the font size; also the fallback for the measured cell height. */

/**
 * Read the saved terminal profile.
 *
 * Returns the value stored under PROFILE_KEY when it names a known profile, and falls back to
 * "pro" when nothing valid is stored or localStorage is unavailable.
 *
 * @returns {ProfileId} The profile to use for a new window.
 *
 * @example
 * const [profile, setProfile] = useState<ProfileId>(loadProfile);
 */
function loadProfile(): ProfileId {
  try {
    const v = localStorage.getItem(PROFILE_KEY);
    if (v === 'basic' || v === 'pro' || v === 'homebrew') return v;
  } catch {
    /* storage unavailable */
  }
  return 'pro';
}

/**
 * Persist the chosen terminal profile.
 *
 * Writes the id under PROFILE_KEY so new windows open with it; storage errors (private mode,
 * quota, disabled storage) are ignored.
 *
 * @param {ProfileId} p - Profile to remember.
 * @returns {void}
 *
 * @example
 * saveProfile('homebrew');
 */
function saveProfile(p: ProfileId): void {
  try {
    localStorage.setItem(PROFILE_KEY, p);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Menus shown while Terminal is the active app but has no window.
 *
 * Mirrors the Shell and View menus of a terminal window with every window-specific item
 * disabled, so Shell ▸ New Window (⌥N) keeps working after the last window is closed, as in
 * Terminal.app.
 *
 * @returns {MenuDef[]} The Shell and View menu definitions.
 *
 * @example
 * useMenus.setState((st) => ({ byApp: { ...st.byApp, terminal: windowlessMenus() } }));
 */
function windowlessMenus(): MenuDef[] {
  return [
    {
      label: S.shell,
      role: 'file',
      items: [
        { label: COMMON.newWindow, shortcut: 'alt+n', action: () => wm.openWindow('terminal') },
        { separator: true },
        { label: S.exportText, shortcut: 'mod+s', disabled: true },
        { separator: true },
        { label: S.clearScrollback, shortcut: 'alt+mod+k', disabled: true },
        { separator: true },
        { label: COMMON.closeWindow, shortcut: 'alt+w', disabled: true },
      ],
    },
    {
      label: COMMON.view,
      items: [
        { label: S.bigger, shortcut: 'mod+=', disabled: true },
        { label: S.smaller, shortcut: 'mod+-', disabled: true },
        { label: S.defaultSize, shortcut: 'mod+0', disabled: true },
      ],
    },
  ];
}

/**
 * Register the windowless Terminal menus in the menu store.
 *
 * The menus go into the store's per-app slot (`byApp`), which the menu bar uses only while
 * Terminal is active without a focused window of its own; window menus live in `byWindow`.
 * Does nothing when the slot is already filled, so the store is written once, by the first
 * window that mounts.
 *
 * @returns {void}
 *
 * @example
 * useEffect(registerWindowlessMenus, []);
 */
function registerWindowlessMenus(): void {
  if (useMenus.getState().byApp.terminal) return;
  useMenus.setState((st) => ({ byApp: { ...st.byApp, terminal: windowlessMenus() } }));
}

/**
 * Resolve an ANSI color value to a CSS color.
 *
 * Palette indexes (0–15) map to the profile's `--ansi-N` custom properties so they follow the
 * active profile; string values are already CSS colors (256-color and truecolor output) and are
 * returned unchanged.
 *
 * @param {number | string | undefined} c - Palette index, CSS color, or undefined for the default.
 * @returns {string | undefined} A CSS color, or undefined when no color is set.
 *
 * @example
 * colorOf(1); // 'var(--ansi-1)'
 * colorOf('#ff8800'); // '#ff8800'
 */
const colorOf = (c: number | string | undefined) => (c === undefined ? undefined : typeof c === 'number' ? `var(--ansi-${c})` : c);

/**
 * Inline style for one styled text segment.
 *
 * Returns undefined for unstyled segments so plain text renders without a style attribute.
 * Inverse video swaps foreground and background, falling back to the profile's solid
 * background and foreground colors when either is unset. Dim is rendered as reduced opacity,
 * and underline and strike-through are combined into one text-decoration value.
 *
 * @param {Segment} seg - Segment produced by the ANSI parser.
 * @returns {CSSProperties | undefined} The inline style, or undefined when the segment is unstyled.
 *
 * @example
 * segStyle({ text: 'error', fg: 1, bold: true }); // { color: 'var(--ansi-1)', fontWeight: 700 }
 */
function segStyle(seg: Segment): CSSProperties | undefined {
  if (!seg.fg && seg.fg !== 0 && !seg.bg && seg.bg !== 0 && !seg.bold && !seg.dim && !seg.italic && !seg.underline && !seg.inverse && !seg.strike) return undefined;
  const st: CSSProperties = {};
  const fg = colorOf(seg.fg);
  const bg = colorOf(seg.bg);
  if (seg.inverse) {
    st.color = bg ?? 'var(--t-bg-solid)';
    st.background = fg ?? 'var(--t-fg)';
  } else {
    if (fg) st.color = fg;
    if (bg) st.background = bg;
  }
  if (seg.bold) st.fontWeight = 700;
  if (seg.dim) st.opacity = 0.6;
  if (seg.italic) st.fontStyle = 'italic';
  if (seg.underline || seg.strike) st.textDecoration = [seg.underline && 'underline', seg.strike && 'line-through'].filter(Boolean).join(' ');
  return st;
}

const HAS_WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\ud83c-\ud83e][\udc00-\udfff]/; /** Quick pre-check for text that may contain wide (CJK / fullwidth / emoji) characters. */

/**
 * Render text so wide characters occupy exactly two cells.
 *
 * Text without any wide character (checked with HAS_WIDE) is returned as-is. Otherwise each
 * character whose `charWidth` is 2 is wrapped in a fixed 2ch-wide span, and runs of narrow
 * characters between them stay plain strings, so columns line up like on a real tty.
 *
 * @param {string} text - Text to render.
 * @param {string} keyPrefix - Prefix for the React keys of the generated spans, unique within the parent.
 * @returns {ReactNode} The text itself, or an array of strings and wide-character spans.
 *
 * @example
 * <div>{cells('ls 한글.txt', 'b')}</div>
 */
function cells(text: string, keyPrefix: string): ReactNode {
  if (!HAS_WIDE.test(text)) return text;
  const out: ReactNode[] = [];
  let run = '';
  let k = 0;
  for (const ch of text) {
    if (charWidth(ch.codePointAt(0)!) === 2) {
      if (run) out.push(run);
      run = '';
      out.push(
        <span key={`${keyPrefix}w${k++}`} className={s.wide}>
          {ch}
        </span>,
      );
    } else run += ch;
  }
  if (run) out.push(run);
  return out;
}

/**
 * Render a list of styled segments as spans.
 *
 * Each segment becomes a span with its inline style from `segStyle`, and its text goes through
 * `cells` so wide characters keep the cell grid.
 *
 * @param {Object} props - Component props.
 * @param {Segment[]} props.segs - Segments to render, in order.
 * @param {string} props.prefix - Key prefix passed to `cells`, keeping keys unique when several lists share a parent.
 * @returns {JSX.Element} A fragment of styled spans.
 *
 * @example
 * <Segments segs={buffer.pendingSegments()} prefix="p" />
 */
function Segments({ segs, prefix }: { segs: Segment[]; prefix: string }) {
  return (
    <>
      {segs.map((seg, i) => (
        <span key={i} style={segStyle(seg)}>
          {cells(seg.text, `${prefix}${i}`)}
        </span>
      ))}
    </>
  );
}

/**
 * One committed scrollback line.
 *
 * Memoised on the segment array, which a committed line never replaces, so appending output
 * only renders the new lines.
 *
 * @param {Object} props - Component props.
 * @param {Segment[]} props.segs - Parsed segments of the line.
 * @returns {JSX.Element} The line element.
 *
 * @example
 * {lines.map((l) => <LineView key={l.id} segs={l.segs} />)}
 */
const LineView = memo(function LineView({ segs }: { segs: Segment[] }) {
  return (
    <div className={s.line}>
      <Segments segs={segs} prefix="" />
    </div>
  );
});

/**
 * One row of the alternate screen used by full-screen programs.
 *
 * Parses the raw row (with escape sequences) on render; memoised on the raw string so only
 * rows that changed are parsed again.
 *
 * @param {Object} props - Component props.
 * @param {string} props.raw - Raw text of the row, including ANSI escapes.
 * @returns {JSX.Element} The row element.
 *
 * @example
 * {session.alt.map((raw, i) => <AltLine key={i} raw={raw} />)}
 */
const AltLine = memo(function AltLine({ raw }: { raw: string }) {
  return (
    <div className={s.line}>
      <Segments segs={parseAnsi(raw).segs} prefix="" />
    </div>
  );
});

/**
 * Subscribe function used before the session exists.
 *
 * Lets `useSyncExternalStore` be called unconditionally; it registers nothing and returns a
 * no-op unsubscribe.
 *
 * @returns {() => void} A no-op unsubscribe function.
 *
 * @example
 * useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getVersion ?? zero);
 */
const noopSubscribe = () => () => {};

/**
 * Snapshot function used before the session exists.
 *
 * Pairs with `noopSubscribe` so `useSyncExternalStore` always receives a stable snapshot getter;
 * the constant value never triggers a re-render.
 *
 * @returns {number} Always 0.
 *
 * @example
 * useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getVersion ?? zero);
 */
const zero = () => 0;

/**
 * Terminal window: one zsh session per window on top of the shared virtual file system.
 *
 * On mount it creates a TerminalSession, starting in the directory from the launch args (a file
 * path starts in its parent folder and is handed to the session). The launch args are read only
 * once, so the window keeps its own working directory afterwards. The session is disposed on
 * unmount, and exiting the shell force-closes the window. The view re-renders whenever the
 * session's version changes (`useSyncExternalStore`).
 *
 * The view renders the ANSI-colored scrollback, the prompt line with a block cursor, and a
 * visually hidden <input> kept at the cursor position so typing, paste, IME composition (and its
 * candidate window) and mobile keyboards all work natively; all terminal logic lives in
 * TerminalSession. The input's position is clamped to the terminal's bounds, so the browser never
 * scrolls the terminal to reveal its caret. The input's value and caret mirror the session's line
 * editor (the caret is not touched mid-composition), and an Enter pressed to commit an IME
 * composition submits the line once the composition ends.
 *
 * Lines from the session's current page sit in a block at least one viewport tall, so `clear`
 * pushes older output up into the scrollback. While a command runs, keys typed ahead are echoed
 * after its output, like a tty; secret input (passwords) is never echoed. When the session shows
 * an alternate screen, its rows replace the scrollback.
 *
 * Side effects:
 * - The character cell is measured with a hidden probe and the session is resized to the
 *   resulting columns × rows whenever the viewport or font size changes.
 * - The window title follows Terminal.app: "<folder> — [command ◂ ]-zsh — cols×rows" (the
 *   home folder shows as the user name), and the window's `path` arg mirrors the working
 *   directory so the title bar shows its proxy icon.
 * - Pro and Homebrew make the window vibrant so the blurred desktop shows through; Basic stays
 *   an opaque document window.
 * - The viewport sticks to the newest output unless the user scrolled up; typing scrolls back
 *   down.
 * - The input is focused when the window becomes key (unless a mouse selection is in progress)
 *   and blurred when another window or the desktop becomes key, so keystrokes never land in a
 *   background terminal.
 * - Closing the window asks for confirmation while processes are still running.
 * - Dropping Finder / Desktop items types their escaped paths, host files are first copied into
 *   ~/Downloads, and dropped text is pasted.
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - Id of the window hosting this terminal.
 * @param {number} props.pid - Pid of the Terminal app process; shell pids are allocated above it.
 * @param {AppArgs} props.args - Launch args; `path` (a folder or file) sets the start directory.
 * @returns {JSX.Element} The terminal view.
 *
 * @example
 * <TerminalApp windowId={windowId} pid={pid} args={{ path: '/Users/aodjo/Documents' }} />
 */
export default function TerminalApp({ windowId, pid, args }: AppProps) {
  const t = useT();
  const win = useWindow();
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [profile, setProfile] = useState<ProfileId>(loadProfile);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const stickToBottom = useRef(true);
  const pointerDown = useRef(false);
  const composing = useRef(false);
  const enterAfterComposition = useRef(false);
  const launchArgs = useRef(args);

  useEffect(() => {
    const target = typeof launchArgs.current.path === 'string' ? fs.stat(launchArgs.current.path) : null;
    const sess = new TerminalSession({
      windowId,
      appPid: pid,
      cwd: target ? (target.type === 'dir' ? target.path : dirname(target.path)) : undefined,
      onExit: () => void wm.close(windowId, { force: true }),
    });
    sessionRef.current = sess;
    setSession(sess);
    void sess.start(target?.type === 'file' ? target.path : undefined);
    return () => {
      sess.dispose();
      if (sessionRef.current === sess) sessionRef.current = null;
    };
  }, [windowId, pid]);

  useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getVersion ?? zero);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const probe = measureRef.current;
    if (!vp || !probe || !session) return;
    /**
     * Measure the character cell and resize the session to fit the viewport.
     *
     * The cell width is the probe's width divided by its 100 characters and the cell height is
     * the probe's height, falling back to font-size estimates when the probe has no layout.
     * `offset*` sizes are used because they ignore CSS transforms (window open / zoom
     * animations). Hidden (display: none) windows report 0×0, so the call is skipped and the
     * last real size is kept. Also records the inner viewport height used as the page's minimum
     * height.
     *
     * @returns {void}
     *
     * @example
     * const ro = new ResizeObserver(measure);
     */
    const measure = () => {
      if (!vp.clientWidth || !vp.clientHeight) return;
      const cellW = probe.offsetWidth / 100 || fontSize * 0.6;
      const cellH = probe.offsetHeight || fontSize * LINE_HEIGHT;
      const cs = getComputedStyle(vp);
      const w = vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = vp.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      session.resize(Math.floor(w / cellW), Math.floor(h / cellH));
      setViewportHeight(Math.max(0, h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [session, fontSize]);

  const running = session?.running ?? null;
  const cols = session?.cols ?? 80;
  const rows = session?.rows ?? 24;
  const cwd = session?.shell.cwd ?? HOME;
  useEffect(() => {
    if (session) wm.setTitle(windowId, `${cwd === '/' ? '/' : basename(cwd)} — ${running ? `${running} ◂ ` : ''}-zsh — ${cols}×${rows}`);
  }, [session, windowId, cwd, running, cols, rows]);

  const translucent = profile !== 'basic';
  useEffect(() => {
    wm.update(windowId, { vibrancy: translucent });
  }, [windowId, translucent]);

  useEffect(() => {
    if (!session || session.mode === 'exited') return;
    const w = useWM.getState().windows.find((x) => x.id === windowId);
    if (w && w.args.path !== cwd) wm.setArgs(windowId, { ...w.args, path: cwd });
  }, [session, windowId, cwd]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (vp && stickToBottom.current) vp.scrollTop = vp.scrollHeight;
  });

  useLayoutEffect(() => {
    const el = inputRef.current;
    const cur = cursorRef.current;
    const root = rootRef.current;
    if (!el || !root || !session) return;
    if (cur) {
      const r = cur.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const x = Math.min(Math.max(0, r.left - rr.left), rr.width - 2);
      const y = Math.min(Math.max(0, r.top - rr.top), rr.height - r.height);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    if (document.activeElement === el && !composing.current && (el.selectionStart !== session.cursor || el.selectionEnd !== session.cursor)) {
      el.setSelectionRange(session.cursor, session.cursor);
    }
  });

  /**
   * Focus the hidden line-editor input.
   *
   * Uses `preventScroll` so focusing never scrolls the viewport or the window contents.
   *
   * @returns {void}
   *
   * @example
   * focusInput();
   */
  const focusInput = () => inputRef.current?.focus({ preventScroll: true });

  useEffect(() => {
    if (win.focused && session && !pointerDown.current) focusInput();
    else if (!win.focused && document.activeElement === inputRef.current) inputRef.current?.blur();
  }, [win.focused, session]);

  useEffect(registerWindowlessMenus, []);

  /**
   * Whether a non-empty text selection exists inside this terminal.
   *
   * Checks the document selection's anchor node against the terminal's root element, so a
   * selection in another window does not count.
   *
   * @returns {boolean} True when text inside this terminal is selected.
   *
   * @example
   * if (!selectionInside()) focusInput();
   */
  const selectionInside = (): boolean => {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed && !!rootRef.current?.contains(sel.anchorNode);
  };

  /**
   * Copy the current text selection to the host clipboard.
   *
   * Does nothing when the selection is empty. Uses the async Clipboard API when it exists and
   * falls back to `document.execCommand('copy')` when it is missing (insecure context) or the
   * write is rejected.
   *
   * @returns {void}
   *
   * @example
   * { label: COMMON.copy, shortcut: 'mod+c', action: copySelection }
   */
  const copySelection = () => {
    const text = window.getSelection()?.toString();
    if (!text) return;
    if (navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => document.execCommand('copy'));
    else document.execCommand('copy');
  };

  /**
   * Paste the host clipboard's text into the session.
   *
   * Reads the clipboard asynchronously, hands the text to the session's paste handling (which
   * runs complete lines and leaves the last partial line in the editor) and refocuses the input.
   * Missing clipboard access or a denied read is silently ignored.
   *
   * @returns {void}
   *
   * @example
   * { label: COMMON.paste, shortcut: 'mod+v', action: pasteClipboard }
   */
  const pasteClipboard = () => {
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        sessionRef.current?.paste(text);
        focusInput();
      })
      .catch(() => {});
  };

  /**
   * Select the whole scrollback, like Terminal.app's ⌘A.
   *
   * Moves focus from the input to the root element (so keystrokes stop editing the line) and
   * selects every child of the viewport.
   *
   * @returns {void}
   *
   * @example
   * { label: COMMON.selectAll, shortcut: 'mod+a', action: selectAll }
   */
  const selectAll = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    rootRef.current?.focus({ preventScroll: true });
    window.getSelection()?.selectAllChildren(vp);
  };

  /**
   * Save the scrollback as a plain-text file (Shell ▸ Export Text As…).
   *
   * Opens a save panel as a sheet on this window, defaulting to "Terminal Saved Output.txt" in
   * ~/Documents, then writes the buffer's plain text there. File-system errors are reported in
   * an alert instead of being thrown; cancelling the panel does nothing.
   *
   * @async
   * @returns {Promise<void>} Resolves once the file is written, the panel is cancelled, or the error is shown.
   *
   * @example
   * { label: S.exportText, shortcut: 'mod+s', action: () => void exportText() }
   */
  const exportText = async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    const path = await dialogs.save({ windowId, title: S.exportText, defaultName: translate(S.savedOutput), defaultDir: PATHS.documents });
    if (!path) return;
    try {
      fs.writeFile(path, sess.buffer.text());
    } catch (e) {
      void showFSError(e, windowId);
    }
  };

  /**
   * Switch this window to a profile and remember it for new windows.
   *
   * Updates the profile state, which restyles this window through its `data-profile` attribute
   * and toggles vibrancy, and stores the id with `saveProfile`. Other open windows keep their
   * current profile.
   *
   * @param {ProfileId} p - Profile to apply.
   * @returns {void}
   *
   * @example
   * chooseProfile('basic');
   */
  const chooseProfile = (p: ProfileId) => {
    setProfile(p);
    saveProfile(p);
  };

  /**
   * Change the font size by a step, or reset it.
   *
   * The new size is clamped to MIN_FONT_SIZE…MAX_FONT_SIZE; a null delta restores
   * DEFAULT_FONT_SIZE. The cell measurement effect then resizes the session to the new grid.
   *
   * @param {number | null} delta - Pixels to add (negative to shrink), or null to reset.
   * @returns {void}
   *
   * @example
   * zoom(1); // View ▸ Bigger
   * zoom(null); // View ▸ Default Font Size
   */
  const zoom = (delta: number | null) => setFontSize((f) => (delta === null ? DEFAULT_FONT_SIZE : Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, f + delta))));

  useAppMenus(
    () => [
      {
        label: S.shell,
        role: 'file',
        items: [
          { label: COMMON.newWindow, shortcut: 'alt+n', action: () => wm.openWindow('terminal') },
          { separator: true },
          { label: S.exportText, shortcut: 'mod+s', action: () => void exportText() },
          { separator: true },
          { label: S.clearScrollback, shortcut: 'alt+mod+k', action: () => sessionRef.current?.clearScrollback() },
          { label: S.clearScreen, shortcut: 'ctrl+l', action: () => sessionRef.current?.clear() },
          { separator: true },
          { label: COMMON.closeWindow, shortcut: 'alt+w', action: () => void wm.close(windowId) },
        ],
      },
      {
        label: COMMON.edit,
        items: [
          { label: COMMON.copy, shortcut: 'mod+c', action: copySelection },
          { label: COMMON.paste, shortcut: 'mod+v', action: pasteClipboard },
          { label: COMMON.selectAll, shortcut: 'mod+a', action: selectAll },
        ],
      },
      {
        label: COMMON.view,
        items: [
          { label: S.bigger, shortcut: 'mod+=', disabled: fontSize >= MAX_FONT_SIZE, action: () => zoom(1) },
          { label: S.smaller, shortcut: 'mod+-', disabled: fontSize <= MIN_FONT_SIZE, action: () => zoom(-1) },
          { label: S.defaultSize, shortcut: 'mod+0', disabled: fontSize === DEFAULT_FONT_SIZE, action: () => zoom(null) },
          { separator: true },
          { label: S.profiles, submenu: PROFILES.map<MenuItem>((p) => ({ label: p.name, checked: p.id === profile, action: () => chooseProfile(p.id) })) },
        ],
      },
    ],
    [profile, fontSize, windowId],
  );

  useBeforeClose(async () => {
    const sess = sessionRef.current;
    const names = sess && sess.mode !== 'exited' ? sess.processNames() : [];
    if (!names.length) return true;
    return dialogs.confirm({ windowId, appId: 'terminal', title: S.confirmTitle, message: confirmMessage([...new Set(names)].join(', ')), okLabel: S.terminate });
  });

  /**
   * Handle a key pressed in the hidden line-editor input.
   *
   * While an IME composition is active the key is left to the IME; an Enter pressed to commit
   * the composition is remembered so the line runs once the composition ends. Keys reported
   * with keyCode 229 are still being processed by the IME and are ignored too, except Enter
   * (Safari reports the committing Enter as 229). Page Up / Page Down scroll the scrollback, ⌘A
   * on a Mac host selects the whole scrollback, and every other key goes to the session; keys
   * the session consumes have their default action and propagation stopped.
   *
   * @param {KeyboardEvent<HTMLInputElement>} e - React keydown event from the input.
   * @returns {void}
   *
   * @example
   * <input onKeyDown={onInputKeyDown} />
   */
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!session) return;
    if (e.nativeEvent.isComposing || composing.current) {
      if (e.key === 'Enter') enterAfterComposition.current = true;
      return;
    }
    if (e.keyCode === 229 && e.key !== 'Enter') return;
    if (scrollKey(e)) return;
    stickToBottom.current = true;
    if (isMacHost && e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectAll();
      return;
    }
    if (session.handleKey(e, { hasSelection: selectionInside() })) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /**
   * Scroll the scrollback for Page Up / Page Down (fn+↑/↓ on a Mac keyboard).
   *
   * Scrolls by one viewport minus one line, at least one line. Ignored while a full-screen
   * program owns the alternate screen and when any of ⌥, ⌃ or ⌘ is held, so those combinations
   * still reach the session.
   *
   * @param {KeyboardEvent} e - React keydown event.
   * @returns {boolean} True when the key was handled (its default action and propagation are stopped).
   *
   * @example
   * if (scrollKey(e)) return;
   */
  const scrollKey = (e: KeyboardEvent): boolean => {
    const vp = viewportRef.current;
    if (!vp || session?.alt || e.altKey || e.ctrlKey || e.metaKey) return false;
    if (e.key !== 'PageUp' && e.key !== 'PageDown') return false;
    e.preventDefault();
    e.stopPropagation();
    const cell = parseFloat(getComputedStyle(vp).lineHeight) || fontSize * LINE_HEIGHT;
    vp.scrollTop += (e.key === 'PageUp' ? -1 : 1) * Math.max(cell, vp.clientHeight - cell);
    return true;
  };

  /**
   * Handle keys pressed while the output, not the input, has focus (e.g. after selecting text).
   *
   * Keys bubbling up from the input are ignored. Page Up / Page Down scroll, copy and select-all
   * shortcuts are left alone so they act on the selection, and bare modifier keys are ignored.
   * Any other key refocuses the input, scrolls to the bottom and goes to the session; printable
   * characters the session does not consume are inserted into the line.
   *
   * @param {KeyboardEvent<HTMLDivElement>} e - React keydown event from the terminal root.
   * @returns {void}
   *
   * @example
   * <div tabIndex={-1} onKeyDown={onRootKeyDown} />
   */
  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!session || e.target === inputRef.current) return;
    if (scrollKey(e)) return;
    const mod = isMacHost ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && (k === 'c' || k === 'a')) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    focusInput();
    stickToBottom.current = true;
    if (session.handleKey(e, { hasSelection: selectionInside() })) {
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      session.insert(e.key);
    }
  };

  /**
   * Route a paste into the input through the session.
   *
   * Prevents the browser from inserting the text itself and passes the plain-text clipboard data
   * to the session, which runs complete lines and keeps the last partial line in the editor.
   *
   * @param {ClipboardEvent<HTMLInputElement>} e - React paste event from the input.
   * @returns {void}
   *
   * @example
   * <input onPaste={onPaste} />
   */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    stickToBottom.current = true;
    session?.paste(e.clipboardData.getData('text/plain'));
  };

  /**
   * Whether a drag carries something the terminal can accept.
   *
   * Accepts virtual file paths dragged from Finder or the Desktop, files from the host computer,
   * and plain text.
   *
   * @param {DragEvent} e - React drag event.
   * @returns {boolean} True when the drop should be accepted.
   *
   * @example
   * if (!acceptsDrop(e)) return;
   */
  const acceptsDrop = (e: DragEvent) => hasDragPaths(e) || hasHostFiles(e) || !!e.dataTransfer?.types.includes('text/plain');

  /**
   * Mark an acceptable drag as a copy drop target.
   *
   * Calling preventDefault enables the drop, which also keeps host files from making the browser
   * navigate away. Drags are ignored while a full-screen program owns the alternate screen.
   *
   * @param {DragEvent<HTMLDivElement>} e - React dragover event on the terminal root.
   * @returns {void}
   *
   * @example
   * <div onDragOver={onDragOver} onDrop={onDrop} />
   */
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!session || session.alt || !acceptsDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  /**
   * Handle a drop on the terminal, like Terminal.app.
   *
   * Focuses the window and the input, then: dragged Finder / Desktop items are typed as their
   * shell-escaped paths followed by a space; host files are imported into ~/Downloads first and
   * the paths of the created files are typed once the import finishes; anything else is pasted
   * as plain text.
   *
   * @param {DragEvent<HTMLDivElement>} e - React drop event on the terminal root.
   * @returns {void}
   *
   * @example
   * <div onDragOver={onDragOver} onDrop={onDrop} />
   */
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!session || session.alt || !acceptsDrop(e)) return;
    e.preventDefault();
    stickToBottom.current = true;
    wm.focus(windowId);
    focusInput();
    /**
     * Type file paths into the line editor.
     *
     * Each path is shell-escaped, the paths are joined with spaces and a trailing space is added;
     * an empty list types nothing.
     *
     * @param {string[]} paths - Absolute virtual paths.
     * @returns {void}
     *
     * @example
     * typePaths(['/Users/aodjo/My File.txt']); // inserts "/Users/aodjo/My\ File.txt "
     */
    const typePaths = (paths: string[]) => {
      if (paths.length) session.insert(paths.map(escapeWord).join(' ') + ' ');
    };
    const paths = getDragPaths(e);
    if (paths.length) typePaths(paths);
    else if (hasHostFiles(e)) {
      const files = [...e.dataTransfer.files];
      void importHostFiles(files, PATHS.downloads).then(({ created }) => typePaths(created));
    } else session.paste(e.dataTransfer.getData('text/plain'));
  };

  /**
   * Show the terminal's context menu.
   *
   * Offers Copy (enabled only with a selection inside the terminal), Paste, Select All and
   * Clear Scrollback at the pointer position.
   *
   * @param {ReactMouseEvent} e - React contextmenu event.
   * @returns {void}
   *
   * @example
   * <div onContextMenu={onContextMenu} />
   */
  const onContextMenu = (e: ReactMouseEvent) => {
    const hasSel = selectionInside();
    showContextMenu(e, [
      { label: COMMON.copy, disabled: !hasSel, action: copySelection },
      { label: COMMON.paste, action: pasteClipboard },
      { separator: true },
      { label: COMMON.selectAll, action: selectAll },
      { label: S.clearScrollback, action: () => sessionRef.current?.clearScrollback() },
    ]);
  };

  const focused = win.focused && inputFocused;
  const buffer = session?.buffer;
  const lines = buffer?.lines ?? [];
  const pageStart = buffer?.pageStart ?? 1;
  let split = lines.length;
  for (let i = lines.length - 1; i >= 0 && lines[i].id >= pageStart; i--) split = i;

  const editing = !!session && !session.alt && (session.editing || session.mode === 'running' || session.mode === 'starting');
  const input = session?.input ?? '';
  const cursor = session?.cursor ?? 0;
  const visibleInput = editing && !session.secret;
  const cp = visibleInput ? input.codePointAt(cursor) : undefined;
  const underCursor = cp === undefined ? ' ' : String.fromCodePoint(cp);
  const afterCursor = visibleInput ? input.slice(cursor + underCursor.length) : '';

  return (
    <div
      ref={rootRef}
      className={`${s.root} ${translucent ? s.translucent : ''}`}
      data-profile={profile}
      tabIndex={-1}
      style={{ '--t-font-size': `${fontSize}px`, '--t-line-height': LINE_HEIGHT } as CSSProperties}
      onKeyDown={onRootKeyDown}
      onMouseDown={() => {
        pointerDown.current = true;
        // The drag may end outside the window.
        window.addEventListener('mouseup', () => (pointerDown.current = false), { once: true });
      }}
      onMouseUp={() => {
        pointerDown.current = false;
        if (!selectionInside()) focusInput();
      }}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        ref={viewportRef}
        className={s.viewport}
        role="log"
        aria-label={t(S.outputLabel)}
        aria-live="off"
        onScroll={(e) => {
          const vp = e.currentTarget;
          stickToBottom.current = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 4;
        }}
      >
        {session?.alt ? (
          <div className={s.alt}>
            {session.alt.map((raw, i) => (
              <AltLine key={i} raw={raw} />
            ))}
          </div>
        ) : (
          <>
            {lines.slice(0, split).map((l) => (
              <LineView key={l.id} segs={l.segs} />
            ))}
            <div className={s.page} style={{ minHeight: viewportHeight }}>
              {lines.slice(split).map((l) => (
                <LineView key={l.id} segs={l.segs} />
              ))}
              {session && (
                <div className={s.line}>
                  <Segments segs={session.buffer.pendingSegments()} prefix="p" />
                  {visibleInput && cells(input.slice(0, cursor), 'b')}
                  <span
                    key={`${input.length}:${cursor}`}
                    ref={cursorRef}
                    className={`${s.cursor} ${focused ? s.blink : s.hollow} ${charWidth(underCursor.codePointAt(0)!) === 2 ? s.wide : ''}`}
                    aria-hidden
                  >
                    {underCursor}
                  </span>
                  {afterCursor && cells(afterCursor, 'a')}
                </div>
              )}
              {session?.search && (
                <div className={s.line}>
                  {session.search.failing ? 'failing ' : ''}bck-i-search: {session.search.query}
                  <span className={s.searchCaret}>_</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        className={s.hiddenInput}
        value={input}
        aria-label={t(S.inputLabel)}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        onChange={(e) => {
          stickToBottom.current = true;
          session?.setInput(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => {
          if (!composing.current) session?.setCursor(e.currentTarget.selectionStart ?? 0);
        }}
        onKeyDown={onInputKeyDown}
        onPaste={onPaste}
        onFocus={() => setInputFocused(true)}
        onBlur={() => setInputFocused(false)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(e) => {
          composing.current = false;
          session?.setInput(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          if (enterAfterComposition.current) {
            enterAfterComposition.current = false;
            session?.submit();
          }
        }}
      />
      <span ref={measureRef} className={s.measure} aria-hidden>
        {'0'.repeat(100)}
      </span>
    </div>
  );
}

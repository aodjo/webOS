import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Timer, Trophy } from 'lucide-react';
import type { AppProps, MenuItem } from '@/kernel';
import { dialogs, fmt, formatDate, getWorkspace, isMacHost, t, useAppMenus, useLocale, useT, useWindowKeydown, useWM, wm } from '@/kernel';
import { IconButton, Select } from '@/components/ui';
import { LEVELS, LEVEL_IDS, canChord, chord, cycleMark, minesLeft, neighbors, newGame, reveal, type Difficulty, type Game, type LevelId } from './game';
import styles from './Minesweeper.module.css';

/** A localized string with English and Korean variants. */
type L = { en: string; ko: string };

const S = {
  game: { en: 'Game', ko: '게임' },
  newGame: { en: 'New Game', ko: '새 게임' },
  beginner: { en: 'Beginner', ko: '초급' },
  intermediate: { en: 'Intermediate', ko: '중급' },
  expert: { en: 'Expert', ko: '고급' },
  questionMarks: { en: 'Question Marks', ko: '물음표 표시' },
  bestTimesMenu: { en: 'Best Times…', ko: '최고 기록…' },
  bestTimes: { en: 'Best Times', ko: '최고 기록' },
  best: { en: 'Best {time}', ko: '최고 {time}' },
  noBest: { en: 'No best time yet', ko: '아직 기록 없음' },
  seconds: { en: '{n} s', ko: '{n}초' },
  resetScores: { en: 'Reset Scores', ko: '기록 초기화' },
  resetTitle: { en: 'Reset all best times?', ko: '모든 최고 기록을 초기화하겠습니까?' },
  resetMessage: { en: 'You can’t undo this action.', ko: '이 동작은 실행 취소할 수 없습니다.' },
  reset: { en: 'Reset', ko: '초기화' },
  ok: { en: 'OK', ko: '확인' },
  newRecord: { en: 'New Best Time!', ko: '새로운 최고 기록!' },
  newRecordMessage: { en: 'You cleared {level} in {time} seconds.', ko: '{level} 난이도를 {time}초 만에 완료했습니다.' },
  minesLeft: { en: 'Mines remaining: {n}', ko: '남은 지뢰: {n}개' },
  elapsed: { en: 'Elapsed time: {n} seconds', ko: '경과 시간: {n}초' },
  difficulty: { en: 'Difficulty', ko: '난이도' },
  minefield: { en: 'Minefield', ko: '지뢰밭' },
  cell: { en: 'Row {r}, column {c}', ko: '{r}행 {c}열' },
  hidden: { en: 'covered', ko: '닫힘' },
  flagged: { en: 'flagged', ko: '깃발' },
  question: { en: 'question mark', ko: '물음표' },
  empty: { en: 'empty', ko: '빈 칸' },
  near: { en: '{n} nearby', ko: '주변 지뢰 {n}개' },
  mine: { en: 'mine', ko: '지뢰' },
  won: { en: 'You cleared the minefield!', ko: '지뢰밭을 모두 찾았습니다!' },
  lost: { en: 'Boom! You hit a mine.', ko: '펑! 지뢰를 밟았습니다.' },
} satisfies Record<string, L>; /** Localized UI strings of the Minesweeper window. */

const LEVEL_LABEL: Record<LevelId, L> = { beginner: S.beginner, intermediate: S.intermediate, expert: S.expert }; /** Localized display name of each difficulty level. */

const KEY_LEVEL = 'webos.minesweeper.level'; /** localStorage key of the last selected difficulty level. */
const KEY_MARKS = 'webos.minesweeper.marks'; /** localStorage key of the "Question Marks" preference. */
const KEY_BEST = 'webos.minesweeper.best'; /** localStorage key of the best times per level. */

/** Best winning time per level: duration in ms and the timestamp it was set. */
type BestTimes = Partial<Record<LevelId, { ms: number; at: number }>>;

/**
 * Read a JSON value from localStorage.
 *
 * Returns the fallback when the key is missing or empty, when the stored text is not valid
 * JSON, or when storage access throws (e.g. blocked storage). The parsed value is not
 * validated against `T`.
 *
 * @param {string} key - localStorage key to read.
 * @param {T} fallback - Value returned when nothing usable is stored.
 * @returns {T} The parsed stored value, or `fallback`.
 *
 * @example
 * const marks = load(KEY_MARKS, true);
 * console.log(marks); // true unless the player turned question marks off
 */
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write a value to localStorage as JSON.
 *
 * Errors (storage unavailable, quota exceeded) are swallowed, so the value then only lives in
 * the component's state for the current session.
 *
 * @param {string} key - localStorage key to write.
 * @param {unknown} value - JSON-serializable value to store.
 * @returns {void}
 *
 * @example
 * save(KEY_LEVEL, 'expert');
 */
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage unavailable (e.g. private mode): the value stays in memory only. */
  }
}

/**
 * Determine the difficulty level to start with.
 *
 * Reads the last selected level from localStorage and falls back to 'beginner' when nothing
 * is stored or the stored id is not a known level.
 *
 * @returns {LevelId} A valid level id.
 *
 * @example
 * const [level, setLevel] = useState<LevelId>(initialLevel);
 */
const initialLevel = (): LevelId => {
  const v = load<string>(KEY_LEVEL, 'beginner');
  return (LEVEL_IDS as string[]).includes(v) ? (v as LevelId) : 'beginner';
};

const CELL = 30; /** Side length of a cell in px (matches `.cell` in the CSS module). */
const GAP = 2; /** Gap between cells in px. */
const BOARD_PAD = 6; /** Inner padding of the board well in px. */
const PAD_X = 16; /** Horizontal padding of the window content in px (matches `.root`). */
const CHROME_H = 28 + 10 + 24 + 8 + 40 + 10 + 12; /** Window height in px besides the board: titlebar, paddings, select row, status row and gaps. */

/**
 * Compute the pixel size of the board for a difficulty.
 *
 * Adds up the cells, the gaps between them and the board padding on both sides, using the
 * same geometry constants as the rendered grid.
 *
 * @param {Difficulty} d - Board dimensions (only `rows` and `cols` are used).
 * @returns {{ w: number; h: number }} Board width and height in px.
 *
 * @example
 * const { w, h } = boardPx(LEVELS.beginner);
 * console.log(w, h); // 298 298
 */
function boardPx(d: Difficulty) {
  return { w: d.cols * CELL + (d.cols - 1) * GAP + BOARD_PAD * 2, h: d.rows * CELL + (d.rows - 1) * GAP + BOARD_PAD * 2 };
}

/**
 * Resize a window so the board fits exactly.
 *
 * The size is the board plus the surrounding chrome, clamped to the workspace (the board
 * scrolls when it does not fit). The window keeps its top-left corner unless `center` is set,
 * in which case it grows or shrinks around its current centre. The position is then clamped
 * so the window stays inside the workspace. Missing or maximized windows, and windows that
 * already have the right size, are left untouched.
 *
 * @param {string} windowId - Id of the Minesweeper window.
 * @param {Difficulty} d - Difficulty whose board must fit.
 * @param {boolean} [center=false] - Keep the window centred on its current centre instead of its origin.
 * @returns {void}
 *
 * @example
 * fitWindow(windowId, LEVELS.expert);
 */
function fitWindow(windowId: string, d: Difficulty, center = false): void {
  const w = useWM.getState().windows.find((x) => x.id === windowId);
  if (!w || w.maximized) return;
  const ws = getWorkspace();
  const b = boardPx(d);
  const width = Math.min(b.w + PAD_X * 2, ws.width);
  const height = Math.min(b.h + CHROME_H, ws.height);
  if (w.width === width && w.height === height) return;
  const ax = center ? w.x + (w.width - width) / 2 : w.x;
  const ay = center ? w.y + (w.height - height) / 2 : w.y;
  const x = Math.round(Math.max(ws.x, Math.min(ax, ws.x + ws.width - width)));
  const y = Math.round(Math.max(ws.y, Math.min(ay, ws.y + ws.height - height)));
  wm.update(windowId, { x, y, width, height });
}

/**
 * Format a template in both languages at once.
 *
 * Fills `{name}` placeholders from `vars` (shared by both languages) and from `localized`,
 * whose values are substituted in the matching language. Useful for messages built once and
 * shown later, such as dialog text.
 *
 * @param {L} tpl - Localized template with `{name}` placeholders.
 * @param {Record<string, string | number>} vars - Values used as-is in both languages.
 * @param {Record<string, L>} [localized={}] - Localized values substituted per language.
 * @returns {L} The formatted string in English and Korean.
 *
 * @example
 * const msg = both(S.newRecordMessage, { time: '12.3' }, { level: S.expert });
 * console.log(msg.en); // 'You cleared Expert in 12.3 seconds.'
 */
const both = (tpl: L, vars: Record<string, string | number>, localized: Record<string, L> = {}): L => ({
  en: fmt(tpl.en, { ...vars, ...Object.fromEntries(Object.entries(localized).map(([k, v]) => [k, v.en])) }),
  ko: fmt(tpl.ko, { ...vars, ...Object.fromEntries(Object.entries(localized).map(([k, v]) => [k, v.ko])) }),
});

/**
 * Format a number for a three-digit LCD-style counter.
 *
 * Non-negative values are capped at 999 and zero-padded to three digits; negative values are
 * capped at -99 and shown as a minus sign plus two digits.
 *
 * @param {number} n - Value to display.
 * @returns {string} A three-character counter string.
 *
 * @example
 * console.log(lcd(7)); // '007'
 * console.log(lcd(-3)); // '-03'
 */
const lcd = (n: number) => (n < 0 ? '-' + String(Math.min(99, -n)).padStart(2, '0') : String(Math.min(999, n)).padStart(3, '0'));

/**
 * Format a duration in seconds with one decimal place.
 *
 * The value is truncated (not rounded) to tenths of a second.
 *
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} Seconds with one decimal, e.g. '12.3'.
 *
 * @example
 * console.log(secs(12399)); // '12.3'
 */
const secs = (ms: number) => (Math.floor(ms / 100) / 10).toFixed(1);

/**
 * Resolve the board cell an event target belongs to.
 *
 * Looks for the closest ancestor (or the element itself) carrying a `data-i` attribute, so
 * events on a cell's glyph still map to the cell.
 *
 * @param {EventTarget | null} target - Event target from a delegated board event.
 * @returns {number} The cell's row-major index, or -1 when the target is not inside a cell.
 *
 * @example
 * const i = cellIndex(e.target);
 * if (i >= 0) open(i);
 */
function cellIndex(target: EventTarget | null): number {
  const el = (target as Element | null)?.closest?.('[data-i]') as HTMLElement | null;
  return el ? Number(el.dataset.i) : -1;
}

/**
 * Render the mine icon.
 *
 * Draws a round mine with spikes and a highlight; it uses `currentColor`, so it follows the
 * surrounding text color, and is hidden from assistive technology.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=18] - Width and height in px.
 * @returns {JSX.Element} The SVG icon.
 *
 * @example
 * <MineGlyph size={14} />
 */
function MineGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8" />
      </g>
      <circle cx="12" cy="12" r="6.2" fill="currentColor" />
      <circle cx="9.9" cy="9.9" r="1.7" fill="#fff" opacity="0.75" />
    </svg>
  );
}

/**
 * Render the flag icon.
 *
 * Draws a pole and base in `currentColor` with a red pennant; hidden from assistive technology.
 *
 * @param {Object} props - Component props.
 * @param {number} [props.size=17] - Width and height in px.
 * @returns {JSX.Element} The SVG icon.
 *
 * @example
 * <FlagGlyph />
 */
function FlagGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5v15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 4h9.6a.6.6 0 0 1 .45 1L15.5 8l2.55 3a.6.6 0 0 1-.45 1H8z" fill="var(--red)" />
      <rect x="4" y="18.5" width="10" height="2.4" rx="1.2" fill="currentColor" />
    </svg>
  );
}

/** Props of a single board cell; all primitives so `memo` can skip unchanged cells. */
interface CellViewProps {
  /** Row-major index, exposed as `data-i` for delegated pointer handling. */
  i: number;
  revealed: boolean;
  mine: boolean;
  adjacent: number;
  mark: Game['cells'][number]['mark'];
  /** Game over: show this unflagged mine. */
  showMine: boolean;
  /** Game over: this flag was placed on a safe cell. */
  wrongFlag: boolean;
  /** This is the mine that ended the game. */
  exploded: boolean;
  /** Rendered pushed in while the pointer is held on it (or on a chordable neighbour). */
  pressed: boolean;
  /** Keyboard cursor position: the only cell in the tab order (roving tabindex). */
  tabbable: boolean;
  /** End-of-game animation delay (ms) or -1. */
  delay: number;
  /** Accessible label (position and state). */
  label: string;
}

/**
 * Render one cell of the minefield grid.
 *
 * Memoized on primitive props so only cells whose state changed re-render. A cell is drawn
 * open when revealed or when a mine is shown after a loss; it then shows the mine glyph or
 * its colored adjacent count. Covered cells show a flag or question mark. Pressed, exploded,
 * wrong-flag and animated states map to CSS module classes, and a non-negative `delay` is
 * passed to the end-of-game animation through the `--d` custom property.
 *
 * @param {CellViewProps} props - Cell state and presentation flags.
 * @param {number} props.i - Row-major index, rendered as `data-i`.
 * @param {boolean} props.revealed - Whether the cell is revealed.
 * @param {boolean} props.mine - Whether the cell holds a mine.
 * @param {number} props.adjacent - Number of adjacent mines.
 * @param {Game['cells'][number]['mark']} props.mark - Player mark on the covered cell.
 * @param {boolean} props.showMine - Show the mine after a loss.
 * @param {boolean} props.wrongFlag - Mark the flag as misplaced after a loss.
 * @param {boolean} props.exploded - Highlight the mine that ended the game.
 * @param {boolean} props.pressed - Render the covered cell pushed in.
 * @param {boolean} props.tabbable - Put the cell in the tab order.
 * @param {number} props.delay - End-of-game animation delay in ms, or -1 for none.
 * @param {string} props.label - Accessible label.
 * @returns {JSX.Element} The grid cell element.
 *
 * @example
 * <CellView i={0} revealed={false} mine={false} adjacent={0} mark="flag" showMine={false} wrongFlag={false}
 *   exploded={false} pressed={false} tabbable delay={-1} label="Row 1, column 1, flagged" />
 */
const CellView = memo(function CellView({ i, revealed, mine, adjacent, mark, showMine, wrongFlag, exploded, pressed, tabbable, delay, label }: CellViewProps) {
  const open = revealed || showMine;
  const cls = [
    styles.cell,
    open ? styles.open : styles.closed,
    pressed && !open ? styles.pressed : '',
    exploded ? styles.exploded : '',
    wrongFlag ? styles.wrong : '',
    delay >= 0 ? styles.animated : '',
  ]
    .filter(Boolean)
    .join(' ');
  let content: ReactNode = null;
  if (open && mine) content = <MineGlyph />;
  else if (revealed && adjacent > 0) content = <span className={styles[`n${adjacent}`]}>{adjacent}</span>;
  else if (!revealed && mark === 'flag') content = <FlagGlyph />;
  else if (!revealed && mark === 'question') content = <span className={styles.question}>?</span>;
  return (
    <div role="gridcell" data-i={i} tabIndex={tabbable ? 0 : -1} aria-label={label} className={cls} style={delay >= 0 ? ({ '--d': `${delay}ms` } as CSSProperties) : undefined}>
      {content}
    </div>
  );
});

/**
 * Render the elapsed-time counter.
 *
 * Owns its own 250 ms tick while the game is running, so the board does not re-render four
 * times a second. The elapsed time is `endedAt - startedAt` once the game ends; while running,
 * the current time is clamped to `startedAt` so a game started just before the next tick never
 * shows time from before it began. Before the first reveal it shows 0.
 *
 * @param {Object} props - Component props.
 * @param {number | null} props.startedAt - Start timestamp (ms), or null before the first reveal.
 * @param {number | null} props.endedAt - End timestamp (ms), or null while running.
 * @returns {JSX.Element} The counter capsule with whole elapsed seconds.
 *
 * @example
 * <Clock startedAt={game.startedAt} endedAt={game.endedAt} />
 */
function Clock({ startedAt, endedAt }: { startedAt: number | null; endedAt: number | null }) {
  const tr = useT();
  const [now, setNow] = useState(() => Date.now());
  const running = startedAt != null && endedAt == null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  const elapsedMs = startedAt == null ? 0 : (endedAt ?? Math.max(now, startedAt)) - startedAt;
  const elapsed = Math.floor(elapsedMs / 1000);
  return (
    <div className={`lg lg-control lg-capsule ${styles.counter}`} role="img" aria-label={fmt(tr(S.elapsed), { n: elapsed })}>
      <span className={styles.counterIcon}>
        <Timer size={14} />
      </span>
      <span className={styles.digits}>{lcd(elapsed)}</span>
    </div>
  );
}

/**
 * Minesweeper app window.
 *
 * Holds the game state, the selected level (persisted), the question-mark preference
 * (persisted) and the best times (persisted). On mount it fits the window to the restored
 * level, centred on its current position. Board input is delegated: pointer events are
 * handled on the board element and mapped to cells via `data-i`; mouse presses preview the
 * cells that would open, touch long-presses cycle the mark, and arrow keys move a roving keyboard
 * cursor. A "Game" menu offers new game, levels, question marks and best times, and F2 also
 * starts a new game. Releasing the pointer outside the board or blurring the window cancels a
 * press. Pending timers are cleared on unmount.
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - Id of the window hosting this instance.
 * @returns {JSX.Element} The game window content.
 *
 * @example
 * <Minesweeper windowId={id} pid={pid} args={{}} />
 */
export default function Minesweeper({ windowId }: AppProps) {
  const tr = useT();
  const locale = useLocale();
  const [level, setLevel] = useState<LevelId>(initialLevel);
  const [marks, setMarks] = useState<boolean>(() => load(KEY_MARKS, true));
  const [best, setBest] = useState<BestTimes>(() => load(KEY_BEST, {}));
  const [game, setGame] = useState<Game>(() => newGame(LEVELS[level]));
  const [press, setPress] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null);

  useEffect(() => {
    fitWindow(windowId, LEVELS[level], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId]);

  useEffect(
    () => () => {
      clearTimeout(alertTimer.current);
      if (longPress.current) clearTimeout(longPress.current.timer);
    },
    [],
  );

  const pressing = press !== null;
  useEffect(() => {
    if (!pressing) return;
    /**
     * Cancel the current press.
     *
     * Registered on window `pointerup` and `blur` while a cell is pressed, so releasing the
     * pointer outside the board (or leaving the window) clears the pressed state.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerup', cancel);
     */
    const cancel = () => setPress(null);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [pressing]);

  const over = game.status === 'won' || game.status === 'lost';

  /**
   * Start a new game at the current level.
   *
   * Cancels a pending best-time alert and clears the pressed cell.
   *
   * @returns {void}
   *
   * @example
   * { label: S.newGame, shortcut: 'alt+n', action: restart }
   */
  const restart = useCallback(() => {
    clearTimeout(alertTimer.current);
    setGame(newGame(LEVELS[level]));
    setPress(null);
  }, [level]);

  /**
   * Switch to another difficulty level.
   *
   * Persists the choice, starts a new game on the new board, resets the keyboard cursor and
   * pressed cell, cancels a pending best-time alert and resizes the window to fit the board.
   *
   * @param {LevelId} id - Level to switch to.
   * @returns {void}
   *
   * @example
   * changeLevel('expert');
   */
  const changeLevel = useCallback(
    (id: LevelId) => {
      clearTimeout(alertTimer.current);
      setLevel(id);
      save(KEY_LEVEL, id);
      setGame(newGame(LEVELS[id]));
      setCursor(0);
      setPress(null);
      fitWindow(windowId, LEVELS[id]);
    },
    [windowId],
  );

  /**
   * Toggle whether secondary clicks cycle through a question mark.
   *
   * Flips the preference in state and persists the new value.
   *
   * @returns {void}
   *
   * @example
   * { label: S.questionMarks, checked: marks, action: toggleMarks }
   */
  const toggleMarks = useCallback(() => {
    setMarks(!marks);
    save(KEY_MARKS, !marks);
  }, [marks]);

  /**
   * Show the best times per level in an alert sheet.
   *
   * Lists every level with its best time and the date it was set (or a dash). Choosing
   * "Reset Scores" asks for confirmation and then clears and persists an empty record; when
   * there are no best times to reset, nothing further happens.
   *
   * @async
   * @returns {Promise<void>} Resolves when the dialogs are dismissed.
   *
   * @example
   * void showBestTimes();
   */
  const showBestTimes = useCallback(async () => {
    const lines = LEVEL_IDS.map((id) => {
      const b = best[id];
      const value = b ? `${fmt(t(S.seconds), { n: secs(b.ms) })} · ${formatDate(b.at, locale, { dateStyle: 'medium' })}` : '—';
      return `${t(LEVEL_LABEL[id])}: ${value}`;
    });
    const v = await dialogs.alert({
      windowId,
      appId: 'minesweeper',
      title: S.bestTimes,
      message: lines.join('\n'),
      buttons: [
        { label: S.resetScores, value: 'reset', danger: true },
        { label: S.ok, value: 'ok', primary: true, cancel: true },
      ],
    });
    if (v !== 'reset' || !Object.keys(best).length) return;
    const ok = await dialogs.confirm({ windowId, appId: 'minesweeper', title: S.resetTitle, message: S.resetMessage, okLabel: S.reset, danger: true });
    if (ok) {
      setBest({});
      save(KEY_BEST, {});
    }
  }, [best, locale, windowId]);

  /**
   * Apply a new game state and record a best time on a win.
   *
   * Does nothing when the rules returned the same object (a no-op move). When the move wins
   * the game and beats the stored best time for the level (or there is none), the new time is
   * saved and a "New Best Time" alert is shown after 750 ms, letting the win animation play
   * before the sheet slides down.
   *
   * @param {Game} next - State returned by a game rule function.
   * @returns {void}
   *
   * @example
   * commit(reveal(game, i, Date.now()));
   */
  const commit = (next: Game) => {
    if (next === game) return;
    setGame(next);
    if (next.status !== 'won' || game.status === 'won' || next.startedAt == null || next.endedAt == null) return;
    const ms = next.endedAt - next.startedAt;
    const prev = best[level];
    if (prev && prev.ms <= ms) return;
    const updated = { ...best, [level]: { ms, at: Date.now() } };
    setBest(updated);
    save(KEY_BEST, updated);
    clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => {
      void dialogs.alert({ windowId, appId: 'minesweeper', title: S.newRecord, message: both(S.newRecordMessage, { time: secs(ms) }, { level: LEVEL_LABEL[level] }) });
    }, 750);
  };

  /**
   * Open a cell: reveal it when covered, or chord when it is a revealed number.
   *
   * Ignores indices outside the board.
   *
   * @param {number} i - Row-major index of the cell.
   * @returns {void}
   *
   * @example
   * open(cursor);
   */
  const open = (i: number) => {
    const cell = game.cells[i];
    if (!cell) return;
    commit(cell.revealed ? chord(game, i, Date.now()) : reveal(game, i, Date.now()));
  };

  /**
   * Cycle the mark on a cell, honouring the question-mark preference.
   *
   * Applies `cycleMark` with the current `marks` setting and passes the result to `commit`,
   * so no-op moves (revealed cells, finished games) leave the state untouched.
   *
   * @param {number} i - Row-major index of the cell.
   * @returns {void}
   *
   * @example
   * mark(cursor);
   */
  const mark = (i: number) => commit(cycleMark(game, i, marks));

  useAppMenus(
    () => [
      {
        label: S.game,
        items: [
          { label: S.newGame, shortcut: 'alt+n', action: restart },
          { separator: true },
          ...LEVEL_IDS.map<MenuItem>((id, k) => ({ label: LEVEL_LABEL[id], shortcut: `alt+${k + 1}`, checked: id === level, action: () => changeLevel(id) })),
          { separator: true },
          { label: S.questionMarks, checked: marks, action: toggleMarks },
          { separator: true },
          { label: S.bestTimesMenu, action: () => void showBestTimes() },
        ],
      },
    ],
    [level, marks, restart, changeLevel, toggleMarks, showBestTimes],
  );

  useWindowKeydown((e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      restart();
    }
  });

  /**
   * Cancel the pending touch long-press timer, if any.
   *
   * Leaves `longPress.current` in place so callers can still inspect whether it fired.
   *
   * @returns {void}
   *
   * @example
   * clearLongPress();
   */
  const clearLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current.timer);
  };

  /**
   * Handle a pointer press on the board.
   *
   * Moves the keyboard cursor to the pressed cell. A secondary press (right button, ⌥-click,
   * or ⌃-click on Mac hosts) cycles the cell's mark immediately. A primary press marks the cell
   * as pressed; for touch it also starts a 420 ms long-press timer that, when it fires, clears
   * the press, cycles the mark and vibrates briefly. Presses outside cells or after the game
   * ends are ignored.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer event from the board.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={onPointerDown} />
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const i = cellIndex(e.target);
    if (i < 0 || over) return;
    setCursor(i);
    const secondary = e.button === 2 || (e.button === 0 && (e.altKey || (isMacHost && e.ctrlKey)));
    if (secondary) {
      e.preventDefault();
      mark(i);
      return;
    }
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') {
      clearLongPress();
      const lp = {
        x: e.clientX,
        y: e.clientY,
        fired: false,
        timer: setTimeout(() => {
          lp.fired = true;
          setPress(null);
          setGame((g) => cycleMark(g, i, marks));
          navigator.vibrate?.(12);
        }, 420),
      };
      longPress.current = lp;
    }
    setPress(i);
  };

  /**
   * Cancel a pending touch long-press when the finger moves.
   *
   * Moving more than 10 px from the touch-down point before the timer fires clears the timer
   * and the pressed cell, so scrolling the board does not flag a cell.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer event from the board.
   * @returns {void}
   *
   * @example
   * <div onPointerMove={onPointerMove} />
   */
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const lp = longPress.current;
    if (lp && !lp.fired && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) {
      clearTimeout(lp.timer);
      longPress.current = null;
      setPress(null);
    }
  };

  /**
   * Move the pressed cell while dragging with the primary mouse button held.
   *
   * Like the original game, sliding over the board with the button down presses whichever
   * cell is under the pointer. Touch input and moves without the primary button are ignored.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer event from the board.
   * @returns {void}
   *
   * @example
   * <div onPointerOver={onPointerOver} />
   */
  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (press === null || e.pointerType === 'touch' || !(e.buttons & 1)) return;
    const i = cellIndex(e.target);
    if (i >= 0 && i !== press) setPress(i);
  };

  /**
   * Finish a press and open the cell on release.
   *
   * Clears any long-press. When the long-press already fired (the cell was marked) or nothing
   * is pressed, only the pressed state is cleared. Otherwise a primary-button release over the
   * pressed cell opens it (reveal or chord).
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer event from the board.
   * @returns {void}
   *
   * @example
   * <div onPointerUp={onPointerUp} />
   */
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const lp = longPress.current;
    clearLongPress();
    longPress.current = null;
    if (lp?.fired || press === null) {
      setPress(null);
      return;
    }
    const i = cellIndex(e.target);
    setPress(null);
    if (e.button === 0 && i === press) open(i);
  };

  /**
   * Move DOM focus to a cell element.
   *
   * Looks the cell up by its `data-i` attribute inside the board; does nothing when the board
   * or the cell is not rendered.
   *
   * @param {number} i - Row-major index of the cell.
   * @returns {void}
   *
   * @example
   * focusCell(next);
   */
  const focusCell = (i: number) => boardRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();

  /**
   * Handle keyboard input on the board.
   *
   * Arrow keys move the cursor one cell (clamped to the board edges), Home/End jump to the
   * start/end of the row, and the cursor's cell receives focus. Enter or Space opens the cell;
   * F or M (without modifiers) cycles its mark; both are swallowed but do nothing once the game
   * is over. Other keys are left to the default handling.
   *
   * @param {ReactKeyboardEvent<HTMLDivElement>} e - Keyboard event from the board.
   * @returns {void}
   *
   * @example
   * <div onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const { rows, cols } = game;
    const r = Math.floor(cursor / cols);
    const c = cursor % cols;
    let next = cursor;
    switch (e.key) {
      case 'ArrowLeft':
        next = r * cols + Math.max(0, c - 1);
        break;
      case 'ArrowRight':
        next = r * cols + Math.min(cols - 1, c + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, r - 1) * cols + c;
        break;
      case 'ArrowDown':
        next = Math.min(rows - 1, r + 1) * cols + c;
        break;
      case 'Home':
        next = r * cols;
        break;
      case 'End':
        next = r * cols + cols - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!over) open(cursor);
        return;
      case 'f':
      case 'F':
      case 'm':
      case 'M':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        if (!over) mark(cursor);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next !== cursor) {
      setCursor(next);
      focusCell(next);
    }
  };

  const pressedSet = new Set<number>();
  if (press !== null && !over) {
    const cell = game.cells[press];
    if (cell && !cell.revealed && cell.mark !== 'flag') pressedSet.add(press);
    else if (canChord(game, press)) for (const j of neighbors(press, game.rows, game.cols)) if (!game.cells[j].revealed && game.cells[j].mark !== 'flag') pressedSet.add(j);
  }

  const exR = game.exploded >= 0 ? Math.floor(game.exploded / game.cols) : 0;
  const exC = game.exploded >= 0 ? game.exploded % game.cols : 0;

  const face = game.status === 'won' ? '😎' : game.status === 'lost' ? '😵' : press !== null ? '😮' : '😊';
  const bestHere = best[level];
  const boardSize = boardPx(game);

  /**
   * Build the accessible label of a cell.
   *
   * Combines the 1-based row/column position with the cell's state: mine, adjacent count or
   * empty when revealed; mine for unflagged mines after a loss; otherwise flagged, question
   * mark or covered.
   *
   * @param {number} i - Row-major index of the cell.
   * @returns {string} Localized label such as "Row 1, column 2, 3 nearby".
   *
   * @example
   * <CellView label={labelFor(i)} />
   */
  const labelFor = (i: number): string => {
    const cell = game.cells[i];
    const pos = fmt(tr(S.cell), { r: Math.floor(i / game.cols) + 1, c: (i % game.cols) + 1 });
    let state: string;
    if (cell.revealed) state = cell.mine ? tr(S.mine) : cell.adjacent ? fmt(tr(S.near), { n: cell.adjacent }) : tr(S.empty);
    else if (game.status === 'lost' && cell.mine && cell.mark !== 'flag') state = tr(S.mine);
    else state = cell.mark === 'flag' ? tr(S.flagged) : cell.mark === 'question' ? tr(S.question) : tr(S.hidden);
    return `${pos}, ${state}`;
  };

  return (
    <div className={styles.root}>
      <div className={styles.topRow}>
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>{tr(S.difficulty)}</span>
          <Select value={level} onChange={changeLevel} options={LEVEL_IDS.map((id) => ({ value: id, label: `${tr(LEVEL_LABEL[id])} · ${LEVELS[id].cols}×${LEVELS[id].rows}` }))} />
        </label>
        <span className={styles.bestLabel} title={tr(S.bestTimes)}>
          {bestHere ? fmt(tr(S.best), { time: fmt(tr(S.seconds), { n: secs(bestHere.ms) }) }) : tr(S.noBest)}
        </span>
        <IconButton label={tr(S.bestTimes)} onClick={() => void showBestTimes()}>
          <Trophy size={14} />
        </IconButton>
      </div>

      <div className={styles.status}>
        <div className={`lg lg-control lg-capsule ${styles.counter}`} role="img" aria-label={fmt(tr(S.minesLeft), { n: minesLeft(game) })}>
          <span className={styles.counterIcon}>
            <MineGlyph size={14} />
          </span>
          <span className={styles.digits}>{lcd(minesLeft(game))}</span>
        </div>
        <button type="button" className={`lg lg-control lg-circle lg-interactive ${styles.face}`} aria-label={tr(S.newGame)} title={`${tr(S.newGame)} (F2)`} onClick={restart}>
          <span key={game.status} className={styles.faceGlyph}>
            {face}
          </span>
        </button>
        <Clock startedAt={game.startedAt} endedAt={game.endedAt} />
      </div>

      <div className={styles.boardScroll}>
        <div
          ref={boardRef}
          // Long-press flags a cell, so the board opts out of the shell's touch
          // long-press → context menu fallback.
          data-own-longpress=""
          role="grid"
          aria-label={tr(S.minefield)}
          aria-rowcount={game.rows}
          aria-colcount={game.cols}
          className={`${styles.board} ${game.status === 'lost' ? styles.lost : ''} ${game.status === 'won' ? styles.won : ''}`}
          style={{ width: boardSize.w, height: boardSize.h, gridTemplateColumns: `repeat(${game.cols}, ${CELL}px)`, gap: GAP, padding: BOARD_PAD }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerOver={onPointerOver}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            clearLongPress();
            longPress.current = null;
            setPress(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={onKeyDown}
        >
          {Array.from({ length: game.rows }, (_, r) => (
            <div role="row" key={r} className={styles.row}>
              {Array.from({ length: game.cols }, (_, c) => {
                const i = r * game.cols + c;
                const cell = game.cells[i];
                const lost = game.status === 'lost';
                const showMine = lost && cell.mine && cell.mark !== 'flag';
                const wrongFlag = lost && !cell.mine && cell.mark === 'flag';
                let delay = -1;
                if (game.status === 'won') delay = (r + c) * 18;
                else if (showMine && i !== game.exploded) delay = Math.min(700, Math.round(Math.hypot(r - exR, c - exC) * 45));
                return (
                  <CellView
                    key={i}
                    i={i}
                    revealed={cell.revealed}
                    mine={cell.mine}
                    adjacent={cell.adjacent}
                    mark={cell.mark}
                    showMine={showMine}
                    wrongFlag={wrongFlag}
                    exploded={i === game.exploded}
                    pressed={pressedSet.has(i)}
                    tabbable={i === cursor}
                    delay={delay}
                    label={labelFor(i)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.srOnly} aria-live="polite">
        {game.status === 'won' ? tr(S.won) : game.status === 'lost' ? tr(S.lost) : ''}
      </div>
    </div>
  );
}

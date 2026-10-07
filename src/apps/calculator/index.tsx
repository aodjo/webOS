/**
 * Calculator — macOS-style basic & scientific calculator.
 * All arithmetic lives in ./engine (pure reducer); this file renders the keypad and display
 * and wires keys, keyboard, menus and the clipboard to the reducer.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { getWorkspace, useAppMenus, useT, useWindow, useWindowKeydown, wm } from '@/kernel';
import type { AppProps, LString } from '@/kernel';
import {
  calculate,
  clearLabel,
  clipboardText,
  displayText,
  expressionText,
  highlightedOp,
  initialState,
  openParens,
  parsePasted,
  type BinOp,
  type CalcAction,
  type UnaryFn,
} from './engine';
import styles from './Calculator.module.css';

const S = {
  view: { en: 'View', ko: '보기' },
  edit: { en: 'Edit', ko: '편집' },
  basic: { en: 'Basic', ko: '기본' },
  scientific: { en: 'Scientific', ko: '공학용' },
  separators: { en: 'Show Thousands Separators', ko: '천 단위 구분 기호 보기' },
  copy: { en: 'Copy', ko: '복사하기' },
  paste: { en: 'Paste', ko: '붙여넣기' },
  error: { en: 'Error', ko: '오류' },
  rad: { en: 'Rad', ko: 'Rad' },
  allClear: { en: 'All Clear', ko: '모두 지우기' },
  clear: { en: 'Clear', ko: '지우기' },
  negate: { en: 'Negate', ko: '부호 바꾸기' },
  percent: { en: 'Percent', ko: '퍼센트' },
  divide: { en: 'Divide', ko: '나누기' },
  multiply: { en: 'Multiply', ko: '곱하기' },
  subtract: { en: 'Subtract', ko: '빼기' },
  add: { en: 'Add', ko: '더하기' },
  equals: { en: 'Equals', ko: '등호' },
  decimal: { en: 'Decimal Point', ko: '소수점' },
  display: { en: 'Result', ko: '결과' },
} satisfies Record<string, LString>; /** Localized UI strings for menus, labels and key names. */

/** Keypad layout: the four-column basic pad or the ten-column scientific pad. */
type Mode = 'basic' | 'scientific';
const PREFS_KEY = 'webos.calculator'; /** localStorage key holding the persisted `Prefs`. */
const BASIC_WIDTH = 232; /** Window width in px in basic mode. */
const SCI_WIDTH = 560; /** Window width in px in scientific mode. */

/** View preferences persisted across sessions. */
interface Prefs {
  mode: Mode;
  separators: boolean;
}

/**
 * Reads the persisted view preferences.
 *
 * Parses the JSON stored under `PREFS_KEY`. The mode is scientific only when stored as
 * such, and thousands separators are on unless explicitly turned off. Missing, corrupt or
 * inaccessible storage yields the defaults (basic mode, separators on).
 *
 * @returns {Prefs} The stored preferences, or the defaults.
 *
 * @example
 * const [prefs, setPrefs] = useState(loadPrefs);
 * console.log(prefs.mode); // "basic"
 */
function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { mode: raw.mode === 'scientific' ? 'scientific' : 'basic', separators: raw.separators !== false };
  } catch {
    return { mode: 'basic', separators: true };
  }
}

/* ───────────────────────── Keys ───────────────────────── */

/** Visual style of a key: top-row function, digit, operator or scientific. */
type KeyKind = 'fn' | 'num' | 'op' | 'sci';
/** One keypad key. */
interface KeyDef {
  /** Stable key id, also used to flash the key on keyboard input. */
  id: string;
  label: ReactNode;
  /** Accessible name. */
  aria: LString;
  kind: KeyKind;
  /** Reducer action; 'second' toggles the 2nd functions and 'rand' inserts a random number. */
  action: CalcAction | 'second' | 'rand';
  /** Spans two grid columns (the 0 key). */
  wide?: boolean;
}

/**
 * Renders a label with a superscript.
 *
 * Wraps the base and a `<sup>` element in a fragment, used for key labels such as x² or eˣ.
 *
 * @param {ReactNode} base - Main label text.
 * @param {ReactNode} s - Superscript text.
 * @returns {JSX.Element} The combined label.
 *
 * @example
 * const label = sup('x', '2'); // x²
 */
const sup = (base: ReactNode, s: ReactNode) => (
  <>
    {base}
    <sup>{s}</sup>
  </>
);

/**
 * The "+/−" glyph shown on the negate key.
 *
 * Draws a plus sign, a slash and a minus sign as a 20×20 SVG stroked in the current
 * text color; it is hidden from assistive technology because the key has its own label.
 *
 * @returns {JSX.Element} The SVG icon.
 *
 * @example
 * <span><PlusMinus /></span>
 */
function PlusMinus() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M6 2.5v7M2.5 6h7M14 3.5 6 16.5M11 14h6.5" />
    </svg>
  );
}

const OP_KEYS: Record<'/' | '*' | '-' | '+', { label: string; aria: LString }> = {
  '/': { label: '÷', aria: S.divide },
  '*': { label: '×', aria: S.multiply },
  '-': { label: '−', aria: S.subtract },
  '+': { label: '+', aria: S.add },
}; /** Label and accessible name of each basic operator key. */

/**
 * Builds the basic keypad.
 *
 * Returns 19 keys in reading order: four rows of four (clear, ±, %, ÷ / 7 8 9 × /
 * 4 5 6 − / 1 2 3 +) followed by the wide 0, the decimal point and "=". The clear key
 * shows the given label and the matching accessible name.
 *
 * @param {'AC' | 'C'} clear - Current label of the clear key.
 * @returns {KeyDef[]} The basic keys in row order.
 *
 * @example
 * const keys = basicKeys(clearLabel(state));
 * console.log(keys.length); // 19
 */
function basicKeys(clear: 'AC' | 'C'): KeyDef[] {
  /**
   * Creates a digit key.
   *
   * The 0 key is marked wide so it spans two columns.
   *
   * @param {string} d - The digit, "0"–"9".
   * @returns {KeyDef} The digit key.
   *
   * @example
   * digit('7');
   */
  const digit = (d: string): KeyDef => ({ id: d, label: d, aria: d, kind: 'num', action: { type: 'digit', digit: d }, wide: d === '0' });
  /**
   * Creates a basic operator key.
   *
   * Takes the label and accessible name from `OP_KEYS`.
   *
   * @param {'/' | '*' | '-' | '+'} o - The operator.
   * @returns {KeyDef} The operator key.
   *
   * @example
   * op('+');
   */
  const op = (o: '/' | '*' | '-' | '+'): KeyDef => ({ id: o, label: OP_KEYS[o].label, aria: OP_KEYS[o].aria, kind: 'op', action: { type: 'op', op: o } });
  return [
    { id: 'clear', label: clear, aria: clear === 'AC' ? S.allClear : S.clear, kind: 'fn', action: { type: 'clear' } },
    { id: 'negate', label: <PlusMinus />, aria: S.negate, kind: 'fn', action: { type: 'negate' } },
    { id: '%', label: '%', aria: S.percent, kind: 'fn', action: { type: 'percent' } },
    op('/'),
    digit('7'),
    digit('8'),
    digit('9'),
    op('*'),
    digit('4'),
    digit('5'),
    digit('6'),
    op('-'),
    digit('1'),
    digit('2'),
    digit('3'),
    op('+'),
    digit('0'),
    { id: '.', label: '.', aria: S.decimal, kind: 'num', action: { type: 'decimal' } },
    { id: '=', label: '=', aria: S.equals, kind: 'op', action: { type: 'equals' } },
  ];
}

/**
 * Builds the scientific keypad.
 *
 * Returns 30 keys, six per row, that sit to the left of the basic keypad. When `second`
 * is on, several keys switch to their alternate function (yˣ, 2ˣ, log_y, log₂ and the
 * inverse trigonometric and hyperbolic functions). The angle key shows the unit it
 * switches to.
 *
 * @param {boolean} second - Whether the 2nd functions are active.
 * @param {'deg' | 'rad'} angle - Current angle unit.
 * @returns {KeyDef[]} The scientific keys in row order.
 *
 * @example
 * const keys = sciKeys(false, 'deg');
 * console.log(keys.length); // 30
 */
function sciKeys(second: boolean, angle: 'deg' | 'rad'): KeyDef[] {
  /**
   * Creates a key that applies a unary function.
   *
   * The key uses the scientific style and dispatches an 'fn' action for `f`.
   *
   * @param {string} id - Key id.
   * @param {ReactNode} label - Key label.
   * @param {LString} aria - Accessible name.
   * @param {UnaryFn} f - Function applied to the displayed value.
   * @returns {KeyDef} The scientific function key.
   *
   * @example
   * const sine = fn('sin', 'sin', 'Sine', 'sin');
   */
  const fn = (id: string, label: ReactNode, aria: LString, f: UnaryFn): KeyDef => ({ id, label, aria, kind: 'sci', action: { type: 'fn', fn: f } });
  /**
   * Creates a key that enters a binary operator.
   *
   * The key uses the scientific style and dispatches an 'op' action for `op`.
   *
   * @param {string} id - Key id.
   * @param {ReactNode} label - Key label.
   * @param {LString} aria - Accessible name.
   * @param {BinOp} op - Operator pushed onto the pending expression.
   * @returns {KeyDef} The scientific operator key.
   *
   * @example
   * const ee = bin('ee', 'EE', 'Scientific Notation', 'ee');
   */
  const bin = (id: string, label: ReactNode, aria: LString, op: BinOp): KeyDef => ({ id, label, aria, kind: 'sci', action: { type: 'op', op } });
  /**
   * Renders an inverse-function label.
   *
   * Appends a superscript "-1" to the function name, e.g. sin⁻¹.
   *
   * @param {ReactNode} s - Function name.
   * @returns {JSX.Element} The label.
   *
   * @example
   * inv('sin');
   */
  const inv = (s: ReactNode) => sup(s, '-1');
  return [
    { id: '(', label: '(', aria: { en: 'Open Parenthesis', ko: '여는 괄호' }, kind: 'sci', action: { type: 'paren', open: true } },
    { id: ')', label: ')', aria: { en: 'Close Parenthesis', ko: '닫는 괄호' }, kind: 'sci', action: { type: 'paren', open: false } },
    { id: 'mc', label: 'mc', aria: { en: 'Memory Clear', ko: '메모리 지우기' }, kind: 'sci', action: { type: 'memory', op: 'mc' } },
    { id: 'm+', label: 'm+', aria: { en: 'Memory Add', ko: '메모리 더하기' }, kind: 'sci', action: { type: 'memory', op: 'm+' } },
    { id: 'm-', label: 'm−', aria: { en: 'Memory Subtract', ko: '메모리 빼기' }, kind: 'sci', action: { type: 'memory', op: 'm-' } },
    { id: 'mr', label: 'mr', aria: { en: 'Memory Recall', ko: '메모리 불러오기' }, kind: 'sci', action: { type: 'memory', op: 'mr' } },

    { id: '2nd', label: sup('2', 'nd'), aria: { en: 'Second Functions', ko: '보조 기능' }, kind: 'sci', action: 'second' },
    fn('sq', sup('x', '2'), { en: 'Square', ko: '제곱' }, 'sq'),
    fn('cube', sup('x', '3'), { en: 'Cube', ko: '세제곱' }, 'cube'),
    bin('pow', sup('x', 'y'), { en: 'Power', ko: '거듭제곱' }, 'pow'),
    second ? bin('ypow', sup('y', 'x'), { en: 'Power of y', ko: 'y의 거듭제곱' }, 'ypow') : fn('exp', sup('e', 'x'), { en: 'e to the power', ko: 'e의 거듭제곱' }, 'exp'),
    second ? fn('pow2', sup('2', 'x'), { en: '2 to the power', ko: '2의 거듭제곱' }, 'pow2') : fn('pow10', sup('10', 'x'), { en: '10 to the power', ko: '10의 거듭제곱' }, 'pow10'),

    fn('inv', <><sup>1</sup>⁄<sub>x</sub></>, { en: 'Reciprocal', ko: '역수' }, 'inv'),
    fn('sqrt', <><sup>2</sup>√x</>, { en: 'Square Root', ko: '제곱근' }, 'sqrt'),
    fn('cbrt', <><sup>3</sup>√x</>, { en: 'Cube Root', ko: '세제곱근' }, 'cbrt'),
    bin('root', <><sup>y</sup>√x</>, { en: 'Root', ko: '거듭제곱근' }, 'root'),
    second ? bin('logy', <>log<sub>y</sub></>, { en: 'Logarithm base y', ko: '밑이 y인 로그' }, 'logy') : fn('ln', 'ln', { en: 'Natural Logarithm', ko: '자연로그' }, 'ln'),
    second ? fn('log2', <>log<sub>2</sub></>, { en: 'Logarithm base 2', ko: '밑이 2인 로그' }, 'log2') : fn('log10', <>log<sub>10</sub></>, { en: 'Logarithm base 10', ko: '상용로그' }, 'log10'),

    fn('fact', 'x!', { en: 'Factorial', ko: '계승' }, 'fact'),
    second ? fn('asin', inv('sin'), { en: 'Arcsine', ko: '아크사인' }, 'asin') : fn('sin', 'sin', { en: 'Sine', ko: '사인' }, 'sin'),
    second ? fn('acos', inv('cos'), { en: 'Arccosine', ko: '아크코사인' }, 'acos') : fn('cos', 'cos', { en: 'Cosine', ko: '코사인' }, 'cos'),
    second ? fn('atan', inv('tan'), { en: 'Arctangent', ko: '아크탄젠트' }, 'atan') : fn('tan', 'tan', { en: 'Tangent', ko: '탄젠트' }, 'tan'),
    { id: 'e', label: 'e', aria: { en: "Euler's Number", ko: '자연상수' }, kind: 'sci', action: { type: 'const', value: Math.E } },
    bin('ee', 'EE', { en: 'Scientific Notation', ko: '지수 표기' }, 'ee'),

    { id: 'angle', label: angle === 'deg' ? 'Rad' : 'Deg', aria: angle === 'deg' ? { en: 'Radians', ko: '라디안' } : { en: 'Degrees', ko: '도' }, kind: 'sci', action: { type: 'angle' } },
    second ? fn('asinh', inv('sinh'), { en: 'Inverse Hyperbolic Sine', ko: '역쌍곡사인' }, 'asinh') : fn('sinh', 'sinh', { en: 'Hyperbolic Sine', ko: '쌍곡사인' }, 'sinh'),
    second ? fn('acosh', inv('cosh'), { en: 'Inverse Hyperbolic Cosine', ko: '역쌍곡코사인' }, 'acosh') : fn('cosh', 'cosh', { en: 'Hyperbolic Cosine', ko: '쌍곡코사인' }, 'cosh'),
    second ? fn('atanh', inv('tanh'), { en: 'Inverse Hyperbolic Tangent', ko: '역쌍곡탄젠트' }, 'atanh') : fn('tanh', 'tanh', { en: 'Hyperbolic Tangent', ko: '쌍곡탄젠트' }, 'tanh'),
    { id: 'pi', label: 'π', aria: { en: 'Pi', ko: '원주율' }, kind: 'sci', action: { type: 'const', value: Math.PI } },
    { id: 'rand', label: 'Rand', aria: { en: 'Random Number', ko: '난수' }, kind: 'sci', action: 'rand' },
  ];
}

/**
 * Maps a keyboard key to a keypad key and reducer action.
 *
 * Digits, "." / "," (decimal), + - − * x × / ÷, Enter / "=", "%", Backspace / Delete,
 * Escape (all clear) and c (clear) work in both modes; "^", "(", ")" and "!" only in
 * scientific mode. The returned id identifies the on-screen key to flash.
 *
 * @param {KeyboardEvent} e - The keydown event.
 * @param {boolean} sci - Whether scientific mode is active.
 * @returns {{ id: string; action: CalcAction } | null} The matching key, or null when the
 *   key is not mapped.
 *
 * @example
 * keyToAction(new KeyboardEvent('keydown', { key: '*' }), false);
 * // { id: '*', action: { type: 'op', op: '*' } }
 */
function keyToAction(e: KeyboardEvent, sci: boolean): { id: string; action: CalcAction } | null {
  const k = e.key;
  if (/^[0-9]$/.test(k)) return { id: k, action: { type: 'digit', digit: k } };
  switch (k) {
    case '.':
    case ',':
      return { id: '.', action: { type: 'decimal' } };
    case '+':
      return { id: '+', action: { type: 'op', op: '+' } };
    case '-':
    case '−':
      return { id: '-', action: { type: 'op', op: '-' } };
    case '*':
    case 'x':
    case 'X':
    case '×':
      return { id: '*', action: { type: 'op', op: '*' } };
    case '/':
    case '÷':
      return { id: '/', action: { type: 'op', op: '/' } };
    case 'Enter':
    case '=':
      return { id: '=', action: { type: 'equals' } };
    case '%':
      return { id: '%', action: { type: 'percent' } };
    case 'Backspace':
    case 'Delete':
      return { id: 'backspace', action: { type: 'backspace' } };
    case 'Escape':
      return { id: 'clear', action: { type: 'allClear' } };
    case 'c':
    case 'C':
      return { id: 'clear', action: { type: 'clear' } };
    case '^':
      return sci ? { id: 'pow', action: { type: 'op', op: 'pow' } } : null;
    case '(':
      return sci ? { id: '(', action: { type: 'paren', open: true } } : null;
    case ')':
      return sci ? { id: ')', action: { type: 'paren', open: false } } : null;
    case '!':
      return sci ? { id: 'fact', action: { type: 'fn', fn: 'fact' } } : null;
    default:
      return null;
  }
}

/* ───────────────────────── Display ───────────────────────── */

/**
 * Right-aligned text that shrinks its font to fit the available width.
 *
 * After every render that changes the text, the parent width or `max`, the font size is
 * reset to `max`, and if the text then overflows its parent it is scaled down in
 * proportion to the overflow (never below 12px). A ResizeObserver on the parent re-runs
 * the fit when the window is resized.
 *
 * @param {Object} props - Component props.
 * @param {string} props.text - Text to show.
 * @param {string} props.className - Class applied to the text element.
 * @param {number} props.max - Largest font size in px.
 * @returns {JSX.Element} The text element.
 *
 * @example
 * <FitText text="1,234,567" className={styles.result} max={48} />
 */
function FitText({ text, className, max }: { text: string; className: string; max: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    el.style.fontSize = `${max}px`;
    const avail = parent.clientWidth;
    const natural = el.scrollWidth;
    if (natural > avail && natural > 0) el.style.fontSize = `${Math.max(12, Math.floor((max * avail) / natural))}px`;
  }, [text, width, max]);

  return (
    <div ref={ref} className={className}>
      {text}
    </div>
  );
}

/* ───────────────────────── App ───────────────────────── */

/**
 * The Calculator app window.
 *
 * Keeps the calculation in the engine reducer and renders the display (indicators,
 * expression line, auto-fitting result) above a keypad. Basic and scientific modes share
 * one grid so their keys line up: each row is six scientific keys (scientific mode only)
 * followed by that row of the basic keypad.
 *
 * The window is made vibrant on mount so the body is dark and translucent in both
 * appearances. Switching modes resizes the window to the mode's width and keeps it on
 * screen, unless it is maximized or tiled. The mode and separator preferences persist in
 * localStorage. Keyboard input without modifiers is mapped to keys (which briefly flash),
 * and the Edit and View menus provide Copy, Paste, mode switching (⌘1 / ⌘2) and the
 * thousands-separator toggle.
 *
 * @param {AppProps} props - Standard app props.
 * @param {string} props.windowId - Id of the window hosting the calculator.
 * @returns {JSX.Element} The calculator UI.
 *
 * @example
 * <Calculator windowId={id} pid={pid} args={{}} />
 */
export default function Calculator({ windowId }: AppProps) {
  const t = useT();
  const { win } = useWindow();
  const [state, dispatch] = useReducer(calculate, initialState);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [second, setSecond] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sci = prefs.mode === 'scientific';

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  useEffect(() => {
    wm.update(windowId, { vibrancy: true });
  }, [windowId]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* Storage unavailable: preferences then last only for this session. */
    }
  }, [prefs]);

  const maximized = !!win?.maximized || !!win?.tiled;
  const winX = win?.x;
  useEffect(() => {
    if (maximized || winX === undefined) return;
    const width = sci ? SCI_WIDTH : BASIC_WIDTH;
    const ws = getWorkspace();
    const x = Math.max(ws.x, Math.min(winX, ws.x + ws.width - width));
    wm.update(windowId, { width, x });
    // Only react to the mode, not to the window being dragged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sci, maximized, windowId]);

  /**
   * Shows a key in its pressed state for a moment.
   *
   * Marks the key as pressed and clears it after 130 ms, restarting the timer when
   * another key is flashed first.
   *
   * @param {string} id - Id of the key to flash.
   * @returns {void}
   *
   * @example
   * flash('=');
   */
  const flash = useCallback((id: string) => {
    setPressed(id);
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressed(null), 130);
  }, []);

  /**
   * Copies the current value to the system clipboard.
   *
   * Writes the ungrouped value; does nothing in the error state, and clipboard failures
   * are ignored.
   *
   * @returns {void}
   *
   * @example
   * copy();
   */
  const copy = useCallback(() => {
    const text = clipboardText(state);
    if (text) void navigator.clipboard?.writeText(text).catch(() => {});
  }, [state]);

  /**
   * Pastes a number from the system clipboard.
   *
   * Reads the clipboard asynchronously and dispatches a paste action when the text parses
   * as a number; non-numeric text, a missing clipboard API and read failures are ignored.
   *
   * @returns {void}
   *
   * @example
   * paste();
   */
  const paste = useCallback(() => {
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        const n = parsePasted(text);
        if (n !== null) dispatch({ type: 'paste', value: n });
      })
      .catch(() => {});
  }, []);

  /**
   * Switches between the basic and scientific keypads.
   *
   * Updates the persisted preference; the resize effect then adjusts the window width.
   *
   * @param {Mode} mode - The keypad to show.
   * @returns {void}
   *
   * @example
   * setMode('scientific');
   */
  const setMode = useCallback((mode: Mode) => setPrefs((p) => ({ ...p, mode })), []);

  useAppMenus(
    () => [
      {
        label: S.edit,
        items: [
          { label: S.copy, shortcut: 'mod+c', disabled: state.error, action: copy },
          { label: S.paste, shortcut: 'mod+v', action: paste },
        ],
      },
      {
        label: S.view,
        items: [
          { label: S.basic, shortcut: 'mod+1', checked: !sci, action: () => setMode('basic') },
          { label: S.scientific, shortcut: 'mod+2', checked: sci, action: () => setMode('scientific') },
          { separator: true },
          { label: S.separators, checked: prefs.separators, action: () => setPrefs((p) => ({ ...p, separators: !p.separators })) },
        ],
      },
    ],
    [state.error, sci, prefs.separators, copy, paste, setMode],
  );

  useWindowKeydown((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const hit = keyToAction(e, sci);
    if (!hit) return;
    e.preventDefault();
    flash(hit.id);
    dispatch(hit.action);
  });

  /**
   * Handles a click on a keypad key.
   *
   * Toggles the 2nd functions, inserts a random number in [0, 1) for Rand, or dispatches
   * the key's reducer action.
   *
   * @param {KeyDef} k - The clicked key.
   * @returns {void}
   *
   * @example
   * press(basicKeys('AC')[0]);
   */
  const press = (k: KeyDef) => {
    if (k.action === 'second') setSecond((v) => !v);
    else if (k.action === 'rand') dispatch({ type: 'const', value: Math.random() });
    else dispatch(k.action);
  };

  const clear = clearLabel(state);
  const highlighted = highlightedOp(state);
  const shown = displayText(state);
  /**
   * Applies the thousands-separator preference to display text.
   *
   * Removes all commas when separators are turned off.
   *
   * @param {string} s - Grouped display text.
   * @returns {string} The text to show.
   *
   * @example
   * strip('1,234'); // "1234" with separators off
   */
  const strip = (s: string) => (prefs.separators ? s : s.replace(/,/g, ''));
  const main = shown === null ? t(S.error) : strip(shown);
  const expr = strip(expressionText(state));
  const parens = openParens(state);

  /**
   * Renders one keypad button.
   *
   * Combines the key's kind class with state classes: selected for the pending operator,
   * on for an active 2nd key or the mr key while memory holds a value, and pressed while
   * the key is flashed from the keyboard. Mouse-down is prevented so the button never
   * takes focus away from the window.
   *
   * @param {KeyDef} k - The key to render.
   * @returns {JSX.Element} The key's button.
   *
   * @example
   * <div className={styles.pad}>{keys.map(renderKey)}</div>
   */
  const renderKey = (k: KeyDef) => {
    const active = typeof k.action === 'object' && k.action.type === 'op' && k.action.op === highlighted;
    const on = (k.id === '2nd' && second) || (k.id === 'mr' && state.memory !== null);
    const cls = [styles.key, styles[k.kind], k.wide && styles.wide, active && styles.selected, on && styles.on, pressed === k.id && styles.pressed].filter(Boolean).join(' ');
    return (
      <button
        key={k.id}
        type="button"
        className={cls}
        aria-label={t(k.aria)}
        aria-pressed={k.id === '2nd' ? second : active || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => press(k)}
      >
        <span>{k.label}</span>
      </button>
    );
  };

  const basic = basicKeys(clear);
  const basicRows = [basic.slice(0, 4), basic.slice(4, 8), basic.slice(8, 12), basic.slice(12, 16), basic.slice(16)];
  const sciList = sci ? sciKeys(second, state.angle) : [];
  const keys = basicRows.flatMap((row, r) => [...sciList.slice(r * 6, r * 6 + 6), ...row]);

  return (
    <div className={[styles.calc, sci && styles.isSci, maximized && styles.max].filter(Boolean).join(' ')}>
      <div className={styles.display} data-drag-region>
        <div className={styles.indicators} data-drag-region>
          {sci && state.angle === 'rad' && <span>{t(S.rad)}</span>}
          {state.memory !== null && <span>M</span>}
          {parens > 0 && <span>{'('.repeat(Math.min(parens, 5))}</span>}
        </div>
        <div className={styles.expr} data-drag-region>
          <span>{expr}</span>
        </div>
        <div className={styles.resultBox} data-drag-region role="status" aria-label={t(S.display)} aria-live="polite">
          <FitText text={main} className={styles.result} max={sci ? 50 : 48} />
        </div>
      </div>
      <div className={styles.pad}>{keys.map(renderKey)}</div>
    </div>
  );
}

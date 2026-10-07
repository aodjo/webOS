/** macOS-style find bar (with optional replace row) shown at the top of a TextEdit window. */
import { forwardRef, useImperativeHandle, useRef, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { fmt, useT } from '@/kernel';
import { isComposing } from './editing';
import styles from './TextEdit.module.css';

const S = {
  find: { en: 'Find', ko: '찾기' },
  replace: { en: 'Replace', ko: '대치' },
  replaceWith: { en: 'Replace with', ko: '대치할 내용' },
  all: { en: 'All', ko: '모두' },
  done: { en: 'Done', ko: '완료' },
  previous: { en: 'Previous', ko: '이전' },
  next: { en: 'Next', ko: '다음' },
  matchCase: { en: 'Match Case', ko: '대소문자 구분' },
  notFound: { en: 'Not found', ko: '찾을 수 없음' },
  count: { en: '{i} of {n}', ko: '{n}개 중 {i}번째' },
}; /** Localized strings for the find bar. */

/** Imperative API the find bar exposes to TextEdit through its ref. */
export interface FindBarHandle {
  /** Focus the find field and select its text. */
  focusFind: () => void;
  /** Focus the replace field (only present while the replace row is open). */
  focusReplace: () => void;
  /** Whether an element is inside the find bar; used to keep focus there after an edit. */
  contains: (el: Element | null) => boolean;
}

/** Find state and callbacks owned by the TextEdit window. */
interface Props {
  /** Text being searched for. */
  query: string;
  /** Text that replaces matches. */
  replacement: string;
  /** Whether the replace row is shown. */
  replaceOpen: boolean;
  /** Whether matching is case-sensitive. */
  matchCase: boolean;
  /** Number of matches in the document. */
  total: number;
  /** Index of the current match (0-based). */
  current: number;
  onQuery: (q: string) => void;
  onReplacement: (r: string) => void;
  onToggleReplace: (v: boolean) => void;
  onToggleCase: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

/**
 * Floating find (and optional replace) bar shown at the top of a TextEdit window.
 *
 * A controlled component: the query, replacement, options and match counts come from props and
 * every change is reported through the `on*` callbacks. It renders as a thick Liquid Glass panel
 * (`lg lg-thick`; the `.lg` class owns the ::before/::after layers). The first row holds the
 * Replace toggle, the find field with its "i of n" / "Not found" status and the Match Case
 * button, the previous/next buttons and Done; the second row (when `replaceOpen`) holds the
 * replace field with Replace and All. Enter in the find field goes to the next match (⇧Enter to
 * the previous), Enter in the replace field replaces the current match, and Escape closes the
 * bar; keys are ignored while an IME composition is active. The ref exposes `FindBarHandle`.
 *
 * @param {Props} p - Find state and callbacks.
 * @param {string} p.query - Text being searched for.
 * @param {string} p.replacement - Replacement text.
 * @param {boolean} p.replaceOpen - Whether the replace row is shown.
 * @param {boolean} p.matchCase - Whether matching is case-sensitive.
 * @param {number} p.total - Number of matches.
 * @param {number} p.current - Index of the current match.
 * @param {(q: string) => void} p.onQuery - Called with the new query as the user types.
 * @param {(r: string) => void} p.onReplacement - Called with the new replacement text.
 * @param {(v: boolean) => void} p.onToggleReplace - Called when the Replace checkbox changes.
 * @param {() => void} p.onToggleCase - Called when Match Case is clicked.
 * @param {() => void} p.onNext - Go to the next match.
 * @param {() => void} p.onPrevious - Go to the previous match.
 * @param {() => void} p.onReplace - Replace the current match.
 * @param {() => void} p.onReplaceAll - Replace every match.
 * @param {() => void} p.onClose - Close the bar.
 * @param {React.Ref<FindBarHandle>} ref - Receives the imperative handle.
 * @returns {JSX.Element} The find bar.
 *
 * @example
 * <FindBar ref={findRef} query={q} total={matches.length} current={i} onQuery={setQ} onClose={close} {...rest} />
 */
export const FindBar = forwardRef<FindBarHandle, Props>(function FindBar(p, ref) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    /**
     * Focus the find field and select its contents.
     *
     * Selecting the existing query lets the user type a new search term right away.
     *
     * @returns {void}
     *
     * @example
     * findRef.current?.focusFind();
     */
    focusFind: () => {
      findRef.current?.focus();
      findRef.current?.select();
    },
    /**
     * Focus the replace field.
     *
     * Does nothing while the replace row is closed.
     *
     * @returns {void}
     *
     * @example
     * findRef.current?.focusReplace();
     */
    focusReplace: () => replaceRef.current?.focus(),
    /**
     * Whether an element belongs to the find bar.
     *
     * Returns false for null and checks DOM containment against the bar's root element.
     *
     * @param {Element | null} el - Element to test, typically `document.activeElement`.
     * @returns {boolean} True when `el` is inside the bar.
     *
     * @example
     * findRef.current?.contains(document.activeElement);
     */
    contains: (el) => !!el && !!rootRef.current?.contains(el),
  }));

  /**
   * Keyboard handler for the find field.
   *
   * Enter goes to the next match and ⇧Enter to the previous one; Escape closes the bar. Both keys
   * have their default action prevented. Keys pressed during an IME composition are ignored.
   *
   * @param {KeyboardEvent<HTMLInputElement>} e - The keydown event.
   * @returns {void}
   *
   * @example
   * <input onKeyDown={onFindKey} />
   */
  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) p.onPrevious();
      else p.onNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      p.onClose();
    }
  };

  /**
   * Keyboard handler for the replace field.
   *
   * Enter replaces the current match and Escape closes the bar. Both keys have their default
   * action prevented. Keys pressed during an IME composition are ignored.
   *
   * @param {KeyboardEvent<HTMLInputElement>} e - The keydown event.
   * @returns {void}
   *
   * @example
   * <input onKeyDown={onReplaceKey} />
   */
  const onReplaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      p.onReplace();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      p.onClose();
    }
  };

  const status = !p.query ? '' : p.total ? fmt(t(S.count), { i: Math.max(1, p.current + 1), n: p.total }) : t(S.notFound);

  return (
    <div ref={rootRef} className={`lg lg-thick ${styles.findBar}`} role="search">
      <div className={styles.findRow}>
        <label className={styles.replaceToggle}>
          <input type="checkbox" checked={p.replaceOpen} onChange={(e) => p.onToggleReplace(e.target.checked)} />
          {t(S.replace)}
        </label>
        <div className={`${styles.findField} ${p.query && !p.total ? styles.findMiss : ''}`}>
          <Search size={12} aria-hidden />
          <input
            ref={findRef}
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={onFindKey}
            placeholder={t(S.find)}
            aria-label={t(S.find)}
            spellCheck={false}
            autoComplete="off"
          />
          {status && <span className={styles.findCount}>{status}</span>}
          <button type="button" className={`${styles.caseBtn} ${p.matchCase ? styles.caseOn : ''}`} aria-pressed={p.matchCase} title={t(S.matchCase)} aria-label={t(S.matchCase)} onClick={p.onToggleCase}>
            Aa
          </button>
        </div>
        <div className={styles.navGroup} role="group">
          <button type="button" aria-label={t(S.previous)} title={t(S.previous)} disabled={!p.total} onClick={p.onPrevious}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" aria-label={t(S.next)} title={t(S.next)} disabled={!p.total} onClick={p.onNext}>
            <ChevronRight size={14} />
          </button>
        </div>
        <button type="button" className={`ui-btn ${styles.barBtn}`} onClick={p.onClose}>
          {t(S.done)}
        </button>
      </div>
      {p.replaceOpen && (
        <div className={styles.findRow}>
          <span className={styles.replaceSpacer} />
          <div className={styles.findField}>
            <input ref={replaceRef} value={p.replacement} onChange={(e) => p.onReplacement(e.target.value)} onKeyDown={onReplaceKey} placeholder={t(S.replaceWith)} aria-label={t(S.replaceWith)} spellCheck={false} autoComplete="off" />
          </div>
          <button type="button" className={`ui-btn ${styles.barBtn}`} disabled={!p.total} onClick={p.onReplace}>
            {t(S.replace)}
          </button>
          <button type="button" className={`ui-btn ${styles.barBtn}`} disabled={!p.total} onClick={p.onReplaceAll}>
            {t(S.all)}
          </button>
        </div>
      )}
    </div>
  );
});

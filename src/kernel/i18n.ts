import { useCallback } from 'react';
import type { Locale, LString } from './types';
import { useSystem } from './system';

/**
 * Translates a localized string for a given locale.
 *
 * Plain strings are returned unchanged, `null`/`undefined` become an empty string, and a
 * localized object falls back to its English text when the requested locale is missing.
 *
 * @param {LString | undefined | null} s - The string to translate.
 * @param {Locale} locale - The locale to translate into.
 * @returns {string} The text for `locale`.
 *
 * @example
 * tr({ en: 'Save', ko: '저장' }, 'ko'); // '저장'
 */
export function tr(s: LString | undefined | null, locale: Locale): string {
  if (s == null) return '';
  if (typeof s === 'string') return s;
  return s[locale] ?? s.en;
}

/**
 * Translates a localized string using the current system locale.
 *
 * Reads the locale from the system store at call time without subscribing, so it does not
 * re-render anything when the language changes; use it outside React components and `useT()`
 * inside them.
 *
 * @param {LString | undefined | null} s - The string to translate.
 * @returns {string} The text for the current system locale.
 *
 * @example
 * const label = t(COMMON.moveToTrash);
 * console.log(label); // 'Move to Trash' when the system locale is English
 */
export function t(s: LString | undefined | null): string {
  return tr(s, useSystem.getState().settings.locale);
}

/**
 * Returns the current system locale and re-renders the component when it changes.
 *
 * Subscribes to `settings.locale` in the system store, so only locale changes (not other
 * settings) trigger a re-render.
 *
 * @returns {Locale} The active UI locale.
 *
 * @example
 * const locale = useLocale();
 * const when = formatDate(node.modifiedAt, locale);
 */
export function useLocale(): Locale {
  return useSystem((s) => s.settings.locale);
}

/**
 * Returns a translator bound to the current system locale.
 *
 * The component re-renders when the locale changes, and the returned function is memoized per
 * locale, so it is stable between renders and safe to use in dependency lists.
 *
 * @returns {(s: LString | undefined | null) => string} A function that translates into the
 *   current locale.
 *
 * @example
 * const S = { save: { en: 'Save', ko: '저장' } };
 * const t = useT();
 * return <button>{t(S.save)}</button>;
 */
export function useT(): (s: LString | undefined | null) => string {
  const locale = useLocale();
  return useCallback((s: LString | undefined | null) => tr(s, locale), [locale]);
}

/**
 * Fills `{name}` placeholders in a template.
 *
 * Each `{word}` placeholder is replaced with the matching value from `vars` converted to a
 * string; placeholders without a matching key are left as they are.
 *
 * @param {string} template - Text containing `{name}` placeholders.
 * @param {Record<string, string | number>} vars - Values keyed by placeholder name.
 * @returns {string} The interpolated text.
 *
 * @example
 * fmt('{count} items', { count: 3 }); // '3 items'
 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Formats a byte count as a human-readable size.
 *
 * Uses decimal units (1 KB = 1000 bytes) like macOS. Sizes under 1000 bytes are spelled out in
 * the given locale; larger sizes are scaled up to TB and shown with one decimal below 10 and
 * rounded to a whole number otherwise.
 *
 * @param {number} bytes - The size in bytes.
 * @param {Locale} [locale='en'] - Locale used for the "bytes" wording.
 * @returns {string} The formatted size.
 *
 * @example
 * formatBytes(512); // '512 bytes'
 * formatBytes(2_500_000); // '2.5 MB'
 */
export function formatBytes(bytes: number, locale: Locale = 'en'): string {
  if (bytes < 1000) return locale === 'ko' ? `${bytes}바이트` : `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Localizes the word "Present" in a period string.
 *
 * Replaces the first whole-word, case-insensitive "present" with its translation, so periods
 * written in English in the portfolio data read naturally in other locales.
 *
 * @param {string} period - A period such as "2024 — Present".
 * @param {Locale} locale - The target locale.
 * @returns {string} The period with "Present" translated.
 *
 * @example
 * localizePeriod('2024 — Present', 'ko'); // '2024 — 현재'
 */
export function localizePeriod(period: string, locale: Locale): string {
  return period.replace(/\bpresent\b/i, tr({ en: 'Present', ko: '현재' }, locale));
}

/**
 * Formats a timestamp as a localized date and time.
 *
 * Uses `Intl.DateTimeFormat` with the `ko-KR` or `en-US` locale; without options it shows a
 * medium date and a short time.
 *
 * @param {number} ts - Milliseconds since the epoch.
 * @param {Locale} locale - The display locale.
 * @param {Intl.DateTimeFormatOptions} [opts] - Formatting options; defaults to
 *   `{ dateStyle: 'medium', timeStyle: 'short' }`.
 * @returns {string} The formatted date.
 *
 * @example
 * formatDate(node.modifiedAt, 'en', { dateStyle: 'long' }); // e.g. 'October 3, 2026'
 */
export function formatDate(ts: number, locale: Locale, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', opts ?? { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
}

export const COMMON = {
  ok: { en: 'OK', ko: '확인' },
  cancel: { en: 'Cancel', ko: '취소' },
  save: { en: 'Save', ko: '저장' },
  saveAs: { en: 'Save As…', ko: '다른 이름으로 저장…' },
  dontSave: { en: "Don't Save", ko: '저장 안 함' },
  open: { en: 'Open', ko: '열기' },
  openWith: { en: 'Open With', ko: '다음으로 열기' },
  close: { en: 'Close', ko: '닫기' },
  closeWindow: { en: 'Close Window', ko: '윈도우 닫기' },
  quit: { en: 'Quit', ko: '종료' },
  hide: { en: 'Hide', ko: '가리기' },
  about: { en: 'About', ko: '정보' },
  file: { en: 'File', ko: '파일' },
  edit: { en: 'Edit', ko: '편집' },
  view: { en: 'View', ko: '보기' },
  go: { en: 'Go', ko: '이동' },
  window: { en: 'Window', ko: '윈도우' },
  help: { en: 'Help', ko: '도움말' },
  newWindow: { en: 'New Window', ko: '새로운 윈도우' },
  newFolder: { en: 'New Folder', ko: '새로운 폴더' },
  newFile: { en: 'New File', ko: '새로운 파일' },
  rename: { en: 'Rename', ko: '이름 변경' },
  delete: { en: 'Delete', ko: '삭제' },
  moveToTrash: { en: 'Move to Trash', ko: '휴지통으로 이동' },
  emptyTrash: { en: 'Empty Trash', ko: '휴지통 비우기' },
  getInfo: { en: 'Get Info', ko: '정보 가져오기' },
  undo: { en: 'Undo', ko: '실행 취소' },
  redo: { en: 'Redo', ko: '실행 복귀' },
  cut: { en: 'Cut', ko: '오려두기' },
  copy: { en: 'Copy', ko: '복사하기' },
  paste: { en: 'Paste', ko: '붙여넣기' },
  selectAll: { en: 'Select All', ko: '전체 선택' },
  minimize: { en: 'Minimize', ko: '최소화' },
  zoom: { en: 'Zoom', ko: '확대/축소' },
  untitled: { en: 'Untitled', ko: '제목 없음' },
  untitledFolder: { en: 'untitled folder', ko: '무제 폴더' },
  search: { en: 'Search', ko: '검색' },
  settings: { en: 'Settings…', ko: '설정…' },
} satisfies Record<string, LString>; /** Localized strings shared by many apps (dialog buttons, standard menu titles and items). */

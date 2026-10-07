import { Fragment, useMemo, useState } from 'react';
import { AppWindow, ChevronLeft, Folder, Monitor, Search, Type } from 'lucide-react';
import { formatShortcut, isMacHost, useT } from '@/kernel';
import { EmptyState, SearchField, Spacer, Toolbar } from '@/components/ui';
import { SHORTCUT_GROUPS, type ShortcutGroup } from './shortcuts';
import styles from './Welcome.module.css';

const S = {
  title: { en: 'Keyboard Shortcuts', ko: '키보드 단축키' },
  tips: { en: 'Tips', ko: '팁' },
  backToTips: { en: 'Back to Tips', ko: '팁으로 돌아가기' },
  search: { en: 'Search Shortcuts', ko: '단축키 검색' },
  or: { en: 'or', ko: '또는' },
  none: { en: 'No Shortcuts Found', ko: '단축키 없음' },
  footnote: {
    en: 'The browser reserves ⌘W, ⌘Q, ⌘N and ⌘T, so window commands use ⌥ (Option) instead.',
    ko: '브라우저가 ⌘W, ⌘Q, ⌘N, ⌘T를 사용하므로 윈도우 명령에는 대신 ⌥(Option) 키를 사용합니다.',
  },
  footnoteOther: {
    en: 'Ctrl is used where macOS uses ⌘; window commands use Alt because the browser reserves Ctrl+W, Ctrl+N and Ctrl+T.',
    ko: 'macOS의 ⌘ 대신 Ctrl을 사용하며, 브라우저가 Ctrl+W, Ctrl+N, Ctrl+T를 사용하므로 윈도우 명령에는 Alt를 사용합니다.',
  },
}; /** Localized strings for the Keyboard Shortcuts view; `footnote` is shown on Mac hosts and `footnoteOther` elsewhere. */

const GROUP_ICON: Record<ShortcutGroup['id'], typeof Monitor> = { system: Monitor, windows: AppWindow, finder: Folder, text: Type }; /** Heading icon for each shortcut group, keyed by group id. */
const MAC_MODIFIERS = '⌃⌥⇧⌘'; /** macOS modifier symbols that `formatShortcut` places before the key on Mac hosts. */

/**
 * Splits a shortcut into the individual key caps to draw.
 *
 * The shortcut is first formatted for the host with `formatShortcut`. On Mac hosts the
 * leading modifier symbols (`⌃⌥⇧⌘`) each become their own cap and the remainder becomes
 * the final cap. On other hosts the label is split on `+` and repeated names are
 * dropped, since `mod` and `ctrl` both name the Ctrl key there.
 *
 * @param {string} shortcut - Shortcut in MenuItem syntax, e.g. `'mod+shift+s'`.
 * @returns {string[]} Key cap labels in display order.
 *
 * @example
 * keyCaps('ctrl+mod+q'); // ['⌃', '⌘', 'Q'] on macOS, ['Ctrl', 'Q'] elsewhere
 * keyCaps('ctrl+alt+left'); // ['⌃', '⌥', '←'] on macOS, ['Ctrl', 'Alt', '←'] elsewhere
 */
export function keyCaps(shortcut: string): string[] {
  const label = formatShortcut(shortcut);
  if (!isMacHost) return [...new Set(label.split('+'))];
  let i = 0;
  while (i < label.length && MAC_MODIFIERS.includes(label[i])) i++;
  return [...label.slice(0, i), label.slice(i)];
}

/**
 * Renders a shortcut as a row of `<kbd>` key caps.
 *
 * The caps come from `keyCaps` and are hidden from assistive technology; the wrapper
 * is exposed as an image whose accessible name is the full formatted shortcut, so
 * screen readers announce it as one label instead of key by key.
 *
 * @param {Object} props - Component props.
 * @param {string} props.shortcut - Shortcut in MenuItem syntax, e.g. `'alt+w'`.
 * @returns {JSX.Element} The key cap group.
 *
 * @example
 * <KeyCaps shortcut={SYSTEM_SHORTCUTS.spotlight} />
 */
export function KeyCaps({ shortcut }: { shortcut: string }) {
  return (
    <span className={styles.keys} role="img" aria-label={formatShortcut(shortcut)}>
      {keyCaps(shortcut).map((k, i) => (
        <kbd key={i} className={styles.kbd} aria-hidden="true">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Searchable Keyboard Shortcuts reference page of the Tips app.
 *
 * Shows a toolbar with a back button, the title and a search field, followed by a grid
 * of glass cards, one per entry in `SHORTCUT_GROUPS`, each listing its rows with key
 * caps. Multiple keys in a row are separated by a localized "or" or by "/" when the row
 * sets `join: 'slash'`. The search query (trimmed, case-insensitive) matches a row's
 * label, its group title or any of its formatted shortcuts; groups left without rows
 * are hidden, and an empty state is shown when nothing matches. Pressing Escape in a
 * non-empty search field clears it. A footnote explains the host-specific modifier
 * choices.
 *
 * @param {Object} props - Component props.
 * @param {() => void} props.onBack - Called when the "Tips" back button is clicked.
 * @returns {JSX.Element} The shortcuts view.
 *
 * @example
 * if (mode === 'shortcuts') return <ShortcutsView onBack={() => setMode('tips')} />;
 */
export function ShortcutsView({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_GROUPS;
    return SHORTCUT_GROUPS.map((g) => ({
      ...g,
      rows: g.rows.filter((r) => [t(r.label), t(g.title), ...r.keys.map(formatShortcut)].some((s) => s.toLowerCase().includes(q))),
    })).filter((g) => g.rows.length);
  }, [query, t]);

  return (
    <div className={styles.shortcuts}>
      <Toolbar>
        <button type="button" className={`lg lg-control lg-capsule lg-interactive ${styles.backButton}`} onClick={onBack} title={t(S.backToTips)}>
          <ChevronLeft size={16} />
          {t(S.tips)}
        </button>
        <div className={`ui-toolbar-title ${styles.scTitle}`}>{t(S.title)}</div>
        <Spacer />
        <div className={styles.scSearch}>
          <SearchField value={query} onChange={setQuery} placeholder={t(S.search)} onKeyDown={(e) => e.key === 'Escape' && query && (e.preventDefault(), setQuery(''))} />
        </div>
      </Toolbar>

      <div className={styles.scScroll}>
        {groups.length ? (
          <div className={styles.scGrid}>
            {groups.map((g, gi) => {
              const Icon = GROUP_ICON[g.id];
              return (
                <section key={g.id} className={`lg lg-thick ${styles.scGroup}`} style={{ animationDelay: `${gi * 50}ms` }}>
                  <h2 className={styles.scHeading}>
                    <span className={styles.scIcon}>
                      <Icon size={13} />
                    </span>
                    {t(g.title)}
                  </h2>
                  <table className={styles.scTable}>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={t(r.label)}>
                          <th scope="row">{t(r.label)}</th>
                          <td>
                            <span className={styles.keyAlts}>
                              {r.keys.map((k, i) => (
                                <Fragment key={k}>
                                  {i > 0 && <span className={styles.or}>{r.join === 'slash' ? '/' : t(S.or)}</span>}
                                  <KeyCaps shortcut={k} />
                                </Fragment>
                              ))}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<Search size={28} strokeWidth={1.5} />} title={t(S.none)} />
        )}
        <p className={styles.footnote}>{t(isMacHost ? S.footnote : S.footnoteOther)}</p>
      </div>
    </div>
  );
}

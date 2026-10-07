/**
 * The `webos://history` page: searchable browsing history grouped by day, plus the
 * shared "Clear History" confirmation used by the Safari menu.
 */
import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { Button, SearchField } from '@/components/ui';
import { dialogs, formatDate, showContextMenu, useLocale, useT } from '@/kernel';
import { useSafari, type HistoryEntry } from '../store';
import { S } from '../strings';
import { displayHost, kindOfURL } from '../url';
import { SiteIcon } from '../SiteIcon';
import { linkMenu, type PageAPI } from './api';
import styles from './Pages.module.css';

const P = {
  today: { en: 'Today', ko: '오늘' },
  yesterday: { en: 'Yesterday', ko: '어제' },
  empty: { en: 'No History', ko: '방문 기록 없음' },
  noResults: { en: 'No Results', ko: '결과 없음' },
  removeVisit: { en: 'Remove from History', ko: '방문 기록에서 제거' },
  search: { en: 'Search History', ko: '방문 기록 검색' },
}; /** Localized strings for the history page. */

/**
 * Returns a key identifying the local calendar day of a timestamp.
 *
 * Uses `Date#toDateString`, so two timestamps share a key exactly when they fall on
 * the same day in the local time zone.
 *
 * @param {number} ts - Epoch milliseconds.
 * @returns {string} The day key, e.g. `"Sat Oct 03 2026"`.
 *
 * @example
 * dayKey(Date.now()) === dayKey(Date.now() - 1000); // true unless midnight just passed
 */
const dayKey = (ts: number) => new Date(ts).toDateString();

/**
 * Asks for confirmation, then clears all Safari browsing history.
 *
 * Shows a destructive confirm dialog as a sheet on the given window. Only when the
 * user confirms does it call the store's `clearHistory`, which empties the persisted
 * history shared by every Safari window.
 *
 * @async
 * @param {string} windowId - Window the confirmation sheet attaches to.
 * @returns {Promise<void>} Resolves once the dialog is dismissed and, if confirmed, the history is cleared.
 *
 * @example
 * void confirmClearHistory(api.windowId);
 */
export async function confirmClearHistory(windowId: string): Promise<void> {
  const ok = await dialogs.confirm({ windowId, appId: 'safari', title: S.clearHistoryTitle, message: S.clearHistoryMsg, okLabel: S.clear, danger: true });
  if (ok) useSafari.getState().clearHistory();
}

/**
 * The `webos://history` page: browsing history grouped by day, with search.
 *
 * Filters history by a case-insensitive match on title or URL, then groups the
 * newest-first entries into consecutive runs of the same local day, labeled "Today",
 * "Yesterday" or a long weekday/month/day date. Each row shows the visit time, a
 * letter icon, the title and the host (or the full URL for non-web URLs). Clicking a
 * row navigates the tab; its context menu is the standard link menu plus "Remove from
 * History". The header button clears all history after confirmation, and the empty
 * state says "No Results" during a search or "No History" otherwise.
 *
 * @param {Object} props - Component props.
 * @param {PageAPI} props.api - Tab API used for navigation, link menus and the window id.
 * @returns {JSX.Element} The scrollable history page.
 *
 * @example
 * <HistoryPage api={api} />
 */
export function HistoryPage({ api }: { api: PageAPI }) {
  const t = useT();
  const locale = useLocale();
  const history = useSafari((s) => s.history);
  const removeVisit = useSafari((s) => s.removeVisit);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? history.filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)) : history;
    const out: { key: string; label: string; items: HistoryEntry[] }[] = [];
    const today = dayKey(Date.now());
    const yesterday = dayKey(Date.now() - 86_400_000);
    for (const h of list) {
      const key = dayKey(h.ts);
      let group = out[out.length - 1];
      if (!group || group.key !== key) {
        const label = key === today ? t(P.today) : key === yesterday ? t(P.yesterday) : formatDate(h.ts, locale, { weekday: 'long', month: 'long', day: 'numeric' });
        group = { key, label, items: [] };
        out.push(group);
      }
      group.items.push(h);
    }
    return out;
  }, [history, query, t, locale]);

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <header className={styles.pageHeader}>
          <h1>{t(S.history)}</h1>
          <SearchField value={query} onChange={setQuery} placeholder={t(P.search)} style={{ width: 220 }} />
          <Button disabled={!history.length} onClick={() => void confirmClearHistory(api.windowId)}>
            {t(S.clearHistory)}
          </Button>
        </header>
        {groups.length === 0 ? (
          <div className="ui-empty" style={{ height: 240 }}>
            <Clock size={32} strokeWidth={1.4} />
            <div>{t(query ? P.noResults : P.empty)}</div>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className={styles.historyGroup}>
              <h2 className={styles.historyDay}>{g.label}</h2>
              {g.items.map((h) => {
                return (
                  <button
                    key={`${h.ts}-${h.url}`}
                    type="button"
                    className={styles.historyRow}
                    onClick={() => api.navigate(h.url)}
                    onContextMenu={(e) => showContextMenu(e, linkMenu(api, h.url, [{ label: P.removeVisit, action: () => removeVisit(h.ts) }]))}
                  >
                    <span className={styles.historyTime}>{formatDate(h.ts, locale, { hour: 'numeric', minute: '2-digit' })}</span>
                    <SiteIcon url={h.url} size={18} />
                    <span className={styles.historyTitle}>{h.title}</span>
                    <span className={styles.historyUrl}>{kindOfURL(h.url) === 'web' ? displayHost(h.url) : h.url}</span>
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

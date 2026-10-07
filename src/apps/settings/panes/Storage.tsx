/**
 * Storage: a live breakdown of the virtual file system (by category) plus the real browser
 * storage quota from navigator.storage.
 */
import { useMemo, useState } from 'react';
import { AppWindow, FileText, Folder, Image, Settings as Gear, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui';
import { osInfo } from '@/data/portfolio';
import { emptyTrashWithConfirm, fileSizeOf, fmt, formatBytes, isWithin, PATHS, useFS, useSystem, useT, useTrashCount, wm } from '@/kernel';
import { Legend, NavRow, Pane, Row, Section, UsageBar } from '../kit';
import { useNav } from '../nav';
import { useBrowserStorage, useFSStorage } from '../hooks';
import { STORAGE_CATEGORIES, STORAGE_COLORS, STORAGE_NAMES, type StorageCategory } from '../storageStats';
import s from './panes.module.css';

const S = {
  disk: { en: '{os} HD', ko: '{os} HD' },
  files: { en: '{n} files', ko: '파일 {n}개' },
  used: { en: '{size} used', ko: '{size} 사용됨' },
  recommendations: { en: 'Recommendations', ko: '추천 사항' },
  emptyTrash: { en: 'Empty Trash', ko: '휴지통 비우기' },
  emptyTrashButton: { en: 'Empty Trash…', ko: '휴지통 비우기…' },
  trashItems: { en: '{n} items in the Trash use {size}.', ko: '휴지통 항목 {n}개 · {size}' },
  trashEmpty: { en: 'The Trash is empty.', ko: '휴지통이 비어 있습니다.' },
  categories: { en: 'Categories', ko: '범주' },
  browserStorage: { en: 'Browser Storage', ko: '브라우저 저장 공간' },
  browserFooter: {
    en: '{os} keeps its file system in this browser’s IndexedDB. Clearing this website’s data erases it.',
    ko: '{os}은(는) 파일 시스템을 이 브라우저의 IndexedDB에 저장합니다. 이 웹 사이트의 데이터를 지우면 함께 지워집니다.',
  },
  siteUsage: { en: 'Used by this website', ko: '이 웹 사이트가 사용 중' },
  ofQuota: { en: '{usage} of {quota} available to this website', ko: '이 웹 사이트에 허용된 {quota} 중 {usage}' },
  persistent: { en: 'Persistent storage', ko: '영구 저장 공간' },
  persistentOn: { en: 'The browser won’t clear this data automatically.', ko: '브라우저가 이 데이터를 자동으로 지우지 않습니다.' },
  persistentOff: { en: 'The browser may clear this data when space runs low.', ko: '공간이 부족하면 브라우저가 이 데이터를 지울 수 있습니다.' },
  on: { en: 'On', ko: '켬' },
  makePersistent: { en: 'Keep Data…', ko: '데이터 유지…' },
  unavailable: { en: 'Storage information isn’t available in this browser.', ko: '이 브라우저에서는 저장 공간 정보를 사용할 수 없습니다.' },
  calculating: { en: 'Calculating…', ko: '계산 중…' },
}; /** Localized strings for the Storage pane. */

const CATEGORY_ICON: Record<StorageCategory, LucideIcon> = { apps: AppWindow, documents: FileText, images: Image, system: Gear, other: Folder }; /** Icon of each storage category in the Categories list. */
const CATEGORY_HEX: Record<StorageCategory, string> = { apps: '#ff453a', documents: '#ff9f0a', images: '#ffcc00', system: '#8e8e93', other: '#bf5af2' }; /** Icon tile color of each storage category in the Categories list. */
const CATEGORY_PATH: Record<StorageCategory, string> = { apps: PATHS.applications, documents: PATHS.documents, images: PATHS.pictures, system: '/System', other: PATHS.home }; /** Folder opened in Finder when a storage category row is clicked. */

/**
 * Renders the Storage settings pane.
 *
 * Shows the virtual disk's used size and file count with a stacked usage bar and legend by
 * category, a recommendation to empty the Trash (with its item count and the summed size of the
 * files inside it), one row per category that opens its folder in Finder, and the real browser
 * storage estimate: this site's usage against its quota and, when the browser reports it, whether
 * storage is persistent, with a button to request persistence. When `navigator.storage.estimate`
 * is unavailable the browser section shows a notice instead.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <StoragePane />
 */
export function StoragePane() {
  const t = useT();
  const { windowId } = useNav();
  const locale = useSystem((st) => st.settings.locale);
  const stats = useFSStorage();
  const trashCount = useTrashCount();
  const nodes = useFS((st) => st.nodes);
  const trashBytes = useMemo(() => {
    let sum = 0;
    for (const p in nodes) if (p !== PATHS.trash && isWithin(p, PATHS.trash) && nodes[p].type === 'file') sum += fileSizeOf(nodes[p]);
    return sum;
  }, [nodes]);
  const { data: browser, refresh } = useBrowserStorage();
  const [persistBusy, setPersistBusy] = useState(false);

  /**
   * Formats a byte count for display.
   *
   * Delegates to `formatBytes` with the current system locale.
   *
   * @param {number} n - Number of bytes.
   * @returns {string} A human-readable size such as "1.2 MB".
   *
   * @example
   * bytes(stats.total);
   */
  const bytes = (n: number) => formatBytes(n, locale);
  const supportsEstimate = typeof navigator !== 'undefined' && !!navigator.storage?.estimate;

  /**
   * Asks the browser to make this site's storage persistent.
   *
   * Does nothing when `navigator.storage.persist` is unavailable. Otherwise disables the button
   * while the request is pending, ignores a rejected request (the browser makes the final call)
   * and then refreshes the storage estimate so the row shows the resulting state.
   *
   * @async
   * @returns {Promise<void>} Resolves after the request has settled and a refresh was triggered.
   *
   * @example
   * <Button onClick={() => void requestPersist()}>Keep Data…</Button>
   */
  const requestPersist = async () => {
    if (!navigator.storage?.persist) return;
    setPersistBusy(true);
    try {
      await navigator.storage.persist();
    } catch {
      /* The browser decides; nothing else to do. */
    }
    setPersistBusy(false);
    refresh();
  };

  return (
    <Pane>
      <Section>
        <Row label={<strong>{fmt(t(S.disk), { os: osInfo.name })}</strong>} sublabel={fmt(t(S.files), { n: stats.files.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US') })}>
          {fmt(t(S.used), { size: bytes(stats.total) })}
        </Row>
        <Row
          stacked
          label={
            <div className={s.storageBar}>
              <UsageBar
                height={20}
                total={stats.total}
                label={fmt(t(S.used), { size: bytes(stats.total) })}
                segments={STORAGE_CATEGORIES.map((c) => ({ key: c, value: stats.byCategory[c], color: STORAGE_COLORS[c], title: `${t(STORAGE_NAMES[c])} — ${bytes(stats.byCategory[c])}` }))}
              />
              <Legend items={STORAGE_CATEGORIES.map((c) => ({ key: c, color: STORAGE_COLORS[c], label: t(STORAGE_NAMES[c]) }))} />
            </div>
          }
        />
      </Section>

      <Section title={t(S.recommendations)}>
        <Row label={t(S.emptyTrash)} sublabel={trashCount ? fmt(t(S.trashItems), { n: trashCount, size: bytes(trashBytes) }) : t(S.trashEmpty)}>
          <Button disabled={!trashCount} onClick={() => void emptyTrashWithConfirm(windowId)}>
            {t(S.emptyTrashButton)}
          </Button>
        </Row>
      </Section>

      <Section title={t(S.categories)}>
        {STORAGE_CATEGORIES.map((c) => (
          <NavRow
            key={c}
            icon={CATEGORY_ICON[c]}
            color={CATEGORY_HEX[c]}
            label={t(STORAGE_NAMES[c])}
            detail={bytes(stats.byCategory[c])}
            onClick={() => wm.openWindow('finder', { path: CATEGORY_PATH[c] })}
          />
        ))}
      </Section>

      <Section title={t(S.browserStorage)} footer={fmt(t(S.browserFooter), { os: osInfo.name })}>
        {!supportsEstimate ? (
          <Row label={<span className={s.muted}>{t(S.unavailable)}</span>} />
        ) : (
          <>
            <Row
              stacked
              label={t(S.siteUsage)}
              sublabel={browser ? fmt(t(S.ofQuota), { usage: bytes(browser.usage), quota: bytes(browser.quota) }) : t(S.calculating)}
            >
              <UsageBar height={8} label={t(S.siteUsage)} total={browser?.quota || 1} segments={[{ key: 'usage', value: browser?.usage ?? 0, color: 'var(--accent)' }]} />
            </Row>
            {browser && browser.persisted !== null && (
              <Row label={t(S.persistent)} sublabel={t(browser.persisted ? S.persistentOn : S.persistentOff)}>
                {browser.persisted ? (
                  t(S.on)
                ) : (
                  <Button disabled={persistBusy} onClick={() => void requestPersist()}>
                    {t(S.makePersistent)}
                  </Button>
                )}
              </Row>
            )}
          </>
        )}
      </Section>
    </Pane>
  );
}

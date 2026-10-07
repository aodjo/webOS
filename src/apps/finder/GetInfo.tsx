import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppProps, FSNode } from '@/kernel';
import {
  HOME,
  PATHS,
  appsThatOpen,
  defaultAppFor,
  dirname,
  fileSizeOf,
  fmt,
  formatBytes,
  fs,
  getApp,
  isWithin,
  tildify,
  useAppMenus,
  useFS,
  useLocale,
  useSystem,
  useT,
  useWindow,
  wm,
} from '@/kernel';
import { Select, TextField } from '@/components/ui';
import { FileIcon } from '@/icons';
import { osInfo } from '@/data/portfolio';
import { DISK, diskUsage, displayName, findMovedPath, formatFinderDate, isAppFile, itemCount, kindLabel, onDiskSize } from './model';
import { S, TAG_COLORS } from './strings';
import { ops } from './ops';
import { FilePreview } from './Preview';
import s from './GetInfo.module.css';

/** Identifier of a collapsible section of the Get Info window. */
type SectionId = 'general' | 'name' | 'openWith' | 'preview' | 'sharing';

/**
 * Computes the recursive size and item count of a folder.
 *
 * Scans every node below `dir` in the flat FS map, counting all descendants and summing the
 * logical size and the rounded on-disk size of the files. The result is packed into a string
 * so memoized callers compare a primitive and only re-render when the numbers change.
 *
 * @param {Record<string, FSNode>} nodes - Flat path-to-node map of the file system.
 * @param {string} dir - Absolute path of the folder ('/' for the whole disk).
 * @returns {string} `"<bytes>|<on-disk bytes>|<item count>"`.
 *
 * @example
 * const stats = folderStats(useFS.getState().nodes, PATHS.documents);
 * console.log(stats); // e.g. '1234|8192|3'
 */
function folderStats(nodes: Record<string, FSNode>, dir: string): string {
  const prefix = dir === '/' ? '/' : dir + '/';
  let bytes = 0;
  let disk = 0;
  let count = 0;
  for (const p in nodes) {
    if (p === dir || !p.startsWith(prefix)) continue;
    count++;
    if (nodes[p].type === 'file') {
      const b = fileSizeOf(nodes[p]);
      bytes += b;
      disk += onDiskSize(b);
    }
  }
  return `${bytes}|${disk}|${count}`;
}

/**
 * Finder "Get Info" window for a single item.
 *
 * Opened by `openGetInfo` with the item's path in the window args. Shows a header (icon, name,
 * size, modification date) and collapsible General, Name & Extension, Open with, Preview and
 * Sharing sections that update live. The args are read from the window store via `useWindow()`
 * so following a rename or move re-renders immediately. When the node disappears, an effect
 * compares the previous and current FS snapshots with `findMovedPath`: if the item was renamed,
 * moved or trashed the window is re-targeted to its new path, otherwise the window is
 * force-closed. The window title follows the item's display name, folders show their recursive
 * size and item count, and the startup disk ('/') shows capacity, available and used space.
 * The General section also holds the color tag buttons and the Locked checkbox, which can only
 * be toggled for items inside the home folder and outside the Trash that are either unprotected
 * or locked by the user.
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - Id of this Get Info window (title, menus and args updates).
 * @returns {JSX.Element} The Get Info content, or an empty container while the item is missing.
 *
 * @example
 * openGetInfo(`${PATHS.documents}/notes.txt`);
 * // renders <GetInfo windowId={id} pid={pid} args={{ view: 'info', path }} />
 */
export function GetInfo({ windowId }: AppProps) {
  const t = useT();
  const locale = useLocale();
  const h24 = useSystem((st) => st.settings.clock24h);
  const { args } = useWindow();
  const path = typeof args.path === 'string' ? args.path : '/';
  const nodes = useFS((st) => st.nodes);
  const node = nodes[path] as FSNode | undefined;
  const prevNodes = useRef(nodes);
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ general: true, name: true, openWith: true, preview: true, sharing: false });

  useEffect(() => {
    const before = prevNodes.current;
    prevNodes.current = nodes;
    if (node) return;
    const last = before[path];
    const moved = last ? findMovedPath(last, before, nodes) : null;
    if (moved) wm.setArgs(windowId, { ...args, path: moved });
    else void wm.close(windowId, { force: true });
  }, [nodes, node, path, windowId, args]);

  const name = node ? displayName(node, locale) : '';
  useEffect(() => {
    if (name) wm.setTitle(windowId, fmt(t(S.infoTitle), { name }));
  }, [name, t, windowId]);

  useAppMenus(
    () => [
      {
        label: S.file,
        items: [
          { label: S.newFinderWindow, shortcut: 'alt+n', action: () => wm.openWindow('finder', { path: HOME }) },
          { label: S.closeWindow, shortcut: 'alt+w', action: () => void wm.close(windowId) },
        ],
      },
    ],
    [windowId],
  );

  const stats = useMemo(() => (node?.type === 'dir' ? folderStats(nodes, path) : ''), [node?.type, nodes, path]);
  const disk = useMemo(() => {
    if (path !== '/') return null;
    const { available } = diskUsage(nodes);
    return { capacity: DISK.capacity, available, used: DISK.capacity - available };
  }, [nodes, path]);

  if (!node) return <div className={s.root} />;

  const isDir = node.type === 'dir';
  const isApp = isAppFile(node);
  const app = isApp ? getApp((node.content ?? '').trim()) : undefined;
  const isProtected = fs.isProtected(path);
  const userLocked = !!node.meta?.locked && isWithin(path, HOME + '/');
  const canToggleLock = isWithin(path, HOME + '/') && (!isProtected || userLocked) && !isWithin(path, PATHS.trash);
  const bytes = isDir ? Number(stats.split('|')[0]) : fileSizeOf(node);
  const onDisk = isDir ? Number(stats.split('|')[1]) : onDiskSize(bytes);
  const count = isDir ? Number(stats.split('|')[2]) : 0;
  /**
   * Formats a timestamp the way Finder shows dates.
   *
   * Uses the current locale and the system 12/24-hour clock setting.
   *
   * @param {number} ts - Timestamp in milliseconds since the epoch.
   * @returns {string} The formatted date and time.
   *
   * @example
   * date(node.modifiedAt); // e.g. 'Today at 9:41 AM'
   */
  const date = (ts: number) => formatFinderDate(ts, locale, { h24 });

  const sizeText = (() => {
    const exact = bytes.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US');
    const diskText = formatBytes(onDisk, locale);
    if (locale === 'ko') return isDir ? `${itemCount(count, locale)}에 대해 디스크 상의 ${diskText}(${exact}바이트)` : `디스크 상의 ${diskText}(${exact}바이트)`;
    return isDir ? `${exact} bytes (${diskText} on disk) for ${itemCount(count, locale)}` : `${exact} bytes (${diskText} on disk)`;
  })();

  const handlers = !isDir && !isApp ? appsThatOpen(node.name) : [];
  const defaultApp = !isDir && !isApp ? defaultAppFor(node.name) : undefined;
  const currentApp = node.meta?.openWith && getApp(node.meta.openWith) ? node.meta.openWith : defaultApp;

  /**
   * Expands or collapses a section.
   *
   * Flips the section's flag in the local open-state map.
   *
   * @param {SectionId} id - Section to toggle.
   * @returns {void} Nothing.
   *
   * @example
   * toggle('sharing');
   */
  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div className={s.root}>
      <header className={s.header}>
        <FileIcon node={node} size={48} />
        <div className={s.headText}>
          <div className={s.headRow}>
            <span className={s.headName} title={name}>
              {name}
            </span>
            <span className={s.headSize}>{path === '/' && disk ? formatBytes(disk.capacity, locale) : formatBytes(bytes, locale)}</span>
          </div>
          <div className={s.headModified}>{fmt(t(S.modifiedInline), { date: date(node.modifiedAt) })}</div>
        </div>
      </header>

      <Section id="general" title={t(S.general)} open={open.general} onToggle={toggle}>
        <dl className={s.grid}>
          <Row label={t(S.kindLabel)}>{kindLabel(node, locale)}</Row>
          {path === '/' && disk ? (
            <>
              <Row label={t(S.capacityLabel)}>{formatBytes(disk.capacity, locale)}</Row>
              <Row label={t(S.availableLabel)}>{formatBytes(disk.available, locale)}</Row>
              <Row label={t(S.usedLabel)}>{formatBytes(disk.used, locale)}</Row>
            </>
          ) : (
            <Row label={t(S.sizeLabel)}>{sizeText}</Row>
          )}
          {path !== '/' && <Row label={t(S.whereLabel)}>{tildify(dirname(path))}</Row>}
          <Row label={t(S.createdLabel)}>{date(node.createdAt)}</Row>
          <Row label={t(S.modifiedLabel)}>{date(node.modifiedAt)}</Row>
          {isApp && <Row label={t(S.versionLabel)}>{app?.version ?? osInfo.version}</Row>}
          <Row label={t(S.tagsLabel)}>
            <span className={s.tags} role="group" aria-label={t(S.tagsLabel)}>
              {TAG_COLORS.map((c) => {
                const on = node.meta?.tag === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${s.tag} ${on ? s.tagOn : ''}`}
                    style={{ background: c.color }}
                    aria-label={t(c.name)}
                    aria-pressed={on}
                    title={t(c.name)}
                    onClick={() => ops.setTag([path], on ? undefined : c.id)}
                  />
                );
              })}
            </span>
          </Row>
        </dl>
        <label className={s.check}>
          <input type="checkbox" checked={isProtected} disabled={!canToggleLock} onChange={(e) => fs.setMeta(path, { locked: e.target.checked })} />
          {t(S.locked)}
        </label>
      </Section>

      <Section id="name" title={t(S.nameExt)} open={open.name} onToggle={toggle}>
        <NameField key={node.path} node={node} disabled={isProtected} windowId={windowId} onRenamed={(p) => wm.setArgs(windowId, { ...args, path: p })} />
      </Section>

      {handlers.length > 0 && (
        <Section id="openWith" title={t(S.openWithSection)} open={open.openWith} onToggle={toggle}>
          <Select
            value={currentApp ?? handlers[0].id}
            style={{ width: '100%' }}
            options={handlers.map((a) => ({ value: a.id, label: a.id === defaultApp ? `${t(a.name)} ${t(S.defaultSuffix)}` : t(a.name) }))}
            onChange={(v) => fs.setMeta(path, { openWith: v === defaultApp ? undefined : v })}
          />
          <p className={s.hint}>{t(S.openWithHint)}</p>
        </Section>
      )}

      <Section id="preview" title={t(S.previewSection)} open={open.preview} onToggle={toggle}>
        <div className={s.preview}>
          <FilePreview node={node} variant="thumb" iconSize={96} />
        </div>
      </Section>

      <Section id="sharing" title={t(S.sharing)} open={open.sharing} onToggle={toggle}>
        <p className={s.hint}>{t(isProtected ? S.readOnly : S.readWrite)}</p>
      </Section>
    </div>
  );
}

/**
 * Collapsible section of the Get Info window.
 *
 * Renders a header button with a disclosure triangle that rotates when open; the body is only
 * mounted while the section is expanded.
 *
 * @param {Object} props - Component props.
 * @param {SectionId} props.id - Section identifier passed back to `onToggle`.
 * @param {string} props.title - Localized header text.
 * @param {boolean} props.open - Whether the body is shown.
 * @param {(id: SectionId) => void} props.onToggle - Called with `id` when the header is clicked.
 * @param {ReactNode} props.children - Section content.
 * @returns {JSX.Element} The section element.
 *
 * @example
 * <Section id="general" title={t(S.general)} open={open.general} onToggle={toggle}>…</Section>
 */
function Section({ id, title, open, onToggle, children }: { id: SectionId; title: string; open: boolean; onToggle: (id: SectionId) => void; children: ReactNode }) {
  return (
    <section className={s.section}>
      <button type="button" className={s.sectionHead} aria-expanded={open} onClick={() => onToggle(id)}>
        <span className={`${s.triangle} ${open ? s.triangleOpen : ''}`} aria-hidden="true" />
        {title}
      </button>
      {open && <div className={s.sectionBody}>{children}</div>}
    </section>
  );
}

/**
 * Label / value pair of the General section's description list.
 *
 * Renders a `<dt>` and a selectable `<dd>` as siblings so they fill the two grid columns.
 *
 * @param {Object} props - Component props.
 * @param {string} props.label - Localized label shown in the left column.
 * @param {ReactNode} props.children - Value shown in the right column.
 * @returns {JSX.Element} A fragment with the term and its description.
 *
 * @example
 * <Row label={t(S.kindLabel)}>{kindLabel(node, locale)}</Row>
 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="selectable">{children}</dd>
    </>
  );
}

/**
 * Editable name field of the Name & Extension section.
 *
 * Keeps a local draft of the name and strips slashes while typing. When the node is renamed
 * elsewhere, the draft is reset during render (by comparing against the last seen name)
 * rather than in an effect. Enter or blur commits the draft through `ops.rename`, which reports
 * errors and records an undo step; Escape reverts it. IME composition keys are ignored.
 *
 * @param {Object} props - Component props.
 * @param {FSNode} props.node - Item being renamed.
 * @param {boolean} props.disabled - Disables editing for protected items.
 * @param {string} props.windowId - Window used to attach error sheets.
 * @param {(path: string) => void} props.onRenamed - Called with the new path after a successful
 *   rename.
 * @returns {JSX.Element} The text field.
 *
 * @example
 * <NameField key={node.path} node={node} disabled={false} windowId={id}
 *   onRenamed={(p) => wm.setArgs(id, { ...args, path: p })} />
 */
function NameField({ node, disabled, windowId, onRenamed }: { node: FSNode; disabled: boolean; windowId: string; onRenamed: (path: string) => void }) {
  const t = useT();
  const [value, setValue] = useState(node.name);
  const [prevName, setPrevName] = useState(node.name);
  if (prevName !== node.name) {
    setPrevName(node.name);
    setValue(node.name);
  }
  /**
   * Applies the edited name.
   *
   * Restores the current name when the draft is blank or unchanged. Otherwise renames through
   * `ops.rename`; on success reports the new path via `onRenamed`, on failure restores the name.
   *
   * @returns {void} Nothing.
   *
   * @example
   * <TextField value={value} onBlur={commit} />
   */
  const commit = () => {
    if (value.trim() === node.name || !value.trim()) {
      setValue(node.name);
      return;
    }
    const next = ops.rename(node.path, value, windowId);
    if (next) onRenamed(next);
    else setValue(node.name);
  };
  return (
    <TextField
      value={value}
      disabled={disabled}
      style={{ width: '100%' }}
      aria-label={t(S.nameExt).replace(/:$/, '')}
      onChange={(e) => setValue(e.target.value.replace(/\//g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setValue(node.name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

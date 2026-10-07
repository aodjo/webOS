/** Notes sidebar: account section with All Notes, folders, Recently Deleted and a New Folder button. */
import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { Folder, FolderPlus, Trash } from 'lucide-react';
import { hasDragPaths, useT } from '@/kernel';
import { osInfo } from '@/data/portfolio';
import styles from './Notes.module.css';

const S = {
  allNotes: { en: 'All Notes', ko: '모든 메모' },
  recentlyDeleted: { en: 'Recently Deleted', ko: '최근 삭제된 항목' },
  newFolder: { en: 'New Folder', ko: '새로운 폴더' },
  folders: { en: 'Folders', ko: '폴더' },
}; /** Localized strings of the sidebar. */

/** A notes folder as listed in the sidebar. */
export interface FolderInfo {
  /** Absolute path of the folder. */
  path: string;
  /** Display name. */
  name: string;
  /** Nesting level used for indentation (0 for top-level folders). */
  depth: number;
  /** Number of notes in the folder. */
  count: number;
  /** The default folder: can't be renamed or deleted. */
  fixed?: boolean;
}

interface Props {
  scope: string;
  allCount: number;
  trashCount: number;
  folders: FolderInfo[];
  onScope: (scope: string) => void;
  onFolderMenu: (e: MouseEvent, path: string) => void;
  onNewFolder: () => void;
  /** Drop dragged notes on a scope ('all', 'trash' or a folder path). */
  onDropPaths: (e: DragEvent, scope: string) => void;
}

/**
 * The Notes sidebar.
 *
 * Renders a tree headed by the OS name with "All Notes", one item per folder (indented by depth)
 * and "Recently Deleted" (shown only while it has notes or is the current scope), followed by a
 * New Folder button. Each item shows its note count, selects its scope on click and accepts
 * dragged notes: while a drag carrying file paths hovers an item it is outlined, and dropping
 * calls `onDropPaths` with that item's scope. Folders that are not `fixed` open a context menu on
 * right-click.
 *
 * @param {Props} props - Component props.
 * @param {string} props.scope - Current scope: 'all', 'trash', a folder path, or '' for none.
 * @param {number} props.allCount - Number of notes shown next to "All Notes".
 * @param {number} props.trashCount - Number of notes in Recently Deleted.
 * @param {FolderInfo[]} props.folders - Folders in display order.
 * @param {(scope: string) => void} props.onScope - Selects a scope.
 * @param {(e: MouseEvent, path: string) => void} props.onFolderMenu - Opens a folder's context menu.
 * @param {() => void} props.onNewFolder - Creates a new folder.
 * @param {(e: DragEvent, scope: string) => void} props.onDropPaths - Handles notes dropped on a scope.
 * @returns {JSX.Element} The sidebar's scrolling tree and footer.
 *
 * @example
 * <Sidebar scope="all" allCount={12} trashCount={0} folders={folders} onScope={setScope}
 *   onFolderMenu={openFolderMenu} onNewFolder={createFolder} onDropPaths={moveNotes} />
 */
export function Sidebar({ scope, allCount, trashCount, folders, onScope, onFolderMenu, onNewFolder, onDropPaths }: Props) {
  const t = useT();
  const [over, setOver] = useState<string | null>(null);

  /**
   * Builds the drag-and-drop handlers that make a sidebar item a drop target.
   *
   * Only drags that carry file paths are accepted; the hovered target is remembered so it can be
   * outlined, and the highlight is cleared when the pointer leaves the item or the drop happens.
   *
   * @param {string} target - Scope of the item: 'all', 'trash' or a folder path.
   * @returns {{ onDragOver: (e: DragEvent) => void; onDragLeave: (e: DragEvent) => void; onDrop: (e: DragEvent) => void }}
   *   Event handlers to spread onto the item.
   *
   * @example
   * <button {...dropProps('trash')} />
   */
  const dropProps = (target: string) => ({
    /**
     * Accepts a path drag over the item as a move and marks the item as hovered.
     *
     * @param {DragEvent} e - Dragover event.
     * @returns {void}
     *
     * @example
     * <button onDragOver={dropProps(path).onDragOver} />
     */
    onDragOver: (e: DragEvent) => {
      if (!hasDragPaths(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== target) setOver(target);
    },
    /**
     * Clears the hover outline when the pointer leaves the item.
     *
     * Moving between the item's own children also fires dragleave, so the outline is cleared
     * only when the element being entered lies outside the item.
     *
     * @param {DragEvent} e - Dragleave event.
     * @returns {void}
     *
     * @example
     * <button onDragLeave={dropProps(path).onDragLeave} />
     */
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
    },
    /**
     * Clears the hover outline and hands dropped paths to `onDropPaths` with the item's scope.
     *
     * @param {DragEvent} e - Drop event.
     * @returns {void}
     *
     * @example
     * <button onDrop={dropProps(path).onDrop} />
     */
    onDrop: (e: DragEvent) => {
      setOver(null);
      if (!hasDragPaths(e)) return;
      e.preventDefault();
      onDropPaths(e, target);
    },
  });

  /**
   * Renders one sidebar item.
   *
   * The item is a tree item button that shows an icon, a label and a note count. It is marked
   * selected when `key` is the current scope, outlined while a drag hovers it, indented by
   * `depth`, selects its scope on click and acts as a drop target.
   *
   * @param {string} key - Scope of the item ('all', 'trash' or a folder path), also its React key.
   * @param {string} label - Display name.
   * @param {number} count - Number of notes shown on the right.
   * @param {ReactNode} icon - Leading icon.
   * @param {number} [depth=0] - Nesting level used for the left padding.
   * @param {(e: MouseEvent) => void} [onMenu] - Context-menu handler; omitted for items without a menu.
   * @returns {JSX.Element} The item button.
   *
   * @example
   * item('all', 'All Notes', 12, <Folder size={15} />);
   */
  const item = (key: string, label: string, count: number, icon: ReactNode, depth = 0, onMenu?: (e: MouseEvent) => void) => (
    <button
      key={key}
      type="button"
      role="treeitem"
      aria-selected={scope === key}
      className={`${styles.folder} ${scope === key ? styles.folderSelected : ''} ${over === key ? styles.folderDrop : ''}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={() => onScope(key)}
      onContextMenu={onMenu}
      {...dropProps(key)}
    >
      {icon}
      <span className={styles.folderName}>{label}</span>
      <span className={styles.folderCount}>{count}</span>
    </button>
  );

  return (
    <>
      <div className={styles.sidebarScroll} role="tree" aria-label={t(S.folders)}>
        <div className={styles.sidebarSection}>{osInfo.name}</div>
        {item('all', t(S.allNotes), allCount, <Folder size={15} className={styles.folderIcon} aria-hidden />)}
        {folders.map((f) => item(f.path, f.name, f.count, <Folder size={15} className={styles.folderIcon} aria-hidden />, f.depth, f.fixed ? undefined : (e) => onFolderMenu(e, f.path)))}
        {(trashCount > 0 || scope === 'trash') && item('trash', t(S.recentlyDeleted), trashCount, <Trash size={15} className={styles.folderIcon} aria-hidden />)}
      </div>
      <div className={styles.sidebarFooter}>
        <button type="button" className={styles.newFolder} onClick={onNewFolder}>
          <FolderPlus size={15} aria-hidden />
          {t(S.newFolder)}
        </button>
      </div>
    </>
  );
}

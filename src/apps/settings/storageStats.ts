/** Pure storage breakdown of the virtual file system by category. */
import type { FSNode, LString } from '@/kernel/types';
import { kindOf } from '@/kernel/fs';
import { isWithin } from '@/kernel/path';

/** Bucket a file's size is counted under in the Storage pane. */
export type StorageCategory = 'apps' | 'documents' | 'images' | 'system' | 'other';

export const STORAGE_CATEGORIES: StorageCategory[] = ['apps', 'documents', 'images', 'system', 'other']; /** Categories in the order they appear in the storage bar and legend. */

export const STORAGE_NAMES: Record<StorageCategory, LString> = {
  apps: { en: 'Applications', ko: '응용 프로그램' },
  documents: { en: 'Documents', ko: '문서' },
  images: { en: 'Images', ko: '이미지' },
  system: { en: 'System Data', ko: '시스템 데이터' },
  other: { en: 'Other', ko: '기타' },
}; /** Localized display name of each storage category. */

export const STORAGE_COLORS: Record<StorageCategory, string> = {
  apps: 'var(--red)',
  documents: 'var(--orange)',
  images: 'var(--yellow)',
  system: 'var(--gray)',
  other: 'var(--purple)',
}; /** Theme color variable used for each category's bar segment and legend dot. */

const SYSTEM_ROOTS = ['/System', '/Library', '/bin', '/etc', '/usr', '/var', '/tmp', '/private']; /** Top-level folders whose contents count as System Data. */

/**
 * Assigns a node to a storage category.
 *
 * Location wins first: anything inside `/Applications` is an app and anything inside a
 * `SYSTEM_ROOTS` folder is system data (`isWithin` matches whole path segments, so
 * `/Users/me/etcetera.txt` is not under `/etc`). Otherwise the file kind decides: images,
 * text/markdown/PDF/code as documents, `.app` bundles as apps, everything else as other.
 *
 * @param {Pick<FSNode, 'path' | 'name' | 'type'>} node - Node to classify.
 * @returns {StorageCategory} The category the node's size is counted under.
 *
 * @example
 * categorize({ path: '/etc/hosts', name: 'hosts', type: 'file' }); // 'system'
 * categorize({ path: '/Users/me/cat.png', name: 'cat.png', type: 'file' }); // 'images'
 */
export function categorize(node: Pick<FSNode, 'path' | 'name' | 'type'>): StorageCategory {
  if (isWithin(node.path, '/Applications')) return 'apps';
  if (SYSTEM_ROOTS.some((r) => isWithin(node.path, r))) return 'system';
  switch (kindOf(node)) {
    case 'image':
      return 'images';
    case 'text':
    case 'markdown':
    case 'pdf':
    case 'code':
      return 'documents';
    case 'app':
      return 'apps';
    default:
      return 'other';
  }
}

/** Result of `computeStorage`. */
export interface StorageStats {
  /** Total bytes of all files. */
  total: number;
  /** Number of files counted (folders are excluded). */
  files: number;
  /** Bytes per category. */
  byCategory: Record<StorageCategory, number>;
}

/**
 * Sums file sizes across the file system, per category.
 *
 * Iterates the nodes once, skipping anything that is not a file, measuring each file with
 * `sizeOf` and adding the size to its `categorize` bucket and to the grand total.
 *
 * @param {Iterable<FSNode>} nodes - Nodes to measure (e.g. every node in the FS).
 * @param {(n: FSNode) => number} sizeOf - Returns the size in bytes of a file node.
 * @returns {StorageStats} Total bytes, file count and bytes per category.
 *
 * @example
 * const stats = computeStorage(allNodes, (n) => n.bytes ?? 0);
 * console.log(stats.byCategory.images);
 */
export function computeStorage(nodes: Iterable<FSNode>, sizeOf: (n: FSNode) => number): StorageStats {
  const byCategory: Record<StorageCategory, number> = { apps: 0, documents: 0, images: 0, system: 0, other: 0 };
  let total = 0;
  let files = 0;
  for (const n of nodes) {
    if (n.type !== 'file') continue;
    const size = sizeOf(n);
    byCategory[categorize(n)] += size;
    total += size;
    files++;
  }
  return { total, files, byCategory };
}

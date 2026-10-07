/**
 * Follows a document across renames and moves made by other apps (Finder, Terminal, Notes…).
 *
 * Every move, rename, trash and put-back goes through `fs.move`, which records old → new paths
 * (for the file and all of its descendants) in the kernel's move journal. Documents are matched
 * only through that journal: creation time and contents are not unique (`touch a.txt b.txt`
 * creates two identical empty files in the same millisecond, and every child of a copied folder
 * shares one creation time), so matching on them could hand a deleted document over to — and
 * on save overwrite — an unrelated file.
 */
import { fs } from '@/kernel/fs';
import type { FSNode } from '@/kernel/types';

/** What a document remembers about the file it was loaded from. */
export interface FileIdentity {
  /** Creation time of the file last seen at the document's path (preserved by moves). */
  createdAt: number;
  /** Text content (text files). */
  content?: string;
  /** Source URL (binary files). */
  src?: string;
}

/**
 * Captures the identity of a file node.
 *
 * Copies the node's `createdAt`, `content` and `src` into a plain object, so the identity
 * stays unchanged when the node in the file system is later edited or replaced.
 *
 * @param {FSNode} node - The file node.
 * @returns {FileIdentity} Its creation time, text content and source URL.
 *
 * @example
 * const id = identityOf(fs.writeFile(`${PATHS.documents}/a.txt`, 'hi'));
 */
export function identityOf(node: FSNode): FileIdentity {
  return { createdAt: node.createdAt, content: node.content, src: node.src };
}

/**
 * Finds where a file went after it disappeared from its old path.
 *
 * Looks `excludePath` up in the kernel's move journal, which also catches an edit and a rename
 * in the same tick (e.g. Notes renaming a note after its new title). The journaled
 * destination is accepted only if it is still a file with the same `createdAt` (moves keep
 * it), so a stale journal entry (`mv a b; touch a; rm a`) never hands the document over to an
 * unrelated file that lives at the old destination.
 *
 * @param {FileIdentity} id - Identity of the file last seen at the old path.
 * @param {string} [excludePath] - The path the file disappeared from; without it nothing is found.
 * @returns {FSNode | null} The file at its new location, or null if it was deleted.
 *
 * @example
 * const moved = findMovedFile(identity, `${PATHS.documents}/old.txt`);
 * if (moved) setPath(moved.path);
 */
export function findMovedFile(id: FileIdentity, excludePath?: string): FSNode | null {
  const journaled = excludePath ? fs.movedTo(excludePath) : null;
  if (!journaled) return null;
  const n = fs.stat(journaled);
  return n?.type === 'file' && n.createdAt === id.createdAt ? n : null;
}

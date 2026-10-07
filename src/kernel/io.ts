/**
 * Bridges between the virtual FS and the host machine: importing dropped/uploaded files and
 * downloading virtual files.
 */
import { fs, isTextFile, mimeFor } from './fs';
import { join, basename } from './path';

const MAX_IMPORT_BYTES = 15 * 1024 * 1024; /** Largest host file (15 MiB) that is imported; bigger files are skipped. */

/**
 * Reads a host file with a `FileReader`.
 *
 * Wraps the event-based reader in a Promise that resolves with the file's text or with a
 * base64 `data:` URL of its bytes, and rejects with the reader's error if reading fails.
 *
 * @param {File} file - The host file to read.
 * @param {'text' | 'dataURL'} mode - Read as text or as a data URL.
 * @returns {Promise<string>} The file contents in the requested form.
 * @throws {DOMException} When the browser fails to read the file (as a rejected Promise).
 *
 * @example
 * const text = await readAs(file, 'text');
 */
function readAs(file: File, mode: 'text' | 'dataURL'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    if (mode === 'text') r.readAsText(file);
    else r.readAsDataURL(file);
  });
}

/**
 * Imports host files (from a drop or an `<input type="file">`) into a virtual directory.
 *
 * Each file gets a unique name in `dir`. Text-like files are stored as text content; the choice
 * is made by file extension, because browsers report misleading MIME types for many source
 * files (`.ts` as video/mp2t, `.sh` as application/x-sh, `.yaml` as application/x-yaml); only an
 * image, audio or video MIME type other than video/mp2t overrides it. Everything else is stored
 * as a `data:` URL with its byte size and MIME type. Files over `MAX_IMPORT_BYTES`, and files
 * that cannot be read or written (for example into a protected folder), are reported as skipped
 * instead of throwing.
 *
 * @async
 * @param {FileList | File[]} files - The host files to import.
 * @param {string} dir - Absolute path of the destination directory.
 * @returns {Promise<{ created: string[]; skipped: string[] }>} Paths of the created files and
 *   names of the files that were skipped.
 *
 * @example
 * const { created, skipped } = await importHostFiles(e.dataTransfer.files, PATHS.desktop);
 * if (skipped.length) notify({ appId: 'finder', title: `${skipped.length} files skipped` });
 */
export async function importHostFiles(files: FileList | File[], dir: string): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const file of Array.from(files)) {
    if (file.size > MAX_IMPORT_BYTES) {
      skipped.push(file.name);
      continue;
    }
    const name = fs.uniqueName(dir, file.name || 'Untitled');
    const path = join(dir, name);
    const probe = { type: 'file' as const, name, src: undefined };
    try {
      if (isTextFile(probe) && !/^(image|audio|video\/(?!mp2t))/.test(file.type)) {
        fs.writeFile(path, await readAs(file, 'text'));
      } else {
        const src = await readAs(file, 'dataURL');
        fs.writeFile(path, '', { src, bytes: file.size, mime: file.type || mimeFor(name) });
      }
      created.push(path);
    } catch {
      skipped.push(file.name);
    }
  }
  return { created, skipped };
}

/**
 * Downloads a virtual file to the host machine through the browser.
 *
 * Files backed by a `src` URL are downloaded from that URL; text files are wrapped in a Blob
 * with their MIME type (plain text by default) and served from a temporary object URL that is
 * revoked two seconds later. The download is started by clicking a temporary `<a download>`
 * element. Missing paths and directories are ignored.
 *
 * @param {string} path - Absolute path of the virtual file.
 * @returns {void}
 *
 * @example
 * downloadFile(`${PATHS.documents}/Resume.md`);
 */
export function downloadFile(path: string): void {
  const node = fs.stat(path);
  if (!node || node.type !== 'file') return;
  let href: string;
  let revoke = false;
  if (node.src) href = node.src;
  else {
    href = URL.createObjectURL(new Blob([node.content ?? ''], { type: node.mime ?? 'text/plain' }));
    revoke = true;
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = basename(path);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 2000);
}

/**
 * Opens the host file picker and imports the chosen files into a virtual directory.
 *
 * Creates a temporary multi-select `<input type="file">`, clicks it, and imports the selection
 * with `importHostFiles`. The Promise resolves with an empty list when the selection is empty;
 * if the user cancels the picker without a `change` event, it never settles.
 *
 * @param {string} dir - Absolute path of the destination directory.
 * @param {string} [accept] - Value for the input's `accept` attribute (e.g. `'image/*'`).
 * @returns {Promise<string[]>} Paths of the files that were created.
 *
 * @example
 * const paths = await pickHostFiles(PATHS.pictures, 'image/*');
 */
export function pickHostFiles(dir: string, accept?: string): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (accept) input.accept = accept;
    input.onchange = async () => {
      if (!input.files?.length) return resolve([]);
      const { created } = await importHostFiles(input.files, dir);
      resolve(created);
    };
    input.click();
  });
}

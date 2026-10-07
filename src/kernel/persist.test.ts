import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = {};
  return {
    sets: [] as string[],
    db: {} as Record<string, string>,
    hang: false,
    hung: [] as (() => void)[],
  };
}); /** In-memory IndexedDB behind the mock: every written value (`sets`), the committed data (`db`), a `hang` switch that keeps writes from committing (as when the browser aborts IndexedDB transactions on unload) and the resolvers of those held-back writes (`hung`). */

vi.mock('idb-keyval', () => ({
  /**
   * Mock read from the in-memory database.
   *
   * Returns whatever was last committed to `store.db` under the key.
   *
   * @async
   * @param {string} k - The key to read.
   * @returns {Promise<string | undefined>} The stored value, if any.
   *
   * @example
   * const raw = await get('webos.fs');
   */
  get: async (k: string) => store.db[k],
  /**
   * Mock write that records every value and commits it unless writes are hanging.
   *
   * While `store.hang` is true the value is recorded but not committed, and the returned promise
   * stays pending until its resolver in `store.hung` is called.
   *
   * @param {string} k - The key to write.
   * @param {string} v - The serialized value.
   * @returns {Promise<void>} Resolves once the write is committed (or released from `store.hung`).
   *
   * @example
   * await set('webos.fs', JSON.stringify(state));
   */
  set: (k: string, v: string) => {
    store.sets.push(v);
    if (store.hang) return new Promise<void>((res) => store.hung.push(res));
    store.db[k] = v;
    return Promise.resolve();
  },
  /**
   * Mock delete from the in-memory database.
   *
   * Removes the key from `store.db` immediately, even while writes are hanging.
   *
   * @async
   * @param {string} k - The key to delete.
   * @returns {Promise<void>} Resolves after the key is removed.
   *
   * @example
   * await del('webos.fs');
   */
  del: async (k: string) => void delete store.db[k],
}));

const DIRS = {
  '/': { path: '/', name: '/', type: 'dir' as const, createdAt: 1, modifiedAt: 1 },
  '/tmp': { path: '/tmp', name: 'tmp', type: 'dir' as const, createdAt: 1, modifiedAt: 1 },
}; /** Minimal tree (root and /tmp) that the tests write files into. */

/**
 * Lists the localStorage keys of the file system's unload journals.
 *
 * On pagehide the file system synchronously journals to localStorage whatever IndexedDB may be
 * missing and removes the entry once its write commits; this returns the keys of every journal
 * entry currently stored.
 *
 * @returns {string[]} Keys starting with "webos.fs.journal.".
 *
 * @example
 * expect(journalKeys()).toHaveLength(0);
 */
const journalKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('webos.fs.journal.'));

/**
 * Waits for one macrotask so pending promise callbacks and timers at 0 ms run.
 *
 * Schedules a 0 ms timeout and resolves when it fires; queued microtasks run before it.
 *
 * @returns {Promise<unknown>} Resolves on the next macrotask.
 *
 * @example
 * await tick();
 */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Loads a fresh instance of the fs module, as a page load would.
 *
 * Resets the module registry so module-level state starts over, imports `./fs` and waits until it
 * has hydrated from the mocked IndexedDB (and replayed any localStorage journal).
 *
 * @async
 * @returns {Promise<typeof import('./fs')>} The freshly booted fs module.
 *
 * @example
 * const { fs } = await boot();
 */
async function boot() {
  vi.resetModules();
  const mod = await import('./fs');
  await mod.whenFSReady();
  return mod;
}

describe('IndexedDB persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    store.hang = false;
  });

  it('writes made by onBeforePersist handlers are part of the final flush on pagehide', async () => {
    const { fs, useFS, onBeforePersist } = await boot();
    useFS.setState({ nodes: { ...DIRS }, seedVersion: 'v' });
    // A debounced autosave that only gets to run when the page goes away (like Notes' editor).
    const off = onBeforePersist(() => fs.writeFile('/tmp/note.md', 'last keystrokes'));
    const before = store.sets.length;
    window.dispatchEvent(new Event('pagehide'));
    off();
    expect(store.sets.slice(before).some((v) => v.includes('last keystrokes'))).toBe(true);
    await tick();
  });

  it('keeps changes made right before a reload even though the last IndexedDB write never commits', async () => {
    store.db = {};
    const first = await boot();
    first.useFS.setState({ nodes: { ...DIRS }, seedVersion: 'v' });
    first.fs.writeFile('/tmp/probe-immediate.txt', 'x');
    store.hang = true;
    window.dispatchEvent(new Event('pagehide'));
    expect(store.db['webos.fs']).toBeUndefined();
    expect(journalKeys()).toHaveLength(1);

    // Simulated reload.
    store.hang = false;
    const second = await boot();
    expect(second.fs.readFile('/tmp/probe-immediate.txt')).toBe('x');
    expect(second.useFS.getState().seedVersion).toBe('v');
    // The journal was folded into IndexedDB and removed.
    expect(journalKeys()).toHaveLength(0);
    expect(store.db['webos.fs']).toContain('probe-immediate');
    // Let the aborted write of the previous page settle so it does not journal again.
    store.hung.splice(0).forEach((res) => res());
    await tick();
  });

  it('loading the stored tree does not write it back (no echo between tabs)', async () => {
    store.db = { 'webos.fs': JSON.stringify({ state: { nodes: { ...DIRS }, seedVersion: 'v' }, version: 1 }) };
    const before = store.sets.length;
    const { useFS } = await boot();
    expect(useFS.getState().hydrated).toBe(true);
    await useFS.persist.rehydrate();
    await new Promise((r) => setTimeout(r, 300));
    expect(store.sets.length).toBe(before);
  });

  it.runIf(typeof BroadcastChannel !== 'undefined')('a tab reloads the tree another tab persisted instead of overwriting it later', async () => {
    store.db = { 'webos.fs': JSON.stringify({ state: { nodes: { ...DIRS }, seedVersion: 'v' }, version: 1 }) };
    const tabA = await boot();
    const tabB = await boot();
    tabA.fs.writeFile('/tmp/from-a.txt', 'a');
    window.dispatchEvent(new Event('pagehide')); // flushes immediately instead of waiting for the debounce
    await vi.waitFor(() => expect(tabB.fs.exists('/tmp/from-a.txt')).toBe(true));
    tabB.fs.writeFile('/tmp/from-b.txt', 'b');
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(store.db['webos.fs']).toContain('from-b'));
    expect(store.db['webos.fs']).toContain('from-a');
  });

  it('journals only the nodes IndexedDB may be missing', async () => {
    store.db = {};
    const { fs, useFS } = await boot();
    useFS.setState({ nodes: { ...DIRS, '/tmp/a.txt': { path: '/tmp/a.txt', name: 'a.txt', type: 'file', content: 'a', createdAt: 1, modifiedAt: 1 } }, seedVersion: 'v' });
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(journalKeys()).toHaveLength(0);

    fs.writeFile('/tmp/b.txt', 'b');
    fs.rm('/tmp/a.txt');
    store.hang = true;
    window.dispatchEvent(new Event('pagehide'));
    const [key] = journalKeys();
    const journal = JSON.parse(localStorage.getItem(key)!);
    expect(Object.keys(journal.upserts).sort()).toEqual(['/tmp', '/tmp/b.txt']);
    expect(journal.deletes).toEqual(['/tmp/a.txt']);

    store.hang = false;
    const next = await boot();
    expect(next.fs.exists('/tmp/a.txt')).toBe(false);
    expect(next.fs.readFile('/tmp/b.txt')).toBe('b');
    store.hung.splice(0).forEach((res) => res());
    await tick();
  });
});

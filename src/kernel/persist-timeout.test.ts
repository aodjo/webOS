import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = {};
  return { sets: 0 };
}); /** Shared mock state: counts IndexedDB writes; created before the mocks so `fs` sees a fake `indexedDB` global. */

vi.mock('idb-keyval', () => ({
  /**
   * Mock read that never settles.
   *
   * Simulates an IndexedDB that never answers, as when it is blocked by another connection or
   * private-mode storage is broken, so `fs` has to fall back to its boot timeout.
   *
   * @returns {Promise<never>} A promise that stays pending forever.
   *
   * @example
   * void get('webos.fs'); // never resolves
   */
  get: () => new Promise(() => {}),
  /**
   * Mock write that only counts how often it is called.
   *
   * Increments `store.sets` and stores nothing, so the test can assert that `fs` never tried to
   * write over the data it could not read.
   *
   * @async
   * @returns {Promise<void>} Resolves immediately after incrementing `store.sets`.
   *
   * @example
   * await set('webos.fs', '{}'); // store.sets === 1
   */
  set: async () => void store.sets++,
  /**
   * Mock delete that does nothing.
   *
   * Ignores its arguments and resolves at once.
   *
   * @async
   * @returns {Promise<undefined>} Resolves immediately.
   *
   * @example
   * await del('webos.fs');
   */
  del: async () => undefined,
}));

describe('IndexedDB that never answers', () => {
  it('boots from memory after the timeout and never writes over the stored data', async () => {
    vi.useFakeTimers();
    const { fs, whenFSReady, useFS, isPersistenceAvailable } = await import('./fs');
    let ready = false;
    void whenFSReady().then(() => (ready = true));
    await vi.advanceTimersByTimeAsync(5100);
    expect(ready).toBe(true);
    expect(isPersistenceAvailable()).toBe(false);
    fs.sudo(() => useFS.setState({ nodes: { '/': { path: '/', name: '/', type: 'dir', createdAt: 1, modifiedAt: 1 }, '/tmp': { path: '/tmp', name: 'tmp', type: 'dir', createdAt: 1, modifiedAt: 1 } }, seedVersion: 'v' }));
    fs.writeFile('/tmp/a.txt', 'x');
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event('pagehide'));
    expect(store.sets).toBe(0);
    vi.useRealTimers();
  });
});

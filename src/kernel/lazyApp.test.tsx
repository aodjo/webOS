import { act, Suspense, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, lazyApp } from './lazyApp';
import type { AppProps } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Minimal error boundary that makes load failures observable.
 *
 * Renders its children until a descendant throws (including a rejected lazy import), then
 * renders a "failed" marker instead. Remounting it with a new `key` clears the caught error.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.children - Content rendered while no error has been caught.
 *
 * @example
 * <Boundary key={1}><App {...props} /></Boundary>
 */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  /**
   * Stores the error thrown by a child so the boundary renders its fallback.
   *
   * React calls this during rendering after a descendant throws, including when a lazy
   * component's import rejects.
   *
   * @param {Error} error - The error thrown by a descendant.
   * @returns {{ error: Error }} The state update holding the error.
   *
   * @example
   * Boundary.getDerivedStateFromError(new Error('boom')); // { error }
   */
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  /**
   * Renders the children, or a "failed" marker after an error was caught.
   *
   * Reads `state.error`, which `getDerivedStateFromError` sets when a descendant throws.
   *
   * @returns {ReactNode} The fallback marker or the children.
   *
   * @example
   * <Boundary><App {...props} /></Boundary>
   */
  render() {
    return this.state.error ? <span>failed</span> : this.props.children;
  }
}

const props: AppProps = { windowId: 'w', pid: 1, args: {} }; /** Props passed to the lazy app under test. */

describe('lazyApp', () => {
  it('recognizes code-download errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('can load again after reset() instead of keeping the cached failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const App = lazyApp(async () => {
      if (fail) throw new Error('boom');
      return { default: () => <span>loaded</span> };
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    /**
     * Renders the lazy app inside a fresh error boundary and Suspense fallback.
     *
     * A new `key` remounts the boundary, clearing its caught error, so each call attempts the
     * load again; the call waits inside `act` until the lazy import has settled.
     *
     * @async
     * @param {number} key - Key that forces a new boundary instance.
     * @returns {Promise<void>} Resolves once rendering has settled.
     *
     * @example
     * await mount(1);
     */
    const mount = async (key: number) =>
      act(async () => {
        root.render(
          <Boundary key={key}>
            <Suspense fallback={<span>loading</span>}>
              <App {...props} />
            </Suspense>
          </Boundary>,
        );
      });
    await mount(1);
    expect(host.textContent).toBe('failed');
    fail = false;
    await mount(2);
    expect(host.textContent).toBe('failed'); // React.lazy cached the rejection
    App.reset();
    await mount(3);
    expect(host.textContent).toBe('loaded');
    act(() => root.unmount());
    vi.restoreAllMocks();
  });
});

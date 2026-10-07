/**
 * Lazy-loaded app components that can recover from a failed code download.
 *
 * React.lazy caches a rejected import forever, and browsers also cache a failed module fetch by
 * URL — so after a network blip (or a dev-server restart, or a deploy that replaced the chunks)
 * an app would stay broken until the page reloads. `lazyApp` retries once with a cache-busting
 * URL, and `reset()` (the crash screen's Reopen) lets the next render try again.
 */
import { createElement, lazy, type ComponentType, type ReactElement } from 'react';
import type { AppProps } from './types';

type AppModule = { default: ComponentType<AppProps> };
type Loader = () => Promise<AppModule>;

/** An app component that loads its code lazily and can retry after a failed download. */
export interface RetryableApp {
  (props: AppProps): ReactElement;
  displayName?: string;
  /** Forget a failed load so the next mount downloads the code again. */
  reset(): void;
}

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Outdated Optimize Dep/i; /** Error messages that browsers and Vite produce when a code chunk cannot be downloaded. */

/**
 * Tells whether an error was caused by failing to download an app's code.
 *
 * Matches the error message against the known chunk-load messages of Chrome, Firefox, Safari
 * and Vite, so a download failure can be told apart from the app itself crashing.
 *
 * @param {unknown} e - The caught error.
 * @returns {boolean} True when `e` is an `Error` whose message describes a failed code download.
 *
 * @example
 * if (isChunkLoadError(error)) showRetryButton();
 */
export function isChunkLoadError(e: unknown): boolean {
  return e instanceof Error && CHUNK_ERROR.test(e.message);
}

/**
 * Extracts the URL of the module that failed to load from an error message.
 *
 * Chrome and Firefox include the module URL in the message; Safari does not, so this returns
 * `null` there. Trailing punctuation (`.`, `,`, `)`) picked up from the sentence is stripped.
 *
 * @param {unknown} e - The caught error.
 * @returns {string | null} The module URL, or `null` when the message contains none.
 *
 * @example
 * failedModuleURL(new TypeError('Failed to fetch dynamically imported module: http://x/a.js')); // 'http://x/a.js'
 */
function failedModuleURL(e: unknown): string | null {
  const m = e instanceof Error ? /(https?:\/\/[^\s'"]+)/.exec(e.message) : null;
  return m ? m[1].replace(/[.,)]+$/, '') : null;
}

let bust = 0; /** Counter appended to cache-busting query strings so every retry URL is unique. */

/**
 * Wraps a dynamic import of an app module in a lazily loaded component that can recover.
 *
 * The loader is retried once when it fails with a chunk-load error whose message names the
 * module URL: after a 400 ms pause the same module is imported again with a unique `t` query
 * parameter, which bypasses the browser's cached failure. Any other error is rethrown. Because
 * `React.lazy` caches a rejected import forever, the returned component's `reset()` replaces the
 * lazy component so the next mount starts a fresh download. The component must be rendered
 * inside a `<Suspense>` boundary.
 *
 * @param {() => Promise<{ default: ComponentType<AppProps> }>} load - Dynamic import of the app module.
 * @param {string} [name] - App name used in the component's `displayName`.
 * @returns {RetryableApp} The lazy app component with a `reset()` method.
 *
 * @example
 * const Notes = lazyApp(() => import('@/apps/notes/index'), 'notes');
 * Notes.reset();
 */
export function lazyApp(load: Loader, name?: string): RetryableApp {
  /**
   * Runs the loader and retries a failed chunk download once with a cache-busting URL.
   *
   * Waits 400 ms, then imports the failed module URL with a fresh `t` query parameter. Errors
   * that are not chunk-load errors, or that do not include the module URL, are rethrown.
   *
   * @returns {Promise<{ default: ComponentType<AppProps> }>} The loaded app module.
   * @throws {Error} When the load fails for another reason, or the retry also fails.
   *
   * @example
   * const mod = await loadWithRetry();
   */
  const loadWithRetry: Loader = () =>
    load().catch(async (e: unknown) => {
      const url = failedModuleURL(e);
      if (!url || !isChunkLoadError(e)) throw e;
      await new Promise((r) => setTimeout(r, 400));
      const retry = new URL(url);
      retry.searchParams.set('t', `${Date.now()}${++bust}`);
      return (await import(/* @vite-ignore */ retry.href)) as AppModule;
    });
  let Lazy = lazy(loadWithRetry);
  /**
   * Renders the current lazy component with the app's props.
   *
   * Looks up `Lazy` on every render, so after `reset()` the next mount uses the new lazy
   * component and downloads the code again.
   *
   * @param {AppProps} props - Window id, process id and launch args of the app.
   * @returns {ReactElement} The lazy app element.
   *
   * @example
   * <App windowId="w1" pid={1} args={{}} />
   */
  const App = ((props: AppProps) => createElement(Lazy, props)) as RetryableApp;
  App.displayName = name ? `LazyApp(${name})` : 'LazyApp';
  /**
   * Forgets a failed load so the next mount downloads the code again.
   *
   * Replaces the cached lazy component with a new one built from the same retrying loader.
   *
   * @returns {void}
   *
   * @example
   * App.reset();
   */
  App.reset = () => {
    Lazy = lazy(loadWithRetry);
  };
  return App;
}

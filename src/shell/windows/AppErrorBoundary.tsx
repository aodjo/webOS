/**
 * Catches render errors of an app so one crashing app can't take down the whole shell.
 * Shows a macOS-style "quit unexpectedly" screen inside the window.
 */
import { Component, useContext, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { WindowContext, fmt, getApp, isChunkLoadError, useT, useWM, type RetryableApp } from '@/kernel';
import { Button } from '@/components/ui';
import s from './Window.module.css';

const S = {
  quit: { en: '{app} quit unexpectedly.', ko: '{app}이(가) 예기치 않게 종료되었습니다.' },
  hint: { en: 'Click Reopen to open the app again.', ko: '앱을 다시 열려면 ‘다시 열기’를 클릭하십시오.' },
  details: { en: 'Details', ko: '세부사항' },
  reopen: { en: 'Reopen', ko: '다시 열기' },
  close: { en: 'Close', ko: '닫기' },
  loadFailed: { en: '{app} couldn’t be opened.', ko: '{app}을(를) 열 수 없습니다.' },
  loadHint: {
    en: 'The app’s code couldn’t be downloaded. Check your connection, then try again — or reload the page if the site was just updated.',
    ko: '앱 코드를 내려받지 못했습니다. 연결을 확인한 다음 다시 시도하거나, 사이트가 방금 업데이트되었다면 페이지를 새로고침하십시오.',
  },
  tryAgain: { en: 'Try Again', ko: '다시 시도' },
  reloadPage: { en: 'Reload Page', ko: '페이지 새로고침' },
}; /** Localized strings for the crash screen. */

/**
 * Drops an app's cached (failed) code download so remounting fetches it again.
 *
 * Calls `reset()` on the app's lazily loaded component when it has one (see `lazyApp`); apps
 * that are not registered or not lazily loaded are left alone.
 *
 * @param {string} appId - Id of the app whose loader is reset.
 * @returns {void}
 *
 * @example
 * resetLoader('notes');
 */
function resetLoader(appId: string): void {
  (getApp(appId)?.component as Partial<RetryableApp> | undefined)?.reset?.();
}

/** Props of {@link AppErrorBoundary}. */
interface Props {
  /** Id of the app rendered inside the boundary. */
  appId: string;
  /** Remounts the app (Reopen / Try Again). */
  onReopen: () => void;
  /** Closes the window. */
  onClose: () => void;
  /** The app's window content. */
  children: ReactNode;
}

/** State of {@link AppErrorBoundary}. */
interface State {
  /** The error thrown while rendering the app, or null while it runs normally. */
  error: Error | null;
}

/**
 * Error boundary around an app's window content.
 *
 * Renders the children until one of them throws while rendering; from then on it shows the
 * crash screen inside the window, so one crashing app can't take down the whole shell.
 *
 * @param {Props} props - Component props.
 * @param {string} props.appId - Id of the app rendered inside the boundary.
 * @param {() => void} props.onReopen - Remounts the app (Reopen / Try Again).
 * @param {() => void} props.onClose - Closes the window.
 * @param {ReactNode} props.children - The app's window content.
 * @returns {ReactNode} The children, or the crash screen once an error was caught.
 *
 * @example
 * <AppErrorBoundary key={generation} appId="notes" onReopen={remount} onClose={closeWindow}>
 *   <App />
 * </AppErrorBoundary>
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  /**
   * Stores a render error in the boundary's state.
   *
   * Non-Error values that were thrown are wrapped in an Error so the crash screen can always show
   * a message.
   *
   * @param {unknown} error - The value thrown during rendering.
   * @returns {State} The new state holding the error.
   *
   * @example
   * AppErrorBoundary.getDerivedStateFromError('boom'); // { error: Error('boom') }
   */
  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  /**
   * Logs a caught render error with the app id and the component stack.
   *
   * Runs after `getDerivedStateFromError` has switched the boundary to the crash screen; it only
   * writes to the console and leaves the state untouched.
   *
   * @param {unknown} error - The value thrown during rendering.
   * @param {ErrorInfo} info - React's error info, including the component stack.
   * @returns {void}
   *
   * @example
   * boundary.componentDidCatch(new Error('boom'), { componentStack: '\n    at Notes' });
   * // console: [notes] crashed: Error: boom …
   */
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[${this.props.appId}] crashed:`, error, info.componentStack);
  }

  /**
   * Renders the app, or the crash screen once an error was caught.
   *
   * Reopening from the crash screen first resets the app's lazy loader, so a failed code
   * download is fetched again, and then calls `onReopen`.
   *
   * @returns {ReactNode} The children, or the crash screen.
   *
   * @example
   * const output = boundary.render(); // the children, or <CrashScreen … /> after an error
   */
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    /**
     * Resets the app's loader and asks the window to remount the app.
     *
     * Clearing the cached lazy import first makes a failed code download start over, then
     * `onReopen` remounts the boundary with a fresh app instance.
     *
     * @returns {void}
     *
     * @example
     * <CrashScreen onReopen={reopen} … />
     */
    const reopen = () => {
      resetLoader(this.props.appId);
      this.props.onReopen();
    };
    return <CrashScreen appId={this.props.appId} error={error} onReopen={reopen} onClose={this.props.onClose} />;
  }
}

/**
 * macOS-style "quit unexpectedly" screen drawn inside a crashed app's window.
 *
 * Shows the app icon, a title and a hint, the error message in a collapsible Details section,
 * and Close / Reopen buttons. For chunk-load errors (the app's code couldn't be downloaded) it
 * says the app couldn't be opened, offers Reload Page, and labels the primary button Try Again.
 * The primary button takes keyboard focus on mount, but only while this window is focused.
 *
 * @param {Object} props - Component props.
 * @param {string} props.appId - Id of the crashed app.
 * @param {Error} props.error - The caught error.
 * @param {() => void} props.onReopen - Reopens (remounts) the app.
 * @param {() => void} props.onClose - Closes the window.
 * @returns {JSX.Element} The crash screen.
 *
 * @example
 * <CrashScreen appId="notes" error={error} onReopen={reopen} onClose={close} />
 */
function CrashScreen({ appId, error, onReopen, onClose }: { appId: string; error: Error; onReopen: () => void; onClose: () => void }) {
  const t = useT();
  const app = getApp(appId);
  const Icon = app?.icon;
  const name = app ? t(app.name) : appId;
  const windowId = useContext(WindowContext)?.id;
  const reopenRef = useRef<HTMLButtonElement>(null);
  const loadError = isChunkLoadError(error);

  useEffect(() => {
    if (windowId && useWM.getState().focusedId === windowId) reopenRef.current?.focus({ preventScroll: true });
  }, [windowId]);

  return (
    <div className={s.crash} role="alert" data-drag-region>
      {Icon && <Icon size={56} />}
      <div className={s.crashTitle}>{fmt(t(loadError ? S.loadFailed : S.quit), { app: name })}</div>
      <div className={s.crashHint}>{t(loadError ? S.loadHint : S.hint)}</div>
      <details className={s.crashDetails} data-no-drag>
        <summary>{t(S.details)}</summary>
        <pre className="selectable">{error.message || String(error)}</pre>
      </details>
      <div className={s.crashButtons}>
        <Button onClick={onClose}>{t(S.close)}</Button>
        {loadError && <Button onClick={() => window.location.reload()}>{t(S.reloadPage)}</Button>}
        <Button ref={reopenRef} variant="primary" onClick={onReopen}>
          {t(loadError ? S.tryAgain : S.reopen)}
        </Button>
      </div>
    </div>
  );
}

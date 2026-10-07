/**
 * "Force Quit Applications" (⌥⌘⎋): a floating thick-glass panel listing every running app, hidden
 * ones included. Finder can only be relaunched. Confirmations appear as a sheet on this panel.
 *
 * Like a macOS panel it stays the key window only until you click somewhere else, and ⌥⌘⎋ makes
 * it key again. While it is key it takes Return / Esc / arrows / type-select; otherwise keys go
 * to the app or desktop that was clicked.
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { COMMON, MENU_BAR_HEIGHT, SYSTEM_SHORTCUTS, dialogs, formatShortcut, getApp, useDialogs, useSystem, useT, useUI, useWM, wm, type LString } from '@/kernel';
import { Button } from '@/components/ui';
import { Z } from '../layers';
import { isModKey, isPlainKey } from './DialogParts';
import { SheetHost, cancelDialogs } from './Dialogs';
import { desktopUI } from './desktopStore';
import { KEY_PRIORITY, useModalKeys } from './modalKeys';
import styles from './ForceQuit.module.css';

export const FORCE_QUIT_HOST = 'force-quit'; /** Sheet host id under which the confirmation alerts are shown on this panel. */

const TITLEBAR_HEIGHT = 36; /** Height in px of the panel's transparent title bar; matches `.titlebar` in ForceQuit.module.css. */

const S = {
  title: { en: 'Force Quit Applications', ko: '응용 프로그램 강제 종료' },
  explain: { en: 'If an app doesn’t respond for a while, select its name and click Force Quit.', ko: '응용 프로그램이 한동안 응답하지 않으면, 해당 이름을 선택하고 강제 종료를 클릭하십시오.' },
  hint: { en: 'You can open this window by pressing {k}.', ko: '{k}를 눌러 이 윈도우를 열 수 있습니다.' },
  forceQuit: { en: 'Force Quit', ko: '강제 종료' },
  relaunch: { en: 'Relaunch', ko: '재실행' },
  apps: { en: 'Running applications', ko: '실행 중인 응용 프로그램' },
  lost: { en: 'You will lose any unsaved changes.', ko: '저장되지 않은 변경 사항은 손실됩니다.' },
} satisfies Record<string, LString>; /** Localized strings of the Force Quit panel. */

/**
 * Closes the Force Quit panel.
 *
 * Clears the `forceQuit` flag in the UI store, which unmounts the panel.
 *
 * @returns {void}
 *
 * @example
 * <button onClick={close} />
 */
const close = () => useUI.getState().set({ forceQuit: false });

/**
 * Mounts the Force Quit panel while the UI store's `forceQuit` flag is set.
 *
 * Logging out, restarting or shutting down clears the flag, so the panel does not reappear
 * after the next login.
 *
 * @returns {JSX.Element | null} The panel, or null while it is closed.
 *
 * @example
 * <ForceQuitDialog />
 */
export function ForceQuitDialog() {
  const open = useUI((s) => s.forceQuit);
  const sessionEnding = useSystem((s) => s.power === 'loggingOut' || s.power === 'restarting' || s.power === 'shuttingDown');
  useEffect(() => {
    if (sessionEnding) close();
  }, [sessionEnding]);
  return open ? <ForceQuitWindow /> : null;
}

/**
 * Force quits an app and cancels the questions it was still asking.
 *
 * Closes the app's windows without asking, so unsaved changes are lost, and quits the app (a
 * persistent app such as Finder keeps its process). Pending dialogs attached to those windows,
 * and app-level dialogs of the app, are then dismissed with their cancel answer; the panel's
 * own confirmation sheet is left alone.
 *
 * @async
 * @param {string} appId - Id of the app to quit.
 * @returns {Promise<void>} Resolves once the app has quit and its dialogs are cancelled.
 *
 * @example
 * await forceQuit('textedit');
 */
async function forceQuit(appId: string): Promise<void> {
  const windowIds = new Set(useWM.getState().windows.filter((w) => w.appId === appId).map((w) => w.id));
  await wm.quit(appId, { force: true });
  cancelDialogs((d) => d.windowId !== FORCE_QUIT_HOST && (d.windowId ? windowIds.has(d.windowId) : d.appId === appId));
}

/**
 * The Force Quit panel: a draggable thick-glass window listing every running app.
 *
 * The selection starts on the active app and falls back to the first app when the selected one
 * quits. The list takes focus when the panel opens; when it closes, confirmations still pending
 * on the panel are answered "Cancel" and focus returns to the previously focused element if
 * nothing else took it. The panel is the key window until the pointer goes down outside it.
 * While key it handles Return (confirm), Esc / ⌘. / ⌥W (close), arrows, Home/End and
 * type-select, and ⌥⌘⎋ makes it key again. Confirming shows an alert sheet on the panel and
 * then force quits the app, or relaunches Finder.
 *
 * @returns {JSX.Element} The panel.
 *
 * @example
 * {open && <ForceQuitWindow />}
 */
function ForceQuitWindow() {
  const t = useT();
  const idPrefix = useId();
  const processes = useWM((s) => s.processes);
  const apps = processes.flatMap((p) => {
    const app = getApp(p.appId);
    return app ? [{ appId: p.appId, app }] : [];
  });
  const [picked, setPicked] = useState<string | null>(() => useWM.getState().activeAppId);
  const current = apps.some((a) => a.appId === picked) ? picked : (apps[0]?.appId ?? null);
  const sheetOpen = useDialogs((s) => s.queue.some((d) => d.windowId === FORCE_QUIT_HOST));
  const [isKey, setIsKey] = useState(true);

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef({ text: '', at: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; minY: number; maxY: number } | null>(null);

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    listRef.current?.focus({ preventScroll: true });
    return () => {
      cancelDialogs((d) => d.windowId === FORCE_QUIT_HOST);
      if (prev?.isConnected && (!document.activeElement || document.activeElement === document.body)) prev.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    /**
     * Updates the key-window state from a pointer press anywhere on the page.
     *
     * Listens in the capture phase so it sees every press: one inside the panel makes it key,
     * one anywhere else hands the keyboard to whatever was clicked.
     *
     * @param {PointerEvent} e - Pointer press.
     * @returns {void}
     *
     * @example
     * window.addEventListener('pointerdown', onDown, true);
     */
    const onDown = (e: PointerEvent) => setIsKey(e.target instanceof Node && !!panelRef.current?.contains(e.target));
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  /**
   * Makes the panel the key window again and focuses its list.
   *
   * Used when ⌥⌘⎋ is pressed while the panel is already open.
   *
   * @returns {void}
   *
   * @example
   * activate();
   */
  const activate = () => {
    setIsKey(true);
    listRef.current?.focus({ preventScroll: true });
  };

  /**
   * Asks for confirmation, then force quits (or relaunches) an app.
   *
   * Shows an alert sheet on the panel, worded as a relaunch for Finder. When confirmed, the app
   * is force quit; for Finder the desktop is told about the relaunch and a new Finder window is
   * opened. Does nothing without an app or while a sheet is already showing.
   *
   * @async
   * @param {string | null} appId - App to quit, or null when nothing is selected.
   * @returns {Promise<void>} Resolves when the alert is answered and any quit has finished.
   *
   * @example
   * void confirm(current);
   */
  const confirm = async (appId: string | null) => {
    if (!appId || sheetOpen) return;
    const app = getApp(appId);
    const name = app ? t(app.name) : appId;
    const isFinder = appId === 'finder';
    const answer = await dialogs.alert({
      windowId: FORCE_QUIT_HOST,
      appId,
      title: isFinder ? { en: `Do you want to relaunch “${name}”?`, ko: `“${name}”을(를) 재실행하겠습니까?` } : { en: `Do you want to force “${name}” to quit?`, ko: `“${name}”을(를) 강제로 종료하겠습니까?` },
      message: S.lost,
      buttons: [
        { label: COMMON.cancel, value: 'cancel', cancel: true },
        { label: isFinder ? S.relaunch : S.forceQuit, value: 'quit', primary: true },
      ],
    });
    if (answer !== 'quit') return;
    await forceQuit(appId);
    if (isFinder) {
      desktopUI.finderRelaunched();
      wm.openWindow('finder');
    }
  };

  /**
   * Selects an app in the list and scrolls its row into view.
   *
   * The row is found through its generated element id.
   *
   * @param {string} appId - App to select.
   * @returns {void}
   *
   * @example
   * pick('finder');
   */
  const pick = (appId: string) => {
    setPicked(appId);
    document.getElementById(`${idPrefix}-${appId}`)?.scrollIntoView?.({ block: 'nearest' });
  };

  /**
   * Moves the selection to an index computed from the current one.
   *
   * `to` receives the current index (0 when nothing is selected) and its result is clamped to
   * the list bounds. Does nothing when no app is running.
   *
   * @param {(i: number) => number} to - Maps the current index to the target index.
   * @returns {void}
   *
   * @example
   * move((i) => i + 1); // next app
   */
  const move = (to: (i: number) => number) => {
    if (!apps.length) return;
    const i = apps.findIndex((a) => a.appId === current);
    pick(apps[Math.max(0, Math.min(apps.length - 1, to(i === -1 ? 0 : i)))].appId);
  };

  /**
   * Selects the first app whose name starts with the typed prefix.
   *
   * Characters typed less than 900 ms apart accumulate into the prefix; a longer pause starts a
   * new one. Matching is case-insensitive on the localized app name.
   *
   * @param {string} ch - Character that was typed.
   * @returns {void}
   *
   * @example
   * typeSelect('f'); // selects Finder
   */
  const typeSelect = (ch: string) => {
    const ta = typeAhead.current;
    const now = performance.now();
    ta.text = (now - ta.at > 900 ? '' : ta.text) + ch.toLowerCase();
    ta.at = now;
    const hit = apps.find((a) => t(a.app.name).toLowerCase().startsWith(ta.text));
    if (hit) pick(hit.appId);
  };

  useModalKeys({
    enabled: !sheetOpen,
    priority: KEY_PRIORITY.forceQuit,
    modal: false,
    panel: panelRef,
    /**
     * Keyboard handling of the panel, active while no confirmation sheet is showing.
     *
     * ⌥⌘⎋ always makes the panel the key window again. While the panel is not key, or focus is
     * in a text field, other keys are left alone. Otherwise Esc, ⌘. and ⌥W close the panel,
     * Return confirms the selected app, arrows and Home/End move the selection, and printable
     * characters type-select.
     *
     * @param {KeyboardEvent} e - Key event routed to the panel.
     * @returns {boolean} True when the key was handled.
     *
     * @example
     * useModalKeys({ enabled: true, priority, modal: false, panel, onKey });
     */
    onKey: (e) => {
      if (isModKey(e) && e.altKey && e.key === 'Escape') {
        activate();
        return true;
      }
      if (!isKey) return false;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
      if (isPlainKey(e, 'Escape') || (isModKey(e) && e.key === '.') || (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyW')) {
        close();
        return true;
      }
      if (isPlainKey(e, 'Enter')) {
        void confirm(current);
        return true;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      const moves: Record<string, (i: number) => number> = {
        /**
         * Targets the next app.
         *
         * `move` clamps the result, so the selection stays on the last app.
         *
         * @param {number} i - Current index.
         * @returns {number} The following index.
         *
         * @example
         * move(moves.ArrowDown);
         */
        ArrowDown: (i) => i + 1,
        /**
         * Targets the previous app.
         *
         * `move` clamps the result, so the selection stays on the first app.
         *
         * @param {number} i - Current index.
         * @returns {number} The preceding index.
         *
         * @example
         * move(moves.ArrowUp);
         */
        ArrowUp: (i) => i - 1,
        /**
         * Targets the first app.
         *
         * Ignores the current index.
         *
         * @returns {number} Index 0.
         *
         * @example
         * move(moves.Home);
         */
        Home: () => 0,
        /**
         * Targets the last app.
         *
         * Ignores the current index.
         *
         * @returns {number} Index of the last running app.
         *
         * @example
         * move(moves.End);
         */
        End: () => apps.length - 1,
      };
      if (moves[e.key]) {
        move(moves[e.key]);
        return true;
      }
      if (e.key.length === 1 && e.key !== ' ') {
        typeSelect(e.key);
        return true;
      }
      return false;
    },
  });

  /**
   * Starts dragging the panel by its title bar.
   *
   * Ignores non-primary buttons and presses on the traffic-light buttons. Records the pointer
   * position, the current offset and vertical limits that keep the panel's top edge below the
   * menu bar and at least 60px above the bottom of the viewport, then captures the pointer.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer press on the title bar.
   * @returns {void}
   *
   * @example
   * <div onPointerDown={onTitlePointerDown} />
   */
  const onTitlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button') || !panelRef.current) return;
    const base = panelRef.current.offsetTop;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, minY: MENU_BAR_HEIGHT - base, maxY: window.innerHeight - base - 60 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  /**
   * Moves the panel while a title-bar drag is in progress.
   *
   * Adds the pointer's movement to the offset recorded at drag start, clamping the vertical
   * offset to the recorded limits. Does nothing when no drag is active.
   *
   * @param {ReactPointerEvent<HTMLDivElement>} e - Pointer move over the title bar.
   * @returns {void}
   *
   * @example
   * <div onPointerMove={onTitlePointerMove} />
   */
  const onTitlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setOffset({ x: d.ox + e.clientX - d.x, y: Math.max(d.minY, Math.min(d.maxY, d.oy + e.clientY - d.y)) });
  };
  /**
   * Ends a title-bar drag.
   *
   * The panel keeps the offset it was dragged to.
   *
   * @returns {void}
   *
   * @example
   * <div onPointerUp={endDrag} onPointerCancel={endDrag} />
   */
  const endDrag = () => {
    drag.current = null;
  };

  const isFinder = current === 'finder';
  const hint = t(S.hint).replace('{k}', formatShortcut(SYSTEM_SHORTCUTS.forceQuit));

  return (
    <div
      ref={panelRef}
      className={`lg lg-thick lg-float ${styles.window} ${isKey ? '' : styles.inactive}`}
      style={{ zIndex: Z.FORCE_QUIT, transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
      role="dialog"
      aria-labelledby={`${idPrefix}-title`}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={styles.titlebar} onPointerDown={onTitlePointerDown} onPointerMove={onTitlePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className={styles.lights}>
          <button type="button" className={`${styles.light} ${styles.close}`} aria-label={t(COMMON.close)} disabled={sheetOpen} onClick={close}>
            <X size={8} strokeWidth={3.2} />
          </button>
          <span className={styles.light} aria-hidden />
          <span className={styles.light} aria-hidden />
        </div>
        <span id={`${idPrefix}-title`} className={styles.title}>
          {t(S.title)}
        </span>
      </div>

      <div className={styles.body}>
        <p className={styles.explain}>{t(S.explain)}</p>
        <div
          ref={listRef}
          className={styles.list}
          role="listbox"
          aria-label={t(S.apps)}
          tabIndex={0}
          aria-activedescendant={current ? `${idPrefix}-${current}` : undefined}
        >
          {apps.map(({ appId, app }) => {
            const Icon = app.icon;
            return (
              <div
                key={appId}
                id={`${idPrefix}-${appId}`}
                role="option"
                aria-selected={appId === current}
                className={`${styles.row} ${appId === current ? styles.selected : ''}`}
                onMouseDown={() => setPicked(appId)}
                onDoubleClick={() => void confirm(appId)}
              >
                <span className={styles.appIcon}>
                  <Icon size={20} />
                </span>
                <span className={styles.appName}>{t(app.name)}</span>
              </div>
            );
          })}
        </div>
        <div className={styles.footer}>
          <span className={styles.hint}>{hint}</span>
          <Button variant="primary" className={styles.action} disabled={!current || sheetOpen} onClick={() => void confirm(current)}>
            {t(isFinder ? S.relaunch : S.forceQuit)}
          </Button>
        </div>
      </div>

      <SheetHost hostId={FORCE_QUIT_HOST} active={isKey} topInset={TITLEBAR_HEIGHT} sheetPriority={KEY_PRIORITY.forceQuitSheet} />
    </div>
  );
}

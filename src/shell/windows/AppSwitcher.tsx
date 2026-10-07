/**
 * ⌥Tab application switcher (⌘Tab belongs to the host OS). While ⌥ is held: Tab / ⇧Tab and the
 * arrow keys move through running apps in most-recently-used order, Q quits and H hides the
 * highlighted app, Esc cancels. Releasing ⌥ activates the highlighted app.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getApp, useSystem, useT, useUI, useWM, wm } from '@/kernel';
import { useRefraction } from '@/components/Glass';
import { Z } from '../layers';
import { cx, useViewport } from './state';
import s from './AppSwitcher.module.css';

const S = {
  title: { en: 'App Switcher', ko: '앱 전환기' },
}; /** Localized strings for the app switcher. */

/**
 * Lists the running apps in most-recently-used order.
 *
 * Keeps the MRU entries whose app is still running (Finder always counts as running), then
 * appends Finder and any running app missing from the MRU list in process order.
 *
 * @param {string[]} mru - App ids, most recently activated first.
 * @returns {string[]} App ids for the switcher, most recently used first.
 *
 * @example
 * switcherOrder(['notes', 'finder', 'terminal']); // ['notes', 'finder'] once Terminal has quit
 */
function switcherOrder(mru: string[]): string[] {
  const running = useWM.getState().processes.map((p) => p.appId);
  const alive = new Set([...running, 'finder']);
  const list = mru.filter((a) => alive.has(a));
  for (const a of ['finder', ...running]) if (!list.includes(a)) list.push(a);
  return list;
}

/**
 * Brings an app forward the way ⌘Tab does.
 *
 * An app with windows is relaunched through `wm.launch`, which restores and unhides its
 * windows; an app without windows is unhidden and made the active app.
 *
 * @param {string} appId - Id of the app to activate.
 * @returns {void}
 *
 * @example
 * activate('notes');
 */
function activate(appId: string): void {
  if (useWM.getState().windows.some((w) => w.appId === appId)) wm.launch(appId);
  else {
    wm.unhideApp(appId);
    wm.activateApp(appId);
  }
}

/**
 * ⌥Tab application switcher HUD.
 *
 * Listens for ⌥Tab on the window (capture phase, only while the desktop is showing). The first
 * press snapshots the running apps in most-recently-used order and highlights the previously
 * used app (⇧⌥Tab starts from the end). While ⌥ is held, Tab / ⇧Tab and ← / → move the
 * highlight, Q quits and H hides the highlighted app, Enter activates it and Esc cancels; every
 * other key is swallowed so it can't reach the front app. Releasing ⌥ (or a key press that
 * arrives without ⌥ because its release was missed) activates the highlighted app, and the
 * window losing focus closes the switcher. Hovering an item highlights it and clicking it
 * activates it.
 *
 * The MRU order is tracked from `activeAppId` changes for as long as the component is mounted.
 * When a highlighted app quits, the highlight is clamped to the shortened list. Icons shrink
 * (between 24 and 80 px) when many apps are running so the HUD, with its 16px screen margins,
 * 14px padding and 20px per-item gutter, always fits the viewport.
 *
 * @returns {JSX.Element | null} The switcher HUD, or null while it is closed.
 *
 * @example
 * <AppSwitcher />
 */
export function AppSwitcher() {
  const t = useT();
  const index = useUI((u) => u.appSwitcher);
  const processes = useWM((st) => st.processes);
  const viewport = useViewport();
  const [order, setOrder] = useState<string[]>([]);
  const mruRef = useRef<string[]>([]);
  const appsRef = useRef<string[]>([]);
  const hudRef = useRefraction<HTMLDivElement>();

  const apps = useMemo(() => {
    const running = new Set(processes.map((p) => p.appId));
    return order.filter((a) => a === 'finder' || running.has(a));
  }, [order, processes]);

  useLayoutEffect(() => {
    appsRef.current = apps;
  }, [apps]);

  useEffect(() => {
    if (index !== null && apps.length && index >= apps.length) useUI.getState().set({ appSwitcher: apps.length - 1 });
  }, [index, apps.length]);

  useEffect(() => {
    /**
     * Moves an app to the front of the most-recently-used list.
     *
     * Removes any earlier entry for the app, so every id appears in the list at most once.
     *
     * @param {string} appId - Id of the app that was activated.
     * @returns {void}
     *
     * @example
     * touch(useWM.getState().activeAppId);
     */
    const touch = (appId: string) => {
      mruRef.current = [appId, ...mruRef.current.filter((a) => a !== appId)];
    };
    touch(useWM.getState().activeAppId);
    return useWM.subscribe((st, prev) => {
      if (st.activeAppId !== prev.activeAppId) touch(st.activeAppId);
    });
  }, []);

  useEffect(() => {
    /**
     * Reads the current UI store state.
     *
     * Reads the store on every call rather than capturing a snapshot, so the long-lived key
     * handlers always see the latest highlight index.
     *
     * @returns {ReturnType<typeof useUI.getState>} The UI state.
     *
     * @example
     * ui().set({ appSwitcher: null });
     */
    const ui = () => useUI.getState();
    /**
     * Tells whether the switcher is showing.
     *
     * The switcher is open whenever the UI store's `appSwitcher` highlight index is not null.
     *
     * @returns {boolean} True while a highlight index is set.
     *
     * @example
     * if (!isOpen()) return;
     */
    const isOpen = () => ui().appSwitcher !== null;
    /**
     * Returns the id of the highlighted app.
     *
     * Looks the highlight index up in the snapshot of apps the switcher is showing.
     *
     * @returns {string | undefined} The highlighted app id, or undefined while closed.
     *
     * @example
     * const appId = highlighted();
     */
    const highlighted = () => {
      const i = ui().appSwitcher;
      return i === null ? undefined : appsRef.current[i];
    };
    /**
     * Moves the highlight by a number of items, wrapping around at both ends.
     *
     * Starts from index 0 when nothing is highlighted and does nothing while the app list is
     * empty.
     *
     * @param {number} delta - Items to move (negative goes backwards).
     * @returns {void}
     *
     * @example
     * step(e.shiftKey ? -1 : 1);
     */
    const step = (delta: number) => {
      const n = appsRef.current.length;
      if (n) ui().set({ appSwitcher: ((ui().appSwitcher ?? 0) + delta + n) % n });
    };
    /**
     * Hides the switcher without activating anything.
     *
     * Clears the UI store's highlight index, which unmounts the HUD.
     *
     * @returns {void}
     *
     * @example
     * close();
     */
    const close = () => ui().set({ appSwitcher: null });
    /**
     * Hides the switcher and activates the highlighted app.
     *
     * Reads the highlighted app before closing (closing clears the index), then brings that app
     * forward with `activate`. Does nothing beyond closing when no app is highlighted.
     *
     * @returns {void}
     *
     * @example
     * commit();
     */
    const commit = () => {
      const appId = highlighted();
      close();
      if (appId) activate(appId);
    };

    /**
     * Handles ⌥Tab and the keys typed while the switcher is open.
     *
     * ⌥Tab opens the switcher (only on the desktop) with a fresh MRU snapshot and highlights the
     * previously used app, or the last one with ⇧; when it is already open it steps forward or
     * backward. While open, every key is consumed (so ⌥Q can't quit the front app): a key without
     * ⌥ means ⌥ was released unseen and commits, Esc closes, ← / → step, Enter commits, Q quits
     * the highlighted app unless it is persistent (Finder) and H hides it.
     *
     * @param {KeyboardEvent} e - The captured keydown event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keydown', onKeyDown, true);
     */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.altKey && !e.ctrlKey && !e.metaKey) {
        if (useSystem.getState().power !== 'desktop') return;
        e.preventDefault();
        e.stopPropagation();
        if (isOpen()) {
          step(e.shiftKey ? -1 : 1);
          return;
        }
        const list = switcherOrder(mruRef.current);
        appsRef.current = list;
        setOrder(list);
        ui().set({ appSwitcher: list.length > 1 ? (e.shiftKey ? list.length - 1 : 1) : 0 });
        return;
      }
      if (!isOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.altKey && e.key !== 'Alt') {
        commit();
        return;
      }
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Enter') commit();
      else if (e.code === 'KeyQ') {
        const appId = highlighted();
        if (appId && !getApp(appId)?.persistent) void wm.quit(appId);
      } else if (e.code === 'KeyH') {
        const appId = highlighted();
        if (appId) wm.hideApp(appId);
      }
    };
    /**
     * Activates the highlighted app when ⌥ is released.
     *
     * Ignores key-ups while closed and those of other keys while ⌥ is still held.
     *
     * @param {KeyboardEvent} e - The captured keyup event.
     * @returns {void}
     *
     * @example
     * window.addEventListener('keyup', onKeyUp, true);
     */
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isOpen() || (e.key !== 'Alt' && e.altKey)) return;
      e.preventDefault();
      e.stopPropagation();
      commit();
    };
    /**
     * Closes the switcher when the browser window loses focus.
     *
     * The ⌥ key-up can't be observed once the window is blurred, so the switcher is cancelled
     * instead of committing to the highlighted app.
     *
     * @returns {void}
     *
     * @example
     * window.addEventListener('blur', onBlur);
     */
    const onBlur = () => {
      if (isOpen()) close();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  if (index === null || !apps.length) return null;

  const size = Math.max(24, Math.min(80, Math.floor((viewport.width - 32 - 28) / apps.length) - 20));

  return (
    <div className={s.root} style={{ zIndex: Z.APP_SWITCHER }}>
      <div ref={hudRef} className={cx('lg lg-float', s.hud)} role="listbox" aria-label={t(S.title)} aria-activedescendant={`appswitcher-${apps[index] ?? ''}`}>
        {apps.map((appId, i) => {
          const app = getApp(appId);
          const Icon = app?.icon;
          return (
            <div
              key={appId}
              id={`appswitcher-${appId}`}
              role="option"
              aria-selected={i === index}
              className={cx(s.item, i === index && 'lg lg-control', i === index && s.selected)}
              style={{ width: size + 20 }}
              onPointerEnter={() => useUI.getState().set({ appSwitcher: i })}
              onClick={() => {
                useUI.getState().set({ appSwitcher: null });
                activate(appId);
              }}
            >
              <span className={s.icon} style={{ width: size, height: size }}>
                {Icon && <Icon size={size} />}
              </span>
              <span className={cx(s.name, i === index && 'lg lg-thick lg-capsule')}>{app ? t(app.name) : appId}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

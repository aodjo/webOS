/**
 * Desktop-only UI state: which widgets are on the desktop (persisted per browser), the widget
 * edit mode, and a signal used when Finder is relaunched from Force Quit.
 */
import { create } from 'zustand';

/** Identifier of a desktop widget. */
export type WidgetId = 'clock' | 'now';
export const WIDGET_IDS: WidgetId[] = ['clock', 'now']; /** Every desktop widget, in display order. */

const STORAGE_KEY = 'webos.widgets'; /** localStorage key holding the widget visibility map. */

/** Whether each widget is shown on the desktop. */
type WidgetVisibility = Record<WidgetId, boolean>;

/**
 * Reads the saved widget visibility from localStorage.
 *
 * Every widget defaults to visible; a widget is hidden only when the saved map stores `false`
 * for it, so widgets absent from the saved map are shown. Missing, malformed or inaccessible
 * storage yields the all-visible default.
 *
 * @returns {WidgetVisibility} The visibility of every widget.
 *
 * @example
 * const widgets = load(); // { clock: true, now: true }
 */
function load(): WidgetVisibility {
  const all: WidgetVisibility = { clock: true, now: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') for (const id of WIDGET_IDS) all[id] = (saved as Record<string, unknown>)[id] !== false;
  } catch {
    /* storage unavailable: show everything */
  }
  return all;
}

/**
 * Saves the widget visibility to localStorage.
 *
 * Write failures (private mode, quota, blocked storage) are ignored, so the change only lasts
 * for the current session.
 *
 * @param {WidgetVisibility} v - The visibility map to save.
 * @returns {void}
 *
 * @example
 * persist({ clock: true, now: false });
 */
function persist(v: WidgetVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/** State of the desktop UI store. */
interface DesktopUIState {
  /** Which widgets are shown on the desktop. */
  widgets: WidgetVisibility;
  /** True while widget edit mode (remove buttons and the widget gallery) is active. */
  editingWidgets: boolean;
  /** Bumped whenever Finder is relaunched; the desktop icons blink back in, like macOS. */
  finderRelaunches: number;
}

export const useDesktopUI = create<DesktopUIState>()(() => ({ widgets: load(), editingWidgets: false, finderRelaunches: 0 })); /** Zustand store for desktop widgets, widget edit mode and Finder relaunches. */

export const desktopUI = {
  /**
   * Shows or hides one desktop widget.
   *
   * Updates the store and saves the new visibility map to localStorage.
   *
   * @param {WidgetId} id - The widget to change.
   * @param {boolean} visible - True to show the widget, false to remove it.
   * @returns {void}
   *
   * @example
   * desktopUI.setWidget('clock', false);
   */
  setWidget(id: WidgetId, visible: boolean): void {
    useDesktopUI.setState((s) => {
      const widgets = { ...s.widgets, [id]: visible };
      persist(widgets);
      return { widgets };
    });
  },
  /**
   * Enters or leaves widget edit mode.
   *
   * The store is only updated when the value actually changes, so subscribers are not notified
   * for no-op calls.
   *
   * @param {boolean} editingWidgets - True to open the widget editor, false to close it.
   * @returns {void}
   *
   * @example
   * desktopUI.setEditing(true);
   */
  setEditing(editingWidgets: boolean): void {
    if (useDesktopUI.getState().editingWidgets !== editingWidgets) useDesktopUI.setState({ editingWidgets });
  },
  /**
   * Signals that Finder was relaunched.
   *
   * Increments `finderRelaunches`. The desktop watches the counter to clear its selection,
   * rename field and Quick Look, and remounts its icons so they blink back in.
   *
   * @returns {void}
   *
   * @example
   * desktopUI.finderRelaunched();
   */
  finderRelaunched(): void {
    useDesktopUI.setState((s) => ({ finderRelaunches: s.finderRelaunches + 1 }));
  },
}; /** Actions that update the desktop UI store. */

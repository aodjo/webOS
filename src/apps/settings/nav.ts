import { createContext, useContext } from 'react';

/** Navigation context that System Settings provides to its pane components. */
export interface SettingsNav {
  /** Id of the Settings window the pane is rendered in. */
  windowId: string;
  /** Navigate to another pane (pushes onto the back/forward history). */
  go: (paneId: string) => void;
  /** Element covering the whole window that in-window sheets portal into. */
  sheetHost: HTMLElement | null;
}

export const NavContext = createContext<SettingsNav | null>(null); /** React context carrying the `SettingsNav` of the enclosing Settings window (`null` outside it). */

/**
 * Returns the window id and navigation helpers for a Settings pane component.
 *
 * Reads `NavContext`, which the Settings app provides around every pane.
 *
 * @returns {SettingsNav} The enclosing window's id, `go` navigator and sheet host element.
 * @throws {Error} When called outside the System Settings component tree.
 *
 * @example
 * const { windowId, go } = useNav();
 * return <NavRow label="Wallpaper" onClick={() => go('wallpaper')} />;
 */
export function useNav(): SettingsNav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside System Settings');
  return nav;
}

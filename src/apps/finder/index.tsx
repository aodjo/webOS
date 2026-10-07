/**
 * Finder app entry. Renders a browser window by default, or the Get Info panel when
 * `args.view === 'info'` (opened by the kernel's `openGetInfo`).
 */
import type { AppProps } from '@/kernel';
import { FinderBrowser } from './Browser';
import { GetInfo } from './GetInfo';

/**
 * Finder window component.
 *
 * Chooses the window content from the launch arguments: the Get Info panel for
 * `args.view === 'info'`, otherwise the file browser. All props are passed through.
 *
 * @param {AppProps} props - Window props supplied by the window manager.
 * @returns {JSX.Element} The Get Info panel or the Finder browser.
 *
 * @example
 * wm.openWindow('finder', { path: PATHS.documents });
 * wm.openWindow('finder', { view: 'info', path: PATHS.documents });
 */
export default function Finder(props: AppProps) {
  return props.args.view === 'info' ? <GetInfo {...props} /> : <FinderBrowser {...props} />;
}

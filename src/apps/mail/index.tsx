/**
 * Mail — the portfolio's contact channel. One app, three kinds of windows:
 * the viewer (mailboxes / list / message), a compose window and a single-message window.
 */
import type { AppProps } from '@/kernel';
import { Compose } from './ComposeWindow';
import { MessageWindow, Viewer } from './Viewer';

/**
 * Root component of the Mail app, rendered once per Mail window.
 *
 * Picks the window kind from the window args: `compose` (or a string `to`) renders the
 * compose window, a string `messageId` renders a standalone message window, and anything
 * else renders the main viewer.
 *
 * @param {AppProps} props - Props passed by the window manager.
 * @param {string} props.windowId - Id of the window hosting this component.
 * @param {AppArgs} props.args - Window args that select which kind of window to render.
 * @returns {JSX.Element} The compose window, message window or viewer.
 *
 * @example
 * <Mail windowId="w1" args={{ messageId: 'welcome' }} />
 */
export default function Mail({ windowId, args }: AppProps) {
  if (args.compose || typeof args.to === 'string') return <Compose windowId={windowId} args={args} />;
  if (typeof args.messageId === 'string') return <MessageWindow windowId={windowId} messageId={args.messageId} />;
  return <Viewer windowId={windowId} />;
}

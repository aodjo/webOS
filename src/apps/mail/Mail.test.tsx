import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowContext, useBadges, useDialogs, useMenus, useNotifications, useWM, wm, type AlertRequest, type AppArgs } from '@/kernel';
import '@/apps';
import { owner } from '@/data/portfolio';
import Mail from './index';
import { COMPOSE_WINDOW } from './compose';
import { useMail } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; /** React root of the currently mounted Mail window, unmounted after each test. */
let host: HTMLDivElement | null = null; /** Container element of the currently mounted Mail window. */
const errors = vi.spyOn(console, 'error'); /** Spy on console.error; each test asserts that nothing was logged as an error. */

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  wm.killAll();
  useMail.setState({ seed: {}, messages: [], seededAt: Date.now(), lastChecked: 0 });
  useDialogs.setState({ queue: [] });
});

/**
 * Opens a Mail window and renders its component into the document.
 *
 * Creates the window through the window manager, then renders `<Mail>` inside a
 * `WindowContext` provider so kernel hooks resolve to that window. The root and host are kept
 * in module variables so `afterEach` can unmount them.
 *
 * @param {AppArgs} [args={}] - Window args, e.g. `{ compose: true, to: '…' }` for a compose window.
 * @returns {{ id: string, host: HTMLDivElement }} The window id and the container element.
 *
 * @example
 * const { id, host } = mount({ compose: true });
 * host.querySelector('textarea');
 */
function mount(args: AppArgs = {}) {
  const id = wm.openWindow('mail', args)!;
  const win = useWM.getState().windows.find((w) => w.id === id)!;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <WindowContext.Provider value={{ id, pid: win.pid, appId: 'mail' }}>
        <Mail windowId={id} pid={win.pid} args={args} />
      </WindowContext.Provider>,
    ),
  );
  return { id, host };
}

/**
 * Types a value into a controlled input or textarea.
 *
 * Calls the native `value` setter from the element's prototype (bypassing React's value
 * tracking) and dispatches a bubbling `input` event, so React's onChange fires as it would for
 * real typing.
 *
 * @param {HTMLInputElement | HTMLTextAreaElement} el - The field to change.
 * @param {string} text - The new value.
 * @returns {void} Nothing.
 *
 * @example
 * setValue(host.querySelector('textarea')!, 'Hello');
 */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Mail window', () => {
  it('lists the seeded inbox, reads a message and badges the Dock', () => {
    const { host } = mount();
    const rows = host.querySelectorAll('[role="option"]');
    expect(rows).toHaveLength(4);
    expect(useBadges.getState().badges.mail).toBe('4');
    act(() => rows[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(host.querySelector('article')?.textContent).toContain('Welcome');
    expect(useBadges.getState().badges.mail).toBe('3');
    const flagged = [...host.querySelectorAll('nav button')].find((b) => b.textContent?.includes('Flagged'))!;
    act(() => (flagged as HTMLButtonElement).click());
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it('offers a Back button that returns from the message to the list (stacked phone layout)', () => {
    const { host } = mount();
    expect(host.querySelector('button[aria-label="Back"]')).toBeNull();
    const row = host.querySelector('[role="option"]')!;
    act(() => row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    const back = host.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!;
    expect(back).not.toBeNull();
    expect(host.querySelector('article')).not.toBeNull();
    act(() => back.click());
    expect(host.querySelector('button[aria-label="Back"]')).toBeNull();
    expect(host.querySelector('article')).toBeNull();
    expect(host.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(0);
  });

  it('asks to save a draft when closing a compose window with content', async () => {
    const { id, host } = mount({ compose: true, to: 'hello@example.com' });
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('hello@example.com');
    setValue(host.querySelectorAll('input')[2], 'Hi!');
    setValue(host.querySelector('textarea')!, 'Nice OS.');
    let closed: Promise<boolean> | undefined;
    await act(async () => {
      closed = wm.close(id);
    });
    const dialog = useDialogs.getState().queue[0] as AlertRequest;
    expect(dialog.kind).toBe('alert');
    await act(async () => dialog.resolve('save'));
    expect(await closed).toBe(true);
    const drafts = useMail.getState().messages.filter((m) => m.mailbox === 'drafts');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subject).toBe('Hi!');
    expect(errors).not.toHaveBeenCalled();
  });

  it('a compose window opened directly gets the owner address and the compose size', () => {
    const { id, host } = mount({ compose: true });
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe(owner.email);
    const win = useWM.getState().windows.find((w) => w.id === id)!;
    expect([win.width, win.height]).toEqual([COMPOSE_WINDOW.width, COMPOSE_WINDOW.height]);
    expect(document.activeElement).toBe(host.querySelectorAll('input')[2]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('autosaves drafts while typing and deletes them when asked', async () => {
    vi.useFakeTimers();
    try {
      const { id, host } = mount({ compose: true, to: 'hello@example.com' });
      setValue(host.querySelectorAll('input')[2], 'Draft subject');
      act(() => vi.advanceTimersByTime(2100));
      expect(useMail.getState().messages.filter((m) => m.mailbox === 'drafts').map((m) => m.subject)).toEqual(['Draft subject']);
      let closed: Promise<boolean> | undefined;
      await act(async () => {
        closed = wm.close(id);
      });
      await act(async () => (useDialogs.getState().queue[0] as AlertRequest).resolve('delete'));
      expect(await closed).toBe(true);
      expect(useMail.getState().messages.filter((m) => m.mailbox === 'drafts')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it('drops an autosaved draft without asking once its content is erased', async () => {
    vi.useFakeTimers();
    try {
      const { id, host } = mount({ compose: true, to: 'hello@example.com' });
      const subject = host.querySelectorAll('input')[2];
      setValue(subject, 'Oops');
      act(() => vi.advanceTimersByTime(2100));
      setValue(subject, '');
      await act(async () => {
        await wm.close(id);
      });
      expect(useDialogs.getState().queue).toHaveLength(0);
      expect(useMail.getState().messages).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it('sends: files the message in Sent and hands off to the mail client', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { id, host } = mount({ compose: true, to: 'hello@example.com', subject: 'Hello' });
    setValue(host.querySelector('textarea')!, 'Body');
    const send = useMenus.getState().byWindow[id].find((m) => (typeof m.label === 'string' ? m.label : m.label.en) === 'Message')!.items[0];
    await act(async () => send.action!());
    expect(click).toHaveBeenCalled();
    expect(useMail.getState().messages.find((m) => m.mailbox === 'sent')?.subject).toBe('Hello');
    expect(useNotifications.getState().items[0].appId).toBe('mail');
    expect(useWM.getState().windows.find((w) => w.id === id)).toBeUndefined();
    click.mockRestore();
    expect(errors).not.toHaveBeenCalled();
  });
});

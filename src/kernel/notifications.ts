import { create } from 'zustand';
import type { LString, Notification } from './types';
import { useSystem } from './system';

interface NotificationsState {
  /** Posted notifications, newest first (at most 50), as listed in Notification Center. */
  items: Notification[];
  /** Ids of notifications currently shown as banners (top-right). */
  banners: string[];
}

export const useNotifications = create<NotificationsState>()(() => ({ items: [], banners: [] })); /** Store of posted notifications and the banners currently on screen. */

let n = 0; /** Counter used to generate unique notification ids ("n1", "n2", …). */

/**
 * Posts a notification.
 *
 * Adds it to the top of Notification Center (keeping at most 50 items) and shows it as a banner
 * that is dismissed automatically after 5 seconds. No banner is shown when Do Not Disturb is on or
 * when banners are turned off for the app in System Settings → Notifications (`mutedApps`); the
 * notification is still recorded in that case.
 *
 * @param {Object} opts - Notification options.
 * @param {string} opts.appId - Id of the app posting the notification.
 * @param {LString} opts.title - Title of the notification.
 * @param {LString} [opts.body] - Optional body text.
 * @param {() => void} [opts.onClick] - Called when the notification is clicked.
 * @returns {string} The id of the new notification.
 *
 * @example
 * const id = notify({ appId: 'mail', title: { en: 'New message', ko: '새 메시지' } });
 */
export function notify(opts: { appId: string; title: LString; body?: LString; onClick?: () => void }): string {
  const id = `n${++n}`;
  const item: Notification = { id, appId: opts.appId, title: opts.title, body: opts.body, onClick: opts.onClick, createdAt: Date.now(), read: false };
  const { doNotDisturb, mutedApps } = useSystem.getState().settings;
  const dnd = doNotDisturb || (mutedApps ?? []).includes(opts.appId);
  useNotifications.setState((s) => ({
    items: [item, ...s.items].slice(0, 50),
    banners: dnd ? s.banners : [...s.banners, id],
  }));
  if (!dnd) setTimeout(() => dismissBanner(id), 5000);
  return id;
}

/**
 * Hides a notification's banner.
 *
 * Removes the id from the visible banners only; the notification stays in Notification Center.
 *
 * @param {string} id - Id of the notification whose banner is hidden.
 * @returns {void}
 *
 * @example
 * dismissBanner(id);
 */
export function dismissBanner(id: string): void {
  useNotifications.setState((s) => ({ banners: s.banners.filter((b) => b !== id) }));
}

/**
 * Removes a notification entirely.
 *
 * Deletes it from Notification Center and hides its banner if it is still showing.
 *
 * @param {string} id - Id of the notification to remove.
 * @returns {void}
 *
 * @example
 * removeNotification(id);
 */
export function removeNotification(id: string): void {
  useNotifications.setState((s) => ({ items: s.items.filter((i) => i.id !== id), banners: s.banners.filter((b) => b !== id) }));
}

/**
 * Clears every notification.
 *
 * Empties Notification Center and hides all banners.
 *
 * @returns {void}
 *
 * @example
 * clearNotifications();
 */
export function clearNotifications(): void {
  useNotifications.setState({ items: [], banners: [] });
}

/**
 * Marks every notification as read.
 *
 * Sets `read: true` on all items in Notification Center without removing them.
 *
 * @returns {void}
 *
 * @example
 * markAllRead();
 */
export function markAllRead(): void {
  useNotifications.setState((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) }));
}

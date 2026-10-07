/**
 * Focus (Do Not Disturb) and Notifications (per-app banners). Both are enforced by the kernel's
 * `notify()`: Do Not Disturb or a muted app means no banner, only a Notification Center entry.
 */
import { BellOff, Moon } from 'lucide-react';
import { Select, Switch } from '@/components/ui';
import { listApps, useSystem, useT } from '@/kernel';
import { NavRow, Pane, PaneIcon, Row, Section, SwitchRow } from '../kit';
import { useNav } from '../nav';
import { setPrefs, usePrefs, type NotificationPreviews } from '../prefs';
import s from './panes.module.css';

const S = {
  dnd: { en: 'Do Not Disturb', ko: '방해 금지 모드' },
  dndOn: { en: 'On — notifications are silenced', ko: '켬 — 알림이 무음 처리됨' },
  dndOff: { en: 'Off', ko: '끔' },
  dndFooter: {
    en: 'While Do Not Disturb is on, notification banners are hidden. Notifications still collect in Notification Center.',
    ko: '방해 금지 모드가 켜져 있는 동안에는 알림 배너가 표시되지 않습니다. 알림은 알림 센터에 계속 쌓입니다.',
  },

  center: { en: 'Notification Center', ko: '알림 센터' },
  previews: { en: 'Show previews', ko: '미리보기 보기' },
  always: { en: 'Always', ko: '항상' },
  unlocked: { en: 'When Unlocked', ko: '잠금 해제 시' },
  never: { en: 'Never', ko: '안 함' },
  whenLocked: { en: 'Allow notifications when the screen is locked', ko: '화면이 잠겨 있을 때 알림 허용' },
  dndActive: { en: 'Do Not Disturb is on', ko: '방해 금지 모드가 켜져 있음' },
  appNotifications: { en: 'Application Notifications', ko: '응용 프로그램 알림' },
  appFooter: { en: 'Turning an app off hides its banners; its notifications still appear in Notification Center.', ko: '앱을 끄면 해당 앱의 배너가 표시되지 않으며, 알림은 알림 센터에 계속 표시됩니다.' },
  banners: { en: 'Banners', ko: '배너' },
  off: { en: 'Off', ko: '끔' },
}; /** Localized strings for the Focus and Notifications panes. */

/**
 * Renders the Focus settings pane.
 *
 * A single switch bound to `settings.doNotDisturb`, with a sublabel describing the current state
 * and a footer explaining that banners are hidden while notifications still collect in
 * Notification Center.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <FocusPane />
 */
export function FocusPane() {
  const t = useT();
  const dnd = useSystem((x) => x.settings.doNotDisturb);
  const update = useSystem((x) => x.updateSettings);
  return (
    <Pane>
      <Section footer={t(S.dndFooter)}>
        <Row label={<strong>{t(S.dnd)}</strong>} sublabel={t(dnd ? S.dndOn : S.dndOff)} leading={<PaneIcon icon={Moon} color="#5e5ce6" size={28} />}>
          <Switch checked={dnd} onChange={(v) => update({ doNotDisturb: v })} label={t(S.dnd)} />
        </Row>
      </Section>
    </Pane>
  );
}

/**
 * Renders the Notifications settings pane.
 *
 * While Do Not Disturb is on, a row at the top links to the Focus pane. The Notification Center
 * section binds the preview mode and the lock-screen switch to this app's prefs. The Application
 * Notifications section lists every app that has a window component, each with a switch that
 * shows or mutes its banners by removing or adding its id in `settings.mutedApps`.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <NotificationsPane />
 */
export function NotificationsPane() {
  const t = useT();
  const { go } = useNav();
  const dnd = useSystem((x) => x.settings.doNotDisturb);
  const muted = useSystem((x) => x.settings.mutedApps);
  const update = useSystem((x) => x.updateSettings);
  const previews = usePrefs((p) => p.notificationPreviews);
  const whenLocked = usePrefs((p) => p.notifyOnLockScreen);
  const apps = listApps().filter((a) => a.component);

  /**
   * Shows or mutes banners for one app.
   *
   * Reads the latest muted list from the system store and either removes the app id from it or
   * adds the id (without duplicates) before saving it back to settings.
   *
   * @param {string} appId - Id of the app to update.
   * @param {boolean} allowed - True to show the app's banners, false to mute them.
   * @returns {void}
   *
   * @example
   * setAllowed('mail', false); // mute Mail banners
   */
  const setAllowed = (appId: string, allowed: boolean) => {
    const current = useSystem.getState().settings.mutedApps ?? [];
    update({ mutedApps: allowed ? current.filter((id) => id !== appId) : [...new Set([...current, appId])] });
  };

  return (
    <Pane>
      {dnd && (
        <Section>
          <NavRow icon={BellOff} color="#5e5ce6" label={t(S.dndActive)} onClick={() => go('focus')} />
        </Section>
      )}
      <Section title={t(S.center)}>
        <Row label={t(S.previews)}>
          <Select<NotificationPreviews>
            value={previews}
            onChange={(v) => setPrefs({ notificationPreviews: v })}
            options={[
              { value: 'always', label: t(S.always) },
              { value: 'unlocked', label: t(S.unlocked) },
              { value: 'never', label: t(S.never) },
            ]}
          />
        </Row>
        <SwitchRow label={t(S.whenLocked)} checked={whenLocked} onChange={(v) => setPrefs({ notifyOnLockScreen: v })} />
      </Section>
      <Section title={t(S.appNotifications)} footer={t(S.appFooter)}>
        {apps.map((app) => {
          const Icon = app.icon;
          const allowed = !(muted ?? []).includes(app.id);
          return (
            <Row
              key={app.id}
              label={t(app.name)}
              sublabel={t(allowed ? S.banners : S.off)}
              leading={
                <span className={s.appIcon}>
                  <Icon size={24} />
                </span>
              }
            >
              <Switch checked={allowed} onChange={(v) => setAllowed(app.id, v)} label={t(app.name)} />
            </Row>
          );
        })}
      </Section>
    </Pane>
  );
}

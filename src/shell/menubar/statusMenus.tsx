/**
 * Contents of the Wi-Fi, Focus, Battery and input source status menus (Sonoma layout: a title
 * row with a control, section headings, then a settings link).
 */
import { Lock } from 'lucide-react';
import type { Locale, LString } from '@/kernel/types';
import { wm } from '@/kernel/wm';
import { useSystem } from '@/kernel/system';
import { fmt, tr } from '@/kernel/i18n';
import { Switch } from '@/components/ui';
import { MenuHeaderRow, type MenuEntry } from '@/components/Menu';
import { NETWORKS, joinNetwork, type WifiNetwork } from './status';
import { FocusBadge, NetworkBadge } from './glyphs';
import { formatHM } from './format';
import type { BatteryState } from './battery';

const S = {
  wifi: 'Wi-Fi',
  knownNetwork: { en: 'Known Network', ko: '알려진 네트워크' },
  knownNetworks: { en: 'Known Networks', ko: '알려진 네트워크' },
  otherNetworks: { en: 'Other Networks', ko: '기타 네트워크' },
  connecting: { en: 'Connecting…', ko: '연결 중…' },
  wifiSettings: { en: 'Open Wi-Fi Settings…', ko: 'Wi-Fi 설정 열기…' },
  wifiOn: { en: 'Turn Wi-Fi on', ko: 'Wi-Fi 켜기' },
  focus: { en: 'Focus', ko: '집중 모드' },
  dnd: { en: 'Do Not Disturb', ko: '방해 금지 모드' },
  focusOn: { en: 'On', ko: '켬' },
  focusSettings: { en: 'Focus Settings…', ko: '집중 모드 설정…' },
  battery: { en: 'Battery', ko: '배터리' },
  sourceBattery: { en: 'Power Source: Battery', ko: '전원: 배터리' },
  sourceAdapter: { en: 'Power Source: Power Adapter', ko: '전원: 전원 어댑터' },
  charged: { en: 'Battery Is Charged', ko: '배터리 충전 완료' },
  charging: { en: 'Charging', ko: '충전 중' },
  untilFull: { en: '{t} until full', ko: '완전 충전까지 {t}' },
  remaining: { en: '{t} remaining', ko: '{t} 남음' },
  energy: { en: 'Using Significant Energy', ko: '상당한 에너지 사용 중' },
  noApps: { en: 'No Apps Using Significant Energy', ko: '상당한 에너지를 사용하는 앱 없음' },
  activityMonitor: { en: 'Open Activity Monitor…', ko: '활성 상태 보기 열기…' },
  abc: { en: 'ABC — English', ko: 'ABC — 영어' },
  korean: { en: '2-Set Korean — 한국어', ko: '두벌식 — 한국어' },
  keyboardSettings: { en: 'Open Keyboard Settings…', ko: '키보드 설정 열기…' },
} satisfies Record<string, LString>; /** Localized strings for the Wi-Fi, Focus, Battery and input source menus. */

/**
 * Fills the `{t}` placeholder of a localized template with a time.
 *
 * Formats the English and Korean templates separately, so the result is a regular `LString`
 * that the menu renders in the current locale.
 *
 * @param {{ en: string; ko: string }} s - Template with a `{t}` placeholder in each locale.
 * @param {string} time - Formatted duration (e.g. `1:05`) substituted into both locales.
 * @returns {LString} The localized string with the time filled in.
 *
 * @example
 * const label = withTime(S.remaining, '2:30');
 * label.en; // '2:30 remaining'
 */
const withTime = (s: { en: string; ko: string }, time: string): LString => ({ en: fmt(s.en, { t: time }), ko: fmt(s.ko, { t: time }) });

/**
 * Builds the menu row for one Wi-Fi network.
 *
 * The row shows the signal-strength badge (highlighted when joined), a "Connecting…" label
 * while that network is being joined, and a lock for secured networks. Choosing it joins the
 * network; the joined network's row has no action.
 *
 * @param {WifiNetwork} n - The network the row represents.
 * @param {boolean} connected - Whether this network is the joined one.
 * @param {boolean} connecting - Whether this network is being joined right now.
 * @param {Locale} locale - Locale for the "Connecting…" label.
 * @returns {MenuEntry} The menu entry for the network.
 *
 * @example
 * const row = networkEntry(NETWORKS[0], true, false, 'en');
 * row.action; // undefined (already joined)
 */
function networkEntry(n: WifiNetwork, connected: boolean, connecting: boolean, locale: Locale): MenuEntry {
  return {
    label: n.ssid,
    leading: <NetworkBadge strength={n.strength} active={connected} />,
    trailing: (
      <>
        {connecting && <span>{tr(S.connecting, locale)}</span>}
        {n.secure && <Lock size={11} strokeWidth={2.4} />}
      </>
    ),
    action: connected ? undefined : () => void joinNetwork(n),
  };
}

/**
 * Builds the Wi-Fi status menu.
 *
 * Starts with a "Wi-Fi" title row whose switch turns Wi-Fi on or off in the system settings.
 * When Wi-Fi is off, only the "Open Wi-Fi Settings…" link follows. When it is on, the known
 * networks in range (the joined one first, under "Known Network(s)") are listed, then an
 * "Other Networks" submenu with every remaining network in range, then the settings link.
 * While a join is in progress, no row is marked as connected.
 *
 * @param {Object} opts - Current Wi-Fi state.
 * @param {boolean} opts.on - Whether Wi-Fi is turned on.
 * @param {string | null} opts.network - SSID of the joined network, or null.
 * @param {string | null} opts.connecting - SSID of the network being joined, or null.
 * @param {string[]} opts.known - SSIDs of the networks joined before.
 * @param {Locale} opts.locale - Locale for labels rendered as plain text.
 * @returns {MenuEntry[]} The menu entries.
 *
 * @example
 * const items = buildWifiMenu({ on: true, network: 'aodjo-5G', connecting: null, known: ['aodjo-5G'], locale: 'en' });
 * items[0].custom; // the "Wi-Fi" title row with its switch
 */
export function buildWifiMenu(opts: { on: boolean; network: string | null; connecting: string | null; known: string[]; locale: Locale }): MenuEntry[] {
  const { on, network, connecting, known, locale } = opts;
  const header: MenuEntry = {
    custom: (
      <MenuHeaderRow title={S.wifi}>
        <Switch checked={on} label={tr(S.wifiOn, locale)} onChange={(v) => useSystem.getState().updateSettings({ wifi: v })} />
      </MenuHeaderRow>
    ),
  };
  const settings: MenuEntry = { label: S.wifiSettings, action: () => wm.launch('settings', { pane: 'wifi' }) };
  if (!on) return [header, { separator: true }, settings];

  const knownNets = NETWORKS.filter((n) => known.includes(n.ssid) || n.ssid === network).sort((a, b) => Number(b.ssid === network) - Number(a.ssid === network));
  const others = NETWORKS.filter((n) => !knownNets.includes(n));
  return [
    header,
    { separator: true },
    ...(knownNets.length
      ? [
          { heading: true, label: knownNets.length > 1 ? S.knownNetworks : S.knownNetwork },
          ...knownNets.map((n) => networkEntry(n, n.ssid === network && !connecting, n.ssid === connecting, locale)),
          { separator: true },
        ]
      : []),
    { label: S.otherNetworks, submenu: others.map((n) => networkEntry(n, false, n.ssid === connecting, locale)) },
    { separator: true },
    settings,
  ];
}

/**
 * Builds the menu of the Focus menu bar item.
 *
 * The item is shown only while Do Not Disturb is on, so the menu lists that Focus as "On";
 * choosing it turns Do Not Disturb off. A "Focus Settings…" link opens the Focus pane of
 * System Settings.
 *
 * @param {Locale} locale - Locale for the title and the "On" label.
 * @returns {MenuEntry[]} The menu entries.
 *
 * @example
 * const focusMenu = { key: 'focus', status: true, items: buildFocusMenu(locale) };
 */
export function buildFocusMenu(locale: Locale): MenuEntry[] {
  return [
    { custom: <MenuHeaderRow title={tr(S.focus, locale)} /> },
    { separator: true },
    {
      label: S.dnd,
      leading: <FocusBadge active />,
      trailing: <span>{tr(S.focusOn, locale)}</span>,
      action: () => useSystem.getState().updateSettings({ doNotDisturb: false }),
    },
    { separator: true },
    { label: S.focusSettings, action: () => wm.launch('settings', { pane: 'focus' }) },
  ];
}

/**
 * Builds the Battery status menu.
 *
 * Shows the charge percentage in the title row and the power source. A detail line follows
 * when there is one: "Battery Is Charged" at 100 % on power, the time until full while
 * charging (or just "Charging" when unknown), or the time remaining on battery (omitted when
 * unknown). An energy section (always empty) and an "Open Activity Monitor…" link close it.
 *
 * @param {BatteryState} b - Current battery state.
 * @param {Locale} locale - Locale for the title row.
 * @returns {MenuEntry[]} The menu entries.
 *
 * @example
 * const battery = useBattery();
 * const batteryMenu = { key: 'battery', status: true, items: buildBatteryMenu(battery, locale) };
 */
export function buildBatteryMenu(b: BatteryState, locale: Locale): MenuEntry[] {
  const pct = Math.round(b.level * 100);
  let detail: LString | null = null;
  if (b.charging) {
    const time = formatHM(b.chargingTime);
    detail = pct >= 100 ? S.charged : time ? withTime(S.untilFull, time) : S.charging;
  } else {
    const time = formatHM(b.dischargingTime);
    if (time) detail = withTime(S.remaining, time);
  }
  return [
    {
      custom: (
        <MenuHeaderRow title={tr(S.battery, locale)}>
          <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
        </MenuHeaderRow>
      ),
    },
    { info: true, label: b.charging ? S.sourceAdapter : S.sourceBattery },
    ...(detail ? [{ info: true, label: detail }] : []),
    { separator: true },
    { heading: true, label: S.energy },
    { info: true, label: S.noApps },
    { separator: true },
    { label: S.activityMonitor, action: () => wm.launch('activity-monitor') },
  ];
}

/**
 * Builds the input source menu.
 *
 * Lists the English (ABC) and 2-Set Korean input sources with the current one checked;
 * choosing one also switches the UI language by updating the system `locale` setting.
 * An "Open Keyboard Settings…" link opens the Language pane of System Settings.
 *
 * @param {Locale} locale - The current locale, which marks the checked input source.
 * @returns {MenuEntry[]} The menu entries.
 *
 * @example
 * const inputMenu = { key: 'input', status: true, items: buildInputMenu(locale) };
 */
export function buildInputMenu(locale: Locale): MenuEntry[] {
  /**
   * Creates the menu action that switches to a locale.
   *
   * Returns a closure rather than switching immediately, so it can be used directly as a
   * menu entry's `action`.
   *
   * @param {Locale} next - The locale to switch to.
   * @returns {() => void} An action that sets the system `locale` setting to `next`.
   *
   * @example
   * const action = choose('ko');
   * action(); // UI switches to Korean
   */
  const choose = (next: Locale) => () => useSystem.getState().updateSettings({ locale: next });
  return [
    { label: S.abc, checked: locale === 'en', action: choose('en') },
    { label: S.korean, checked: locale === 'ko', action: choose('ko') },
    { separator: true },
    { label: S.keyboardSettings, action: () => wm.launch('settings', { pane: 'language' }) },
  ];
}

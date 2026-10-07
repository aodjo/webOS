/**
 * Wi-Fi and Bluetooth panes. The radios are simulated, but their state is real: the toggles
 * drive `settings.wifi` / `settings.bluetooth` (menu bar, Control Center, lock screen), and the
 * joined network / paired devices persist across reloads.
 */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Bluetooth, Ellipsis, Headphones, Keyboard, Lock, Mouse, Wifi } from 'lucide-react';
import { Button, IconButton, Switch, TextField } from '@/components/ui';
import { dialogs, fmt, HOSTNAME, showContextMenu, useSystem, useT } from '@/kernel';
import { ActivityIndicator, Pane, PaneIcon, Row, Section } from '../kit';
import { HOME_NETWORK, setPrefs, usePrefs } from '../prefs';
import { useNav } from '../nav';
import { NOT_A_CREDENTIAL, Sheet, SheetCheckbox, SheetField } from '../sheet';
import s from './panes.module.css';

const S = {
  wifi: { en: 'Wi-Fi', ko: 'Wi-Fi' },
  connected: { en: 'Connected', ko: '연결됨' },
  notConnected: { en: 'Not Connected', ko: '연결 안 됨' },
  connecting: { en: 'Connecting…', ko: '연결 중…' },
  connect: { en: 'Connect', ko: '연결' },
  disconnect: { en: 'Disconnect', ko: '연결 해제' },
  knownNetworks: { en: 'Known Networks', ko: '알려진 네트워크' },
  otherNetworks: { en: 'Other Networks', ko: '기타 네트워크' },
  wifiOff: { en: 'Wi-Fi is turned off.', ko: 'Wi-Fi가 꺼져 있습니다.' },
  wifiOffSub: { en: 'Turn on Wi-Fi to see networks you can join.', ko: '연결할 수 있는 네트워크를 보려면 Wi-Fi를 켜십시오.' },
  secured: { en: 'Secured', ko: '보안' },
  open: { en: 'Open network', ko: '개방형 네트워크' },
  forget: { en: 'Forget This Network…', ko: '이 네트워크 지우기…' },
  forgetTitle: { en: 'Forget Wi-Fi network “{name}”?', ko: 'Wi-Fi 네트워크 “{name}”을(를) 지우겠습니까?' },
  forgetMsg: { en: 'Your computer will no longer join this Wi-Fi network automatically.', ko: '컴퓨터가 더 이상 이 Wi-Fi 네트워크에 자동으로 연결되지 않습니다.' },
  forgetOk: { en: 'Forget', ko: '지우기' },
  more: { en: 'More options for {name}', ko: '{name} 추가 옵션' },
  needsPassword: { en: 'The Wi-Fi network “{name}” requires a WPA2 password.', ko: 'Wi-Fi 네트워크 “{name}”에 WPA2 암호가 필요합니다.' },
  passwordRule: { en: 'Wi-Fi passwords are at least 8 characters long.', ko: 'Wi-Fi 암호는 8자 이상입니다.' },
  password: { en: 'Password', ko: '암호' },
  showPassword: { en: 'Show password', ko: '암호 보기' },
  remember: { en: 'Remember this network', ko: '이 네트워크 기억하기' },
  join: { en: 'Join', ko: '연결' },
  bluetooth: { en: 'Bluetooth', ko: 'Bluetooth' },
  discoverable: { en: 'Now discoverable as “{name}”.', ko: '현재 “{name}”(으)로 발견 가능합니다.' },
  btOff: { en: 'Bluetooth is turned off.', ko: 'Bluetooth가 꺼져 있습니다.' },
  myDevices: { en: 'My Devices', ko: '나의 기기' },
  nearby: { en: 'Nearby Devices', ko: '근처의 기기' },
  searching: { en: 'Make sure your device is turned on and in pairing mode.', ko: '기기가 켜져 있고 페어링 모드인지 확인하십시오.' },
  battery: { en: 'Battery {pct}%', ko: '배터리 {pct}%' },
}; /** Localized strings for the Wi-Fi and Bluetooth panes. */

/* ───────────────────────── Wi-Fi ───────────────────────── */

/** A simulated Wi-Fi network in range. */
interface Network {
  ssid: string;
  secure: boolean;
  /** 1–3 bars. */
  strength: number;
}

const NETWORKS: Network[] = [
  { ssid: HOME_NETWORK, secure: true, strength: 3 },
  { ssid: 'Hallasan Guest', secure: false, strength: 2 },
  { ssid: 'Seongsu Cafe 5G', secure: true, strength: 3 },
  { ssid: 'Studio-2.4G', secure: true, strength: 2 },
  { ssid: 'Neighbor_Net', secure: true, strength: 1 },
  { ssid: 'Jeju Free WiFi', secure: false, strength: 1 },
  { ssid: 'Printer-DIRECT', secure: true, strength: 1 },
]; /** Simulated networks in range; the first is the home network that is joined and known by default. */

const CONNECT_MS = 1100; /** Simulated duration of a Wi-Fi join or Bluetooth connection, in milliseconds. */

/**
 * Renders a Wi-Fi fan glyph with a number of lit parts.
 *
 * Draws a dot and two arcs; parts up to `strength` use the current text color and the rest use
 * the tertiary text color. The SVG is decorative (`aria-hidden`).
 *
 * @param {Object} props - Component props.
 * @param {number} props.strength - Signal strength in bars (1–3).
 * @returns {JSX.Element} The signal glyph.
 *
 * @example
 * <SignalIcon strength={net.strength} />
 */
function SignalIcon({ strength }: { strength: number }) {
  /**
   * Picks the color of one part of the glyph.
   *
   * Parts are numbered from 1 (the dot) to 3 (the outer arc) and are lit up to `strength`.
   *
   * @param {number} i - Index of the part, 1 to 3.
   * @returns {string} `currentColor` when lit, otherwise the tertiary text color variable.
   *
   * @example
   * arc(3); // 'var(--text-tertiary)' when strength is 2
   */
  const arc = (i: number) => (i <= strength ? 'currentColor' : 'var(--text-tertiary)');
  return (
    <svg width="16" height="13" viewBox="0 0 16 13" aria-hidden="true" className={s.signal}>
      <path d="M8 12.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z" fill={arc(1)} />
      <path d="M4.6 7.6a4.8 4.8 0 0 1 6.8 0" fill="none" stroke={arc(2)} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M2.2 5.1a8.2 8.2 0 0 1 11.6 0" fill="none" stroke={arc(3)} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Tracks a single simulated connection attempt that completes after a delay.
 *
 * `start(id, done)` cancels any attempt in progress, marks `id` as pending and, after
 * {@link CONNECT_MS} ms, clears the pending id and calls `done`. The timer is cleared on unmount,
 * so `done` never runs after the pane has gone away.
 *
 * @returns {{ pending: string | null; start: (id: string, done: () => void) => void }} The id of
 *   the attempt in progress (or null) and the function that starts a new attempt.
 *
 * @example
 * const { pending, start } = useConnectTimer();
 * start('airpods', () => setConnected('airpods', true));
 */
function useConnectTimer() {
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * Starts a simulated connection attempt, replacing any attempt in progress.
   *
   * The given id is reported as `pending` until the delay elapses and `done` is called.
   *
   * @param {string} id - Identifier of the network or device being connected.
   * @param {() => void} done - Called when the attempt completes.
   * @returns {void}
   *
   * @example
   * start(net.ssid, () => setPrefs({ wifiNetwork: net.ssid }));
   */
  const start = (id: string, done: () => void) => {
    clearTimeout(timer.current);
    setPending(id);
    timer.current = window.setTimeout(() => {
      setPending(null);
      done();
    }, CONNECT_MS);
  };
  return { pending, start };
}

/**
 * Renders the Wi-Fi settings pane.
 *
 * The switch drives `settings.wifi`. While Wi-Fi is on, the current network (from prefs) is shown
 * as connected with Disconnect and "…" actions, followed by the known networks in range and the
 * other networks, each with a Connect button; while it is off a note replaces the lists. Joining a
 * secured network that isn't known opens a password sheet, and turning Wi-Fi off from anywhere
 * (this pane, Control Center or the menu bar) closes that sheet, cancelling the join.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <WifiPane />
 */
export function WifiPane() {
  const t = useT();
  const { windowId } = useNav();
  const wifi = useSystem((st) => st.settings.wifi);
  const updateSettings = useSystem((st) => st.updateSettings);
  const current = usePrefs((p) => p.wifiNetwork);
  const known = usePrefs((p) => p.knownNetworks);
  const { pending, start } = useConnectTimer();
  const [asking, setAsking] = useState<Network | null>(null);
  useEffect(() => {
    if (!wifi) setAsking(null);
  }, [wifi]);

  const connected = wifi ? NETWORKS.find((n) => n.ssid === current) : undefined;
  const knownInRange = NETWORKS.filter((n) => known.includes(n.ssid) && n.ssid !== current);
  const others = NETWORKS.filter((n) => !known.includes(n.ssid) && n.ssid !== current);

  /**
   * Joins a network after the simulated connection delay.
   *
   * Marks the network as pending; when the delay elapses it becomes the current Wi-Fi network
   * and, if `remember` is true, is appended to the known networks unless already listed. Prefs are
   * read at that moment, so changes made during the delay are kept.
   *
   * @param {Network} net - The network to join.
   * @param {boolean} remember - Whether to add the network to the known networks.
   * @returns {void}
   *
   * @example
   * connect(net, true);
   */
  const connect = (net: Network, remember: boolean) => {
    start(net.ssid, () => {
      const p = usePrefs.getState();
      const knownNetworks = remember && !p.knownNetworks.includes(net.ssid) ? [...p.knownNetworks, net.ssid] : p.knownNetworks;
      setPrefs({ wifiNetwork: net.ssid, knownNetworks });
    });
  };

  /**
   * Starts joining a network, asking for its password first when needed.
   *
   * Known networks and open networks connect straight away and are remembered; a secured network
   * that is not yet known opens the password sheet instead.
   *
   * @param {Network} net - The network to join.
   * @returns {void}
   *
   * @example
   * <Button onClick={() => join(net)}>Connect</Button>
   */
  const join = (net: Network) => {
    if (net.secure && !known.includes(net.ssid)) setAsking(net);
    else connect(net, true);
  };

  /**
   * Forgets a known network after confirmation.
   *
   * Asks for confirmation in a sheet on this window, then removes the SSID from the known
   * networks and, when it is the current network, disconnects from it.
   *
   * @async
   * @param {Network} net - The network to forget.
   * @returns {Promise<void>} Resolves once the dialog has been answered and prefs updated.
   *
   * @example
   * void forget(net);
   */
  const forget = async (net: Network) => {
    const ok = await dialogs.confirm({ windowId, appId: 'settings', title: fmt(t(S.forgetTitle), { name: net.ssid }), message: S.forgetMsg, okLabel: S.forgetOk });
    if (!ok) return;
    const p = usePrefs.getState();
    setPrefs({ knownNetworks: p.knownNetworks.filter((x) => x !== net.ssid), wifiNetwork: p.wifiNetwork === net.ssid ? null : p.wifiNetwork });
  };

  /**
   * Opens the "…" menu for a network below the button that was clicked.
   *
   * Positions a context menu at the bottom-left corner of the clicked button. It offers Disconnect
   * for the current network or Connect for any other, followed by "Forget This Network…".
   *
   * @param {MouseEvent} e - The click event from the "…" button.
   * @param {Network} net - The network the menu acts on.
   * @returns {void}
   *
   * @example
   * <IconButton label="More" onClick={(e) => moreMenu(e, net)} />
   */
  const moreMenu = (e: MouseEvent, net: Network) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() }, [
      ...(current === net.ssid ? [{ label: S.disconnect, action: () => setPrefs({ wifiNetwork: null }) }] : [{ label: S.connect, action: () => join(net) }]),
      { separator: true },
      { label: S.forget, action: () => void forget(net) },
    ]);
  };

  /**
   * Renders the row for one network in the Known or Other Networks list.
   *
   * Shows the signal glyph, the SSID, a lock icon for secured networks and either a Connect button
   * (disabled while any join is pending) or, while this network is joining, a spinner with a
   * "Connecting…" sublabel. Known networks also get a "…" button that opens the network menu.
   *
   * @param {Network} net - The network to render.
   * @param {boolean} isKnown - Whether the network is one of the known networks.
   * @returns {JSX.Element} The network row.
   *
   * @example
   * knownInRange.map((n) => networkRow(n, true));
   */
  const networkRow = (net: Network, isKnown: boolean) => (
    <Row
      key={net.ssid}
      label={net.ssid}
      sublabel={pending === net.ssid ? t(S.connecting) : undefined}
      leading={<span className={s.rowGlyph}><SignalIcon strength={net.strength} /></span>}
    >
      {net.secure && <Lock size={12} aria-label={t(S.secured)} />}
      {pending === net.ssid ? (
        <ActivityIndicator />
      ) : (
        <Button onClick={() => join(net)} disabled={!!pending}>
          {t(S.connect)}
        </Button>
      )}
      {isKnown && (
        <IconButton label={fmt(t(S.more), { name: net.ssid })} onClick={(e) => moreMenu(e, net)}>
          <Ellipsis size={15} />
        </IconButton>
      )}
    </Row>
  );

  return (
    <Pane>
      <Section>
        <Row label={<strong>{t(S.wifi)}</strong>} leading={<PaneIcon icon={Wifi} color="#0a84ff" size={28} />}>
          <Switch checked={wifi} onChange={(v) => updateSettings({ wifi: v })} label={t(S.wifi)} />
        </Row>
        {wifi && current && connected && (
          <Row
            label={connected.ssid}
            sublabel={
              <span className={s.statusLine}>
                <i className={s.dotGreen} />
                {t(S.connected)}
              </span>
            }
            leading={<span className={s.rowGlyph}><SignalIcon strength={connected.strength} /></span>}
          >
            {connected.secure && <Lock size={12} aria-label={t(S.secured)} />}
            <Button onClick={() => setPrefs({ wifiNetwork: null })}>{t(S.disconnect)}</Button>
            <IconButton label={fmt(t(S.more), { name: connected.ssid })} onClick={(e) => moreMenu(e, connected)}>
              <Ellipsis size={15} />
            </IconButton>
          </Row>
        )}
      </Section>

      {!wifi ? (
        <div className={s.emptyNote}>
          <div className={s.emptyTitle}>{t(S.wifiOff)}</div>
          <div>{t(S.wifiOffSub)}</div>
        </div>
      ) : (
        <>
          {knownInRange.length > 0 && <Section title={t(S.knownNetworks)}>{knownInRange.map((n) => networkRow(n, true))}</Section>}
          <Section title={t(S.otherNetworks)} aside={<ActivityIndicator size={14} />}>
            {others.map((n) => networkRow(n, false))}
          </Section>
        </>
      )}

      {asking && wifi && (
        <JoinSheet
          ssid={asking.ssid}
          onCancel={() => setAsking(null)}
          onJoin={(remember) => {
            setAsking(null);
            connect(asking, remember);
          }}
        />
      )}
    </Pane>
  );
}

const MIN_WPA_LENGTH = 8; /** Minimum WPA2 passphrase length; shorter passwords keep Join disabled. */

/**
 * Renders the "requires a WPA2 password" sheet for joining a secured network.
 *
 * Holds the typed password, a "Show password" checkbox that switches the field between masked and
 * plain text, and a "Remember this network" checkbox that starts checked. Join stays disabled
 * until the password has at least {@link MIN_WPA_LENGTH} characters; any such password is
 * accepted. The field is marked so password managers ignore it.
 *
 * @param {Object} props - Component props.
 * @param {string} props.ssid - Name of the network being joined.
 * @param {() => void} props.onCancel - Called when the sheet is cancelled.
 * @param {(remember: boolean) => void} props.onJoin - Called on Join with the "remember" choice.
 * @returns {JSX.Element} The password sheet.
 *
 * @example
 * <JoinSheet ssid={net.ssid} onCancel={() => setAsking(null)} onJoin={(remember) => connect(net, remember)} />
 */
function JoinSheet({ ssid, onCancel, onJoin }: { ssid: string; onCancel: () => void; onJoin: (remember: boolean) => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  return (
    <Sheet
      leading={<PaneIcon icon={Wifi} color="#0a84ff" size={40} />}
      title={fmt(t(S.needsPassword), { name: ssid })}
      subtitle={t(S.passwordRule)}
      submitLabel={t(S.join)}
      submitDisabled={password.length < MIN_WPA_LENGTH}
      onSubmit={() => onJoin(remember)}
      onCancel={onCancel}
    >
      <SheetField label={t(S.password)}>
        <TextField type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} {...NOT_A_CREDENTIAL} />
      </SheetField>
      <SheetCheckbox label={t(S.showPassword)} checked={show} onChange={setShow} />
      <SheetCheckbox label={t(S.remember)} checked={remember} onChange={setRemember} />
    </Sheet>
  );
}

/* ───────────────────────── Bluetooth ───────────────────────── */

const DEVICES = [
  { id: 'airpods', name: 'AirPods Pro', icon: Headphones, battery: 0.82 },
  { id: 'keyboard', name: 'Magic Keyboard', icon: Keyboard, battery: 0.64 },
  { id: 'mouse', name: 'Magic Mouse', icon: Mouse, battery: 0.41 },
]; /** Simulated paired Bluetooth devices with their icon and fixed battery level (0–1). */

/**
 * Renders the Bluetooth settings pane.
 *
 * The switch drives `settings.bluetooth`. While Bluetooth is on, the footer shows the host name
 * the computer is discoverable as, each simulated device lists its connection state (with its
 * battery level when connected) and a Connect or Disconnect button, and a Nearby Devices section
 * shows a searching hint; while it is off a note replaces the lists. Connecting goes through the
 * simulated connection delay, disconnecting is immediate, and connection state persists in prefs.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <BluetoothPane />
 */
export function BluetoothPane() {
  const t = useT();
  const bluetooth = useSystem((st) => st.settings.bluetooth);
  const updateSettings = useSystem((st) => st.updateSettings);
  const connectedMap = usePrefs((p) => p.btConnected);
  const { pending, start } = useConnectTimer();

  /**
   * Persists the connection state of one Bluetooth device.
   *
   * Merges the value into the latest `btConnected` map read from prefs.
   *
   * @param {string} id - Device id, e.g. "airpods".
   * @param {boolean} v - Whether the device is connected.
   * @returns {void}
   *
   * @example
   * setConnected('mouse', false);
   */
  const setConnected = (id: string, v: boolean) => setPrefs({ btConnected: { ...usePrefs.getState().btConnected, [id]: v } });

  return (
    <Pane>
      <Section footer={bluetooth ? fmt(t(S.discoverable), { name: HOSTNAME }) : undefined}>
        <Row label={<strong>{t(S.bluetooth)}</strong>} leading={<PaneIcon icon={Bluetooth} color="#0a84ff" size={28} />}>
          <Switch checked={bluetooth} onChange={(v) => updateSettings({ bluetooth: v })} label={t(S.bluetooth)} />
        </Row>
      </Section>

      {!bluetooth ? (
        <div className={s.emptyNote}>
          <div className={s.emptyTitle}>{t(S.btOff)}</div>
        </div>
      ) : (
        <>
          <Section title={t(S.myDevices)}>
            {DEVICES.map((d) => {
              const on = !!connectedMap[d.id];
              const Icon = d.icon;
              return (
                <Row
                  key={d.id}
                  label={d.name}
                  sublabel={
                    pending === d.id ? (
                      t(S.connecting)
                    ) : on ? (
                      <span className={s.statusLine}>
                        <i className={s.dotGreen} />
                        {t(S.connected)} · {fmt(t(S.battery), { pct: Math.round(d.battery * 100) })}
                      </span>
                    ) : (
                      t(S.notConnected)
                    )
                  }
                  leading={
                    <span className={s.deviceGlyph}>
                      <Icon size={15} />
                    </span>
                  }
                >
                  {pending === d.id ? (
                    <ActivityIndicator />
                  ) : on ? (
                    <Button onClick={() => setConnected(d.id, false)}>{t(S.disconnect)}</Button>
                  ) : (
                    <Button onClick={() => start(d.id, () => setConnected(d.id, true))} disabled={!!pending}>
                      {t(S.connect)}
                    </Button>
                  )}
                </Row>
              );
            })}
          </Section>
          <Section title={t(S.nearby)} aside={<ActivityIndicator size={14} />}>
            <Row label={<span className={s.muted}>{t(S.searching)}</span>} />
          </Section>
        </>
      )}
    </Pane>
  );
}

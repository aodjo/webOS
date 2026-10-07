/**
 * Session state behind the Wi-Fi status menu and Control Center.
 *
 * The joined network and the known networks are the ones System Settings → Wi-Fi uses
 * (persisted in its prefs store), so the menu bar, Control Center and Settings always agree.
 * Only the in-flight "Connecting…" state and the decorative AirDrop / Stage Manager / Mirroring
 * toggles live here.
 */
import { create } from 'zustand';
import type { LString } from '@/kernel/types';
import { dialogs } from '@/kernel/dialogs';
import { fmt, t } from '@/kernel/i18n';
import { HOME_NETWORK, setPrefs, usePrefs } from '@/apps/settings/prefs';

/** A Wi-Fi network "in range", as listed by the Wi-Fi menu and System Settings. */
export interface WifiNetwork {
  ssid: string;
  /** Whether joining requires a password (unless the network is already known). */
  secure: boolean;
  /** Signal bars 1 – 3. */
  strength: 1 | 2 | 3;
}

export const NETWORKS: WifiNetwork[] = [
  { ssid: HOME_NETWORK, secure: true, strength: 3 },
  { ssid: 'Hallasan Guest', secure: false, strength: 2 },
  { ssid: 'Seongsu Cafe 5G', secure: true, strength: 3 },
  { ssid: 'Studio-2.4G', secure: true, strength: 2 },
  { ssid: 'Neighbor_Net', secure: true, strength: 1 },
  { ssid: 'Jeju Free WiFi', secure: false, strength: 1 },
  { ssid: 'Printer-DIRECT', secure: true, strength: 1 },
]; /** Networks "in range": the same list System Settings → Wi-Fi shows, with the home network first. */

const S = {
  needsPassword: { en: 'The Wi-Fi network “{name}” requires a WPA2 password.', ko: 'Wi-Fi 네트워크 “{name}”에 WPA2 암호가 필요합니다.' },
  password: { en: 'Password', ko: '암호' },
  join: { en: 'Join', ko: '연결' },
  wrongPassword: { en: 'Couldn’t join “{name}”.', ko: '“{name}”에 연결할 수 없습니다.' },
  wrongPasswordMsg: { en: 'The password is incorrect. Wi-Fi passwords are at least 8 characters long.', ko: '암호가 올바르지 않습니다. Wi-Fi 암호는 8자 이상이어야 합니다.' },
} satisfies Record<string, LString>; /** Localized strings for the password prompt and the join-failure alert. */

/** Transient status-menu state that is not persisted in the Settings prefs. */
interface StatusState {
  /** SSID of the network currently being joined (null when idle). */
  connecting: string | null;
  airDrop: boolean;
  stageManager: boolean;
  mirroring: boolean;
}

export const useStatus = create<StatusState>()(() => ({
  connecting: null,
  airDrop: true,
  stageManager: false,
  mirroring: false,
})); /** Zustand store for the in-flight join and the decorative Control Center toggles. */

/**
 * Subscribes to the SSID of the joined Wi-Fi network.
 *
 * Reads `wifiNetwork` from the System Settings prefs store, so the value is shared with
 * Settings → Wi-Fi and re-renders the caller whenever it changes.
 *
 * @returns {string | null} The joined network's SSID, or null when not connected.
 *
 * @example
 * const network = useWifiNetwork();
 * const label = network ?? 'Not Connected';
 */
export const useWifiNetwork = (): string | null => usePrefs((p) => p.wifiNetwork);

/**
 * Subscribes to the list of networks joined before.
 *
 * Reads `knownNetworks` from the System Settings prefs store; the Wi-Fi menu lists these
 * under "Known Networks" and joins them without asking for a password.
 *
 * @returns {string[]} SSIDs of the known networks.
 *
 * @example
 * const known = useKnownNetworks();
 * const isKnown = known.includes('Hallasan Guest');
 */
export const useKnownNetworks = (): string[] => usePrefs((p) => p.knownNetworks);

const CONNECT_MS = 1100; /** Simulated time in ms a join takes before the network counts as connected. */
let joinTimer: ReturnType<typeof setTimeout> | undefined; /** Pending timer of the join in progress, cleared when another join starts. */

/**
 * Joins a Wi-Fi network.
 *
 * Does nothing when the network is already joined and no join is in progress. For a secured
 * network that is not yet known, it first asks for a password; cancelling aborts, and a
 * password shorter than 8 characters shows a "couldn't join" alert and aborts. Otherwise it
 * cancels any join in progress, sets `useStatus.connecting` to the SSID and, after
 * `CONNECT_MS`, stores the network as joined (adding it to the known networks) and clears
 * `connecting`.
 *
 * @async
 * @param {WifiNetwork} net - The network to join.
 * @returns {Promise<void>} Resolves once the join has been started or aborted (the connection
 *   itself completes later on a timer).
 *
 * @example
 * await joinNetwork(NETWORKS[1]);
 * useStatus.getState().connecting; // 'Hallasan Guest'
 */
export async function joinNetwork(net: WifiNetwork): Promise<void> {
  const { wifiNetwork, knownNetworks } = usePrefs.getState();
  if (wifiNetwork === net.ssid && !useStatus.getState().connecting) return;
  if (net.secure && !knownNetworks.includes(net.ssid)) {
    const pw = await dialogs.prompt({ appId: 'settings', title: fmt(t(S.needsPassword), { name: net.ssid }), placeholder: S.password, okLabel: S.join });
    if (pw === null) return;
    if (pw.length < 8) {
      await dialogs.alert({ appId: 'settings', title: fmt(t(S.wrongPassword), { name: net.ssid }), message: S.wrongPasswordMsg });
      return;
    }
  }
  clearTimeout(joinTimer);
  useStatus.setState({ connecting: net.ssid });
  joinTimer = setTimeout(() => {
    const known = usePrefs.getState().knownNetworks;
    setPrefs({ wifiNetwork: net.ssid, knownNetworks: known.includes(net.ssid) ? known : [...known, net.ssid] });
    useStatus.setState({ connecting: null });
  }, CONNECT_MS);
}

/**
 * Flips one of the decorative Control Center toggles.
 *
 * Inverts the boolean in the `useStatus` store, re-rendering every subscriber. The value is
 * not persisted and resets on reload.
 *
 * @param {'airDrop' | 'stageManager' | 'mirroring'} key - The toggle to invert in `useStatus`.
 * @returns {void}
 *
 * @example
 * toggleStatus('airDrop');
 * useStatus.getState().airDrop; // false (it starts as true)
 */
export function toggleStatus(key: 'airDrop' | 'stageManager' | 'mirroring'): void {
  useStatus.setState((s) => ({ [key]: !s[key] }));
}

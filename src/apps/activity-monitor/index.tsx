/**
 * Activity Monitor — the running apps (from the window manager) plus a cast of system
 * processes, with live CPU / Memory / Energy / Disk / Network views. Quitting a process really
 * quits the app; quitting WindowServer logs you out.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, CircleX, Info } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { osInfo, owner } from '@/data/portfolio';
import { IconButton, SearchField, Segmented, Toolbar } from '@/components/ui';
import { GlassGroup } from '@/components/Glass';
import { dialogs, fmt, formatBytes, formatDate, fs, fileSizeOf, getApp, power, t as translate, useAppMenus, useLocale, useSystem, useT, useWM, wm, type AppProps, type LString, type MenuItem } from '@/kernel';
import { Graph } from './Graph';
import { cpuCores, deviceMemoryGB, monitor, readHeap, useBattery, useConnection, useStorageEstimate } from './metrics';
import { SYSTEM_PROCESSES, advance, buildRows, emptyAccum, formatCPUTime, formatCount, formatMem, profileFor, type Accum, type ProcInput, type ProcRow, type Signals } from './sim';
import styles from './ActivityMonitor.module.css';

const S = {
  appName: { en: 'Activity Monitor', ko: '활성 상태 보기' },
  quitProcess: { en: 'Quit Process', ko: '프로세스 종료' },
  inspect: { en: 'Inspect Process', ko: '프로세스 정보 보기' },
  search: { en: 'Search', ko: '검색' },
  view: { en: 'View', ko: '보기' },
  edit: { en: 'Edit', ko: '편집' },
  copy: { en: 'Copy', ko: '복사하기' },
  find: { en: 'Find', ko: '찾기' },
  updateFrequency: { en: 'Update Frequency', ko: '업데이트 빈도' },
  veryOften: { en: 'Very Often (1 sec)', ko: '매우 자주 (1초)' },
  often: { en: 'Often (2 sec)', ko: '자주 (2초)' },
  normally: { en: 'Normally (5 sec)', ko: '보통 (5초)' },
  quitTitle: { en: 'Are you sure you want to quit this process?', ko: '이 프로세스를 종료하겠습니까?' },
  quitMsg: { en: 'Do you really want to quit “{name}”?', ko: '“{name}”을(를) 종료하겠습니까?' },
  quit: { en: 'Quit', ko: '종료' },
  forceQuit: { en: 'Force Quit', ko: '강제 종료' },
  cancel: { en: 'Cancel', ko: '취소' },
  denied: { en: 'You don’t have permission to quit “{name}”.', ko: '“{name}”을(를) 종료할 권한이 없습니다.' },
  deniedMsg: { en: 'It belongs to the system ({user}) and is protected.', ko: '시스템({user})에 속한 보호된 프로세스입니다.' },
  parent: { en: 'Parent Process', ko: '상위 프로세스' },
  user: { en: 'User', ko: '사용자' },
  bundle: { en: 'Bundle Identifier', ko: '번들 식별자' },
  started: { en: 'Started', ko: '시작 시간' },
  windows: { en: 'Windows', ko: '윈도우' },
  system: { en: 'System:', ko: '시스템:' },
  userPct: { en: 'User:', ko: '사용자:' },
  idle: { en: 'Idle:', ko: '대기:' },
  cpuLoad: { en: 'CPU LOAD', ko: 'CPU 부하' },
  threads: { en: 'Threads:', ko: '스레드:' },
  processes: { en: 'Processes:', ko: '프로세스:' },
  cores: { en: 'CPU Cores:', ko: 'CPU 코어:' },
  mainThread: { en: 'Main Thread Busy:', ko: '메인 스레드 사용:' },
  memPressure: { en: 'MEMORY PRESSURE', ko: '메모리 압박' },
  physical: { en: 'Physical Memory:', ko: '물리적 메모리:' },
  memUsed: { en: 'Memory Used:', ko: '사용된 메모리:' },
  jsHeap: { en: 'JS Heap:', ko: 'JS 힙:' },
  swap: { en: 'Swap Used:', ko: '사용된 스왑:' },
  appMem: { en: 'App Memory:', ko: '앱 메모리:' },
  wired: { en: 'Wired Memory:', ko: '와이어드 메모리:' },
  compressed: { en: 'Compressed:', ko: '압축됨:' },
  energyImpact: { en: 'ENERGY IMPACT', ko: '에너지 영향' },
  battery: { en: 'Battery:', ko: '배터리:' },
  charging: { en: 'Charging', ko: '충전 중' },
  onBattery: { en: 'On Battery', ko: '배터리 사용 중' },
  powerSource: { en: 'Power Source:', ko: '전원:' },
  ac: { en: 'Power Adapter', ko: '전원 어댑터' },
  timeLeft: { en: 'Time Remaining:', ko: '남은 시간:' },
  timeToFull: { en: 'Time Until Full:', ko: '완충까지:' },
  noBattery: { en: 'Battery info isn’t available in this browser.', ko: '이 브라우저에서는 배터리 정보를 사용할 수 없습니다.' },
  calculating: { en: 'Calculating…', ko: '계산 중…' },
  totalEnergy: { en: 'Total Energy Impact:', ko: '총 에너지 영향:' },
  data: { en: 'DATA', ko: '데이터' },
  readsIn: { en: 'Reads in:', ko: '읽기:' },
  writesOut: { en: 'Writes out:', ko: '쓰기:' },
  dataWritten: { en: 'Data written:', ko: '기록된 데이터:' },
  storage: { en: 'Storage Used:', ko: '사용된 저장 공간:' },
  files: { en: 'Files:', ko: '파일:' },
  folders: { en: 'Folders:', ko: '폴더:' },
  fsSize: { en: 'Total File Size:', ko: '전체 파일 크기:' },
  sinceOpen: { en: 'since opened', ko: '열린 이후' },
  packetsIn: { en: 'Packets in:', ko: '받은 패킷:' },
  packetsOut: { en: 'Packets out:', ko: '보낸 패킷:' },
  dataReceived: { en: 'Data received:', ko: '받은 데이터:' },
  requests: { en: 'Requests:', ko: '요청:' },
  connection: { en: 'Connection:', ko: '연결:' },
  offline: { en: 'Offline', ko: '오프라인' },
  online: { en: 'Online', ko: '온라인' },
  bandwidth: { en: 'Bandwidth:', ko: '대역폭:' },
  latency: { en: 'Latency:', ko: '지연 시간:' },
  frameRate: { en: 'Frame Rate:', ko: '프레임 속도:' },
  unknown: { en: 'Unknown', ko: '알 수 없음' },
  yes: { en: 'Yes', ko: '예' },
  no: { en: 'No', ko: '아니요' },
  na: { en: 'N/A', ko: '해당 없음' },
  zeroBytes: { en: '0 bytes', ko: '0바이트' },
  bytesUnit: { en: 'bytes', ko: '바이트' },
} satisfies Record<string, LString>; /** Localized UI strings for the window, menus, dialogs and bottom panels. */

/** View shown in the table and bottom panel. */
type Tab = 'cpu' | 'memory' | 'energy' | 'disk' | 'network';
/** Which processes the table lists (View menu). */
type Filter = 'all' | 'mine' | 'system' | 'active' | 'windowed';

const TABS: { id: Tab; label: LString }[] = [
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: { en: 'Memory', ko: '메모리' } },
  { id: 'energy', label: { en: 'Energy', ko: '에너지' } },
  { id: 'disk', label: { en: 'Disk', ko: '디스크' } },
  { id: 'network', label: { en: 'Network', ko: '네트워크' } },
]; /** Toolbar tabs in display order; their position also sets the mod+1 … mod+5 shortcuts. */

const FILTERS: { id: Filter; label: LString }[] = [
  { id: 'all', label: { en: 'All Processes', ko: '모든 프로세스' } },
  { id: 'mine', label: { en: 'My Processes', ko: '나의 프로세스' } },
  { id: 'system', label: { en: 'System Processes', ko: '시스템 프로세스' } },
  { id: 'active', label: { en: 'Active Processes', ko: '활성 프로세스' } },
  { id: 'windowed', label: { en: 'Windowed Processes', ko: '윈도우가 있는 프로세스' } },
]; /** Process filters listed in the View menu; the active one also appears in the window title. */

/* ───────────────────────── Columns ───────────────────────── */

/** A table column. */
interface Column {
  /** Sort key; also selects the cell rendering ('name' gets the icon cell, 'user' and 'kind' are left-aligned text). */
  key: string;
  label: LString;
  /** Fixed width in px; columns without one share the remaining space. */
  width?: number;
  /** Value used for sorting (and for display when `format` is missing). */
  value: (r: ProcRow) => number | string;
  /** Display text of the cell. */
  format?: (r: ProcRow) => string;
}

/**
 * Formats a boolean as a localized "Yes" / "No".
 *
 * Uses the non-reactive translator, so it reflects the locale at call time.
 *
 * @param {boolean} v - The value to format.
 * @returns {string} The localized "Yes" or "No".
 *
 * @example
 * yesNo(true); // 'Yes'
 */
const yesNo = (v: boolean) => translate(v ? S.yes : S.no);
/**
 * Formats a byte count the way Activity Monitor does, with a localized "bytes" unit.
 *
 * Delegates to `formatMem`, passing the translated unit used for values below 1 KB.
 *
 * @param {number} bytes - Size in bytes.
 * @returns {string} Human-readable size, e.g. '245 MB'.
 *
 * @example
 * mem(1536); // '1.5 KB'
 */
const mem = (bytes: number) => formatMem(bytes, translate(S.bytesUnit));
const nameCol: Column = { key: 'name', label: { en: 'Process Name', ko: '프로세스 이름' }, value: (r) => r.name.toLowerCase() }; /** Process name column; sorts case-insensitively. */
const pidCol: Column = { key: 'pid', label: 'PID', width: 60, value: (r) => r.pid }; /** Process ID column. */
const userCol: Column = { key: 'user', label: { en: 'User', ko: '사용자' }, width: 112, value: (r) => r.user, format: (r) => r.user }; /** Owning user column. */
const threadsCol: Column = { key: 'threads', label: { en: 'Threads', ko: '스레드' }, width: 64, value: (r) => r.threads }; /** Thread count column. */

const COLUMNS: Record<Tab, Column[]> = {
  cpu: [
    nameCol,
    { key: 'cpu', label: '% CPU', width: 66, value: (r) => r.cpu, format: (r) => r.cpu.toFixed(1) },
    { key: 'cpuTime', label: { en: 'CPU Time', ko: 'CPU 시간' }, width: 92, value: (r) => r.cpuTime, format: (r) => formatCPUTime(r.cpuTime) },
    threadsCol,
    { key: 'idleWakeUps', label: { en: 'Idle Wake Ups', ko: '유휴 상태 깨우기' }, width: 110, value: (r) => r.idleWakeUps },
    pidCol,
    userCol,
  ],
  memory: [
    nameCol,
    { key: 'memory', label: { en: 'Memory', ko: '메모리' }, width: 90, value: (r) => r.memory, format: (r) => mem(r.memory) },
    { key: 'compressed', label: { en: 'Compressed Mem', ko: '압축된 메모리' }, width: 118, value: (r) => r.compressed, format: (r) => mem(r.compressed) },
    threadsCol,
    { key: 'ports', label: { en: 'Ports', ko: '포트' }, width: 64, value: (r) => r.ports },
    pidCol,
    userCol,
  ],
  energy: [
    nameCol,
    { key: 'energy', label: { en: 'Energy Impact', ko: '에너지 영향' }, width: 104, value: (r) => r.energy, format: (r) => r.energy.toFixed(1) },
    { key: 'power12h', label: { en: '12 hr Power', ko: '12시간 전력' }, width: 92, value: (r) => r.power12h, format: (r) => r.power12h.toFixed(2) },
    { key: 'appNap', label: 'App Nap', width: 76, value: (r) => (r.appId ? (r.appNap ? 1 : 0) : -1), format: (r) => (r.appId ? yesNo(r.appNap) : '-') },
    { key: 'preventingSleep', label: { en: 'Preventing Sleep', ko: '잠자기 방지' }, width: 118, value: (r) => (r.preventingSleep ? 1 : 0), format: (r) => yesNo(r.preventingSleep) },
    userCol,
  ],
  disk: [
    nameCol,
    { key: 'bytesWritten', label: { en: 'Bytes Written', ko: '기록된 바이트' }, width: 112, value: (r) => r.bytesWritten, format: (r) => mem(r.bytesWritten) },
    { key: 'bytesRead', label: { en: 'Bytes Read', ko: '읽은 바이트' }, width: 104, value: (r) => r.bytesRead, format: (r) => mem(r.bytesRead) },
    { key: 'kind', label: { en: 'Kind', ko: '종류' }, width: 76, value: () => 'Apple', format: () => 'Apple' },
    pidCol,
    userCol,
  ],
  network: [
    nameCol,
    { key: 'sentBytes', label: { en: 'Sent Bytes', ko: '보낸 바이트' }, width: 96, value: (r) => r.sentBytes, format: (r) => mem(r.sentBytes) },
    { key: 'rcvdBytes', label: { en: 'Rcvd Bytes', ko: '받은 바이트' }, width: 96, value: (r) => r.rcvdBytes, format: (r) => mem(r.rcvdBytes) },
    { key: 'sentPackets', label: { en: 'Sent Packets', ko: '보낸 패킷' }, width: 98, value: (r) => r.sentPackets, format: (r) => formatCount(r.sentPackets) },
    { key: 'rcvdPackets', label: { en: 'Rcvd Packets', ko: '받은 패킷' }, width: 98, value: (r) => r.rcvdPackets, format: (r) => formatCount(r.rcvdPackets) },
    pidCol,
    userCol,
  ],
}; /** Columns shown for each tab, in display order. */

const DEFAULT_SORT: Record<Tab, { key: string; desc: boolean }> = {
  cpu: { key: 'cpu', desc: true },
  memory: { key: 'memory', desc: true },
  energy: { key: 'energy', desc: true },
  disk: { key: 'bytesWritten', desc: true },
  network: { key: 'rcvdBytes', desc: true },
}; /** Initial sort column and direction per tab (largest values first). */

/* ───────────────────────── Process registry ───────────────────────── */

const relaunched = new Map<number, { pid: number; startedAt: number }>(); /** Relaunched system processes for this page session: original PID → new PID and start time (ms). */
let nextRelaunchPid = 60_000 + Math.floor(Math.random() * 2000); /** Most recent PID assigned to a relaunched process; starts at a random base well above the window manager's app PIDs so the two ranges never collide, and grows by a random step of 1–40 per relaunch. */

/**
 * Builds the simulation inputs for the built-in system processes.
 *
 * Each entry of `SYSTEM_PROCESSES` becomes a windowless, unfocused process. Processes without
 * a fixed user run as the portfolio owner and start at login (falling back to boot time when
 * nobody has logged in yet); the others start at boot. Relaunched processes use their new PID
 * and relaunch time from `relaunched`.
 *
 * @param {number} bootedAt - Boot timestamp in ms.
 * @param {number} loggedInAt - Login timestamp in ms (0 when not logged in).
 * @returns {ProcInput[]} One input per system process.
 *
 * @example
 * const inputs = systemInputs(sys.bootedAt, sys.loggedInAt);
 */
function systemInputs(bootedAt: number, loggedInAt: number): ProcInput[] {
  return SYSTEM_PROCESSES.map((sp) => {
    const r = relaunched.get(sp.pid);
    return {
      pid: r?.pid ?? sp.pid,
      name: sp.name,
      user: sp.user ?? owner.handle,
      startedAt: r?.startedAt ?? (sp.user === null ? loggedInAt || bootedAt : bootedAt),
      windows: 0,
      focused: false,
      hidden: false,
      profile: sp.profile,
      kill: sp.kill,
    };
  });
}

/**
 * Counts open windows per app.
 *
 * Returns a map from app ID to its number of windows, plus a `__visible` entry with the number
 * of non-minimized windows across all apps. Used as a `useShallow` selector, so the result only
 * triggers a re-render when one of the counts changes.
 *
 * @param {ReturnType<typeof useWM.getState>} s - Window manager state.
 * @returns {Record<string, number>} Window count per app ID plus `__visible`.
 *
 * @example
 * const counts = useWM(useShallow(windowStats));
 * counts['calculator']; // 1
 */
function windowStats(s: ReturnType<typeof useWM.getState>): Record<string, number> {
  const out: Record<string, number> = { __visible: 0 };
  for (const w of s.windows) {
    out[w.appId] = (out[w.appId] ?? 0) + 1;
    if (!w.minimized) out.__visible++;
  }
  return out;
}

/**
 * Builds the simulation inputs for the running app processes.
 *
 * Every window manager process becomes an input owned by the portfolio owner, with its
 * localized app name, bundle identifier, window count, focus and hidden state, and the CPU /
 * memory profile of its app. App processes are always killed by quitting the app.
 *
 * @param {ReturnType<typeof useWM.getState>} s - Window manager state.
 * @param {Record<string, number>} counts - Window counts per app ID (see `windowStats`).
 * @returns {ProcInput[]} One input per running app process.
 *
 * @example
 * const inputs = appInputs(useWM.getState(), windowStats(useWM.getState()));
 */
function appInputs(s: ReturnType<typeof useWM.getState>, counts: Record<string, number>): ProcInput[] {
  return s.processes.map((p) => {
    const app = getApp(p.appId);
    return {
      pid: p.pid,
      name: translate(app?.name ?? p.appId),
      appId: p.appId,
      bundleId: app?.bundleId,
      user: owner.handle,
      startedAt: p.startedAt,
      windows: counts[p.appId] ?? 0,
      focused: s.activeAppId === p.appId,
      hidden: p.hidden,
      profile: profileFor(p.appId),
      kill: 'app',
    };
  });
}

/* ───────────────────────── Sampling state ───────────────────────── */

/** One sampling tick: simulation state plus the monitor counters it was computed from. */
interface Sample {
  /** Sample time in seconds. */
  t: number;
  /** Number of samples taken so far (0 for the initial state). */
  step: number;
  /** Accumulated per-process counters. */
  acc: Accum;
  /** Measured signals fed to the simulation for this sample. */
  signals: Signals;
  /** Monitor counter values at sample time, used to compute the next sample's deltas. */
  busyMs: number;
  fsWrites: number;
  fsBytes: number;
  netBytes: number;
  /** Graph history (at most `HISTORY` points each): CPU %, memory pressure %, energy, and disk / network bytes per second. */
  hist: { sys: number[]; user: number[]; pressure: number[]; energy: number[]; read: number[]; write: number[]; rx: number[]; tx: number[] };
}

const HISTORY = 60; /** Number of samples kept for each graph. */
/**
 * Appends a value to a graph history, dropping the oldest points beyond `HISTORY`.
 *
 * Returns a new array and leaves the input untouched.
 *
 * @param {number[]} arr - Existing history, oldest first.
 * @param {number} v - The new sample.
 * @returns {number[]} The history with `v` appended, at most `HISTORY` long.
 *
 * @example
 * push([1, 2, 3], 4); // [1, 2, 3, 4]
 */
const push = (arr: number[], v: number) => [...arr.slice(-(HISTORY - 1)), v];

/**
 * Measures how much a per-PID counter grew between two samples.
 *
 * Sums the difference for every PID present in both maps, so processes that just appeared
 * (or disappeared) do not count. Negative totals are clamped to 0.
 *
 * @param {Record<number, number>} next - Counter values of the newer sample.
 * @param {Record<number, number>} prev - Counter values of the older sample.
 * @returns {number} Total growth across the shared PIDs (never negative).
 *
 * @example
 * growth({ 1: 50, 2: 10 }, { 1: 20 }); // 30
 */
function growth(next: Record<number, number>, prev: Record<number, number>): number {
  let sum = 0;
  for (const pid in prev) if (pid in next) sum += next[pid] - prev[pid];
  return Math.max(0, sum);
}

/**
 * Creates the sampling state used before the first tick.
 *
 * Captures the current time, the monitor's live signals and its current counters as the
 * baseline that the next sample's deltas are measured against. Busy share starts at 0 and all
 * graph histories start empty.
 *
 * @returns {Sample} An empty sample at step 0.
 *
 * @example
 * const [sample, setSample] = useState(initialSample);
 */
function initialSample(): Sample {
  return {
    t: Date.now() / 1000,
    step: 0,
    acc: emptyAccum(),
    signals: { busy: 0, fps: monitor.fps, fsBytesByApp: monitor.fsBytesByApp, netBytes: monitor.netBytes, frameBytes: monitor.frameBytes },
    busyMs: monitor.busyMs,
    fsWrites: monitor.fsWrites,
    fsBytes: monitor.fsBytes,
    netBytes: monitor.netBytes,
    hist: { sys: [], user: [], pressure: [], energy: [], read: [], write: [], rx: [], tx: [] },
  };
}

/**
 * Estimates the memory pressure shown in the Memory graph.
 *
 * Combines the simulated memory of all processes as a share of physical memory (weighted 0.6)
 * with the real JS heap usage as a share of its limit (weighted 2), so actual heap growth in
 * the page raises the graph. The heap part is 0 when `performance.memory` is unavailable. The
 * result is clamped to 4–100.
 *
 * @param {ProcRow[]} rows - Current process rows.
 * @param {number} physicalBytes - Physical memory size in bytes.
 * @returns {number} Memory pressure in percent (4–100).
 *
 * @example
 * memoryPressure(rows, 16 * 1024 ** 3); // e.g. 18.5
 */
function memoryPressure(rows: ProcRow[], physicalBytes: number): number {
  const heap = readHeap();
  const used = rows.reduce((a, r) => a + r.memory, 0);
  const base = (used / physicalBytes) * 100;
  const heapPart = heap ? (heap.used / heap.limit) * 100 : 0;
  return Math.min(100, Math.max(4, base * 0.6 + heapPart * 2));
}

/* ───────────────────────── Bottom panels ───────────────────────── */

/**
 * Renders one label/value line of the bottom panel.
 *
 * The optional color is applied to the label only (used as a legend for the graph series).
 *
 * @param {Object} props - Component props.
 * @param {string} props.label - Localized label text.
 * @param {string} props.value - Formatted value shown in bold.
 * @param {string} [props.color] - CSS color for the label.
 * @returns {JSX.Element} The stat line.
 *
 * @example
 * <Stat label="System:" value="3.25%" color="var(--red)" />
 */
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className={styles.stat}>
      <span style={color ? ({ color } as CSSProperties) : undefined}>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/**
 * Counts the files, folders and total file size of the virtual file system.
 *
 * Walks every node under `/` on each call, so it reflects the current FS state.
 *
 * @returns {{ files: number; dirs: number; bytes: number }} File count, folder count and total file content size in bytes.
 *
 * @example
 * const { files, dirs, bytes } = fsStats();
 */
function fsStats(): { files: number; dirs: number; bytes: number } {
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  for (const n of fs.walk('/')) {
    if (n.type === 'dir') dirs++;
    else {
      files++;
      bytes += fileSizeOf(n);
    }
  }
  return { files, dirs, bytes };
}

/**
 * Renders the bottom statistics panel for the selected tab.
 *
 * Each tab shows a column of summary stats, a history graph and a second column of stats:
 * CPU shows system / user / idle load and thread, process and core counts plus the measured
 * main-thread load; Memory shows device memory, simulated usage, the real JS heap and memory
 * pressure (graph turns yellow above 50% and red above 70%); Energy shows the real battery
 * status when the Battery Status API is available; Disk shows virtual FS writes, file counts
 * and the origin's storage estimate; Network shows packet totals, real bytes and requests
 * transferred by the page and the connection info. Totals come from all rows, not only the
 * filtered ones.
 *
 * @param {Object} props - Component props.
 * @param {Tab} props.tab - The selected tab.
 * @param {ProcRow[]} props.rows - All process rows of the current sample.
 * @param {Sample} props.sample - The current sample with its graph history.
 * @returns {JSX.Element} The panel for the selected tab.
 *
 * @example
 * <Panel tab="cpu" rows={allRows} sample={sample} />
 */
function Panel({ tab, rows, sample }: { tab: Tab; rows: ProcRow[]; sample: Sample }) {
  const t = useT();
  const locale = useLocale();
  const battery = useBattery();
  const connection = useConnection();
  const storage = useStorageEstimate();
  const h = sample.hist;
  /**
   * Returns the newest value of a history.
   *
   * Histories are stored oldest first, so this reads the last element; an empty history
   * yields 0.
   *
   * @param {number[]} a - History, oldest first.
   * @returns {number} The last value, or 0 when the history is empty.
   *
   * @example
   * last(h.sys); // 3.2
   */
  const last = (a: number[]) => a[a.length - 1] ?? 0;
  /**
   * Formats a percentage with two decimals.
   *
   * The value is used as-is (already in percent) and is not clamped.
   *
   * @param {number} v - Percentage value.
   * @returns {string} The value followed by '%', e.g. '12.50%'.
   *
   * @example
   * pct(12.5); // '12.50%'
   */
  const pct = (v: number) => `${v.toFixed(2)}%`;
  const physicalGB = deviceMemoryGB();
  const heap = readHeap();
  const totalMem = rows.reduce((a, r) => a + r.memory, 0);

  switch (tab) {
    case 'cpu': {
      const sys = last(h.sys);
      const user = last(h.user);
      return (
        <div className={styles.panel}>
          <div className={styles.stats}>
            <Stat label={t(S.system)} value={pct(sys)} color="var(--red)" />
            <Stat label={t(S.userPct)} value={pct(user)} color="var(--blue)" />
            <Stat label={t(S.idle)} value={pct(Math.max(0, 100 - sys - user))} />
          </div>
          <Graph series={[h.sys, h.user]} colors={['var(--red)', 'var(--blue)']} max={100} label={t(S.cpuLoad)} title={t(S.cpuLoad)} />
          <div className={styles.stats}>
            <Stat label={t(S.threads)} value={formatCount(rows.reduce((a, r) => a + r.threads, 0))} />
            <Stat label={t(S.processes)} value={String(rows.length)} />
            <Stat label={t(S.cores)} value={String(cpuCores())} />
            <Stat label={t(S.mainThread)} value={pct(sample.signals.busy * 100)} />
          </div>
        </div>
      );
    }
    case 'memory': {
      const appMem = rows.filter((r) => r.appId).reduce((a, r) => a + r.memory, 0);
      const wired = rows.filter((r) => r.name === 'kernel_task' || r.name === 'WindowServer').reduce((a, r) => a + r.memory, 0);
      return (
        <div className={styles.panel}>
          <div className={styles.stats}>
            <Stat label={t(S.physical)} value={physicalGB ? `${physicalGB >= 8 ? '≥ ' : ''}${physicalGB} GB` : osInfo.memory} />
            <Stat label={t(S.memUsed)} value={mem(totalMem)} />
            <Stat label={t(S.jsHeap)} value={heap ? `${mem(heap.used)} / ${mem(heap.limit)}` : t(S.na)} />
            <Stat label={t(S.swap)} value={t(S.zeroBytes)} />
          </div>
          <Graph series={[h.pressure]} colors={[last(h.pressure) > 70 ? 'var(--red)' : last(h.pressure) > 50 ? 'var(--yellow)' : 'var(--green)']} max={100} label={t(S.memPressure)} title={t(S.memPressure)} />
          <div className={styles.stats}>
            <Stat label={t(S.appMem)} value={mem(appMem)} />
            <Stat label={t(S.wired)} value={mem(wired)} />
            <Stat label={t(S.compressed)} value={mem(rows.reduce((a, r) => a + r.compressed, 0))} />
          </div>
        </div>
      );
    }
    case 'energy': {
      /**
       * Formats a battery time estimate as hours and minutes.
       *
       * Non-finite or non-positive values (which the Battery Status API reports while the
       * estimate is unknown) show the localized "Calculating…" text.
       *
       * @param {number} sec - Time in seconds.
       * @returns {string} 'h:mm', or the "Calculating…" text.
       *
       * @example
       * time(5400); // '1:30'
       */
      const time = (sec: number) => (Number.isFinite(sec) && sec > 0 ? `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}` : t(S.calculating));
      return (
        <div className={styles.panel}>
          <div className={styles.stats}>
            {battery ? (
              <>
                <Stat label={t(S.battery)} value={`${Math.round(battery.level * 100)}%`} />
                <Stat label={t(S.powerSource)} value={t(battery.charging ? S.ac : S.onBattery)} />
                <Stat label={t(battery.charging ? S.timeToFull : S.timeLeft)} value={battery.charging && battery.level >= 1 ? '—' : time(battery.charging ? battery.chargingTime : battery.dischargingTime)} />
              </>
            ) : (
              <div className={styles.note}>{battery === null ? t(S.noBattery) : t(S.calculating)}</div>
            )}
          </div>
          <Graph series={[h.energy]} colors={['var(--green)']} max={Math.max(40, ...h.energy) * 1.1} label={t(S.energyImpact)} title={t(S.energyImpact)} />
          <div className={styles.stats}>
            <Stat label={t(S.totalEnergy)} value={last(h.energy).toFixed(1)} />
            {battery && <Stat label={t(S.charging)} value={t(battery.charging ? S.yes : S.no)} />}
          </div>
        </div>
      );
    }
    case 'disk': {
      const st = fsStats();
      return (
        <div className={styles.panel}>
          <div className={styles.stats}>
            <Stat label={t(S.readsIn)} value={formatCount(Math.round(rows.reduce((a, r) => a + r.bytesRead, 0) / 4096))} color="var(--blue)" />
            <Stat label={t(S.writesOut)} value={`${formatCount(sample.fsWrites)} (${t(S.sinceOpen)})`} color="var(--red)" />
            <Stat label={t(S.dataWritten)} value={mem(monitor.fsBytes)} />
            <Stat label={t(S.storage)} value={storage ? `${formatBytes(storage.usage, locale)} / ${formatBytes(storage.quota, locale)}` : storage === null ? t(S.na) : '…'} />
          </div>
          <Graph series={[h.write, h.read]} colors={['var(--red)', 'var(--blue)']} max={Math.max(64 * 1024, ...h.read.map((v, i) => v + (h.write[i] ?? 0))) * 1.1} label={t(S.data)} title={t(S.data)} />
          <div className={styles.stats}>
            <Stat label={t(S.files)} value={formatCount(st.files)} />
            <Stat label={t(S.folders)} value={formatCount(st.dirs)} />
            <Stat label={t(S.fsSize)} value={mem(st.bytes)} />
          </div>
        </div>
      );
    }
    case 'network': {
      const rx = rows.reduce((a, r) => a + r.rcvdPackets, 0);
      const tx = rows.reduce((a, r) => a + r.sentPackets, 0);
      return (
        <div className={styles.panel}>
          <div className={styles.stats}>
            <Stat label={t(S.packetsIn)} value={formatCount(rx)} color="var(--blue)" />
            <Stat label={t(S.packetsOut)} value={formatCount(tx)} color="var(--red)" />
            <Stat label={t(S.dataReceived)} value={mem(monitor.netBytes)} />
            <Stat label={t(S.requests)} value={formatCount(monitor.netRequests)} />
          </div>
          <Graph series={[h.tx, h.rx]} colors={['var(--red)', 'var(--blue)']} max={Math.max(16 * 1024, ...h.rx.map((v, i) => v + (h.tx[i] ?? 0))) * 1.1} label={t(S.data)} title={t(S.data)} />
          <div className={styles.stats}>
            <Stat label={t(S.connection)} value={connection.online ? `${t(S.online)}${connection.effectiveType ? ` · ${connection.effectiveType.toUpperCase()}` : ''}` : t(S.offline)} />
            <Stat label={t(S.bandwidth)} value={connection.downlink !== undefined ? `${connection.downlink} Mbps` : t(S.unknown)} />
            <Stat label={t(S.latency)} value={connection.rtt !== undefined ? `${connection.rtt} ms` : t(S.unknown)} />
            <Stat label={t(S.frameRate)} value={`${sample.signals.fps} fps`} />
          </div>
        </div>
      );
    }
  }
}

/* ───────────────────────── Window ───────────────────────── */

/**
 * Activity Monitor window.
 *
 * Lists the running apps (from the window manager) together with the simulated system
 * processes in a sortable, filterable, searchable table, with CPU / Memory / Energy / Disk /
 * Network tabs and a bottom panel of live stats and graphs. While mounted it holds a reference
 * on the shared metrics `monitor`. Every update interval (1, 2 or 5 s, chosen in the View menu)
 * it advances the simulation with the real signals measured since the previous sample
 * (main-thread busy share, frame rate, FS writes, network bytes) and appends a point to each
 * graph history. The first sample ignores the monitor's deltas, because its observers replay
 * buffered page-load entries right after starting. Sort order is remembered per tab; the
 * window title shows the active filter. The Edit and View menus provide copy, find, filters,
 * tabs, update frequency, quit and inspect; ↑ / ↓ move the selection in the focused table.
 *
 * @param {AppProps} props - Standard app window props.
 * @param {string} props.windowId - ID of the window hosting the app.
 * @returns {JSX.Element} The Activity Monitor window content.
 *
 * @example
 * <ActivityMonitor windowId={id} pid={pid} args={{}} />
 */
export default function ActivityMonitor({ windowId }: AppProps) {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>('cpu');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sorts, setSorts] = useState(DEFAULT_SORT);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [interval, setIntervalMs] = useState(2000);
  const [relaunchVersion, setRelaunchVersion] = useState(0);
  const [sample, setSample] = useState(initialSample);
  const rootRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const bootedAt = useSystem((s) => s.bootedAt);
  const loggedInAt = useSystem((s) => s.loggedInAt);
  const processes = useWM((s) => s.processes);
  const activeAppId = useWM((s) => s.activeAppId);
  const counts = useWM(useShallow(windowStats));

  useEffect(() => {
    monitor.start();
    return () => monitor.stop();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setSample((prev) => {
        const now = Date.now() / 1000;
        const dt = Math.max(0.001, now - prev.t);
        const wmState = useWM.getState();
        const c = windowStats(wmState);
        const sys = useSystem.getState();
        const inputs = [...systemInputs(sys.bootedAt, sys.loggedInAt), ...appInputs(wmState, c)];
        const first = prev.step === 0;
        const signals: Signals = {
          busy: first ? 0 : Math.min(1, Math.max(0, (monitor.busyMs - prev.busyMs) / (dt * 1000))),
          fps: monitor.fps,
          fsBytesByApp: monitor.fsBytesByApp,
          netBytes: monitor.netBytes,
          frameBytes: monitor.frameBytes,
        };
        const acc = advance(prev.acc, inputs, now, dt, signals, c.__visible);
        const rows = buildRows(inputs, acc, now, prev.step + 1, signals, c.__visible);
        const cores = cpuCores();
        const sysCPU = rows.filter((r) => r.user !== owner.handle).reduce((a, r) => a + r.cpu, 0) / cores;
        const userCPU = rows.filter((r) => r.user === owner.handle).reduce((a, r) => a + r.cpu, 0) / cores;
        const read = growth(acc.read, prev.acc.read) / dt;
        const realNet = first ? 0 : Math.max(0, monitor.netBytes - prev.netBytes);
        const deviceGB = deviceMemoryGB() ?? 16;
        return {
          t: now,
          step: prev.step + 1,
          acc,
          signals,
          busyMs: monitor.busyMs,
          fsWrites: monitor.fsWrites,
          fsBytes: monitor.fsBytes,
          netBytes: monitor.netBytes,
          hist: {
            sys: push(prev.hist.sys, Math.min(100, sysCPU)),
            user: push(prev.hist.user, Math.min(100 - Math.min(100, sysCPU), userCPU)),
            pressure: push(prev.hist.pressure, memoryPressure(rows, deviceGB * 1024 ** 3)),
            energy: push(prev.hist.energy, rows.reduce((a, r) => a + r.energy, 0)),
            read: push(prev.hist.read, read),
            write: push(prev.hist.write, (first ? 0 : Math.max(0, monitor.fsBytes - prev.fsBytes)) / dt + read * 0.18),
            rx: push(prev.hist.rx, (growth(acc.rcvd, prev.acc.rcvd) + realNet) / dt),
            tx: push(prev.hist.tx, (growth(acc.sent, prev.acc.sent) + realNet * 0.04) / dt),
          },
        };
      });
    }, interval);
    return () => clearInterval(id);
  }, [interval]);

  const allRows = useMemo(() => {
    const wmState = { ...useWM.getState(), processes, activeAppId };
    const inputs = [...systemInputs(bootedAt, loggedInAt), ...appInputs(wmState, counts)];
    return buildRows(inputs, sample.acc, sample.t, sample.step, sample.signals, counts.__visible ?? 0);
    // `locale` re-translates app names; `relaunchVersion` picks up relaunched system processes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processes, activeAppId, counts, sample, bootedAt, loggedInAt, locale, relaunchVersion]);

  const sort = sorts[tab];
  const columns = COLUMNS[tab];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !String(r.pid).includes(q)) return false;
      switch (filter) {
        case 'mine':
          return r.user === owner.handle;
        case 'system':
          return r.user !== owner.handle;
        case 'active':
          return r.cpu >= 0.5;
        case 'windowed':
          return !!r.appId && r.windows > 0;
        default:
          return true;
      }
    });
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    const dir = sort.desc ? -1 : 1;
    return filtered.sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return cmp * dir || a.pid - b.pid;
    });
  }, [allRows, query, filter, columns, sort]);

  const selected = rows.find((r) => r.pid === selectedPid) ?? null;
  const filterLabel = t(FILTERS.find((f) => f.id === filter)!.label);

  useEffect(() => wm.setTitle(windowId, `${t(S.appName)} (${filterLabel})`), [windowId, filterLabel, t]);

  /**
   * Asks for confirmation and quits a process.
   *
   * Shows a Quit / Force Quit / Cancel sheet. Then, depending on the row's kill mode: app
   * processes quit their app through the window manager (forced when "Force Quit" was chosen);
   * WindowServer and loginwindow log the user out, as on macOS; agents that launchd relaunches
   * get a new, higher PID and start time, and the selection follows them; protected system
   * processes show a permission-denied alert instead.
   *
   * @async
   * @param {ProcRow | null} [row=selected] - The process to quit; does nothing when null.
   * @returns {Promise<void>} Resolves once the dialog is answered and the action is done.
   *
   * @example
   * void quitProcess();
   */
  const quitProcess = async (row: ProcRow | null = selected) => {
    if (!row) return;
    const choice = await dialogs.alert({
      windowId,
      appId: 'activity-monitor',
      title: S.quitTitle,
      message: fmt(t(S.quitMsg), { name: row.name }),
      buttons: [
        { label: S.forceQuit, value: 'force', danger: true },
        { label: S.cancel, value: 'cancel', cancel: true },
        { label: S.quit, value: 'quit', primary: true },
      ],
    });
    if (choice === 'cancel') return;
    switch (row.kill) {
      case 'app':
        if (row.appId) await wm.quit(row.appId, { force: choice === 'force' });
        break;
      case 'logout':
        power.logOut();
        break;
      case 'relaunch': {
        const original = SYSTEM_PROCESSES.find((p) => p.name === row.name && (relaunched.get(p.pid)?.pid ?? p.pid) === row.pid);
        if (!original) return;
        nextRelaunchPid += 1 + Math.floor(Math.random() * 40);
        relaunched.set(original.pid, { pid: nextRelaunchPid, startedAt: Date.now() });
        setSelectedPid(nextRelaunchPid);
        setRelaunchVersion((v) => v + 1);
        break;
      }
      case 'protected':
        await dialogs.alert({ windowId, appId: 'activity-monitor', title: fmt(t(S.denied), { name: row.name }), message: fmt(t(S.deniedMsg), { user: row.user }) });
        break;
    }
  };

  /**
   * Shows an alert with details about a process.
   *
   * Lists the PID, parent process, user, bundle identifier (apps only), CPU usage and time,
   * memory, threads, window count (apps only) and start time. The alert uses the process's
   * app ID when it has one.
   *
   * @param {ProcRow | null} [row=selected] - The process to inspect; does nothing when null.
   * @returns {void} Nothing.
   *
   * @example
   * inspect(row);
   */
  const inspect = (row: ProcRow | null = selected) => {
    if (!row) return;
    const lines = [
      `PID: ${row.pid}`,
      `${t(S.parent)}: launchd (1)`,
      `${t(S.user)}: ${row.user}`,
      row.bundleId && `${t(S.bundle)}: ${row.bundleId}`,
      `% CPU: ${row.cpu.toFixed(1)} · ${formatCPUTime(row.cpuTime)}`,
      `${t({ en: 'Memory', ko: '메모리' })}: ${mem(row.memory)}`,
      `${t({ en: 'Threads', ko: '스레드' })}: ${row.threads}`,
      row.appId && `${t(S.windows)}: ${row.windows}`,
      `${t(S.started)}: ${formatDate(row.startedAt, locale)}`,
    ].filter(Boolean);
    void dialogs.alert({ windowId, appId: row.appId ?? 'activity-monitor', title: `${row.name} (${row.pid})`, message: lines.join('\n') });
  };

  /**
   * Copies the selected row to the clipboard.
   *
   * Writes one `label<TAB>value` line per visible column of the current tab. Does nothing
   * without a selection; clipboard failures are ignored.
   *
   * @returns {void} Nothing.
   *
   * @example
   * copyRow();
   */
  const copyRow = () => {
    if (!selected) return;
    const text = columns.map((c) => `${t(c.label)}\t${c.format ? c.format(selected) : String(c.key === 'name' ? selected.name : c.value(selected))}`).join('\n');
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  /**
   * Sorts the current tab by a column.
   *
   * Choosing the active column flips the direction; a new column starts ascending for the name
   * and user columns and descending for every other column. Each tab keeps its own sort.
   *
   * @param {string} key - Column key to sort by.
   * @returns {void} Nothing.
   *
   * @example
   * setSort('memory');
   */
  const setSort = (key: string) => setSorts((s) => ({ ...s, [tab]: { key, desc: s[tab].key === key ? !s[tab].desc : key !== 'name' && key !== 'user' } }));

  useAppMenus(
    () => [
      {
        label: S.edit,
        items: [
          { label: S.copy, shortcut: 'mod+c', disabled: !selected, action: copyRow },
          { separator: true },
          {
            label: S.find,
            shortcut: 'mod+f',
            // Narrow windows show the search field in its own row; focus whichever one is visible.
            action: () => [...(rootRef.current?.querySelectorAll<HTMLInputElement>('.ui-search input') ?? [])].find((i) => i.getClientRects().length > 0)?.focus(),
          },
        ],
      },
      {
        label: S.view,
        items: [
          ...FILTERS.map<MenuItem>((f) => ({ label: f.label, checked: f.id === filter, action: () => setFilter(f.id) })),
          { separator: true },
          ...TABS.map<MenuItem>((x, i) => ({ label: x.label, shortcut: `mod+${i + 1}`, checked: x.id === tab, action: () => setTab(x.id) })),
          { separator: true },
          {
            label: S.updateFrequency,
            submenu: [
              { label: S.veryOften, checked: interval === 1000, action: () => setIntervalMs(1000) },
              { label: S.often, checked: interval === 2000, action: () => setIntervalMs(2000) },
              { label: S.normally, checked: interval === 5000, action: () => setIntervalMs(5000) },
            ],
          },
          { separator: true },
          { label: S.quitProcess, shortcut: 'mod+alt+q', disabled: !selected, action: () => void quitProcess() },
          { label: S.inspect, shortcut: 'mod+i', disabled: !selected, action: () => inspect() },
        ],
      },
    ],
    [selected, filter, tab, interval, columns, locale],
  );

  /**
   * Moves the table selection with the arrow keys.
   *
   * ↑ / ↓ select the previous / next visible row (the first row when nothing is selected),
   * clamped to the list, and scroll the new row into view on the next frame. Other keys are
   * ignored.
   *
   * @param {KeyboardEvent} e - Keydown event from the table.
   * @returns {void} Nothing.
   *
   * @example
   * <div role="grid" tabIndex={0} onKeyDown={onTableKey} />
   */
  const onTableKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = rows.findIndex((r) => r.pid === selectedPid);
    const next = rows[i === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    setSelectedPid(next.pid);
    requestAnimationFrame(() => tableRef.current?.querySelector(`[data-pid="${next.pid}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  const grid = columns.map((c) => (c.width ? `${c.width}px` : 'minmax(170px, 1fr)')).join(' ');

  return (
    <div ref={rootRef} className={styles.am}>
      <Toolbar className={styles.toolbar}>
        <div className={styles.titleBlock} data-drag-region>
          <div className={styles.title}>{t(S.appName)}</div>
          <div className={styles.subtitle}>{filterLabel}</div>
        </div>
        <GlassGroup>
          <IconButton label={t(S.quitProcess)} disabled={!selected} onClick={() => void quitProcess()}>
            <CircleX size={17} />
          </IconButton>
          <IconButton label={t(S.inspect)} disabled={!selected} onClick={() => inspect()}>
            <Info size={17} />
          </IconButton>
        </GlassGroup>
        <div className={styles.spacer} data-drag-region />
        <Segmented value={tab} onChange={setTab} options={TABS.map((x) => ({ value: x.id, label: t(x.label) }))} />
        <div className={styles.spacer} data-drag-region />
        <div className={styles.search}>
          <SearchField value={query} onChange={setQuery} placeholder={t(S.search)} style={{ width: '100%' }} />
        </div>
      </Toolbar>
      {/* Phone-width windows: the tabs take the toolbar, so search gets a row of its own. */}
      <div className={styles.searchRow}>
        <SearchField value={query} onChange={setQuery} placeholder={t(S.search)} style={{ width: '100%' }} />
      </div>

      <div ref={tableRef} className={styles.table} role="grid" aria-label={filterLabel} aria-rowcount={rows.length} tabIndex={0} onKeyDown={onTableKey}>
        <div className={styles.thead} role="row" style={{ gridTemplateColumns: grid }}>
          {columns.map((c) => {
            const active = sort.key === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="columnheader"
                aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                className={`${styles.th} ${c.width ? styles.num : ''} ${active ? styles.thActive : ''}`}
                onClick={() => setSort(c.key)}
              >
                <span>{t(c.label)}</span>
                {active && (sort.desc ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
              </button>
            );
          })}
        </div>
        {rows.map((r) => {
          const app = r.appId ? getApp(r.appId) : undefined;
          const Icon = app?.icon;
          return (
            <div
              key={r.pid}
              data-pid={r.pid}
              role="row"
              aria-selected={r.pid === selectedPid}
              className={`${styles.tr} ${r.pid === selectedPid ? styles.trSelected : ''}`}
              style={{ gridTemplateColumns: grid }}
              onMouseDown={() => setSelectedPid(r.pid)}
              onDoubleClick={() => inspect(r)}
            >
              {columns.map((c) =>
                c.key === 'name' ? (
                  <div key={c.key} role="gridcell" className={styles.nameCell}>
                    <span className={styles.procIcon}>{Icon ? <Icon size={16} /> : null}</span>
                    <span className={styles.procName}>{r.name}</span>
                  </div>
                ) : (
                  <div key={c.key} role="gridcell" className={c.key === 'user' || c.key === 'kind' ? styles.textCell : styles.numCell}>
                    {c.format ? c.format(r) : String(c.value(r))}
                  </div>
                ),
              )}
            </div>
          );
        })}
      </div>

      <Panel tab={tab} rows={allRows} sample={sample} />
    </div>
  );
}

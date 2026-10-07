/**
 * General and its sub-panes: About, Software Update, Language & Region, Transfer or Reset.
 */
import { useEffect, useMemo, useState } from 'react';
import { Globe, HardDrive, Info, RefreshCw, RotateCcw, Settings as Gear } from 'lucide-react';
import { Button } from '@/components/ui';
import { OSLogo } from '@/icons';
import { osInfo, owner, projects } from '@/data/portfolio';
import { dialogs, eraseAll, fmt, formatBytes, formatDate, fs, HOSTNAME, PATHS, power, useIsDark, useSystem, useT, wm, join, type Locale } from '@/kernel';
import { APPS } from '@/apps';
import { ActivityIndicator, ButtonBar, CheckRow, Hero, NavRow, onRadioGroupKeyDown, Pane, Row, Section, UsageBar } from '../kit';
import { useNav } from '../nav';
import { resetPrefs } from '../prefs';
import { parseBrowser, parseOS, serialNumber } from '../deviceInfo';
import { useFSStorage, useScreenInfo } from '../hooks';
import { useWallpaperURL } from '../media';
import { STORAGE_CATEGORIES, STORAGE_COLORS, STORAGE_NAMES } from '../storageStats';
import { LaptopArt } from './MachineArt';
import s from './panes.module.css';

const S = {
  general: { en: 'General', ko: '일반' },
  generalDesc: {
    en: 'Manage your overall setup and preferences for your computer, such as software updates, device language, storage, and more.',
    ko: '소프트웨어 업데이트, 기기 언어, 저장 공간 등 컴퓨터의 전반적인 설정 및 환경설정을 관리합니다.',
  },
  about: { en: 'About', ko: '정보' },
  softwareUpdate: { en: 'Software Update', ko: '소프트웨어 업데이트' },
  storage: { en: 'Storage', ko: '저장 공간' },
  language: { en: 'Language & Region', ko: '언어 및 지역' },
  reset: { en: 'Transfer or Reset', ko: '전송 또는 재설정' },
  used: { en: '{size} used', ko: '{size} 사용됨' },

  name: { en: 'Name', ko: '이름' },
  chip: { en: 'Chip', ko: '칩' },
  memory: { en: 'Memory', ko: '메모리' },
  serial: { en: 'Serial number', ko: '일련 번호' },
  build: { en: 'Build', ko: '빌드' },
  displays: { en: 'Displays', ko: '디스플레이' },
  builtInDisplay: { en: 'Built-in Display', ko: '내장 디스플레이' },
  displaySettings: { en: 'Display Settings…', ko: '디스플레이 설정…' },
  storageSettings: { en: 'Storage Settings…', ko: '저장 공간 설정…' },
  disk: { en: '{os} HD', ko: '{os} HD' },
  thisBrowser: { en: 'This Browser', ko: '이 브라우저' },
  browser: { en: 'Browser', ko: '브라우저' },
  engine: { en: 'Rendering engine', ko: '렌더링 엔진' },
  platform: { en: 'Operating system', ko: '운영체제' },
  cores: { en: 'CPU cores', ko: 'CPU 코어' },
  coresValue: { en: '{n} cores', ko: '{n}코어' },
  deviceMemory: { en: 'Device memory', ko: '기기 메모리' },
  memoryCapped: { en: '8 GB or more', ko: '8GB 이상' },
  screen: { en: 'Screen', ko: '화면' },
  languages: { en: 'Languages', ko: '언어' },
  timeZone: { en: 'Time zone', ko: '시간대' },
  browserFooter: {
    en: 'This information comes from your real browser and device. Nothing is sent anywhere.',
    ko: '이 정보는 실제 브라우저와 기기에서 가져온 것입니다. 어디에도 전송되지 않습니다.',
  },
  systemReport: { en: 'System Report…', ko: '시스템 리포트…' },

  checking: { en: 'Checking for updates…', ko: '업데이트 확인 중…' },
  upToDate: { en: 'Your computer is up to date — {os} {version}', ko: '컴퓨터가 최신 상태입니다 — {os} {version}' },
  lastChecked: { en: 'Last checked: {when}', ko: '마지막 확인: {when}' },
  checkNow: { en: 'Check Now', ko: '지금 확인' },
  learnMore: { en: 'Learn More…', ko: '더 알아보기…' },
  automatic: { en: 'Automatic updates', ko: '자동 업데이트' },
  automaticValue: { en: 'Updates are installed every time you reload', ko: '새로 고칠 때마다 업데이트가 설치됨' },

  preferred: { en: 'Preferred Languages', ko: '선호하는 언어' },
  preferredFooter: {
    en: 'The whole system — menus, apps and dialogs — switches instantly. Files that already exist keep their names.',
    ko: '메뉴, 앱, 대화상자 등 시스템 전체가 즉시 전환됩니다. 이미 있는 파일의 이름은 그대로 유지됩니다.',
  },
  primary: { en: 'Primary', ko: '기본' },
  region: { en: 'Region', ko: '지역' },
  regionValue: { en: 'United States', ko: '대한민국' },
  calendar: { en: 'Calendar', ko: '달력' },
  gregorian: { en: 'Gregorian', ko: '양력' },
  temperature: { en: 'Temperature', ko: '온도' },
  temperatureValue: { en: 'Fahrenheit (°F)', ko: '섭씨(°C)' },
  firstDay: { en: 'First day of week', ko: '주의 시작 요일' },
  sunday: { en: 'Sunday', ko: '일요일' },
  browserLanguage: { en: 'Browser language', ko: '브라우저 언어' },
  preview: { en: 'Format Preview', ko: '형식 미리보기' },
  dateTime: { en: 'Date & time', ko: '날짜 및 시간' },
  shortDate: { en: 'Short date', ko: '짧은 날짜' },
  number: { en: 'Number', ko: '숫자' },
  currency: { en: 'Currency', ko: '통화' },

  resetDesc: {
    en: 'Erase this computer and start over with a fresh copy of {os}. Everything you created or changed is removed.',
    ko: '이 컴퓨터를 지우고 새로운 {os}(으)로 다시 시작합니다. 생성하거나 변경한 모든 항목이 제거됩니다.',
  },
  eraseRow: { en: 'Erase All Content and Settings', ko: '모든 콘텐츠 및 설정 지우기' },
  eraseSub: {
    en: 'Removes your files, settings, app data, Wi-Fi networks and password, then restarts.',
    ko: '파일, 설정, 앱 데이터, Wi-Fi 네트워크 및 암호를 제거한 다음 재시동합니다.',
  },
  eraseButton: { en: 'Erase All Content and Settings…', ko: '모든 콘텐츠 및 설정 지우기…' },
  eraseTitle: { en: 'Erase all content and settings?', ko: '모든 콘텐츠 및 설정을 지우겠습니까?' },
  eraseMsg: {
    en: 'All files you created and every setting you changed will be removed, and the computer will restart. You can’t undo this action.',
    ko: '생성한 모든 파일과 변경한 모든 설정이 제거되고 컴퓨터가 재시동됩니다. 이 동작은 실행 취소할 수 없습니다.',
  },
  eraseOk: { en: 'Erase', ko: '지우기' },
  downloadBeforeReset: { en: 'Back up a file first? Use “Download to This Computer” in Finder.', ko: '먼저 파일을 백업하려면 Finder에서 ‘이 컴퓨터로 다운로드’를 사용하십시오.' },
}; /** Localized strings for the General pane and its sub-panes. */

/* ───────────────────────── General ───────────────────────── */

/**
 * Renders the General settings pane.
 *
 * Shows the General hero followed by navigation rows to About, Software Update, Storage (with the
 * virtual disk's used size), Language & Region (with the current language's native name) and
 * Transfer or Reset.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <GeneralPane />
 */
export function GeneralPane() {
  const t = useT();
  const { go } = useNav();
  const locale = useSystem((st) => st.settings.locale);
  const storage = useFSStorage();
  return (
    <Pane>
      <Hero icon={Gear} color="#8e8e93" title={t(S.general)} description={t(S.generalDesc)} />
      <Section>
        <NavRow icon={Info} color="#8e8e93" label={t(S.about)} onClick={() => go('about')} />
        <NavRow icon={RefreshCw} color="#8e8e93" label={t(S.softwareUpdate)} onClick={() => go('software-update')} />
      </Section>
      <Section>
        <NavRow icon={HardDrive} color="#8e8e93" label={t(S.storage)} detail={fmt(t(S.used), { size: formatBytes(storage.total, locale) })} onClick={() => go('storage')} />
      </Section>
      <Section>
        <NavRow icon={Globe} color="#0a84ff" label={t(S.language)} detail={locale === 'ko' ? '한국어' : 'English'} onClick={() => go('language')} />
      </Section>
      <Section>
        <NavRow icon={RotateCcw} color="#8e8e93" label={t(S.reset)} onClick={() => go('reset')} />
      </Section>
    </Pane>
  );
}

/* ───────────────────────── About ───────────────────────── */

/**
 * Renders the About settings pane.
 *
 * Shows a laptop illustration with the current wallpaper and the machine facts from the
 * portfolio's `osInfo` (host name, chip, memory, a serial number derived from the owner handle and
 * build, OS version and build), the display resolution and virtual disk usage with buttons to
 * their panes, and real facts about the visitor's browser and device read once on mount (browser,
 * engine, OS, CPU cores, device memory, screen, languages and time zone). The cores and device
 * memory rows are omitted when the browser doesn't report them, and a device memory of 8 GB or
 * more is shown as "8 GB or more" because browsers cap the reported value. "System Report…"
 * launches Activity Monitor.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <AboutPane />
 */
export function AboutPane() {
  const t = useT();
  const { go } = useNav();
  const locale = useSystem((st) => st.settings.locale);
  const dark = useIsDark();
  const wallpaper = useWallpaperURL(useSystem((st) => st.settings.wallpaper), dark);
  const scr = useScreenInfo();
  const storage = useFSStorage();

  const env = useMemo(() => {
    const ua = navigator.userAgent;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      browser: parseBrowser(ua),
      os: parseOS(ua, navigator.maxTouchPoints),
      cores: navigator.hardwareConcurrency || 0,
      memory: nav.deviceMemory,
      languages: navigator.languages?.length ? navigator.languages.join(', ') : navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }, []);

  return (
    <Pane>
      <div className={s.machineHeader}>
        <LaptopArt wallpaper={wallpaper} width={210} />
        <div className={s.machineName}>{t(osInfo.machine)}</div>
        <div className={s.machineSub}>{osInfo.year}</div>
      </div>

      <Section>
        <Row label={t(S.name)}>
          <span className="selectable">{HOSTNAME}</span>
        </Row>
        <Row label={t(S.chip)}>{osInfo.chip}</Row>
        <Row label={t(S.memory)}>{osInfo.memory}</Row>
        <Row label={t(S.serial)}>
          <span className="selectable">{serialNumber(owner.handle + osInfo.build)}</span>
        </Row>
        <Row label={osInfo.name}>
          {t(osInfo.codename)} {osInfo.version}
        </Row>
        <Row label={t(S.build)}>
          <span className="selectable">{osInfo.build}</span>
        </Row>
      </Section>

      <Section title={t(S.displays)}>
        <Row label={t(S.builtInDisplay)} sublabel={`${scr.screenW} × ${scr.screenH}`}>
          <Button onClick={() => go('displays')}>{t(S.displaySettings)}</Button>
        </Row>
      </Section>

      <Section title={t(S.storage)}>
        <Row label={fmt(t(S.disk), { os: osInfo.name })} sublabel={fmt(t(S.used), { size: formatBytes(storage.total, locale) })}>
          <Button onClick={() => go('storage')}>{t(S.storageSettings)}</Button>
        </Row>
        <Row
          label={
            <UsageBar
              height={8}
              total={storage.total}
              label={fmt(t(S.used), { size: formatBytes(storage.total, locale) })}
              segments={STORAGE_CATEGORIES.map((c) => ({ key: c, value: storage.byCategory[c], color: STORAGE_COLORS[c], title: t(STORAGE_NAMES[c]) }))}
            />
          }
        />
      </Section>

      <Section title={t(S.thisBrowser)} footer={t(S.browserFooter)}>
        <Row label={t(S.browser)}>{`${env.browser.name} ${env.browser.version}`.trim()}</Row>
        <Row label={t(S.engine)}>{env.browser.engine}</Row>
        <Row label={t(S.platform)}>{env.os}</Row>
        {env.cores > 0 && <Row label={t(S.cores)}>{fmt(t(S.coresValue), { n: env.cores })}</Row>}
        {env.memory !== undefined && <Row label={t(S.deviceMemory)}>{env.memory >= 8 ? t(S.memoryCapped) : `${env.memory} GB`}</Row>}
        <Row label={t(S.screen)}>{`${scr.screenW} × ${scr.screenH} @ ${Number(scr.dpr.toFixed(2))}×`}</Row>
        <Row label={t(S.languages)}>
          <span className={s.ellipsis}>{env.languages}</span>
        </Row>
        <Row label={t(S.timeZone)}>{env.timeZone}</Row>
      </Section>
      <ButtonBar>
        <Button onClick={() => wm.launch('activity-monitor')}>{t(S.systemReport)}</Button>
      </ButtonBar>
    </Pane>
  );
}

/* ───────────────────────── Software Update ───────────────────────── */

const CHECK_MS = 1500; /** Duration of the simulated update check, in milliseconds. */

/**
 * Renders the Software Update settings pane.
 *
 * Simulates an update check: a spinner shows for {@link CHECK_MS} ms, then the pane reports that
 * the system is up to date along with the time of the check. "Check Now" clears the result and
 * reruns the check (it is disabled while a check is running). "Learn More…" opens the first
 * portfolio project's README when that file exists and otherwise launches the Projects app; it is
 * hidden when there are no projects.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <SoftwareUpdatePane />
 */
export function SoftwareUpdatePane() {
  const t = useT();
  const locale = useSystem((st) => st.settings.locale);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => setCheckedAt(Date.now()), CHECK_MS);
    return () => clearTimeout(id);
  }, [run]);

  const checking = checkedAt === null;
  const readme = projects[0] ? join(PATHS.projects, projects[0].name, 'README.md') : null;

  return (
    <Pane>
      <Section>
        <div className={s.updateBox} aria-live="polite">
          {checking ? (
            <>
              <ActivityIndicator size={22} />
              <div className={s.updateText}>{t(S.checking)}</div>
            </>
          ) : (
            <>
              <span className={s.updateLogo}>
                <OSLogo size={34} color="#fff" />
              </span>
              <div className={s.updateTitle}>{fmt(t(S.upToDate), { os: osInfo.name, version: osInfo.version })}</div>
              <div className={s.updateText}>{fmt(t(S.lastChecked), { when: formatDate(checkedAt, locale, { dateStyle: 'medium', timeStyle: 'short' }) })}</div>
            </>
          )}
        </div>
      </Section>
      <Section>
        <Row label={t(S.automatic)} sublabel={t(S.automaticValue)} />
        <Row label={`${osInfo.name} ${osInfo.version} (${osInfo.build})`} sublabel={t(osInfo.codename)}>
          {readme && (
            <Button onClick={() => (fs.exists(readme) ? wm.openPath(readme) : wm.launch('projects'))}>{t(S.learnMore)}</Button>
          )}
        </Row>
      </Section>
      <ButtonBar>
        <Button
          disabled={checking}
          onClick={() => {
            setCheckedAt(null);
            setRun((n) => n + 1);
          }}
        >
          {t(S.checkNow)}
        </Button>
      </ButtonBar>
    </Pane>
  );
}

/* ───────────────────────── Language & Region ───────────────────────── */

const LANGUAGES: { id: Locale; native: string; other: { en: string; ko: string } }[] = [
  { id: 'en', native: 'English', other: { en: 'English', ko: '영어' } },
  { id: 'ko', native: '한국어', other: { en: 'Korean', ko: '한국어' } },
]; /** Supported system languages with their native name and their name in each locale. */

/**
 * Renders the Language & Region settings pane.
 *
 * Lists the supported languages as a radio group with the current one first and marked as
 * primary; choosing one sets `settings.locale`, which switches the whole UI immediately. The
 * Region section shows fixed values for the current locale plus the browser's own language, and
 * the Format Preview section formats a date captured on mount, a number and a currency amount
 * (USD or KRW) with `Intl` for the en-US or ko-KR tag.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <LanguagePane />
 */
export function LanguagePane() {
  const t = useT();
  const locale = useSystem((st) => st.settings.locale);
  const updateSettings = useSystem((st) => st.updateSettings);
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  const sample = useMemo(() => new Date(), []);
  const ordered = [...LANGUAGES].sort((a, b) => (a.id === locale ? -1 : b.id === locale ? 1 : 0));

  return (
    <Pane>
      <Section title={t(S.preferred)} footer={t(S.preferredFooter)}>
        <div role="radiogroup" aria-label={t(S.preferred)} onKeyDown={onRadioGroupKeyDown}>
          {ordered.map((l) => (
            <CheckRow
              key={l.id}
              label={l.native}
              sublabel={l.id === locale ? `${t(l.other)} — ${t(S.primary)}` : t(l.other)}
              checked={l.id === locale}
              onSelect={() => updateSettings({ locale: l.id })}
            />
          ))}
        </div>
      </Section>

      <Section title={t(S.region)}>
        <Row label={t(S.region)}>{t(S.regionValue)}</Row>
        <Row label={t(S.calendar)}>{t(S.gregorian)}</Row>
        <Row label={t(S.temperature)}>{t(S.temperatureValue)}</Row>
        <Row label={t(S.firstDay)}>{t(S.sunday)}</Row>
        <Row label={t(S.browserLanguage)}>{navigator.language}</Row>
      </Section>

      <Section title={t(S.preview)}>
        <Row label={t(S.dateTime)}>{new Intl.DateTimeFormat(tag, { dateStyle: 'full', timeStyle: 'short' }).format(sample)}</Row>
        <Row label={t(S.shortDate)}>{new Intl.DateTimeFormat(tag, { dateStyle: 'short' }).format(sample)}</Row>
        <Row label={t(S.number)}>{new Intl.NumberFormat(tag).format(1234567.89)}</Row>
        <Row label={t(S.currency)}>{new Intl.NumberFormat(tag, { style: 'currency', currency: locale === 'ko' ? 'KRW' : 'USD' }).format(locale === 'ko' ? 1234567 : 1234.56)}</Row>
      </Section>
    </Pane>
  );
}

/* ───────────────────────── Transfer or Reset ───────────────────────── */

const RESET_IN_PLACE = new Set(['webos.system', 'webos.settings-app']); /** localStorage keys "Erase All" resets in place (kernel settings, this app's prefs). */
const RELOAD_AFTER_MS = 950; /** Delay before reloading after "Erase All", timed to the end of the ~1s restart fade. */

/**
 * Removes the data every other app persisted in localStorage.
 *
 * Collects all keys first (removing while iterating would shift the indices), then deletes each
 * key in the "webos." namespace (Mail, Calculator, widgets…) except those in
 * {@link RESET_IN_PLACE}. When localStorage is unavailable, for example in private mode, nothing
 * is removed and no error is raised.
 *
 * @returns {void}
 *
 * @example
 * forgetAppData();
 */
function forgetAppData(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const k of keys) if (k?.startsWith('webos.') && !RESET_IN_PLACE.has(k)) localStorage.removeItem(k);
  } catch {
    /* Storage can be unavailable (private mode); the reload still resets in-memory state. */
  }
}

/**
 * Renders the Transfer or Reset settings pane.
 *
 * Shows a hero describing the factory reset and an "Erase All Content and Settings…" button that
 * runs it after confirmation, with a footer suggesting how to back up files first.
 *
 * @returns {JSX.Element} The pane content.
 *
 * @example
 * <ResetPane />
 */
export function ResetPane() {
  const t = useT();
  const { windowId } = useNav();

  /**
   * Erases all content and settings after confirmation, then restarts.
   *
   * Asks for confirmation in a destructive sheet. When confirmed it resets this app's prefs and
   * the kernel settings, re-seeds the file system in the locale left after that reset (so seeded
   * file names match the language after restart), removes every other app's persisted data,
   * starts the restart transition and reloads the page after {@link RELOAD_AFTER_MS} ms so that
   * every app's in-memory state is discarded too, like a freshly booted machine.
   *
   * @async
   * @returns {Promise<void>} Resolves once the user cancels or the reset has been started.
   *
   * @example
   * <Button variant="danger" onClick={() => void erase()}>Erase All Content and Settings…</Button>
   */
  const erase = async () => {
    const ok = await dialogs.confirm({ windowId, appId: 'settings', title: S.eraseTitle, message: S.eraseMsg, okLabel: S.eraseOk, danger: true });
    if (!ok) return;
    resetPrefs();
    useSystem.getState().resetSettings();
    eraseAll(useSystem.getState().settings.locale, APPS);
    forgetAppData();
    power.restart();
    window.setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
  };

  return (
    <Pane>
      <Hero icon={RotateCcw} color="#8e8e93" title={t(S.reset)} description={fmt(t(S.resetDesc), { os: osInfo.name })} />
      <Section footer={t(S.downloadBeforeReset)}>
        <Row label={t(S.eraseRow)} sublabel={t(S.eraseSub)}>
          <Button variant="danger" onClick={() => void erase()}>
            {t(S.eraseButton)}
          </Button>
        </Row>
      </Section>
    </Pane>
  );
}

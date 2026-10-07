/**
 * Linux — a real Alpine Linux PC emulated in the browser (v86).
 *
 * The window shows the machine's text console and a status bar. The machine has no network. It
 * resumes from a booted snapshot, so a shell is ready as soon as the snapshot is downloaded;
 * files are fetched lazily as programs open them. Nothing is saved: closing the window or
 * restarting the machine discards every change.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { V86 } from 'v86';
import { useAppMenus, useT, useWindow, type AppProps, type LString } from '@/kernel';
import { createMachine } from './machine';
import styles from './Linux.module.css';

const S = {
  machine: { en: 'Machine', ko: '머신' },
  restart: { en: 'Restart Machine', ko: '머신 재시동' },
  loading: { en: 'Loading Linux…', ko: 'Linux 불러오는 중…' },
  starting: { en: 'Starting…', ko: '시작하는 중…' },
  running: { en: 'Running', ko: '실행 중' },
  failed: { en: 'The virtual machine could not start.', ko: '가상 머신을 시작할 수 없습니다.' },
  offline: { en: 'Offline', ko: '오프라인' },
  ephemeral: { en: 'Changes are lost when the window closes.', ko: '창을 닫으면 변경 사항이 사라집니다.' },
  screen: { en: 'Linux console', ko: 'Linux 콘솔' },
} satisfies Record<string, LString>; /** Localized strings for the menu, status bar and console label. */

/** Lifecycle of the emulator: downloading the snapshot, running, or failed to start. */
type Phase = 'loading' | 'running' | 'failed';

/**
 * The Linux app window.
 *
 * Creates the emulator on mount (and again for each restart, keyed by `generation`) and destroys
 * it on unmount. Download progress of the snapshot drives the progress bar; once the emulator
 * is ready, the guest keyboard is enabled only while this window is focused. The console is scaled to fit the window without distorting it. A Machine menu offers
 * restarting from the snapshot.
 *
 * @param {AppProps} _props - Window props supplied by the window manager (unused).
 * @returns {JSX.Element} The window content.
 *
 * @example
 * wm.launch('linux');
 */
export default function Linux(_props: AppProps) {
  const t = useT();
  const { focused } = useWindow();
  const viewportRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const vmRef = useRef<V86 | null>(null);
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    setPhase('loading');
    setProgress(0);
    let vm: V86;
    try {
      vm = createMachine(screen);
    } catch {
      setPhase('failed');
      return;
    }
    vmRef.current = vm;
    vm.add_listener('download-progress', (e) => {
      if (e.lengthComputable && e.total > 0 && /state/.test(e.file_name)) setProgress(e.loaded / e.total);
    });
    vm.add_listener('download-error', () => setPhase('failed'));
    vm.add_listener('emulator-ready', () => setPhase('running'));
    return () => {
      vmRef.current = null;
      void vm.destroy();
    };
  }, [generation]);

  useEffect(() => {
    if (phase === 'running') vmRef.current?.keyboard_set_enabled(focused);
  }, [focused, phase]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const screen = screenRef.current;
    if (!viewport || !screen || typeof ResizeObserver === 'undefined') return;
    /**
     * Scales the console so it fits the viewport, keeping its aspect ratio.
     *
     * @returns {void}
     *
     * @example
     * fit();
     */
    const fit = () => {
      const w = screen.offsetWidth;
      const h = screen.offsetHeight;
      if (!w || !h) return;
      setScale(Math.min(viewport.clientWidth / w, viewport.clientHeight / h, 1.6));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(viewport);
    ro.observe(screen);
    return () => ro.disconnect();
  }, [generation]);

  /**
   * Restarts the machine from its snapshot, discarding all changes.
   *
   * @returns {void}
   *
   * @example
   * restart();
   */
  const restart = useCallback(() => setGeneration((g) => g + 1), []);

  useAppMenus(() => [{ label: S.machine, items: [{ label: S.restart, action: restart }] }], [restart]);

  return (
    <div className={styles.root}>
      <div ref={viewportRef} className={styles.viewport}>
        <div ref={screenRef} key={generation} className={styles.screen} style={{ transform: `scale(${scale})` }} role="application" aria-label={t(S.screen)}>
          <div className={styles.text} />
          <canvas className={styles.canvas} />
        </div>
        {phase !== 'running' && (
          <div className={styles.overlay}>
            {phase === 'failed' ? (
              <p>{t(S.failed)}</p>
            ) : (
              <>
                <p>{t(progress < 1 ? S.loading : S.starting)}</p>
                <div className={styles.track}>
                  <div className={styles.fill} style={{ transform: `scaleX(${progress})` }} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <footer className={styles.status}>
        <span className={`${styles.dot} ${phase === 'running' ? styles.running : ''}`} aria-hidden="true" />
        <span>{phase === 'running' ? `${t(S.running)} · ${t(S.offline)}` : t(S.starting)}</span>
        <span className={styles.note}>{t(S.ephemeral)}</span>
      </footer>
    </div>
  );
}

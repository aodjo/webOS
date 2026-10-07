/**
 * Building blocks shared by every dialog surface (system alerts, window sheets, file panels and
 * the Force Quit window): the glass panel shell with focus + keyboard handling, the close lifecycle
 * and the Tahoe-style alert body.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { dismissDialog, getApp, isMacHost } from '@/kernel';
import { Button } from '@/components/ui';
import { OSLogo } from '@/icons';
import { KEY_PRIORITY, useModalKeys } from './modalKeys';
import styles from './Dialogs.module.css';

/** How a dialog is presented: a sheet attached to a window, or a centered system modal. */
export type DialogMode = 'sheet' | 'modal';

export const EXIT_MS = 170; /** Exit animation length in ms; matches the 0.17s exit keyframes in Dialogs.module.css. */

/**
 * Manages the close lifecycle of a dialog panel.
 *
 * `finish` runs the given resolver exactly once (later calls are ignored) and switches the
 * panel into its leaving state so the exit animation can play. EXIT_MS later the request is
 * removed from the kernel queue with `dismissDialog`. The effect cleanup dismisses it as well,
 * so the request is always removed even when the panel unmounts before the timer fires (for
 * example because its window closed).
 *
 * @param {string} id - Id of the dialog request in the kernel dialog queue.
 * @returns {{ leaving: boolean; finish: (resolve: () => void) => void }} `leaving` is true once
 *   the dialog has been answered; `finish` resolves the request and starts the exit.
 *
 * @example
 * const { leaving, finish } = useFinish(req.id);
 * const cancel = () => finish(() => req.resolve(null));
 */
export function useFinish(id: string): { leaving: boolean; finish: (resolve: () => void) => void } {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  /**
   * Resolves the dialog once and starts its exit animation.
   *
   * The first call runs `resolve` and sets `leaving`; every later call is ignored, so a
   * double click or a key repeat cannot answer the request twice.
   *
   * @param {() => void} resolve - Callback that resolves the dialog request.
   * @returns {void}
   *
   * @example
   * finish(() => req.resolve('ok'));
   */
  const finish = useCallback((resolve: () => void) => {
    if (done.current) return;
    done.current = true;
    resolve();
    setLeaving(true);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => dismissDialog(id), EXIT_MS);
    return () => {
      clearTimeout(timer);
      dismissDialog(id);
    };
  }, [leaving, id]);
  return { leaving, finish };
}

/**
 * Tells whether the host's command modifier is held.
 *
 * Checks ⌘ (`metaKey`) on Mac hosts and Ctrl (`ctrlKey`) everywhere else, matching the `mod`
 * convention used by menu shortcuts.
 *
 * @param {{ metaKey: boolean; ctrlKey: boolean }} e - Any event carrying modifier flags.
 * @returns {boolean} True when the command modifier is pressed.
 *
 * @example
 * if (isModKey(e) && e.key === '.') cancel();
 */
export const isModKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMacHost ? e.metaKey : e.ctrlKey);

/**
 * Tells whether a key was pressed without command modifiers.
 *
 * Compares `e.key` exactly and rejects the event when ⌘, Ctrl or ⌥ is held; Shift is not
 * checked. Used for plain Return / Escape handling in dialogs.
 *
 * @param {KeyboardEvent} e - The keydown event.
 * @param {string} key - Expected `KeyboardEvent.key` value, e.g. `'Enter'` or `'Escape'`.
 * @returns {boolean} True when `e.key` equals `key` and no ⌘/Ctrl/⌥ modifier is held.
 *
 * @example
 * if (isPlainKey(e, 'Enter')) submit();
 */
export const isPlainKey = (e: KeyboardEvent, key: string) => e.key === key && !e.metaKey && !e.ctrlKey && !e.altKey;

interface PanelShellProps {
  mode: DialogMode;
  /** This panel currently receives the keyboard (its window is focused / it is the system modal). */
  active: boolean;
  leaving: boolean;
  /** Key priority for sheets (window sheets vs. the Force Quit window's sheet). */
  sheetPriority?: number;
  /** Key handler; returns true when it handled the key. */
  onKey: (e: KeyboardEvent) => boolean;
  /** Element focused when the panel becomes active (defaults to the panel itself). */
  initialFocus?: RefObject<HTMLElement | null>;
  labelledBy?: string;
  label?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Renders the floating panel shared by alerts, sheets and file panels.
 *
 * The panel uses the thick Liquid Glass material and the sheet or modal enter/exit animation.
 * While it is active and not leaving it registers with `useModalKeys` (system priority for
 * modals, `sheetPriority` for sheets), so keys are routed to `onKey` and Tab stays inside the
 * panel. On mount it remembers the focused element and, on unmount, gives focus back to it if
 * focus would otherwise fall to `document.body`. Whenever the panel becomes active while focus
 * is outside it, focus moves to `initialFocus` or to the panel itself. The browser context
 * menu is suppressed inside the panel.
 *
 * @param {PanelShellProps} props - Component props.
 * @param {DialogMode} props.mode - `'sheet'` to hang from a window, `'modal'` for a centered system modal.
 * @param {boolean} props.active - Whether this panel currently receives the keyboard.
 * @param {boolean} props.leaving - Whether the exit animation is playing.
 * @param {number} [props.sheetPriority=KEY_PRIORITY.sheet] - Key priority used in sheet mode.
 * @param {(e: KeyboardEvent) => boolean} props.onKey - Key handler; returns true when it handled the key.
 * @param {RefObject<HTMLElement | null>} [props.initialFocus] - Element focused when the panel becomes active.
 * @param {string} [props.labelledBy] - Id of the element that labels the dialog.
 * @param {string} [props.label] - Accessible label used when `labelledBy` is not given.
 * @param {string} [props.className=''] - Extra class names for the panel.
 * @param {CSSProperties} [props.style] - Inline styles for the panel.
 * @param {ReactNode} props.children - Panel content.
 * @returns {JSX.Element} The dialog panel element.
 *
 * @example
 * <PanelShell mode="modal" active leaving={leaving} onKey={onKey} labelledBy={titleId}>
 *   <AlertBody icon={<AlertIcon />} title="Saved" titleId={titleId} buttons={buttons} />
 * </PanelShell>
 */
export function PanelShell({ mode, active, leaving, sheetPriority = KEY_PRIORITY.sheet, onKey, initialFocus, labelledBy, label, className = '', style, children }: PanelShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalKeys({ enabled: active && !leaving, priority: mode === 'modal' ? KEY_PRIORITY.system : sheetPriority, modal: true, panel: ref, onKey });

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const now = document.activeElement;
      if (prev && prev.isConnected && (!now || now === document.body)) prev.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!active || leaving) return;
    const el = ref.current;
    if (!el || el.contains(document.activeElement)) return;
    (initialFocus?.current ?? el).focus({ preventScroll: true });
  }, [active, leaving, initialFocus]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={-1}
      data-modal-panel=""
      className={`lg lg-thick lg-float ${styles.panel} ${mode === 'sheet' ? styles.sheet : styles.modal} ${leaving ? styles.leaving : ''} ${className}`}
      style={style}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

/* ───────────────────────── Alert body ───────────────────────── */

/**
 * Renders the icon shown at the top of an alert.
 *
 * Uses the registered icon of `appId` at 64px when that app exists; otherwise (no id, or an
 * unknown app) falls back to the OS logo on a grey rounded tile.
 *
 * @param {Object} props - Component props.
 * @param {string} [props.appId] - Id of the app whose icon to show.
 * @returns {JSX.Element} The app icon or the system icon tile.
 *
 * @example
 * <AlertIcon appId={req.appId ?? fallbackAppId} />
 */
export function AlertIcon({ appId }: { appId?: string }) {
  const Icon = appId ? getApp(appId)?.icon : undefined;
  if (Icon) return <Icon size={64} />;
  return (
    <span className={styles.systemIcon} aria-hidden>
      <OSLogo size={34} color="#fff" />
    </span>
  );
}

/** One button rendered by {@link AlertBody}. */
export interface AlertButtonSpec {
  /** React key, unique within the alert. */
  key: string;
  label: string;
  /** Default button: accent style, placed last (rightmost in a row, bottom of a stack). */
  primary?: boolean;
  /** Destructive action, drawn in the danger style unless it is also primary. */
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * Estimates the rendered width of a 13px button label.
 *
 * Counts each Hangul, kana, CJK or full-width character as 13px and every other character as
 * 7.2px. The estimate only decides whether alert buttons fit side by side, so no text is
 * measured in the DOM.
 *
 * @param {string} s - The label text.
 * @returns {number} Approximate width in pixels.
 *
 * @example
 * labelWidth('OK'); // 14.4
 */
function labelWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 13 : 7.2;
  return w;
}

/**
 * Lays out the body of a macOS Tahoe-style alert.
 *
 * Shows the icon, a bold title, an optional secondary message and optional accessory content
 * (such as a text field), followed by capsule buttons. Buttons are reordered so the primary
 * (default) button comes last. They sit side by side, default on the right, unless there are
 * three or more or any label is estimated wider than 84px; then they stack full-width with the
 * default button at the bottom.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.icon - Icon shown above the title.
 * @param {string} props.title - Alert title.
 * @param {string} props.titleId - Id given to the title element, for `aria-labelledby`.
 * @param {string} [props.message] - Secondary message below the title.
 * @param {AlertButtonSpec[]} props.buttons - Buttons to render.
 * @param {ReactNode} [props.children] - Accessory content placed between the message and the buttons.
 * @returns {JSX.Element} The alert body.
 *
 * @example
 * <AlertBody icon={<AlertIcon />} title="Saved" titleId={titleId}
 *   buttons={[{ key: 'ok', label: 'OK', primary: true, onClick: close }]} />
 */
export function AlertBody({ icon, title, titleId, message, buttons, children }: { icon: ReactNode; title: string; titleId: string; message?: string; buttons: AlertButtonSpec[]; children?: ReactNode }) {
  const list = [...buttons.filter((b) => !b.primary), ...buttons.filter((b) => b.primary)];
  const vertical = buttons.length >= 3 || buttons.some((b) => labelWidth(b.label) > 84);
  return (
    <div className={styles.alert}>
      <div className={styles.alertIcon}>{icon}</div>
      <div id={titleId} className={styles.alertTitle}>
        {title}
      </div>
      {message && <div className={styles.alertMessage}>{message}</div>}
      {children && <div className={styles.accessory}>{children}</div>}
      <div className={`${styles.alertButtons} ${vertical ? styles.vertical : ''}`}>
        {list.map((b) => (
          <Button key={b.key} size="large" variant={b.primary ? 'primary' : b.danger ? 'danger' : 'default'} className={styles.alertBtn} disabled={b.disabled} onClick={b.onClick}>
            {b.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders an alert nested on top of a file panel.
 *
 * Covers the panel with a dim layer and shows a thick-glass `alertdialog`, horizontally
 * centered near the top. File panels use it for the replace confirmation, the new-folder name
 * prompt and error messages.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.children - Alert content, usually an {@link AlertBody}.
 * @param {string} props.label - Accessible label of the nested alert.
 * @returns {JSX.Element} The dim layer containing the nested alert.
 *
 * @example
 * <InnerAlert label="Replace file?">
 *   <AlertBody icon={<AlertIcon />} title="Replace file?" titleId={id} buttons={buttons} />
 * </InnerAlert>
 */
export function InnerAlert({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.innerLayer}>
      <div className={`lg lg-thick lg-float ${styles.innerAlert}`} role="alertdialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

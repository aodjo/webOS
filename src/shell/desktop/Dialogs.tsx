/**
 * Renders the kernel dialog queue (`kernel/dialogs.ts`).
 *
 *  - `DialogHost` (in Root): dialogs without a window — or whose window is gone / never mounted a
 *    sheet host — as centered system modals over a click-blocker.
 *  - `WindowSheets` (in every window frame): dialogs targeting that window as a sheet that slides
 *    down from the top of the window and blocks only that window.
 *
 * Only the first queued dialog per target is shown; the next one appears once it is answered.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { COMMON, dismissDialog, useDialogs, useSystem, useT, useWM, wm, type AlertRequest, type DialogRequest, type PromptRequest } from '@/kernel';
import { TextField } from '@/components/ui';
import { Z } from '../layers';
import { AlertBody, AlertIcon, PanelShell, isModKey, isPlainKey, useFinish, type DialogMode } from './DialogParts';
import { OpenPanel, SavePanel } from './FilePanel';
import { KEY_PRIORITY } from './modalKeys';
import styles from './Dialogs.module.css';

/* ───────────────────────── Sheet host registry ───────────────────────── */

const useSheetHosts = create<{ hosts: Record<string, number> }>()(() => ({ hosts: {} })); /** Mount count per sheet host id (window ids and pseudo hosts such as Force Quit); dialogs whose target has no mounted host are shown as system modals. */

/**
 * Registers a mounted sheet host for the lifetime of the calling component.
 *
 * Increments the host's mount count in `useSheetHosts` during the layout phase (before paint)
 * and decrements it on cleanup, deleting the entry when the count reaches zero. Counting keeps
 * the id registered while any component using it is still mounted.
 *
 * @param {string} id - Host id, normally the window id.
 * @returns {void}
 *
 * @example
 * useRegisterHost(windowId);
 */
function useRegisterHost(id: string): void {
  useLayoutEffect(() => {
    useSheetHosts.setState((s) => ({ hosts: { ...s.hosts, [id]: (s.hosts[id] ?? 0) + 1 } }));
    return () =>
      useSheetHosts.setState((s) => {
        const hosts = { ...s.hosts };
        if ((hosts[id] ?? 0) > 1) hosts[id] -= 1;
        else delete hosts[id];
        return { hosts };
      });
  }, [id]);
}

/**
 * Cancels and removes every queued dialog that matches a predicate.
 *
 * Each match is answered as if the user cancelled it: alerts resolve with the value of their
 * cancel button (else the first button, else `'cancel'`), every other kind resolves with
 * `null`. The request is then removed from the queue. Used when whoever asked can no longer
 * take the answer (a force-quit app, a closing Force Quit panel or an ending session), so the
 * questions do not linger as orphaned system alerts.
 *
 * @param {(d: DialogRequest) => boolean} match - Returns true for the dialogs to cancel.
 * @returns {void}
 *
 * @example
 * cancelDialogs((d) => d.appId === 'textedit');
 */
export function cancelDialogs(match: (d: DialogRequest) => boolean): void {
  for (const d of useDialogs.getState().queue) {
    if (!match(d)) continue;
    if (d.kind === 'alert') d.resolve((d.buttons.find((b) => b.cancel) ?? d.buttons[0])?.value ?? 'cancel');
    else d.resolve(null);
    dismissDialog(d.id);
  }
}

/* ───────────────────────── Panels ───────────────────────── */

/** Presentation props shared by every dialog panel. */
interface ViewProps {
  mode: DialogMode;
  /** The panel currently receives the keyboard. */
  active: boolean;
  sheetPriority?: number;
  /** App whose icon an alert shows when the request has no `appId` (the sheet's window app). */
  fallbackAppId?: string;
}

/**
 * Renders the panel component that matches a dialog request's kind.
 *
 * Alerts go to AlertPanel, prompts to PromptPanel and save/open requests to the file panels;
 * the presentation props are forwarded unchanged.
 *
 * @param {ViewProps & { req: DialogRequest }} props - View props plus the request.
 * @param {DialogRequest} props.req - The dialog request to render.
 * @param {DialogMode} props.mode - Sheet or modal presentation.
 * @param {boolean} props.active - Whether the panel receives the keyboard.
 * @param {number} [props.sheetPriority] - Key priority used in sheet mode.
 * @param {string} [props.fallbackAppId] - App whose icon an alert shows when the request has no `appId`.
 * @returns {JSX.Element} The panel for the request.
 *
 * @example
 * <DialogView key={req.id} req={req} mode="modal" active />
 */
function DialogView({ req, ...rest }: ViewProps & { req: DialogRequest }) {
  switch (req.kind) {
    case 'alert':
      return <AlertPanel req={req} {...rest} />;
    case 'prompt':
      return <PromptPanel req={req} {...rest} />;
    case 'save':
      return <SavePanel req={req} {...rest} />;
    case 'open':
      return <OpenPanel req={req} {...rest} />;
  }
}

const DEFAULT_BUTTONS: AlertRequest['buttons'] = [{ label: COMMON.ok, value: 'ok', primary: true, cancel: true }]; /** Buttons used when an alert request has none: a single OK that is both default and cancel. */

/**
 * Renders an alert request inside a dialog panel.
 *
 * Falls back to a single OK button when the request has no buttons. The primary and cancel
 * buttons are the ones flagged as such, or the only button when there is just one. Choosing a
 * button resolves the request with that button's value and plays the exit animation. The icon
 * is the request's app, or `fallbackAppId` when the request has none.
 *
 * @param {ViewProps & { req: AlertRequest }} props - View props plus the request.
 * @param {AlertRequest} props.req - The alert request.
 * @param {DialogMode} props.mode - Sheet or modal presentation.
 * @param {boolean} props.active - Whether the panel receives the keyboard.
 * @param {number} [props.sheetPriority] - Key priority used in sheet mode.
 * @param {string} [props.fallbackAppId] - App icon used when the request has no `appId`.
 * @returns {JSX.Element} The alert panel.
 *
 * @example
 * <AlertPanel req={req} mode="sheet" active={focused} fallbackAppId="textedit" />
 */
function AlertPanel({ req, mode, active, sheetPriority, fallbackAppId }: ViewProps & { req: AlertRequest }) {
  const t = useT();
  const titleId = useId();
  const { leaving, finish } = useFinish(req.id);
  const buttons = req.buttons.length ? req.buttons : DEFAULT_BUTTONS;
  const primary = buttons.find((b) => b.primary) ?? (buttons.length === 1 ? buttons[0] : undefined);
  const cancel = buttons.find((b) => b.cancel) ?? (buttons.length === 1 ? buttons[0] : undefined);
  const discard = buttons.find((b) => b.value === 'discard');
  /**
   * Answers the alert with a button value.
   *
   * Resolves the request through `finish`, which ignores repeated answers and starts the exit
   * animation.
   *
   * @param {string} value - Value of the chosen button.
   * @returns {void}
   *
   * @example
   * choose('ok');
   */
  const choose = (value: string) => finish(() => req.resolve(value));

  /**
   * Handles the alert's keyboard shortcuts.
   *
   * Return picks the primary button, Escape or ⌘. picks the cancel button, and ⌘D (without
   * Shift or ⌥) picks the button whose value is `'discard'` ("Don't Save", as in macOS). Each
   * shortcut applies only when the matching button exists.
   *
   * @param {KeyboardEvent} e - The keydown event routed to the panel.
   * @returns {boolean} True when the key was handled.
   *
   * @example
   * onKey(new KeyboardEvent('keydown', { key: 'Enter' })); // true when there is a primary button
   */
  const onKey = (e: KeyboardEvent) => {
    if (isPlainKey(e, 'Enter') && primary) {
      choose(primary.value);
      return true;
    }
    if ((isPlainKey(e, 'Escape') || (isModKey(e) && e.key === '.')) && cancel) {
      choose(cancel.value);
      return true;
    }
    if (discard && isModKey(e) && !e.shiftKey && !e.altKey && e.code === 'KeyD') {
      choose(discard.value);
      return true;
    }
    return false;
  };

  return (
    <PanelShell mode={mode} active={active} leaving={leaving} sheetPriority={sheetPriority} onKey={onKey} labelledBy={titleId}>
      <AlertBody
        icon={<AlertIcon appId={req.appId ?? fallbackAppId} />}
        title={t(req.title)}
        titleId={titleId}
        message={req.message ? t(req.message) : undefined}
        buttons={buttons.map((b, i) => ({ key: `${i}-${b.value}`, label: t(b.label), primary: b === primary, danger: b.danger, onClick: () => choose(b.value) }))}
      />
    </PanelShell>
  );
}

/**
 * Renders a prompt request: an alert with a text field and Cancel / OK buttons.
 *
 * The field starts with the request's default value, is focused when the panel becomes active
 * and selects all of its text on the first focus only. Return or OK resolves the request with
 * the current text; Escape, ⌘. or Cancel resolves it with `null`.
 *
 * @param {ViewProps & { req: PromptRequest }} props - View props plus the request.
 * @param {PromptRequest} props.req - The prompt request.
 * @param {DialogMode} props.mode - Sheet or modal presentation.
 * @param {boolean} props.active - Whether the panel receives the keyboard.
 * @param {number} [props.sheetPriority] - Key priority used in sheet mode.
 * @param {string} [props.fallbackAppId] - App icon used when the request has no `appId`.
 * @returns {JSX.Element} The prompt panel.
 *
 * @example
 * <PromptPanel req={req} mode="modal" active />
 */
function PromptPanel({ req, mode, active, sheetPriority, fallbackAppId }: ViewProps & { req: PromptRequest }) {
  const t = useT();
  const titleId = useId();
  const { leaving, finish } = useFinish(req.id);
  const [value, setValue] = useState(req.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedOnce = useRef(false);
  /**
   * Answers the prompt with the current field text.
   *
   * Resolves the request through `finish`, which ignores repeated answers and starts the exit
   * animation.
   *
   * @returns {void}
   *
   * @example
   * submit();
   */
  const submit = () => finish(() => req.resolve(value));
  /**
   * Dismisses the prompt without a value.
   *
   * Resolves the request with `null` through `finish`, which ignores repeated answers and
   * starts the exit animation.
   *
   * @returns {void}
   *
   * @example
   * cancel();
   */
  const cancel = () => finish(() => req.resolve(null));

  /**
   * Handles the prompt's keyboard shortcuts.
   *
   * Return submits the current text; Escape or ⌘. cancels the prompt.
   *
   * @param {KeyboardEvent} e - The keydown event routed to the panel.
   * @returns {boolean} True when the key was handled.
   *
   * @example
   * onKey(new KeyboardEvent('keydown', { key: 'Escape' })); // true
   */
  const onKey = (e: KeyboardEvent) => {
    if (isPlainKey(e, 'Enter')) {
      submit();
      return true;
    }
    if (isPlainKey(e, 'Escape') || (isModKey(e) && e.key === '.')) {
      cancel();
      return true;
    }
    return false;
  };

  return (
    <PanelShell mode={mode} active={active} leaving={leaving} sheetPriority={sheetPriority} onKey={onKey} labelledBy={titleId} initialFocus={inputRef}>
      <AlertBody
        icon={<AlertIcon appId={req.appId ?? fallbackAppId} />}
        title={t(req.title)}
        titleId={titleId}
        message={req.message ? t(req.message) : undefined}
        buttons={[
          { key: 'cancel', label: t(COMMON.cancel), onClick: cancel },
          { key: 'ok', label: t(req.okLabel ?? COMMON.ok), primary: true, onClick: submit },
        ]}
      >
        <TextField
          ref={inputRef}
          className={styles.promptField}
          value={value}
          placeholder={req.placeholder ? t(req.placeholder) : undefined}
          aria-labelledby={titleId}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => {
            if (selectedOnce.current) return;
            selectedOnce.current = true;
            e.currentTarget.select();
          }}
        />
      </AlertBody>
    </PanelShell>
  );
}

/* ───────────────────────── System modals ───────────────────────── */

const HOST_GRACE_MS = 1200; /** Time in ms a live window may take to mount its sheet host before its dialogs are shown as system modals. */

/**
 * Shows the first dialog that has no sheet host as a centered system modal.
 *
 * A request qualifies when it has no `windowId`, when its window does not exist, or when its
 * window exists but has not mounted a sheet host within HOST_GRACE_MS (the grace timer restarts
 * whenever the set of such requests changes). Windows are selected as `id\0appId` strings so the
 * shallow comparison only re-renders when windows or their apps change; the resulting map also
 * supplies the fallback alert icon. While the session is logging out, restarting or shutting
 * down, every queued dialog is cancelled. The modal sits on a click blocker whose mouse-downs
 * are prevented so they do not take focus from the alert, and the context menu is suppressed.
 *
 * @returns {JSX.Element | null} The modal layer, or null when no request qualifies.
 *
 * @example
 * <DialogHost />
 */
export function DialogHost() {
  const queue = useDialogs((s) => s.queue);
  const sessionEnding = useSystem((s) => s.power === 'loggingOut' || s.power === 'restarting' || s.power === 'shuttingDown');
  useEffect(() => {
    if (sessionEnding) cancelDialogs(() => true);
  }, [sessionEnding]);
  const hosts = useSheetHosts((s) => s.hosts);
  const windows = useWM(useShallow((s) => s.windows.map((w) => `${w.id}\u0000${w.appId}`)));
  const appOf = new Map(windows.map((w) => w.split('\u0000') as [string, string]));

  const orphanKey = queue
    .filter((d) => d.windowId && appOf.has(d.windowId) && !hosts[d.windowId])
    .map((d) => d.id)
    .join(',');
  const [expiredKey, setExpiredKey] = useState('');
  useEffect(() => {
    if (!orphanKey) return;
    const timer = setTimeout(() => setExpiredKey(orphanKey), HOST_GRACE_MS);
    return () => clearTimeout(timer);
  }, [orphanKey]);
  const orphansVisible = !!orphanKey && expiredKey === orphanKey;

  const req = queue.find((d) => {
    if (!d.windowId) return true;
    if (hosts[d.windowId]) return false;
    return !appOf.has(d.windowId) || orphansVisible;
  });
  if (!req) return null;

  return (
    <div
      className={styles.modalLayer}
      style={{ zIndex: Z.DIALOG }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <DialogView key={req.id} req={req} mode="modal" active fallbackAppId={req.windowId ? appOf.get(req.windowId) : undefined} />
    </div>
  );
}

/* ───────────────────────── Sheets ───────────────────────── */

const TITLEBAR_HEIGHT = 28; /** Height in px of a standard window title bar; sheets hang below it. */
const TOOLBAR_HEIGHT = 52; /** Height in px of the unified toolbar of overlay-titlebar windows; sheets hang below it. */

/**
 * Renders the sheet, if any, queued for a host.
 *
 * Registers `hostId` as a mounted sheet host and shows the first queued dialog whose
 * `windowId` equals it, over a dim layer that covers only this host. Before paint, the sheet's
 * top edge is written to the `--sheet-top` CSS variable: `topInset` when given; otherwise 0
 * when the host's offset parent is not the full window (its height differs from
 * `windowHeight`, so the frame already placed the host below the title bar), else the toolbar
 * height for overlay title bars or the title bar height for standard ones. Mouse-downs on the
 * host background or the dim layer are prevented so they do not move focus, and the context
 * menu is suppressed.
 *
 * @param {Object} props - Component props.
 * @param {string} props.hostId - Host id: a window id or a pseudo host id.
 * @param {boolean} props.active - Whether the sheet receives the keyboard.
 * @param {number} [props.topInset] - Fixed distance in px from the host's top to the sheet.
 * @param {'standard' | 'overlay'} [props.titlebar='standard'] - Title bar style used to derive the inset.
 * @param {number} [props.windowHeight=0] - Window height in px, compared with the offset parent's height.
 * @param {number} [props.sheetPriority=KEY_PRIORITY.sheet] - Key priority of the sheet.
 * @param {string} [props.fallbackAppId] - App icon used by alerts without an `appId`.
 * @returns {JSX.Element | null} The sheet layer, or null when nothing is queued for the host.
 *
 * @example
 * <SheetHost hostId={FORCE_QUIT_HOST} active={isKey} topInset={28} sheetPriority={KEY_PRIORITY.forceQuitSheet} />
 */
export function SheetHost({
  hostId,
  active,
  topInset,
  titlebar = 'standard',
  windowHeight = 0,
  sheetPriority = KEY_PRIORITY.sheet,
  fallbackAppId,
}: {
  hostId: string;
  active: boolean;
  topInset?: number;
  titlebar?: 'standard' | 'overlay';
  windowHeight?: number;
  sheetPriority?: number;
  fallbackAppId?: string;
}) {
  useRegisterHost(hostId);
  const req = useDialogs((s) => s.queue.find((d) => d.windowId === hostId));
  const ref = useRef<HTMLDivElement>(null);
  const reqId = req?.id;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inset = topInset;
    if (inset === undefined) {
      const frame = el.offsetParent as HTMLElement | null;
      const coversFrame = !frame || !windowHeight || Math.abs(frame.offsetHeight - windowHeight) < 4;
      inset = !coversFrame ? 0 : titlebar === 'overlay' ? TOOLBAR_HEIGHT : TITLEBAR_HEIGHT;
    }
    el.style.setProperty('--sheet-top', `${inset}px`);
  }, [reqId, topInset, titlebar, windowHeight]);

  if (!req) return null;
  return (
    <div
      ref={ref}
      className={styles.sheetHost}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.sheetDim !== undefined) e.preventDefault();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className={styles.sheetDim} data-sheet-dim="" />
      <DialogView key={req.id} req={req} mode="sheet" active={active} sheetPriority={sheetPriority} fallbackAppId={fallbackAppId} />
    </div>
  );
}

/**
 * Renders the sheets attached to a window; mounted by the window frame.
 *
 * Reads the window's focus, title bar style, height and app from the window manager and passes
 * them to SheetHost. When a sheet is queued for a window that is minimized or whose app is
 * hidden, the window is focused, which brings it forward so the sheet can be answered.
 *
 * @param {Object} props - Component props.
 * @param {string} props.windowId - Id of the window.
 * @returns {JSX.Element} The window's sheet host.
 *
 * @example
 * <WindowSheets windowId={win.id} />
 */
export function WindowSheets({ windowId }: { windowId: string }) {
  const focused = useWM((s) => s.focusedId === windowId);
  const titlebar = useWM((s) => s.windows.find((w) => w.id === windowId)?.titlebar);
  const height = useWM((s) => s.windows.find((w) => w.id === windowId)?.height ?? 0);
  const appId = useWM((s) => s.windows.find((w) => w.id === windowId)?.appId);
  const sheetId = useDialogs((s) => s.queue.find((d) => d.windowId === windowId)?.id);

  useEffect(() => {
    if (!sheetId) return;
    const s = useWM.getState();
    const w = s.windows.find((x) => x.id === windowId);
    if (!w) return;
    const hidden = s.processes.some((p) => p.appId === w.appId && p.hidden);
    if (w.minimized || hidden) wm.focus(windowId);
  }, [sheetId, windowId]);

  return <SheetHost hostId={windowId} active={focused} titlebar={titlebar} windowHeight={height} fallbackAppId={appId} />;
}

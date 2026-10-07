/**
 * Modal dialogs & file panels.
 *
 * Every function returns a Promise resolved when the user answers. If `windowId` is given the
 * dialog is shown as a sheet sliding out of that window's title bar (blocking only that window),
 * otherwise as a centered system modal. Rendering is done by `shell/Dialogs.tsx`.
 */
import { create } from 'zustand';
import type { LString } from './types';

/** A button of an alert dialog. */
export interface DialogButton<V = string> {
  label: LString;
  /** Value the dialog's Promise resolves with when this button is chosen. */
  value: V;
  /** Default button (blue, triggered by Enter). */
  primary?: boolean;
  /** Triggered by Escape. */
  cancel?: boolean;
  /** Destructive action (red). */
  danger?: boolean;
}

/** Fields shared by every dialog request. */
interface BaseRequest {
  id: string;
  /** Window to attach the dialog to as a sheet; omit for a centered system modal. */
  windowId?: string;
  /** App id whose icon is shown in the alert. */
  appId?: string;
}

/** An alert with a title, an optional message and a row of buttons. */
export interface AlertRequest extends BaseRequest {
  kind: 'alert';
  title: LString;
  message?: LString;
  buttons: DialogButton[];
  resolve: (value: string) => void;
}

/** An alert with a single-line text field. */
export interface PromptRequest extends BaseRequest {
  kind: 'prompt';
  title: LString;
  message?: LString;
  defaultValue?: string;
  placeholder?: LString;
  okLabel?: LString;
  resolve: (value: string | null) => void;
}

/** A save panel: file name field plus a folder browser. */
export interface SavePanelRequest extends BaseRequest {
  kind: 'save';
  title?: LString;
  defaultName: string;
  defaultDir: string;
  resolve: (path: string | null) => void;
}

/** An open panel for choosing an existing file or folder. */
export interface OpenPanelRequest extends BaseRequest {
  kind: 'open';
  title?: LString;
  defaultDir: string;
  /** Lowercase extensions without dot. Omit to allow any file. */
  extensions?: string[];
  /** Choose a folder instead of a file. */
  chooseDirectory?: boolean;
  resolve: (path: string | null) => void;
}

/** Any pending dialog, discriminated by `kind`. */
export type DialogRequest = AlertRequest | PromptRequest | SavePanelRequest | OpenPanelRequest;

interface DialogsState {
  /** Pending dialogs in the order they were requested. */
  queue: DialogRequest[];
}

export const useDialogs = create<DialogsState>()(() => ({ queue: [] })); /** Zustand store of pending dialogs, rendered by `shell/Dialogs.tsx`. */

let n = 0; /** Counter used to generate unique dialog ids. */

/**
 * Generates a unique dialog id.
 *
 * Increments the module-level counter and returns it with a `d` prefix.
 *
 * @returns {string} A new id such as `"d3"`.
 *
 * @example
 * const id = nextId(); // "d1"
 */
const nextId = () => `d${++n}`;

/**
 * Appends a dialog request to the queue.
 *
 * The dialog UI picks the request up from `useDialogs` and renders it.
 *
 * @param {T} req - The complete dialog request, including its `resolve` callback.
 * @returns {void}
 *
 * @example
 * push({ kind: 'prompt', id: nextId(), title, resolve });
 */
function push<T extends DialogRequest>(req: T): void {
  useDialogs.setState((s) => ({ queue: [...s.queue, req] }));
}

/**
 * Removes a dialog from the queue.
 *
 * Called by the dialog UI after it has resolved the request's Promise. Unknown ids are ignored.
 *
 * @param {string} id - Id of the dialog request to remove.
 * @returns {void}
 *
 * @example
 * req.resolve(value);
 * dismissDialog(req.id);
 */
export function dismissDialog(id: string): void {
  useDialogs.setState((s) => ({ queue: s.queue.filter((d) => d.id !== id) }));
}

/** Request options as callers pass them: everything except the fields the dialog API fills in. */
type Omitted<T> = Omit<T, 'id' | 'kind' | 'resolve'>;

export const dialogs = {
  /**
   * Shows an alert with custom buttons.
   *
   * Queues an alert request; without `buttons` a single OK button is shown that is both the
   * default (Enter) and the cancel (Escape) button.
   *
   * @param {Omit<Omitted<AlertRequest>, 'buttons'> & { buttons?: DialogButton[] }} opts - Title,
   *   message, optional `windowId` / `appId` and buttons.
   * @returns {Promise<string>} Resolves with the `value` of the clicked button (`'ok'` for the
   *   built-in OK button).
   *
   * @example
   * await dialogs.alert({ title: { en: 'Done', ko: '완료' } });
   */
  alert(opts: Omit<Omitted<AlertRequest>, 'buttons'> & { buttons?: DialogButton[] }): Promise<string> {
    return new Promise((resolve) =>
      push({ ...opts, kind: 'alert', id: nextId(), buttons: opts.buttons ?? [{ label: { en: 'OK', ko: '확인' }, value: 'ok', primary: true, cancel: true }], resolve }),
    );
  },

  /**
   * Shows an OK / Cancel confirmation alert.
   *
   * Builds a Cancel button (Escape) and an OK button (Enter) with optional custom labels; `danger`
   * styles the OK button as destructive.
   *
   * @async
   * @param {Omit<Omitted<AlertRequest>, 'buttons'> & { okLabel?: LString; cancelLabel?: LString; danger?: boolean }} opts -
   *   Title, message, optional `windowId` / `appId`, button labels and the danger flag.
   * @returns {Promise<boolean>} Resolves true when OK was chosen, false otherwise.
   *
   * @example
   * if (await dialogs.confirm({ title, okLabel: { en: 'Delete', ko: '삭제' }, danger: true })) remove();
   */
  async confirm(opts: Omit<Omitted<AlertRequest>, 'buttons'> & { okLabel?: LString; cancelLabel?: LString; danger?: boolean }): Promise<boolean> {
    const v = await dialogs.alert({
      ...opts,
      buttons: [
        { label: opts.cancelLabel ?? { en: 'Cancel', ko: '취소' }, value: 'cancel', cancel: true },
        { label: opts.okLabel ?? { en: 'OK', ko: '확인' }, value: 'ok', primary: true, danger: opts.danger },
      ],
    });
    return v === 'ok';
  },

  /**
   * Shows an alert with a text field.
   *
   * Queues a prompt request; the field starts with `defaultValue`.
   *
   * @param {Omitted<PromptRequest>} opts - Title, message, default value, placeholder, OK label
   *   and optional `windowId` / `appId`.
   * @returns {Promise<string | null>} Resolves with the entered text, or null when cancelled.
   *
   * @example
   * const name = await dialogs.prompt({ title: { en: 'Name', ko: '이름' }, defaultValue: 'untitled' });
   */
  prompt(opts: Omitted<PromptRequest>): Promise<string | null> {
    return new Promise((resolve) => push({ ...opts, kind: 'prompt', id: nextId(), resolve }));
  },

  /**
   * Shows a save panel.
   *
   * Queues a save request starting in `defaultDir` with `defaultName` in the name field. The
   * chosen file may already exist; the panel itself asks whether to replace it.
   *
   * @param {Omitted<SavePanelRequest>} opts - Default name and folder, optional title and
   *   `windowId` / `appId`.
   * @returns {Promise<string | null>} Resolves with the chosen absolute path, or null when cancelled.
   *
   * @example
   * const path = await dialogs.save({ windowId, defaultName: 'Untitled.txt', defaultDir: PATHS.documents });
   */
  save(opts: Omitted<SavePanelRequest>): Promise<string | null> {
    return new Promise((resolve) => push({ ...opts, kind: 'save', id: nextId(), resolve }));
  },

  /**
   * Shows an open panel.
   *
   * Queues an open request starting in `defaultDir`; only files with one of `extensions` (or a
   * folder, with `chooseDirectory`) can be chosen.
   *
   * @param {Omitted<OpenPanelRequest>} opts - Start folder, allowed extensions, folder mode,
   *   optional title and `windowId` / `appId`.
   * @returns {Promise<string | null>} Resolves with the chosen absolute path, or null when cancelled.
   *
   * @example
   * const path = await dialogs.open({ windowId, defaultDir: PATHS.pictures, extensions: ['png', 'jpg'] });
   */
  open(opts: Omitted<OpenPanelRequest>): Promise<string | null> {
    return new Promise((resolve) => push({ ...opts, kind: 'open', id: nextId(), resolve }));
  },

  /**
   * Asks whether to save unsaved changes before closing a document.
   *
   * Shows the standard "Do you want to save the changes you made to …?" alert with Don't Save,
   * Cancel (Escape) and Save (Enter) buttons. Document apps call it from their before-close handler.
   *
   * @async
   * @param {Object} opts - Dialog options.
   * @param {string} [opts.windowId] - Window to attach the sheet to.
   * @param {string} [opts.appId] - App whose icon is shown in the alert.
   * @param {string} opts.name - Document name shown in the title.
   * @returns {Promise<'save' | 'discard' | 'cancel'>} The user's choice.
   *
   * @example
   * const choice = await dialogs.unsavedChanges({ windowId, appId: 'textedit', name: 'notes.txt' });
   * if (choice === 'cancel') return false;
   */
  async unsavedChanges(opts: { windowId?: string; appId?: string; name: string }): Promise<'save' | 'discard' | 'cancel'> {
    const v = await dialogs.alert({
      windowId: opts.windowId,
      appId: opts.appId,
      title: { en: `Do you want to save the changes you made to “${opts.name}”?`, ko: `“${opts.name}”에 대한 변경 사항을 저장하겠습니까?` },
      message: { en: "Your changes will be lost if you don't save them.", ko: '저장하지 않으면 변경 사항이 손실됩니다.' },
      buttons: [
        { label: { en: "Don't Save", ko: '저장 안 함' }, value: 'discard', danger: true },
        { label: { en: 'Cancel', ko: '취소' }, value: 'cancel', cancel: true },
        { label: { en: 'Save', ko: '저장' }, value: 'save', primary: true },
      ],
    });
    return v as 'save' | 'discard' | 'cancel';
  },
}; /** Promise-based API for alerts, confirmations, prompts and save / open panels. */

/**
 * In-window sheets for System Settings (Change Password, Wi-Fi password…). They portal into the
 * window's sheet host so they cover the whole window, trap Tab, cancel on Escape and give focus
 * back to whatever opened them — like the sheets macOS slides out of a window's title bar.
 * Tahoe look: a thick Liquid Glass panel with large, concentric corners.
 */
import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui';
import { COMMON, useT } from '@/kernel';
import { useNav } from './nav';
import s from './sheet.module.css';

export const NOT_A_CREDENTIAL = {
  autoComplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const; /** Props that stop password managers from saving or decorating simulated password fields. */

/**
 * Tells whether animations should be skipped.
 *
 * True when the OS's own "Reduce motion" setting is on (`data-reduce-motion="true"` on the
 * root element) or the host browser reports `prefers-reduced-motion: reduce`. Always false
 * outside a DOM environment.
 *
 * @returns {boolean} Whether motion should be reduced.
 *
 * @example
 * if (!prefersReducedMotion()) el.animate(SHAKE, 380);
 */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.reduceMotion === 'true' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-10px)' },
  { transform: 'translateX(8px)' },
  { transform: 'translateX(-5px)' },
  { transform: 'translateX(2px)' },
  { transform: 'translateX(0)' },
]; /** Horizontal shake keyframes played on the sheet after wrong input. */

/** Props of `Sheet`. */
interface SheetProps {
  title: ReactNode;
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  /** Icon or avatar left of the title. */
  leading?: ReactNode;
  children?: ReactNode;
  /** Error line under the fields. Omit to leave no room for one. */
  error?: ReactNode;
  /** Increment to shake the sheet (wrong input). */
  shake?: number;
  /** Label of the default (submit) button. */
  submitLabel: string;
  /** Disables the submit button and ignores Return. */
  submitDisabled?: boolean;
  /** Style of the submit button (default `primary`). */
  submitVariant?: 'primary' | 'danger';
  /** Called when the form is submitted while not disabled. */
  onSubmit: () => void;
  /** Called by the Cancel button and by Escape. */
  onCancel: () => void;
}

/**
 * In-window modal sheet for System Settings forms.
 *
 * Portals into the window's sheet host (from `useNav`) and renders nothing when there is
 * none. On mount it focuses the first form control and, on unmount, gives focus back to the
 * element that was focused before. Escape cancels, Tab and Shift+Tab wrap focus between the
 * first and last enabled controls, and submitting (button or Return) calls `onSubmit` unless
 * `submitDisabled` is set. Each increment of `shake` plays the shake animation unless reduced
 * motion is preferred. The content scrolls inside an inner `.body` element so the glass
 * panel's rim and sheen pseudo-elements stay fixed.
 *
 * @param {SheetProps} props - Sheet props.
 * @param {ReactNode} props.title - Bold title, also used as the dialog's accessible name.
 * @param {ReactNode} [props.subtitle] - Secondary line under the title.
 * @param {ReactNode} [props.leading] - Icon or avatar left of the title.
 * @param {ReactNode} [props.children] - Form fields.
 * @param {ReactNode} [props.error] - Error line under the fields; omit to reserve no room for it.
 * @param {number} [props.shake=0] - Counter whose increments shake the sheet.
 * @param {string} props.submitLabel - Label of the submit button.
 * @param {boolean} [props.submitDisabled] - Disables submitting.
 * @param {'primary' | 'danger'} [props.submitVariant='primary'] - Style of the submit button.
 * @param {() => void} props.onSubmit - Called on a valid submit.
 * @param {() => void} props.onCancel - Called by Cancel and Escape.
 * @returns {JSX.Element | null} The portaled sheet, or null without a sheet host.
 *
 * @example
 * <Sheet title="Change Password" submitLabel="Change" onSubmit={save} onCancel={close}>
 *   <SheetField label="Old Password"><TextField type="password" /></SheetField>
 * </Sheet>
 */
export function Sheet({ title, subtitle, leading, children, error, shake = 0, submitLabel, submitDisabled, submitVariant = 'primary', onSubmit, onCancel }: SheetProps) {
  const t = useT();
  const { sheetHost } = useNav();
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const hasHost = !!sheetHost;

  useEffect(() => {
    if (!hasHost) return;
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => previous?.focus?.();
  }, [hasHost]);

  useEffect(() => {
    if (!shake || prefersReducedMotion()) return;
    formRef.current?.animate?.(SHAKE, { duration: 380, easing: 'ease-out' });
  }, [shake]);

  /**
   * Handles the form's submit event.
   *
   * Prevents the browser's page submit and calls `onSubmit` unless submitting is disabled.
   *
   * @param {FormEvent} e - Submit event.
   * @returns {void}
   *
   * @example
   * <form onSubmit={submit} />
   */
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!submitDisabled) onSubmit();
  };

  /**
   * Handles keyboard input inside the sheet.
   *
   * Escape is consumed (so the window does not see it) and cancels the sheet. Tab on the last
   * enabled control, or Shift+Tab on the first, wraps focus to the other end to keep it
   * trapped inside the sheet; other keys pass through.
   *
   * @param {KeyboardEvent} e - Keydown event from the form.
   * @returns {void}
   *
   * @example
   * <form onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !formRef.current) return;
    const focusables = [...formRef.current.querySelectorAll<HTMLElement>('input:not(:disabled), select, textarea, button:not(:disabled)')];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!sheetHost) return null;

  return createPortal(
    <div className={s.backdrop}>
      <form ref={formRef} className={`lg lg-thick lg-float ${s.sheet}`} role="dialog" aria-modal="true" aria-labelledby={titleId} autoComplete="off" onSubmit={submit} onKeyDown={onKeyDown}>
        {/* Scrolls inside the glass panel, so the panel's rim and sheen (.lg pseudo-elements) stay put. */}
        <div className={s.body}>
          <div className={s.header}>
            {leading}
            <div className={s.headerText}>
              <div className={s.title} id={titleId}>
                {title}
              </div>
              {subtitle && <div className={s.subtitle}>{subtitle}</div>}
            </div>
          </div>
          {children && <div className={s.fields}>{children}</div>}
          {error !== undefined && (
            <div className={s.error} role="alert">
              {error}
            </div>
          )}
          <div className={s.buttons}>
            <Button onClick={onCancel}>{t(COMMON.cancel)}</Button>
            <Button type="submit" variant={submitVariant === 'danger' ? 'danger' : 'primary'} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>,
    sheetHost,
  );
}

/**
 * Labeled form row for a sheet.
 *
 * Lays out the label and control on one grid row with the label right-aligned, like macOS
 * forms; narrow windows stack them. Wrapping both in a `<label>` makes clicking the label
 * focus the control.
 *
 * @param {Object} props - Field props.
 * @param {ReactNode} props.label - Text shown left of the control.
 * @param {ReactNode} props.children - The control.
 * @returns {JSX.Element} The field row.
 *
 * @example
 * <SheetField label="Password"><TextField type="password" /></SheetField>
 */
export function SheetField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

/**
 * Checkbox row aligned with the controls of `SheetField` rows.
 *
 * An empty first grid cell takes the label column so the checkbox lines up under the
 * field controls.
 *
 * @param {Object} props - Checkbox props.
 * @param {ReactNode} props.label - Text next to the checkbox.
 * @param {boolean} props.checked - Whether the box is checked.
 * @param {(v: boolean) => void} props.onChange - Called with the new checked state.
 * @returns {JSX.Element} The checkbox row.
 *
 * @example
 * <SheetCheckbox label="Remember this network" checked={remember} onChange={setRemember} />
 */
export function SheetCheckbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={s.field}>
      <span />
      <label className={s.checkbox}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </div>
  );
}

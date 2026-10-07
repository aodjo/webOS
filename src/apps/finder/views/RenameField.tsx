import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FSNode } from '@/kernel';
import s from './RenameField.module.css';

interface Props {
  /** Item being renamed; its current name is the initial value. */
  node: Pick<FSNode, 'name' | 'type'>;
  /** Render an auto-growing, centered textarea (icon view) instead of a single-line input. */
  multiline?: boolean;
  /** Extra class name for the field. */
  className?: string;
  /** Called once with the edited name on Enter or blur. */
  onCommit: (name: string) => void;
  /** Called once when editing is cancelled with Escape. */
  onCancel: () => void;
}

/**
 * Inline editor for renaming an item in a Finder view.
 *
 * On mount it focuses the field, selects the name without its extension (files only; a leading
 * dot such as ".env" selects the whole name) and scrolls the field into view. That effect runs only
 * on mount so later renders don't reset the caret. In multiline mode the textarea's height follows
 * its content. Enter or blur commits, Escape cancels, and the outcome is reported only once.
 * Keystrokes are stopped from propagating so window shortcuts don't fire while typing, and IME
 * composition keys are ignored so confirming a composed character doesn't commit. Newlines and
 * slashes are stripped from the input, and clicks don't reach the item underneath.
 *
 * @param {Object} props - Component props.
 * @param {Pick<FSNode, 'name' | 'type'>} props.node - Item being renamed.
 * @param {boolean} [props.multiline] - Whether to render a multiline textarea.
 * @param {string} [props.className=''] - Extra class name for the field.
 * @param {(name: string) => void} props.onCommit - Receives the edited name.
 * @param {() => void} props.onCancel - Called when editing is cancelled.
 * @returns {JSX.Element} An input or textarea element.
 *
 * @example
 * <RenameField node={node} onCommit={(name) => ctl.commitRename(node.path, name)}
 *   onCancel={ctl.cancelRename} />
 */
export function RenameField({ node, multiline, className = '', onCommit, onCancel }: Props) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [value, setValue] = useState(node.name);
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const dot = node.type === 'file' ? node.name.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : node.name.length);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!multiline || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, multiline]);

  /**
   * Ends editing by committing or cancelling, at most once.
   *
   * A ref guards against reporting twice, e.g. when Enter commits and the field then blurs as it
   * unmounts.
   *
   * @param {boolean} commit - True to commit the current value, false to cancel.
   * @returns {void}
   *
   * @example
   * finish(true); // calls onCommit(value)
   */
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  /**
   * Handles keys typed in the field.
   *
   * Stops every key from propagating to window shortcuts. Ignores keys that belong to an IME
   * composition (`isComposing` or keyCode 229); otherwise Enter commits and Escape cancels.
   *
   * @param {KeyboardEvent} e - Keyboard event from the field.
   * @returns {void}
   *
   * @example
   * <input onKeyDown={onKeyDown} />
   */
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };

  const common = {
    ref,
    value,
    spellCheck: false,
    'aria-label': node.name,
    className: `${s.field} ${multiline ? s.multi : s.single} ${className}`,
    /**
     * Stores the typed value without newlines or slashes.
     *
     * Strips every `\n` and `/` from the field's text before saving it to state, so pasted
     * multi-line text or path separators never reach the committed name.
     *
     * @param {{ target: { value: string } }} e - Change event from the field.
     * @returns {void}
     *
     * @example
     * onChange({ target: { value: 'a/b' } }); // value becomes 'ab'
     */
    onChange: (e: { target: { value: string } }) => setValue(e.target.value.replace(/[\n/]/g, '')),
    onKeyDown,
    /**
     * Commits the current value when the field loses focus.
     *
     * Calls `finish(true)`, so clicking elsewhere saves the edited name; it does nothing when
     * editing already ended through Enter or Escape.
     *
     * @returns {void}
     *
     * @example
     * <input onBlur={onBlur} />
     */
    onBlur: () => finish(true),
    /**
     * Keeps clicks inside the field from reaching the item underneath.
     *
     * Stops propagation so placing the caret with the mouse is not handled by the item's own
     * click handler (which can collapse a multi-item selection or schedule another rename).
     *
     * @param {{ stopPropagation: () => void }} e - Click event.
     * @returns {void}
     *
     * @example
     * <input onClick={onClick} />
     */
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    /**
     * Keeps double-clicks inside the field from opening the item underneath.
     *
     * Stops propagation so double-clicking to select a word in the name does not trigger the
     * item's double-click handler, which would open it.
     *
     * @param {{ stopPropagation: () => void }} e - Double-click event.
     * @returns {void}
     *
     * @example
     * <input onDoubleClick={onDoubleClick} />
     */
    onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };
  return multiline ? <textarea rows={1} {...common} /> : <input {...common} />;
}

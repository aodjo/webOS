/**
 * Shared macOS-style controls. Styling lives in styles/global.css (.ui-*) so apps can also use
 * the class names directly.
 */
import { forwardRef, useRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useDraggableThumb } from './segmentThumb';

/** Props of {@link Button}: native button attributes plus a visual variant and a size. */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'plain'; size?: 'regular' | 'large' };

/**
 * Push button in the macOS style.
 *
 * Renders a `<button type="button">` with the `ui-btn` class. A non-default `variant` and the
 * `large` size are added as extra class names; all other props (including `onClick` and
 * `disabled`) pass straight through to the native element, and the ref is forwarded to it.
 *
 * @param {BtnProps} props - Native button attributes plus the options below.
 * @param {'default' | 'primary' | 'danger' | 'plain'} [props.variant='default'] - Visual style.
 * @param {'regular' | 'large'} [props.size='regular'] - Control size.
 * @param {string} [props.className=''] - Extra class names appended to `ui-btn`.
 * @param {React.ForwardedRef<HTMLButtonElement>} ref - Forwarded ref to the `<button>` element.
 * @returns {JSX.Element} The button element.
 *
 * @example
 * <Button variant="primary" onClick={save}>Save</Button>
 */
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'default', size = 'regular', className = '', ...rest }, ref) {
  const cls = ['ui-btn', variant !== 'default' && variant, size === 'large' && 'large', className].filter(Boolean).join(' ');
  return <button ref={ref} type="button" className={cls} {...rest} />;
});

/**
 * Borderless icon-only button, used in toolbars.
 *
 * Renders a `<button>` with the `ui-icon-btn` class; `active` adds the `active` class for a
 * pressed/toggled look. `label` becomes both the accessible name and the hover tooltip. The
 * icon itself is passed as children.
 *
 * @param {ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label?: string }} props -
 *   Native button attributes plus the options below.
 * @param {boolean} [props.active] - Shows the button in its toggled-on state.
 * @param {string} [props.label] - Accessible label and tooltip text.
 * @param {string} [props.className=''] - Extra class names appended after `ui-icon-btn`.
 * @param {React.ForwardedRef<HTMLButtonElement>} ref - Forwarded ref to the `<button>` element.
 * @returns {JSX.Element} The button element.
 *
 * @example
 * <IconButton label="Back" onClick={goBack}><ChevronLeft size={16} /></IconButton>
 */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label?: string }>(function IconButton(
  { active, label, className = '', ...rest },
  ref,
) {
  return <button ref={ref} type="button" aria-label={label} title={label} className={`ui-icon-btn ${active ? 'active' : ''} ${className}`} {...rest} />;
});

/**
 * Single-line text input with the system text-field style.
 *
 * Renders an `<input>` with the `ui-input` class and spell checking turned off; every other
 * input attribute passes through, and the ref is forwarded to the element.
 *
 * @param {InputHTMLAttributes<HTMLInputElement>} props - Native input attributes.
 * @param {string} [props.className=''] - Extra class names appended to `ui-input`.
 * @param {React.ForwardedRef<HTMLInputElement>} ref - Forwarded ref to the `<input>` element.
 * @returns {JSX.Element} The input element.
 *
 * @example
 * <TextField value={name} onChange={(e) => setName(e.target.value)} />
 */
export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextField({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`ui-input ${className}`} spellCheck={false} {...rest} />;
});

/**
 * Rounded search field with a magnifying-glass icon.
 *
 * A `<label>` wraps the icon and the input so clicking anywhere in the pill focuses the input.
 * The field is controlled: `onChange` receives the new string value rather than the event.
 *
 * @param {Object} props - Component props.
 * @param {string} props.value - Current query text.
 * @param {(v: string) => void} props.onChange - Called with the new text on every edit.
 * @param {string} [props.placeholder] - Placeholder text.
 * @param {CSSProperties} [props.style] - Inline styles for the outer label.
 * @param {boolean} [props.autoFocus] - Focuses the input on mount.
 * @param {(e: React.KeyboardEvent<HTMLInputElement>) => void} [props.onKeyDown] - Key handler for the input.
 * @param {string} [props.className=''] - Extra class names appended to `ui-search`.
 * @returns {JSX.Element} The search field.
 *
 * @example
 * <SearchField value={query} onChange={setQuery} placeholder="Search" />
 */
export function SearchField({ value, onChange, placeholder, style, autoFocus, onKeyDown, className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; style?: CSSProperties; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; className?: string }) {
  return (
    <label className={`ui-search ${className}`} style={style}>
      <Search size={13} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false} onKeyDown={onKeyDown} />
    </label>
  );
}

/**
 * On/off toggle switch.
 *
 * Renders a `<button role="switch">` whose `aria-checked` reflects `checked`; the knob position
 * is drawn by the `ui-switch` CSS from that attribute. Clicking calls `onChange` with the
 * inverted value; the component holds no state of its own.
 *
 * @param {Object} props - Component props.
 * @param {boolean} props.checked - Whether the switch is on.
 * @param {(v: boolean) => void} props.onChange - Called with the toggled value.
 * @param {string} [props.label] - Accessible label.
 * @param {boolean} [props.disabled] - Disables interaction.
 * @returns {JSX.Element} The switch button.
 *
 * @example
 * <Switch checked={enabled} onChange={setEnabled} label="Dark mode" />
 */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="ui-switch" onClick={() => onChange(!checked)} />;
}

/**
 * Segmented control: a row of mutually exclusive buttons.
 *
 * Renders one button per option inside a `role="group"` container; the option whose value
 * equals `value` gets `aria-pressed`. A glass thumb slides under the selected segment and can be
 * grabbed and dragged to another segment (see useDraggableThumb). Clicking a segment calls
 * `onChange` with that option's value. `T` is the string union of option values.
 *
 * @param {Object} props - Component props.
 * @param {T} props.value - Currently selected value.
 * @param {{ value: T; label: ReactNode; title?: string }[]} props.options - Segments in display order, with an optional tooltip each.
 * @param {(v: T) => void} props.onChange - Called with the clicked segment's value.
 * @returns {JSX.Element} The segmented control.
 *
 * @example
 * <Segmented value={view} options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} onChange={setView} />
 */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { thumb, handlers } = useDraggableThumb(
    ref,
    options.findIndex((o) => o.value === value),
    (i) => onChange(options[i].value),
    options.length,
  );
  return (
    <div ref={ref} className="ui-segmented" role="group" {...handlers}>
      {thumb && <span className={`ui-segmented-thumb${thumb.dragging ? ' dragging' : ''}`} style={{ width: thumb.w, translate: `${thumb.x}px 0` }} aria-hidden="true" />}
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Horizontal range slider.
 *
 * Renders an `<input type="range">` with the `ui-slider` class. The filled part of the track is
 * painted from the `--fill` CSS variable, set to the value's position between `min` and `max`
 * as a percentage. `onChange` receives the value as a number. `min` and `max` must differ, or
 * the fill percentage is not a finite number.
 *
 * @param {Object} props - Component props.
 * @param {number} props.value - Current value.
 * @param {number} [props.min=0] - Lowest value.
 * @param {number} [props.max=1] - Highest value.
 * @param {number} [props.step=0.01] - Step between values.
 * @param {(v: number) => void} props.onChange - Called with the new numeric value.
 * @param {CSSProperties} [props.style] - Inline styles merged before the `--fill` variable.
 * @param {string} [props.label] - Accessible label.
 * @returns {JSX.Element} The range input.
 *
 * @example
 * <Slider value={volume} onChange={setVolume} label="Volume" />
 */
export function Slider({ value, min = 0, max = 1, step = 0.01, onChange, style, label }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; style?: CSSProperties; label?: string }) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input
      type="range"
      className="ui-slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ...style, ['--fill' as string]: fill }}
    />
  );
}

/**
 * Pop-up button backed by a native `<select>`.
 *
 * Renders one `<option>` per entry and calls `onChange` with the chosen option's value, typed
 * as `T` (the string union of option values).
 *
 * @param {Object} props - Component props.
 * @param {T} props.value - Currently selected value.
 * @param {{ value: T; label: string }[]} props.options - Choices in display order.
 * @param {(v: T) => void} props.onChange - Called with the newly selected value.
 * @param {CSSProperties} [props.style] - Inline styles for the select.
 * @returns {JSX.Element} The select element.
 *
 * @example
 * <Select value={sort} options={[{ value: 'name', label: 'Name' }, { value: 'date', label: 'Date' }]} onChange={setSort} />
 */
export function Select<T extends string>({ value, options, onChange, style }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; style?: CSSProperties }) {
  return (
    <select className="ui-select" value={value} onChange={(e) => onChange(e.target.value as T)} style={style}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Toolbar for windows with an `'overlay'` titlebar.
 *
 * The bar is marked as a drag region so empty areas move the window. With `inset` it pads 84px
 * on the left to leave room for the traffic-light buttons; otherwise it pads 12px. A `style`
 * prop can override the padding.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} [props.children] - Toolbar contents.
 * @param {CSSProperties} [props.style] - Inline styles applied after the padding.
 * @param {boolean} [props.inset=true] - Reserves space for the traffic lights.
 * @param {string} [props.className=''] - Extra class names appended to `ui-toolbar`.
 * @returns {JSX.Element} The toolbar element.
 *
 * @example
 * <Toolbar><IconButton label="Back" /><Spacer /><SearchField value={q} onChange={setQ} /></Toolbar>
 */
export function Toolbar({ children, style, inset = true, className = '' }: { children?: ReactNode; style?: CSSProperties; inset?: boolean; className?: string }) {
  return (
    <div className={`ui-toolbar ${className}`} data-drag-region style={{ paddingLeft: inset ? 84 : 12, ...style }}>
      {children}
    </div>
  );
}

/**
 * Flexible gap that pushes the following toolbar items to the far end.
 *
 * Grows with `flex: 1` and is itself a drag region, so the empty space still moves the window.
 *
 * @returns {JSX.Element} The spacer element.
 *
 * @example
 * <Toolbar><Button>Left</Button><Spacer /><Button>Right</Button></Toolbar>
 */
export function Spacer() {
  return <div style={{ flex: 1 }} data-drag-region />;
}

/**
 * Group of sidebar items with an optional small heading.
 *
 * Renders a plain `<div>`: when `title` is truthy it comes first as a `ui-sidebar-section`
 * heading, followed by the children; otherwise only the children are rendered.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} [props.title] - Section heading; not rendered when falsy.
 * @param {ReactNode} props.children - The section's items.
 * @returns {JSX.Element} The section wrapper.
 *
 * @example
 * <SidebarSection title="Favorites"><SidebarItem label="Desktop" /></SidebarSection>
 */
export function SidebarSection({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {title && <div className="ui-sidebar-section">{title}</div>}
      {children}
    </div>
  );
}

/**
 * Clickable sidebar row with an icon and a label.
 *
 * Renders a `<div role="button">` with the `ui-sidebar-item` class; `selected` adds the
 * `selected` class for the highlighted state. The label is truncated with an ellipsis. Extra
 * div attributes (e.g. drag-and-drop handlers) are spread onto the row.
 *
 * @param {Object} props - Component props, plus any other `div` attributes.
 * @param {ReactNode} [props.icon] - Leading icon.
 * @param {ReactNode} props.label - Row text.
 * @param {boolean} [props.selected] - Highlights the row.
 * @param {() => void} [props.onClick] - Called when the row is clicked.
 * @param {(e: React.MouseEvent) => void} [props.onContextMenu] - Called on right-click.
 * @param {string} [props.className=''] - Extra class names.
 * @returns {JSX.Element} The sidebar row.
 *
 * @example
 * <SidebarItem icon={<Folder size={14} />} label="Documents" selected={path === docs} onClick={() => go(docs)} />
 */
export function SidebarItem({ icon, label, selected, onClick, onContextMenu, className = '', ...rest }: { icon?: ReactNode; label: ReactNode; selected?: boolean; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void } & Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick' | 'onContextMenu'>) {
  return (
    <div role="button" {...rest} className={`ui-sidebar-item ${selected ? 'selected' : ''} ${className}`} onClick={onClick} onContextMenu={onContextMenu}>
      {icon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  );
}

/**
 * Centered placeholder shown when a view has no content.
 *
 * Stacks an optional icon, a bold title and an optional subtitle inside the `ui-empty` box.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} [props.icon] - Illustration above the title.
 * @param {ReactNode} props.title - Main message.
 * @param {ReactNode} [props.subtitle] - Secondary explanation.
 * @returns {JSX.Element} The empty-state block.
 *
 * @example
 * <EmptyState icon={<Inbox size={32} />} title="No Messages" />
 */
export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="ui-empty">
      {icon}
      <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</div>
      {subtitle && <div>{subtitle}</div>}
    </div>
  );
}

/**
 * Liquid Glass surfaces (styled by styles/glass.css).
 *
 *   <Glass variant="regular" shape="capsule" refraction>…</Glass>
 *
 * Optics: on Chromium, `backdrop-filter` accepts SVG filter references, so the backdrop is
 * rendered through a filter built per element size and look (components/liquidGlass): lens
 * refraction at the rim, light frost, colour bleeding into the edge and a specular rim light.
 * Other browsers get the CSS material alone: blur, rim light and inner edge glow.
 */
import { forwardRef, useCallback, useEffect, useRef, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { useSystem } from '@/kernel/system';
import { acquireGlassFilter, type FilterHandle, type GlassLookName, type LensTuning } from './liquidGlass/filter';

/** Material of a glass surface; every value except 'regular' adds an `lg-<variant>` class. */
export type GlassVariant = 'regular' | 'clear' | 'thick' | 'tinted' | 'control';
/** Outline of a glass surface; 'capsule' and 'circle' add `lg-capsule` / `lg-circle`. */
export type GlassShape = 'rect' | 'capsule' | 'circle';

/** Tuning for the glass optics. */
export interface RefractionOptions {
  /** Upper bound for the width of the curved rim in px (default: derived from the element size). */
  bezel?: number;
  /** Lens strength, where 26 is normal (larger bends the backdrop more). */
  scale?: number;
}

export const refractionSupported: boolean = (() => {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  const chromium = brands ? brands.some((b) => /Chromium/i.test(b.brand)) : /\bChrome\/\d+/.test(navigator.userAgent) && !/Edg\/|CriOS|FxiOS/.test(navigator.userAgent);
  return chromium && typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'blur(1px)');
})(); /** True on Chromium engines with `backdrop-filter`, where SVG filters can refract the backdrop. */

/* Mirrors the flag to <html data-lg-refraction>; glass.css only applies refraction when it is 'true'. */
if (typeof document !== 'undefined') document.documentElement.dataset.lgRefraction = String(refractionSupported);

/**
 * Records where a press on interactive glass started, as `--lg-px` / `--lg-py` on the element.
 *
 * Finds the closest `.lg-interactive` ancestor of the event target and stores the pointer offset
 * relative to its box; glass.css lights the glass up from that point while it is pressed. Presses
 * outside interactive glass are ignored. Installed once as a capturing, passive pointerdown
 * listener on the document.
 *
 * @param {PointerEvent} e - The pointerdown event.
 * @returns {void}
 *
 * @example
 * document.addEventListener('pointerdown', trackPress, { capture: true, passive: true });
 */
function trackPress(e: PointerEvent): void {
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.lg-interactive') : null;
  if (!target) return;
  const r = target.getBoundingClientRect();
  target.style.setProperty('--lg-px', `${Math.round(e.clientX - r.left)}px`);
  target.style.setProperty('--lg-py', `${Math.round(e.clientY - r.top)}px`);
}

if (typeof document !== 'undefined') document.addEventListener('pointerdown', trackPress, { capture: true, passive: true });

/**
 * Picks the glass look of an element from its material classes.
 *
 * Checks the modifier classes in priority order (`lg-menu`, `lg-thick`, `lg-clear`,
 * `lg-control`) and returns the look of the first one present, so the filter matches the
 * material glass.css draws.
 *
 * @param {Element} el - An element carrying the `lg` classes.
 * @returns {GlassLookName} The matching look ('regular' when no modifier class is present).
 *
 * @example
 * lookOf(menuPanel); // 'menu'
 */
function lookOf(el: Element): GlassLookName {
  const c = el.classList;
  if (c.contains('lg-menu')) return 'menu';
  if (c.contains('lg-thick')) return 'thick';
  if (c.contains('lg-clear')) return 'clear';
  if (c.contains('lg-control')) return 'control';
  return 'regular';
}

/**
 * Applies the Liquid Glass filter to an element and keeps it matched to the element's geometry.
 *
 * Acquires the shared filter for the element's size (rounded to even pixels so near-identical
 * elements share one), corner radius and look, exposes it as `--lg-refraction` and sets
 * `data-refract` so glass.css uses it instead of the plain CSS blur. A ResizeObserver rebuilds it
 * once a size change has settled for 150 ms, keeping the current filter during the animation.
 * Elements without a layout size (hidden ones) are skipped until they get one.
 *
 * @param {HTMLElement} el - An element that has the `lg` classes.
 * @param {LensTuning} tuning - Optional bezel cap and lens strength.
 * @returns {() => void} Detaches the filter and stops observing the element.
 *
 * @example
 * const detach = attachOptics(panel, {});
 * detach();
 */
function attachOptics(el: HTMLElement, tuning: LensTuning): () => void {
  let handle: FilterHandle | null = null;
  let frame = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;

  /**
   * Applies the filter that matches the element's current geometry and look.
   *
   * Acquires the new filter before releasing the old one so the surface never flashes unfiltered.
   *
   * @returns {void}
   *
   * @example
   * frame = requestAnimationFrame(update);
   */
  const update = () => {
    frame = 0;
    if (!el.offsetWidth || !el.offsetHeight) return;
    const w = Math.max(2, Math.round(el.offsetWidth / 2) * 2);
    const h = Math.max(2, Math.round(el.offsetHeight / 2) * 2);
    const r = Math.min(Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0), w / 2, h / 2);
    const next = acquireGlassFilter(w, h, r, lookOf(el), tuning);
    handle?.release();
    handle = next;
    if (next) {
      el.style.setProperty('--lg-refraction', `url(#${next.id})`);
      el.dataset.refract = '';
    }
  };
  const ro = new ResizeObserver(() => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!frame) frame = requestAnimationFrame(update);
    }, handle ? 150 : 0);
  });
  ro.observe(el);
  update();
  return () => {
    ro.disconnect();
    clearTimeout(settle);
    cancelAnimationFrame(frame);
    handle?.release();
    el.style.removeProperty('--lg-refraction');
    delete el.dataset.refract;
  };
}

/**
 * Gives an element Liquid Glass optics through a shared SVG backdrop filter (Chromium).
 *
 * Returns a callback ref that runs attachOptics on the element (lens refraction, frost, edge
 * light bleed and specular rim — see components/liquidGlass) and detaches it when the element
 * changes or unmounts. Does nothing without browser support, with Reduce Transparency on, or when
 * `opts` is false. Markup built from class strings can use the `data-lg-optics` attribute instead.
 *
 * @param {RefractionOptions | boolean} [opts=true] - True for automatic optics, an object to cap
 *   the bezel width (`bezel`, px) or scale the lens (`scale`, 26 = normal), or false to disable.
 * @returns {(el: T | null) => void} A callback ref to pass to the element.
 *
 * @example
 * const refractRef = useRefraction<HTMLDivElement>();
 * return <div ref={refractRef} className="lg lg-float" />;
 */
export function useRefraction<T extends HTMLElement>(opts: RefractionOptions | boolean = true): (el: T | null) => void {
  const reduce = useSystem((s) => s.settings.reduceTransparency);
  const enabled = !!opts && refractionSupported && !reduce;
  const bezel = typeof opts === 'object' ? opts.bezel : undefined;
  const strength = typeof opts === 'object' && opts.scale ? opts.scale / 26 : undefined;
  const cleanup = useRef<(() => void) | null>(null);

  /**
   * Callback ref that wires the glass filter to an element.
   *
   * Detaches from the previous element first, then attaches to the new one when enabled.
   *
   * @param {T | null} el - The element being attached, or null when it is detached.
   * @returns {void}
   *
   * @example
   * <div ref={attach} className="lg" />
   */
  const attach = useCallback(
    (el: T | null) => {
      cleanup.current?.();
      cleanup.current = el && enabled ? attachOptics(el, { bezel, strength }) : null;
    },
    [enabled, bezel, strength],
  );

  useEffect(() => () => cleanup.current?.(), []);
  return attach;
}

const autoOptics = new Map<HTMLElement, () => void>(); /** Elements carrying `data-lg-optics` that currently have a filter, with their detach functions. */
let autoFrame = 0; /** Pending animation frame of the next `data-lg-optics` sync (0 = none). */

/**
 * Attaches or detaches glass optics for every element marked `data-lg-optics`.
 *
 * Detaches elements that left the document or lost the attribute, attaches new ones, and with
 * Reduce Transparency on (or without browser support) detaches everything.
 *
 * @returns {void}
 *
 * @example
 * syncAutoOptics();
 */
function syncAutoOptics(): void {
  autoFrame = 0;
  const on = refractionSupported && !useSystem.getState().settings.reduceTransparency;
  const wanted = new Set(on ? document.querySelectorAll<HTMLElement>('[data-lg-optics]') : []);
  for (const [el, detach] of autoOptics) {
    if (!wanted.has(el) || !el.isConnected) {
      detach();
      autoOptics.delete(el);
    }
  }
  for (const el of wanted) if (!autoOptics.has(el)) autoOptics.set(el, attachOptics(el, {}));
}

/**
 * Schedules a `data-lg-optics` sync on the next animation frame.
 *
 * Does nothing while a sync is already pending, so a burst of DOM mutations or setting changes
 * results in a single syncAutoOptics run.
 *
 * @returns {void}
 *
 * @example
 * new MutationObserver(scheduleAutoOptics).observe(document.body, { childList: true, subtree: true });
 */
function scheduleAutoOptics(): void {
  if (!autoFrame) autoFrame = requestAnimationFrame(syncAutoOptics);
}

if (typeof document !== 'undefined' && refractionSupported) {
  /**
   * Starts watching the document for `data-lg-optics` elements.
   *
   * Observes the body for added or removed nodes and for changes to the `data-lg-optics`
   * attribute, re-syncs whenever the Reduce Transparency setting flips, and runs an initial sync.
   * It runs right away when the body already exists, otherwise once on DOMContentLoaded.
   *
   * @returns {void}
   *
   * @example
   * startAutoOptics();
   */
  const startAutoOptics = () => {
    new MutationObserver(scheduleAutoOptics).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-lg-optics'] });
    useSystem.subscribe((s, prev) => {
      if (s.settings.reduceTransparency !== prev.settings.reduceTransparency) scheduleAutoOptics();
    });
    scheduleAutoOptics();
  };
  if (document.body) startAutoOptics();
  else document.addEventListener('DOMContentLoaded', startAutoOptics, { once: true });
}

/** Props for <Glass>; any other HTML attributes are passed through to the rendered element. */
export interface GlassProps extends HTMLAttributes<HTMLElement> {
  /** Element or component to render (default 'div'). */
  as?: ElementType;
  /** Glass material (default 'regular'). */
  variant?: GlassVariant;
  /** Outline (default 'rect'). */
  shape?: GlassShape;
  /** Shadow depth: 'flat' (on content), default, or 'float' (popovers, dock, panels). */
  elevation?: 'flat' | 'default' | 'float';
  /** Hover/press "jelly" response for clickable glass. */
  interactive?: boolean;
  /** Edge refraction on supporting browsers; true for defaults or an options object (default false). */
  refraction?: boolean | RefractionOptions;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Combines several refs into one callback ref.
 *
 * The returned callback forwards each value to every ref: function refs are called and object
 * refs get their `current` set. Undefined entries are skipped.
 *
 * @param {...(Ref<T> | undefined)} refs - Refs that should all receive the element.
 * @returns {(value: T | null) => void} A callback ref that updates every given ref.
 *
 * @example
 * <div ref={mergeRefs(forwardedRef, localRef)} />
 */
function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value);
      else if (ref) (ref as { current: T | null }).current = value;
    }
  };
}

/**
 * A Liquid Glass surface.
 *
 * Renders `as` (a div by default) with the `lg` class plus modifier classes for the variant,
 * shape, elevation and interactive state, followed by any `className`. Refraction is attached
 * through useRefraction; the forwarded ref and the refraction ref are merged so both receive the
 * element. Remaining props are spread onto the element.
 *
 * @param {GlassProps} props - Surface options and pass-through HTML attributes.
 * @param {ElementType} [props.as='div'] - Element or component to render.
 * @param {GlassVariant} [props.variant='regular'] - Glass material.
 * @param {GlassShape} [props.shape='rect'] - Outline.
 * @param {'flat' | 'default' | 'float'} [props.elevation='default'] - Shadow depth.
 * @param {boolean} [props.interactive] - Adds the hover/press response.
 * @param {boolean | RefractionOptions} [props.refraction=false] - Edge refraction settings.
 * @param {string} [props.className=''] - Extra classes appended after the glass classes.
 * @param {ReactNode} [props.children] - Content of the surface.
 * @param {Ref<HTMLElement>} ref - Forwarded ref to the rendered element.
 * @returns {JSX.Element} The glass element.
 *
 * @example
 * <Glass variant="thick" shape="capsule" elevation="float" refraction>Now Playing</Glass>
 */
export const Glass = forwardRef<HTMLElement, GlassProps>(function Glass(
  { as: Tag = 'div', variant = 'regular', shape = 'rect', elevation = 'default', interactive, refraction = false, className = '', children, ...rest },
  ref,
) {
  const refractRef = useRefraction<HTMLElement>(refraction);
  const cls = [
    'lg',
    variant !== 'regular' && `lg-${variant}`,
    shape !== 'rect' && `lg-${shape}`,
    elevation === 'flat' && 'lg-flat',
    elevation === 'float' && 'lg-float',
    interactive && 'lg-interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag ref={mergeRefs(ref, refractRef)} className={cls} {...rest}>
      {children}
    </Tag>
  );
});

/**
 * A glass capsule that groups toolbar buttons.
 *
 * Renders a `role="group"` container with the control glass classes, marked `data-no-drag` so
 * clicks on it do not start a window drag from the toolbar.
 *
 * @param {Object} props - Component props.
 * @param {ReactNode} props.children - Buttons in the group.
 * @param {string} [props.className=''] - Extra classes for the capsule.
 * @param {CSSProperties} [props.style] - Inline styles for the capsule.
 * @param {string} [props.label] - Accessible name of the group.
 * @returns {JSX.Element} The group container.
 *
 * @example
 * <GlassGroup label="Navigation">
 *   <IconButton label="Back"><ChevronLeft size={16} /></IconButton>
 * </GlassGroup>
 */
export function GlassGroup({ children, className = '', style, label }: { children: ReactNode; className?: string; style?: CSSProperties; label?: string }) {
  return (
    <div className={`lg lg-control lg-group ${className}`} style={style} role="group" aria-label={label} data-no-drag>
      {children}
    </div>
  );
}

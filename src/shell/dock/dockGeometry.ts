/**
 * Pure geometry for the Dock: base layout along the dock axis, macOS-style magnification with a
 * cosine falloff, and the panel shift that keeps the point under the pointer stationary while the
 * dock grows (so neighbors push apart around the cursor).
 *
 * All positions are 1-D coordinates along the dock axis (x for a bottom dock, y for a side dock).
 */

/** One slot of the dock layout (an icon or a separator). */
export interface SlotSpec {
  /** Base length along the axis (icons: icon size; separators: their fixed width). */
  len: number;
  /** Icons magnify; separators don't. */
  magnify: boolean;
}

/**
 * Computes the total length of the dock panel at rest.
 *
 * Sums every slot length, the gaps between neighboring slots and the padding at both ends.
 *
 * @param {SlotSpec[]} slots - Slots in dock order.
 * @param {number} gap - Space between adjacent slots.
 * @param {number} padding - Padding at each end of the panel.
 * @returns {number} The panel length along the dock axis.
 *
 * @example
 * restLength([{ len: 50, magnify: true }, { len: 50, magnify: true }], 4, 6); // 116
 */
export function restLength(slots: SlotSpec[], gap: number, padding: number): number {
  if (!slots.length) return padding * 2;
  return padding * 2 + slots.reduce((sum, s) => sum + s.len, 0) + gap * (slots.length - 1);
}

/**
 * Computes the center of every slot at rest for a panel centered on `center`.
 *
 * Starts at the panel's leading edge plus the padding and walks the slots in order, placing each
 * center half a slot length in and advancing by the slot length plus one gap.
 *
 * @param {SlotSpec[]} slots - Slots in dock order.
 * @param {number} gap - Space between adjacent slots.
 * @param {number} padding - Padding at each end of the panel.
 * @param {number} center - Axis coordinate of the panel's center.
 * @returns {number[]} Slot centers along the axis, in slot order.
 *
 * @example
 * restCenters(slots, 4, 6, window.innerWidth / 2);
 */
export function restCenters(slots: SlotSpec[], gap: number, padding: number, center: number): number[] {
  let acc = center - restLength(slots, gap, padding) / 2 + padding;
  return slots.map((s) => {
    const c = acc + s.len / 2;
    acc += s.len + gap;
    return c;
  });
}

/**
 * Computes the magnified size of each slot for the current pointer position.
 *
 * Icons grow along a cosine bell, f(d) = (1 + cos(πd / range)) / 2, which is 1 under the pointer,
 * 0 at ±range and has zero slope at both ends, so sizes change smoothly as the pointer moves.
 * Separators keep their length; every icon stays at `base` when the pointer is away or
 * magnification is disabled (`max <= base`).
 *
 * @param {SlotSpec[]} slots - Slots in dock order.
 * @param {number[]} centers - Rest centers of the slots (from `restCenters`).
 * @param {number | null} pointer - Pointer coordinate along the axis, or null when not hovering.
 * @param {number} base - Icon size at rest.
 * @param {number} max - Icon size directly under the pointer.
 * @param {number} range - Distance from the pointer at which magnification fades out completely.
 * @returns {number[]} Target length of each slot.
 *
 * @example
 * const sizes = magnifiedSizes(slots, centers, mouseX, 48, 96, 150);
 */
export function magnifiedSizes(slots: SlotSpec[], centers: number[], pointer: number | null, base: number, max: number, range: number): number[] {
  return slots.map((s, i) => {
    if (!s.magnify) return s.len;
    if (pointer === null || max <= base) return base;
    const d = Math.abs(pointer - centers[i]);
    if (d >= range) return base;
    const f = (1 + Math.cos((Math.PI * d) / range)) / 2;
    return base + (max - base) * f;
  });
}

/**
 * Computes how far to translate the panel so the content under the pointer stays put.
 *
 * A centered flex container grows equally in both directions, so when slots grow from
 * `slots[i].len` to `sizes[i]` the panel is shifted by (total extra / 2 − extra left of the
 * pointer). Each slot contributes its growth to the "left" share in proportion to how much of it
 * lies before the pointer.
 *
 * @param {SlotSpec[]} slots - Slots in dock order.
 * @param {number[]} centers - Rest centers of the slots.
 * @param {number[]} sizes - Magnified slot lengths (from `magnifiedSizes`).
 * @param {number | null} pointer - Pointer coordinate along the axis, or null when not hovering.
 * @returns {number} The shift along the axis; 0 when the pointer is null.
 *
 * @example
 * const shift = panelShift(slots, centers, sizes, mouseX);
 * panel.style.transform = `translateX(${shift}px)`;
 */
export function panelShift(slots: SlotSpec[], centers: number[], sizes: number[], pointer: number | null): number {
  let total = 0;
  let left = 0;
  for (let i = 0; i < slots.length; i++) {
    const extra = sizes[i] - slots[i].len;
    if (!extra) continue;
    total += extra;
    if (pointer === null) continue;
    const start = centers[i] - slots[i].len / 2;
    const frac = Math.min(1, Math.max(0, (pointer - start) / slots[i].len));
    left += extra * frac;
  }
  return pointer === null ? 0 : total / 2 - left;
}

/**
 * Computes the worst-case total growth of the dock, in units of (max − base).
 *
 * For icons `step` px apart and a magnification `range`, returns the largest sum of the cosine
 * bell over all pointer offsets. The sum is periodic in `step`, so 8 pointer offsets across one
 * icon pitch are sampled. Degenerate inputs (non-positive step or range) and sums below 1 yield 1.
 *
 * @param {number} step - Distance between adjacent icon centers.
 * @param {number} range - Magnification range (see `magnifiedSizes`).
 * @returns {number} The bell-sum factor, at least 1.
 *
 * @example
 * const maxExtra = bellSum(52, 150) * (maxSize - baseSize);
 */
export function bellSum(step: number, range: number): number {
  if (step <= 0 || range <= 0) return 1;
  const reach = Math.ceil(range / step) + 1;
  let best = 0;
  for (let s = 0; s < 8; s++) {
    const offset = (step * s) / 8;
    let sum = 0;
    for (let k = -reach; k <= reach; k++) {
      const d = Math.abs(k * step - offset);
      if (d < range) sum += (1 + Math.cos((Math.PI * d) / range)) / 2;
    }
    best = Math.max(best, sum);
  }
  return Math.max(1, best);
}

/**
 * Clamps the panel shift so a magnified dock stays within [lo, hi] when it fits.
 *
 * Near the screen edges the content under the pointer then drifts slightly instead of the end
 * icons sliding off-screen. When the grown dock is longer than the bounds, the shift that centers
 * it in the bounds is returned instead.
 *
 * @param {number} shift - Unclamped shift (from `panelShift`).
 * @param {number} restLen - Panel length at rest.
 * @param {number} extra - Total growth caused by magnification.
 * @param {number} center - Axis coordinate the panel is centered on.
 * @param {number} lo - Lower screen bound along the axis.
 * @param {number} hi - Upper screen bound along the axis.
 * @returns {number} The clamped shift.
 *
 * @example
 * clampShift(-200, 400, 100, 250, 0, 600); // 0
 */
export function clampShift(shift: number, restLen: number, extra: number, center: number, lo: number, hi: number): number {
  const len = restLen + extra;
  if (len >= hi - lo) return lo + len / 2 - center + (hi - lo - len) / 2;
  const start = center - len / 2 + shift;
  if (start < lo) return shift + (lo - start);
  if (start + len > hi) return shift - (start + len - hi);
  return shift;
}

/**
 * Finds the largest icon size (≤ `wanted`) for which the dock fits in `available` px.
 *
 * Gaps scale with the icon size (see `gapFor`). The size is first solved linearly assuming
 * gap ≈ size · gapRatio, then decremented until the rounded layout fits. The result never goes
 * below `minSize`, so the caller must handle a dock that is still too long at that size. With no
 * icons, `wanted` is returned unchanged.
 *
 * @param {number} wanted - Preferred icon size.
 * @param {number} iconCount - Number of icons (scaling slots).
 * @param {number} fixed - Total length of slots that don't scale (separators).
 * @param {number} slotCount - Total number of slots, used to count the gaps.
 * @param {number} padding - Padding at each end of the panel.
 * @param {number} available - Space available along the axis.
 * @param {number} gapRatio - Gap size as a fraction of the icon size.
 * @param {number} [minSize=24] - Smallest size returned.
 * @returns {number} The icon size to use.
 *
 * @example
 * fitIconSize(52, 20, 13, 21, 6, 600, 0.05); // a size below 52 that fits in 600px
 */
export function fitIconSize(wanted: number, iconCount: number, fixed: number, slotCount: number, padding: number, available: number, gapRatio: number, minSize = 24): number {
  if (iconCount <= 0) return wanted;
  const gaps = Math.max(0, slotCount - 1);
  /**
   * Computes the dock length needed at a given icon size.
   *
   * Uses the gap that `gapFor` derives from the candidate size, so rounding of the gaps is
   * included in the result.
   *
   * @param {number} size - Candidate icon size.
   * @returns {number} Padding + fixed slots + icons + scaled gaps.
   *
   * @example
   * if (need(wanted) <= available) return wanted;
   */
  const need = (size: number) => padding * 2 + fixed + size * iconCount + gapFor(size, gapRatio) * gaps;
  if (need(wanted) <= available) return wanted;
  let size = Math.floor((available - padding * 2 - fixed) / (iconCount + gaps * gapRatio));
  while (size > minSize && need(size) > available) size--;
  return Math.max(minSize, Math.min(wanted, size));
}

/**
 * Computes the gap between dock slots for an icon size.
 *
 * Multiplies the size by the ratio and rounds to whole pixels, never going below 2 px so icons
 * keep visible spacing at small sizes.
 *
 * @param {number} size - Icon size.
 * @param {number} gapRatio - Gap as a fraction of the icon size.
 * @returns {number} The rounded gap, at least 2 px.
 *
 * @example
 * gapFor(52, 0.05); // 3
 */
export function gapFor(size: number, gapRatio: number): number {
  return Math.max(2, Math.round(size * gapRatio));
}

/**
 * Computes the insertion index for a dragged icon whose center is at `pos`.
 *
 * Rounds the distance from the section's first slot center to whole slot steps and clamps it to
 * [min, max].
 *
 * @param {number} pos - Axis coordinate of the dragged icon's center.
 * @param {number} firstCenter - Rest center of the first slot of the section.
 * @param {number} step - Distance between slot centers.
 * @param {number} min - Smallest allowed index.
 * @param {number} max - Largest allowed index.
 * @returns {number} The clamped insertion index.
 *
 * @example
 * insertionIndex(160, 0, 50, 1, 5); // 3
 */
export function insertionIndex(pos: number, firstCenter: number, step: number, min: number, max: number): number {
  const raw = Math.round((pos - firstCenter) / step);
  return Math.min(max, Math.max(min, raw));
}

/**
 * Moves `item` to position `index` within `list`.
 *
 * The item is removed from wherever it is (if present) and inserted at `index`, clamped to the
 * bounds of the remaining list. The input array is not modified.
 *
 * @param {T[]} list - The source list.
 * @param {T} item - The item to move (compared by identity).
 * @param {number} index - Target index in the list without the item.
 * @returns {T[]} A new array with the item at its new position.
 *
 * @example
 * moveTo(['a', 'b', 'c', 'd'], 'a', 2); // ['b', 'c', 'a', 'd']
 */
export function moveTo<T>(list: T[], item: T, index: number): T[] {
  const without = list.filter((x) => x !== item);
  const i = Math.min(Math.max(0, index), without.length);
  return [...without.slice(0, i), item, ...without.slice(i)];
}

import { describe, expect, it } from 'vitest';
import { refractionProfile, sdRoundRect, squircleHeight } from './optics';

describe('Liquid Glass optics', () => {
  it('models a convex squircle bulge that is flat on top', () => {
    expect(squircleHeight(0)).toBe(0);
    expect(squircleHeight(1)).toBe(1);
    expect(squircleHeight(0.5)).toBeGreaterThan(0.9);
    expect(squircleHeight(-1)).toBe(0);
  });

  it('measures signed distance to a rounded rectangle', () => {
    expect(sdRoundRect(0, 0, 50, 20, 10)).toBeCloseTo(-20);
    expect(sdRoundRect(50, 0, 50, 20, 10)).toBeCloseTo(0);
    expect(sdRoundRect(60, 0, 50, 20, 10)).toBeCloseTo(10);
  });

  it('refracts most at the rim and not at all on the flat top', () => {
    const { offsets, max } = refractionProfile(20, 1, 1.5);
    expect(max).toBeGreaterThan(0);
    expect(offsets[0]).toBeGreaterThan(offsets[offsets.length - 1]);
    expect(offsets[offsets.length - 1]).toBeLessThan(max * 0.05);
  });

  it('bends more with a higher refractive index and a thicker bulge', () => {
    const base = refractionProfile(20, 0.8, 1.5).max;
    expect(refractionProfile(20, 0.8, 1.9).max).toBeGreaterThan(base);
    expect(refractionProfile(20, 1.1, 1.5).max).toBeGreaterThan(base);
  });
});

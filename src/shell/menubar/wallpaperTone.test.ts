import { describe, expect, it } from 'vitest';
import { coverStrip, foregroundFor, meanLuminance } from './wallpaperTone';

describe('meanLuminance', () => {
  it('averages relative luminance and ignores transparent pixels', () => {
    expect(meanLuminance([255, 255, 255, 255])).toBeCloseTo(1);
    expect(meanLuminance([0, 0, 0, 255])).toBe(0);
    expect(meanLuminance([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(0.5);
    expect(meanLuminance([255, 255, 255, 255, 0, 0, 0, 0])).toBeCloseTo(1);
    expect(meanLuminance([0, 0, 0, 0])).toBeNull();
  });
});

describe('foregroundFor', () => {
  it('uses dark glyphs on bright wallpapers and light glyphs on dark ones', () => {
    expect(foregroundFor(0.9)).toBe('dark');
    expect(foregroundFor(0.05)).toBe('light');
    // A mid-blue sky (#6c8fe0) is bright enough for dark glyphs.
    expect(foregroundFor(meanLuminance([0x6c, 0x8f, 0xe0, 255])!)).toBe('dark');
    // A night sky (#08113a) is not.
    expect(foregroundFor(meanLuminance([0x08, 0x11, 0x3a, 255])!)).toBe('light');
  });
});

describe('coverStrip', () => {
  it('maps the strip under the bar into the picture as background-size: cover crops it', () => {
    // Same aspect ratio: the whole width, the top 26 screen px = 52 image px.
    expect(coverStrip(2880, 1800, 1440, 900, 26)).toEqual({ sx: 0, sy: 0, sw: 2880, sh: 52 });
    // Narrower screen: the sides are cropped.
    const square = coverStrip(2880, 1800, 1000, 1000, 26);
    expect(square.sx).toBeCloseTo(540);
    expect(square.sw).toBeCloseTo(1800);
    expect(square.sy).toBe(0);
    expect(square.sh).toBeCloseTo(46.8);
    // Wider screen: the top and bottom are cropped, so the strip starts lower in the picture.
    const wide = coverStrip(2880, 1800, 2000, 500, 26);
    expect(wide.sx).toBe(0);
    expect(wide.sy).toBeCloseTo(540);
    expect(wide.sh).toBeCloseTo(37.44);
  });
});

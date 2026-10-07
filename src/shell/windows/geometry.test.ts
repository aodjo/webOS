import { describe, expect, it } from 'vitest';
import {
  clampWindowPosition,
  detectSnap,
  minimizeTransform,
  resizeBounds,
  restoreOnDrag,
  slideOutOffset,
  snapRect,
  MIN_VISIBLE_X,
  MIN_VISIBLE_Y,
  SLIVER,
} from './geometry';

const screen = { width: 1440, height: 900 }; /** Viewport size used by the tests. */
const ws = { x: 0, y: 26, width: 1440, height: 798 }; /** Workspace below a 26px menu bar on the test screen. */
const caps = { canFill: true, canTile: true }; /** Window capabilities allowing both filling and tiling. */

describe('clampWindowPosition', () => {
  it('keeps the title bar below the menu bar and above the screen bottom', () => {
    expect(clampWindowPosition(100, -50, 400, ws, screen).y).toBe(ws.y);
    expect(clampWindowPosition(100, 5000, 400, ws, screen).y).toBe(screen.height - MIN_VISIBLE_Y);
  });

  it('keeps part of the window horizontally on screen', () => {
    expect(clampWindowPosition(-1000, 100, 400, ws, screen).x).toBe(MIN_VISIBLE_X - 400);
    expect(clampWindowPosition(5000, 100, 400, ws, screen).x).toBe(screen.width - MIN_VISIBLE_X);
    expect(clampWindowPosition(200.6, 100.2, 400, ws, screen)).toEqual({ x: 201, y: 100 });
  });
});

describe('detectSnap', () => {
  it('tiles at the side edges and fills at the top', () => {
    expect(detectSnap({ x: 0, y: 400 }, ws, screen, caps)).toBe('left');
    expect(detectSnap({ x: -30, y: 400 }, ws, screen, caps)).toBe('left');
    expect(detectSnap({ x: 1439, y: 400 }, ws, screen, caps)).toBe('right');
    expect(detectSnap({ x: 700, y: 2 }, ws, screen, caps)).toBe('fill');
    expect(detectSnap({ x: 700, y: 300 }, ws, screen, caps)).toBeNull();
  });

  it('respects window capabilities', () => {
    expect(detectSnap({ x: 0, y: 400 }, ws, screen, { canFill: true, canTile: false })).toBeNull();
    expect(detectSnap({ x: 700, y: 0 }, ws, screen, { canFill: false, canTile: true })).toBeNull();
  });

  it('matches the rects used by wm.tile', () => {
    expect(snapRect('fill', ws)).toEqual(ws);
    expect(snapRect('left', ws)).toEqual({ x: 0, y: 26, width: 720, height: 798 });
    expect(snapRect('right', ws)).toEqual({ x: 720, y: 26, width: 720, height: 798 });
  });
});

describe('restoreOnDrag', () => {
  it('keeps the pointer at the same relative x', () => {
    const r = restoreOnDrag({ x: 0, y: 26, width: 1440, height: 798 }, { width: 600, height: 400 }, 360);
    expect(r).toEqual({ x: 210, y: 26, width: 600, height: 400 });
  });
});

describe('resizeBounds', () => {
  const o = { x: 100, y: 100, width: 500, height: 400 };
  const lim = { minWidth: 300, minHeight: 200, top: 26 };

  it('moves the dragged edges only', () => {
    expect(resizeBounds(o, 'se', 50, 20, lim)).toEqual({ x: 100, y: 100, width: 550, height: 420 });
    expect(resizeBounds(o, 'w', -40, 999, lim)).toEqual({ x: 60, y: 100, width: 540, height: 400 });
    expect(resizeBounds(o, 'n', 999, 30, lim)).toEqual({ x: 100, y: 130, width: 500, height: 370 });
  });

  it('enforces the minimum size from the anchored edge', () => {
    expect(resizeBounds(o, 'w', 400, 0, lim)).toEqual({ x: 300, y: 100, width: 300, height: 400 });
    expect(resizeBounds(o, 'se', -400, -400, lim)).toEqual({ x: 100, y: 100, width: 300, height: 200 });
  });

  it('never moves the top edge above the workspace', () => {
    expect(resizeBounds(o, 'nw', 0, -500, lim)).toEqual({ x: 100, y: 26, width: 500, height: 474 });
  });

  it('resizes around the center with ⌥', () => {
    expect(resizeBounds(o, 'e', 30, 0, lim, true)).toEqual({ x: 70, y: 100, width: 560, height: 400 });
    expect(resizeBounds(o, 'e', -200, 0, lim, true)).toEqual({ x: 200, y: 100, width: 300, height: 400 });
  });
});

describe('slideOutOffset', () => {
  it('pushes a window off its nearest edge leaving a sliver', () => {
    const left = { x: 20, y: 200, width: 300, height: 300 };
    expect(slideOutOffset(left, screen)).toEqual({ x: SLIVER - 320, y: 0 });
    const right = { x: 1100, y: 200, width: 300, height: 300 };
    expect(slideOutOffset(right, screen)).toEqual({ x: screen.width - SLIVER - 1100, y: 0 });
    const bottom = { x: 600, y: 700, width: 300, height: 150 };
    expect(slideOutOffset(bottom, screen)).toEqual({ x: 0, y: screen.height - SLIVER - 700 });
  });
});

describe('minimizeTransform', () => {
  it('centers the scaled window on the target', () => {
    const t = minimizeTransform({ x: 100, y: 100, width: 400, height: 200 }, { x: 700, y: 850, width: 40, height: 40 });
    // scale = min(40/400, 40/200) = 0.1 → scaled 40×20 centered on (720, 870) → top-left (700, 860)
    expect(t).toBe('translate(600.0px, 760.0px) scale(0.1000)');
  });
});

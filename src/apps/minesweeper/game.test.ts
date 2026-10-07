import { describe, expect, it } from 'vitest';
import { LEVELS, chord, cycleMark, fromLayout, layMines, minesLeft, neighbors, newGame, reveal } from './game';

/**
 * Create a deterministic pseudo-random number generator (mulberry32).
 *
 * Each call of the returned function advances a 32-bit state and mixes it into a float, so
 * the same seed always produces the same sequence, which makes mine placement reproducible.
 *
 * @param {number} seed - Initial 32-bit state.
 * @returns {() => number} Generator returning values in [0, 1).
 *
 * @example
 * const rng = seeded(7);
 * const game = layMines(newGame(LEVELS.beginner), 0, rng);
 */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a (row, column) position to a row-major cell index.
 *
 * Mirrors the board layout used by the game, where cell `i` sits at row `floor(i / cols)`
 * and column `i % cols`.
 *
 * @param {number} r - Zero-based row.
 * @param {number} c - Zero-based column.
 * @param {number} cols - Number of columns on the board.
 * @returns {number} The row-major index of the cell.
 *
 * @example
 * const first = idx(8, 15, LEVELS.expert.cols);
 * console.log(first); // 255
 */
const idx = (r: number, c: number, cols: number) => r * cols + c;

describe('neighbors', () => {
  it('handles corners, edges and the interior', () => {
    expect(neighbors(0, 3, 3).sort()).toEqual([1, 3, 4]);
    expect(neighbors(4, 3, 3)).toHaveLength(8);
    expect(neighbors(1, 3, 3)).toHaveLength(5);
  });
});

describe('board generation', () => {
  it('lays exactly the configured number of mines with correct adjacency', () => {
    for (const level of Object.values(LEVELS)) {
      const g = layMines(newGame(level), 0, seeded(7));
      expect(g.cells.filter((c) => c.mine)).toHaveLength(level.mines);
      g.cells.forEach((cell, i) => {
        const n = neighbors(i, g.rows, g.cols).filter((j) => g.cells[j].mine).length;
        expect(cell.adjacent).toBe(n);
      });
    }
  });

  it('keeps the first click and its neighbours mine-free so it opens an area', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const level = LEVELS.expert;
      const first = idx(8, 15, level.cols);
      const g = reveal(newGame(level), first, 1000, seeded(seed));
      expect(g.status).toBe('playing');
      expect(g.startedAt).toBe(1000);
      expect(g.cells[first].mine).toBe(false);
      expect(g.cells[first].adjacent).toBe(0);
      for (const j of neighbors(first, g.rows, g.cols)) expect(g.cells[j].mine).toBe(false);
      expect(g.revealed).toBeGreaterThan(1);
    }
  });

  it('still keeps the clicked cell safe on a nearly full board', () => {
    const g = reveal(newGame({ rows: 3, cols: 3, mines: 8 }), 4, 0, seeded(3));
    expect(g.cells[4].mine).toBe(false);
    expect(g.cells.filter((c) => c.mine)).toHaveLength(8);
    expect(g.status).toBe('won');
  });
});

describe('flood fill', () => {
  it('reveals the connected zero region and its numbered border only', () => {
    const g = fromLayout([
      '.....', //
      '.....',
      '...**',
      '...*.',
    ]);
    const next = reveal(g, 0, 5);
    const shown = next.cells.map((c) => (c.revealed ? (c.mine ? '*' : String(c.adjacent)) : '#'));
    expect(shown.join('')).toBe(['00000', '00122', '002##', '002##'].join(''));
    expect(next.revealed).toBe(shown.filter((s) => s !== '#').length);
    expect(next.status).toBe('playing');
  });

  it('does not reveal flagged cells and clears question marks it passes over', () => {
    let g = fromLayout(['....', '....', '...*']);
    g = cycleMark(g, 1);
    g = cycleMark(cycleMark(g, 2), 2);
    const next = reveal(g, 4, 0);
    expect(next.cells[1].revealed).toBe(false);
    expect(next.cells[1].mark).toBe('flag');
    expect(next.cells[2].revealed).toBe(true);
    expect(next.cells[2].mark).toBe('none');
  });

  it('ignores clicks on flagged cells', () => {
    const g = cycleMark(fromLayout(['*.', '..']), 3);
    expect(reveal(g, 3, 0)).toBe(g);
  });
});

describe('chording', () => {
  const layout = ['*..', '...', '...'];

  it('reveals the remaining neighbours when the flags match the number', () => {
    let g = reveal(fromLayout(layout), 4, 0);
    expect(g.cells[4].adjacent).toBe(1);
    g = cycleMark(g, 0);
    const next = chord(g, 4, 10);
    expect(next.status).toBe('won');
    expect(next.cells.filter((c, i) => i !== 0 && c.revealed)).toHaveLength(8);
  });

  it('does nothing when the flag count does not match', () => {
    const g = reveal(fromLayout(layout), 4, 0);
    expect(chord(g, 4, 1)).toBe(g);
  });

  it('loses when a flag is misplaced', () => {
    let g = reveal(fromLayout(layout), 4, 0);
    g = cycleMark(g, 1);
    const next = chord(g, 4, 10);
    expect(next.status).toBe('lost');
    expect(next.exploded).toBe(0);
    expect(next.endedAt).toBe(10);
  });
});

describe('marks', () => {
  it('cycles flag → question → none and tracks the mine counter', () => {
    let g = fromLayout(['*.', '..']);
    g = cycleMark(g, 1);
    expect(g.cells[1].mark).toBe('flag');
    expect(minesLeft(g)).toBe(0);
    g = cycleMark(g, 1);
    expect(g.cells[1].mark).toBe('question');
    expect(minesLeft(g)).toBe(1);
    g = cycleMark(g, 1);
    expect(g.cells[1].mark).toBe('none');
  });

  it('skips the question mark when disabled', () => {
    let g = cycleMark(fromLayout(['*.', '..']), 1, false);
    g = cycleMark(g, 1, false);
    expect(g.cells[1].mark).toBe('none');
  });
});

describe('win / lose detection', () => {
  it('wins when every safe cell is revealed and flags the mines', () => {
    let g = fromLayout(['*.', '..']);
    g = reveal(g, 1, 0);
    g = reveal(g, 2, 0);
    expect(g.status).toBe('playing');
    g = reveal(g, 3, 42);
    expect(g.status).toBe('won');
    expect(g.endedAt).toBe(42);
    expect(g.cells[0].mark).toBe('flag');
    expect(minesLeft(g)).toBe(0);
  });

  it('loses when a mine is revealed and freezes the board', () => {
    const g = reveal(fromLayout(['*.', '..']), 0, 7);
    expect(g.status).toBe('lost');
    expect(g.exploded).toBe(0);
    expect(reveal(g, 1, 8)).toBe(g);
    expect(cycleMark(g, 1)).toBe(g);
  });
});

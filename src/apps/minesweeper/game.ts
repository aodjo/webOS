/**
 * Pure Minesweeper rules. Every function returns a new Game (or the same object when the move
 * is a no-op, so React state updates can bail out).
 */

/** Board dimensions and mine count of a difficulty level. */
export interface Difficulty {
  rows: number;
  cols: number;
  mines: number;
}

export const LEVELS = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
} as const satisfies Record<string, Difficulty>; /** The three classic difficulty presets, keyed by level id. */

/** Identifier of one of the preset difficulty levels. */
export type LevelId = keyof typeof LEVELS;
export const LEVEL_IDS = Object.keys(LEVELS) as LevelId[]; /** Level ids in menu order (beginner → expert). */

/** Player mark on a covered cell. */
export type Mark = 'none' | 'flag' | 'question';

/** One square of the minefield. */
export interface Cell {
  mine: boolean;
  /** Number of mines in the 8 neighbouring cells. */
  adjacent: number;
  revealed: boolean;
  mark: Mark;
}

/** Game lifecycle: 'ready' until the first reveal lays the mines, then 'playing' until won or lost. */
export type Status = 'ready' | 'playing' | 'won' | 'lost';

/**
 * Complete, immutable state of a Minesweeper round.
 * Cells are stored row-major (index = row * cols + col).
 */
export interface Game {
  rows: number;
  cols: number;
  mines: number;
  cells: Cell[];
  status: Status;
  /** Index of the mine that ended the game, or -1. */
  exploded: number;
  /** Timestamp (ms) of the first reveal, or null before the game starts. */
  startedAt: number | null;
  /** Timestamp (ms) at which the game was won or lost, or null while it is running. */
  endedAt: number | null;
  /** Number of revealed cells. */
  revealed: number;
  /** Number of flagged cells. */
  flags: number;
}

/**
 * Create an empty board for a difficulty.
 *
 * All cells start covered and mine-free; mines are laid on the first reveal (see `layMines`)
 * so the first click is always safe. The mine count is clamped to `rows * cols - 1` so at
 * least one safe cell always exists.
 *
 * @param {Difficulty} difficulty - Board size and mine count.
 * @param {number} difficulty.rows - Number of rows.
 * @param {number} difficulty.cols - Number of columns.
 * @param {number} difficulty.mines - Requested number of mines.
 * @returns {Game} A fresh game in the 'ready' state.
 *
 * @example
 * const game = newGame(LEVELS.beginner);
 * console.log(game.cells.length); // 81
 */
export function newGame({ rows, cols, mines }: Difficulty): Game {
  const cells: Cell[] = Array.from({ length: rows * cols }, () => ({ mine: false, adjacent: 0, revealed: false, mark: 'none' }));
  return { rows, cols, mines: Math.min(mines, rows * cols - 1), cells, status: 'ready', exploded: -1, startedAt: null, endedAt: null, revealed: 0, flags: 0 };
}

/**
 * List the indices of the cells surrounding a cell.
 *
 * Converts the row-major index to (row, column), walks the 3×3 block around it and keeps
 * the in-bounds positions other than the cell itself. Corner cells yield 3 neighbours, edge
 * cells 5 and interior cells 8.
 *
 * @param {number} i - Row-major index of the centre cell.
 * @param {number} rows - Number of rows on the board.
 * @param {number} cols - Number of columns on the board.
 * @returns {number[]} Row-major indices of the neighbouring cells.
 *
 * @example
 * const around = neighbors(0, 3, 3);
 * console.log(around); // [1, 3, 4]
 */
export function neighbors(i: number, rows: number, cols: number): number[] {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
    }
  }
  return out;
}

/**
 * Recompute every cell's `adjacent` mine count.
 *
 * Returns new cell objects; the input array and its cells are not mutated.
 *
 * @param {Cell[]} cells - Cells with their `mine` flags set.
 * @param {number} rows - Number of rows on the board.
 * @param {number} cols - Number of columns on the board.
 * @returns {Cell[]} Copies of the cells with `adjacent` filled in.
 *
 * @example
 * const counted = withAdjacency(cells, 9, 9);
 * console.log(counted[0].adjacent); // 0..3 for a corner cell
 */
function withAdjacency(cells: Cell[], rows: number, cols: number): Cell[] {
  return cells.map((cell, i) => ({ ...cell, adjacent: neighbors(i, rows, cols).reduce((n, j) => n + (cells[j].mine ? 1 : 0), 0) }));
}

/**
 * Place the mines while keeping the clicked cell safe.
 *
 * `safe` and, when the board has enough room for every mine elsewhere, its neighbours are
 * excluded, so the first click always opens an area; on a nearly full board only `safe`
 * itself is excluded. The remaining candidates are shuffled with a partial Fisher–Yates pass,
 * so the first `mines` entries form a uniform random sample. Adjacency counts are then
 * recomputed for the whole board.
 *
 * @param {Game} game - Game whose board receives the mines (its `mines` count is used).
 * @param {number} safe - Row-major index of the cell that must stay mine-free.
 * @param {() => number} [rng=Math.random] - Random source returning values in [0, 1).
 * @returns {Game} A copy of the game with mines laid and adjacency counts filled in.
 *
 * @example
 * const game = layMines(newGame(LEVELS.expert), 0);
 * console.log(game.cells.filter((c) => c.mine).length); // 99
 */
export function layMines(game: Game, safe: number, rng: () => number = Math.random): Game {
  const { rows, cols, mines } = game;
  const total = rows * cols;
  const zone = new Set([safe, ...neighbors(safe, rows, cols)]);
  const exclude = total - zone.size >= mines ? zone : new Set([safe]);
  const candidates: number[] = [];
  for (let i = 0; i < total; i++) if (!exclude.has(i)) candidates.push(i);
  for (let k = 0; k < mines; k++) {
    const j = k + Math.floor(rng() * (candidates.length - k));
    [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
  }
  const mineSet = new Set(candidates.slice(0, mines));
  const cells = game.cells.map((cell, i) => ({ ...cell, mine: mineSet.has(i) }));
  return { ...game, cells: withAdjacency(cells, rows, cols) };
}

/**
 * Reveal a cell and flood-fill outward through zero cells.
 *
 * Works on a mutable copy of the cell array using an explicit stack. Already revealed and
 * flagged cells are skipped; question marks on revealed cells are cleared. Neighbours are
 * only expanded from safe cells with no adjacent mines, so the fill stops at the numbered
 * border of an empty region.
 *
 * @param {Cell[]} cells - Mutable cell array; revealed cells are replaced in place.
 * @param {number} start - Row-major index to reveal first.
 * @param {number} rows - Number of rows on the board.
 * @param {number} cols - Number of columns on the board.
 * @returns {number} Number of newly revealed cells.
 *
 * @example
 * const cells = game.cells.slice();
 * const added = floodReveal(cells, 0, game.rows, game.cols);
 */
function floodReveal(cells: Cell[], start: number, rows: number, cols: number): number {
  let count = 0;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const cell = cells[i];
    if (cell.revealed || cell.mark === 'flag') continue;
    cells[i] = { ...cell, revealed: true, mark: 'none' };
    count++;
    if (cell.adjacent === 0 && !cell.mine) {
      for (const j of neighbors(i, rows, cols)) if (!cells[j].revealed) stack.push(j);
    }
  }
  return count;
}

/**
 * Build the next game state after a reveal and detect a win or loss.
 *
 * A non-negative `exploded` index ends the game as lost. Otherwise, once every safe cell is
 * revealed the game is won and every mine is flagged (as in the classic game), which brings
 * the flag count to the mine count. In all other cases only the cells and reveal count change.
 *
 * @param {Game} game - State before the move.
 * @param {Cell[]} cells - Updated cell array.
 * @param {number} revealed - Total number of revealed cells after the move.
 * @param {number} now - Current timestamp (ms), stored as `endedAt` when the game ends.
 * @param {number} exploded - Index of the mine that was hit, or -1.
 * @returns {Game} The resulting game state.
 *
 * @example
 * const next = finish(game, cells, game.revealed + added, Date.now(), -1);
 * console.log(next.status); // 'playing' or 'won'
 */
function finish(game: Game, cells: Cell[], revealed: number, now: number, exploded: number): Game {
  if (exploded >= 0) return { ...game, cells, revealed, status: 'lost', exploded, endedAt: now };
  if (revealed === game.rows * game.cols - game.mines) {
    const flagged = cells.map((c) => (c.mine ? { ...c, mark: 'flag' as const } : c));
    return { ...game, cells: flagged, revealed, flags: game.mines, status: 'won', endedAt: now };
  }
  return { ...game, cells, revealed };
}

/**
 * Handle a primary click on a covered cell.
 *
 * Finished games, out-of-range indices, revealed cells and flagged cells are ignored and the
 * same game object is returned. On a 'ready' game the first reveal lays the mines (keeping the
 * clicked cell safe, see `layMines`), switches to 'playing' and records `startedAt`. Revealing
 * a mine loses the game; otherwise the cell is flood-filled and a win is detected.
 *
 * @param {Game} game - Current game state.
 * @param {number} i - Row-major index of the clicked cell.
 * @param {number} now - Current timestamp (ms), used for `startedAt` / `endedAt`.
 * @param {() => number} [rng=Math.random] - Random source used when the mines are laid.
 * @returns {Game} The next game state, or `game` itself when the click is a no-op.
 *
 * @example
 * const next = reveal(newGame(LEVELS.beginner), 40, Date.now());
 * console.log(next.status); // 'playing'
 */
export function reveal(game: Game, i: number, now: number, rng: () => number = Math.random): Game {
  if (game.status === 'won' || game.status === 'lost') return game;
  const target = game.cells[i];
  if (!target || target.revealed || target.mark === 'flag') return game;
  let g = game;
  if (g.status === 'ready') g = { ...layMines(g, i, rng), status: 'playing', startedAt: now };
  const cells = g.cells.slice();
  if (cells[i].mine) {
    cells[i] = { ...cells[i], revealed: true, mark: 'none' };
    return finish(g, cells, g.revealed, now, i);
  }
  const added = floodReveal(cells, i, g.rows, g.cols);
  return finish(g, cells, g.revealed + added, now, -1);
}

/**
 * Chord on a revealed number: reveal every unflagged neighbour at once.
 *
 * Only acts while playing, on a revealed number whose count of flagged neighbours equals its
 * mine count and that still has covered, unflagged neighbours. Each target is flood-filled;
 * any mine among them (i.e. a flag was misplaced) is revealed and the first one hit ends the
 * game as lost.
 *
 * @param {Game} game - Current game state.
 * @param {number} i - Row-major index of the revealed number cell.
 * @param {number} now - Current timestamp (ms), stored as `endedAt` when the game ends.
 * @returns {Game} The next game state, or `game` itself when chording does not apply.
 *
 * @example
 * const next = chord(game, 4, Date.now());
 * console.log(next === game); // true when the flag count does not match
 */
export function chord(game: Game, i: number, now: number): Game {
  if (game.status !== 'playing') return game;
  const cell = game.cells[i];
  if (!cell?.revealed || cell.adjacent === 0) return game;
  const around = neighbors(i, game.rows, game.cols);
  const flagged = around.filter((j) => game.cells[j].mark === 'flag').length;
  if (flagged !== cell.adjacent) return game;
  const targets = around.filter((j) => !game.cells[j].revealed && game.cells[j].mark !== 'flag');
  if (!targets.length) return game;
  const cells = game.cells.slice();
  let revealed = game.revealed;
  let exploded = -1;
  for (const j of targets) {
    if (cells[j].mine) {
      cells[j] = { ...cells[j], revealed: true, mark: 'none' };
      if (exploded < 0) exploded = j;
    } else {
      revealed += floodReveal(cells, j, game.rows, game.cols);
    }
  }
  return finish(game, cells, revealed, now, exploded);
}

/**
 * Cycle the mark on a covered cell (secondary click).
 *
 * The order is none → flag → question → none, or none → flag → none when question marks are
 * disabled. The game's flag counter is updated accordingly. Finished games, revealed cells and
 * out-of-range indices are ignored.
 *
 * @param {Game} game - Current game state.
 * @param {number} i - Row-major index of the cell to mark.
 * @param {boolean} [allowQuestion=true] - Whether the question-mark step is part of the cycle.
 * @returns {Game} The next game state, or `game` itself when the cell cannot be marked.
 *
 * @example
 * const flagged = cycleMark(game, 0);
 * console.log(flagged.cells[0].mark); // 'flag'
 */
export function cycleMark(game: Game, i: number, allowQuestion = true): Game {
  if (game.status === 'won' || game.status === 'lost') return game;
  const cell = game.cells[i];
  if (!cell || cell.revealed) return game;
  const next: Mark = cell.mark === 'none' ? 'flag' : cell.mark === 'flag' && allowQuestion ? 'question' : 'none';
  const cells = game.cells.slice();
  cells[i] = { ...cell, mark: next };
  const flags = game.flags + (next === 'flag' ? 1 : 0) - (cell.mark === 'flag' ? 1 : 0);
  return { ...game, cells, flags };
}

/**
 * Compute the value of the remaining-mines counter.
 *
 * Mines minus placed flags; it goes negative when more flags than mines are placed, like the
 * original game.
 *
 * @param {Game} game - Current game state.
 * @returns {number} Number of mines not yet accounted for by flags.
 *
 * @example
 * console.log(minesLeft(newGame(LEVELS.beginner))); // 10
 */
export function minesLeft(game: Game): number {
  return game.mines - game.flags;
}

/**
 * Check whether a cell is a revealed number that chording could act on.
 *
 * Used for the pressed-neighbour preview while the pointer is held on a number; it does not
 * check whether the flag count matches.
 *
 * @param {Game} game - Current game state.
 * @param {number} i - Row-major index of the cell.
 * @returns {boolean} True while playing when the cell is revealed and has adjacent mines.
 *
 * @example
 * const preview = canChord(game, i) ? neighbors(i, game.rows, game.cols) : [i];
 */
export function canChord(game: Game, i: number): boolean {
  const cell = game.cells[i];
  return game.status === 'playing' && !!cell?.revealed && cell.adjacent > 0;
}

/**
 * Build a game from a text layout for tests and deterministic scenarios.
 *
 * Each string is one row; '*' marks a mine and any other character a safe cell. The column
 * count comes from the first row. Adjacency is computed and the game starts in the
 * 'playing' state with nothing revealed or flagged.
 *
 * @param {string[]} layout - Rows of the board, top to bottom.
 * @param {number} [startedAt=0] - Value stored as the game's `startedAt` timestamp.
 * @returns {Game} A game in the 'playing' state with the given mines.
 *
 * @example
 * const game = fromLayout(['*.', '..']);
 * console.log(game.cells[3].adjacent); // 1
 */
export function fromLayout(layout: string[], startedAt = 0): Game {
  const rows = layout.length;
  const cols = layout[0]?.length ?? 0;
  const cells: Cell[] = [];
  for (const line of layout) for (const ch of line) cells.push({ mine: ch === '*', adjacent: 0, revealed: false, mark: 'none' });
  const mines = cells.filter((c) => c.mine).length;
  return { rows, cols, mines, cells: withAdjacency(cells, rows, cols), status: 'playing', exploded: -1, startedAt, endedAt: null, revealed: 0, flags: 0 };
}

// games/tilt/engine-internal.ts — grid geometry, rotation/compaction, and win-detection helpers
// (docs/plans/tilt.md §1, §3) for Tilt. Kept separate from engine.ts so the pure "what is a
// winning window" / "how does gravity settle a column" questions have one home, matching
// Fadeout's and Order vs Chaos's engine/engine-internal split.
//
// GRID CONVENTION (pinned once, here, since every function below depends on it): `size*size`
// cells, row-major, index = row*size + col. Row 0 is the TOP of the board; row `size-1` is the
// BOTTOM. Gravity pulls discs toward increasing row index (down the array's row axis) — a
// "lowest empty row" in a column is the row with the LARGEST index that is still null.
//
// This module is genuinely parameterized by size/winLength/tiltPeriod-adjacent geometry (size,
// winLength) rather than hardcoded to 7x7/win-4 — plan §1's "the engine is parameterized so
// variants are config, not code" applies to the geometry too, since §4's remedy menu includes a
// 6x6 board and the kill-test sweep (§5.1) may need to re-run geometry-dependent checks against
// a remedy config without a second copy of this file.

export type Disc = 0 | 1 | null;
export type Grid = readonly Disc[]; // length size*size, row-major, index = row*size + col

export type PlayerSeat = 0 | 1;

export interface Geometry {
  readonly size: number;
  readonly winLength: number;
}

export type Line = readonly number[]; // cell indices, in order, for one maximal row/col/diagonal

function idx(row: number, col: number, size: number): number {
  return row * size + col;
}

/** All maximal lines (rows, columns, both diagonal directions) of length >= winLength. */
function buildLines(geo: Geometry): Line[] {
  const { size } = geo;
  const lines: Line[] = [];
  for (let r = 0; r < size; r++) {
    lines.push(Array.from({ length: size }, (_, c) => idx(r, c, size)));
  }
  for (let c = 0; c < size; c++) {
    lines.push(Array.from({ length: size }, (_, r) => idx(r, c, size)));
  }
  // down-right diagonals, keyed by (row - col)
  for (let k = -(size - 1); k <= size - 1; k++) {
    const cells: number[] = [];
    for (let r = 0; r < size; r++) {
      const c = r - k;
      if (c >= 0 && c < size) cells.push(idx(r, c, size));
    }
    if (cells.length >= geo.winLength) lines.push(cells);
  }
  // down-left (anti) diagonals, keyed by (row + col)
  for (let k = 0; k <= 2 * (size - 1); k++) {
    const cells: number[] = [];
    for (let r = 0; r < size; r++) {
      const c = k - r;
      if (c >= 0 && c < size) cells.push(idx(r, c, size));
    }
    if (cells.length >= geo.winLength) lines.push(cells);
  }
  return lines;
}

function buildWindows(lines: readonly Line[], winLength: number): Line[] {
  const windows: Line[] = [];
  for (const line of lines) {
    for (let start = 0; start + winLength <= line.length; start++) {
      windows.push(line.slice(start, start + winLength));
    }
  }
  return windows;
}

const windowCache = new Map<string, readonly Line[]>();

/** All winning windows for a geometry, memoized per (size, winLength) pair — pure geometry,
 *  never depends on grid contents. */
export function windowsFor(geo: Geometry): readonly Line[] {
  const key = `${geo.size}:${geo.winLength}`;
  const cached = windowCache.get(key);
  if (cached) return cached;
  const windows = buildWindows(buildLines(geo), geo.winLength);
  windowCache.set(key, windows);
  return windows;
}

/** True iff `player` fills every cell of at least one winning window. */
export function hasRun(grid: Grid, geo: Geometry, player: PlayerSeat): boolean {
  for (const window of windowsFor(geo)) {
    let mono = true;
    for (const cell of window) {
      if (grid[cell] !== player) {
        mono = false;
        break;
      }
    }
    if (mono) return true;
  }
  return false;
}

export function discCount(grid: Grid): number {
  let n = 0;
  for (const cell of grid) if (cell !== null) n++;
  return n;
}

/** Whose turn it is next, derived purely from disc count (docs/plans/tilt.md §2.1): seat 0
 *  (P1) plays odd plies (1st, 3rd, ...), so seat 0 moves whenever the CURRENT disc count is
 *  even (0 discs placed so far -> ply 1 is seat 0's; 1 disc placed -> ply 2 is seat 1's; ...). */
export function toMoveOf(grid: Grid): PlayerSeat {
  return discCount(grid) % 2 === 0 ? 0 : 1;
}

/** The seat that placed the MOST RECENT disc (i.e., played the ply that produced this exact
 *  grid) — purely arithmetic from disc count, no stored history needed. Used only by the
 *  `doubleLine: "mover-wins"` variant (docs/plans/tilt.md §1.4/§4 lever 3's sibling), which
 *  needs to know who just moved without keeping any path-dependent field in state (§2.1's
 *  binding condition). Meaningless (never consulted) on the empty-grid state. */
export function lastMoverOf(grid: Grid): PlayerSeat {
  const n = discCount(grid);
  const priorCount = n - 1; // discCount just BEFORE the most recent placement
  return priorCount % 2 === 0 ? 0 : 1;
}

/** The lowest (closest-to-bottom) empty row in `col`, or -1 if the column is full. Correct
 *  under the standing invariant that every grid this engine hands out is bottom-packed (no
 *  floating discs) except transiently mid-rotation, which is why this is a simple bottom-up
 *  scan rather than a search for "the first gap". */
export function lowestEmptyRow(grid: Grid, geo: Geometry, col: number): number {
  for (let r = geo.size - 1; r >= 0; r--) {
    if (grid[idx(r, col, geo.size)] === null) return r;
  }
  return -1;
}

export function columnHasSpace(grid: Grid, geo: Geometry, col: number): boolean {
  return lowestEmptyRow(grid, geo, col) !== -1;
}

/**
 * 90-degree rotation of the disc PATTERN — a rigid relabeling of cell positions, never a
 * gravity re-settle by itself (docs/plans/tilt.md §1.2: "90 degree [direction], rigid rotation
 * of the disc pattern, then each column compacts downward"). `direction` "cw" is the shipped
 * config; "ccw" exists only to support the `tiltDirection: "alternating"` lever (§1's config
 * type), which needs both.
 *
 * Standard rotation formulas for a size x size grid, row-major, row 0 = top:
 *   CW:  new[c][size-1-r] = old[r][c]
 *   CCW: new[size-1-c][r] = old[r][c]
 */
/** Where a single cell index lands under the rigid rotation alone (no compaction). Exposed
 *  (not just inlined in `rotate`) because `heuristic.ts`'s tilt-survival discount needs to
 *  track individual threat cells through the same transform the real tilt uses, rather than
 *  re-deriving the formula a second time. */
export function rotateCell(cell: number, geo: Geometry, direction: "cw" | "ccw"): number {
  const { size } = geo;
  const r = Math.floor(cell / size);
  const c = cell % size;
  const [nr, nc] = direction === "cw" ? [c, size - 1 - r] : [size - 1 - c, r];
  return idx(nr, nc, size);
}

export function rotate(grid: Grid, geo: Geometry, direction: "cw" | "ccw"): Grid {
  const { size } = geo;
  const out = new Array<Disc>(size * size).fill(null);
  for (let cell = 0; cell < size * size; cell++) {
    const value = grid[cell]!;
    if (value === null) continue;
    out[rotateCell(cell, geo, direction)] = value;
  }
  return out;
}

export interface DiscMove {
  readonly player: PlayerSeat;
  readonly from: number; // cell index in the NEW (post-rotation) frame, before compaction
  readonly to: number; // cell index in the NEW (post-rotation) frame, after compaction
}

export interface CompactResult {
  readonly grid: Grid;
  /** One entry per DISPLACED disc, in column-major order (docs/plans/tilt.md §3: "one per
   *  displaced disc, listed in a deterministic order (column-major in the new frame)") — a
   *  disc already resting at the bottom of its column before compaction gets no entry at all,
   *  which is what makes a no-op tilt's `moved` list legitimately `[]` (§1.5). Within a column,
   *  entries are emitted top-to-bottom by their PRE-compaction row (an order the plan does not
   *  pin beyond "column-major", chosen for determinism and because it matches the order
   *  discs would visually "fall" in). */
  readonly moved: readonly DiscMove[];
  /** EVERY occupied cell's pre-compaction cell index -> its post-compaction cell index,
   *  including discs that did not move at all (mapped to themselves). Unlike `moved`, this is
   *  total over every disc — used by `heuristic.ts` to track a specific threat's cells through
   *  a hypothetical tilt (survival discount), where "didn't move" is exactly as informative as
   *  "moved to X". Not used by `apply()`'s own effect-building, which only needs `moved`. */
  readonly landedAt: ReadonlyMap<number, number>;
}

/**
 * Gravity re-settle: every column independently compacts its discs toward the bottom, with
 * relative vertical order preserved among that column's own discs (docs/plans/tilt.md §1.2) —
 * i.e., a stable partition of each column into (nulls..., discs-in-original-relative-order).
 * One pass reaches quiescence (49 cells on the shipped board; no disc can ever collide with or
 * pass another, since compaction only ever removes gaps, never reorders).
 */
export function compactColumns(grid: Grid, geo: Geometry): CompactResult {
  const { size } = geo;
  const out = new Array<Disc>(size * size).fill(null);
  const moved: DiscMove[] = [];
  const landedAt = new Map<number, number>();
  for (let c = 0; c < size; c++) {
    const filled: { value: 0 | 1; oldRow: number }[] = [];
    for (let r = 0; r < size; r++) {
      const value = grid[idx(r, c, size)]!;
      if (value !== null) filled.push({ value, oldRow: r });
    }
    const startRow = size - filled.length;
    filled.forEach((entry, i) => {
      const newRow = startRow + i;
      const oldCell = idx(entry.oldRow, c, size);
      const newCell = idx(newRow, c, size);
      out[newCell] = entry.value;
      landedAt.set(oldCell, newCell);
      if (newRow !== entry.oldRow) {
        moved.push({ player: entry.value, from: oldCell, to: newCell });
      }
    });
  }
  return { grid: out, moved, landedAt };
}

/** True iff any column contains a "floating" disc — an occupied cell with an empty cell
 *  somewhere below it in the same column (i.e., the column is not a contiguous bottom-packed
 *  block). Used only by `decode`'s C4 structural-validity check; every grid this engine's own
 *  `apply()` ever produces already satisfies "not floating" by construction. */
export function hasFloatingDisc(grid: Grid, geo: Geometry): boolean {
  const { size } = geo;
  for (let c = 0; c < size; c++) {
    let seenOccupied = false;
    // Scan top (r=0) to bottom (r=size-1): a valid bottom-packed column is nulls-then-discs,
    // transitioning at most once. Seeing an EMPTY cell after an OCCUPIED one (i.e., below it,
    // since increasing r moves toward the bottom) means that occupied cell is floating above
    // space it should have fallen through.
    for (let r = 0; r < size; r++) {
      const value = grid[idx(r, c, size)];
      if (value !== null) {
        seenOccupied = true;
      } else if (seenOccupied) {
        return true;
      }
    }
  }
  return false;
}

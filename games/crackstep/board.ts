// games/crackstep/board.ts — pure grid math, board generation, and the shared unvisited/
// reachability computations engine.ts (heuristic) and solver.ts (the admissible IDA* cost
// estimate) both need (docs/plans/crackstep.md §1.1/§3.1/§3.2/§6.3). No GameEngine dependency
// here — just grid math — so solver.ts can import it without a circular dependency on engine.ts.

import type { Rng } from "@twist-arcade/engine";

export type TileKind = "crumble" | "stone" | "hole";

export interface CrackstepBoard {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileKind[]; // row-major
  readonly start: number; // always a "crumble" tile (plan §1.1)
}

const DIMENSION_CHOICES = [5, 6] as const;
const MIN_HOLE_FRACTION = 0.1;
const MAX_HOLE_FRACTION = 0.3;
const MAX_STONES = 5;
// `setup()` must be TOTAL — this is a generous ceiling for a 25-36 cell grid under weak
// constraints (see generateBoard's own doc comment for why exhaustion is not expected).
const MAX_GENERATION_ATTEMPTS = 5000;

export function neighbors(cell: number, width: number, height: number): number[] {
  const row = Math.floor(cell / width);
  const col = cell % width;
  const out: number[] = [];
  if (row > 0) out.push(cell - width);
  if (row < height - 1) out.push(cell + width);
  if (col > 0) out.push(cell - 1);
  if (col < width - 1) out.push(cell + 1);
  return out;
}

/** BFS/DFS reachability: every cell reachable from `start` by repeatedly stepping to an
 *  orthogonal neighbor for which `passable(cell)` holds. Returns the empty set if `start`
 *  itself is not passable. */
export function reachableSet(
  start: number,
  width: number,
  height: number,
  passable: (cell: number) => boolean
): Set<number> {
  const seen = new Set<number>();
  if (!passable(start)) return seen;
  const stack = [start];
  seen.add(start);
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const n of neighbors(cur, width, height)) {
      if (passable(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

function isConnected(width: number, height: number, walkable: ReadonlySet<number>): boolean {
  if (walkable.size === 0) return false;
  const first = [...walkable][0]!;
  const reached = reachableSet(first, width, height, (c) => walkable.has(c));
  return reached.size === walkable.size;
}

/** Generator pre-rejection (plan §3.1 step 4, 0-stone boards only): a full-coverage path
 *  alternates checkerboard colors, so if the two color-class sizes differ by >=2, no such path
 *  can exist from ANY start on this walkable set — reject before ever invoking the solver.
 *  Stone tiles break this argument (a revisit can change color freely), so it applies only when
 *  the board has no stone at all — callers gate that themselves. */
export function parityRejects(width: number, walkable: ReadonlySet<number>): boolean {
  let colorA = 0;
  let colorB = 0;
  for (const cell of walkable) {
    const row = Math.floor(cell / width);
    const col = cell % width;
    if ((row + col) % 2 === 0) colorA += 1;
    else colorB += 1;
  }
  return Math.abs(colorA - colorB) >= 2;
}

/** Generator pre-rejection (plan §3.1 step 4): more than one non-start, non-stone crumbling
 *  tile of walkable-degree 1 means at most one of them can ever be the run's single final tile
 *  — the board is unsolvable regardless of move ordering, for any solver. */
export function tooManyDeadEnds(
  width: number,
  height: number,
  walkable: ReadonlySet<number>,
  stones: ReadonlySet<number>,
  start: number
): boolean {
  let deadEnds = 0;
  for (const cell of walkable) {
    if (cell === start || stones.has(cell)) continue;
    const degree = neighbors(cell, width, height).filter((n) => walkable.has(n)).length;
    if (degree <= 1) {
      deadEnds += 1;
      if (deadEnds > 1) return true;
    }
  }
  return false;
}

/**
 * Generates one Crackstep board (plan §3.1). Internally retries — drawing MORE randomness from
 * the SAME rng stream, never re-seeding — until every generator-enforced structural invariant
 * holds: the walkable set (non-hole cells) is orthogonally connected, no two stone tiles are
 * orthogonally adjacent (§1.5's termination proof depends on this), the start tile is a
 * crumbling tile, and — the cheap pre-solver rejections — the parity check (0-stone boards) and
 * the dead-end count both pass.
 *
 * `setup()` must be TOTAL, so this is capped at MAX_GENERATION_ATTEMPTS; not expected to be hit
 * in practice at this board size (25-36 cells, weak constraints — see engine.test.ts's
 * generation-always-succeeds fixture, which exercises 500 distinct seeds with zero exhaustions).
 * If it ever were exhausted, the last CONNECTED, stone-non-adjacent candidate (which may still
 * fail parity/dead-end — a worse, but never structurally broken, board) is returned rather than
 * throwing: `setup()` must never fail.
 */
export function generateBoard(rng: Rng): CrackstepBoard {
  let bestEffort: CrackstepBoard | undefined;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const width = DIMENSION_CHOICES[rng.int(DIMENSION_CHOICES.length)]!;
    const height = DIMENSION_CHOICES[rng.int(DIMENSION_CHOICES.length)]!;
    const total = width * height;

    const holeFraction = MIN_HOLE_FRACTION + rng.next() * (MAX_HOLE_FRACTION - MIN_HOLE_FRACTION);
    const holeCount = Math.min(total - 1, Math.max(1, Math.round(total * holeFraction)));
    const shuffledCells = rng.shuffle(Array.from({ length: total }, (_, i) => i));
    const holes = new Set(shuffledCells.slice(0, holeCount));
    const walkable = new Set(shuffledCells.slice(holeCount));

    if (!isConnected(width, height, walkable)) continue;

    // Stone placement: sample a target count 0..MAX_STONES, then greedily place stones from a
    // shuffled walkable order, skipping any candidate orthogonally adjacent to an already-placed
    // stone (the generator's structural termination device, §1.5) — never backtracks, so the
    // achieved count can land below the target when the board is dense with earlier picks; that
    // is fine, 0 stones is itself a valid (if parity-checked) board.
    const stoneTarget = rng.int(MAX_STONES + 1);
    const stones = new Set<number>();
    const walkableShuffled = rng.shuffle([...walkable]);
    for (const cell of walkableShuffled) {
      if (stones.size >= stoneTarget) break;
      const adjacentToStone = neighbors(cell, width, height).some((n) => stones.has(n));
      if (!adjacentToStone) stones.add(cell);
    }

    const crumblingCells = [...walkable].filter((c) => !stones.has(c));
    if (crumblingCells.length === 0) continue; // no legal start candidate at all — redraw
    const start = crumblingCells[rng.int(crumblingCells.length)]!;

    const tilesOf = (): TileKind[] =>
      Array.from({ length: total }, (_, i) => (holes.has(i) ? "hole" : stones.has(i) ? "stone" : "crumble"));

    if (!bestEffort) {
      // First connected, stone-legal candidate — kept as the total-function fallback even if
      // the cheaper triviality/dead-end checks below never succeed within budget.
      bestEffort = { width, height, tiles: tilesOf(), start };
    }

    if (stones.size === 0 && parityRejects(width, walkable)) continue;
    if (tooManyDeadEnds(width, height, walkable, stones, start)) continue;

    return { width, height, tiles: tilesOf(), start };
  }

  // Exhausted every attempt without a fully-filtered candidate (not expected — see doc comment
  // above). `bestEffort` is guaranteed set unless literally every one of MAX_GENERATION_ATTEMPTS
  // draws failed CONNECTIVITY too, which is vanishingly unlikely at this grid size; if that ever
  // happens there truly is no board to return, and setup() cannot fabricate one honestly.
  if (bestEffort) return bestEffort;
  throw new Error(
    `generateBoard: exhausted ${MAX_GENERATION_ATTEMPTS} attempts without ever drawing a connected walkable set — this should be unreachable at 5x5/6x6 hole fractions of 10-30%.`
  );
}

// ---------------------------------------------------------------------------------------
// Shared state-shaped computations (engine.ts's heuristic() and solver.ts's admissible IDA*
// cost estimate both need these — kept here so the two never drift apart, ux-lens-style).
// ---------------------------------------------------------------------------------------

export function countUnvisited(tiles: readonly TileKind[], visited: readonly boolean[]): number {
  let n = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== "hole" && !visited[i]) n += 1;
  }
  return n;
}

/** A cell is currently "intact" (crossable, whether or not it has ever been visited) iff it is
 *  not a hole and has not crumbled. Movement legality and reachability both depend on exactly
 *  this — NOT on `visited` (an already-visited stone tile is still intact and re-crossable). */
export function isIntact(tiles: readonly TileKind[], crumbled: readonly boolean[], cell: number): boolean {
  return tiles[cell] !== "hole" && !crumbled[cell];
}

/** Unvisited cells NOT reachable from `pos` over currently-intact tiles — solver prune 1 /
 *  heuristic penalty term (plan §3.2/§6.3). */
export function unreachableUnvisitedCount(
  tiles: readonly TileKind[],
  crumbled: readonly boolean[],
  visited: readonly boolean[],
  width: number,
  height: number,
  pos: number
): number {
  const reachable = reachableSet(pos, width, height, (c) => isIntact(tiles, crumbled, c));
  let unreachable = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== "hole" && !visited[i] && !reachable.has(i)) unreachable += 1;
  }
  return unreachable;
}

/** Count of unvisited, non-current-position "crumble" (never "stone") tiles whose CURRENT
 *  intact-degree is <=1 — solver prune 2 (plan §3.2): at most one such pocket can ever be the
 *  run's single final tile, so 2+ of them proves the state is a dead branch. */
export function deadEndReservationCount(
  tiles: readonly TileKind[],
  crumbled: readonly boolean[],
  visited: readonly boolean[],
  width: number,
  height: number,
  pos: number
): number {
  let deadEnds = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== "crumble" || visited[i] || i === pos) continue;
    const degree = neighbors(i, width, height).filter((n) => isIntact(tiles, crumbled, n)).length;
    if (degree <= 1) deadEnds += 1;
  }
  return deadEnds;
}

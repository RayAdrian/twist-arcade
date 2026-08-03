// games/mine-run/heuristic.ts — Greedy's brain (docs/plans/mine-run.md §4.5,
// platform-corrections.md C6).
//
// Before this file existed, `greedyOnlyPolicy`/`beam`'s shared candidate ranking
// (packages/bots/src/search-utils.ts's `rankingValueOf`) fell back to bare `engine.score()`
// (== `banked`) for Mine Run — blind to the live streak, the entire quantity a press-your-luck
// decision turns on (C6's finding). `heuristic()` fixes that: it values `banked` PLUS the live
// streak's continuation value, per mine-run.md §4.5's three-step spec:
//   (1) mark forced mines/forced-safe cells to a single-point fixpoint;
//   (2) per-cell risk = max over adjacent constraints of remaining-mines/unrevealed-count,
//       background rate off-frontier;
//   (3) 1-ply EV: a proven-safe reveal ranks above (bank vs best-risk reveal by immediate
//       expected points).
//
// Deliberately weaker than safeMove's full CSP (csp.ts's `analyzeFrontier`): no combinatorial
// enumeration of consistent mine layouts, no global mine-count coupling across components —
// just direct single-point propagation. Greedy is the "notices the obvious" rung; the gap
// between this and safeMove's full deduction is part of what separates Strong/Always-Safe
// from Greedy (mine-run.md §4.5's own framing).
//
// View-honest by construction, even though its parameter is a full `MineRunState`: it reads
// `state.mines` ONLY to compute the "n" adjacency count of an ALREADY-REVEALED cell — exactly
// the number a real player already sees in their own view, identical across every hidden world
// consistent with that view (this is what makes `test/heuristic.test.ts`'s resampled-world
// check pass) — never to decide anything about an UNREVEALED cell directly. Every fact about
// an unrevealed cell here is derived purely from single-point propagation over revealed
// numbers, the same discipline `csp.ts`'s module doc holds itself to.

import type { PlayerId } from "@twist-arcade/engine";
import type { MineRunState } from "./engine";
import { countAdjacentMines, neighbors } from "./board";

interface Dims {
  readonly width: number;
  readonly height: number;
  readonly totalCells: number;
}

interface WorkingConstraint {
  cells: number[];
  required: number;
}

interface FixpointResult {
  /** True iff at least one unrevealed cell is safe in EVERY consistent assignment. */
  readonly provablySafe: boolean;
  /** The lowest deduced P(mine) available among the next candidate reveals (frontier cells
   *  resolved by the fixpoint, plus the uniform background rate for off-frontier cells). */
  readonly bestRisk: number;
}

/** Single-point fixpoint (mine-run.md §4.5, steps 1-2). Repeatedly resolves any constraint
 *  whose required-mine count is 0 (every remaining cell is safe) or equals its remaining cell
 *  count (every remaining cell is a mine), propagating each resolution into every other
 *  constraint sharing a cell, until nothing more resolves. Unlike `csp.ts`'s `analyzeFrontier`,
 *  this never enumerates joint assignments and never couples components together — it can
 *  (correctly, by design) miss a deduction that requires reasoning about several constraints
 *  jointly, which is exactly the gap the plan calls out between Greedy and Strong/Always-Safe. */
function singlePointFixpoint(state: MineRunState, dims: Dims): FixpointResult {
  const minesSet = new Set(state.mines);
  const revealedSet = new Set(state.revealed);
  const explodedSet = new Set(state.exploded);

  const provablySafe = new Set<number>();
  const provablyMine = new Set<number>(explodedSet);

  const constraints: WorkingConstraint[] = [];
  const frontier = new Set<number>();
  for (const c of revealedSet) {
    if (explodedSet.has(c)) continue; // an exploded cell carries no usable "n" clue
    const unrevealed = neighbors(c, dims.width, dims.height).filter((nb) => !revealedSet.has(nb));
    if (unrevealed.length === 0) continue;
    const n = countAdjacentMines(c, minesSet, dims.width, dims.height);
    constraints.push({ cells: unrevealed, required: n });
    for (const nb of unrevealed) frontier.add(nb);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const constraint of constraints) {
      if (constraint.cells.length === 0) continue;
      if (constraint.required <= 0) {
        for (const cell of constraint.cells) {
          if (!provablySafe.has(cell)) {
            provablySafe.add(cell);
            changed = true;
          }
        }
        constraint.cells = [];
      } else if (constraint.required >= constraint.cells.length) {
        for (const cell of constraint.cells) {
          if (!provablyMine.has(cell)) {
            provablyMine.add(cell);
            changed = true;
          }
        }
        constraint.cells = [];
      }
    }
    if (!changed) break;
    for (const constraint of constraints) {
      if (constraint.cells.length === 0) continue;
      const next: number[] = [];
      for (const cell of constraint.cells) {
        if (provablySafe.has(cell)) continue;
        if (provablyMine.has(cell)) {
          constraint.required -= 1;
          continue;
        }
        next.push(cell);
      }
      constraint.cells = next;
    }
  }

  let bestFrontierRisk = Number.POSITIVE_INFINITY;
  for (const constraint of constraints) {
    if (constraint.cells.length === 0) continue;
    const r = Math.max(0, constraint.required) / constraint.cells.length;
    if (r < bestFrontierRisk) bestFrontierRisk = r;
  }

  const totalUnrevealed = dims.totalCells - revealedSet.size;
  const resolvedUnrevealed = provablySafe.size + (provablyMine.size - explodedSet.size);
  const backgroundCells = totalUnrevealed - frontier.size - resolvedUnrevealed;
  const remainingMines = Math.max(0, state.mines.length - provablyMine.size);
  const backgroundRate = backgroundCells > 0 ? remainingMines / backgroundCells : 0;

  const isProvablySafe = provablySafe.size > 0;
  const bestRisk = isProvablySafe ? 0 : Math.min(bestFrontierRisk, backgroundRate);
  return { provablySafe: isProvablySafe, bestRisk };
}

/**
 * Builds Mine Run's `engine.heuristic` (mine-run.md §4.5). `width`/`height` are captured by
 * closure — exactly how `engine.ts`'s own `score`/`playerView` are wired per board
 * configuration — so `createMineRun({ width, height, ... })` can wire a heuristic sized to
 * itself rather than hardcoding the launch board's dimensions.
 */
export function createMineRunHeuristic(
  width: number,
  height: number
): (state: MineRunState, player: PlayerId) => number {
  const totalCells = width * height;
  const dims: Dims = { width, height, totalCells };

  return function mineRunHeuristic(state: MineRunState, _player: PlayerId): number {
    if (state.revealsLeft <= 0) return state.banked; // terminal — nothing left to weigh

    const { provablySafe, bestRisk } = singlePointFixpoint(state, dims);
    const bankValue = state.banked + state.streakValue;
    const gain = state.streakLen + 1; // triangular next increment (playerView's own `nextGain`)

    if (provablySafe) {
      // (3): a proven-safe reveal ranks above banking — no risk to discount, and it strictly
      // grows the streak beyond what banking now would lock in.
      return bankValue + gain;
    }
    // (3): bank vs. the best-risk reveal's immediate expected points.
    const revealEV = state.banked + (1 - bestRisk) * (state.streakValue + gain);
    return Math.max(bankValue, revealEV);
  };
}

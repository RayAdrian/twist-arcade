// games/crackstep/solver.ts — the exact solver `harness certify`/`harness calibrate` need
// (docs/plans/crackstep.md §3.2). Composes the harness's generic `idaStarSolver(h)` building
// block (M3d) with an ADMISSIBLE heuristic that also carries Crackstep's two prunes for free.
//
// `encode()` IS a valid dedup/position key here (see engine.ts's module header and
// platform-corrections.md C3) — Crackstep positions can never repeat — so idaStarSolver's own
// within-iteration encode-dedup is sound with no bespoke positionKey() needed, unlike Fadeout.
//
// Why idaStarSolver (not the simpler dfsSolver) is the right building block for THIS puzzle:
// the plain BFS `dfsSolver` building block would enumerate every distinct (pos, visited-subset)
// reachable node with no guidance at all — on a coverage/Hamiltonian-path problem that blows up
// combinatorially even at 25-36 tiles. IDA* with a TIGHT admissible heuristic converges in very
// few threshold iterations instead (plan §3.2's four compounding reasons: small instances, a
// tight heuristic, an acyclic state graph making the within-iteration dedup effective, and the
// two prunes below killing doomed branches within one node of the fatal move).

import type { SoloSolver } from "@twist-arcade/game-spec";
// From the harness's "./solver" subpath, NOT the package root ("@twist-arcade/harness"): the
// root barrel also statically imports certify.ts, which reads real files via node:fs/promises
// at module scope. This module is loaded ONLY via games/registry.ts's `loadSolver()` (itself a
// dynamic import()) — but a client-reachable dynamic import still needs its target chunk to be
// BUILDABLE for the browser, and a chunk that transitively reaches node:fs/promises is not,
// regardless of whether the import is static or dynamic or whether `loadSolver()` is ever
// actually called at runtime. Importing the root barrel here 500'd `next dev`'s `/play/
// crackstep` outright (`UnhandledSchemeError: node:fs/promises`) until this was narrowed to the
// browser-safe subpath — see generic-solo.ts's own module doc for the full story.
import { idaStarSolver, type SoloHeuristic } from "@twist-arcade/harness/solver";
import {
  countUnvisited,
  deadEndReservationCount,
  unreachableUnvisitedCount,
} from "./board";
import type { CrackstepMove, CrackstepState } from "./engine";

/**
 * Admissible cost-to-go estimate: `h = number of unvisited tiles` (plan §3.2) — each move visits
 * at most one new tile, so this never overestimates the true remaining move count, and it is
 * TIGHT (the gap to true cost is exactly the run's stone-detour overhead, small on band seeds).
 *
 * Carries the plan's two solver prunes for free, without touching idaStarSolver's generic code
 * at all: a dead branch's TRUE remaining cost is infinite, so returning `Infinity` here is
 * trivially still an admissible (never-an-overestimate) bound, and `f = g + Infinity` always
 * exceeds IDA*'s current threshold — an immediate cutoff.
 *   1. Reachability: an unvisited tile unreachable from `pos` over intact tiles proves the state
 *      is a dead branch.
 *   2. Dead-end reservation: >=2 unvisited, non-current-position "crumble" tiles of intact-
 *      degree <=1 — at most one such pocket can ever be the run's single final tile.
 */
export const crackstepSoloHeuristic: SoloHeuristic<CrackstepState> = (state) => {
  const unvisited = countUnvisited(state.tiles, state.visited);
  if (unvisited === 0) return 0;

  const unreachable = unreachableUnvisitedCount(
    state.tiles,
    state.crumbled,
    state.visited,
    state.width,
    state.height,
    state.pos
  );
  if (unreachable > 0) return Number.POSITIVE_INFINITY; // prune 1

  const deadEnds = deadEndReservationCount(state.tiles, state.crumbled, state.visited, state.width, state.height, state.pos);
  if (deadEnds > 1) return Number.POSITIVE_INFINITY; // prune 2

  return unvisited;
};

export const solver: SoloSolver<CrackstepState, CrackstepMove> = idaStarSolver<CrackstepState, CrackstepMove>(
  crackstepSoloHeuristic
);

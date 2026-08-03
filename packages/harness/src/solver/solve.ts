// packages/harness/src/solver/solve.ts — composes reach() + retrograde() into a root game
// value and a per-opening value table (plan §7.6). This is `pnpm harness solve <gameId>`'s
// implementation.
//
// C3 CAVEAT (platform-corrections.md; the fuller version lives in ./types.ts's module doc —
// read that first if this is the first file you're looking at): `solveTwoPlayerGame` is NOT
// generic over every 2-player game under the state-space ceiling. It hashes on
// `engine.encode(S)` (via reach()) as the position key, deduplicating the reachability graph
// on that hash. That is sound ONLY when `encode(S)` is a valid position key — i.e. when two
// states with the same `encode()` output are always legally interchangeable going forward.
// Under superko (or any repetition rule whose legality depends on the PATH taken to reach a
// position, not just the position itself), that assumption is false: `history` legitimately
// lives in state, so `encode(S)` is NOT a position key there, and deduplicating on it would
// silently conflate genuinely different game states into a wrong solve.
//
// THE TEST FOR A FUTURE CALLER: if legality or outcome depends on the path taken rather than
// the position reached, `encode` is not a position key for this function — compose `reach()`
// and `retrograde()` (both exported individually from this package) locally over your OWN
// sound position key instead of calling `solveTwoPlayerGame` / `harness solve` directly.
// Fadeout (superko) is that pattern; Crackstep (positions can never repeat at all) is the
// opposite — its `encode` is sound and this function works on it directly.

import type { GameEngine, Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import { reach, type ReachNode, type ReachOptions } from "./reach";
import { retrograde, type RetrogradeResult } from "./retrograde";
import { assertSolvablePreconditions, flipValue, UnsupportedGameError, type PositionValue } from "./types";

export interface OpeningValue {
  move: Json;
  /** Value of playing this opening, from the perspective of the player who plays it (i.e. the
   *  ROOT's mover — never re-perspectived per opening). "win" always means "the player who
   *  made this opening move wins with optimal play from both sides afterward". */
  value: PositionValue;
}

export interface SolveResult {
  reachableStates: number;
  /** The root position's value, from the perspective of whichever player is `active()` at
   *  `engine.setup()`. */
  rootValue: PositionValue;
  /** Every legal move at the root, each valued from the SAME root-mover perspective as
   *  `rootValue` (order matches `engine.legalMoves(root, rootMover)`, i.e. `reach()`'s edge
   *  order at the root node). Feeds pie-rule / opening-fairness decisions (plan §7.6). */
  openings: OpeningValue[];
}

/** `child`'s outcome as seen by `mover` — the same "outcome of an edge" computation
 *  retrograde()'s internal worklist uses, but exposed here at the granularity of "one root
 *  opening" rather than folded into the fixed-point loop. Terminal "won": direct from status.
 *  Any other terminal (draw, or a disallowed 2P `lost`/`scored` defensively): undetermined ->
 *  residue "draw", matching retrograde's own convention. Ongoing: the child's OWN mover-
 *  relative value, flipped via `flipValue` only when a different player is to move next (never
 *  called with "draw" — see flipValue's own doc). */
function outcomeForMover<S extends WithEffects>(
  mover: PlayerId,
  child: ReachNode<S>,
  result: RetrogradeResult
): PositionValue {
  if (child.status.kind === "won") {
    return child.status.winner === mover ? "win" : "loss";
  }
  if (child.status.kind !== "ongoing" || child.mover === undefined) {
    return "draw";
  }
  const value = result.valueAt(child.hash);
  if (value === "draw") return "draw";
  return child.mover === mover ? value : flipValue(value);
}

export function solveTwoPlayerGame<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ReachOptions = {}
): SolveResult {
  assertSolvablePreconditions(engine.meta);
  const graph = reach(engine, opts);
  const result = retrograde(engine, graph);

  const root = graph.nodes.get(graph.initialHash)!;
  if (root.status.kind !== "ongoing" || root.mover === undefined) {
    throw new UnsupportedGameError(
      `engine "${engine.meta.id}": the initial (setup) position is already terminal — there is ` +
        "nothing for solveTwoPlayerGame to solve."
    );
  }
  const rootMover = root.mover;

  const openings: OpeningValue[] = root.moves.map((edge) => {
    const child = graph.nodes.get(edge.toHash)!;
    return { move: edge.move, value: outcomeForMover(rootMover, child, result) };
  });

  return {
    reachableStates: graph.nodes.size,
    rootValue: result.valueAt(graph.initialHash),
    openings,
  };
}

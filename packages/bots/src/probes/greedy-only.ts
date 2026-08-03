// packages/bots/src/probes/greedy-only.ts — generic degeneracy probe (plan §6/§7.4):
// "Greedy-Only" — a pure 1-ply hill-climb on score()/heuristic(), with NO look-ahead beyond
// the immediate result of each candidate move (no win/block reasoning like rushPolicy, no
// rollout estimation like stall/suicide — just "what does the very next position look like").
// Named the "dominant-strategy probe" in the harness design gate (§7.4): if Greedy-Only scores
// within ~10% of the Strong agent, one visible, unsophisticated policy is effectively the
// whole game — search adds nothing, so there is no depth to speak of.
//
// Candidate ranking is `../search-utils.ts`'s shared `rankingValueOf` (platform-corrections.md
// C6): prefers heuristic() over score() when both exist — score() is contractually pinned to
// "however much is already realized" (it must equal a scored terminal's `scores[0]`), so a
// probe that preferred it would be blind to unrealized/potential progress (mine-run.md §4.4/
// §4.5's press-your-luck streak being the motivating case). Requires at least one of
// score()/heuristic() — there is nothing to rank candidates by otherwise. This used to be a
// locally-duplicated `evaluate()` with the OPPOSITE (score-first) priority — the exact
// blindness C6 found — folded into the shared helper instead of drifting a second copy.

import type { Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "../policy";
import { rankingValueOf } from "../search-utils";

export class GreedyOnlyUnsupportedGameError extends Error {
  constructor(gameId: string) {
    super(
      `greedyOnlyPolicy: engine "${gameId}" implements neither score() nor heuristic() — ` +
        "greedy-only has nothing to rank candidate moves by."
    );
    this.name = "GreedyOnlyUnsupportedGameError";
  }
}

export function greedyOnlyPolicy<S extends WithEffects, M extends Json>(): Policy<S, M> {
  return {
    chooseMove({ engine, state, player, rng, clock }) {
      const start = clock.now();
      if (!engine.score && !engine.heuristic) {
        throw new GreedyOnlyUnsupportedGameError(engine.meta.id);
      }
      const status = engine.status(state);
      if (status.kind !== "ongoing") {
        throw new Error("greedyOnlyPolicy: chooseMove called on a terminal state");
      }
      const legal = engine.legalMoves(state, player as PlayerId);
      if (legal.length === 0) {
        throw new Error(`greedyOnlyPolicy: player ${String(player)} has no legal moves`);
      }

      let bestMove: M = legal[0]!;
      let bestValue = Number.NEGATIVE_INFINITY;
      for (const move of legal) {
        const next = engine.apply(state, new Map([[player, move]]), rng);
        const value = rankingValueOf(engine, engine.status(next), next, player);
        if (value > bestValue) {
          bestValue = value;
          bestMove = move;
        }
      }

      return {
        move: bestMove,
        stats: { elapsedMs: clock.now() - start, rollouts: legal.length, rootValue: bestValue },
      };
    },
  };
}

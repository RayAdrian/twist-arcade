// packages/bots/src/random.ts — RandomPolicy: uniform over legalMoves (plan §6).

import type { Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "./policy";

/** Uniform-random policy: draws `legal[rng.int(legal.length)]`. Trivial, but useful as the
 *  baseline every harness ratio (Strong/Random) is measured against, and as the fallback
 *  rollout policy other search algorithms in this package reuse for playouts beyond the tree. */
export function randomPolicy<S extends WithEffects, M extends Json>(): Policy<S, M> {
  return {
    chooseMove({ engine, state, player, rng, clock }) {
      const start = clock.now();
      const legal = engine.legalMoves(state, player as PlayerId);
      if (legal.length === 0) {
        throw new Error(
          `randomPolicy: no legal move available for player ${String(player)} — chooseMove ` +
            "must only be called for a player active() lists while status is ongoing."
        );
      }
      const move = legal[rng.int(legal.length)]!;
      return { move, stats: { elapsedMs: clock.now() - start, rollouts: 1 } };
    },
  };
}

// packages/bots/src/probes/greedy-only.ts — generic degeneracy probe (plan §6/§7.4):
// "Greedy-Only" — a pure 1-ply hill-climb on score()/heuristic(), with NO look-ahead beyond
// the immediate result of each candidate move (no win/block reasoning like rushPolicy, no
// rollout estimation like stall/suicide — just "what does the very next position look like").
// Named the "dominant-strategy probe" in the harness design gate (§7.4): if Greedy-Only scores
// within ~10% of the Strong agent, one visible, unsophisticated policy is effectively the
// whole game — search adds nothing, so there is no depth to speak of.
//
// Prefers score() over heuristic() when both exist (score() is the game's own notion of
// "how well am I doing", the natural ranking for a solo score-chase; heuristic() is the
// fallback for 2P games that have no score()). Requires at least one — there is nothing to
// rank candidates by otherwise.

import type { GameEngine, Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "../policy";

export class GreedyOnlyUnsupportedGameError extends Error {
  constructor(gameId: string) {
    super(
      `greedyOnlyPolicy: engine "${gameId}" implements neither score() nor heuristic() — ` +
        "greedy-only has nothing to rank candidate moves by."
    );
    this.name = "GreedyOnlyUnsupportedGameError";
  }
}

/** Value of `state` from `player`'s POV, for ranking ONE ply ahead: terminal outcomes get
 *  their natural value (win/lose/draw/scored); a still-`ongoing` state falls through to
 *  score() (preferred) or heuristic() — the two static rankings this probe is allowed to use. */
function evaluate<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S,
  player: PlayerId
): number {
  const status = engine.status(state);
  switch (status.kind) {
    case "won":
      return status.winner === player ? 1 : -1;
    case "lost":
      return -1;
    case "draw":
      return 0;
    case "scored":
      return status.scores[player] ?? 0;
    case "ongoing":
      if (engine.score) return engine.score(state, player);
      // engine.heuristic existence is checked once up-front in chooseMove; safe here.
      return engine.heuristic!(state, player);
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
        const value = evaluate(engine, next, player);
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

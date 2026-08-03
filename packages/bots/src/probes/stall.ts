// packages/bots/src/probes/stall.ts — generic 2-player degeneracy probe (plan §6):
// "maximize estimated remaining plies via shallow rollouts". Deliberately prefers PROLONGING
// the game over ending it — even by declining an available win — because the whole point of
// this probe is to surface whether a game rewards that perverse strategy (a game where
// stalling is ever optimal has a design problem the harness's stall-probe metric exists to
// catch; that check itself is M3b/M3c, out of M2 scope, but the probe's behavior must be
// this way for that later check to mean anything).

import type { GameEngine, Json, PlayerId, Rng, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "../policy";

export interface StallOptions {
  /** Shallow rollouts per candidate move used to estimate remaining game length. Default 20. */
  rolloutsPerAction?: number;
  rolloutCapPlies?: number;
}

/** Simulates uniform-random legal moves from `start` to a terminal (or `maxPlies`), returning
 *  the number of plies actually taken. A local variant of search-utils's rolloutToHorizon
 *  that also reports ply count — the thing stall/suicide need, that mcts/flat-mc/beam don't. */
function countRolloutPlies<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  start: S,
  rng: Rng,
  maxPlies: number
): number {
  let state = start;
  let status = engine.status(state);
  let plies = 0;
  while (status.kind === "ongoing" && plies < maxPlies) {
    const active = engine.active(state);
    const actors = active.mode === "sequential" ? [active.player] : active.players;
    const jm = new Map<PlayerId, M>();
    for (const p of actors) {
      const legal = engine.legalMoves(state, p);
      if (legal.length === 0) {
        throw new Error(
          `stallPolicy rollout: active player ${p} has no legal moves while status is ongoing.`
        );
      }
      jm.set(p, legal[rng.int(legal.length)]!);
    }
    state = engine.apply(state, jm, rng);
    status = engine.status(state);
    plies += 1;
  }
  return plies;
}

export function stallPolicy<S extends WithEffects, M extends Json>(opts: StallOptions = {}): Policy<S, M> {
  const rolloutsPerActionDefault = opts.rolloutsPerAction ?? 20;
  const rolloutCapPlies = opts.rolloutCapPlies ?? 200;

  return {
    chooseMove({ engine, state, player, rng, budget, clock }) {
      const start = clock.now();
      const status = engine.status(state);
      if (status.kind !== "ongoing") {
        throw new Error("stallPolicy: chooseMove called on a terminal state");
      }
      const legal = engine.legalMoves(state, player as PlayerId);
      if (legal.length === 0) {
        throw new Error(`stallPolicy: player ${String(player)} has no legal moves`);
      }
      // NOTE: a `deadlineMs` budget is NOT honored here — it silently falls back to a fixed
      // `rolloutsPerActionDefault` (20) rollouts per candidate regardless of the actual time
      // remaining, unlike beam.ts/minimax.ts's search loops, which check the deadline as they
      // go. Fine for this probe's own harness-internal use (always driven by a `rollouts`
      // budget in practice), but a caller handing this a real wall-clock budget would get no
      // responsiveness guarantee at all.
      const perActionRollouts =
        budget.kind === "rollouts" ? Math.max(1, Math.floor(budget.n / legal.length)) : rolloutsPerActionDefault;

      let bestMove: M = legal[0]!;
      let bestAveragePlies = Number.NEGATIVE_INFINITY;
      let totalRollouts = 0;

      for (const move of legal) {
        const nextState = engine.apply(state, new Map([[player, move]]), rng);
        const nextStatus = engine.status(nextState);
        let average: number;
        if (nextStatus.kind !== "ongoing") {
          // Ending the game right here is the WORST outcome for a stalling agent: 0 further
          // plies. Still counted (not skipped) so it can lose fairly to any longer alternative.
          average = 0;
          totalRollouts += 1;
        } else {
          let pliesSum = 0;
          for (let i = 0; i < perActionRollouts; i++) {
            pliesSum += countRolloutPlies(engine, nextState, rng, rolloutCapPlies);
          }
          totalRollouts += perActionRollouts;
          average = pliesSum / perActionRollouts;
        }
        if (average > bestAveragePlies) {
          bestAveragePlies = average;
          bestMove = move;
        }
      }

      return {
        move: bestMove,
        stats: { elapsedMs: clock.now() - start, rollouts: totalRollouts, rootValue: bestAveragePlies },
      };
    },
  };
}

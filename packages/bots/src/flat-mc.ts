// packages/bots/src/flat-mc.ts — flat Monte-Carlo policy (plan §6): the cheap Strong
// stand-in for stochastic solo games. Unlike mctsPolicy, it builds NO tree — for each legal
// move at the current state, it runs `rolloutsPerAction` independent random playouts from the
// resulting state and picks the move with the best average outcome. That flatness is exactly
// why it suits noisy/stochastic score-chases: it never has to decide how to CREDIT a shared
// ancestor node under high-variance transitions, it just averages per candidate move directly.

import type { Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import type { Policy, SearchStats } from "./policy";
import { rolloutToHorizon, valueOfStatus } from "./search-utils";

export class FlatMonteCarloTerminalStateError extends Error {
  constructor() {
    super("flatMonteCarloPolicy: chooseMove called on a terminal state — there is nothing to search for.");
    this.name = "FlatMonteCarloTerminalStateError";
  }
}

export interface FlatMonteCarloOptions {
  /** Rollouts per candidate move, when the budget is expressed as `deadlineMs` (time-boxed
   *  instead). Under a `rollouts` budget, the total is instead spread evenly across the
   *  legal moves (see chooseMove below) so the deterministic wire-format meaning of
   *  `{kind:"rollouts", n}` — "exactly n simulated playouts, full stop" — holds regardless of
   *  branching factor. Default 32 (plan §6). */
  rolloutsPerAction?: number;
  /** Ply cap for each rollout. Default 200. */
  rolloutCapPlies?: number;
}

export function flatMonteCarloPolicy<S extends WithEffects, M extends Json>(
  opts: FlatMonteCarloOptions = {}
): Policy<S, M> {
  const rolloutsPerActionDefault = opts.rolloutsPerAction ?? 32;
  const rolloutCapPlies = opts.rolloutCapPlies ?? 200;

  return {
    chooseMove({ engine, state, player, rng, budget, clock }) {
      const start = clock.now();
      const status = engine.status(state);
      if (status.kind !== "ongoing") {
        throw new FlatMonteCarloTerminalStateError();
      }
      const legal = engine.legalMoves(state, player as PlayerId);
      if (legal.length === 0) {
        throw new Error(`flatMonteCarloPolicy: player ${String(player)} has no legal moves`);
      }

      // Under a `rollouts` budget, spread `n` as evenly as possible across candidates — NOT
      // exactly `n` total rollouts. When `n >= legal.length`, the actual total is
      // `floor(n / legal.length) * legal.length`, which is <= n (the remainder from the
      // integer division is simply never spent). When `n < legal.length` (fewer rollouts than
      // candidate moves), `Math.max(1, ...)` guarantees every candidate still gets at least one
      // rollout, so the actual total is `legal.length` — MORE than `n` was asked for. Either
      // way, the total is still a pure function of (n, legal.length) — deterministic and
      // machine-independent — just not exactly `n`.
      const perActionRollouts =
        budget.kind === "rollouts" ? Math.max(1, Math.floor(budget.n / legal.length)) : rolloutsPerActionDefault;
      const deadline = budget.kind === "deadlineMs" ? start + budget.ms : undefined;

      let bestMove: M = legal[0]!;
      let bestAverage = Number.NEGATIVE_INFINITY;
      let totalRollouts = 0;
      const rootVisits: { move: Json; visits: number }[] = [];

      for (const move of legal) {
        const nextState = engine.apply(state, new Map([[player, move]]), rng);
        const nextStatus = engine.status(nextState);
        let sum = 0;
        let count = 0;
        if (nextStatus.kind !== "ongoing") {
          // Already decided — no need to simulate further; count it once so its average is
          // exact rather than diluted or duplicated.
          sum = valueOfStatus(engine, nextStatus, nextState, player);
          count = 1;
        } else {
          for (let i = 0; i < perActionRollouts; i++) {
            if (deadline !== undefined && clock.now() >= deadline) break;
            const { status: leafStatus, state: leafState } = rolloutToHorizon(engine, nextState, rng, rolloutCapPlies);
            sum += valueOfStatus(engine, leafStatus, leafState, player);
            count += 1;
          }
        }
        totalRollouts += count;
        rootVisits.push({ move: move as unknown as Json, visits: count });
        const average = count > 0 ? sum / count : Number.NEGATIVE_INFINITY;
        if (average > bestAverage) {
          bestAverage = average;
          bestMove = move;
        }
      }

      const stats: SearchStats = {
        elapsedMs: clock.now() - start,
        rollouts: totalRollouts,
        rootVisits,
      };
      if (bestAverage > Number.NEGATIVE_INFINITY) stats.rootValue = bestAverage;
      return { move: bestMove, stats };
    },
  };
}

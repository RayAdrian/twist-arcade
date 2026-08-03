// packages/bots/src/determinized-flat-mc.ts — the literal hidden-information Strong mechanism
// mine-run.md §4.4's "Decided mechanism" specifies: "for each candidate move, sample K
// consistent layouts, roll out with the greedy policy to terminal, average, pick the best."
//
// Why this is NOT `determinize(flatMonteCarloPolicy())` (platform-corrections.md C6's
// close-out finding): `determinize()` (policy.ts) is a GENERIC adapter — it draws `samples`
// worlds ONCE per decision, runs the ENTIRE wrapped policy once per world (which itself
// re-evaluates every candidate move against that SAME single world), and majority-VOTES across
// the `samples` resulting "best move for that world" answers. That is the right shape for a
// policy that is otherwise a black box, but for Mine Run specifically it throws away almost all
// of the variance reduction the plan asks for: every candidate only ever gets evaluated against
// whichever ONE world its enclosing sample drew, and votes on the ARGMAX (not the underlying
// values) wash out a candidate with a rare catastrophic outcome — a majority of worlds mildly
// preferring move A can out-vote the one world where move A is a disaster, even when A's TRUE
// average is far worse than B's. This module instead samples `samplesPerCandidate` FRESH
// worlds PER CANDIDATE MOVE and averages the resulting values directly, exactly like
// `flatMonteCarloPolicy` already does for a perfect-information game against ONE real state —
// the only difference is that "the state" here is redrawn from `sampleConsistentState` on every
// single sample, never the true secret (view-honest by construction: `chooseMove` has no `S`
// parameter at all, only `PlayerView<V>`, the same structural guarantee `ViewPolicy` gives
// every hidden-info entry point).

import type { Json, WithEffects } from "@twist-arcade/engine";
import { MissingSampleConsistentStateError, type PlayerView, type SearchStats, type ViewPolicy } from "./policy";
import { rolloutToHorizon, uniformRandomMoveSelector, valueOfStatus } from "./search-utils";
import type { MoveSelector } from "./search-utils";

export class DeterminizedFlatMonteCarloTerminalStateError extends Error {
  constructor() {
    super(
      "determinizedFlatMonteCarloPolicy: chooseMove called on a view whose sampled reference " +
        "world is already terminal — there is nothing to search for."
    );
    this.name = "DeterminizedFlatMonteCarloTerminalStateError";
  }
}

export interface DeterminizedFlatMonteCarloOptions<S extends WithEffects = WithEffects, M extends Json = Json> {
  /** Fresh world samples per candidate move, when the budget is expressed as `deadlineMs`.
   *  Under a `rollouts` budget, `budget.n` is instead spread evenly across the legal moves —
   *  the same deterministic-wire-format convention `flatMonteCarloPolicy` uses. Default 8. */
  samplesPerCandidate?: number;
  /** Ply cap for each rollout. Default 200. */
  rolloutCapPlies?: number;
  /** Move selector each rollout uses at every ply. Default `uniformRandomMoveSelector`; pass
   *  `greedyMoveSelector` for mine-run.md §4.4's "roll out with the greedy policy to terminal". */
  rolloutMoveSelector?: MoveSelector<S, M>;
}

/**
 * THE hidden-information Strong mechanism (mine-run.md §4.4, platform-corrections.md C6).
 * `chooseMove` never receives a real `state: S` — only `view: PlayerView<V>` — so nothing here
 * can read a true secret even by mistake; every world it ever touches comes from
 * `engine.sampleConsistentState(view, rng)`.
 */
export function determinizedFlatMonteCarloPolicy<S extends WithEffects, M extends Json, V extends WithEffects>(
  opts: DeterminizedFlatMonteCarloOptions<S, M> = {}
): ViewPolicy<S, M, V> {
  const samplesPerCandidateDefault = opts.samplesPerCandidate ?? 8;
  const rolloutCapPlies = opts.rolloutCapPlies ?? 200;
  const rolloutMoveSelector = opts.rolloutMoveSelector ?? uniformRandomMoveSelector;

  return {
    chooseMove({ engine, view, player, rng, budget, clock }) {
      const start = clock.now();
      if (!engine.sampleConsistentState) {
        throw new MissingSampleConsistentStateError(engine.meta.id);
      }
      const sampleConsistentState = (v: PlayerView<V>) => engine.sampleConsistentState!(v, rng);

      // A reference world purely to enumerate the legal-move set and check terminality — for
      // every shipped hidden-info game, legality depends only on view-visible bookkeeping
      // (revealed/streak/budget counters), so every world consistent with `view` agrees on it.
      const reference = sampleConsistentState(view);
      const referenceStatus = engine.status(reference);
      if (referenceStatus.kind !== "ongoing") {
        throw new DeterminizedFlatMonteCarloTerminalStateError();
      }
      const legal = engine.legalMoves(reference, player);
      if (legal.length === 0) {
        throw new Error(`determinizedFlatMonteCarloPolicy: player ${String(player)} has no legal moves`);
      }

      const samplesPerCandidate =
        budget.kind === "rollouts" ? Math.max(1, Math.floor(budget.n / legal.length)) : samplesPerCandidateDefault;
      const deadline = budget.kind === "deadlineMs" ? start + budget.ms : undefined;

      let bestMove: M = legal[0]!;
      let bestAverage = Number.NEGATIVE_INFINITY;
      let totalRollouts = 0;
      const rootVisits: { move: Json; visits: number }[] = [];

      for (const move of legal) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < samplesPerCandidate; i++) {
          if (deadline !== undefined && clock.now() >= deadline) break;
          const world = sampleConsistentState(view);
          const nextState = engine.apply(world, new Map([[player, move]]), rng);
          const nextStatus = engine.status(nextState);
          let leafStatus = nextStatus;
          let leafState = nextState;
          if (nextStatus.kind === "ongoing") {
            const rolled = rolloutToHorizon(engine, nextState, rng, rolloutCapPlies, rolloutMoveSelector);
            leafStatus = rolled.status;
            leafState = rolled.state;
          }
          sum += valueOfStatus(engine, leafStatus, leafState, player);
          count += 1;
        }
        totalRollouts += count;
        rootVisits.push({ move: move as unknown as Json, visits: count });
        const average = count > 0 ? sum / count : Number.NEGATIVE_INFINITY;
        if (average > bestAverage) {
          bestAverage = average;
          bestMove = move;
        }
      }

      const stats: SearchStats = { elapsedMs: clock.now() - start, rollouts: totalRollouts, rootVisits };
      if (bestAverage > Number.NEGATIVE_INFINITY) stats.rootValue = bestAverage;
      return { move: bestMove, stats };
    },
  };
}

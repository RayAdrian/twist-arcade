// packages/bots/src/probes/suicide.ts — generic degeneracy probe (plan §6/§7.4: "harness runs
// it only for games tagged misere"): the mirror image of stallPolicy — "shortest path to a
// terminal". At every decision, estimates each candidate move's expected REMAINING plies via
// shallow random rollouts (the same technique stallPolicy uses) and prefers the move that ends
// the game SOONEST, regardless of WHICH terminal it ends in — win, loss, draw, or score are
// all irrelevant to this probe; only speed to any terminal matters. The harness's misère check
// then asks whether this agent's actual outcomes are suspiciously good: if "trying to end the
// game as fast as possible" comes out ahead, the game rewards deliberately finishing itself,
// which is the design defect this probe exists to surface.

import type { GameEngine, Json, PlayerId, Rng, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "../policy";

export interface SuicideOptions {
  /** Shallow rollouts per candidate move used to estimate remaining game length. Default 20. */
  rolloutsPerAction?: number;
  rolloutCapPlies?: number;
}

/** Simulates uniform-random legal moves from `start` to a terminal (or `maxPlies`), returning
 *  the number of plies actually taken. Identical in shape to stallPolicy's local helper of the
 *  same purpose — kept as a sibling copy (not shared) since the two files are meant to read as
 *  exact mirror images of each other, each self-contained. */
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
          `suicidePolicy rollout: active player ${p} has no legal moves while status is ongoing.`
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

export function suicidePolicy<S extends WithEffects, M extends Json>(opts: SuicideOptions = {}): Policy<S, M> {
  const rolloutsPerActionDefault = opts.rolloutsPerAction ?? 20;
  const rolloutCapPlies = opts.rolloutCapPlies ?? 200;

  return {
    chooseMove({ engine, state, player, rng, budget, clock }) {
      const start = clock.now();
      const status = engine.status(state);
      if (status.kind !== "ongoing") {
        throw new Error("suicidePolicy: chooseMove called on a terminal state");
      }
      const legal = engine.legalMoves(state, player as PlayerId);
      if (legal.length === 0) {
        throw new Error(`suicidePolicy: player ${String(player)} has no legal moves`);
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
      let bestAveragePlies = Number.POSITIVE_INFINITY;
      let totalRollouts = 0;

      for (const move of legal) {
        const nextState = engine.apply(state, new Map([[player, move]]), rng);
        const nextStatus = engine.status(nextState);
        let average: number;
        if (nextStatus.kind !== "ongoing") {
          // Ending the game right here is the BEST outcome for a suicide agent: 0 further
          // plies, full stop — no rollouts needed to know that.
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
        if (average < bestAveragePlies) {
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

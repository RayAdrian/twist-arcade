// packages/bots/src/search-utils.ts — internal helpers shared by mcts.ts, flat-mc.ts, and
// beam.ts. NOT part of the package's public surface (not re-exported from src/index.ts) —
// this exists purely so all three search algorithms agree on what "the value of an outcome"
// and "simulate randomly to a terminal/horizon" mean. A subtle divergence between, say,
// mcts.ts's and flat-mc.ts's idea of a scored terminal's value would be a quiet correctness
// bug (their SearchStats.rootValue / average-value numbers would stop being comparable),
// which is exactly the kind of thing worth a shared, once-reviewed implementation instead of
// three independently-drifting copies.

import type { GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";

/** Value of a (possibly non-terminal, horizon-capped) outcome, from `player`'s perspective:
 *  +1 win / -1 loss-or-lost / 0 draw / status.scores[player] for a scored terminal / a
 *  score()-or-heuristic()-based estimate (falling back to 0) when the horizon was hit before
 *  any terminal. */
export function valueOfStatus<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  status: Status,
  state: S,
  player: PlayerId
): number {
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
      // score() is NOT squashed: a "scored" game's terminal value (the `case "scored"` branch
      // above) is already the raw status.scores[player] — no ±1 convention exists for these
      // games at all — so a mid-game score() estimate stays commensurate with its OWN game's
      // terminal by construction. Squashing it here would instead make it LESS commensurate
      // with its own terminal, the opposite of the problem this function exists to prevent.
      if (engine.score) return engine.score(state, player);
      // heuristic() IS squashed, via Math.tanh (order-preserving, and bounded strictly inside
      // (-1, 1)). `heuristic()`'s doc (packages/engine/src/types.ts) promises only "positive =
      // good for player" — no bound on its range — and is used exclusively by won/lost/draw-
      // style games where ±1/0 IS the terminal convention. An earlier version of this line
      // returned the heuristic raw and pushed the "must already be ±1-commensurate" requirement
      // onto every game author instead: a requirement nothing checks, silently violated by
      // classic-ttt's own heuristic (span ~±8) the moment a rollout hit `rolloutCapPlies`
      // before a terminal — a horizon-capped "ongoing" value could then outrank an actual
      // averaged win. (An even earlier version divided by a hardcoded 9 — classic-ttt's own
      // open-line-count max — which "fixed" that one fixture while silently mis-scaling every
      // OTHER game's differently-ranged heuristic instead.) Squashing removes the failure mode
      // structurally rather than documenting around it — the same call made for the masked-vs-
      // omitted fog fixture and the decode-ordering pin elsewhere in this package's history: a
      // contract a future game author has to remember has already failed here more than once.
      if (engine.heuristic) return Math.tanh(engine.heuristic(state, player));
      return 0;
  }
}

/** Simulates uniform-random legal moves from `start` (inclusive) until a non-ongoing status
 *  or `maxPlies` is reached, drawing every random choice (move selection AND any stochastic
 *  transition inside apply()) from the SAME injected `rng` — callers wanting independent
 *  rollouts simply keep drawing from one continuing Rng stream across calls (see mcts.ts's
 *  module doc for why that already gives "fresh randomness per playout" without forking). */
export function rolloutToHorizon<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  start: S,
  rng: Rng,
  maxPlies: number
): { status: Status; state: S } {
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
          `rolloutToHorizon: active player ${p} has no legal moves while status is ongoing — ` +
            "this violates the engine contract's no-hidden-pass rule."
        );
      }
      jm.set(p, legal[rng.int(legal.length)]!);
    }
    state = engine.apply(state, jm, rng);
    status = engine.status(state);
    plies += 1;
  }
  return { status, state };
}

// packages/bots/src/search-utils.ts — internal helpers shared by mcts.ts, flat-mc.ts, and
// beam.ts. `valueOfStatus`/`rolloutToHorizon`/`rankingValueOf` are NOT part of the package's
// public surface (not re-exported from src/index.ts) — this exists purely so all three search
// algorithms (plus greedy-only.ts and beam.ts's own candidate ranking) agree on what "the value
// of an outcome" and "simulate to a terminal/horizon" mean. A subtle divergence between, say,
// mcts.ts's and flat-mc.ts's idea of a scored terminal's value would be a quiet correctness
// bug (their SearchStats.rootValue / average-value numbers would stop being comparable),
// which is exactly the kind of thing worth a shared, once-reviewed implementation instead of
// three independently-drifting copies.
//
// `greedyMoveSelector` / `uniformRandomMoveSelector` / `MoveSelector` / `RankingValueUnavailableError`
// ARE re-exported from src/index.ts (platform-corrections.md C6) — a caller building a
// determinized Strong (e.g. the harness's `resolveStrongPolicy` for a hidden-information game,
// mine-run.md §4.4's "roll out with the greedy policy to terminal") needs to pass
// `greedyMoveSelector` into `flatMonteCarloPolicy`'s `rolloutMoveSelector` option from outside
// this package.

import type { GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";

/** Thrown by `valueOfStatus` when an engine implements BOTH `score()` and `heuristic()` but
 *  declares no `horizonValue` (platform-corrections.md C30). Before this field existed,
 *  `valueOfStatus` defaulted silently to `score()` whenever it was present — which is exactly
 *  what blinded Mine Run's Strong to its entire live-streak mechanic: Mine Run's `score()` is
 *  `banked` ONLY (a deliberate, correct decision — it must equal the "scored" terminal's raw
 *  value), while `heuristic()` carries the streak's continuation value. Only the game's own
 *  author knows which quantity is a meaningful mid-game estimate for THEIR game; the platform
 *  cannot infer it, and a silent default already produced one wrong answer here. There is no
 *  safe default to fall back to a second time — this throws instead. */
export class HorizonValueUndeclaredError extends Error {
  constructor(gameId: string) {
    super(
      `valueOfStatus: engine "${gameId}" implements BOTH score() and heuristic() but declares ` +
        `no horizonValue — a search cannot know which one to trust at a non-terminal, ` +
        `horizon-capped leaf (platform-corrections.md C30). Set horizonValue: "score" | ` +
        `"heuristic" on the engine.`
    );
    this.name = "HorizonValueUndeclaredError";
  }
}

/** Resolves the RAW (unsquashed) score()/heuristic() estimate `valueOfStatus`'s "ongoing"
 *  branch should use, per `engine.horizonValue` (platform-corrections.md C30) — or `undefined`
 *  when the engine implements neither. Squashing is NOT decided here: it depends on the
 *  engine's own terminal convention (see `valueOfStatus` below), not on which hook supplied
 *  the number. */
function resolveHorizonEstimate<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S,
  player: PlayerId
): number | undefined {
  const hasScore = !!engine.score;
  const hasHeuristic = !!engine.heuristic;
  if (hasScore && hasHeuristic) {
    if (engine.horizonValue === "score") return engine.score!(state, player);
    if (engine.horizonValue === "heuristic") return engine.heuristic!(state, player);
    throw new HorizonValueUndeclaredError(engine.meta.id);
  }
  if (hasScore) return engine.score!(state, player);
  if (hasHeuristic) return engine.heuristic!(state, player);
  return undefined;
}

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
    case "ongoing": {
      const estimate = resolveHorizonEstimate(engine, state, player);
      if (estimate === undefined) return 0;
      // Squashing tracks the ENGINE's own terminal convention, not which hook supplied the
      // estimate (platform-corrections.md C30 — this is the seam the original bug lived in:
      // conflating "prefer score()" with "don't squash" broke the instant a game wanted
      // heuristic() to supply a horizon estimate for a SCORED game). An engine that implements
      // score() at all has a "scored" terminal by score()'s own contract (packages/engine/src/
      // types.ts: "MUST equal status().scores[0] at a scored terminal") — that terminal's own
      // value (the `case "scored"` branch above) is already raw, with no ±1 convention in play,
      // so ANY horizon estimate for that engine — score() OR heuristic() — must stay raw to
      // remain commensurate with it. Squashing it here would make it LESS commensurate with its
      // own terminal, the opposite of the problem this function exists to prevent.
      //
      // An engine with NO score() at all has a won/lost/draw terminal (±1/0 convention), and
      // its heuristic() IS squashed via Math.tanh (order-preserving, bounded strictly inside
      // (-1, 1)). `heuristic()`'s doc promises only "positive = good for player" — no bound on
      // its range — so an un-squashed heuristic here could let a horizon-capped "ongoing" value
      // outrank an actual averaged win (classic-ttt's own heuristic, span ~±8, is exactly this
      // case). Squashing removes the failure mode structurally rather than documenting around
      // it — the same call made for the masked-vs-omitted fog fixture and the decode-ordering
      // pin elsewhere in this package's history: a contract a future game author has to
      // remember has already failed here more than once.
      return engine.score ? estimate : Math.tanh(estimate);
    }
  }
}

/** Picks the move a rollout should take for `player` at `state`, given its legal moves.
 *  Implementations MUST NOT read anything beyond (engine, state, player, legal, rng) — in
 *  particular, for a hidden-information game `state` may be a `sampleConsistentState`-sampled
 *  hypothetical world (never the true secret), and a selector must treat it as such rather
 *  than assuming it is ever the ground truth (this is exactly what makes it safe to reuse
 *  inside a determinized rollout, C1). */
export type MoveSelector<S extends WithEffects, M extends Json> = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S,
  player: PlayerId,
  legal: readonly M[],
  rng: Rng
) => M;

/** `rolloutToHorizon`'s default selector, and the ONLY behavior it had before `MoveSelector`
 *  was parameterised out (platform-corrections.md C6) — a uniformly random legal move, drawn
 *  from the shared rollout `rng`. */
export function uniformRandomMoveSelector<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _engine: GameEngine<S, M, any>,
  _state: S,
  _player: PlayerId,
  legal: readonly M[],
  rng: Rng
): M {
  return legal[rng.int(legal.length)]!;
}

/** Thrown by `greedyMoveSelector` when the engine has neither `score()` nor `heuristic()` —
 *  there is nothing for a 1-ply greedy comparison to rank candidate moves by. Named distinctly
 *  from `probes/greedy-only.ts`'s `GreedyOnlyUnsupportedGameError` (same shape of failure, a
 *  different call site) so a caller catching one never silently swallows the other. */
export class RankingValueUnavailableError extends Error {
  constructor(gameId: string) {
    super(
      `greedyMoveSelector: engine "${gameId}" implements neither score() nor heuristic() — ` +
        "there is nothing to rank candidate moves by."
    );
    this.name = "RankingValueUnavailableError";
  }
}

/**
 * 1-ply candidate-move RANKING value (platform-corrections.md C6), from `player`'s
 * perspective. Deliberately a SEPARATE function from `valueOfStatus` above, with the OPPOSITE
 * score/heuristic priority: `valueOfStatus` prefers `score()` (a horizon-capped rollout leaf
 * estimate must stay commensurate with a "scored" terminal's raw `scores[player]`, which IS
 * `score()`'s own contract), while `rankingValueOf` prefers `heuristic()` — documented in
 * `packages/engine/src/types.ts` as "per-game eval for minimax/greedy", built for exactly this
 * 1-ply ranking use, and free to value POTENTIAL/unrealized progress that `score()` cannot:
 * `score()` is contractually pinned to equal `status().scores[0]` at a scored terminal, so it
 * can only ever reflect what has already been realized. A ranking function that preferred
 * `score()` here would rank every candidate by "however much is already realized" alone — blind
 * to unrealized progress (mine-run.md §4.4/§4.5, the C6 finding). Not squashed (unlike
 * `valueOfStatus`): this is a pure 1-ply comparator between candidates evaluated in the same
 * call, never averaged across rollouts, so there is no cross-rollout scale-mixing to guard
 * against here.
 */
export function rankingValueOf<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  status: Status,
  state: S,
  player: PlayerId
): number {
  switch (status.kind) {
    case "won":
      return status.winner === player ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    case "lost":
      return Number.NEGATIVE_INFINITY;
    case "draw":
      return 0;
    case "scored":
      return status.scores[player] ?? 0;
    case "ongoing":
      if (engine.heuristic) return engine.heuristic(state, player);
      if (engine.score) return engine.score(state, player);
      return 0;
  }
}

/** A 1-ply greedy `MoveSelector` (mine-run.md §4.4's "roll out with the greedy policy to
 *  terminal"): applies each legal candidate move against `state` (honest — see `MoveSelector`'s
 *  doc on what `state` may be) and picks whichever resulting position `rankingValueOf` ranks
 *  highest. This is deliberately the SAME 1-ply-hill-climb shape as `probes/greedy-only.ts`'s
 *  policy, reused here as a rollout STEP rather than a whole-game policy — valid for a
 *  sequential single-actor decision (every shipped solo game); it evaluates each candidate by
 *  applying ONLY `player`'s move, so it is not meaningful for a simultaneous multi-actor ply. */
export function greedyMoveSelector<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  state: S,
  player: PlayerId,
  legal: readonly M[],
  rng: Rng
): M {
  if (!engine.score && !engine.heuristic) {
    throw new RankingValueUnavailableError(engine.meta.id);
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
  return bestMove;
}

/** Simulates legal moves from `start` (inclusive) until a non-ongoing status or `maxPlies` is
 *  reached, drawing every random choice (move selection AND any stochastic transition inside
 *  apply()) from the SAME injected `rng` — callers wanting independent rollouts simply keep
 *  drawing from one continuing Rng stream across calls (see mcts.ts's module doc for why that
 *  already gives "fresh randomness per playout" without forking). `moveSelector` (default
 *  `uniformRandomMoveSelector`, platform-corrections.md C6) picks each actor's move at every
 *  ply — pass `greedyMoveSelector` for the greedy-rollout Strong mine-run.md §4.4 specifies. */
export function rolloutToHorizon<S extends WithEffects, M extends Json>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<S, M, any>,
  start: S,
  rng: Rng,
  maxPlies: number,
  moveSelector: MoveSelector<S, M> = uniformRandomMoveSelector
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
      jm.set(p, moveSelector(engine, state, p, legal, rng));
    }
    state = engine.apply(state, jm, rng);
    status = engine.status(state);
    plies += 1;
  }
  return { status, state };
}

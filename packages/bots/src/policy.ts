// packages/bots/src/policy.ts — the Policy / ViewPolicy surface (plan §6), plus the
// view-honesty seam correction C1 (platform-corrections.md) requires.
//
// Correction C1, in one sentence: a policy evaluated against a `hiddenInformation: true` game
// must receive `playerView(state, seat)`, never the canonical `state` — because a policy that
// CAN read unrevealed secrets posts a passing Strong/Random ratio on a game that is unplayable
// blind, and nothing about that failure is loud. C1's preferred fix is type-level: view-honesty
// should not be a discipline a policy author has to remember.
//
// THE SEAM, PRECISELY: `Policy<S, M>` is the search-algorithm surface (minimax/MCTS/beam/
// flat-MC all implement it) — it operates on the real state `S` because search fundamentally
// needs to simulate `apply()`/`legalMoves()` forward, which only exist for `S`. That is fine
// for a PERFECT-INFORMATION game: there, `playerView` is the identity (V = S per the engine
// contract's own testkit property), so handing a `Policy<S,M>` the real state loses nothing —
// "the view" and "the state" are the same object.
//
// For a HIDDEN-INFORMATION game, no caller may hand a `Policy<S,M>` the real canonical state.
// Instead, `ViewPolicy<S, M, V>` is the ONLY entry point permitted, and its `chooseMove` has NO
// parameter of type `S` at all — only `view: PlayerView<V>`. `determinize()` (below) is the one
// sanctioned adapter from `Policy<S,M>` to `ViewPolicy<S,M,V>`: it samples HYPOTHETICAL worlds
// consistent with the view via `engine.sampleConsistentState`, runs the underlying state-space
// policy against those SELF-GENERATED worlds, and returns a move — never the actual truth.
//
// TYPE-LEVEL ENFORCEMENT: `PlayerView<V>` is a branded type (`V & { [VIEW_BRAND]: true }`),
// produced ONLY by `deriveView()`, which does nothing but call `engine.playerView` and stamp
// the brand on the result. Plain TypeScript structural typing would otherwise let a caller
// pass a full `state: S` anywhere a plain `V` is expected (extra properties on a variable —
// as opposed to a fresh object literal — are NOT rejected by structural subtyping), silently
// defeating the whole point of a "different parameter type". The brand closes that hole: `S`
// does not (and cannot, without an explicit, grep-able `as PlayerView<V>` cast) carry the
// brand property, so passing a raw state where a `PlayerView<V>` is required is a compile
// error, not a structural coincidence. `deriveView` is the ONLY function in this package
// allowed to manufacture the brand — every hidden-info bot invocation crosses through it
// exactly once, and nowhere else fabricates one.
//
// RUNTIME PROBE (C1: "keep regardless" — belt-and-braces for a failure this quiet):
// `probeViewHonesty` fixes a view, re-deals hidden worlds consistent with it (two DIFFERENT
// real states that project to the identical view), and asserts a `ViewPolicy` returns the
// identical move for both — given the same rng seed. This catches the bug the type system
// cannot: a `ViewPolicy` implementation that closes over the real state via a stray outer
// closure instead of the sanctioned `sampleConsistentState` path.

import type { GameEngine, Json, PlayerId, Rng, WithEffects } from "@twist-arcade/engine";
import type { SearchBudget } from "@twist-arcade/game-spec";

/**
 * Thrown by `requireDeterministicBudget` (and by anything that calls it, e.g. `tierPolicy`'s
 * daily/pinned path) when handed a `deadlineMs` budget where determinism is required. Plan §6
 * / §5.2 (orchestrator decision 7): a `rollouts` budget is deterministic and is what makes
 * the pinned daily bot possible; a `deadlineMs` budget plays differently on a fast laptop
 * than a slow phone, silently destroying day-over-day comparability. This must be a REFUSAL,
 * never a silent accept — the whole point is that the failure mode it prevents is invisible.
 */
export class NonDeterministicBudgetError extends Error {
  constructor(context: string) {
    super(
      `${context}: a deadlineMs SearchBudget was supplied where determinism is required. ` +
        "Wall-clock budgets are non-deterministic across devices (a fast laptop plays a " +
        "different game than a slow phone) — use a `rollouts` budget instead."
    );
    this.name = "NonDeterministicBudgetError";
  }
}

/** Refuse (throw NonDeterministicBudgetError) unless `budget.kind === "rollouts"`. Call this
 *  at every seam where a caller has asserted determinism matters — the pinned daily bot, the
 *  worker's round-trip-identical-move guarantee, any harness ladder run. `context` is a short
 *  human-readable label included in the thrown message (e.g. the calling function's name). */
export function requireDeterministicBudget(budget: SearchBudget, context: string): void {
  if (budget.kind !== "rollouts") {
    throw new NonDeterministicBudgetError(context);
  }
}

/** Injected wall-clock reader. Bots may not call Date.now() directly (lint-enforced in
 *  src/**, see eslint.config.mjs) — all timing flows through this, exactly like Rng carries
 *  all randomness. The worker host (src/worker/host.ts) is the one place that constructs a
 *  REAL Clock (`{ now: () => Date.now() }`); every policy just consumes the interface. */
export interface Clock {
  now(): number;
}

/** Reported back alongside every chosen move — feeds the harness's logging, the ε-softmax
 *  blunder wrapper (root visit counts at temperature τ), and worker diagnostics. */
export interface SearchStats {
  elapsedMs: number;
  rollouts?: number;
  depth?: number;
  rootValue?: number;
  rootVisits?: { move: Json; visits: number }[];
}

/**
 * The state-space search surface. Every concrete algorithm (random/minimax/mcts/beam/
 * flat-mc) implements this. Safe to hand the real `state: S` directly ONLY for
 * perfect-information games (`meta.hiddenInformation === false`), where playerView is the
 * identity anyway. For a hidden-information game, wrap with `determinize()` instead of
 * calling this directly with a real state — see the module doc.
 */
export interface Policy<S extends WithEffects, M extends Json> {
  chooseMove(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine: GameEngine<S, M, any>;
    state: S;
    player: PlayerId;
    rng: Rng;
    budget: SearchBudget;
    clock: Clock;
  }): { move: M; stats: SearchStats };
}

// ---------------------------------------------------------------------------------------
// The view-honesty brand (C1's type-level guarantee).
// ---------------------------------------------------------------------------------------

declare const VIEW_BRAND: unique symbol;

/**
 * A value known to have been produced by `engine.playerView(state, seat)` via the sanctioned
 * `deriveView` helper — never a raw state. The brand is a `unique symbol` property that no
 * ordinary state/view object literal carries, so TypeScript's structural typing (which
 * otherwise allows a wider object to satisfy a narrower parameter type through a variable)
 * cannot be fooled into accepting a real `S` here without an explicit, auditable cast.
 */
export type PlayerView<V> = V & { readonly [VIEW_BRAND]: true };

/**
 * The ONLY sanctioned way to produce a `PlayerView`. Every hidden-info bot invocation must
 * cross through here exactly once — grep for `as PlayerView` / `as unknown as PlayerView` to
 * find (and challenge) any other attempt to manufacture one.
 */
export function deriveView<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  state: S,
  player: PlayerId | null
): PlayerView<V> {
  return engine.playerView(state, player) as PlayerView<V>;
}

/**
 * The hidden-information-safe policy surface. Structurally, `chooseMove` has no parameter of
 * type `S` — only `view: PlayerView<V>` — so a caller cannot pass the canonical state here
 * even by mistake (short of the visible, grep-able cast `deriveView`'s output requires to
 * fabricate elsewhere). This is the entry point every hidden-info game's bot integration,
 * the worker host, and the harness must use.
 */
export interface ViewPolicy<S extends WithEffects, M extends Json, V extends WithEffects> {
  chooseMove(args: {
    engine: GameEngine<S, M, V>;
    view: PlayerView<V>;
    player: PlayerId;
    rng: Rng;
    budget: SearchBudget;
    clock: Clock;
  }): { move: M; stats: SearchStats };
}

/** Thrown by `determinize()` when asked to drive a hidden-info game whose engine does not
 *  implement the optional `sampleConsistentState` hook — there is no honest way to search
 *  without it, and silently falling back to the real state would be exactly the C1 defect. */
export class MissingSampleConsistentStateError extends Error {
  constructor(gameId: string) {
    super(
      `determinize(): engine "${gameId}" has hiddenInformation===true but does not implement ` +
        "sampleConsistentState(view, rng) — there is no honest way to search a hidden-info " +
        "game's move space without it. Falling back to the real state would defeat the point " +
        "(correction C1)."
    );
    this.name = "MissingSampleConsistentStateError";
  }
}

export interface DeterminizeOptions {
  /** Independent hidden-world samples per decision. >1 runs the underlying policy once per
   *  sampled world and combines by majority vote on the returned move (ties broken by the
   *  order first seen). Default 1 — a single honest re-deal per decision; the plan explicitly
   *  scopes this package to "the sanctioned determinization", not full ISMCTS with tree reuse
   *  across samples (that wrapper is an explicit fast-follow, per §6/§10). */
  samples?: number;
}

/**
 * The determinization adapter (plan §6 / correction C1's related note: "Determinized Strong
 * lives in packages/bots... reused by every hidden-info game and becomes the shipped hint
 * feature"). Wraps a state-space `Policy<S,M>` into a `ViewPolicy<S,M,V>`: on each decision,
 * samples one or more full worlds consistent with the given view via
 * `engine.sampleConsistentState(view, rng)`, runs the wrapped policy against each sampled
 * world (never the real truth — the caller never gave it one), and returns the majority move.
 *
 * This is also THE determinized flat-MC / determinized MCTS mode named in the plan — it is
 * policy-agnostic, so `determinize(flatMonteCarloPolicy())` and `determinize(mctsPolicy())`
 * are both valid, sharing this one wrapper rather than forking a game-local copy (the
 * correction's explicit reason this lives here, not in any game).
 */
export function determinize<S extends WithEffects, M extends Json, V extends WithEffects>(
  policy: Policy<S, M>,
  opts: DeterminizeOptions = {}
): ViewPolicy<S, M, V> {
  const samples = opts.samples ?? 1;
  if (!Number.isInteger(samples) || samples < 1) {
    throw new RangeError(`determinize(): opts.samples must be a positive integer, got ${samples}`);
  }
  return {
    chooseMove({ engine, view, player, rng, budget, clock }) {
      if (!engine.sampleConsistentState) {
        throw new MissingSampleConsistentStateError(engine.meta.id);
      }
      const sampleConsistentState = engine.sampleConsistentState.bind(engine);
      const start = clock.now();
      const votes = new Map<string, { move: M; count: number; totalRollouts: number }>();
      let totalRollouts = 0;
      let lastStats: SearchStats | undefined;
      for (let i = 0; i < samples; i++) {
        // `view` is real (branded) data every time; the WORLD sampled from it is fresh and
        // honestly generated — this is the only place a full `S` is synthesized on a hidden-
        // info path, and it is synthesized, never handed in from outside.
        const world = sampleConsistentState(view, rng);
        const { move, stats } = policy.chooseMove({ engine, state: world, player, rng, budget, clock });
        lastStats = stats;
        totalRollouts += stats.rollouts ?? 0;
        const key = JSON.stringify(move);
        const existing = votes.get(key);
        if (existing) {
          existing.count += 1;
          existing.totalRollouts += stats.rollouts ?? 0;
        } else {
          votes.set(key, { move, count: 1, totalRollouts: stats.rollouts ?? 0 });
        }
      }
      let winner: { move: M; count: number } | undefined;
      for (const entry of votes.values()) {
        if (!winner || entry.count > winner.count) winner = entry;
      }
      // `votes` is populated exactly `samples` (>=1) times above, so this is unreachable —
      // narrows the type for the return statement below.
      if (!winner) throw new Error("determinize(): no samples were drawn");
      const stats: SearchStats = { elapsedMs: clock.now() - start, rollouts: totalRollouts };
      if (lastStats?.depth !== undefined) stats.depth = lastStats.depth;
      // rootValue/rootVisits describe a SINGLE search tree's root — only meaningful to pass
      // through when there was exactly one sample (otherwise they'd silently describe just
      // the LAST sample's tree, which would be misleading given `samples` independent trees
      // were actually run).
      if (samples === 1) {
        if (lastStats?.rootValue !== undefined) stats.rootValue = lastStats.rootValue;
        if (lastStats?.rootVisits !== undefined) stats.rootVisits = lastStats.rootVisits;
      }
      return { move: winner.move, stats };
    },
  };
}

/**
 * Runtime honesty probe (C1: "keep regardless" of the type-level fix). Given a FIXED view and
 * two (or more) independently-supplied "hidden worlds" that a caller asserts project to that
 * identical view, re-run the SAME `ViewPolicy` with the SAME rng seed against each world and
 * assert it returns the identical move. An honest `ViewPolicy` cannot see the worlds at all
 * (only the view crosses the type boundary), so this must always pass for any implementation
 * built the sanctioned way — a failure means some implementation smuggled real state through
 * a closure instead of `sampleConsistentState`.
 *
 * `makeRng` must build a FRESH Rng from the same seed for each call (e.g. `() =>
 * rngFromSeed(seed)`) — reusing one stateful Rng instance across the two invocations would
 * make the second call see a different (already-advanced) stream and invalidate the probe.
 */
export function probeViewHonesty<S extends WithEffects, M extends Json, V extends WithEffects>(args: {
  engine: GameEngine<S, M, V>;
  policy: ViewPolicy<S, M, V>;
  view: PlayerView<V>;
  player: PlayerId;
  budget: SearchBudget;
  clock: Clock;
  makeRng: () => Rng;
  /** Distinct hidden worlds the caller asserts all project to `view` — for documentation
   *  only; not passed to the policy (that would defeat the probe). Used purely to size the
   *  number of comparison runs and to make failure messages legible. */
  worldLabels: string[];
}): void {
  const { engine, policy, view, player, budget, clock, makeRng, worldLabels } = args;
  if (worldLabels.length < 2) {
    throw new RangeError("probeViewHonesty: need at least 2 worldLabels to compare");
  }
  const moves: { label: string; move: M }[] = [];
  for (const label of worldLabels) {
    const { move } = policy.chooseMove({ engine, view, player, rng: makeRng(), budget, clock });
    moves.push({ label, move });
  }
  const first = JSON.stringify(moves[0]!.move);
  for (const entry of moves.slice(1)) {
    if (JSON.stringify(entry.move) !== first) {
      throw new Error(
        `probeViewHonesty: the SAME view produced DIFFERENT moves across hidden worlds ` +
          `(${moves[0]!.label} -> ${first}, ${entry.label} -> ${JSON.stringify(entry.move)}) — ` +
          "the policy is behaving as though it can see something beyond the view (C1 violation)."
      );
    }
  }
}

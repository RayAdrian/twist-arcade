// packages/harness/src/agents.ts — resolves the solo agent roster (solo-games-lens §3.1:
// Random / Greedy / Strong) into one uniform SoloAgent interface, honoring
// platform-corrections C1 for hidden-information games: an agent evaluated against a
// `hiddenInformation: true` game NEVER receives the canonical state, only
// `engine.playerView(state, seat)` — routed through `@twist-arcade/bots`'s `determinize()` /
// `deriveView()` seam, the same belt-and-braces mechanism Mine Run's own view-honesty test
// uses. A harness that fed a policy the real state would post a passing Strong/Random ratio
// on a game unplayable blind, and nothing about that failure would be loud (C1's whole point).

import type { GameEngine, Json, PlayerId, Rng, WithEffects } from "@twist-arcade/engine";
import type { SearchBudget } from "@twist-arcade/game-spec";
import {
  beamPolicy,
  determinizedFlatMonteCarloPolicy,
  deriveView,
  determinize,
  flatMonteCarloPolicy,
  greedyMoveSelector,
  greedyOnlyPolicy,
  randomPolicy,
  type Clock,
  type DeterminizeOptions,
  type Policy,
  type SearchStats,
  type ViewPolicy,
} from "@twist-arcade/bots";

/** Uniform agent surface the runner drives — identical whether the underlying game is
 *  perfect-information (agent gets the real Policy<S,M> directly) or hidden-information
 *  (agent is wrapped through determinize()/deriveView(), never touching S beyond the view).
 *
 *  `viewHonest: true` is a runtime brand (SHOULD FIX item 5, stage-5 fix), set ONLY by
 *  `buildAgent`/`buildViewPolicyAgent`/`buildSafeMoveAgent` below. `playSoloRun` hands its
 *  `state: S` argument to `agent.chooseMove` verbatim regardless of
 *  `engine.meta.hiddenInformation` — the C1 wall this module's own doc comment describes
 *  exists ONLY inside these three constructors, one wrapper away from the runner seam that
 *  actually drives a game. An agent built any other way (or a raw object literal satisfying
 *  this interface's shape) runs silently against a hidden-information engine with no
 *  enforcement at all — the exact hole class already found and fixed at the two-player
 *  `runMatchup` seam. `playSoloRun` throws `UnwrappedAgentOnHiddenInformationEngineError` when
 *  `hiddenInformation && !agent.viewHonest`, so an agent author who bypasses these
 *  constructors and wants to claim honesty anyway (e.g. because they independently derive the
 *  view themselves, as `probes-solo.test.ts`'s hand-rolled greedy-rollout Strong agent does)
 *  must set it explicitly and take on the responsibility that implies. */
export interface SoloAgent<S extends WithEffects, M extends Json> {
  readonly name: string;
  readonly viewHonest: true;
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

/** Wraps a state-space `Policy<S,M>` into a `SoloAgent<S,M>`. For
 *  `meta.hiddenInformation === true`, routes through `determinize()` so the policy only ever
 *  sees self-generated worlds consistent with `playerView(state, seat)` — never the real
 *  secret. For perfect-info games, `playerView` is the identity (engine contract, testkit-
 *  asserted), so handing the policy the real state loses nothing.
 *
 *  `determinizeOpts` (default `{}` — `determinize()`'s own default of 1 sample) is forwarded
 *  to `determinize()` only on the hidden-info path; it is inert for perfect-info games. Used by
 *  `buildSoloRoster` to give hidden-info Strong more than one sampled world (platform-
 *  corrections.md C6) without changing Random/Greedy's single-sample behavior. */
export function buildAgent<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  base: Policy<S, M>,
  name: string,
  determinizeOpts: DeterminizeOptions = {}
): SoloAgent<S, M> {
  if (engine.meta.hiddenInformation) {
    const viewPolicy = determinize<S, M, V>(base, determinizeOpts);
    return {
      name,
      viewHonest: true,
      chooseMove({ state, player, rng, budget, clock }) {
        const view = deriveView(engine, state, player);
        return viewPolicy.chooseMove({ engine, view, player, rng, budget, clock });
      },
    };
  }
  return {
    name,
    viewHonest: true,
    chooseMove({ state, player, rng, budget, clock }) {
      return base.chooseMove({ engine, state, player, rng, budget, clock });
    },
  };
}

/** Wraps a `ViewPolicy<S,M,V>` (a policy whose `chooseMove` never receives a real state at
 *  all, only `deriveView(engine, state, player)`'s branded output) into a `SoloAgent<S,M>`.
 *  Structurally stronger than routing through `buildAgent`/`determinize()`: a `ViewPolicy` here
 *  is handed the derived view directly, with no adapter in between that could reintroduce a
 *  state parameter. Used for hidden-info Strong (platform-corrections.md C6's close-out) —
 *  `determinizedFlatMonteCarloPolicy` IS a `ViewPolicy` already, not a `Policy<S,M>` that needs
 *  `determinize()`'s generic (and, for this shape, too-lossy) wrapping. */
export function buildViewPolicyAgent<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  viewPolicy: ViewPolicy<S, M, V>,
  name: string
): SoloAgent<S, M> {
  return {
    name,
    viewHonest: true,
    chooseMove({ state, player, rng, budget, clock }) {
      const view = deriveView(engine, state, player);
      return viewPolicy.chooseMove({ engine, view, player, rng, budget, clock });
    },
  };
}

export class StrongPolicyUnavailableError extends Error {
  constructor(gameId: string) {
    super(
      `resolveStrongPolicy: engine "${gameId}" implements neither score() nor heuristic() — ` +
        "there is nothing for beam/flat-MC to rank continuations by. This is expected for a " +
        "daily-puzzle game with no score chase; puzzle skill separation is measured via the " +
        "exact solver's solve rate (solver/generic-solo.ts), not this agent roster."
    );
    this.name = "StrongPolicyUnavailableError";
  }
}

/** Ply cap for each of hidden-info Strong's greedy rollouts. Mirrors the size used to validate
 *  the Always-Safe gate itself (packages/harness/test/probes-solo.test.ts's test-local
 *  greedy-rollout Strong) — generous relative to a score-chase's typical run length (mine-
 *  run.md §4.6: median ~65-70 decisions) while still bounding a single decision's cost. */
const STRONG_HIDDEN_INFO_ROLLOUT_CAP_PLIES = 60;

/** Per-candidate world-sample count for hidden-info Strong, when the caller's budget is
 *  `deadlineMs` (mine-run.md §4.4's "Decided mechanism": "for each candidate move, sample K
 *  consistent layouts, roll out with the greedy policy to terminal, average, pick the best").
 *  Inert for the harness's own runs — every harness call uses a `rollouts` budget (platform
 *  §5.2), under which `determinizedFlatMonteCarloPolicy` derives its per-candidate sample count
 *  from `budget.n / legal.length` instead (the same convention `flatMonteCarloPolicy` already
 *  uses) — kept only as the option's documented default for a non-harness caller. */
export const STRONG_HIDDEN_INFO_SAMPLES = 16;

/** THE solo Strong agent (solo-games-lens §3.1): beam-100 for perfect-information score
 *  chases; a GREEDY-rollout `determinizedFlatMonteCarloPolicy` (mine-run.md §4.4 — approved as
 *  the platform-wide pattern for hidden-info games) otherwise. Both are product code — this is
 *  the same policy that ships as the hint/ghost feature, so the harness and the shipped feature
 *  never diverge in what "Strong" means for a given game.
 *
 *  Returns a bare `Policy<S,M>` — usable directly against an already-sampled world (e.g. a
 *  caller that wants ONLY the underlying per-world greedy-rollout search, or a perfect-info
 *  game, which never needs determinization at all). For a hidden-info game's OWN roster
 *  "strong" entry, `buildSoloRoster` does NOT wrap this return value — it builds
 *  `determinizedFlatMonteCarloPolicy` directly instead (platform-corrections.md C6's
 *  close-out): wrapping this bare policy through the generic `determinize()` adapter draws K
 *  worlds ONCE per decision and majority-votes full per-world re-searches, which — unlike
 *  `determinizedFlatMonteCarloPolicy`'s true per-candidate averaging — let a single
 *  catastrophic-but-rare sampled world get out-voted by several mildly-preferring ones, even
 *  when the truly-averaged value says otherwise (see packages/bots/test/
 *  determinized-flat-mc.test.ts's "true per-candidate averaging" case for the concrete proof).
 *  That mismatch is why the ORIGINAL C6 finding — the shipped Strong could not reliably clear
 *  the Always-Safe gate on a healthy Mine Run — held even after adding a greedy rollout and
 *  more samples to the old `determinize(flatMonteCarloPolicy())` wiring alone. */
export function resolveStrongPolicy<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>
): Policy<S, M> {
  if (engine.meta.hiddenInformation) {
    return flatMonteCarloPolicy<S, M>({
      rolloutMoveSelector: greedyMoveSelector,
      rolloutCapPlies: STRONG_HIDDEN_INFO_ROLLOUT_CAP_PLIES,
    });
  }
  if (!engine.score && !engine.heuristic) throw new StrongPolicyUnavailableError(engine.meta.id);
  return beamPolicy<S, M>({ width: 100 });
}

export interface SoloRoster<S extends WithEffects, M extends Json> {
  random: SoloAgent<S, M>;
  greedy: SoloAgent<S, M>;
  strong: SoloAgent<S, M>;
}

/** The full score-chase roster (solo-games-lens §3.1 table), view-honesty-wired uniformly.
 *  `strong` is built specially for a hidden-info game — `determinizedFlatMonteCarloPolicy`
 *  directly (a `ViewPolicy`, true per-candidate world averaging), NOT
 *  `resolveStrongPolicy(engine)` routed through the generic `determinize()` wrap (see
 *  `resolveStrongPolicy`'s doc for why that shape under-delivers here). Random and Greedy stay
 *  on the plain `buildAgent`/`determinize()` path at its default of 1 sample — a K-sampled
 *  "Random" or "Greedy" baseline would no longer mean what those names promise, only how
 *  strong they are. */
export function buildSoloRoster<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>
): SoloRoster<S, M> {
  const strong: SoloAgent<S, M> = engine.meta.hiddenInformation
    ? buildViewPolicyAgent(
        engine,
        determinizedFlatMonteCarloPolicy<S, M, V>({
          samplesPerCandidate: STRONG_HIDDEN_INFO_SAMPLES,
          rolloutMoveSelector: greedyMoveSelector,
          rolloutCapPlies: STRONG_HIDDEN_INFO_ROLLOUT_CAP_PLIES,
        }),
        "strong"
      )
    : buildAgent(engine, resolveStrongPolicy(engine), "strong");
  return {
    random: buildAgent(engine, randomPolicy<S, M>(), "random"),
    greedy: buildAgent(engine, greedyOnlyPolicy<S, M>(), "greedy"),
    strong,
  };
}

/** The mandatory per-game `safeMove` hook (platform §6/§7.4), wrapped as a SoloAgent. Always
 *  view-honest by signature: `safeMove` takes `V`, never `S` — exactly Mine Run's
 *  `games/mine-run/probes.ts` shape, and for a perfect-info game `V === S` so the same
 *  signature costs nothing extra there either. */
export type SafeMoveFn<M extends Json, V> = (view: V) => M;

export function buildSafeMoveAgent<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  safeMove: SafeMoveFn<M, V>
): SoloAgent<S, M> {
  return {
    name: "always-safe",
    viewHonest: true,
    chooseMove({ state, player, clock }) {
      const start = clock.now();
      const view = engine.playerView(state, player);
      const move = safeMove(view);
      return { move, stats: { elapsedMs: clock.now() - start, rollouts: 0 } };
    },
  };
}

/** A clock that never advances — every roster agent here is driven by a deterministic
 *  `{ kind: "rollouts" }` budget (platform §5.2: the only budget kind safe for reproducible
 *  harness runs), so nothing in this package's agents ever consults wall-clock time to decide
 *  when to stop. Keeping it static (rather than `Date.now()`, which packages/harness is not
 *  lint-restricted from calling) makes every harness run byte-reproducible and removes wall-
 *  clock flakiness from CI, matching the plan's "fixed seed ⇒ byte-identical JSON report" DoD
 *  item (§13). */
export function staticClock(): Clock {
  return { now: () => 0 };
}

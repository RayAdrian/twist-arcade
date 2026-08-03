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
  deriveView,
  determinize,
  flatMonteCarloPolicy,
  greedyOnlyPolicy,
  randomPolicy,
  type Clock,
  type Policy,
  type SearchStats,
} from "@twist-arcade/bots";

/** Uniform agent surface the runner drives — identical whether the underlying game is
 *  perfect-information (agent gets the real Policy<S,M> directly) or hidden-information
 *  (agent is wrapped through determinize()/deriveView(), never touching S beyond the view). */
export interface SoloAgent<S extends WithEffects, M extends Json> {
  readonly name: string;
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
 *  asserted), so handing the policy the real state loses nothing. */
export function buildAgent<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  base: Policy<S, M>,
  name: string
): SoloAgent<S, M> {
  if (engine.meta.hiddenInformation) {
    const viewPolicy = determinize<S, M, V>(base);
    return {
      name,
      chooseMove({ state, player, rng, budget, clock }) {
        const view = deriveView(engine, state, player);
        return viewPolicy.chooseMove({ engine, view, player, rng, budget, clock });
      },
    };
  }
  return {
    name,
    chooseMove({ state, player, rng, budget, clock }) {
      return base.chooseMove({ engine, state, player, rng, budget, clock });
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

/** THE solo Strong agent (solo-games-lens §3.1): beam-100 for perfect-information score
 *  chases; determinized flat-Monte-Carlo (Mine Run plan §4.4/O1 — approved as the platform-
 *  wide pattern for hidden-info games) otherwise. Both are product code — this is the same
 *  policy that ships as the hint/ghost feature, so the harness and the shipped feature never
 *  diverge in what "Strong" means for a given game. */
export function resolveStrongPolicy<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>
): Policy<S, M> {
  if (engine.meta.hiddenInformation) return flatMonteCarloPolicy<S, M>();
  if (!engine.score && !engine.heuristic) throw new StrongPolicyUnavailableError(engine.meta.id);
  return beamPolicy<S, M>({ width: 100 });
}

export interface SoloRoster<S extends WithEffects, M extends Json> {
  random: SoloAgent<S, M>;
  greedy: SoloAgent<S, M>;
  strong: SoloAgent<S, M>;
}

/** The full score-chase roster (solo-games-lens §3.1 table), view-honesty-wired uniformly. */
export function buildSoloRoster<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>
): SoloRoster<S, M> {
  return {
    random: buildAgent(engine, randomPolicy<S, M>(), "random"),
    greedy: buildAgent(engine, greedyOnlyPolicy<S, M>(), "greedy"),
    strong: buildAgent(engine, resolveStrongPolicy(engine), "strong"),
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

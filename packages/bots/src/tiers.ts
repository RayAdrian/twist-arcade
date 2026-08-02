// packages/bots/src/tiers.ts — tierPolicy(tier): interprets DifficultyTier (manifest DATA,
// not code — plan §6/§10 "declared as manifest data" is honored precisely by this file
// existing at all: every difficulty knob a game team tunes lives in the DifficultyTier
// object, never in a new bots function). Three orthogonal knobs, each independently settable:
//   1. search budget         — tier.budget (rollouts | deadlineMs), always the TIER's own
//                               value — a tierPolicy ignores whatever budget its caller
//                               passes, since the whole point of a tier is a PINNED search
//                               depth, not a caller-negotiable one.
//   2. blunder rate          — tier.blunder?: { epsilon, temperature } — with probability
//                               epsilon, sample a move from softmax(visits/temperature) over
//                               the underlying search's root visit counts instead of playing
//                               its top choice. Requires the underlying search to report
//                               `stats.rootVisits` (mcts/flat-mc/beam do; random/minimax
//                               mostly don't produce a meaningful visit distribution — see
//                               below).
//   3. policy mix            — tier.policy: PolicySpec, incl. `{ kind: "mix", components }` —
//                               a probability-weighted choice of WHICH underlying policy
//                               decides this particular move, resampled every decision.
//
// SOFTEN (BotRequest.soften?, first-game-softening seam): raises epsilon SPECIFICALLY when
// the underlying policy's own greedy choice is flagged as exploiting this game's twist
// mechanic — never a blanket budget cut, and never touching non-twist decisions, so the bot
// keeps playing the BASE game at full strength throughout. What counts as "twist-exploiting"
// is inherently game-specific knowledge this package cannot have (the top-line rule for this
// package is "consume only GameEngine, no game-specific code") — so it is injected by the
// caller via `TierPolicyOptions.isTwistExploitingMove`, a predicate over (state, move). If a
// game never supplies one, `soften` is a no-op (there is nothing to soften).

import type { Json, Rng, WithEffects } from "@twist-arcade/engine";
import type { DifficultyTier, PolicySpec } from "@twist-arcade/game-spec";
import type { Policy, SearchStats } from "./policy";
import { randomPolicy } from "./random";
import { minimaxPolicy } from "./minimax";
import { mctsPolicy } from "./mcts";
import { beamPolicy } from "./beam";
import { flatMonteCarloPolicy } from "./flat-mc";

/** How much epsilon is raised to when `soften` is active and the greedy move is flagged
 *  twist-exploiting. A fixed, documented constant rather than a new manifest field — see
 *  tiers.ts's module doc and the handoff report for why this wasn't added to GameManifest's
 *  schema (a schema change is an orchestrator-routed decision, per CLAUDE.md §4; this keeps
 *  the behavior working today without preempting that call). Tunable later without any
 *  caller-visible API change. */
const SOFTEN_TWIST_EPSILON = 0.6;

export interface TierPolicyOptions<S extends WithEffects, M extends Json> {
  /** First-game-softening seam: when true, decisions whose greedy move is flagged
   *  twist-exploiting get a RAISED epsilon (see SOFTEN_TWIST_EPSILON); every other decision
   *  is unaffected — the bot still plays the base game at the tier's normal strength. */
  soften?: boolean;
  /** Game-supplied predicate identifying moves that exploit THIS game's specific twist
   *  mechanic. Required for `soften` to do anything; omitting it makes `soften` a no-op. */
  isTwistExploitingMove?: (state: S, move: M) => boolean;
}

function buildPolicy<S extends WithEffects, M extends Json>(spec: PolicySpec, rng: Rng): Policy<S, M> {
  switch (spec.kind) {
    case "random":
      return randomPolicy<S, M>();
    case "minimax":
      return minimaxPolicy<S, M>(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {});
    case "mcts":
      return mctsPolicy<S, M>(spec.explorationC !== undefined ? { explorationC: spec.explorationC } : {});
    case "beam":
      return beamPolicy<S, M>(spec.width !== undefined ? { width: spec.width } : {});
    case "flat-mc":
      return flatMonteCarloPolicy<S, M>(
        spec.rolloutsPerAction !== undefined ? { rolloutsPerAction: spec.rolloutsPerAction } : {}
      );
    case "mix": {
      const total = spec.components.reduce((sum, c) => sum + c.weight, 0);
      if (total <= 0) {
        throw new Error("tierPolicy: a `mix` PolicySpec's component weights must sum to > 0");
      }
      // Weighted choice, resampled fresh every decision (chooseMove is called once per move;
      // this branch runs once per chooseMove invocation of the mix policy itself).
      let roll = rng.next() * total;
      let chosen: PolicySpec = spec.components[0]!.policy;
      for (const component of spec.components) {
        if (roll < component.weight) {
          chosen = component.policy;
          break;
        }
        roll -= component.weight;
      }
      return buildPolicy<S, M>(chosen, rng);
    }
  }
}

/** Softmax sampling over root visit counts, at `temperature` — the blunder mechanism's core,
 *  exported standalone so it can be unit-tested (and reused) independent of search noise.
 *  P(move_i) ∝ exp(visits_i / temperature). Lower temperature -> peakier (closer to argmax);
 *  higher temperature -> flatter (closer to uniform). Deterministic given the same `rng`. */
export function softmaxSample<M extends Json>(
  rootVisits: readonly { move: M; visits: number }[],
  temperature: number,
  rng: Rng
): M {
  if (rootVisits.length === 0) {
    throw new RangeError("softmaxSample: rootVisits must be non-empty");
  }
  if (temperature <= 0) {
    throw new RangeError(`softmaxSample: temperature must be > 0, got ${temperature}`);
  }
  const maxVisits = Math.max(...rootVisits.map((v) => v.visits));
  // Subtract the max before exponentiating (standard softmax stabilization) — purely a
  // numerical-stability step, does not change the resulting distribution.
  const weights = rootVisits.map((v) => Math.exp((v.visits - maxVisits) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < rootVisits.length; i++) {
    if (roll < weights[i]!) return rootVisits[i]!.move;
    roll -= weights[i]!;
  }
  // Floating-point edge case (roll landed exactly on the boundary) — fall back to the last.
  return rootVisits[rootVisits.length - 1]!.move;
}

export function tierPolicy<S extends WithEffects, M extends Json>(
  tier: DifficultyTier,
  opts: TierPolicyOptions<S, M> = {}
): Policy<S, M> {
  return {
    chooseMove(args) {
      const { engine, state, player, rng, clock } = args;
      // The tier's OWN declared budget always wins — a tierPolicy represents a PINNED search
      // depth (that is the entire point of a difficulty tier), not a caller-negotiable one.
      const budget = tier.budget;
      const underlying = buildPolicy<S, M>(tier.policy, rng);
      const { move: greedyMove, stats } = underlying.chooseMove({ engine, state, player, rng, budget, clock });

      const epsilon = resolveEpsilon(tier, opts, state, greedyMove);
      if (epsilon <= 0 || !stats.rootVisits || stats.rootVisits.length === 0) {
        return { move: greedyMove, stats };
      }
      if (rng.next() >= epsilon) {
        return { move: greedyMove, stats };
      }
      const temperature = tier.blunder?.temperature ?? 1;
      const blunderedMove = softmaxSample(
        stats.rootVisits.map((v) => ({ move: v.move as unknown as M, visits: v.visits })),
        temperature,
        rng
      );
      const blunderedStats: SearchStats = { ...stats };
      return { move: blunderedMove, stats: blunderedStats };
    },
  };
}

function resolveEpsilon<S extends WithEffects, M extends Json>(
  tier: DifficultyTier,
  opts: TierPolicyOptions<S, M>,
  state: S,
  greedyMove: M
): number {
  const baseEpsilon = tier.blunder?.epsilon ?? 0;
  if (!opts.soften || !opts.isTwistExploitingMove) return baseEpsilon;
  if (!opts.isTwistExploitingMove(state, greedyMove)) return baseEpsilon;
  return Math.max(baseEpsilon, SOFTEN_TWIST_EPSILON);
}

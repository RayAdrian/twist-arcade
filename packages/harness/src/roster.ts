// packages/harness/src/roster.ts — named 2-player agent resolution (plan §7.1's roster:
// "random, greedy, mcts100|mcts1k|mcts10k, minimax<d>, stall, rush, mirror, plus manifest tier
// ids"). `resolveNamedAgent` turns one of those name strings into a runnable `AgentSpec`; the
// CLI, `runMatchup`, and `suites.ts` all go through this so the roster has exactly one
// implementation of what each name means.
//
// MIRROR IS PER-GAME (plan §6/§7.1) — this file cannot resolve `"mirror"` on its own; a caller
// must supply the game's own `mirrorMove(state, lastOppMove, legalMoves)` (the platform's fixed
// three-argument convention — the harness handoff notes this explicitly: legality depends on
// board config and, for history-dependent games like Fadeout, superko history, so a mirror
// policy needs to see the actual opponent move and the actual current legal set, not guess at
// board symmetry blind). `mirrorAgent()` below wraps one into an `AgentSpec`; `runner.ts`'s game
// loop supplies `lastOppMove` itself (it already tracks the previous ply's move to build
// `GameOutcome`), which is why a mirror `AgentSpec` is a distinct union arm rather than a bare
// bots `Policy` — `Policy.chooseMove` has no "last opponent move" parameter to plumb this
// through, and mirror is the one roster entry that structurally needs it.

import type { Json, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "@twist-arcade/bots";
import {
  greedyOnlyPolicy,
  minimaxPolicy,
  mctsPolicy,
  randomPolicy,
  rushPolicy,
  stallPolicy,
  suicidePolicy,
} from "@twist-arcade/bots";
import type { SearchBudget } from "@twist-arcade/game-spec";

export interface PolicyAgentSpec<S extends WithEffects, M extends Json> {
  readonly kind: "policy";
  readonly name: string;
  readonly policy: Policy<S, M>;
  readonly budget: SearchBudget;
}

export interface MirrorAgentSpec<S extends WithEffects, M extends Json> {
  readonly kind: "mirror";
  readonly name: string;
  /** The platform's pinned three-argument mirror convention (see module doc). `lastOppMove` is
   *  `null` on the mirror seat's very first move of a game (there is nothing to mirror yet —
   *  the game-local `mirrorMove` must handle that case, e.g. by playing center/any opening).
   *
   *  RETURN TYPE IS `M | null` (docs/plans/degeneracy-probes.md, C64 finding): every shipped
   *  game's `mirrorMove` (`probes.ts`) is documented to return `null` when there is no opponent
   *  move yet to mirror, or the reflected target is no longer legal — "the harness's mirror-bot
   *  policy falls back to a random legal move in either case" (each game's own doc comment
   *  states this convention verbatim). `runner.ts`'s `playOneGame` is what actually implements
   *  that fallback.
   *
   *  FIXED (platform-corrections.md C81 / task #26): this was NOT universal until now — Nine
   *  Grids' own `mirrorMove` used to never return `null` at all; it fell back INTERNALLY to
   *  `legalMoves[0]`. That fallback was invisible to the harness (it never saw a `null`, so
   *  `runner.ts`'s own random-legal-move substitution never fired for Nine Grids) and
   *  substantially more frequent in practice than Fadeout's or Tilt's — measured fallback rates
   *  through the real matchup shape: tilt 0/80 (0.0%), fadeout 17/61 (27.9%), nine-grids 221/258
   *  (85.7%). Nine Grids' own `mirrorMove` is now aligned to the same null-and-harness-fallback
   *  convention every other game uses (games/nine-grids/probes.ts), and `runner.ts` now counts
   *  every fallback substitution into `GameOutcome.mirrorMoveCount`/`mirrorFallbackCount`,
   *  aggregated into `MatchupReport.metrics.mirrorFallbackRate` (metrics.ts) — a mirror-probe
   *  gate detail (probes-two-player.ts) reads that to disclose how much of a "mirror" row is
   *  actually mirroring vs. deterministic fallback play. */
  readonly mirrorMove: (state: S, lastOppMove: M | null, legalMoves: readonly M[]) => M | null;
}

export type AgentSpec<S extends WithEffects, M extends Json> = PolicyAgentSpec<S, M> | MirrorAgentSpec<S, M>;

function policyAgent<S extends WithEffects, M extends Json>(
  name: string,
  policy: Policy<S, M>,
  budget: SearchBudget
): PolicyAgentSpec<S, M> {
  return { kind: "policy", name, policy, budget };
}

export function mirrorAgent<S extends WithEffects, M extends Json>(
  mirrorMove: (state: S, lastOppMove: M | null, legalMoves: readonly M[]) => M | null
): MirrorAgentSpec<S, M> {
  return { kind: "mirror", name: "mirror", mirrorMove };
}

export class UnknownAgentNameError extends Error {
  constructor(name: string) {
    super(
      `resolveNamedAgent: unknown agent name "${name}". Known: random, greedy, stall, rush, ` +
        `suicide, mcts100|mcts1k|mcts10k, minimax<depth> (e.g. "minimax9"). "mirror" is ` +
        "per-game and cannot be resolved by name — build it with mirrorAgent(mirrorMove) instead."
    );
    this.name = "UnknownAgentNameError";
  }
}

const MCTS_ROLLOUTS: Record<string, number> = {
  mcts100: 100,
  mcts1k: 1_000,
  mcts10k: 10_000,
};

const MINIMAX_NAME = /^minimax(\d+)$/;

/**
 * Resolves a roster name to a runnable `AgentSpec`. Every resolved agent gets a deterministic
 * `{ kind: "rollouts" }` budget (plan §5.2 / orchestrator decision 7's determinism rule) — named
 * roster agents are harness-internal probes and comparisons, never interactive UI tiers, so
 * there is no reason to accept a wall-clock budget here at all.
 */
export function resolveNamedAgent<S extends WithEffects, M extends Json>(name: string): AgentSpec<S, M> {
  if (name === "random") {
    return policyAgent(name, randomPolicy<S, M>(), { kind: "rollouts", n: 1 });
  }
  if (name === "greedy") {
    return policyAgent(name, greedyOnlyPolicy<S, M>(), { kind: "rollouts", n: 1 });
  }
  if (name === "stall") {
    return policyAgent(name, stallPolicy<S, M>({ rolloutsPerAction: 20 }), { kind: "rollouts", n: 200 });
  }
  if (name === "rush") {
    return policyAgent(name, rushPolicy<S, M>(), { kind: "rollouts", n: 1 });
  }
  if (name === "suicide") {
    return policyAgent(name, suicidePolicy<S, M>({ rolloutsPerAction: 20 }), { kind: "rollouts", n: 200 });
  }
  if (name in MCTS_ROLLOUTS) {
    const n = MCTS_ROLLOUTS[name]!;
    return policyAgent(name, mctsPolicy<S, M>(), { kind: "rollouts", n });
  }
  const minimaxMatch = MINIMAX_NAME.exec(name);
  if (minimaxMatch) {
    const maxDepth = Number(minimaxMatch[1]);
    return policyAgent(name, minimaxPolicy<S, M>({ maxDepth }), { kind: "rollouts", n: 1 });
  }
  throw new UnknownAgentNameError(name);
}

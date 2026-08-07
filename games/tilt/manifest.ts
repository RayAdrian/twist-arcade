// games/tilt/manifest.ts — GameManifest (docs/plans/tilt.md §1, §3, §5.3). Data only.
//
// `classic` deliberately says "four-in-a-row", never the trademarked brand name the plan's own
// header warns against ("Drop-four (Connect-Four-family mechanic; never that name, never
// blue-rack/red-yellow trade dress — house palette and a square frame are already distinct)").
//
// `solvedValue` is deliberately omitted (equivalent to `{ value: "unknown" }`, plan §2.2): 7x7
// with rotation is at or above the ~7x10^16 raw-state ceiling for classic 7x6 drop-four, many
// orders beyond the ~10^7 exact-solve ceiling. No C23 gate relief follows — the full [35,65]
// first-player-win-rate band and the other decisiveness gates apply in full once T4 actually
// runs them.
//
// `ciGateBudget.twoPlayerCiRollouts` (T3, plan §5.2/§5.3, C22/C25's provenance rule): set from a
// real pilot against THIS 7x7/win-4/period-4 board — never imported from another game (C25:
// Fadeout's 3,000 and Order vs Chaos's 3,000 are evidence about their own boards only, and this
// happens to land on the same number by coincidence of measurement, not by copying it).
//
// Cost pilot (scripts/research/tilt-t3-cost-pilot.ts, seed "tilt-t3-cost-pilot", n=15,
// TIMING ONLY per C26): 1500->21.1s, 2000->28.2s, 3000->40.9s, 5000->61.4s, 10000->105.6s for
// the full 3-matchup/15-game CI suite. The n=15 gate reads themselves flipped pass/fail
// non-monotonically across candidates (1500 fail, 2000 pass, 3000 pass, 5000 fail, 10000 pass)
// — reproducing C26's exact Order-vs-Chaos lesson (mean-plies at n=15 is noise) rather than
// just citing it, and confirming a verdict may never be drawn at this n.
//
// Validation sweep (scripts/research/tilt-t3-validation-sweep.ts, seed "tilt-t3-validation",
// n=100, same 5 candidates): every candidate reproduces the 10,000-rollout baseline's VERDICT
// (first-player-win-rate stays inside [35,65], mean-plies passes, zero cap hits across all
// three matchups at every candidate) — 1500: 58.0%, 2000: 52.0%, 3000: 48.0%, 5000: 48.0%,
// 10000 (baseline): 38.0%.
//
// FLAGGED, NOT SILENTLY AVERAGED OVER: first-player-win-rate is MONOTONICALLY decreasing as
// rollouts increase (58 -> 52 -> 48 -> 48 -> 38) — a ~20-point drift within the 30-point-wide
// band, too ordered to be simple n=100 sampling noise (P(5 independent draws monotonic by
// chance) = 1/120). Plan §4's own named mechanism is a plausible, UNCONFIRMED explanation: P2
// "aims placements at the imminent re-fall" only once search is deep enough to find that
// aiming move, so shallow budgets may understate the very P2-side offset the balance hypothesis
// depends on. Not yet a proven mechanism (n=100 single-seed) — reported to the orchestrator,
// not resolved here. Chose 3000 over the cheaper 1500/2000 partly for this reason: it sits on
// the trend's more stable plateau (matching 5000's 48% exactly) rather than the noisier, more
// volatile top of the range, while still keeping CI fast (~41s at n=15; validated cost-cheap at
// n=100 per the same pilot). 3000 > standard's 1000 (TierBudgetCollapseError's floor) with
// large margin.
export const CI_GATE_BUDGET_PROVENANCE =
  "T3 pilot on the shipped 7x7/win-4/period-4 board: scripts/research/tilt-t3-cost-pilot.ts + " +
  "tilt-t3-validation-sweep.ts, seeds tilt-t3-cost-pilot/tilt-t3-validation. See this file's " +
  "module doc for the full numbers and the flagged FPA-vs-budget drift.";
//
// `difficultyTiers` below are §8's starting values (100/1,000/10,000 rollouts, all
// deterministic `rollouts` budgets so daily pinning is satisfied by construction) — untuned,
// retuned once T4's design-gate report runs.

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";

export const RULE_SENTENCE = "Every 4th turn the board rotates and every piece falls again.";

export const manifest: GameManifest = {
  id: "tilt",
  title: "Tilt",
  classic: "four-in-a-row",
  ruleSentence: RULE_SENTENCE,
  // "symmetric": the board has left-right reflection symmetry (probes.ts's mirrorMove), though
  // the fixed-CW tilt makes mirroring NOT value-preserving (see probes.ts's own doc) — the tag
  // describes the board's geometry, not a claim that mirroring is a good strategy.
  tags: ["rotation", "symmetric"],
  estMinutes: 4,
  modes: { bot: true, hotseat: true, asyncLink: true },
  players: { min: 2, max: 2 },

  difficultyTiers: [
    {
      id: "casual",
      policy: { kind: "mcts" },
      budget: { kind: "rollouts", n: 100 },
      minReplyMs: 250,
      blunder: { epsilon: 0.3, temperature: 1.5 },
    },
    {
      id: "standard",
      policy: { kind: "mcts" },
      budget: { kind: "rollouts", n: 1000 },
      minReplyMs: 250,
      blunder: { epsilon: 0.08, temperature: 1.0 },
    },
    {
      id: "ruthless",
      policy: { kind: "mcts" },
      budget: { kind: "rollouts", n: 10000 },
      minReplyMs: 250,
    },
  ],

  // Perfect-play value is not established for the shipped 7x7 board (plan §2.2) — no proof
  // artifact, so no C23 gate relief.
  solvedValue: { value: "unknown" },

  // See this file's module doc (top) for the full T3 pilot data and provenance (C25) behind
  // this number, including the flagged FPA-vs-budget drift across candidates.
  ciGateBudget: { twoPlayerCiRollouts: 3000 },
};

assertRuleSentenceLength(manifest);

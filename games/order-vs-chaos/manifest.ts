// games/order-vs-chaos/manifest.ts — GameManifest (plan §5.2, §5 item 11). Data only.
//
// solvedValue is deliberately "unknown" (plan §1.2, §2): the lens's "Order wins 6x6 with
// correct play" claim is a perfect-play hypothesis, not a proof artifact, and 3^36 is far
// beyond the solve ceiling even with symmetry/reachability pruning (plan §2). C23's relief
// mechanism requires a cited proof pointer; there is none here, so no gate relief follows and
// the [35, 65] first-player-win-rate band applies in full once the gate actually runs (OV2).
//
// ciGateBudget.twoPlayerCiRollouts = 3000 (OV2, docs/plans/order-vs-chaos.md §4/§7). Provenance
// (C25 — a budget is evidence about the board it was measured on and nothing else; this number
// was measured on THIS board, not imported from another game or a test fixture):
//
//   1. 15-game cost pilot (scripts/research/order-vs-chaos-ov2-cost-pilot.ts, self-play,
//      rollouts in {100..10000}) — cost only, per C26 (a pilot this small is never a verdict).
//      Its own mean-plies column read non-monotonically across candidates (19.8-28.4, no
//      trend) — sampling noise wider than any real effect at n=15, so it could not be used to
//      pick a budget; it only bracketed the per-game cost curve.
//   2. Budget-validation sweep (scripts/research/order-vs-chaos-ov2-budget-sweep.ts), n=100,
//      ONE fixed seed ("ov2-budget-sweep", C24 — never templated with the rollout count),
//      comparing the shipped 10,000-rollout baseline against a 3,000-rollout candidate
//      (self-play only — first-player-win-rate and mean-plies are both self-play metrics, so
//      the full three-matchup runCiSuite/compareBudgets table was not needed and would have
//      cost 3x for no discriminating benefit). Measured:
//        10,000 rollouts: FPA=84.0%, mean-plies=22.36, capHitRate=0.0% (923.4s/100 games)
//         3,000 rollouts: FPA=84.0%, mean-plies=23.00, capHitRate=0.0% (272.9s/100 games)
//      Criterion (C22's resolution): does the candidate reproduce the baseline's VERDICT — same
//      side of the [35,65] FPA band, mean-plies in the gate's [4,200] band, zero cap hits — not
//      raw numeric closeness (at n=100 a win-rate's 95% interval is roughly +/-10 points, C32).
//      3,000 matched on every axis; it is the cheapest of the two candidates tested, and 2.5x
//      cheaper than the shipped budget for the same measured verdict on this board.
//
// Note this measured FPA (84.0%, both budgets) is itself the plan's §3 kill-rule signal — Order
// lands outside [35,65] on the high side, so the ladder's config B (Chaos moves first) is the
// indicated fallback (§3); that decision is the orchestrator's, made against the real gate table
// (OV2's 100-game run), not this sweep's self-play-only numbers.
//
// difficultyTiers below are the plan's own §5 item 11 starting values (100/1,000/10,000
// rollouts) — untuned, to be retuned against this board's real cost/strength curve once OV4's
// design-gate report runs (same status Nine Grids' own tiers are in).

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";

export const RULE_SENTENCE = "Both players place X or O. Order wins with 5 in a row; Chaos wins if the board fills.";

export const manifest: GameManifest = {
  id: "order-vs-chaos",
  title: "Order vs Chaos",
  classic: "Tic-Tac-Toe",
  ruleSentence: RULE_SENTENCE,
  // "asymmetric": Order and Chaos have different win conditions (role, not just seat, differs).
  // "symmetric": the BOARD is point-symmetric (6x6 has no reflection-fixed cell, so mirroring
  // is available on every move, plan §5 item 10) — CI hard-requires probes.ts's mirrorMove for
  // this tag (see that file's header). The two tags describe different axes and are not in
  // tension: role asymmetry is a rules fact, board symmetry is a geometry fact.
  tags: ["asymmetric", "symmetric"],
  estMinutes: 3,
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

  // Perfect-play is a hypothesis (plan §1.2), not a proof (C14/C23) — no relief without a
  // cited proof artifact.
  solvedValue: { value: "unknown" },

  ciGateBudget: {
    // See this file's module doc above for the full provenance (OV2 cost pilot + n=100
    // validation sweep, measured on THIS board's config A: 6x6/win-5/Order-first, C25).
    twoPlayerCiRollouts: 3000,
  },

  // No exceptions[]: the shipped gate table can judge this game (plan §1.1's ruling, §10 Q1) —
  // no waiver or gate-machinery exception is needed for the ship decision.
};

assertRuleSentenceLength(manifest);

// games/order-vs-chaos/manifest.ts — GameManifest (plan §5.2, §5 item 11). Data only.
//
// solvedValue is deliberately "unknown" (plan §1.2, §2): the lens's "Order wins 6x6 with
// correct play" claim is a perfect-play hypothesis, not a proof artifact, and 3^36 is far
// beyond the solve ceiling even with symmetry/reachability pruning (plan §2). C23's relief
// mechanism requires a cited proof pointer; there is none here, so no gate relief follows and
// the [35, 65] first-player-win-rate band applies in full once the gate actually runs (OV2).
//
// ciGateBudget is deliberately UNSET here — plan §4's derivation (15-game cost pilot -> single-
// seed budget-validation sweep -> ciGateBudget.twoPlayerCiRollouts) is OV2's job, run under
// orchestrator review, not OV1's. Leaving it unset means `runCiSuite`/`runTwoPlayerCiGate` will
// correctly REFUSE to run the "ci" suite for this game until OV2 sets it (the shipped
// `ruthless` tier's 10,000 rollouts exceeds `MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE`, C22) — that
// refusal is the intended behavior, not a gap: OV1 explicitly does not run the gate table
// (standing instruction).
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

  // No exceptions[]: the shipped gate table can judge this game (plan §1.1's ruling, §10 Q1) —
  // no waiver or gate-machinery exception is needed for the ship decision.
};

assertRuleSentenceLength(manifest);

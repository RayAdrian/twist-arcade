// games/bid-tac-toe/manifest.ts — GameManifest (plan §5.2). Data only.
//
// title/classic/ruleSentence are pinned by the plan itself (header + §1), not placeholders.
// tags/estMinutes are B1's best honest guess, not measured — revisit at B4. difficultyTiers'
// `n` values are the plan §7 STARTING values only ("B3 tunes until tier ordering holds at
// shipped budgets"), unchanged here.

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";
import { MIRROR_PROBE_NOT_APPLICABLE_REASON } from "./probes";

export const RULE_SENTENCE = "No turns — bid chips each round; the higher bid pays and plays.";

export const manifest: GameManifest = {
  id: "bid-tac-toe",
  title: "Bid-Tac-Toe",
  classic: "Tic-Tac-Toe",
  ruleSentence: RULE_SENTENCE,
  // No "symmetric" tag: the board is spatially symmetric but the bid axis (budgets/star) is
  // not reflectable, so probes.ts exports no mirrorMove at all (its earlier scaffold
  // placeholder — legal-but-not-a-real-mirror — is gone) — a per-cell reflection has no
  // meaningful analogue for a bid move. See `mirrorProbe` below (platform-corrections.md
  // C48, routed at C62): the harness reports this as n/a citing the reason, not a WARN.
  tags: ["bidding", "simultaneous"],
  estMinutes: 3,
  modes: { bot: true, hotseat: true, asyncLink: false }, // plan §3.1: async needs a pending-
  //   commitment mechanism C21's schema doesn't have yet; not built at launch.
  players: { min: 2, max: 2 },

  // platform-corrections.md C48 (ruled), routed at C62: this game's own B1 flag ("the mirror
  // probe will WARN... Ruling: that should be n/a with a reason, not a WARN") finally routed.
  // Same reason string probes.ts's own comment already cites by name — declared once, in the
  // constant, not duplicated.
  mirrorProbe: { applicable: false, reason: MIRROR_PROBE_NOT_APPLICABLE_REASON },

  // Bot tiers (plan §7): all three budgets are `rollouts` (deterministic, daily-pinnable).
  // MCTS-UCT on the JOINT bid-move space is the only shipped search — minimax refuses
  // simultaneous engines by design (packages/bots/src/minimax.ts), and flat-mc's per-player
  // apply is meaningless for a simultaneous ply. STARTING values only, unchanged from the
  // plan's own table: "B3 tunes until tier ordering holds at *shipped* budgets."
  //
  // leafEvaluation: true (platform-corrections.md C92/C95, bid-tac-toe-budget-sweep.md §2 P1):
  // DUCT + leaf evaluation is the winning search configuration this branch exists to measure —
  // C95 found the flag was previously unreachable from any manifest (PolicySpec's mcts arm had
  // no field for it), so setting it here is this game's half of P1's fix.
  difficultyTiers: [
    {
      id: "casual",
      policy: { kind: "mcts", leafEvaluation: true },
      budget: { kind: "rollouts", n: 300 },
      minReplyMs: 250,
      blunder: { epsilon: 0.3, temperature: 1.5 },
    },
    {
      id: "standard",
      policy: { kind: "mcts", leafEvaluation: true },
      budget: { kind: "rollouts", n: 1500 },
      minReplyMs: 250,
      blunder: { epsilon: 0.08, temperature: 1.0 },
    },
    {
      id: "ruthless",
      policy: { kind: "mcts", leafEvaluation: true },
      budget: { kind: "rollouts", n: 10000 },
      minReplyMs: 250,
    },
  ],

  // ciGateBudget.twoPlayerCiRollouts is left UNSET (still). B3's own budget sweep
  // (docs/research/games/bid-tac-toe-b3-report.md §1, C22/C24-safe: one fixed seed, never the
  // swept variable in the seed) ran candidates 1,600 through 10,000 and found `solved-value-
  // reached` failing (0% — self-play never draws) at EVERY one, with `strong-vs-random` getting
  // WORSE as rollouts rise — a platform-level MCTS defect on simultaneous nodes (§2 of that
  // report: packages/bots/src/mcts.ts picks the single most-visited JOINT (row,col) arm rather
  // than aggregating per player's own marginal move), not a signal about which budget is safe.
  // Every number in that sweep describes a badly-played game — setting this field now would be
  // tuning a broken measurement. Revisit once the search defect is fixed (not this game's own
  // scope to fix — packages/bots is shared platform code).

  // B2's exact solve (docs/research/games/bid-tac-toe-solve-report.md): STARTING_BUDGET=8 is a
  // PURE, PROVEN, EXACT draw — 369,802 bid nodes checked, zero impure (Develin-Payne holds
  // exactly for this tie/transfer variant). Unlike Wrap's "none by construction" (C14/C16), this
  // is a proof artifact, not an assertion — C23's relief legitimately applies.
  solvedValue: {
    value: "draw",
    proof: "docs/research/games/bid-tac-toe-solve-report.md §1 (B=8: exact backward induction, " +
      "pure at every bid node — 369,802/369,802 — cross-checked against an independent " +
      "brute-force oracle at B<=3)",
  },
};

assertRuleSentenceLength(manifest);

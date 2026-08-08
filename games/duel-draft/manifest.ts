// games/duel-draft/manifest.ts — GameManifest (plan §5.2, §9, §12 acceptance criterion 12).
// Data only.
//
// `solvedValue` deliberately OMITTED (plan §2.2): the shipped 4x4 board sits at ≥10^8 states
// even after the equal-counts pruning, well past the ~10^7 exact-solve ceiling, and every
// non-terminal node is a matrix-game node whose equilibria are EXPECTED to be mixed (unlike
// Bid-Tac-Toe, where C51 exhaustively confirmed pure saddle points) — an LP per node, not a
// tractable exhaustive solve. Per C23, no `solvedValue` means NO gate relief: all five
// two-player CI gates run for real once D3 measures them.
//
// `ciGateBudget` is DELIBERATELY UNSET here, same as Bid-Tac-Toe's own B1→B3 sequencing
// (platform-corrections.md C48's "flags carried forward": "`ciGateBudget` deliberately unset,
// so gates refuse until B3's sweep sets it. C22 working, not an oversight.") — D1 (this
// engine) is not the stage that runs the timing pilot; D2's `compareBudgets` sweep (plan §8.3)
// is, and it is the only place a real number here would have real provenance (C25: "a number
// is evidence about how it was measured", never imported from another game's board).
//
// `difficultyTiers` below are plan §9's starting values (300/1,500/10,000 rollouts, all
// deterministic `rollouts` budgets so daily pinning holds by construction) — UNTUNED, retuned
// once D3's gate table runs against the real search (plan §9: "D5 tunes until nightly tier
// ordering holds").
//
// tags: DELIBERATELY does not include "symmetric" — see probes.ts's module doc for why this
// game exports no mirrorMove (mirroring is structurally incoherent under `simultaneous: true`
// with no sequential phase to react to, not merely "no reflective symmetry"; tagging
// "symmetric" would make CI hard-require a probe this game has a principled reason not to
// ship). The board DOES have real reflective/rotational geometry (plan §1.7: "8 cells sit on 3
// lines... unusually equal, 8 on 2") — that fact is simply not what the "symmetric" tag gates.

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";

// Plan header, 77 characters, quoted verbatim.
export const RULE_SENTENCE = "Pick cells at the same time — pick the same one and it's destroyed for good.";

export const manifest: GameManifest = {
  id: "duel-draft",
  title: "Duel Draft",
  classic: "Tic-Tac-Toe",
  ruleSentence: RULE_SENTENCE,
  tags: [],
  estMinutes: 3,
  modes: { bot: true, hotseat: true, asyncLink: true },
  players: { min: 2, max: 2 },

  // Bot tiers (plan §9): all three budgets are `rollouts` (deterministic) — a `deadlineMs`
  // budget here would make the daily-mode pinned bot non-comparable across devices. Starting
  // values only; D5 tunes until nightly tier ordering holds (ruthless >= standard >= casual).
  difficultyTiers: [
    {
      id: "casual",
      policy: { kind: "mcts" },
      budget: { kind: "rollouts", n: 300 },
      minReplyMs: 250,
      blunder: { epsilon: 0.3, temperature: 1.5 },
    },
    {
      id: "standard",
      policy: { kind: "mcts" },
      budget: { kind: "rollouts", n: 1500 },
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
};

assertRuleSentenceLength(manifest);

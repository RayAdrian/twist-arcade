// games/nine-grids/manifest.ts — GameManifest (plan §5.2). Data only.
//
// Ultimate Tic-Tac-Toe, strict ruleset (game-theory-lens §1.10, §4 entry 2). "symmetric" is
// tagged because probes.ts's mirrorMove is a real point-reflection (see that file's module
// doc), not the scaffold's play-first-legal-move placeholder.
//
// difficultyTiers below are still the scaffold's placeholder rollout budgets — untuned against
// heuristic.ts's real evaluation. Tuning them against `suite design`'s tier-ordering
// expectation (ruthless >= standard >= casual) is deliberately out of scope for this pass (see
// this game's handoff notes): it needs the harness gates, which are the thing a sibling agent
// is currently making affordable.

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";

export const RULE_SENTENCE = "Where you play in a small board sends your opponent to that board.";

export const manifest: GameManifest = {
  id: "nine-grids",
  title: "Nine Grids",
  classic: "Tic-Tac-Toe",
  ruleSentence: RULE_SENTENCE,
  tags: ["symmetric"],
  estMinutes: 5,
  modes: { bot: true, hotseat: true, asyncLink: true },
  players: { min: 2, max: 2 },

  // Bot tiers (plan §6): all three budgets are `rollouts` (deterministic) per §5.2/§9 — a
  // `deadlineMs` budget here would make the daily-mode pinned bot non-comparable across
  // devices. Tune `n` once `heuristic.ts` is real; these starting values are placeholders.
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

  // CI-only rollout budget (platform-corrections.md C19/C22). The shipped `ruthless` tier
  // above (10,000) exceeds MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE (3000), so `runCiSuite` refuses
  // for suite "ci" without an explicit override — measured, not guessed, via an in-memory
  // manifest clone that never touches the shipped tier (C20 discipline).
  //
  // Measured against the real engine (9x9 board, no solvedValue — full self-play cost, unlike
  // Fadeout's proven-draw shortcut): at n=1,500, self-play cost 9.99s/game (100 games x 3
  // matchups = ~17 min for a full "ci" run) — affordable, and comparable to Fadeout's own
  // shipped 3,000-rollout budget on a much smaller 3x3 board (848s for the same 300-game
  // shape), consistent with C19's "cost scales with cells x plies x rollouts, not cells alone"
  // — Nine Grids' larger board is offset by a smaller effective branching factor (mostly
  // constrained to one 3x3 sub-board) and comparable game length. 1,500 clears the
  // TierBudgetCollapseError floor (standard's own 1,000) with room to spare (1.5x).
  //
  // NOTE: an earlier probe accidentally varied the self-play seed per rollout count, which
  // conflated the budget with which games were played (a 13.3% vs 60.0% FPA swing at n=1,500
  // vs n=2,000, at only 15 games/matchup — not attributable to budget). That data was
  // discarded. This number is chosen on COST alone, measured with a fixed seed; it makes no
  // claim about balance — the real, full 100-game "ci" gate below is the balance measurement.
  ciGateBudget: { twoPlayerCiRollouts: 1500 },
};

assertRuleSentenceLength(manifest);

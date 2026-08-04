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
};

assertRuleSentenceLength(manifest);

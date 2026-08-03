// games/__GAME_ID__/manifest.ts — GameManifest (plan §5.2). Data only.
//
// TODO(you): title, classic, ruleSentence, tags, estMinutes are all placeholders — fill in the
// real ones before this game ships. `assertRuleSentenceLength` below is a hard <=90-char
// constraint (also asserted as a real test in manifest.test.ts — G-12).

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";

export const RULE_SENTENCE = "TODO: describe the twist in one sentence, <=90 characters.";

export const manifest: GameManifest = {
  id: "__GAME_ID__",
  title: "__TITLE__", // TODO(you)
  classic: "TODO", // TODO(you): the classic game this twists, e.g. "Tic-Tac-Toe"
  ruleSentence: RULE_SENTENCE,
  tags: [], // TODO(you): e.g. ["decay"] — add "symmetric" iff mirrorMove (probes.ts) is real
  estMinutes: 2, // TODO(you)
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

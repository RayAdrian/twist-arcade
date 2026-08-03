// games/fadeout/manifest.ts — GameManifest DRAFT (plan §10, F1 deliverable).
//
// NOT wired into games/registry.ts yet: registration is F3 scope (needs the ruleset frozen
// by F2 and the shell's Board/useGame contract, per the plan's "F3 does not start before the
// F2 ruleset freeze" rule). This file exists so the bot-tier data (§6, ruleset-independent) is
// on the record now, without pretending the game is ready to ship — see the TODOs below for
// exactly what F2 must fill in before this manifest is real.

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";

export const RULE_SENTENCE = "Your pieces vanish 3 turns after you place them.";

export const fadeoutManifestDraft: GameManifest = {
  id: "fadeout",
  title: "Fadeout",
  classic: "Tic-Tac-Toe",
  ruleSentence: RULE_SENTENCE,
  tags: ["decay"],
  estMinutes: 2,
  modes: { bot: true, hotseat: true, asyncLink: true },
  players: { min: 2, max: 2 },

  // Bot tiers (plan §6) — ruleset-independent, so these are final now, not draft. All three
  // budgets are `rollouts` (deterministic), never `deadlineMs`, per §6/§9: the daily-mode
  // pinning requirement is satisfied by this choice alone, with no special daily tier needed.
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

  // TODO (F2, orchestrator-reviewed): freeze which of the 8 RulesetConfig combinations ships
  // (plan §1's criteria) and record it here (likely as a tag, e.g. "superko" / "playThrough"
  // — GameManifest has no dedicated ruleset-config field; the shipping RulesetConfig value
  // itself lives wherever the frozen engine is constructed, e.g. games/fadeout/index.ts).
  // TODO (F2): thresholds — only add an override here if the frozen variant's harness numbers
  // need one; leave unset (inherit DEFAULT_HARNESS_THRESHOLDS) until F4 proves otherwise.
  // TODO (F4, iff criterion 5 fires, plan §14 Q2): exceptions[] entry with justification, if
  // no variant lands FPA in band.
};

assertRuleSentenceLength(fadeoutManifestDraft);

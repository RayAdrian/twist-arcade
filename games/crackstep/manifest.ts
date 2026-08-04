// games/crackstep/manifest.ts — GameManifest (plan §5.2), SOLO DAILY-PUZZLE format. Data only.
//
// Rule-sentence ruling (plan §1.3, orchestrator addendum §13 #1): the stone-tile "exception" is
// NOT accepted as a silent one — the floor is a two-material floor and the sentence names the
// material, so it is 100% true rather than 95% true with a silent exception. See §13 #1 for the
// full ruling this sentence embodies.

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";

export const RULE_SENTENCE =
  "Wooden tiles crumble as you leave them — cross the whole floor without stranding yourself.";

export const manifest: GameManifest = {
  id: "crackstep",
  title: "Crackstep",
  classic: "N/A — an original twist on a floor-coverage path puzzle",
  ruleSentence: RULE_SENTENCE,
  tags: ["decay", "path", "daily"],
  estMinutes: 3,
  modes: { bot: false, hotseat: false, asyncLink: false }, // solo games: no opponent modes
  players: { min: 1, max: 1 },
  difficultyTiers: [], // solo games have no bot-tier ladder (there is no opponent)

  solo: {
    format: "daily-puzzle",
    // No moveCap / scoreMonotone here — a puzzle has no score() and terminates STRUCTURALLY
    // (bounded by 2*|crumbling|+1 <= 69 moves, plan §1.5), not via a move-count tripwire.
  },
};

assertRuleSentenceLength(manifest);

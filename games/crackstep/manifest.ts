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
  // No classic-game ancestor: Crackstep is an original design, not a twist on anything (plan
  // §5.2 GameManifest.classic doc). This used to be the string sentinel
  // `"N/A — an original twist on a floor-coverage path puzzle"`; platform-corrections.md C77
  // item 4 scheduled the migration to a real `classic: string | null` type (task #23), which is
  // this change. The sentinel's descriptive half — "an original twist on a floor-coverage path
  // puzzle" — is dropped here rather than carried into a comment nobody reads at display time:
  // there is no field on GameManifest that any shell surface renders as free-form genre-lineage
  // copy (ruleSentence above already states the actual mechanic; tags below already carries
  // "path"), so there is nowhere for that sentence to be DISPLAYED. If a future design wants a
  // rendered "why this exists" blurb, that's a new field with its own display surface, not a
  // repurposed `classic`.
  classic: null,
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

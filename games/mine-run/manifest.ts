// games/mine-run/manifest.ts — GameManifest (mine-run.md §13's DoD list, §1's frozen rule
// sentence, §8.4/O2's cell-size exception). Mine Run is a solo score chase (`players.max === 1`,
// `meta.maxPlayers === 1`) with NO opponent at all — there is nothing to play "against" but the
// board and the budget, so `modes` is all-false and `difficultyTiers` is empty, mirroring the
// established solo-fixture convention (packages/shell/test/fixtures/crackstep-definition.ts).

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";
import { mineRun } from "./engine";

/** Frozen (plan §1, 82 chars) — the ONE canonical sentence, printed on the rule card, the
 *  library card, and the OG description (byte-identical everywhere, per the platform contract). */
export const RULE_SENTENCE = "Reveal squares to grow a streak; bank anytime — a mine wipes your unbanked streak.";

export const mineRunManifest: GameManifest = {
  id: mineRun.meta.id,
  title: "Mine Run",
  classic: "Minesweeper",
  ruleSentence: RULE_SENTENCE,
  tags: ["press-your-luck"],
  estMinutes: 3,
  // Solo games have no opponent modes at all (game-spec's own manifest.ts comment) — daily/
  // endless framing is shell/daily-team scope, not a "mode" in this sense.
  modes: { bot: false, hotseat: false, asyncLink: false },
  players: { min: 1, max: 1 },
  // No bot to tier — Mine Run has no opponent (mirrors the crackstep solo fixture convention).
  difficultyTiers: [],

  solo: {
    format: "score-chase",
    // R12: structurally bounded at <= 2*budget + 1 = 121 moves for the launch config; 400 is a
    // pure tripwire (plan §1.1), never the terminator.
    moveCap: 400,
    // score() === banked, which only ever grows (R6/R7 never subtract from it) — monotone.
    scoreMonotone: true,
    // R5: escalation is polynomial (triangular), not exponential, so score stays close enough
    // to linear-in-achievements for the ratio gates; no proxy needed (contrast Fadeout's
    // n/a-for-2P-games or a 2048-family exponential-score game, which WOULD need one).
    comparisonMetric: "score",
  },

  // O2 (orchestrator addendum, 2026-08-02): the 32px cell exception is granted CONDITIONALLY —
  // mandatory two-tap commit on every platform (games/mine-run/ui/Board.tsx implements this via
  // the shell's Cell `armed`/`onArm` seam). Recorded here so the exception is visible in review,
  // per platform-corrections.md's own framing ("the shell team is being informed their
  // constraint has one sanctioned violation and why").
  exceptions: [
    {
      gate: "cell-size-48px",
      justification:
        "10-column board; a 320px viewport cannot reach the 48px floor without either shrinking " +
        "the board (which would change mine density and the whole Always-Safe gap the design " +
        "depends on) or overflowing the viewport. Mitigated by mandatory two-tap commit on every " +
        "platform (tap/Enter stages, a second tap/Enter on the same cell commits) plus an " +
        "enlarged, outlined confirm affordance on the staged cell — a mis-tap here doesn't cost a " +
        "turn, it hits a mine and wipes an unbanked streak, so the mitigation is load-bearing, " +
        "not cosmetic.",
    },
  ],
};

assertRuleSentenceLength(mineRunManifest);

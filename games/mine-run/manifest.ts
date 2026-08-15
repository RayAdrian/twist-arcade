// games/mine-run/manifest.ts — GameManifest (mine-run.md §13's DoD list, §1's frozen rule
// sentence). Mine Run is a solo score chase (`players.max === 1`, `meta.maxPlayers === 1`) with
// NO opponent at all — there is nothing to play "against" but the board and the budget, so
// `modes` is all-false and `difficultyTiers` is empty, mirroring the established solo-fixture
// convention (packages/shell/test/fixtures/crackstep-definition.ts).
//
// NO manifest exceptions (revised from the plan's O2 — see games/mine-run/ui/Board.tsx's module
// doc for the full reasoning). mine-run.md §8.4/O2 pre-authorized a 32px cell-size-48px exception
// conditioned on mandatory two-tap commit. That exception is withdrawn here, on the same grounds
// platform-corrections.md C50 withdrew the analogous exception once granted to Tilt: BoardShell's
// natural-size zoom/pan mechanism (built for Nine Grids' 9x9 board, C38) renders every cell at
// the real 48px floor and lets the frame scroll instead, with zero per-cell shrinkage — and,
// concretely for Mine Run, the OLD 32px exception never actually made the board fit a 320px
// viewport either (10*32 + 9*4 = 356px vs. a ~288px frame — still 24% over), so an
// overflow-handling mechanism was always required regardless of which floor was chosen. Flagged
// for review as a documented deviation, not a silent one.

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

  // No exceptions (see this file's module doc — the O2 cell-size-48px exception is withdrawn;
  // Board.tsx renders every cell at the shell's standard 48px floor via BoardShell's zoom/pan).

  // platform-corrections.md C23: no solve exists for Mine Run (a score chase with no single
  // "solved" terminal value — R5/R6/R7 make banked monotone and unbounded, so there is no
  // "optimal outcome" to prove the way Fadeout proved an exact draw). `{ value: "unknown" }` IS
  // the default when this field is omitted entirely, but it is declared explicitly here rather
  // than left implicit — the same "explicit N/A over silent omission" discipline C2 established
  // for inapplicable gates, extended to this claim. Grants NO gate relief; do not change this
  // without a proof artifact this manifest can point to (the harness refuses a non-"unknown"
  // claim with no `proof`, and `solved-value-reached` fails a false one — see suites.ts).
  solvedValue: { value: "unknown" },

  // platform-corrections.md C19/C22: CI-only rollout budget for the hidden-info solo-chase
  // lane. UNLIKE Fadeout's 3x3 board, this number is NOT freely scalable down — Mine Run's
  // hiddenInformation:true engine couples this rollout count directly to the determinization
  // sample count K (K = n / root branching factor, packages/bots/src/determinized-flat-mc.ts),
  // and the harness refuses (HiddenInfoBudgetTooLowError) below the empirically-set floor of
  // MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE = 8 samples/candidate.
  //
  // Measured against the 10x10/20-mine/budget-60 board (not the smaller 6x6/36-cell fixture
  // packages/harness/test/ci-gates.test.ts uses to prove 320 is viable there — that number is
  // NOT transferable here): `engine.legalMoves(engine.setup(1, rngFromSeed(<the harness's own
  // fixed probe seed>)), 0).length` = 87 root legal moves (the opening reveal is wide open;
  // the board's actual initial-safe-reveal flood fill varies this roughly 58-90 seed to seed,
  // so 87 is a representative near-worst-case, matching the guard's own stated conservative
  // intent). Floor: 8 * 87 = 696. 750 clears it with a real (if modest) margin — K ≈ 8.62 at
  // the guarded seed, vs K ≈ 11.36 at the platform default of 1000. This buys only a ~25% cut
  // versus leaving this unset, because the branching-factor floor sits close to the default —
  // unlike Fadeout, board-scaling relief here is capped by K, not by rollout count alone. See
  // the gate-run report for the wall-clock consequence: seed count x move count dominate this
  // game's CI cost far more than the rollout budget does, and this field cannot touch either.
  //
  // STALE INPUT, FLAGGED RATHER THAN SILENTLY CARRIED (found while wiring the UI, not fixed
  // here): the "87 root legal moves" measurement above predates C46/C52's freeze at 22%/75 —
  // it was taken at the 20%/60 pair engine.ts's DEFAULT_MINES/DEFAULT_BUDGET shipped until this
  // pass. A denser board (22% vs 20%) tends to produce a SMALLER opening flood on average, which
  // would lower the root branching factor and could narrow (or, in the worst case, erase) the
  // 8.62x margin this floor claims. `soloChaseCiRollouts: 750` is left UNCHANGED here — recomput-
  // ing the 87-move probe and the resulting K margin against the real 22%/75 board is a harness/
  // gate-table concern, not a board-UI one, and re-deriving it without measuring would be exactly
  // the "comment asserting an invariant the code doesn't verify" failure this codebase keeps
  // finding. Recommend the orchestrator route a re-measurement to whichever team owns
  // ciGateBudget before this number is trusted again.
  ciGateBudget: {
    soloChaseCiRollouts: 750,
    // platform-corrections.md C27: Strong-dependent solo-chase gates (strongVsRandomRatio,
    // distributionOverlap, strongVsGreedyRatio, strongScoreCV, alwaysSafeVsStrong,
    // medianRunLength, capHitRate, ceilingPileUp) are too expensive to measure for real at
    // suite "ci" on the real board — measured ~165s/seed at rollouts=750 (up to 83min/seed at
    // higher search, a 7.5x seed-to-seed spread), so ~4.6h at the standard seedCount=100 floor.
    // Deferred to nightly; CI keeps what's genuinely cheap (the contract/redaction/view-
    // honesty/manifest suite, ~2.7s, and grindProbe, ~0.5s). This is independent of C30's fix
    // to WHICH value Strong's rollouts consult — the cost is dominated by seed count x
    // decisions-per-game x rollouts-per-decision, not by the value function, so the deferral
    // was always going to be needed regardless of how C30 resolved.
    deferGatesToNightly: {
      reason:
        "Strong-dependent; ~165s/seed at soloChaseCiRollouts=750 on the real 10x10/20-mine " +
        "board (up to 83min/seed at higher search) — ~4.6h at seedCount=100 in CI — " +
        "platform-corrections.md C27",
      // platform-corrections.md C70: the day THIS deferral (this exact reason/gate set) was
      // declared — git-verified, not guessed: `git log -S deferGatesToNightly --format="%H %ad"
      // -- games/mine-run/manifest.ts` finds a29772a1 "feat(harness): C27 — the 'deferred' gate
      // status, both lanes" and c8f88609 "feat(mine-run): board UI, registration, and the
      // config the gates actually froze", both dated 2026-08-07 — the commit that first gave
      // this game a `deferGatesToNightly` block. Anchoring the deferral-discharge ledger here
      // (rather than to whatever day the ledger mechanism happens to first run) is the whole
      // point: C68 found nightly has never once completed, so this deferral has been
      // undischarged since 2026-08-07, not since whenever this comment was added.
      since: "2026-08-07",
    },
  },
};

assertRuleSentenceLength(mineRunManifest);

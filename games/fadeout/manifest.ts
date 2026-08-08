// games/fadeout/manifest.ts — GameManifest (plan §10), FROZEN for registration (F3).
//
// Ruleset freeze (orchestrator decision, 2026-08-03, per docs/research/games/fadeout-solve-
// report.md §1.1/§3.1): `remove-first` / solid (`playThrough: false`) / **threefold**.
//
// Why threefold and not the solve report's own top recommendation (superko): the solve report
// recommends `remove-first/solid/superko` but flags its C1 (superko) value as UNPROVEN — an
// 8-minute exact search exhausted its budget without converging (62.2M nodes) and the report
// explicitly refuses to ship an unproven claim (§1.5, per plan §2.3's standing instruction).
// `remove-first/solid/threefold` is the same game's C2 sibling, whose value IS exactly proven:
// **draw, every one of the 9 openings a draw** (report §1.1's threefold row: "yes (pass 1 IS
// exact here)"). Shipping the proven config rather than the recommended-but-unproven one means:
//   - criterion 1 (plan §1) is satisfied on EVIDENCE, not a plausibility argument: there is no
//     forced win anywhere to quote, for either repetition rule, so quotability is moot either way.
//   - no pie rule: every opening is already a draw, so there is no first-player advantage to
//     correct (report §3.2 — the pie rule's FPA/near-balanced-opening gate has nothing to fire on
//     when the WHOLE table is draws).
//   - no 4x4/cap-4 escalation: that escalation is triggered by the quotability trap (a forced win
//     that IS quotable) or by criterion 5 (no variant survives at all) — neither applies here.
// If a future superko proof (or F4's statistical C1-vs-C2 comparison) shows the superko sibling
// is ALSO a clean draw, revisit; until then this is the only proven-exact, criterion-1-clean
// variant on record, and is the one wired into games/registry.ts.

import type { GameManifest } from "@twist-arcade/game-spec";
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";
import type { RulesetConfig } from "./engine-internal";

export const RULE_SENTENCE = "Your pieces vanish 3 turns after you place them.";

/** The one shipping ruleset (see the freeze note above). `games/fadeout/index.ts` and
 *  `games/registry.ts` both construct their engine instance from this single constant so the
 *  shipped config can never drift between the two call sites. */
export const FADEOUT_RULESET_CONFIG: RulesetConfig = {
  decayTiming: "remove-first",
  playThrough: false,
  repetition: "threefold",
};

export const fadeoutManifest: GameManifest = {
  id: "fadeout",
  title: "Fadeout",
  classic: "Tic-Tac-Toe",
  ruleSentence: RULE_SENTENCE,
  tags: ["decay"],
  estMinutes: 2,
  modes: { bot: true, hotseat: true, asyncLink: true },
  players: { min: 2, max: 2 },

  // Bot tiers (plan §6) — ruleset-independent. All three budgets are `rollouts`
  // (deterministic), never `deadlineMs`, per §6/§9: the daily-mode pinning requirement is
  // satisfied by this choice alone, with no special daily tier needed.
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

  // No `thresholds` override: DEFAULT_HARNESS_THRESHOLDS apply.
  // No `exceptions[]`: criteria 1/2 (plan §1) are both satisfied on proven evidence (see the
  // freeze note above) — this is not a criterion-5 (no variant survives) situation. `exceptions[]`
  // would also be the WRONG mechanism here regardless (platform-corrections.md C23 ruling): an
  // exception says "permitted to fail," which reads identically whether a game is proven drawn
  // or merely disappointing. `solvedValue` below is the correct one — it says WHY, with a proof.

  // CORRECTED under platform-corrections.md C23 (this comment previously predicted the RIGHT
  // problem and the WRONG fix — see C23's own text: "the comment was right, and it was a
  // comment, so nothing acted on it"). `remove-first/solid/threefold` is an EXACT-SOLVED draw
  // (docs/research/games/fadeout-solve-report.md §1.1: 128,170 states, all 9 openings drawn) —
  // not a plausibility argument, a proof. A witnessed sweep (100 games at 10,000/8,000/5,000/
  // 3,000 rollouts; 50/25 games at 10,000 rollouts) found IDENTICAL self-play behaviour at
  // every point: 100% draw rate, 0% first-player win rate, 100% strong-vs-random. The bots are
  // correctly reaching the proven value at every budget; three CI gates
  // (first-player-win-rate, draw-rate, ruthless-vs-standard) were unsatisfiable by construction
  // and failing on CORRECT play. `solvedValue` below makes those three report `n/a` (citing
  // this proof) and activates the inverted `solved-value-reached` gate instead — the real
  // regression signal for a decided game (packages/harness/src/suites.ts's
  // `SOLVED_VALUE_SELF_PLAY_FLOOR`).
  solvedValue: {
    value: "draw",
    proof:
      "docs/research/games/fadeout-solve-report.md §1.1 (remove-first/solid/threefold: draw, 128,170 states, all 9 openings drawn)",
    // ADDED under platform-corrections.md C57 — has NO effect on today's output (self-play is
    // at 100%, comfortably above SOLVED_VALUE_SELF_PLAY_FLOOR, so `solved-value-reached` takes
    // the unchanged "reached" branch regardless of whether a baseline is declared). It matters
    // for the FUTURE: without it, a real regression here (draw rate falling to, say, 70%) would
    // render as the harness's "unattained" status ("never established a baseline") rather than
    // the loud "fail" a genuine regression demands — collapsing exactly the two claims C57
    // exists to keep apart, in the one game this gate was originally built to protect. The rate
    // and proof below are the C23 sweep's own witnessed numbers, cited the same way `proof`
    // above is.
    attainmentBaseline: {
      rate: 1.0,
      proof:
        "platform-corrections.md C23 sweep: self-play reached the proven draw at EXACTLY 100% across all six tested points (25-100 games, 3,000-10,000 rollouts, zero variance)",
    },
  },

  // CI-only rollout budget (platform-corrections.md C19/C22/C23). The same witnessed sweep
  // found every tested rollout count reaches the IDENTICAL verdict — no budget was ever
  // "unsafe" here, so the cheapest one measured is simply correct: 100 games x 3,000 rollouts
  // costs 848s against the shipped 10,000-rollout budget's 2802s for the same answer (3.3x
  // cheaper). The shipped `ruthless` tier above (10,000) is UNCHANGED — this only scales what
  // the CI ("ci") suite measures with, via an in-memory clone (C20: "the shipped ruthless tier
  // was never touched"); nightly always runs the real, full 10,000-rollout budget.
  ciGateBudget: { twoPlayerCiRollouts: 3000 },
};

assertRuleSentenceLength(fadeoutManifest);

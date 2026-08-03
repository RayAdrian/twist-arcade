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
import { assertRuleSentenceLength } from "@twist-arcade/game-spec";
export const RULE_SENTENCE = "Your pieces vanish 3 turns after you place them.";
/** The one shipping ruleset (see the freeze note above). `games/fadeout/index.ts` and
 *  `games/registry.ts` both construct their engine instance from this single constant so the
 *  shipped config can never drift between the two call sites. */
export const FADEOUT_RULESET_CONFIG = {
    decayTiming: "remove-first",
    playThrough: false,
    repetition: "threefold",
};
export const fadeoutManifest = {
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
    // No `thresholds` override: DEFAULT_HARNESS_THRESHOLDS apply until F4's harness numbers (not
    // this pass's scope — F3 is board UI + registration, not tier tuning/validation) show one is
    // needed. NOTE for F4, recorded here so it isn't rediscovered from scratch: a root value that
    // is a proven draw under optimal play is expected to pull the MEASURED draw rate (mcts self-
    // play, not the exact-solve 100%) toward the high end of — or past — the default 0.60
    // `maxDrawRate` ceiling; if F4's numbers land there, the fix is an `exceptions[]` entry with
    // that reasoning on the record (plan §2.3's "never ship a silent decisive/threshold claim" — a
    // proven-draw root is exactly the kind of fact that belongs in the justification), not a
    // silently loosened default.
    // No `exceptions[]`: criteria 1/2 (plan §1) are both satisfied on proven evidence (see the
    // freeze note above) — this is not a criterion-5 (no variant survives) situation.
};
assertRuleSentenceLength(fadeoutManifest);

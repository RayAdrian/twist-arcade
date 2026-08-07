// packages/harness/test/suites.test.ts — TDD anchor: the roadmap §6 two-player CI gate table,
// wired as failing assertions (plan §7.5). Red first: suites.ts does not exist yet.
//
// STANDING WARNING THIS FILE EXISTS TO ANSWER (project convention, restated because it is the
// single most important property of a gate module): a gate never observed failing is not a
// gate. For every threshold this module enforces, there is a test below that plants a
// violation of EXACTLY that threshold (nothing else) and asserts the resulting status is
// "fail" (or "warn" for the PR-budget ruthless-vs-standard gate) — never silently "pass" or
// "n/a". `evaluateCiGates` is tested as a pure function first (hand-built `GateInputs`, no real
// self-play needed to plant a precise violation); a smaller end-to-end test at the bottom
// proves `runCiSuite` really wires a real matchup into it, using a deliberately-sabotaged
// "ruthless" tier (== randomPolicy) that must trip strong-vs-random for real.

import { describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";
import type { GameManifest, SolvedValueClaim } from "@twist-arcade/game-spec";
import {
  compareBudgets,
  EmptyExceptionJustificationError,
  evaluateCiGates,
  hasDeferredGates,
  MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE,
  MissingCiRolloutBudgetError,
  MissingSolvedValueProofError,
  runCiSuite,
  SOLVED_VALUE_SELF_PLAY_FLOOR,
  SuiteFailedError,
  TierBudgetCollapseError,
  TwoPlayerDeferredGateAtNightlyError,
  worstCapHitRate,
  type GateInputs,
} from "../src/suites";
import type { MatchupReport } from "../src/runner";
import { formatCiSuiteTable } from "../src/report";

// A GateInputs value that passes EVERY gate cleanly — every planted-violation test below
// starts from a clone of this and perturbs exactly one field, so a test failure always
// isolates to the one threshold it claims to be testing.
const HEALTHY: GateInputs = {
  strongVsRandomWinRate: 0.95,
  firstPlayerWinRate: 0.5,
  drawRate: 0.2,
  meanPlies: 20,
  capHitRate: 0,
  ruthlessVsStandardWinRate: 0.7,
};

function statusOf(inputs: GateInputs, gate: string, suite: "ci" | "nightly" = "ci") {
  const gates = evaluateCiGates(inputs, DEFAULT_HARNESS_THRESHOLDS, [], suite);
  const found = gates.find((g) => g.gate === gate);
  if (!found) throw new Error(`test setup error: no gate named "${gate}" in ${JSON.stringify(gates)}`);
  return found.status;
}

describe("evaluateCiGates() — healthy baseline", () => {
  it("every APPLICABLE gate passes when every metric is comfortably inside its band", () => {
    // UPDATED under C23 (platform-corrections.md): `evaluateCiGates` now always reports a
    // "solved-value-reached" row (C2's "never silently skipped" rule), and HEALTHY carries no
    // `solvedValue` — that row is correctly "n/a" ("no proven manifest.solvedValue — nothing to
    // confirm"), not "pass". n/a is not a lesser pass; it is a DIFFERENT, deliberately distinct
    // status for a gate that does not apply, which is the entire point of C2/C23's rule — so a
    // blanket "every gate is pass" assertion is now the wrong test for this fixture. Every gate
    // that DOES apply to a solvedValue-less manifest still passes; the one gate that does not
    // apply is checked separately, for its own correct status.
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    for (const g of gates) {
      if (g.gate === "solved-value-reached") {
        expect(g.status, `gate ${g.gate}: ${g.detail}`).toBe("n/a");
        continue;
      }
      expect(g.status, `gate ${g.gate}: ${g.detail}`).toBe("pass");
    }
  });
});

describe("evaluateCiGates() — planted violations, one gate at a time", () => {
  it("strong-vs-random: < 0.90 fails", () => {
    expect(statusOf(HEALTHY, "strong-vs-random")).toBe("pass"); // control
    expect(statusOf({ ...HEALTHY, strongVsRandomWinRate: 0.89 }, "strong-vs-random")).toBe("fail");
  });

  it("first-player-win-rate: outside [0.35, 0.65] fails, on EITHER side", () => {
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.34 }, "first-player-win-rate")).toBe("fail");
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.66 }, "first-player-win-rate")).toBe("fail");
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.35 }, "first-player-win-rate")).toBe("pass"); // boundary inclusive
  });

  it("draw-rate: > 0.60 fails", () => {
    expect(statusOf({ ...HEALTHY, drawRate: 0.61 }, "draw-rate")).toBe("fail");
    expect(statusOf({ ...HEALTHY, drawRate: 0.6 }, "draw-rate")).toBe("pass"); // boundary inclusive
  });

  it("mean-plies: outside [4, 200] fails", () => {
    expect(statusOf({ ...HEALTHY, meanPlies: 3 }, "mean-plies")).toBe("fail");
    expect(statusOf({ ...HEALTHY, meanPlies: 201 }, "mean-plies")).toBe("fail");
    expect(statusOf({ ...HEALTHY, meanPlies: 4 }, "mean-plies")).toBe("pass"); // boundary inclusive
  });

  it("mean-plies: ANY cap hit fails, even with an otherwise-fine mean", () => {
    expect(statusOf({ ...HEALTHY, capHitRate: 0.01 }, "mean-plies")).toBe("fail");
  });

  it("ruthless-vs-standard: < 0.60 warns on the ci (PR-budget) suite...", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: 0.59 }, "ruthless-vs-standard", "ci")).toBe("warn");
  });

  it("...but hard-fails on the nightly suite", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: 0.59 }, "ruthless-vs-standard", "nightly")).toBe(
      "fail"
    );
  });

  it("ruthless-vs-standard: reports n/a (never a silent pass) when there is no standard tier", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: null }, "ruthless-vs-standard")).toBe("n/a");
  });
});

describe("evaluateCiGates() — manifest exceptions (plan §7.5)", () => {
  it("downgrades a would-be fail to warn, with the justification attached, never to a silent pass", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, drawRate: 0.9 },
      DEFAULT_HARNESS_THRESHOLDS,
      [{ gate: "draw-rate", justification: "deliberate near-certain-draw design, see ADR-3" }],
      "ci"
    );
    const drawGate = gates.find((g) => g.gate === "draw-rate")!;
    expect(drawGate.status).toBe("warn");
    expect(drawGate.exceptionJustification).toBe("deliberate near-certain-draw design, see ADR-3");
  });

  it("an exception for a DIFFERENT gate does not touch this one's fail", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, drawRate: 0.9 },
      DEFAULT_HARNESS_THRESHOLDS,
      [{ gate: "mean-plies", justification: "unrelated" }],
      "ci"
    );
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("fail");
  });

  // SHOULD FIX #2: an empty justification is currently accepted, and the report then hides the
  // exception entirely (a bare "[WARN] draw-rate: ..." with no marker at all, indistinguishable
  // from an ordinary warn) — defeating "visible in review, never a silent pass". Refuse it
  // outright instead of downgrading silently.
  it("throws EmptyExceptionJustificationError on an empty justification, even when it would " +
    "match a real failing gate", () => {
    expect(() =>
      evaluateCiGates(
        { ...HEALTHY, drawRate: 0.9 },
        DEFAULT_HARNESS_THRESHOLDS,
        [{ gate: "draw-rate", justification: "" }],
        "ci"
      )
    ).toThrow(EmptyExceptionJustificationError);
  });

  it("throws on a WHITESPACE-only justification too (not just the exact empty string)", () => {
    expect(() =>
      evaluateCiGates(
        { ...HEALTHY, drawRate: 0.9 },
        DEFAULT_HARNESS_THRESHOLDS,
        [{ gate: "draw-rate", justification: "   " }],
        "ci"
      )
    ).toThrow(EmptyExceptionJustificationError);
  });

  it("throws even when NO gate is currently failing — validated up front, not lazily on use", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [{ gate: "draw-rate", justification: "" }], "ci")
    ).toThrow(EmptyExceptionJustificationError);
  });
});

describe("evaluateCiGates() — boundary near-misses probed on BOTH sides (coverage debt, not a bug)", () => {
  // The stage-6 review probed all four of these both ways and found the implementation already
  // correct everywhere — these are the assertions that would catch a future >=/> regression.
  it("strong-vs-random: exactly 0.90 (the threshold itself) passes", () => {
    expect(statusOf({ ...HEALTHY, strongVsRandomWinRate: 0.9 }, "strong-vs-random")).toBe("pass");
  });

  it("first-player-win-rate: exactly 0.65 (the upper band edge) passes", () => {
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.65 }, "first-player-win-rate")).toBe("pass");
  });

  it("mean-plies: exactly 200 (the upper band edge) passes", () => {
    expect(statusOf({ ...HEALTHY, meanPlies: 200 }, "mean-plies")).toBe("pass");
  });

  it("ruthless-vs-standard: exactly 0.60 (the threshold itself) passes on the ci suite", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: 0.6 }, "ruthless-vs-standard", "ci")).toBe("pass");
  });
});

describe("worstCapHitRate() — cap-hit gating must see every matchup run, not just self-play (SHOULD FIX #3)", () => {
  function withCapHit(capHitRate: number): Pick<MatchupReport, "metrics"> {
    return { metrics: { ...HEALTHY_METRICS, capHitRate } };
  }
  const HEALTHY_METRICS: MatchupReport["metrics"] = {
    games: 200,
    firstPlayerWinRate: 0.5,
    drawRate: 0.2,
    winRateBySeat: [0.5, 0.5],
    meanPlies: 20,
    medianPlies: 20,
    p95Plies: 30,
    meanBranchingFactor: 4,
    capHitRate: 0,
  };

  it("takes the max across matchups — a clean self-play must not hide a dirty vs-random", () => {
    expect(worstCapHitRate([withCapHit(0.15), withCapHit(0), null])).toBe(0.15);
  });

  it("is 0 when every run matchup is clean", () => {
    expect(worstCapHitRate([withCapHit(0), withCapHit(0), null])).toBe(0);
  });

  it("considers ruthlessVsStandard too when it was actually run (not null)", () => {
    expect(worstCapHitRate([withCapHit(0), withCapHit(0), withCapHit(0.4)])).toBe(0.4);
  });

  it("throws rather than silently returning a degenerate value when nothing was run at all", () => {
    expect(() => worstCapHitRate([null, null])).toThrow(RangeError);
  });
});

describe("SuiteFailedError / the overall ok flag (the 'wired as a failing assertion' part)", () => {
  it("ok is true and assertSuiteOk does not throw when every gate passes or warns", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    expect(gates.every((g) => g.status !== "fail")).toBe(true);
  });

  it("SuiteFailedError names every failing gate", () => {
    const err = new SuiteFailedError([
      { gate: "draw-rate", status: "fail", detail: "0.90 > 0.60" },
      { gate: "mean-plies", status: "fail", detail: "cap hit" },
    ]);
    expect(err.message).toContain("draw-rate");
    expect(err.message).toContain("mean-plies");
  });
});

describe("runCiSuite() end-to-end wiring (a real matchup, not a hand-built GateInputs)", () => {
  // Deliberately sabotaged manifest: "ruthless" IS randomPolicy, so vs the roster's own
  // "random" agent it must land near 50% — a real trip of strong-vs-random, proving the
  // wiring (not just the pure evaluator) actually fires.
  const sabotagedManifest: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Sabotaged TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "Sabotaged fixture for suites.test.ts — ruthless tier is literally randomPolicy.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 },
    ],
  };

  it("reports strong-vs-random as a real fail when the manifest's ruthless tier is sabotaged to be random", () => {
    const report = runCiSuite(classicTicTacToe, sabotagedManifest, { games: 40, seed: "suites-test:sabotaged" });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("reports ruthless-vs-standard as n/a when the manifest has no standard tier (never silently passes)", () => {
    const report = runCiSuite(classicTicTacToe, sabotagedManifest, { games: 20, seed: "suites-test:no-standard" });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
  });

  it("a healthy manifest (mcts100 ruthless tier) passes strong-vs-random for real", () => {
    const healthyManifest: GameManifest = {
      ...sabotagedManifest,
      title: "Healthy TTT",
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 200 }, minReplyMs: 0 },
      ],
    };
    const report = runCiSuite(classicTicTacToe, healthyManifest, { games: 30, seed: "suites-test:healthy" });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C19 — CI-gate-only rollout budget scaling.
//
// The gate table's absolute rollout budget was sized against Fadeout's 3x3 board (fast) and
// broke down on Wrap's 6x6 (43+ minutes). The proven fix: measure with a SMALLER rollout
// budget for the "ruthless" tier, at the CI (PR) suite only — never the shipped tier real
// players face, never nightly's full-budget table. `manifest.ciGateBudget.twoPlayerCiRollouts`
// is that override; omitted, behavior is 100% unchanged (Fadeout never needs to touch this).
//
// The Wrap trap this guards against (C20): at a scaled-down 1000, "ruthless" collapsed onto
// "standard"'s OWN 1000-rollout budget — the two tiers became indistinguishable and
// ruthless-vs-standard's 50% was a measurement artifact, not a real result. A tier gate is
// meaningless once two tiers share a budget, so a scaled budget that collapses them must
// refuse loudly (TierBudgetCollapseError) rather than silently emit that meaningless ratio.
// ---------------------------------------------------------------------------------------

describe("runCiSuite() — C19: ciGateBudget.twoPlayerCiRollouts scales ONLY the ci-suite ruthless measurement", () => {
  // A genuinely strong tier (mcts, 5000 rollouts) so a healthy strong-vs-random pass at the
  // FULL budget is not in doubt — the only variable under test is whether the CI-suite
  // override actually gets substituted in place of it. Deliberately NO "standard" tier here —
  // the tier-collapse guard is its own describe block below; this one isolates the scaling
  // substitution itself.
  const manifestNoStandard: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Scaled TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "suites.test.ts C19 fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 5000 }, minReplyMs: 0 },
    ],
    // Absurdly low on purpose: at n=1, MCTS with a single rollout per candidate is barely
    // distinguishable from random — if the ci-suite override is really substituted for the
    // shipped 5000-rollout ruthless tier, strong-vs-random must fail for real.
    ciGateBudget: { twoPlayerCiRollouts: 1 },
  };

  it("suite 'ci' (default) uses the override — a real strong-vs-random regression at the scaled-down budget", () => {
    const report = runCiSuite(classicTicTacToe, manifestNoStandard, {
      games: 30,
      seed: "suites-test:c19:ci-scaled",
      suite: "ci",
    });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("fail");
  });

  it("suite 'nightly' ignores the override and runs the full shipped budget (the plan's 'nightly keeps the full-budget table')", () => {
    const report = runCiSuite(classicTicTacToe, manifestNoStandard, {
      games: 30,
      seed: "suites-test:c19:nightly-full",
      suite: "nightly",
    });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("pass");
  });

  it("no ciGateBudget declared at all, shipped budget within C22's no-override ceiling: behavior is unchanged (a genuinely cheap game never needs this field)", () => {
    // REVISED under C22 (platform-corrections.md): this test originally used a 5000-rollout
    // shipped tier and asserted "a game like Fadeout never needs this" — that premise is
    // exactly the defect C22 found (Fadeout's shipped 10,000-rollout tier ran unscaled for
    // 29+ minutes because nobody was required to set an override). runCiSuite now REQUIRES
    // manifest.ciGateBudget.twoPlayerCiRollouts once the shipped budget exceeds
    // MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE — see the dedicated C22 describe block below for that
    // refusal. This test is narrowed to what its title actually means: a shipped budget that
    // is ALREADY at or under the ceiling is genuinely cheap and still needs no override at all.
    //
    // A fresh literal (not manifestNoStandard minus a field) so this test never accidentally
    // inherits an override via a stray key — "no ciGateBudget" means the property is genuinely
    // absent, not merely destructured away.
    const noOverride: GameManifest = {
      id: "classic-ttt-fixture",
      title: "Scaled TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C19 fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE }, minReplyMs: 0 },
      ],
    };
    const report = runCiSuite(classicTicTacToe, noOverride, {
      games: 30,
      seed: "suites-test:c19:no-override",
      suite: "ci",
    });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("pass"); // full shipped ruthless tier, unscaled (no throw, no override needed)
  });
});

describe("runCiSuite() — C19/C20: a scaled budget that collapses ruthless onto standard fails LOUDLY", () => {
  function manifestWithOverride(standardN: number, ruthlessShippedN: number, ciOverrideN: number): GameManifest {
    return {
      id: "classic-ttt-fixture",
      title: "Collapse TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C19/C20 collapse fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "standard", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: standardN }, minReplyMs: 0 },
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: ruthlessShippedN }, minReplyMs: 0 },
      ],
      ciGateBudget: { twoPlayerCiRollouts: ciOverrideN },
    };
  }

  it("throws TierBudgetCollapseError when the scaled ruthless budget EQUALS standard's own budget (Wrap's exact C20 finding)", () => {
    const manifest = manifestWithOverride(1000, 10000, 1000);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:equal", suite: "ci" })
    ).toThrow(TierBudgetCollapseError);
  });

  it("throws TierBudgetCollapseError when the scaled ruthless budget drops BELOW standard's own budget", () => {
    const manifest = manifestWithOverride(1000, 10000, 500);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:below", suite: "ci" })
    ).toThrow(TierBudgetCollapseError);
  });

  it("does NOT throw when the scaled budget stays strictly above standard's (real separation preserved)", () => {
    const manifest = manifestWithOverride(1000, 10000, 2000);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:safe", suite: "ci" })
    ).not.toThrow();
  });

  it("the nightly suite is immune — it never applies the ci-only override, so it cannot collapse", () => {
    const manifest = manifestWithOverride(1000, 10000, 1000); // would collapse at "ci"
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:nightly-immune", suite: "nightly" })
    ).not.toThrow();
  });

  it("a manifest with no 'standard' tier at all cannot collapse (nothing to collapse onto)", () => {
    const manifest: GameManifest = {
      id: "classic-ttt-fixture",
      title: "No Standard TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C19 no-standard-tier fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { twoPlayerCiRollouts: 1 },
    };
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:no-standard", suite: "ci" })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C22: the CI rollout budget must be required (and refuse loudly when
// absent), not merely available as a knob a team must remember to set. `--game fadeout` at the
// shipped, unscaled 10,000-rollout "ruthless" budget measured past 29 minutes — a 3x3 board,
// the smallest game in the catalogue — because ciGateBudget.twoPlayerCiRollouts is optional
// with no default and Fadeout never set it. A naively COMPUTED scaled default (mirroring
// Wrap's validated 2,000-rollout, 30x-speedup ratio) was tried against Fadeout and rejected:
// self-play at 2,000 rollouts produced mean-plies 40+ / 100% draw-rate / 0% first-player-win —
// a verdict the full 10,000-rollout budget does not produce — proving a scaled-down "ruthless"
// can be too weak a yardstick for THIS game even though the identical ratio was safe for
// Wrap's. So this suite proves the loud-refusal fallback instead: every test below is a
// planted violation (a manifest with no override and an expensive shipped tier) observed
// actually refusing, synchronously, before any self-play runs — never a silent full-cost run.
// ---------------------------------------------------------------------------------------

describe("runCiSuite() — C22: an expensive shipped ruthless budget REQUIRES an explicit CI override", () => {
  function expensiveManifestNoOverride(shippedN: number): GameManifest {
    return {
      id: "expensive-fixture",
      title: "Expensive Fixture",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C22 fixture — an expensive shipped ruthless tier, no CI override.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: shippedN }, minReplyMs: 0 },
      ],
      // Deliberately no ciGateBudget — this is exactly the state every registered game shipped
      // in (platform-corrections.md C22's own finding).
    };
  }

  it("MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE is a real, positive ceiling", () => {
    expect(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE).toBeGreaterThan(0);
  });

  it("refuses loudly, before running any self-play, when the shipped budget exceeds the ceiling and no override is set — proves Fadeout's exact defect is now caught rather than silently run", () => {
    const manifest = expensiveManifestNoOverride(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE + 1);
    // An absurdly large `games` count that would take far too long to actually run for real —
    // if this test completes at all (let alone the sub-second budget the whole suite runs
    // under), the throw fired BEFORE any matchup started, not merely "eventually".
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 1_000_000, seed: "suites-test:c22:missing-required" })
    ).toThrow(MissingCiRolloutBudgetError);
  });

  it("the thrown error names the actual shipped budget and the ceiling, so a reader knows exactly what to fix", () => {
    const manifest = expensiveManifestNoOverride(10_000);
    try {
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:message" });
      expect.fail("expected MissingCiRolloutBudgetError to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingCiRolloutBudgetError);
      const message = (e as Error).message;
      expect(message).toContain("10000");
      expect(message).toContain(String(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE));
      expect(message).toContain("expensive-fixture");
    }
  });

  it("does NOT throw when the shipped budget sits AT the ceiling — a cheap/small game never needs to touch this field (the unchanged, safe pass-through path)", () => {
    const manifest = expensiveManifestNoOverride(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:at-ceiling" })
    ).not.toThrow(MissingCiRolloutBudgetError);
  });

  it("does NOT throw when an explicit ciGateBudget.twoPlayerCiRollouts is present, however low — an active, reviewed choice is never refused by this guard (the tier-collapse guard is the one that polices ITS safety)", () => {
    const manifest: GameManifest = {
      ...expensiveManifestNoOverride(10_000),
      ciGateBudget: { twoPlayerCiRollouts: 500 },
    };
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:override-present" })
    ).not.toThrow(MissingCiRolloutBudgetError);
  });

  it("nightly is exempt unconditionally — the full-budget table always runs there regardless of this ceiling", () => {
    const manifest = expensiveManifestNoOverride(10_000);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:nightly-exempt", suite: "nightly" })
    ).not.toThrow(MissingCiRolloutBudgetError);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C23: the witnessed C22 sweep found IDENTICAL self-play behaviour for
// Fadeout at every tested budget — 100% draw rate, 0% first-player win rate, 100%
// strong-vs-random — because `remove-first/solid/threefold` is an EXACT-SOLVED draw (128,170
// states, all 9 openings drawn; docs/research/games/fadeout-solve-report.md §1.1). Three gates
// (first-player-win-rate, draw-rate, ruthless-vs-standard) were failing FOREVER on correct
// play, at any budget — a guard that goes red while everything is right. This suite proves the
// fix: a proven `manifest.solvedValue` makes exactly those gates report `n/a` (never `pass`,
// never a silent skip — C2's own rule), citing the proof, and a NEW gate inverts the check —
// does self-play actually REACH the proven value, the real regression signal a decided game
// needs. Every threshold here plants a violation and observes it fire, per the standing rule.
// ---------------------------------------------------------------------------------------

const SOLVE_REPORT_PROOF = "docs/research/games/fadeout-solve-report.md §1.1 (remove-first/solid/threefold: draw, 128,170 states, all 9 openings drawn)";

describe("evaluateCiGates — C23: manifest.solvedValue requires a proof pointer", () => {
  it("throws MissingSolvedValueProofError for a claimed value with NO proof, before any gate is evaluated", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "draw" })
    ).toThrow(MissingSolvedValueProofError);
  });

  it("throws for a claimed value with a BLANK (whitespace-only) proof — not just a missing one", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "draw", proof: "   " })
    ).toThrow(MissingSolvedValueProofError);
  });

  it("does NOT throw for value 'unknown' even with no proof — the default grants nothing and demands nothing", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "unknown" })
    ).not.toThrow();
  });

  it("does NOT throw when omitted entirely (the common case — most games have no solved value)", () => {
    expect(() => evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci")).not.toThrow();
  });

  it("does NOT throw once a real proof is provided", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "draw", proof: SOLVE_REPORT_PROOF })
    ).not.toThrow();
  });
});

describe("evaluateCiGates — C23: the three unsatisfiable-by-construction gates go n/a for a proven draw, citing the proof", () => {
  // Fadeout's OWN real numbers from the witnessed C22 sweep (100 x 10,000 baseline row) — the
  // exact inputs that were failing forever before this fix.
  const fadeoutBaseline: GateInputs = {
    strongVsRandomWinRate: 1.0,
    firstPlayerWinRate: 0.0,
    drawRate: 1.0,
    meanPlies: 45.5,
    capHitRate: 0, // isolated from the real 1% cap-hit finding — that is mean-plies' own concern, tested separately below
    ruthlessVsStandardWinRate: 0.0,
  };
  const solvedDraw: SolvedValueClaim = { value: "draw", proof: SOLVE_REPORT_PROOF };

  it("first-player-win-rate is n/a, citing the proof, instead of failing forever on 0%", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "first-player-win-rate")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain(SOLVE_REPORT_PROOF);
  });

  it("draw-rate is n/a, citing the proof, instead of failing forever on 100%", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "draw-rate")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain(SOLVE_REPORT_PROOF);
  });

  it("ruthless-vs-standard is n/a at suite 'ci', citing the proof, instead of WARNing forever on 0%", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain(SOLVE_REPORT_PROOF);
  });

  it("ruthless-vs-standard is ALSO n/a at suite 'nightly' — this is the fix for 'nightly is broken for Fadeout today too' (C23)", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", solvedDraw);
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    // Before this fix: 0% < the 60% min, and suite "nightly" turns that into a hard FAIL (see
    // the un-corrected branch above) — every nightly run for Fadeout was red. Proves it isn't.
    expect(gate.status).toBe("n/a");
  });

  it("mean-plies is UNAFFECTED by solvedValue — it is not one of the three unsatisfiable gates, and still evaluates for real", () => {
    const withCapHit: GateInputs = { ...fadeoutBaseline, capHitRate: 0.01 };
    const gates = evaluateCiGates(withCapHit, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "mean-plies")!;
    expect(gate.status).toBe("fail"); // the real C22-sweep finding: baseline's 1% cap-hit rate genuinely fails this gate
    expect(gate.detail).toContain("across all matchups"); // C23 item 5: disambiguated from a self-play-only number
  });

  it("a proven DECISIVE value (p0-win) leaves draw-rate and ruthless-vs-standard ACTIVE — only first-player-win-rate goes n/a", () => {
    const decisive: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 1.0, // P0 always wins — correct for a proven p0-win
      drawRate: 0.0,
      meanPlies: 10,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.8,
    };
    const solvedP0Win: SolvedValueClaim = { value: "p0-win", proof: "a hypothetical p0-win proof" };
    const gates = evaluateCiGates(decisive, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedP0Win);
    expect(gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("n/a");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("pass"); // still a real, active gate
    expect(gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("pass"); // still a real, active gate
  });

  it("N/A is provably distinguishable from PASS in the RENDERED report — plant-and-observe of the actual formatter, not just the status enum", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const ok = gates.every((g) => g.status !== "fail");
    const rendered = formatCiSuiteTable({ gameId: "fadeout", suite: "ci", ok, gates, matchups: null as never });
    const lines = rendered.split("\n");
    const fpwrLine = lines.find((l) => l.includes("first-player-win-rate"))!;
    const drawRateLine = lines.find((l) => l.includes("draw-rate:"))!;
    const strongVsRandomLine = lines.find((l) => l.includes("strong-vs-random"))!;
    expect(fpwrLine).toContain("[N/A ]");
    expect(fpwrLine).not.toContain("[PASS]");
    expect(drawRateLine).toContain("[N/A ]");
    expect(strongVsRandomLine).toContain("[PASS]"); // the real, still-active gate — visibly different
    expect(strongVsRandomLine).not.toContain("[N/A ]");
  });
});

describe("evaluateCiGates — C23: the inverted 'solved-value-reached' gate — the real regression signal a decided game needs", () => {
  it("SOLVED_VALUE_SELF_PLAY_FLOOR is a real threshold, comfortably below the observed 100% but well above a genuine regression", () => {
    expect(SOLVED_VALUE_SELF_PLAY_FLOOR).toBeGreaterThan(0.5);
    expect(SOLVED_VALUE_SELF_PLAY_FLOOR).toBeLessThan(1.0);
  });

  it("is n/a when there is no proven solvedValue — never silently absent from the report (C2)", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    const gate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(gate).toBeDefined();
    expect(gate.status).toBe("n/a");
  });

  it("passes at the real Fadeout baseline (100% draws) — comfortably clears the floor", () => {
    const fadeoutBaseline: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.0,
      drawRate: 1.0,
      meanPlies: 45.5,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.0,
    };
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: SOLVE_REPORT_PROOF,
    });
    const gate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(gate.status).toBe("pass");
    expect(gate.detail).toContain("100.0%");
  });

  it("PLANTED REGRESSION: a draw rate that drops to 70% FAILS this gate — the orchestrator's own worked example, and the exact case the un-corrected gates would have scored as an IMPROVEMENT", () => {
    const regressed: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.15, // moved TOWARD the old "balanced" band — would have looked better under the old gate
      drawRate: 0.7,
      meanPlies: 20,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.3,
    };
    const gates = evaluateCiGates(regressed, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: SOLVE_REPORT_PROOF,
    });
    const solvedGate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedGate.status).toBe("fail");
    expect(solvedGate.detail).toContain("70.0%");
    // The three C23-corrected gates stay n/a regardless — they are not what catches this. The
    // NEW gate is the only one that does, which is exactly the point.
    expect(gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("n/a");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("n/a");
  });

  it("a proven p0-win checks firstPlayerWinRate directly; a proven p1-win checks its complement", () => {
    const p0Healthy: GateInputs = {
      strongVsRandomWinRate: 1,
      firstPlayerWinRate: 0.95,
      drawRate: 0.02,
      meanPlies: 10,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.7,
    };
    expect(
      evaluateCiGates(p0Healthy, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "p0-win", proof: "p0 proof" }).find(
        (g) => g.gate === "solved-value-reached"
      )!.status
    ).toBe("pass");

    const p1Healthy: GateInputs = { ...p0Healthy, firstPlayerWinRate: 0.05 }; // P1 (second player) wins 95%
    expect(
      evaluateCiGates(p1Healthy, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "p1-win", proof: "p1 proof" }).find(
        (g) => g.gate === "solved-value-reached"
      )!.status
    ).toBe("pass");

    // Mismatched: claiming p1-win but P0 is actually winning — must fail, not silently pass.
    const mismatched: GateInputs = { ...p0Healthy, firstPlayerWinRate: 0.95 };
    expect(
      evaluateCiGates(mismatched, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "p1-win", proof: "p1 proof" }).find(
        (g) => g.gate === "solved-value-reached"
      )!.status
    ).toBe("fail");
  });
});

describe("runCiSuite() — C23 end-to-end: a real proven-draw fixture (classicTicTacToe), not hand-built GateInputs", () => {
  it("classicTicTacToe (a REAL proven draw under optimal play) with solvedValue:draw passes cleanly — n/a where the old gates would have failed forever, pass on solved-value-reached", () => {
    const manifest: GameManifest = {
      id: "classic-ttt-fixture",
      title: "Classic TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C23 end-to-end fixture — a real, known proven draw.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 2000 }, minReplyMs: 0 },
      ],
      solvedValue: { value: "draw", proof: "classic tic-tac-toe is a textbook proven draw under optimal play" },
    };
    const report = runCiSuite(classicTicTacToe, manifest, { games: 40, seed: "suites-test:c23:e2e-ttt-draw" });

    expect(report.gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("n/a");
    expect(report.gates.find((g) => g.gate === "draw-rate")!.status).toBe("n/a");
    expect(report.gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("n/a"); // no "standard" tier here anyway
    const solvedGate = report.gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedGate.status).toBe("pass");
    expect(report.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C26: Nine Grids' first real gate run passed its balance gates
// (FPA 46.0%, draws 30.0%) but reported `[WARN] ruthless-vs-standard: 42.0% (min 60.0%, ci)` —
// the HARDER tier losing to the EASIER one. Nine Grids ships standard=1,000 / ruthless=10,000
// (a real 10x gap) but its ciGateBudget.twoPlayerCiRollouts scales ruthless down to 1,500 for
// suite "ci" — a 1.5x gap against standard's 1,000. `TierBudgetCollapseError`'s strict
// inequality (1500 > 1000) correctly does not fire, but MCTS strength grows roughly with the
// LOG of rollouts, so a 1.5x budget gap is a strength difference noise swallows whole. The
// measured 42.0% is an artifact of the substitution, not a finding about the game — and nightly
// (which never applies the override) would have hard-failed Nine Grids on a number that was
// never meaningful in CI. Fix: when the override is active, this gate reports n/a, naming both
// budgets, instead of a WARN that reads as a real result.
// ---------------------------------------------------------------------------------------

describe("evaluateCiGates/runCiSuite — C26: ruthless-vs-standard reports n/a (not a number) when a CI rollout override is active", () => {
  it("PURE evaluator: n/a, naming BOTH budgets, for Nine Grids' exact numbers (1,500 vs standard's 1,000, measured 42.0%)", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, ruthlessVsStandardWinRate: 0.42 },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      undefined,
      { active: true, ruthlessN: 1500, standardN: 1000 }
    );
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain("1500");
    expect(gate.detail).toContain("1000");
    expect(gate.detail).not.toMatch(/42/); // the misleading figure itself must not appear
  });

  it("PURE evaluator: WITHOUT an active override, the SAME 42.0% still measures normally (warns at ci) — the fix never suppresses a real measurement", () => {
    const gates = evaluateCiGates({ ...HEALTHY, ruthlessVsStandardWinRate: 0.42 }, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("warn");
    expect(gate.detail).toContain("42.0%");
  });

  function nineGridsLikeManifest(ruthlessPolicy: "mcts" | "random" = "mcts"): GameManifest {
    return {
      id: "nine-grids-fixture",
      title: "Nine Grids Fixture",
      classic: "Ultimate Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C26 fixture — Nine Grids' exact tier/override shape.",
      tags: [],
      estMinutes: 3,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "standard", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 1000 }, minReplyMs: 0 },
        { id: "ruthless", policy: { kind: ruthlessPolicy }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { twoPlayerCiRollouts: 1500 },
    };
  }

  it("real runCiSuite, Nine Grids' EXACT manifest shape: suite 'ci' (1,500-rollout override active) reports n/a, never a percentage", () => {
    const report = runCiSuite(classicTicTacToe, nineGridsLikeManifest(), { games: 20, seed: "suites-test:c26:nine-grids-ci" });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain("1500");
    expect(gate.detail).toContain("1000");
    expect(gate.detail).not.toMatch(/%/);
  });

  it("real runCiSuite, SAME manifest, suite 'nightly': the override is ignored — ruthless-vs-standard measures the REAL shipped 10,000-vs-1,000 gap for real, not n/a", () => {
    const report = runCiSuite(classicTicTacToe, nineGridsLikeManifest(), {
      games: 20,
      seed: "suites-test:c26:nine-grids-nightly",
      suite: "nightly",
    });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).not.toBe("n/a");
    expect(gate.detail).toMatch(/%/); // a real, measured percentage
  });

  it("nightly still HARD-FAILS a genuine tier inversion — the exact hazard C26 names ('Nine Grids would pass CI and fail nightly on a number that was never meaningful in CI')", () => {
    // Sabotaged on purpose: ruthless is a RANDOM policy (genuinely the weaker agent) against a
    // real mcts "standard" — nightly ignores ciGateBudget entirely, so this is a real,
    // unscaled measurement, and it MUST still be a hard fail (roadmap §6), proving C26's fix
    // narrows the false-warn case without blinding nightly to a real one.
    const report = runCiSuite(classicTicTacToe, nineGridsLikeManifest("random"), {
      games: 20,
      seed: "suites-test:c26:nightly-real-inversion",
      suite: "nightly",
    });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("fail");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C24: two independent agents, in unrelated worktrees on the same day,
// both hand-rolled a budget comparison by templating the varying rollout count INTO the seed
// string (`c22-sweep:${label}:...rollouts=${rollouts}`, `pilot:nine-grids:${n}:${games}`).
// Since runner.ts derives game i as `${seed}:${i}`, that means every candidate played a
// DIFFERENT set of games, conflating the budget's effect with seed variance. `compareBudgets`
// is the fix: one seed, many candidates, the loop nobody has to hand-roll (or get wrong) again.
// ---------------------------------------------------------------------------------------

describe("compareBudgets — C24: one seed, many rollout candidates, never a hand-rolled per-candidate seed", () => {
  const manifest: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Compare Budgets TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "suites.test.ts C24 fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
    ],
    // Deliberately declares NO ciGateBudget of its own — compareBudgets must supply one per
    // candidate regardless (proving it never depends on the manifest already having one).
  };

  it("returns one point per candidate, in the SAME order, each carrying its own rollout count", () => {
    const points = compareBudgets(classicTicTacToe, manifest, [500, 2000, 5000], {
      seed: "suites-test:c24:order",
      games: 10,
    });
    expect(points.map((p) => p.rollouts)).toEqual([500, 2000, 5000]);
    expect(points).toHaveLength(3);
  });

  it("uses the IDENTICAL seed across every candidate — two candidates with the SAME rollout count produce byte-identical reports, proving determinism and same-seed usage together", () => {
    const points = compareBudgets(classicTicTacToe, manifest, [3000, 3000], {
      seed: "suites-test:c24:same-seed-proof",
      games: 15,
    });
    // Every DECISION-derived field must match exactly (same seed -> same games, same outcomes,
    // same gate verdicts) — `throughputGamesPerSec` is the one field runner.ts's own
    // MatchupReport carries that is NOT decision-derived (report.ts's toMatchupReportJson has
    // the identical exclusion, and for the identical reason: it is a real elapsed-time
    // measurement, expected to vary run to run under a fixed seed).
    const strip = (report: (typeof points)[number]["report"]) =>
      JSON.parse(
        JSON.stringify(report, (key, value: unknown) => (key === "throughputGamesPerSec" ? undefined : value))
      );
    expect(strip(points[0]!.report)).toEqual(strip(points[1]!.report));
  });

  it("never mutates the manifest passed in — shipped difficultyTiers and any pre-existing ciGateBudget are untouched after the call", () => {
    const manifestWithOwnBudget: GameManifest = {
      ...manifest,
      ciGateBudget: { twoPlayerCiRollouts: 999 }, // must survive the call unchanged
    };
    const tiersBefore = JSON.stringify(manifestWithOwnBudget.difficultyTiers);
    const budgetBefore = JSON.stringify(manifestWithOwnBudget.ciGateBudget);
    compareBudgets(classicTicTacToe, manifestWithOwnBudget, [1000, 4000], { seed: "suites-test:c24:no-mutation", games: 10 });
    expect(JSON.stringify(manifestWithOwnBudget.difficultyTiers)).toBe(tiersBefore);
    expect(JSON.stringify(manifestWithOwnBudget.ciGateBudget)).toBe(budgetBefore);
  });

  it("always runs at suite 'ci' — a rollout-budget comparison is a CI-suite-only concept (nightly ignores the override, so every candidate would be identical there)", () => {
    // A candidate low enough that, if suite were somehow "nightly" (which ignores the
    // override), strong-vs-random would run at the full 10,000-rollout shipped budget and pass
    // comfortably. At "ci" it must actually apply the low candidate and can regress for real.
    const points = compareBudgets(classicTicTacToe, manifest, [1], { seed: "suites-test:c24:always-ci", games: 20 });
    const gate = points[0]!.report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("fail");
    expect(points[0]!.report.suite).toBe("ci");
  });

  it("each candidate's report reflects ITS OWN rollout count, not the previous one (a real, observable difference across the sweep)", () => {
    const points = compareBudgets(classicTicTacToe, manifest, [1, 8000], {
      seed: "suites-test:c24:real-difference",
      games: 20,
    });
    const weak = points[0]!.report.gates.find((g) => g.gate === "strong-vs-random")!;
    const strong = points[1]!.report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(weak.status).toBe("fail");
    expect(strong.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C27: Order vs Chaos, Tilt, and Bid-Tac-Toe (docs/plans/) each name
// the `"deferred"` status as a load-bearing dependency for their own balance-gate reporting at
// PR tier — the two-player analogue of Mine Run's solo-chase problem. `manifest.ciGateBudget.
// deferGatesToNightly` skips self-play ENTIRELY at suite "ci" (not scaled down — skipped), and
// every affected row reports `"deferred"`, naming nightly and the manifest's own reason.
// ---------------------------------------------------------------------------------------

const DEFERRAL_REASON = "balance rows cost ~25 min at 100 games/matchup in CI — platform-corrections.md C27";

describe("evaluateCiGates — C27: 'deferred' status, pure evaluator", () => {
  it("every deferrable row reports 'deferred', naming nightly and the reason, when a deferral is active", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      undefined,
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    for (const name of ["strong-vs-random", "first-player-win-rate", "draw-rate", "mean-plies", "ruthless-vs-standard"]) {
      const g = gates.find((x) => x.gate === name)!;
      expect(g.status, `gate ${name}`).toBe("deferred");
      expect(g.detail).toContain("nightly");
      expect(g.detail).toContain(DEFERRAL_REASON);
    }
    // solved-value-reached: HEALTHY carries no solvedValue, so it is n/a (a DIFFERENT, prior
    // reason) rather than "deferred" — proven directly below with its own manifest.
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("n/a");
  });

  it("solved-value-reached ALSO defers when the manifest has a proven value and deferral is active", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      { value: "draw", proof: SOLVE_REPORT_PROOF },
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("deferred");
  });

  it("'deferred' !== 'n/a': a proven-draw's structural n/a rows (FPA, draw-rate, ruthless-vs-standard) stay n/a even with an active deferral — deferral never relabels a row that was already n/a for an unrelated reason", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      { value: "draw", proof: SOLVE_REPORT_PROOF },
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    expect(gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("n/a");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("n/a");
    expect(gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("n/a"); // proven-draw reason, not deferral
    // strong-vs-random and mean-plies have no such structural exemption — they DO defer.
    expect(gates.find((g) => g.gate === "strong-vs-random")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "mean-plies")!.status).toBe("deferred");
  });

  it("ruthless-vs-standard stays n/a ('no standard tier'), never 'deferred', when the manifest genuinely has no standard tier — deferral never invents a row to defer", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, ruthlessVsStandardWinRate: null },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      undefined,
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain("standard");
    expect(gate.detail).not.toContain("nightly");
  });

  it("allGatesPass-equivalent (report.ok) is TRUE for a fully-deferred report — CI can go green with deferred rows; hasDeferredGates is what tells the two apart", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", undefined, undefined, {
      active: true,
      reason: DEFERRAL_REASON,
    });
    expect(gates.every((g) => g.status !== "fail")).toBe(true);
    expect(hasDeferredGates(gates)).toBe(true);
  });

  it("hasDeferredGates is false for a fully-measured (non-deferred) report", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    expect(hasDeferredGates(gates)).toBe(false);
  });

  it("N/A is provably distinguishable from DEFERRED in the RENDERED report — plant-and-observe of the actual formatter, not just the status enum", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      { value: "draw", proof: SOLVE_REPORT_PROOF },
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    const ok = gates.every((g) => g.status !== "fail");
    const rendered = formatCiSuiteTable({ gameId: "ovc-fixture", suite: "ci", ok, gates, matchups: null });
    const lines = rendered.split("\n");
    const fpwrLine = lines.find((l) => l.includes("first-player-win-rate"))!;
    const strongVsRandomLine = lines.find((l) => l.includes("strong-vs-random"))!;
    expect(fpwrLine).toContain("[N/A ]"); // structural, unaffected by deferral
    expect(fpwrLine).not.toContain("[DEFER]");
    expect(strongVsRandomLine).toContain("[DEFER]"); // Strong-dependent, deferred
    expect(strongVsRandomLine).not.toContain("[N/A ]");
    expect(strongVsRandomLine).not.toContain("[PASS]");
  });

  it("ABUSE GUARD: suite 'nightly' with an active deferral throws TwoPlayerDeferredGateAtNightlyError — a row deferred at every tier must be a loud failure, not a quiet status", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", undefined, undefined, {
        active: true,
        reason: DEFERRAL_REASON,
      })
    ).toThrow(TwoPlayerDeferredGateAtNightlyError);
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", undefined, undefined, {
        active: true,
        reason: DEFERRAL_REASON,
      })
    ).toThrow(/never runs/);
  });

  it("nightly with an INACTIVE (or absent) deferral is unaffected by the guard", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", undefined, undefined, {
        active: false,
        reason: DEFERRAL_REASON,
      })
    ).not.toThrow();
    expect(() => evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly")).not.toThrow();
  });
});

describe("runCiSuite — C27: real wiring, no self-play at all when deferral is active", () => {
  function deferrableManifest(withStandardTier: boolean): GameManifest {
    return {
      id: "c27-two-player-fixture",
      title: "C27 Two-Player Fixture",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C27 fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        ...(withStandardTier
          ? [{ id: "standard" as const, policy: { kind: "mcts" as const }, budget: { kind: "rollouts" as const, n: 1000 }, minReplyMs: 0 }]
          : []),
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { deferGatesToNightly: { reason: DEFERRAL_REASON } },
    };
  }

  it("suite 'ci': matchups is null, every deferrable row is 'deferred', and NO MissingCiRolloutBudgetError fires despite the shipped ruthless budget (10,000) exceeding MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE with no twoPlayerCiRollouts override set — because self-play never runs at all", () => {
    const report = runCiSuite(classicTicTacToe, deferrableManifest(true), {
      seed: "suites-test:c27:ci-deferred",
      games: 100,
    });
    expect(report.matchups).toBeNull();
    expect(report.gates.find((g) => g.gate === "strong-vs-random")!.status).toBe("deferred");
    expect(report.gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("deferred");
    expect(report.ok).toBe(true); // no fail — a provisional pass
  });

  it("a manifest with NO standard tier still reports ruthless-vs-standard as n/a (not deferred) under an active deferral", () => {
    const report = runCiSuite(classicTicTacToe, deferrableManifest(false), {
      seed: "suites-test:c27:ci-deferred-no-standard",
      games: 100,
    });
    expect(report.gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("n/a");
  });

  it("suite 'nightly' IGNORES deferGatesToNightly entirely — real self-play runs, matchups is non-null, every row is measured for real (never 'deferred')", () => {
    const report = runCiSuite(classicTicTacToe, deferrableManifest(true), {
      seed: "suites-test:c27:nightly-measures-for-real",
      games: 20,
      suite: "nightly",
    });
    expect(report.matchups).not.toBeNull();
    for (const g of report.gates) {
      expect(g.status, `gate ${g.gate}`).not.toBe("deferred");
    }
  }, 30_000);

  it("PLANTED VIOLATION: a deferred CI run can still be a REAL fail if grind/whatever else the manifest declares stays wired — proven here via a manifest exception's own presence being irrelevant to a hard-coded sabotage: deferral covers self-play rows, so a manifest requiring a 'standard' tier that doesn't exist still throws its OWN unrelated error, proving deferral doesn't swallow other real errors", () => {
    // Sanity/negative-space check: deferral must not become a blanket try/catch that silently
    // absorbs unrelated configuration errors. A manifest with NO 'ruthless' tier at all still
    // throws the pre-existing, unrelated "no ruthless tier" error even with deferral declared.
    const manifest: GameManifest = {
      ...deferrableManifest(true),
      difficultyTiers: [], // no ruthless tier at all
    };
    expect(() => runCiSuite(classicTicTacToe, manifest, { seed: "suites-test:c27:no-ruthless-tier", games: 10 })).toThrow(
      /no "ruthless" difficulty tier/
    );
  });
});

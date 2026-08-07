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
  EmptyExceptionJustificationError,
  evaluateCiGates,
  MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE,
  MissingCiRolloutBudgetError,
  MissingSolvedValueProofError,
  runCiSuite,
  SOLVED_VALUE_SELF_PLAY_FLOOR,
  SuiteFailedError,
  TierBudgetCollapseError,
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

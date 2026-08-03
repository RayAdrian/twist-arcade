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
import type { GameManifest } from "@twist-arcade/game-spec";
import {
  EmptyExceptionJustificationError,
  evaluateCiGates,
  runCiSuite,
  SuiteFailedError,
  worstCapHitRate,
  type GateInputs,
} from "../src/suites";
import type { MatchupReport } from "../src/runner";

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
  it("every gate passes when every metric is comfortably inside its band", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    for (const g of gates) {
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

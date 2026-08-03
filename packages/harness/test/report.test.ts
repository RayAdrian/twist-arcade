// packages/harness/test/report.test.ts — TDD anchor for report.ts's own formatting rules,
// tested directly against hand-built report shapes (no real self-play needed — this module has
// no logic of its own beyond formatting, per its module doc).

import { describe, expect, it } from "vitest";
import { formatCiSuiteTable } from "../src/report";
import type { CiSuiteReport, GateResult } from "../src/suites";
import type { MatchupReport } from "../src/runner";

function fakeMatchupReport(): MatchupReport {
  return {
    agentA: "ruthless",
    agentB: "random",
    metrics: {
      games: 1,
      firstPlayerWinRate: 1,
      drawRate: 0,
      winRateBySeat: [1, 0],
      meanPlies: 5,
      medianPlies: 5,
      p95Plies: 5,
      meanBranchingFactor: 3,
      capHitRate: 0,
    },
    throughputGamesPerSec: 100,
    outcomes: [],
  };
}

function fakeSuiteReport(gates: readonly GateResult[]): CiSuiteReport {
  return {
    gameId: "report-test-fixture",
    suite: "ci",
    ok: gates.every((g) => g.status !== "fail"),
    gates,
    matchups: {
      strongVsRandom: fakeMatchupReport(),
      strongSelfPlay: fakeMatchupReport(),
      ruthlessVsStandard: null,
    },
  };
}

describe("formatCiSuiteTable() — exception marker keyed on presence, not truthiness (SHOULD FIX #2)", () => {
  it("shows the exception marker for a non-empty justification", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "draw-rate", status: "warn", detail: "90.0% (max 60.0%)", exceptionJustification: "ADR-3" },
      ])
    );
    expect(output).toContain("(exception: ADR-3)");
  });

  it("an ordinary (non-excused) warn — no exceptionJustification key at all — shows no marker", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([{ gate: "ruthless-vs-standard", status: "warn", detail: "59.0% (min 60.0%, ci)" }])
    );
    expect(output).not.toContain("exception:");
  });

  it("even a defensively-empty-string justification still shows a marker — never hidden by " +
    "truthiness, so an excused fail can never look byte-identical to an ordinary warn", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "draw-rate", status: "warn", detail: "90.0% (max 60.0%)", exceptionJustification: "" },
      ])
    );
    expect(output).toContain("(exception: )");
  });
});

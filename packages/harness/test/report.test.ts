// packages/harness/test/report.test.ts — TDD anchor for report.ts's own formatting rules,
// tested directly against hand-built report shapes (no real self-play needed — this module has
// no logic of its own beyond formatting, per its module doc).

import { describe, expect, it } from "vitest";
import { formatCiSuiteTable, formatGameCiGateReport, formatSoloGateTable, toGameCiGateReportJson } from "../src/report";
import type { CiSuiteReport, GateResult } from "../src/suites";
import type { MatchupReport } from "../src/runner";
import type { GameCiGateReport } from "../src/ci-gates";
import type { GateResult as SoloGateResult } from "../src/solo-gates";

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

// ---------------------------------------------------------------------------------------
// formatSoloGateTable / formatGameCiGateReport / toGameCiGateReportJson — C2's own
// requirement restated at the FORMATTER layer: "a skipped gate and a passed gate must never
// look the same in a report", proven for both the human table and the JSON artifact.
// ---------------------------------------------------------------------------------------

const MIXED_SOLO_GATES: readonly SoloGateResult[] = [
  { name: "strongVsRandomRatio", status: "pass", detail: "3.200 (fail if < 1.5)" },
  { name: "grindProbe", status: "fail", detail: "zero-risk cycle found (length 1, scoreDelta 0)" },
  { name: "certificatePresent", status: "n/a", detail: "score-chase format — no daily certificate pipeline" },
];

describe("formatSoloGateTable() — N/A is visually distinct from PASS/FAIL/WARN", () => {
  it("prints a distinct [N/A ] label, never collapsing into [PASS] or an empty marker", () => {
    const output = formatSoloGateTable("bank-run-fixture", "score-chase", false, MIXED_SOLO_GATES);
    expect(output).toContain("[PASS] strongVsRandomRatio");
    expect(output).toContain("[FAIL] grindProbe");
    expect(output).toContain("[N/A ] certificatePresent");
    // The three labels must all differ from one another as rendered text — the literal
    // failure shape C2 exists to prevent is "n/a" reading identically to "pass".
    const passLine = output.split("\n").find((l) => l.includes("strongVsRandomRatio"))!;
    const naLine = output.split("\n").find((l) => l.includes("certificatePresent"))!;
    expect(passLine).not.toEqual(naLine);
  });

  it("reports FAILED in the header when any gate is a real fail (n/a rows never count as fail)", () => {
    const output = formatSoloGateTable("bank-run-fixture", "score-chase", false, MIXED_SOLO_GATES);
    expect(output).toContain('for "bank-run-fixture" — FAILED');
  });
});

describe("formatGameCiGateReport() / toGameCiGateReportJson() — dispatch by report kind", () => {
  const soloReport: GameCiGateReport = {
    kind: "solo-chase",
    gameId: "bank-run-fixture",
    ok: false,
    report: {
      gameId: "bank-run-fixture",
      format: "score-chase",
      ok: false,
      gates: MIXED_SOLO_GATES,
      metrics: {
        strongVsRandomRatio: 3.2,
        greedyVsRandomRatio: 1.8,
        strongVsGreedyRatio: 1.6,
        strongMedian: 100,
        randomMedian: 30,
        greedyMedian: 55,
        strongP10: 80,
        randomP75: 40,
        randomP90: 45,
        distributionSeparated: true,
        distributionOverlapsBadly: false,
        strongScoreCV: 0.4,
        medianRunLength: 90,
        p95RunLength: 200,
        capHitRate: 0,
        ceilingPileUp: 0.02,
      },
      grind: { found: true },
      alwaysSafeVsStrong: 0.5,
    },
  };

  it("formatGameCiGateReport renders a solo report via formatSoloGateTable", () => {
    const output = formatGameCiGateReport(soloReport);
    expect(output).toContain("solo-ci (score-chase)");
    expect(output).toContain("[N/A ] certificatePresent");
  });

  it("toGameCiGateReportJson keeps the n/a status as a distinct string value, not coerced to pass/omitted", () => {
    const json = toGameCiGateReportJson(soloReport);
    const parsed = JSON.parse(json) as GameCiGateReport & { report: { gates: SoloGateResult[] } };
    const naGate = parsed.report.gates.find((g) => g.name === "certificatePresent")!;
    expect(naGate.status).toBe("n/a");
    expect(naGate.status).not.toBe("pass");
  });

  it("formatGameCiGateReport renders a two-player report via formatCiSuiteTable", () => {
    const twoPlayerReport: GameCiGateReport = {
      kind: "two-player",
      gameId: "classic-ttt-fixture",
      ok: true,
      report: fakeSuiteReport([{ gate: "strong-vs-random", status: "pass", detail: "95.0% (min 90.0%)" }]),
    };
    const output = formatGameCiGateReport(twoPlayerReport);
    expect(output).toContain("CI suite (ci)");
    expect(output).toContain("[PASS] strong-vs-random");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C27: "deferred" ≠ "n/a" ≠ "pass" in the RENDERED report — the whole
// point is what a human reads, tested directly against report.ts's own formatters (not merely
// via the status enum, and not merely via an end-to-end suites.test.ts render).
// ---------------------------------------------------------------------------------------

const DEFER_DETAIL = "measured at nightly (Strong-dependent; ~4.6h at seedCount=100 in CI — platform-corrections.md C27)";

describe("formatCiSuiteTable() / formatSoloGateTable() — C27: '[DEFER]' is a DIFFERENT label from '[N/A ]' and '[PASS]'", () => {
  const mixedTwoPlayerGates: readonly GateResult[] = [
    { gate: "strong-vs-random", status: "deferred", detail: DEFER_DETAIL },
    { gate: "first-player-win-rate", status: "n/a", detail: "manifest.solvedValue is a proven \"draw\" — a balanced-FPA band does not apply" },
    { gate: "mean-plies", status: "pass", detail: "mean 20.0 plies, 0 cap hits across all matchups" },
  ];

  it("two-player table: three visually distinct labels for three distinct statuses on the SAME report", () => {
    const output = formatCiSuiteTable(fakeSuiteReport(mixedTwoPlayerGates));
    const lines = output.split("\n");
    const deferLine = lines.find((l) => l.includes("strong-vs-random"))!;
    const naLine = lines.find((l) => l.includes("first-player-win-rate"))!;
    const passLine = lines.find((l) => l.includes("mean-plies"))!;
    expect(deferLine).toContain("[DEFER]");
    expect(naLine).toContain("[N/A ]");
    expect(passLine).toContain("[PASS]");
    // Pairwise distinct as rendered strings — not just distinct labels floating unattached.
    expect(new Set([deferLine, naLine, passLine]).size).toBe(3);
    expect(deferLine).not.toContain("[N/A ]");
    expect(deferLine).not.toContain("[PASS]");
    expect(naLine).not.toContain("[DEFER]");
  });

  it("two-player header: 'OK (provisional — ...)' when ok=true and a deferred row is present — visibly distinguishable from a fully-measured 'OK'", () => {
    const provisional = formatCiSuiteTable(fakeSuiteReport(mixedTwoPlayerGates));
    const fullyMeasured = formatCiSuiteTable(fakeSuiteReport([{ gate: "strong-vs-random", status: "pass", detail: "95.0%" }]));
    expect(provisional).toContain("OK (provisional");
    expect(fullyMeasured).toMatch(/— OK$/m); // bare "OK", nothing appended
    expect(fullyMeasured).not.toContain("provisional");
  });

  const mixedSoloGates: readonly SoloGateResult[] = [
    { name: "alwaysSafeVsStrong", status: "deferred", detail: DEFER_DETAIL },
    { name: "suicideProbe", status: "n/a", detail: "not misère-tagged" },
    { name: "greedyVsRandomRatio", status: "pass", detail: "1.800 (fail if < 1.5)" },
  ];

  it("solo table: three visually distinct labels for three distinct statuses on the SAME report", () => {
    const output = formatSoloGateTable("mine-run-fixture", "score-chase", true, mixedSoloGates);
    const lines = output.split("\n");
    const deferLine = lines.find((l) => l.includes("alwaysSafeVsStrong"))!;
    const naLine = lines.find((l) => l.includes("suicideProbe"))!;
    const passLine = lines.find((l) => l.includes("greedyVsRandomRatio"))!;
    expect(deferLine).toContain("[DEFER]");
    expect(naLine).toContain("[N/A ]");
    expect(passLine).toContain("[PASS]");
    expect(new Set([deferLine, naLine, passLine]).size).toBe(3);
  });

  it("solo header: also reports 'OK (provisional — ...)', matching the two-player lane's rule", () => {
    const output = formatSoloGateTable("mine-run-fixture", "score-chase", true, mixedSoloGates);
    expect(output).toContain('for "mine-run-fixture" — OK (provisional');
  });

  it("a FAILED report with a deferred row still says FAILED, never 'provisional' (provisional only ever qualifies a PASS)", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "strong-vs-random", status: "deferred", detail: DEFER_DETAIL },
        { gate: "mean-plies", status: "fail", detail: "mean 900.0 plies (band [10, 40])" },
      ])
    );
    expect(output).toContain("— FAILED");
    expect(output).not.toContain("provisional");
  });
});

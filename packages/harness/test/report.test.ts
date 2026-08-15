// packages/harness/test/report.test.ts — TDD anchor for report.ts's own formatting rules,
// tested directly against hand-built report shapes (no real self-play needed — this module has
// no logic of its own beyond formatting, per its module doc).

import { describe, expect, it } from "vitest";
import {
  formatCiSuiteTable,
  formatCiSuiteTableWithAging,
  formatGameCiGateReport,
  formatGameCiGateReportWithAging,
  formatSoloGateTable,
  formatSoloGateTableWithAging,
  toGameCiGateReportJson,
} from "../src/report";
import type { CiSuiteReport, GateResult } from "../src/suites";
import type { MatchupReport } from "../src/runner";
import type { GameCiGateReport } from "../src/ci-gates";
import type { GateResult as SoloGateResult } from "../src/solo-gates";
import { annotateDeferralAging, type DeferralAgingReport } from "../src/deferral-ledger";

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

// ---------------------------------------------------------------------------------------
// platform-corrections.md C57: "[NEVER]" is a DIFFERENT label from "[FAIL]", "[PASS]", "[N/A ]",
// and "[DEFER]" — the whole point is that a reader must be able to tell "measured, genuinely
// never reached, no baseline to regress from" apart from an ordinary fail or a bare pass at a
// glance, on the RENDERED table, not merely in the status enum.
// ---------------------------------------------------------------------------------------

const UNATTAINED_DETAIL =
  'self-play has never reached the proven "draw" (0.0% observed, floor 90%) — no manifest.solvedValue.attainmentBaseline declared, so there is no history to regress from; this describes search adequacy for this tree, not a regression (platform-corrections.md C57)';

describe("formatCiSuiteTable() — C57: '[NEVER]' is visually distinct from '[FAIL]', '[PASS]', '[N/A ]', and '[DEFER]'", () => {
  const mixedGatesWithUnattained: readonly GateResult[] = [
    { gate: "solved-value-reached", status: "unattained", detail: UNATTAINED_DETAIL },
    { gate: "first-player-win-rate", status: "pass", detail: "43.3% (band [35%, 65%])" },
    { gate: "strong-vs-random", status: "fail", detail: "85.0% (min 90.0%)" },
    { gate: "mean-plies", status: "n/a", detail: "manifest has no \"standard\" tier" },
    { gate: "draw-rate", status: "deferred", detail: DEFER_DETAIL },
  ];

  it("five distinct labels for five distinct statuses on the SAME report, pairwise distinguishable as rendered text", () => {
    const output = formatCiSuiteTable(fakeSuiteReport(mixedGatesWithUnattained));
    const lines = output.split("\n");
    const neverLine = lines.find((l) => l.includes("solved-value-reached"))!;
    const passLine = lines.find((l) => l.includes("first-player-win-rate"))!;
    const failLine = lines.find((l) => l.includes("strong-vs-random"))!;
    const naLine = lines.find((l) => l.includes("mean-plies"))!;
    const deferLine = lines.find((l) => l.includes("draw-rate"))!;
    expect(neverLine).toContain("[NEVER]");
    expect(passLine).toContain("[PASS]");
    expect(failLine).toContain("[FAIL]");
    expect(naLine).toContain("[N/A ]");
    expect(deferLine).toContain("[DEFER]");
    // Every rendered line distinct from every other — the exact C2/C57 requirement restated at
    // the formatter layer: two conditions requiring different responses must not print the same
    // word, and here that means not even the same LINE.
    expect(new Set([neverLine, passLine, failLine, naLine, deferLine]).size).toBe(5);
    expect(neverLine).not.toContain("[FAIL]");
    expect(neverLine).not.toContain("[PASS]");
  });

  it("header: 'OK (provisional — ...)' when ok=true and an unattained row is present, naming solved-value-reached — visibly distinguishable from a bare 'OK'", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "solved-value-reached", status: "unattained", detail: UNATTAINED_DETAIL },
        { gate: "first-player-win-rate", status: "pass", detail: "43.3% (band [35%, 65%])" },
      ])
    );
    expect(output).toContain("OK (provisional");
    expect(output).toContain("solved-value-reached");
    const fullyMeasured = formatCiSuiteTable(fakeSuiteReport([{ gate: "strong-vs-random", status: "pass", detail: "95.0%" }]));
    expect(fullyMeasured).toMatch(/— OK$/m);
  });

  it("a report with BOTH a deferred row and an unattained row names both in the header, never silently dropping one", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "solved-value-reached", status: "unattained", detail: UNATTAINED_DETAIL },
        { gate: "strong-vs-random", status: "deferred", detail: DEFER_DETAIL },
      ])
    );
    const header = output.split("\n")[0];
    expect(header).toContain("provisional");
    expect(header).toMatch(/deferred/i);
    expect(header).toMatch(/never attained|solved-value-reached/i);
  });

  it("a FAILED report with an unattained row still says FAILED, never 'provisional' (an unattained row does not make a real fail elsewhere disappear)", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "solved-value-reached", status: "unattained", detail: UNATTAINED_DETAIL },
        { gate: "strong-vs-random", status: "fail", detail: "85.0% (min 90.0%)" },
      ])
    );
    expect(output).toContain("— FAILED");
    expect(output).not.toContain("provisional");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C70: the deferral-discharge ledger's aging annotation, rendered.
// `formatXWithAging(report, undefined)` must be BYTE-IDENTICAL to the un-aged formatter (this
// IS the byte-identity guard for games with no deferrals, proven at the unit level rather than
// only via the fixed-seed CLI diff) — every other case below is Mine Run's real 8/10 shape.
// ---------------------------------------------------------------------------------------

const MINE_RUN_DEFERRED_GATES = [
  "strongVsRandomRatio",
  "distributionOverlap",
  "strongVsGreedyRatio",
  "strongScoreCV",
  "alwaysSafeVsStrong",
  "medianRunLength",
  "capHitRate",
  "ceilingPileUp",
] as const;

function mineRunShapedSoloGates(): SoloGateResult[] {
  return [
    ...MINE_RUN_DEFERRED_GATES.map((name) => ({ name, status: "deferred" as const, detail: DEFER_DETAIL })),
    { name: "greedyVsRandomRatio", status: "pass", detail: "1.800 (fail if < 1.5)" },
    { name: "grindProbe", status: "pass", detail: "no zero-risk unbounded cycle found" },
    { name: "suicideProbe", status: "n/a", detail: "not misère-tagged" },
    { name: "certificatePresent", status: "n/a", detail: "score-chase format — no daily certificate pipeline" },
    { name: "certificatePar", status: "n/a", detail: "score-chase format — no par to certify" },
    { name: "randomPlayoutSolveRate", status: "n/a", detail: "score-chase format — no single 'solve' to rate" },
    { name: "forcedMoveFraction", status: "n/a", detail: "score-chase format — no optimal solve path to measure" },
    { name: "generatorRejectionRate", status: "n/a", detail: "score-chase format — no certify-time generator" },
    { name: "dayOverDayDrift", status: "n/a", detail: "score-chase format — no daily difficulty band" },
    { name: "certifiedBufferDays", status: "n/a", detail: "score-chase format — no certificate buffer to deplete" },
    { name: "fogDeductionOnly", status: "n/a", detail: "score-chase format — no daily certificate, no guess-free requirement to check" },
  ];
}

function agingFor(ageDays: number): DeferralAgingReport | undefined {
  const today = "2026-08-15";
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - ageDays * 86_400_000).toISOString().slice(0, 10);
  // No committed DeferralRun evidence exists — undischarged since `since` (platform-
  // corrections.md C81: discharge is derived from committed artifacts, never a mutable ledger).
  return annotateDeferralAging("mine-run-fixture", mineRunShapedSoloGates(), [], since, today);
}

describe("formatXWithAging — no aging (undefined) is byte-identical to the un-aged formatter", () => {
  it("formatSoloGateTableWithAging(..., undefined) === formatSoloGateTable(...)", () => {
    const withAging = formatSoloGateTableWithAging("mine-run-fixture", "score-chase", true, mineRunShapedSoloGates(), undefined);
    const plain = formatSoloGateTable("mine-run-fixture", "score-chase", true, mineRunShapedSoloGates());
    expect(withAging).toBe(plain);
  });

  it("formatCiSuiteTableWithAging(..., undefined) === formatCiSuiteTable(...)", () => {
    const report = fakeSuiteReport([{ gate: "strong-vs-random", status: "pass", detail: "95.0%" }]);
    expect(formatCiSuiteTableWithAging(report, undefined)).toBe(formatCiSuiteTable(report));
  });

  it("formatGameCiGateReportWithAging(report, undefined) === formatGameCiGateReport(report), for both lanes", () => {
    const soloReport: GameCiGateReport = {
      kind: "solo-chase",
      gameId: "mine-run-fixture",
      ok: true,
      report: { gameId: "mine-run-fixture", format: "score-chase", ok: true, gates: mineRunShapedSoloGates(), metrics: {} as never, grind: { found: false } },
    };
    expect(formatGameCiGateReportWithAging(soloReport, undefined)).toBe(formatGameCiGateReport(soloReport));
  });
});

describe("formatXWithAging — fresh (age 0): identical header/rows to the un-aged render (C27 stays usable on day one)", () => {
  it("no [STALE]/[OVERDUE] suffixes, header still bare 'OK (provisional — ...)'", () => {
    const aging = agingFor(0);
    const output = formatSoloGateTableWithAging("mine-run-fixture", "score-chase", true, mineRunShapedSoloGates(), aging);
    expect(output).toContain('for "mine-run-fixture" — OK (provisional');
    expect(output).not.toContain("STALLED");
    expect(output).not.toContain("STALE");
    expect(output).not.toContain("OVERDUE");
  });
});

describe("formatXWithAging — PLANTED VIOLATION, material fraction (requirement 3): Mine Run's real 8/10 shape, aged 8 days, never discharged", () => {
  it("header says STALLED, not OK — this is the direct fix for C70's 'OK (provisional) with exit code 0'", () => {
    const aging = agingFor(8);
    const output = formatSoloGateTableWithAging("mine-run-fixture", "score-chase", true, mineRunShapedSoloGates(), aging);
    const header = output.split("\n")[0]!;
    expect(header).toContain("STALLED");
    expect(header).not.toMatch(/— OK\b/);
    expect(header).toMatch(/8\/10|80%/); // names the material fraction
  });

  it("every deferred row is individually annotated [STALE] with its undischarged day count", () => {
    const aging = agingFor(8);
    const output = formatSoloGateTableWithAging("mine-run-fixture", "score-chase", true, mineRunShapedSoloGates(), aging);
    for (const name of MINE_RUN_DEFERRED_GATES) {
      const line = output.split("\n").find((l) => l.includes(`] ${name}:`))!;
      expect(line, name).toContain("STALE");
      expect(line, name).toContain("8d");
    }
    // Rows that were never deferred (measured for real, or n/a) carry no aging suffix at all.
    const passLine = output.split("\n").find((l) => l.includes("] greedyVsRandomRatio:"))!;
    expect(passLine).not.toContain("STALE");
    expect(passLine).not.toContain("OVERDUE");
  });
});

describe("formatXWithAging — PLANTED VIOLATION, aged past fatal (requirement 2): 30+ days undischarged", () => {
  it("header says STALLED and every deferred row is [OVERDUE]", () => {
    const aging = agingFor(30);
    const output = formatSoloGateTableWithAging("mine-run-fixture", "score-chase", true, mineRunShapedSoloGates(), aging);
    const header = output.split("\n")[0]!;
    expect(header).toContain("STALLED");
    for (const name of MINE_RUN_DEFERRED_GATES) {
      const line = output.split("\n").find((l) => l.includes(`] ${name}:`))!;
      expect(line, name).toContain("OVERDUE");
      expect(line, name).toContain("30d");
    }
  });
});

describe("formatXWithAging — a real FAIL row still renders FAILED, never STALLED, even when aging also forces a fail", () => {
  it("two-player table: FAILED wins the header text (the exit code is already non-zero either way)", () => {
    const aging = agingFor(30);
    const failedReport = fakeSuiteReport([
      { gate: "strong-vs-random", status: "deferred", detail: DEFER_DETAIL },
      { gate: "mean-plies", status: "fail", detail: "mean 900.0 plies (band [10, 40])" },
    ]);
    const output = formatCiSuiteTableWithAging(failedReport, aging);
    expect(output).toContain("— FAILED");
    expect(output).not.toContain("STALLED");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C71 Part 1 / C80 — a rate-style gate's `provisional` flag rendered:
// a per-row "[PROVISIONAL]" marker (distinct from the status label) plus a header note, on BOTH
// a passing and a FAILING report — never silently dropped, never conflated with C27's "deferred"
// or C57's "unattained" qualifiers.
// ---------------------------------------------------------------------------------------

describe("formatCiSuiteTable() — C71/C80: 'provisional' rows are marked per-row AND noted in the header", () => {
  it("a passing report with one provisional row: header says 'OK (provisional — ...)', that row (and only that row) carries '[PROVISIONAL]'", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "first-player-win-rate", status: "pass", detail: "36.0% (band [35%, 65%]) [seeds=5, seed-to-seed SD=6.0pp, SE=2.7pp]", provisional: true },
        { gate: "strong-vs-random", status: "pass", detail: "95.0%" },
      ])
    );
    const lines = output.split("\n");
    expect(lines[0]).toContain("OK (provisional");
    expect(lines[0]).toContain("[PROVISIONAL]"); // named in the header note too, per C71/C80
    const fpaLine = lines.find((l) => l.includes("first-player-win-rate"))!;
    const strongLine = lines.find((l) => l.includes("strong-vs-random"))!;
    expect(fpaLine).toContain("[PROVISIONAL]");
    expect(strongLine).not.toContain("[PROVISIONAL]");
  });

  it("a FAILING report whose FAILING row is ITSELF provisional: header says 'FAILED (...)', NEVER a bare unqualified 'FAILED' — a near-edge fail is still a real fail, but the reader is told it's close to the gate's own noise floor", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        { gate: "first-player-win-rate", status: "fail", detail: "70.0% (band [35%, 65%]) [seeds=5, seed-to-seed SD=12.9pp, SE=5.8pp]", provisional: true },
      ])
    );
    const lines = output.split("\n");
    expect(lines[0]).toContain("FAILED (");
    expect(lines[0]).not.toBe('CI suite (ci) for "report-test-fixture" — FAILED');
    expect(lines[0]).toContain("[PROVISIONAL]");
  });

  it("C80 (stage-6 review, minor finding): a FAILING report where the PROVISIONAL row is a DIFFERENT, PASSING row must NOT surface the provisional note in the header — an unrelated row's noise must never read as softening a genuine, unrelated hard fail", () => {
    const output = formatCiSuiteTable(
      fakeSuiteReport([
        // The failing row is NOT provisional — a clean, unambiguous fail.
        { gate: "strong-vs-random", status: "fail", detail: "85.0% (min 90.0%)" },
        // A DIFFERENT row is provisional, but it's a PASS — irrelevant to why this suite failed.
        { gate: "first-player-win-rate", status: "pass", detail: "36.0% (band [35%, 65%]) [seeds=5, seed-to-seed SD=6.0pp, SE=2.7pp]", provisional: true },
      ])
    );
    const lines = output.split("\n");
    // Bare, unqualified FAILED — the header must not mention provisional at all.
    expect(lines[0]).toBe('CI suite (ci) for "report-test-fixture" — FAILED');
    expect(lines[0]).not.toContain("provisional");
    expect(lines[0]).not.toContain("[PROVISIONAL]");
    // The per-row marker is still exactly where it belongs — only on the row that carries it.
    const fpaLine = lines.find((l) => l.includes("first-player-win-rate"))!;
    const strongLine = lines.find((l) => l.includes("strong-vs-random"))!;
    expect(fpaLine).toContain("[PROVISIONAL]");
    expect(strongLine).not.toContain("[PROVISIONAL]");
  });

  it("no gate carries 'provisional' at all: header is the bare, unqualified 'OK'/'FAILED' exactly as before C71/C80 — zero rendering change for the module's existing default", () => {
    const okOutput = formatCiSuiteTable(fakeSuiteReport([{ gate: "strong-vs-random", status: "pass", detail: "95.0%" }]));
    const failedOutput = formatCiSuiteTable(fakeSuiteReport([{ gate: "strong-vs-random", status: "fail", detail: "85.0%" }]));
    expect(okOutput).toMatch(/— OK$/m);
    expect(failedOutput.split("\n")[0]).toBe('CI suite (ci) for "report-test-fixture" — FAILED');
  });
});

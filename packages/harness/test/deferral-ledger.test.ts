// packages/harness/test/deferral-ledger.test.ts — TDD anchor for deferral-ledger.ts
// (platform-corrections.md C70, C81).
//
// C27 built a real "deferred" gate status. C68 found nightly has never once completed a run.
// C70 built a first discharge mechanism — and C81's stage-6 review found it self-defeating:
// `recordDischarge` wrote into a single mutable `data/deferral-ledger.json` at suite "nightly",
// but `nightly.yml` runs in an ephemeral GitHub Actions workspace with no commit-back step, so
// that write was discarded every night. A kept promise could never discharge.
//
// THIS design instead derives discharge from a COMMITTED ARTIFACT, exactly like
// certify.ts's own `data/certificates/<gameId>/<day>.json`: a real nightly run writes one small,
// immutable, dated `DeferralRun` file recording which gates it actually measured for real that
// day (derived from the run's OWN report rows — never a hardcoded canonical list, which is what
// C81's A2 finding showed goes out of sync between the "ci" and "nightly" lanes). A human commits
// that file afterward, the same documented manual path certify.ts already requires (C68: nightly
// cannot run automatically today regardless — billing, not code). Discharge recognition then
// SCANS these committed files at read time; there is no mutable ledger blob to write, lose, or
// hand-edit undetected — tampering means forging an entire dated, reviewable evidence file.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  annotateDeferralAging,
  defaultDeferralRunsBaseDir,
  DEFERRAL_FATAL_DAYS,
  DEFERRAL_WARN_DAYS,
  deferralRunPath,
  deferralSeverity,
  effectiveOk,
  InvalidDeferralSinceError,
  MalformedDeferralRunError,
  measuredGateNames,
  readAllDeferralRuns,
  readDeferralRun,
  resolveDischargeAnchor,
  writeDeferralRun,
  type DeferralRun,
} from "../src/deferral-ledger";

// Mine Run's REAL 19-row shape (evaluateChaseGates' deferred branch, platform-corrections.md
// C27): 10 applicable (non-"n/a") rows, 8 of which are Strong-dependent and report "deferred"
// when Strong never ran.
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

function mineRunShapedRows(): { name: string; status: string }[] {
  return [
    ...MINE_RUN_DEFERRED_GATES.map((name) => ({ name, status: "deferred" })),
    { name: "greedyVsRandomRatio", status: "pass" },
    { name: "grindProbe", status: "pass" },
    { name: "suicideProbe", status: "n/a" },
    { name: "certificatePresent", status: "n/a" },
    { name: "certificatePar", status: "n/a" },
    { name: "randomPlayoutSolveRate", status: "n/a" },
    { name: "forcedMoveFraction", status: "n/a" },
    { name: "generatorRejectionRate", status: "n/a" },
    { name: "dayOverDayDrift", status: "n/a" },
    { name: "certifiedBufferDays", status: "n/a" },
    { name: "fogDeductionOnly", status: "n/a" },
  ];
}

/** A real nightly report for the same manifest: every previously-deferred row now measured for
 *  real (pass/fail — never "deferred", structurally enforced upstream), plus everything that
 *  was already real at "ci" tier too. */
function mineRunNightlyMeasuredRows(): { name: string; status: string }[] {
  return [
    ...MINE_RUN_DEFERRED_GATES.map((name) => ({ name, status: "pass" })),
    { name: "greedyVsRandomRatio", status: "pass" },
    { name: "grindProbe", status: "pass" },
    { name: "suicideProbe", status: "n/a" },
    { name: "certificatePresent", status: "n/a" },
    { name: "certificatePar", status: "n/a" },
    { name: "randomPlayoutSolveRate", status: "n/a" },
    { name: "forcedMoveFraction", status: "n/a" },
    { name: "generatorRejectionRate", status: "n/a" },
    { name: "dayOverDayDrift", status: "n/a" },
    { name: "certifiedBufferDays", status: "n/a" },
    { name: "fogDeductionOnly", status: "n/a" },
  ];
}

describe("deferralSeverity — the three-band escalation (C70)", () => {
  it("fresh below the warn threshold", () => {
    expect(deferralSeverity(0)).toBe("fresh");
    expect(deferralSeverity(DEFERRAL_WARN_DAYS - 1)).toBe("fresh");
  });

  it("stale from the warn threshold up to (not including) the fatal threshold", () => {
    expect(deferralSeverity(DEFERRAL_WARN_DAYS)).toBe("stale");
    expect(deferralSeverity(DEFERRAL_FATAL_DAYS - 1)).toBe("stale");
  });

  it("overdue at and past the fatal threshold", () => {
    expect(deferralSeverity(DEFERRAL_FATAL_DAYS)).toBe("overdue");
    expect(deferralSeverity(DEFERRAL_FATAL_DAYS + 365)).toBe("overdue");
  });
});

describe("measuredGateNames — derived from a report's OWN rows, never a hardcoded canonical list (C81's A2 fix)", () => {
  it("every non-'n/a' row counts as measured — pass, fail, warn, unattained alike", () => {
    const rows = [
      { name: "a", status: "pass" },
      { name: "b", status: "fail" },
      { name: "c", status: "warn" },
      { name: "d", status: "unattained" },
      { name: "e", status: "n/a" },
    ];
    expect(measuredGateNames(rows)).toEqual(["a", "b", "c", "d"]);
  });

  it("a two-player nightly run's measured set can be a SUBSET of the solo-chase canonical list shape — no assumption either lane's full list applies", () => {
    // The exact defect C81 found: ruthless-vs-standard/solved-value-reached can independently
    // be n/a (a structural reason unrelated to deferral) even at a game whose deferral is
    // active — so "what was measured tonight" must come from the report, not a constant.
    const rows = [
      { name: "strong-vs-random", status: "pass" },
      { name: "first-player-win-rate", status: "pass" },
      { name: "draw-rate", status: "pass" },
      { name: "mean-plies", status: "pass" },
      { name: "ruthless-vs-standard", status: "n/a" }, // no "standard" tier — structural, not deferral
      { name: "solved-value-reached", status: "n/a" },
    ];
    expect(measuredGateNames(rows)).toEqual(["strong-vs-random", "first-player-win-rate", "draw-rate", "mean-plies"]);
  });
});

describe("resolveDischargeAnchor — requirement 1: a later run recognized as the discharging one, via COVERAGE not exact-set equality (C81's A2 fix)", () => {
  const deferredNames = [...MINE_RUN_DEFERRED_GATES];

  it("no runs at all: anchors to the manifest-declared `since`", () => {
    const anchor = resolveDischargeAnchor(deferredNames, [], "2026-08-07", "2026-08-15");
    expect(anchor.anchorDay).toBe("2026-08-07");
    expect(anchor.dischargedBy).toBeUndefined();
  });

  it("omitting `since` (and no runs) anchors to today (documented, understated-age fallback)", () => {
    const anchor = resolveDischargeAnchor(deferredNames, [], undefined, "2026-08-15");
    expect(anchor.anchorDay).toBe("2026-08-15");
  });

  it("a run that measured EVERY currently-deferred gate discharges — anchors to that run's day", () => {
    const run: DeferralRun = {
      gameId: "mine-run",
      lane: "solo-chase",
      day: "2026-08-15",
      suite: "nightly",
      measuredGates: [...deferredNames, "greedyVsRandomRatio", "grindProbe"],
    };
    const anchor = resolveDischargeAnchor(deferredNames, [run], "2026-08-07", "2026-08-15");
    expect(anchor.anchorDay).toBe("2026-08-15");
    expect(anchor.dischargedBy).toBe(run);
  });

  it("COVERAGE, not exact equality: a run that measured MORE than the currently-deferred set still discharges (the two-player subset case A2 flagged)", () => {
    const currentlyDeferred = ["strong-vs-random", "first-player-win-rate"]; // a proper subset — draw-rate/mean-plies/ruthless-vs-standard/solved-value-reached are n/a today
    const run: DeferralRun = {
      gameId: "some-two-player-game",
      lane: "two-player",
      day: "2026-08-15",
      suite: "nightly",
      // nightly's own measured set for this manifest that night happens to be the SAME subset
      // (ruthless-vs-standard/solved-value-reached are STILL n/a at nightly too, structurally)
      // — a strict-equality check on a hardcoded 6-name canonical list would have missed this.
      measuredGates: ["strong-vs-random", "first-player-win-rate"],
    };
    const anchor = resolveDischargeAnchor(currentlyDeferred, [run], "2026-08-01", "2026-08-15");
    expect(anchor.anchorDay).toBe("2026-08-15");
    expect(anchor.dischargedBy).toBe(run);
  });

  it("a run that did NOT measure every currently-deferred gate does not discharge (partial coverage refused)", () => {
    const run: DeferralRun = {
      gameId: "mine-run",
      lane: "solo-chase",
      day: "2026-08-15",
      suite: "nightly",
      measuredGates: ["strongVsRandomRatio"], // missing the other 7
    };
    const anchor = resolveDischargeAnchor(deferredNames, [run], "2026-08-07", "2026-08-15");
    expect(anchor.anchorDay).toBe("2026-08-07"); // still anchored at `since` — undischarged
    expect(anchor.dischargedBy).toBeUndefined();
  });

  it("the MOST RECENT covering run wins when several exist", () => {
    const older: DeferralRun = {
      gameId: "mine-run",
      lane: "solo-chase",
      day: "2026-08-10",
      suite: "nightly",
      measuredGates: [...deferredNames],
    };
    const newer: DeferralRun = { ...older, day: "2026-08-14" };
    const anchor = resolveDischargeAnchor(deferredNames, [older, newer], "2026-08-07", "2026-08-15");
    expect(anchor.anchorDay).toBe("2026-08-14");
  });

  it("rejects a malformed `since` (InvalidDeferralSinceError) rather than silently misdating the anchor", () => {
    expect(() => resolveDischargeAnchor(deferredNames, [], "08/07/2026", "2026-08-15")).toThrow(InvalidDeferralSinceError);
  });
});

describe("PLANTED VIOLATIONS — annotateDeferralAging end to end, driven entirely by committed DeferralRun evidence (requirements 2 and 3)", () => {
  it("PLANTED VIOLATION, DISCHARGED: a nightly run that covers the currently-deferred set resets age to 0", () => {
    const run: DeferralRun = {
      gameId: "mine-run",
      lane: "solo-chase",
      day: "2026-08-15",
      suite: "nightly",
      measuredGates: measuredGateNames(mineRunNightlyMeasuredRows()),
    };
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), [run], "2026-08-07", "2026-08-15")!;
    expect(aging.rows[0]!.ageDays).toBe(0);
    expect(aging.forcesFail).toBe(false);
  });

  it("PLANTED VIOLATION, MATERIAL FRACTION (requirement 3, real Mine Run 8/10 shape): never discharged, 8 days old — 80% >= 50% materiality forces a fail with no row individually overdue", () => {
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), [], "2026-08-07", "2026-08-15")!;
    expect(aging.staleOrOverdueFraction).toBeCloseTo(0.8, 10);
    expect(aging.anyOverdue).toBe(false);
    expect(aging.materialityBreached).toBe(true);
    expect(aging.forcesFail).toBe(true);
  });

  it("PLANTED VIOLATION, AGED PAST FATAL (requirement 2): 30+ days undischarged is overdue on its own", () => {
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), [], "2026-08-07", "2026-09-06")!;
    expect(aging.rows.every((r) => r.severity === "overdue")).toBe(true);
    expect(aging.anyOverdue).toBe(true);
    expect(aging.forcesFail).toBe(true);
  });

  it("an OLD, stale-covering run followed by tonight re-declaring the deferral still measures age from the discharge, not from `since`", () => {
    const oldDischarge: DeferralRun = {
      gameId: "mine-run",
      lane: "solo-chase",
      day: "2026-08-15",
      suite: "nightly",
      measuredGates: measuredGateNames(mineRunNightlyMeasuredRows()),
    };
    // Tomorrow's "ci" run re-declares the same deferral (Strong is still unaffordable at "ci").
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), [oldDischarge], "2026-08-07", "2026-08-17")!;
    expect(aging.rows[0]!.ageDays).toBe(2); // 2026-08-15 -> 2026-08-17
    expect(aging.forcesFail).toBe(false); // fresh again, well under material
  });

  it("no deferred rows at all: undefined — a no-op for games with no active deferral", () => {
    const rows = [{ name: "pass-1", status: "pass" }];
    expect(annotateDeferralAging("fadeout", rows, [], undefined, "2026-08-15")).toBeUndefined();
  });

  it("a NON-material fraction (1/10) does not force a fail even once stale", () => {
    const rows = [
      { name: "solo-x", status: "deferred" },
      ...Array.from({ length: 9 }, (_, i) => ({ name: `pass-${i}`, status: "pass" })),
    ];
    const aging = annotateDeferralAging("one-row-game", rows, [], "2026-08-01", "2026-08-15")!;
    expect(aging.staleOrOverdueFraction).toBeCloseTo(0.1, 10);
    expect(aging.forcesFail).toBe(false);
  });
});

describe("effectiveOk — the exit-code combinator", () => {
  it("true when the report was already ok and aging is absent", () => {
    expect(effectiveOk(true, undefined)).toBe(true);
  });
  it("false when aging forces a fail, even though report.ok=true", () => {
    expect(effectiveOk(true, { forcesFail: true } as never)).toBe(false);
  });
  it("stays false when the underlying report already failed", () => {
    expect(effectiveOk(false, undefined)).toBe(false);
  });
});

describe("DeferralRun storage — committed, per-day, immutable evidence (mirrors certify.ts's certificate convention exactly)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deferral-runs-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sampleRun: DeferralRun = {
    gameId: "mine-run",
    lane: "solo-chase",
    day: "2026-08-15",
    suite: "nightly",
    measuredGates: [...MINE_RUN_DEFERRED_GATES],
  };

  it("readDeferralRun returns undefined for a day that was never written (ENOENT)", async () => {
    expect(await readDeferralRun(dir, "mine-run", "2026-08-15")).toBeUndefined();
  });

  it("round-trips a written run", async () => {
    await writeDeferralRun(dir, sampleRun);
    expect(await readDeferralRun(dir, "mine-run", "2026-08-15")).toEqual(sampleRun);
  });

  it("readAllDeferralRuns returns every stored day for a game, sorted ascending", async () => {
    await writeDeferralRun(dir, { ...sampleRun, day: "2026-08-20" });
    await writeDeferralRun(dir, { ...sampleRun, day: "2026-08-07" });
    await writeDeferralRun(dir, { ...sampleRun, day: "2026-08-15" });
    const all = await readAllDeferralRuns(dir, "mine-run");
    expect(all.map((r) => r.day)).toEqual(["2026-08-07", "2026-08-15", "2026-08-20"]);
  });

  it("readAllDeferralRuns returns [] for a game with no stored runs at all", async () => {
    expect(await readAllDeferralRuns(dir, "no-such-game")).toEqual([]);
  });

  it("throws MalformedDeferralRunError on a corrupted/hand-edited file — fails LOUD, never silently 'fresh' (C81's A3 fix)", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const filePath = deferralRunPath(dir, "mine-run", "2026-08-15");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ gameId: "mine-run", day: "not-a-date" }), "utf8");
    await expect(readDeferralRun(dir, "mine-run", "2026-08-15")).rejects.toThrow(MalformedDeferralRunError);
  });

  it("throws MalformedDeferralRunError when the stored `day` disagrees with the filename it's stored under (mirrors CertificateDayMismatchError)", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const filePath = deferralRunPath(dir, "mine-run", "2026-08-15");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ ...sampleRun, day: "2026-08-16" }), "utf8");
    await expect(readDeferralRun(dir, "mine-run", "2026-08-15")).rejects.toThrow(MalformedDeferralRunError);
  });

  it("defaultDeferralRunsBaseDir points at data/deferral-runs under the repo root", () => {
    expect(defaultDeferralRunsBaseDir("/repo")).toBe(path.join("/repo", "data/deferral-runs"));
  });
});

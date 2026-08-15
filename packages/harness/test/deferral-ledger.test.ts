// packages/harness/test/deferral-ledger.test.ts — TDD anchor for deferral-ledger.ts
// (platform-corrections.md C70, extending C27/C68).
//
// C27 built a real, sound "deferred" gate status: a Strong-dependent row that is too expensive
// to measure at suite "ci" reports `"deferred"` instead of a fabricated pass. C68 then found
// that nightly — the tier every deferral names as the one that measures it for real — has never
// once completed a run. C70's finding: nothing in the system ever checks that a deferral's
// promise was kept, so Mine Run's report has printed "OK (provisional — …)" with exit code 0
// on 8 of its 10 gates, forever, since the day the deferral was declared.
//
// This module is the missing check: a deferral RECORDS what would discharge it (which tier,
// and the exact gate names — `observeDeferral`), a later run that actually measures those gates
// for real is RECOGNIZED as the discharging one (`recordDischarge`), and an undischarged
// deferral AGES — visibly (`"stale"` past `DEFERRAL_WARN_DAYS`) and eventually fatally
// (`"overdue"` past `DEFERRAL_FATAL_DAYS`, `annotateDeferralAging(...).forcesFail === true`).
// A SEPARATE, aggregate rule (`DEFERRAL_MATERIAL_FRACTION`) means a report is not allowed to
// keep printing an unqualified "OK" merely because no single row has individually gone fatal
// yet, when a MAJORITY of a game's real gates have gone stale together — Mine Run's actual
// 8/10 shape.

import { describe, expect, it } from "vitest";
import {
  annotateDeferralAging,
  DEFERRAL_FATAL_DAYS,
  DEFERRAL_MATERIAL_FRACTION,
  DEFERRAL_WARN_DAYS,
  deferralAgeDays,
  deferralSeverity,
  effectiveOk,
  InvalidDeferralSinceError,
  observeDeferral,
  readDeferralLedger,
  recordDischarge,
  writeDeferralLedger,
  type DeferralLedger,
} from "../src/deferral-ledger";

// Mine Run's REAL 19-row shape (evaluateChaseGates' deferred branch, platform-corrections.md
// C27): 10 applicable (non-"n/a") rows, 8 of which are Strong-dependent and report "deferred"
// when Strong never ran; 9 n/a rows (suicideProbe + the 8 puzzle-only rows) are never
// applicable regardless of deferral and must never count toward the materiality fraction.
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
    { name: "greedyVsRandomRatio", status: "pass" }, // measured for real even under deferral
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

describe("observeDeferral — anchoring firstObservedAt", () => {
  it("a brand-new deferral anchors to the manifest-declared `since`, NOT to today — the whole point being that deploying this ledger must not erase pre-existing age (C70's own trap, one level up)", () => {
    const ledger: DeferralLedger = {};
    const next = observeDeferral(
      ledger,
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-15"
    );
    expect(next["mine-run"]!.firstObservedAt).toBe("2026-08-07");
    expect(deferralAgeDays(next["mine-run"]!, "2026-08-15")).toBe(8);
  });

  it("omitting `since` anchors to today (documented, understated-age fallback)", () => {
    const next = observeDeferral(
      {},
      { gameId: "no-since-game", lane: "solo-chase", gates: ["a", "b"] },
      "2026-08-15"
    );
    expect(next["no-since-game"]!.firstObservedAt).toBe("2026-08-15");
  });

  it("re-observing the SAME identity is a no-op on firstObservedAt (idempotent — the nightly-less every-CI-run case)", () => {
    const first = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-15"
    );
    const second = observeDeferral(
      first,
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-20"
    );
    expect(second["mine-run"]!.firstObservedAt).toBe("2026-08-07");
  });

  it("firstObservedAt can only move EARLIER, never later, for the same identity — a manifest edit that bumps `since` forward cannot silently reset an already-aging deferral's clock", () => {
    const first = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-15"
    );
    // Someone edits the manifest and (accidentally or not) bumps `since` forward to today.
    const gamed = observeDeferral(
      first,
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-09-01" },
      "2026-09-01"
    );
    expect(gamed["mine-run"]!.firstObservedAt).toBe("2026-08-07");
  });

  it("a MATERIALLY different gate set (a genuinely new promise) DOES reset the clock — this is deliberate, not a bug", () => {
    const first = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-15"
    );
    const reshaped = observeDeferral(
      first,
      { gameId: "mine-run", lane: "solo-chase", gates: ["strongVsRandomRatio"], since: "2026-08-20" },
      "2026-08-20"
    );
    expect(reshaped["mine-run"]!.firstObservedAt).toBe("2026-08-20");
    expect(reshaped["mine-run"]!.lastDischargedAt).toBeUndefined();
  });

  it("rejects a malformed `since` (InvalidDeferralSinceError) rather than silently misdating the ledger", () => {
    expect(() =>
      observeDeferral({}, { gameId: "x", lane: "solo-chase", gates: ["a"], since: "08/07/2026" }, "2026-08-15")
    ).toThrow(InvalidDeferralSinceError);
  });
});

describe("recordDischarge — a later real nightly run recognized as the discharging one (requirement 1)", () => {
  it("PLANTED VIOLATION, DISCHARGED: an aged deferral, once nightly measures the SAME gate set for real, resets age to 0", () => {
    const observed = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-15"
    );
    expect(deferralAgeDays(observed["mine-run"]!, "2026-08-15")).toBe(8); // aged, undischarged

    const discharged = recordDischarge(
      observed,
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES] },
      "2026-08-15"
    );
    expect(discharged["mine-run"]!.lastDischargedAt).toBe("2026-08-15");
    expect(deferralAgeDays(discharged["mine-run"]!, "2026-08-15")).toBe(0);

    // Tonight's discharge does not erase the historical firstObservedAt — only the AGE clock,
    // which is measured from the more recent of the two, resets.
    expect(discharged["mine-run"]!.firstObservedAt).toBe("2026-08-07");

    // The very next CI run re-declares the SAME deferral (Strong is still unaffordable at "ci"
    // tomorrow) — age must measure from last night's discharge, not from 2026-08-07 again.
    const nextCiRun = observeDeferral(
      discharged,
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-17"
    );
    expect(deferralAgeDays(nextCiRun["mine-run"]!, "2026-08-17")).toBe(2);
  });

  it("a discharge for an identity never observed before still records it (nightly running before any CI observation is not a lost event)", () => {
    const discharged = recordDischarge(
      {},
      { gameId: "fresh-game", lane: "two-player", gates: ["strong-vs-random"] },
      "2026-08-15"
    );
    expect(discharged["fresh-game"]!.firstObservedAt).toBe("2026-08-15");
    expect(discharged["fresh-game"]!.lastDischargedAt).toBe("2026-08-15");
    expect(deferralAgeDays(discharged["fresh-game"]!, "2026-08-15")).toBe(0);
  });
});

describe("annotateDeferralAging — per-row severity and the report-level materiality gate (requirements 2 and 3)", () => {
  it("no deferred rows at all: undefined (a no-op — games with no deferrals must be untouched by this mechanism)", () => {
    const rows = [
      { name: "first-player-win-rate", status: "pass" },
      { name: "draw-rate", status: "pass" },
    ];
    expect(annotateDeferralAging("fadeout", rows, undefined, "2026-08-15")).toBeUndefined();
  });

  it("fresh (age 0, e.g. the moment a deferral is first declared): materiality NOT breached, does not force a fail — C27's deferral stays usable on day one", () => {
    const ledger = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-15" },
      "2026-08-15"
    );
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), ledger["mine-run"], "2026-08-15")!;
    expect(aging.applicableGateCount).toBe(10);
    expect(aging.staleOrOverdueCount).toBe(0);
    expect(aging.materialityBreached).toBe(false);
    expect(aging.anyOverdue).toBe(false);
    expect(aging.forcesFail).toBe(false);
  });

  it("PLANTED VIOLATION — MATERIAL FRACTION (requirement 3, the real Mine Run 8/10 shape): once stale, 8/10 = 80% >= the 50% materiality bar forces a fail even with NO row individually overdue yet", () => {
    const ledger = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-15" // age 8d — stale (>=7), well under fatal (30)
    );
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), ledger["mine-run"], "2026-08-15")!;
    expect(aging.staleOrOverdueFraction).toBeCloseTo(0.8, 10);
    expect(aging.staleOrOverdueFraction).toBeGreaterThanOrEqual(DEFERRAL_MATERIAL_FRACTION);
    expect(aging.anyOverdue).toBe(false);
    expect(aging.materialityBreached).toBe(true);
    expect(aging.forcesFail).toBe(true);
  });

  it("PLANTED VIOLATION — AGED PAST FATAL (requirement 2): 30+ days undischarged is overdue and forces a fail on its own, independent of materiality", () => {
    const ledger = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-09-06" // 30 days later, still never discharged
    );
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), ledger["mine-run"], "2026-09-06")!;
    expect(aging.rows.every((r) => r.severity === "overdue")).toBe(true);
    expect(aging.anyOverdue).toBe(true);
    expect(aging.forcesFail).toBe(true);
  });

  it("a NON-material fraction (1/10) does not force a fail even once stale — the materiality gate is about a MAJORITY of a game's gates going dark together, not any single stale row", () => {
    const rows = [
      { name: "solo-x", status: "deferred" },
      ...Array.from({ length: 9 }, (_, i) => ({ name: `pass-${i}`, status: "pass" })),
    ];
    const ledger = observeDeferral({}, { gameId: "one-row-game", lane: "solo-chase", gates: ["solo-x"], since: "2026-08-01" }, "2026-08-15");
    const aging = annotateDeferralAging("one-row-game", rows, ledger["one-row-game"], "2026-08-15")!;
    expect(aging.staleOrOverdueFraction).toBeCloseTo(0.1, 10);
    expect(aging.materialityBreached).toBe(false);
    expect(aging.anyOverdue).toBe(false);
    expect(aging.forcesFail).toBe(false);
  });

  it("a missing ledger entry for an active deferral is treated as age 0 (fresh), never as an instant failure — the conservative direction for a caller that has not yet persisted its first observation", () => {
    const aging = annotateDeferralAging("mine-run", mineRunShapedRows(), undefined, "2026-08-15")!;
    expect(aging.forcesFail).toBe(false);
  });
});

describe("effectiveOk — the exit-code combinator", () => {
  it("true when the report was already ok and aging is absent (no deferrals) — untouched behavior", () => {
    expect(effectiveOk(true, undefined)).toBe(true);
  });

  it("true when aging exists but has not forced a fail (fresh or non-material stale)", () => {
    expect(effectiveOk(true, { forcesFail: false } as never)).toBe(true);
  });

  it("false when aging forces a fail, even though the underlying gate report itself was ok (report.ok=true, no `fail` row) — this is exactly C70's 'OK with exit 0' defect", () => {
    expect(effectiveOk(true, { forcesFail: true } as never)).toBe(false);
  });

  it("stays false when the underlying report already failed, aging or not", () => {
    expect(effectiveOk(false, undefined)).toBe(false);
    expect(effectiveOk(false, { forcesFail: false } as never)).toBe(false);
  });
});

describe("ledger I/O — checked-in JSON, atomic write, ENOENT-as-empty (mirrors certify.ts's own convention)", () => {
  it("readDeferralLedger returns {} for a file that does not exist yet", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = path.join(os.tmpdir(), `deferral-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const ledger = await readDeferralLedger(path.join(dir, "deferral-ledger.json"));
    expect(ledger).toEqual({});
  });

  it("round-trips a ledger written by writeDeferralLedger", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = path.join(os.tmpdir(), `deferral-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const file = path.join(dir, "nested", "deferral-ledger.json");
    const ledger = observeDeferral(
      {},
      { gameId: "mine-run", lane: "solo-chase", gates: [...MINE_RUN_DEFERRED_GATES], since: "2026-08-07" },
      "2026-08-15"
    );
    await writeDeferralLedger(file, ledger);
    const roundTripped = await readDeferralLedger(file);
    expect(roundTripped).toEqual(ledger);
  });

  it("writes deterministically (sorted keys) so a re-run with unchanged content produces a byte-identical file — no unnecessary git churn", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = path.join(os.tmpdir(), `deferral-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const file = path.join(dir, "deferral-ledger.json");
    let ledger: DeferralLedger = {};
    ledger = observeDeferral(ledger, { gameId: "zzz-game", lane: "solo-chase", gates: ["a"], since: "2026-08-01" }, "2026-08-15");
    ledger = observeDeferral(ledger, { gameId: "aaa-game", lane: "two-player", gates: ["b"], since: "2026-08-01" }, "2026-08-15");
    await writeDeferralLedger(file, ledger);
    const first = await (await import("node:fs/promises")).readFile(file, "utf8");
    await writeDeferralLedger(file, ledger);
    const second = await (await import("node:fs/promises")).readFile(file, "utf8");
    expect(second).toBe(first);
    expect(first.indexOf("aaa-game")).toBeLessThan(first.indexOf("zzz-game"));
  });
});

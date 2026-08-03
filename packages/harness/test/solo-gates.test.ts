// packages/harness/test/solo-gates.test.ts — C2 (platform-corrections.md): the solo-ci gate
// table must be selected by `manifest.solo.format`, never by player count, and a gate that
// does not apply to a format must be reported as explicitly N/A — never silently omitted, and
// never collapsed into "pass" (a skipped gate and a passed gate must never look the same).

import { describe, expect, it } from "vitest";
import type { GameManifest } from "@twist-arcade/game-spec";
import {
  allGatesPass,
  evaluateSoloGates,
  type EvaluateSoloGatesInput,
  type SoloGateChaseInputs,
  type SoloGatePuzzleInputs,
} from "../src/solo-gates";
import type { SoloDistributionMetrics } from "../src/solo-metrics";

function healthyMetrics(overrides: Partial<SoloDistributionMetrics> = {}): SoloDistributionMetrics {
  return {
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
    ...overrides,
  };
}

function chaseManifest(overrides: Partial<GameManifest> = {}): Pick<GameManifest, "solo" | "thresholds"> {
  return { solo: { format: "score-chase" }, ...overrides };
}

function puzzleManifest(overrides: Partial<GameManifest> = {}): Pick<GameManifest, "solo" | "thresholds"> {
  return { solo: { format: "daily-puzzle" }, ...overrides };
}

const healthyChaseInputs: SoloGateChaseInputs = {
  metrics: healthyMetrics(),
  grind: { found: false },
  alwaysSafeVsStrong: 0.6,
};

const healthyPuzzleInputs: SoloGatePuzzleInputs = {
  certificate: { present: true, verifiedByReplay: true, par: 20 },
  randomPlayoutSolveRate: 0.1,
  forcedMoveFraction: 0.4,
  generatorRejectionRate: 0.2,
  certifiedBufferDays: 60,
};

describe("C2 — gate table selection by manifest.solo.format, never by player count", () => {
  it("a score-chase manifest evaluates score-chase rows and reports EVERY puzzle row as explicit n/a", () => {
    const results = evaluateSoloGates({ manifest: chaseManifest(), chase: healthyChaseInputs });
    const byName = new Map(results.map((r) => [r.name, r]));

    // Score-chase rows are actually EVALUATED (not n/a).
    for (const name of [
      "strongVsRandomRatio",
      "distributionOverlap",
      "greedyVsRandomRatio",
      "strongVsGreedyRatio",
      "strongScoreCV",
      "alwaysSafeVsStrong",
      "grindProbe",
      "medianRunLength",
      "capHitRate",
      "ceilingPileUp",
    ]) {
      expect(byName.get(name)?.status).not.toBe("n/a");
    }

    // Puzzle-only rows are explicitly n/a — present in the report, not omitted.
    for (const name of [
      "certificatePresent",
      "certificatePar",
      "randomPlayoutSolveRate",
      "forcedMoveFraction",
      "generatorRejectionRate",
      "dayOverDayDrift",
      "certifiedBufferDays",
    ]) {
      const row = byName.get(name);
      expect(row).toBeDefined();
      expect(row?.status).toBe("n/a");
      expect(row?.detail.length).toBeGreaterThan(0); // never a blank/silent n/a
    }
  });

  it("a daily-puzzle manifest evaluates puzzle rows and reports EVERY score-chase row as explicit n/a", () => {
    const results = evaluateSoloGates({ manifest: puzzleManifest(), puzzle: healthyPuzzleInputs });
    const byName = new Map(results.map((r) => [r.name, r]));

    for (const name of [
      "certificatePresent",
      "certificatePar",
      "randomPlayoutSolveRate",
      "forcedMoveFraction",
      "generatorRejectionRate",
      "certifiedBufferDays",
    ]) {
      expect(byName.get(name)?.status).not.toBe("n/a");
    }

    for (const name of [
      "strongVsRandomRatio",
      "distributionOverlap",
      "greedyVsRandomRatio",
      "strongVsGreedyRatio",
      "strongScoreCV",
      "alwaysSafeVsStrong",
      "grindProbe",
      "medianRunLength",
      "capHitRate",
      "ceilingPileUp",
      "suicideProbe",
    ]) {
      const row = byName.get(name);
      expect(row).toBeDefined();
      expect(row?.status).toBe("n/a");
      expect(row?.detail.length).toBeGreaterThan(0);
    }
  });

  it("two DIFFERENT maxPlayers=1 manifests (chase vs puzzle) never produce the identical gate table — the defect C2 exists to prevent", () => {
    const chaseResults = evaluateSoloGates({ manifest: chaseManifest(), chase: healthyChaseInputs });
    const puzzleResults = evaluateSoloGates({ manifest: puzzleManifest(), puzzle: healthyPuzzleInputs });
    const chaseStatuses = new Map(chaseResults.map((r) => [r.name, r.status]));
    const puzzleStatuses = new Map(puzzleResults.map((r) => [r.name, r.status]));
    // Every gate name appears in both reports (same shape)...
    expect(new Set(chaseStatuses.keys())).toEqual(new Set(puzzleStatuses.keys()));
    // ...but the n/a rows are exactly swapped, never identical wholesale.
    expect(chaseStatuses).not.toEqual(puzzleStatuses);
  });

  it("throws (a caller error, not a silent n/a) when score-chase inputs are missing for a score-chase manifest", () => {
    const input: EvaluateSoloGatesInput = { manifest: chaseManifest() };
    expect(() => evaluateSoloGates(input)).toThrow(/chase/i);
  });

  it("throws when puzzle inputs are missing for a daily-puzzle manifest", () => {
    const input: EvaluateSoloGatesInput = { manifest: puzzleManifest() };
    expect(() => evaluateSoloGates(input)).toThrow(/puzzle/i);
  });
});

describe("score-chase gate thresholds — hard-fail lines (roadmap §6, solo-games-lens §3.8)", () => {
  it("passes a healthy roster", () => {
    const results = evaluateSoloGates({ manifest: chaseManifest(), chase: healthyChaseInputs });
    expect(allGatesPass(results)).toBe(true);
  });

  it("fails strongVsRandomRatio below 1.5 (a slot machine)", () => {
    const results = evaluateSoloGates({
      manifest: chaseManifest(),
      chase: { ...healthyChaseInputs, metrics: healthyMetrics({ strongVsRandomRatio: 1.2 }) },
    });
    const row = results.find((r) => r.name === "strongVsRandomRatio")!;
    expect(row.status).toBe("fail");
    expect(allGatesPass(results)).toBe(false);
  });

  it("fails alwaysSafeVsStrong at >= 0.95 (the risk is fake)", () => {
    const results = evaluateSoloGates({
      manifest: chaseManifest(),
      chase: { ...healthyChaseInputs, alwaysSafeVsStrong: 0.97 },
    });
    expect(results.find((r) => r.name === "alwaysSafeVsStrong")?.status).toBe("fail");
  });

  it("fails grindProbe when a cycle was found", () => {
    const results = evaluateSoloGates({
      manifest: chaseManifest(),
      chase: { ...healthyChaseInputs, grind: { found: true, cycle: [], scoreDelta: 0, startSeed: "s" } },
    });
    expect(results.find((r) => r.name === "grindProbe")?.status).toBe("fail");
  });

  it("fails medianRunLength outside [15, 600]", () => {
    const results = evaluateSoloGates({
      manifest: chaseManifest(),
      chase: { ...healthyChaseInputs, metrics: healthyMetrics({ medianRunLength: 700 }) },
    });
    expect(results.find((r) => r.name === "medianRunLength")?.status).toBe("fail");
  });

  it("respects a manifest.thresholds override (a looser minStrongVsRandomRatio floor)", () => {
    const results = evaluateSoloGates({
      manifest: chaseManifest({ thresholds: { minStrongVsRandomRatio: 1.0 } }),
      chase: { ...healthyChaseInputs, metrics: healthyMetrics({ strongVsRandomRatio: 1.2 }) },
    });
    // 1.2 would fail the default 1.5 floor but passes an overridden 1.0 floor.
    expect(results.find((r) => r.name === "strongVsRandomRatio")?.status).toBe("pass");
  });

  it("evaluates the suicide probe only when explicitly supplied (misère-tagged), n/a otherwise", () => {
    const notTagged = evaluateSoloGates({ manifest: chaseManifest(), chase: healthyChaseInputs });
    expect(notTagged.find((r) => r.name === "suicideProbe")?.status).toBe("n/a");

    const taggedAndBroken = evaluateSoloGates({
      manifest: chaseManifest(),
      chase: { ...healthyChaseInputs, suicide: { suicideIsOptimalLine: true } },
    });
    expect(taggedAndBroken.find((r) => r.name === "suicideProbe")?.status).toBe("fail");

    const taggedAndHealthy = evaluateSoloGates({
      manifest: chaseManifest(),
      chase: { ...healthyChaseInputs, suicide: { suicideIsOptimalLine: false } },
    });
    expect(taggedAndHealthy.find((r) => r.name === "suicideProbe")?.status).toBe("pass");
  });
});

describe("daily-puzzle gate thresholds (docs/plans/crackstep.md §5)", () => {
  it("passes a healthy day", () => {
    const results = evaluateSoloGates({ manifest: puzzleManifest(), puzzle: healthyPuzzleInputs });
    expect(allGatesPass(results)).toBe(true);
  });

  it("fails certificatePresent when the certificate is missing", () => {
    const results = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, certificate: { present: false, verifiedByReplay: false, par: 0 } },
    });
    expect(results.find((r) => r.name === "certificatePresent")?.status).toBe("fail");
  });

  it("fails certificatePresent when the certificate is present but fails CI replay", () => {
    const results = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, certificate: { present: true, verifiedByReplay: false, par: 20 } },
    });
    expect(results.find((r) => r.name === "certificatePresent")?.status).toBe("fail");
  });

  it("fails certificatePar outside [8, 80]", () => {
    const results = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, certificate: { present: true, verifiedByReplay: true, par: 5 } },
    });
    expect(results.find((r) => r.name === "certificatePar")?.status).toBe("fail");
  });

  it("warns (not fails) generatorRejectionRate between 50% and 90%, fails above 90%", () => {
    const warned = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, generatorRejectionRate: 0.6 },
    });
    expect(warned.find((r) => r.name === "generatorRejectionRate")?.status).toBe("warn");
    expect(allGatesPass(warned)).toBe(true); // warn does not fail CI

    const failed = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, generatorRejectionRate: 0.95 },
    });
    expect(failed.find((r) => r.name === "generatorRejectionRate")?.status).toBe("fail");
  });

  it("warns certifiedBufferDays below 30, fails below 7", () => {
    const warned = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, certifiedBufferDays: 20 },
    });
    expect(warned.find((r) => r.name === "certifiedBufferDays")?.status).toBe("warn");

    const failed = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, certifiedBufferDays: 3 },
    });
    expect(failed.find((r) => r.name === "certifiedBufferDays")?.status).toBe("fail");
  });

  it("reports dayOverDayDrift as n/a (with a reason) when there is no prior day, not a silent pass", () => {
    const results = evaluateSoloGates({ manifest: puzzleManifest(), puzzle: healthyPuzzleInputs });
    const row = results.find((r) => r.name === "dayOverDayDrift")!;
    expect(row.status).toBe("n/a");
    expect(row.detail).toMatch(/no prior/i);
  });

  it("fails dayOverDayDrift when supplied and beyond 1.5σ", () => {
    const results = evaluateSoloGates({
      manifest: puzzleManifest(),
      puzzle: { ...healthyPuzzleInputs, dayOverDayDriftSigma: 2.1 },
    });
    expect(results.find((r) => r.name === "dayOverDayDrift")?.status).toBe("fail");
  });
});

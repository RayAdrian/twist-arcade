// packages/harness/test/calibrate.test.ts — TDD anchors for `harness calibrate` (M3d): the
// feature distribution a candidate daily is z-scored against, and the generator-rejection-rate
// signal solo-gates.ts's warn(>50%)/fail(>90%) thresholds consume.

import { describe, expect, it } from "vitest";
import { calibrate, dayOverDayDriftSigma, withinBand, zScore, type FeatureStats } from "../src/calibrate";
import { dfsSolver } from "../src/solver/generic-solo";
import { holeWalk } from "./fixtures/hole-walk";
import type { HoleWalkMove, HoleWalkState } from "./fixtures/hole-walk";

function seeds(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}:${i}`);
}

describe("calibrate — a real generated batch (hole-walk fixture)", () => {
  it("classifies every seed as usable, unsolvable, or budget-exhausted, and the counts add up", () => {
    const result = calibrate({
      engine: holeWalk,
      solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
      seeds: seeds("calib", 40),
      solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
      randomPlayoutTrials: 50,
    });
    expect(result.sampleCount).toBe(40);
    expect(result.usableCount + result.rejectedUnsolvable + result.rejectedBudgetExhausted).toBe(40);
    expect(result.rejectionRate).toBeCloseTo(
      (result.rejectedUnsolvable + result.rejectedBudgetExhausted) / 40,
      10
    );
  }, 15_000);

  it("length stats are computed only over SOLVED seeds — every observed length is >= the grid's Manhattan floor (5)", () => {
    const result = calibrate({
      engine: holeWalk,
      solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
      seeds: seeds("calib-len", 40),
      solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
      randomPlayoutTrials: 50,
    });
    expect(result.length.n).toBe(result.usableCount);
    if (result.length.n > 0) {
      expect(result.length.mean).toBeGreaterThanOrEqual(5);
    }
  }, 15_000);

  it("returns all-zero stats (n=0), not NaN, when every seed is unsolvable", () => {
    const alwaysUnsolvable = { solve: () => ({ outcome: "unsolvable" as const, nodesExpanded: 1 }) };
    const result = calibrate({ engine: holeWalk, solver: alwaysUnsolvable, seeds: seeds("calib-none", 10) });
    expect(result.usableCount).toBe(0);
    expect(result.rejectionRate).toBe(1);
    expect(result.length).toEqual({ mean: 0, stddev: 0, n: 0 });
    expect(Number.isNaN(result.length.mean)).toBe(false);
  });

  it("returns a zero rejectionRate (not NaN) for an empty seed list", () => {
    const result = calibrate({ engine: holeWalk, solver: dfsSolver<HoleWalkState, HoleWalkMove>(), seeds: [] });
    expect(result.sampleCount).toBe(0);
    expect(result.rejectionRate).toBe(0);
  });
});

describe("zScore / withinBand — the documented zero-stddev edge case", () => {
  const stats: FeatureStats = { mean: 20, stddev: 4, n: 100 };

  it("computes a plain z-score for a normal distribution", () => {
    expect(zScore(24, stats)).toBeCloseTo(1, 10);
    expect(zScore(12, stats)).toBeCloseTo(-2, 10);
  });

  it("withinBand respects the sigma threshold in both directions", () => {
    expect(withinBand(22, stats, 0.5)).toBe(true); // z = 0.5, at the boundary
    expect(withinBand(23, stats, 0.5)).toBe(false); // z = 0.75
    expect(withinBand(8, stats, 1.5)).toBe(false); // z = -3
  });

  it("is 0 for an exact match and +Infinity otherwise when stddev is 0 (never NaN, never a finite fallback)", () => {
    const constant: FeatureStats = { mean: 10, stddev: 0, n: 5 };
    expect(zScore(10, constant)).toBe(0);
    expect(zScore(11, constant)).toBe(Number.POSITIVE_INFINITY);
    expect(withinBand(10, constant, 0.5)).toBe(true);
    expect(withinBand(11, constant, 0.5)).toBe(false);
  });
});

describe("dayOverDayDriftSigma", () => {
  it("is the signed difference between two days' z-scores", () => {
    expect(dayOverDayDriftSigma(0.2, 0.9)).toBeCloseTo(0.7, 10);
    expect(dayOverDayDriftSigma(0.9, 0.2)).toBeCloseTo(-0.7, 10);
    expect(dayOverDayDriftSigma(0, 0)).toBe(0);
  });
});

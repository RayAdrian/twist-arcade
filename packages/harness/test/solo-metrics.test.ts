// packages/harness/test/solo-metrics.test.ts — verifies the WIP solo-metrics.ts (committed at
// 1003679, never previously exercised): the percentile/CV/safeRatio edge cases the module's
// own doc comments call out by name, and the composite computeSoloDistributionMetrics gates
// (solo-games-lens §3.2/§3.5/§3.7, roadmap §6).

import { describe, expect, it } from "vitest";
import {
  coefficientOfVariation,
  computeSoloDistributionMetrics,
  mean,
  median,
  percentile,
  safeRatio,
  stddev,
} from "../src/solo-metrics";
import type { SoloRunSummary } from "../src/solo-runner";

function summaryOf(name: string, scores: number[], decisionsList?: number[], capHitRate = 0): SoloRunSummary {
  return {
    name,
    runs: scores.map((finalScore, i) => ({
      seed: `${name}-${i}`,
      finalScore,
      decisions: decisionsList?.[i] ?? 10,
      capHit: false,
      terminal: "scored",
      moveLog: [],
    })),
    scores,
    decisionsList: decisionsList ?? scores.map(() => 10),
    capHitRate,
  };
}

describe("basic statistics", () => {
  it("mean/median/stddev of an empty array are all 0, never NaN", () => {
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(stddev([])).toBe(0);
  });

  it("percentile clamps p<=0 to the min and p>=1 to the max", () => {
    const xs = [5, 1, 3, 2, 4];
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 1)).toBe(5);
    expect(percentile(xs, -1)).toBe(1);
    expect(percentile(xs, 2)).toBe(5);
  });

  it("median of [1,2,3,4] linearly interpolates to 2.5", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("coefficientOfVariation — documented zero-mean edge cases", () => {
  it("is 0 for a constant-zero sample (no variability, not undefined)", () => {
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });

  it("is +Infinity for a zero-mean sample with any spread (never NaN, never a finite fallback)", () => {
    expect(coefficientOfVariation([-1, 1])).toBe(Number.POSITIVE_INFINITY);
  });

  it("is a finite ratio for a normal non-zero-mean sample", () => {
    const cv = coefficientOfVariation([8, 10, 12]);
    expect(cv).toBeGreaterThan(0);
    expect(Number.isFinite(cv)).toBe(true);
  });
});

describe("safeRatio — documented zero-denominator edge cases", () => {
  it("is +Infinity when the denominator is 0 and the numerator is positive (best possible separation)", () => {
    expect(safeRatio(5, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is 1 when both are 0 (vacuously equal, neither pass nor fail)", () => {
    expect(safeRatio(0, 0)).toBe(1);
  });

  it("is a plain ratio otherwise", () => {
    expect(safeRatio(9, 3)).toBe(3);
  });
});

describe("computeSoloDistributionMetrics — the CI gate shape (roadmap §6, solo-games-lens §3.2)", () => {
  it("flags healthy separation: Strong p10 >= Random p90 (distributionSeparated=true)", () => {
    const random = summaryOf("random", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const greedy = summaryOf("greedy", [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    const strong = summaryOf("strong", [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
    const metrics = computeSoloDistributionMetrics({ random, greedy, strong });
    expect(metrics.distributionSeparated).toBe(true);
    expect(metrics.distributionOverlapsBadly).toBe(false);
    expect(metrics.strongVsRandomRatio).toBeGreaterThanOrEqual(1.5);
  });

  it("flags a slot-machine failure: Strong median close to Random's (ratio < 1.5, overlap bad)", () => {
    const random = summaryOf("random", [10, 10, 10, 10, 10]);
    const greedy = summaryOf("greedy", [10, 10, 10, 10, 10]);
    const strong = summaryOf("strong", [9, 9, 9, 9, 9]);
    const metrics = computeSoloDistributionMetrics({ random, greedy, strong });
    expect(metrics.strongVsRandomRatio).toBeLessThan(1.5);
    expect(metrics.distributionOverlapsBadly).toBe(true);
  });

  it("reports ceilingPileUp trivially 0 when no ceilingScore is declared", () => {
    const random = summaryOf("random", [1, 2, 3]);
    const greedy = summaryOf("greedy", [4, 5, 6]);
    const strong = summaryOf("strong", [100, 100, 100]);
    const metrics = computeSoloDistributionMetrics({ random, greedy, strong });
    expect(metrics.ceilingPileUp).toBe(0);
  });

  it("computes ceilingPileUp as the fraction of Strong runs within 1% of the declared ceiling", () => {
    const random = summaryOf("random", [1]);
    const greedy = summaryOf("greedy", [2]);
    const strong = summaryOf("strong", [100, 100, 50, 99.5]); // 3/4 within 1% of ceiling 100
    const metrics = computeSoloDistributionMetrics({ random, greedy, strong }, { ceilingScore: 100 });
    expect(metrics.ceilingPileUp).toBeCloseTo(0.75, 5);
  });

  it("capHitRate is the max across all three policies, not a sum or an average", () => {
    const random = summaryOf("random", [1, 2], [10, 10], 0.02);
    const greedy = summaryOf("greedy", [3, 4], [10, 10], 0.5);
    const strong = summaryOf("strong", [5, 6], [10, 10], 0.1);
    const metrics = computeSoloDistributionMetrics({ random, greedy, strong });
    expect(metrics.capHitRate).toBe(0.5);
  });
});

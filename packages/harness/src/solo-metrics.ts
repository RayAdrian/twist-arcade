// packages/harness/src/solo-metrics.ts — distribution separation, CV, overlap, run-length,
// and ceiling pile-up (phase-0 plan §7.3, solo-games-lens §3.2/§3.5/§3.7). "Skill is
// distribution separation, not head-to-head wins — there is no head to head."

import type { SoloRunSummary } from "./solo-runner";

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Linear-interpolation percentile (p in [0,1]), the common "R-7" convention — matches what
 *  most stats libraries mean by "the p90" for a finite sample. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  if (p <= 0) return Math.min(...xs);
  if (p >= 1) return Math.max(...xs);
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function median(xs: readonly number[]): number {
  return percentile(xs, 0.5);
}

export function stddev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/** stddev / |mean|. A constant-zero sample (mean 0, stddev 0) has CV 0 (no variability, not
 *  undefined); a sample with any spread around a zero mean has CV +Infinity (unbounded
 *  relative variability) rather than NaN or 0 — either finite fallback would silently hide a
 *  real luck-band violation from the CI gate. */
export function coefficientOfVariation(xs: readonly number[]): number {
  const m = mean(xs);
  const sd = stddev(xs);
  if (m === 0) return sd === 0 ? 0 : Number.POSITIVE_INFINITY;
  return sd / Math.abs(m);
}

/** a/b, with the same "no silent finite fallback" posture as coefficientOfVariation: a zero
 *  denominator with a positive numerator is +Infinity (Strong dominating a Random that never
 *  scores is the BEST possible separation, not a broken ratio), and 0/0 is defined as 1 (two
 *  identically-null distributions are, vacuously, "equal" — neither a pass nor an artificial
 *  fail). */
export function safeRatio(a: number, b: number): number {
  if (b === 0) return a === 0 ? 1 : Number.POSITIVE_INFINITY;
  return a / b;
}

export interface SoloDistributionMetrics {
  strongVsRandomRatio: number;
  greedyVsRandomRatio: number;
  strongVsGreedyRatio: number;
  strongMedian: number;
  randomMedian: number;
  greedyMedian: number;
  strongP10: number;
  randomP75: number;
  randomP90: number;
  /** Design gate: Strong's p10 >= Random's p90 ("a strong player's bad run still beats a
   *  random player's good run"). */
  distributionSeparated: boolean;
  /** CI hard fail: Strong's median < Random's p75. */
  distributionOverlapsBadly: boolean;
  strongScoreCV: number;
  medianRunLength: number;
  p95RunLength: number;
  /** max across the three roster policies — the gate is "any policy" (platform §7.5). */
  capHitRate: number;
  /** fraction of Strong's runs within 1% of `opts.ceilingScore`; 0 (trivially green, per Mine
   *  Run plan §4.6) when no design cap is declared for the game. */
  ceilingPileUp: number;
}

export interface ComputeSoloDistributionMetricsOptions {
  /** A design cap / maximum achievable score, when the game declares one. Omit for games
   *  with no supremum (floods etc. make it "soft") — the pile-up gate is then reported
   *  trivially green rather than computed against a fabricated ceiling. */
  ceilingScore?: number;
}

export function computeSoloDistributionMetrics(
  runs: { random: SoloRunSummary; greedy: SoloRunSummary; strong: SoloRunSummary },
  opts: ComputeSoloDistributionMetricsOptions = {}
): SoloDistributionMetrics {
  const { random, greedy, strong } = runs;

  const strongMedian = median(strong.scores);
  const randomMedian = median(random.scores);
  const greedyMedian = median(greedy.scores);
  const strongP10 = percentile(strong.scores, 0.1);
  const randomP75 = percentile(random.scores, 0.75);
  const randomP90 = percentile(random.scores, 0.9);

  const allRunLengths = [...random.decisionsList, ...greedy.decisionsList, ...strong.decisionsList];

  let ceilingPileUp = 0;
  if (opts.ceilingScore !== undefined) {
    const threshold = opts.ceilingScore * 0.99;
    const within = strong.scores.filter((s) => s >= threshold).length;
    ceilingPileUp = strong.scores.length === 0 ? 0 : within / strong.scores.length;
  }

  return {
    strongVsRandomRatio: safeRatio(strongMedian, randomMedian),
    greedyVsRandomRatio: safeRatio(greedyMedian, randomMedian),
    strongVsGreedyRatio: safeRatio(strongMedian, greedyMedian),
    strongMedian,
    randomMedian,
    greedyMedian,
    strongP10,
    randomP75,
    randomP90,
    distributionSeparated: strongP10 >= randomP90,
    distributionOverlapsBadly: strongMedian < randomP75,
    strongScoreCV: coefficientOfVariation(strong.scores),
    medianRunLength: median(allRunLengths),
    p95RunLength: percentile(allRunLengths, 0.95),
    capHitRate: Math.max(random.capHitRate, greedy.capHitRate, strong.capHitRate),
    ceilingPileUp,
  };
}

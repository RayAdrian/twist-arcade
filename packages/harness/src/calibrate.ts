// packages/harness/src/calibrate.ts — `harness calibrate` (M3d, platform §7.7 /
// solo-games-lens §3.4): generates and solves a batch of candidate seeds ONCE (nightly-tier,
// once per game + drift checks — never PR-tier), computing the feature distribution every
// candidate daily is later z-scored against. Also the generator-rejection-rate report
// (solo-games-lens §3.3/§3.4: warn > 50%, hard-fail > 90%, evaluated by solo-gates.ts) so
// generator/band mismatches show up here, in a batch job, rather than as a slow trickle of
// certify-time rejections nobody is watching in aggregate.
//
// Seed enumeration is injected (`seeds: readonly string[]`), same posture as certify.ts's
// `seedFor` — this module does not own `dailyFormula` or any notion of "the next 10,000
// candidate seeds"; a caller (the daily team's formula, or a test's own list) supplies them.

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { rngForSetup } from "@twist-arcade/engine";
import type { SoloSolveBudget, SoloSolver } from "@twist-arcade/game-spec";
import { computePathFeatures, randomPlayoutStats } from "./certify";

const DEFAULT_SOLVE_BUDGET: SoloSolveBudget = { maxNodes: 1e7, maxMs: 10_000 };
const DEFAULT_RANDOM_PLAYOUT_TRIALS = 200;

export interface CalibrateOptions<S extends WithEffects, M extends Json, V extends WithEffects> {
  engine: GameEngine<S, M, V>;
  solver: SoloSolver<S, M>;
  seeds: readonly string[];
  solveBudget?: SoloSolveBudget;
  randomPlayoutTrials?: number;
}

export interface FeatureStats {
  readonly mean: number;
  readonly stddev: number;
  readonly n: number;
}

export interface CalibrationResult {
  readonly sampleCount: number;
  readonly usableCount: number;
  readonly rejectedUnsolvable: number;
  readonly rejectedBudgetExhausted: number;
  /** (sampleCount - usableCount) / sampleCount — solo-games-lens §3.3/§3.4's generator-
   *  rejection-rate signal, evaluated by solo-gates.ts (warn > 50%, fail > 90%). This is
   *  DELIBERATELY the raw unsolvable/budget-exhausted rate only — triviality (too-short/too-
   *  forced/too-easy) is a BAND question this module's stats feed, not a rejection this
   *  function decides on its own, so a caller layering certifyDay's stricter triviality
   *  clauses on top will see a HIGHER rejection rate than this raw number, by design. */
  readonly rejectionRate: number;
  readonly length: FeatureStats;
  readonly forcedMoveFraction: FeatureStats;
  readonly branchingMean: FeatureStats;
  readonly deadEndDensity: FeatureStats;
  readonly solverNodes: FeatureStats;
}

function statsOf(xs: readonly number[]): FeatureStats {
  const n = xs.length;
  if (n === 0) return { mean: 0, stddev: 0, n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / n;
  return { mean, stddev: Math.sqrt(variance), n };
}

/**
 * Runs the solver over every seed in `seeds`, collecting the feature vector for every solved
 * candidate (unsolvable and budget-exhausted candidates are tallied but excluded from the
 * feature distribution — an unsolvable seed has no `par` to contribute). This is the batch
 * calibration pass; `certifyDay`'s per-day `withinDifficultyBand`/`zScoreFor` hooks are meant
 * to be built from THIS result's `.length` stats (and any other feature a caller cares about),
 * via `zScore`/`withinBand` below.
 */
export function calibrate<S extends WithEffects, M extends Json, V extends WithEffects>(
  opts: CalibrateOptions<S, M, V>
): CalibrationResult {
  const solveBudget = opts.solveBudget ?? DEFAULT_SOLVE_BUDGET;
  const randomPlayoutTrials = opts.randomPlayoutTrials ?? DEFAULT_RANDOM_PLAYOUT_TRIALS;

  const lengths: number[] = [];
  const forcedMoveFractions: number[] = [];
  const branchingMeans: number[] = [];
  const deadEndDensities: number[] = [];
  const solverNodes: number[] = [];
  let rejectedUnsolvable = 0;
  let rejectedBudgetExhausted = 0;

  for (const seed of opts.seeds) {
    const initial = opts.engine.setup(1, rngForSetup(seed));
    const result = opts.solver.solve(opts.engine, initial, solveBudget);
    if (result.outcome === "unsolvable") {
      rejectedUnsolvable += 1;
      continue;
    }
    if (result.outcome === "budget-exhausted") {
      rejectedBudgetExhausted += 1;
      continue;
    }
    const moveLog = result.moveLog! as unknown as M[];
    const pathFeatures = computePathFeatures(opts.engine, initial, moveLog);
    const playoutStats = randomPlayoutStats(opts.engine, initial, randomPlayoutTrials, result.length! * 4 + 50);
    lengths.push(result.length!);
    forcedMoveFractions.push(pathFeatures.forcedMoveFraction);
    branchingMeans.push(pathFeatures.branchingMean);
    deadEndDensities.push(playoutStats.deadEndDensity);
    solverNodes.push(result.nodesExpanded);
  }

  const sampleCount = opts.seeds.length;
  const usableCount = lengths.length;
  return {
    sampleCount,
    usableCount,
    rejectedUnsolvable,
    rejectedBudgetExhausted,
    rejectionRate: sampleCount === 0 ? 0 : (rejectedUnsolvable + rejectedBudgetExhausted) / sampleCount,
    length: statsOf(lengths),
    forcedMoveFraction: statsOf(forcedMoveFractions),
    branchingMean: statsOf(branchingMeans),
    deadEndDensity: statsOf(deadEndDensities),
    solverNodes: statsOf(solverNodes),
  };
}

/** How many standard deviations `value` sits from `stats.mean`. A zero-stddev distribution
 *  (every calibration sample landed on the identical value) reports 0 for an exact match and
 *  +Infinity otherwise — the same "no silent finite fallback" posture solo-metrics.ts's
 *  `coefficientOfVariation` uses, for the same reason: a finite fallback would silently hide a
 *  real drift/band violation from the CI gate. */
export function zScore(value: number, stats: FeatureStats): number {
  if (stats.stddev === 0) return value === stats.mean ? 0 : Number.POSITIVE_INFINITY;
  return (value - stats.mean) / stats.stddev;
}

/** True iff `value` is within `bandSigma` standard deviations of `stats.mean` (solo-games-lens
 *  §3.4: "target ±0.5σ around the game's chosen difficulty center"). Intended to back
 *  `certifyDay`'s `withinDifficultyBand` hook directly. */
export function withinBand(value: number, stats: FeatureStats, bandSigma: number): boolean {
  return Math.abs(zScore(value, stats)) <= bandSigma;
}

/** Day-over-day difficulty drift (solo-games-lens §3.4: "consecutive days may not drift more
 *  than 0.5σ"; platform §7.5's CI hard-fail is 1.5σ) — the SIGNED difference between two days'
 *  z-scores against the same calibration distribution, so a caller can both hard-fail on
 *  `|drift| > 1.5` and separately flag the tighter 0.5σ design target. */
export function dayOverDayDriftSigma(previousZ: number, currentZ: number): number {
  return currentZ - previousZ;
}

// packages/game-spec/src/thresholds.ts — HarnessThresholds + SoloThresholds + platform
// defaults (plan §5, §7.5). Pure data; consumed by packages/harness (M3, not this
// milestone) and referenced from GameManifest.thresholds overrides.

export interface HarnessThresholds {
  strongVsRandomMinWinRate: number; // fail < 0.90
  firstPlayerWinRateRange: [number, number]; // fail outside [0.35, 0.65]
  maxDrawRate: number; // fail > 0.60
  pliesRange: [number, number]; // fail outside [4, 200], or any cap hit
  ruthlessVsStandardMinWinRate: number; // warn at PR budget, fail nightly: < 0.60
  maxBundleKb: number; // fail > 75 kB gz/route
}

export interface SoloThresholds {
  minStrongVsRandomRatio: number; // fail < 1.5 (slot machine)
  minGreedyVsRandomRatio: number; // fail < 1.2
  minStrongVsGreedyRatio: number; // fail < 1.15
  maxStrongScoreCV: number; // fail > 1.2
  maxAlwaysSafeVsStrongRatio: number; // fail >= 0.95 (risk is fake)
  runLengthRange: [number, number]; // fail outside [15, 600] decisions
  maxCapHitRate: number; // fail > 0.01 (2,000-move cap)
  maxCeilingPileUp: number; // fail > 0.20
  certificateParRange: [number, number]; // fail outside [8, 80]
  maxRandomPlayoutSolveRate: number; // fail > 0.30 (trivial)
  maxForcedMoveFraction: number; // fail > 0.85
  maxGeneratorRejectionRate: number; // warn > 0.50, fail > 0.90
  maxDayOverDayDriftSigma: number; // fail > 1.5
  minCertifiedBufferDays: number; // alert < 30, fail < 7
}

export const DEFAULT_HARNESS_THRESHOLDS: HarnessThresholds = {
  strongVsRandomMinWinRate: 0.9,
  firstPlayerWinRateRange: [0.35, 0.65],
  maxDrawRate: 0.6,
  pliesRange: [4, 200],
  ruthlessVsStandardMinWinRate: 0.6,
  maxBundleKb: 75,
};

export const DEFAULT_SOLO_THRESHOLDS: SoloThresholds = {
  minStrongVsRandomRatio: 1.5,
  minGreedyVsRandomRatio: 1.2,
  minStrongVsGreedyRatio: 1.15,
  maxStrongScoreCV: 1.2,
  maxAlwaysSafeVsStrongRatio: 0.95,
  runLengthRange: [15, 600],
  maxCapHitRate: 0.01,
  maxCeilingPileUp: 0.2,
  certificateParRange: [8, 80],
  maxRandomPlayoutSolveRate: 0.3,
  maxForcedMoveFraction: 0.85,
  maxGeneratorRejectionRate: 0.9,
  maxDayOverDayDriftSigma: 1.5,
  minCertifiedBufferDays: 7,
};

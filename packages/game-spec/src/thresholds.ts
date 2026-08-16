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

  // Two-player degeneracy probe suite (docs/plans/degeneracy-probes.md §1, wiring C64's
  // finding: mirror/stall/rush existed as real, tested bot policies with zero CI call sites).
  // Provenance is marked in that plan per gate — stall's cap-hit fail is RECOVERED, its warn
  // and its win-rate pair are PROPOSED; rush is PROPOSED by stated analogy to the
  // MCTS-1k-vs-MCTS-100 row. All three follow the same severity split ruthless-vs-standard
  // already carries (warn at "ci", fail for real at "nightly") and are exceptionable
  // (EXCEPTIONABLE_GATES in suites.ts).
  //
  // MIRROR — CORRECTED (stage-6 review): the THRESHOLD NUMBERS below are RECOVERED
  // (roadmap.md:258, game-theory-lens §2.7/§3.4) — that re-check stands. But the METRIC
  // BINDING — gating on wins/games AT ALL, rather than a parity-style score with the same
  // proven-draw relief rush-probe has — is PROPOSED, a plan amendment (not an in-branch
  // redesign): `game-theory-lens` §5.4 names the canonical mirror degeneracy as "P2 copying
  // P1's move through the center can force a draw (or worse)," but a mirror that draws 100% of
  // its games scores a 0% win rate under wins/games — a clean PASS on the exact pathology its
  // own source document most emphasizes. The mirror matchup's draw rate is recorded in the
  // gate's detail string (probes-two-player.ts) so a future S5 baseline captures it even though
  // this metric cannot act on it today.
  mirrorProbeWinRateWarn: number; // warn >= 0.40 (mirror as P2's win rate: wins/all games)
  mirrorProbeWinRateFail: number; // fail >= 0.50
  stallProbeCapHitFail: number; // fail > 0.01 (any nonzero cap-hit rate warns below this)
  stallProbeWinRateWarn: number; // warn >= 0.20 (stall as P2's win rate: wins/all games)
  stallProbeWinRateFail: number; // fail >= 0.40
  rushProbeScoreWarn: number; // warn > 0.40 (rush's parity score: (wins + 0.5*draws)/games)
  rushProbeScoreFail: number; // fail >= 0.45
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

  mirrorProbeWinRateWarn: 0.4,
  mirrorProbeWinRateFail: 0.5,
  stallProbeCapHitFail: 0.01,
  stallProbeWinRateWarn: 0.2,
  stallProbeWinRateFail: 0.4,
  rushProbeScoreWarn: 0.4,
  rushProbeScoreFail: 0.45,
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

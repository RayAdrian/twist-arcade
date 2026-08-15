// packages/harness/src/index.ts — public barrel for @twist-arcade/harness (package.json's
// declared "main"/"types" entry). Two parallel lanes share this package and this barrel:
//
//   - The two-player self-play model (M3a/M3b): exact solvers (`reach`, `retrograde`,
//     `solveTwoPlayerGame`), the named agent roster, `runMatchup`, matchup metrics, the CI
//     gate table (`suites.ts`), and report formatters. `cli.ts` is deliberately NOT
//     re-exported here — it is a process entry point (package.json's `"bin"` subpath), not a
//     library import; pulling it in here would drag `main()`'s `process.argv`/`process.exit`
//     usage into every consumer's module graph for no reason.
//
//   - The solo validation model (M3c/M3d): the solo agent roster, the paired-seed runner,
//     solo distribution metrics, degeneracy probes (Grind/Always-Safe), the format-selected
//     solo gate table (C2), the generic solo-solver building blocks (`dfsSolver`/
//     `idaStarSolver`), the certificate pipeline, and difficulty calibration.
//
// Each lane owns its own exports and is expected to extend this barrel additively rather than
// restructure it. The solver building blocks (`reach`, `retrograde`, their types) are exported
// individually — not folded into one `solve` default — specifically so a history-dependent
// game (Fadeout, under superko) can compose them locally over its own position key, per
// correction C3. See solver/types.ts's module doc for the full caveat.
//
// NAME COLLISION: both lanes independently define a `percentile(xs, p)` helper (`./metrics`
// for two-player matchup score distributions, `./solo-metrics` for solo run-score
// distributions) — different modules, not the same function. The two-player one keeps the
// bare `percentile` name (established first); the solo one is re-exported as
// `soloPercentile` to avoid a duplicate-export error. Import directly from `./metrics` or
// `./solo-metrics` if the alias reads awkwardly at a call site.

export type { ReachEdge, ReachGraph, ReachNode, ReachOptions } from "./solver/reach";
export { reach } from "./solver/reach";

export type { RetrogradeResult } from "./solver/retrograde";
export { retrograde } from "./solver/retrograde";

export type { OpeningValue, SolveResult } from "./solver/solve";
export { solveTwoPlayerGame } from "./solver/solve";

export type { PositionValue } from "./solver/types";
export {
  assertSolvablePreconditions,
  flipValue,
  ReachLimitExceededError,
  UnsupportedGameError,
} from "./solver/types";

export type { AgentSpec, MirrorAgentSpec, PolicyAgentSpec } from "./roster";
export { mirrorAgent, resolveNamedAgent, UnknownAgentNameError } from "./roster";

export type { GameOutcome, MatchupMetrics } from "./metrics";
export { agentWinRate, computeMatchupMetrics, percentile } from "./metrics";

export type { MatchupReport, RunMatchupOptions } from "./runner";
export { HiddenInformationUnsupportedError, runMatchup } from "./runner";

export type {
  CiGateDeferral,
  CiSuiteReport,
  CompareBudgetsPoint,
  GateInputs,
  GateResult as CiGateResult,
  GateStatus as CiGateStatus,
  RunCiSuiteOptions,
  RuthlessVsStandardBudgets,
} from "./suites";
export {
  assertSuiteOk,
  compareBudgets,
  DEFERRABLE_CI_GATES,
  EmptyExceptionJustificationError,
  EmptyMirrorProbeReasonError,
  evaluateCiGates,
  evaluateMirrorProbeGate,
  hasDeferredGates as twoPlayerHasDeferredGates,
  hasUnattainedGates,
  InvalidAttainmentBaselineError,
  InvalidMirrorProbeDeclarationError,
  KNOWN_EXCEPTIONABLE_GATES,
  MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE,
  MissingCiRolloutBudgetError,
  MissingSolvedValueProofError,
  runCiSuite,
  SOLVED_VALUE_SELF_PLAY_FLOOR,
  SuiteFailedError,
  TierBudgetCollapseError,
  TwoPlayerDeferredGateAtNightlyError,
  UnknownExceptionGateError,
  worstCapHitRate,
} from "./suites";

export {
  formatCiSuiteTable,
  formatCiSuiteTableWithAging,
  formatGameCiGateReport,
  formatGameCiGateReportWithAging,
  formatMatchupTable,
  formatSolveResult,
  formatSoloGateTable,
  formatSoloGateTableWithAging,
  toGameCiGateReportJson,
  toMatchupReportJson,
  toReportJson,
} from "./report";

export type { SafeMoveFn, SoloAgent, SoloRoster } from "./agents";
export {
  buildAgent,
  buildSafeMoveAgent,
  buildSoloRoster,
  buildViewPolicyAgent,
  resolveStrongPolicy,
  staticClock,
  STRONG_HIDDEN_INFO_SAMPLES,
  StrongPolicyUnavailableError,
} from "./agents";

export type { PlaySoloRunOptions, SoloRunResult, SoloRunSummary } from "./solo-runner";
export {
  pairedSeeds,
  playSoloRun,
  runSoloAgentOverSeeds,
  UnwrappedAgentOnHiddenInformationEngineError,
} from "./solo-runner";

export type {
  ComputeSoloDistributionMetricsOptions,
  SoloDistributionMetrics,
  SoloDistributionMetricsCiTier,
} from "./solo-metrics";
export {
  coefficientOfVariation,
  computeSoloDistributionMetrics,
  mean,
  percentile as soloPercentile,
  safeRatio,
  stddev,
} from "./solo-metrics";
// median is re-exported under its own name — no collision with the two-player lane.
export { median } from "./solo-metrics";

export type { GrindCycleStep, GrindOptions, GrindResult } from "./probes-solo";
export {
  alwaysSafeVsStrongRatio,
  grindProbe,
  MissingSafeMoveError,
  runAlwaysSafeProbe,
  ZeroScoringYardstickError,
} from "./probes-solo";

export type {
  EvaluateSoloGatesInput,
  GateResult,
  GateStatus,
  SoloGateChaseInputs,
  SoloGateChaseInputsDeferred,
  SoloGateChaseInputsFull,
  SoloGatePuzzleInputs,
} from "./solo-gates";
export {
  allGatesPass,
  evaluateSoloGates,
  hasDeferredGates as soloHasDeferredGates,
  SoloDeferredGateAtNightlyError,
  STRONG_DEPENDENT_CHASE_GATES,
} from "./solo-gates";

export type { SoloHeuristic } from "./solver/generic-solo";
export { dfsSolver, idaStarSolver, StochasticEngineUnsupportedError } from "./solver/generic-solo";

export type { CertifyDayOptions, CertifyDayResult, CertifyRejection } from "./certify";
export {
  bufferDaysRemaining,
  CertificateDayMismatchError,
  certificatePath,
  certifyDay,
  computePathFeatures,
  randomPlayoutStats,
  readAllCertificates,
  readCertificate,
  rejectionRate,
  StochasticEngineCertifyUnsupportedError,
  writeCertificate,
} from "./certify";

export type { CalibrateOptions, CalibrationResult, FeatureStats } from "./calibrate";
export { calibrate, dayOverDayDriftSigma, withinBand, zScore } from "./calibrate";

// M4 CI wiring (ci-gates.ts): the per-game dispatcher selected by manifest.solo.format
// (platform-corrections.md C2), enforced at runtime rather than left to caller convention —
// see ci-gates.ts's own module doc for the full rationale.
export type {
  GameCiGateKind,
  GameCiGateOptions,
  GameCiGateReport,
  SoloChaseCiGateOptions,
  SoloChaseGateReport,
  SoloPuzzleCiGateOptions,
  SoloPuzzleGateReport,
  TwoPlayerCiGateOptions,
} from "./ci-gates";
export {
  DEFAULT_CI_GATE_GAMES,
  DEFAULT_SOLO_SEED_COUNT,
  GateKindMismatchError,
  HiddenInfoBudgetTooLowError,
  MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE,
  runGameCiGate,
  runSoloChaseCiGate,
  runSoloPuzzleCiGate,
  runTwoPlayerCiGate,
  selectGateKind,
  UnrecognizedSoloFormatError,
} from "./ci-gates";

// M4 CI wiring, continued (deferral-ledger.ts): the deferral-DISCHARGE ledger
// (platform-corrections.md C70) — checks that a `"deferred"` row's promise ("measured at
// nightly") was actually kept, ages an undischarged deferral visibly and eventually fatally,
// and fails a report outright once a MATERIAL fraction of a game's gates have gone stale
// together. Deliberately does not touch suites.ts/solo-gates.ts/ci-gates.ts — every existing
// gate's raw output stays byte-identical; this is a strictly additive layer on top.
export type {
  DeferralAgingReport,
  DeferralLane,
  DeferralLedger,
  DeferralLedgerEntry,
  DeferralObservation,
  DeferralRowAging,
  DeferralSeverity,
  GateRowLike,
} from "./deferral-ledger";
export {
  annotateDeferralAging,
  annotateDeferralAgingForReport,
  defaultLedgerPath,
  DEFERRAL_FATAL_DAYS,
  DEFERRAL_MATERIAL_FRACTION,
  DEFERRAL_WARN_DAYS,
  deferralAgeDays,
  deferralSeverity,
  effectiveOk,
  gateRowsFromReport,
  InvalidDeferralSinceError,
  laneOfReport,
  observeDeferral,
  readDeferralLedger,
  recordDischarge,
  writeDeferralLedger,
} from "./deferral-ledger";

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
  EmptyExceptionJustificationError,
  evaluateCiGates,
  MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE,
  MissingCiRolloutBudgetError,
  MissingSolvedValueProofError,
  runCiSuite,
  SOLVED_VALUE_SELF_PLAY_FLOOR,
  SuiteFailedError,
  TierBudgetCollapseError,
  worstCapHitRate,
} from "./suites";

export {
  formatCiSuiteTable,
  formatGameCiGateReport,
  formatMatchupTable,
  formatSolveResult,
  formatSoloGateTable,
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
export { alwaysSafeVsStrongRatio, grindProbe, MissingSafeMoveError, runAlwaysSafeProbe } from "./probes-solo";

export type {
  EvaluateSoloGatesInput,
  GateResult,
  GateStatus,
  SoloGateChaseInputs,
  SoloGatePuzzleInputs,
} from "./solo-gates";
export { allGatesPass, evaluateSoloGates } from "./solo-gates";

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

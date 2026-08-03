// packages/harness/src/index.ts — public barrel (package.json's declared `"main"`/`"types"`
// entry). `cli.ts` is deliberately NOT re-exported here — it is a process entry point (its
// package.json `"bin"` subpath), not a library import; pulling it in here would drag `main()`'s
// `process.argv`/`process.exit` usage into every consumer's module graph for no reason.
//
// The solver building blocks (`reach`, `retrograde`, their types) are exported individually —
// not folded into one `solve` default — specifically so a history-dependent game (Fadeout,
// under superko) can compose them locally over its own position key, per correction C3. See
// solver/types.ts's module doc for the full caveat.

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
export { runMatchup } from "./runner";

export type { CiSuiteReport, GateInputs, GateResult, GateStatus, RunCiSuiteOptions } from "./suites";
export { assertSuiteOk, evaluateCiGates, runCiSuite, SuiteFailedError } from "./suites";

export { formatCiSuiteTable, formatMatchupTable, formatSolveResult, toReportJson } from "./report";

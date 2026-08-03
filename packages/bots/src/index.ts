// packages/bots/src/index.ts — public barrel (package.json's declared `"main"`/`"types"`
// entry). The worker protocol/host are deliberately NOT re-exported here — they have their
// own package.json subpath exports ("./worker/protocol", "./worker/host") so a consumer that
// only needs the worker boundary doesn't pull in every search algorithm's module graph, and
// vice versa.

export type {
  Clock,
  DeterminizeOptions,
  Policy,
  PlayerView,
  SearchStats,
  ViewPolicy,
} from "./policy";
export {
  MissingSampleConsistentStateError,
  NonDeterministicBudgetError,
  deriveView,
  determinize,
  probeViewHonesty,
  requireDeterministicBudget,
} from "./policy";

export { randomPolicy } from "./random";

// The move-selector seam (platform-corrections.md C6) — public because a caller building a
// determinized Strong (e.g. the harness's `resolveStrongPolicy`) needs to pass
// `greedyMoveSelector` into `flatMonteCarloPolicy`'s `rolloutMoveSelector` option.
// `rankingValueOf`/`valueOfStatus`/`rolloutToHorizon` stay internal (see search-utils.ts's
// module doc) — nothing outside this package needs to call them directly.
export type { MoveSelector } from "./search-utils";
export { RankingValueUnavailableError, greedyMoveSelector, uniformRandomMoveSelector } from "./search-utils";

export type { MinimaxOptions } from "./minimax";
export { MinimaxHeuristicRequiredError, MinimaxUnsupportedGameError, minimaxPolicy } from "./minimax";

export type { MctsOptions } from "./mcts";
export { MctsTerminalStateError, mctsPolicy } from "./mcts";

export type { BeamOptions } from "./beam";
export { BeamUnsupportedGameError, beamPolicy } from "./beam";

export type { FlatMonteCarloOptions } from "./flat-mc";
export { FlatMonteCarloTerminalStateError, flatMonteCarloPolicy } from "./flat-mc";

export type { DeterminizedFlatMonteCarloOptions } from "./determinized-flat-mc";
export { DeterminizedFlatMonteCarloTerminalStateError, determinizedFlatMonteCarloPolicy } from "./determinized-flat-mc";

export type { TierPolicyOptions } from "./tiers";
export { softmaxSample, tierPolicy } from "./tiers";

export type { StallOptions } from "./probes/stall";
export { stallPolicy } from "./probes/stall";

export { rushPolicy } from "./probes/rush";

export { GreedyOnlyUnsupportedGameError, greedyOnlyPolicy } from "./probes/greedy-only";

export type { SuicideOptions } from "./probes/suicide";
export { suicidePolicy } from "./probes/suicide";

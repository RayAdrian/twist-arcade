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

export type { MinimaxOptions } from "./minimax";
export { MinimaxUnsupportedGameError, minimaxPolicy } from "./minimax";

export type { MctsOptions } from "./mcts";
export { MctsTerminalStateError, mctsPolicy } from "./mcts";

export type { BeamOptions } from "./beam";
export { BeamUnsupportedGameError, beamPolicy } from "./beam";

export type { FlatMonteCarloOptions } from "./flat-mc";
export { FlatMonteCarloTerminalStateError, flatMonteCarloPolicy } from "./flat-mc";

export type { TierPolicyOptions } from "./tiers";
export { softmaxSample, tierPolicy } from "./tiers";

export type { StallOptions } from "./probes/stall";
export { stallPolicy } from "./probes/stall";

export { rushPolicy } from "./probes/rush";

export { GreedyOnlyUnsupportedGameError, greedyOnlyPolicy } from "./probes/greedy-only";

export type { SuicideOptions } from "./probes/suicide";
export { suicidePolicy } from "./probes/suicide";

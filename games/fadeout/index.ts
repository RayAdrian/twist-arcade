// games/fadeout/index.ts — public package surface for @twist-arcade/fadeout (mirrors
// games/mine-run/index.ts's convention). package.json's main/types/exports all point here.
//
// NOT statically imported by app/** or packages/shell/src/** (eslint's registrySplittingBoundary
// bans exactly that) — games/registry.ts is the one place that loads this game's code, and it
// does so via dynamic import() of ./engine and ./presentation directly (finer-grained than this
// barrel, so a route that only needs the engine — e.g. a future server-side bot host — never
// pulls in React/Board too). This file exists for everything else that wants the whole package
// in one import: tests, the solver, tooling.

import { createFadeoutEngine } from "./engine";
import { FADEOUT_RULESET_CONFIG } from "./manifest";

export { allRulesetConfigs, createFadeoutEngine, positionKey } from "./engine";
export type { FadeoutMove, FadeoutState, RulesetConfig } from "./engine";

export { fadeoutHeuristic } from "./heuristic";

export { mirrorMove } from "./probes";

export { FADEOUT_RULESET_CONFIG, fadeoutManifest, RULE_SENTENCE } from "./manifest";

export { fadeoutPresentation } from "./presentation";

/** The one ready-to-play engine instance for the shipped ruleset — constructed once here so
 *  every consumer (registry, tests, tooling) that just wants "the real game" shares the exact
 *  same construction site as `FADEOUT_RULESET_CONFIG` rather than re-deriving it. */
export const fadeoutEngine = createFadeoutEngine(FADEOUT_RULESET_CONFIG);

// games/fadeout/solver/solve.ts — top-level orchestration of the 8-variant exact solve (plan
// §2.3's deliverable, composed from raw-engine.ts's pass 1 and pass2-superko.ts's pass 2).
//
// Per platform-corrections.md C3 / plan §3.4/§14: this is the game-local solve that composes
// @twist-arcade/harness's reach()/retrograde() building blocks over `positionKey` — never
// `harness solve` / `solveTwoPlayerGame` directly, which hashes on `encode()` and would be
// unsound here (encode includes `history`, so it is not a valid position key under superko).
//
// One raw graph per (decayTiming, playThrough) pair is shared across its `threefold` and
// `superko` configs — pass 1 is repetition-rule-agnostic by construction (see raw-engine.ts's
// module doc), so building it twice per pair would be pure waste, not a correctness issue.

import type { PositionValue } from "@twist-arcade/harness";
import { allRulesetConfigs, type RulesetConfig } from "../engine";
import { solveSuperko, type SuperkoBudget } from "./pass2-superko";
import { solveRaw, type RawConfig, type RawOpeningValue, type RawSolveResult } from "./raw-engine";

export interface ConfigSolveResult {
  config: RulesetConfig;
  rootValue: PositionValue;
  /** Pass-1 reachable-state count — exact for the `threefold` value; an upper bound / proxy
   *  for the `superko` config sharing this (decayTiming, playThrough) pair, since superko's
   *  true reachable-position count is a subset (some raw positions become unreachable once
   *  repeats are forbidden) that this solve does not separately enumerate. */
  reachableStatesRaw: number;
  openings: { cell: number; value: PositionValue }[];
  /** false only for a `superko` config whose pass-2 search exhausted its budget — in that case
   *  rootValue/openings are the pass-1 (C2) fallback, not a proven C1 result (plan §2.3: never
   *  ship an unproven claim silently). Always true for `threefold` (pass 1 IS the exact C2
   *  value; see raw-engine.ts's module doc for the residue-equals-C2 argument). */
  exact: boolean;
  nodesVisited?: number;
}

function rawConfigOf(config: RulesetConfig): RawConfig {
  return { decayTiming: config.decayTiming, playThrough: config.playThrough };
}

// Each (decayTiming, playThrough) pair is shared by exactly two RulesetConfigs (its threefold
// and superko arms) — memoized so a full solveAllConfigs() run (and this module's own test
// suite, which calls solveConfig repeatedly) builds each of the 4 raw graphs exactly once
// rather than twice. Safe indefinitely: solveRaw is a pure function of RawConfig.
const rawCache = new Map<string, RawSolveResult>();
function cachedSolveRaw(rawConfig: RawConfig): RawSolveResult {
  const key = `${rawConfig.decayTiming}:${rawConfig.playThrough}`;
  const cached = rawCache.get(key);
  if (cached) return cached;
  const computed = solveRaw(rawConfig);
  rawCache.set(key, computed);
  return computed;
}

export function solveConfig(config: RulesetConfig, budget: SuperkoBudget = {}): ConfigSolveResult {
  const raw = cachedSolveRaw(rawConfigOf(config));

  if (config.repetition === "threefold") {
    return {
      config,
      rootValue: raw.rootValue,
      reachableStatesRaw: raw.reachableStates,
      openings: raw.openings.map((o: RawOpeningValue) => ({ cell: o.cell, value: o.value })),
      exact: true,
    };
  }

  const superko = solveSuperko(rawConfigOf(config), raw, budget);
  return {
    config,
    rootValue: superko.rootValue,
    reachableStatesRaw: raw.reachableStates,
    openings: superko.openings,
    exact: !superko.budgetExceeded,
    nodesVisited: superko.nodesVisited,
  };
}

/** Solves all 8 syntactic RulesetConfig combinations (plan §1) — the caller is expected to
 *  notice (and this module's test suite asserts as a hard cross-check) that they collapse to 6
 *  distinct games once `playThrough: true` (plan §16): the two `decayTiming` arms MUST report
 *  identical values in that case, or the solver itself is broken. */
export function solveAllConfigs(budget: SuperkoBudget = {}): ConfigSolveResult[] {
  return allRulesetConfigs().map((config) => solveConfig(config, budget));
}

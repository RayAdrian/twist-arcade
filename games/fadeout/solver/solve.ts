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
//
// WHY THE RAW GRAPH'S RETROGRADE RESIDUE EQUALS THE C2 (THREEFOLD) VALUE EXACTLY — the argument
// raw-engine.ts's module doc and the solve report both point back to this file for, recorded here
// for real rather than only cited elsewhere (F2 amendments item 5). This is the one place the
// freeze's C2 exactness ultimately rests on, so it is written as an actual argument, not a
// pointer to a pointer.
//
// The raw graph (raw-engine.ts) ignores repetition ENTIRELY: it never filters a move on
// repetition grounds, and its `status()` never resolves via a repeat count — only via
// `checkWinner()`. Under `threefold`, repetition is ALSO never a legality concern (see
// engine-internal.ts's `computeLegalCells`: the `superko` branch is the only one that ever
// removes a move on repetition grounds; `threefold` leaves every occupancy-legal move
// available, exactly like the raw graph). So threefold's legal-move graph and the raw graph are
// the SAME graph, move for move — threefold's repetition rule only ever adds ONE thing: a third
// occurrence of the same (position, mover) pair is itself an immediate draw terminal
// (engine.ts's `computeStatus`).
//
// Backward induction (retrograde analysis, harness's `retrograde()`) assigns every WIN/LOSS node
// a resolution "depth" — the round of the algorithm's own work-queue in which it was proven — with
// the standard invariant: EVERY move out of a LOSS-depth-d node lands on a WIN node of depth
// STRICTLY LESS than d (that is the definition of LOSS: all children resolved WIN at a smaller
// depth), and a WIN-depth-d node has AT LEAST ONE move to a LOSS node of depth strictly less than
// d (that is the definition of WIN). Consequence: starting from any resolved (non-residue) node
// and playing the game out for real, the depth value strictly decreases on EVERY SINGLE PLY,
// regardless of which move either side picks among the ones available to them — a mover at a
// LOSS node has no move that doesn't strictly decrease depth (every child is a lower-depth WIN),
// and the opponent, from that WIN node, always HAS at least one depth-decreasing reply available
// and takes it. A strictly-decreasing sequence of non-negative integers can never repeat a value,
// so NO position can recur anywhere along real play from a resolved node — meaning the game
// reaches its terminal WIN/LOSS well before any position could occur even once more, let alone a
// third time. Threefold's "third repeat = draw" clause therefore can NEVER fire while play stays
// inside the resolved (WIN/LOSS) region: the LOSING side cannot escape into a draw by stalling —
// every move available to them, not just the ones along one canonical witness line, already
// strictly decreases the depth toward the opponent's forced win. (This generalizes
// raw-engine.ts's `stepWitness`/witness-disjointness argument, which is the special case of this
// same invariant applied along one specific extracted line, to EVERY possible line either side
// could play.) So raw-WIN transfers to threefold-WIN, and raw-LOSS transfers to threefold-LOSS,
// unconditionally.
//
// The residue (positions retrograde never resolves WIN or LOSS) is exactly the complementary
// case: by the same depth argument run in reverse, a residue position can have NO move into a
// LOSS-for-the-opponent node (that would make it WIN) and cannot have EVERY move lead to a
// WIN-for-the-opponent node (that would make it LOSS) — so it always has at least one move that
// either stays in the residue or is otherwise never disadvantageous, and in particular BOTH
// players can choose, every time it is their turn in the residue, a move that keeps the game
// inside the residue rather than ever handing the opponent an already-resolved WIN. Neither side
// has any incentive to leave (leaving means handing the opponent a proven win, strictly worse
// than whatever the residue holds), so under optimal play from a residue position the game stays
// in the finite residue set forever — and by pigeonhole, playing forever over finitely many
// (position, mover) pairs means SOME pair recurs infinitely often, hence at least a third time,
// triggering threefold's draw terminal. The raw graph's "draw" label and the threefold game's
// actual optimal-play outcome therefore coincide too.
//
// This is the standard win/loss/draw-on-cycle theorem for finite two-player perfect-information
// games (Zermelo's algorithm generalized to graphs with cycles via backward induction, with
// "draw" as the residue's game value) — recorded here in full because platform-corrections.md's
// ruleset freeze, and the solve report's every "exact (C2)" claim, rest on it.

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

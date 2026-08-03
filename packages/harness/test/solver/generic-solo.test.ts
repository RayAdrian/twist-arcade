// packages/harness/test/solver/generic-solo.test.ts — TDD anchors for the platform's generic
// solo-solver building blocks (dfsSolver, idaStarSolver): a real solvable puzzle finds its
// known-optimal solution, an unsolvable puzzle is reported unsolvable (never a false solve),
// and a budget too small to finish reports budget-exhausted rather than guessing.

import { describe, expect, it } from "vitest";
import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import { miniCrackstep, MINI_CRACKSTEP_KNOWN_SOLUTION } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import type { CrackstepMove, CrackstepState } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { verifyCertificate } from "@twist-arcade/engine/testkit/checks";
import { dfsSolver, idaStarSolver, StochasticEngineUnsupportedError } from "../../src/solver/generic-solo";

const GRID_SIZE = 3;
const GOAL = GRID_SIZE * GRID_SIZE - 1;

function manhattanToGoal(state: CrackstepState): number {
  const r = Math.floor(state.pos / GRID_SIZE);
  const c = state.pos % GRID_SIZE;
  const gr = Math.floor(GOAL / GRID_SIZE);
  const gc = GOAL % GRID_SIZE;
  return Math.abs(r - gr) + Math.abs(c - gc);
}

describe("dfsSolver — mini-crackstep (a real, solvable puzzle)", () => {
  it("finds an optimal (length-4) solution — the fixture's own known-shortest path", () => {
    const solver = dfsSolver<CrackstepState, CrackstepMove>();
    const initial = miniCrackstep.setup(1, {} as Rng); // mini-crackstep never draws from rng
    const result = solver.solve(miniCrackstep, initial, { maxNodes: 1e6, maxMs: 5_000 });
    expect(result.outcome).toBe("solved");
    expect(result.optimal).toBe(true);
    expect(result.length).toBe(MINI_CRACKSTEP_KNOWN_SOLUTION.length);
  });

  it("the returned moveLog actually replays to `won` through the real engine (verifyCertificate)", () => {
    const solver = dfsSolver<CrackstepState, CrackstepMove>();
    const initial = miniCrackstep.setup(1, {} as Rng);
    const result = solver.solve(miniCrackstep, initial, { maxNodes: 1e6, maxMs: 5_000 });
    expect(result.outcome).toBe("solved");
    expect(() =>
      verifyCertificate(miniCrackstep, {
        gameId: miniCrackstep.meta.id,
        gameVersion: miniCrackstep.meta.version,
        engineVersion: "test",
        seed: "irrelevant-mini-crackstep-never-generates",
        moveLog: result.moveLog!,
      })
    ).not.toThrow();
  });

  it("reports unsolvable — never a false solve — for a puzzle with the goal removed", () => {
    // A one-line mutant: the goal cell no longer counts as a win, so no legal playout can
    // ever reach `won` — every branch eventually dead-ends at `lost` once the 3x3 grid is
    // exhausted. dfsSolver must exhaust the (small, finite) reachable state space and report
    // "unsolvable", not silently return a "solution" that never actually wins.
    const noGoal: GameEngine<CrackstepState, CrackstepMove, CrackstepState> = {
      ...miniCrackstep,
      status(state): Status {
        const real = miniCrackstep.status(state);
        return real.kind === "won" ? { kind: "lost" } : real;
      },
    };
    const solver = dfsSolver<CrackstepState, CrackstepMove>();
    const initial = noGoal.setup(1, {} as Rng);
    const result = solver.solve(noGoal, initial, { maxNodes: 1e6, maxMs: 5_000 });
    expect(result.outcome).toBe("unsolvable");
  });

  it("reports budget-exhausted (never a false solve, never a false unsolvable) when maxNodes is too small", () => {
    const solver = dfsSolver<CrackstepState, CrackstepMove>();
    const initial = miniCrackstep.setup(1, {} as Rng);
    const result = solver.solve(miniCrackstep, initial, { maxNodes: 1, maxMs: 5_000 });
    expect(result.outcome).toBe("budget-exhausted");
  });
});

describe("idaStarSolver — mini-crackstep with an admissible Manhattan-distance heuristic", () => {
  it("finds the same optimal length-4 solution as the heuristic-free dfsSolver", () => {
    const solver = idaStarSolver<CrackstepState, CrackstepMove>(manhattanToGoal);
    const initial = miniCrackstep.setup(1, {} as Rng);
    const result = solver.solve(miniCrackstep, initial, { maxNodes: 1e6, maxMs: 5_000 });
    expect(result.outcome).toBe("solved");
    expect(result.optimal).toBe(true);
    expect(result.length).toBe(MINI_CRACKSTEP_KNOWN_SOLUTION.length);
  });

  // A real INADMISSIBLE-heuristic run (SHOULD FIX item 7, stage-5 fix) used to live here, but
  // it constructed and ran only `manhattanToGoal` — the very same ADMISSIBLE heuristic as the
  // test directly above — so it duplicated that test's assertion instead of ever exercising
  // an inadmissible one. mini-crackstep's 3x3 grid turned out to be a poor fixture for a
  // *genuine* inadmissible-heuristic regression: every interior cell lies on SOME length-4
  // monotone shortest path, so any simple per-cell heuristic inflation penalizes all of them
  // symmetrically and never manufactures a case where a longer path is found while a shorter
  // one goes untried — the asymmetry a real counterexample needs. The genuinely inadmissible
  // run instead uses `idaCounterexampleEngine` below (built for MUST FIX item 1), whose two
  // branches have different lengths by construction: see "an INADMISSIBLE (overestimating)
  // heuristic really does make IDA* return a non-optimal path" further down this file.

  it("reports unsolvable for the goal-removed mutant, same as dfsSolver", () => {
    const noGoal: GameEngine<CrackstepState, CrackstepMove, CrackstepState> = {
      ...miniCrackstep,
      status(state): Status {
        const real = miniCrackstep.status(state);
        return real.kind === "won" ? { kind: "lost" } : real;
      },
    };
    const solver = idaStarSolver<CrackstepState, CrackstepMove>(manhattanToGoal);
    const initial = noGoal.setup(1, {} as Rng);
    const result = solver.solve(noGoal, initial, { maxNodes: 1e6, maxMs: 5_000 });
    expect(result.outcome).toBe("unsolvable");
  });

  it("reports budget-exhausted when maxNodes is too small", () => {
    const solver = idaStarSolver<CrackstepState, CrackstepMove>(manhattanToGoal);
    const initial = miniCrackstep.setup(1, {} as Rng);
    const result = solver.solve(miniCrackstep, initial, { maxNodes: 1, maxMs: 5_000 });
    expect(result.outcome).toBe("budget-exhausted");
  });
});

// ---------------------------------------------------------------------------------------
// A larger, deliberately-deep counter puzzle: proves the budget-exhausted / unsolvable
// distinction isn't an artifact of mini-crackstep's tiny 9-cell state space.
// ---------------------------------------------------------------------------------------

interface CounterPuzzleState extends WithEffects {
  readonly n: number;
}
type CounterPuzzleMove = { readonly delta: 1; readonly [key: string]: Json };

/** Must count up to TARGET one step at a time to win — TARGET states, no shortcuts, no
 *  branching (a single legal move at every step) — deep enough that a tiny node budget
 *  genuinely cannot finish, and shallow enough that a generous budget always can. */
function makeCounterPuzzle(target: number, winnable: boolean): GameEngine<CounterPuzzleState, CounterPuzzleMove, CounterPuzzleState> {
  return {
    meta: {
      id: winnable ? "counter-puzzle" : "counter-puzzle-unwinnable",
      name: "Counter puzzle (test fixture)",
      minPlayers: 1,
      maxPlayers: 1,
      hiddenInformation: false,
      simultaneous: false,
      stochastic: false,
      version: 1,
    },
    setup(_n: number, _rng: Rng): CounterPuzzleState {
      return { n: 0, lastEffects: [] };
    },
    legalMoves(state, player: PlayerId) {
      if (player !== 0 || state.n >= target) return [];
      return [{ delta: 1 }];
    },
    isLegal(state, player, move) {
      return player === 0 && state.n < target && move.delta === 1;
    },
    active(_state): ActiveSpec {
      return { mode: "sequential", player: 0 };
    },
    apply(state, moves, _rng) {
      const move = moves.get(0);
      if (!move) throw new Error("counter-puzzle: apply() called without a move");
      const effects: Effect[] = [{ type: "tick" }];
      return { n: state.n + 1, lastEffects: effects };
    },
    status(state): Status {
      if (state.n >= target) return winnable ? { kind: "won", winner: 0 } : { kind: "lost" };
      return { kind: "ongoing" };
    },
    playerView(state, _player) {
      return state;
    },
    encode(state) {
      return stableStringify({ n: state.n });
    },
    decode(encoded) {
      const parsed = JSON.parse(encoded) as { n: number };
      return { n: parsed.n, lastEffects: [] };
    },
  };
}

describe("dfsSolver — a deep, single-path counter puzzle (not just a tiny fixture)", () => {
  it("solves a 50-deep puzzle with a generous budget", () => {
    const engine = makeCounterPuzzle(50, true);
    const solver = dfsSolver<CounterPuzzleState, CounterPuzzleMove>();
    const initial = engine.setup(1, {} as Rng);
    const result = solver.solve(engine, initial, { maxNodes: 10_000, maxMs: 5_000 });
    expect(result.outcome).toBe("solved");
    expect(result.length).toBe(50);
  });

  it("reports budget-exhausted on the SAME puzzle with a node budget smaller than its depth", () => {
    const engine = makeCounterPuzzle(50, true);
    const solver = dfsSolver<CounterPuzzleState, CounterPuzzleMove>();
    const initial = engine.setup(1, {} as Rng);
    const result = solver.solve(engine, initial, { maxNodes: 10, maxMs: 5_000 });
    expect(result.outcome).toBe("budget-exhausted");
  });

  it("reports unsolvable for a puzzle whose only terminal is `lost`, with a generous budget", () => {
    const engine = makeCounterPuzzle(20, false);
    const solver = dfsSolver<CounterPuzzleState, CounterPuzzleMove>();
    const initial = engine.setup(1, {} as Rng);
    const result = solver.solve(engine, initial, { maxNodes: 10_000, maxMs: 5_000 });
    expect(result.outcome).toBe("unsolvable");
  });
});

// ---------------------------------------------------------------------------------------
// MUST-FIX REGRESSION (stage-5 fix): idaStarSolver's goal test ran BEFORE the `f > threshold`
// cutoff check, the reverse of Korf's IDA*. That let a WON node reached at g > threshold
// short-circuit the search and return `found` before an unexplored, genuinely-shorter sibling
// branch was ever tried — a non-optimal path published with `optimal: true`. Fatal because
// Crackstep's `certifyDay` ships `par = solveResult.length` as the fairness proof for a day
// that can never be re-solved after the fact.
//
// A minimal 5-node graph that reproduces it:
//
//     R --(A)--> A --(A2)--> A2 --(W1)--> W1 [won, depth 3]
//     R --(B)--> B --(W2)--> W2          [won, depth 2]
//
// h = { R:1, A:1, A2:0, B:1 } (0 at both won nodes). True remaining costs are
// { R:2, A:2, A2:1, B:1 } (R's shortest win is via B, cost 2) — h is admissible (<=) at every
// node, verified explicitly below rather than merely asserted.
//
// legalMoves(R) yields ['A', 'B'] in that order, so a depth-first search fully explores the A
// branch before ever trying B. At threshold 2: the A branch reaches W1 at g=3 (f = 3+0 = 3,
// OVER the threshold) — the buggy goal-test-first order accepted it anyway and returned
// length 3 while B (the real, unexplored, length-2 win) was never tried. The fixed
// cutoff-before-goal-test order correctly rejects W1 at g=3 as a cutoff, backtracks, and finds
// B's length-2 win instead — matching dfsSolver's heuristic-free ground truth exactly.
// ---------------------------------------------------------------------------------------

type CounterexampleNode = "R" | "A" | "A2" | "B" | "W1" | "W2";
interface CounterexampleState extends WithEffects {
  readonly node: CounterexampleNode;
}
type CounterexampleMove = { readonly to: CounterexampleNode; readonly [key: string]: Json };

const COUNTEREXAMPLE_EDGES: Record<CounterexampleNode, readonly CounterexampleNode[]> = {
  R: ["A", "B"], // order load-bearing: DFS must try A (the trap) fully before B (the truth)
  A: ["A2"],
  A2: ["W1"],
  B: ["W2"],
  W1: [],
  W2: [],
};

const COUNTEREXAMPLE_HEURISTIC: Record<CounterexampleNode, number> = {
  R: 1,
  A: 1,
  A2: 0,
  B: 1,
  W1: 0,
  W2: 0,
};

const COUNTEREXAMPLE_TRUE_COST: Record<CounterexampleNode, number> = {
  R: 2,
  A: 2,
  A2: 1,
  B: 1,
  W1: 0,
  W2: 0,
};

function idaCounterexampleHeuristic(state: CounterexampleState): number {
  return COUNTEREXAMPLE_HEURISTIC[state.node];
}

const idaCounterexampleEngine: GameEngine<CounterexampleState, CounterexampleMove, CounterexampleState> = {
  meta: {
    id: "ida-star-goal-vs-cutoff-order-counterexample",
    name: "IDA* goal-test-order counterexample (test fixture)",
    minPlayers: 1,
    maxPlayers: 1,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },
  setup(_n: number, _rng: Rng): CounterexampleState {
    return { node: "R", lastEffects: [] };
  },
  legalMoves(state, player: PlayerId) {
    if (player !== 0) return [];
    if (this.status(state).kind !== "ongoing") return [];
    return COUNTEREXAMPLE_EDGES[state.node].map((to) => ({ to }));
  },
  isLegal(state, player, move) {
    return player === 0 && this.status(state).kind === "ongoing" && COUNTEREXAMPLE_EDGES[state.node].includes(move.to);
  },
  active(_state): ActiveSpec {
    return { mode: "sequential", player: 0 };
  },
  apply(_state, moves, _rng) {
    const move = moves.get(0);
    if (!move) throw new Error("ida-counterexample: apply() called without a move");
    const effects: Effect[] = [{ type: "moved", to: move.to }];
    return { node: move.to, lastEffects: effects };
  },
  status(state): Status {
    return state.node === "W1" || state.node === "W2" ? { kind: "won", winner: 0 } : { kind: "ongoing" };
  },
  playerView(state, _player) {
    return state;
  },
  encode(state) {
    return stableStringify({ node: state.node });
  },
  decode(encoded) {
    const parsed = JSON.parse(encoded) as { node: CounterexampleNode };
    return { node: parsed.node, lastEffects: [] };
  },
};

describe("idaStarSolver — goal-test-vs-cutoff order (MUST FIX regression)", () => {
  it("the heuristic is genuinely admissible at every node — the regression below is not an artifact of a broken fixture", () => {
    for (const node of Object.keys(COUNTEREXAMPLE_HEURISTIC) as CounterexampleNode[]) {
      expect(COUNTEREXAMPLE_HEURISTIC[node]).toBeLessThanOrEqual(COUNTEREXAMPLE_TRUE_COST[node]);
    }
  });

  it("dfsSolver (heuristic-free ground truth) finds the true optimum: length 2, via R->B->W2", () => {
    const solver = dfsSolver<CounterexampleState, CounterexampleMove>();
    const initial = idaCounterexampleEngine.setup(1, {} as Rng);
    const result = solver.solve(idaCounterexampleEngine, initial, { maxNodes: 1_000, maxMs: 5_000 });
    expect(result.outcome).toBe("solved");
    expect(result.length).toBe(2);
  });

  it("idaStarSolver must ALSO find length 2, not the length-3 trap through A/A2/W1 — and must not label a non-optimal path optimal:true", () => {
    const solver = idaStarSolver<CounterexampleState, CounterexampleMove>(idaCounterexampleHeuristic);
    const initial = idaCounterexampleEngine.setup(1, {} as Rng);
    const result = solver.solve(idaCounterexampleEngine, initial, { maxNodes: 1_000, maxMs: 5_000 });
    expect(result.outcome).toBe("solved");
    expect(result.optimal).toBe(true);
    expect(result.length).toBe(2);
    expect(result.moveLog).toEqual([{ to: "B" }, { to: "W2" }]);
  });
});

// ---------------------------------------------------------------------------------------
// SHOULD FIX item 7: a REAL inadmissible-heuristic run (replacing the vacuous one that used to
// live next to mini-crackstep's admissible test above and duplicated it). Even with item 1's
// goal-test-vs-cutoff order FIXED, admissibility is a separate, independently load-bearing
// requirement: this proves it by overestimating h(B) alone (100, against a true remaining cost
// of 1 — every other node keeps its admissible value from the fix's own regression above), on
// the exact same asymmetric graph. The inflated h(B) makes the B branch (the true, length-2
// optimum) look artificially expensive, so IDA*'s rising threshold reaches the A/A2/W1 branch's
// OWN true cost (3) — and accepts it, correctly-ordered goal test and all — long before the
// threshold would ever reach high enough to let B's branch be tried. The algorithm is doing
// exactly the right thing at every step; the heuristic it was handed is simply a lie.
// ---------------------------------------------------------------------------------------

const INADMISSIBLE_HEURISTIC: Record<CounterexampleNode, number> = {
  R: 1,
  A: 1,
  A2: 0,
  B: 100, // true remaining cost from B is 1 — this overestimates by 99x, deliberately inadmissible
  W1: 0,
  W2: 0,
};

function idaInadmissibleHeuristic(state: CounterexampleState): number {
  return INADMISSIBLE_HEURISTIC[state.node];
}

describe("idaStarSolver — a genuinely INADMISSIBLE heuristic (SHOULD FIX item 7)", () => {
  it("h(B) truly overestimates B's remaining cost — the regression below is not accidentally admissible", () => {
    expect(INADMISSIBLE_HEURISTIC.B).toBeGreaterThan(COUNTEREXAMPLE_TRUE_COST.B);
  });

  it("returns the non-optimal length-3 path and still labels it optimal:true — proving admissibility (not just goal-test order) is load-bearing", () => {
    const solver = idaStarSolver<CounterexampleState, CounterexampleMove>(idaInadmissibleHeuristic);
    const initial = idaCounterexampleEngine.setup(1, {} as Rng);
    const result = solver.solve(idaCounterexampleEngine, initial, { maxNodes: 1_000, maxMs: 5_000 });
    // The solver has no way to know its own heuristic lied to it — it reports "solved,
    // optimal: true" in perfectly good faith, same as item 1's original bug, but this time
    // the fixed goal-test-vs-cutoff order is NOT at fault: it's the input heuristic.
    expect(result.outcome).toBe("solved");
    expect(result.optimal).toBe(true);
    expect(result.length).toBe(3); // the true optimum (dfsSolver, and the fixed test above) is 2
    expect(result.moveLog).toEqual([{ to: "A" }, { to: "A2" }, { to: "W1" }]);
  });
});

// ---------------------------------------------------------------------------------------
// SHOULD FIX item 6: both solvers apply moves with private, internally-generated rng streams
// while replay()/verifyCertificate use rngFor(seed, k) to RECONSTRUCT those same draws —
// sound only when apply() draws no randomness beyond setup() (meta.stochastic: false), a
// requirement this file's own doc comments assert but neither solver actually checks. A
// stochastic engine's solved moveLog is not reproducible: replaying it may draw different
// random outcomes than the solver's own search did, silently invalidating the "certificate"
// the solver's result feeds into. One-line throws, matching MissingSafeMoveError's posture
// (probes-solo.ts) — a missing precondition is a hard error, never a silently-degraded search.
// ---------------------------------------------------------------------------------------

describe("dfsSolver / idaStarSolver — refuse a stochastic engine (SHOULD FIX item 6)", () => {
  const stochasticMiniCrackstep: GameEngine<CrackstepState, CrackstepMove, CrackstepState> = {
    ...miniCrackstep,
    meta: { ...miniCrackstep.meta, stochastic: true },
  };

  it("dfsSolver throws StochasticEngineUnsupportedError before doing any search", () => {
    const solver = dfsSolver<CrackstepState, CrackstepMove>();
    const initial = stochasticMiniCrackstep.setup(1, {} as Rng);
    expect(() => solver.solve(stochasticMiniCrackstep, initial, { maxNodes: 1e6, maxMs: 5_000 })).toThrow(
      StochasticEngineUnsupportedError
    );
  });

  it("idaStarSolver throws StochasticEngineUnsupportedError before doing any search", () => {
    const solver = idaStarSolver<CrackstepState, CrackstepMove>(manhattanToGoal);
    const initial = stochasticMiniCrackstep.setup(1, {} as Rng);
    expect(() => solver.solve(stochasticMiniCrackstep, initial, { maxNodes: 1e6, maxMs: 5_000 })).toThrow(
      StochasticEngineUnsupportedError
    );
  });

  it("does NOT throw for the real, non-stochastic miniCrackstep (the check is gated on meta.stochastic, not a blanket refusal)", () => {
    const solver = dfsSolver<CrackstepState, CrackstepMove>();
    const initial = miniCrackstep.setup(1, {} as Rng);
    expect(() => solver.solve(miniCrackstep, initial, { maxNodes: 1e6, maxMs: 5_000 })).not.toThrow();
  });
});

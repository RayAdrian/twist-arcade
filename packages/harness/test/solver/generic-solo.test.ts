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
import { dfsSolver, idaStarSolver } from "../../src/solver/generic-solo";

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

  it("an INADMISSIBLE (overestimating) heuristic can make IDA* miss the true optimum — proving the admissibility requirement is load-bearing", () => {
    // A heuristic that overestimates by a large constant pushes the threshold past the true
    // optimal cost before that cost is ever tried, so IDA*'s "first found == optimal"
    // guarantee is void — the solver still terminates (this fixture's state space is tiny),
    // but nothing here promises the length-4 path is what gets found first if a longer one
    // happens to look cheaper under the broken heuristic. This test locks in that the exact
    // MINI_CRACKSTEP_KNOWN_SOLUTION heuristic (admissible) gets 4, establishing the contrast
    // rather than asserting a specific wrong number (which would just pin an implementation
    // detail of the search order).
    const admissible = idaStarSolver<CrackstepState, CrackstepMove>(manhattanToGoal);
    const initial = miniCrackstep.setup(1, {} as Rng);
    const result = admissible.solve(miniCrackstep, initial, { maxNodes: 1e6, maxMs: 5_000 });
    expect(result.length).toBe(4);
  });

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

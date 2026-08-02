// packages/game-spec/src/solver.ts — SoloSolver / SoloSolveResult (plan §7.6). The generic
// building blocks (dfsSolver, idaStarSolver) and per-game bespoke solvers live in
// packages/harness (M3d, not this milestone); this milestone owns only the interfaces games
// and the harness compose against.

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";

export interface SoloSolveBudget {
  maxNodes: number; // default 1e7
  maxMs: number; // default 10_000
}

export interface SoloSolveResult {
  outcome: "solved" | "unsolvable" | "budget-exhausted";
  moveLog?: Json[]; // the solution — replayable through the engine
  length?: number; // L*
  optimal?: boolean; // false ⇒ best-found-in-budget (anytime beam/IDA*);
  //   par is then an upper bound — beating it is a player achievement, not a bug
  guessFree?: boolean; // fog games: solvable by deduction alone (no branching)
  nodesExpanded: number;
  features?: Record<string, number>; // extra per-game difficulty features
}

// V is irrelevant to a solver, which only ever sees canonical S; erased here rather than
// threaded through every solver implementation.
export interface SoloSolver<S extends WithEffects, M extends Json> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  solve(engine: GameEngine<S, M, any>, initial: S, budget: SoloSolveBudget): SoloSolveResult;
}

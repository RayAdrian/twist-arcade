// games/crackstep/solver.test.ts — plan §6.5's solver anchors: a known board with hand-verified
// L*, a planted parity-unsolvable board, a tiny budget forcing "budget-exhausted", the
// heuristic's two prunes exercised directly (planted violations against the guard itself), and
// an independent brute-force oracle cross-check on a small board.

import { describe, expect, it } from "vitest";
import type { PlayerId, Rng } from "@twist-arcade/engine";
import { rngFromSeed } from "@twist-arcade/engine";
import { crackstep, type CrackstepMove, type CrackstepState, type TileKind } from "./engine";
import { crackstepSoloHeuristic, solver } from "./solver";
import { generateBoard } from "./board";

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] };

function apply(state: CrackstepState, move: CrackstepMove): CrackstepState {
  return crackstep.apply(state, new Map<PlayerId, CrackstepMove>([[0, move]]), NO_OP_RNG);
}

function stateOf(width: number, height: number, tiles: TileKind[], start: number): CrackstepState {
  const total = width * height;
  const visited = Array(total).fill(false);
  visited[start] = true;
  return { width, height, tiles, crumbled: Array(total).fill(false), visited, pos: start, lastEffects: [] };
}

describe("solver — known 3x3 all-crumble board, hand-verified L*=8", () => {
  it("solves optimally in exactly 8 moves (a Hamiltonian boustrophedon exists from any corner)", () => {
    const initial = stateOf(3, 3, Array(9).fill("crumble") as TileKind[], 0);
    const result = solver.solve(crackstep, initial, { maxNodes: 1e6, maxMs: 10_000 });
    expect(result.outcome).toBe("solved");
    expect(result.length).toBe(8);
    expect(result.optimal).toBe(true);
    // The returned moveLog must actually replay to a won state (not just report a length).
    let state = initial;
    for (const move of result.moveLog!) {
      state = apply(state, move as CrackstepMove);
    }
    expect(crackstep.status(state)).toEqual({ kind: "won", winner: 0 });
  });
});

describe("solver — a hand board with a stone hub, hand-verified L*=4 (the stone is the escape hatch)", () => {
  // 0 1 2      1 = stone hub; 0, 2, 4 are crumbling leaves reachable ONLY through the hub.
  // 3 4 5      Minimum coverage from leaf 4: 4->1->0->1->2 (revisiting the hub via stone).
  const TILES: TileKind[] = ["crumble", "stone", "crumble", "hole", "crumble", "hole"];

  it("solves optimally in exactly 4 moves", () => {
    const initial = stateOf(3, 2, TILES, 4);
    const result = solver.solve(crackstep, initial, { maxNodes: 1e6, maxMs: 10_000 });
    expect(result.outcome).toBe("solved");
    expect(result.length).toBe(4);
    expect(result.optimal).toBe(true);
  });

  it("independent brute-force oracle (no solver.ts code reused) agrees with the solver's L*", () => {
    // Exhaustive DFS over move sequences, tracking the shortest that reaches `won` — small
    // enough state space (6 cells) to brute-force directly rather than trust any shared code.
    let best = Infinity;
    function dfs(state: CrackstepState, depth: number): void {
      if (depth >= best) return; // no point continuing past the best already found
      const status = crackstep.status(state);
      if (status.kind === "won") {
        best = Math.min(best, depth);
        return;
      }
      if (status.kind === "lost") return;
      for (const move of crackstep.legalMoves(state, 0)) {
        dfs(apply(state, move), depth + 1);
      }
    }
    dfs(stateOf(3, 2, TILES, 4), 0);
    expect(best).toBe(4);

    const result = solver.solve(crackstep, stateOf(3, 2, TILES, 4), { maxNodes: 1e6, maxMs: 10_000 });
    expect(result.length).toBe(best);
  });
});

describe("solver — planted parity-unsolvable board", () => {
  it("a 3x3 plus-shape (color imbalance 4 vs 1) is reported unsolvable, never a hang", () => {
    // hole everywhere except the cross (1,3,4,5,7) — parityRejects(width=3, that set) is true
    // (board.test.ts pins this directly); confirmed genuinely unsolvable here via real search.
    const TILES: TileKind[] = ["hole", "crumble", "hole", "crumble", "crumble", "crumble", "hole", "crumble", "hole"];
    const initial = stateOf(3, 3, TILES, 4);
    const result = solver.solve(crackstep, initial, { maxNodes: 1e6, maxMs: 10_000 });
    expect(result.outcome).toBe("unsolvable");
  });
});

describe("solver — tiny budget forces budget-exhausted (never silently 'unsolvable')", () => {
  it("a real generated board under maxNodes: 1 reports budget-exhausted, not unsolvable", () => {
    const rng = rngFromSeed("solver-budget-exhausted:1");
    const board = generateBoard(rng);
    const total = board.width * board.height;
    const visited = Array(total).fill(false);
    visited[board.start] = true;
    const initial: CrackstepState = {
      width: board.width,
      height: board.height,
      tiles: board.tiles as TileKind[],
      crumbled: Array(total).fill(false),
      visited,
      pos: board.start,
      lastEffects: [],
    };
    const result = solver.solve(crackstep, initial, { maxNodes: 1, maxMs: 10_000 });
    expect(result.outcome).toBe("budget-exhausted");
  });
});

describe("crackstepSoloHeuristic — the two prunes, planted directly against the guard", () => {
  it("prune 1 (reachability): an unvisited tile cut off by a crumbled hub returns Infinity", () => {
    // Same plus-shape as the stranding fixture: hub(4) crumbled, standing at arm 1 -- arms
    // 3, 5, 7 (unvisited) are now unreachable.
    const tiles: TileKind[] = ["hole", "crumble", "hole", "crumble", "crumble", "crumble", "hole", "crumble", "hole"];
    const crumbled = Array(9).fill(false);
    crumbled[4] = true;
    const visited = Array(9).fill(false);
    visited[4] = true;
    visited[1] = true;
    const state: CrackstepState = { width: 3, height: 3, tiles, crumbled, visited, pos: 1, lastEffects: [] };
    expect(crackstepSoloHeuristic(state)).toBe(Number.POSITIVE_INFINITY);
  });

  it("prune 2 (dead-end reservation): 2+ unvisited degree-1 crumbling pockets returns Infinity", () => {
    const tiles: TileKind[] = ["hole", "crumble", "hole", "crumble", "crumble", "crumble", "hole", "crumble", "hole"];
    const crumbled = Array(9).fill(false);
    const visited = Array(9).fill(false);
    visited[4] = true; // standing at the intact hub; arms 1,3,5,7 are all unvisited degree-1
    const state: CrackstepState = { width: 3, height: 3, tiles, crumbled, visited, pos: 4, lastEffects: [] };
    expect(crackstepSoloHeuristic(state)).toBe(Number.POSITIVE_INFINITY);
  });

  it("neither prune applies: returns the exact (finite, admissible) unvisited count", () => {
    const initial = stateOf(3, 3, Array(9).fill("crumble") as TileKind[], 0);
    expect(crackstepSoloHeuristic(initial)).toBe(8); // 8 unvisited (cell 0 is the visited start)
  });

  it("solved state (0 unvisited) returns exactly 0, not a pruned Infinity", () => {
    const tiles: TileKind[] = Array(4).fill("crumble") as TileKind[];
    const state: CrackstepState = {
      width: 2,
      height: 2,
      tiles,
      crumbled: [true, true, true, false],
      visited: [true, true, true, true],
      pos: 3,
      lastEffects: [],
    };
    expect(crackstepSoloHeuristic(state)).toBe(0);
  });
});

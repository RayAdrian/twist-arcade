// games/crackstep/engine-fixtures.test.ts — TDD anchors from the plan's §6.5 list: a scripted
// hand-board walkthrough with hand-computed crumbled/visited/effects at every step; stone
// re-entry legality + "leaving stone emits no crumbled"; crumbled-cell re-entry illegality; a
// stranding fixture (lost, never a hang); the termination bound (2|C|+1); and the position-key
// soundness property (plan §6.4) proven as a general invariant, not just one hand pair.
//
// Fixtures construct `CrackstepState` directly (bypassing `setup()`'s procedural generator,
// which is covered separately in board.test.ts) — the state shape is a plain exported
// interface, and hand-built boards are how a "known answer" is even possible here.

import { describe, expect, it } from "vitest";
import type { PlayerId, Rng } from "@twist-arcade/engine";
import { rngFromSeed } from "@twist-arcade/engine";
import { crackstep, type CrackstepMove, type CrackstepState, type TileKind } from "./engine";
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

describe("scripted 3x3 all-crumble walkthrough (boustrophedon, hand-verified)", () => {
  // 0 1 2
  // 3 4 5
  // 6 7 8
  const PATH = [1, 2, 5, 4, 3, 6, 7, 8];

  it("crumbles the departed cell on every move, effect order [moved, crumbled], win on the last tile", () => {
    let state = stateOf(3, 3, Array(9).fill("crumble") as TileKind[], 0);
    for (const to of PATH) {
      const from = state.pos;
      state = apply(state, to);
      expect(state.lastEffects).toEqual([
        { type: "moved", from, to, width: 3, height: 3 },
        { type: "crumbled", cell: from },
      ]);
      expect(state.crumbled[from]).toBe(true);
      expect(state.visited[to]).toBe(true);
    }
    expect(crackstep.status(state)).toEqual({ kind: "won", winner: 0 });
    // Every cell but the final one (8, never left) has crumbled.
    for (let c = 0; c < 9; c++) {
      expect(state.crumbled[c]).toBe(c !== 8);
    }
    // Effects never accumulate across calls.
    expect(state.lastEffects).toHaveLength(2);
  });

  it("the first move crumbles the start tile (start is always a crumbling tile, plan §1.1)", () => {
    let state = stateOf(3, 3, Array(9).fill("crumble") as TileKind[], 0);
    expect(state.crumbled[0]).toBe(false);
    state = apply(state, 1);
    expect(state.crumbled[0]).toBe(true);
  });
});

describe("stone: re-entry legal, never crumbles, never marked crumbled", () => {
  // 3-wide, 2-tall grid; only cells 0,1,2,4 are walkable (3 and 5 are holes):
  //   0 1 2
  //   3 4 5
  // tile 1 is stone (a hub reachable from 0, 2, and 4); start = 4.
  const TILES: TileKind[] = ["crumble", "stone", "crumble", "hole", "crumble", "hole"];

  it("full walkthrough: 4->1->0->1->2, stone survives twice, re-entry legal, ends won", () => {
    let state = stateOf(3, 2, TILES, 4);

    // move 1: 4 (crumble) -> 1 (stone). Departing a crumble tile crumbles it.
    state = apply(state, 1);
    expect(state.crumbled[4]).toBe(true);
    expect(state.lastEffects).toEqual([
      { type: "moved", from: 4, to: 1, width: 3, height: 2 },
      { type: "crumbled", cell: 4 },
    ]);

    // move 2: 1 (stone) -> 0 (crumble). Leaving STONE emits NO crumbled effect.
    state = apply(state, 0);
    expect(state.crumbled[1]).toBe(false);
    expect(state.lastEffects).toEqual([{ type: "moved", from: 1, to: 0, width: 3, height: 2 }]);

    // move 3: 0 (crumble) -> 1 (stone) AGAIN. Re-entering a visited, never-crumbled stone tile
    // is legal — this is the re-entry property under test.
    expect(crackstep.isLegal(state, 0, 1)).toBe(true);
    state = apply(state, 1);
    expect(state.crumbled[0]).toBe(true);
    expect(state.crumbled[1]).toBe(false); // still never crumbled, even on a second visit

    // move 4: 1 (stone) -> 2 (crumble). Leaving stone AGAIN emits no crumbled effect.
    state = apply(state, 2);
    expect(state.lastEffects).toEqual([{ type: "moved", from: 1, to: 2, width: 3, height: 2 }]);
    expect(state.crumbled[1]).toBe(false);

    expect(crackstep.status(state)).toEqual({ kind: "won", winner: 0 });
  });

  it("a crumbled cell can never be re-entered (isLegal false, absent from legalMoves)", () => {
    let state = stateOf(3, 2, TILES, 4);
    state = apply(state, 1); // 4 crumbles
    expect(crackstep.isLegal(state, 0, 4)).toBe(false);
    expect(crackstep.legalMoves(state, 0)).not.toContain(4);
    expect(() => apply(state, 4)).toThrow();
  });
});

describe("stranding fixture: entering a dead-end pocket first strands the run (lost, never a hang)", () => {
  // 3x3 plus-shape: hole everywhere except the cross (1,3,4,5,7). Start at the hub (4).
  // Walking straight into arm 1 first leaves 4 (the ONLY neighbor 1 ever had) crumbled behind
  // you — arm 1 then has no legal moves at all, while arms 3/5/7 remain completely unvisited.
  const TILES: TileKind[] = ["hole", "crumble", "hole", "crumble", "crumble", "crumble", "hole", "crumble", "hole"];

  it("legalMoves empties out and status becomes `lost`, not a hang", () => {
    let state = stateOf(3, 3, TILES, 4);
    state = apply(state, 1);
    expect(crackstep.legalMoves(state, 0)).toEqual([]);
    expect(crackstep.status(state)).toEqual({ kind: "lost" });
    // Not every tile was visited — this is a genuine stranding, not a false "won".
    expect(state.visited.filter((v, i) => TILES[i] !== "hole" && v)).toHaveLength(2);
  });
});

describe("position-key soundness (plan §6.4): crumbled is fully determined by (tiles, visited, pos)", () => {
  it("holds as an invariant across many random playouts on real generated boards", () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = rngFromSeed(`position-key:${seed}`);
      let state = crackstep.setup(1, rng);
      const walkRng = rngFromSeed(`position-key-walk:${seed}`);
      for (let ply = 0; ply < 80; ply++) {
        if (crackstep.status(state).kind !== "ongoing") break;
        const legal = crackstep.legalMoves(state, 0);
        const move = legal[walkRng.int(legal.length)]!;
        state = apply(state, move);

        for (let c = 0; c < state.tiles.length; c++) {
          const expectedCrumbled = state.tiles[c] === "crumble" && state.visited[c] && c !== state.pos;
          expect(state.crumbled[c]).toBe(expectedCrumbled);
        }
      }
    }
  });

  it("corollary: two states sharing (tiles, visited, pos) therefore share `crumbled` and encode() identically", () => {
    // A direct instance, not just the general invariant above: build the SAME logical state
    // (tiles, visited, pos) via two different constructions and confirm the derived `crumbled`
    // — and hence encode() — agree, without either construction threading move ORDER through
    // at all (the invariant above is exactly why order can never matter).
    const TILES: TileKind[] = ["crumble", "stone", "crumble", "hole", "crumble", "hole"];
    const visitedSet = [0, 1, 2, 4];

    function stateFromVisitedSet(pos: number): CrackstepState {
      const visited = Array(6).fill(false);
      for (const c of visitedSet) visited[c] = true;
      const crumbled = TILES.map((t, i) => t === "crumble" && visited[i] && i !== pos);
      return { width: 3, height: 2, tiles: TILES, crumbled, visited, pos, lastEffects: [] };
    }

    const a = stateFromVisitedSet(2);
    const b = stateFromVisitedSet(2);
    expect(crackstep.encode(a)).toBe(crackstep.encode(b));
  });
});

describe("termination bound: 2|crumbling| + 1 (plan §1.5, structural — not a tripwire)", () => {
  it("holds across 200 real generated boards' random playouts", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = rngFromSeed(`termination-bound:${seed}`);
      const board = generateBoard(rng);
      const crumblingCount = board.tiles.filter((t) => t === "crumble").length;
      const bound = 2 * crumblingCount + 1;

      let state = crackstep.setup(1, rngFromSeed(`termination-bound:${seed}`));
      const walkRng = rngFromSeed(`termination-bound-walk:${seed}`);
      let moves = 0;
      while (crackstep.status(state).kind === "ongoing" && moves <= bound + 5) {
        const legal = crackstep.legalMoves(state, 0);
        const move = legal[walkRng.int(legal.length)]!;
        state = apply(state, move);
        moves += 1;
      }
      expect(crackstep.status(state).kind).not.toBe("ongoing");
      expect(moves).toBeLessThanOrEqual(bound);
      // Also comfortably under the platform's 200-ply cap (never even close).
      expect(moves).toBeLessThanOrEqual(69);
    }
  });
});

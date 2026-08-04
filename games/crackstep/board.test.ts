// games/crackstep/board.test.ts — pure grid-math/generator unit tests (plan §6.5's generator
// invariants): connectivity, stone non-adjacency, start-is-crumbling, and (where applicable)
// the two cheap pre-solver rejections, swept across many distinct seeds rather than asserted
// from a single hand-picked one.

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import {
  deadEndReservationCount,
  generateBoard,
  neighbors,
  parityRejects,
  reachableSet,
  tooManyDeadEnds,
  unreachableUnvisitedCount,
} from "./board";

describe("neighbors", () => {
  it("corner has 2 orthogonal neighbors, interior has 4, edge has 3", () => {
    expect(neighbors(0, 5, 5).sort((a, b) => a - b)).toEqual([1, 5]); // top-left corner
    expect(neighbors(12, 5, 5).sort((a, b) => a - b)).toEqual([7, 11, 13, 17]); // center of 5x5
    expect(neighbors(1, 5, 5).sort((a, b) => a - b)).toEqual([0, 2, 6]); // top edge
  });
});

describe("reachableSet", () => {
  it("returns only the passable component connected to start", () => {
    // 1x3 row: 0-1-2, but 1 is impassable — 0 and 2 are each isolated singletons.
    const passable = (c: number) => c !== 1;
    const from0 = reachableSet(0, 3, 1, passable);
    expect([...from0]).toEqual([0]);
  });

  it("start itself impassable -> empty set", () => {
    expect(reachableSet(0, 3, 3, () => false).size).toBe(0);
  });
});

describe("parityRejects", () => {
  it("a full 5x5 walkable grid (25 cells, colors 13/12) does not reject", () => {
    const walkable = new Set(Array.from({ length: 25 }, (_, i) => i));
    expect(parityRejects(5, walkable)).toBe(false);
  });

  it("a cross-shaped 5-cell board (colors 1 vs 4) rejects", () => {
    // 3x3 grid, walkable = the plus/cross shape: (0,1),(1,0),(1,1),(1,2),(2,1) = cells 1,3,4,5,7
    const walkable = new Set([1, 3, 4, 5, 7]);
    expect(parityRejects(3, walkable)).toBe(true);
  });
});

describe("tooManyDeadEnds", () => {
  it("a straight corridor has exactly one non-start dead end (the far end) -> not rejected", () => {
    // 1x4 corridor: 0-1-2-3, start = 0. Cell 3 has degree 1 (non-start) -- exactly one, allowed.
    const walkable = new Set([0, 1, 2, 3]);
    expect(tooManyDeadEnds(4, 1, walkable, new Set(), 0)).toBe(false);
  });

  it("two dead-end corridors off a shared hub -> rejected (both non-start, both degree 1)", () => {
    // A 5x1 corridor plus a T-branch: cells 0-1-2-3-4 in a row, plus cell 5 hanging off cell 2
    // (a Y-shape). Cannot build a Y purely from `neighbors()` on a rectangular grid without a
    // second row, so use a 3x3 "plus" shape instead: center 4, arms 1,3,5,7 (a 4-way hub) plus
    // extend one arm further so two OTHER arms are genuine dead ends relative to a start on the
    // extended arm. Simpler: a 3-wide, 3-tall grid keeping only the plus-shape (cells
    // 1,3,4,5,7) with start at 4 (the hub) -- arms 1,3,5,7 are all non-start degree-1 dead
    // ends: 4 of them, comfortably over the >1 threshold.
    const walkable = new Set([1, 3, 4, 5, 7]);
    expect(tooManyDeadEnds(3, 3, walkable, new Set(), 4)).toBe(true);
  });

  it("a stone tile at a degree-1 position is exempt (stone is never the reservation problem)", () => {
    const walkable = new Set([0, 1, 2, 3]);
    // cell 3 (degree 1, non-start) is stone -- exempt, so still not rejected even alone.
    expect(tooManyDeadEnds(4, 1, walkable, new Set([3]), 0)).toBe(false);
  });
});

describe("generateBoard — swept across many seeds", () => {
  const SEED_COUNT = 500;

  it("every seed: dims in {5,6}, walkable set connected, no adjacent stones, start is crumbling", () => {
    for (let i = 0; i < SEED_COUNT; i++) {
      const rng = rngFromSeed(`board-sweep:${i}`);
      const board = generateBoard(rng);

      expect([5, 6]).toContain(board.width);
      expect([5, 6]).toContain(board.height);
      const total = board.width * board.height;
      expect(board.tiles).toHaveLength(total);

      const walkable = new Set<number>();
      const stones = new Set<number>();
      for (let c = 0; c < total; c++) {
        if (board.tiles[c] !== "hole") walkable.add(c);
        if (board.tiles[c] === "stone") stones.add(c);
      }

      // Connectivity.
      const reached = reachableSet([...walkable][0]!, board.width, board.height, (c) => walkable.has(c));
      expect(reached.size).toBe(walkable.size);

      // Walkable-tile band (plan §1.1: 16-34 after holes).
      expect(walkable.size).toBeGreaterThanOrEqual(16);
      expect(walkable.size).toBeLessThanOrEqual(34);

      // No two stones orthogonally adjacent (the termination proof depends on this, §1.5).
      for (const s of stones) {
        for (const n of neighbors(s, board.width, board.height)) {
          expect(stones.has(n)).toBe(false);
        }
      }
      expect(stones.size).toBeLessThanOrEqual(5);

      // Start is always a crumbling tile.
      expect(board.tiles[board.start]).toBe("crumble");

      // Cheap pre-solver rejections actually held at generation time.
      if (stones.size === 0) {
        expect(parityRejects(board.width, walkable)).toBe(false);
      }
      expect(tooManyDeadEnds(board.width, board.height, walkable, stones, board.start)).toBe(false);
    }
  });
});

describe("shared unvisited/reachability/dead-end helpers", () => {
  it("unreachableUnvisitedCount is 0 on a fully-intact 3x3 grid from any start", () => {
    const tiles = Array(9).fill("crumble") as ("crumble" | "stone" | "hole")[];
    const crumbled = Array(9).fill(false);
    const visited = Array(9).fill(false);
    visited[0] = true;
    expect(unreachableUnvisitedCount(tiles, crumbled, visited, 3, 3, 0)).toBe(0);
  });

  it("unreachableUnvisitedCount counts an unvisited tile cut off by crumbling", () => {
    // 1x3 corridor: 0-1-2. Standing at 2, cell 0 crumbled (fallen) -- cell... actually with only
    // 3 cells and pos=2, crumbling cell 0 does not disconnect anything (0 has no OTHER unvisited
    // neighbor depending on it). Use a Y via the 3x3 plus-shape instead: hub 4, arms 1,3,5,7.
    const tiles: ("crumble" | "stone" | "hole")[] = Array(9).fill("hole");
    for (const c of [1, 3, 4, 5, 7]) tiles[c] = "crumble";
    const crumbled = Array(9).fill(false);
    crumbled[4] = true; // the hub has fallen
    const visited = Array(9).fill(false);
    visited[4] = true;
    visited[1] = true; // arm 1 already visited/left
    visited[5] = true; // standing here now
    // Standing at arm 5; arms 3 and 7 are unvisited and, with the hub crumbled, unreachable.
    expect(unreachableUnvisitedCount(tiles, crumbled, visited, 3, 3, 5)).toBe(2);
  });

  it("deadEndReservationCount finds 2+ unvisited degree-1 crumbling pockets", () => {
    const tiles: ("crumble" | "stone" | "hole")[] = Array(9).fill("hole");
    for (const c of [1, 3, 4, 5, 7]) tiles[c] = "crumble";
    const crumbled = Array(9).fill(false);
    const visited = Array(9).fill(false);
    visited[4] = true; // standing at the hub; arms 1,3,5,7 all unvisited degree-1 pockets
    expect(deadEndReservationCount(tiles, crumbled, visited, 3, 3, 4)).toBe(4);
  });
});

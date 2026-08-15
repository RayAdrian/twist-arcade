// games/nine-grids/probes.test.ts — TDD anchor for platform-corrections.md C81/task #26: Nine
// Grids' own mirrorMove must return `null` (the platform's documented "null -> harness fallback"
// convention — same as Fadeout's and Tilt's own probes.ts) rather than silently substituting
// `legalMoves[0]` internally, which made ~86% of its "mirror" row invisible first-legal play the
// harness could not observe (measured fallback rates: tilt 0/80, fadeout 17/61, nine-grids
// 221/258).

import { describe, expect, it } from "vitest";
import { rngForSetup } from "@twist-arcade/engine";
import { nineGrids } from "./engine";
import { mirrorMove } from "./probes";

describe("mirrorMove", () => {
  it("returns null when there is no opponent move to mirror (opening)", () => {
    const state = nineGrids.setup(2, rngForSetup("ng-probes-1"));
    expect(mirrorMove(state, null, nineGrids.legalMoves(state, state.toMove))).toBeNull();
  });

  it("point-reflects the opponent's move (g -> 80-g) when the reflected target IS in the mover's current legal set", () => {
    // Opening move (board=0, cell=8): g = 0*9+8 = 8, sends the opponent to activeBoard=8 (the
    // send rule: activeBoard' = cell just played). Mirrored target: mirroredG = 80-8 = 72 =
    // 8*9+0 -> (board=8, cell=0), which sits INSIDE board 8 and is unoccupied — a real legal
    // reflection, not the degenerate self-mapping case.
    let state = nineGrids.setup(2, rngForSetup("ng-probes-2"));
    state = nineGrids.apply(state, new Map([[0, { board: 0, cell: 8 }]]), rngForSetup("ng-probes-2-apply"));
    expect(state.activeBoard).toBe(8);
    const legal = nineGrids.legalMoves(state, state.toMove);
    expect(mirrorMove(state, { board: 0, cell: 8 }, legal)).toEqual({ board: 8, cell: 0 });
  });

  it("returns null (never legalMoves[0]) when the reflected target is illegal — the must-follow rule confines the mover to a DIFFERENT board than the reflection lands in", () => {
    // Opening move (board=0, cell=0): g = 0, sends the opponent to activeBoard=0 (cell 0 of
    // board 0 is now taken). Mirrored target: mirroredG = 80 -> (board=8, cell=8) — a
    // perfectly valid CELL, but board 8 is not the mover's activeBoard (0), so it is not in
    // the mover's current legal set at all. The pre-fix implementation silently substituted
    // legalMoves[0] here (invisible to the harness); the fix must return null so the harness's
    // own documented fallback (a random legal move) handles it instead.
    let state = nineGrids.setup(2, rngForSetup("ng-probes-3"));
    state = nineGrids.apply(state, new Map([[0, { board: 0, cell: 0 }]]), rngForSetup("ng-probes-3-apply"));
    expect(state.activeBoard).toBe(0);
    const legal = nineGrids.legalMoves(state, state.toMove);
    expect(legal.some((m) => m.board === 8 && m.cell === 8)).toBe(false);
    expect(mirrorMove(state, { board: 0, cell: 0 }, legal)).toBeNull();
  });
});

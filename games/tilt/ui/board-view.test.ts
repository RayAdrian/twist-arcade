// games/tilt/ui/board-view.test.ts — TDD for the pure view-building helpers behind Board.tsx and
// index.ts's announce()/telegraph. DOM-free, directly testable in isolation (Nine Grids' own
// board-view.test.ts convention).

import { describe, expect, it } from "vitest";
import { rngForSetup } from "@twist-arcade/engine";
import { SIZE, TILT_PERIOD, tilt } from "../engine";
import type { Disc } from "../engine-internal";
import {
  boardSummaryText,
  buildCellPresentations,
  justMovedCells,
  nextFloorEdge,
  pliesUntilNextTilt,
  telegraphText,
  tiltProximityAnnouncement,
} from "./board-view";

function idx(row: number, col: number): number {
  return row * SIZE + col;
}

function emptyGrid(): Disc[] {
  return new Array<Disc>(SIZE * SIZE).fill(null);
}

describe("pliesUntilNextTilt", () => {
  it("returns tiltPeriod on the empty opening grid (a full cycle ahead)", () => {
    const state = tilt.setup(2, rngForSetup("s"));
    expect(pliesUntilNextTilt(state.grid, TILT_PERIOD)).toBe(TILT_PERIOD);
  });

  it("counts down as discs are placed, and wraps back to tiltPeriod right after a tilt fires", () => {
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    expect(pliesUntilNextTilt(grid, TILT_PERIOD)).toBe(TILT_PERIOD - 1);
    const grid2 = emptyGrid();
    for (let i = 0; i < TILT_PERIOD; i++) grid2[i] = (i % 2) as 0 | 1; // discCount === TILT_PERIOD
    expect(pliesUntilNextTilt(grid2, TILT_PERIOD)).toBe(TILT_PERIOD);
  });
});

describe("tiltProximityAnnouncement", () => {
  it("is silent when more than 2 plies remain", () => {
    const state = tilt.setup(2, rngForSetup("s"));
    expect(tiltProximityAnnouncement(state.grid, TILT_PERIOD)).toBe("");
  });

  it("says '...after the next move' at exactly 1 ply remaining", () => {
    const grid = emptyGrid();
    for (let i = 0; i < TILT_PERIOD - 1; i++) grid[i] = 0;
    expect(pliesUntilNextTilt(grid, TILT_PERIOD)).toBe(1);
    expect(tiltProximityAnnouncement(grid, TILT_PERIOD)).toBe("Board tilts after the next move.");
  });

  it("says '...after N more moves' at 2 plies remaining", () => {
    const grid = emptyGrid();
    for (let i = 0; i < TILT_PERIOD - 2; i++) grid[i] = 0;
    expect(pliesUntilNextTilt(grid, TILT_PERIOD)).toBe(2);
    expect(tiltProximityAnnouncement(grid, TILT_PERIOD)).toBe("Board tilts after 2 more moves.");
  });
});

describe("telegraphText — visible from ply 1 (plan §6.1)", () => {
  it("is well-defined on the empty opening grid", () => {
    const state = tilt.setup(2, rngForSetup("s"));
    const text = telegraphText(state.grid, TILT_PERIOD, "cw");
    expect(text).toContain(String(TILT_PERIOD));
    expect(text).toContain("right");
  });
});

describe("nextFloorEdge", () => {
  it("is 'right' under the shipped cw direction", () => {
    expect(nextFloorEdge("cw")).toBe("right");
  });
  it("is 'unknown' under the unsupported alternating lever (documented gap, not guessed)", () => {
    expect(nextFloorEdge("alternating")).toBe("unknown");
  });
});

describe("buildCellPresentations", () => {
  it("returns SIZE*SIZE presentations, row-major", () => {
    const state = tilt.setup(2, rngForSetup("s"));
    const cells = buildCellPresentations(state.grid, { size: SIZE, winLength: 4 });
    expect(cells).toHaveLength(SIZE * SIZE);
    expect(cells[0]).toMatchObject({ row: 0, col: 0 });
    expect(cells[SIZE * SIZE - 1]).toMatchObject({ row: SIZE - 1, col: SIZE - 1 });
  });

  it("marks exactly the lowest-empty-row cell of each non-full column as the drop target", () => {
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0; // col0 has one disc — next drop target is row5,col0
    const cells = buildCellPresentations(grid, { size: SIZE, winLength: 4 });
    const col0Targets = cells.filter((c) => c.col === 0 && c.isDropTarget);
    expect(col0Targets).toHaveLength(1);
    expect(col0Targets[0]).toMatchObject({ row: 5, col: 0 });
    // Every other (empty) column's drop target is row 6 (the bottom).
    const col1Targets = cells.filter((c) => c.col === 1 && c.isDropTarget);
    expect(col1Targets).toHaveLength(1);
    expect(col1Targets[0]).toMatchObject({ row: 6, col: 1 });
  });

  it("a full column has no drop target at all", () => {
    const grid = emptyGrid();
    for (let r = 0; r < SIZE; r++) grid[idx(r, 0)] = (r % 2) as 0 | 1;
    const cells = buildCellPresentations(grid, { size: SIZE, winLength: 4 });
    expect(cells.filter((c) => c.col === 0 && c.isDropTarget)).toHaveLength(0);
  });

  it("accessible names distinguish filled/ringed discs, drop targets, and plain empty cells", () => {
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 1)] = 1;
    const cells = buildCellPresentations(grid, { size: SIZE, winLength: 4 });
    const filled = cells.find((c) => c.row === 6 && c.col === 0)!;
    expect(filled.accessibleName).toContain("filled disc");
    const ringed = cells.find((c) => c.row === 6 && c.col === 1)!;
    expect(ringed.accessibleName).toContain("ringed disc");
    const dropTarget = cells.find((c) => c.row === 6 && c.col === 2)!;
    expect(dropTarget.accessibleName).toContain("drop target");
    const plainEmpty = cells.find((c) => c.row === 0 && c.col === 2)!;
    expect(plainEmpty.accessibleName).not.toContain("drop target");
  });
});

describe("justMovedCells", () => {
  it("collects the 'to' cell of every 'moved' effect, ignoring other effect types", () => {
    const cells = justMovedCells([
      { type: "placed", column: 0, cell: 42 },
      { type: "tilted", direction: "cw" },
      { type: "moved", player: 0, from: 0, to: 21 },
      { type: "moved", player: 1, from: 1, to: 29 },
    ]);
    expect(cells).toEqual(new Set([21, 29]));
  });

  it("is empty when there was no tilt (no 'moved' effects)", () => {
    expect(justMovedCells([{ type: "placed", column: 0, cell: 42 }])).toEqual(new Set());
  });
});

describe("boardSummaryText", () => {
  it("counts filled and ringed discs and open columns on the opening grid", () => {
    const state = tilt.setup(2, rngForSetup("s"));
    const text = boardSummaryText(state.grid, { size: SIZE, winLength: 4 });
    expect(text).toContain("0 filled discs, 0 ringed discs");
    expect(text).toContain(`${SIZE} of ${SIZE} columns open`);
  });

  it("reflects a partially-filled board", () => {
    const grid = emptyGrid();
    grid[idx(6, 0)] = 0;
    grid[idx(6, 1)] = 1;
    for (let r = 0; r < SIZE; r++) grid[idx(r, 2)] = (r % 2) as 0 | 1; // fill column 2 entirely
    const text = boardSummaryText(grid, { size: SIZE, winLength: 4 });
    expect(text).toContain(`${SIZE - 1} of ${SIZE} columns open`);
  });
});

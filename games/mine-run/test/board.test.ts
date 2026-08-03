// games/mine-run/test/board.test.ts
//
// TDD anchor (docs/plans/mine-run.md §10): pure grid geometry — neighbor adjacency, adjacent
// mine counts, and the classic zero-flood fill — hand-verified on a tiny 3x3 and a 5x5 board
// before engine.ts is built on top of it. This file is written and run RED before board.ts
// exists.

import { describe, expect, it } from "vitest";
import { countAdjacentMines, floodFrom, neighbors } from "../board";

describe("board geometry", () => {
  it("neighbors(): a corner cell on a 3x3 board has exactly 3 neighbors", () => {
    // 3x3 grid, cell 0 is top-left corner: neighbors are 1 (right), 3 (down), 4 (diag).
    expect(new Set(neighbors(0, 3, 3))).toEqual(new Set([1, 3, 4]));
  });

  it("neighbors(): an edge (non-corner) cell on a 3x3 board has exactly 5 neighbors", () => {
    // cell 1 is top-middle: neighbors 0,2 (row), 3,4,5 (row below).
    expect(new Set(neighbors(1, 3, 3))).toEqual(new Set([0, 2, 3, 4, 5]));
  });

  it("neighbors(): a fully interior cell on a 3x3 board has exactly 8 neighbors", () => {
    // cell 4 is the center: all other 8 cells.
    expect(new Set(neighbors(4, 3, 3))).toEqual(new Set([0, 1, 2, 3, 5, 6, 7, 8]));
  });

  it("neighbors(): a non-square board (width != height) computes row/col correctly", () => {
    // 5-wide, 2-tall board. cell 5 is (row 1, col 0): neighbors (row0,col0)=0,(row0,col1)=1,(row1,col1)=6.
    expect(new Set(neighbors(5, 5, 2))).toEqual(new Set([0, 1, 6]));
  });

  it("countAdjacentMines(): counts mines among the 8-neighborhood only", () => {
    // 3x3 board, mines at 0 and 8 (opposite corners). Cell 4 (center) is adjacent to both.
    const mines = new Set([0, 8]);
    expect(countAdjacentMines(4, mines, 3, 3)).toBe(2);
    // Cell 1 (top-middle) is adjacent to 0 but not 8.
    expect(countAdjacentMines(1, mines, 3, 3)).toBe(1);
    // Cell 5 (right-middle) is adjacent to neither directly... check by hand: cell 5 = (row1,col2)
    // neighbors: (0,1)=1,(0,2)=2,(1,1)=4,(2,1)=7,(2,2)=8 -> adjacent to mine 8.
    expect(countAdjacentMines(5, mines, 3, 3)).toBe(1);
  });

  it("floodFrom(): a non-zero start cell opens only itself (no expansion)", () => {
    // 3x3, single mine at 0. Cell 4 (center) has count 1 (adjacent to mine 0) -> no flood.
    const mines = new Set([0]);
    expect(floodFrom(4, mines, 3, 3).sort((a, b) => a - b)).toEqual([4]);
  });

  it("floodFrom(): a zero start cell opens its connected zero region plus bordering numbers", () => {
    // 5x5 board, single mine in a far corner (cell 24, bottom-right). Flooding from cell 0
    // (top-left, far from the mine) should open the entire board except the mine's numbered
    // border, since with only one mine on a 5x5 board almost everything not adjacent to the
    // mine is a zero cell.
    // Board layout (row-major, 5 wide):
    //  0  1  2  3  4
    //  5  6  7  8  9
    // 10 11 12 13 14
    // 15 16 17 18 19
    // 20 21 22 23 24 (mine here)
    // Cells adjacent to 24: 18,19,23 (and 24 itself, excluded). Those get count=1, non-zero,
    // and stop the flood. Every other cell is zero and connected to cell 0.
    const mines = new Set([24]);
    const opened = new Set(floodFrom(0, mines, 5, 5));
    // The numbered border cells ARE opened (they're revealed, just not expanded past).
    expect(opened.has(18)).toBe(true);
    expect(opened.has(19)).toBe(true);
    expect(opened.has(23)).toBe(true);
    // The mine itself is never opened by a flood (flood only traverses safe cells).
    expect(opened.has(24)).toBe(false);
    // Every other safe cell (0..23 except 18,19,23) is reached.
    for (let c = 0; c < 24; c++) {
      if (c === 18 || c === 19 || c === 23) continue;
      expect(opened.has(c)).toBe(true);
    }
    expect(opened.size).toBe(24); // all 24 safe cells (25 total - 1 mine)
  });

  it("floodFrom(): stops at numbered cells and does not cross a wall of numbers into an unrelated zero pocket", () => {
    // 5x5 board with mines arranged so two zero pockets are separated by a solid band of
    // numbered cells: mines at row 2 entirely (10,11,12,13,14 -> wait these must be mines,
    // but then row2 cells can't also be "numbered safe cells". Use a thinner separating band:
    // mines at 10 and 14 only is not enough to fully separate; construct a genuine wall using
    // a full row of mines is too dense (5 mines in one row of a 5-wide board removes the row
    // entirely, which is a fine partition). Row index 2 (cells 10-14) all mines.
    const mines = new Set([10, 11, 12, 13, 14]);
    const openedTop = new Set(floodFrom(0, mines, 5, 5));
    // Top pocket (rows 0-1) should NOT reach the bottom pocket (rows 3-4) since the whole
    // middle row is mines with nothing to flood through.
    for (let c = 15; c < 25; c++) {
      expect(openedTop.has(c)).toBe(false);
    }
    // Top pocket cells adjacent to the mine row (row 1: 5..9) have count > 0 and ARE opened,
    // but not expanded past (no further mines to touch beyond the wall).
    for (let c = 0; c < 10; c++) {
      expect(openedTop.has(c)).toBe(true);
    }
  });
});

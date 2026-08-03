// games/crackstep/ui/board-view.test.ts — pure view-building helper tests (no DOM). Board.test.tsx
// proves these get wired onto real shell Cells; this file pins the logic itself.

import { describe, expect, it } from "vitest";
import type { CrackstepState, TileKind } from "../engine";
import { boardSummaryText, buildCellPresentations, positionName, rowCol, tilesRemaining } from "./board-view";

function state(overrides: Partial<CrackstepState> = {}): CrackstepState {
  const tiles: TileKind[] = ["crumble", "stone", "crumble", "hole"];
  return {
    width: 2,
    height: 2,
    tiles,
    crumbled: [false, false, false, false],
    visited: [true, false, false, false],
    pos: 0,
    lastEffects: [],
    ...overrides,
  };
}

describe("rowCol / positionName", () => {
  it("computes row/col from a row-major cell index", () => {
    expect(rowCol(0, 3)).toEqual([0, 0]);
    expect(rowCol(4, 3)).toEqual([1, 1]);
    expect(rowCol(8, 3)).toEqual([2, 2]);
  });

  it("names use 1-indexed 'row R column C' with no comma between them", () => {
    expect(positionName(4, 3)).toBe("row 2 column 2");
  });
});

describe("buildCellPresentations", () => {
  it("classifies each of the five states correctly", () => {
    const view = state({
      tiles: ["crumble", "stone", "crumble", "hole"],
      crumbled: [false, false, true, false],
      visited: [true, false, true, false],
      pos: 0,
    });
    const cells = buildCellPresentations(view);
    expect(cells[0]!.state).toBe("current"); // pos, and it's a "crumble" tile
    expect(cells[1]!.state).toBe("stone");
    expect(cells[2]!.state).toBe("crumbled");
    expect(cells[3]!.state).toBe("hole");
  });

  it("current on a stone tile is 'current', not 'stone'", () => {
    const view = state({ pos: 1, visited: [true, true, false, false] });
    const cells = buildCellPresentations(view);
    expect(cells[1]!.state).toBe("current");
  });

  it("accessible names follow the 'position, type, state' convention", () => {
    const view = state({
      tiles: ["crumble", "stone", "crumble", "hole"],
      crumbled: [false, false, true, false],
      visited: [true, false, true, false],
      pos: 0,
    });
    const cells = buildCellPresentations(view);
    expect(cells[0]!.accessibleName).toBe("row 1 column 1, crumbling, you are here — falls when you leave");
    expect(cells[1]!.accessibleName).toBe("row 1 column 2, stone, not yet crossed");
    expect(cells[2]!.accessibleName).toBe("row 2 column 1, gone");
    expect(cells[3]!.accessibleName).toBe("row 2 column 2, never floor");
  });

  it("current on stone reads as safe, not falling", () => {
    const view = state({ pos: 1, visited: [true, true, false, false] });
    const cells = buildCellPresentations(view);
    expect(cells[1]!.accessibleName).toBe("row 1 column 2, stone, you are here");
  });
});

describe("tilesRemaining / boardSummaryText", () => {
  it("counts only non-hole, unvisited cells", () => {
    const view = state({ visited: [true, false, false, false] });
    expect(tilesRemaining(view)).toBe(2); // cells 1,2 (non-hole, unvisited); 3 is a hole
  });

  it("boardSummaryText names position, material, and remaining count", () => {
    const view = state({ pos: 0, visited: [true, false, false, false] });
    expect(boardSummaryText(view)).toBe("row 1 column 1, on a crumbling tile. 2 tiles left.");
  });

  it("boardSummaryText on stone says 'on stone'", () => {
    const view = state({ pos: 1, visited: [true, true, false, false] });
    expect(boardSummaryText(view)).toBe("row 1 column 2, on stone. 1 tile left.");
  });

  it("boardSummaryText reports the crossing when nothing remains", () => {
    const view = state({ visited: [true, true, true, false] });
    expect(boardSummaryText(view)).toBe("Floor crossed, row 1 column 1.");
  });
});

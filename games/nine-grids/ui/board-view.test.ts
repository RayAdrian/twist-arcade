import { describe, expect, it } from "vitest";
import type { MicroCell } from "../engine-internal";
import type { NineGridsState } from "../engine";
import { boardName, boardSummaryText, buildCellPresentations, closedReasonLabel, glyphFor, positionName } from "./board-view";

function state(cells: readonly MicroCell[], activeBoard: number | null, toMove: 0 | 1 = 0): NineGridsState {
  return { cells, activeBoard, toMove, lastEffects: [] };
}
function emptyBoards(): MicroCell[] {
  return new Array(81).fill(null) as MicroCell[];
}

describe("positionName / boardName", () => {
  it("names all 9 positions distinctly", () => {
    const names = Array.from({ length: 9 }, (_, i) => positionName(i));
    expect(new Set(names).size).toBe(9);
    expect(positionName(0)).toBe("top left");
    expect(positionName(4)).toBe("middle center");
    expect(positionName(7)).toBe("bottom center");
    expect(positionName(8)).toBe("bottom right");
  });

  it("boardName appends ' board'", () => {
    expect(boardName(4)).toBe("middle center board");
  });
});

describe("closedReasonLabel", () => {
  it("names the winner for a won board, and 'full, no winner' for a drawn one", () => {
    expect(closedReasonLabel({ kind: "won", winner: 0 })).toBe("won by X");
    expect(closedReasonLabel({ kind: "won", winner: 1 })).toBe("won by O");
    expect(closedReasonLabel({ kind: "full" })).toBe("full, no winner");
  });
});

describe("buildCellPresentations — global visual order (the load-bearing translation)", () => {
  it("returns exactly 81 cells, iterated in flat 9x9 row-major (globalRow,globalCol) order", () => {
    const view = state(emptyBoards(), null);
    const cells = buildCellPresentations(view);
    expect(cells).toHaveLength(81);
    // First cell is the true top-left of the whole visual grid: board 0, cell 0.
    expect(cells[0]).toMatchObject({ globalRow: 0, globalCol: 0, board: 0, cell: 0 });
    // Second VISUAL column (globalCol=1) is STILL board 0 (board 0 occupies visual cols 0-2),
    // cell 1 — NOT board 1. This is exactly the translation a board-major DOM order would get
    // wrong (it would instead jump straight to board 0 cell 1..8 for the first 9 DOM nodes,
    // which happens to look identical for the FIRST row only — the real proof is globalCol=3
    // below, which board-major order could never produce).
    expect(cells[1]).toMatchObject({ globalRow: 0, globalCol: 1, board: 0, cell: 1 });
    // globalRow=0, globalCol=3: this is the SECOND macro column's top-left cell — board 1
    // (macro row 0, macro col 1), local cell 0. A board-major iteration would place board 1's
    // cells starting at flat index 9, never at index 3.
    const idxR0C3 = cells.find((c) => c.globalRow === 0 && c.globalCol === 3)!;
    expect(idxR0C3).toMatchObject({ board: 1, cell: 0 });
    // The exact visual center of the WHOLE 9x9 grid (globalRow=4, globalCol=4) must be board 4
    // (center macro board), cell 4 (center micro cell) — the one cell every Ultimate-TTT board
    // agrees is "the center of the center."
    const trueCenter = cells.find((c) => c.globalRow === 4 && c.globalCol === 4)!;
    expect(trueCenter).toMatchObject({ board: 4, cell: 4, isBoardCenter: true });
    // Bottom-right of the whole grid: board 8, cell 8.
    const bottomRight = cells.find((c) => c.globalRow === 8 && c.globalCol === 8)!;
    expect(bottomRight).toMatchObject({ board: 8, cell: 8 });
  });

  it("every (board, cell) pair 0..8 x 0..8 appears exactly once across the 81 presentations", () => {
    const view = state(emptyBoards(), null);
    const cells = buildCellPresentations(view);
    const seen = new Set<string>();
    for (const c of cells) seen.add(`${c.board}-${c.cell}`);
    expect(seen.size).toBe(81);
  });
});

describe("buildCellPresentations — confinement flags and accessible names", () => {
  it("confined state: the active board's empty cells say 'your move here'; other open boards say where to play", () => {
    const view = state(emptyBoards(), 4); // confined to board 4
    const cells = buildCellPresentations(view);
    const inActive = cells.find((c) => c.board === 4 && c.cell === 0)!;
    expect(inActive.isActiveBoard).toBe(true);
    expect(inActive.isFreeMoveEligible).toBe(false);
    expect(inActive.accessibleName).toContain("Your move here");

    const elsewhere = cells.find((c) => c.board === 0 && c.cell === 0)!;
    expect(elsewhere.isActiveBoard).toBe(false);
    expect(elsewhere.accessibleName).toContain("Play in the middle center board");
  });

  it("free-move state: every open board's empty cells are flagged eligible and say 'any open board'", () => {
    const view = state(emptyBoards(), null);
    const cells = buildCellPresentations(view);
    const someCell = cells.find((c) => c.board === 2 && c.cell === 3)!;
    expect(someCell.isActiveBoard).toBe(false);
    expect(someCell.isFreeMoveEligible).toBe(true);
    expect(someCell.accessibleName).toContain("Free move — any open board");
  });

  it("a closed (won) board's cells are never active/eligible and name the winner", () => {
    const cells81 = emptyBoards();
    // Board 0 won by X (top row of board 0).
    cells81[0] = 0;
    cells81[1] = 0;
    cells81[2] = 0;
    const view = state(cells81, null);
    const presentations = buildCellPresentations(view);
    const inClosed = presentations.find((c) => c.board === 0 && c.cell === 4)!; // still-empty cell
    expect(inClosed.boardStatus).toEqual({ kind: "won", winner: 0 });
    expect(inClosed.isActiveBoard).toBe(false);
    expect(inClosed.isFreeMoveEligible).toBe(false);
    expect(inClosed.accessibleName).toBe("top left board, middle center. Closed — won by X.");
    expect(inClosed.isBoardCenter).toBe(true); // local cell 4 is always the board's own center
  });

  it("an occupied open cell reports its mark, not emptiness", () => {
    const cells81 = emptyBoards();
    cells81[4] = 1; // board 0, cell 4 = O
    const view = state(cells81, null);
    const presentations = buildCellPresentations(view);
    const marked = presentations.find((c) => c.board === 0 && c.cell === 4)!;
    expect(marked.mark).toBe(1);
    expect(marked.accessibleName).toBe("top left board, middle center. O.");
  });
});

describe("glyphFor", () => {
  it("0 => X, 1 => O", () => {
    expect(glyphFor(0)).toBe("X");
    expect(glyphFor(1)).toBe("O");
  });
});

describe("boardSummaryText", () => {
  it("reports won counts, open count, and current confinement", () => {
    const view = state(emptyBoards(), 3);
    const text = boardSummaryText(view);
    expect(text).toContain("X has won 0 boards");
    expect(text).toContain("O has won 0");
    expect(text).toContain("9 boards still open");
    expect(text).toContain("confined to the middle left board");
  });

  it("free-move confinement phrase", () => {
    const view = state(emptyBoards(), null);
    expect(boardSummaryText(view)).toContain("free move — play in any open board");
  });
});

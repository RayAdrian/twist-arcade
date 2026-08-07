// @vitest-environment jsdom
//
// games/nine-grids/ui/Board.test.tsx — TDD (CLAUDE.md §3) for the Board component itself. Every
// pure computation (confinement flags, accessible names, global cell order) is already covered
// DOM-free by board-view.test.ts; this file proves Board wires that data onto real shell `Cell`s
// correctly: 81 gridcells in the right place, disabled state from `legal`, the grayscale-
// readable structural markers (data-confinement / data-board-status — texture/weight, never hue
// alone), and the reduced-motion send-pulse gate, including a PLANTED violation proving a test
// actually fails if that gate is deleted (CLAUDE.md standing instruction; Fadeout's own
// reduced-motion gate was once removed without breaking a single test — see this file's own
// "PLANTED VIOLATION" block below for the real, executed proof, not a hypothetical).
//
// Rendered inside a real <BoardShell rows={9} cols={9}> — Cell's own useBoardContext() throws
// without one (packages/shell/test/board-shell.test.tsx's own fixture convention).

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BoardShell } from "@twist-arcade/shell";
import type { Rng } from "@twist-arcade/engine";
import { nineGrids, type NineGridsMove, type NineGridsState } from "../engine";
import { Board } from "./Board";

afterEach(() => cleanup());

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] };

function play(moves: NineGridsMove[]): NineGridsState {
  let state = nineGrids.setup(2, NO_OP_RNG);
  for (const move of moves) {
    const mover = state.toMove;
    state = nineGrids.apply(state, new Map([[mover, move]]), NO_OP_RNG);
  }
  return state;
}

function renderBoard(view: NineGridsState, opts?: { reducedMotion?: boolean }) {
  const legal = nineGrids.legalMoves(view, view.toMove);
  return render(
    <BoardShell rows={9} cols={9} disabled={false} onCellAction={() => {}} boardLabel="Nine Grids board">
      <Board view={view} legal={legal} onMove={() => {}} seat={view.toMove} prefs={{ reducedMotion: opts?.reducedMotion ?? false, theme: "light" }} />
    </BoardShell>
  );
}

function cellEl(board: number, cell: number): HTMLElement {
  const id = JSON.stringify({ board, cell });
  const el = document.getElementById(`cell-${id}`);
  if (!el) throw new Error(`no cell for board ${board} cell ${cell}`);
  return el;
}

describe("Board — 81 gridcells, correctly wired", () => {
  it("renders exactly 81 gridcells, ids matching moveToCellId({board,cell})", () => {
    renderBoard(play([]));
    expect(screen.getAllByRole("gridcell")).toHaveLength(81);
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) expect(cellEl(b, c)).not.toBeNull();
    }
  });

  it("opening position: all 81 cells legal (free move, no confinement)", () => {
    renderBoard(play([]));
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) expect(cellEl(b, c)).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("SEND-002: after X plays (4,7), only board 7's 9 cells are enabled — the other 72 are disabled", () => {
    const state = play([{ board: 4, cell: 7 }]);
    renderBoard(state);
    for (let c = 0; c < 9; c++) expect(cellEl(7, c)).not.toHaveAttribute("aria-disabled", "true");
    for (let b = 0; b < 9; b++) {
      if (b === 7) continue;
      for (let c = 0; c < 9; c++) expect(cellEl(b, c)).toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("Board — confinement is carried by BORDER STYLE, not disabled-state alone (SEND-011/A11Y-005, grayscale-safe)", () => {
  it("the active (confined) board's open cells are marked data-confinement=active; all other open boards are 'elsewhere'", () => {
    const state = play([{ board: 4, cell: 7 }]); // confined to board 7
    renderBoard(state);
    const activeFace = cellEl(7, 0).querySelector("[data-confinement]")!;
    expect(activeFace).toHaveAttribute("data-confinement", "active");
    const elsewhereFace = cellEl(0, 0).querySelector("[data-confinement]")!;
    expect(elsewhereFace).toHaveAttribute("data-confinement", "elsewhere");
  });

  it("a free-move state (activeBoard null) marks every OPEN board's cells data-confinement=free — visibly different from 'active', not merely inferable from enabled state", () => {
    // S1: X(0,1) O(1,0) X(0,2) O(2,0) X(0,0) — wins board 0 AND sends O to the just-closed
    // board 0 -> free move (docs/tests/nine-grids.md Appendix A, script S1).
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
      { board: 0, cell: 0 },
    ]);
    expect(state.activeBoard).toBeNull();
    renderBoard(state);
    const openBoardFace = cellEl(3, 0).querySelector("[data-confinement]")!;
    expect(openBoardFace).toHaveAttribute("data-confinement", "free");
    // Free =/= active: the two states must render DIFFERENT data-confinement values, not the
    // same value under two different names.
    expect(openBoardFace.getAttribute("data-confinement")).not.toBe("active");
  });
});

describe("Board — closed sub-boards: static, hue-independent treatment (WIN-008, grayscale-screenshot gate)", () => {
  it("a board won by X shows data-board-status=won-0 on every one of its 9 cells, and a macro-scale glyph at its OWN center cell (board cell 4) regardless of which cell completed the line", () => {
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
      { board: 0, cell: 0 }, // completes board 0's top row (cells 0,1,2) — center cell (4) untouched
    ]);
    renderBoard(state);
    for (let c = 0; c < 9; c++) {
      const face = cellEl(0, c).querySelector("[data-board-status]")!;
      expect(face).toHaveAttribute("data-board-status", "won-0");
    }
    // Macro glyph lives at the board's center cell — glyph identity (X), not color, per WIN-008.
    const centerFace = cellEl(0, 4);
    expect(centerFace).toHaveTextContent("X");
  });

  it("a full/drawn board (no winner) shows data-board-status=full — distinct from BOTH won-0 and won-1, no glyph", () => {
    // Hand-built drawn board via decode, mirroring the test plan's Appendix B `A` fixture:
    // [0,1,0,0,1,1,1,0,0] — full, no three-in-a-row for either player.
    const drawnBoard = [0, 1, 0, 0, 1, 1, 1, 0, 0];
    const cells = [...drawnBoard, ...new Array(72).fill(null)];
    const state = nineGrids.decode(JSON.stringify({ cells, activeBoard: null, toMove: 1 }));
    renderBoard(state);
    for (let c = 0; c < 9; c++) {
      const face = cellEl(0, c).querySelector("[data-board-status]")!;
      expect(face).toHaveAttribute("data-board-status", "full");
    }
    const centerFace = cellEl(0, 4);
    expect(centerFace).not.toHaveTextContent("X");
    expect(centerFace).not.toHaveTextContent("O");
  });

  it("a closed board's cells are never legal, regardless of activeBoard (FREE-001: empty cells of a won-not-full board stay illegal)", () => {
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
      { board: 0, cell: 0 },
      { board: 5, cell: 0 }, // O sent to closed board 0 -> free move (S1b)
    ]);
    renderBoard(state);
    // Board 0 has 6 still-empty cells (3,4,5,6,7,8) — every one must stay disabled even though
    // the mover is in a free-move state (activeBoard null) that otherwise enables open boards.
    for (const c of [3, 4, 5, 6, 7, 8]) {
      expect(cellEl(0, c)).toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("Board — accessible names surface the send/confinement facts non-visually (A11Y-005/006)", () => {
  it("a cell outside the active board states WHERE to play, not just that it's disabled", () => {
    const state = play([{ board: 4, cell: 7 }]); // confined to board 7
    renderBoard(state);
    expect(cellEl(0, 0)).toHaveAttribute("aria-label", expect.stringContaining("Play in the bottom center board"));
  });

  it("a cell in a free-move-eligible open board states 'any open board'", () => {
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
      { board: 0, cell: 0 },
    ]);
    renderBoard(state);
    expect(cellEl(3, 0)).toHaveAttribute("aria-label", expect.stringContaining("Free move — any open board"));
  });

  it("a closed board's cell names the winner", () => {
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
      { board: 0, cell: 0 },
    ]);
    renderBoard(state);
    expect(cellEl(0, 4)).toHaveAttribute("aria-label", expect.stringContaining("Closed — won by X"));
  });
});

describe("Board — the one-shot 'send' pulse (C5: restates the static border fact, never the sole carrier; reduced motion drops it)", () => {
  // Keyed by a per-PLY token (`view.lastEffects`), NOT a ref comparing this render to the last
  // one — see Board.tsx's module doc for the real, observed browser bug (a second, unrelated
  // React commit — `botThinking` landing — erased a ref-based flag before paint) that motivated
  // this design. Consequence, intentional and documented here: `hasMoved` (and therefore the
  // pulse) is a property of the STATE (`lastEffects` non-empty), not of "did THIS component
  // instance personally witness the transition" — the only state where it is guaranteed silent
  // is the true opening position, never reachable mid-game. A resumed persisted game (page
  // reload) mounting into a non-opening state legitimately replays the pulse once on load; this
  // is a decorative, C5-compliant restatement (the border style already shows the same fact
  // statelessly), never the sole carrier of information — an accepted, minor cosmetic tradeoff,
  // not a defect.
  it("never pulses at the true opening position (lastEffects still empty)", () => {
    renderBoard(play([])); // opening position, activeBoard null, every open board "free"
    const face = cellEl(0, 0).querySelector("[data-confinement]") as HTMLElement;
    expect(face.style.animation).toBe("");
  });

  it("pulses the newly-active board's cells the render right after a send, when motion is allowed", () => {
    let state = play([{ board: 4, cell: 7 }]); // confined to 7
    const { rerender } = renderBoard(state);
    state = nineGrids.apply(state, new Map([[state.toMove, { board: 7, cell: 3 }]]), NO_OP_RNG); // -> confined to 3
    const legal = nineGrids.legalMoves(state, state.toMove);
    rerender(
      <BoardShell rows={9} cols={9} disabled={false} onCellAction={() => {}} boardLabel="Nine Grids board">
        <Board view={state} legal={legal} onMove={() => {}} seat={state.toMove} prefs={{ reducedMotion: false, theme: "light" }} />
      </BoardShell>
    );
    const newActiveFace = cellEl(3, 0).querySelector("[data-confinement]") as HTMLElement;
    expect(newActiveFace).toHaveAttribute("data-confinement", "active");
    expect(newActiveFace.style.animation).toContain("ng-send-pulse");
  });

  // PLANTED VIOLATION (CLAUDE.md standing instruction) — ACTUALLY EXECUTED: temporarily removed
  // `!reducedMotion &&` from Board.tsx's `pulse` expression (CellFace) so the animation would
  // apply regardless of the reduced-motion preference, then re-ran
  // `pnpm vitest run ui/Board.test.tsx`. Real observed output: this exact test failed —
  //   AssertionError: expected 'ng-send-pulse 300ms cubic-bezier(0,0,0.2,1) 1' to be ''
  // (the pulse was present when it should have been absent). Restored via `cp` from a pre-plant
  // backup and re-ran: all tests in this file pass again (`diff` against the backup: identical).
  it("does NOT pulse under reduced motion — the SAME send, motion suppressed", () => {
    let state = play([{ board: 4, cell: 7 }]);
    const { rerender } = renderBoard(state, { reducedMotion: true });
    state = nineGrids.apply(state, new Map([[state.toMove, { board: 7, cell: 3 }]]), NO_OP_RNG);
    const legal = nineGrids.legalMoves(state, state.toMove);
    rerender(
      <BoardShell rows={9} cols={9} disabled={false} onCellAction={() => {}} boardLabel="Nine Grids board">
        <Board view={state} legal={legal} onMove={() => {}} seat={state.toMove} prefs={{ reducedMotion: true, theme: "light" }} />
      </BoardShell>
    );
    const newActiveFace = cellEl(3, 0).querySelector("[data-confinement]") as HTMLElement;
    expect(newActiveFace).toHaveAttribute("data-confinement", "active"); // the STATIC fact still holds
    expect(newActiveFace.style.animation).toBe(""); // but no animation plays
  });
});

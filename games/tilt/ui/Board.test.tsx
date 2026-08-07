// @vitest-environment jsdom
//
// games/tilt/ui/Board.test.tsx — TDD (CLAUDE.md §3) for the Board component itself. Pure
// computation (drop-target selection, accessible names) is already covered DOM-free by
// board-view.test.ts; this file proves Board wires that data onto real shell `Cell`s correctly:
// SIZE*SIZE gridcells, exactly one enabled drop target per non-full column, the grayscale-
// readable just-moved marker (data-just-moved — attribute/outline, never hue alone), and the
// reduced-motion settle-pulse gate, including a PLANTED violation proving a test actually fails
// if that gate is deleted (CLAUDE.md standing instruction; mirrors Nine Grids' own
// "PLANTED VIOLATION" block for its send-pulse, games/nine-grids/ui/Board.test.tsx).
//
// Rendered inside a real <BoardShell rows={SIZE} cols={SIZE}> — Cell's own useBoardContext()
// throws without one.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BoardShell } from "@twist-arcade/shell";
import type { Rng } from "@twist-arcade/engine";
import { SIZE, tilt, toMoveOf, type TiltMove, type TiltState } from "../engine";
import { Board } from "./Board";

afterEach(() => cleanup());

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] };

function play(moves: TiltMove[]): TiltState {
  let state = tilt.setup(2, NO_OP_RNG);
  for (const move of moves) {
    const mover = toMoveOf(state.grid);
    state = tilt.apply(state, new Map([[mover, move]]), NO_OP_RNG);
  }
  return state;
}

function renderBoard(view: TiltState, opts?: { reducedMotion?: boolean }) {
  const seat = toMoveOf(view.grid);
  const legal = tilt.legalMoves(view, seat);
  return render(
    <BoardShell rows={SIZE} cols={SIZE} disabled={false} onCellAction={() => {}} boardLabel="Tilt board">
      <Board
        view={view}
        legal={legal}
        onMove={() => {}}
        seat={seat}
        prefs={{ reducedMotion: opts?.reducedMotion ?? false, theme: "light" }}
      />
    </BoardShell>
  );
}

function discCellEl(row: number, col: number): HTMLElement {
  const el = document.getElementById(`cell-tilt-disc-${row}-${col}`);
  if (!el) throw new Error(`no decorative cell for row ${row} col ${col}`);
  return el;
}

function dropCellEl(column: number): HTMLElement {
  const id = JSON.stringify({ column });
  const el = document.getElementById(`cell-${id}`);
  if (!el) throw new Error(`no drop-target cell for column ${column}`);
  return el;
}

describe("Board — SIZE*SIZE gridcells, correctly wired", () => {
  it(`renders exactly ${SIZE * SIZE} gridcells on the opening position`, () => {
    const { getAllByRole } = renderBoard(play([]));
    expect(getAllByRole("gridcell")).toHaveLength(SIZE * SIZE);
  });

  it("exactly one enabled drop-target cell per column on the opening position, at the bottom row", () => {
    renderBoard(play([]));
    for (let col = 0; col < SIZE; col++) {
      const cell = dropCellEl(col);
      expect(cell).toHaveAttribute("aria-rowindex", String(SIZE)); // 1-indexed bottom row
      expect(cell).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("a decorative (non-drop-target) cell is always disabled and never a real move id", () => {
    renderBoard(play([]));
    const topLeft = discCellEl(0, 0);
    expect(topLeft).toHaveAttribute("aria-disabled", "true");
  });

  it("dropping in a column moves that column's drop-target cell up one row", () => {
    const state = play([{ column: 2 }]);
    renderBoard(state);
    const cell = dropCellEl(2);
    expect(cell).toHaveAttribute("aria-rowindex", String(SIZE - 1)); // one row above the bottom
  });
});

describe("Board — just-moved markers (plan §6.1, grayscale-safe, both motion preferences)", () => {
  it("no cell is marked just-moved before any tilt has fired", () => {
    const state = play([{ column: 0 }]);
    renderBoard(state);
    const bottom = discCellEl(SIZE - 1, 0);
    expect(bottom.querySelector("[data-just-moved]")).toBeNull();
  });

  it("every disc a re-fall displaces is marked data-just-moved, present under FULL motion", () => {
    // The hand-verified 4-ply fixture from engine.test.ts: col0,col0,col1,col0 — 4th ply tilts,
    // and (per that fixture's trace) discs land at rows5/6 col0 and row6 col1/col2, all having
    // moved from their pre-compaction positions.
    const state = play([{ column: 0 }, { column: 0 }, { column: 1 }, { column: 0 }]);
    renderBoard(state, { reducedMotion: false });
    const marked = document.querySelectorAll("[data-just-moved]");
    expect(marked.length).toBeGreaterThan(0);
  });

  it("the SAME markers are present under REDUCED motion — the static answer to 'what did the tilt do'", () => {
    const state = play([{ column: 0 }, { column: 0 }, { column: 1 }, { column: 0 }]);
    renderBoard(state, { reducedMotion: true });
    const marked = document.querySelectorAll("[data-just-moved]");
    expect(marked.length).toBeGreaterThan(0);
  });
});

describe("Board — the one-shot settle pulse (C5: restates the static marker, never the sole carrier; reduced motion drops it)", () => {
  it("pulses under full motion when a disc just moved", () => {
    const state = play([{ column: 0 }, { column: 0 }, { column: 1 }, { column: 0 }]);
    renderBoard(state, { reducedMotion: false });
    const marked = document.querySelector("[data-just-moved]") as HTMLElement;
    expect(marked.style.animation).toContain("tilt-settle-pulse");
  });

  // PLANTED VIOLATION (CLAUDE.md standing instruction) — ACTUALLY EXECUTED: temporarily removed
  // `!prefs.reducedMotion &&` from Board.tsx's `pulse` expression so the animation would apply
  // regardless of the reduced-motion preference, then re-ran `pnpm vitest run ui/Board.test.tsx`.
  // Real observed output: this exact test failed —
  //   AssertionError: expected 'tilt-settle-pulse 220ms cubic-bezier(0,0,0.2,1) 1' to be ''
  // (the pulse was present when it should have been absent). Reverted; all tests in this file
  // pass again.
  it("does NOT pulse under reduced motion — the marker itself still holds", () => {
    const state = play([{ column: 0 }, { column: 0 }, { column: 1 }, { column: 0 }]);
    renderBoard(state, { reducedMotion: true });
    const marked = document.querySelector("[data-just-moved]") as HTMLElement;
    expect(marked).toHaveAttribute("data-just-moved", "true"); // the STATIC fact still holds
    expect(marked.style.animation).toBe(""); // but no animation plays
  });
});

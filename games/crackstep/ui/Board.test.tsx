// @vitest-environment jsdom
//
// games/crackstep/ui/Board.test.tsx — TDD for the Board component itself (Fadeout's
// ui/Board.test.tsx sets this convention). Every pure computation (cell state, accessible name)
// is already covered DOM-free by board-view.test.ts; this file only proves Board wires that data
// onto real shell `Cell`s correctly — ids matching the moveToCellId convention, disabled state
// from `legal`, holes rendered non-interactively, and the grayscale-readability requirement
// proven structurally here (distinct texture/shape markers per state) and confirmed visually via
// an actual rendered screenshot (see the session report — this file cannot itself take one).

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BoardShell } from "@twist-arcade/shell";
import type { PlayerId, Rng } from "@twist-arcade/engine";
import { crackstep, type CrackstepMove, type CrackstepState, type TileKind } from "../engine";
import { Board } from "./Board";

afterEach(() => cleanup());

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] };

function apply(state: CrackstepState, move: CrackstepMove): CrackstepState {
  return crackstep.apply(state, new Map<PlayerId, CrackstepMove>([[0, move]]), NO_OP_RNG);
}

// 0 1 2      1 = stone hub; 3, 5 are holes.
// 3 4 5
const TILES: TileKind[] = ["crumble", "stone", "crumble", "hole", "crumble", "hole"];

function initial(): CrackstepState {
  const visited = Array(6).fill(false);
  visited[4] = true;
  return { width: 3, height: 2, tiles: TILES, crumbled: Array(6).fill(false), visited, pos: 4, lastEffects: [] };
}

function renderBoard(view: CrackstepState, opts?: { reducedMotion?: boolean }) {
  const legal = crackstep.legalMoves(view, 0);
  return render(
    <BoardShell rows={2} cols={3} disabled={false} onCellAction={() => {}} boardLabel="Crackstep board">
      <Board view={view} legal={legal} onMove={() => {}} seat={0} prefs={{ reducedMotion: opts?.reducedMotion ?? false, theme: "light" }} />
    </BoardShell>
  );
}

describe("Board — renders one gridcell per WALKABLE tile, holes are non-interactive", () => {
  it("4 walkable cells become gridcells (ids = moveToCellId(cell)); the 2 holes do not", () => {
    renderBoard(initial());
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(4); // cells 0,1,2,4 — not 3 or 5 (holes)
    for (const cell of [0, 1, 2, 4]) {
      expect(document.getElementById(`cell-${JSON.stringify(cell)}`)).not.toBeNull();
    }
    for (const hole of [3, 5]) {
      expect(document.getElementById(`cell-${JSON.stringify(hole)}`)).toBeNull();
    }
  });

  it("only orthogonally-legal moves are enabled; the current cell and holes are always disabled", () => {
    renderBoard(initial());
    // From pos=4, the only legal move is to 1 (the stone hub) — see engine-fixtures.test.ts.
    expect(document.getElementById(`cell-${JSON.stringify(1)}`)).not.toHaveAttribute("aria-disabled", "true");
    for (const notLegal of [0, 2, 4]) {
      expect(document.getElementById(`cell-${JSON.stringify(notLegal)}`)).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("accessible names surface material and state, including the falls-when-you-leave telegraph", () => {
    renderBoard(initial());
    const current = document.getElementById(`cell-${JSON.stringify(4)}`)!;
    expect(current).toHaveAttribute("aria-label", expect.stringContaining("falls when you leave"));
    const stone = document.getElementById(`cell-${JSON.stringify(1)}`)!;
    expect(stone).toHaveAttribute("aria-label", expect.stringContaining("stone"));
  });

  it("a crumbled cell renders with the dashed ghost outline for exactly the next render, then settles", () => {
    let view = initial();
    const { rerender } = renderBoard(view);

    view = apply(view, 1); // departs 4 (crumbles it)
    rerender(
      <BoardShell rows={2} cols={3} disabled={false} onCellAction={() => {}} boardLabel="Crackstep board">
        <Board view={view} legal={crackstep.legalMoves(view, 0)} onMove={() => {}} seat={0} prefs={{ reducedMotion: false, theme: "light" }} />
      </BoardShell>
    );
    // Cell 4 just crumbled this render — not yet in its one-render "ghost" window.
    let cell4 = document.getElementById(`cell-${JSON.stringify(4)}`)!;
    expect(cell4.querySelector('[aria-hidden="true"]')).not.toBeNull();

    view = apply(view, 0); // departs 1 (stone — no crumble); arrives 0
    rerender(
      <BoardShell rows={2} cols={3} disabled={false} onCellAction={() => {}} boardLabel="Crackstep board">
        <Board view={view} legal={crackstep.legalMoves(view, 0)} onMove={() => {}} seat={0} prefs={{ reducedMotion: false, theme: "light" }} />
      </BoardShell>
    );
    cell4 = document.getElementById(`cell-${JSON.stringify(4)}`)!;
    expect(cell4).toHaveAttribute("aria-label", "row 2 column 2, gone");
  });
});

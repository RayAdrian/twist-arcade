// @vitest-environment jsdom
//
// games/crackstep/ui/materials-consistency.test.tsx — the regression guard for a defect class
// this codebase keeps getting bitten by: two independent declarations of one fact, drifting
// apart. Board.tsx (the actual tile render) and SidePanel.tsx (the "Floor left" legend) both
// need Crackstep's four material colors; they now both import the single MATERIAL_COLORS
// constant from ./materials, but an import alone doesn't prevent a future hand-edit to either
// file's own literal — only cross-rendering both components and comparing their ACTUAL painted
// colors does. This test renders a board that exercises all four material states (wood/stone/
// rubble/hole) alongside the legend and asserts, pixel for pixel, that they agree.
//
// Prove-it note: this test is meaningless unless it can fail. Temporarily change ONE literal in
// either Board.tsx or SidePanel.tsx (bypassing MATERIAL_COLORS) and this suite goes red on the
// corresponding row — see the session report for the actual failure transcript.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BoardShell } from "@twist-arcade/shell";
import type { CrackstepState, TileKind } from "../engine";
import { Board } from "./Board";
import { SidePanel } from "./SidePanel";

afterEach(() => cleanup());

// 0 1 2 3 4      0 = stone, 1 = hole, 2 = already-crumbled ("rubble"),
//                3 = wooden/not-yet-crossed ("wood"), 4 = current position (unused below).
const TILES: TileKind[] = ["stone", "hole", "crumble", "crumble", "crumble"];

function view(): CrackstepState {
  return {
    width: 5,
    height: 1,
    tiles: TILES,
    crumbled: [false, false, true, false, false],
    visited: [false, false, true, false, true],
    pos: 4,
    lastEffects: [],
  };
}

function renderBoard(v: CrackstepState) {
  return render(
    <BoardShell rows={1} cols={5} disabled={false} onCellAction={() => {}} boardLabel="Crackstep board">
      <Board view={v} legal={[]} onMove={() => {}} seat={0} prefs={{ reducedMotion: false, theme: "light" }} />
    </BoardShell>
  );
}

function renderSidePanel(v: CrackstepState) {
  return render(<SidePanel view={v} legal={[]} onMove={() => {}} seat={0} prefs={{ reducedMotion: false, theme: "light" }} />);
}

/** The outer, aria-hidden material div Board.tsx's TileFace renders for a given cell — the
 *  first `[aria-hidden="true"]` element in that cell's subtree is always this outer div (the
 *  crack overlay / dust puff / emoji children TileFace nests inside it only ever appear for the
 *  CURRENT cell, which this test deliberately never queries). */
function boardCellColor(cell: number): string {
  const cellEl = document.getElementById(`cell-${JSON.stringify(cell)}`);
  if (!cellEl) throw new Error(`cell ${cell} not found`);
  const materialEl = cellEl.querySelector('[aria-hidden="true"]');
  if (!materialEl) throw new Error(`cell ${cell} has no material div`);
  return getComputedStyle(materialEl).backgroundColor;
}

function legendSwatchColor(label: string): string {
  const row = screen.getByText(label).closest("li");
  if (!row) throw new Error(`legend row "${label}" not found`);
  const swatch = row.querySelector('[aria-hidden="true"]');
  if (!swatch) throw new Error(`legend row "${label}" has no swatch`);
  return getComputedStyle(swatch).backgroundColor;
}

describe("Board and SidePanel material colors never diverge", () => {
  it("wood (crumbling, cell 3) matches the legend's 'wood' swatch", () => {
    renderBoard(view());
    const boardColor = boardCellColor(3);
    renderSidePanel(view());
    expect(boardColor).toBe(legendSwatchColor("wood"));
  });

  it("stone (cell 0) matches the legend's 'stone' swatch", () => {
    renderBoard(view());
    const boardColor = boardCellColor(0);
    renderSidePanel(view());
    expect(boardColor).toBe(legendSwatchColor("stone"));
  });

  it("rubble (already-crumbled, cell 2) matches the legend's 'rubble' swatch", () => {
    renderBoard(view());
    const boardColor = boardCellColor(2);
    renderSidePanel(view());
    expect(boardColor).toBe(legendSwatchColor("rubble"));
  });

  it("hole (cell 1, rendered outside any Cell) matches the legend's 'hole' swatch", () => {
    renderBoard(view());
    // Holes render as a plain non-interactive div, never a shell Cell (Board.tsx's own comment:
    // "holes are never a legal target... a flat, non-interactive pit") — so it's a DIRECT child
    // of BoardShell's `role="row"` wrapper, unlike every other material div (nested one level
    // deeper, inside a `role="gridcell"` Cell). That structural difference, not render order,
    // is what uniquely picks out the hole div here.
    const boardEl = screen.getByRole("grid");
    const holeEl = boardEl.querySelector('[role="row"] > [aria-hidden="true"]');
    if (!holeEl) throw new Error("hole div not found");
    const boardColor = getComputedStyle(holeEl).backgroundColor;
    renderSidePanel(view());
    expect(boardColor).toBe(legendSwatchColor("hole"));
  });
});

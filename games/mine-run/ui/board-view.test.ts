// games/mine-run/ui/board-view.test.ts — TDD (CLAUDE.md §3) for the pure presentation logic
// behind Board.tsx/presentation.ts. No React/jsdom here: everything a screen reader or a
// sighted layout needs (revealed/exploded/hidden classification, accessible names, row/col
// naming) is a pure function of MineRunView, tested before any component wires it to a Cell —
// mirrors games/fadeout/ui/board-view.test.ts's own split.

import { describe, expect, it } from "vitest";
import { rngForSetup, rngFor } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import type { MineRunState, MineRunView } from "../engine";
import {
  boardPositionName,
  buildCellPresentations,
  hasProvenSafeMove,
  mineCountSummary,
} from "./board-view";

const WIDTH = 5;
const HEIGHT = 5;

function setupSmall(seed: string, mines = 4, budget = 15) {
  return createMineRun({ width: WIDTH, height: HEIGHT, mines, budget });
}

function firstView(seed: string): { engine: ReturnType<typeof setupSmall>; view: MineRunView; state: MineRunState } {
  const engine = setupSmall(seed);
  const state = engine.setup(1, rngForSetup(seed));
  return { engine, state, view: engine.playerView(state, 0) };
}

describe("boardPositionName — 'Row R, column C' 1-indexed wording (plan §8.4)", () => {
  it("names cell 0 as Row 1, column 1", () => {
    expect(boardPositionName(0, WIDTH)).toBe("Row 1, column 1");
  });

  it("names the wrap point of a row correctly (row-major indexing)", () => {
    expect(boardPositionName(5, WIDTH)).toBe("Row 2, column 1"); // WIDTH=5: cell 5 starts row 2
    expect(boardPositionName(6, WIDTH)).toBe("Row 2, column 2");
  });

  it("names every cell of a small board distinctly", () => {
    const names = Array.from({ length: WIDTH * HEIGHT }, (_, i) => boardPositionName(i, WIDTH));
    expect(new Set(names).size).toBe(WIDTH * HEIGHT);
  });
});

describe("buildCellPresentations — revealed/hidden/exploded classification and accessible names", () => {
  it("every cell in the opening region is revealed, with a numeral and 'Revealed, N.' accessible name", () => {
    const { view } = firstView("board-view-a");
    const revealedCells = Object.keys(view.cells).map(Number);
    expect(revealedCells.length).toBeGreaterThan(0);
    const presentations = buildCellPresentations(view);
    for (const cell of revealedCells) {
      const p = presentations[cell]!;
      expect(p.revealed).toBe(true);
      expect(p.exploded).toBe(false);
      expect(typeof p.n).toBe("number");
      expect(p.accessibleName).toBe(`${boardPositionName(cell, view.width)}. Revealed, ${p.n}.`);
    }
  });

  it("every unrevealed cell reads 'Hidden.' and carries no numeral", () => {
    const { view } = firstView("board-view-a");
    const revealedSet = new Set(Object.keys(view.cells).map(Number));
    const presentations = buildCellPresentations(view);
    for (let c = 0; c < view.width * view.height; c++) {
      if (revealedSet.has(c)) continue;
      const p = presentations[c]!;
      expect(p.revealed).toBe(false);
      expect(p.exploded).toBe(false);
      expect(p.n).toBeUndefined();
      expect(p.accessibleName).toBe(`${boardPositionName(c, view.width)}. Hidden.`);
    }
  });

  it("an exploded mine reads 'Exploded mine.' and carries no numeral", () => {
    // Drive the engine until we hit a mine (bounded search over a few seeds/cells).
    let hit: { view: MineRunView; cell: number } | undefined;
    for (let seed = 0; seed < 30 && !hit; seed++) {
      const engine = setupSmall(`explode-${seed}`);
      let state = engine.setup(1, rngForSetup(`explode-${seed}`));
      for (let step = 0; step < 20 && engine.status(state).kind === "ongoing"; step++) {
        const legal = engine.legalMoves(state, 0);
        const reveal = legal.find((m) => m.t === "reveal");
        if (!reveal) break;
        const before = new Set(state.mines);
        const wasMine = before.has((reveal as { cell: number }).cell);
        state = engine.apply(state, new Map([[0, reveal]]), rngFor(`explode-${seed}`, step));
        if (wasMine) {
          hit = { view: engine.playerView(state, 0), cell: (reveal as { cell: number }).cell };
          break;
        }
      }
    }
    expect(hit).toBeDefined();
    const presentations = buildCellPresentations(hit!.view);
    const p = presentations[hit!.cell]!;
    expect(p.revealed).toBe(true);
    expect(p.exploded).toBe(true);
    expect(p.n).toBeUndefined();
    expect(p.accessibleName).toBe(`${boardPositionName(hit!.cell, hit!.view.width)}. Exploded mine.`);
  });

  it("returns exactly width*height entries, one per cell, in index order", () => {
    const { view } = firstView("board-view-b");
    const presentations = buildCellPresentations(view);
    expect(presentations).toHaveLength(view.width * view.height);
    presentations.forEach((p, i) => expect(p.cell).toBe(i));
  });
});

describe("mineCountSummary — the always-visible informed-odds HUD line (lens §1.7)", () => {
  it("reports total and exploded mine counts", () => {
    const { view } = firstView("board-view-a");
    expect(mineCountSummary(view)).toBe(`\u{1F4A3} ${view.minesTotal} \u{00B7} ${view.minesExploded} hit`);
  });
});

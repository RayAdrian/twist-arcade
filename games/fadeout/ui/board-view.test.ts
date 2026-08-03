// games/fadeout/ui/board-view.test.ts — TDD (CLAUDE.md §3) for the pure telegraph logic
// behind Board.tsx. No React/jsdom needed here: everything a screen reader/sighted layout
// needs (ageStep, countdown badge, ghost, accessible name) is a pure function of FadeoutState,
// so it's tested in isolation before Board.tsx ever wires it to a Cell.

import { describe, expect, it } from "vitest";
import { createFadeoutEngine } from "../engine";
import type { FadeoutState } from "../engine";
import { FADEOUT_RULESET_CONFIG } from "../manifest";
import {
  boardCellNamePlain,
  boardPositionName,
  buildCellPresentations,
  ghostCellOf,
} from "./board-view";

const engine = createFadeoutEngine(FADEOUT_RULESET_CONFIG);
const cells9 = buildCellPresentations;

function play(cells: number[]): FadeoutState {
  let state = engine.setup(2, { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] });
  for (const cell of cells) {
    const mover = state.toMove;
    state = engine.apply(state, new Map([[mover, { cell }]]), { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] });
  }
  return state;
}

describe("boardPositionName — the 'top left'/'middle center' wording ux-lens §8's example uses", () => {
  it("names all 9 cells distinctly", () => {
    const names = Array.from({ length: 9 }, (_, i) => boardPositionName(i));
    expect(new Set(names).size).toBe(9);
    expect(boardPositionName(0)).toBe("top left");
    expect(boardPositionName(4)).toBe("middle center");
    expect(boardPositionName(7)).toBe("bottom center");
  });
});

describe("boardCellNamePlain — the coarser centre/corner/edge wording textureLine's table uses", () => {
  it("classifies the center, corners, and edges", () => {
    expect(boardCellNamePlain(4)).toBe("center");
    expect(boardCellNamePlain(0)).toBe("corner");
    expect(boardCellNamePlain(2)).toBe("corner");
    expect(boardCellNamePlain(6)).toBe("corner");
    expect(boardCellNamePlain(8)).toBe("corner");
    expect(boardCellNamePlain(1)).toBe("edge");
    expect(boardCellNamePlain(3)).toBe("edge");
  });
});

describe("buildCellPresentations — the telegraph's counting formula (plan §5.1)", () => {
  it("a freshly placed mark is ageStep 0 with no badge (remaining === cap === 3)", () => {
    const state = play([0]); // P0 places at cell 0
    const cells = buildCellPresentations(state);
    const c0 = cells[0]!;
    expect(c0.occupant).toBe(0);
    expect(c0.ageStep).toBe(0);
    expect(c0.countdown).toBeUndefined();
  });

  it("an empty cell has no occupant, ageStep, countdown, or ghost", () => {
    const state = play([0]);
    const empty = cells9(state)[1]!;
    expect(empty.occupant).toBeNull();
    expect(empty.ageStep).toBeUndefined();
    expect(empty.countdown).toBeUndefined();
    expect(empty.ghost).toBeUndefined();
  });

  it("badge appears ONLY at remaining <= 2 (age-2 step), never on a fresh mark", () => {
    // P0: 0, P1: 1, P0: 2, P1: 3 -> P0's mark at cell 0 is now index0/q2 -> remaining = 0+1+(3-2) = 2
    const state = play([0, 1, 2, 3]);
    const cellAt0 = cells9(state)[0]!;
    expect(cellAt0.occupant).toBe(0);
    expect(cellAt0.countdown).toBe(2);
    expect(cellAt0.ageStep).toBe(1);
  });

  it("final turn (remaining === 1) is ageStep 2 with countdown 1", () => {
    // P0: 0,2,4 (q=3, cap reached) ; P1: 1,3,5. Next P0 placement (cell 7, NOT 6 — {2,4,6} is
    // a real winning diagonal and would end the game) pops cell 0 first (remove-first),
    // landing the new front (cell 2) at index0/q3 -> remaining = 0+1+0 = 1.
    const state = play([0, 1, 2, 3, 4, 5, 7]);
    const cellAt2 = cells9(state)[2]!;
    expect(cellAt2.occupant).toBe(0);
    expect(cellAt2.countdown).toBe(1);
    expect(cellAt2.ageStep).toBe(2);
  });

  it("accessible name matches ux-lens §8's exact wording for an imminent mark", () => {
    const state = play([0, 1, 2, 3]);
    const cellAt0 = cells9(state)[0]!;
    expect(cellAt0.accessibleName).toBe("Row 1, column 1. X, fades in 2 turns.");
  });

  it("accessible name singularizes 'turn' at countdown 1", () => {
    const state = play([0, 1, 2, 3, 4, 5, 6]);
    const cellAt2 = cells9(state)[2]!;
    expect(cellAt2.accessibleName).toBe("Row 1, column 3. X, fades in 1 turn.");
  });

  it("accessible name for a non-imminent mark has no pending-change clause", () => {
    const state = play([4]); // P0 (X) moves first
    const cellAt4 = cells9(state)[4]!;
    expect(cellAt4.accessibleName).toBe("Row 2, column 2. X.");
  });

  it("accessible name for an empty cell matches ux-lens §8's exact wording", () => {
    const state = play([0]);
    const empty = cells9(state)[1]!;
    expect(empty.accessibleName).toBe("Row 1, column 2. Empty.");
  });
});

describe("ghostCellOf — the vacated cell, for exactly one ply (view.lastEffects is fully overwritten)", () => {
  it("null when the last move produced no decay", () => {
    const state = play([0]);
    expect(ghostCellOf(state)).toBeNull();
  });

  it("names the (now-empty) cell and departed glyph the instant a decay happens", () => {
    const state = play([0, 1, 2, 3, 4, 5, 7]); // P0's 4th placement pops cell 0
    const ghost = ghostCellOf(state);
    expect(ghost).toEqual({ cell: 0, player: 0 });
    const cells = buildCellPresentations(state);
    expect(cells[0]!.occupant).toBeNull(); // vacated
    expect(cells[0]!.ghost).toBe(0);
  });

  it("disappears on the very next ply (matches 'one turn' — lastEffects is fully overwritten)", () => {
    // By ply 7 BOTH sides are at cap, so every subsequent move overflows SOMEONE (steady
    // state) — there is no continuation where "zero ghosts anywhere" is possible. What "one
    // turn" actually guarantees is narrower and is what this test pins: cell 0's OWN ghost
    // (from P0's decay above) is gone by the next ply, even though that next ply produces a
    // fresh ghost of its own (P1's first overflow, cell 1) — lastEffects is fully overwritten
    // per apply, not accumulated.
    const state = play([0, 1, 2, 3, 4, 5, 7, 8]); // P1's 4th placement pops cell 1
    expect(ghostCellOf(state)).toEqual({ cell: 1, player: 1 });
    const cells = buildCellPresentations(state);
    expect(cells[0]!.ghost).toBeUndefined(); // the OLD (cell 0) ghost is gone
    expect(cells[1]!.ghost).toBe(1); // replaced by the new one
  });
});

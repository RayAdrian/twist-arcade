// games/mine-run/test/engine-fixtures.test.ts
//
// TDD anchor (docs/plans/mine-run.md §10): "Hand-built 5x5 fixture layout: exact numbers,
// flood extent, streak arithmetic (streak of 4 banks 10), wipe zeroes streak but not vault,
// exploded cell revealed and permanent." Plus the full-clear and budget-exhaustion terminal
// anchors ("full-clear terminal on a tiny fixture"; "budget exhaustion auto-banks").
//
// States are hand-constructed directly (bypassing setup()/rng) so mine positions are known
// exactly and every number below is hand-computed against board.ts's neighbor function
// (already unit-tested in board.test.ts), not against the engine's own generation.

import { describe, expect, it } from "vitest";
import { createMineRun } from "../engine";
import type { MineRunState } from "../engine";

function baseState(mines: number[], revealsLeft: number): MineRunState {
  return {
    mines: [...mines].sort((a, b) => a - b),
    revealed: [],
    exploded: [],
    streakLen: 0,
    streakValue: 0,
    banked: 0,
    revealsLeft,
    lastEffects: [],
  };
}

describe("Mine Run engine — hand-built fixtures", () => {
  it("streak arithmetic: 4 single-cell safe reveals build a streak of 4 worth 10", () => {
    // 5x5 board, single mine at cell 12 (center). Cells 6,7,8,11 are each a neighbor of 12
    // (count=1) and NOT neighbors of each other's flood — each reveal opens exactly one cell.
    const engine = createMineRun({ width: 5, height: 5, mines: 1, budget: 10 });
    let state = baseState([12], 10);

    const sequence = [6, 7, 8, 11];
    const expectedCounts = [1, 1, 1, 1]; // hand-verified: each is an 8-neighbor of cell 12
    const expectedStreakLen = [1, 2, 3, 4];
    const expectedStreakValue = [1, 3, 6, 10]; // triangular: 1, 1+2, 1+2+3, 1+2+3+4

    for (let i = 0; i < sequence.length; i++) {
      const cell = sequence[i]!;
      const next = engine.apply(state, new Map([[0, { t: "reveal", cell }]]), {
        next: () => 0,
        int: () => 0,
        shuffle: <T>(xs: readonly T[]) => xs.slice(),
      });
      expect(next.revealed).toContain(cell);
      expect(next.streakLen).toBe(expectedStreakLen[i]);
      expect(next.streakValue).toBe(expectedStreakValue[i]);
      expect(next.revealsLeft).toBe(10 - (i + 1));
      // Effect carries the exact revealed count.
      expect(next.lastEffects).toEqual([{ type: "revealed", cell, n: expectedCounts[i] }]);
      state = next;
    }

    // Bank: the whole streak value (10) moves to banked; streak resets; budget untouched.
    const banked = engine.apply(state, new Map([[0, { t: "bank" }]]), {
      next: () => 0,
      int: () => 0,
      shuffle: <T>(xs: readonly T[]) => xs.slice(),
    });
    expect(banked.banked).toBe(10);
    expect(banked.streakLen).toBe(0);
    expect(banked.streakValue).toBe(0);
    expect(banked.revealsLeft).toBe(6); // unchanged by bank (R6: bank costs no budget)
    expect(banked.lastEffects).toEqual([{ type: "banked", points: 10 }]);
  });

  it("a mine wipes the unbanked streak but never touches banked points; the exploded cell stays revealed permanently", () => {
    // Same 5x5 board, two mines: 12 (center) and 20 (row4,col0).
    const engine = createMineRun({ width: 5, height: 5, mines: 2, budget: 10 });
    let state = baseState([12, 20], 10);

    const rng = { next: () => 0, int: () => 0, shuffle: <T>(xs: readonly T[]) => xs.slice() };

    // Build and bank a streak of 4 worth 10, exactly as the prior test (cells 6,7,8,11 are
    // still each adjacent to mine 12 only — mine 20 is far away and does not affect them).
    for (const cell of [6, 7, 8, 11]) {
      state = engine.apply(state, new Map([[0, { t: "reveal", cell }]]), rng);
    }
    state = engine.apply(state, new Map([[0, { t: "bank" }]]), rng);
    expect(state.banked).toBe(10);

    // Reveal 13 (count=1, adjacent to mine 12 only) then 16 (count=2, adjacent to BOTH mines
    // 12 and 20) — hand-verified against board.ts's neighbors(). Fresh streak: 1, then +2 = 3.
    state = engine.apply(state, new Map([[0, { t: "reveal", cell: 13 }]]), rng);
    expect(state.streakLen).toBe(1);
    expect(state.streakValue).toBe(1);
    state = engine.apply(state, new Map([[0, { t: "reveal", cell: 16 }]]), rng);
    expect(state.streakLen).toBe(2);
    expect(state.streakValue).toBe(3);
    expect(state.banked).toBe(10); // untouched so far

    // Hit mine 20: wipes the unbanked streak (3), never touches banked (10), reveals+explodes
    // the mine cell, run continues (never a terminal by itself).
    const afterMine = engine.apply(state, new Map([[0, { t: "reveal", cell: 20 }]]), rng);
    expect(afterMine.streakLen).toBe(0);
    expect(afterMine.streakValue).toBe(0);
    expect(afterMine.banked).toBe(10); // mines never touch banked points (R7)
    expect(afterMine.exploded).toEqual([20]);
    expect(afterMine.revealed).toContain(20);
    expect(afterMine.lastEffects).toEqual([{ type: "exploded", cell: 20, streakLost: 3 }]);

    // Exploded cell permanence: it stays in `revealed` and `exploded` forever after, and can
    // never be revealed again (checked properly in the legality test file; here we just
    // confirm the field never reverts across a further no-op-adjacent move).
    const further = engine.apply(afterMine, new Map([[0, { t: "reveal", cell: 14 }]]), rng);
    expect(further.exploded).toContain(20);
    expect(further.revealed).toContain(20);
  });

  it("full-clear terminal on a tiny fixture: a single flooding reveal can end the run before the budget runs out", () => {
    // 3x3 board, single mine at the corner (cell 8), generous budget (100). Revealing cell 0
    // floods the ENTIRE board (hand-verified: only mine 8 blocks the flood, and every other
    // safe cell is zero-connected to 0) — all 8 safe cells open in one move.
    const engine = createMineRun({ width: 3, height: 3, mines: 1, budget: 100 });
    const state = baseState([8], 100);
    const rng = { next: () => 0, int: () => 0, shuffle: <T>(xs: readonly T[]) => xs.slice() };

    const next = engine.apply(state, new Map([[0, { t: "reveal", cell: 0 }]]), rng);

    // All 8 safe cells revealed; mine itself never revealed.
    expect(next.revealed.length).toBe(8);
    expect(next.revealed).not.toContain(8);
    // streak = 8 opened cells this move -> triangular(8) = 36 -> auto-banked at the terminal.
    expect(next.streakLen).toBe(0); // folded by auto-bank
    expect(next.streakValue).toBe(0);
    expect(next.banked).toBe(36);
    expect(next.revealsLeft).toBe(99); // only 1 budget unit spent on the flood move
    // Auto-bank effect is appended after the reveal effects.
    expect(next.lastEffects[next.lastEffects.length - 1]).toEqual({ type: "banked", points: 36 });

    const status = engine.status(next);
    expect(status).toEqual({ kind: "scored", scores: [36] });
  });

  it("budget-exhaustion terminal auto-banks the surviving streak (never full-clear)", () => {
    // 3x3 board, single mine at the CENTER (cell 4) so a corner reveal never floods (every
    // corner is adjacent to the center) — a clean single-cell reveal with count=1, budget=1.
    const engine = createMineRun({ width: 3, height: 3, mines: 1, budget: 1 });
    const state = baseState([4], 1);
    const rng = { next: () => 0, int: () => 0, shuffle: <T>(xs: readonly T[]) => xs.slice() };

    const next = engine.apply(state, new Map([[0, { t: "reveal", cell: 0 }]]), rng);

    expect(next.revealed).toEqual([0]); // no flood: cell 0's count is 1 (adjacent to center)
    expect(next.revealsLeft).toBe(0);
    expect(next.banked).toBe(1); // streak of 1 (worth 1) auto-banked
    expect(next.streakLen).toBe(0);
    expect(next.streakValue).toBe(0);

    const status = engine.status(next);
    expect(status).toEqual({ kind: "scored", scores: [1] });
    // Not full-clear: 7 of 8 safe cells remain unrevealed, budget exhaustion ended it instead.
    expect(next.revealed.length).toBeLessThan(8);
  });

  it("score() always equals banked and is monotone across a hand-built sequence", () => {
    const engine = createMineRun({ width: 5, height: 5, mines: 1, budget: 10 });
    let state = baseState([12], 10);
    const rng = { next: () => 0, int: () => 0, shuffle: <T>(xs: readonly T[]) => xs.slice() };
    expect(engine.score!(state, 0)).toBe(0);
    for (const cell of [6, 7, 8]) {
      state = engine.apply(state, new Map([[0, { t: "reveal", cell }]]), rng);
      expect(engine.score!(state, 0)).toBe(state.banked);
    }
    const prevScore = engine.score!(state, 0);
    state = engine.apply(state, new Map([[0, { t: "bank" }]]), rng);
    expect(engine.score!(state, 0)).toBeGreaterThanOrEqual(prevScore);
    expect(engine.score!(state, 0)).toBe(state.banked);
  });
});

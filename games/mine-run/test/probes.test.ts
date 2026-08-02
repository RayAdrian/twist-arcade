// games/mine-run/test/probes.test.ts
//
// TDD anchor (docs/plans/mine-run.md §4.2): safeMove's decision order — (1) a provably-safe
// cell, preferring one that is ALSO provably zero; (2) else bank if streak >= 1; (3) else
// reveal the minimum-posterior cell. `chooseSafeMove` is the pure decision function taking an
// already-computed FrontierAnalysis (exported specifically so this file can test the ORDERING
// logic directly with a hand-built analysis, rather than needing to hand-construct a real CSP
// board that happens to discriminate every branch — csp.test.ts already owns proving
// analyzeFrontier's OWN correctness via an independent oracle; this file owns proving the
// DECISION taken given a (possibly hand-built) analysis is the one the plan specifies).
// `safeMove` (the integration: analyzeFrontier + chooseSafeMove) gets a few real end-to-end
// checks too, reusing the oracle-verified "1-2-1" board from csp.test.ts.

import { describe, expect, it } from "vitest";
import { countAdjacentMines } from "../board";
import { chooseSafeMove, safeMove } from "../probes";
import type { FrontierAnalysis } from "../csp";
import type { MineRunCellView, MineRunView } from "../engine";

function makeView(
  width: number,
  height: number,
  revealed: Map<number, number>,
  minesTotal: number,
  overrides: Partial<MineRunView> = {}
): MineRunView {
  const cells: Record<number, MineRunCellView> = {};
  for (const [cell, n] of revealed) cells[cell] = { n };
  return {
    width,
    height,
    cells,
    minesTotal,
    minesExploded: 0,
    streakLen: 0,
    streakValue: 0,
    nextGain: 1,
    banked: 0,
    revealsLeft: 50,
    lastEffects: [],
    ...overrides,
  };
}

function analysis(overrides: Partial<FrontierAnalysis>): FrontierAnalysis {
  return {
    provablySafe: new Set(),
    provablyMine: new Set(),
    posterior: new Map(),
    fallbackUsed: false,
    ...overrides,
  };
}

describe("chooseSafeMove — decision ordering (pure, given a fixed analysis)", () => {
  it("reveals a provably-safe cell that is ALSO provably zero, over a provably-safe-but-nonzero one", () => {
    // View: cell A (10) is revealed-safe (its neighbor cell would be "known safe" material);
    // cell B (11) is provably safe but has an unrevealed, non-safe (mine) neighbor -> NOT
    // provably zero; cell C (12) is provably safe and every one of ITS neighbors is either
    // revealed-safe or provably-safe -> provably zero. Board geometry is simplified to a
    // single row (width=20, height=1) purely so `neighbors()` gives predictable, easy-to-hand-
    // construct adjacency (each cell's only neighbors are its immediate left/right).
    const width = 20;
    const height = 1;
    const revealed = new Map<number, number>([[9, 0]]); // arbitrary revealed anchor, irrelevant to neighbors of 11/12
    const view = makeView(width, height, revealed, 3);
    // cell 11's neighbors are 10,12. Make 10 provablyMine (not safe) so 11 is NOT provably-zero.
    // cell 15's neighbors are 14,16. Make both provablySafe so 15 IS provably-zero.
    const a = analysis({
      provablySafe: new Set([11, 14, 15, 16]),
      provablyMine: new Set([10]),
    });
    const move = chooseSafeMove(view, a);
    expect(move).toEqual({ t: "reveal", cell: 15 });
  });

  it("falls back to any provably-safe cell (lowest index) when none qualifies as provably zero", () => {
    const width = 20;
    const height = 1;
    const view = makeView(width, height, new Map(), 3);
    // 11's neighbors (10,12) are neither revealed-safe nor provably-safe -> not provably zero.
    // 18's neighbors (17,19) likewise not established safe.
    const a = analysis({ provablySafe: new Set([18, 11]) });
    const move = chooseSafeMove(view, a);
    expect(move).toEqual({ t: "reveal", cell: 11 }); // lowest index among the provably-safe set
  });

  it("banks when no cell is provably safe and the streak is >= 1", () => {
    const width = 10;
    const height = 10;
    const view = makeView(width, height, new Map(), 5, { streakLen: 3, streakValue: 6 });
    const a = analysis({ posterior: new Map([[42, 0.3]]) });
    const move = chooseSafeMove(view, a);
    expect(move).toEqual({ t: "bank" });
  });

  it("reveals the minimum-posterior cell when nothing is provable and the streak is 0", () => {
    const width = 10;
    const height = 10;
    const view = makeView(width, height, new Map(), 5, { streakLen: 0 });
    const a = analysis({
      posterior: new Map([
        [3, 0.4],
        [7, 0.12],
        [50, 0.5],
      ]),
    });
    const move = chooseSafeMove(view, a);
    expect(move).toEqual({ t: "reveal", cell: 7 });
  });

  it("ties in minimum posterior break on the lowest cell index", () => {
    const width = 10;
    const height = 10;
    const view = makeView(width, height, new Map(), 5, { streakLen: 0 });
    const a = analysis({
      posterior: new Map([
        [40, 0.2],
        [12, 0.2],
        [77, 0.9],
      ]),
    });
    const move = chooseSafeMove(view, a);
    expect(move).toEqual({ t: "reveal", cell: 12 });
  });
});

describe("safeMove — end-to-end (analyzeFrontier + chooseSafeMove)", () => {
  it("reveals the provably-safe cell on the oracle-verified 1-2-1 board", () => {
    const width = 3;
    const height = 2;
    const mines = new Set([3, 5]);
    const revealed = new Map<number, number>([
      [0, countAdjacentMines(0, mines, width, height)],
      [1, countAdjacentMines(1, mines, width, height)],
      [2, countAdjacentMines(2, mines, width, height)],
    ]);
    const view = makeView(width, height, revealed, mines.size);
    const move = safeMove(view);
    expect(move).toEqual({ t: "reveal", cell: 4 });
  });

  it("banks when nothing is provable and the streak is >= 1 (real analysis, ambiguous board)", () => {
    // 3-cell board, reveal only the middle cell (1): its two neighbors (0 and 2) are its ONLY
    // unrevealed cells (no background), and its count is 1 -- exactly one of {0,2} is a mine,
    // genuinely 50/50, so analyzeFrontier must mark NEITHER as provably safe/mine.
    const width = 3;
    const height = 1;
    const mines = new Set([0]); // only used to derive a consistent count for cell1
    const revealed = new Map<number, number>([[1, countAdjacentMines(1, mines, width, height)]]);
    const view = makeView(width, height, revealed, 1, { streakLen: 2, streakValue: 3 });
    const move = safeMove(view);
    expect(move).toEqual({ t: "bank" });
  });
});

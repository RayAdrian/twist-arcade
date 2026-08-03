// games/mine-run/test/sample-consistent-state.test.ts
//
// TDD anchor (docs/plans/mine-run.md §10): "sampleConsistentState: every sample consistent
// with the view; frequency of a hand-solved 50/50 cell ≈ 0.5 over 2,000 samples (loose band)."
//
// The "known" posterior each frequency check is compared against comes from analyzeFrontier
// (already cross-validated against an independent brute-force oracle in csp.test.ts) — this
// file's job is to prove the SEPARATE sampling code path (weighted total-count draw + per-
// component sequential conditioning + uniform background subset) reproduces that same
// distribution empirically, not to re-derive the analytical answer by hand a second time.

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { countAdjacentMines } from "../board";
import { analyzeFrontier, sampleConsistentState } from "../csp";
import type { MineRunCellView, MineRunView } from "../engine";

function makeView(
  width: number,
  height: number,
  revealed: Map<number, number>,
  minesTotal: number,
  explodedCells: number[] = []
): MineRunView {
  const cells: Record<number, MineRunCellView> = {};
  for (const [cell, n] of revealed) cells[cell] = { n };
  for (const cell of explodedCells) cells[cell] = { exploded: true };
  return {
    width,
    height,
    cells,
    minesTotal,
    minesExploded: explodedCells.length,
    streakLen: 3,
    streakValue: 6,
    nextGain: 4,
    banked: 12,
    revealsLeft: 40,
    lastEffects: [],
  };
}

function assertConsistent(view: MineRunView, sample: ReturnType<typeof sampleConsistentState>): void {
  expect(sample.mines.length).toBe(view.minesTotal);
  const mineSet = new Set(sample.mines);
  const revealedFromView = new Set<number>();
  for (const key of Object.keys(view.cells)) {
    const cell = Number(key);
    const v = view.cells[cell]!;
    if ("mine" in v) continue; // spectator-only disclosure, never actually "revealed"
    revealedFromView.add(cell);
    if ("exploded" in v) {
      expect(mineSet.has(cell)).toBe(true);
    } else {
      expect(mineSet.has(cell)).toBe(false); // revealed-safe cells must never be sampled as mines
      const trueN = countAdjacentMines(cell, mineSet, view.width, view.height);
      expect(trueN).toBe(v.n); // the sampled layout must reproduce EVERY shown number exactly
    }
  }
  expect(new Set(sample.revealed)).toEqual(revealedFromView);
}

describe("sampleConsistentState", () => {
  it("every sample is fully consistent with the view (numbers, exploded cells, total mine count)", () => {
    const width = 4;
    const height = 4;
    const mines = new Set([5, 6, 9, 10]);
    const revealedRing = [0, 1, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15];
    const trueCounts = new Map<number, number>();
    for (const c of revealedRing) trueCounts.set(c, countAdjacentMines(c, mines, width, height));
    const view = makeView(width, height, trueCounts, mines.size);

    const rng = rngFromSeed("consistency-check");
    for (let i = 0; i < 50; i++) {
      const sample = sampleConsistentState(view, rng);
      assertConsistent(view, sample);
    }
  });

  it("every sample is consistent even with an already-exploded mine in the view", () => {
    const width = 3;
    const height = 3;
    const mines = new Set([4, 8]);
    const trueCounts = new Map<number, number>([[0, countAdjacentMines(0, mines, width, height)]]);
    const view = makeView(width, height, trueCounts, mines.size, [8]);

    const rng = rngFromSeed("consistency-check-exploded");
    for (let i = 0; i < 50; i++) {
      const sample = sampleConsistentState(view, rng);
      assertConsistent(view, sample);
    }
  });

  it("empirical sampling frequency matches analyzeFrontier's exact posterior within a loose band (2,000 samples)", () => {
    // Reuse the "1-2-1" pattern (cells 3 and 5 provably mines, cell 4 provably safe under
    // analyzeFrontier — already oracle-verified in csp.test.ts). A provable cell's frequency
    // should be essentially 0 or 1 exactly; add a genuinely fractional-posterior scenario too.
    const width = 3;
    const height = 2;
    const mines = new Set([3, 5]);
    const trueCounts = new Map<number, number>([
      [0, countAdjacentMines(0, mines, width, height)],
      [1, countAdjacentMines(1, mines, width, height)],
      [2, countAdjacentMines(2, mines, width, height)],
    ]);
    const view = makeView(width, height, trueCounts, mines.size);
    const analysis = analyzeFrontier(view);

    const rng = rngFromSeed("frequency-check-121");
    const N = 2000;
    const counts = new Map<number, number>([[3, 0], [4, 0], [5, 0]]);
    for (let i = 0; i < N; i++) {
      const sample = sampleConsistentState(view, rng);
      const mineSet = new Set(sample.mines);
      for (const cell of [3, 4, 5]) {
        if (mineSet.has(cell)) counts.set(cell, counts.get(cell)! + 1);
      }
    }
    for (const cell of [3, 4, 5]) {
      const empirical = counts.get(cell)! / N;
      const expected = analysis.posterior.get(cell)!;
      expect(Math.abs(empirical - expected)).toBeLessThan(0.05); // loose band, per plan §10
    }
  });

  it("empirical sampling frequency matches analyzeFrontier on a genuinely fractional-posterior scenario", () => {
    // The "global mine-count coupling" board from csp.test.ts: two separated frontier
    // components plus background, chosen specifically because it leaves real ambiguity (not
    // fully pinned down like a solved ring), so several cells have genuinely fractional
    // posteriors rather than just the two provable-cell edge cases.
    const width = 5;
    const height = 3;
    const mines = new Set([5, 8, 12]);
    const revealedCellsRow0 = [0, 1, 2, 3, 4];
    const revealedRow1Wall = [7];
    const trueCounts = new Map<number, number>();
    for (const c of [...revealedCellsRow0, ...revealedRow1Wall]) {
      trueCounts.set(c, countAdjacentMines(c, mines, width, height));
    }
    const view = makeView(width, height, trueCounts, mines.size);
    const analysis = analyzeFrontier(view);

    // Only test cells with a genuinely fractional posterior (not 0 or 1) -- those are the
    // ones a buggy sampler could get subtly wrong while still "passing" on the easy 0/1 cases.
    const fractionalCells = [...analysis.posterior.entries()].filter(([, p]) => p > 0.02 && p < 0.98);
    expect(fractionalCells.length).toBeGreaterThan(0);

    const rng = rngFromSeed("frequency-check-fractional");
    const N = 2000;
    const counts = new Map<number, number>(fractionalCells.map(([cell]) => [cell, 0]));
    for (let i = 0; i < N; i++) {
      const sample = sampleConsistentState(view, rng);
      const mineSet = new Set(sample.mines);
      for (const [cell] of fractionalCells) {
        if (mineSet.has(cell)) counts.set(cell, counts.get(cell)! + 1);
      }
    }
    for (const [cell, expected] of fractionalCells) {
      const empirical = counts.get(cell)! / N;
      expect(Math.abs(empirical - expected)).toBeLessThan(0.07); // loose band
    }
  });

  it("empirical sampling frequency matches analyzeFrontier on a GENUINELY separated " +
    "two-component frontier (should-fix 3's companion case)", () => {
    // Same 1x9 two-component board as csp.test.ts's "genuinely separated two-component
    // frontier" test: component A = {0,2} (revealed cell 1, count 1), component B = {4,6}
    // (revealed cell 5, count 1), background = {3,7,8}. This is the sequential per-component
    // conditioning path in sampleConsistentState (suffix convolutions across >=2 components) —
    // previously exercised by NO test, since every other frequency check here runs against a
    // single-component or single-blob view.
    const width = 9;
    const height = 1;
    const mines = new Set([0, 6, 8]);
    const trueCounts = new Map<number, number>([
      [1, countAdjacentMines(1, mines, width, height)],
      [5, countAdjacentMines(5, mines, width, height)],
    ]);
    const view = makeView(width, height, trueCounts, mines.size);
    const analysis = analyzeFrontier(view);

    const rng = rngFromSeed("frequency-check-two-component");
    const N = 3000;
    const cells = [0, 2, 4, 6, 3, 7, 8];
    const counts = new Map<number, number>(cells.map((c) => [c, 0]));
    for (let i = 0; i < N; i++) {
      const sample = sampleConsistentState(view, rng);
      const mineSet = new Set(sample.mines);
      for (const cell of cells) {
        if (mineSet.has(cell)) counts.set(cell, counts.get(cell)! + 1);
      }
      // Every sample must still put exactly 2 mines total across the two frontier pairs plus
      // exactly 1 in the background, since the view's total (3) and each component's own
      // local constraint (exactly 1 per pair) are both hard requirements.
      expect(mineSet.has(0) !== mineSet.has(2)).toBe(true); // exactly one of {0,2}
      expect(mineSet.has(4) !== mineSet.has(6)).toBe(true); // exactly one of {4,6}
    }
    for (const cell of cells) {
      const empirical = counts.get(cell)! / N;
      const expected = analysis.posterior.get(cell)!;
      expect(Math.abs(empirical - expected)).toBeLessThan(0.05); // loose band, per plan §10
    }
  });
});

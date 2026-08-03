// games/mine-run/test/engine-generation.test.ts
//
// TDD anchor (docs/plans/mine-run.md §10): "Same seed twice => identical layout + opening
// region (generation determinism); a seed whose first placement has no zero cell exercises
// the deterministic retry path." All generation happens in setup() via the injected Rng
// (R1/R2) — this is also exactly the property the platform's leaderboard verification and
// solo-games-lens §4's "determinism through generation" testkit property depend on.

import { describe, expect, it } from "vitest";
import { rngForSetup } from "@twist-arcade/engine";
import { createMineRun, DEFAULT_BUDGET, DEFAULT_HEIGHT, DEFAULT_MINES, DEFAULT_WIDTH } from "../engine";

describe("Mine Run generation (setup)", () => {
  it("same seed twice produces an identical mine layout and opening region (launch board)", () => {
    const engine = createMineRun({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, mines: DEFAULT_MINES, budget: DEFAULT_BUDGET });
    const seed = "mine-run-determinism-seed-1";
    const a = engine.setup(1, rngForSetup(seed));
    const b = engine.setup(1, rngForSetup(seed));
    expect(a.mines).toEqual(b.mines);
    expect(a.revealed).toEqual(b.revealed);
    expect(a.exploded).toEqual([]);
    expect(a.streakLen).toBe(0);
    expect(a.streakValue).toBe(0);
    expect(a.banked).toBe(0);
    expect(a.revealsLeft).toBe(DEFAULT_BUDGET);
  });

  it("a different seed generally produces a different layout (sanity — not a hard guarantee, but astronomically likely)", () => {
    const engine = createMineRun();
    const a = engine.setup(1, rngForSetup("seed-A"));
    const b = engine.setup(1, rngForSetup("seed-B"));
    expect(a.mines).not.toEqual(b.mines);
  });

  it("the opening region always contains only safe (non-mine) cells and costs no budget", () => {
    const engine = createMineRun();
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const state = engine.setup(1, rngForSetup(seed));
      const mineSet = new Set(state.mines);
      for (const c of state.revealed) {
        expect(mineSet.has(c)).toBe(false);
      }
      expect(state.revealsLeft).toBe(DEFAULT_BUDGET); // opening region is free (R2)
      expect(state.revealed.length).toBeGreaterThan(0);
    }
  });

  it("forces the deterministic retry-then-fallback path when no zero cell can ever exist, and stays deterministic", () => {
    // 3x3 board with 8 mines: exactly one safe cell remains, and it necessarily has >=3
    // mine-neighbors (every other cell on the board is a mine) — a zero cell is IMPOSSIBLE,
    // so every one of MAX_GENERATION_ATTEMPTS retries fails and the minimum-count fallback
    // fires. The opening region must therefore be exactly the single safe cell (a size-1
    // region, since floodFrom on a non-zero cell never expands).
    const engine = createMineRun({ width: 3, height: 3, mines: 8, budget: 5 });
    const seed = "forced-fallback-seed";
    const a = engine.setup(1, rngForSetup(seed));
    const b = engine.setup(1, rngForSetup(seed));

    expect(a.mines.length).toBe(8);
    expect(a.revealed.length).toBe(1); // fallback: single minimum-count cell, no flood
    expect(a.mines).toEqual(b.mines); // still fully deterministic despite exhausting retries
    expect(a.revealed).toEqual(b.revealed);
  });
});

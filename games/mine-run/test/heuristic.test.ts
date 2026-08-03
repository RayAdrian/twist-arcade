// games/mine-run/test/heuristic.test.ts — TDD coverage for heuristic.ts (docs/plans/
// mine-run.md §4.5, platform-corrections.md C6). The motivating bug: bare `engine.score()`
// (== banked) ties every reveal candidate at the SAME value (revealing never raises banked in
// one step), so a 1-ply greedy ranking built on score() alone is blind to the entire live
// streak. These tests pin that `heuristic()` actually differentiates on the live streak, that
// it orders "proven-safe reveal available" above "no proven deduction", and that it stays
// view-honest (identical across independently-resampled hidden worlds sharing a view — the
// same anchor test/view-honesty.test.ts already holds safeMove to).

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup, rngFromSeed } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import type { MineRunState } from "../engine";
import { createMineRunHeuristic } from "../heuristic";

describe("createMineRunHeuristic: live-streak awareness (the C6 fix)", () => {
  it("values a live streak strictly above an otherwise-identical banked-only state, even though score() (banked) ties both", () => {
    const heuristic = createMineRunHeuristic(3, 1);
    const noStreak: MineRunState = {
      mines: [],
      revealed: [],
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 0,
      revealsLeft: 5,
      lastEffects: [],
    };
    const withStreak: MineRunState = { ...noStreak, streakLen: 5, streakValue: 15 };

    // score() (== banked) is identical for both — a bare-score 1-ply ranking could not tell
    // these apart, which is exactly the C6 blindness.
    expect(noStreak.banked).toBe(withStreak.banked);
    expect(heuristic(withStreak, 0)).toBeGreaterThan(heuristic(noStreak, 0));
  });

  it("a proven-safe reveal (single-point fixpoint) ranks the position above an identical-streak state with no deducible safety", () => {
    // 3x1 board, one mine at cell 2. Revealing cell 0 shows "0" (its only neighbor, cell 1, is
    // not a mine) — cell 1 is forced safe by the single-point rule (required mines among its
    // one unresolved neighbor drops to 0).
    const heuristic = createMineRunHeuristic(3, 1);
    const withClue: MineRunState = {
      mines: [2],
      revealed: [0],
      exploded: [],
      streakLen: 2,
      streakValue: 3,
      banked: 0,
      revealsLeft: 5,
      lastEffects: [],
    };
    // Same streak/banked, same total mine count, but NOTHING revealed — no deduction available,
    // only the uniform background rate.
    const noClue: MineRunState = { ...withClue, revealed: [] };

    expect(heuristic(withClue, 0)).toBeGreaterThan(heuristic(noClue, 0));
  });

  it("returns exactly banked at a terminal (revealsLeft <= 0) state — nothing left to weigh", () => {
    const heuristic = createMineRunHeuristic(1, 1);
    const terminal: MineRunState = {
      mines: [],
      revealed: [0],
      exploded: [],
      streakLen: 0,
      streakValue: 0,
      banked: 7,
      revealsLeft: 0,
      lastEffects: [],
    };
    expect(heuristic(terminal, 0)).toBe(7);
  });
});

describe("createMineRunHeuristic: view-honesty (mirrors test/view-honesty.test.ts's safeMove anchor)", () => {
  it("agrees across independently-resampled hidden worlds that share the same view", () => {
    const engine = createMineRun({ width: 6, height: 6, mines: 8, budget: 20 });
    const heuristic = createMineRunHeuristic(6, 6);
    const seed = "heuristic-view-honesty";
    let state = engine.setup(1, rngForSetup(seed));

    let step = 0;
    while (engine.status(state).kind === "ongoing" && step < 4) {
      const legal = engine.legalMoves(state, 0).filter((m) => m.t === "reveal");
      if (legal.length === 0) break;
      const move = legal.reduce((min, m) => (m.t === "reveal" && min.t === "reveal" && m.cell < min.cell ? m : min));
      state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
      step++;
    }
    expect(engine.status(state).kind).toBe("ongoing");

    const view = engine.playerView(state, 0);
    const unrevealedCount = view.width * view.height - Object.keys(view.cells).length;
    expect(unrevealedCount).toBeGreaterThan(0); // real hidden information remains to resample

    const worldSeeds = ["world-a", "world-b", "world-c", "world-d"];
    const sampledMineSets: string[] = [];
    const values: number[] = [];
    for (const s of worldSeeds) {
      const sampled = engine.sampleConsistentState!(view, rngFromSeed(s));
      expect(engine.playerView(sampled, 0)).toMatchObject({ cells: view.cells }); // same view
      sampledMineSets.push(JSON.stringify(sampled.mines));
      values.push(heuristic(sampled, 0));
    }

    for (const v of values) expect(v).toBe(values[0]);
    // Not a degenerate sampler.
    expect(new Set(sampledMineSets).size).toBeGreaterThan(1);
  });
});

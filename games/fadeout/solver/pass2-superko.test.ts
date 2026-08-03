// games/fadeout/solver/pass2-superko.test.ts — TDD anchors for pass 2 of the exact solve
// (docs/plans/fadeout.md §2.4's anchor 4, plus root-level contract tests):
//   - superko filtering mechanism: a move that would recreate a prior position is excluded
//     from the legal set (and is NOT excluded when that same position is absent from history)
//   - the budget/fallback contract: an exhausted budget reports the pass-1 (C2) value, flagged
//   - root-level correctness on the two configs fast enough to prove exactly (playThrough=true,
//     where the R1 axis collapse + the pass-1 LOSS shortcut resolve nearly instantly) — the
//     other two configs (playThrough=false) are the genuinely hard GHI residue; see the solve
//     report for how those are handled (fallback + escalation, not asserted here as "proven").

import { describe, expect, it } from "vitest";
import { positionKey } from "../engine";
import {
  legalSuperkoCells,
  resolvedSuperkoConfig,
  solveSuperko,
  type SuperkoOpeningValue,
} from "./pass2-superko";
import { solveRaw } from "./raw-engine";

// ---------------------------------------------------------------------------------------
// Anchor 4 (plan §2.4): superko filtering — a move recreating a prior position is illegal;
// the identical move stays legal when that position is absent from history. Reuses the exact
// rotation-cycle position engine.test.ts already hand-verified ("superko: the move that would
// recreate an earlier full position is illegal").
// ---------------------------------------------------------------------------------------

describe("legalSuperkoCells() — the mechanism pass2's history-aware search depends on", () => {
  it("excludes exactly the move that would recreate a position already in history, nothing else", () => {
    const config = { decayTiming: "remove-first" as const, playThrough: false };
    const resolved = resolvedSuperkoConfig(config);
    // Both sides at cap on disjoint non-winning cells (engine.test.ts's buildToCap() set),
    // P0 to move, oldest own mark = cell 0 — the self-rotation target.
    const queues: [readonly number[], readonly number[]] = [[0, 1, 3], [2, 5, 7]];
    const mover = 0 as const;

    // The position that would result from P0 rotating (cell 0 -> evict 0, place 0 again):
    // occupancy unchanged, queue becomes [3,0,0]... actually recompute directly rather than
    // hand-deriving twice: legalSuperkoCells with an EMPTY history includes cell 0.
    const withoutHistory = legalSuperkoCells(queues, mover, new Set(), resolved);
    expect(withoutHistory.map((m) => m.cell).sort((a, b) => a - b)).toContain(0);

    const selfRotate = withoutHistory.find((m) => m.cell === 0)!;
    const recreatedKey = positionKey({ queues: selfRotate.childQueues, toMove: selfRotate.childToMove });

    const withHistory = legalSuperkoCells(queues, mover, new Set([recreatedKey]), resolved);
    expect(withHistory.map((m) => m.cell)).not.toContain(0);
    // Every OTHER previously-legal move is untouched — only the recreating one is removed.
    const expectedSurvivors = withoutHistory.filter((m) => m.cell !== 0).map((m) => m.cell).sort((a, b) => a - b);
    expect(withHistory.map((m) => m.cell).sort((a, b) => a - b)).toEqual(expectedSurvivors);
  });

  it("a move recreating a position NOT in history stays legal (no false positives)", () => {
    const config = { decayTiming: "remove-first" as const, playThrough: false };
    const resolved = resolvedSuperkoConfig(config);
    const queues: [readonly number[], readonly number[]] = [[0, 1, 3], [2, 5, 7]];
    const unrelatedKey = positionKey({ queues: [[9], []] as unknown as [readonly number[], readonly number[]], toMove: 1 });
    const legal = legalSuperkoCells(queues, 0, new Set([unrelatedKey]), resolved);
    expect(legal.map((m) => m.cell)).toContain(0);
  });
});

// ---------------------------------------------------------------------------------------
// Budget/fallback contract (plan §2.3): an exhausted budget must report the pass-1 (C2) value,
// flagged, never an unproven claim silently passed off as decisive.
// ---------------------------------------------------------------------------------------

describe("solveSuperko() — budget/fallback contract", () => {
  it("a budget of zero node visits falls back to the pass-1 value and flags budgetExceeded", () => {
    const config = { decayTiming: "remove-first" as const, playThrough: false };
    const raw = solveRaw(config);
    const result = solveSuperko(config, raw, { maxNodesVisited: 0, wallClockMs: 60_000 });
    expect(result.budgetExceeded).toBe(true);
    expect(result.rootValue).toBe(raw.rootValue);
    expect(result.openings).toEqual(raw.openings satisfies SuperkoOpeningValue[]);
  });
});

// ---------------------------------------------------------------------------------------
// Root-level correctness on the two FAST configs (playThrough=true): the R1 axis collapse
// means decayTiming is a no-op here, and the pass-1 LOSS shortcut resolves the whole root
// nearly instantly (measured: 0ms/5 nodes) — a genuine exact proof, not a fallback, cheap
// enough to assert directly as a regression guard.
// ---------------------------------------------------------------------------------------

describe("solveSuperko() — root-level exact proof on the fast (playThrough=true) configs", () => {
  it.each([
    { decayTiming: "remove-first" as const, playThrough: true },
    { decayTiming: "place-first" as const, playThrough: true },
  ])("proves the root exactly (no budget fallback) for %o, agreeing with pass 1", (config) => {
    const raw = solveRaw(config);
    const result = solveSuperko(config, raw, { wallClockMs: 30_000 });
    expect(result.budgetExceeded).toBe(false);
    expect(result.rootValue).toBe(raw.rootValue);
    expect(result.openings).toEqual(raw.openings);
  });

  it("the R1 axis collapse holds for the SUPERKO value too, not just pass 1", () => {
    const a1 = { decayTiming: "remove-first" as const, playThrough: true };
    const a2 = { decayTiming: "place-first" as const, playThrough: true };
    const superkoA1 = solveSuperko(a1, solveRaw(a1), { wallClockMs: 30_000 });
    const superkoA2 = solveSuperko(a2, solveRaw(a2), { wallClockMs: 30_000 });
    expect(superkoA1.rootValue).toBe(superkoA2.rootValue);
    expect(superkoA1.openings).toEqual(superkoA2.openings);
  });
});

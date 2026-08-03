// games/fadeout/solver/pass2-superko.test.ts — TDD anchors for pass 2 of the exact solve
// (docs/plans/fadeout.md §2.4's anchor 4, plus root-level contract tests):
//   - superko filtering mechanism: a move that would recreate a prior position is excluded
//     from the legal set (and is NOT excluded when that same position is absent from history)
//   - the budget/fallback contract: an exhausted budget reports the pass-1 (C2) value, flagged
//   - root-level correctness on the two configs fast enough to prove exactly (playThrough=true,
//     where the R1 axis collapse + the pass-1 LOSS shortcut resolve nearly instantly) — the
//     other two configs (playThrough=false) are the genuinely hard GHI residue; see the solve
//     report for how those are handled (fallback + escalation, not asserted here as "proven").
//   - plan §2.4's OWN anchor 4 (VALUE, not legality): a hand-built position where the only
//     non-losing raw move recreates a prior position — C1 must score the mover lost, C2 must
//     report draw. Needs `solveSuperkoFromPosition`'s from-position entry point (below), since
//     `solveSuperko` only ever starts from the empty root.

import { describe, expect, it } from "vitest";
import { positionKey } from "../engine";
import {
  legalSuperkoCells,
  resolvedSuperkoConfig,
  solveSuperko,
  solveSuperkoFromPosition,
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

// ---------------------------------------------------------------------------------------
// Plan §2.4's OWN anchor 4, asserted at the VALUE level (not the legality-only mechanism test
// above): "a hand-built position where the only non-losing move recreates a prior position —
// under C1 the mover must be scored as lost (superko removes the escape), under C2 as draw."
//
// `remove-first/solid` cannot host this fixture: the solve report (§1.5, finding #6) found its
// raw graph has ZERO reachable LOSS positions anywhere, so there is no config where "every
// other move already loses" is even possible. `place-first/solid` DOES have real LOSS
// positions (24,268 of them per the report) — found programmatically against the already-
// solved raw graph (same honest, found-not-guessed spirit as raw-engine.test.ts's anchor 3):
// after P0 opens on cell 0, P1 to move has exactly one non-losing reply (cell 4, a draw) and
// loses with every other reply. `raw.valueAt` on the position itself confirms the C2 value is
// "draw" (P1's best is the cell-4 draw) — matching the per-opening table in the solve report
// (opening cell 0 = draw for P0).
// ---------------------------------------------------------------------------------------

describe("solveSuperkoFromPosition() — plan §2.4 anchor 4: the ONLY non-losing move recreates history", () => {
  it("C2 (raw graph) reports draw at this position; C1 (superko, with that move already in history) scores the mover LOST", () => {
    const config = { decayTiming: "place-first" as const, playThrough: false };
    const raw = solveRaw(config);

    // P0 has played cell 0; P1 to move. Found by walking the solved raw graph for a node with
    // exactly one non-loss move whose own value is "draw" — not hand-traced ply-by-ply.
    const queues: [readonly number[], readonly number[]] = [[0], []];
    const toMove = 1 as const;
    const key = positionKey({ queues, toMove });

    // C2: the raw graph's own value at this exact position.
    expect(raw.valueAt(key)).toBe("draw");

    // The one non-losing move: P1 plays cell 4, reaching queues=[[0],[4]], toMove=0.
    const nonLosingChildKey = positionKey({ queues: [[0], [4]], toMove: 0 });

    // C1: seed historyBefore with that exact child key, as if this exact position had already
    // been visited once before — superko must therefore reject cell 4 as a repeat, leaving P1
    // with only its seven other (all raw-LOSS) replies.
    const historyBefore = new Set([nonLosingChildKey]);
    const result = solveSuperkoFromPosition(config, raw, { queues, toMove, historyBefore }, { wallClockMs: 30_000 });

    expect(result.budgetExceeded).toBe(false);
    expect(result.value).toBe("loss");
  });
});

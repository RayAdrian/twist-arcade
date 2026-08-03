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
//   - THE DEEP SEARCH CORE, beyond the O(1) witness/LOSS shortcuts (the F2 amendments' item 4):
//     the "no legal moves" superko-exhaustion base case; a genuine deferred-recursion+history-
//     threading case where blocking the raw graph's own canonical witness flips a position's
//     value from the shortcuts' "win" to an actually-searched "loss"; and a regression test for
//     the partial-result bug (item 8) where an already-proven rootValue used to be discarded
//     whenever a LATER opening exhausted the shared search budget.

import { describe, expect, it } from "vitest";
import { positionKey } from "../engine";
import { transition, type ResolvedRulesetConfig } from "../engine-internal";
import {
  legalSuperkoCells,
  resolvedSuperkoConfig,
  solveSuperko,
  solveSuperkoFromPosition,
  type SuperkoOpeningValue,
} from "./pass2-superko";
import { solveRaw, winWitnessPositionKeys, type RawOpeningValue, type RawSolveResult } from "./raw-engine";

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

// ---------------------------------------------------------------------------------------
// Deep search core, part 1: the "no legal moves" superko-exhaustion base case (plan §3.3's
// "no-legal-moves corner" — engine.ts's computeStatus resolves this as a loss for the mover with
// no move). `value()`'s only two base cases are an immediate win and this one; the anchor-4 test
// above resolves via the pass-1 LOSS shortcut (moves.length is never actually 0 there — every
// OTHER reply is individually raw-LOSS), so it never touches this branch. This fixture forces
// moves.length === 0 directly: reuse raw-engine.test.ts's hand-verified full-cap self-rotation
// position ({0,1,3} vs {2,5,7}, P0 to move, oldest own mark = cell 0), whose only raw-legal moves
// (occupancy-only, ignoring superko) are the three empty cells {4,6,8} plus the self-rotation
// target {0} — found programmatically below, not asserted from memory. Blocking ALL FOUR of
// their resulting positions via historyBefore leaves P0 with zero legal targets.
// ---------------------------------------------------------------------------------------

describe("solveSuperkoFromPosition() — the no-legal-moves corner (plan §3.3): every raw-legal move already recreates history", () => {
  it("a mover with every raw-legal reply blocked by superko history loses immediately, with zero recursion", () => {
    const config = { decayTiming: "remove-first" as const, playThrough: false };
    const raw = solveRaw(config);
    const resolved = resolvedSuperkoConfig(config);

    const queues: [readonly number[], readonly number[]] = [[0, 1, 3], [2, 5, 7]];
    const mover = 0 as const;

    // Confirm the raw-legal move set is exactly what the fixture's derivation claims (found, not
    // assumed) before relying on it to build historyBefore.
    const legalNoHistory = legalSuperkoCells(queues, mover, new Set(), resolved);
    expect(legalNoHistory.map((m) => m.cell).sort((a, b) => a - b)).toEqual([0, 4, 6, 8]);

    const childKeys = legalNoHistory.map((m) => positionKey({ queues: m.childQueues, toMove: m.childToMove }));
    expect(new Set(childKeys).size).toBe(childKeys.length); // sanity: all four are genuinely distinct positions

    const historyBefore = new Set(childKeys);
    // Every raw-legal move now recreates a position already in `historyBefore` — superko leaves
    // the mover with nothing.
    expect(legalSuperkoCells(queues, mover, historyBefore, resolved)).toEqual([]);

    const result = solveSuperkoFromPosition(config, raw, { queues, toMove: mover, historyBefore }, { wallClockMs: 5_000 });
    expect(result.budgetExceeded).toBe(false);
    expect(result.value).toBe("loss");
    // No recursion needed at all: `value()` returns from the empty-moves check before ever
    // examining a child, distinguishing this from the shortcut-driven anchor-4 case above.
    expect(result.nodesVisited).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
// Deep search core, part 2: genuine deferred recursion + history threading, where blocking the
// raw graph's OWN canonical win-witness forces the search to actually explore alternatives
// rather than take the O(1) shortcut — and the alternatives turn out to be worse than the raw
// graph's witness-based value, flipping the position's value from "win" (C2/pass-1, and what the
// unblocked WIN-witness shortcut would report) to "loss" (searched exhaustively over the
// remaining moves). This demonstrates the deep search core (the `deferred` list, the recursive
// `value()` calls with growing `historyAfter`) actually running end to end, not just the 1-node
// shortcut checks the other pass2 tests exercise.
//
// Fixture found programmatically (same honest, found-not-guessed spirit as the other anchors):
// among place-first/solid's raw-WIN positions with a short (3-key) witness, P1 to move at
// queues=[[0,8],[1]] has raw value "win" via witness [self, {queues:[[0,8],[1,4]],toMove:0},
// {queues:[[0,8,2],[1,4]],toMove:1}] — i.e. P1's witness plays cell 4 (threatening the 1-4-7
// diagonal), P0's forced (arbitrary, since it's LOSS for P0 either way) reply is cell 2, and P1
// completes with cell 7. Seeding historyBefore with the witness's SECOND entry (as if the
// position reached by "P1 plays 4" had already occurred earlier in this hypothetical game) makes
// cell 4 illegal under superko — removing the raw graph's witness move entirely. `legalSuperkoCells`
// confirms cell 4 is the only one removed; the actual C1 value over what remains is "loss", not
// "win" — a real, searched divergence from what the raw graph (and the blocked witness) would
// otherwise report.
// ---------------------------------------------------------------------------------------

describe("solveSuperkoFromPosition() — deep search core: blocking the raw graph's own witness forces real recursion, and the real answer differs", () => {
  it("with the witness's own second position pre-visited, P1 loses despite the raw graph (and the blocked witness) saying win", () => {
    const config = { decayTiming: "place-first" as const, playThrough: false };
    const raw = solveRaw(config);
    const resolved = resolvedSuperkoConfig(config);

    const queues: [readonly number[], readonly number[]] = [[0, 8], [1]];
    const toMove = 1 as const;
    const key = positionKey({ queues, toMove });

    // C2 (raw graph): P1 to move here is a proven win, via a 3-position witness.
    expect(raw.valueAt(key)).toBe("win");
    const witness = winWitnessPositionKeys(raw, key);
    expect(witness).toEqual([
      key,
      positionKey({ queues: [[0, 8], [1, 4]], toMove: 0 }),
      positionKey({ queues: [[0, 8, 2], [1, 4]], toMove: 1 }),
    ]);

    // Block the witness's second entry — as if "P1 plays cell 4" had already happened once
    // before in this hypothetical game's history — which makes cell 4 illegal under superko
    // (recreating that prior position) and nothing else.
    const historyBefore = new Set([witness[1]!]);
    const legalNoHistory = legalSuperkoCells(queues, toMove, new Set(), resolved);
    expect(legalNoHistory.map((m) => m.cell).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
    const legalBlocked = legalSuperkoCells(queues, toMove, historyBefore, resolved);
    expect(legalBlocked.map((m) => m.cell).sort((a, b) => a - b)).toEqual([2, 3, 5, 6, 7]);

    const result = solveSuperkoFromPosition(config, raw, { queues, toMove, historyBefore }, { wallClockMs: 5_000, maxNodesVisited: 50_000 });
    expect(result.budgetExceeded).toBe(false);
    // The real, searched value: worse than what the (now-blocked) witness promised.
    expect(result.value).toBe("loss");
    // Genuine recursion happened (not a single O(1) shortcut hit) — distinguishing this from the
    // no-legal-moves case above and from the WIN-witness-shortcut tests elsewhere in this file.
    expect(result.nodesVisited).toBeGreaterThan(1);

    // Cross-check: with an EMPTY history (nothing artificially blocked), the WIN-witness shortcut
    // fires immediately and agrees with the raw graph — confirming the "loss" above is really
    // caused by blocking the witness, not some unrelated fixture mistake.
    const resultUnblocked = solveSuperkoFromPosition(
      config,
      raw,
      { queues, toMove, historyBefore: new Set() },
      { wallClockMs: 5_000 }
    );
    expect(resultUnblocked.budgetExceeded).toBe(false);
    expect(resultUnblocked.value).toBe("win");
    expect(resultUnblocked.nodesVisited).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
// Regression test for the F2 amendments' item 8: `solveSuperko` used to wrap the root's
// `search.value()` call AND all 9 `search.valueOfMove()` opening calls in a single try/catch, so
// a budget exhausted PARTWAY THROUGH THE OPENINGS discarded an already-proven `rootValue` (and
// any openings already proven before the cutoff) in favor of the blanket pass-1/C2 fallback for
// EVERYTHING — even the root, which had already been proven moments earlier.
//
// None of the real 8 configs can exercise this end to end: under this game's real ruleset, root
// is either cheap enough that root+all 9 openings finish together in single-digit node counts
// (both playThrough=true configs), or hard enough that root itself doesn't resolve within
// millions of nodes (both playThrough=false hard configs, per the solve report's §1.5) — there is
// no real config where root is cheap but a later opening is expensive. So this test drives
// `solveSuperko` with a hand-built `RawSolveResult` whose shortcut data is fully controlled: cell
// 0's resulting position is (falsely, but harmlessly for this test) marked raw-LOSS, so root's
// own search resolves in one shortcut hit and opening cell 0 does too; every other cell's
// resulting position is marked "not in the raw graph", forcing `valueOfMove` to fall through into
// genuine recursive search (cheap to blow a tiny node budget on, by design). The raw/C2 fallback
// values are deliberately set to "draw" everywhere — a value that must NEVER appear as the
// reported rootValue or opening-0 value once this bug is fixed, since both were genuinely proven
// as "win" before the budget ran out on a later opening.
// ---------------------------------------------------------------------------------------

describe("solveSuperko() — a budget exhausted on a LATER opening must not discard an already-proven root/earlier-opening value", () => {
  it("keeps the proven rootValue and opening-0 value; only falls back for openings not yet proven", () => {
    const config = { decayTiming: "remove-first" as const, playThrough: false };
    const resolved: ResolvedRulesetConfig = {
      decayTiming: config.decayTiming,
      playThrough: config.playThrough,
      repetition: "superko",
      boardSize: 3,
      cap: 3,
    };

    const rootQueues: [number[], number[]] = [[], []];
    const cell0Result = transition(rootQueues, 0, 0, [0, 0], [0, 0], resolved);
    const cell0ChildKey = positionKey({ queues: cell0Result.queues, toMove: cell0Result.toMove });

    const openings: RawOpeningValue[] = [];
    for (let cell = 0; cell < 9; cell++) openings.push({ cell, value: "draw" });

    const fakeRaw: RawSolveResult = {
      reachableStates: 0,
      rootValue: "draw", // deliberately the WRONG value — must never surface once proven otherwise
      openings,
      valueAt(k: string) {
        if (k === cell0ChildKey) return "loss";
        throw new Error(`fakeRaw.valueAt: unexpected key ${k} (test bug, not the code under test)`);
      },
      graph: {
        nodes: { has: (k: string) => k === cell0ChildKey },
        initialHash: "",
      } as unknown as RawSolveResult["graph"],
      result: {} as unknown as RawSolveResult["result"],
    };

    const result = solveSuperko(config, fakeRaw, { maxNodesVisited: 3, wallClockMs: 30_000 });

    expect(result.budgetExceeded).toBe(true); // some opening genuinely didn't finish
    expect(result.rootValue).toBe("win"); // PROVEN — must not have been reset to the fake "draw"
    const byCell = new Map(result.openings.map((o) => [o.cell, o.value] as const));
    expect(byCell.get(0)).toBe("win"); // PROVEN via the same shortcut root used
    // At least one later opening must have actually fallen back to the fake C2 value — otherwise
    // this fixture isn't exercising the budget-exhaustion path at all.
    expect([...byCell.entries()].some(([cell, value]) => cell !== 0 && value === "draw")).toBe(true);
  });
});

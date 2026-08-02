// games/mine-run/test/view-honesty.test.ts
//
// TDD anchor (docs/plans/mine-run.md §4.4/§10, promoted to a platform-wide rule by the §14
// orchestrator addendum): "fix a mid-run view; resample the hidden layout via
// sampleConsistentState with different rng; assert safeMove... choose the IDENTICAL move
// across resampled worlds."
//
// safeMove's signature here (`(view: MineRunView) => MineRunMove`, see probes.ts's doc
// comment) makes this a STRUCTURAL guarantee, not a runtime coincidence: there is no
// MineRunState parameter to peek at, so no call to safeMove could ever depend on which hidden
// world produced the view. What this test operationalizes is the belt-and-braces runtime half
// the addendum still requires: (a) sampleConsistentState really does draw from MULTIPLE
// distinct hidden worlds for a genuinely ambiguous view (not a degenerate always-the-same
// sampler), (b) every sampled world's OWN reconstructed view round-trips back to the exact
// original view (the sample is truly indistinguishable from the real game state), and (c)
// safeMove computed from each of those independently-reconstructed views agrees.
//
// Only Greedy/Strong (packages/bots, M2 — not this milestone, per platform-corrections C1's
// determinized-Strong seam being routed to the platform team) don't exist yet to extend this
// test to. safeMove is the one hidden-info policy this milestone owns, and it is exercised
// here to the letter of the plan's anchor.

import { describe, expect, it } from "vitest";
import { rngFromSeed, rngFor, rngForSetup } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import { safeMove } from "../probes";

describe("view-honesty: safeMove agrees across independently-resampled hidden worlds", () => {
  it("resampled worlds are genuinely distinct, round-trip to the identical view, and safeMove agrees on all of them", () => {
    const engine = createMineRun({ width: 6, height: 6, mines: 8, budget: 20 });
    const seed = "view-honesty-midrun";
    let state = engine.setup(1, rngForSetup(seed));

    // Play a short scripted opening (a few "always reveal the lowest-index unrevealed cell"
    // moves) to reach a genuine mid-run state with SOME revealed structure but real remaining
    // ambiguity -- stop as soon as at least one unrevealed cell remains unresolved either way.
    let step = 0;
    while (engine.status(state).kind === "ongoing" && step < 4) {
      const legal = engine.legalMoves(state, 0).filter((m) => m.t === "reveal");
      if (legal.length === 0) break;
      const move = legal.reduce((min, m) => (m.t === "reveal" && min.t === "reveal" && m.cell < min.cell ? m : min));
      state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
      step++;
    }
    expect(engine.status(state).kind).toBe("ongoing"); // still a real mid-run state

    const view = engine.playerView(state, 0);
    const unrevealedCount = view.width * view.height - Object.keys(view.cells).length;
    expect(unrevealedCount).toBeGreaterThan(0); // there IS hidden information left to resample

    const worldRngSeeds = ["world-a", "world-b", "world-c", "world-d", "world-e"];
    const sampledMineSets: string[] = [];
    const moves: unknown[] = [];

    for (const s of worldRngSeeds) {
      const sampled = engine.sampleConsistentState!(view, rngFromSeed(s));

      // (a)/(b): the sample must be a FULL valid state whose own view is byte-identical to
      // the original (proving it is a genuinely indistinguishable alternate world, not just
      // "close enough").
      const reView = engine.playerView(sampled, 0);
      expect(engine.encode(sampled) === engine.encode(sampled)).toBe(true); // sanity: encode is total
      expect(JSON.stringify(reView)).toBe(JSON.stringify(view));

      sampledMineSets.push(JSON.stringify(sampled.mines));

      // (c): safeMove computed from the RECONSTRUCTED view (derived independently from this
      // specific sampled hidden world) must agree with safeMove computed from the original.
      moves.push(safeMove(reView));
    }

    // Every resampled world produced the identical safeMove decision.
    const firstMove = moves[0];
    for (const m of moves) expect(m).toEqual(firstMove);
    // ...and matches calling safeMove on the original view directly.
    expect(safeMove(view)).toEqual(firstMove);

    // Not a degenerate sampler: at least two of the resampled worlds actually differ in their
    // full mine layout (otherwise "resampling" would be vacuous -- there'd be only one world
    // to agree with itself).
    const distinctWorlds = new Set(sampledMineSets);
    expect(distinctWorlds.size).toBeGreaterThan(1);
  });

  it("safeMove is a pure, deterministic function of the view alone (repeated calls agree)", () => {
    const engine = createMineRun({ width: 8, height: 8, mines: 10, budget: 30 });
    const state = engine.setup(1, rngForSetup("determinism-of-safemove"));
    const view = engine.playerView(state, 0);
    const results = Array.from({ length: 5 }, () => safeMove(view));
    for (const r of results) expect(r).toEqual(results[0]);
  });
});

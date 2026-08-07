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
// Extended (docs/plans/mine-run-risk-aware-policy.md §2/§3, platform-corrections.md C39's S1
// ruling) to cover `riskAwareMove` (risk-policy.ts) the identical way, BEFORE any tuning run
// against it is trusted: "C1 has failed twice in this codebase and Mine Run is precisely the
// game where an omniscient policy posts excellent numbers on an unplayable game." Same
// structural guarantee applies — `riskAwareMove`'s signature is `(view: MineRunView) =>
// MineRunMove`, and its default (Tier B) risk source is `analyzeFrontier(view)`, itself already
// proven view-honest by construction (csp.ts's own module doc: every function there takes a
// MineRunView, never MineRunState/mines) — so there is no parameter anywhere in the call chain
// that could carry which hidden world produced the view.

import { describe, expect, it } from "vitest";
import { rngFromSeed, rngFor, rngForSetup } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import type { MineRunView } from "../engine";
import { safeMove } from "../probes";
import { riskAwareMove, riskAwareRolloutSelector } from "../risk-policy";

/**
 * `lastEffects` is excluded from the round-trip comparison below, deliberately. It is
 * transient per-transition presentation echo, not part of a state's canonical identity —
 * the SAME convention `encode()` already enforces platform-wide (types.ts: "EXCLUDES
 * lastEffects [...] effects are recomputable by re-applying") and that `decode()` enforces
 * literally (`decode(x).lastEffects === []`, asserted by checkEncodeDecodeAndEffects).
 * `sampleConsistentState` is, in effect, reconstructing a state the way `decode()` would —
 * from a snapshot of visible information, not from a specific preceding apply() call — so it
 * has no "last move" to echo and correctly returns `lastEffects: []` (see csp.ts, which
 * builds every sampled MineRunState with `lastEffects: []` explicitly, matching decode()'s
 * documented contract exactly). Demanding byte-identical `lastEffects` here would be
 * demanding the sampler reconstruct which SPECIFIC move produced the original state's last
 * transition in this hypothetical alternate world — a different and unnecessary problem, not
 * what "consistent with the view" means. Every OTHER field (cells, counts, streak, banked,
 * budget) still must match byte-for-byte, which is what actually proves the sample is
 * indistinguishable from the real game state for decision-making purposes.
 */
function withoutEffects(view: MineRunView): Omit<MineRunView, "lastEffects"> {
  const {
    width,
    height,
    cells,
    minesTotal,
    minesExploded,
    streakLen,
    streakValue,
    nextGain,
    banked,
    revealsLeft,
  } = view;
  return { width, height, cells, minesTotal, minesExploded, streakLen, streakValue, nextGain, banked, revealsLeft };
}

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

      // (a)/(b): the sample must be a FULL valid state whose own view is identical to the
      // original MODULO lastEffects (proving it is a genuinely indistinguishable alternate
      // world, not just "close enough") — see withoutEffects()'s doc comment for why
      // lastEffects itself is excluded from this comparison.
      const reView = engine.playerView(sampled, 0);
      expect(engine.encode(sampled) === engine.encode(sampled)).toBe(true); // sanity: encode is total
      expect(JSON.stringify(withoutEffects(reView))).toBe(JSON.stringify(withoutEffects(view)));
      // sampleConsistentState has no preceding move of its own to echo — it always reports
      // lastEffects: [], the same convention decode() uses (types.ts: "decode(x).lastEffects
      // === []"). Pinned here so a future change to that convention is a deliberate decision.
      expect(reView.lastEffects).toEqual([]);

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

describe("view-honesty: riskAwareMove agrees across independently-resampled hidden worlds (S1, C39)", () => {
  it("resampled worlds are genuinely distinct, round-trip to the identical view, and riskAwareMove agrees on all of them", () => {
    const engine = createMineRun({ width: 6, height: 6, mines: 8, budget: 20 });
    const seed = "view-honesty-midrun-risk";
    let state = engine.setup(1, rngForSetup(seed));

    // Same scripted opening as the safeMove test above — reach a genuine mid-run state with
    // real remaining ambiguity, not a hand-picked one that happens to favor this policy.
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
    expect(unrevealedCount).toBeGreaterThan(0);

    const worldRngSeeds = ["world-a", "world-b", "world-c", "world-d", "world-e"];
    const sampledMineSets: string[] = [];
    const moves: unknown[] = [];

    for (const s of worldRngSeeds) {
      const sampled = engine.sampleConsistentState!(view, rngFromSeed(s));

      const reView = engine.playerView(sampled, 0);
      expect(JSON.stringify(withoutEffects(reView))).toBe(JSON.stringify(withoutEffects(view)));
      expect(reView.lastEffects).toEqual([]);

      sampledMineSets.push(JSON.stringify(sampled.mines));

      // riskAwareMove computed from the RECONSTRUCTED view (derived independently from this
      // specific sampled hidden world, default Tier B risk source `analyzeFrontier`) must agree
      // with riskAwareMove computed from the original.
      moves.push(riskAwareMove(reView));
    }

    const firstMove = moves[0];
    for (const m of moves) expect(m).toEqual(firstMove);
    expect(riskAwareMove(view)).toEqual(firstMove);

    const distinctWorlds = new Set(sampledMineSets);
    expect(distinctWorlds.size).toBeGreaterThan(1);
  });

  it("riskAwareMove is a pure, deterministic function of the view alone (repeated calls agree)", () => {
    const engine = createMineRun({ width: 8, height: 8, mines: 10, budget: 30 });
    const state = engine.setup(1, rngForSetup("determinism-of-riskawaremove"));
    const view = engine.playerView(state, 0);
    const results = Array.from({ length: 5 }, () => riskAwareMove(view));
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it("riskAwareRolloutSelector (the rollout adapter) derives its view via engine.playerView and never touches state.mines", () => {
    // The adapter's own contract (risk-policy.ts's doc): a rollout MoveSelector receives `state`
    // that may be a sampleConsistentState-sampled hypothetical world, never the true secret.
    // Proven here the same way the safeMove test above proves it for the base policy: resample
    // several independent worlds consistent with ONE fixed view, run the adapter against each
    // full sampled STATE (not the view directly, since that's the adapter's whole point), and
    // confirm every one agrees with chooseRiskAwareMove(view) computed directly.
    const engine = createMineRun({ width: 6, height: 6, mines: 8, budget: 20 });
    const seed = "view-honesty-adapter";
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
    const directMove = riskAwareMove(view);
    const legal = engine.legalMoves(state, 0);

    const worldRngSeeds = ["adapter-world-a", "adapter-world-b", "adapter-world-c"];
    const sampledMineSets: string[] = [];
    for (const s of worldRngSeeds) {
      const sampled = engine.sampleConsistentState!(view, rngFromSeed(s));
      sampledMineSets.push(JSON.stringify(sampled.mines));
      const viaAdapter = riskAwareRolloutSelector(engine, sampled, 0, legal, rngFromSeed(`${s}:selector`));
      expect(viaAdapter).toEqual(directMove);
    }
    const distinctWorlds = new Set(sampledMineSets);
    expect(distinctWorlds.size).toBeGreaterThan(1);
  });
});

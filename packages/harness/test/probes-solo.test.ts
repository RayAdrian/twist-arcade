// packages/harness/test/probes-solo.test.ts — verifies the WIP probes-solo.ts (committed at
// 1003679, never previously exercised) AND, per this milestone's standing warning ("a guard
// that doesn't guard" is this project's recurring defect), PLANTS a real violation of each
// gate and confirms it fires. A gate never observed failing is not a gate.

import { describe, expect, it } from "vitest";
import { deriveView } from "@twist-arcade/bots";
import { createMineRun, safeMove as mineRunSafeMove } from "@twist-arcade/mine-run";
import type { MineRunMove, MineRunState, MineRunView } from "@twist-arcade/mine-run";
import type { GameEngine, Rng } from "@twist-arcade/engine";
import { buildSoloRoster, type SoloAgent } from "../src/agents";
import {
  alwaysSafeVsStrongRatio,
  grindProbe,
  MissingSafeMoveError,
  runAlwaysSafeProbe,
} from "../src/probes-solo";
import { runSoloAgentOverSeeds, pairedSeeds } from "../src/solo-runner";
import {
  createAlwaysSafeBrokenMineRun,
  createAlwaysSafeHealthyMineRun,
  createGrindBoundedStreakZeroBankMineRun,
  createGrindBrokenMineRun,
  createGrindStreakNeverResetsMineRun,
} from "./fixtures/mine-run-mutants";

// ---------------------------------------------------------------------------------------
// A test-local, K-sample, GREEDY-ROLLOUT Strong agent for Mine Run — NOT the shipped
// agents.ts wiring. See the harness handoff report for the full finding; short version:
// agents.ts's shipped `resolveStrongPolicy` for hidden-info games wraps the generic
// `flatMonteCarloPolicy()` (packages/bots) through `determinize()` at its default
// `samples: 1`. Two things compound on Mine Run specifically:
//   1. `flatMonteCarloPolicy`'s internal rollout is UNIFORM RANDOM continuation
//      (packages/bots/src/search-utils.ts), not the GREEDY rollout mine-run.md §4.4's
//      "Decided mechanism" specifies ("sample K consistent layouts, roll out with the
//      GREEDY policy to terminal, average").
//   2. Even swapping in a greedy rollout, a 1-ply evaluator on bare `engine.score()`
//      (== `banked`) is blind to an unbanked streak: revealing never raises `banked` in a
//      single step, so a score()-only greedy walk always prefers banking immediately —
//      Mine Run has no shipped `heuristic.ts` (mine-run.md §4.5 spec'd one; games/mine-run
//      has none), so `packages/bots`'s `greedyOnlyPolicy`/beam's shared `evaluate()` falls
//      back to bare `score()` for this engine today, with the same blind spot.
// This helper fixes both for evaluation purposes ONLY, inside this test: rollouts are
// greedy on `banked + streakValue` ("value if I banked right now" — the natural read of
// mine-run.md §4.5's own "bank vs best-risk reveal by immediate expected points"), and K
// worlds are sampled and averaged per candidate move, still through the SAME sanctioned
// `deriveView`/`sampleConsistentState` seam (C1) — never the real state. This is the
// smallest way to validate the Always-Safe GATE ITSELF against a real, hidden-information
// engine without taking a side on the open Strong-policy design question (O1).
// ---------------------------------------------------------------------------------------

function potentialValue(s: MineRunState): number {
  return s.banked + s.streakValue;
}

function greedyRolloutScore(
  engine: GameEngine<MineRunState, MineRunMove, MineRunView>,
  world: MineRunState,
  rng: Rng,
  maxPlies: number
): number {
  let s = world;
  let status = engine.status(s);
  let plies = 0;
  while (status.kind === "ongoing" && plies < maxPlies) {
    const legal = engine.legalMoves(s, 0);
    let best = legal[0]!;
    let bestVal = Number.NEGATIVE_INFINITY;
    for (const m of legal) {
      const next = engine.apply(s, new Map([[0, m]]), rng);
      const val = potentialValue(next);
      if (val > bestVal) {
        bestVal = val;
        best = m;
      }
    }
    s = engine.apply(s, new Map([[0, best]]), rng);
    status = engine.status(s);
    plies += 1;
  }
  return engine.score!(s, 0);
}

function buildGreedyRolloutStrongAgent(
  engine: GameEngine<MineRunState, MineRunMove, MineRunView>,
  samples: number,
  rolloutCapPlies: number
): SoloAgent<MineRunState, MineRunMove> {
  return {
    name: "strong-greedy-rollout",
    // Not built via buildAgent/buildViewPolicyAgent/buildSafeMoveAgent (this file's own
    // top-of-suite comment explains why: none of the three sanctioned constructors give a
    // GREEDY rollout, only this test-local one does), but genuinely view-honest by
    // construction: `chooseMove` below never reads `state` for anything except passing it
    // straight to `deriveView`/`sampleConsistentState` — every candidate move and rollout is
    // evaluated against a freshly sampled world, never the real secret. Setting this by hand
    // is exactly the documented escape hatch (agents.ts's `SoloAgent.viewHonest` doc) for an
    // agent author who independently verified honesty outside the three constructors.
    viewHonest: true,
    chooseMove({ engine: e, state, player, rng, clock }) {
      const start = clock.now();
      const view = deriveView(e, state, player);
      // Candidate moves come off a freshly sampled world's legalMoves(), never the real
      // state — for Mine Run every consistent world agrees on the legal-move set (it only
      // depends on revealed/streak bookkeeping, which the view already carries in full).
      const probe = e.sampleConsistentState!(view, rng);
      const legal = e.legalMoves(probe, player);
      let bestMove = legal[0]!;
      let bestAverage = Number.NEGATIVE_INFINITY;
      let rollouts = 0;
      for (const move of legal) {
        let sum = 0;
        for (let k = 0; k < samples; k++) {
          const world = e.sampleConsistentState!(view, rng);
          const next = e.apply(world, new Map([[player, move]]), rng);
          sum += greedyRolloutScore(e, next, rng, rolloutCapPlies);
          rollouts += 1;
        }
        const average = sum / samples;
        if (average > bestAverage) {
          bestAverage = average;
          bestMove = move;
        }
      }
      return {
        move: bestMove,
        stats: { elapsedMs: clock.now() - start, rollouts, rootValue: bestAverage },
      };
    },
  };
}

describe("grindProbe — the real, shipping Mine Run engine", () => {
  it("finds nothing on the real engine (structural termination proof, mine-run.md §4.1)", () => {
    const engine = createMineRun({ width: 5, height: 5, mines: 5, budget: 20 });
    const result = grindProbe(engine, { startSeeds: pairedSeeds("grind-real", 3) });
    expect(result.found).toBe(false);
  }, 15_000);
});

describe("grindProbe — planted violation (docs/plans/mine-run.md §4.1's own worked example)", () => {
  it("catches a bank-legal-at-streak-0 mutant as a length-1, zero-risk, zero-cost cycle", () => {
    const engine = createGrindBrokenMineRun({ width: 5, height: 5, mines: 5, budget: 20 });
    const result = grindProbe(engine, { startSeeds: pairedSeeds("grind-broken", 3) });
    expect(result.found).toBe(true);
    expect(result.cycle).toBeDefined();
    expect(result.cycle!.length).toBe(1);
    expect(result.cycle![0]!.move).toEqual({ t: "bank" });
    expect(result.scoreDelta).toBe(0); // zero-risk AND zero-gain — still a hard-fail shape
  }, 15_000);
});

describe("grindProbe — C9 correction: the probe must not be blind to score living inside canonical state", () => {
  it("catches a mutant whose bank credits streakValue but never resets the streak — a genuine infinite zero-risk farm the OLD encode()-equality check could never see (banked strictly increases every iteration)", () => {
    // This is platform-corrections.md C9's own executed counterexample: `banked` lives
    // inside `encode(state)`, so the old `encode(next) === encode(start)` check could only
    // ever match a byte-IDENTICAL repeat — a real, indefinitely-repeatable farm where the
    // score itself keeps climbing was structurally invisible to it. The fixed probe instead
    // confirms repeatability directly: does the SAME move sequence stay legal and keep
    // producing the SAME (non-negative) delta, over and over, regardless of whether the
    // full encoded state ever repeats.
    const engine = createGrindStreakNeverResetsMineRun({ width: 5, height: 5, mines: 5, budget: 20 });
    const result = grindProbe(engine, { startSeeds: pairedSeeds("grind-streak-never-resets", 3) });
    expect(result.found).toBe(true);
    expect(result.cycle).toBeDefined();
    expect(result.cycle!.length).toBe(1);
    expect(result.cycle![0]!.move).toEqual({ t: "bank" });
    expect(result.scoreDelta).toBeGreaterThan(0); // a real, growing gain each iteration — not the streak-0 zero-gain shape
  }, 15_000);

  it("does NOT flag a BOUNDED legal no-op (same streak-0-bank shape, but this one also costs one unit of the reveal budget) — bounded is not a farm, even though a single repeat looks identical to the unbounded case", () => {
    // Contrast case (the finding's "verified clean in the over-fire direction"): reuses the
    // exact bank-legal-at-streak-0/zero-delta shape from createGrindBrokenMineRun, but this
    // variant also decrements revealsLeft each time, so it can only repeat `budget` times
    // before `bank` becomes illegal again (this mutant's own isLegal gates it on
    // revealsLeft > 0). A tiny budget (3) guarantees it runs out long before any reasonable
    // confirmation count — proving the fix's repeatability check isn't satisfied by "happened
    // to repeat a few times", only by "keeps being legal indefinitely". maxCycleLength: 1
    // keeps this fast (no need to search deeper than the single self-referential move).
    const engine = createGrindBoundedStreakZeroBankMineRun({ width: 5, height: 5, mines: 5, budget: 3 });
    const result = grindProbe(engine, {
      startSeeds: pairedSeeds("grind-bounded-noop", 3),
      maxCycleLength: 1,
      walkLength: 0,
    });
    expect(result.found).toBe(false);
  }, 15_000);
});

describe("runAlwaysSafeProbe", () => {
  it("hard-errors (MissingSafeMoveError) when no safeMove hook is supplied — never a silent skip", () => {
    const engine = createMineRun({ width: 4, height: 4, mines: 2, budget: 16 });
    expect(() => runAlwaysSafeProbe(engine, undefined, pairedSeeds("no-hook", 3))).toThrow(
      MissingSafeMoveError
    );
  });
});

describe("alwaysSafeVsStrongRatio — real engine vs. a planted density violation (mine-run.md §4.2)", () => {
  // solo-games-lens §3.1 specifies N=1,000 paired runs per policy for a real CI suite; this
  // test uses a much smaller N (still paired, still real gameplay) purely to keep unit-test
  // wall time reasonable. At small N, per-seed variance is real — an earlier 10-seed draw
  // landed at ratio 0.965 for the "healthy" config (just above the 0.95 line) purely from
  // sampling noise, even though a 10-seed draw with a DIFFERENT seed prefix landed at 0.73.
  // 40 seeds is enough to make that noise negligible at this board's score scale without
  // pushing the suite's wall time past a few seconds.
  const seeds = pairedSeeds("always-safe-gate", 40);
  const moveCap = 30;
  const SAMPLES = 4;
  const ROLLOUT_CAP_PLIES = 30;

  it("healthy density (~22%): Always-Safe stays below the 0.95 hard-fail line", () => {
    const engine = createAlwaysSafeHealthyMineRun();
    const strong = runSoloAgentOverSeeds(
      engine,
      buildGreedyRolloutStrongAgent(engine, SAMPLES, ROLLOUT_CAP_PLIES),
      seeds,
      { moveCap }
    );
    const alwaysSafe = runAlwaysSafeProbe(engine, mineRunSafeMove, seeds, { moveCap });
    const ratio = alwaysSafeVsStrongRatio(alwaysSafe, strong);
    expect(ratio).toBeLessThan(0.95);
  }, 30_000);

  it("planted violation — near-zero density (~5.5%): Always-Safe closes to >= 0.95 of Strong (the risk is fake)", () => {
    const engine = createAlwaysSafeBrokenMineRun();
    const strong = runSoloAgentOverSeeds(
      engine,
      buildGreedyRolloutStrongAgent(engine, SAMPLES, ROLLOUT_CAP_PLIES),
      seeds,
      { moveCap }
    );
    const alwaysSafe = runAlwaysSafeProbe(engine, mineRunSafeMove, seeds, { moveCap });
    const ratio = alwaysSafeVsStrongRatio(alwaysSafe, strong);
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  }, 30_000);

  it("sanity: the SHIPPED default-wiring roster.strong still runs end-to-end here", () => {
    // Not a gate assertion (see this file's top-of-suite comment for why) — agents.ts's own
    // view-honesty is already covered by agents.test.ts's C1 suite. This only confirms
    // buildSoloRoster(engine).strong runs without throwing, so a future reader doesn't
    // mistake this file's greedy-rollout agent for a replacement of the shipped roster.
    // UPDATE (platform-corrections.md C6): as of this milestone, the shipped wiring itself is
    // K-sample (STRONG_HIDDEN_INFO_SAMPLES) determinized flat-MC with a GREEDY rollout — see
    // "Always-Safe validation against the SHIPPED roster.strong" below for the gate re-run this
    // fix was actually FOR.
    const engine = createAlwaysSafeHealthyMineRun();
    const strong = runSoloAgentOverSeeds(engine, buildSoloRoster(engine).strong, pairedSeeds("sanity", 2), {
      budget: { kind: "rollouts", n: 50 },
      moveCap,
    });
    expect(strong.scores).toHaveLength(2);
  }, 15_000);
});

// ---------------------------------------------------------------------------------------
// Always-Safe validation against the SHIPPED roster.strong (platform-corrections.md C6's
// actual close-out). The two suites above validate the Always-Safe GATE MECHANISM using a
// test-local, K-sample, greedy-rollout Strong built by hand inside this file — proving the
// gate CAN separate a healthy Mine Run from a degenerate one when given a strong-enough
// yardstick. C6's finding was that the SHIPPED wiring (agents.ts's buildSoloRoster/
// resolveStrongPolicy, before this milestone: determinize(flatMonteCarloPolicy()) at the
// default samples=1, with flatMonteCarloPolicy's rollout uniform-random) could NOT reproduce
// that separation — a weak Strong collapses the ratio toward 1 on a good game (false fail) and
// stops catching a genuinely degenerate one once any threshold is loosened to compensate
// (false pass). This suite re-runs the identical healthy/broken comparison against
// `buildSoloRoster(engine).strong` itself and confirms the SAME separation holds with the
// real, shipped agent — not a stand-in.
//
// The shipped agent is now `determinizedFlatMonteCarloPolicy` (packages/bots) with a greedy
// rollout, wired directly (not through `determinize()`'s generic per-world-vote wrapping —
// see agents.ts's `resolveStrongPolicy`/`buildSoloRoster` doc comments for why that shape
// under-delivered even AFTER adding a greedy rollout: it draws K worlds ONCE per decision and
// majority-votes full per-world re-searches, which lets a rare catastrophic world get
// out-voted). Two empirical findings from tuning this suite, worth recording:
//   1. A `rollouts` budget of ~60 (a handful of samples per candidate at this board's ~30-cell
//      branching factor) reproduced the exact same ratio as a naive majority-vote wrapper —
//      not because the averaging fix didn't matter (packages/bots/test/
//      determinized-flat-mc.test.ts proves it does, on a fixture designed to show it), but
//      because at low N the ROOT decision (the widest branching factor, ~36 candidates) gets
//      only ~1 sample each — too little for the averaging to out-perform a vote at all.
//   2. Raising the budget to 400 (~10+ samples per candidate even at the widest branching
//      factor) is what actually produced separation — confirming the bottleneck was sample
//      count at the root, not the aggregation architecture in isolation. Both mattered.
describe("alwaysSafeVsStrongRatio — against the SHIPPED buildSoloRoster(engine).strong (C6 close-out)", () => {
  const seeds = pairedSeeds("shipped-strong-gate", 20);
  const moveCapShipped = 30;
  const budget = { kind: "rollouts" as const, n: 400 };

  it("healthy density (~22%): Always-Safe stays below the 0.95 hard-fail line against the shipped Strong", () => {
    const engine = createAlwaysSafeHealthyMineRun();
    const strong = runSoloAgentOverSeeds(engine, buildSoloRoster(engine).strong, seeds, {
      budget,
      moveCap: moveCapShipped,
    });
    const alwaysSafe = runAlwaysSafeProbe(engine, mineRunSafeMove, seeds, { moveCap: moveCapShipped });
    const ratio = alwaysSafeVsStrongRatio(alwaysSafe, strong);
    expect(ratio).toBeLessThan(0.95);
  }, 120_000);

  it("planted violation — near-zero density (~5.5%): Always-Safe closes to >= 0.95 of the shipped Strong (the risk is fake)", () => {
    const engine = createAlwaysSafeBrokenMineRun();
    const strong = runSoloAgentOverSeeds(engine, buildSoloRoster(engine).strong, seeds, {
      budget,
      moveCap: moveCapShipped,
    });
    const alwaysSafe = runAlwaysSafeProbe(engine, mineRunSafeMove, seeds, { moveCap: moveCapShipped });
    const ratio = alwaysSafeVsStrongRatio(alwaysSafe, strong);
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  }, 120_000);
});

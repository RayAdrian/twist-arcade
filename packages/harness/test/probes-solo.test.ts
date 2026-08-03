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
  createGrindBrokenMineRun,
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

  it("sanity: the SHIPPED default-wiring roster.strong (samples=1, random rollout) still runs end-to-end here", () => {
    // Not a gate assertion (see this file's top-of-suite comment for why) — agents.ts's own
    // view-honesty is already covered by agents.test.ts's C1 suite. This only confirms
    // buildSoloRoster(engine).strong runs without throwing, so a future reader doesn't
    // mistake this file's greedy-rollout agent for a replacement of the shipped roster.
    const engine = createAlwaysSafeHealthyMineRun();
    const strong = runSoloAgentOverSeeds(engine, buildSoloRoster(engine).strong, pairedSeeds("sanity", 2), {
      budget: { kind: "rollouts", n: 50 },
      moveCap,
    });
    expect(strong.scores).toHaveLength(2);
  }, 15_000);
});

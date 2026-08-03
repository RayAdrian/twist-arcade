// packages/harness/test/agents.test.ts — verifies the WIP agents.ts (committed at 1003679,
// never previously exercised): the uniform SoloAgent wrapper, the Strong-policy resolver
// (beam for scored/heuristic games, flat-MC for hidden-info, a hard error for neither), the
// mandatory safeMove wrapper, and — the sharpest platform interaction (platform-corrections
// C1) — that a hidden-information game's roster is actually routed through determinize()/
// deriveView() rather than handed the real canonical state.

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { createBankRun } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { miniCrackstep } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { createMineRun } from "@twist-arcade/mine-run";
import { safeMove as mineRunSafeMove } from "@twist-arcade/mine-run";
import {
  buildSafeMoveAgent,
  buildSoloRoster,
  resolveStrongPolicy,
  StrongPolicyUnavailableError,
  staticClock,
} from "../src/agents";

describe("resolveStrongPolicy", () => {
  it("throws StrongPolicyUnavailableError for a puzzle engine with neither score() nor heuristic()", () => {
    expect(() => resolveStrongPolicy(miniCrackstep)).toThrow(StrongPolicyUnavailableError);
  });

  it("does not throw for a scored perfect-info game (bank-run) — beam is available", () => {
    const engine = createBankRun();
    expect(() => resolveStrongPolicy(engine)).not.toThrow();
  });

  it("does not throw for a hidden-information game (mine-run) — flat-MC is available regardless of score()", () => {
    const engine = createMineRun({ width: 4, height: 4, mines: 2, budget: 16 });
    expect(() => resolveStrongPolicy(engine)).not.toThrow();
  });
});

describe("buildSoloRoster — perfect-info (bank-run)", () => {
  const engine = createBankRun({ successProb: 0.6 });
  const roster = buildSoloRoster(engine);

  it("builds random/greedy/strong agents that each produce a legal move", () => {
    const state = engine.setup(1, rngFromSeed("roster-seed:setup"));
    for (const agent of [roster.random, roster.greedy, roster.strong]) {
      const { move } = agent.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed("roster-seed:decision"),
        budget: { kind: "rollouts", n: 50 },
        clock: staticClock(),
      });
      expect(engine.isLegal(state, 0, move)).toBe(true);
    }
  });
});

describe("buildSafeMoveAgent", () => {
  it("wraps a per-game safeMove hook as a SoloAgent named 'always-safe'", () => {
    const engine = createBankRun({ successProb: 0.6 });
    const agent = buildSafeMoveAgent(engine, (view) => (view.streak >= 1 ? { kind: "bank" } : { kind: "push" }));
    expect(agent.name).toBe("always-safe");
    const state = engine.setup(1, rngFromSeed("safe-seed:setup"));
    const { move, stats } = agent.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("safe-seed:decision"),
      budget: { kind: "rollouts", n: 1 },
      clock: staticClock(),
    });
    expect(move).toEqual({ kind: "push" }); // streak starts at 0
    expect(stats.rollouts).toBe(0); // safeMove is a pure lookup, not a search
  });
});

describe("C1 — hidden-information view honesty (mine-run)", () => {
  // Two DIFFERENT real mine layouts that project to the IDENTICAL view (nothing revealed yet
  // beyond setup's opening region on a board built so the opening is a single non-zero cell,
  // so the "view" carries almost no information to discriminate the two worlds by).
  const engine = createMineRun({ width: 4, height: 4, mines: 6, budget: 16 });

  it("buildAgent wraps a hidden-info engine's roster agent so it never receives the real state", () => {
    const roster = buildSoloRoster(engine);
    const state = engine.setup(1, rngFromSeed("view-honesty-seed:setup"));

    // Build a second, structurally different state (different mine layout) that projects to
    // the SAME view as `state` — the harness must return the SAME move for both when driven
    // by the safe-move / strong agent, because both only ever see playerView(state, 0).
    const view = engine.playerView(state, 0);
    const resampled = engine.sampleConsistentState!(view, rngFromSeed("resample-seed"));
    expect(engine.playerView(resampled, 0)).toEqual(view); // sanity: resampled really shares the view
    // Note (fold-in): without this, the test below would pass vacuously if `resampled` ever
    // happened to equal `state` outright (true today only by seed luck) — pin that the two
    // canonical states are actually DIFFERENT worlds, so "same move for both" is proving
    // something about view-honesty, not just "same move for the same state twice".
    expect(engine.encode(resampled)).not.toBe(engine.encode(state));

    const budget = { kind: "rollouts" as const, n: 20 };
    const clock = staticClock();
    const moveFromReal = roster.strong.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("strong-decision-seed"),
      budget,
      clock,
    }).move;
    const moveFromResampled = roster.strong.chooseMove({
      engine,
      state: resampled,
      player: 0,
      rng: rngFromSeed("strong-decision-seed"),
      budget,
      clock,
    }).move;
    // Both invocations only ever hand the policy `deriveView(engine, state, 0)`, which is
    // identical for `state` and `resampled` — so an honest (determinized) strong agent must
    // return the same move regardless of which real world it was actually called with. If
    // buildAgent ever regressed to handing the base policy `state` directly (skipping
    // determinize/deriveView), this would be the first place two different mine layouts could
    // produce two different "strong" moves for what the player experiences as the same board.
    expect(moveFromReal).toEqual(moveFromResampled);
  });

  it("buildSafeMoveAgent only ever calls engine.playerView(state, player), never touches state.mines directly", () => {
    // safeMove's own type signature (SafeMoveFn<M, V>) takes V, not S — this test pins that a
    // real hidden-info hook (mine-run's own safeMove) plugged in through buildSafeMoveAgent
    // gets a genuine view object indistinguishable from any other state sharing that view.
    const agent = buildSafeMoveAgent(engine, mineRunSafeMove);
    const state = engine.setup(1, rngFromSeed("safe-mine-seed:setup"));
    const view = engine.playerView(state, 0);
    const resampled = engine.sampleConsistentState!(view, rngFromSeed("safe-resample-seed"));
    // Same fold-in as the test above: prove `resampled` is a genuinely different world, not a
    // vacuous "same move for the same state" pass.
    expect(engine.encode(resampled)).not.toBe(engine.encode(state));
    const { move: moveA } = agent.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("x"),
      budget: { kind: "rollouts", n: 1 },
      clock: staticClock(),
    });
    const { move: moveB } = agent.chooseMove({
      engine,
      state: resampled,
      player: 0,
      rng: rngFromSeed("x"),
      budget: { kind: "rollouts", n: 1 },
      clock: staticClock(),
    });
    expect(moveA).toEqual(moveB);
  });
});

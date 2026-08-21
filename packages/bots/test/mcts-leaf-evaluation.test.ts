// packages/bots/test/mcts-leaf-evaluation.test.ts — MctsOptions.leafEvaluation, the named
// spelling of what platform-corrections.md C87–C90/C92 call "leaf evaluation": skip the
// post-tree rollout and score the newly-expanded leaf directly via valueOfStatus's "ongoing"
// branch (score()/heuristic()). Before this option existed, the ONLY way to reach that behavior
// was `rolloutCapPlies: 0` — an accident of `rolloutToHorizon`'s `plies < maxPlies` loop guard
// happening to run zero iterations at that value, not a stated intent anywhere in mcts.ts.
//
// Isolated in its own file (rather than folded into mcts.test.ts) because it is the one place in
// this package that mocks search-utils.ts — a real spy WRAPPING the genuine `rolloutToHorizon`
// (never a stub/fake), so every assertion here is still exercising the real algorithm; the
// isolation just keeps that `vi.mock` from having to coexist with mcts.test.ts's much larger
// real-search suite in the same module graph.

import { describe, expect, it, vi } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { fakeClock } from "./helpers";

vi.mock("../src/search-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/search-utils")>();
  return { ...actual, rolloutToHorizon: vi.fn(actual.rolloutToHorizon) };
});

// These two imports must textually follow the vi.mock call above, per Vitest's hoisting
// contract — vi.mock calls are hoisted to the top of the file, but the module bindings below
// still need to resolve against the mocked module graph.
import { rolloutToHorizon } from "../src/search-utils";
import { mctsPolicy } from "../src/mcts";

const rolloutToHorizonSpy = vi.mocked(rolloutToHorizon);

describe("mctsPolicy MctsOptions.leafEvaluation", () => {
  const engine = classicTicTacToe;

  it("skips the rollout phase entirely: rolloutToHorizon is never called", () => {
    rolloutToHorizonSpy.mockClear();
    const state = engine.setup(2, rngFromSeed("leaf-eval-setup"));
    const policy = mctsPolicy<TTTState, TTTMove>({ leafEvaluation: true });
    policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("leaf-eval-decision"),
      budget: { kind: "rollouts", n: 25 },
      clock: fakeClock(0),
    });
    expect(rolloutToHorizonSpy).not.toHaveBeenCalled();
  });

  it("default (leafEvaluation unset) is unaffected: rolloutToHorizon is called once per rollout, with the default 200-ply cap", () => {
    rolloutToHorizonSpy.mockClear();
    const state = engine.setup(2, rngFromSeed("leaf-eval-setup"));
    const policy = mctsPolicy<TTTState, TTTMove>({});
    policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("leaf-eval-decision"),
      budget: { kind: "rollouts", n: 25 },
      clock: fakeClock(0),
    });
    expect(rolloutToHorizonSpy).toHaveBeenCalledTimes(25);
    for (const call of rolloutToHorizonSpy.mock.calls) {
      expect(call[3]).toBe(200); // (engine, state, rng, maxPlies)
    }
  });

  it("leafEvaluation: true takes precedence over an explicit rolloutCapPlies — rollout is skipped regardless of the cap's value", () => {
    rolloutToHorizonSpy.mockClear();
    const state = engine.setup(2, rngFromSeed("leaf-eval-setup"));
    const policy = mctsPolicy<TTTState, TTTMove>({ leafEvaluation: true, rolloutCapPlies: 37 });
    policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("leaf-eval-decision"),
      budget: { kind: "rollouts", n: 10 },
      clock: fakeClock(0),
    });
    expect(rolloutToHorizonSpy).not.toHaveBeenCalled();
  });

  it("is behaviorally identical to the legacy rolloutCapPlies: 0 spelling — same move, same stats, given the same seed", () => {
    const state = engine.setup(2, rngFromSeed("leaf-eval-setup"));
    const named = mctsPolicy<TTTState, TTTMove>({ leafEvaluation: true }).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("leaf-eval-decision"),
      budget: { kind: "rollouts", n: 60 },
      clock: fakeClock(0),
    });
    const legacy = mctsPolicy<TTTState, TTTMove>({ rolloutCapPlies: 0 }).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("leaf-eval-decision"),
      budget: { kind: "rollouts", n: 60 },
      clock: fakeClock(0),
    });
    expect(named.move).toEqual(legacy.move);
    expect(named.stats).toEqual(legacy.stats);
  });

  it("does not evaluate to the all-zero degenerate case: rootValue is nonzero for a non-trivial position", () => {
    // Guards against a vacuous implementation that "skips the rollout" by returning 0 for
    // everything rather than actually invoking valueOfStatus at the leaf.
    const state = engine.setup(2, rngFromSeed("leaf-eval-setup"));
    const { stats } = mctsPolicy<TTTState, TTTMove>({ leafEvaluation: true }).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("leaf-eval-decision"),
      budget: { kind: "rollouts", n: 60 },
      clock: fakeClock(0),
    });
    expect(stats.rootValue).toBeDefined();
    expect(stats.rootValue).not.toBe(0);
  });
});

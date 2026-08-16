// packages/bots/test/tiers-leaf-evaluation.test.ts — proves PolicySpec's "mcts" arm forwards
// `leafEvaluation` through tierPolicy -> buildPolicy -> mctsPolicy (platform-corrections.md
// C95 / bid-tac-toe-budget-sweep.md §2 P1). `MctsOptions.leafEvaluation` was named and tested
// at the mctsPolicy level (a642899, mcts-leaf-evaluation.test.ts) but UNREACHABLE from any
// manifest: PolicySpec's mcts arm had no field for it and buildPolicy forwarded only
// explorationC. Every gate/suite/compareBudgets builds its agents through tierPolicy ->
// buildPolicy, so a manifest declaring leafEvaluation: true had no way to make it take effect
// — C95's finding was that the prior byte-identity verification of this exact feature PASSED
// *because* the flag was unreachable (an unreachable flag changes nothing).
//
// Isolated in its own file for the same reason mcts-leaf-evaluation.test.ts is isolated: it
// mocks search-utils.ts with a real spy WRAPPING the genuine rolloutToHorizon (never a
// stub/fake), so every assertion here is still exercising the real algorithm; the isolation
// just keeps that vi.mock from coexisting with tiers.test.ts's much larger suite.

import { describe, expect, it, vi } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import type { DifficultyTier } from "@twist-arcade/game-spec";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { fakeClock } from "./helpers";

vi.mock("../src/search-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/search-utils")>();
  return { ...actual, rolloutToHorizon: vi.fn(actual.rolloutToHorizon) };
});

// These two imports must textually follow the vi.mock call above, per Vitest's hoisting
// contract — see mcts-leaf-evaluation.test.ts's own note.
import { rolloutToHorizon } from "../src/search-utils";
import { tierPolicy } from "../src/tiers";
import { mctsPolicy } from "../src/mcts";

const rolloutToHorizonSpy = vi.mocked(rolloutToHorizon);
const engine = classicTicTacToe;

const LEAF_TIER: DifficultyTier = {
  id: "standard",
  policy: { kind: "mcts", leafEvaluation: true },
  budget: { kind: "rollouts", n: 25 },
  minReplyMs: 0,
};

const DEFAULT_TIER: DifficultyTier = {
  id: "standard",
  policy: { kind: "mcts" },
  budget: { kind: "rollouts", n: 25 },
  minReplyMs: 0,
};

describe("tierPolicy forwards MctsOptions.leafEvaluation through PolicySpec's mcts arm (C95)", () => {
  it("PolicySpec { kind: 'mcts', leafEvaluation: true } through tierPolicy skips the rollout phase entirely — FAILS if buildPolicy stops forwarding the flag", () => {
    rolloutToHorizonSpy.mockClear();
    const state = engine.setup(2, rngFromSeed("tier-leaf-setup"));
    tierPolicy<TTTState, TTTMove>(LEAF_TIER).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("tier-leaf-decision"),
      budget: LEAF_TIER.budget,
      clock: fakeClock(),
    });
    expect(rolloutToHorizonSpy).not.toHaveBeenCalled();
  });

  it("PolicySpec { kind: 'mcts' } (no leafEvaluation) through tierPolicy still rolls out — an absent flag stays absent, never forced to an explicit false", () => {
    rolloutToHorizonSpy.mockClear();
    const state = engine.setup(2, rngFromSeed("tier-leaf-setup"));
    tierPolicy<TTTState, TTTMove>(DEFAULT_TIER).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("tier-leaf-decision"),
      budget: DEFAULT_TIER.budget,
      clock: fakeClock(),
    });
    expect(rolloutToHorizonSpy).toHaveBeenCalledTimes(25);
  });

  it("PLANTED CHECK (bid-tac-toe-budget-sweep.md §2 P1, verification b): tierPolicy's mcts+leafEvaluation route is byte-identical to a script-level mctsPolicy({leafEvaluation:true}) call — same seed, same move, same stats. LEAF_TIER has no blunder config, so tierPolicy adds no extra rng draws over the raw policy.", () => {
    const state = engine.setup(2, rngFromSeed("tier-leaf-setup"));
    const viaTier = tierPolicy<TTTState, TTTMove>(LEAF_TIER).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("tier-leaf-decision"),
      budget: LEAF_TIER.budget,
      clock: fakeClock(),
    });
    const direct = mctsPolicy<TTTState, TTTMove>({ leafEvaluation: true }).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("tier-leaf-decision"),
      budget: LEAF_TIER.budget,
      clock: fakeClock(),
    });
    expect(viaTier.move).toEqual(direct.move);
    expect(viaTier.stats).toEqual(direct.stats);
  });
});

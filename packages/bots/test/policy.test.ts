import { describe, expect, it } from "vitest";
import { rngFromSeed, type GameEngine, type WithEffects } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import {
  MissingSampleConsistentStateError,
  NonDeterministicBudgetError,
  deriveView,
  determinize,
  probeViewHonesty,
  requireDeterministicBudget,
  type Policy,
  type ViewPolicy,
} from "../src/policy";
import { fakeClock } from "./helpers";

describe("requireDeterministicBudget", () => {
  it("passes silently for a rollouts budget", () => {
    expect(() => requireDeterministicBudget({ kind: "rollouts", n: 100 }, "test")).not.toThrow();
  });

  it("throws NonDeterministicBudgetError for a deadlineMs budget", () => {
    expect(() => requireDeterministicBudget({ kind: "deadlineMs", ms: 500 }, "pinned daily bot")).toThrow(
      NonDeterministicBudgetError
    );
    expect(() => requireDeterministicBudget({ kind: "deadlineMs", ms: 500 }, "pinned daily bot")).toThrow(
      /pinned daily bot/
    );
  });
});

describe("determinize()", () => {
  it("throws MissingSampleConsistentStateError when the engine has no sampleConsistentState", () => {
    // classic-ttt is perfect-info and has no sampleConsistentState — a plausible (if wrong)
    // caller mistake would be to determinize() a perfect-info engine's policy anyway.
    const stub: Policy<TTTState, TTTMove> = {
      chooseMove: () => ({ move: { cell: 0 }, stats: { elapsedMs: 0 } }),
    };
    const viewPolicy = determinize(stub);
    const state = classicTicTacToe.setup(2, rngFromSeed("x"));
    const view = deriveView(classicTicTacToe, state, 0);
    expect(() =>
      viewPolicy.chooseMove({
        engine: classicTicTacToe,
        view,
        player: 0,
        rng: rngFromSeed("x:decision"),
        budget: { kind: "rollouts", n: 1 },
        clock: fakeClock(),
      })
    ).toThrow(MissingSampleConsistentStateError);
  });

  it("multi-sample determinize() returns the majority move across independent samples", () => {
    // A stub engine (reusing tiny-fog's shape informally) whose sampleConsistentState
    // alternates between two possible worlds via rng, and a stub Policy that always "chooses"
    // to mirror whatever world it was given — lets us control exactly what determinize()
    // should see as its vote distribution.
    let callCount = 0;
    const engine = {
      ...classicTicTacToe,
      meta: { ...classicTicTacToe.meta, hiddenInformation: true },
      sampleConsistentState: () => {
        callCount += 1;
        // First 2 samples "vote" cell 0, last 1 "votes" cell 1 — majority should be cell 0.
        return classicTicTacToe.setup(2, rngFromSeed("majority"));
      },
    };
    let stubCallCount = 0;
    const stubPolicy: Policy<TTTState, TTTMove> = {
      chooseMove: () => {
        stubCallCount += 1;
        const cell = stubCallCount <= 2 ? 0 : 1;
        return { move: { cell }, stats: { elapsedMs: 0, rollouts: 1 } };
      },
    };
    const viewPolicy = determinize(stubPolicy, { samples: 3 });
    const state = classicTicTacToe.setup(2, rngFromSeed("y"));
    const view = deriveView(engine, state, 0);
    const { move, stats } = viewPolicy.chooseMove({
      engine,
      view,
      player: 0,
      rng: rngFromSeed("y:decision"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(move.cell).toBe(0); // 2 out of 3 votes
    expect(callCount).toBe(3); // sampled exactly `samples` hidden worlds
    expect(stats.rollouts).toBe(3); // summed across all 3 underlying searches
  });
});

describe("probeViewHonesty: view-equality check must not be key-order-sensitive", () => {
  interface OrderState extends WithEffects {
    marker: "A" | "B";
  }
  type OrderMove = { x: number };
  interface OrderView extends WithEffects {
    a: number;
    b: number;
  }

  function makeOrderEngine(): GameEngine<OrderState, OrderMove, OrderView> {
    return {
      meta: {
        id: "key-order-fixture",
        name: "key-order-fixture",
        minPlayers: 1,
        maxPlayers: 1,
        hiddenInformation: true,
        simultaneous: false,
        stochastic: false,
        version: 1,
      },
      setup: () => {
        throw new Error("not needed for this test");
      },
      legalMoves: () => {
        throw new Error("not needed for this test");
      },
      isLegal: () => {
        throw new Error("not needed for this test");
      },
      active: () => ({ mode: "sequential", player: 0 }),
      apply: () => {
        throw new Error("not needed for this test");
      },
      status: () => ({ kind: "ongoing" }),
      playerView(state) {
        // Same logical view (a:1, b:2) for BOTH real worlds, but with the object's keys
        // inserted in a DIFFERENT order depending on which world produced it — the exact shape
        // of the review finding: JSON.stringify is key-order-sensitive, so a probe comparing
        // views via JSON.stringify would (wrongly) reject these two worlds as not sharing a
        // view at all, even though they are deep-equal.
        return state.marker === "A" ? { a: 1, b: 2, lastEffects: [] } : { b: 2, a: 1, lastEffects: [] };
      },
      encode: () => {
        throw new Error("not needed for this test");
      },
      decode: () => {
        throw new Error("not needed for this test");
      },
    };
  }

  it("does not falsely reject two worlds whose derived views are deep-equal but built with different key insertion order", () => {
    const engine = makeOrderEngine();
    const worldA: OrderState = { marker: "A", lastEffects: [] };
    const worldB: OrderState = { marker: "B", lastEffects: [] };
    const makePolicy = (): ViewPolicy<OrderState, OrderMove, OrderView> => ({
      chooseMove: () => ({ move: { x: 0 }, stats: { elapsedMs: 0 } }),
    });
    expect(() =>
      probeViewHonesty({
        engine,
        makePolicy,
        worlds: [worldA, worldB],
        player: 0,
        budget: { kind: "rollouts", n: 1 },
        clock: fakeClock(),
        makeRng: () => rngFromSeed("key-order-seed"),
      })
    ).not.toThrow();
  });
});

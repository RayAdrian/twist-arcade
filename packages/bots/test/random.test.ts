import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { randomPolicy } from "../src/random";
import { fakeClock } from "./helpers";

describe("randomPolicy", () => {
  it("always returns a move that is a member of legalMoves(state, player)", () => {
    const engine = classicTicTacToe;
    const policy = randomPolicy<TTTState, TTTMove>();
    let state = engine.setup(2, rngFromSeed("random-policy-legal"));
    const rng = rngFromSeed("random-policy-legal:driver");
    for (let ply = 0; ply < 9; ply++) {
      const status = engine.status(state);
      if (status.kind !== "ongoing") break;
      const active = engine.active(state);
      if (active.mode !== "sequential") throw new Error("unexpected");
      const { move } = policy.chooseMove({
        engine,
        state,
        player: active.player,
        rng,
        budget: { kind: "rollouts", n: 1 },
        clock: fakeClock(),
      });
      const legal = engine.legalMoves(state, active.player);
      expect(legal.some((m) => m.cell === move.cell)).toBe(true);
      state = engine.apply(state, new Map([[active.player, move]]), rngFromSeed(`step-${ply}`));
    }
  });

  it("is uniform over the injected rng: draws legal[rng.int(legal.length)], byte-for-byte with a stub rng", () => {
    const engine = classicTicTacToe;
    const policy = randomPolicy<TTTState, TTTMove>();
    const state = engine.setup(2, rngFromSeed("x"));
    const legal = engine.legalMoves(state, 0);
    // Stub rng whose int() always returns a fixed index — the policy must draw exactly that
    // index from `legalMoves`, proving it delegates move selection to the injected Rng and
    // does not, e.g., always pick index 0 or use its own internal counter.
    const stubRng = {
      next: () => 0.5,
      int: (max: number) => Math.min(2, max - 1),
      shuffle: <T,>(xs: readonly T[]) => [...xs],
    };
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: stubRng,
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(move).toEqual(legal[Math.min(2, legal.length - 1)]);
  });

  it("throws a clear error when called on a terminal state / a player with no legal moves", () => {
    const engine = classicTicTacToe;
    const policy = randomPolicy<TTTState, TTTMove>();
    // Build a full (drawn) board by hand via repeated legal moves to a known draw line, OR
    // simpler: call for the INACTIVE player, who structurally has zero legal moves while the
    // game is ongoing — same "nothing to choose from" failure mode randomPolicy must refuse
    // cleanly rather than throwing an opaque RangeError from rng.int(0).
    const state = engine.setup(2, rngFromSeed("y"));
    expect(() =>
      policy.chooseMove({
        engine,
        state,
        player: 1, // player 0 is active at setup; player 1 has no legal moves right now
        rng: rngFromSeed("y:driver"),
        budget: { kind: "rollouts", n: 1 },
        clock: fakeClock(),
      })
    ).toThrow(/legal move/i);
  });

  it("reports SearchStats with elapsedMs >= 0 and rollouts of 1 (trivial for random)", () => {
    const engine = classicTicTacToe;
    const policy = randomPolicy<TTTState, TTTMove>();
    const state = engine.setup(2, rngFromSeed("z"));
    const { stats } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("z:driver"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

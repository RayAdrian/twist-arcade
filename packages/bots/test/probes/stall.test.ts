import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { stallPolicy } from "../../src/probes/stall";
import { fakeClock } from "../helpers";

describe("stallPolicy (generic 2P degeneracy probe: maximize estimated remaining plies)", () => {
  it("prefers NOT taking an immediate win when a non-terminal alternative is available (the deliberately degenerate behavior the probe exists to surface)", () => {
    // X (player 0) to move: cell 2 completes the top row for an immediate win (ends the
    // game); cell 5 is a harmless alternative that keeps the game ongoing. A stalling agent
    // should prefer PROLONGING the game over ending it, even via a win — that perverse
    // preference is exactly what this probe is FOR (surfacing whether a game rewards
    // stalling).
    const state: TTTState = {
      board: [0, 0, null, 1, 1, null, null, null, null],
      turn: 0,
      lastEffects: [],
    };
    const policy = stallPolicy<TTTState, { cell: number; readonly [k: string]: import("@twist-arcade/engine").Json }>({
      rolloutsPerAction: 40,
    });
    const { move } = policy.chooseMove({
      engine: classicTicTacToe,
      state,
      player: 0,
      rng: rngFromSeed("stall-avoid-win"),
      budget: { kind: "rollouts", n: 200 },
      clock: fakeClock(),
    });
    expect(move.cell).not.toBe(2);
  });

  it("always returns a legal move", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("stall-legal"));
    const policy = stallPolicy<TTTState, { cell: number; readonly [k: string]: import("@twist-arcade/engine").Json }>();
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("stall-legal-decision"),
      budget: { kind: "rollouts", n: 60 },
      clock: fakeClock(),
    });
    expect(engine.legalMoves(state, 0).some((m) => m.cell === move.cell)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { suicidePolicy } from "../../src/probes/suicide";
import { fakeClock } from "../helpers";

describe("suicidePolicy (generic degeneracy probe: shortest path to ANY terminal — the mirror image of stallPolicy, misère check)", () => {
  it("prefers ending the game THIS ply (even via a win) over prolonging it — the exact opposite preference from stallPolicy on the identical fixture", () => {
    // Identical board to stall.test.ts's "avoid win" case: cell 2 completes the top row for
    // an immediate win (ends the game NOW); cell 5 is a harmless alternative that keeps the
    // game ongoing. Suicide must prefer ENDING the game, regardless of it being a win —
    // "shortest path to a terminal" cares about speed to any terminal, not which one.
    const state: TTTState = {
      board: [0, 0, null, 1, 1, null, null, null, null],
      turn: 0,
      lastEffects: [],
    };
    const policy = suicidePolicy<TTTState, TTTMove>({ rolloutsPerAction: 40 });
    const { move } = policy.chooseMove({
      engine: classicTicTacToe,
      state,
      player: 0,
      rng: rngFromSeed("suicide-take-terminal"),
      budget: { kind: "rollouts", n: 200 },
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("always returns a legal move", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("suicide-legal"));
    const policy = suicidePolicy<TTTState, TTTMove>();
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("suicide-legal-decision"),
      budget: { kind: "rollouts", n: 60 },
      clock: fakeClock(),
    });
    expect(engine.legalMoves(state, 0).some((m) => m.cell === move.cell)).toBe(true);
  });
});

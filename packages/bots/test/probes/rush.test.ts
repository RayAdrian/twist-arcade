import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { rushPolicy } from "../../src/probes/rush";
import { fakeClock } from "../helpers";

describe("rushPolicy (generic 2P degeneracy probe: win now > block > heuristic > random)", () => {
  it("takes an immediate win when available", () => {
    const state: TTTState = {
      board: [0, 0, null, 1, 1, null, null, null, null],
      turn: 0,
      lastEffects: [],
    };
    const { move } = rushPolicy<TTTState, TTTMove>().chooseMove({
      engine: classicTicTacToe,
      state,
      player: 0,
      rng: rngFromSeed("rush-win"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("blocks the opponent's immediate winning threat when it has no win of its own", () => {
    // O (player 1) to move; X threatens cells 0,1 with 2 open, O has no win available.
    const state: TTTState = {
      board: [0, 0, null, 1, null, null, null, null, null],
      turn: 1,
      lastEffects: [],
    };
    const { move } = rushPolicy<TTTState, TTTMove>().chooseMove({
      engine: classicTicTacToe,
      state,
      player: 1,
      rng: rngFromSeed("rush-block"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("falls back to the heuristic-best move when no immediate win or forced block exists", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("rush-heuristic"));
    const { move } = rushPolicy<TTTState, TTTMove>().chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("rush-heuristic-decision"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    // classic-ttt's heuristic favors the center (cell 4) on an empty board: it participates
    // in the most lines (4), so it should score strictly higher than every corner/edge cell.
    expect(move.cell).toBe(4);
  });

  it("always returns a legal move", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("rush-legal"));
    const { move } = rushPolicy<TTTState, TTTMove>().chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("rush-legal-decision"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(engine.legalMoves(state, 0).some((m) => m.cell === move.cell)).toBe(true);
  });
});

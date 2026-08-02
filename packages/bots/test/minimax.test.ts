import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { minimaxPolicy } from "../src/minimax";
import { randomPolicy } from "../src/random";
import { fakeClock } from "./helpers";

const BUDGET = { kind: "rollouts", n: 50000 } as const;

describe("minimaxPolicy", () => {
  it("finds the win in a two-in-a-row position (free oracle, plan §9)", () => {
    // X (player 0) has two in a row on the top row (cells 0,1) and cell 2 is open: X to move
    // must take cell 2 for the immediate win. O (player 1) occupies 3,4 (no threat).
    const state: TTTState = {
      board: [0, 0, null, 1, 1, null, null, null, null],
      turn: 0,
      lastEffects: [],
    };
    const policy = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 9 });
    const { move } = policy.chooseMove({
      engine: classicTicTacToe,
      state,
      player: 0,
      rng: rngFromSeed("minimax-two-in-a-row"),
      budget: BUDGET,
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("blocks the opponent's immediate winning threat when it has no win of its own", () => {
    // O (player 1) to move; X (player 0) threatens cells 0,1 with 2 open. O must block at 2.
    const state: TTTState = {
      board: [0, 0, null, 1, null, null, null, null, null],
      turn: 1,
      lastEffects: [],
    };
    const policy = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 9 });
    const { move } = policy.chooseMove({
      engine: classicTicTacToe,
      state,
      player: 1,
      rng: rngFromSeed("minimax-block"),
      budget: BUDGET,
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("never loses a full game against a random opponent, from either seat, across many seeds (free oracle, plan §9)", () => {
    const minimax = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 9 });
    const random = randomPolicy<TTTState, TTTMove>();
    const engine = classicTicTacToe;
    for (let seed = 0; seed < 25; seed++) {
      for (const minimaxSeat of [0, 1] as const) {
        let state = engine.setup(2, rngFromSeed(`minimax-vs-random-setup-${seed}`));
        const driverRng = rngFromSeed(`minimax-vs-random-driver-${seed}-${minimaxSeat}`);
        for (let ply = 0; ply < 9; ply++) {
          const status = engine.status(state);
          if (status.kind !== "ongoing") break;
          const active = engine.active(state);
          if (active.mode !== "sequential") throw new Error("unexpected");
          const mover = active.player === minimaxSeat ? minimax : random;
          const { move } = mover.chooseMove({
            engine,
            state,
            player: active.player,
            rng: driverRng,
            budget: BUDGET,
            clock: fakeClock(),
          });
          state = engine.apply(state, new Map([[active.player, move]]), rngFromSeed(`step-${seed}-${ply}`));
        }
        const finalStatus = engine.status(state);
        if (finalStatus.kind === "won") {
          expect(finalStatus.winner).toBe(minimaxSeat);
        }
        // draw is fine; minimax must never be the LOSER.
      }
    }
  });

  it("throws a typed error when the engine has no heuristic and no maxDepth reaches every terminal", () => {
    // bank-run has no heuristic and is stochastic/1-player — minimax's precondition
    // (sequential perfect-info, deterministic) is violated by stochasticity; must refuse.
    const policy = minimaxPolicy<BankRunState, BankRunMove>();
    const state = bankRun.setup(1, rngFromSeed("no-heuristic"));
    expect(() =>
      policy.chooseMove({
        engine: bankRun,
        state,
        player: 0,
        rng: rngFromSeed("no-heuristic:driver"),
        budget: BUDGET,
        clock: fakeClock(),
      })
    ).toThrow(/minimax/i);
  });
});

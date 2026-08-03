import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { rps } from "../fixtures/rps";
import { greedyOnlyPolicy, GreedyOnlyUnsupportedGameError } from "../../src/probes/greedy-only";
import { fakeClock } from "../helpers";

describe("greedyOnlyPolicy (generic degeneracy probe: 1-ply hill-climb on score()/heuristic(), NO look-ahead)", () => {
  it("banks immediately whenever a streak is at risk — it only ranks the IMMEDIATE score() of each candidate, never future risk", () => {
    // bank-run's score() excludes the at-risk streak, so "bank" strictly raises the immediate
    // score while "push" never changes it (win or bust) — a pure 1-ply hill-climb must prefer
    // "bank" here regardless of push's actual odds, which is exactly the point of this probe.
    const state: BankRunState = { banked: 0, streak: 3, round: 2, lastEffects: [] };
    const { move } = greedyOnlyPolicy<BankRunState, BankRunMove>().chooseMove({
      engine: bankRun,
      state,
      player: 0,
      rng: rngFromSeed("greedy-bank"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(move.kind).toBe("bank");
  });

  it("falls back to heuristic()-best when score() is absent (classic-ttt has no score())", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("greedy-heuristic"));
    const { move } = greedyOnlyPolicy<TTTState, TTTMove>().chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("greedy-heuristic-decision"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    // classic-ttt's heuristic favors the center (cell 4) on an empty board — the same free
    // oracle rush.test.ts uses for its own heuristic-fallback case.
    expect(move.cell).toBe(4);
  });

  it("takes an immediate win over a merely-higher-heuristic ongoing position (a real win beats any raw heuristic score)", () => {
    // X (player 0) has two in a row at cells 0,1 with cell 2 open for the immediate win.
    // Playing cell 4 (center) instead leaves an ongoing position whose classic-ttt heuristic
    // evaluates to +3 (four open-line contributions) — which is HIGHER than won's naive value
    // of 1, so an evaluate() that doesn't rank terminal outcomes above ongoing heuristics picks
    // cell 4 and throws away a forced win. This is the exact defect the reviewer proved: an
    // artificially weakened greedy-only widens the gap to Strong, so the §7.4 dominant-strategy
    // gate under-fires on a genuinely degenerate game.
    const engine = classicTicTacToe;
    const state: TTTState = {
      board: [0, 0, null, 1, null, 1, null, null, null],
      turn: 0,
      lastEffects: [],
    };
    const { move } = greedyOnlyPolicy<TTTState, TTTMove>().chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("greedy-win-vs-heuristic"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("always returns a legal move", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("greedy-legal"));
    const { move } = greedyOnlyPolicy<TTTState, TTTMove>().chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("greedy-legal-decision"),
      budget: { kind: "rollouts", n: 1 },
      clock: fakeClock(),
    });
    expect(engine.legalMoves(state, 0).some((m) => m.cell === move.cell)).toBe(true);
  });

  it("throws a typed error when the engine implements neither score() nor heuristic()", () => {
    const state = rps.setup(2, rngFromSeed("greedy-unsupported"));
    expect(() =>
      greedyOnlyPolicy().chooseMove({
        engine: rps,
        state,
        player: 0,
        rng: rngFromSeed("greedy-unsupported-decision"),
        budget: { kind: "rollouts", n: 1 },
        clock: fakeClock(),
      })
    ).toThrow(GreedyOnlyUnsupportedGameError);
  });
});

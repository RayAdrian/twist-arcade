import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { miniCrackstep } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { beamPolicy } from "../src/beam";
import { randomPolicy } from "../src/random";
import { fakeClock } from "./helpers";

function playOneGame(policy: { chooseMove: ReturnType<typeof beamPolicy<BankRunState, BankRunMove>>["chooseMove"] }, seed: string): number {
  const engine = bankRun;
  let state = engine.setup(1, rngFromSeed(`${seed}:setup`));
  const decisionRng = rngFromSeed(`${seed}:decision`);
  for (let round = 0; round < 10; round++) {
    const status = engine.status(state);
    if (status.kind !== "ongoing") break;
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: decisionRng,
      budget: { kind: "rollouts", n: 500 },
      clock: fakeClock(),
    });
    state = engine.apply(state, new Map([[0, move]]), rngFromSeed(`${seed}:step-${round}`));
  }
  const finalStatus = engine.status(state);
  if (finalStatus.kind !== "scored") throw new Error(`unexpected terminal: ${JSON.stringify(finalStatus)}`);
  return finalStatus.scores[0]!;
}

describe("beamPolicy", () => {
  it("always returns a legal move on bank-run (default width 100, plan §6)", () => {
    const policy = beamPolicy<BankRunState, BankRunMove>();
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("beam-legal"));
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("beam-legal-decision"),
      budget: { kind: "rollouts", n: 200 },
      clock: fakeClock(),
    });
    const legal = engine.legalMoves(state, 0);
    expect(legal.some((m) => m.kind === move.kind)).toBe(true);
  });

  it("beats random by a reproducible fixed-seed margin on bank-run (DoD §13 anchor: THE solo Strong agent)", () => {
    const beam = beamPolicy<BankRunState, BankRunMove>({ width: 50 });
    const random = randomPolicy<BankRunState, BankRunMove>();
    const N = 60;
    let beamTotal = 0;
    let randomTotal = 0;
    for (let seed = 0; seed < N; seed++) {
      beamTotal += playOneGame(beam, `beam-strong-${seed}`);
      randomTotal += playOneGame(random, `beam-random-${seed}`);
    }
    expect(beamTotal / N).toBeGreaterThan(randomTotal / N);
  });

  it("same seed ⇒ identical move (determinism, rollouts budget)", () => {
    const policy = beamPolicy<BankRunState, BankRunMove>({ width: 20 });
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("beam-det"));
    const a = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("beam-det-decision"),
      budget: { kind: "rollouts", n: 100 },
      clock: fakeClock(),
    });
    const b = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("beam-det-decision"),
      budget: { kind: "rollouts", n: 100 },
      clock: fakeClock(),
    });
    expect(a.move).toEqual(b.move);
  });

  it("refuses a non-solo game with a typed error", () => {
    const policy = beamPolicy<TTTState, TTTMove>();
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("beam-not-solo"));
    expect(() =>
      policy.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed("beam-not-solo-decision"),
        budget: { kind: "rollouts", n: 10 },
        clock: fakeClock(),
      })
    ).toThrow(/solo/i);
  });

  it("refuses a solo game with neither score() nor heuristic() (mini-crackstep) with a typed error", () => {
    const policy = beamPolicy();
    const engine = miniCrackstep;
    const state = engine.setup(1, rngFromSeed("beam-no-eval"));
    expect(() =>
      policy.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed("beam-no-eval-decision"),
        budget: { kind: "rollouts", n: 10 },
        clock: fakeClock(),
      })
    ).toThrow(/score|heuristic/i);
  });
});

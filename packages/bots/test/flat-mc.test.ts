import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { flatMonteCarloPolicy } from "../src/flat-mc";
import { randomPolicy } from "../src/random";
import { fakeClock } from "./helpers";

/** Plays one full bank-run game with `policy` deciding every move, returns the final score
 *  (== banked, per the fixture's own score()/terminal invariant). */
function playOneGame(policy: { chooseMove: ReturnType<typeof flatMonteCarloPolicy<BankRunState, BankRunMove>>["chooseMove"] }, seed: string): number {
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
      budget: { kind: "rollouts", n: 64 },
      clock: fakeClock(),
    });
    state = engine.apply(state, new Map([[0, move]]), rngFromSeed(`${seed}:step-${round}`));
  }
  const finalStatus = engine.status(state);
  if (finalStatus.kind !== "scored") throw new Error(`unexpected terminal: ${JSON.stringify(finalStatus)}`);
  return finalStatus.scores[0]!;
}

describe("flatMonteCarloPolicy", () => {
  it("always returns a legal move on bank-run", () => {
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>({ rolloutsPerAction: 8 });
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("flat-mc-legal"));
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("flat-mc-legal-decision"),
      budget: { kind: "rollouts", n: 32 },
      clock: fakeClock(),
    });
    const legal = engine.legalMoves(state, 0);
    expect(legal.some((m) => m.kind === move.kind)).toBe(true);
  });

  it("beats random by a reproducible fixed-seed margin on bank-run (DoD §13 anchor)", () => {
    const flatMc = flatMonteCarloPolicy<BankRunState, BankRunMove>({ rolloutsPerAction: 32 });
    const random = randomPolicy<BankRunState, BankRunMove>();
    const N = 60;
    let flatMcTotal = 0;
    let randomTotal = 0;
    for (let seed = 0; seed < N; seed++) {
      flatMcTotal += playOneGame(flatMc, `flat-mc-strong-${seed}`);
      randomTotal += playOneGame(random, `flat-mc-random-${seed}`);
    }
    const flatMcMean = flatMcTotal / N;
    const randomMean = randomTotal / N;
    expect(flatMcMean).toBeGreaterThan(randomMean);
  });

  it("same seed ⇒ identical move (determinism, rollouts budget)", () => {
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>({ rolloutsPerAction: 16 });
    const engine = bankRun;
    const state = engine.setup(1, rngFromSeed("flat-mc-det"));
    const a = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("flat-mc-det-decision"),
      budget: { kind: "rollouts", n: 16 },
      clock: fakeClock(),
    });
    const b = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("flat-mc-det-decision"),
      budget: { kind: "rollouts", n: 16 },
      clock: fakeClock(),
    });
    expect(a.move).toEqual(b.move);
  });

  it("throws a clear error when called on a terminal state", () => {
    const policy = flatMonteCarloPolicy<BankRunState, BankRunMove>();
    const engine = bankRun;
    const terminalState: BankRunState = { banked: 3, streak: 0, round: 6, lastEffects: [] };
    expect(() =>
      policy.chooseMove({
        engine,
        state: terminalState,
        player: 0,
        rng: rngFromSeed("flat-mc-terminal"),
        budget: { kind: "rollouts", n: 8 },
        clock: fakeClock(),
      })
    ).toThrow(/terminal/i);
  });
});

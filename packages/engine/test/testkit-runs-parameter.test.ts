// packages/engine/test/testkit-runs-parameter.test.ts
//
// M1 review finding 7: checkEncodeDecodeAndEffects, checkLegalityCoherence,
// checkPlayerViewTotal, checkPerfectInfoIdentity, and checkRedaction used to run exactly ONE
// fixed playout per player count, ignoring `opts.runs` entirely (the self-test suite even
// passed `runs: 10` to checkRedaction and it was silently ignored). This proves the fix: each
// property now drives exactly `opts.runs` independent playouts, by wrapping an engine's
// setup() with a call counter — an engine ignoring `runs` would call setup() exactly once
// per player count regardless of the requested run count; the fixed properties call it
// exactly `runs` times.

import { describe, expect, it } from "vitest";
import type { GameEngine, Json, Rng, WithEffects } from "../src/types";
import {
  checkEncodeDecodeAndEffects,
  checkLegalityCoherence,
  checkPerfectInfoIdentity,
  checkPlayerViewTotal,
  checkRedaction,
} from "../testkit/checks";
import { classicTicTacToe, type TTTMove, type TTTState } from "../testkit/fixtures/classic-ttt";
import { fogFixtureCorrect, fogSecretExtractor, type FogMove, type FogState, type FogView } from "./mutants/mutants";

function withSetupSpy<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>
): { wrapped: GameEngine<S, M, V>; getCalls: () => number } {
  let calls = 0;
  const wrapped: GameEngine<S, M, V> = {
    ...engine,
    setup(n: number, rng: Rng): S {
      calls += 1;
      return engine.setup(n, rng);
    },
  };
  return { wrapped, getCalls: () => calls };
}

const RUNS = 7;

describe("contract properties honor opts.runs (M1 review finding 7)", () => {
  it("checkEncodeDecodeAndEffects drives exactly `runs` playouts", () => {
    const { wrapped, getCalls } = withSetupSpy<TTTState, TTTMove, TTTState>(classicTicTacToe);
    checkEncodeDecodeAndEffects(wrapped, { maxPlies: 9, runs: RUNS, playerCounts: [2] });
    expect(getCalls()).toBe(RUNS);
  });

  it("checkLegalityCoherence drives exactly `runs` playouts", () => {
    const { wrapped, getCalls } = withSetupSpy<TTTState, TTTMove, TTTState>(classicTicTacToe);
    checkLegalityCoherence(wrapped, { maxPlies: 9, runs: RUNS, playerCounts: [2] });
    expect(getCalls()).toBe(RUNS);
  });

  it("checkPlayerViewTotal drives exactly `runs` playouts", () => {
    const { wrapped, getCalls } = withSetupSpy<TTTState, TTTMove, TTTState>(classicTicTacToe);
    checkPlayerViewTotal(wrapped, { maxPlies: 9, runs: RUNS, playerCounts: [2] });
    expect(getCalls()).toBe(RUNS);
  });

  it("checkPerfectInfoIdentity drives exactly `runs` playouts", () => {
    const { wrapped, getCalls } = withSetupSpy<TTTState, TTTMove, TTTState>(classicTicTacToe);
    checkPerfectInfoIdentity(wrapped, { maxPlies: 9, runs: RUNS, playerCounts: [2] });
    expect(getCalls()).toBe(RUNS);
  });

  it("checkRedaction drives exactly `runs` playouts (the exact case the review called out — self-test passed runs:10 and it was silently ignored)", () => {
    const { wrapped, getCalls } = withSetupSpy<FogState, FogMove, FogView>(fogFixtureCorrect);
    checkRedaction(wrapped, { maxPlies: 5, runs: RUNS, secretExtractor: fogSecretExtractor, playerCounts: [1] });
    expect(getCalls()).toBe(RUNS);
  });
});

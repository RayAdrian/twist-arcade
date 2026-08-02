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
  checkDeterminism,
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

  it("checkDeterminism drives exactly `runs` playouts when given explicitly", () => {
    const { wrapped, getCalls } = withSetupSpy<TTTState, TTTMove, TTTState>(classicTicTacToe);
    checkDeterminism(wrapped, { maxPlies: 9, runs: RUNS, playerCounts: [2] });
    // checkDeterminism calls randomPlayout TWICE per run (the "a" and "b" trajectories) PLUS
    // one more setup() call inside its replay()-cross-check, so setup() is called 3x per run.
    expect(getCalls()).toBe(RUNS * 3);
  });
});

// Gap G-14 (M2 entry checklist, platform-corrections.md): ContractOptions.runs's docstring
// says "default: 20", and checkTermination/checkEncodeDecodeAndEffects/etc. all honor that —
// but checkDeterminism alone defaulted to `opts.runs ?? 10`, silently sampling at half the
// documented rate whenever a caller omitted `runs`. Fixed to match the documented default.
describe("checkDeterminism's default `runs` matches the documented default of 20 (Gap G-14)", () => {
  it("checkDeterminism with no `runs` option drives exactly 20 playouts per player count", () => {
    const { wrapped, getCalls } = withSetupSpy<TTTState, TTTMove, TTTState>(classicTicTacToe);
    checkDeterminism(wrapped, { maxPlies: 9, playerCounts: [2] });
    // 3x per run (the "a"/"b" trajectories plus the internal replay() cross-check) — 20 runs
    // ⇒ 60 setup() calls.
    expect(getCalls()).toBe(60);
  });
});

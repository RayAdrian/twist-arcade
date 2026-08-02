// packages/engine/test/wire-006-golden-trajectory.test.ts
//
// WIRE-006 from the M1 acceptance test plan (docs/tests/phase-0-platform-spine.md) — the
// highest-value untested criterion the review flagged: "a one-line 'cleanup' of the
// setup-rng wiring currently passes every existing test because the Rng goldens are
// unit-level." rng.test.ts pins the RAW mulberry32/splitmix32/xmur3 outputs; replay.test.ts
// pins per-step independence. Neither pins how replay() actually WIRES those streams to a
// real game's setup()/apply() end-to-end — a refactor of replay.ts's one setup line (e.g.
// swapping rngForSetup for a differently-suffixed or unsuffixed seed) would still produce
// byte-exact rng.test.ts goldens and still pass replay.test.ts's independence checks, yet
// silently orphan every stored replay. This test pins the COMPOSITE wire format: fixed seed
// + fixed move script -> exact encode() string and exact lastEffects array at every step.
// These literal values were captured on first run (via `pnpm exec tsx`, independent of
// vitest) against the current, fixed rng wiring (finding 1: setup() <- rngForSetup(seed)).
//
// Caveat, stated rather than hidden: bank-run's setup() does not consume its rng argument at
// all (see testkit/fixtures/bank-run.ts), so THIS golden trajectory does not, by itself,
// exercise a regression to the setup-rng convention specifically (finding 1's exact failure
// class) — only to per-step forking + apply()'s randomness consumption + encode/effects.
// See wire-006-fog-setup-rng.test.ts alongside this file for a companion golden trajectory
// built on a fixture that DOES draw randomness in setup(), which closes that specific gap.

import { describe, expect, it } from "vitest";
import { bankRun } from "../testkit/fixtures/bank-run";
import { appendStep, replay, type ReplayRecord } from "../src/replay";

function buildRecord(): ReplayRecord {
  let record: ReplayRecord = {
    gameId: bankRun.meta.id,
    gameVersion: bankRun.meta.version,
    engineVersion: "wire-golden-test",
    numPlayers: 1,
    seed: "wire-golden-1",
    steps: [],
  };
  const moves = [
    { kind: "push" as const },
    { kind: "push" as const },
    { kind: "bank" as const },
    { kind: "push" as const },
    { kind: "push" as const },
    { kind: "push" as const },
  ];
  for (const move of moves) {
    record = appendStep(record, new Map([[0, move]]));
  }
  return record;
}

const EXPECTED_ENCODES = [
  '{"banked":0,"round":0,"streak":0}',
  '{"banked":0,"round":1,"streak":1}',
  '{"banked":0,"round":2,"streak":0}',
  '{"banked":0,"round":3,"streak":0}',
  '{"banked":0,"round":4,"streak":0}',
  '{"banked":0,"round":5,"streak":0}',
  '{"banked":0,"round":6,"streak":1}',
];

const EXPECTED_EFFECTS: readonly unknown[][] = [
  [],
  [{ type: "revealed", result: "success" }],
  [{ type: "revealed", result: "bust", lostStreak: 1 }],
  [{ type: "banked", amount: 0 }],
  [{ type: "revealed", result: "bust", lostStreak: 0 }],
  [{ type: "revealed", result: "bust", lostStreak: 0 }],
  [{ type: "revealed", result: "success" }],
];

describe("WIRE-006: bank-run golden end-to-end trajectory (seed 'wire-golden-1')", () => {
  it("pins the exact encode() string and lastEffects array at every step", () => {
    const record = buildRecord();
    const result = replay(bankRun, record);

    expect(result.states).toHaveLength(EXPECTED_ENCODES.length);
    result.states.forEach((state, i) => {
      expect(bankRun.encode(state)).toBe(EXPECTED_ENCODES[i]);
      expect(state.lastEffects).toEqual(EXPECTED_EFFECTS[i]);
    });

    expect(result.status).toEqual({ kind: "scored", scores: [0] });
  });

  it("is byte-identical across two independent replay() calls (leaderboard-verification property, exercised directly on a real fixture)", () => {
    const record = buildRecord();
    const a = replay(bankRun, record);
    const b = replay(bankRun, record);
    expect(a.states.map((s) => bankRun.encode(s))).toEqual(b.states.map((s) => bankRun.encode(s)));
    expect(a.states.map((s) => s.lastEffects)).toEqual(b.states.map((s) => s.lastEffects));
    expect(a.status).toEqual(b.status);
  });
});

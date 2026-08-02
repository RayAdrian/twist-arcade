import { describe, expect, it } from "vitest";
import { classicTicTacToe } from "../testkit/fixtures/classic-ttt";
import { rngFor, rngForSetup } from "../src/rng";
import { appendStep, replay, replayTo, type ReplayRecord } from "../src/replay";

function buildTTTRecord(): ReplayRecord {
  // X plays corners+center to win top row: 0,1,2 for X; O plays elsewhere.
  // Moves: X:0, O:3, X:1, O:4, X:2 (X wins top row).
  let record: ReplayRecord = {
    gameId: classicTicTacToe.meta.id,
    gameVersion: classicTicTacToe.meta.version,
    engineVersion: "0.1.0",
    numPlayers: 2,
    seed: "ttt-replay-seed",
    steps: [],
  };
  const moves: [number, { cell: number }][] = [
    [0, { cell: 0 }],
    [1, { cell: 3 }],
    [0, { cell: 1 }],
    [1, { cell: 4 }],
    [0, { cell: 2 }],
  ];
  for (const [player, move] of moves) {
    record = appendStep(record, new Map([[player, move]]));
  }
  return record;
}

describe("replay() on a 2P fixture (classic-ttt)", () => {
  it("reproduces the full trajectory and final status", () => {
    const record = buildTTTRecord();
    const result = replay(classicTicTacToe, record);
    expect(result.states).toHaveLength(record.steps.length + 1); // initial + one per step
    expect(result.status).toEqual({ kind: "won", winner: 0 });
    expect(result.final.board).toEqual([0, 0, 0, 1, 1, null, null, null, null]);
  });

  it("is byte-identical (via encode) across two independent replays of the same record", () => {
    const record = buildTTTRecord();
    const a = replay(classicTicTacToe, record);
    const b = replay(classicTicTacToe, record);
    expect(a.states.map((s) => classicTicTacToe.encode(s))).toEqual(
      b.states.map((s) => classicTicTacToe.encode(s))
    );
  });

  it("refuses (throws) a log containing an illegal move", () => {
    const record = buildTTTRecord();
    // Corrupt step 1's move to re-place on an already-occupied cell.
    const corrupted: ReplayRecord = {
      ...record,
      steps: record.steps.map((s, i) => (i === 2 ? { moves: [[0, { cell: 0 }]] } : s)),
    };
    expect(() => replay(classicTicTacToe, corrupted)).toThrow();
  });

  it("replayTo(k) returns the state after exactly k steps", () => {
    const record = buildTTTRecord();
    const full = replay(classicTicTacToe, record);
    const atStep2 = replayTo(classicTicTacToe, record, 2);
    expect(classicTicTacToe.encode(atStep2)).toBe(classicTicTacToe.encode(full.states[2]!));
  });

  it("replayTo(0) returns the initial setup state", () => {
    const record = buildTTTRecord();
    const initial = replayTo(classicTicTacToe, record, 0);
    expect(initial.board).toEqual(Array.from({ length: 9 }, () => null));
  });
});

describe("appendStep", () => {
  it("returns a new record with the step appended, without mutating the original", () => {
    const record: ReplayRecord = {
      gameId: classicTicTacToe.meta.id,
      gameVersion: 1,
      engineVersion: "0.1.0",
      numPlayers: 2,
      seed: "s",
      steps: [],
    };
    const next = appendStep(record, new Map([[0, { cell: 0 }]]));
    expect(record.steps).toHaveLength(0);
    expect(next.steps).toHaveLength(1);
    expect(next).not.toBe(record);
  });
});

describe("replay determinism / rng plumbing", () => {
  // M1 review finding 1 (MUST FIX): rngFor(seed, 0) and the raw rngFromSeed(seed) ARE
  // algebraically identical by the pinned formula (rngFor(seed,k) =
  // mulberry32(splitmix32(xmur3(seed)+k)); at k=0 that is exactly what rngFromSeed(seed)
  // computes for a string seed). That fact is real and does not change — but replay.ts must
  // never feed that collision-prone stream to setup(). The property that actually matters,
  // restored here as a real assertion (an earlier version of this test asserted it and it was
  // wrongly deleted — that deletion is what let the collision ship silently): the stream
  // setup() actually receives (rngForSetup) must differ from step 0's stream (rngFor(seed,
  // 0)). See rng.test.ts's "rngForSetup domain separation" suite for the direct unit-level
  // proof; this is the replay-level restatement.
  it("the stream setup() receives differs from step 0's apply() stream", () => {
    const seed = "plumbing-seed";
    const setupFirst = rngForSetup(seed).next();
    const step0First = rngFor(seed, 0).next();
    expect(setupFirst).not.toBe(step0First);
  });

  it("does not throw when internally deriving a per-step rng", () => {
    const record = buildTTTRecord();
    expect(() => replay(classicTicTacToe, record)).not.toThrow();
  });

  it("rngFor(seed, k) differs across steps, so distinct steps never accidentally share a stream", () => {
    const a = rngFor("plumbing-seed", 0).next();
    const b = rngFor("plumbing-seed", 1).next();
    expect(a).not.toBe(b);
  });
});

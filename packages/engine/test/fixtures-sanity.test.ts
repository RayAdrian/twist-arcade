import { describe, expect, it } from "vitest";
import {
  miniCrackstep,
  MINI_CRACKSTEP_KNOWN_SOLUTION,
} from "../testkit/fixtures/mini-crackstep";
import { bankRun, createBankRun } from "../testkit/fixtures/bank-run";
import { appendStep, replay, type ReplayRecord } from "../src/replay";

describe("mini-crackstep sanity", () => {
  it("the known solution reaches a won terminal", () => {
    let record: ReplayRecord = {
      gameId: miniCrackstep.meta.id,
      gameVersion: miniCrackstep.meta.version,
      engineVersion: "0.1.0",
      numPlayers: 1,
      seed: "crackstep-known-solution",
      steps: [],
    };
    for (const move of MINI_CRACKSTEP_KNOWN_SOLUTION) {
      record = appendStep(record, new Map([[0, move]]));
    }
    const result = replay(miniCrackstep, record);
    expect(result.status).toEqual({ kind: "won", winner: 0 });
  });

  it("walking into a dead end (no path to the goal remaining) produces lost", () => {
    // Grid:
    // 0 1 2
    // 3 4 5
    // 6 7 8
    // Path 0 -> 1 -> 4 -> 7 -> 6 -> 3: visited = {0,1,4,7,6,3}. Cell 3's neighbors are
    // {0,6,4} — all crumbled — and 3 !== the goal (8), so the run is stuck: lost.
    let record: ReplayRecord = {
      gameId: miniCrackstep.meta.id,
      gameVersion: miniCrackstep.meta.version,
      engineVersion: "0.1.0",
      numPlayers: 1,
      seed: "crackstep-dead-end",
      steps: [],
    };
    for (const to of [1, 4, 7, 6, 3]) {
      record = appendStep(record, new Map([[0, { to }]]));
    }
    const result = replay(miniCrackstep, record);
    expect(result.status).toEqual({ kind: "lost" });
    expect(miniCrackstep.legalMoves(result.final, 0)).toEqual([]);
  });
});

describe("bank-run sanity", () => {
  it("reaches a scored terminal after the round cap, forfeiting any unbanked streak", () => {
    let record: ReplayRecord = {
      gameId: bankRun.meta.id,
      gameVersion: bankRun.meta.version,
      engineVersion: "0.1.0",
      numPlayers: 1,
      seed: "bank-run-sanity-seed",
      steps: [],
    };
    // Always push — never bank. Whatever the final banked total is, it must be 0, since
    // banked only increases via an explicit "bank" move.
    for (let i = 0; i < 6; i++) {
      record = appendStep(record, new Map([[0, { kind: "push" }]]));
    }
    const result = replay(bankRun, record);
    expect(result.status.kind).toBe("scored");
    if (result.status.kind === "scored") {
      expect(result.status.scores).toEqual([0]);
    }
    expect(bankRun.score?.(result.final, 0)).toBe(0);
  });

  it("banking commits the streak to the permanent score", () => {
    let record: ReplayRecord = {
      gameId: bankRun.meta.id,
      gameVersion: bankRun.meta.version,
      engineVersion: "0.1.0",
      numPlayers: 1,
      seed: "bank-run-commit-seed",
      steps: [],
    };
    // push, push, bank, then fill out the round cap with bank (no-ops on an empty streak).
    record = appendStep(record, new Map([[0, { kind: "push" }]]));
    record = appendStep(record, new Map([[0, { kind: "push" }]]));
    record = appendStep(record, new Map([[0, { kind: "bank" }]]));
    record = appendStep(record, new Map([[0, { kind: "bank" }]]));
    record = appendStep(record, new Map([[0, { kind: "bank" }]]));
    record = appendStep(record, new Map([[0, { kind: "bank" }]]));
    const result = replay(bankRun, record);
    expect(result.status.kind).toBe("scored");
    // score() at every reachable state must equal banked exactly — but this alone is
    // satisfied trivially by an engine that discards the streak on every push AND every
    // bank (banked stays 0 the whole way, and score() === banked === 0 throughout). M1
    // review finding 6: pin the actual COMMITTED value under this real seed (seed
    // "bank-run-commit-seed" busts push 1 then succeeds push 2 under the real rngFor
    // stream — computed via replay(), not stubbed — so exactly one point banks), so a
    // banking-is-a-no-op regression is caught even though the per-state score/banked
    // equality above would not catch it.
    if (result.status.kind === "scored") {
      expect(result.status.scores).toEqual([1]);
    }
    for (const s of result.states) {
      expect(bankRun.score?.(s, 0)).toBe(s.banked);
    }
  });

  it("createBankRun({ plantFarmingLoop: true }) never busts a push", () => {
    const farming = createBankRun({ plantFarmingLoop: true });
    let state = farming.setup(1, { next: () => 0.9999, int: () => 0, shuffle: (xs) => [...xs] });
    for (let i = 0; i < 5; i++) {
      state = farming.apply(state, new Map([[0, { kind: "push" }]]), {
        next: () => 0.9999, // would bust under the normal successProb, but not when planted
        int: () => 0,
        shuffle: (xs) => [...xs],
      });
    }
    expect(state.streak).toBe(5);
  });
});

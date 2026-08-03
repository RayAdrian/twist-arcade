import { describe, expect, it } from "vitest";
import { assertValidBotRecord, type DailyBotRecord } from "../src/era";

// Plan §2.2: the pinned bot is a stored, versioned artifact — never a runtime default.
// assertValidBotRecord is the load-time guard useGame's own assertDailyTierIsRollouts
// mirrors at the hook level; this is the manifest/era-file-level twin of that same rule.

function validRecord(overrides: Partial<DailyBotRecord> = {}): DailyBotRecord {
  return {
    era: 1,
    tier: "standard",
    policy: { kind: "mcts" },
    budget: { kind: "rollouts", n: 1000 },
    blunder: null,
    botsVersion: "0.1.0",
    humanSeat: 0,
    ...overrides,
  };
}

describe("era.ts — DailyBotRecord validation", () => {
  it("accepts a well-formed rollouts-budget record", () => {
    expect(() => assertValidBotRecord(validRecord())).not.toThrow();
  });

  it("rejects a deadlineMs budget — the exact failure mode a wall-clock budget would cause (plan §2.2)", () => {
    // @ts-expect-error — deliberately constructing the forbidden shape to prove the guard fires.
    const record: DailyBotRecord = validRecord({ budget: { kind: "deadlineMs", ms: 500 } });
    expect(() => assertValidBotRecord(record)).toThrow(/rollouts/);
  });

  it("rejects humanSeat !== 0 — D1: the human is always P1 in daily mode", () => {
    // @ts-expect-error — deliberately constructing the forbidden shape to prove the guard fires.
    const record: DailyBotRecord = validRecord({ humanSeat: 1 });
    expect(() => assertValidBotRecord(record)).toThrow(/humanSeat/);
  });

  it("rejects a non-positive rollouts budget", () => {
    const record = validRecord({ budget: { kind: "rollouts", n: 0 } });
    expect(() => assertValidBotRecord(record)).toThrow();
  });

  it("rejects a non-integer era", () => {
    const record = validRecord({ era: 1.5 });
    expect(() => assertValidBotRecord(record)).toThrow(/era/);
  });
});

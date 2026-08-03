import { describe, expect, it } from "vitest";
import { assertEraChangeIsReviewed, assertManifestBotMatchesEra, findEraReviewViolations } from "../src/era-guard";
import type { DailyBotRecord, EraFile } from "../src/era";

// Plan §2.3, point 1: "Era snapshot test — a committed vitest snapshot of era.json. Any edit
// fails CI unless the era number was bumped in the same diff and a line added to
// data/daily/CHANGELOG.md. A bot change is thereby always a visible, reviewed event." This
// module is the pure diff-comparison predicate behind that rule; scripts/check-era-changelog.mjs
// is the git-diff-driven CLI that feeds it real before/after era.json content.

function bot(overrides: Partial<DailyBotRecord> = {}): DailyBotRecord {
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

describe("era-guard.ts — findEraReviewViolations() / assertEraChangeIsReviewed()", () => {
  it("no violations when era.json is byte-identical", () => {
    const era: EraFile = { fadeout: bot() };
    expect(findEraReviewViolations(era, era, false)).toEqual([]);
  });

  it("no violations when unrelated games are added — a brand-new game entry needs no prior era to bump from", () => {
    const oldEra: EraFile = { fadeout: bot() };
    const newEra: EraFile = { fadeout: bot(), crackstep: bot({ era: 1, botsVersion: "0.2.0" }) };
    // A brand-new entry is still a change to the file, so CHANGELOG.md must have moved too.
    expect(findEraReviewViolations(oldEra, newEra, true)).toEqual([]);
  });

  it("PLANTED VIOLATION: a record changed WITHOUT bumping era is flagged by name", () => {
    const oldEra: EraFile = { fadeout: bot({ era: 1, budget: { kind: "rollouts", n: 1000 } }) };
    const newEra: EraFile = { fadeout: bot({ era: 1, budget: { kind: "rollouts", n: 4000 } }) }; // retuned, era NOT bumped
    const violations = findEraReviewViolations(oldEra, newEra, true);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.gameId).toBe("fadeout");
    expect(violations[0]?.reason).toMatch(/bump/i);
  });

  it("a record changed WITH era correctly bumped, but CHANGELOG.md untouched, is still flagged", () => {
    const oldEra: EraFile = { fadeout: bot({ era: 1 }) };
    const newEra: EraFile = { fadeout: bot({ era: 2, botsVersion: "0.2.0" }) };
    const violations = findEraReviewViolations(oldEra, newEra, false); // changelogChanged: false
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toMatch(/CHANGELOG/i);
  });

  it("accepts a well-formed change: record changed, era bumped, CHANGELOG.md touched", () => {
    const oldEra: EraFile = { fadeout: bot({ era: 1 }) };
    const newEra: EraFile = { fadeout: bot({ era: 2, botsVersion: "0.2.0" }) };
    expect(findEraReviewViolations(oldEra, newEra, true)).toEqual([]);
  });

  it("rejects an era bump that DECREASES or stays equal (not a real bump)", () => {
    const oldEra: EraFile = { fadeout: bot({ era: 3 }) };
    const newEra: EraFile = { fadeout: bot({ era: 2, botsVersion: "0.9.0" }) };
    const violations = findEraReviewViolations(oldEra, newEra, true);
    expect(violations).toHaveLength(1);
  });

  it("assertEraChangeIsReviewed throws (a build break) on any violation", () => {
    const oldEra: EraFile = { fadeout: bot({ era: 1 }) };
    const newEra: EraFile = { fadeout: bot({ era: 1, botsVersion: "0.9.0" }) };
    expect(() => assertEraChangeIsReviewed(oldEra, newEra, true)).toThrow(/fadeout/);
  });

  it("assertEraChangeIsReviewed does not throw for a well-formed reviewed change", () => {
    const oldEra: EraFile = { fadeout: bot({ era: 1 }) };
    const newEra: EraFile = { fadeout: bot({ era: 2 }) };
    expect(() => assertEraChangeIsReviewed(oldEra, newEra, true)).not.toThrow();
  });
});

describe("era-guard.ts — assertManifestBotMatchesEra() (plan §2.2: 'CI asserts the embedded copy is byte-identical to era.json for that era')", () => {
  // This is the exact check a live demonstration surfaced as MISSING while proving the
  // immutability guard: retuning a manifest's EMBEDDED bot copy (rather than era.json itself)
  // sailed straight past both the immutability guard's target (data/daily/*.json, which DOES
  // change so it's not an immutability violation on an already-future day) and the
  // era-changelog guard (which only ever looks at era.json, untouched in that scenario). Without
  // this check, a manifest's bot record and era.json's own copy of "the same era" could silently
  // diverge — exactly the comparability break plan §2.2 exists to prevent.
  const era: EraFile = { fadeout: bot({ era: 1, budget: { kind: "rollouts", n: 1000 } }) };

  it("accepts a manifest bot that is byte-identical to era.json's entry for the same gameId", () => {
    expect(() => assertManifestBotMatchesEra("fadeout", bot({ era: 1, budget: { kind: "rollouts", n: 1000 } }), era)).not.toThrow();
  });

  it("PLANTED VIOLATION: rejects a manifest bot that diverges from era.json under the SAME era number", () => {
    const divergedBot = bot({ era: 1, budget: { kind: "rollouts", n: 5000 } }); // retuned in the manifest only
    expect(() => assertManifestBotMatchesEra("fadeout", divergedBot, era)).toThrow(/era\.json/i);
  });

  it("rejects a manifest naming an era.json entry that doesn't exist at all", () => {
    expect(() => assertManifestBotMatchesEra("crackstep", bot(), era)).toThrow(/no era\.json entry/i);
  });
});

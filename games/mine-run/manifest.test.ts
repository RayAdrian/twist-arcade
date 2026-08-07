// games/mine-run/manifest.test.ts

import { describe, expect, it } from "vitest";
import { mineRun } from "./engine";
import { mineRunManifest, RULE_SENTENCE } from "./manifest";

describe("mine-run manifest", () => {
  it("rule sentence is <=90 chars and matches the frozen canonical wording (plan §1)", () => {
    expect(RULE_SENTENCE.length).toBeLessThanOrEqual(90);
    expect(RULE_SENTENCE).toBe("Reveal squares to grow a streak; bank anytime — a mine wipes your unbanked streak.");
    expect(mineRunManifest.ruleSentence).toBe(RULE_SENTENCE);
  });

  it("id matches engine.meta.id", () => {
    expect(mineRunManifest.id).toBe(mineRun.meta.id);
  });

  it("players min/max are 1/1 (solo score chase, matches engine.meta.maxPlayers)", () => {
    expect(mineRunManifest.players).toEqual({ min: 1, max: 1 });
    expect(mineRun.meta.maxPlayers).toBe(1);
  });

  it("no opponent modes and no difficulty tiers — there is no bot to play against", () => {
    expect(mineRunManifest.modes).toEqual({ bot: false, hotseat: false, asyncLink: false });
    expect(mineRunManifest.difficultyTiers).toEqual([]);
  });

  it("solo block declares score-chase with a monotone score and the score comparisonMetric (plan §13 DoD)", () => {
    expect(mineRunManifest.solo).toEqual({
      format: "score-chase",
      moveCap: 400,
      scoreMonotone: true,
      comparisonMetric: "score",
    });
  });

  it("carries exactly one manifest exception: the 32px cell-size floor, conditioned on two-tap commit (O2)", () => {
    expect(mineRunManifest.exceptions).toHaveLength(1);
    const exception = mineRunManifest.exceptions![0]!;
    expect(exception.gate).toBe("cell-size-48px");
    expect(exception.justification).toMatch(/two-tap/i);
  });

  it("tags include press-your-luck", () => {
    expect(mineRunManifest.tags).toContain("press-your-luck");
  });

  it("declares solvedValue explicitly as unknown (C23) — no proof artifact exists, so no gate " +
    "relief is claimed; explicit rather than silently omitted, mirroring C2's own rule for n/a " +
    "gates", () => {
    expect(mineRunManifest.solvedValue).toEqual({ value: "unknown" });
  });

  it("declares a C19/C22 CI-only rollout budget for the hidden-info solo-chase lane, evidence-" +
    "based against the REAL 10x10 board's root branching factor (not the smaller harness test " +
    "fixture's 6x6/36-cell board) — must clear MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE with margin", () => {
    expect(mineRunManifest.ciGateBudget).toEqual({ soloChaseCiRollouts: 750 });
  });
});

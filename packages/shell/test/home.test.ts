import { describe, expect, it } from "vitest";
import type { GameManifest } from "@twist-arcade/game-spec";
import { cardTiltClass, pickFeaturedManifest, shouldShowStreakFlame } from "../src/home";
import { INITIAL_STREAK, type StreakRecord } from "../src/streak";

function manifest(id: string): GameManifest {
  return {
    id,
    title: id,
    classic: "X",
    ruleSentence: "x",
    tags: [],
    estMinutes: 3,
    modes: { bot: true, hotseat: true, asyncLink: false },
    players: { min: 1, max: 2 },
    difficultyTiers: [],
  };
}

// Riso Zine home direction (design 1b) — pure helpers behind the home page's own three
// content-conflict resolutions: pickFeaturedManifest never fabricates a "next twist" (conflict
// 1, platform-corrections.md C44 — Order vs Chaos is killed), shouldShowStreakFlame renders no
// invented numbers (conflict 2), and cardTiltClass is the deterministic per-card rotation the
// "cut-out cards" material look needs. All three are extracted here — rather than left inline in
// app/page.tsx — specifically because they're the one part of the home page this repo's vitest
// workspace can actually unit-test (app/** has no vitest project; see app/page.tsx's own module
// doc for why the rest of the page composition is verified by Playwright/screenshot instead).
describe("pickFeaturedManifest — deterministic, never fabricates a game", () => {
  it("picks the first manifest, in registry order (no randomness, no wall-clock)", () => {
    const manifests = [manifest("crackstep"), manifest("fadeout")];
    expect(pickFeaturedManifest(manifests)?.id).toBe("crackstep");
  });

  it("returns null for an empty registry — never fabricates a placeholder game", () => {
    expect(pickFeaturedManifest([])).toBeNull();
  });

  it("is stable across repeated calls with the same input", () => {
    const manifests = [manifest("a"), manifest("b"), manifest("c")];
    expect(pickFeaturedManifest(manifests)?.id).toBe(pickFeaturedManifest(manifests)?.id);
  });
});

describe("shouldShowStreakFlame — never renders an invented number", () => {
  it("false for the initial (never-played) streak", () => {
    expect(shouldShowStreakFlame(INITIAL_STREAK)).toBe(false);
  });

  it("false when current is exactly 0", () => {
    const streak: StreakRecord = { current: 0, best: 5, lastDailyN: 3, lastDay: "2026-08-01" };
    expect(shouldShowStreakFlame(streak)).toBe(false);
  });

  it("true when current is > 0", () => {
    const streak: StreakRecord = { current: 3, best: 5, lastDailyN: 3, lastDay: "2026-08-01" };
    expect(shouldShowStreakFlame(streak)).toBe(true);
  });
});

describe("cardTiltClass — deterministic alternating rotation for cut-out cards", () => {
  it("returns a Tailwind rotate class containing a small fractional degree", () => {
    expect(cardTiltClass(0)).toMatch(/rotate-\[-?\d+(\.\d+)?deg\]/);
  });

  it("is deterministic: same index always yields the same class", () => {
    expect(cardTiltClass(2)).toBe(cardTiltClass(2));
  });

  it("cycles rather than growing unbounded (index 0 and index N both resolve to a class)", () => {
    const first = cardTiltClass(0);
    const wrapped = cardTiltClass(1000);
    expect(typeof wrapped).toBe("string");
    expect(wrapped.length).toBeGreaterThan(0);
    // Not asserting first === wrapped for a SPECIFIC modulus (that would over-constrain the
    // implementation's cycle length) — only that wrapping never throws or returns empty.
    expect(typeof first).toBe("string");
  });

  it("never rotates by a whole 90/180/etc degree — this is a subtle cut-out tilt, not a spin", () => {
    for (let i = 0; i < 8; i++) {
      const match = /rotate-\[(-?\d+(?:\.\d+)?)deg\]/.exec(cardTiltClass(i));
      expect(match).not.toBeNull();
      const deg = Math.abs(Number(match![1]));
      expect(deg).toBeGreaterThan(0);
      expect(deg).toBeLessThanOrEqual(1.5);
    }
  });
});

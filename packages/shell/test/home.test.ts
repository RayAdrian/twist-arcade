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

// The actual rotation degrees live in app/globals.css's `.tilt-a`..`.tilt-f` hand-authored
// classes, declared OUTSIDE any `@layer` block (see that file's comment on those rules, and
// home.ts's own doc comment on CARD_TILT_CLASSES, for the corrected C77 narrative on why that
// placement — not simply "named classes instead of arbitrary-value ones" — is what makes them
// survive content-scanning purge; `.scratch/prove-tilt-immune.mts` builds it both ways). This
// file can only assert the NAME-cycling contract from here — it has no way to observe whether a
// real build actually emits CSS for the returned name, which is exactly the kind of drift a
// future `` `tilt-${letter}` `` refactor could reintroduce without failing here. Real emission
// is verified by app/globals.css's own placement (structural, not tested per se) plus the
// screenshot verification pass in the final report.
describe("cardTiltClass — deterministic alternating tilt-class name for cut-out cards", () => {
  it("returns one of the known hand-authored tilt class names", () => {
    expect(cardTiltClass(0)).toMatch(/^tilt-[a-f]$/);
  });

  it("is deterministic: same index always yields the same class", () => {
    expect(cardTiltClass(2)).toBe(cardTiltClass(2));
  });

  it("alternates: consecutive indices never yield the same class", () => {
    for (let i = 0; i < 8; i++) {
      expect(cardTiltClass(i)).not.toBe(cardTiltClass(i + 1));
    }
  });

  it("cycles rather than growing unbounded (a large index still resolves to a valid class)", () => {
    expect(cardTiltClass(1000)).toMatch(/^tilt-[a-f]$/);
  });
});

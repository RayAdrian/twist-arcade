// games/tilt/manifest.test.ts — G-12 (platform-corrections.md M2 entry checklist,
// re-scoped to M5 template tests): the ruleSentence <=90-char constraint is asserted here as
// a REAL test, not only as the module-scope throw in manifest.ts — a future edit to
// manifest.ts cannot silently drop the check without a red test noticing.

import { describe, expect, it } from "vitest";
import { tilt } from "./engine";
import { manifest } from "./manifest";

describe("tilt manifest", () => {
  it("ruleSentence is <=90 characters (G-12)", () => {
    expect(manifest.ruleSentence.length).toBeLessThanOrEqual(90);
  });

  it("id matches engine.meta.id (plan §5.2's own contract)", () => {
    expect(manifest.id).toBe(tilt.meta.id);
  });

  it("players.min/max matches engine.meta.minPlayers/maxPlayers", () => {
    expect(manifest.players.min).toBe(tilt.meta.minPlayers);
    expect(manifest.players.max).toBe(tilt.meta.maxPlayers);
  });

  it("ciGateBudget.twoPlayerCiRollouts is set (T3, C22) and strictly above standard's shipped budget (C19/C20)", () => {
    const rollouts = manifest.ciGateBudget?.twoPlayerCiRollouts;
    expect(rollouts).toBeDefined();
    const standard = manifest.difficultyTiers.find((t) => t.id === "standard");
    expect(standard?.budget.kind).toBe("rollouts");
    if (standard && standard.budget.kind === "rollouts") {
      expect(rollouts!).toBeGreaterThan(standard.budget.n);
    }
  });
});

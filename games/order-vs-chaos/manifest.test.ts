// games/order-vs-chaos/manifest.test.ts — G-12 (platform-corrections.md M2 entry checklist,
// re-scoped to M5 template tests): the ruleSentence <=90-char constraint is asserted here as
// a REAL test, not only as the module-scope throw in manifest.ts — a future edit to
// manifest.ts cannot silently drop the check without a red test noticing.

import { describe, expect, it } from "vitest";
import { orderVsChaos } from "./engine";
import { manifest } from "./manifest";

describe("order-vs-chaos manifest", () => {
  it("ruleSentence is <=90 characters (G-12)", () => {
    expect(manifest.ruleSentence.length).toBeLessThanOrEqual(90);
  });

  it("id matches engine.meta.id (plan §5.2's own contract)", () => {
    expect(manifest.id).toBe(orderVsChaos.meta.id);
  });

  it("players.min/max matches engine.meta.minPlayers/maxPlayers", () => {
    expect(manifest.players.min).toBe(orderVsChaos.meta.minPlayers);
    expect(manifest.players.max).toBe(orderVsChaos.meta.maxPlayers);
  });

  // OV2 (docs/plans/order-vs-chaos.md §4, §7): the shipped "ruthless" tier's 10,000 rollouts
  // exceeds MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE (3,000), so runCiSuite hard-refuses suite "ci"
  // without an explicit ciGateBudget.twoPlayerCiRollouts (platform-corrections.md C22). OV1
  // left this deliberately unset (manifest.ts's own module doc). This test demands the value
  // OV2's cost-pilot + budget-validation-sweep evidence produces, not an arbitrary number —
  // once set, manifest.ts's own comment must name the board and the pilot data it came from
  // (C25's provenance rule).
  it("ciGateBudget.twoPlayerCiRollouts is set, from OV2's validated budget sweep (C22)", () => {
    expect(manifest.ciGateBudget?.twoPlayerCiRollouts).toBeTypeOf("number");
    expect(manifest.ciGateBudget?.twoPlayerCiRollouts).toBeGreaterThan(0);
  });
});

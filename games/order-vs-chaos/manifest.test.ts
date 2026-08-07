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
});

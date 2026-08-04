// games/crackstep/manifest.test.ts — G-12 (platform-corrections.md M2 entry checklist,
// re-scoped to M5 template tests): the ruleSentence <=90-char constraint is asserted here as
// a REAL test, not only as the module-scope throw in manifest.ts — a future edit to
// manifest.ts cannot silently drop the check without a red test noticing.

import { describe, expect, it } from "vitest";
import { crackstep } from "./engine";
import { manifest } from "./manifest";

describe("crackstep manifest", () => {
  it("ruleSentence is <=90 characters (G-12)", () => {
    expect(manifest.ruleSentence.length).toBeLessThanOrEqual(90);
  });

  it("id matches engine.meta.id (plan §5.2's own contract)", () => {
    expect(manifest.id).toBe(crackstep.meta.id);
  });

  it("players.min/max matches engine.meta.minPlayers/maxPlayers (both 1 for a solo game)", () => {
    expect(manifest.players.min).toBe(crackstep.meta.minPlayers);
    expect(manifest.players.max).toBe(crackstep.meta.maxPlayers);
  });

  it("manifest.solo is present iff players.max === 1 (C2's own precondition)", () => {
    expect(manifest.solo).toBeDefined();
  });
});

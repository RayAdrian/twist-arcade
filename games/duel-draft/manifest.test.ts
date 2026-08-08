// games/duel-draft/manifest.test.ts — G-12 (platform-corrections.md M2 entry checklist,
// re-scoped to M5 template tests): the ruleSentence <=90-char constraint is asserted here as
// a REAL test, not only as the module-scope throw in manifest.ts — a future edit to
// manifest.ts cannot silently drop the check without a red test noticing.

import { describe, expect, it } from "vitest";
import { evaluateMirrorProbeGate } from "@twist-arcade/harness";
import { duelDraft } from "./engine";
import { manifest } from "./manifest";
import { MIRROR_PROBE_NOT_APPLICABLE_REASON } from "./probes";

describe("duel-draft manifest", () => {
  it("ruleSentence is <=90 characters (G-12)", () => {
    expect(manifest.ruleSentence.length).toBeLessThanOrEqual(90);
  });

  it("id matches engine.meta.id (plan §5.2's own contract)", () => {
    expect(manifest.id).toBe(duelDraft.meta.id);
  });

  it("players.min/max matches engine.meta.minPlayers/maxPlayers", () => {
    expect(manifest.players.min).toBe(duelDraft.meta.minPlayers);
    expect(manifest.players.max).toBe(duelDraft.meta.maxPlayers);
  });

  // platform-corrections.md C48 (ruled), routed at C62: this game declares the mirror probe
  // n/a rather than exporting a vacuous mirrorMove — see probes.ts's module doc for the reason
  // this is correct for a simultaneous, no-prior-move-within-a-round game.
  it("declares mirrorProbe not-applicable, citing probes.ts's own reason constant verbatim", () => {
    expect(manifest.mirrorProbe).toEqual({ applicable: false, reason: MIRROR_PROBE_NOT_APPLICABLE_REASON });
  });

  it("the harness's real evaluator reports this as n/a citing the reason, not a WARN or a silent skip", () => {
    const result = evaluateMirrorProbeGate(manifest);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("n/a");
    expect(result!.detail).toBe(`not applicable: ${MIRROR_PROBE_NOT_APPLICABLE_REASON}`);
  });
});

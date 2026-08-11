// games/bid-tac-toe/manifest.test.ts — G-12 (platform-corrections.md M2 entry checklist,
// re-scoped to M5 template tests): the ruleSentence <=90-char constraint is asserted here as
// a REAL test, not only as the module-scope throw in manifest.ts — a future edit to
// manifest.ts cannot silently drop the check without a red test noticing.

import { describe, expect, it } from "vitest";
import { evaluateMirrorProbeGate } from "@twist-arcade/harness";
import { bidTacToe } from "./engine";
import { manifest } from "./manifest";
import { MIRROR_PROBE_NOT_APPLICABLE_REASON } from "./probes";

describe("bid-tac-toe manifest", () => {
  it("ruleSentence is <=90 characters (G-12)", () => {
    expect(manifest.ruleSentence.length).toBeLessThanOrEqual(90);
  });

  it("id matches engine.meta.id (plan §5.2's own contract)", () => {
    expect(manifest.id).toBe(bidTacToe.meta.id);
  });

  it("players.min/max matches engine.meta.minPlayers/maxPlayers", () => {
    expect(manifest.players.min).toBe(bidTacToe.meta.minPlayers);
    expect(manifest.players.max).toBe(bidTacToe.meta.maxPlayers);
  });

  // platform-corrections.md C48 (ruled), routed at C62: B1's own flag ("the mirror probe will
  // WARN... Implement at B3") — this game declares the mirror probe n/a rather than exporting
  // a vacuous mirrorMove. See probes.ts's module doc: the board is spatially symmetric but bids
  // and the star have no reflective analogue.
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

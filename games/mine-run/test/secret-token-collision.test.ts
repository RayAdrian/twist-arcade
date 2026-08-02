// games/mine-run/test/secret-token-collision.test.ts
//
// Self-test for secret.ts's collision-proof claim (docs/plans/mine-run.md §3.2: "an encoding
// that cannot collide with legitimate view numbers... prove it with a self-test"). Runs random
// playouts and asserts the secret tokens NEVER accidentally appear in a legitimate view's
// serialization for reasons other than an actual leak — i.e., the token format itself cannot
// be produced by any real (n/exploded/mine/width/height/...) view content.

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import { mineSecretToken, MINES_FIELD_TOKEN } from "../secret";

describe("secret token collision-proofness", () => {
  it("mineSecretToken()'s format never appears in a correct, fully-revealed view by coincidence", () => {
    const engine = createMineRun({ width: 6, height: 6, mines: 6, budget: 30 });
    for (let run = 0; run < 10; run++) {
      const seed = `token-collision-${run}`;
      let state = engine.setup(1, rngForSetup(seed));
      let step = 0;
      while (engine.status(state).kind === "ongoing" && step < 40) {
        const legal = engine.legalMoves(state, 0);
        const move = legal[0]!;
        state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
        step++;
      }
      // Even a FULLY revealed (post-terminal spectator) view, which legitimately contains
      // every cell's true n/exploded/mine content, must never coincidentally contain the raw
      // token strings — those are reserved, out-of-band markers, not real view vocabulary.
      const spectatorView = engine.playerView(state, null);
      const serialized = JSON.stringify(spectatorView);
      expect(serialized).not.toContain(MINES_FIELD_TOKEN);
      for (const m of state.mines) {
        expect(serialized).not.toContain(mineSecretToken(m));
      }
    }
  });
});

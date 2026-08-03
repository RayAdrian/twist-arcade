// games/mine-run/test/secret-token-collision.test.ts
//
// Self-test for secret.ts, covering two distinct claims:
//  1. MINES_FIELD_TOKEN's collision-freedom: it must never appear in ANY legitimate,
//     correctly-redacted view, including a fully-revealed post-terminal spectator view.
//  2. makeMineRunSecretExtractor's own gating: mineSecretToken(m) must be REQUIRED (present in
//     the returned secret list) for the player's own view and for an ONGOING spectator view,
//     and DROPPED only for a TERMINAL spectator view — exactly secret.ts's `spectatorAtTerminal`
//     conjunct (`player === null && status.kind !== "ongoing"`). This replaces this file's
//     earlier per-mine "never coincidentally appears" assertion, which was written for the old
//     artificial-tag token design (`"__MINE_SECRET_n__"`) and no longer holds by design: the
//     new structural token (`"<cell>":{"mine":true}`) is SUPPOSED to appear in a legitimate
//     terminal spectator view — that's the whole point of anchoring it to the real leak shape
//     (see secret.ts's doc comment). What must be pinned instead is that the extractor only
//     ever calls it a non-secret in that one legitimate case.

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import { createMineRun } from "../engine";
import { makeMineRunSecretExtractor, mineSecretToken, MINES_FIELD_TOKEN } from "../secret";

describe("secret token collision-proofness and extractor gating", () => {
  it("MINES_FIELD_TOKEN never appears in a correct, fully-revealed view by coincidence", () => {
    const engine = createMineRun({ width: 6, height: 6, mines: 6, budget: 30 });
    for (let run = 0; run < 10; run++) {
      const seed = `token-collision-${run}`;
      let state = engine.setup(1, rngForSetup(seed));
      let step = 0;
      while (engine.status(state).kind === "ongoing" && step < 40) {
        const legal = engine.legalMoves(state, 0);
        // Prefer a reveal over a bank: legalMovesFor lists `bank` FIRST whenever streakLen >=
        // 1, so `legal[0]` alone can ping-pong reveal/bank/reveal/bank without ever exhausting
        // revealsLeft or the safe-cell total within the step cap (a real bug this file's
        // comment claim -- "post-terminal spectator view" -- was silently vulnerable to; see
        // "notes to fold in" in the Fable review). Always revealing when possible guarantees
        // revealsLeft strictly decreases every step, so terminal is reached well within budget
        // (30) steps.
        const move = legal.find((m) => m.t === "reveal") ?? legal[0]!;
        state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
        step++;
      }
      // The claim this test depends on: we actually reached a real terminal state, not just
      // the step cap. Asserted explicitly rather than assumed.
      expect(engine.status(state).kind).not.toBe("ongoing");

      // Even a FULLY revealed (post-terminal spectator) view, which legitimately contains
      // every cell's true n/exploded/mine content, must never coincidentally contain this
      // reserved, out-of-band marker — it is not real view vocabulary.
      const spectatorView = engine.playerView(state, null);
      const serialized = JSON.stringify(spectatorView);
      expect(serialized).not.toContain(MINES_FIELD_TOKEN);
    }
  });

  it("makeMineRunSecretExtractor requires mine tokens for the player and for an ONGOING " +
    "spectator, and drops them ONLY for a TERMINAL spectator view", () => {
    const width = 6;
    const height = 6;
    const totalCells = width * height;
    const engine = createMineRun({ width, height, mines: 6, budget: 30 });
    const extractor = makeMineRunSecretExtractor(totalCells);
    const seed = "extractor-gating";
    let state = engine.setup(1, rngForSetup(seed));

    // Mid-run: both the player (0) and a spectator (-1) must have every un-exploded mine
    // listed as a required secret — the carve-out has not opened yet.
    expect(engine.status(state).kind).toBe("ongoing");
    const unexplodedSet = new Set(state.exploded);
    const unexplodedAtStart = state.mines.filter((m) => !unexplodedSet.has(m));
    expect(unexplodedAtStart.length).toBeGreaterThan(0);
    const playerSecretsStart = extractor(state, 0);
    const spectatorSecretsStart = extractor(state, -1);
    for (const m of unexplodedAtStart) {
      expect(playerSecretsStart).toContain(mineSecretToken(m));
      expect(spectatorSecretsStart).toContain(mineSecretToken(m));
    }

    // Drive to terminal. Prefer a reveal over a bank (see the other test's comment above for
    // why `legal[0]` alone can ping-pong without ever exhausting the budget).
    let step = 0;
    while (engine.status(state).kind === "ongoing" && step < 40) {
      const legal = engine.legalMoves(state, 0);
      const move = legal.find((m) => m.t === "reveal") ?? legal[0]!;
      state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
      step++;
    }
    expect(engine.status(state).kind).not.toBe("ongoing");

    const explodedAtEnd = new Set(state.exploded);
    const unexplodedAtEnd = state.mines.filter((m) => !explodedAtEnd.has(m));

    // Player (0) never gets the carve-out — every un-exploded mine remains required.
    const playerSecretsEnd = extractor(state, 0);
    for (const m of unexplodedAtEnd) {
      expect(playerSecretsEnd).toContain(mineSecretToken(m));
    }

    // Spectator (-1) at terminal: the carve-out is now legitimate, so mine tokens are DROPPED
    // — but the masking-anti-pattern guard is still always required, even here.
    const spectatorSecretsEnd = extractor(state, -1);
    for (const m of unexplodedAtEnd) {
      expect(spectatorSecretsEnd).not.toContain(mineSecretToken(m));
    }
    expect(spectatorSecretsEnd).toContain(MINES_FIELD_TOKEN);
  });
});

// games/mine-run/test/spectator-carveout.test.ts
//
// Fable review (must-fix 2): the spectator "show me the mines" carve-out in engine.ts's
// playerView() is exactly the conjunction `player === null && status.kind !== "ongoing"`.
// Dropping either conjunct is a silent, high-severity leak (the full mine layout, mid-run) —
// and the property-based redaction check alone did not have this pinned directly enough to
// survive a regression (see secret.ts's doc comment and redaction-mutant.test.ts's carve-out
// regression mutant). This file pins BOTH arms directly against the real engine, independent
// of any secretExtractor machinery: a mid-run spectator view must show nothing but the
// revealed cells and never `mine: true`; a terminal spectator view must legitimately show the
// full layout.

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup } from "@twist-arcade/engine";
import { createMineRun } from "../engine";

describe("spectator carve-out — both arms pinned directly on playerView", () => {
  it("mid-run (ongoing): playerView(state, null) shows ONLY revealed cells, and no cell carries mine:true", () => {
    const engine = createMineRun({ width: 6, height: 6, mines: 6, budget: 20 });
    const seed = "spectator-carveout-midrun";
    let state = engine.setup(1, rngForSetup(seed));
    const legal = engine.legalMoves(state, 0).filter((m) => m.t === "reveal");
    state = engine.apply(state, new Map([[0, legal[0]!]]), rngFor(seed, 0));
    expect(engine.status(state).kind).toBe("ongoing"); // a genuine mid-run state

    const spectatorView = engine.playerView(state, null);
    const revealedSet = new Set(state.revealed);

    // Structural: exactly the revealed set, nothing more, nothing less.
    const viewKeys = new Set(Object.keys(spectatorView.cells).map(Number));
    expect(viewKeys).toEqual(revealedSet);

    // Content: no entry — revealed or not — carries the terminal-only mine:true shape.
    for (const key of Object.keys(spectatorView.cells)) {
      expect(spectatorView.cells[Number(key)]).not.toEqual({ mine: true });
    }
  });

  it("terminal: playerView(state, null) DOES legitimately reveal the full layout (the carve-out)", () => {
    const engine = createMineRun({ width: 4, height: 4, mines: 3, budget: 30 });
    const seed = "spectator-carveout-terminal";
    let state = engine.setup(1, rngForSetup(seed));
    let step = 0;
    while (engine.status(state).kind === "ongoing" && step < 60) {
      const legal = engine.legalMoves(state, 0);
      // Prefer a reveal over a bank -- legalMovesFor lists `bank` FIRST once streakLen >= 1,
      // so `legal[0]` alone can ping-pong reveal/bank without ever exhausting revealsLeft or
      // the safe-cell total (see secret-token-collision.test.ts's comment for the same issue
      // found by the Fable review). Always revealing when possible guarantees termination.
      const move = legal.find((m) => m.t === "reveal") ?? legal[0]!;
      state = engine.apply(state, new Map([[0, move]]), rngFor(seed, step));
      step++;
    }
    expect(engine.status(state).kind).not.toBe("ongoing"); // reached a real terminal

    const spectatorView = engine.playerView(state, null);
    const explodedSet = new Set(state.exploded);

    // Every cell on the board now has an entry (the carve-out shows everything).
    expect(Object.keys(spectatorView.cells).length).toBe(4 * 4);
    for (const m of state.mines) {
      const cell = spectatorView.cells[m];
      expect(cell).toBeDefined();
      if (explodedSet.has(m)) {
        expect(cell).toEqual({ exploded: true });
      } else {
        expect(cell).toEqual({ mine: true }); // the ONE legitimate place this shape may appear
      }
    }
  });
});

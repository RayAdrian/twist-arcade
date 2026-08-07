// games/nine-grids/index.test.ts — the real announce() strings (ux-lens §8-9, this game's own
// test plan Area A11Y — every case there is tagged [SPEC] against the old TODO placeholders;
// these tests turn A11Y-001..004/010's INFORMATION-CONTENT contracts into real, observed-passing
// assertions against this build). Calls `presentation.announce()` directly with the exact
// `GameEvent` shapes `useGame.ts` composes them with (see that file's `applyMove`) — effects come
// from REAL `nineGrids.apply()` steps, never hand-mocked, so a change to `transition()`'s effect
// vocabulary would break these tests too, not just silently go unnoticed.

import { describe, expect, it } from "vitest";
import type { Rng } from "@twist-arcade/engine";
import { nineGrids, type NineGridsMove, type NineGridsState } from "./engine";
import { presentation } from "./index";

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] };

function play(moves: NineGridsMove[]): NineGridsState {
  let state = nineGrids.setup(2, NO_OP_RNG);
  for (const move of moves) {
    const mover = state.toMove;
    state = nineGrids.apply(state, new Map([[mover, move]]), NO_OP_RNG);
  }
  return state;
}

describe("announce({kind:'moved'}) — what the mover just did", () => {
  it("SEND-002 shape: a plain placement, no board closed", () => {
    const before = play([]);
    const move: NineGridsMove = { board: 4, cell: 7 };
    const after = nineGrids.apply(before, new Map([[0, move]]), NO_OP_RNG);
    const str = presentation.announce({ kind: "moved", player: 0, move, effects: after.lastEffects });
    expect(str).toBe("X placed in the middle center board, bottom center.");
  });

  it("A11Y-002 shape: the SAME move both places AND wins the board it was played in", () => {
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
    ]);
    const winningMove: NineGridsMove = { board: 0, cell: 0 };
    const after = nineGrids.apply(state, new Map([[0, winningMove]]), NO_OP_RNG);
    const str = presentation.announce({ kind: "moved", player: 0, move: winningMove, effects: after.lastEffects });
    expect(str).toBe("X placed in the top left board, top left. X wins the top left board.");
  });
});

describe("announce({kind:'imminent'}) — the SEND consequence: confined, or free + why (A11Y-001/003)", () => {
  it("a normal send: names the exact board the opponent must play in", () => {
    const before = play([]);
    const move: NineGridsMove = { board: 4, cell: 7 };
    const after = nineGrids.apply(before, new Map([[0, move]]), NO_OP_RNG);
    const str = presentation.announce({ kind: "imminent", effects: after.lastEffects, view: after });
    expect(str).toBe("Play in the bottom center board.");
  });

  it("A11Y-002: closed BY THIS MOVE — 'now closed', paired with the moved fragment's own win sentence", () => {
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
    ]);
    const winningMove: NineGridsMove = { board: 0, cell: 0 }; // wins board 0 AND sends to board 0
    const after = nineGrids.apply(state, new Map([[0, winningMove]]), NO_OP_RNG);
    expect(after.activeBoard).toBeNull();
    const str = presentation.announce({ kind: "imminent", effects: after.lastEffects, view: after });
    expect(str).toBe("The top left board is now closed — free move, play in any open board.");
  });

  it("A11Y-003 (S1b): sent to a board closed on an EARLIER turn — 'already closed', names why", () => {
    const state = play([
      { board: 0, cell: 1 },
      { board: 1, cell: 0 },
      { board: 0, cell: 2 },
      { board: 2, cell: 0 },
      { board: 0, cell: 0 }, // wins board 0, O is now free (S1)
    ]);
    expect(state.toMove).toBe(1);
    const move: NineGridsMove = { board: 5, cell: 0 }; // O sends X to board 0 — already closed
    const after = nineGrids.apply(state, new Map([[1, move]]), NO_OP_RNG);
    const str = presentation.announce({ kind: "imminent", effects: after.lastEffects, view: after });
    expect(str).toBe("The top left board is already closed (won by X) — free move, play in any open board.");
  });

  it("silent once the game has ended — a status event owns the terminal announcement instead", () => {
    // D4-style: force a macro win and confirm imminent goes quiet rather than naming a "next"
    // board that doesn't exist. Build directly via decode (Appendix B's D4 fixture shape).
    const WX0 = [0, 0, 0, 1, 1, null, 1, null, null];
    const E = new Array(9).fill(null);
    const board4 = [0, null, 1, null, 0, 1, null, null, null];
    const cells = [...WX0, ...E, ...E, ...E, ...board4, ...E, ...E, ...E, ...WX0];
    const state = nineGrids.decode(JSON.stringify({ cells, activeBoard: 4, toMove: 0 }));
    const move: NineGridsMove = { board: 4, cell: 8 };
    const after = nineGrids.apply(state, new Map([[0, move]]), NO_OP_RNG);
    expect(nineGrids.status(after)).toEqual({ kind: "won", winner: 0 });
    const str = presentation.announce({ kind: "imminent", effects: after.lastEffects, view: after });
    expect(str).toBe("");
  });
});

describe("announce({kind:'status'}) — the terminal, assertive-channel announcement (A11Y-004)", () => {
  it("a macro win names the winner, once", () => {
    const str = presentation.announce({ kind: "status", status: { kind: "won", winner: 0 } });
    expect(str).toBe("X wins — three boards in a row.");
  });

  it("a draw is distinct from a win", () => {
    const str = presentation.announce({ kind: "status", status: { kind: "draw" } });
    expect(str).toBe("Draw — all nine boards are closed.");
  });

  it("ongoing status produces no assertive text (never fires mid-game)", () => {
    expect(presentation.announce({ kind: "status", status: { kind: "ongoing" } })).toBe("");
  });
});

describe("announce({kind:'boardSummary'}) — on-request only (A11Y-010: never per-move — see useGame's isDecayClassEffects gate, which Nine Grids' effect vocabulary never satisfies)", () => {
  it("reports won counts, open count, and current confinement in one composed sentence", () => {
    const state = play([{ board: 4, cell: 7 }]);
    const str = presentation.announce({ kind: "boardSummary", view: state });
    expect(str).toContain("X has won 0 boards");
    expect(str).toContain("confined to the bottom center board");
  });
});

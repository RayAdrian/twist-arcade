// games/tilt/index.test.ts — the real announce() strings (plan §6.3). Calls
// `presentation.announce()` directly with the exact `GameEvent` shapes `useGame.ts` composes
// them with — effects come from REAL `tilt.apply()` steps, never hand-mocked, so a change to
// the engine's effect vocabulary would break these tests too, not just silently go unnoticed.
// Fixtures mirror engine.test.ts's own hand-verified positions where useful, so the "what
// actually happened" claim is checked against the same trace, not re-derived blind.

import { describe, expect, it } from "vitest";
import type { Rng } from "@twist-arcade/engine";
import { TILT_PERIOD, tilt, toMoveOf, type TiltMove, type TiltState } from "./engine";
import { presentation } from "./index";

const NO_OP_RNG: Rng = { next: () => 0, int: () => 0, shuffle: (xs) => [...xs] };

function play(moves: TiltMove[]): TiltState {
  let state = tilt.setup(2, NO_OP_RNG);
  for (const move of moves) {
    const mover = toMoveOf(state.grid);
    state = tilt.apply(state, new Map([[mover, move]]), NO_OP_RNG);
  }
  return state;
}

describe("announce({kind:'moved'}) — what the mover just did (plan §6.3.1)", () => {
  it("a plain drop, no tilt: names the mover and the column", () => {
    const before = play([]);
    const move: TiltMove = { column: 2 };
    const after = tilt.apply(before, new Map([[0, move]]), NO_OP_RNG);
    const str = presentation.announce({ kind: "moved", player: 0, move, effects: after.lastEffects });
    expect(str).toBe("● dropped in column 3.");
  });

  it("a tilt-triggering drop: the tilt summary is NEVER omitted (plan §6.3.2, load-bearing)", () => {
    // engine.test.ts's own hand-verified 4-ply fixture: col0,col0,col1,col0 — 4th ply tilts,
    // 4 discs displaced (0,0,col1->col1 landing plus col2 arrival — see that test for the trace).
    const state = play([{ column: 0 }, { column: 0 }, { column: 1 }, { column: 0 }]);
    expect(state.lastEffects.some((e) => e.type === "tilted")).toBe(true);
    const movedCount = state.lastEffects.filter((e) => e.type === "moved").length;
    expect(movedCount).toBeGreaterThan(0);
    const str = presentation.announce({ kind: "moved", player: 1, move: { column: 0 }, effects: state.lastEffects });
    expect(str).toContain("Board tilted clockwise.");
    expect(str).toContain(`${movedCount} piece`);
  });

  it("a no-op tilt (moved: []) still announces the tilt itself, with a count of zero", () => {
    const state = play([{ column: 6 }, { column: 6 }, { column: 6 }, { column: 6 }]);
    expect(state.lastEffects.some((e) => e.type === "tilted")).toBe(true);
    expect(state.lastEffects.filter((e) => e.type === "moved")).toEqual([]);
    const str = presentation.announce({ kind: "moved", player: 1, move: { column: 6 }, effects: state.lastEffects });
    expect(str).toContain("Board tilted clockwise. 0 pieces resettled.");
  });

  it("returns empty string when there is no 'placed' effect to describe (defensive)", () => {
    const str = presentation.announce({ kind: "moved", player: 0, move: { column: 0 }, effects: [] });
    expect(str).toBe("");
  });
});

describe("announce({kind:'imminent'}) — tilt proximity, same counting source as the telegraph (plan §6.3.1)", () => {
  it("silent more than 2 plies before the next tilt", () => {
    const state = play([]);
    const str = presentation.announce({ kind: "imminent", effects: state.lastEffects, view: state });
    expect(str).toBe("");
  });

  it("'after the next move' with exactly 1 ply remaining", () => {
    const state = play(Array.from({ length: TILT_PERIOD - 1 }, (_, i) => ({ column: i })));
    const str = presentation.announce({ kind: "imminent", effects: state.lastEffects, view: state });
    expect(str).toBe("Board tilts after the next move.");
  });
});

describe("announce({kind:'boardSummary'}) — on-demand full readback, always the CURRENT (post-tilt) grid", () => {
  it("reflects discs and open columns", () => {
    const state = play([{ column: 0 }]);
    const str = presentation.announce({ kind: "boardSummary", view: state });
    expect(str).toContain("1 filled discs, 0 ringed discs");
  });
});

describe("announce({kind:'status'}) — the game-ending fact, never omitted (plan §6.3.2)", () => {
  it("a win names the winner", () => {
    const str = presentation.announce({ kind: "status", status: { kind: "won", winner: 0 } });
    expect(str).toBe("● completed four in a row. ● wins.");
  });

  it("a draw is announced", () => {
    const str = presentation.announce({ kind: "status", status: { kind: "draw" } });
    expect(str).toBe("Draw.");
  });

  it("is silent while the game is ongoing", () => {
    const str = presentation.announce({ kind: "status", status: { kind: "ongoing" } });
    expect(str).toBe("");
  });
});

describe("boardDimensions", () => {
  it("is the full 7x7 grid", () => {
    const state = play([]);
    expect(presentation.boardDimensions(state)).toEqual({ rows: 7, cols: 7 });
  });
});

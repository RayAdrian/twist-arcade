// games/duel-draft/resolution.test.ts — the domain-specific acceptance criteria from
// docs/plans/duel-draft.md §3/§12 that the generic engineContract() suite (engine.test.ts)
// cannot express: the pinned resolution table, apply()'s typed-error behavior, decode()'s C4
// rejection cases (plus the deliberate double-win ACCEPTANCE, the opposite of a rejection),
// the equal-counts invariant, encode's round-order independence, and the structural
// termination bound (<=16 rounds, zero cap hits, no encode repeats within a playout).
//
// engineContract() already covers (see contract.ts): purity, termination (within the 200-ply
// cap engineContract itself uses), determinism (including a replay() cross-check), encode/
// decode canonical form + effects-never-accumulate + status-stable, GLOBAL encode injectivity,
// isLegal<->legalMoves coherence, playerView totality + perfect-info identity, and "never
// emits `lost`". This file does not re-test any of that.

import { describe, expect, it } from "vitest";
import { rngFromSeed, rngFor, rngForSetup } from "@twist-arcade/engine";
import {
  duelDraft,
  DuelDraftApplyError,
  DuelDraftDecodeError,
  SIZE,
  WINDOWS,
  type Cell,
  type DuelDraftState,
} from "./engine";

const rng = rngFromSeed("resolution-test");

function boardOf(fill: Record<number, Cell>): readonly Cell[] {
  const board: Cell[] = Array.from({ length: SIZE * SIZE }, () => "empty");
  for (const [i, c] of Object.entries(fill)) board[Number(i)] = c;
  return board;
}

function freshState(board?: readonly Cell[]): DuelDraftState {
  return { board: board ?? Array.from({ length: SIZE * SIZE }, () => "empty"), lastEffects: [] };
}

// ---------------------------------------------------------------------------------------
// Window count pencil-check (D0's own self-test pinned this: 10 at WIN_LENGTH=4).
// ---------------------------------------------------------------------------------------

describe("WINDOWS", () => {
  it("has exactly 10 windows at WIN_LENGTH=4 (4 rows + 4 cols + 2 diagonals)", () => {
    expect(WINDOWS.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------
// Pinned resolution table (plan §3's TDD anchors / §12 acceptance criteria 3-5).
// ---------------------------------------------------------------------------------------

describe("pinned resolution table", () => {
  it("distinct picks: both marks placed in one apply(), effects placed x2 with seat 0 first", () => {
    const state = freshState();
    const next = duelDraft.apply(state, new Map([[0, { cell: 0 }], [1, { cell: 5 }]]), rng);
    expect(next.board[0]).toBe(0);
    expect(next.board[5]).toBe(1);
    expect(next.lastEffects).toEqual([
      { type: "placed", player: 0, cell: 0 },
      { type: "placed", player: 1, cell: 5 },
    ]);
  });

  it("same pick: nothing placed, the cell is destroyed, a single collided effect", () => {
    const state = freshState();
    const next = duelDraft.apply(state, new Map([[0, { cell: 7 }], [1, { cell: 7 }]]), rng);
    expect(next.board[7]).toBe("destroyed");
    expect(next.lastEffects).toEqual([{ type: "collided", cell: 7 }]);
  });

  it("one-line win: the opponent's simultaneous placement stands, and does not block the win", () => {
    // Seat 0 has 3 of the top row; this round's distinct picks complete it for seat 0 while
    // seat 1 ALSO places a mark elsewhere on the board — that placement must stand.
    const state = freshState(boardOf({ 0: 0, 1: 0, 2: 0 }));
    const next = duelDraft.apply(state, new Map([[0, { cell: 3 }], [1, { cell: 15 }]]), rng);
    expect(duelDraft.status(next)).toEqual({ kind: "won", winner: 0 });
    expect(next.board[15]).toBe(1); // seat 1's simultaneous placement still stands
  });

  it("double-win: both seats complete a line in the same round -> draw, never a seat-winner", () => {
    // Seat 0 has 3 of row 0 (cells 0-3, missing 3); seat 1 has 3 of row 1 (cells 4-7, missing
    // 7). Distinct picks 3 and 7 complete BOTH lines in the same round.
    const state = freshState(boardOf({ 0: 0, 1: 0, 2: 0, 4: 1, 5: 1, 6: 1 }));
    const next = duelDraft.apply(state, new Map([[0, { cell: 3 }], [1, { cell: 7 }]]), rng);
    expect(duelDraft.status(next)).toEqual({ kind: "draw" });
  });

  it("a line through a destroyed cell never scores, even with 3 of 4 cells held by one player", () => {
    const state = freshState(boardOf({ 0: 0, 1: 0, 2: 0, 3: "destroyed" }));
    expect(duelDraft.status(state)).toEqual({ kind: "ongoing" });
  });

  it("forced collision: with exactly one empty cell, both seats' only legal pick is that cell", () => {
    // 15 of 16 cells filled (arbitrary legal-looking pattern, no pre-existing line), cell 15
    // empty.
    const fill: Record<number, Cell> = {};
    const pattern: Cell[] = [0, 1, 0, 1, "destroyed", 0, 1, 0, 1, "destroyed", 0, 1, 0, 1, "destroyed"];
    pattern.forEach((c, i) => (fill[i] = c));
    const state = freshState(boardOf(fill));
    expect(duelDraft.status(state)).toEqual({ kind: "ongoing" });

    const legal0 = duelDraft.legalMoves(state, 0);
    const legal1 = duelDraft.legalMoves(state, 1);
    expect(legal0).toEqual([{ cell: 15 }]);
    expect(legal1).toEqual([{ cell: 15 }]);

    const next = duelDraft.apply(state, new Map([[0, { cell: 15 }], [1, { cell: 15 }]]), rng);
    expect(next.board[15]).toBe("destroyed");
    expect(duelDraft.legalMoves(next, 0)).toEqual([]);
  });

  it("exhausted board, no line: draw", () => {
    // All 16 cells filled with an equal 8/8 split and no completed line anywhere. NOT a
    // checkerboard: a checkerboard's cell value is (row+col) mod 2, which is CONSTANT along
    // both main diagonals (row+col is constant on the (r,r) diagonal and always-odd on the
    // (r,3-r) anti-diagonal) — a checkerboard always hands one seat a diagonal win by
    // construction, so this pattern is deliberately irregular instead (every row, column, and
    // both diagonals checked by hand to hold both values).
    const pattern: Cell[] = [
      0, 0, 1, 1,
      1, 1, 0, 0,
      0, 1, 0, 1,
      1, 0, 1, 0,
    ];
    const state = freshState(pattern);
    expect(duelDraft.status(state)).toEqual({ kind: "draw" });
  });
});

// ---------------------------------------------------------------------------------------
// active() (plan §12 acceptance criterion 2).
// ---------------------------------------------------------------------------------------

describe("active()", () => {
  it("reports simultaneous [0, 1] on the initial state", () => {
    const rngSetup = rngForSetup("active-test");
    const state = duelDraft.setup(2, rngSetup);
    expect(duelDraft.active(state)).toEqual({ mode: "simultaneous", players: [0, 1] });
  });

  it("reports simultaneous [0, 1] mid-game", () => {
    const state = freshState(boardOf({ 0: 0, 5: 1 }));
    expect(duelDraft.active(state)).toEqual({ mode: "simultaneous", players: [0, 1] });
  });
});

// ---------------------------------------------------------------------------------------
// apply()'s typed-error contract (plan §3: "a missing seat, extra actor, or illegal cell
// throws a typed error — never a silent default").
// ---------------------------------------------------------------------------------------

describe("apply() typed errors", () => {
  it("throws when a seat's move is missing", () => {
    const state = freshState();
    expect(() => duelDraft.apply(state, new Map([[0, { cell: 0 }]]), rng)).toThrow(DuelDraftApplyError);
  });

  it("throws when an extra actor's move is present", () => {
    const state = freshState();
    expect(() =>
      duelDraft.apply(state, new Map([[0, { cell: 0 }], [1, { cell: 1 }], [2, { cell: 2 }]]), rng)
    ).toThrow(DuelDraftApplyError);
  });

  it("throws when a move targets an occupied cell", () => {
    const state = freshState(boardOf({ 3: 0 }));
    expect(() => duelDraft.apply(state, new Map([[0, { cell: 3 }], [1, { cell: 4 }]]), rng)).toThrow(
      DuelDraftApplyError
    );
  });

  it("throws when a move targets an out-of-range cell", () => {
    const state = freshState();
    expect(() => duelDraft.apply(state, new Map([[0, { cell: 16 }], [1, { cell: 1 }]]), rng)).toThrow(
      DuelDraftApplyError
    );
  });

  it("throws when apply() is called on a terminal state", () => {
    const state = freshState(boardOf({ 0: 0, 1: 0, 2: 0, 3: 0 })); // already won
    expect(() => duelDraft.apply(state, new Map([[0, { cell: 4 }], [1, { cell: 5 }]]), rng)).toThrow(
      DuelDraftApplyError
    );
  });
});

// ---------------------------------------------------------------------------------------
// decode()'s C4 contract (plan §3/§12 acceptance criterion 8).
// ---------------------------------------------------------------------------------------

describe("decode()", () => {
  it("throws on invalid JSON", () => {
    expect(() => duelDraft.decode("not json")).toThrow(DuelDraftDecodeError);
  });

  it("throws when the top-level value is not an object", () => {
    expect(() => duelDraft.decode("[1,2,3]")).toThrow(DuelDraftDecodeError);
  });

  it("throws when board has the wrong length", () => {
    const bad = JSON.stringify({ board: Array.from({ length: 15 }, () => "empty") });
    expect(() => duelDraft.decode(bad)).toThrow(DuelDraftDecodeError);
  });

  it("throws when board contains an invalid cell value", () => {
    const board: unknown[] = Array.from({ length: 16 }, () => "empty");
    board[0] = "not-a-cell";
    const bad = JSON.stringify({ board });
    expect(() => duelDraft.decode(bad)).toThrow(DuelDraftDecodeError);
  });

  it("throws when count(p0) !== count(p1)", () => {
    const board = boardOf({ 0: 0, 1: 0, 2: 1 }); // 2 vs 1
    const bad = JSON.stringify({ board });
    expect(() => duelDraft.decode(bad)).toThrow(DuelDraftDecodeError);
  });

  it("ACCEPTS a double-win board (both seats complete a line) as a terminal draw — the opposite of Nine Grids' C28-A3 ruling", () => {
    const board = boardOf({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1 });
    const encoded = JSON.stringify({ board });
    const decoded = duelDraft.decode(encoded);
    expect(duelDraft.status(decoded)).toEqual({ kind: "draw" });
  });
});

// ---------------------------------------------------------------------------------------
// encode()'s round-order independence (plan §2.1: "Two round-orders reaching the same board
// reach the same game in every respect").
// ---------------------------------------------------------------------------------------

describe("encode() order-independence (plan §2.1)", () => {
  it("two different round orders reaching the identical board encode identically", () => {
    const start = freshState();

    // Order A: round 1 places (0,1)->(cell0,cell5); round 2 places (0,1)->(cell1,cell6).
    let a = duelDraft.apply(start, new Map([[0, { cell: 0 }], [1, { cell: 5 }]]), rngFor("order-a", 0));
    a = duelDraft.apply(a, new Map([[0, { cell: 1 }], [1, { cell: 6 }]]), rngFor("order-a", 1));

    // Order B: the SAME two rounds, swapped.
    let b = duelDraft.apply(start, new Map([[0, { cell: 1 }], [1, { cell: 6 }]]), rngFor("order-b", 0));
    b = duelDraft.apply(b, new Map([[0, { cell: 0 }], [1, { cell: 5 }]]), rngFor("order-b", 1));

    expect(duelDraft.encode(a)).toBe(duelDraft.encode(b));
  });
});

// ---------------------------------------------------------------------------------------
// Equal-counts invariant, live through apply() (plan §2.1) — decode()'s own rejection of a
// FORGED unequal-count board is tested above; this checks the invariant actually HOLDS through
// real play, never merely that a violation is rejected after the fact.
// ---------------------------------------------------------------------------------------

describe("equal-counts invariant (plan §2.1)", () => {
  it("count(p0) === count(p1) after every apply() across a random playout", () => {
    let state = duelDraft.setup(2, rngForSetup("equal-counts"));
    for (let round = 0; round < 16 && duelDraft.status(state).kind === "ongoing"; round++) {
      const legal0 = duelDraft.legalMoves(state, 0);
      const legal1 = duelDraft.legalMoves(state, 1);
      const driverRng = rngFor("equal-counts:driver", round);
      const m0 = legal0[driverRng.int(legal0.length)]!;
      const m1 = legal1[driverRng.int(legal1.length)]!;
      state = duelDraft.apply(state, new Map([[0, m0], [1, m1]]), rngFor("equal-counts", round));
      const p0 = state.board.filter((c) => c === 0).length;
      const p1 = state.board.filter((c) => c === 1).length;
      expect(p0).toBe(p1);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Structural termination (plan §1.5/§12 acceptance criterion 6): every game <=16 rounds, zero
// cap hits, no encode() repeats within a playout (the DAG property).
// ---------------------------------------------------------------------------------------

describe("structural termination", () => {
  it("200 random playouts: every game terminates within 16 rounds and never repeats an encode() within itself", () => {
    for (let i = 0; i < 200; i++) {
      const seed = `structural-termination-${i}`;
      let state = duelDraft.setup(2, rngForSetup(seed));
      const seen = new Set<string>([duelDraft.encode(state)]);
      let round = 0;
      while (duelDraft.status(state).kind === "ongoing") {
        expect(round).toBeLessThan(16); // strictly enforced BELOW the loop's own safety valve
        const legal0 = duelDraft.legalMoves(state, 0);
        const legal1 = duelDraft.legalMoves(state, 1);
        const driverRng = rngFor(`${seed}:driver`, round);
        const m0 = legal0[driverRng.int(legal0.length)]!;
        const m1 = legal1[driverRng.int(legal1.length)]!;
        state = duelDraft.apply(state, new Map([[0, m0], [1, m1]]), rngFor(seed, round));
        round += 1;
        const enc = duelDraft.encode(state);
        expect(seen.has(enc)).toBe(false); // DAG property: no revisited position within a playout
        seen.add(enc);
        if (round > 16) throw new Error(`engine bug: game exceeded 16 rounds (seed=${seed})`);
      }
      expect(round).toBeLessThanOrEqual(16);
    }
  });
});

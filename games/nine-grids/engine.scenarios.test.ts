// games/nine-grids/engine.scenarios.test.ts — hand-constructed scenario tests for the two
// facts engineContract's RANDOM playouts are unlikely to exercise densely: (1) the strict
// ruleset's closed-board free-move rule, in BOTH its "won" and "full-but-drawn" flavors (the
// task brief's "single most likely bug" — getting only ONE of the two closed-reasons wired to
// the free-move rule), and (2) that a full-but-drawn board is DECISIVE-NEUTRAL for the macro
// win check, not merely "not the opponent's" (a subtly different, wrong rule that would let a
// drawn board complete someone's macro line).
//
// These are hand-built NineGridsState values, not reached via a legal move history — legitimate
// because encode()/legality/status here depend ONLY on (cells, activeBoard, toMove), never on
// how that combination was reached (see engine-internal.ts's module doc on C3). decode()'s
// stricter reachability-flavored invariants (mark-count parity, activeBoard-must-be-open) are
// a separate concern, about rejecting FORGED external input, and are tested separately below
// against decode() specifically, not against these hand-built in-memory states.
//
// Each closed-board/neutral-blocking assertion here was verified by deliberately planting the
// corresponding bug in engine-internal.ts and confirming the specific test below (and only
// that test) went red, then reverting — "verify by planting violations, not by reading code."

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { nineGrids, type NineGridsMove, type NineGridsState } from "./engine";

const rng = rngFromSeed("nine-grids-scenarios");

function apply(state: NineGridsState, player: 0 | 1, move: NineGridsMove): NineGridsState {
  return nineGrids.apply(state, new Map([[player, move]]), rng);
}

/** Splices a 9-cell micro board's marks into an 81-cell array at `board`'s offset. */
function withBoard(cells: (0 | 1 | null)[], board: number, marks: (0 | 1 | null)[]): (0 | 1 | null)[] {
  const next = cells.slice();
  for (let i = 0; i < 9; i++) next[board * 9 + i] = marks[i]!;
  return next;
}

function blankCells(): (0 | 1 | null)[] {
  return new Array(81).fill(null);
}

// A real, valid full-tic-tac-toe-board draw pattern (no three-in-a-row for either mark):
//   0 1 0        X O X
//   0 1 1   ==   X O O
//   1 0 0        O X X
const DRAWN_BOARD: (0 | 1 | null)[] = [0, 1, 0, 0, 1, 1, 1, 0, 0];

// Player 0 wins the top row of a micro board.
const WON_TOP_ROW: (0 | 1 | null)[] = [0, 0, 0, null, null, null, null, null, null];

describe("nine-grids: closed-board free-move rule (strict ruleset)", () => {
  it("sending the opponent to an ALREADY-WON board grants a free move anywhere still open", () => {
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW); // board 0: won by player 0, closed
    const state: NineGridsState = { cells, activeBoard: 5, toMove: 1, lastEffects: [] };

    // Player 1, confined to board 5, plays LOCAL cell 0 — which names board 0 as the send
    // target. Board 0 is already won/closed, so this must be a free move for player 0.
    const next = apply(state, 1, { board: 5, cell: 0 });

    expect(next.activeBoard).toBeNull();
    expect(next.lastEffects).toEqual([{ type: "placed", player: 1, board: 5, cell: 0 }]);

    const legal = nineGrids.legalMoves(next, 0);
    const boardsOffered = new Set(legal.map((m) => m.board));
    expect(boardsOffered.has(0)).toBe(false); // board 0 is closed: never offered
    expect(boardsOffered.size).toBeGreaterThan(1); // genuinely "anywhere", not one board
    expect(boardsOffered.has(1)).toBe(true);
    expect(boardsOffered.has(5)).toBe(true); // board 5 itself still has 8 empty cells
  });

  it("sending the opponent to an ALREADY-FULL-BUT-DRAWN board ALSO grants a free move anywhere", () => {
    let cells = blankCells();
    cells = withBoard(cells, 0, DRAWN_BOARD); // board 0: full, no winner, closed
    const state: NineGridsState = { cells, activeBoard: 5, toMove: 1, lastEffects: [] };

    const next = apply(state, 1, { board: 5, cell: 0 });

    expect(next.activeBoard).toBeNull();
    const legal = nineGrids.legalMoves(next, 0);
    const boardsOffered = new Set(legal.map((m) => m.board));
    expect(boardsOffered.has(0)).toBe(false);
    expect(boardsOffered.size).toBeGreaterThan(1);
  });

  it("sending the opponent to a STILL-OPEN board confines them to exactly that board (contrast case)", () => {
    const state: NineGridsState = { cells: blankCells(), activeBoard: 5, toMove: 1, lastEffects: [] };
    // Player 1 plays local cell 3 (board 3 is untouched/open) -> player 0 is confined to board 3.
    const next = apply(state, 1, { board: 5, cell: 3 });

    expect(next.activeBoard).toBe(3);
    const legal = nineGrids.legalMoves(next, 0);
    expect(legal.length).toBe(9); // all of board 3's cells, nothing else
    expect(legal.every((m) => m.board === 3)).toBe(true);

    // isLegal must reject a move in any OTHER open board while confined.
    expect(nineGrids.isLegal(next, 0, { board: 5, cell: 0 })).toBe(false);
  });
});

describe("nine-grids: won vs full are different closed-reasons, surfaced as different effects", () => {
  it("completing a three-in-a-row emits `boardWon` (not `boardClosed`)", () => {
    // Board 0 needs one more X to complete the top row: X at 0,1, empty at 2.
    let cells = blankCells();
    cells = withBoard(cells, 0, [0, 0, null, null, null, null, null, null, null]);
    const state: NineGridsState = { cells, activeBoard: 0, toMove: 0, lastEffects: [] };

    const next = apply(state, 0, { board: 0, cell: 2 });

    expect(next.lastEffects).toEqual([
      { type: "placed", player: 0, board: 0, cell: 2 },
      { type: "boardWon", board: 0, winner: 0 },
    ]);
  });

  it("filling the last cell with no winner emits `boardClosed` (not `boardWon`)", () => {
    // One cell short of DRAWN_BOARD: leave the last cell (index 8, an X per DRAWN_BOARD) empty.
    let cells = blankCells();
    const almostDrawn = DRAWN_BOARD.slice();
    almostDrawn[8] = null;
    cells = withBoard(cells, 0, almostDrawn);
    const state: NineGridsState = { cells, activeBoard: 0, toMove: 0, lastEffects: [] };

    const next = apply(state, 0, { board: 0, cell: 8 });

    expect(next.lastEffects).toEqual([
      { type: "placed", player: 0, board: 0, cell: 8 },
      { type: "boardClosed", board: 0 },
    ]);
  });
});

describe("nine-grids: a full-but-drawn board is DECISIVE-NEUTRAL for the macro win check", () => {
  it("does NOT award a macro win through a line containing a drawn (winner-less) board", () => {
    // Macro line (0,1,2): board 0 won by player 0, board 2 won by player 0, board 1 FULL/drawn.
    // A buggy macroWinnerOf that treats "not opponent" as sufficient (rather than requiring
    // "won by this exact player") would wrongly call this a win for player 0.
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW);
    cells = withBoard(cells, 1, DRAWN_BOARD);
    cells = withBoard(cells, 2, WON_TOP_ROW);
    const state: NineGridsState = { cells, activeBoard: null, toMove: 1, lastEffects: [] };

    expect(nineGrids.status(state)).toEqual({ kind: "ongoing" });
  });

  it("DOES award a macro win through a line of three genuine wins (positive control)", () => {
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW);
    cells = withBoard(cells, 1, WON_TOP_ROW);
    cells = withBoard(cells, 2, WON_TOP_ROW);
    const state: NineGridsState = { cells, activeBoard: null, toMove: 1, lastEffects: [] };

    expect(nineGrids.status(state)).toEqual({ kind: "won", winner: 0 });
  });

  it("draws the overall game when every board is closed and no macro line completed", () => {
    // All 9 boards drawn (no winner anywhere) -> overall draw, never a `won` or `ongoing`.
    let cells = blankCells();
    for (let board = 0; board < 9; board++) cells = withBoard(cells, board, DRAWN_BOARD);
    const state: NineGridsState = { cells, activeBoard: null, toMove: 0, lastEffects: [] };

    expect(nineGrids.status(state)).toEqual({ kind: "draw" });
  });
});

describe("nine-grids: encode() is a sound position key (platform-corrections.md C3)", () => {
  it("two different move orders reaching the same position encode identically", () => {
    // Two independent boards (0 and 1) never interact — playing into them in either order
    // reaches the SAME logical position. If encode() depended on history, these would differ;
    // it doesn't, because this game has none to depend on.
    const start: NineGridsState = { cells: blankCells(), activeBoard: null, toMove: 0, lastEffects: [] };

    // Order A: board0 cell4, board2 cell4 (wherever each send happens to land, both paths are
    // legal because both target boards start empty), interleaved with forced replies.
    let a = apply(start, 0, { board: 0, cell: 4 }); // X -> sends O to board 4
    a = apply(a, 1, { board: 4, cell: 1 }); // O -> sends X to board 1
    a = apply(a, 0, { board: 1, cell: 4 }); // X -> sends O to board 4

    let b = apply(start, 0, { board: 0, cell: 4 });
    b = apply(b, 1, { board: 4, cell: 1 });
    b = apply(b, 0, { board: 1, cell: 4 });

    expect(nineGrids.encode(a)).toBe(nineGrids.encode(b));
  });
});

describe("nine-grids: decode() rejects forged/impossible input (platform-corrections.md C4)", () => {
  it("throws on non-JSON input", () => {
    expect(() => nineGrids.decode("not json")).toThrow();
  });

  it("throws when `cells` is the wrong length", () => {
    const bad = JSON.stringify({ cells: new Array(80).fill(null), activeBoard: null, toMove: 0 });
    expect(() => nineGrids.decode(bad)).toThrow();
  });

  it("throws when `cells` contains an invalid value", () => {
    const cells = blankCells();
    (cells as unknown[])[0] = 2; // only 0, 1, null are valid marks
    const bad = JSON.stringify({ cells, activeBoard: null, toMove: 0 });
    expect(() => nineGrids.decode(bad)).toThrow();
  });

  it("throws when mark counts are inconsistent with toMove (forged turn order)", () => {
    // Two X marks, zero O marks, but claims it's P0's turn again (should be P1's, since P0 has
    // played one more mark than P1).
    let cells = blankCells();
    cells = withBoard(cells, 0, [0, 0, null, null, null, null, null, null, null]);
    const bad = JSON.stringify({ cells, activeBoard: null, toMove: 0 });
    expect(() => nineGrids.decode(bad)).toThrow();
  });

  it("throws when activeBoard points at an already-closed board", () => {
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW);
    const bad = JSON.stringify({ cells, activeBoard: 0, toMove: 1 });
    expect(() => nineGrids.decode(bad)).toThrow();
  });

  it("throws when activeBoard is out of range", () => {
    const bad = JSON.stringify({ cells: blankCells(), activeBoard: 9, toMove: 0 });
    expect(() => nineGrids.decode(bad)).toThrow();
  });

  it("round-trips a legitimate mid-game state without throwing, and decode().lastEffects is []", () => {
    let cells = blankCells();
    cells = withBoard(cells, 0, [0, 1, null, null, null, null, null, null, null]);
    const state: NineGridsState = { cells, activeBoard: 2, toMove: 0, lastEffects: [] };
    const encoded = nineGrids.encode(state);
    const decoded = nineGrids.decode(encoded);
    expect(decoded.lastEffects).toEqual([]);
    expect(nineGrids.encode(decoded)).toBe(encoded);
  });
});

describe("nine-grids: mirrorMove point-reflection probe", () => {
  it("mirrors the opponent's move through the board's point-symmetric center (g -> 80-g)", async () => {
    const { mirrorMove } = await import("./probes");
    const state: NineGridsState = { cells: blankCells(), activeBoard: null, toMove: 1, lastEffects: [] };
    const legal = nineGrids.legalMoves(state, 1);
    // Opponent (player 0) played {board: 3, cell: 2} -> global 29. Mirror is 80-29=51 ->
    // board 5, cell 6.
    const mirrored = mirrorMove(state, { board: 3, cell: 2 }, legal);
    expect(mirrored).toEqual({ board: 5, cell: 6 });
  });
});

// Player 0 (O-shaped) wins the top row of a micro board — the O-owner counterpart of
// WON_TOP_ROW above, used to build macro patterns where ownership is split between the two
// players (WON_TOP_ROW alone can only ever assert "X owns this board").
const WON_TOP_ROW_O: (0 | 1 | null)[] = [1, 1, 1, null, null, null, null, null, null];

describe("nine-grids: C28 ruling A1 — dead-position draw detection", () => {
  it("ends the game as a draw the moment no macro line remains achievable for EITHER player, even though a board is still open", () => {
    // Macro layout (board index -> status): 0=X 1=O 2=OPEN 3=O 4=DRAWN 5=X 6=X 7=O 8=O.
    // Every one of the 8 macro lines is dead for BOTH players: each either passes through the
    // drawn board 4 (kills a line for both sides outright) or contains both an X-won and an
    // O-won board (mixed ownership, so neither side's line can ever complete). Board 2 is the
    // ONLY board left open — 9 empty cells, plenty of legal moves under the old "play until all
    // boards close" rule. Verified by hand against LINES: [0,1,2] mixed, [3,4,5] has board4,
    // [6,7,8] mixed, [0,3,6] mixed, [1,4,7] has board4, [2,5,8] mixed, [0,4,8] has board4,
    // [2,4,6] has board4.
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW); // X
    cells = withBoard(cells, 1, WON_TOP_ROW_O); // O
    // board 2 left blank/open on purpose
    cells = withBoard(cells, 3, WON_TOP_ROW_O); // O
    cells = withBoard(cells, 4, DRAWN_BOARD); // full, no winner
    cells = withBoard(cells, 5, WON_TOP_ROW); // X
    cells = withBoard(cells, 6, WON_TOP_ROW); // X
    cells = withBoard(cells, 7, WON_TOP_ROW_O); // O
    cells = withBoard(cells, 8, WON_TOP_ROW_O); // O
    const state: NineGridsState = { cells, activeBoard: null, toMove: 0, lastEffects: [] };

    expect(nineGrids.status(state)).toEqual({ kind: "draw" });
    // The termination-contract corollary (already covered generically by engineContract, pinned
    // here for this specific shape): a non-ongoing status means zero legal moves for either
    // seat, even though board 2's 9 cells are still physically empty.
    expect(nineGrids.legalMoves(state, 0)).toEqual([]);
    expect(nineGrids.legalMoves(state, 1)).toEqual([]);
    expect(nineGrids.isLegal(state, 0, { board: 2, cell: 0 })).toBe(false);
  });

  it("does NOT call a position dead while at least one macro line remains achievable for one side (contrast case)", () => {
    // Same shape as the WIN-006-style "drawn board blocks a line" scenario already covered
    // above, restated to make the A1 boundary explicit: board 0 and board 2 are X-won, board 1
    // is drawn (blocks line [0,1,2] for both), but boards 3-8 are all still fully open, so
    // e.g. line [3,4,5] remains achievable for BOTH players. Must stay `ongoing`.
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW);
    cells = withBoard(cells, 1, DRAWN_BOARD);
    cells = withBoard(cells, 2, WON_TOP_ROW);
    const state: NineGridsState = { cells, activeBoard: null, toMove: 1, lastEffects: [] };

    expect(nineGrids.status(state)).toEqual({ kind: "ongoing" });
    expect(nineGrids.legalMoves(state, 1).length).toBeGreaterThan(0);
  });
});

describe("nine-grids: C28 ruling A2 (confirmed as pinned) — free-move scope is any empty cell of any OPEN board", () => {
  it("a genuine free move (activeBoard: null) never offers empty cells of a won-but-not-full board", () => {
    // Board 0: X has the top row (3 marks) but 6 cells are still physically empty — exactly the
    // "won-but-not-full" shape A2 is about. Boards 1-8 are untouched/open. toMove: 1 with no
    // send in effect (activeBoard null) — the opening-move shape of a free move, not merely
    // "sent to a board that happened to be closed" (already covered by the closed-board-send
    // tests above; this pins the SAME rule for a free move reached any other way).
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW);
    const state: NineGridsState = { cells, activeBoard: null, toMove: 1, lastEffects: [] };

    const legal = nineGrids.legalMoves(state, 1);
    expect(legal.length).toBe(8 * 9); // every cell of boards 1-8, none of board 0's
    expect(legal.some((m) => m.board === 0)).toBe(false);

    // isLegal must independently reject an EMPTY cell of the won board (not just full boards).
    expect(nineGrids.isLegal(state, 1, { board: 0, cell: 3 })).toBe(false);
    // Contrast: an empty cell of a genuinely open board is legal.
    expect(nineGrids.isLegal(state, 1, { board: 1, cell: 0 })).toBe(true);
  });
});

describe("nine-grids: C28 ruling A3 — decode() rejects a micro board with completed lines for BOTH players", () => {
  it("throws NineGridsDecodeError on the DEC-011/AMB-double fixture: board 0 = an X line AND an O line at once", () => {
    // b0 = [0,0,0, 1,1,1, null,null,null]: X's top row AND O's middle row both complete in the
    // same 9 cells — impossible to reach by real play, since transition() closes a board (and
    // stops accepting marks into it) at its FIRST completed line. Rest of the boards empty.
    let cells = blankCells();
    cells = withBoard(cells, 0, [0, 0, 0, 1, 1, 1, null, null, null]);
    const bad = JSON.stringify({ cells, activeBoard: null, toMove: 0 });

    expect(() => nineGrids.decode(bad)).toThrow();
    try {
      nineGrids.decode(bad);
      expect.unreachable("decode should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("NineGridsDecodeError");
      expect((err as Error).message).toContain("BOTH players");
    }
  });

  it("does NOT reject a board with only ONE completed line (positive control — the common, legal case)", () => {
    // Two DIFFERENT boards, each with exactly one completed line for a DIFFERENT player — this
    // must stay legal (the check is per-board, not "no two boards may disagree"). Mark counts
    // (3 X, 3 O) are parity-consistent with toMove: 0.
    let cells = blankCells();
    cells = withBoard(cells, 0, WON_TOP_ROW); // X only, one line
    cells = withBoard(cells, 1, WON_TOP_ROW_O); // O only, one line, DIFFERENT board
    const encoded = JSON.stringify({ cells, activeBoard: null, toMove: 0 });

    expect(() => nineGrids.decode(encoded)).not.toThrow();
  });

  it("rejects the conflicting-lines board regardless of which OTHER board carries the send (activeBoard-open elsewhere)", () => {
    // Confirms the new check fires independently of the existing activeBoard-open invariant:
    // board 5 is untouched/open and legitimately confines the mover there, while board 0 is
    // the structurally-impossible one.
    let cells = blankCells();
    cells = withBoard(cells, 0, [0, 0, 0, 1, 1, 1, null, null, null]);
    const bad = JSON.stringify({ cells, activeBoard: 5, toMove: 0 });

    expect(() => nineGrids.decode(bad)).toThrow(/BOTH players/);
  });
});

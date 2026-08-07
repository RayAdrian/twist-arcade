// games/order-vs-chaos/engine.test.ts — TDD per CLAUDE.md §3: every `it` below pins one
// behavior from docs/plans/order-vs-chaos.md §5's acceptance criteria (derived from the plan,
// not from engine.ts's implementation — the plan's own instruction for stage-3 test design,
// applied here at the TDD-anchor level too). The generic `engineContract()` suite covers
// purity/determinism/legality-coherence/encode-decode-roundtrip/etc. generically; everything
// below is game-specific.
//
// `runs: 100` is explicit (not the testkit's own default) — G-14's rule: CI must never depend
// on a library default for its sample count.

import { describe, expect, it } from "vitest";
import { engineContract } from "@twist-arcade/engine/testkit";
import { rngFor, rngForSetup, type PlayerId } from "@twist-arcade/engine";
import {
  CHAOS_SEAT,
  DEFAULT_CONFIG_ID,
  ORDER_SEAT,
  createOrderVsChaosEngine,
  orderVsChaos,
  type OrderVsChaosState,
} from "./engine";
import { TOTAL_CELLS, WIN_LENGTH, type Cell, type CellSymbol } from "./engine-internal";
import { buildFullNoRunBoard, buildFullNoRunBoardAllowingPinnedRun } from "./test/board-fixtures";

engineContract(orderVsChaos, { runs: 100, maxPlies: 40 });

// ---------------------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------------------

function apply(
  engine: typeof orderVsChaos,
  state: OrderVsChaosState,
  player: PlayerId,
  cell: number,
  symbol: CellSymbol,
  seed = "t",
  step = 0
): OrderVsChaosState {
  return engine.apply(state, new Map([[player, { cell, symbol }]]), rngFor(seed, step));
}

/** Builds a decode()-able JSON string for a hand-crafted board, matching engine.ts's own
 *  encode() shape exactly — so decode-focused tests exercise the real public boundary (the one
 *  a client would hit after a reconnect/replay) rather than reaching into engine internals. */
function encodeRaw(board: readonly Cell[], toMove: PlayerId, config = DEFAULT_CONFIG_ID): string {
  return JSON.stringify({ board, toMove, config });
}

describe("order-vs-chaos engine — basic shape", () => {
  it("exposes meta for a 2-player perfect-information game", () => {
    expect(orderVsChaos.meta.id).toBe("order-vs-chaos");
    expect(orderVsChaos.meta.minPlayers).toBe(2);
    expect(orderVsChaos.meta.maxPlayers).toBe(2);
    expect(orderVsChaos.meta.hiddenInformation).toBe(false);
    expect(orderVsChaos.meta.simultaneous).toBe(false);
    expect(orderVsChaos.meta.stochastic).toBe(false);
  });

  it("setup() starts with an empty 36-cell board, Order (seat 0) to move, no effects", () => {
    const state = orderVsChaos.setup(2, rngForSetup("s1"));
    expect(state.board).toHaveLength(TOTAL_CELLS);
    expect(state.board.every((c) => c === null)).toBe(true);
    expect(state.toMove).toBe(ORDER_SEAT);
    expect(state.lastEffects).toEqual([]);
  });

  it("legalMoves offers both symbols on every empty cell: length === 2 x empties (plan §5 item 1)", () => {
    let state = orderVsChaos.setup(2, rngForSetup("s2"));
    expect(orderVsChaos.legalMoves(state, ORDER_SEAT)).toHaveLength(2 * TOTAL_CELLS);
    state = apply(orderVsChaos, state, ORDER_SEAT, 0, "X", "s2");
    expect(orderVsChaos.legalMoves(state, CHAOS_SEAT)).toHaveLength(2 * (TOTAL_CELLS - 1));
  });

  it("both symbols are legal for both seats, always (the twist)", () => {
    const state = orderVsChaos.setup(2, rngForSetup("s3"));
    expect(orderVsChaos.isLegal(state, ORDER_SEAT, { cell: 10, symbol: "X" })).toBe(true);
    expect(orderVsChaos.isLegal(state, ORDER_SEAT, { cell: 10, symbol: "O" })).toBe(true);
  });

  it("a placement records a `placed` effect and flips toMove", () => {
    let state = orderVsChaos.setup(2, rngForSetup("s4"));
    state = apply(orderVsChaos, state, ORDER_SEAT, 7, "O", "s4");
    expect(state.board[7]).toBe("O");
    expect(state.toMove).toBe(CHAOS_SEAT);
    expect(state.lastEffects).toEqual([{ type: "placed", seat: ORDER_SEAT, cell: 7, symbol: "O" }]);
  });
});

describe("order-vs-chaos engine — status discipline (plan §5 item 2)", () => {
  it("status is ongoing on an empty board", () => {
    const state = orderVsChaos.setup(2, rngForSetup("st1"));
    expect(orderVsChaos.status(state)).toEqual({ kind: "ongoing" });
  });

  it("never emits draw — this engine has no draw terminal at all (plan §3)", () => {
    // engineContract's generic status-discipline property already checks `lost` never appears
    // for a 2-player engine; `draw` specifically is this game's own additional invariant.
    let state = orderVsChaos.setup(2, rngForSetup("st2"));
    for (let i = 0; i < TOTAL_CELLS && orderVsChaos.status(state).kind === "ongoing"; i++) {
      const legal = orderVsChaos.legalMoves(state, state.toMove);
      const move = legal[0]!;
      state = apply(orderVsChaos, state, state.toMove, move.cell, move.symbol, "st2", i);
      expect(orderVsChaos.status(state).kind).not.toBe("draw");
    }
  });
});

describe("order-vs-chaos engine — win detection (plan §5 items 3, 5)", () => {
  it("5 in a row wins for Order, EVEN when Chaos places the completing mark (pinned)", () => {
    let state = orderVsChaos.setup(2, rngForSetup("win1"));
    state = apply(orderVsChaos, state, ORDER_SEAT, 0, "X", "win1", 0);
    state = apply(orderVsChaos, state, CHAOS_SEAT, 20, "O", "win1", 1); // off-line filler
    state = apply(orderVsChaos, state, ORDER_SEAT, 1, "X", "win1", 2);
    state = apply(orderVsChaos, state, CHAOS_SEAT, 21, "O", "win1", 3); // off-line filler
    state = apply(orderVsChaos, state, ORDER_SEAT, 2, "X", "win1", 4);
    state = apply(orderVsChaos, state, CHAOS_SEAT, 22, "O", "win1", 5); // off-line filler
    state = apply(orderVsChaos, state, ORDER_SEAT, 3, "X", "win1", 6);
    expect(orderVsChaos.status(state)).toEqual({ kind: "ongoing" });
    expect(state.toMove).toBe(CHAOS_SEAT);

    // Chaos completes cell 4 with X — never a move a real Chaos bot would choose, but the
    // ENGINE must allow it (both symbols are always legal for both seats) and score it as an
    // Order win regardless of who placed it.
    state = apply(orderVsChaos, state, CHAOS_SEAT, 4, "X", "win1", 7);
    expect(orderVsChaos.status(state)).toEqual({ kind: "won", winner: ORDER_SEAT });
    expect(state.lastEffects).toContainEqual({ type: "line", cells: [0, 1, 2, 3, 4] });
  });

  it("a 6-run wins (contains a 5-window; plan §5 item 5)", () => {
    // Built directly via decode(), bypassing incremental play — a dedicated regression against
    // an implementation that only checks EXACTLY-5-length windows.
    const pins = new Map<number, CellSymbol>([
      [0, "X"],
      [1, "X"],
      [2, "X"],
      [3, "X"],
      [4, "X"],
      [5, "X"],
    ]);
    const board = buildFullNoRunBoardAllowingPinnedRun(pins);
    const filled = board.filter((c) => c !== null).length;
    const toMove = filled % 2 === 0 ? ORDER_SEAT : CHAOS_SEAT;
    const state = orderVsChaos.decode(encodeRaw(board, toMove));
    expect(orderVsChaos.status(state)).toEqual({ kind: "won", winner: ORDER_SEAT });
  });

  it("36th placement with no line anywhere: Chaos wins (plan §5 item 4)", () => {
    const fullBoard = buildFullNoRunBoard();
    const lastCell = TOTAL_CELLS - 1; // buildFullNoRunBoard fills in index order 0..35
    const lastSymbol = fullBoard[lastCell]!;
    const almostFull: Cell[] = fullBoard.slice();
    almostFull[lastCell] = null;

    const fillCountBefore = TOTAL_CELLS - 1; // 35, odd
    const toMoveBefore = fillCountBefore % 2 === 0 ? ORDER_SEAT : CHAOS_SEAT;
    let state = orderVsChaos.decode(encodeRaw(almostFull, toMoveBefore));
    expect(orderVsChaos.status(state)).toEqual({ kind: "ongoing" });
    expect(orderVsChaos.legalMoves(state, toMoveBefore)).toHaveLength(2); // one empty cell x 2 symbols

    state = apply(orderVsChaos, state, toMoveBefore, lastCell, lastSymbol, "full", 0);
    expect(state.board.every((c) => c !== null)).toBe(true);
    expect(orderVsChaos.status(state)).toEqual({ kind: "won", winner: CHAOS_SEAT });
  });

  it("36th placement that ALSO completes a line: Order wins — win-check precedes full-board check (plan §5 item 4)", () => {
    const pins = new Map<number, CellSymbol>([
      [0, "X"],
      [1, "X"],
      [2, "X"],
      [3, "X"],
    ]);
    const fullBoard = buildFullNoRunBoardAllowingPinnedRun(pins, /* leaveEmpty */ 4);
    expect(fullBoard[4]).toBeNull();
    const filledCells = fullBoard.filter((c) => c !== null).length;
    expect(filledCells).toBe(TOTAL_CELLS - 1); // 35

    const toMoveBefore = filledCells % 2 === 0 ? ORDER_SEAT : CHAOS_SEAT;
    let state = orderVsChaos.decode(encodeRaw(fullBoard, toMoveBefore));
    expect(orderVsChaos.status(state)).toEqual({ kind: "ongoing" });

    // The 36th placement completes the row-0 window AND fills the board simultaneously.
    state = apply(orderVsChaos, state, toMoveBefore, 4, "X", "precedence", 0);
    expect(state.board.every((c) => c !== null)).toBe(true);
    expect(orderVsChaos.status(state)).toEqual({ kind: "won", winner: ORDER_SEAT });
  });
});

describe("order-vs-chaos engine — encode/decode (plan §5 item 7, C4)", () => {
  it("encode = board + toMove + config id, excludes lastEffects", () => {
    let state = orderVsChaos.setup(2, rngForSetup("enc1"));
    state = apply(orderVsChaos, state, ORDER_SEAT, 5, "X", "enc1", 0);
    const parsed = JSON.parse(orderVsChaos.encode(state)) as Record<string, unknown>;
    expect(parsed).toHaveProperty("board");
    expect(parsed).toHaveProperty("toMove", CHAOS_SEAT);
    expect(parsed).toHaveProperty("config", DEFAULT_CONFIG_ID);
    expect(parsed).not.toHaveProperty("lastEffects");
  });

  it("two different move orders reaching the same final board encode identically (C3 property)", () => {
    // Order matters for effects/history in general, but NOT for this game's board content —
    // the board only records cell -> symbol, never who placed it or when. Two seat-alternating
    // sequences of the same 4 (cell, symbol) assignments, applied in a different sequence,
    // must land on byte-identical encode() output.
    const assignments: [number, CellSymbol][] = [
      [0, "X"],
      [5, "O"],
      [10, "X"],
      [15, "O"],
    ];
    const order1 = [0, 1, 2, 3];
    const order2 = [2, 3, 0, 1];

    function playInOrder(indices: number[]): OrderVsChaosState {
      let s = orderVsChaos.setup(2, rngForSetup("commute"));
      for (let step = 0; step < indices.length; step++) {
        const [cell, symbol] = assignments[indices[step]!]!;
        s = apply(orderVsChaos, s, s.toMove, cell, symbol, "commute-play", step);
      }
      return s;
    }

    const a = playInOrder(order1);
    const b = playInOrder(order2);
    expect(a.board).toEqual(b.board);
    expect(orderVsChaos.encode(a)).toBe(orderVsChaos.encode(b));
  });

  it("throws on wrong length", () => {
    expect(() =>
      orderVsChaos.decode(JSON.stringify({ board: [null, null], toMove: 0, config: DEFAULT_CONFIG_ID }))
    ).toThrow(/length/);
  });

  it("throws on invalid symbols", () => {
    const board = new Array(TOTAL_CELLS).fill(null);
    board[0] = "Z";
    expect(() => orderVsChaos.decode(JSON.stringify({ board, toMove: 0, config: DEFAULT_CONFIG_ID }))).toThrow(
      /null, "X", or "O"/
    );
  });

  it("throws on a config id from a different engine instance", () => {
    const board = new Array(TOTAL_CELLS).fill(null);
    expect(() => orderVsChaos.decode(JSON.stringify({ board, toMove: 0, config: "bogus-config" }))).toThrow(/config/);
  });

  it("throws on fill-count/toMove parity mismatch", () => {
    const board: Cell[] = new Array(TOTAL_CELLS).fill(null);
    board[0] = "X"; // 1 filled cell -> toMove must be CHAOS_SEAT (1), not ORDER_SEAT (0)
    expect(() => orderVsChaos.decode(encodeRaw(board, ORDER_SEAT))).toThrow(/parity/);
  });

  it("throws on a structurally impossible dual-winner board", () => {
    // Row 0 all X (a completed run) AND row 1 all O (a second completed run) can never both
    // arise from real play: the first run to appear ends the game immediately, and a single
    // placement can only complete a run of the symbol it just placed.
    const pins = new Map<number, CellSymbol>();
    for (let c = 0; c < WIN_LENGTH; c++) pins.set(c, "X"); // row 0, cells 0-4
    for (let c = 0; c < WIN_LENGTH; c++) pins.set(6 + c, "O"); // row 1, cells 6-10
    const board = buildFullNoRunBoardAllowingPinnedRun(pins);
    const filled = board.filter((c) => c !== null).length;
    const toMove = filled % 2 === 0 ? ORDER_SEAT : CHAOS_SEAT;
    expect(() => orderVsChaos.decode(encodeRaw(board, toMove))).toThrow(/BOTH symbols/);
  });

  it("decode SUCCEEDS for a board that already has a completed line — status correctly reports won(Order), never ongoing", () => {
    const pins = new Map<number, CellSymbol>();
    for (let c = 0; c < WIN_LENGTH; c++) pins.set(c, "X");
    const board = buildFullNoRunBoardAllowingPinnedRun(pins);
    const filled = board.filter((c) => c !== null).length;
    const toMove = filled % 2 === 0 ? ORDER_SEAT : CHAOS_SEAT;
    const state = orderVsChaos.decode(encodeRaw(board, toMove));
    expect(orderVsChaos.status(state)).toEqual({ kind: "won", winner: ORDER_SEAT });
  });

  it("decode SUCCEEDS for a full board with no line — status correctly reports won(Chaos), never ongoing", () => {
    const board = buildFullNoRunBoard();
    const state = orderVsChaos.decode(encodeRaw(board, ORDER_SEAT));
    expect(orderVsChaos.status(state)).toEqual({ kind: "won", winner: CHAOS_SEAT });
  });

  it("encode(decode(encode(s))) === encode(s) for a hand-built board (canonical form round-trip)", () => {
    // NOT `encode(decode(raw)) === raw`: `raw` here is a hand-written JSON string with
    // key-insertion order board/toMove/config, while encode()'s stableStringify backbone always
    // emits keys alphabetically (board/config/toMove) — that key-order canonicalization is the
    // whole POINT of stableStringify (two logically-equal objects built with different key
    // orders must hash identically), so asserting against the non-canonical hand-written string
    // would be asserting the wrong invariant. Round-trip through encode() first to get a
    // canonical string, matching the generic contract property's own shape (checks.ts's
    // checkEncodeDecodeAndEffects).
    const board = buildFullNoRunBoard();
    const canonical = orderVsChaos.encode(orderVsChaos.decode(encodeRaw(board, ORDER_SEAT)));
    const roundTripped = orderVsChaos.encode(orderVsChaos.decode(canonical));
    expect(roundTripped).toBe(canonical);
  });
});

describe("order-vs-chaos engine — factory guards (config ladder reserved, plan §3)", () => {
  it("throws for any boardSize/winLength other than the implemented 6x6/win-5", () => {
    expect(() => createOrderVsChaosEngine({ boardSize: 7 })).toThrow(/reserved/);
    expect(() => createOrderVsChaosEngine({ winLength: 4 })).toThrow(/reserved/);
  });

  it("accepts firstMover=1 (config B: Chaos moves first) as a distinct, separately-keyed engine", () => {
    const chaosFirst = createOrderVsChaosEngine({ firstMover: CHAOS_SEAT });
    const state = chaosFirst.setup(2, rngForSetup("cf1"));
    expect(state.toMove).toBe(CHAOS_SEAT);
    // Order is STILL seat 0 (module doc's invariant) — only who acts FIRST changed.
    expect(ORDER_SEAT).toBe(0);
  });

  it("a config-B encoding is rejected by the default (config-A) engine instance", () => {
    const chaosFirst = createOrderVsChaosEngine({ firstMover: CHAOS_SEAT });
    const state = chaosFirst.setup(2, rngForSetup("cf2"));
    const encoded = chaosFirst.encode(state);
    expect(() => orderVsChaos.decode(encoded)).toThrow(/config/);
  });
});

describe("order-vs-chaos engine — structural termination (plan §5 item 9)", () => {
  it("terminates within 36 plies across a sweep of random playouts, zero cap hits", () => {
    for (let i = 0; i < 50; i++) {
      let state = orderVsChaos.setup(2, rngForSetup(`term-${i}`));
      let ply = 0;
      for (; ply < 40 && orderVsChaos.status(state).kind === "ongoing"; ply++) {
        const legal = orderVsChaos.legalMoves(state, state.toMove);
        const move = legal[rngFor(`term-${i}`, ply).int(legal.length)]!;
        state = apply(orderVsChaos, state, state.toMove, move.cell, move.symbol, `term-${i}`, ply);
      }
      expect(orderVsChaos.status(state).kind).not.toBe("ongoing");
      expect(ply).toBeLessThanOrEqual(TOTAL_CELLS);
    }
  });
});

describe("order-vs-chaos engine — perfect information", () => {
  it("playerView is the identity for both seats and the spectator", () => {
    let state = orderVsChaos.setup(2, rngForSetup("pv1"));
    state = apply(orderVsChaos, state, ORDER_SEAT, 3, "O", "pv1", 0);
    expect(orderVsChaos.playerView(state, ORDER_SEAT)).toEqual(state);
    expect(orderVsChaos.playerView(state, CHAOS_SEAT)).toEqual(state);
    expect(orderVsChaos.playerView(state, null)).toEqual(state);
  });
});

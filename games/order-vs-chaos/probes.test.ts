// games/order-vs-chaos/probes.test.ts — mechanical correctness for both probes (plan §5 item
// 10). What this file does NOT do: measure pairingMove's win rate against Strong — that is
// OV2/OV4's job (the standing instruction is that OV1 does not run the gate table). What it DOES
// do: prove the probes are legal, deterministic, and total (never throw), and pin down exactly
// what the naive pairing strategy protects and what it doesn't, so the eventual OV2 measurement
// has a mechanically-verified strategy under it rather than an unverified prose description.

import { describe, expect, it } from "vitest";
import { rngFor, rngForSetup, type PlayerId } from "@twist-arcade/engine";
import { CHAOS_SEAT, ORDER_SEAT, orderVsChaos, type OrderVsChaosMove, type OrderVsChaosState } from "./engine";
import { BOARD_SIZE, TOTAL_CELLS, WINDOWS } from "./engine-internal";
import { dominoPartner, mirrorMove, pairingMove } from "./probes";

function apply(
  state: OrderVsChaosState,
  player: PlayerId,
  move: OrderVsChaosMove,
  seed: string,
  step: number
): OrderVsChaosState {
  return orderVsChaos.apply(state, new Map([[player, move]]), rngFor(seed, step));
}

describe("mirrorMove", () => {
  it("returns null when there is no opponent move yet", () => {
    const state = orderVsChaos.setup(2, rngForSetup("m1"));
    expect(mirrorMove(state, null, orderVsChaos.legalMoves(state, CHAOS_SEAT))).toBeNull();
  });

  it("point-reflects cell -> 35 - cell, same symbol, when the reflection is legal", () => {
    let state = orderVsChaos.setup(2, rngForSetup("m2"));
    state = apply(state, ORDER_SEAT, { cell: 0, symbol: "X" }, "m2", 0);
    const legal = orderVsChaos.legalMoves(state, CHAOS_SEAT);
    const move = mirrorMove(state, { cell: 0, symbol: "X" }, legal);
    expect(move).toEqual({ cell: 35, symbol: "X" });
  });

  it("6x6 has no reflection-fixed cell: every cell's mirror target is a DIFFERENT cell (plan §5 item 10)", () => {
    for (let cell = 0; cell < TOTAL_CELLS; cell++) {
      expect(TOTAL_CELLS - 1 - cell).not.toBe(cell);
    }
  });

  it("returns null (falls back to random) when the reflected cell is no longer legal", () => {
    let state = orderVsChaos.setup(2, rngForSetup("m3"));
    // Fill cell 35 first so it's unavailable when we later try to mirror a move onto it.
    state = apply(state, ORDER_SEAT, { cell: 35, symbol: "O" }, "m3", 0);
    state = apply(state, CHAOS_SEAT, { cell: 0, symbol: "X" }, "m3", 1);
    const legal = orderVsChaos.legalMoves(state, ORDER_SEAT);
    expect(mirrorMove(state, { cell: 0, symbol: "X" }, legal)).toBeNull();
  });

  it("never throws across a random playout, always returns either null or a currently-legal move", () => {
    let state = orderVsChaos.setup(2, rngForSetup("m4"));
    let lastMove: OrderVsChaosMove | null = null;
    for (let ply = 0; ply < 36 && orderVsChaos.status(state).kind === "ongoing"; ply++) {
      const legal = orderVsChaos.legalMoves(state, state.toMove);
      const mirrored = mirrorMove(state, lastMove, legal);
      if (mirrored !== null) {
        expect(legal).toContainEqual(mirrored);
      }
      const move = legal[rngFor("m4", ply).int(legal.length)]!;
      state = apply(state, state.toMove, move, "m4", ply);
      lastMove = move;
    }
  });
});

describe("pairingMove — domino pairing geometry", () => {
  it("dominoPartner is its own inverse and stays within the same row", () => {
    for (let cell = 0; cell < TOTAL_CELLS; cell++) {
      const partner = dominoPartner(cell);
      expect(dominoPartner(partner)).toBe(cell);
      expect(Math.floor(partner / BOARD_SIZE)).toBe(Math.floor(cell / BOARD_SIZE));
      expect(partner).not.toBe(cell);
    }
  });

  it("every ROW window fully contains at least one complete domino pair (pigeonhole: 5 of 6 cells excludes at most one of 3 pairs)", () => {
    const rowWindows = WINDOWS.filter((w) => new Set(w.map((c) => Math.floor(c / BOARD_SIZE))).size === 1);
    expect(rowWindows).toHaveLength(12); // pencil-check cross-reference: 6 rows x 2 windows each
    for (const window of rowWindows) {
      const cells = new Set(window);
      const hasCompletePair = window.some((c) => cells.has(dominoPartner(c)));
      expect(hasCompletePair).toBe(true);
    }
  });

  it("NO column or diagonal window contains a complete domino pair — the known coverage gap", () => {
    const rowWindows = new Set(WINDOWS.filter((w) => new Set(w.map((c) => Math.floor(c / BOARD_SIZE))).size === 1));
    const nonRowWindows = WINDOWS.filter((w) => !rowWindows.has(w));
    expect(nonRowWindows).toHaveLength(20); // 32 total - 12 row windows (12 col + 8 diag)
    for (const window of nonRowWindows) {
      const cells = new Set(window);
      const hasCompletePair = window.some((c) => cells.has(dominoPartner(c)));
      expect(hasCompletePair).toBe(false);
    }
  });
});

describe("pairingMove — response behavior", () => {
  it("returns null when there is no opponent move yet", () => {
    const state = orderVsChaos.setup(2, rngForSetup("p1"));
    expect(pairingMove(state, null, orderVsChaos.legalMoves(state, CHAOS_SEAT))).toBeNull();
  });

  it("answers with the domino partner carrying the OPPOSITE symbol", () => {
    let state = orderVsChaos.setup(2, rngForSetup("p2"));
    state = apply(state, ORDER_SEAT, { cell: 2, symbol: "X" }, "p2", 0);
    const legal = orderVsChaos.legalMoves(state, CHAOS_SEAT);
    const move = pairingMove(state, { cell: 2, symbol: "X" }, legal);
    expect(move).toEqual({ cell: 3, symbol: "O" });
  });

  it("returns null when the domino partner is no longer legal", () => {
    let state = orderVsChaos.setup(2, rngForSetup("p3"));
    state = apply(state, ORDER_SEAT, { cell: 3, symbol: "O" }, "p3", 0); // pre-fill the partner
    state = apply(state, CHAOS_SEAT, { cell: 10, symbol: "X" }, "p3", 1);
    const legal = orderVsChaos.legalMoves(state, ORDER_SEAT);
    expect(pairingMove(state, { cell: 2, symbol: "X" }, legal)).toBeNull();
  });

  it("playing the pairing response prevents that ROW window from EVER completing (both cells always differ)", () => {
    // Row 0's windows are [0-4] and [1-5]. Order tries to build a run starting at cell 0;
    // pairingMove's response to cell 0 (partner 1) plants an O at cell 1, which sits inside
    // BOTH row-0 windows — poisoning both at once, exactly the pigeonhole property asserted
    // above, demonstrated end to end through apply().
    let state = orderVsChaos.setup(2, rngForSetup("p4"));
    state = apply(state, ORDER_SEAT, { cell: 0, symbol: "X" }, "p4", 0);
    const legal = orderVsChaos.legalMoves(state, CHAOS_SEAT);
    const response = pairingMove(state, { cell: 0, symbol: "X" }, legal)!;
    expect(response).toEqual({ cell: 1, symbol: "O" });
    state = apply(state, CHAOS_SEAT, response, "p4", 1);
    expect(state.board[0]).toBe("X");
    expect(state.board[1]).toBe("O");
    // Neither row-0 window can ever be monochromatic now, regardless of what fills cells 2-5.
    expect(orderVsChaos.status(state)).toEqual({ kind: "ongoing" });
  });

  it("does NOT stop a column run — the documented coverage gap, demonstrated end to end", () => {
    // Order builds straight down column 0 (cells 0, 6, 12, 18, 24); pairingMove's response to
    // each is that cell's ROW partner (column 1), which never touches column 0 at all.
    let state = orderVsChaos.setup(2, rngForSetup("p5"));
    const columnCells = [0, 6, 12, 18, 24];
    let step = 0;
    for (const cell of columnCells) {
      state = apply(state, state.toMove, { cell, symbol: "X" }, "p5", step++);
      if (orderVsChaos.status(state).kind !== "ongoing") break;
      const legal = orderVsChaos.legalMoves(state, state.toMove);
      const response = pairingMove(state, { cell, symbol: "X" }, legal);
      if (response) state = apply(state, state.toMove, response, "p5", step++);
    }
    expect(orderVsChaos.status(state)).toEqual({ kind: "won", winner: ORDER_SEAT });
  });

  it("never throws across a random playout, always returns either null or a currently-legal move", () => {
    let state = orderVsChaos.setup(2, rngForSetup("p6"));
    let lastMove: OrderVsChaosMove | null = null;
    for (let ply = 0; ply < 36 && orderVsChaos.status(state).kind === "ongoing"; ply++) {
      const legal = orderVsChaos.legalMoves(state, state.toMove);
      const paired = pairingMove(state, lastMove, legal);
      if (paired !== null) {
        expect(legal).toContainEqual(paired);
      }
      const move = legal[rngFor("p6", ply).int(legal.length)]!;
      state = apply(state, state.toMove, move, "p6", ply);
      lastMove = move;
    }
  });
});

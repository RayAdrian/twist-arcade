// games/order-vs-chaos/test/board-fixtures.ts — shared, vitest-FREE board-construction helpers
// for engine.test.ts and probes.test.ts (both need a hand-built, verified-no-run 6x6 board to
// exercise the "36th placement" precedence cases and the pairing-bot probe without depending on
// a lucky random playout). Pulled out of engine.test.ts rather than left inline so probes.test.ts
// doesn't import a `.test.ts` module (vitest test files are not meant to be import targets).

import { TOTAL_CELLS, WINDOWS, type Cell, type CellSymbol } from "../engine-internal";

/**
 * Backtracking search for a FULL (36-cell) board with zero winning window anywhere. Assigns
 * cells 0..35 in order; a candidate symbol is rejected the instant it completes any window
 * whose highest-indexed cell is the one just placed. `pins` lets a caller force specific cells
 * to specific symbols while the search fills in everything else around them.
 *
 * A solution is guaranteed to exist — OV0/R1 (scripts/research/order-vs-chaos-line-probability.ts)
 * measured ~17.6% of uniformly random filled boards have zero winning window (1 - 0.8243), so
 * the search space is far from empty; backtracking over 36 binary cells finds one in well under
 * a millisecond.
 */
export function buildFullNoRunBoard(pins: ReadonlyMap<number, CellSymbol> = new Map()): CellSymbol[] {
  const board: Cell[] = new Array(TOTAL_CELLS).fill(null);

  function completesRunAt(index: number): boolean {
    for (const window of WINDOWS) {
      if (Math.max(...window) !== index) continue;
      const first = board[window[0]!];
      if (first === null) continue;
      if (window.every((c) => board[c] === first)) return true;
    }
    return false;
  }

  function place(index: number): boolean {
    if (index === TOTAL_CELLS) return true;
    const pinned = pins.get(index);
    const candidates: CellSymbol[] = pinned ? [pinned] : ["X", "O"];
    for (const symbol of candidates) {
      board[index] = symbol;
      if (!completesRunAt(index) && place(index + 1)) return true;
      board[index] = null;
    }
    return false;
  }

  if (!place(0)) {
    throw new Error("buildFullNoRunBoard: no solution found — should not happen on 6x6/win-5");
  }
  return board as CellSymbol[];
}

/**
 * Like `buildFullNoRunBoard`, but `pins` is allowed to carry a genuine completed run — windows
 * fully contained within `pins` are treated as an INTENTIONAL run and never trigger
 * backtracking; every other window must still stay run-free. `leaveEmpty`, when given, is left
 * as `null` in the returned board (used to build "35 filled, 1 cell from completing pins' line"
 * fixtures without the search itself ever needing to decide what goes there).
 */
export function buildFullNoRunBoardAllowingPinnedRun(
  pins: ReadonlyMap<number, CellSymbol>,
  leaveEmpty?: number
): Cell[] {
  const board: Cell[] = new Array(TOTAL_CELLS).fill(null);

  function completesUnpinnedRunAt(index: number): boolean {
    for (const window of WINDOWS) {
      if (Math.max(...window) !== index) continue;
      if (window.every((c) => pins.has(c))) continue; // expected to be monochromatic — that's the point
      const first = board[window[0]!];
      if (first === null) continue;
      if (window.every((c) => board[c] === first)) return true;
    }
    return false;
  }

  function place(index: number): boolean {
    if (index === TOTAL_CELLS) return true;
    if (index === leaveEmpty) return place(index + 1);
    const pinned = pins.get(index);
    const candidates: CellSymbol[] = pinned ? [pinned] : ["X", "O"];
    for (const symbol of candidates) {
      board[index] = symbol;
      if (!completesUnpinnedRunAt(index) && place(index + 1)) return true;
      board[index] = null;
    }
    return false;
  }

  if (!place(0)) {
    throw new Error("buildFullNoRunBoardAllowingPinnedRun: no solution found");
  }
  if (leaveEmpty !== undefined) board[leaveEmpty] = null;
  return board;
}

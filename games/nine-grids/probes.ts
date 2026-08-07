// games/nine-grids/probes.ts — the per-game mirror-bot probe (plan §6): "point symmetry is
// board geometry the interface deliberately doesn't expose", so every game that IS
// point-symmetric (tagged "symmetric" in manifest.ts) exports its own `mirrorMove`.
//
// Nine Grids IS point-symmetric: the board is 9 macro boards of 9 cells, each a plain 3x3
// grid, laid out identically. A 180-degree rotation of the WHOLE 81-cell structure (rotate the
// 3x3 macro grid AND rotate within each of its 3x3 boards, simultaneously) maps global index
// g = board*9 + cell to exactly 80 - g:
//   - within a 3x3 grid, 180-degree rotation maps local index i -> 8 - i (row r -> 2-r, col c
//     -> 2-c, and i = 3r+c => (2-r)*3+(2-c) = 8-i).
//   - applying that to BOTH scales at once: board' = 8 - board, cell' = 8 - cell, so
//     g' = board'*9 + cell' = (8-board)*9 + (8-cell) = 72 - 9*board + 8 - cell = 80 - g.
// The empty board is fixed under this rotation, so mirroring the opponent's last move (playing
// its point-reflection) is always well-defined as a strategy shape, though it is not
// necessarily always LEGAL — the target board may already be closed, or the reflected cell may
// already be occupied by an earlier mirrored move (mirroring is not a drawing/non-losing
// strategy the way it can be in some symmetric games; it is just the probe's job to reflect
// when possible and fall back sanely otherwise, per the CHECKLIST's "never throws, never
// returns an illegal move" contract).

import type { NineGridsMove, NineGridsState } from "./engine";

const TOTAL_CELLS = 81;

export function mirrorMove(
  _state: NineGridsState,
  lastOppMove: NineGridsMove | null,
  legalMoves: readonly NineGridsMove[]
): NineGridsMove {
  if (lastOppMove) {
    const g = lastOppMove.board * 9 + lastOppMove.cell;
    const mirroredG = TOTAL_CELLS - 1 - g;
    const board = Math.floor(mirroredG / 9);
    const cell = mirroredG % 9;
    const mirrored = legalMoves.find((m) => m.board === board && m.cell === cell);
    if (mirrored) return mirrored;
  }
  // Fallback (opening move with no prior opponent move, or the mirrored target isn't legal
  // right now): play the first legal move. Never throws, never returns an illegal move.
  const move = legalMoves[0];
  if (!move) {
    throw new Error("nine-grids: mirrorMove() called with no legal moves — the harness should never do this");
  }
  return move;
}

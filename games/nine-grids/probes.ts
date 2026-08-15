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
// necessarily always LEGAL — the target board may already be closed, the mover may be confined
// (by the must-follow send rule) to a DIFFERENT board than the reflection lands in, or the
// reflected cell may already be occupied by an earlier mirrored move.
//
// CORRECTED (platform-corrections.md C81 / task #26): this function used to fall back
// INTERNALLY to `legalMoves[0]` whenever the reflection wasn't legal, rather than returning
// `null` the way Fadeout's and Tilt's own `mirrorMove` do (games/fadeout/probes.ts,
// games/tilt/probes.ts) — "the platform's pinned three-argument mirror convention"
// (packages/harness/src/roster.ts's own `MirrorAgentSpec.mirrorMove` doc): `M | null`, with
// `runner.ts`'s `playOneGame` substituting a random legal move when it sees `null`. Because
// this game's own fallback ran INSIDE this function, the harness never observed it happening at
// all — a mirror-probe row here was measured fallback rate 221/258 (85.7%) through the real
// matchup shape, i.e. roughly 14% mirror content and 86% deterministic first-legal play, with
// nothing in the report able to say so. Returning `null` here instead hands that fallback back
// to the harness, where `runProbeSuite`'s `MatchupReport.mirrorFallback` (runner.ts) can finally
// count it.

import type { NineGridsMove, NineGridsState } from "./engine";

const TOTAL_CELLS = 81;

export function mirrorMove(
  _state: NineGridsState,
  lastOppMove: NineGridsMove | null,
  legalMoves: readonly NineGridsMove[]
): NineGridsMove | null {
  if (lastOppMove === null) return null;
  const g = lastOppMove.board * 9 + lastOppMove.cell;
  const mirroredG = TOTAL_CELLS - 1 - g;
  const board = Math.floor(mirroredG / 9);
  const cell = mirroredG % 9;
  const mirrored = legalMoves.find((m) => m.board === board && m.cell === cell);
  return mirrored ?? null;
}

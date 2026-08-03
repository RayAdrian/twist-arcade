// games/__GAME_ID__/probes.ts — the per-game mirror-bot probe (plan §6): "point symmetry is
// board geometry the interface deliberately doesn't expose", so every game that IS
// point-symmetric (tag your manifest "symmetric" once this is real) exports its own
// `mirrorMove`. The harness only WARNS when this is absent; CI HARD-REQUIRES it for games
// tagged "symmetric" — delete this file (and the "symmetric" tag) if your game genuinely has
// no reflective symmetry.
//
// TODO(you): implement the real point-reflection once your board has real geometry. This
// placeholder just plays whatever the FIRST legal move happens to be — legal (never throws,
// never returns an illegal move), but not an actual mirror strategy.

import type { __PASCAL_ID__Move, __PASCAL_ID__State } from "./engine";

export function mirrorMove(
  _state: __PASCAL_ID__State,
  _lastOppMove: __PASCAL_ID__Move | null,
  legalMoves: readonly __PASCAL_ID__Move[]
): __PASCAL_ID__Move {
  const move = legalMoves[0];
  if (!move) {
    throw new Error("__GAME_ID__: mirrorMove() called with no legal moves — the harness should never do this");
  }
  return move;
}

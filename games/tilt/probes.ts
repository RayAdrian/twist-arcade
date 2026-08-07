// games/tilt/probes.ts — the per-game degeneracy probe (docs/plans/tilt.md §5.4).
//
// mirrorMove — the board has left-right reflection symmetry (column c -> size-1-c), but a
// FIXED-CW tilt is NOT reflection-invariant: reflecting the board conjugates a clockwise
// rotation into a counter-clockwise one, so a mirroring player's rotated board is the MIRROR
// IMAGE of what a truly-mirrored game would produce, not the same position. Mirroring is
// therefore not value-preserving here — plan §5.4 says to run the probe anyway ("it is cheap
// and C16 says load-bearing probes are never assumed passed"), expecting it to fail (mirror as
// P2 should lose most games, not draw at ~50%), which is itself informative: a probe that
// "should" fail and does confirms the harness is actually exercising the asymmetry rather than
// silently no-op'ing.

import { SIZE } from "./engine";
import type { TiltMove, TiltState } from "./engine";

/** Reflects the opponent's last move's column through the board's vertical center axis:
 *  column -> (SIZE - 1) - column. Returns null when there is no opponent move yet to mirror, or
 *  the reflected column is no longer legal (full) — the harness's mirror-bot policy falls back
 *  to a random legal move in either case (the platform's documented "null -> fallback random"
 *  convention; same as Order vs Chaos's mirrorMove). */
export function mirrorMove(
  _state: TiltState,
  lastOppMove: TiltMove | null,
  legalMoves: readonly TiltMove[]
): TiltMove | null {
  if (lastOppMove === null) return null;
  const reflected = SIZE - 1 - lastOppMove.column;
  const candidate = legalMoves.find((m) => m.column === reflected);
  return candidate ?? null;
}

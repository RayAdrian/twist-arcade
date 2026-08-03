// games/fadeout/probes.ts — the per-game degeneracy probes the harness composes with the
// generic ones in @twist-arcade/bots (plan §7). F1 only builds mirrorMove: it is pure board
// geometry and needs neither bots nor the harness (both M2/M3 dependencies not yet available
// to this team). Stall/rush/opening-concentration probes are generic and live in
// packages/bots per phase-0-platform-spine.md's file layout — not duplicated here.

import type { FadeoutMove, FadeoutState } from "./engine";

const TOTAL_CELLS = 9; // this engine implements only the 3x3/cap-3 chassis (see engine.ts)

/**
 * mirrorMove(state, lastOppMove, legalMoves) — the mandatory mirror-bot probe for a
 * centrally-symmetric game (plan §7: "Fadeout is tagged `symmetric`, so CI requires the
 * per-game export games/fadeout/probes.ts -> mirrorMove"). Point-reflects the opponent's last
 * move through the board's centre (cell -> 8 - cell on this 3x3 board); returns null when the
 * reflected cell isn't in the mover's CURRENT legal set or there is no opponent move yet to
 * mirror — the harness's mirror-bot policy falls back to a random legal move in either case
 * (plan §7's "null -> fallback random").
 *
 * DEVIATION FROM THE PLAN'S LITERAL 2-ARG SIGNATURE, DOCUMENTED HERE (see the handoff report):
 * whether an OCCUPIED cell is a legal target depends on the ruleset config (decayTiming,
 * playThrough) that isn't frozen until F2, and whether an EMPTY cell is legal can additionally
 * depend on superko history — legality is not a pure function of `state` alone without also
 * knowing the config, and this game is parameterized over 8 configs precisely because F1 must
 * not bake in a choice the solve hasn't made yet. Rather than have this probe silently
 * over-approximate (returning a move that's actually illegal — a real bug the harness would
 * hit downstream) or reconstruct an arbitrary engine instance internally (silently picking a
 * config nobody chose), mirrorMove takes the mover's ALREADY-COMPUTED legal moves as a third
 * argument: the harness always has this on hand immediately before invoking any policy (it is
 * literally engine.legalMoves(state, state.toMove)), so threading it through costs the caller
 * nothing and keeps this function's legality check exact instead of approximate.
 */
export function mirrorMove(
  state: FadeoutState,
  lastOppMove: FadeoutMove | null,
  legalMoves: readonly FadeoutMove[]
): FadeoutMove | null {
  if (lastOppMove === null) return null;

  const reflected = TOTAL_CELLS - 1 - lastOppMove.cell;
  if (!Number.isInteger(reflected) || reflected < 0 || reflected >= TOTAL_CELLS) return null;

  const isCurrentlyLegal = legalMoves.some((m) => m.cell === reflected);
  return isCurrentlyLegal ? { cell: reflected } : null;
}

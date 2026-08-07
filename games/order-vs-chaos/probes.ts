// games/order-vs-chaos/probes.ts — the per-game degeneracy probes (plan §5 item 10, §6 R2/R5).
// Two probes, both game-local because point symmetry and the pairing strategy are board
// geometry the platform interface deliberately doesn't expose (same reasoning as every other
// game's mirrorMove).
//
// mirrorMove — mandatory for a point-symmetric board (manifest.ts tags "symmetric"; CI hard-
// requires this export for that tag). 6x6 has NO reflection-fixed cell (unlike Fadeout's 3x3,
// where cell 4 is its own point-reflection), so mirroring is available on EVERY move, not just
// most of them — the plan calls this out as making the probe load-bearing rather than a
// formality (§5 item 10).
//
// pairingMove — the game-local "cheapest disconfirming experiment" for Chaos (plan §5 item 10,
// §6 risk table): a FIXED domino pairing of the 36 cells. Whenever the opponent (Order) plays
// a cell, Chaos immediately answers in that cell's paired partner with the OPPOSITE symbol —
// "the window-poisoning symbol" — so any winning window spanning both cells of a completed
// domino can never be monochromatic (one cell is always X and the other always O).
//
// THIS PARTICULAR PAIRING IS DELIBERATELY NAIVE, matching the plan's own framing ("a naive
// pairing strategy" / "a googleable one-sentence defense"): horizontal dominoes, (0,1) (2,3)
// (4,5) repeated per row. By pigeonhole, every ROW window (5 of 6 cells) fully contains at
// least one of a row's 3 pairs, so this pairing poisons every row window. It poisons NOTHING
// on columns or diagonals — a horizontal domino never shares a column or diagonal window with
// its partner. Whether that partial coverage is enough to hold Order below the plan's <40%
// gate (or well above it) is exactly the empirical question OV2/OV4 measures; building a
// "smarter" pairing here would defeat the point of testing the naive, easily-described one
// first (C31's sequencing rule: run the cheap discriminating experiment before the expensive
// one).
//
// Both probes share the mirror convention's 3-argument shape (state, lastOppMove, legalMoves)
// -> move | null, so both wire into packages/harness/src/roster.ts's mirrorAgent() unchanged
// (that helper only cares about the function shape, not the "mirror" name — see roster.ts's
// module doc). Wiring either probe into an actual gate run is OV2's job, not OV1's (standing
// instruction: OV1 does not run the gate table); this file only builds and unit-tests the
// mechanism.

import { BOARD_SIZE, TOTAL_CELLS, type CellSymbol } from "./engine-internal";
import type { OrderVsChaosMove, OrderVsChaosState } from "./engine";

/**
 * Point-reflects the opponent's last move through the board's centre: cell -> 35 - cell.
 * Returns null when there is no opponent move yet to mirror, or the reflected cell/symbol
 * isn't currently legal (the mirror target may already be occupied, including by an earlier
 * mirrored move) — the harness's mirror-bot policy falls back to a random legal move in either
 * case (the documented "null -> fallback random" convention; platform-corrections.md C15 notes
 * this fallback is not yet implemented in roster.ts/runner.ts as of that correction, so this is
 * inherited, not new).
 */
export function mirrorMove(
  _state: OrderVsChaosState,
  lastOppMove: OrderVsChaosMove | null,
  legalMoves: readonly OrderVsChaosMove[]
): OrderVsChaosMove | null {
  if (lastOppMove === null) return null;
  const reflected = TOTAL_CELLS - 1 - lastOppMove.cell;
  const candidate = legalMoves.find((m) => m.cell === reflected && m.symbol === lastOppMove.symbol);
  return candidate ?? null;
}

/** cell -> its fixed horizontal-domino partner: pairs (0,1) (2,3) (4,5) within every row. */
export function dominoPartner(cell: number): number {
  const row = Math.floor(cell / BOARD_SIZE);
  const col = cell % BOARD_SIZE;
  const partnerCol = col % 2 === 0 ? col + 1 : col - 1;
  return row * BOARD_SIZE + partnerCol;
}

function poisonSymbol(justPlaced: CellSymbol): CellSymbol {
  return justPlaced === "X" ? "O" : "X";
}

/**
 * The naive domino-pairing probe, as Chaos (see this file's header for the strategy and its
 * known coverage gap). Returns null — falls back to random, same convention as mirrorMove —
 * when there is no opponent move yet to answer, or the domino partner cell is no longer legal
 * (already filled, by either side).
 */
export function pairingMove(
  _state: OrderVsChaosState,
  lastOppMove: OrderVsChaosMove | null,
  legalMoves: readonly OrderVsChaosMove[]
): OrderVsChaosMove | null {
  if (lastOppMove === null) return null;
  const partner = dominoPartner(lastOppMove.cell);
  const symbol = poisonSymbol(lastOppMove.symbol);
  const candidate = legalMoves.find((m) => m.cell === partner && m.symbol === symbol);
  return candidate ?? null;
}

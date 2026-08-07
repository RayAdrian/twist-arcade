// games/tilt/heuristic.ts — optional per-game eval (docs/plans/tilt.md §3: "classic open-line
// counting with a tilt discount"). MCTS tiers (and the T2 kill-test sweep's random/mcts100/
// mcts1k roster) need nothing here — this feeds greedy/rush probes and any future minimax tier
// only. "Positive = good for `player`"; only SIGN and ORDERING are contractual (engine
// contract's own doc), so no attempt is made to keep this on any particular scale.
//
// THE DISCOUNT MECHANISM (plan §3): "a threat whose supporting geometry does not survive the
// imminent rotation (checkable by applying the rotation map to the threat cells) is discounted
// when the tilt is <=2 plies away." Implemented literally: when a tilt is imminent, every open
// window's cells are run through the SAME rotate+compact transform `apply()` itself uses (a
// pure projection — this never mutates real state or fires a real tilt), and a window whose
// cells no longer coincide with any winning window afterward is discounted rather than valued
// at face value, since the alignment it represents is about to be destroyed by gravity
// regardless of either player's next move.

import {
  compactColumns,
  discCount,
  rotate,
  rotateCell,
  windowsFor,
  type Geometry,
  type Grid,
  type PlayerSeat,
} from "./engine-internal";
import type { TiltState } from "./engine";

export interface HeuristicConfig extends Geometry {
  readonly tiltPeriod: number;
  readonly tiltDirection: "cw" | "alternating";
}

/** How many plies from now (counting the one about to be played) the next tilt fires. Always
 *  in [1, tiltPeriod] — tiltPeriod itself means "a tilt just fired; a full cycle remains" (or
 *  the game has not started). Mirrors engine.ts's own tilt-scheduling arithmetic. */
function pliesUntilNextTilt(grid: Grid, tiltPeriod: number): number {
  const remainder = discCount(grid) % tiltPeriod;
  return tiltPeriod - remainder;
}

/** Direction of the NEXT (not-yet-fired) tilt, purely from disc count — see engine.ts's own
 *  `nextTiltDirection` for the identical reasoning applied at apply()-time; duplicated here
 *  (rather than imported) because this is a small, self-contained arithmetic helper and
 *  heuristic.ts must not depend on engine.ts's internal (unexported) resolveConfig machinery. */
function nextTiltDirection(grid: Grid, cfg: HeuristicConfig): "cw" | "ccw" {
  if (cfg.tiltDirection === "cw") return "cw";
  const nextTiltDiscCount = discCount(grid) + pliesUntilNextTilt(grid, cfg.tiltPeriod);
  const tiltIndex = Math.floor(nextTiltDiscCount / cfg.tiltPeriod) - 1;
  return tiltIndex % 2 === 0 ? "cw" : "ccw";
}

/** True iff `windowCells` (a real winning window's cell set, in the CURRENT frame) still lands
 *  on some winning window's cell set after a hypothetical tilt fires right now. Pure projection
 *  — builds the same rotate()+compactColumns() an actual tilt would, but never touches real
 *  engine state. */
function survivesTilt(grid: Grid, geo: Geometry, direction: "cw" | "ccw", windowCells: readonly number[]): boolean {
  const rotated = rotate(grid, geo, direction);
  const { landedAt } = compactColumns(rotated, geo);
  const finalCells = new Set(
    windowCells.map((cell) => {
      const rotatedCell = rotateCell(cell, geo, direction);
      // `windowCells` are all occupied (callers only check real threats), so `landedAt` always
      // has an entry — the `?? rotatedCell` fallback only matters if ever called on an empty
      // cell, which no caller here does.
      return landedAt.get(rotatedCell) ?? rotatedCell;
    })
  );
  return windowsFor(geo).some((w) => w.length === finalCells.size && w.every((c) => finalCells.has(c)));
}

/** Escalating weight for an open (single-player, unblocked) window with `count` of that
 *  player's discs out of `winLength` cells. `count >= winLength` is defensive only — a real win
 *  already ends the game before this function could ever be called on such a position. */
function windowWeight(count: number, winLength: number): number {
  if (count <= 0) return 0;
  if (count >= winLength) return 1000;
  if (count === winLength - 1) return 20; // one disc from winning
  if (count === winLength - 2) return 5;
  return 1;
}

/** A threat whose supporting geometry is about to be destroyed by an imminent tilt is
 *  discounted, not zeroed — the discs themselves remain on the board and may still matter for a
 *  DIFFERENT alignment after the re-fall, so a hard zero would throw away real information. */
const TILT_DISCOUNT_FACTOR = 0.25;
const IMMINENT_TILT_PLIES = 2;

export function heuristic(state: TiltState, player: PlayerSeat, cfg: HeuristicConfig): number {
  const grid = state.grid;
  const opponent: PlayerSeat = player === 0 ? 1 : 0;
  const untilNext = pliesUntilNextTilt(grid, cfg.tiltPeriod);
  const discountApplies = untilNext <= IMMINENT_TILT_PLIES;
  const direction = discountApplies ? nextTiltDirection(grid, cfg) : "cw";

  let score = 0;
  for (const window of windowsFor(cfg)) {
    let playerCount = 0;
    let opponentCount = 0;
    for (const cell of window) {
      const value = grid[cell];
      if (value === player) playerCount++;
      else if (value === opponent) opponentCount++;
    }
    if (playerCount > 0 && opponentCount > 0) continue; // blocked: neither side can complete it
    if (playerCount === 0 && opponentCount === 0) continue; // empty: no information yet
    const owner: PlayerSeat = playerCount > 0 ? player : opponent;
    const count = playerCount > 0 ? playerCount : opponentCount;
    let weight = windowWeight(count, cfg.winLength);
    if (discountApplies && !survivesTilt(grid, cfg, direction, window)) {
      weight *= TILT_DISCOUNT_FACTOR;
    }
    score += owner === player ? weight : -weight;
  }
  return score;
}

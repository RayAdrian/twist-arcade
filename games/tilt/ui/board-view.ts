// games/tilt/ui/board-view.ts — pure view-building helpers behind Board.tsx and index.ts's
// announce()/telegraph (Fadeout's/Nine Grids' own ui/board-view.ts convention: no React import,
// directly testable in isolation, shared by rendering AND the live-region text so the two can
// never drift apart — ux-lens §9's "the badge, announce(), and the heuristic never drift apart"
// rule).
//
// INTERACTIVE-CELL DESIGN (deviation from plan §12.1's literal "column strip" framing, flagged
// for review): §12.1 grants a sub-48px cell-floor exception with mandatory two-tap commit,
// anticipating a flat single-row-of-7-columns layout that cannot fit the 48px floor at a 320px
// viewport. This implementation instead renders the FULL 7x7 disc grid (`boardDimensions` =
// {rows:7,cols:7}), with exactly ONE real interactive Cell per non-full column — the cell at
// that column's current lowest-empty-row (engine-internal.ts's `lowestEmptyRow`) — at the
// STANDARD 48px floor, and relies on BoardShell's zoom/pan mechanism (already validated by Nine
// Grids' 9x9 board) for viewports too narrow to show all 7 columns at once. No cell ever renders
// below the 48px floor under this design, so the two-tap-commit exception is not invoked. Every
// OTHER cell (already-filled, or empty-but-not-yet-reachable) is a disabled, non-interactive
// Cell showing only the static disc content — never wired to a real move, so it carries no
// `moveToCellId` obligation.

import type { Effect } from "@twist-arcade/engine";
import { WIN_LENGTH } from "../engine";
import { columnHasSpace, discCount, lowestEmptyRow, type Disc, type Geometry, type Grid } from "../engine-internal";

export const GLYPH: Readonly<Record<0 | 1, string>> = { 0: "●", 1: "◎" }; // ● filled / ◎ ringed — glyph, not hue alone

export function glyphFor(player: 0 | 1): string {
  return GLYPH[player];
}

function idx(row: number, col: number, size: number): number {
  return row * size + col;
}

export interface CellPresentation {
  row: number;
  col: number;
  disc: Disc;
  /** True iff this is the ONE real drop target for its column right now (see this file's
   *  module doc). At most one true cell per column; none if the column is full. */
  isDropTarget: boolean;
  /** True for exactly one render — this cell's disc was displaced by the most recent re-fall
   *  (plan §6.1's "just-moved markers", static, present under both motion preferences). Driven
   *  directly by `view.lastEffects`, which the engine fully overwrites on every `apply()` — so
   *  this is automatically "exactly one ply" with no extra tracked state. */
  justMoved: boolean;
  accessibleName: string;
}

function cellAccessibleName(row: number, col: number, disc: Disc, isDropTarget: boolean, justMoved: boolean): string {
  const pos = `row ${row + 1}, column ${col + 1}`;
  if (disc !== null) {
    const who = disc === 0 ? "filled disc" : "ringed disc";
    return justMoved ? `${pos}. ${who}, just resettled by the tilt.` : `${pos}. ${who}.`;
  }
  return isDropTarget ? `${pos}. Empty — drop target for this column.` : `${pos}. Empty.`;
}

export function buildCellPresentations(grid: Grid, geo: Geometry): CellPresentation[] {
  const { size } = geo;
  const out: CellPresentation[] = [];
  const dropRowByCol = new Map<number, number>();
  for (let c = 0; c < size; c++) {
    if (columnHasSpace(grid, geo, c)) dropRowByCol.set(c, lowestEmptyRow(grid, geo, c));
  }
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const disc = grid[idx(row, col, size)] ?? null;
      const isDropTarget = dropRowByCol.get(col) === row;
      out.push({
        row,
        col,
        disc,
        isDropTarget,
        justMoved: false, // filled in by the caller, which has access to lastEffects
        accessibleName: cellAccessibleName(row, col, disc, isDropTarget, false),
      });
    }
  }
  return out;
}

/** Cell indices (row*size+col) displaced by the most recent re-fall, from `lastEffects`'s
 *  `moved` entries — empty when the last ply was not a tilt ply (or there is no last ply yet).
 *  Shared by Board.tsx (rendering the marker) and index.ts's announce() (the tilt summary's
 *  displaced-piece count), so the two can never disagree about what counts as "just moved". */
export function justMovedCells(lastEffects: readonly Effect[]): Set<number> {
  const cells = new Set<number>();
  for (const e of lastEffects) {
    if (e.type === "moved" && typeof e.to === "number") cells.add(e.to);
  }
  return cells;
}

/** Plies remaining until the next tilt fires — the SAME counting source the static telegraph
 *  countdown and `announce()`'s proximity phrase both read, per plan §6.3's "same definition,
 *  two consumers" rule. Always in [1, tiltPeriod]. */
export function pliesUntilNextTilt(grid: Grid, tiltPeriod: number): number {
  return tiltPeriod - (discCount(grid) % tiltPeriod);
}

/** The board edge that will become the new floor on the NEXT tilt, under a fixed-CW rotation:
 *  the current RIGHT edge rotates to the bottom (see engine-internal.ts's `rotate` doc — CW maps
 *  new(nr,nc)=old(r,c) with nc=size-1-r, so the bottom row of the rotated frame is populated from
 *  the OLD right column). Only "cw" is shipped; "alternating" is a §4 remedy lever with no UI
 *  support yet (documented gap, not silently guessed past). */
export function nextFloorEdge(direction: "cw" | "alternating"): "right" | "unknown" {
  return direction === "cw" ? "right" : "unknown";
}

export const NEW_FLOOR_ARROW = "→"; // → , points at the edge that becomes the new floor (right, under cw)

/** The static tilt-telegraph text (plan §6.1/§6.2): "⟳ N" countdown plus which edge becomes
 *  the new floor. Visible from ply 1 — `pliesUntilNextTilt` is well-defined even on the empty
 *  opening grid (returns `tiltPeriod`). */
export function telegraphText(grid: Grid, tiltPeriod: number, direction: "cw" | "alternating"): string {
  const remaining = pliesUntilNextTilt(grid, tiltPeriod);
  const edge = nextFloorEdge(direction);
  const edgeText = edge === "right" ? `new floor: right ${NEW_FLOOR_ARROW}` : "new floor: unknown (untested config)";
  return `⟳ ${remaining}  ·  ${edgeText}`;
}

/** announce() proximity fragment (plan §6.3.1): fires only within 2 plies of the next tilt,
 *  same counting source as the static telegraph. Empty string when the tilt is not imminent. */
export function tiltProximityAnnouncement(grid: Grid, tiltPeriod: number): string {
  const remaining = pliesUntilNextTilt(grid, tiltPeriod);
  if (remaining > 2) return "";
  if (remaining === 1) return "Board tilts after the next move.";
  return `Board tilts after ${remaining} more moves.`;
}

export function boardSummaryText(grid: Grid, geo: Geometry): string {
  let p0 = 0;
  let p1 = 0;
  for (const c of grid) {
    if (c === 0) p0++;
    else if (c === 1) p1++;
  }
  const openColumns = Array.from({ length: geo.size }, (_, c) => c).filter((c) => columnHasSpace(grid, geo, c)).length;
  return `${p0} filled discs, ${p1} ringed discs on the board. ${openColumns} of ${geo.size} columns open. First to ${WIN_LENGTH} in a row wins.`;
}

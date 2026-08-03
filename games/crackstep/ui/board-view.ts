// games/crackstep/ui/board-view.ts — pure view-building helpers shared by index.ts (announce,
// firstOccurrence anchors) and ui/Board.tsx (rendering). No React import, no @twist-arcade/
// harness import — directly testable in isolation (Fadeout's ui/board-view.ts sets the same
// convention), and safe to import from the presentation module without pulling the solver's
// heavier dependency into a route that only plays the game (the registry's loadSolver
// code-splitting boundary — see solver.ts's own header and index.ts's shareArtifact comment).

import type { CrackstepState, TileKind } from "../engine";

export function rowCol(cell: number, width: number): [row: number, col: number] {
  return [Math.floor(cell / width), cell % width];
}

/** "row R column C" — plan §7.4's literal accessible-name convention (no comma between the two
 *  coordinates; a comma separates this from the type/state that follows it). */
export function positionName(cell: number, width: number): string {
  const [row, col] = rowCol(cell, width);
  return `row ${row + 1} column ${col + 1}`;
}

export type CellVisualState = "current" | "stone" | "crumbling" | "crumbled" | "hole";

export interface CellPresentation {
  cell: number;
  row: number;
  col: number;
  tile: TileKind;
  state: CellVisualState;
  accessibleName: string;
}

function stateOf(view: CrackstepState, cell: number): CellVisualState {
  if (view.tiles[cell] === "hole") return "hole";
  if (cell === view.pos) return "current";
  if (view.tiles[cell] === "stone") return "stone";
  if (view.crumbled[cell]) return "crumbled";
  return "crumbling";
}

/** "position, type, state" (plan §7.4: "row 2 column 3, stone, crossed" / "row 4 column 1,
 *  gone."). A non-current "crumbling" tile is always NOT-yet-crossed by construction: any
 *  crumbling tile that was visited and then left is immediately crumbled (plan §1.2's
 *  crumble-on-leave rule) — so "crumbling AND visited AND not current" cannot occur. */
function accessibleNameOf(view: CrackstepState, cell: number, state: CellVisualState): string {
  const pos = positionName(cell, view.width);
  switch (state) {
    case "hole":
      return `${pos}, never floor`;
    case "current":
      return view.tiles[cell] === "stone"
        ? `${pos}, stone, you are here`
        : `${pos}, crumbling, you are here — falls when you leave`;
    case "stone":
      return `${pos}, stone, ${view.visited[cell] ? "crossed" : "not yet crossed"}`;
    case "crumbled":
      return `${pos}, gone`;
    case "crumbling":
      return `${pos}, wooden, not yet crossed`;
  }
}

export function buildCellPresentations(view: CrackstepState): CellPresentation[] {
  const out: CellPresentation[] = [];
  for (let cell = 0; cell < view.tiles.length; cell++) {
    const [row, col] = rowCol(cell, view.width);
    const state = stateOf(view, cell);
    out.push({ cell, row, col, tile: view.tiles[cell]!, state, accessibleName: accessibleNameOf(view, cell, state) });
  }
  return out;
}

export function tilesRemaining(view: CrackstepState): number {
  let n = 0;
  for (let i = 0; i < view.tiles.length; i++) {
    if (view.tiles[i] !== "hole" && !view.visited[i]) n += 1;
  }
  return n;
}

export function boardSummaryText(view: CrackstepState): string {
  const remaining = tilesRemaining(view);
  const here = positionName(view.pos, view.width);
  const onStone = view.tiles[view.pos] === "stone";
  if (remaining === 0) return `Floor crossed, ${here}.`;
  const tileNote = onStone ? "on stone" : "on a crumbling tile";
  return `${here}, ${tileNote}. ${remaining} tile${remaining === 1 ? "" : "s"} left.`;
}

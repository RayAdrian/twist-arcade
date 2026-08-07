// games/nine-grids/ui/board-view.ts — pure view-building helpers behind Board.tsx and index.ts's
// announce() (Fadeout's/Crackstep's own ui/board-view.ts sets this convention: no React import,
// directly testable in isolation, shared by both rendering and the live-region text so the two
// can never drift apart from each other — ux-lens §9's own "the badge, announce(), and the
// heuristic never drift apart" rule, applied here to "the border style and the accessible name
// never drift apart").
//
// GLOBAL CELL ORDER (read before touching buildCellPresentations): this game's engine addresses
// cells as (board 0..8, cell 0..8) — board-major. The RENDERED 9x9 grid must NOT emit cells in
// that order: BoardShell's CSS grid places children by plain DOM/row-major auto-flow over a
// `repeat(9,1fr)` template, so board-major order would visually scramble the macro/micro layout
// (board 0's 9 cells would render as one contiguous run — the first ROW-and-a-bit of the visual
// grid — instead of occupying the correct top-left 3x3 block). `buildCellPresentations` below
// iterates GLOBAL (row, col) 0..8 x 0..8 and translates each back to (board, cell), which is the
// one place this translation must happen correctly for the whole board to read as 9 recognizable
// 3x3 sub-boards arranged in a 3x3 macro grid rather than 9 arbitrary strips.

import type { PlayerId } from "@twist-arcade/engine";
import { boardStatusOf, globalIndex, type MicroBoardStatus, type MicroCell } from "../engine-internal";
import type { NineGridsState } from "../engine";

/** Shape-first identity (ux-lens §2/§8): X vs O, never color alone. */
export function glyphFor(player: PlayerId): string {
  return player === 0 ? "X" : "O";
}

const ROW_NAME = ["top", "middle", "bottom"] as const;
const COL_NAME = ["left", "center", "right"] as const;

/** "top left" / "middle center" / ... — reused at BOTH the macro (board 0..8) and micro
 *  (cell 0..8 within a board) scale, same 3x3 chassis, same naming — mirrors
 *  engine-internal.ts's own "LINES reused at both scales" convention, and Fadeout's established
 *  `boardPositionName` wording (ux-lens §8's own live-region example: "middle center"). NOTE for
 *  whoever pins verbatim strings later (platform-corrections.md C28's "pin them verbatim into
 *  the plan" instruction): the nine-grids test plan's OWN A11Y-001 illustrative example uses a
 *  visibly different, not-fully-self-consistent scheme ("center board", "bottom middle") — the
 *  plan states those are "example sentences" / "information-content contracts", not required
 *  verbatim text, so this file deliberately reuses the house convention already shipped in
 *  Fadeout rather than inventing a third naming scheme. Flagged for the next review pass rather
 *  than silently guessed past.
 */
export function positionName(idx: number): string {
  const row = Math.floor(idx / 3);
  const col = idx % 3;
  return `${ROW_NAME[row]} ${COL_NAME[col]}`;
}

export function boardName(board: number): string {
  return `${positionName(board)} board`;
}

/** Human phrase for a closed board's reason — shared by accessibleName and announce() so
 *  "won by X" / "full, no winner" is spelled identically everywhere it appears. */
export function closedReasonLabel(status: MicroBoardStatus): string {
  if (status.kind === "won") return `won by ${glyphFor(status.winner)}`;
  if (status.kind === "full") return "full, no winner";
  return "open";
}

export interface CellPresentation {
  board: number;
  cell: number;
  /** Position in the FLAT 9x9 visual grid — see this file's module doc. */
  globalRow: number;
  globalCol: number;
  mark: MicroCell;
  boardStatus: MicroBoardStatus;
  /** True when this cell's board is the one the mover is confined to right now. */
  isActiveBoard: boolean;
  /** True when the whole game is in a free-move state (`activeBoard === null`) AND this cell's
   *  board is still open — i.e. this cell is one of possibly-many simultaneously-legal boards,
   *  as distinct from `isActiveBoard` (exactly one board, or none). SEND-011/FREE-005's
   *  "visibly different, not merely inferable" requirement is carried by this flag driving a
   *  DIFFERENT static border treatment in Board.tsx (dashed "any open board" vs solid "this one
   *  board"), never by disabled-state alone. */
  isFreeMoveEligible: boolean;
  /** The board's own visual center cell (local index 4) — where a closed board's macro-scale
   *  glyph/pattern renders (WIN-008: "glyph, not hue alone"), so exactly one of the 9 physical
   *  Cells per closed board carries it rather than repeating it 9 times. */
  isBoardCenter: boolean;
  accessibleName: string;
}

function cellAccessibleName(
  board: number,
  cell: number,
  mark: MicroCell,
  status: MicroBoardStatus,
  activeBoard: number | null
): string {
  const pos = `${boardName(board)}, ${positionName(cell)}`;
  if (status.kind !== "open") return `${pos}. Closed — ${closedReasonLabel(status)}.`;
  if (mark !== null) return `${pos}. ${glyphFor(mark)}.`;
  if (activeBoard === null) return `${pos}. Empty. Free move — any open board.`;
  if (activeBoard === board) return `${pos}. Empty. Your move here.`;
  return `${pos}. Empty. Play in the ${boardName(activeBoard)}.`;
}

/** Builds all 81 cells' presentation data, in the FLAT VISUAL 9x9 order Board.tsx must render
 *  them in (see this file's module doc) — the one function Board.tsx maps onto shell `Cell`s. */
export function buildCellPresentations(view: NineGridsState): CellPresentation[] {
  const out: CellPresentation[] = [];
  for (let globalRow = 0; globalRow < 9; globalRow++) {
    for (let globalCol = 0; globalCol < 9; globalCol++) {
      const board = Math.floor(globalRow / 3) * 3 + Math.floor(globalCol / 3);
      const cell = (globalRow % 3) * 3 + (globalCol % 3);
      const status = boardStatusOf(view.cells, board);
      const mark = view.cells[globalIndex(board, cell)] ?? null;
      out.push({
        board,
        cell,
        globalRow,
        globalCol,
        mark,
        boardStatus: status,
        isActiveBoard: view.activeBoard === board,
        isFreeMoveEligible: view.activeBoard === null && status.kind === "open",
        isBoardCenter: cell === 4,
        accessibleName: cellAccessibleName(board, cell, mark, status, view.activeBoard),
      });
    }
  }
  return out;
}

/** On-request full readback (A11Y-010: never auto-included per move — Nine Grids has no
 *  decay-class effects at all, so `isDecayClassEffects` is always false for it and this only
 *  ever fires from the "Describe board" control). */
export function boardSummaryText(view: NineGridsState): string {
  const statuses = Array.from({ length: 9 }, (_, b) => boardStatusOf(view.cells, b));
  const wonX = statuses.filter((s) => s.kind === "won" && s.winner === 0).length;
  const wonO = statuses.filter((s) => s.kind === "won" && s.winner === 1).length;
  const openCount = statuses.filter((s) => s.kind === "open").length;
  const confinement =
    view.activeBoard === null ? "free move — play in any open board" : `confined to the ${boardName(view.activeBoard)}`;
  return `X has won ${wonX} board${wonX === 1 ? "" : "s"}, O has won ${wonO}. ${openCount} board${openCount === 1 ? "" : "s"} still open. Currently ${confinement}.`;
}

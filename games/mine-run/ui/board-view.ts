// games/mine-run/ui/board-view.ts — pure presentation logic behind Board.tsx (mine-run.md
// §8.1/§8.4). No React here on purpose: revealed/hidden/exploded classification and accessible
// names are a pure function of MineRunView, so they're tested in isolation before Board.tsx
// ever wires them to a shell Cell — mirrors games/fadeout/ui/board-view.ts's own split.
//
// View-honest by construction: every function here takes a MineRunView (never MineRunState) —
// there is no code path that could read an unrevealed mine's identity, because the view type
// itself has no field that could carry one (engine.ts's own header comment).

import type { MineRunView } from "../engine";

/** "Row 1, column 1" — 1-indexed, matching mine-run.md §8.4's exact wording. */
export function boardPositionName(cell: number, width: number): string {
  const row = Math.floor(cell / width);
  const col = cell % width;
  return `Row ${row + 1}, column ${col + 1}`;
}

export interface MineRunCellPresentation {
  cell: number;
  row: number;
  col: number;
  revealed: boolean;
  exploded: boolean;
  /** Adjacent-mine count — present iff revealed and not exploded (an exploded cell shows the
   *  mine glyph, never a numeral: `engine.ts`'s own view contract never carries a number for an
   *  exploded cell). */
  n?: number;
  accessibleName: string;
}

/** Builds all `width*height` cells' presentation data from the current view, one entry per
 *  cell in index order (`out[cell] === ` that cell's presentation) — the one function Board.tsx
 *  maps onto shell `Cell`s. Pure; safe to call on every render. Iterates the FULL index range,
 *  not `Object.keys(view.cells)`, specifically so an unrevealed cell still gets a real "Hidden."
 *  presentation rather than being silently absent from the returned array. */
export function buildCellPresentations(view: MineRunView): MineRunCellPresentation[] {
  const total = view.width * view.height;
  const out: MineRunCellPresentation[] = [];
  for (let cell = 0; cell < total; cell++) {
    const row = Math.floor(cell / view.width);
    const col = cell % view.width;
    const positionName = boardPositionName(cell, view.width);
    const cellView = view.cells[cell];

    if (!cellView) {
      out.push({ cell, row, col, revealed: false, exploded: false, accessibleName: `${positionName}. Hidden.` });
      continue;
    }
    if ("exploded" in cellView) {
      out.push({ cell, row, col, revealed: true, exploded: true, accessibleName: `${positionName}. Exploded mine.` });
      continue;
    }
    if ("mine" in cellView) {
      // Terminal spectator-only carve-out (engine.ts §3.2) — never reached by the player's own
      // view during an ongoing run; included for completeness so this function stays total.
      out.push({ cell, row, col, revealed: false, exploded: false, accessibleName: `${positionName}. Mine.` });
      continue;
    }
    out.push({
      cell,
      row,
      col,
      revealed: true,
      exploded: false,
      n: cellView.n,
      accessibleName: `${positionName}. Revealed, ${cellView.n}.`,
    });
  }
  return out;
}

/** The always-visible informed-odds HUD line (lens §1.7: mine counts are never hidden — the
 *  risk is real, not a guessing game about how many mines exist at all). */
export function mineCountSummary(view: MineRunView): string {
  return `\u{1F4A3} ${view.minesTotal} \u{00B7} ${view.minesExploded} hit`;
}

/** Small-number words for 0-8 (a cell's adjacent-mine count is always in this range on any
 *  8-neighbor grid), used by announce()'s reveal sentence ("Two neighbouring mines."). */
const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

export function neighbouringMinesPhrase(n: number): string {
  const word = COUNT_WORDS[n] ?? String(n);
  return `${word} neighbouring mine${n === 1 ? "" : "s"}.`;
}

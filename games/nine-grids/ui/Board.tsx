// games/nine-grids/ui/Board.tsx — typed against BoardProps<V, M> (plan §5.3).
//
// DELIBERATE SCOPE BOUNDARY: this is engine-only pass (orchestrator's gate-before-UI ruling,
// platform-corrections.md-adjacent correction C16 — a shipped board UI must not get ahead of
// its engine's contract/design gates). This file exists ONLY so the package typechecks against
// the real NineGridsState/NineGridsMove shape; it renders one Cell per legal move, addressed
// by its raw (board, cell) pair, with NO macro/micro grid layout, no active-board highlighting,
// no closed-board styling. The real board — 9 macro boards of 9 cells, with the strict
// ruleset's active-board/free-move states made visually legible — is a later, separate pass,
// gated on this engine's contract and design suites passing first.
//
// Uses `@twist-arcade/shell`'s `Cell` (the >=48px floor, focus/keyboard-nav registration) and
// `moveToCellId` (the cellId <-> move convention `GameShell` relies on to parse `onCellAction`
// back into a real move — see packages/shell/src/cell-id.ts) rather than a bare <button>, so
// even this placeholder is keyboard-navigable and APG-grid-compliant for free.
//
// C5 (platform-corrections.md): no animation library here, ever — this directory (games/*/ui)
// is board state, not chrome. Any state change must be visible from a static render; motion
// may only RESTATE something the static encoding already shows, never carry information alone.

import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { NineGridsMove, NineGridsState } from "../engine";

// `onMove` is deliberately NOT destructured: a board built entirely from `Cell` components
// never calls it directly — Cell commits through BoardContext (registerCell/commit), which
// BoardShell forwards to `onCellAction`, which GameShell wires straight to the same handler
// `onMove` would otherwise reach via `moveToCellId`. `onMove` exists on `BoardProps` for a
// board that resolves a move WITHOUT a 1:1 Cell per legal move (e.g. a drag gesture or a
// multi-cell selection) — not needed here, but still part of the type every Board must accept.
export function Board({ view, legal }: BoardProps<NineGridsState, NineGridsMove>) {
  const legalKeys = new Set(legal.map((m) => moveToCellId(m)));

  const cells = [];
  for (let board = 0; board < 9; board++) {
    for (let cell = 0; cell < 9; cell++) {
      const move: NineGridsMove = { board, cell };
      const id = moveToCellId(move);
      const mark = view.cells[board * 9 + cell];
      cells.push(
        <Cell
          key={id}
          id={id}
          row={board}
          col={cell}
          occupant={mark === null ? null : <span>{mark === 0 ? "X" : "O"}</span>}
          accessibleName={`board ${board + 1}, cell ${cell + 1}${
            mark === null ? "" : mark === 0 ? ", X" : ", O"
          }`}
          disabled={!legalKeys.has(id)}
        />
      );
    }
  }

  return <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4 }}>{cells}</div>;
}

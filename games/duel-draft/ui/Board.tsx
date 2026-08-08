// games/duel-draft/ui/Board.tsx — typed against BoardProps<V, M> (plan §5.3). STILL the
// scaffold's placeholder rendering — D1 (this change) is engine + tests + probes only
// (docs/plans/duel-draft.md §14's sequencing table: UI is D4, strictly after D3 gates are
// green, per C16's gate-before-UI rule). This file is updated ONLY enough to typecheck against
// the REAL engine shape (a 16-cell board, not the scaffold's fictional single-cell counter) —
// replace with the real 4x4 board renderer at D4.
//
// Uses `@twist-arcade/shell`'s `Cell` (the >=48px floor, focus/keyboard-nav registration) and
// `moveToCellId` (the cellId <-> move convention `GameShell` relies on to parse `onCellAction`
// back into a real move — see packages/shell/src/cell-id.ts) rather than a bare <button>, so
// this board is keyboard-navigable and APG-grid-compliant for free.
//
// C5 (platform-corrections.md): no animation library here, ever — this directory (games/*/ui)
// is board state, not chrome. Any state change must be visible from a static render; motion
// may only RESTATE something the static encoding already shows, never carry information alone.

import type { BoardProps } from "@twist-arcade/game-spec";
import { Cell, moveToCellId } from "@twist-arcade/shell";
import type { DuelDraftMove, DuelDraftState } from "../engine";

// `onMove` is deliberately NOT destructured: a board built entirely from `Cell` components
// never calls it directly — Cell commits through BoardContext (registerCell/commit), which
// BoardShell forwards to `onCellAction`, which GameShell wires straight to the same handler
// `onMove` would otherwise reach via `moveToCellId`. `onMove` exists on `BoardProps` for a
// board that resolves a move WITHOUT a 1:1 Cell per legal move (e.g. a drag gesture or a
// multi-cell selection) — not needed here, but still part of the type every Board must accept.
export function Board({ view, legal }: BoardProps<DuelDraftState, DuelDraftMove>) {
  const legalCells = new Set(legal.map((m) => m.cell));
  const move0: DuelDraftMove = { cell: 0 };

  // TODO(you, D4): a real 4x4 grid — one <Cell> per board cell, occupant reflecting
  // "empty"|0|1|"destroyed" per plan §11's authoritative static encoding (a distinct
  // glyph/pattern for destroyed cells, never hue alone). This placeholder renders exactly one
  // cell so the package typechecks against the real DuelDraftState/DuelDraftMove shape.
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: 8 }}>
      <Cell
        id={moveToCellId(move0)}
        row={0}
        col={0}
        occupant={<span>{view.board[0]}</span>}
        accessibleName={`cell 0 is ${view.board[0]}`}
        disabled={!legalCells.has(0)}
      />
    </div>
  );
}

// games/tilt/ui/Board.tsx — typed against BoardProps<V, M> (plan §5.3). STILL THE SCAFFOLD
// PLACEHOLDER, deliberately: T1/T2 (docs/plans/tilt.md §11) build the engine and the kill-test
// sweep only — gate-before-UI (C16) means the real 7x7 board is not built until T2's sweep and
// T4's gates are on the record and reviewed (T5). This file was only touched enough to keep
// `pnpm typecheck` green against the real (non-placeholder) `TiltState`/`TiltMove` shape — it
// renders a single non-representative cell, not a board.
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
import type { TiltMove, TiltState } from "../engine";

// `onMove` is deliberately NOT destructured: a board built entirely from `Cell` components
// never calls it directly — Cell commits through BoardContext (registerCell/commit), which
// BoardShell forwards to `onCellAction`, which GameShell wires straight to the same handler
// `onMove` would otherwise reach via `moveToCellId`. `onMove` exists on `BoardProps` for a
// board that resolves a move WITHOUT a 1:1 Cell per legal move (e.g. a drag gesture or a
// multi-cell selection) — not needed here, but still part of the type every Board must accept.
export function Board({ view, legal }: BoardProps<TiltState, TiltMove>) {
  const filled = view.grid.filter((c) => c !== null).length;
  const move: TiltMove | undefined = legal[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: 8 }}>
      <Cell
        id={move ? moveToCellId(move) : "placeholder"}
        row={0}
        col={0}
        occupant={<span>{filled}</span>}
        accessibleName={`${filled} of 49 cells filled${move ? ", tap to drop" : ""}`}
        disabled={!move}
      />
    </div>
  );
}

// games/__GAME_ID__/ui/Board.tsx — typed against BoardProps<V, M> (plan §5.3). Renders the
// placeholder counter mechanic; replace with your real board once engine.ts's TODO is done.
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
import type { __PASCAL_ID__Move, __PASCAL_ID__State } from "../engine";

// `onMove` is deliberately NOT destructured: a board built entirely from `Cell` components
// never calls it directly — Cell commits through BoardContext (registerCell/commit), which
// BoardShell forwards to `onCellAction`, which GameShell wires straight to the same handler
// `onMove` would otherwise reach via `moveToCellId`. `onMove` exists on `BoardProps` for a
// board that resolves a move WITHOUT a 1:1 Cell per legal move (e.g. a drag gesture or a
// multi-cell selection) — not needed here, but still part of the type every Board must accept.
export function Board({ view, legal }: BoardProps<__PASCAL_ID__State, __PASCAL_ID__Move>) {
  const canIncrement = legal.some((m) => m.kind === "increment");
  const move: __PASCAL_ID__Move = { kind: "increment" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: 8 }}>
      <Cell
        id={moveToCellId(move)}
        row={0}
        col={0}
        occupant={<span>{view.counter}</span>}
        accessibleName={`counter is ${view.counter}${canIncrement ? ", tap to increment" : ""}`}
        disabled={!canIncrement}
      />
    </div>
  );
}

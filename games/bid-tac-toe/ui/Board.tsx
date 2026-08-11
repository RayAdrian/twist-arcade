// games/bid-tac-toe/ui/Board.tsx — placeholder ONLY, kept just type-correct against the real
// engine shape (plan §5.3). Real UI is B4's job, strictly after B3 is green (C16: no board
// before B3) — this team's brief is the engine (B1), not this file. Do not treat this as a
// design decision; it exists so the package typechecks.
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
import type { BidTacToeMove, BidTacToeState } from "../engine";

// `onMove` is deliberately NOT destructured (same reasoning as every other stamped Board.tsx
// in this repo): a board built entirely from `Cell` components commits through BoardContext,
// not `onMove` directly. `onMove` stays part of the type every Board must accept.
export function Board({ view, legal }: BoardProps<BidTacToeState, BidTacToeMove>) {
  // TODO(B4): the real bid-input UI (stepper/slider + star toggle + commit, plan §9) — the
  // sealed-bid phase has no per-cell affordance at all. This placeholder renders only the
  // 3x3 board's PLACE phase legality so the package has real geometry to typecheck against.
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {view.board.map((occupant, i) => {
        const move: BidTacToeMove = { kind: "place", cell: i };
        const isLegal = legal.some((m) => m.kind === "place" && m.cell === i);
        return (
          <Cell
            key={i}
            id={moveToCellId(move)}
            row={Math.floor(i / 3)}
            col={i % 3}
            occupant={<span>{occupant === null ? "" : occupant === 0 ? "X" : "O"}</span>}
            accessibleName={`cell ${i}${occupant === null ? "" : occupant === 0 ? ", X" : ", O"}`}
            disabled={!isLegal}
          />
        );
      })}
    </div>
  );
}

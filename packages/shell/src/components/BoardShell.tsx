// packages/shell/src/components/BoardShell.tsx — plan §4.4: the machinery box around a
// game's Board. Owns sizing, the >=48px floor (via Cell), the roving-tabindex APG grid,
// pointer-commit + lockout, all so no game reimplements them.

import { Children, type ReactNode, useMemo, useRef, useState } from "react";
import { BoardContext, type CellRegistration } from "./board-context";

export interface BoardShellProps {
  rows: number;
  cols: number;
  /** Not this seat's turn / terminal / spectator — blocks ALL commits. */
  disabled: boolean;
  /** Fires only after commit rules (not disabled, not locked, cell not disabled) pass. */
  onCellAction(cellId: string): void;
  boardLabel: string;
  /** performance.now() timestamp from useGame; a gesture that BEGAN before this instant is
   *  dropped even if it completes later (plan §4.4/§7 — the 250ms post-state-change lockout). */
  lockedUntil?: number;
  reducedMotion?: boolean;
  children: ReactNode;
}

export function BoardShell({
  rows,
  cols,
  disabled,
  onCellAction,
  boardLabel,
  lockedUntil = 0,
  reducedMotion = false,
  children,
}: BoardShellProps) {
  const [cursor, setCursor] = useState({ row: 0, col: 0 });
  const registryRef = useRef(new Map<string, CellRegistration>());
  const byPosRef = useRef(new Map<string, string>()); // "row,col" -> cellId

  function moveCursor(row: number, col: number) {
    const clampedRow = Math.max(0, Math.min(rows - 1, row));
    const clampedCol = Math.max(0, Math.min(cols - 1, col));
    setCursor({ row: clampedRow, col: clampedCol });
    const cellId = byPosRef.current.get(`${clampedRow},${clampedCol}`);
    if (cellId) registryRef.current.get(cellId)?.el.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveCursor(cursor.row - 1, cursor.col);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveCursor(cursor.row + 1, cursor.col);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveCursor(cursor.row, cursor.col - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveCursor(cursor.row, cursor.col + 1);
        break;
    }
  }

  const contextValue = useMemo(
    () => ({
      rows,
      cols,
      disabled,
      reducedMotion,
      cursor,
      registerCell(cellId: string, reg: CellRegistration) {
        registryRef.current.set(cellId, reg);
        byPosRef.current.set(`${reg.row},${reg.col}`, cellId);
        return () => {
          registryRef.current.delete(cellId);
          byPosRef.current.delete(`${reg.row},${reg.col}`);
        };
      },
      moveCursor,
      commit(cellId: string, actionAt: number, cellDisabled?: boolean) {
        if (disabled || cellDisabled) return;
        if (actionAt < lockedUntil) return; // dropped silently — plan §4.4/§7
        onCellAction(cellId);
      },
    }),
    // `moveCursor` is intentionally omitted: it's a plain function recreated every render
    // (not memoized) that only closes over `rows`/`cols`/`byPosRef`/`registryRef`, all of
    // which are otherwise already covered by this same dependency list or are stable refs.
    [rows, cols, disabled, reducedMotion, cursor, lockedUntil, onCellAction]
  );

  // ARIA's grid pattern requires role="gridcell" to be a child of role="row" (axe:
  // aria-required-parent) — but the visual layout is a single CSS grid (§4.4's sizing box),
  // not a table of nested boxes. `display: contents` on the row wrapper satisfies BOTH: the
  // wrapper exists for the accessibility tree, and its children still lay out as direct
  // items of the outer CSS grid. Requires the game's Board to render exactly rows*cols Cells
  // as a flat, row-major child list (Children.toArray flattens the nested-map shape a Board
  // naturally produces).
  const flatCells = Children.toArray(children);

  return (
    <BoardContext.Provider value={contextValue}>
      <div
        role="grid"
        aria-label={boardLabel}
        aria-rowcount={rows}
        aria-colcount={cols}
        onKeyDown={onKeyDown}
        style={{
          width: "min(calc(100vw - 32px), 52svh)",
          aspectRatio: "1 / 1",
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
        className="mx-auto gap-1"
      >
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} role="row" aria-rowindex={r + 1} style={{ display: "contents" }}>
            {flatCells.slice(r * cols, r * cols + cols)}
          </div>
        ))}
      </div>
    </BoardContext.Provider>
  );
}

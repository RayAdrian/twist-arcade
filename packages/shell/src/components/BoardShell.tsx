// packages/shell/src/components/BoardShell.tsx — plan §4.4: the machinery box around a
// game's Board. Owns sizing, the >=48px floor (via Cell), the roving-tabindex APG grid,
// pointer-commit + lockout, all so no game reimplements them.
//
// "use client" — hooks + a keydown handler (see board-context.tsx's comment for why every
// hook-using shell component needs this individually, not just GameShell).
"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";
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
  /** Rendered as an absolutely-positioned sibling over the grid, still inside
   *  BoardContext.Provider — this is the slot CalloutLayer (plan §4.15) is meant to fill,
   *  since it needs the same cell registry the board itself uses to resolve anchors. */
  overlay?: ReactNode;
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
  overlay,
  children,
}: BoardShellProps) {
  const [cursor, setCursor] = useState({ row: 0, col: 0 });
  const registryRef = useRef(new Map<string, CellRegistration>());
  const byPosRef = useRef(new Map<string, string>()); // "row,col" -> cellId
  const [boardEl, setBoardEl] = useState<HTMLElement | null>(null);

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
      getCellElement(cellId: string): HTMLElement | undefined {
        return registryRef.current.get(cellId)?.el;
      },
      boardEl,
      commit(cellId: string, actionAt: number, cellDisabled?: boolean) {
        if (disabled || cellDisabled) return;
        if (actionAt < lockedUntil) return; // dropped silently — plan §4.4/§7
        onCellAction(cellId);
      },
    }),
    // `moveCursor` is intentionally omitted: it's a plain function recreated every render
    // (not memoized) that only closes over `rows`/`cols`/`byPosRef`/`registryRef`, all of
    // which are otherwise already covered by this same dependency list or are stable refs.
    [rows, cols, disabled, reducedMotion, cursor, lockedUntil, onCellAction, boardEl]
  );

  // Deliberately NOT the "N row wrappers + Children.toArray().slice()" shape an earlier
  // revision used: that required a game's Board to render exactly rows*cols Cells as a flat,
  // row-major child list, syntactically, as BoardShell's direct JSX children. That breaks the
  // instant a game's Board is its own component instance (`<presentation.Board/>`, per §4.1's
  // "Board slot... rendered inside BoardShell") — `Children.toArray` only sees the ONE opaque
  // <Board/> element BoardShell was actually handed; it cannot (and must not try to) reach
  // through into what Board's own render eventually produces, since forcing that would mean
  // calling Board as a bare function instead of JSX, which breaks the Rules of Hooks the
  // instant a game's Board uses any hook of its own.
  //
  // Fix: exactly ONE `role="row"` wrapper (not one per visual row) around the whole board,
  // `display: contents` so it never affects the CSS grid layout — this satisfies axe's
  // aria-required-parent rule (every `role="gridcell"` needs a `row` ancestor somewhere in the
  // DOM) without BoardShell needing to know how many cells exist or which ones belong to which
  // row. Each cell's TRUE position is carried by `aria-rowindex`/`aria-colindex` on the cell
  // itself (`Cell` sets these directly) — the documented APG technique for grids where the DOM
  // doesn't mirror row structure 1:1 (the same technique used for virtualized grids). `children`
  // is otherwise rendered completely opaquely: BoardShell has no opinion on its shape beyond
  // "some gridcells are in there somewhere," which is the only guarantee an arbitrary Board
  // component can give.
  return (
    <BoardContext.Provider value={contextValue}>
      <div className="relative mx-auto" style={{ width: "min(calc(100vw - 32px), 52svh)" }}>
        <div
          ref={setBoardEl}
          role="grid"
          aria-label={boardLabel}
          aria-rowcount={rows}
          aria-colcount={cols}
          onKeyDown={onKeyDown}
          style={{
            aspectRatio: "1 / 1",
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
          className="gap-1"
        >
          <div role="row" style={{ display: "contents" }}>
            {children}
          </div>
        </div>
        {overlay}
      </div>
    </BoardContext.Provider>
  );
}

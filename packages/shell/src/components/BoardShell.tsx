// packages/shell/src/components/BoardShell.tsx — plan §4.4: the machinery box around a
// game's Board. Owns sizing, the >=48px floor (via Cell), the roving-tabindex APG grid,
// pointer-commit + lockout, all so no game reimplements them.
//
// "use client" — hooks + a keydown handler (see board-context.tsx's comment for why every
// hook-using shell component needs this individually, not just GameShell).
"use client";

import { type ReactNode, type Ref, useMemo, useRef, useState } from "react";
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
  /** Nine Grids escalation (platform-corrections.md C5's "48px floor at 320px" gate, ux-lens
   *  §7's "boards where the grid math would force cells below 48px on a 320px-wide viewport
   *  must redesign their board (zoom/pan regions or a different layout), not shrink the
   *  targets"): the FLOOR this board's cells are rendered at, for the container's own natural-
   *  size math below — NOT a per-Cell override (each `Cell` still defaults its own `minCellPx`
   *  to 48 independently; this prop must match whatever the game's Cells actually use, or the
   *  zoom/pan math below would compute the wrong natural size). Default 48, matching Cell's own
   *  `DEFAULT_MIN_CELL_PX` — every game before Nine Grids has cols/rows small enough that this
   *  never mattered (natural size always fit inside the viewport-constrained frame already). */
  minCellPx?: number;
  /** RES-002/A11Y-007 fix: an external ref onto the board's own `role="grid"` container, so a
   *  caller (GameShell) can send focus here when ResultModal closes. ResultModal has no
   *  click-based opener at all — GameShell opens it automatically ~300ms after the game reaches
   *  a terminal status — so there is no "invoking control" for Radix's trigger-based focus
   *  restore to return to; the finished board is the sensible landmark instead (ResultModal's
   *  own header comment: "Escape closes to the finished board — the board stays inspectable
   *  underneath"). Composed with this component's own internal `setBoardEl` state setter below
   *  (both need the same DOM node); does not replace or change `boardEl`'s existing role in
   *  BoardContext (CalloutLayer's anchor fallback, moveCursor's focus target). */
  containerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/** Sets a plain callback ref AND/OR a ref object/callback supplied by a caller, on the same
 *  DOM node — deliberately tiny and local rather than a new dependency: this component has
 *  exactly one caller (GameShell) that ever needs the second ref, and Radix's own
 *  `useComposedRefs` isn't part of this package's public dependency surface. */
function composeRefs<T>(a: (node: T | null) => void, b?: Ref<T>) {
  return (node: T | null) => {
    a(node);
    if (typeof b === "function") b(node);
    else if (b && "current" in b) (b as { current: T | null }).current = node;
  };
}

const GAP_PX = 4; // Tailwind `gap-1` (0.25rem @ 16px root) — the grid's own className below.
const DEFAULT_MIN_CELL_PX = 48;

export function BoardShell({
  rows,
  cols,
  disabled,
  onCellAction,
  boardLabel,
  lockedUntil = 0,
  reducedMotion = false,
  overlay,
  minCellPx = DEFAULT_MIN_CELL_PX,
  containerRef,
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

  // Orchestrator ruling (boardDimensions escalation): `rows`/`cols` are computed PER VIEW on the
  // presentation, so they can legitimately shrink between renders (a seed-varied setup, or a
  // shrinking-board twist) — a `cursor` position stored from a LARGER previous board can be left
  // pointing at a (row, col) that no longer exists at all, which would match no rendered Cell and
  // strand the whole grid with ZERO tabIndex=0 cells (unreachable by keyboard/Tab entirely).
  // Clamped HERE, at render time, directly from the raw `cursor` state — not via an effect (which
  // would render once with the stale value first) and not by mutating `cursor` state itself
  // (moveCursor's own arrow-key deltas are computed from the same closure's `rows`/`cols` and
  // already clamp correctly on their own terms).
  const clampedCursor = {
    row: Math.max(0, Math.min(rows - 1, cursor.row)),
    col: Math.max(0, Math.min(cols - 1, cursor.col)),
  };

  const contextValue = useMemo(
    () => ({
      rows,
      cols,
      disabled,
      reducedMotion,
      cursor: clampedCursor,
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
    [rows, cols, disabled, reducedMotion, clampedCursor.row, clampedCursor.col, lockedUntil, onCellAction, boardEl]
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
  // Zoom/pan region (ux-lens §7 / platform-corrections.md C5): the FRAME below is the fixed
  // viewport-constrained footprint every board has always had (`min(100vw-32px, 52svh)`,
  // square). The GRID inside it used to be sized to exactly fill the frame via
  // `aspectRatio:"1/1"` alone, which silently let a wide/tall board's cells shrink below
  // `minCellPx` (each Cell's own `minWidth`/`minHeight` floor would then fight the grid's `1fr`
  // tracks for space it doesn't have). Nine Grids' 9x9 board is the first one where the FRAME
  // genuinely cannot fit `cols` cells at the floor on a 320px viewport (9*48 + 8*4 = 464px vs.
  // ~288px available) — ux-lens's own prescribed remedy for exactly this case is "zoom/pan
  // regions... not shrink the targets", so the grid is now sized to its NATURAL minimum
  // (enough for every cell to be exactly `minCellPx`, never less) and the FRAME clips/scrolls
  // whatever doesn't fit, via `max(100%, naturalPx)`: pure CSS, no JS layout measurement.
  // Every existing game's natural size is already <= the frame (their `rows`/`cols` were always
  // small enough), so `max(100%, natural)` resolves to `100%` for them — this is a no-op there,
  // proven by board-shell.test.tsx's existing suite still passing unchanged.
  const naturalWidthPx = cols * minCellPx + (cols - 1) * GAP_PX;
  const naturalHeightPx = rows * minCellPx + (rows - 1) * GAP_PX;
  const FRAME_SIZE = "min(calc(100vw - 32px), 52svh)";

  return (
    <BoardContext.Provider value={contextValue}>
      <div
        className="relative mx-auto"
        style={{ width: FRAME_SIZE, height: FRAME_SIZE, overflow: "auto", overscrollBehavior: "contain" }}
      >
        <div
          ref={composeRefs(setBoardEl, containerRef)}
          role="grid"
          aria-label={boardLabel}
          aria-rowcount={rows}
          aria-colcount={cols}
          // RES-002/A11Y-007: -1, not 0 — this must stay OUT of the normal Tab order (each
          // Cell's own roving tabindex already governs keyboard entry into the grid); it's only
          // ever reached programmatically, via `containerRef.current?.focus()` when ResultModal
          // closes with no click-based opener to return focus to.
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={{
            width: `max(100%, ${naturalWidthPx}px)`,
            height: `max(100%, ${naturalHeightPx}px)`,
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

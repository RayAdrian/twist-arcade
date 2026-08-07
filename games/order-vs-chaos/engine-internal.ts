// games/order-vs-chaos/engine-internal.ts — board geometry and rules helpers (plan §1.3, §3,
// §5) for Order vs Chaos. Kept separate from engine.ts so the pure "what is a winning window"
// question has one home, matching Fadeout's engine/engine-internal split.
//
// The window construction here (rows, columns, both diagonal directions, all length-WIN_LENGTH
// consecutive slices) deliberately mirrors
// scripts/research/order-vs-chaos-line-probability.ts's OV0/R1 construction, which had to be
// written and run BEFORE this file existed (C31: "Order vs Chaos runs a 10k-board
// line-probability script before anything is built") — that script re-derives its own copy
// rather than importing this one. Both independently assert the same pencil-check total (32
// windows on 6x6/win-5, plan §1.3), which is worth keeping as a cross-check: if this module's
// windows ever disagreed with the research script's, that would be caught by two different
// tests landing on two different numbers, not silently.

export const BOARD_SIZE = 6;
export const WIN_LENGTH = 5;
export const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;

export type CellSymbol = "X" | "O";
export type Cell = CellSymbol | null;
export type Board = readonly Cell[]; // length TOTAL_CELLS, row-major, index = row * BOARD_SIZE + col

type Line = readonly number[];

function idx(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

/** All maximal lines (rows, columns, both diagonal directions) of length >= WIN_LENGTH. */
function buildLines(): Line[] {
  const lines: Line[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    lines.push(Array.from({ length: BOARD_SIZE }, (_, c) => idx(r, c)));
  }
  for (let c = 0; c < BOARD_SIZE; c++) {
    lines.push(Array.from({ length: BOARD_SIZE }, (_, r) => idx(r, c)));
  }
  // down-right diagonals, keyed by (row - col)
  for (let k = -(BOARD_SIZE - 1); k <= BOARD_SIZE - 1; k++) {
    const cells: number[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const c = r - k;
      if (c >= 0 && c < BOARD_SIZE) cells.push(idx(r, c));
    }
    if (cells.length >= WIN_LENGTH) lines.push(cells);
  }
  // down-left (anti) diagonals, keyed by (row + col)
  for (let k = 0; k <= 2 * (BOARD_SIZE - 1); k++) {
    const cells: number[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const c = k - r;
      if (c >= 0 && c < BOARD_SIZE) cells.push(idx(r, c));
    }
    if (cells.length >= WIN_LENGTH) lines.push(cells);
  }
  return lines;
}

function buildWindows(lines: readonly Line[]): Line[] {
  const windows: Line[] = [];
  for (const line of lines) {
    for (let start = 0; start + WIN_LENGTH <= line.length; start++) {
      windows.push(line.slice(start, start + WIN_LENGTH));
    }
  }
  return windows;
}

/** All 32 winning windows on this board (plan §1.3's pencil check: 12 row-windows + 12
 *  column-windows + 8 diagonal-windows). Pure geometry, computed once at module load — never
 *  depends on board contents. */
export const WINDOWS: readonly Line[] = buildWindows(buildLines());

if (WINDOWS.length !== 32) {
  // Defensive: this can only fire if the construction above is edited incorrectly. Kept as a
  // loud module-load throw (same discipline as fadeout's resolveConfig / R1's own assertion)
  // rather than a silently-wrong window count feeding every downstream win check.
  throw new Error(
    `order-vs-chaos engine-internal: expected 32 win-windows on ${BOARD_SIZE}x${BOARD_SIZE}/` +
      `win-${WIN_LENGTH}, got ${WINDOWS.length} — check buildLines()/buildWindows()`
  );
}

/** True iff `symbol` fills every cell of at least one winning window. */
export function hasFiveRun(board: Board, symbol: CellSymbol): boolean {
  for (const window of WINDOWS) {
    let mono = true;
    for (const cell of window) {
      if (board[cell] !== symbol) {
        mono = false;
        break;
      }
    }
    if (mono) return true;
  }
  return false;
}

/** Union of every cell that is part of at least one currently-winning window (either symbol),
 *  sorted ascending. Feeds the `line` effect (UI highlight hook) — cheap enough (32 windows x
 *  5 cells) to call unconditionally on every apply(). */
export function winningCells(board: Board): number[] {
  const cells = new Set<number>();
  for (const symbol of ["X", "O"] as const) {
    for (const window of WINDOWS) {
      if (window.every((c) => board[c] === symbol)) {
        for (const c of window) cells.add(c);
      }
    }
  }
  return [...cells].sort((a, b) => a - b);
}

export function filledCount(board: Board): number {
  let n = 0;
  for (const cell of board) if (cell !== null) n++;
  return n;
}

export type Outcome = "ongoing" | "order" | "chaos";

/**
 * Win check precedes board-full check (plan §3, pinned): a line completed by the 36th
 * placement is an Order win, not a Chaos win. A line is checked for EITHER symbol and
 * regardless of who placed the mark that completed it — Order wins even when Chaos is the one
 * who closed the line (plan §5 item 3's pinned "Chaos completes a line, Order wins" case).
 */
export function computeOutcome(board: Board): Outcome {
  if (hasFiveRun(board, "X") || hasFiveRun(board, "O")) return "order";
  if (filledCount(board) === TOTAL_CELLS) return "chaos";
  return "ongoing";
}

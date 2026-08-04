// games/nine-grids/engine-internal.ts — shared pure helpers behind engine.ts, heuristic.ts,
// and probes.ts (mirrors games/fadeout's split, same rationale: heuristic.ts is imported ONLY
// by an optional bot policy and should never need engine.ts's encode/decode/GameEngine wiring
// just to get board geometry).
//
// STATE-MODEL DECISION, read before touching anything else: board-status (open / won / full)
// is DERIVED from `cells` on every call, never stored as a separate field engine.ts's apply()
// would have to remember to keep in sync. Fadeout's `queues` (the age-ordering) is genuinely
// NOT derivable from anything else and so is stored directly; a Nine Grids micro board's
// status, by contrast, is a pure function of its 9 cells (three-in-a-row, or every cell
// filled) — storing it too would be exactly the "two hand-written copies of the same fact
// drifting apart" bug class the CHECKLIST warns about ("which small board is active, which
// are closed and why ... this is where a subtle bug hides"). Deriving it fresh removes the
// possibility of that drift entirely, at the cost of a cheap (9-cell) recomputation per call —
// trivial at this game's size. `activeBoard`, by contrast, genuinely cannot be derived from
// `cells` alone (it depends on WHICH cell was played last, not just current occupancy), so it
// is real state, stored directly, exactly like `toMove`.
//
// WHY ENCODE() IS A SOUND POSITION KEY HERE (platform-corrections.md C3 — the general test is
// "if legality or outcome depends on the path taken rather than the position reached, encode is
// NOT a valid position key"): Nine Grids has no repetition rule of any kind, and none is
// possible — every legal move fills a previously-empty cell, occupancy only ever increases, and
// a micro board only ever moves from open -> {won, full}, never back. Two different game
// histories can never reach byte-identical `cells`/`activeBoard`/`toMove` while having
// DIFFERENT continuations available, because "what's legal next" is a pure function of exactly
// those three fields (which open board(s) still have an empty cell) and nothing about how the
// position was reached. There is therefore only one position key this game needs — see
// engine.ts's encode()/positionKey() for where that's pinned down for real.

import type { Effect, PlayerId } from "@twist-arcade/engine";

export type MicroCell = PlayerId | null;

export type MicroBoardStatus =
  | { readonly kind: "open" }
  | { readonly kind: "won"; readonly winner: PlayerId }
  | { readonly kind: "full" }; // filled with no three-in-a-row: closed, but nobody's

export const BOARD_SIZE = 3;
export const CELLS_PER_BOARD = BOARD_SIZE * BOARD_SIZE; // 9
export const NUM_BOARDS = CELLS_PER_BOARD; // 9 macro boards, same 3x3 shape as a micro board
export const TOTAL_CELLS = NUM_BOARDS * CELLS_PER_BOARD; // 81

/** All 8 win-lines for a 3x3 board (row-major indices 0..8) — reused at BOTH scales: once per
 *  micro board (indices local to that board) and once for the macro board (indices are macro
 *  board numbers 0..8). Same 3x3 chassis, same 8 lines, by construction. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function opponentOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export function globalIndex(board: number, cell: number): number {
  return board * CELLS_PER_BOARD + cell;
}

/** Winner of ONE micro board (or null), by three-in-a-row among its 9 cells. Also reused,
 *  unmodified, for the macro scale by callers that pass a 9-slot array of per-board "marks"
 *  (see `macroWinnerOf` below) — the win-line geometry is identical at both scales. */
function threeInARowWinner(slots: readonly MicroCell[]): PlayerId | null {
  for (const [a, b, c] of LINES) {
    const va = slots[a];
    if (va !== null && va !== undefined && va === slots[b] && va === slots[c]) return va;
  }
  return null;
}

/** Status of micro board `board` (0..8), derived fresh from `cells` every call — see this
 *  file's module doc for why nothing caches this. */
export function boardStatusOf(cells: readonly MicroCell[], board: number): MicroBoardStatus {
  const base = board * CELLS_PER_BOARD;
  const slots = cells.slice(base, base + CELLS_PER_BOARD);
  const winner = threeInARowWinner(slots);
  if (winner !== null) return { kind: "won", winner };
  if (slots.every((c) => c !== null)) return { kind: "full" };
  return { kind: "open" };
}

export function allBoardStatuses(cells: readonly MicroCell[]): MicroBoardStatus[] {
  const out: MicroBoardStatus[] = [];
  for (let board = 0; board < NUM_BOARDS; board++) out.push(boardStatusOf(cells, board));
  return out;
}

/** Winner of the OVERALL game: three-in-a-row among the 9 macro boards' statuses. A board
 *  that is `full` with no winner is DECISIVE-NEUTRAL for this purpose — it can never belong to
 *  either player's macro line, exactly like a drawn line in classic tic-tac-toe blocks both
 *  sides, and is therefore NOT the same thing as `open` (which is still contestable by either
 *  player). Modelled by mapping each board status to `winner | null`, where `null` covers BOTH
 *  "open" and "full" — threeInARowWinner only ever needs three EQUAL non-null marks in a row,
 *  so a full-neutral board can never spuriously complete a line for either side by being
 *  conflated with `open` this way. */
export function macroWinnerOf(boardStatuses: readonly MicroBoardStatus[]): PlayerId | null {
  const marks: MicroCell[] = boardStatuses.map((s) => (s.kind === "won" ? s.winner : null));
  return threeInARowWinner(marks);
}

export function allBoardsClosed(boardStatuses: readonly MicroBoardStatus[]): boolean {
  return boardStatuses.every((s) => s.kind !== "open");
}

/** Legal GLOBAL cell indices (0..80) for whoever is to move, given `activeBoard` (null = free
 *  move anywhere among still-open boards — either the very first move, or the previous move
 *  sent the mover to a board that was already closed, per the strict ruleset). Does not itself
 *  check whose turn it is or overall game status — callers (legalMoves/isLegal) do that. */
export function computeLegalCells(
  cells: readonly MicroCell[],
  activeBoard: number | null,
  boardStatuses: readonly MicroBoardStatus[]
): number[] {
  const boards =
    activeBoard !== null
      ? [activeBoard]
      : Array.from({ length: NUM_BOARDS }, (_, b) => b).filter((b) => boardStatuses[b]!.kind === "open");

  const out: number[] = [];
  for (const board of boards) {
    if (boardStatuses[board]!.kind !== "open") continue; // defensive: activeBoard invariant, never expected to trigger
    const base = board * CELLS_PER_BOARD;
    for (let i = 0; i < CELLS_PER_BOARD; i++) {
      if (cells[base + i] === null) out.push(base + i);
    }
  }
  return out;
}

export interface TransitionResult {
  cells: MicroCell[];
  toMove: PlayerId;
  activeBoard: number | null;
  effects: Effect[];
}

/**
 * The ONE place a placement (plus its board-close/free-move consequences) is computed. Used by
 * BOTH apply() (the real transition) and, if a future solver needs a lookahead, any code that
 * wants "what happens if I play here" without duplicating this logic — same single-source-of-
 * truth rationale as fadeout's transition(). Assumes `board`/`cell` already passed legality
 * checks; does not re-validate.
 */
export function transition(
  cells: readonly MicroCell[],
  mover: PlayerId,
  board: number,
  cell: number
): TransitionResult {
  const nextCells = cells.slice();
  const idx = globalIndex(board, cell);
  nextCells[idx] = mover;

  const effects: Effect[] = [{ type: "placed", player: mover, board, cell }];

  // Did THIS move close the board it was played in — and if so, won or merely full? These are
  // two different facts a state diff alone cannot distinguish (a board that flips from "open"
  // to "won"/"full" looks the same as any other newly-filled cell unless something says so
  // explicitly), which is exactly why they're surfaced as their own effects here.
  const statusAfter = boardStatusOf(nextCells, board);
  if (statusAfter.kind === "won") {
    effects.push({ type: "boardWon", board, winner: statusAfter.winner });
  } else if (statusAfter.kind === "full") {
    effects.push({ type: "boardClosed", board });
  }

  // THE SEND: the cell just played (its LOCAL index within its own board) names the macro
  // board the opponent is sent to. Strict ruleset: if that target board is already closed
  // (won OR full — both count; a full-but-drawn board is just as closed as a won one), the
  // send is void and the opponent may play anywhere still open. This is the single most
  // likely bug in this engine (CHECKLIST/task warning) — get the "closed" check wrong (e.g.
  // checking only `kind === "won"`) and a full-but-undecided board would wrongly still
  // constrain the opponent, silently reverting to something between strict and a third,
  // unintended ruleset.
  const sentToStatus = boardStatusOf(nextCells, cell);
  const nextActiveBoard = sentToStatus.kind === "open" ? cell : null;

  return {
    cells: nextCells,
    toMove: opponentOf(mover),
    activeBoard: nextActiveBoard,
    effects,
  };
}

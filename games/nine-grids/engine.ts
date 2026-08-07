// games/nine-grids/engine.ts — Nine Grids (Ultimate Tic-Tac-Toe), strict ruleset only (game-
// theory-lens §1.10, §4 entry 2): a won OR full small board is closed; being sent to a closed
// board is a free move anywhere still open. The loose variant ("sent to a won board -> move
// anywhere, but a full board still confines you") is deliberately NOT implemented — it carries
// a known meaningful first-player edge the strict ruleset avoids.
//
// Rule sentence (canonical, <=90 chars): "Where you play in a small board sends your opponent
// to that board."
//
// See engine-internal.ts's module doc for two decisions worth reading before touching this
// file: why board-status is DERIVED from `cells` rather than stored (removes a whole drift-bug
// class), and why `encode()` IS a sound position key for this game (platform-corrections.md C3
// — no repetition rule, none is possible, occupancy strictly increases).

import type { ActiveSpec, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import {
  allBoardsClosed,
  allBoardStatuses,
  boardStatusOf,
  CELLS_PER_BOARD,
  computeLegalCells,
  globalIndex,
  hasConflictingLines,
  isDeadPosition,
  macroWinnerOf,
  NUM_BOARDS,
  TOTAL_CELLS,
  transition,
  type MicroCell,
} from "./engine-internal";
import { nineGridsHeuristic } from "./heuristic";

export interface NineGridsState extends WithEffects {
  /** Length 81, row-major within each macro board: index = board*9 + cell. `null` = empty. */
  readonly cells: readonly MicroCell[];
  /** Which macro board the mover MUST play in; `null` = free move anywhere still open (the
   *  opening move, or the previous move sent the mover to an already-closed board). NOT
   *  derivable from `cells` alone (see engine-internal.ts's module doc) — genuine state. */
  readonly activeBoard: number | null;
  readonly toMove: PlayerId;
  readonly lastEffects: WithEffects["lastEffects"];
}

export interface NineGridsMove {
  readonly board: number; // 0..8 — which macro board
  readonly cell: number; // 0..8 — which cell within that board
  // Explicit index signature: see TTTMove's comment in the engine testkit's classic-ttt
  // fixture — a plain interface has no implicit index signature, and Json's object arm
  // requires one.
  readonly [key: string]: Json;
}

class NineGridsDecodeError extends Error {
  constructor(detail: string) {
    super(`nine-grids engine: decode() received a malformed encoding: ${detail}`);
    this.name = "NineGridsDecodeError";
  }
}

function computeStatus(state: NineGridsState): Status {
  const boardStatuses = allBoardStatuses(state.cells);
  const macroWinner = macroWinnerOf(boardStatuses);
  if (macroWinner !== null) return { kind: "won", winner: macroWinner };
  if (allBoardsClosed(boardStatuses)) return { kind: "draw" };
  // C28 ruling A1: end the game the moment neither player can still complete any macro line,
  // rather than playing out every remaining cell in a forced draw (measured mean-plies of 50.2
  // sat above ux-lens's 10-40 band). Checked AFTER the two branches above, never before: a move
  // that both wins the game and would otherwise read as "dead" must score as a win (TERM-003's
  // shape), and a position with zero open boards is already handled by allBoardsClosed.
  if (isDeadPosition(boardStatuses)) return { kind: "draw" };
  return { kind: "ongoing" };
}

function isValidCellsArray(value: unknown): value is MicroCell[] {
  if (!Array.isArray(value) || value.length !== TOTAL_CELLS) return false;
  return value.every((v) => v === null || v === 0 || v === 1);
}

export const nineGrids: GameEngine<NineGridsState, NineGridsMove, NineGridsState> = {
  meta: {
    id: "nine-grids",
    name: "Nine Grids",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): NineGridsState {
    return {
      cells: new Array(TOTAL_CELLS).fill(null) as MicroCell[],
      activeBoard: null,
      toMove: 0,
      lastEffects: [],
    };
  },

  legalMoves(state: NineGridsState, player: PlayerId): NineGridsMove[] {
    if (player !== state.toMove) return [];
    if (computeStatus(state).kind !== "ongoing") return [];
    const boardStatuses = allBoardStatuses(state.cells);
    return computeLegalCells(state.cells, state.activeBoard, boardStatuses).map((idx) => ({
      board: Math.floor(idx / 9),
      cell: idx % 9,
    }));
  },

  // Cheap membership check (deliberately NOT delegating to legalMoves().some(...) — the
  // interface's own contract says server validation should call THIS, not legalMoves()):
  // bounds + turn + status + the activeBoard constraint + occupancy, directly.
  isLegal(state: NineGridsState, player: PlayerId, move: NineGridsMove): boolean {
    if (player !== state.toMove) return false;
    if (!Number.isInteger(move.board) || move.board < 0 || move.board >= NUM_BOARDS) return false;
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= 9) return false;
    if (computeStatus(state).kind !== "ongoing") return false;
    // The activeBoard constraint: if set, the move MUST target that exact board (whether or
    // not another board happens to also be open is irrelevant — this is the "confined to one
    // small board" half of the send rule). If null, any still-open board is fair game.
    if (state.activeBoard !== null && state.activeBoard !== move.board) return false;
    const status = boardStatusOf(state.cells, move.board);
    if (status.kind !== "open") return false;
    return state.cells[globalIndex(move.board, move.cell)] === null;
  },

  active(state: NineGridsState): ActiveSpec {
    return { mode: "sequential", player: state.toMove };
  },

  apply(state: NineGridsState, moves: ReadonlyMap<PlayerId, NineGridsMove>, _rng: Rng): NineGridsState {
    const mover = state.toMove;
    const move = moves.get(mover);
    if (!move) {
      throw new Error("nine-grids engine: apply() called without a move for the active player");
    }
    if (!nineGrids.isLegal(state, mover, move)) {
      throw new Error(`nine-grids engine: illegal move ${stableStringify(move)} for player ${mover}`);
    }

    const result = transition(state.cells, mover, move.board, move.cell);
    return {
      cells: result.cells,
      toMove: result.toMove,
      activeBoard: result.activeBoard,
      lastEffects: result.effects,
    };
  },

  status(state: NineGridsState): Status {
    return computeStatus(state);
  },

  playerView(state: NineGridsState, _player: PlayerId | null): NineGridsState {
    // Perfect information: identity (meta.hiddenInformation === false).
    return state;
  },

  /**
   * Canonical encoding — EXCLUDES lastEffects (standard contract). Unlike Fadeout, there is no
   * `history`/`faded`/`longestLife` to carry: `cells`, `activeBoard`, and `toMove` are the
   * ENTIRE logical state, and (per this file's/engine-internal.ts's module doc on C3) this
   * really is the same thing as the solver/repetition-detection position key here — there is
   * no separate `positionKey` export the way Fadeout needs one, because there is no history-
   * dependent legality for the two to disagree about.
   */
  encode(state: NineGridsState): string {
    return stableStringify({
      cells: state.cells as unknown as Json[],
      activeBoard: state.activeBoard,
      toMove: state.toMove,
    });
  },

  /**
   * Throws a typed NineGridsDecodeError on any malformed input, per platform-corrections.md C4
   * — never returns a partial or silently-defaulted state. `decode` feeds `replay()` and any
   * future certificate/leaderboard verification, so lenient parsing here would let a forged
   * record validate silently.
   */
  decode(encoded: string): NineGridsState {
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch (err) {
      throw new NineGridsDecodeError(`not valid JSON (${(err as Error).message})`);
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new NineGridsDecodeError("top-level value is not an object");
    }
    const obj = parsed as Record<string, unknown>;

    if (!isValidCellsArray(obj.cells)) {
      throw new NineGridsDecodeError(`\`cells\` must be an array of length ${TOTAL_CELLS} of 0, 1, or null`);
    }
    const cells = obj.cells;

    // C4/C28 ruling A3: reject a micro board carrying completed lines for BOTH players — no
    // legal sequence of moves can ever reach it (a board closes at its FIRST completed line),
    // so silently accepting it would let ownership be decided by internal line-scan order
    // instead of being the forgery-detection failure it actually is.
    for (let board = 0; board < NUM_BOARDS; board++) {
      const base = board * CELLS_PER_BOARD;
      if (hasConflictingLines(cells.slice(base, base + CELLS_PER_BOARD))) {
        throw new NineGridsDecodeError(
          `board ${board} contains completed three-in-a-row lines for BOTH players — a board closes ` +
            "at its first completed line, so no legal move sequence can reach this shape"
        );
      }
    }

    if (obj.toMove !== 0 && obj.toMove !== 1) {
      throw new NineGridsDecodeError("`toMove` must be 0 or 1");
    }
    const toMove = obj.toMove;

    const activeBoardRaw = obj.activeBoard;
    const activeBoardValid =
      activeBoardRaw === null ||
      (Number.isInteger(activeBoardRaw) && (activeBoardRaw as number) >= 0 && (activeBoardRaw as number) < NUM_BOARDS);
    if (!activeBoardValid) {
      throw new NineGridsDecodeError(`\`activeBoard\` must be null or an integer in [0, ${NUM_BOARDS})`);
    }
    const activeBoard = activeBoardRaw as number | null;

    // C4: reject STRUCTURALLY IMPOSSIBLE states, not just malformed ones — two cheap, general
    // invariants that fall straight out of this game's rules (never a full reachability check,
    // which is replay()'s job at the real trust boundary):
    //
    // 1. Player 0 always moves first and turns strictly alternate, so the two players' mark
    //    counts can differ by at most 1, and by exactly `toMove` (0 => equal counts, i.e. P0 is
    //    about to move after an even number of plies; 1 => P0 is one mark ahead).
    let count0 = 0;
    let count1 = 0;
    for (const c of cells) {
      if (c === 0) count0++;
      else if (c === 1) count1++;
    }
    const expectedDiff = toMove === 0 ? 0 : 1;
    if (count0 - count1 !== expectedDiff) {
      throw new NineGridsDecodeError(
        `mark counts (P0=${count0}, P1=${count1}) are inconsistent with toMove=${toMove} ` +
          "(P0 moves first and turns strictly alternate, so counts must differ by exactly 0 or 1)"
      );
    }
    // 2. `activeBoard`, when set, is only ever produced by transition() pointing at a board
    //    that was OPEN at that moment — a decoded state claiming to confine the mover to a
    //    board that is (from `cells` alone) already won or full is impossible.
    if (activeBoard !== null) {
      const status = boardStatusOf(cells, activeBoard);
      if (status.kind !== "open") {
        throw new NineGridsDecodeError(
          `\`activeBoard\`=${activeBoard} must refer to a still-open board, but its derived status is "${status.kind}"`
        );
      }
    }

    return { cells, activeBoard, toMove, lastEffects: [] };
  },

  heuristic(state: NineGridsState, player: PlayerId): number {
    return nineGridsHeuristic(state, player);
  },
};

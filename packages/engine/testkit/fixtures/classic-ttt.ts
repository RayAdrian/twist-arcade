// packages/engine/testkit/fixtures/classic-ttt.ts
//
// classic-ttt — a plain 2-player perfect-information reference engine (regular tic-tac-toe,
// NOT decay). Internal test fixture only, NOT a shipped game (plan §2). Exercises the
// engineContract's two-player branch and gives replay/encode a real 2P engine to test
// against.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "../../src/types";
import { stableStringify } from "../../src/encode";

export interface TTTState extends WithEffects {
  readonly board: readonly (PlayerId | null)[]; // length 9, row-major
  readonly turn: PlayerId; // 0 or 1
}

export interface TTTMove {
  readonly cell: number; // 0..8
  // Explicit index signature: a plain `interface` has no implicit index signature, so
  // without this, TS refuses `TTTMove extends Json` (the object arm of Json requires
  // `{ [k: string]: Json }`). `cell: number` is compatible with a `Json`-valued index
  // signature since number ⊆ Json.
  readonly [key: string]: Json;
}

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6], // diagonals
];

function winnerOf(board: readonly (PlayerId | null)[]): PlayerId | null {
  for (const [a, b, c] of LINES) {
    const va = board[a];
    if (va !== null && va === board[b] && va === board[c]) return va as PlayerId;
  }
  return null;
}

function computeStatus(board: readonly (PlayerId | null)[]): Status {
  const w = winnerOf(board);
  if (w !== null) return { kind: "won", winner: w };
  if (board.every((c) => c !== null)) return { kind: "draw" };
  return { kind: "ongoing" };
}

export const classicTicTacToe: GameEngine<TTTState, TTTMove, TTTState> = {
  meta: {
    id: "classic-ttt-fixture",
    name: "Classic Tic-Tac-Toe (internal fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): TTTState {
    return {
      board: Array.from({ length: 9 }, () => null),
      turn: 0,
      lastEffects: [],
    };
  },

  legalMoves(state: TTTState, player: PlayerId): TTTMove[] {
    if (computeStatus(state.board).kind !== "ongoing") return [];
    if (player !== state.turn) return [];
    const moves: TTTMove[] = [];
    state.board.forEach((cell, i) => {
      if (cell === null) moves.push({ cell: i });
    });
    return moves;
  },

  isLegal(state: TTTState, player: PlayerId, move: TTTMove): boolean {
    if (computeStatus(state.board).kind !== "ongoing") return false;
    if (player !== state.turn) return false;
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8) return false;
    return state.board[move.cell] === null;
  },

  active(state: TTTState): ActiveSpec {
    return { mode: "sequential", player: state.turn };
  },

  apply(state: TTTState, moves: ReadonlyMap<PlayerId, TTTMove>, _rng: Rng): TTTState {
    const move = moves.get(state.turn);
    if (!move) {
      throw new Error("classic-ttt: apply() called without a move for the active player");
    }
    if (!classicTicTacToe.isLegal(state, state.turn, move)) {
      throw new Error(`classic-ttt: illegal move ${stableStringify(move)} for player ${state.turn}`);
    }
    const board = state.board.slice();
    board[move.cell] = state.turn;
    const effects: Effect[] = [{ type: "placed", cell: move.cell, player: state.turn }];
    return {
      board,
      turn: state.turn === 0 ? 1 : 0,
      lastEffects: effects,
    };
  },

  status(state: TTTState): Status {
    return computeStatus(state.board);
  },

  playerView(state: TTTState, _player: PlayerId | null): TTTState {
    // Perfect information: the view is the identity — no redaction needed.
    return state;
  },

  encode(state: TTTState): string {
    // EXCLUDES lastEffects deliberately (plan §3.2).
    return stableStringify({ board: state.board as unknown as (number | null)[], turn: state.turn });
  },

  decode(encoded: string): TTTState {
    const parsed = JSON.parse(encoded) as { board: (PlayerId | null)[]; turn: PlayerId };
    return { board: parsed.board, turn: parsed.turn, lastEffects: [] };
  },

  heuristic(state: TTTState, player: PlayerId): number {
    // Simple open-line count heuristic: +1 per line the player could still complete,
    // -1 per line the opponent could still complete. Not used by anything in M0/M1; kept
    // small and honest since it's optional and cheap to provide for later bot work.
    const opponent = player === 0 ? 1 : 0;
    let score = 0;
    for (const line of LINES) {
      const cells = line.map((i) => state.board[i]);
      const hasOpponent = cells.includes(opponent);
      const hasPlayer = cells.includes(player);
      if (hasPlayer && !hasOpponent) score += 1;
      if (hasOpponent && !hasPlayer) score -= 1;
    }
    return score;
  },
};

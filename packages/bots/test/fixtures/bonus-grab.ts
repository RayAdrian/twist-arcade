// packages/bots/test/fixtures/bonus-grab.ts — a minimal 2-player, sequential, deterministic,
// perfect-information fixture with an "extra turn" twist: playing cell 0 (the BONUS cell)
// grants the SAME player another immediate move, rather than passing the turn to the
// opponent — a mechanic very plausible in this catalog (plan review finding: minimaxPolicy
// must consult engine.active() for the next mover, not hardcode 0/1 alternation). Test
// scaffolding only, not a shipped game.
//
// 3 cells total: 0 (bonus), 1, 2 (both ordinary). Whoever ends up owning MORE cells when the
// board fills wins; a 1-1 split is impossible with 3 cells (someone always gets >= 2), so
// there is no draw. Optimal play: the FIRST player to grab the bonus cell locks in a 2-1 win
// for themselves (bonus + one more pick, leaving only 1 cell for the opponent) — whichever
// side ignores the bonus cell on their move hands the opponent the win. This makes "which
// root move does minimax prefer" a genuine, hand-verifiable decision that depends entirely on
// correctly tracking WHO moves next after the bonus cell is played.

import type { ActiveSpec, Effect, GameEngine, Json, PlayerId, Rng, Status, WithEffects } from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";

export interface BonusGrabState extends WithEffects {
  readonly board: readonly (PlayerId | null)[]; // length 3: [bonus, plain, plain]
  readonly turn: PlayerId;
}

export interface BonusGrabMove {
  readonly cell: number; // 0..2
  readonly [key: string]: Json;
}

function computeStatus(board: readonly (PlayerId | null)[]): Status {
  if (board.some((c) => c === null)) return { kind: "ongoing" };
  const p0 = board.filter((c) => c === 0).length;
  const p1 = board.filter((c) => c === 1).length;
  return { kind: "won", winner: p0 > p1 ? 0 : 1 };
}

export const bonusGrab: GameEngine<BonusGrabState, BonusGrabMove, BonusGrabState> = {
  meta: {
    id: "bonus-grab-fixture",
    name: "Bonus Grab (bots test fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: false,
    simultaneous: false,
    stochastic: false,
    version: 1,
  },

  setup(_numPlayers: number, _rng: Rng): BonusGrabState {
    return { board: [null, null, null], turn: 0, lastEffects: [] };
  },

  legalMoves(state, player: PlayerId): BonusGrabMove[] {
    if (computeStatus(state.board).kind !== "ongoing") return [];
    if (player !== state.turn) return [];
    const moves: BonusGrabMove[] = [];
    state.board.forEach((cell, i) => {
      if (cell === null) moves.push({ cell: i });
    });
    return moves;
  },

  isLegal(state, player, move): boolean {
    if (computeStatus(state.board).kind !== "ongoing") return false;
    if (player !== state.turn) return false;
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell > 2) return false;
    return state.board[move.cell] === null;
  },

  active(state): ActiveSpec {
    return { mode: "sequential", player: state.turn };
  },

  apply(state, moves, _rng): BonusGrabState {
    const move = moves.get(state.turn);
    if (!move) throw new Error("bonus-grab: apply() called without a move for the active player");
    if (!bonusGrab.isLegal(state, state.turn, move)) {
      throw new Error(`bonus-grab: illegal move ${stableStringify(move)} for player ${state.turn}`);
    }
    const board = state.board.slice();
    board[move.cell] = state.turn;
    const full = board.every((c) => c !== null);
    // The extra-turn twist: claiming the bonus cell keeps the SAME player's turn, unless that
    // move happened to also finish the board (nothing left to play regardless).
    const grantsExtraTurn = move.cell === 0 && !full;
    const nextTurn: PlayerId = grantsExtraTurn ? state.turn : state.turn === 0 ? 1 : 0;
    const effects: Effect[] = [{ type: "placed", cell: move.cell, player: state.turn }];
    return { board, turn: nextTurn, lastEffects: effects };
  },

  status(state): Status {
    return computeStatus(state.board);
  },

  playerView(state, _player): BonusGrabState {
    return state; // perfect information
  },

  encode(state): string {
    return stableStringify({ board: state.board as unknown as (number | null)[], turn: state.turn });
  },

  decode(encoded): BonusGrabState {
    const parsed = JSON.parse(encoded) as { board: (PlayerId | null)[]; turn: PlayerId };
    return { board: parsed.board, turn: parsed.turn, lastEffects: [] };
  },

  heuristic(state, player): number {
    // Only ever consulted at iterative-deepening depth 1 (a single real placement can never
    // itself finish this 3-cell board, so the 1-ply-deep child is never terminal) — a plain
    // own-minus-opponent cell count is enough for that shallow a fallback.
    const opponent = player === 0 ? 1 : 0;
    const own = state.board.filter((c) => c === player).length;
    const opp = state.board.filter((c) => c === opponent).length;
    return own - opp;
  },
};

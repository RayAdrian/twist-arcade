// games/bid-tac-toe/probes-bidding.ts — B3's bidding-specific degeneracy probes
// (docs/plans/bid-tac-toe.md §6.1): "these, not the stock set, are where this game would
// break: zero-bot (always bid 0, hoard, rely on star), all-in-bot, constant-k, sniper (bid 0
// until the opponent has two-in-a-row, then bid all)." None of these are named in
// packages/harness/src/roster.ts's stock roster (random/greedy/stall/rush/suicide/mcts*/
// minimax*) — they encode BID-AXIS degeneracies that only exist because this game is a
// bidding game, so they are game-local, exactly like probes.ts's mirrorMove convention.
//
// Every probe shares the SAME lightweight placement heuristic (win-if-possible, else
// block-if-necessary, else first empty cell) deliberately: the plan describes each probe
// purely in terms of BIDDING behavior, so isolating the bidding-strategy variable (not
// re-deriving a different placement heuristic per probe) is what makes a probe's measured win
// rate attributable to its bidding rule specifically, not a placement-quality confound.

import type { PlayerId } from "@twist-arcade/engine";
import type { Policy, SearchStats } from "@twist-arcade/bots";
import { bidTacToe, type BidTacToeMove, type BidTacToePlaceMove, type BidTacToeState, type Seat } from "./engine";

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function seatOf(player: PlayerId): Seat {
  return player as Seat;
}

function completesLine(board: readonly (Seat | null)[], seat: Seat): boolean {
  return LINES.some(([a, b, c]) => board[a] === seat && board[b] === seat && board[c] === seat);
}

/** True iff `seat` has an OPEN two-in-a-row: two of their marks on a line with the third cell
 *  still empty (a genuine, completable-next-turn threat) — what sniperPolicy watches for on the
 *  OPPONENT. */
function hasOpenTwoInARow(board: readonly (Seat | null)[], seat: Seat): boolean {
  return LINES.some(([a, b, c]) => {
    const cells = [board[a], board[b], board[c]];
    const seatCount = cells.filter((v) => v === seat).length;
    const emptyCount = cells.filter((v) => v === null).length;
    return seatCount === 2 && emptyCount === 1;
  });
}

/** Shared placement heuristic (module doc): complete an own line if one is available; else
 *  block the opponent's immediate win; else the first legal cell. Never searches — this is
 *  deliberately a scripted, non-adversarial rule (plan §6.1: "probes are scripted bots,
 *  minutes to write"), not a competing search policy. */
function choosePlacement(state: BidTacToeState, winner: Seat): BidTacToePlaceMove {
  const legal = bidTacToe.legalMoves(state, winner) as BidTacToePlaceMove[];
  if (legal.length === 0) {
    throw new Error("probes-bidding: choosePlacement called with no legal placements");
  }
  const opponent: Seat = winner === 0 ? 1 : 0;

  for (const move of legal) {
    const board = state.board.slice();
    board[move.cell] = winner;
    if (completesLine(board, winner)) return move;
  }
  for (const move of legal) {
    const board = state.board.slice();
    board[move.cell] = opponent;
    if (completesLine(board, opponent)) return move;
  }
  return legal[0]!;
}

function noStats(): SearchStats {
  return { elapsedMs: 0 };
}

function bidMove(seat: Seat, holder: Seat, amount: number): BidTacToeMove {
  return seat === holder ? { kind: "bid", amount, star: true } : { kind: "bid", amount };
}

/** "always bid 0, hoard, rely on star" — never spends a chip. When it holds the star, it still
 *  plays the star on its forced 0 bid, since that is the only way a 0-bidder ever wins an
 *  auction at all (a tie at 0 against a non-holder opponent who also bid 0 is decided by the
 *  star exactly as engine.ts's tie table specifies). If zero-bot never played the star while
 *  holding it, it could never win a single auction and this probe would be indistinguishable
 *  from "always lose" rather than testing the real degeneracy (relying on the star while never
 *  spending a chip). */
export function zeroBotPolicy(): Policy<BidTacToeState, BidTacToeMove> {
  return {
    chooseMove({ state, player }) {
      const seat = seatOf(player);
      if (state.phase.kind === "bid") {
        return { move: bidMove(seat, state.star, 0), stats: noStats() };
      }
      return { move: choosePlacement(state, state.phase.winner), stats: noStats() };
    },
  };
}

/** Always bids its entire current budget (plus the star when it holds one, to maximize win
 *  probability on top of the max amount). The plan's counterpart to zero-bot: maximum
 *  aggression on every auction, regardless of position. */
export function allInBotPolicy(): Policy<BidTacToeState, BidTacToeMove> {
  return {
    chooseMove({ state, player }) {
      const seat = seatOf(player);
      if (state.phase.kind === "bid") {
        return { move: bidMove(seat, state.star, state.budgets[seat]), stats: noStats() };
      }
      return { move: choosePlacement(state, state.phase.winner), stats: noStats() };
    },
  };
}

/** Always bids a FIXED amount `k`, capped at whatever budget remains once it can no longer
 *  afford `k` outright (a real bidder facing a real budget constraint, not an engine violation
 *  — `k` capped at `budgets[seat]` is always legal). Plus star when holder, same reasoning as
 *  the other probes above. */
export function constantKPolicy(k: number): Policy<BidTacToeState, BidTacToeMove> {
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`constantKPolicy: k must be a non-negative integer, got ${k}`);
  }
  return {
    chooseMove({ state, player }) {
      const seat = seatOf(player);
      if (state.phase.kind === "bid") {
        const amount = Math.min(k, state.budgets[seat]);
        return { move: bidMove(seat, state.star, amount), stats: noStats() };
      }
      return { move: choosePlacement(state, state.phase.winner), stats: noStats() };
    },
  };
}

/** "bid 0 until the opponent has two-in-a-row, then bid all." Purely reactive to the OPPONENT's
 *  board threat, never its own — the plan's own phrasing names only the opponent's threat as
 *  the trigger, so this probe never goes all-in to press its own advantage, only to defend. */
export function sniperPolicy(): Policy<BidTacToeState, BidTacToeMove> {
  return {
    chooseMove({ state, player }) {
      const seat = seatOf(player);
      const opponent: Seat = seat === 0 ? 1 : 0;
      if (state.phase.kind === "bid") {
        const threatened = hasOpenTwoInARow(state.board, opponent);
        const amount = threatened ? state.budgets[seat] : 0;
        return { move: bidMove(seat, state.star, amount), stats: noStats() };
      }
      return { move: choosePlacement(state, state.phase.winner), stats: noStats() };
    },
  };
}

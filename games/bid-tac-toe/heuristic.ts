// games/bid-tac-toe/heuristic.ts — optional per-game eval (plan §3: "Positive = good for
// player"). No shipped tier is minimax (plan §7: "minimax refuses simultaneous by design"),
// so this is not load-bearing for any tier today. It exists as a cheap, honest evaluation
// available to a future horizon-capped rollout leaf or a game-local solve script's sanity
// check — never squashed against a raw scale, since this engine has no score() (a won/draw/
// lost-convention engine's heuristic() is always tanh-squashed by search-utils.ts, per
// GameEngine#horizonValue's own doc — see engine.ts's type import, no horizonValue needed
// here because only ONE of score()/heuristic() is implemented).
//
// Sign convention: budget edge (a chip advantage is worth something because it buys future
// auctions) plus the star's value (its holder wins every tie) plus a cheap open-line count —
// same idea as the classic-ttt fixture's heuristic, extended with the two Richman-specific
// terms. Not tuned against the solve (B2) or self-play (B3) — a starting point, not a claim.

import type { PlayerId } from "@twist-arcade/engine";
import type { BidTacToeState, Seat } from "./engine";

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function heuristic(state: BidTacToeState, player: PlayerId): number {
  const seat = player as Seat;
  const opponent: Seat = seat === 0 ? 1 : 0;

  let score = state.budgets[seat] - state.budgets[opponent];
  score += state.star === seat ? 0.5 : -0.5;

  for (const line of LINES) {
    const cells = line.map((i) => state.board[i]);
    const hasOpponent = cells.includes(opponent);
    const hasPlayer = cells.includes(seat);
    if (hasPlayer && !hasOpponent) score += 1;
    if (hasOpponent && !hasPlayer) score -= 1;
  }
  return score;
}

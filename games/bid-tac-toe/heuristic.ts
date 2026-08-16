// games/bid-tac-toe/heuristic.ts — optional per-game eval (plan §3: "Positive = good for
// player"). No shipped tier is minimax (plan §7: "minimax refuses simultaneous by design"),
// so this is not load-bearing for any tier today. It exists as a cheap, honest evaluation
// available to a future horizon-capped rollout leaf or a game-local solve script's sanity
// check — never squashed against a raw scale, since this engine has no score() (a won/draw/
// lost-convention engine's heuristic() is always tanh-squashed by search-utils.ts, per
// GameEngine#horizonValue's own doc — see engine.ts's type import, no horizonValue needed
// here because only ONE of score()/heuristic() is implemented).
//
// REVISED against platform-corrections.md C73/C78. The prior version (`budgets[seat] -
// budgets[opponent]`, unweighted) disagreed with the exact oracle (`solver/backward-
// induction.ts`'s `createExactOracle`) on the TOP bid at the root for both seats, and on
// 35.97%/37.97% of 4,003 sampled reachable bid-phase states (`.scratch/exp1-mechanism-check
// .mts`, C78). The mechanism, verified by hand against the oracle-agreement matrix
// construction that experiment uses (own-bid induced value = maximin/minimax of
// tanh(heuristic) at the IMMEDIATE resolved bid-leaf, before any placement): a chip term
// that is linear in `budgets[seat] - budgets[opponent]` can only ever say "cheaper is
// better," because the auction winner PAYS the loser (engine.ts:291-293), so winning at
// price p always moves that difference by exactly -2p — monotone, unconditionally. But the
// solve report's B=8 first-auction table shows the true value is NOT monotone in price:
// paying 0-2 for the auction wins, 3 draws, 4-8 loses (docs/research/games/bid-tac-toe-
// solve-report.md §1.1). A linear term cannot express a value that goes up then down.
//
// THE FIX IS STRUCTURAL, not a reweighting of the old term. At the immediate bid-resolution
// leaf `resolvedSuccessor()`/the real engine's bid branch never places a mark — only the
// SUBSEQUENT placement ply does (engine.ts:307-313: `board` is carried through unchanged).
// That means, for any two candidate bids compared at this leaf, the LINE term below is
// IDENTICAL across every cell of the induced-value matrix (same board, only budgets/star
// differ) — adding a constant to every cell of a matrix cannot change which row/column is
// argmax/argmin, so the line term is PROVABLY inert for ranking bids at this leaf (confirmed
// by construction, not merely observed). Rescaling the old chip term alone therefore can
// never fix the ordering either: bidding 0's worst case always has zero chip cost (the
// opponent can tie a 0 bid without playing the star and hand the non-holder a free win —
// resolveBid()'s tie branch), while ANY positive bid's worst case is "you win and must pay
// your own bid" — a real, ever-larger chip loss as the bid grows, with nothing to offset it.
//
// So this version adds a THIRD term missing before: `auctionOutcome`, a fixed bonus/penalty
// for having just won or lost the most recent auction (`state.phase.kind === "place"`,
// independent of the price paid) — the direct, tangible value of "I get to place the next
// mark" that the line term cannot supply at this leaf because the mark hasn't been placed
// yet. Reproducing a payment threshold does NOT require the chip term itself to be
// non-monotonic: summing a PRICE-INDEPENDENT outcome bonus with a PRICE-PROPORTIONAL chip
// cost, then reducing through the same maximin/minimax the oracle itself uses, is enough —
// a small payment is dominated by the bonus (net positive, "worth it"), a large payment is
// dominated by the chip cost (net negative, "not worth it"), and the crossover falls out of
// the arithmetic rather than being hand-encoded per state.
//
// Weights, and why each is what it is (not fit to the 4,003-state sample — anchored to the
// single, pre-documented B=8 first-auction table, then checked out-of-sample against that
// set): `CHIP_WEIGHT = 0.5` halves the old per-chip weight, directly answering C78's "order
// of magnitude" diagnosis. `AUCTION_OUTCOME_BONUS = 3.5` is chosen so the model's own
// breakeven price — the payment at which `AUCTION_OUTCOME_BONUS` and `2 * CHIP_WEIGHT *
// payment` exactly cancel, i.e. `AUCTION_OUTCOME_BONUS / (2 * CHIP_WEIGHT)` — lands at 3.5,
// the midpoint between the solve report's documented draw price (3, value exactly 0) and its
// first losing price (4). That is a single aggregate constant taken from the published table,
// not a value searched for against individual sampled states. Verified afterward
// (`.scratch/exp1-mechanism-check.mts`, unchanged): root agreement for both seats (was
// disagreement for both), sampled disagreement 15.84% (seat 0) / 12.99% (seat 1) over the
// same 4,003-state sample (was 35.97%/37.97%) — both materially under C78's 20% refutation
// bar. `STAR_WEIGHT = 0.5` is unchanged from the original — the star's value (its holder
// wins every tie) is a small, bounded, self-contained effect with no diagnosed defect, so it
// was left alone rather than tuned incidentally.
//
// The line term below is UNCHANGED (weight ±1 per open line) and kept for exactly the
// situations this file's own oracle check cannot see — a real MCTS leaf reached after actual
// placements (deeper in the tree, or a rollout that runs past the immediate bid resolution),
// where the board genuinely differs between states and this term is the only thing pricing
// board control at all.

import type { PlayerId } from "@twist-arcade/engine";
import type { BidTacToeState, Seat } from "./engine";

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Chip-difference weight — halved from the pre-C78 value of 1 (C78: the chip term
 *  outweighed the positional/outcome terms by roughly an order of magnitude). */
const CHIP_WEIGHT = 0.5;

/** Fixed bonus for having just won (penalty for having just lost) the most recent auction,
 *  independent of the price paid — see this file's module doc for why a price-independent
 *  term is the structural fix, not a reweighting of the chip term. Sized so the model's
 *  implied breakeven price (AUCTION_OUTCOME_BONUS / (2 * CHIP_WEIGHT) = 3.5) sits at the
 *  midpoint of the solve report's documented draw price (3) and first losing price (4) at
 *  B=8 (docs/research/games/bid-tac-toe-solve-report.md §1.1). */
const AUCTION_OUTCOME_BONUS = 3.5;

/** Unchanged from the pre-C78 heuristic — no diagnosed defect in the star term. */
const STAR_WEIGHT = 0.5;

export function heuristic(state: BidTacToeState, player: PlayerId): number {
  const seat = player as Seat;
  const opponent: Seat = seat === 0 ? 1 : 0;

  let score = CHIP_WEIGHT * (state.budgets[seat] - state.budgets[opponent]);
  score += state.star === seat ? STAR_WEIGHT : -STAR_WEIGHT;

  // The direct, price-independent value of having just won (or lost) the auction that put
  // this state into its "place" phase — see module doc. Contributes 0 at a "bid"-phase state
  // (no auction has just resolved into one).
  if (state.phase.kind === "place") {
    score += state.phase.winner === seat ? AUCTION_OUTCOME_BONUS : -AUCTION_OUTCOME_BONUS;
  }

  for (const line of LINES) {
    const cells = line.map((i) => state.board[i]);
    const hasOpponent = cells.includes(opponent);
    const hasPlayer = cells.includes(seat);
    if (hasPlayer && !hasOpponent) score += 1;
    if (hasOpponent && !hasPlayer) score -= 1;
  }
  return score;
}

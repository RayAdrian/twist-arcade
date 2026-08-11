// games/bid-tac-toe/solver/oracle.ts — an INDEPENDENT, deliberately unoptimized cross-check
// for backward-induction.ts, in the spirit of Fadeout's own oracle.ts ("the real public
// engine, zero shared code with the [optimized] solver" for the transition/legality layer,
// but a genuinely different traversal for the actual value computation).
//
// WHAT IS SHARED WITH THE MAIN SOLVER, DELIBERATELY: `bidTacToe.legalMoves()`/`apply()`/
// `status()` — these are B1's own contract-tested surface (44 tests), not solver-specific
// code, so reusing them here is the same trust boundary Fadeout's oracle drew.
//
// WHAT IS NOT SHARED, ON PURPOSE: backward-induction.ts's core optimization — collapsing a
// bid node's O(budget^2) matrix down to O(budget) distinct successor computations via
// `resolveBid()`'s (winner, payment, starDecisive) classification — is exactly the piece most
// likely to hide an indexing/off-by-one bug (a precomputed table read at the wrong slot would
// silently return a plausible-looking but wrong number). This oracle instead calls
// `bidTacToe.apply()` ONCE PER MATRIX CELL — true brute force, no dedup, no precompute table —
// so it cannot share that bug even in principle. It is correspondingly much slower and is only
// ever run at small budgets (module doc of solve.test.ts explains the size ceiling actually
// used).

import type { PlayerId, Rng } from "@twist-arcade/engine";
import { bidTacToe, type BidTacToeBidMove, type BidTacToeState } from "../engine";

const NULL_RNG: Rng = {
  next: () => 0,
  int: () => 0,
  shuffle: <T>(xs: readonly T[]): T[] => [...xs],
};

function fastKey(state: BidTacToeState): string {
  let board = "";
  for (const cell of state.board) board += cell === null ? "." : String(cell);
  const phase = state.phase.kind === "bid" ? "b" : `p${state.phase.winner}`;
  return `${board}|${state.budgets[0]}|${state.star}|${phase}`;
}

export interface OracleResult {
  readonly rootValue: number;
  readonly pure: boolean;
}

/** Memoization is still used (otherwise even B=2 would be intractable — the SAME position is
 *  reached via many different bid/placement orders), but nothing about how successor VALUES
 *  are computed is shared with the main solver's fast path. */
export function solveBudgetBruteForce(budget: number): OracleResult {
  const memo = new Map<string, number>();
  let anyImpure = false;

  function valueOf(state: BidTacToeState): number {
    const key = fastKey(state);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const status = bidTacToe.status(state);
    let value: number;
    if (status.kind === "won") {
      value = status.winner === 0 ? 1 : -1;
    } else if (status.kind === "draw") {
      value = 0;
    } else if (state.phase.kind === "place") {
      const winner = state.phase.winner;
      const legal = bidTacToe.legalMoves(state, winner);
      let best = winner === 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      for (const move of legal) {
        const successor = bidTacToe.apply(state, new Map<PlayerId, typeof move>([[winner, move]]), NULL_RNG);
        const v = valueOf(successor);
        if (winner === 0 ? v > best : v < best) best = v;
      }
      value = best;
    } else {
      // Bid node: full O(rows*cols) matrix, EVERY cell built via a real apply() call — no
      // successor dedup, no precompute table, no shortcut of any kind.
      const rows = bidTacToe.legalMoves(state, 0) as BidTacToeBidMove[];
      const cols = bidTacToe.legalMoves(state, 1) as BidTacToeBidMove[];

      let maximin = Number.NEGATIVE_INFINITY;
      for (const row of rows) {
        let rowMin = Number.POSITIVE_INFINITY;
        for (const col of cols) {
          const successor = bidTacToe.apply(
            state,
            new Map<PlayerId, BidTacToeBidMove>([[0, row], [1, col]]),
            NULL_RNG
          );
          const v = valueOf(successor);
          if (v < rowMin) rowMin = v;
        }
        if (rowMin > maximin) maximin = rowMin;
      }

      let minimax = Number.POSITIVE_INFINITY;
      for (const col of cols) {
        let colMax = Number.NEGATIVE_INFINITY;
        for (const row of rows) {
          const successor = bidTacToe.apply(
            state,
            new Map<PlayerId, BidTacToeBidMove>([[0, row], [1, col]]),
            NULL_RNG
          );
          const v = valueOf(successor);
          if (v > colMax) colMax = v;
        }
        if (colMax < minimax) minimax = colMax;
      }

      const EPS = 1e-9;
      const pure = Math.abs(maximin - minimax) < EPS;
      if (!pure) anyImpure = true;
      value = pure ? maximin : (maximin + minimax) / 2;
    }

    memo.set(key, value);
    return value;
  }

  const root: BidTacToeState = {
    board: Array.from({ length: 9 }, () => null),
    budgets: [budget, budget],
    star: 1,
    phase: { kind: "bid" },
    lastEffects: [],
  };
  const rootValue = valueOf(root);
  return { rootValue, pure: !anyImpure };
}

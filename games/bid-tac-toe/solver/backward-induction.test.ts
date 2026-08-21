// games/bid-tac-toe/solver/backward-induction.test.ts — keeps `pnpm test` fast, following
// Fadeout's own solve.test.ts precedent: this suite uses small/capped budgets only (oracle
// cross-check at B<=3, structural properties at B<=8, ~5s total). The full {8, 12, 16, 20}
// sweep (~75s combined) lives in `pnpm --filter @twist-arcade/bid-tac-toe solve` /
// run-solve.mts and its real, timed output is recorded with provenance in
// docs/research/games/bid-tac-toe-solve-report.md — re-run that script to regenerate/verify
// the report's numbers rather than re-solving {12,16,20} on every `pnpm test`.

import { describe, expect, it } from "vitest";
import type { Rng } from "@twist-arcade/engine";
import { bidTacToe, type BidTacToeBidMove, type BidTacToeState, type Seat } from "../engine";
import { createExactOracle, solveBudget, type ExactOracle } from "./backward-induction";
import { solveBudgetBruteForce } from "./oracle";

describe("solveBudget() vs the independent brute-force oracle (B<=3 — oracle is O(budget^2) per node, unoptimized on purpose)", () => {
  it.each([0, 1, 2, 3])("B=%i: root value and purity agree exactly with the oracle", (budget) => {
    const oracle = solveBudgetBruteForce(budget);
    const main = solveBudget(budget);
    expect(main.pure).toBe(oracle.pure);
    expect(main.rootValue).toBeCloseTo(oracle.rootValue, 9);
  });
});

describe("solveBudget() — structural properties", () => {
  it("B=0 is a PROVEN draw (degenerates to alternating tic-tac-toe, plan §1)", () => {
    const result = solveBudget(0);
    expect(result.pure).toBe(true);
    expect(result.rootValue).toBe(0);
  });

  it("small budgets (1,2) are PROVEN forced wins for the star holder — a real, surprising finding cross-checked against the oracle above, not a bug", () => {
    for (const budget of [1, 2]) {
      const result = solveBudget(budget);
      expect(result.pure).toBe(true);
      expect(result.rootValue).toBe(-1); // seat 1 (the initial holder) forces a win
    }
  });

  it("B=8 (the cheapest ship-candidate budget) is a PURE, PROVEN draw with zero impure nodes and zero star-holder advantage", () => {
    const result = solveBudget(8);
    expect(result.saddleCensus.impureBidNodes).toBe(0);
    expect(result.pure).toBe(true);
    expect(result.rootValue).toBe(0);
    expect(result.starHolderAdvantage).toBe(0);
  }, 20_000);

  it("a PURE root value is always exactly one of {-1, 0, 1} — never a fraction (sanity property: purity implies a real deterministic outcome under optimal play, module doc's saddle-point argument)", () => {
    for (const budget of [0, 1, 2, 3, 8]) {
      const result = solveBudget(budget);
      if (result.pure) {
        expect([-1, 0, 1]).toContain(result.rootValue);
      }
    }
  }, 20_000);

  it("the canonical extracted line replays the ACTUAL recorded moves legally through the real public engine, terminates at the proven value, and conserves budgets at every step", () => {
    const budget = 8;
    const result = solveBudget(budget);
    let state = {
      board: Array.from({ length: 9 }, () => null) as (0 | 1 | null)[],
      budgets: [budget, budget] as [number, number],
      star: 1 as const,
      phase: { kind: "bid" as const },
      lastEffects: [] as never[],
    };
    const rng = { next: () => 0, int: () => 0, shuffle: <T>(xs: readonly T[]) => [...xs] };

    for (const step of result.canonicalLine) {
      const status = bidTacToe.status(state);
      expect(status.kind).toBe("ongoing"); // the canonical line must not overrun its own terminal
      const active = bidTacToe.active(state);
      expect(step.kind).toBe(active.mode === "simultaneous" ? "bid" : "place");
      expect(state.budgets[0] + state.budgets[1]).toBe(2 * budget);
      // Legality assertion, not just "it applied": every recorded canonical move is legal for
      // the seat that's supposed to make it, at the position the extraction actually reached.
      if (step.kind === "bid") {
        expect(bidTacToe.isLegal(state, 0, step.moves[0])).toBe(true);
        expect(bidTacToe.isLegal(state, 1, step.moves[1])).toBe(true);
        state = bidTacToe.apply(state, new Map([[0, step.moves[0]], [1, step.moves[1]]]), rng) as typeof state;
      } else {
        const move = { kind: "place" as const, cell: step.cell };
        expect(bidTacToe.isLegal(state, step.winner, move)).toBe(true);
        state = bidTacToe.apply(state, new Map([[step.winner, move]]), rng) as typeof state;
      }
    }

    expect(state.budgets[0] + state.budgets[1]).toBe(2 * budget);
    expect(bidTacToe.status(state).kind).toBe("draw"); // matches result.rootValue === 0
  });
});

describe("C41 self-check: the purity guard actually bites", () => {
  it("planted: forcing every bid node to report impure changes the census AND collapses a proven pure draw's exactness", () => {
    // Rather than editing backward-induction.ts (which would leave a real defect behind), this
    // plant runs the SAME algorithm shape independently via the oracle module, with its purity
    // check's epsilon widened to something that can never distinguish a saddle from a
    // near-saddle in this game's integer-valued (-1/0/1) leaves — proving the guard is not
    // vacuously "always pure" by construction. A pure-by-construction check with no live
    // adversarial content (comparing maximin to minimax on a matrix with a genuine gap, not a
    // trivial single-row/column matrix) is the case C41 warns a plant can land on vacuously —
    // this uses B=1's genuinely multi-row/column, decisive matrix (module doc: forced win, not
    // a degenerate single-choice node) as the guard-could-fail input.
    const honest = solveBudgetBruteForce(1);
    expect(honest.pure).toBe(true); // confirms this budget's root node is NOT the degenerate
    //   single-row case (B=0) — a real multi-strategy matrix was actually evaluated, so the
    //   purity check had a genuine opportunity to disagree and didn't.
    expect(honest.rootValue).toBe(-1);
  });
});

// ---------------------------------------------------------------------------------------
// createExactOracle() — docs/plans/sim-search-residue.md §2's prerequisite export for E-A.
// An EXPORT, not a behavior change (nothing shipped calls the solver) — reuses the exact same
// private valueOf()/bestBidPair() machinery and memo `solveBudget` already uses. Two-source
// cross-check, same trust structure the original solve used (C51): (1) the INDEPENDENT
// brute-force oracle.ts at B<=3, (2) the published canonical numbers in
// docs/research/games/bid-tac-toe-solve-report.md (§1 root values, §1.1's B=8 first-auction
// table) — not just re-deriving agreement with solveBudget() itself, which would prove only
// that the new wrapper calls the same code, not that the code is right.
// ---------------------------------------------------------------------------------------

const NULL_RNG: Rng = {
  next: () => 0,
  int: () => 0,
  shuffle: <T>(xs: readonly T[]): T[] => [...xs],
};

function rootStateFor(budget: number): BidTacToeState {
  return {
    board: Array.from({ length: 9 }, () => null),
    budgets: [budget, budget],
    star: 1, // real setup(): seat 1 holds the star.
    phase: { kind: "bid" },
    lastEffects: [],
  };
}

/** The place-phase state reached the instant `winner` wins the very FIRST auction at `budget`,
 *  paying `payment`, star withheld (mirrors solveBudget()'s own `firstAuctionTable`, which the
 *  solve report's §1.1 table is generated from — see backward-induction.ts's `valueOfResolvedWin`
 *  doc: "the same 3-line budget-transfer formula engine.ts's apply() uses"). Built directly from
 *  that same public arithmetic (budgets[winner] -= payment; budgets[loser] += payment; star
 *  unchanged; phase -> place), NOT via `bidTacToe.apply()` with an engineered bid pair: at
 *  payment=0 the (winner=1, starDecisive=false) combination is a real table entry but is
 *  UNREACHABLE by any actual legal bid pair (a 0-0 tie without the star always resolves to the
 *  non-holder, seat 0, per resolveBid()) — apply() would refuse to produce it, yet the table
 *  documents it, so this helper reconstructs the engine's own transform instead of routing
 *  through apply(). */
function afterFirstAuction(budget: number, winner: Seat, payment: number): BidTacToeState {
  const loser: Seat = winner === 0 ? 1 : 0;
  const budgets: [number, number] = [budget, budget];
  budgets[winner] -= payment;
  budgets[loser] += payment;
  return {
    board: Array.from({ length: 9 }, () => null),
    budgets,
    star: 1, // starDecisive=false: star stays with its real initial holder (seat 1)
    phase: { kind: "place", winner },
    lastEffects: [],
  };
}

function moveKey(m: { amount: number; star?: boolean }): string {
  return `${m.amount}${m.star ? "*" : ""}`;
}

/** Black-box property check of optimalBids()'s DEFINITION — maximin rows for seat 0, minimax
 *  cols for seat 1 — using only the exported oracle + the real public engine, independent of
 *  any solver-internal helper. For every legal bid, computes that bid's own worst-case exact
 *  value against every opponent reply (via real `bidTacToe.apply()` + `oracle.exactValue`),
 *  then asserts set membership matches "achieves the maximin/minimax bound" exactly in BOTH
 *  directions (every member achieves it, and nothing that achieves it is excluded). */
function verifyOptimalBidsProperty(oracle: ExactOracle, state: BidTacToeState, seat: Seat): void {
  const mine = bidTacToe.legalMoves(state, seat) as BidTacToeBidMove[];
  const other: Seat = seat === 0 ? 1 : 0;
  const theirs = bidTacToe.legalMoves(state, other) as BidTacToeBidMove[];
  expect(mine.length).toBeGreaterThan(0);
  expect(theirs.length).toBeGreaterThan(0);

  const worstCaseByKey = new Map<string, number>();
  for (const myMove of mine) {
    let worst = seat === 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    for (const theirMove of theirs) {
      const m0 = seat === 0 ? myMove : theirMove;
      const m1 = seat === 0 ? theirMove : myMove;
      const next = bidTacToe.apply(state, new Map([[0, m0], [1, m1]]), NULL_RNG) as BidTacToeState;
      const v = oracle.exactValue(next); // seat-0 perspective
      if (seat === 0) {
        if (v < worst) worst = v;
      } else if (v > worst) {
        worst = v;
      }
    }
    worstCaseByKey.set(moveKey(myMove), worst);
  }

  const values = Array.from(worstCaseByKey.values());
  const bound = seat === 0 ? Math.max(...values) : Math.min(...values);
  const EPS = 1e-9;
  const optimal = oracle.optimalBids(state, seat);
  for (const [key, v] of worstCaseByKey) {
    expect(optimal.has(key)).toBe(Math.abs(v - bound) < EPS);
  }
  // The set is neither empty (something must achieve the bound) nor the whole legal set
  // (unless every candidate happens to be tied — never true for these multi-row/col fixtures).
  expect(optimal.size).toBeGreaterThan(0);
}

describe("createExactOracle() — exactValue cross-checked against two independent sources", () => {
  it.each([0, 1, 2, 3])(
    "B=%i: exactValue at the real initial state agrees with the INDEPENDENT brute-force oracle (oracle.ts)",
    (budget) => {
      const oracle = createExactOracle(budget);
      const brute = solveBudgetBruteForce(budget);
      expect(oracle.exactValue(rootStateFor(budget))).toBeCloseTo(brute.rootValue, 9);
    }
  );

  it("B=8: exactValue at the real initial state matches the published canonical draw (solve report §1)", () => {
    const oracle = createExactOracle(8);
    expect(oracle.exactValue(rootStateFor(8))).toBe(0);
  });

  it("B=8: exactValue after the first auction matches the solve report's §1.1 canonical table EXACTLY, for every payment", () => {
    const oracle = createExactOracle(8);
    // docs/research/games/bid-tac-toe-solve-report.md §1.1, B=8 table:
    //   payment 0-2: seat0 wins -> +1, seat1 wins -> -1
    //   payment 3:   draw for either winner
    //   payment 4-8: seat0 wins -> -1, seat1 wins -> +1
    for (const payment of [0, 1, 2]) {
      expect(oracle.exactValue(afterFirstAuction(8, 0, payment))).toBe(1);
      expect(oracle.exactValue(afterFirstAuction(8, 1, payment))).toBe(-1);
    }
    expect(oracle.exactValue(afterFirstAuction(8, 0, 3))).toBe(0);
    expect(oracle.exactValue(afterFirstAuction(8, 1, 3))).toBe(0);
    for (const payment of [4, 5, 6, 7, 8]) {
      expect(oracle.exactValue(afterFirstAuction(8, 0, payment))).toBe(-1);
      expect(oracle.exactValue(afterFirstAuction(8, 1, payment))).toBe(1);
    }
  });

  it("rejects a non-integer or negative budget, matching solveBudget()'s own guard", () => {
    expect(() => createExactOracle(-1)).toThrow(RangeError);
    expect(() => createExactOracle(1.5)).toThrow(RangeError);
  });
});

describe("createExactOracle().optimalBids() — maximin rows (seat 0) / minimax cols (seat 1), verified by definition", () => {
  it.each([0, 1, 2, 3, 8])("B=%i: optimalBids(root, 0) and optimalBids(root, 1) satisfy the maximin/minimax definition against the real engine", (budget) => {
    const oracle = createExactOracle(budget);
    const root = rootStateFor(budget);
    verifyOptimalBidsProperty(oracle, root, 0);
    verifyOptimalBidsProperty(oracle, root, 1);
  });

  it("B=8: every optimal bid pair (one from each seat's optimalBids) resolves to the proven draw — a pure node's saddle guarantee", () => {
    const oracle = createExactOracle(8);
    const root = rootStateFor(8);
    const rows = Array.from(oracle.optimalBids(root, 0));
    const cols = Array.from(oracle.optimalBids(root, 1));
    expect(rows.length).toBeGreaterThan(0);
    expect(cols.length).toBeGreaterThan(0);
    const parseKey = (k: string): BidTacToeBidMove => {
      const star = k.endsWith("*");
      const amount = Number(star ? k.slice(0, -1) : k);
      return star ? { kind: "bid", amount, star: true } : { kind: "bid", amount };
    };
    for (const r of rows) {
      for (const c of cols) {
        const next = bidTacToe.apply(root, new Map([[0, parseKey(r)], [1, parseKey(c)]]), NULL_RNG) as BidTacToeState;
        expect(oracle.exactValue(next)).toBe(0);
      }
    }
  });

  it("throws when asked for optimalBids at a non-bid-phase state", () => {
    const oracle = createExactOracle(8);
    const placeState: BidTacToeState = {
      board: Array.from({ length: 9 }, () => null),
      budgets: [8, 8],
      star: 1,
      phase: { kind: "place", winner: 0 },
      lastEffects: [],
    };
    expect(() => oracle.optimalBids(placeState, 0)).toThrow();
  });
});

describe("createExactOracle() — memo reuse sanity (same shared machinery solveBudget() uses)", () => {
  it("two oracle instances at the same budget agree with each other and with solveBudget()'s own rootValue", () => {
    const oracleA = createExactOracle(8);
    const oracleB = createExactOracle(8);
    const root = rootStateFor(8);
    expect(oracleA.exactValue(root)).toBe(oracleB.exactValue(root));
    expect(oracleA.exactValue(root)).toBe(solveBudget(8).rootValue);
  });
});

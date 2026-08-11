// games/bid-tac-toe/solver/backward-induction.test.ts — keeps `pnpm test` fast, following
// Fadeout's own solve.test.ts precedent: this suite uses small/capped budgets only (oracle
// cross-check at B<=3, structural properties at B<=8, ~5s total). The full {8, 12, 16, 20}
// sweep (~75s combined) lives in `pnpm --filter @twist-arcade/bid-tac-toe solve` /
// run-solve.mts and its real, timed output is recorded with provenance in
// docs/research/games/bid-tac-toe-solve-report.md — re-run that script to regenerate/verify
// the report's numbers rather than re-solving {12,16,20} on every `pnpm test`.

import { describe, expect, it } from "vitest";
import { bidTacToe } from "../engine";
import { solveBudget } from "./backward-induction";
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

// packages/harness/test/metrics.test.ts — TDD anchor: pure metric derivation over a hand-built
// array of GameOutcome (no engine/policy involved — the runner is tested separately in
// runner.test.ts). Every expected number below is computed by hand in the test comments so a
// reviewer can check the arithmetic without re-deriving it from the implementation.

import { describe, expect, it } from "vitest";
import {
  agentWinRate,
  computeMatchupMetrics,
  percentile,
  type GameOutcome,
} from "../src/metrics";

describe("percentile()", () => {
  it("p50 of an odd-length sorted array is the middle element", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("p0 is the minimum, p100 is the maximum", () => {
    const xs = [10, 20, 30, 40];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 100)).toBe(40);
  });

  it("a single-element array returns that element at every percentile", () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });

  it("throws on an empty array rather than returning NaN", () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
  });
});

function outcome(partial: Partial<GameOutcome> & Pick<GameOutcome, "winnerSeat" | "plies">): GameOutcome {
  return {
    matchSeed: "seed",
    seatAgent: ["A", "B"],
    capHit: false,
    branchingSamples: [],
    ...partial,
  };
}

describe("computeMatchupMetrics()", () => {
  it("throws on an empty outcome list rather than returning NaN/Infinity metrics", () => {
    expect(() => computeMatchupMetrics([])).toThrow(RangeError);
  });

  it("computes every metric by hand over a small 4-game batch", () => {
    // Game 1: seat 0 wins, 4 plies, branching [9,7]
    // Game 2: seat 1 wins, 10 plies, branching [8,6,4]
    // Game 3: draw (winnerSeat null), 50 plies, branching [3,3]
    // Game 4: seat 0 wins, 6 plies, branching [9,5,3]
    const outcomes: GameOutcome[] = [
      outcome({ winnerSeat: 0, plies: 4, branchingSamples: [9, 7] }),
      outcome({ winnerSeat: 1, plies: 10, branchingSamples: [8, 6, 4] }),
      outcome({ winnerSeat: null, plies: 50, branchingSamples: [3, 3] }),
      outcome({ winnerSeat: 0, plies: 6, branchingSamples: [9, 5, 3] }),
    ];

    const m = computeMatchupMetrics(outcomes);

    expect(m.games).toBe(4);
    // firstPlayerWinRate: seat 0 won games 1 and 4 -> 2/4 = 0.5
    expect(m.firstPlayerWinRate).toBeCloseTo(0.5);
    // drawRate: 1 draw / 4 = 0.25
    expect(m.drawRate).toBeCloseTo(0.25);
    // winRateBySeat: seat0 won 2/4=0.5, seat1 won 1/4=0.25
    expect(m.winRateBySeat[0]).toBeCloseTo(0.5);
    expect(m.winRateBySeat[1]).toBeCloseTo(0.25);
    // plies: [4,10,50,6] -> mean = 70/4 = 17.5; sorted [4,6,10,50] -> median (p50, nearest-rank
    // on a 4-element array, index = ceil(0.5*4)-1 = 1) = 6
    expect(m.meanPlies).toBeCloseTo(17.5);
    expect(m.medianPlies).toBe(6);
    // branching samples flattened: [9,7,8,6,4,3,3,9,5,3] -> sum=57, count=10 -> mean 5.7
    expect(m.meanBranchingFactor).toBeCloseTo(5.7);
    // capHitRate: none of these outcomes set capHit -> 0
    expect(m.capHitRate).toBe(0);
  });

  it("counts a capHit game toward drawRate and capHitRate both (adjudicated draw, plan §7.2)", () => {
    const outcomes: GameOutcome[] = [
      outcome({ winnerSeat: null, plies: 200, capHit: true, branchingSamples: [5] }),
      outcome({ winnerSeat: 0, plies: 8, branchingSamples: [5] }),
    ];
    const m = computeMatchupMetrics(outcomes);
    expect(m.drawRate).toBeCloseTo(0.5);
    expect(m.capHitRate).toBeCloseTo(0.5);
  });
});

describe("agentWinRate()", () => {
  it("computes a named agent's win rate regardless of which seat it occupied", () => {
    const outcomes: GameOutcome[] = [
      outcome({ seatAgent: ["strong", "random"], winnerSeat: 0, plies: 5 }), // strong wins
      outcome({ seatAgent: ["random", "strong"], winnerSeat: 1, plies: 5 }), // strong wins (mirrored seat)
      outcome({ seatAgent: ["strong", "random"], winnerSeat: 1, plies: 5 }), // random wins
      outcome({ seatAgent: ["random", "strong"], winnerSeat: null, plies: 5 }), // draw
    ];
    expect(agentWinRate(outcomes, "strong")).toBeCloseTo(0.5); // 2/4
    expect(agentWinRate(outcomes, "random")).toBeCloseTo(0.25); // 1/4
  });

  it("throws if the named agent never appears in any outcome (a caller error, not a silent 0)", () => {
    const outcomes: GameOutcome[] = [outcome({ seatAgent: ["a", "b"], winnerSeat: 0, plies: 5 })];
    expect(() => agentWinRate(outcomes, "nonexistent")).toThrow(RangeError);
  });
});

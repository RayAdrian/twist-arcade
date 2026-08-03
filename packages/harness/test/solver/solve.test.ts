// packages/harness/test/solver/solve.test.ts — TDD anchor: solveTwoPlayerGame() composes
// reach()+retrograde() into a root game value + per-opening value table (plan §7.6). Red
// first: solve.ts does not exist yet.
//
// The classic-ttt assertions are checked against an INDEPENDENT reference oracle (a plain
// recursive minimax written directly in this test file, memoized) rather than hand-recalled
// tic-tac-toe trivia — TTT's graph is acyclic (pieces never leave the board), so ordinary
// recursion is safe there and gives a second, independently-implemented algorithm to agree
// with solveTwoPlayerGame's retrograde-based one. Agreement between two independent
// implementations is a much stronger check than either one self-reportedly "looking right".

import { describe, expect, it } from "vitest";
import { classicTicTacToe, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { rngFromSeed, stableStringify } from "@twist-arcade/engine";
import { solveTwoPlayerGame } from "../../src/solver/solve";
import { UnsupportedGameError } from "../../src/solver/types";
import { corridor } from "../fixtures/corridor";

// --- Independent reference oracle for classic-ttt (plain recursive minimax; safe because
// classic-ttt's graph is acyclic) -------------------------------------------------------

const dummyRng = rngFromSeed("solve-test:reference-oracle");
const memo = new Map<string, "win" | "loss" | "draw">();

/** Value of `state` (assumed ongoing) from ITS OWN mover's (state.turn's) perspective. */
function referenceValue(state: TTTState): "win" | "loss" | "draw" {
  const key = classicTicTacToe.encode(state);
  const cached = memo.get(key);
  if (cached) return cached;
  const mover = state.turn;
  let sawUnresolved = false;
  for (const move of classicTicTacToe.legalMoves(state, mover)) {
    const next = classicTicTacToe.apply(state, new Map([[mover, move]]), dummyRng);
    const status = classicTicTacToe.status(next);
    let childOutcome: "win" | "loss" | "draw";
    if (status.kind === "won") {
      // The mover who just moved is the only possible winner here.
      childOutcome = status.winner === mover ? "win" : "loss";
    } else if (status.kind === "draw") {
      childOutcome = "draw";
    } else {
      // Ongoing: recurse for the NEXT mover's perspective, then flip (classic-ttt strictly
      // alternates, so the next mover is always the opponent of `mover`).
      const nextMoverValue = referenceValue(next);
      childOutcome = nextMoverValue === "draw" ? "draw" : nextMoverValue === "win" ? "loss" : "win";
    }
    if (childOutcome === "win") {
      memo.set(key, "win");
      return "win";
    }
    if (childOutcome === "draw") sawUnresolved = true;
  }
  const result: "win" | "loss" | "draw" = sawUnresolved ? "draw" : "loss";
  memo.set(key, result);
  return result;
}

describe("solveTwoPlayerGame() on classic-ttt (cross-checked against an independent reference oracle)", () => {
  it("reports 5,478 reachable states (the same published number reach() finds alone)", () => {
    const result = solveTwoPlayerGame(classicTicTacToe);
    expect(result.reachableStates).toBe(5478);
  });

  it("root value agrees with the independent reference minimax (draw)", () => {
    const root = classicTicTacToe.setup(2, dummyRng);
    const expected = referenceValue(root);
    const result = solveTwoPlayerGame(classicTicTacToe);
    expect(result.rootValue).toBe(expected);
    expect(result.rootValue).toBe("draw");
  });

  it("every one of the 9 opening values agrees with the independent reference minimax", () => {
    const root = classicTicTacToe.setup(2, dummyRng);
    const result = solveTwoPlayerGame(classicTicTacToe);
    expect(result.openings).toHaveLength(9);

    for (const opening of result.openings) {
      const afterMove = classicTicTacToe.apply(
        root,
        new Map([[root.turn, opening.move as { cell: number }]]),
        dummyRng
      );
      const status = classicTicTacToe.status(afterMove);
      let expected: "win" | "loss" | "draw";
      if (status.kind === "won") {
        expected = status.winner === root.turn ? "win" : "loss";
      } else if (status.kind === "draw") {
        expected = "draw";
      } else {
        const oppValue = referenceValue(afterMove);
        expected = oppValue === "draw" ? "draw" : oppValue === "win" ? "loss" : "win";
      }
      expect(opening.value, `opening ${stableStringify(opening.move)}`).toBe(expected);
    }
  });
});

describe("solveTwoPlayerGame() on the hand-built cyclic corridor fixture", () => {
  it("agrees with retrograde()'s hand-verified values, expressed as a root-relative opening table", () => {
    const result = solveTwoPlayerGame(corridor);
    expect(result.rootValue).toBe("draw");
    expect(result.openings).toEqual(
      expect.arrayContaining([
        { move: { dir: "right" }, value: "loss" }, // pos=3,turn=1 is a WIN for turn=1 -> LOSS for root's mover (turn=0)
        { move: { dir: "left" }, value: "draw" }, // pos=1,turn=1 is unresolved residue -> draw
      ])
    );
    expect(result.openings).toHaveLength(2);
  });
});

describe("solveTwoPlayerGame() preconditions", () => {
  it("refuses a stochastic (or otherwise unsupported) game with a typed error, not a wrong answer", () => {
    expect(() => solveTwoPlayerGame(bankRun)).toThrow(UnsupportedGameError);
  });
});

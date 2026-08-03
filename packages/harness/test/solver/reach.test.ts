// packages/harness/test/solver/reach.test.ts — TDD anchor (plan §9): "2P solver on
// classic-ttt: 5,478 reachable states" — a published, independently-known number. Red first:
// reach() does not exist yet.

import { describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { reach } from "../../src/solver/reach";
import { UnsupportedGameError, ReachLimitExceededError } from "../../src/solver/types";

describe("reach()", () => {
  it("finds exactly 5,478 reachable states for classic tic-tac-toe (published number)", () => {
    const graph = reach(classicTicTacToe);
    expect(graph.nodes.size).toBe(5478);
  });

  it("includes the initial (empty board) state, keyed by encode()", () => {
    const graph = reach(classicTicTacToe);
    expect(graph.nodes.has(graph.initialHash)).toBe(true);
    const initial = graph.nodes.get(graph.initialHash)!;
    expect(initial.state.board.every((c) => c === null)).toBe(true);
  });

  it("records outgoing edges only for ongoing (non-terminal) nodes", () => {
    const graph = reach(classicTicTacToe);
    for (const node of graph.nodes.values()) {
      if (node.status.kind === "ongoing") {
        expect(node.moves.length).toBeGreaterThan(0);
      } else {
        expect(node.moves.length).toBe(0);
      }
    }
  });

  it("every edge target is itself a node in the graph (closed under apply)", () => {
    const graph = reach(classicTicTacToe);
    for (const node of graph.nodes.values()) {
      for (const edge of node.moves) {
        expect(graph.nodes.has(edge.toHash)).toBe(true);
      }
    }
  });

  it("throws ReachLimitExceededError when max-states is set below the true reachable count", () => {
    expect(() => reach(classicTicTacToe, { maxStates: 100 })).toThrow(ReachLimitExceededError);
  });

  it("refuses a stochastic (or otherwise unsupported) game with a typed error, not a wrong answer", () => {
    expect(() => reach(bankRun)).toThrow(UnsupportedGameError);
  });
});

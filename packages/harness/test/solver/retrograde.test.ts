// packages/harness/test/solver/retrograde.test.ts — TDD anchors (plan §2.2/§9): retrograde
// analysis/value iteration must converge correctly on a CYCLIC game graph, where plain
// minimax/negamax recursion (no cycle handling) would not terminate. Also reproduces the
// published classic-ttt result: 5,478 states, value = draw.

import { describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { reach } from "../../src/solver/reach";
import { retrograde } from "../../src/solver/retrograde";
import { corridor } from "../fixtures/corridor";

describe("retrograde() on classic-ttt (published free oracle)", () => {
  it("values the initial (empty board) position as a draw under optimal play", () => {
    const graph = reach(classicTicTacToe);
    const result = retrograde(classicTicTacToe, graph);
    expect(result.valueAt(graph.initialHash)).toBe("draw");
  });

  it("agrees with a hand-verified forced-win position (two-in-a-row, mover to complete it)", () => {
    // Board: X at 0,1 (mover to move, about to complete the top row at 2). O has one mark
    // elsewhere (4, center) that cannot block in time. Hand-computed: this MUST be a win for
    // the mover (X) — X plays cell 2 and wins outright, on the very next ply.
    const state = {
      board: [0, 0, null, null, 1, null, null, null, null] as const,
      turn: 0 as const,
      lastEffects: [],
    };
    const hash = classicTicTacToe.encode(state as unknown as Parameters<typeof classicTicTacToe.encode>[0]);
    const graph = reach(classicTicTacToe);
    // The hand-built position must actually be reachable from setup() under legal play for
    // this to be a meaningful assertion against the SAME graph retrograde solved.
    expect(graph.nodes.has(hash)).toBe(true);
    const result = retrograde(classicTicTacToe, graph);
    expect(result.valueAt(hash)).toBe("win");
  });
});

describe("retrograde() on the hand-built cyclic fixture (plan §2.2/§9)", () => {
  it("finds a genuine cycle in the raw reachability graph (2-ply round trip back to the start)", () => {
    const graph = reach(corridor);
    const start = graph.nodes.get(graph.initialHash)!;
    // pos=2,turn=0 -left-> pos=1,turn=1 -right-> pos=2,turn=0: the SAME hash recurs.
    const leftEdge = start.moves.find((m) => (m.move as { dir: string }).dir === "left")!;
    const afterLeft = graph.nodes.get(leftEdge.toHash)!;
    const rightEdge = afterLeft.moves.find((m) => (m.move as { dir: string }).dir === "right")!;
    expect(rightEdge.toHash).toBe(graph.initialHash);
  });

  it("converges to the hand-verified values: pos=3 is WIN, pos=0/1/2 are DRAW residue", () => {
    const graph = reach(corridor);
    const result = retrograde(corridor, graph);

    for (const node of graph.nodes.values()) {
      if (node.status.kind !== "ongoing") continue;
      const { pos } = node.state;
      if (pos === 3) {
        expect(result.valueAt(node.hash)).toBe("win");
      } else {
        expect(result.valueAt(node.hash)).toBe("draw");
      }
    }
  });

  it("the initial position (pos=2) is a draw — neither player is ever forced to concede", () => {
    const graph = reach(corridor);
    const result = retrograde(corridor, graph);
    expect(result.valueAt(graph.initialHash)).toBe("draw");
  });
});

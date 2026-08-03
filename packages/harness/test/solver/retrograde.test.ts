// packages/harness/test/solver/retrograde.test.ts — TDD anchors (plan §2.2/§9): retrograde
// analysis/value iteration must converge correctly on a CYCLIC game graph, where plain
// minimax/negamax recursion (no cycle handling) would not terminate. Also reproduces the
// published classic-ttt result: 5,478 states, value = draw.

import { describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { reach } from "../../src/solver/reach";
import { retrograde } from "../../src/solver/retrograde";
import { corridor } from "../fixtures/corridor";
import { twinTrack } from "../fixtures/twin-track";
import { extraTurn } from "../fixtures/extra-turn";

describe("retrograde() on classic-ttt (published free oracle)", () => {
  it("values the initial (empty board) position as a draw under optimal play", () => {
    const graph = reach(classicTicTacToe);
    const result = retrograde(classicTicTacToe, graph);
    expect(result.valueAt(graph.initialHash)).toBe("draw");
  });

  it("agrees with a hand-verified forced-win position (two-in-a-row, mover to complete it)", () => {
    // Board: X at 0,1 (mover to move, about to complete the top row at 2). O has marks at
    // 4 and 8 — both on the diagonal line [0,4,8], which is already dead (X occupies cell 0),
    // so O poses no live threat and cannot block in time regardless. Hand-computed: this MUST
    // be a win for the mover (X) — X plays cell 2 and wins outright, on the very next ply.
    //
    // NOTE on why O needs *two* marks, not one: `turn: 0` (X to move) is only reachable when
    // X and O have placed an EQUAL number of marks (X moves first, so turn returns to X only
    // right after O's move evens the count back up). X has 2 marks here, so O must also have 2
    // — a single O mark alongside 2 X marks is a turn=1 (O-to-move) position, never turn=0; an
    // earlier version of this fixture had exactly that mismatch and was consequently never
    // reachable from setup() under legal alternating play (caught by the very next assertion,
    // which is exactly why it's there).
    const state = {
      board: [0, 0, null, null, 1, null, null, null, 1] as const,
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

// Review Note 7: corridor's own values are {WIN, draw-residue} only, so retrograde.ts's
// LOSS-by-countdown machinery (retrograde.ts:143-145) and its same-mover (extra-turn)
// unflipped-passthrough branch are never directly exercised by anything above. These two small
// fixtures close that gap.
describe("retrograde() on twin-track (both ends win — proves LOSS via the countdown, not just WIN)", () => {
  it("pos=1 and pos=3 are WIN for the mover (one step from either winning end)", () => {
    const graph = reach(twinTrack);
    const result = retrograde(twinTrack, graph);
    for (const node of graph.nodes.values()) {
      if (node.status.kind !== "ongoing") continue;
      if (node.state.pos === 1 || node.state.pos === 3) {
        expect(result.valueAt(node.hash)).toBe("win");
      }
    }
  });

  it("the initial position (pos=2) is a LOSS — every option hands the opponent an immediate win, " +
    "provable only once BOTH outgoing edges resolve (the countdown path)", () => {
    const graph = reach(twinTrack);
    const result = retrograde(twinTrack, graph);
    expect(result.valueAt(graph.initialHash)).toBe("loss");
  });
});

describe("retrograde() on extra-turn (same-mover child value passes through UNFLIPPED)", () => {
  it("the root is WIN, not LOSS — a solver that always flipped would get this backwards", () => {
    const graph = reach(extraTurn);
    const result = retrograde(extraTurn, graph);
    expect(result.valueAt(graph.initialHash)).toBe("win");
  });

  it("the phase-1 (extra-turn) node is itself WIN, resolved straight off its terminal child", () => {
    const graph = reach(extraTurn);
    const result = retrograde(extraTurn, graph);
    const phase1 = [...graph.nodes.values()].find(
      (n) => n.status.kind === "ongoing" && n.state.phase === 1
    )!;
    expect(result.valueAt(phase1.hash)).toBe("win");
  });
});

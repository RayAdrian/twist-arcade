// packages/bots/test/support/mcts-legacy.test.ts — faithfulness tests for the test-only
// `mctsPolicyLegacy` port (docs/plans/sim-search-remedy.md's discriminating-experiment task 1).
//
// The PRIMARY, non-negotiable faithfulness check is external to this suite: `.scratch/
// c57-byte-identity-dump.mts <dir> legacy` must reproduce `docs/research/games/
// c57-byte-identity-pre-fix-{fadeout,nine-grids,tilt}.json` byte-for-byte (verified — see that
// script's own module doc). This file adds two FAST, in-suite corroborations that run under
// `pnpm vitest run packages/bots` alone, without needing the external harness dump:
//
//   1. On a SEQUENTIAL fixture, `mctsPolicyLegacy` and the current `mctsPolicy` must be
//      IDENTICAL — the DUCT fix (C57/C58) only ever touches `active.mode === "simultaneous"`
//      branches, so sequential trees are a structural no-op for the fix and both algorithms
//      should produce the exact same move/value/visit distribution given the same seeds.
//   2. On the hand-verified pure-saddle matrix fixture (mcts.test.ts's own "oracle-in-
//      miniature"), the two algorithms must DIVERGE in the specific, documented way: the
//      current `mctsPolicy` converges to the true saddle (row "a" / col "y", value 3/-3 —
//      see matrix-saddle.ts's own doc and mcts.test.ts's DUCT describe block), while
//      `mctsPolicyLegacy` reproduces the OLD max-max defect and is pulled toward the decoy
//      cell (b, x) = 9 — the single highest cell in the matrix, tempting only to a search that
//      models the opponent as a co-operator (platform-corrections.md C71/C73's diagnosis).
import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { mctsPolicy } from "../../src/mcts";
import { fakeClock } from "../helpers";
import { matrixSaddle, SADDLE_ROW, SADDLE_VALUE, type MatrixSaddleMove, type MatrixSaddleState } from "../fixtures/matrix-saddle";
import { mctsPolicyLegacy } from "./mcts-legacy";

describe("mctsPolicyLegacy (test-only pre-DUCT port, sim-search-remedy.md)", () => {
  it("matches the CURRENT mctsPolicy exactly on a sequential root — DUCT is a structural no-op there", () => {
    const engine = classicTicTacToe;
    const state = engine.setup(2, rngFromSeed("mcts-legacy-seq-setup"));

    const current = mctsPolicy<TTTState, TTTMove>({ explorationC: 1.4 }).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("mcts-legacy-seq-decision"),
      budget: { kind: "rollouts", n: 500 },
      clock: fakeClock(0),
    });
    const legacy = mctsPolicyLegacy<TTTState, TTTMove>({ explorationC: 1.4 }).chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("mcts-legacy-seq-decision"),
      budget: { kind: "rollouts", n: 500 },
      clock: fakeClock(0),
    });

    expect(legacy.move).toEqual(current.move);
    expect(legacy.stats.rollouts).toBe(current.stats.rollouts);
    expect(legacy.stats.rootValue).toBeCloseTo(current.stats.rootValue!, 12);
    expect(legacy.stats.rootVisits).toEqual(current.stats.rootVisits);
  });

  it("reproduces the OLD max-max defect on the pure-saddle matrix fixture: pulled toward the decoy, not the true saddle", () => {
    // Same fixture, same budget, same seeds mcts.test.ts's DUCT test uses for the CURRENT
    // policy (which converges to SADDLE_ROW/"a") — legacy must diverge from that, landing on
    // the decoy row "b" ((b,x)=9 is the highest single cell in the matrix; see matrix-saddle.ts
    // module doc), and its rootValue must sit well away from the true game value of 3.
    const engine = matrixSaddle;
    const state = engine.setup(2, rngFromSeed("matrix-saddle-setup"));
    const policy = mctsPolicyLegacy<MatrixSaddleState, MatrixSaddleMove>({ explorationC: 1.4 });

    const p0 = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("matrix-saddle-decision-p0"),
      budget: { kind: "rollouts", n: 20000 },
      clock: fakeClock(),
    });

    expect(p0.move.choice).not.toBe(SADDLE_ROW);
    expect(p0.move.choice).toBe("b"); // the documented decoy: (b,x)=9, the matrix's single highest cell
    expect(p0.stats.rootValue).toBeDefined();
    // The true saddle value is 3 (player 0's perspective); the co-operator-modeling legacy
    // search is pulled well above it toward the decoy's optimistic best case.
    expect(p0.stats.rootValue!).toBeGreaterThan(SADDLE_VALUE + 0.5);
  });
});

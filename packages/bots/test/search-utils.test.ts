// packages/bots/test/search-utils.test.ts — unit coverage for valueOfStatus/rolloutToHorizon,
// the shared helpers mcts.ts/flat-mc.ts/beam.ts all agree on (search-utils.ts's own module
// doc explains why: a divergence here would be a quiet cross-algorithm correctness bug). This
// file existed with no direct test coverage before the M2 review's finding on the heuristic
// normalization below — added alongside that fix.

import { describe, expect, it } from "vitest";
import { classicTicTacToe, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { valueOfStatus } from "../src/search-utils";

describe("valueOfStatus: 'ongoing' (horizon-capped, no terminal reached) falls back to score()/heuristic()", () => {
  it("returns engine.heuristic()'s RAW value, un-scaled — heuristic() has no documented range in the engine contract (GameEngine.heuristic's doc says only 'positive = good for player'), so this shared cross-game helper must not silently assume any particular game's range (the previous `/ 9` was classic-ttt-specific normalization baked into code every search algorithm shares)", () => {
    // A center-heavy midgame position: classic-ttt's heuristic clearly exceeds ±1 here, which
    // is exactly the point — if this helper silently rescaled it, that TTT-specific assumption
    // would leak into mcts.ts/flat-mc.ts's value accounting for every OTHER game too.
    const state: TTTState = {
      board: [0, null, null, null, 0, null, null, null, 1],
      turn: 0,
      lastEffects: [],
    };
    const rawHeuristic = classicTicTacToe.heuristic!(state, 0);
    expect(rawHeuristic).not.toBe(0);
    const value = valueOfStatus(classicTicTacToe, { kind: "ongoing" }, state, 0);
    expect(value).toBe(rawHeuristic);
  });

  it("prefers score() over heuristic() when both exist", () => {
    const engine = {
      ...classicTicTacToe,
      score: (_state: TTTState, _player: 0 | 1) => 42,
    };
    const state = classicTicTacToe.setup(2, { int: () => 0, next: () => 0 } as never);
    const value = valueOfStatus(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(42);
  });

  it("falls back to 0 when neither score() nor heuristic() exists", () => {
    // Can't spread `{ heuristic: undefined }` — exactOptionalPropertyTypes treats a
    // present-but-undefined property differently from an absent one. Destructure it away
    // instead, which actually OMITS the key from the resulting object.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { heuristic: _unusedHeuristic, ...engine } = classicTicTacToe;
    const state = classicTicTacToe.setup(2, { int: () => 0, next: () => 0 } as never);
    const value = valueOfStatus(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(0);
  });
});

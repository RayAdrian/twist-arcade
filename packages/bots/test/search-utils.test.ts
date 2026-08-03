// packages/bots/test/search-utils.test.ts — unit coverage for valueOfStatus/rolloutToHorizon,
// the shared helpers mcts.ts/flat-mc.ts/beam.ts all agree on (search-utils.ts's own module
// doc explains why: a divergence here would be a quiet cross-algorithm correctness bug). This
// file existed with no direct test coverage before the M2 review's finding on the heuristic
// normalization below — added alongside that fix.

import { describe, expect, it } from "vitest";
import { classicTicTacToe, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { valueOfStatus } from "../src/search-utils";

describe("valueOfStatus: 'ongoing' (horizon-capped, no terminal reached) falls back to score()/heuristic()", () => {
  it("squashes engine.heuristic()'s value through Math.tanh — heuristic() has no documented range in the engine contract (GameEngine.heuristic's doc now says only sign/ordering are contractual, magnitude is NOT), so a horizon-capped rollout's estimate must land strictly inside (-1, 1), below every won/lost terminal's ±1 — otherwise a heuristic like classic-ttt's (span ~±8) lets a horizon-capped 'ongoing' value outrank an actual averaged win, exactly the scale-mixing bug MUST FIX 2 closes. This is a deliberate reversal of an earlier version of this same test, which asserted the RAW un-scaled value was returned and required every game's heuristic to already be ±1-commensurate by convention alone — a convention with no enforcement, which is why it's squashed in code now instead of merely documented (see this file's — and search-utils.ts's — comments for why 'the author must remember' contracts are avoided here)", () => {
    // A center-heavy midgame position: classic-ttt's heuristic clearly exceeds ±1 here, which
    // is exactly the point — an un-squashed helper would let this leak straight into
    // mcts.ts/flat-mc.ts's value accounting as though it were already commensurate with ±1.
    const state: TTTState = {
      board: [0, null, null, null, 0, null, null, null, 1],
      turn: 0,
      lastEffects: [],
    };
    const rawHeuristic = classicTicTacToe.heuristic!(state, 0);
    expect(Math.abs(rawHeuristic)).toBeGreaterThan(1); // otherwise this fixture wouldn't prove anything
    const value = valueOfStatus(classicTicTacToe, { kind: "ongoing" }, state, 0);
    expect(value).toBe(Math.tanh(rawHeuristic));
    expect(value).toBeGreaterThan(-1);
    expect(value).toBeLessThan(1);
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

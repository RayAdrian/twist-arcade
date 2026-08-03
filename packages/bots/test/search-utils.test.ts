// packages/bots/test/search-utils.test.ts — unit coverage for valueOfStatus/rolloutToHorizon,
// the shared helpers mcts.ts/flat-mc.ts/beam.ts all agree on (search-utils.ts's own module
// doc explains why: a divergence here would be a quiet cross-algorithm correctness bug). This
// file existed with no direct test coverage before the M2 review's finding on the heuristic
// normalization below — added alongside that fix.

import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { createBankRun, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import {
  greedyMoveSelector,
  rankingValueOf,
  RankingValueUnavailableError,
  rolloutToHorizon,
  uniformRandomMoveSelector,
  valueOfStatus,
} from "../src/search-utils";

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

// ---------------------------------------------------------------------------------------
// rankingValueOf — the OTHER shared evaluator (platform-corrections.md C6): 1-ply candidate-
// move RANKING, used by greedy-only.ts, beam.ts, and this file's greedyMoveSelector. This is
// deliberately a SEPARATE function from valueOfStatus above, with the OPPOSITE score/heuristic
// priority: valueOfStatus prefers score() (a horizon-capped rollout leaf estimate must stay
// commensurate with a "scored" terminal's raw scores[player], which IS score()'s own contract)
// while rankingValueOf prefers heuristic() (documented in packages/engine/src/types.ts as
// "per-game eval for minimax/greedy" — built for exactly this 1-ply ranking use, and free to
// value POTENTIAL/unrealized progress that score() cannot: score() is contractually pinned to
// MUST equal status().scores[0] at a scored terminal, so it can only ever reflect what has
// already been realized/banked). A ranking function that preferred score() here would rank
// every reveal candidate by "however much I've already banked" alone — blind to the entire
// quantity a press-your-luck decision turns on (mine-run.md §4.4/§4.5, the C6 finding).
// ---------------------------------------------------------------------------------------

describe("rankingValueOf: 'ongoing' prefers heuristic() over score() when both exist", () => {
  it("prefers heuristic() over score() when both exist", () => {
    // bank-run's score() deliberately excludes the at-risk streak (packages/engine/testkit/
    // fixtures/bank-run.ts's own comment: "score() must equal the scored terminal's scores[0]
    // ... unbanked streak forfeited, so it reports only realized value"). A heuristic that
    // instead VALUES the live streak (banked + streak, mirroring mine-run.md §4.5's own
    // "bank vs best-risk reveal by immediate expected points" framing) is exactly the kind of
    // eval score() structurally cannot provide — this is bank-run standing in for Mine Run's
    // real banked/streakValue split without needing the full engine.
    const engine = {
      ...createBankRun(),
      heuristic: (state: BankRunState, _player: 0) => state.banked + state.streak,
    };
    const state: BankRunState = { banked: 2, streak: 5, round: 1, lastEffects: [] };
    const value = rankingValueOf(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(7); // heuristic's 2+5, NOT score()'s bare banked=2
  });

  it("falls back to score() when heuristic() is absent (bank-run has no heuristic)", () => {
    const engine = createBankRun();
    const state: BankRunState = { banked: 2, streak: 5, round: 1, lastEffects: [] };
    const value = rankingValueOf(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(2); // score() only — no heuristic() to prefer
  });

  it("falls back to 0 when neither score() nor heuristic() exists", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { heuristic: _unusedHeuristic, ...engine } = classicTicTacToe;
    const state = classicTicTacToe.setup(2, { int: () => 0, next: () => 0 } as never);
    const value = rankingValueOf(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(0);
  });

  it("ranks won strictly above any ongoing value and lost strictly below (±Infinity convention)", () => {
    const engine = { ...createBankRun(), heuristic: () => 1_000_000 };
    const wonState: BankRunState = { banked: 0, streak: 0, round: 0, lastEffects: [] };
    expect(rankingValueOf(engine, { kind: "won", winner: 0 }, wonState, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(rankingValueOf(engine, { kind: "won", winner: 1 }, wonState, 0)).toBe(Number.NEGATIVE_INFINITY);
    expect(rankingValueOf(engine, { kind: "lost" }, wonState, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("does NOT squash heuristic() (unlike valueOfStatus) — rankingValueOf is a pure 1-ply comparator, not a cross-rollout-averaged estimate", () => {
    const engine = { ...createBankRun(), heuristic: () => 42 };
    const state: BankRunState = { banked: 0, streak: 0, round: 0, lastEffects: [] };
    expect(rankingValueOf(engine, { kind: "ongoing" }, state, 0)).toBe(42);
  });
});

describe("uniformRandomMoveSelector / rolloutToHorizon(moveSelector)", () => {
  it("uniformRandomMoveSelector is rolloutToHorizon's default — omitting the 5th arg behaves identically to passing it explicitly", () => {
    const engine = createBankRun({ successProb: 0.6 });
    const start = engine.setup(1, rngFromSeed("rollout-default-a"));
    const withDefault = rolloutToHorizon(engine, start, rngFromSeed("rollout-default-decision"), 20);
    const withExplicit = rolloutToHorizon(
      engine,
      start,
      rngFromSeed("rollout-default-decision"),
      20,
      uniformRandomMoveSelector
    );
    expect(withDefault.state).toEqual(withExplicit.state);
  });

  it("greedyMoveSelector drives the rollout to a DIFFERENT, reproducibly better outcome than uniform-random on bank-run (plan §4.4's 'roll out with the greedy policy to terminal')", () => {
    // plantFarmingLoop: true removes bust risk entirely, so a greedy rollout (which always
    // prefers the candidate with the higher immediate score()) always pushes and never banks
    // until forced — while a uniform-random rollout banks roughly half the time, forfeiting
    // upside for no reason under this risk-free setup. This proves greedyMoveSelector actually
    // changes rollout behavior, not just that it type-checks.
    const engine = createBankRun({ plantFarmingLoop: true });
    const start = engine.setup(1, rngFromSeed("rollout-greedy-a"));
    const { state: greedyEnd } = rolloutToHorizon(engine, start, rngFromSeed("rollout-greedy-decision"), 6, greedyMoveSelector);
    const { state: randomEnd } = rolloutToHorizon(
      engine,
      start,
      rngFromSeed("rollout-random-decision"),
      6,
      uniformRandomMoveSelector
    );
    expect(greedyEnd.banked).toBeGreaterThanOrEqual(randomEnd.banked);
    // Under plantFarmingLoop, greedy's score()-ranked immediate-best is ALWAYS "push" (banking
    // strictly forfeits future upside at zero risk), so a full 6-round rollout ends with
    // everything still on the streak, never banked, until the round cap forces the final
    // auto-something — bank-run has no auto-bank, so banked stays 0 and streak==6 at the cap.
    expect(greedyEnd.banked).toBe(0);
    expect(greedyEnd.streak).toBe(6);
  });

  it("greedyMoveSelector throws a typed error when the engine has neither score() nor heuristic()", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { heuristic: _unusedHeuristic, ...engine } = classicTicTacToe;
    const legal = engine.legalMoves(engine.setup(2, rngFromSeed("greedy-selector-unsupported")), 0);
    expect(() =>
      greedyMoveSelector(
        engine,
        engine.setup(2, rngFromSeed("greedy-selector-unsupported-2")),
        0,
        legal,
        rngFromSeed("greedy-selector-unsupported-decision")
      )
    ).toThrow(RankingValueUnavailableError);
  });
});

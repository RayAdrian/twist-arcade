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
  HorizonValueUndeclaredError,
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

  // platform-corrections.md C30: valueOfStatus USED TO prefer score() unconditionally whenever
  // both existed — that silent default is exactly what blinded Mine Run's Strong to its entire
  // live-streak mechanic (score() === banked only; heuristic() carries the streak). The engine
  // author, not the platform, is the only party who knows which one is a meaningful mid-game
  // estimate — so an engine implementing BOTH with neither declared is now a loud throw rather
  // than a silent (and here, wrong) default.
  it("throws HorizonValueUndeclaredError when both score() and heuristic() exist but the engine declares no horizonValue", () => {
    const engine = {
      ...classicTicTacToe,
      score: (_state: TTTState, _player: 0 | 1) => 42,
    };
    const state = classicTicTacToe.setup(2, { int: () => 0, next: () => 0 } as never);
    expect(() => valueOfStatus(engine, { kind: "ongoing" }, state, 0)).toThrow(
      HorizonValueUndeclaredError
    );
    expect(() => valueOfStatus(engine, { kind: "ongoing" }, state, 0)).toThrow(/classic-ttt/);
  });

  it("horizonValue: 'score' uses score() even when heuristic() also exists", () => {
    const engine = {
      ...classicTicTacToe,
      score: (_state: TTTState, _player: 0 | 1) => 42,
      horizonValue: "score" as const,
    };
    const state = classicTicTacToe.setup(2, { int: () => 0, next: () => 0 } as never);
    const value = valueOfStatus(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(42);
  });

  it("horizonValue: 'heuristic' uses heuristic() RAW (unsquashed) when the engine also has score() — commensurability tracks the engine's OWN terminal convention (scored ⇒ raw), not which hook supplied the estimate", () => {
    // bank-run stands in for Mine Run's banked/streak split, exactly as the rankingValueOf
    // suite below already uses it. A raw heuristic value with |value| > 1 proves this isn't
    // secretly squashed: if it were, this would come back as Math.tanh(7) ≈ 0.9999..., not 7.
    const engine = {
      ...createBankRun(),
      heuristic: (state: BankRunState, _player: 0) => state.banked + state.streak,
      horizonValue: "heuristic" as const,
    };
    const state: BankRunState = { banked: 2, streak: 5, round: 1, lastEffects: [] };
    const value = valueOfStatus(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(7); // raw 2+5, NOT Math.tanh(7)
  });

  it("horizonValue is a no-op when the engine implements at most one of score()/heuristic() — no ambiguity exists to declare", () => {
    // bank-run has score() only; declaring horizonValue: 'heuristic' anyway must not matter,
    // since there is no heuristic() to prefer and nothing ambiguous about which hook to use.
    const engine = { ...createBankRun(), horizonValue: "heuristic" as const };
    const state: BankRunState = { banked: 2, streak: 5, round: 1, lastEffects: [] };
    const value = valueOfStatus(engine, { kind: "ongoing" }, state, 0);
    expect(value).toBe(2); // score() === banked, used exactly as before this field existed
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

  it("greedyMoveSelector, ranked on score() alone (bank-run has no heuristic), ALWAYS BANKS the instant a streak exists — it never lets the streak grow, which is precisely why Mine Run's heuristic.ts (Greedy's brain) had to exist (C6)", () => {
    // ORCHESTRATOR CORRECTION (stage-5 fix, replacing a wrong assertion): bank-run's score()
    // deliberately EXCLUDES the at-risk streak (bank-run.ts's own comment: "score() must equal
    // the scored terminal's scores[0] ... unbanked streak forfeited, so it reports only
    // realized value"). bank-run has no heuristic(), so rankingValueOf (which prefers
    // heuristic() but falls back to score()) ranks every 1-ply candidate on score() ALONE.
    // Pushing never changes score() (the streak it grows isn't counted); banking immediately
    // RAISES score() by the whole streak. So the instant streak > 0, bank's 1-ply score()
    // strictly beats push's, and greedyMoveSelector takes it — even under plantFarmingLoop's
    // zero bust risk, where there is no downside to waiting.
    //
    // This is the mirror image of this test's previous (wrong) claim that greedy "always
    // pushes and never banks until forced": that claim describes the STRATEGICALLY best policy
    // under zero risk, not what a myopic, score()-ranked greedy selector actually does. The two
    // differ, and the difference is the whole point — a greedy rollout driven by score() alone
    // is a USELESS press-your-luck policy (it cashes out at streak==1 every time, forfeiting
    // all compounding), which is exactly why mine-run's heuristic.ts exists: to give Greedy a
    // ranking signal that can see unbanked streak value, because score() structurally cannot
    // (mine-run.md §4.4/§4.5).
    //
    // It is even worse than "different": it is worse BY score()'s own yardstick. The
    // genuinely-best policy under this risk-free setup is to push for 5 of the 6 rounds and
    // bank once at the very end (banked==5, streak forfeited at the round cap otherwise) —
    // strictly more than greedy's bank-every-opportunity cadence achieves below.
    const engine = createBankRun({ plantFarmingLoop: true });
    const start = engine.setup(1, rngFromSeed("rollout-greedy-a"));
    const { state: greedyEnd } = rolloutToHorizon(
      engine,
      start,
      rngFromSeed("rollout-greedy-decision"),
      6,
      greedyMoveSelector
    );
    expect(greedyEnd.streak).toBe(0); // never left standing on the streak — cashed out every time
    expect(greedyEnd.banked).toBeGreaterThan(0); // did bank, repeatedly
    // Pinned trace over 6 rounds: push, bank, push, bank, push, bank (tie at streak==0 breaks
    // toward the first-listed legal move, "push"; every subsequent decision has streak>0 and
    // bank wins). Three pushes of value 1 each land in banked = 3 — strictly less than the 5
    // reachable by NOT banking early (the comment above).
    expect(greedyEnd.banked).toBe(3);
  });

  it("...but give the SAME greedy selector a heuristic that values the live streak (banked + streak, mirroring Mine Run's heuristic.ts) and it flips to never banking — proving the difference above is the RANKING SIGNAL, not the engine or the selector", () => {
    // Contrasting case: identical engine and rollout shape, except heuristic() now exists, so
    // rankingValueOf prefers it over score() (search-utils.ts's own documented priority) for
    // every ONGOING comparison. Ranking candidates by (banked + streak): pushing raises it by
    // exactly 1 (streak grows, banked untouched); banking leaves it unchanged (the streak just
    // moves from "streak" to "banked", net zero) — so for the first 5 rounds push strictly
    // beats bank, and streak climbs to 5 unbanked.
    //
    // The 6th and final decision is different: BOTH candidates end the round cap and reach a
    // `status.kind === "scored"` terminal, and rankingValueOf's "scored" branch returns
    // `status.scores[player]` directly — it does NOT consult heuristic() at a terminal. Banking
    // there locks in scores=[5]; pushing locks in scores=[0] (the grown streak is forfeited at
    // the cap, per bank-run's own contract). So greedy banks exactly once, on exactly the right
    // move — the heuristic makes it wait the whole run, and the terminal scoring rule (not the
    // heuristic) makes it cash out before the streak is forfeited. banked==5 is in fact the
    // genuinely-best achievable total under this risk-free setup (see the comment on the
    // previous test) — giving Greedy a heuristic does not merely change its behavior, it makes
    // the behavior optimal.
    const engine = {
      ...createBankRun({ plantFarmingLoop: true }),
      heuristic: (state: BankRunState, _player: 0) => state.banked + state.streak,
    };
    const start = engine.setup(1, rngFromSeed("rollout-greedy-heuristic-a"));
    const { state: greedyEnd } = rolloutToHorizon(
      engine,
      start,
      rngFromSeed("rollout-greedy-heuristic-decision"),
      6,
      greedyMoveSelector
    );
    expect(greedyEnd.banked).toBe(5);
    expect(greedyEnd.streak).toBe(0);
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

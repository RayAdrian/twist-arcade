// packages/harness/test/fixtures/mine-run-mutants.ts — deliberately-broken Mine Run variants,
// used ONLY by probes-solo.test.ts to prove the Grind and Always-Safe gates actually catch
// what they claim to catch (the standing project defect this milestone is warned about: "a
// guard that doesn't guard"). Mirrors the convention packages/engine/test/mutants/mutants.ts
// already established for the engine testkit — plant exactly one bug per variant, via a
// `{ ...base, methodOverride() {...} }` spread over the REAL @twist-arcade/mine-run factory,
// never imported by anything outside this test suite.

import type { GameEngine } from "@twist-arcade/engine";
import { assertRevealBudgetScarcity, createMineRun } from "@twist-arcade/mine-run";
import type { MineRunMove, MineRunState, MineRunView } from "@twist-arcade/mine-run";

/**
 * Grind-probe mutant (docs/plans/mine-run.md §4.1's own worked example): "a build where ...
 * bank is legal at streak 0" — real Mine Run's `streakLen >= 1` precondition on `bank` is the
 * second half of its termination proof (the first half, `revealsLeft` strictly decreasing on
 * every reveal, is untouched here). Removing the precondition makes `bank` at streak 0 a
 * true zero-risk, zero-cost, EXACT self-loop: `apply({t:"bank"})` returns a state identical
 * in every `encode()`-relevant field (mines/revealed/exploded/streakLen/streakValue/banked/
 * revealsLeft all unchanged — banked increases by streakValue, which is 0), so
 * `engine.encode(next) === engine.encode(state)` trivially, with `scoreDelta === 0 >= 0`: a
 * length-1 cycle, the simplest possible Grind-probe hit.
 */
export function createGrindBrokenMineRun(
  opts: Parameters<typeof createMineRun>[0] = {}
): GameEngine<MineRunState, MineRunMove, MineRunView> {
  const base = createMineRun(opts);
  return {
    ...base,
    legalMoves(state, player) {
      const moves = base.legalMoves(state, player);
      if (player === 0 && !moves.some((m) => m.t === "bank")) {
        // BUG: bank is legal even at streakLen 0, in addition to whatever was already legal.
        return [...moves, { t: "bank" }];
      }
      return moves;
    },
    isLegal(state, player, move) {
      if (player === 0 && move.t === "bank") return true; // BUG: no streakLen>=1 precondition
      return base.isLegal(state, player, move);
    },
    apply(state, moves, rng) {
      const move = moves.get(0);
      if (move && move.t === "bank" && state.streakLen === 0) {
        // BUG: legal, and a pure no-op scoring-wise — banked += streakValue(=0). Every field
        // that feeds encode() is byte-identical to the input state.
        return { ...state, lastEffects: [{ type: "banked", points: 0 }] };
      }
      return base.apply(state, moves, rng);
    },
  };
}

/**
 * Grind-probe mutant #2 (platform-corrections.md C9's own executed counterexample): `bank`
 * credits `streakValue` into `banked` but never resets `streakLen`/`streakValue` back to 0.
 * Unlike the streak-0 self-loop above, this is NOT byte-identical after one `bank` — `banked`
 * strictly increases — so the OLD `encode(next) === encode(start)` cycle check (blind to
 * anything living inside canonical state, C9's finding) could never see it. But it is still a
 * genuine, indefinitely-repeatable, zero-risk farm: `bank` doesn't touch `revealsLeft` (real
 * Mine Run's `bank` never did — only `reveal` costs a budget unit), and `streakLen`/
 * `streakValue` staying frozen means `bank` remains legal forever and credits the exact same
 * `streakValue` every single time — a true infinite loop, not just a longer one.
 */
export function createGrindStreakNeverResetsMineRun(
  opts: Parameters<typeof createMineRun>[0] = {}
): GameEngine<MineRunState, MineRunMove, MineRunView> {
  const base = createMineRun(opts);
  return {
    ...base,
    apply(state, moves, rng) {
      const move = moves.get(0);
      if (move && move.t === "bank" && state.streakLen >= 1) {
        // BUG: credits the streak into banked but leaves streakLen/streakValue (and
        // everything else — mines/revealed/exploded/revealsLeft) untouched, so `bank` stays
        // legal and stays worth the exact same amount, forever.
        return {
          ...state,
          banked: state.banked + state.streakValue,
          lastEffects: [{ type: "banked", points: state.streakValue }],
        };
      }
      return base.apply(state, moves, rng);
    },
  };
}

/**
 * Grind-probe NEGATIVE fixture (platform-corrections.md C9's "verified clean in the over-fire
 * direction" claim, made concrete): the SAME bank-legal-at-streak-0/zero-delta shape as
 * `createGrindBrokenMineRun`, except this variant also costs one unit of the reveal budget
 * per use (and is gated on `revealsLeft > 0`). A single repeat of this move looks IDENTICAL
 * to the genuine unbounded farm above (legal, zero score delta) — the only difference is that
 * this one is bounded: it can repeat at most `revealsLeft` times before becoming illegal, so
 * a correct fix must NOT flag it, no matter how many times it happens to repeat before that.
 */
export function createGrindBoundedStreakZeroBankMineRun(
  opts: Parameters<typeof createMineRun>[0] = {}
): GameEngine<MineRunState, MineRunMove, MineRunView> {
  const base = createMineRun(opts);
  return {
    ...base,
    legalMoves(state, player) {
      const moves = base.legalMoves(state, player);
      if (player === 0 && state.revealsLeft > 0 && !moves.some((m) => m.t === "bank")) {
        return [...moves, { t: "bank" }];
      }
      return moves;
    },
    isLegal(state, player, move) {
      if (player === 0 && move.t === "bank" && state.streakLen === 0) return state.revealsLeft > 0;
      return base.isLegal(state, player, move);
    },
    apply(state, moves, rng) {
      const move = moves.get(0);
      if (move && move.t === "bank" && state.streakLen === 0) {
        // Same "bank legal at streak 0" bug as createGrindBrokenMineRun, but BOUNDED: costs
        // one unit of the reveal budget every time, so it runs out.
        return { ...state, revealsLeft: state.revealsLeft - 1, lastEffects: [{ type: "banked", points: 0 }] };
      }
      return base.apply(state, moves, rng);
    },
  };
}

/**
 * Always-Safe mutant, via a legitimate tuning lever rather than a code bug (docs/plans/
 * mine-run.md §4.2's own "tuning levers" note: "If the gap is too large... lower density").
 * At very low mine density almost every cell is provably safe by deduction alone (the CSP's
 * frontier rarely constrains anything), so Always-Safe's habit of "never carry a streak into
 * an unproven reveal" costs it almost nothing — there is essentially no real risk decision
 * left for Strong to exploit. Returned alongside a "healthy" config at a realistic density so
 * a test can assert the RATIO responds to the same lever the design doc describes.
 */
export function createAlwaysSafeHealthyMineRun(): GameEngine<MineRunState, MineRunMove, MineRunView> {
  // 6x6 board, 8 mines ~= 22% density — comparable to Mine Run's real 20% launch density.
  // The reveal budget (24, less than the 36-cell board) is deliberately tighter than the
  // cell count so revealsLeft scarcity is a real constraint, not just deduction exhaustion —
  // a 4x4/budget==totalCells configuration was tried first and showed no separation at all
  // (see the harness handoff report): with no reveal scarcity, both Always-Safe and any
  // Strong agent simply clear the whole board regardless of policy. `assertRevealBudgetScarcity`
  // (platform-corrections.md C6's "also record" note) turns that observation into an enforced
  // precondition rather than a comment someone could silently invalidate later.
  assertRevealBudgetScarcity(24, 6 * 6);
  return createMineRun({ width: 6, height: 6, mines: 8, budget: 24 });
}

export function createAlwaysSafeBrokenMineRun(): GameEngine<MineRunState, MineRunMove, MineRunView> {
  // Same board/budget, 2 mines ~= 5.5% density — deduction alone clears nearly the whole
  // board, so Always-Safe's conservative "never carry a streak into an unproven reveal"
  // costs it nothing.
  assertRevealBudgetScarcity(24, 6 * 6);
  return createMineRun({ width: 6, height: 6, mines: 2, budget: 24 });
}

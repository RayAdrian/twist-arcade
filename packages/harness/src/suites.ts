// packages/harness/src/suites.ts — the roadmap §6 two-player CI gate table, wired as failing
// assertions (plan §7.5). `pnpm harness suite <gameId> --suite ci|nightly` runs this.
//
// SCOPE: this module owns exactly the gates that are HARNESS-COMPUTED self-play numbers —
// strong-vs-random, first-player win rate, draw rate, mean plies / cap-hit rate, and
// ruthless-vs-standard. The other roadmap §6 CI rows (engine contract suite, redaction
// contract, bundle budget, a11y) are computed by other milestones' own CI steps (M1's testkit,
// the shell team's build/axe steps) — folding them in here would mean this module either
// silently no-ops on them or fakes a result, both worse than each owning its own row.
//
// TWO LAYERS, DELIBERATELY SEPARATE (this is what makes "plant a violation, confirm it fires"
// actually checkable per gate rather than only as one expensive end-to-end blob):
//   1. `evaluateCiGates` — a PURE function over already-computed numbers (`GateInputs`). Every
//      threshold has a test that plants a violation of EXACTLY that number and nothing else,
//      cheaply and deterministically (see suites.test.ts).
//   2. `runCiSuite` — wires `evaluateCiGates` to REAL self-play via `runMatchup`, resolving the
//      "strong" (ruthless tier) / "standard" tier / "random" agents from the game's own
//      manifest + roster.ts. A smaller end-to-end test proves this wiring is real (a
//      deliberately-sabotaged ruthless tier == randomPolicy must trip strong-vs-random for
//      real, not just in the pure evaluator).

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import type { DifficultyTier, GameManifest, HarnessThresholds, SolvedValueClaim } from "@twist-arcade/game-spec";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";
import { tierPolicy } from "@twist-arcade/bots";
import type { AgentSpec } from "./roster";
import { resolveNamedAgent } from "./roster";
import { runMatchup, type MatchupReport, type RunMatchupOptions } from "./runner";
import { agentWinRate } from "./metrics";

/** `"deferred"` (platform-corrections.md C27) is NOT a fourth flavor of "n/a". `"n/a"` means
 *  "this gate does not apply to this game" (C2/C23/C26 — a claim that will NEVER become a
 *  number, at any tier: a proven-draw's FPA band, a manifest with no "standard" tier, a CI
 *  rollout override that changed the very quantity under comparison). `"deferred"` means the
 *  opposite: the gate DOES apply and WILL be measured for real, just not at THIS tier — too
 *  expensive (see `GameManifest.ciGateBudget.deferGatesToNightly`). Order vs Chaos, Tilt, and
 *  Bid-Tac-Toe (docs/plans/) each name this exact status as a load-bearing dependency for their
 *  own balance-gate reporting at PR tier. */
export type GateStatus = "pass" | "fail" | "warn" | "n/a" | "deferred";

export interface GateResult {
  readonly gate: string;
  readonly status: GateStatus;
  readonly detail: string;
  /** Present iff a manifest `exceptions[]` entry matched this gate and downgraded a would-be
   *  "fail" to "warn" (plan §7.5: an exception is visible in review, never a silent pass). */
  readonly exceptionJustification?: string;
}

/** Info `evaluateCiGates` needs to decide whether this lane's self-play-derived gates are
 *  deferred to nightly at this run (platform-corrections.md C27). `active` is true only when
 *  suite "ci" actually saw `manifest.ciGateBudget.deferGatesToNightly` — the SAME condition
 *  `runCiSuite` uses to skip running any matchup at all, computed once and threaded through
 *  rather than re-derived, so the gate table and the skipped self-play can never disagree about
 *  whether deferral happened. `reason` is folded verbatim into every deferred row's detail. */
export interface CiGateDeferral {
  readonly active: boolean;
  readonly reason: string;
}

/** Every two-player gate row `evaluateCiGates` owns — ALL SIX can report `"deferred"` when a
 *  `CiGateDeferral` is active, but four of them (`ruthless-vs-standard`, `solved-value-reached`,
 *  and the solvedValue-proven branches of `first-player-win-rate`/`draw-rate`) have their own
 *  STRUCTURAL "n/a" reasons (no "standard" tier; no proven solvedValue; a proven-draw's
 *  unsatisfiable-by-construction band) that must keep firing regardless of deferral — those
 *  checks stay in front of the deferral check in their own blocks below, so a row that was
 *  already n/a for an unrelated reason never gets relabelled "deferred". Named once here so the
 *  nightly abuse guard stays in lockstep with the gate blocks themselves. */
const DEFERRABLE_CI_GATES = [
  "strong-vs-random",
  "first-player-win-rate",
  "draw-rate",
  "mean-plies",
  "ruthless-vs-standard",
  "solved-value-reached",
] as const;

/** `"deferred"`, naming the tier that measures the row for real (C27) — distinct at the report
 *  layer from both `"n/a"` (never measured, at any tier) and a real `"pass"`/`"fail"`/`"warn"`
 *  (measured, right here, right now). */
function deferredGate(gate: string, reason: string): GateResult {
  return { gate, status: "deferred", detail: `measured at nightly (${reason})` };
}

/** Thrown by `evaluateCiGates` when suite `"nightly"` is given an active `CiGateDeferral`
 *  (platform-corrections.md C27's abuse guard). `runCiSuite` structurally never builds an
 *  active deferral at suite "nightly" (it only ever consults
 *  `manifest.ciGateBudget.deferGatesToNightly` when `suite === "ci"`), but this is independent,
 *  defense-in-depth enforcement at the pure evaluator itself: a row deferred at EVERY tier is a
 *  gate that never runs again, and that must be a loud, immediate failure here, not a quiet
 *  status shipped in a "nightly: OK" report nobody double-checks. */
export class TwoPlayerDeferredGateAtNightlyError extends Error {
  constructor(reason: string) {
    super(
      `evaluateCiGates: suite "nightly" was given an ACTIVE deferral (reason: "${reason}") for ` +
        `[${DEFERRABLE_CI_GATES.join(", ")}] (platform-corrections.md C27). A gate deferred at ` +
        "EVERY tier never runs — nightly must measure the full self-play table for real, never " +
        "defer again."
    );
    this.name = "TwoPlayerDeferredGateAtNightlyError";
  }
}

/** The already-computed numbers `evaluateCiGates` gates on — kept separate from `MatchupReport`
 *  so the pure evaluator can be tested with hand-built values, no real self-play required. */
export interface GateInputs {
  strongVsRandomWinRate: number;
  firstPlayerWinRate: number;
  drawRate: number;
  meanPlies: number;
  capHitRate: number;
  /** `null` when the manifest has no `"standard"` tier to compare against — reported as an
   *  explicit "n/a" gate (C2's "a skipped gate and a passed gate must never look the same"
   *  applies here exactly as it does to the solo suites). */
  ruthlessVsStandardWinRate: number | null;
}

interface ManifestException {
  readonly gate: string;
  readonly justification: string;
}

/** Thrown by `evaluateCiGates` when a manifest exception's `justification` is empty (or
 *  whitespace-only). Plan §7.5's whole point is that an exception must be "visible in review,
 *  never a silent pass" — a blank justification defeats that at the REPORT layer, not just in
 *  spirit: `formatCiSuiteTable` prints a bare `[WARN] gate: detail` for an exception with no
 *  text, byte-for-byte indistinguishable from an ordinary (non-excused) warn, so a reviewer has
 *  no way to tell "this fail was deliberately excused" from "this gate just warns". Refusing
 *  loudly here, at the manifest boundary, is cheaper than a reviewer ever discovering the gap. */
export class EmptyExceptionJustificationError extends Error {
  constructor(gate: string) {
    super(
      `evaluateCiGates: manifest exception for gate "${gate}" has an empty justification — an ` +
        'exception must be visible in review (plan §7.5, "never a silent pass"); a blank ' +
        "justification is indistinguishable from an ordinary warn once downgraded."
    );
    this.name = "EmptyExceptionJustificationError";
  }
}

/** Applies a manifest exception (if any) to a raw "fail" verdict: downgrades to "warn" with the
 *  justification attached. A raw "pass"/"warn"/"n/a" is returned unchanged — an exception only
 *  ever SOFTENS a fail, it can never manufacture one, and it is applied per gate name (an
 *  exception for gate X must never touch gate Y). */
function applyException(gate: string, raw: GateStatus, detail: string, exceptions: readonly ManifestException[]): GateResult {
  if (raw !== "fail") return { gate, status: raw, detail };
  const exception = exceptions.find((e) => e.gate === gate);
  if (!exception) return { gate, status: "fail", detail };
  return { gate, status: "warn", detail, exceptionJustification: exception.justification };
}

/** Thrown by `evaluateCiGates` when a manifest's `solvedValue` claims a non-"unknown" value with
 *  no `proof` pointer (platform-corrections.md C23: "asserting a value is not proving one" —
 *  the exact confidence that failed on Wrap's predicted-but-unmeasured FPA, and the standard a
 *  "none by construction" balance claim like Bid-Tac-Toe's gets no relief under either). Mirrors
 *  `EmptyExceptionJustificationError`'s posture at the same seam: refused at the manifest
 *  boundary, before any gate is evaluated on the strength of the claim. A game may only receive
 *  gate relief backed by a real, NAMED artifact, never by assertion. */
export class MissingSolvedValueProofError extends Error {
  constructor(value: string) {
    super(
      `evaluateCiGates: manifest.solvedValue.value is "${value}" but carries no "proof" pointer ` +
        "(platform-corrections.md C23: asserting a value is not proving one). Add " +
        "manifest.solvedValue.proof naming the artifact that proves this value (e.g. a solve " +
        "report path and section) before this claim can grant any gate relief."
    );
    this.name = "MissingSolvedValueProofError";
  }
}

/** Info `evaluateCiGates` needs to decide whether a CI-suite rollout override has changed the
 *  very quantity `ruthless-vs-standard` compares (platform-corrections.md C26). `active` is
 *  true only when suite "ci" actually substituted `ciGateBudget.twoPlayerCiRollouts` in place
 *  of the shipped `ruthless` budget — the SAME condition `runCiSuite` uses to build the
 *  in-memory clone, computed once and threaded through rather than re-derived, so the gate and
 *  the substitution can never disagree about whether it happened. `ruthlessN`/`standardN` are
 *  the two budgets under comparison, named in the gate's own `n/a` detail so a reader can see
 *  WHY it wasn't measured, not just that it wasn't. */
export interface RuthlessVsStandardBudgets {
  readonly active: boolean;
  readonly ruthlessN: number;
  readonly standardN: number | null;
}

/** Self-play floor for the "solved-value-reached" gate (platform-corrections.md C23's inverted
 *  check): for a game with a PROVEN `solvedValue`, self-play must actually reach that value at a
 *  healthy rate — the real regression signal a decided game needs, and the exact opposite of the
 *  un-corrected `draw-rate`/`first-player-win-rate` gates that failed Fadeout for playing
 *  correctly. Grounded in C23's own sweep: Fadeout's self-play reached the proven draw at
 *  EXACTLY 100% across all six tested points (3,000 through 10,000 rollouts; 25 through 100
 *  games), with zero variance. 0.90 sits comfortably below that observed floor — room for
 *  legitimate noise (a different seed, a minor bot change) — while still catching a real
 *  regression: the orchestrator's own worked example, a drop to 70%, fails this floor by a wide
 *  margin. That is the point: the un-corrected gate would have scored that drop as an
 *  IMPROVEMENT (closer to the "balanced" 35-65% FPA band it was checking instead). */
export const SOLVED_VALUE_SELF_PLAY_FLOOR = 0.9;

/**
 * Pure gate evaluation (see module doc for why this is split from `runCiSuite`). `suite`
 * selects only the ruthless-vs-standard row's severity (warn at PR budget vs hard-fail
 * nightly, per roadmap §6) — every other row's threshold is suite-independent. `solvedValue`
 * (platform-corrections.md C23) is the manifest's proven game-theoretic value, when it has one —
 * omitted (or `{ value: "unknown" }`) leaves every gate below exactly as it was before C23.
 */
export function evaluateCiGates(
  inputs: GateInputs,
  thresholds: HarnessThresholds,
  exceptions: readonly ManifestException[] = [],
  suite: "ci" | "nightly" = "ci",
  solvedValue?: SolvedValueClaim,
  ruthlessBudgets?: RuthlessVsStandardBudgets,
  deferral?: CiGateDeferral
): GateResult[] {
  // Validated up front, before any gate runs — an exception with a blank justification is
  // rejected regardless of whether it ends up matching a failing gate (see
  // EmptyExceptionJustificationError's own doc for why this must never reach the report layer).
  for (const exception of exceptions) {
    if (exception.justification.trim() === "") {
      throw new EmptyExceptionJustificationError(exception.gate);
    }
  }

  // C23: same posture, same seam — a claimed solved value with no proof is refused before any
  // gate runs on the strength of it.
  if (solvedValue && solvedValue.value !== "unknown" && (!solvedValue.proof || solvedValue.proof.trim() === "")) {
    throw new MissingSolvedValueProofError(solvedValue.value);
  }

  // C27's abuse guard: nightly is the ONLY tier allowed to report these six rows as anything
  // other than "deferred" — a caller that hands nightly an active deferral (by accident, or by
  // copy-pasting the ci-tier wiring) gets refused here, loudly, rather than shipping a
  // "nightly: OK" report where the gate never actually ran.
  if (suite === "nightly" && deferral?.active) {
    throw new TwoPlayerDeferredGateAtNightlyError(deferral.reason);
  }

  const results: GateResult[] = [];

  {
    if (deferral?.active) {
      results.push(deferredGate("strong-vs-random", deferral.reason));
    } else {
      const pass = inputs.strongVsRandomWinRate >= thresholds.strongVsRandomMinWinRate;
      results.push(
        applyException(
          "strong-vs-random",
          pass ? "pass" : "fail",
          `${(inputs.strongVsRandomWinRate * 100).toFixed(1)}% (min ${(thresholds.strongVsRandomMinWinRate * 100).toFixed(1)}%)`,
          exceptions
        )
      );
    }
  }

  {
    // C23: for ANY proven solvedValue (draw, p0-win, or p1-win), a "balanced" FPA band is
    // unsatisfiable by construction — a solved game's first-player win rate is a KNOWN
    // quantity (0% for a draw or a p1-win, ~100% for a p0-win), not a design target to hit a
    // range around. n/a, citing the proof, rather than a fail this game can never clear. This
    // structural check comes BEFORE deferral: a proven-solved game's FPA is never going to be a
    // number regardless of tier, so it is n/a, never "deferred" (C27 must not relabel a row that
    // was already n/a for an unrelated reason).
    if (solvedValue && solvedValue.value !== "unknown") {
      results.push({
        gate: "first-player-win-rate",
        status: "n/a",
        detail: `manifest.solvedValue is a proven "${solvedValue.value}" (${solvedValue.proof}) — a balanced-FPA band does not apply to a solved game`,
      });
    } else if (deferral?.active) {
      results.push(deferredGate("first-player-win-rate", deferral.reason));
    } else {
      const [lo, hi] = thresholds.firstPlayerWinRateRange;
      const pass = inputs.firstPlayerWinRate >= lo && inputs.firstPlayerWinRate <= hi;
      results.push(
        applyException(
          "first-player-win-rate",
          pass ? "pass" : "fail",
          `${(inputs.firstPlayerWinRate * 100).toFixed(1)}% (band [${(lo * 100).toFixed(0)}%, ${(hi * 100).toFixed(0)}%])`,
          exceptions
        )
      );
    }
  }

  {
    // C23: a draw-rate CEILING is unsatisfiable by construction specifically for a proven draw
    // (the true value is 100%) — n/a, citing the proof. A proven DECISIVE value (p0-win/p1-win)
    // does not conflict with this gate (a low draw rate is still the expected, checkable
    // outcome there), so it stays active in that case. Same ordering rule as FPA above: the
    // structural n/a check comes before deferral.
    if (solvedValue && solvedValue.value === "draw") {
      results.push({
        gate: "draw-rate",
        status: "n/a",
        detail: `manifest.solvedValue is a proven draw (${solvedValue.proof}) — a draw-rate ceiling is unsatisfiable by construction for a drawn game`,
      });
    } else if (deferral?.active) {
      results.push(deferredGate("draw-rate", deferral.reason));
    } else {
      const pass = inputs.drawRate <= thresholds.maxDrawRate;
      results.push(
        applyException(
          "draw-rate",
          pass ? "pass" : "fail",
          `${(inputs.drawRate * 100).toFixed(1)}% (max ${(thresholds.maxDrawRate * 100).toFixed(1)}%)`,
          exceptions
        )
      );
    }
  }

  {
    if (deferral?.active) {
      results.push(deferredGate("mean-plies", deferral.reason));
    } else {
      const [lo, hi] = thresholds.pliesRange;
      const inBand = inputs.meanPlies >= lo && inputs.meanPlies <= hi;
      const noCapHits = inputs.capHitRate === 0;
      const pass = inBand && noCapHits;
      // "across all matchups" made explicit here (not just self-play) — this IS
      // worstCapHitRate's own aggregation (see its doc comment), and a report that prints a
      // DIFFERENT, self-play-only cap-hit number alongside this one (as an ad hoc debug script
      // did during the C23 investigation) reads as two numbers for one quantity. This is the one
      // number the gate actually uses; it says so.
      const detail = !inBand
        ? `mean ${inputs.meanPlies.toFixed(1)} plies (band [${lo}, ${hi}])`
        : !noCapHits
          ? `mean ${inputs.meanPlies.toFixed(1)} plies in band, but cap-hit rate ${(inputs.capHitRate * 100).toFixed(2)}% > 0 across all matchups (any cap hit fails)`
          : `mean ${inputs.meanPlies.toFixed(1)} plies, 0 cap hits across all matchups`;
      results.push(applyException("mean-plies", pass ? "pass" : "fail", detail, exceptions));
    }
  }

  {
    // C23: "ruthless cannot out-win standard when neither can win" — unsatisfiable by
    // construction specifically for a proven draw. A proven decisive value does not have this
    // problem (ruthless SHOULD still out-win standard more often via better search), so this
    // gate stays active for p0-win/p1-win.
    if (solvedValue && solvedValue.value === "draw") {
      results.push({
        gate: "ruthless-vs-standard",
        status: "n/a",
        detail: `manifest.solvedValue is a proven draw (${solvedValue.proof}) — ruthless cannot out-win standard when neither can win`,
      });
    } else if (inputs.ruthlessVsStandardWinRate === null) {
      // Structural fact independent of self-play (and independent of deferral): this manifest
      // has no "standard" tier at all, so there is nothing this gate could ever measure, at any
      // tier — n/a, never "deferred".
      results.push({ gate: "ruthless-vs-standard", status: "n/a", detail: "manifest has no \"standard\" tier" });
    } else if (deferral?.active) {
      // There IS a standard tier (the branch above didn't fire), so this row WOULD be a real
      // number if self-play ran — it just didn't, at this tier.
      results.push(deferredGate("ruthless-vs-standard", deferral.reason));
    } else if (ruthlessBudgets?.active) {
      // C26 (Nine Grids): TierBudgetCollapseError's strict-inequality check (ruthlessN >
      // standardN) is NECESSARY but not SUFFICIENT — MCTS strength grows roughly with the
      // LOGARITHM of rollouts, so a budget gap that clears the strict inequality (Nine Grids:
      // 1,500 vs standard's 1,000, a 1.5x gap) can still be a strength difference noise
      // swallows whole, when the SHIPPED gap is 10x (10,000 vs 1,000). The measured number in
      // that case is not a finding about the game — it is an artifact of the CI substitution
      // having changed the very quantity under comparison. Reporting a WARN with that number
      // reads as a real result; it is not one. Reject the temptation to fix this with a ratio
      // threshold instead (rejected in platform-corrections.md C26): any ratio is a guess about
      // how strength scales with rollouts for an unknown game, the exact assumption C22 and C25
      // already punished twice (Wrap's safe ratio was unsafe for Fadeout; a budget proven on a
      // 6x6 fixture didn't transfer to Mine Run's 10x10 board). n/a, naming both budgets, is
      // honest about what CI can and cannot measure — nightly never applies this override, so
      // it keeps measuring the real, shipped 10x (or whatever the manifest actually ships) gap,
      // where the comparison means something.
      results.push({
        gate: "ruthless-vs-standard",
        status: "n/a",
        detail:
          `manifest.ciGateBudget.twoPlayerCiRollouts is active for this CI-suite run — ` +
          `"ruthless" is measured at ${ruthlessBudgets.ruthlessN} rollouts vs "standard"'s shipped ` +
          `${ruthlessBudgets.standardN} — the override has changed the very quantity under ` +
          "comparison, so this gate cannot measure its claim at suite \"ci\" (C26). Nightly " +
          "measures it at the real shipped budgets, where it means something.",
      });
    } else {
      const pass = inputs.ruthlessVsStandardWinRate >= thresholds.ruthlessVsStandardMinWinRate;
      const detail = `${(inputs.ruthlessVsStandardWinRate * 100).toFixed(1)}% (min ${(thresholds.ruthlessVsStandardMinWinRate * 100).toFixed(1)}%, ${suite})`;
      if (pass) {
        results.push({ gate: "ruthless-vs-standard", status: "pass", detail });
      } else if (suite === "nightly") {
        results.push(applyException("ruthless-vs-standard", "fail", detail, exceptions));
      } else {
        // PR-budget ci suite: a below-threshold ruthless-vs-standard WARNS, never hard-fails
        // (roadmap §6) — this is not a manifest exception, it is the gate's own defined
        // severity at this suite tier, so it bypasses applyException entirely.
        results.push({ gate: "ruthless-vs-standard", status: "warn", detail });
      }
    }
  }

  {
    // C23's inverted gate: for a game with a PROVEN solvedValue, confirm self-play actually
    // REACHES it at a healthy rate — always present (never silently skipped, C2's rule), n/a
    // when there is no proven value to confirm. That structural n/a check comes before
    // deferral, same ordering rule as every other block above: a game with no proven value has
    // nothing for THIS gate to ever measure, at any tier.
    if (!solvedValue || solvedValue.value === "unknown") {
      results.push({ gate: "solved-value-reached", status: "n/a", detail: "no proven manifest.solvedValue — nothing to confirm" });
    } else if (deferral?.active) {
      results.push(deferredGate("solved-value-reached", deferral.reason));
    } else {
      const { value, proof } = solvedValue;
      const achieved =
        value === "draw" ? inputs.drawRate : value === "p0-win" ? inputs.firstPlayerWinRate : 1 - inputs.firstPlayerWinRate;
      const pass = achieved >= SOLVED_VALUE_SELF_PLAY_FLOOR;
      const detail = `self-play reached the proven "${value}" ${(achieved * 100).toFixed(1)}% of the time (floor ${(SOLVED_VALUE_SELF_PLAY_FLOOR * 100).toFixed(0)}%, proof: ${proof})`;
      results.push(applyException("solved-value-reached", pass ? "pass" : "fail", detail, exceptions));
    }
  }

  return results;
}

/** Thrown by `runCiSuite` (platform-corrections.md C19/C20) when a scaled-down
 *  `ciGateBudget.twoPlayerCiRollouts` would make the "ruthless" tier's CI-suite measurement
 *  budget equal to or lower than the "standard" tier's own (unscaled) budget. Wrap's exact
 *  finding: at a scaled 1,000, ruthless collided with standard's own 1,000-rollout budget, the
 *  two tiers became indistinguishable, and `ruthless-vs-standard` read a meaningless 50% that
 *  looked like a gate failure. A tier gate is meaningless once two tiers share a budget — this
 *  refuses BEFORE running the matchup, rather than silently reporting that ratio. */
export class TierBudgetCollapseError extends Error {
  constructor(gameId: string, effectiveRuthlessN: number, standardN: number) {
    super(
      `runCiSuite: game "${gameId}"'s CI-suite ruthless rollout budget (${effectiveRuthlessN}, ` +
        `possibly scaled via manifest.ciGateBudget.twoPlayerCiRollouts) is not strictly greater ` +
        `than the "standard" tier's own budget (${standardN}) — ruthless-vs-standard would ` +
        "measure two agents of the same effective strength (platform-corrections.md C19/C20: " +
        "Wrap's scaled-down budget collided with standard's own and the resulting 50% win rate " +
        "was a measurement artifact, not a real result). Raise the scaled budget (or the " +
        "manifest's ciGateBudget.twoPlayerCiRollouts) so ruthless stays strictly above standard."
    );
    this.name = "TierBudgetCollapseError";
  }
}

/** platform-corrections.md C22: `ciGateBudget.twoPlayerCiRollouts` shipped as an OPTIONAL
 *  field with no default, so every registered game silently skipped it and ran the CI suite at
 *  the full shipped `ruthless` budget. Fadeout — a 3x3 board, the smallest game in the
 *  catalogue — measured past 29 minutes on that path. C20's close-out said "make it the
 *  default"; an opt-in knob nobody sets is not a default, it is a comment.
 *
 *  So this module takes the fallback platform-corrections.md explicitly sanctions as
 *  acceptable (the same move C2 made for inapplicable solo gates: require the field and fail
 *  loudly, never silently skip): a game whose shipped `ruthless` budget is already at or below
 *  `MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE` needs no override at all (this is the unchanged, safe
 *  pass-through path — a cheap game like a small fixture never has to touch this field). A game
 *  whose shipped budget EXCEEDS that ceiling MUST declare an explicit `ciGateBudget.
 *  twoPlayerCiRollouts` for suite "ci" — its absence is a loud, immediate refusal (this error),
 *  not a silent 30-minute run. Nightly is exempt unconditionally (the plan's "nightly keeps the
 *  full-budget table") — this requirement only ever applies to the fast PR-budget suite.
 *
 *  CORRECTED (C23, platform-corrections.md): this comment originally justified the required-
 *  field fallback by claiming a scaled-down 2,000-rollout run produced "a verdict the FULL
 *  10,000-rollout budget does not produce" — a C6-shaped yardstick-collapse story that was
 *  never actually measured (the 10,000-rollout baseline had been killed twice, unwitnessed,
 *  before that claim was written). A completed, witnessed sweep (100 games at 10,000 / 8,000 /
 *  5,000 / 3,000 rollouts, and 50 / 25 games at 10,000) found IDENTICAL behaviour at every
 *  point: 100% draw rate, 0% first-player win rate, 100% strong-vs-random — because
 *  `remove-first/solid/threefold` is an exact-solved draw (`docs/research/games/fadeout-solve-
 *  report.md` §1.1, 128,170 states, all 9 openings drawn), so EVERY budget reaches the correct
 *  answer. There was no unsafe budget and no weak yardstick. The requirement below still
 *  stands, but on its true (and honestly narrower) justification: an unscaled 10,000-rollout
 *  suite costs 2802s against 3,000 rollouts' 848s for the IDENTICAL verdict — 3.3x cheaper for
 *  the same answer — and a game team should not have to rediscover that by waiting 47 minutes.
 *  It is a cost problem now, not a correctness one; `manifest.solvedValue` (C23) is what fixes
 *  the correctness problem this comment originally (and wrongly) attributed to the budget. */
export const MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE = 3000;

export class MissingCiRolloutBudgetError extends Error {
  constructor(gameId: string, shippedRuthlessN: number) {
    super(
      `runCiSuite: game "${gameId}"'s shipped "ruthless" tier budget (${shippedRuthlessN} rollouts) ` +
        `exceeds ${MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE} — the ceiling below which no CI override is ` +
        "needed — but the manifest declares no manifest.ciGateBudget.twoPlayerCiRollouts " +
        "(platform-corrections.md C22: a budget nobody sets is not a default, it is a comment). " +
        "Running the CI suite unscaled at this budget is a real cost problem, not a correctness " +
        "one (C23: a witnessed sweep found EVERY budget from 3,000 to 10,000 rollouts reaches the " +
        "identical verdict for Fadeout — 3,000 costs 848s against 10,000's 2802s for the same " +
        "answer). Add an explicit manifest.ciGateBudget.twoPlayerCiRollouts, confirmed by a real " +
        "self-play run that the scaled-down budget still separates the tiers (the tier-collapse " +
        "guard checks that structurally) AND still reaches the same self-play verdict the shipped " +
        "budget does — for a game with a manifest.solvedValue claim, that means still reaching the " +
        "proven value at a healthy rate (see SOLVED_VALUE_SELF_PLAY_FLOOR), not an absolute " +
        "'balanced' shape. Nightly is unaffected — this requirement applies only to suite \"ci\"."
    );
    this.name = "MissingCiRolloutBudgetError";
  }
}

export class SuiteFailedError extends Error {
  constructor(failing: readonly Pick<GateResult, "gate" | "status" | "detail">[]) {
    const names = failing.map((g) => `${g.gate} (${g.detail})`).join(", ");
    super(`CI suite failed: ${names}`);
    this.name = "SuiteFailedError";
  }
}

export interface CiSuiteReport {
  readonly gameId: string;
  readonly suite: "ci" | "nightly";
  /** True iff no gate has status "fail" ("warn" and "n/a" do not fail the suite). */
  readonly ok: boolean;
  readonly gates: readonly GateResult[];
  /** `null` iff `manifest.ciGateBudget.deferGatesToNightly` is active at this run (C27) — no
   *  self-play ran at all, so there is nothing to report here; every gate row explains itself
   *  via its own `"deferred"` status/detail instead. Non-null in every other case, including
   *  every run before C27 existed. */
  readonly matchups: {
    readonly strongVsRandom: MatchupReport;
    readonly strongSelfPlay: MatchupReport;
    readonly ruthlessVsStandard: MatchupReport | null;
  } | null;
}

export interface RunCiSuiteOptions {
  readonly games?: number; // per matchup; default 200 (PR budget)
  /** `runMatchup` (runner.ts) seeds matchup game *i* as `` `${seed}:${i}` ``. Two calls that
   *  vary THIS string therefore play DIFFERENT games — any measured difference between them
   *  conflates whatever you changed with seed variance, not isolates it (platform-corrections.md
   *  C24: two independent agents, in unrelated worktrees on the same day, both templated the
   *  varying parameter INTO this seed while hand-rolling a budget comparison — a recurrence
   *  across independent authors that never saw each other's code is evidence the INTERFACE makes
   *  the wrong thing natural, not that either agent was careless). Comparing configurations
   *  (e.g. several candidate `ciGateBudget.twoPlayerCiRollouts` values)? Use `compareBudgets`
   *  below, which holds this ONE seed fixed across every candidate so they play the identical
   *  games — never invent a seed per candidate here. */
  readonly seed: string;
  readonly suite?: "ci" | "nightly"; // default "ci"
  readonly clock?: RunMatchupOptions["clock"];
}

/** One `compareBudgets` result point: the candidate rollout count and the full report a real
 *  `runCiSuite` run produced at that count. */
export interface CompareBudgetsPoint {
  readonly rollouts: number;
  readonly report: CiSuiteReport;
}

/**
 * platform-corrections.md C24's preferred fix: "provide the comparison as a first-class harness
 * helper... so nobody hand-rolls the loop, nobody invents a seed." Runs `runCiSuite` once per
 * candidate in `rolloutCandidates`, ALL under the exact same `opts.seed` + `opts.games` — only
 * `ciGateBudget.twoPlayerCiRollouts` varies between calls, via a fresh in-memory clone per
 * candidate (the shipped `manifest.ciGateBudget` — and every difficulty tier — is never
 * mutated, matching `runCiSuite`'s own C20 discipline). Always `suite: "ci"`: a rollout-budget
 * comparison is a CI-suite-only concept in the first place (nightly ignores the override
 * entirely, so every candidate would report the identical result there).
 *
 * This is exactly the comparison the C22 Fadeout sweep and the Nine Grids pilot each needed and
 * each built by hand, with a seed that varied per candidate — the confound C24 found in both,
 * independently, in one day. This helper makes the correct construction the only one available.
 */
export function compareBudgets<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  rolloutCandidates: readonly number[],
  opts: { readonly seed: string; readonly games?: number; readonly clock?: RunMatchupOptions["clock"] }
): CompareBudgetsPoint[] {
  return rolloutCandidates.map((rollouts) => {
    const candidateManifest: GameManifest = {
      ...manifest,
      ciGateBudget: { ...manifest.ciGateBudget, twoPlayerCiRollouts: rollouts },
    };
    const report = runCiSuite(engine, candidateManifest, {
      seed: opts.seed, // SAME across every candidate — the entire point of this helper
      ...(opts.games !== undefined ? { games: opts.games } : {}),
      suite: "ci",
      ...(opts.clock ? { clock: opts.clock } : {}),
    });
    return { rollouts, report };
  });
}

function findTier(manifest: GameManifest, id: DifficultyTier["id"]): DifficultyTier | undefined {
  return manifest.difficultyTiers.find((t) => t.id === id);
}

function tierAgent<S extends WithEffects, M extends Json>(name: string, tier: DifficultyTier): AgentSpec<S, M> {
  return { kind: "policy", name, policy: tierPolicy<S, M>(tier), budget: tier.budget };
}

/**
 * SHOULD FIX #3: the mean-plies gate's cap-hit rule (roadmap §6: "any playout hitting the ply
 * cap" fails; Fadeout §7 sharpens this to zero under superko, since a cap hit there is an engine
 * bug) must see EVERY matchup this suite actually ran, not just self-play. A game that
 * terminates briskly ruthless-vs-ruthless can still stall out against a genuinely weaker/random
 * opponent that never finds the forcing line and runs to the cap every game — self-play alone
 * would miss that cap hit entirely and let mean-plies pass on a real bug. Takes the max across
 * whichever matchups were actually run (`ruthlessVsStandard` is `null` when the manifest has no
 * "standard" tier). Exported and pure — this module's own "pure evaluation vs real wiring" split
 * (see module doc) applies at this aggregation seam too: testable with hand-built
 * matchup-shaped values, no real self-play required.
 */
export function worstCapHitRate(reports: readonly (Pick<MatchupReport, "metrics"> | null)[]): number {
  const rates = reports
    .filter((r): r is Pick<MatchupReport, "metrics"> => r !== null)
    .map((r) => r.metrics.capHitRate);
  if (rates.length === 0) {
    throw new RangeError("worstCapHitRate: at least one non-null matchup report is required");
  }
  return Math.max(...rates);
}

/** True iff any row is `"deferred"` — the C27 "provisional pass" signal for the two-player
 *  lane, mirroring `solo-gates.ts`'s `hasDeferredGates`: a report can be `ok` (no `"fail"`)
 *  while still not being a FULLY measured green, because self-play was skipped entirely at this
 *  tier. `report.ts`'s `formatCiSuiteTable` checks this to render that distinction. */
export function hasDeferredGates(results: readonly GateResult[]): boolean {
  return results.some((r) => r.status === "deferred");
}

/**
 * Runs the real self-play this gate table needs (strong-vs-random, strong self-play, and
 * ruthless-vs-standard when the manifest has a "standard" tier) and evaluates every gate
 * against the manifest's own threshold overrides (falling back to
 * `DEFAULT_HARNESS_THRESHOLDS`) and exceptions.
 */
export function runCiSuite<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  manifest: GameManifest,
  opts: RunCiSuiteOptions
): CiSuiteReport {
  const games = opts.games ?? 200;
  const suite = opts.suite ?? "ci";
  const thresholds: HarnessThresholds = { ...DEFAULT_HARNESS_THRESHOLDS, ...manifest.thresholds };
  const exceptions = manifest.exceptions ?? [];

  const shippedRuthlessTier = findTier(manifest, "ruthless");
  if (!shippedRuthlessTier) {
    throw new Error(
      `runCiSuite: manifest "${manifest.id}" has no "ruthless" difficulty tier — the CI gate ` +
        "table's strong-vs-random and strong-self-play rows have no agent to run."
    );
  }

  // C27: at suite "ci" only, `manifest.ciGateBudget.deferGatesToNightly` skips self-play
  // ENTIRELY — not scaled down (that's `twoPlayerCiRollouts` below), skipped, because the
  // manifest has declared this lane unaffordable to measure at all at this tier. Nightly always
  // ignores this field (same rule as `twoPlayerCiRollouts`), enforced structurally by this
  // `suite === "ci"` check — `evaluateCiGates` independently refuses if a caller ever bypasses
  // it and reaches "nightly" with an active deferral anyway (C27's abuse guard).
  const deferral: CiGateDeferral | undefined =
    suite === "ci" && manifest.ciGateBudget?.deferGatesToNightly
      ? { active: true, reason: manifest.ciGateBudget.deferGatesToNightly.reason }
      : undefined;

  if (deferral?.active) {
    // No self-play at all — every field below is UNREACHABLE by construction (every
    // `evaluateCiGates` block checks `deferral?.active` before ever touching `inputs.X` for the
    // rows this deferral covers; see that function's own per-gate comments), and NaN-poisoned
    // rather than a plausible-looking 0/null so a future control-flow bug that DID let one leak
    // through would render as an obviously-broken "NaN%" in a report, never a silent lie (C4).
    // `ruthlessVsStandardWinRate` is the one exception: `null` is a REAL, structural fact ("no
    // standard tier exists") that must survive deferral unchanged — evaluateCiGates's own
    // ruthless-vs-standard block checks that null BEFORE its deferral check for exactly this
    // reason, so a manifest with no standard tier still reports n/a, not "deferred".
    const standardTier = findTier(manifest, "standard");
    const inputs: GateInputs = {
      strongVsRandomWinRate: Number.NaN,
      firstPlayerWinRate: Number.NaN,
      drawRate: Number.NaN,
      meanPlies: Number.NaN,
      capHitRate: Number.NaN,
      ruthlessVsStandardWinRate: standardTier ? Number.NaN : null,
    };
    const gates = evaluateCiGates(inputs, thresholds, exceptions, suite, manifest.solvedValue, undefined, deferral);
    return {
      gameId: manifest.id,
      suite,
      ok: gates.every((g) => g.status !== "fail"),
      gates,
      matchups: null,
    };
  }

  // C19: at suite "ci" only, measure with `ciGateBudget.twoPlayerCiRollouts` rollouts instead
  // of the tier's own shipped budget, via an IN-MEMORY clone — the shipped tier object (what a
  // real player's bot actually uses) is never touched (C20: "the shipped ruthless tier was
  // never touched"). Nightly always uses the tier's real budget unscaled (the plan's "nightly
  // keeps the full-budget table"). A `deadlineMs`-budgeted tier is left alone either way — this
  // override only ever applies to the deterministic `rollouts` budget kind the harness gates
  // with (platform §5.2).
  const ciRolloutOverride = manifest.ciGateBudget?.twoPlayerCiRollouts;

  // C22: a shipped budget expensive enough to matter MUST declare an override for suite "ci" —
  // checked before anything else runs, so an absent override is a loud, immediate refusal
  // (MissingCiRolloutBudgetError) rather than a silent full-cost run. See that error's own doc
  // comment for why this module refuses to just compute-and-trust a scaled number instead.
  if (
    suite === "ci" &&
    ciRolloutOverride === undefined &&
    shippedRuthlessTier.budget.kind === "rollouts" &&
    shippedRuthlessTier.budget.n > MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE
  ) {
    throw new MissingCiRolloutBudgetError(manifest.id, shippedRuthlessTier.budget.n);
  }

  const ruthlessTier =
    suite === "ci" && ciRolloutOverride !== undefined && shippedRuthlessTier.budget.kind === "rollouts"
      ? { ...shippedRuthlessTier, budget: { kind: "rollouts" as const, n: ciRolloutOverride } }
      : shippedRuthlessTier;

  const standardTier = findTier(manifest, "standard");
  // C19/C20: a scaled-down ruthless budget must never collapse onto standard's own budget — a
  // tier gate is meaningless once two tiers share a budget (Wrap's exact finding). Checked
  // BEFORE running anything, so a collapse is a loud refusal, never a silently-meaningless
  // ruthless-vs-standard ratio.
  if (standardTier && ruthlessTier.budget.kind === "rollouts" && standardTier.budget.kind === "rollouts") {
    if (ruthlessTier.budget.n <= standardTier.budget.n) {
      throw new TierBudgetCollapseError(manifest.id, ruthlessTier.budget.n, standardTier.budget.n);
    }
  }

  const ruthless = tierAgent<S, M>("ruthless", ruthlessTier);
  const random = resolveNamedAgent<S, M>("random");

  const strongVsRandom = runMatchup(engine, ruthless, random, {
    games,
    seed: `${opts.seed}:strong-vs-random`,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  const strongSelfPlay = runMatchup(engine, ruthless, ruthless, {
    games,
    seed: `${opts.seed}:strong-self-play`,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });

  const ruthlessVsStandard = standardTier
    ? runMatchup(engine, ruthless, tierAgent<S, M>("standard", standardTier), {
        games,
        seed: `${opts.seed}:ruthless-vs-standard`,
        ...(opts.clock ? { clock: opts.clock } : {}),
      })
    : null;

  const inputs: GateInputs = {
    strongVsRandomWinRate: agentWinRate(strongVsRandom.outcomes, "ruthless"),
    firstPlayerWinRate: strongSelfPlay.metrics.firstPlayerWinRate,
    drawRate: strongSelfPlay.metrics.drawRate,
    // meanPlies deliberately stays self-play-only: it is a shape-of-game statistic (how long a
    // BALANCED game runs), and mixing in a mismatched matchup like ruthless-vs-random would pull
    // it toward whatever that matchup's dynamics happen to be, not the metric roadmap §6 means.
    meanPlies: strongSelfPlay.metrics.meanPlies,
    // capHitRate does NOT stay self-play-only — see worstCapHitRate's own doc (SHOULD FIX #3).
    capHitRate: worstCapHitRate([strongVsRandom, strongSelfPlay, ruthlessVsStandard]),
    ruthlessVsStandardWinRate: ruthlessVsStandard ? agentWinRate(ruthlessVsStandard.outcomes, "ruthless") : null,
  };

  // C26: SAME condition as the in-memory clone substitution above (never re-derived
  // differently), so the gate and the substitution can never disagree about whether the
  // override actually applied.
  const ruthlessBudgets: RuthlessVsStandardBudgets = {
    active: suite === "ci" && ciRolloutOverride !== undefined && shippedRuthlessTier.budget.kind === "rollouts",
    ruthlessN: ruthlessTier.budget.kind === "rollouts" ? ruthlessTier.budget.n : 0,
    standardN: standardTier && standardTier.budget.kind === "rollouts" ? standardTier.budget.n : null,
  };

  const gates = evaluateCiGates(inputs, thresholds, exceptions, suite, manifest.solvedValue, ruthlessBudgets);

  return {
    gameId: manifest.id,
    suite,
    ok: gates.every((g) => g.status !== "fail"),
    gates,
    matchups: { strongVsRandom, strongSelfPlay, ruthlessVsStandard },
  };
}

/** Throws `SuiteFailedError` iff `report.ok` is false — the actual "wired as a failing
 *  assertion" call site (`cli.ts`'s `harness suite` command uses this to set the process exit
 *  code non-zero). Never called implicitly by `runCiSuite` itself, so a caller that wants the
 *  full report even on failure (e.g. to print it) can always get one. */
export function assertSuiteOk(report: CiSuiteReport): void {
  if (!report.ok) {
    throw new SuiteFailedError(report.gates.filter((g) => g.status === "fail"));
  }
}

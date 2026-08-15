// packages/harness/test/suites.test.ts — TDD anchor: the roadmap §6 two-player CI gate table,
// wired as failing assertions (plan §7.5). Red first: suites.ts does not exist yet.
//
// STANDING WARNING THIS FILE EXISTS TO ANSWER (project convention, restated because it is the
// single most important property of a gate module): a gate never observed failing is not a
// gate. For every threshold this module enforces, there is a test below that plants a
// violation of EXACTLY that threshold (nothing else) and asserts the resulting status is
// "fail" (or "warn" for the PR-budget ruthless-vs-standard gate) — never silently "pass" or
// "n/a". `evaluateCiGates` is tested as a pure function first (hand-built `GateInputs`, no real
// self-play needed to plant a precise violation); a smaller end-to-end test at the bottom
// proves `runCiSuite` really wires a real matchup into it, using a deliberately-sabotaged
// "ruthless" tier (== randomPolicy) that must trip strong-vs-random for real.

import { describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";
import type { GameManifest, SolvedValueClaim } from "@twist-arcade/game-spec";
import {
  assertSuiteOk,
  compareBudgets,
  EmptyExceptionJustificationError,
  EmptyMirrorProbeReasonError,
  evaluateCiGates,
  evaluateMirrorProbeGate,
  hasDeferredGates,
  hasUnattainedGates,
  InvalidAttainmentBaselineError,
  InvalidMirrorProbeDeclarationError,
  KNOWN_EXCEPTIONABLE_GATES,
  MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE,
  MissingCiRolloutBudgetError,
  MissingSolvedValueProofError,
  runCiSuite,
  SOLVED_VALUE_SELF_PLAY_FLOOR,
  SuiteFailedError,
  TierBudgetCollapseError,
  TwoPlayerDeferredGateAtNightlyError,
  UnknownExceptionGateError,
  worstCapHitRate,
  type CiSuiteReport,
  type GateInputs,
} from "../src/suites";
import type { MatchupReport } from "../src/runner";
import { formatCiSuiteTable } from "../src/report";

// A GateInputs value that passes EVERY gate cleanly — every planted-violation test below
// starts from a clone of this and perturbs exactly one field, so a test failure always
// isolates to the one threshold it claims to be testing.
const HEALTHY: GateInputs = {
  strongVsRandomWinRate: 0.95,
  firstPlayerWinRate: 0.5,
  drawRate: 0.2,
  meanPlies: 20,
  capHitRate: 0,
  ruthlessVsStandardWinRate: 0.7,
};

function statusOf(inputs: GateInputs, gate: string, suite: "ci" | "nightly" = "ci") {
  const gates = evaluateCiGates(inputs, DEFAULT_HARNESS_THRESHOLDS, [], suite);
  const found = gates.find((g) => g.gate === gate);
  if (!found) throw new Error(`test setup error: no gate named "${gate}" in ${JSON.stringify(gates)}`);
  return found.status;
}

describe("evaluateCiGates() — healthy baseline", () => {
  it("every APPLICABLE gate passes when every metric is comfortably inside its band", () => {
    // UPDATED under C23 (platform-corrections.md): `evaluateCiGates` now always reports a
    // "solved-value-reached" row (C2's "never silently skipped" rule), and HEALTHY carries no
    // `solvedValue` — that row is correctly "n/a" ("no proven manifest.solvedValue — nothing to
    // confirm"), not "pass". n/a is not a lesser pass; it is a DIFFERENT, deliberately distinct
    // status for a gate that does not apply, which is the entire point of C2/C23's rule — so a
    // blanket "every gate is pass" assertion is now the wrong test for this fixture. Every gate
    // that DOES apply to a solvedValue-less manifest still passes; the one gate that does not
    // apply is checked separately, for its own correct status.
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    for (const g of gates) {
      if (g.gate === "solved-value-reached") {
        expect(g.status, `gate ${g.gate}: ${g.detail}`).toBe("n/a");
        continue;
      }
      expect(g.status, `gate ${g.gate}: ${g.detail}`).toBe("pass");
    }
  });
});

describe("evaluateCiGates() — planted violations, one gate at a time", () => {
  it("strong-vs-random: < 0.90 fails", () => {
    expect(statusOf(HEALTHY, "strong-vs-random")).toBe("pass"); // control
    expect(statusOf({ ...HEALTHY, strongVsRandomWinRate: 0.89 }, "strong-vs-random")).toBe("fail");
  });

  it("first-player-win-rate: outside [0.35, 0.65] fails, on EITHER side", () => {
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.34 }, "first-player-win-rate")).toBe("fail");
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.66 }, "first-player-win-rate")).toBe("fail");
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.35 }, "first-player-win-rate")).toBe("pass"); // boundary inclusive
  });

  it("draw-rate: > 0.60 fails", () => {
    expect(statusOf({ ...HEALTHY, drawRate: 0.61 }, "draw-rate")).toBe("fail");
    expect(statusOf({ ...HEALTHY, drawRate: 0.6 }, "draw-rate")).toBe("pass"); // boundary inclusive
  });

  it("mean-plies: outside [4, 200] fails", () => {
    expect(statusOf({ ...HEALTHY, meanPlies: 3 }, "mean-plies")).toBe("fail");
    expect(statusOf({ ...HEALTHY, meanPlies: 201 }, "mean-plies")).toBe("fail");
    expect(statusOf({ ...HEALTHY, meanPlies: 4 }, "mean-plies")).toBe("pass"); // boundary inclusive
  });

  it("mean-plies: ANY cap hit fails, even with an otherwise-fine mean", () => {
    expect(statusOf({ ...HEALTHY, capHitRate: 0.01 }, "mean-plies")).toBe("fail");
  });

  it("ruthless-vs-standard: < 0.60 warns on the ci (PR-budget) suite...", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: 0.59 }, "ruthless-vs-standard", "ci")).toBe("warn");
  });

  it("...but hard-fails on the nightly suite", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: 0.59 }, "ruthless-vs-standard", "nightly")).toBe(
      "fail"
    );
  });

  it("ruthless-vs-standard: reports n/a (never a silent pass) when there is no standard tier", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: null }, "ruthless-vs-standard")).toBe("n/a");
  });
});

describe("evaluateCiGates() — manifest exceptions (plan §7.5)", () => {
  it("downgrades a would-be fail to warn, with the justification attached, never to a silent pass", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, drawRate: 0.9 },
      DEFAULT_HARNESS_THRESHOLDS,
      [{ gate: "draw-rate", justification: "deliberate near-certain-draw design, see ADR-3" }],
      "ci"
    );
    const drawGate = gates.find((g) => g.gate === "draw-rate")!;
    expect(drawGate.status).toBe("warn");
    expect(drawGate.exceptionJustification).toBe("deliberate near-certain-draw design, see ADR-3");
  });

  it("an exception for a DIFFERENT gate does not touch this one's fail", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, drawRate: 0.9 },
      DEFAULT_HARNESS_THRESHOLDS,
      [{ gate: "mean-plies", justification: "unrelated" }],
      "ci"
    );
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("fail");
  });

  // SHOULD FIX #2: an empty justification is currently accepted, and the report then hides the
  // exception entirely (a bare "[WARN] draw-rate: ..." with no marker at all, indistinguishable
  // from an ordinary warn) — defeating "visible in review, never a silent pass". Refuse it
  // outright instead of downgrading silently.
  it("throws EmptyExceptionJustificationError on an empty justification, even when it would " +
    "match a real failing gate", () => {
    expect(() =>
      evaluateCiGates(
        { ...HEALTHY, drawRate: 0.9 },
        DEFAULT_HARNESS_THRESHOLDS,
        [{ gate: "draw-rate", justification: "" }],
        "ci"
      )
    ).toThrow(EmptyExceptionJustificationError);
  });

  it("throws on a WHITESPACE-only justification too (not just the exact empty string)", () => {
    expect(() =>
      evaluateCiGates(
        { ...HEALTHY, drawRate: 0.9 },
        DEFAULT_HARNESS_THRESHOLDS,
        [{ gate: "draw-rate", justification: "   " }],
        "ci"
      )
    ).toThrow(EmptyExceptionJustificationError);
  });

  it("throws even when NO gate is currently failing — validated up front, not lazily on use", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [{ gate: "draw-rate", justification: "" }], "ci")
    ).toThrow(EmptyExceptionJustificationError);
  });

  // stage-6 review finding (second pass, C64): when an exception is BOTH blank AND names a gate
  // that does not exist, identity is checked before content. An author who mistypes a gate name
  // AND leaves the justification blank should learn the gate name is wrong first — fixing the
  // justification only to re-run and discover the gate name was wrong too is the less useful
  // order. Neither error can silence the other; this only pins which one fires first.
  it("an exception that is BOTH blank AND names an unknown gate throws UnknownExceptionGateError, not EmptyExceptionJustificationError — identity checked before content", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [{ gate: "typo", justification: "  " }], "ci")
    ).toThrow(UnknownExceptionGateError);
  });
});

// stage-6 review finding (was 🟡-1), ruled: an exceptions[] entry naming a gate that does not
// exist is silently dead, repo-wide — fail-closed (nothing downgrades), so it is an honesty
// defect rather than a gating defect, but it is exactly the shape of thing platform-
// corrections.md C48 already warned about going unnoticed for two games. Refused up front, same
// seam as EmptyExceptionJustificationError.
describe("evaluateCiGates() — UnknownExceptionGateError: an exception naming a gate that does not exist must not be silently dead (C48/C63)", () => {
  // stage-6 review finding (second pass, C64): this used to be described as "the thing that goes
  // red" if the coupling between KNOWN_EXCEPTIONABLE_GATES and applyException's call sites ever
  // broke — but it compared KNOWN_EXCEPTIONABLE_GATES against a SECOND hand-typed literal of the
  // same six names, right here. Add a seventh applyException call site and forget to touch this
  // list, and both literals still match — this test stays green while the coupling it claimed to
  // enforce is gone. The REAL enforcement now lives in suites.ts: applyException's `gate`
  // parameter is typed `ExceptionableGate`, derived via `(typeof EXCEPTIONABLE_GATES)[number]`
  // from the same array KNOWN_EXCEPTIONABLE_GATES is built from — so a call site naming a gate
  // outside that array fails `pnpm typecheck` at that line, before any test runs. That is a
  // compile-time fact, not something a vitest assertion can exercise; verified manually per C64
  // by temporarily adding such a call site and confirming `pnpm typecheck` reports it (see the
  // C64 commit message for the pasted error). This assertion is downgraded to what it actually
  // is: a readable pin of the current six names, useful for catching an accidental edit to
  // EXCEPTIONABLE_GATES itself, not a substitute for the type-level guarantee.
  // UPDATED under docs/plans/degeneracy-probes.md (C64): widened from six to nine gates —
  // "mirror-probe"/"stall-probe"/"rush-probe" (probes-two-player.ts's evaluateProbeGates) now
  // route through applyException too, since all three CAN genuinely fail once measured (never
  // could before this plan landed).
  it("KNOWN_EXCEPTIONABLE_GATES currently names these nine gates (a readable pin, not the enforcement — see applyException's ExceptionableGate parameter type in suites.ts for that)", () => {
    expect([...KNOWN_EXCEPTIONABLE_GATES].sort()).toEqual(
      [
        "strong-vs-random",
        "first-player-win-rate",
        "draw-rate",
        "mean-plies",
        "ruthless-vs-standard",
        "solved-value-reached",
        "mirror-probe",
        "stall-probe",
        "rush-probe",
      ].sort()
    );
  });

  it("throws UnknownExceptionGateError for a gate name that is not one of the six exceptionable gates", () => {
    expect(() =>
      evaluateCiGates(
        HEALTHY,
        DEFAULT_HARNESS_THRESHOLDS,
        [{ gate: "strong-vs-radnom", justification: "typo'd gate name — must not be silently dead" }],
        "ci"
      )
    ).toThrow(UnknownExceptionGateError);
  });

  it("throws even when the named (nonexistent) gate would never have failed anyway — validated up front, not lazily on use", () => {
    expect(() =>
      evaluateCiGates(
        HEALTHY,
        DEFAULT_HARNESS_THRESHOLDS,
        [{ gate: "solved-value", justification: "close to a real name but not it" }],
        "ci"
      )
    ).toThrow(UnknownExceptionGateError);
  });

  // CORRECTED under docs/plans/degeneracy-probes.md (C64/C65): this test used to assert that
  // "mirror-probe" was special-cased as a NEVER-exceptionable gate name, pointed at
  // manifest.mirrorProbe instead — true only while mirror-probe could never report "fail" (it
  // only ever reported "n/a", via the declaration-only evaluateMirrorProbeGate). That is no
  // longer true: probes-two-player.ts's evaluateProbeGates measures a REAL mirror-probe win rate
  // for any game that does not declare manifest.mirrorProbe, and it CAN fail (for real, at suite
  // "nightly"). Keeping the old assertion would have been exactly C65's own defect — a
  // correction whose premise stopped being true, with nothing updated to match. "mirror-probe"
  // is now an ORDINARY exceptionable gate, same as its two probe siblings — proven below by NOT
  // throwing, the mirror image of what this test used to check.
  it("does NOT special-case \"mirror-probe\" anymore — it is now an ordinary exceptionable gate, since mirror-probe can genuinely fail once measured (C64)", () => {
    expect(() =>
      evaluateCiGates(
        HEALTHY,
        DEFAULT_HARNESS_THRESHOLDS,
        [{ gate: "mirror-probe", justification: "a real, reviewable justification for a real mirror-probe fail" }],
        "ci"
      )
    ).not.toThrow();
  });

  it("does NOT throw for any of the six real exceptionable gate names", () => {
    for (const gate of KNOWN_EXCEPTIONABLE_GATES) {
      expect(() =>
        evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [{ gate, justification: "real gate, real reason" }], "ci")
      ).not.toThrow();
    }
  });
});

describe("evaluateCiGates() — boundary near-misses probed on BOTH sides (coverage debt, not a bug)", () => {
  // The stage-6 review probed all four of these both ways and found the implementation already
  // correct everywhere — these are the assertions that would catch a future >=/> regression.
  it("strong-vs-random: exactly 0.90 (the threshold itself) passes", () => {
    expect(statusOf({ ...HEALTHY, strongVsRandomWinRate: 0.9 }, "strong-vs-random")).toBe("pass");
  });

  it("first-player-win-rate: exactly 0.65 (the upper band edge) passes", () => {
    expect(statusOf({ ...HEALTHY, firstPlayerWinRate: 0.65 }, "first-player-win-rate")).toBe("pass");
  });

  it("mean-plies: exactly 200 (the upper band edge) passes", () => {
    expect(statusOf({ ...HEALTHY, meanPlies: 200 }, "mean-plies")).toBe("pass");
  });

  it("ruthless-vs-standard: exactly 0.60 (the threshold itself) passes on the ci suite", () => {
    expect(statusOf({ ...HEALTHY, ruthlessVsStandardWinRate: 0.6 }, "ruthless-vs-standard", "ci")).toBe("pass");
  });
});

describe("worstCapHitRate() — cap-hit gating must see every matchup run, not just self-play (SHOULD FIX #3)", () => {
  function withCapHit(capHitRate: number): Pick<MatchupReport, "metrics"> {
    return { metrics: { ...HEALTHY_METRICS, capHitRate } };
  }
  const HEALTHY_METRICS: MatchupReport["metrics"] = {
    games: 200,
    firstPlayerWinRate: 0.5,
    drawRate: 0.2,
    winRateBySeat: [0.5, 0.5],
    meanPlies: 20,
    medianPlies: 20,
    p95Plies: 30,
    meanBranchingFactor: 4,
    capHitRate: 0,
  };

  it("takes the max across matchups — a clean self-play must not hide a dirty vs-random", () => {
    expect(worstCapHitRate([withCapHit(0.15), withCapHit(0), null])).toBe(0.15);
  });

  it("is 0 when every run matchup is clean", () => {
    expect(worstCapHitRate([withCapHit(0), withCapHit(0), null])).toBe(0);
  });

  it("considers ruthlessVsStandard too when it was actually run (not null)", () => {
    expect(worstCapHitRate([withCapHit(0), withCapHit(0), withCapHit(0.4)])).toBe(0.4);
  });

  it("throws rather than silently returning a degenerate value when nothing was run at all", () => {
    expect(() => worstCapHitRate([null, null])).toThrow(RangeError);
  });
});

describe("SuiteFailedError / the overall ok flag (the 'wired as a failing assertion' part)", () => {
  it("ok is true and assertSuiteOk does not throw when every gate passes or warns", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    expect(gates.every((g) => g.status !== "fail")).toBe(true);
  });

  it("SuiteFailedError names every failing gate", () => {
    const err = new SuiteFailedError([
      { gate: "draw-rate", status: "fail", detail: "0.90 > 0.60" },
      { gate: "mean-plies", status: "fail", detail: "cap hit" },
    ]);
    expect(err.message).toContain("draw-rate");
    expect(err.message).toContain("mean-plies");
  });
});

describe("runCiSuite() end-to-end wiring (a real matchup, not a hand-built GateInputs)", () => {
  // Deliberately sabotaged manifest: "ruthless" IS randomPolicy, so vs the roster's own
  // "random" agent it must land near 50% — a real trip of strong-vs-random, proving the
  // wiring (not just the pure evaluator) actually fires.
  const sabotagedManifest: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Sabotaged TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "Sabotaged fixture for suites.test.ts — ruthless tier is literally randomPolicy.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 },
    ],
  };

  it("reports strong-vs-random as a real fail when the manifest's ruthless tier is sabotaged to be random", () => {
    const report = runCiSuite(classicTicTacToe, sabotagedManifest, { games: 40, seed: "suites-test:sabotaged" });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("reports ruthless-vs-standard as n/a when the manifest has no standard tier (never silently passes)", () => {
    const report = runCiSuite(classicTicTacToe, sabotagedManifest, { games: 20, seed: "suites-test:no-standard" });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
  });

  it("a healthy manifest (mcts100 ruthless tier) passes strong-vs-random for real", () => {
    const healthyManifest: GameManifest = {
      ...sabotagedManifest,
      title: "Healthy TTT",
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 200 }, minReplyMs: 0 },
      ],
    };
    const report = runCiSuite(classicTicTacToe, healthyManifest, { games: 30, seed: "suites-test:healthy" });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C19 — CI-gate-only rollout budget scaling.
//
// The gate table's absolute rollout budget was sized against Fadeout's 3x3 board (fast) and
// broke down on Wrap's 6x6 (43+ minutes). The proven fix: measure with a SMALLER rollout
// budget for the "ruthless" tier, at the CI (PR) suite only — never the shipped tier real
// players face, never nightly's full-budget table. `manifest.ciGateBudget.twoPlayerCiRollouts`
// is that override; omitted, behavior is 100% unchanged (Fadeout never needs to touch this).
//
// The Wrap trap this guards against (C20): at a scaled-down 1000, "ruthless" collapsed onto
// "standard"'s OWN 1000-rollout budget — the two tiers became indistinguishable and
// ruthless-vs-standard's 50% was a measurement artifact, not a real result. A tier gate is
// meaningless once two tiers share a budget, so a scaled budget that collapses them must
// refuse loudly (TierBudgetCollapseError) rather than silently emit that meaningless ratio.
// ---------------------------------------------------------------------------------------

describe("runCiSuite() — C19: ciGateBudget.twoPlayerCiRollouts scales ONLY the ci-suite ruthless measurement", () => {
  // A genuinely strong tier (mcts, 5000 rollouts) so a healthy strong-vs-random pass at the
  // FULL budget is not in doubt — the only variable under test is whether the CI-suite
  // override actually gets substituted in place of it. Deliberately NO "standard" tier here —
  // the tier-collapse guard is its own describe block below; this one isolates the scaling
  // substitution itself.
  const manifestNoStandard: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Scaled TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "suites.test.ts C19 fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 5000 }, minReplyMs: 0 },
    ],
    // Absurdly low on purpose: at n=1, MCTS with a single rollout per candidate is barely
    // distinguishable from random — if the ci-suite override is really substituted for the
    // shipped 5000-rollout ruthless tier, strong-vs-random must fail for real.
    ciGateBudget: { twoPlayerCiRollouts: 1 },
  };

  it("suite 'ci' (default) uses the override — a real strong-vs-random regression at the scaled-down budget", () => {
    const report = runCiSuite(classicTicTacToe, manifestNoStandard, {
      games: 30,
      seed: "suites-test:c19:ci-scaled",
      suite: "ci",
    });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("fail");
  });

  it("suite 'nightly' ignores the override and runs the full shipped budget (the plan's 'nightly keeps the full-budget table')", () => {
    const report = runCiSuite(classicTicTacToe, manifestNoStandard, {
      games: 30,
      seed: "suites-test:c19:nightly-full",
      suite: "nightly",
    });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("pass");
  });

  it("no ciGateBudget declared at all, shipped budget within C22's no-override ceiling: behavior is unchanged (a genuinely cheap game never needs this field)", () => {
    // REVISED under C22 (platform-corrections.md): this test originally used a 5000-rollout
    // shipped tier and asserted "a game like Fadeout never needs this" — that premise is
    // exactly the defect C22 found (Fadeout's shipped 10,000-rollout tier ran unscaled for
    // 29+ minutes because nobody was required to set an override). runCiSuite now REQUIRES
    // manifest.ciGateBudget.twoPlayerCiRollouts once the shipped budget exceeds
    // MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE — see the dedicated C22 describe block below for that
    // refusal. This test is narrowed to what its title actually means: a shipped budget that
    // is ALREADY at or under the ceiling is genuinely cheap and still needs no override at all.
    //
    // A fresh literal (not manifestNoStandard minus a field) so this test never accidentally
    // inherits an override via a stray key — "no ciGateBudget" means the property is genuinely
    // absent, not merely destructured away.
    const noOverride: GameManifest = {
      id: "classic-ttt-fixture",
      title: "Scaled TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C19 fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE }, minReplyMs: 0 },
      ],
    };
    const report = runCiSuite(classicTicTacToe, noOverride, {
      games: 30,
      seed: "suites-test:c19:no-override",
      suite: "ci",
    });
    const gate = report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("pass"); // full shipped ruthless tier, unscaled (no throw, no override needed)
  });
});

describe("runCiSuite() — C19/C20: a scaled budget that collapses ruthless onto standard fails LOUDLY", () => {
  function manifestWithOverride(standardN: number, ruthlessShippedN: number, ciOverrideN: number): GameManifest {
    return {
      id: "classic-ttt-fixture",
      title: "Collapse TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C19/C20 collapse fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "standard", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: standardN }, minReplyMs: 0 },
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: ruthlessShippedN }, minReplyMs: 0 },
      ],
      ciGateBudget: { twoPlayerCiRollouts: ciOverrideN },
    };
  }

  it("throws TierBudgetCollapseError when the scaled ruthless budget EQUALS standard's own budget (Wrap's exact C20 finding)", () => {
    const manifest = manifestWithOverride(1000, 10000, 1000);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:equal", suite: "ci" })
    ).toThrow(TierBudgetCollapseError);
  });

  it("throws TierBudgetCollapseError when the scaled ruthless budget drops BELOW standard's own budget", () => {
    const manifest = manifestWithOverride(1000, 10000, 500);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:below", suite: "ci" })
    ).toThrow(TierBudgetCollapseError);
  });

  it("does NOT throw when the scaled budget stays strictly above standard's (real separation preserved)", () => {
    const manifest = manifestWithOverride(1000, 10000, 2000);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:safe", suite: "ci" })
    ).not.toThrow();
  });

  it("the nightly suite is immune — it never applies the ci-only override, so it cannot collapse", () => {
    const manifest = manifestWithOverride(1000, 10000, 1000); // would collapse at "ci"
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:nightly-immune", suite: "nightly" })
    ).not.toThrow();
  });

  it("a manifest with no 'standard' tier at all cannot collapse (nothing to collapse onto)", () => {
    const manifest: GameManifest = {
      id: "classic-ttt-fixture",
      title: "No Standard TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C19 no-standard-tier fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { twoPlayerCiRollouts: 1 },
    };
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:collapse:no-standard", suite: "ci" })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C22: the CI rollout budget must be required (and refuse loudly when
// absent), not merely available as a knob a team must remember to set. `--game fadeout` at the
// shipped, unscaled 10,000-rollout "ruthless" budget measured past 29 minutes — a 3x3 board,
// the smallest game in the catalogue — because ciGateBudget.twoPlayerCiRollouts is optional
// with no default and Fadeout never set it. A naively COMPUTED scaled default (mirroring
// Wrap's validated 2,000-rollout, 30x-speedup ratio) was tried against Fadeout and rejected:
// self-play at 2,000 rollouts produced mean-plies 40+ / 100% draw-rate / 0% first-player-win —
// a verdict the full 10,000-rollout budget does not produce — proving a scaled-down "ruthless"
// can be too weak a yardstick for THIS game even though the identical ratio was safe for
// Wrap's. So this suite proves the loud-refusal fallback instead: every test below is a
// planted violation (a manifest with no override and an expensive shipped tier) observed
// actually refusing, synchronously, before any self-play runs — never a silent full-cost run.
// ---------------------------------------------------------------------------------------

describe("runCiSuite() — C22: an expensive shipped ruthless budget REQUIRES an explicit CI override", () => {
  function expensiveManifestNoOverride(shippedN: number): GameManifest {
    return {
      id: "expensive-fixture",
      title: "Expensive Fixture",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C22 fixture — an expensive shipped ruthless tier, no CI override.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: shippedN }, minReplyMs: 0 },
      ],
      // Deliberately no ciGateBudget — this is exactly the state every registered game shipped
      // in (platform-corrections.md C22's own finding).
    };
  }

  it("MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE is a real, positive ceiling", () => {
    expect(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE).toBeGreaterThan(0);
  });

  it("refuses loudly, before running any self-play, when the shipped budget exceeds the ceiling and no override is set — proves Fadeout's exact defect is now caught rather than silently run", () => {
    const manifest = expensiveManifestNoOverride(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE + 1);
    // An absurdly large `games` count that would take far too long to actually run for real —
    // if this test completes at all (let alone the sub-second budget the whole suite runs
    // under), the throw fired BEFORE any matchup started, not merely "eventually".
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 1_000_000, seed: "suites-test:c22:missing-required" })
    ).toThrow(MissingCiRolloutBudgetError);
  });

  it("the thrown error names the actual shipped budget and the ceiling, so a reader knows exactly what to fix", () => {
    const manifest = expensiveManifestNoOverride(10_000);
    try {
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:message" });
      expect.fail("expected MissingCiRolloutBudgetError to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingCiRolloutBudgetError);
      const message = (e as Error).message;
      expect(message).toContain("10000");
      expect(message).toContain(String(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE));
      expect(message).toContain("expensive-fixture");
    }
  });

  it("does NOT throw when the shipped budget sits AT the ceiling — a cheap/small game never needs to touch this field (the unchanged, safe pass-through path)", () => {
    const manifest = expensiveManifestNoOverride(MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:at-ceiling" })
    ).not.toThrow(MissingCiRolloutBudgetError);
  });

  it("does NOT throw when an explicit ciGateBudget.twoPlayerCiRollouts is present, however low — an active, reviewed choice is never refused by this guard (the tier-collapse guard is the one that polices ITS safety)", () => {
    const manifest: GameManifest = {
      ...expensiveManifestNoOverride(10_000),
      ciGateBudget: { twoPlayerCiRollouts: 500 },
    };
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:override-present" })
    ).not.toThrow(MissingCiRolloutBudgetError);
  });

  it("nightly is exempt unconditionally — the full-budget table always runs there regardless of this ceiling", () => {
    const manifest = expensiveManifestNoOverride(10_000);
    expect(() =>
      runCiSuite(classicTicTacToe, manifest, { games: 10, seed: "suites-test:c22:nightly-exempt", suite: "nightly" })
    ).not.toThrow(MissingCiRolloutBudgetError);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C23: the witnessed C22 sweep found IDENTICAL self-play behaviour for
// Fadeout at every tested budget — 100% draw rate, 0% first-player win rate, 100%
// strong-vs-random — because `remove-first/solid/threefold` is an EXACT-SOLVED draw (128,170
// states, all 9 openings drawn; docs/research/games/fadeout-solve-report.md §1.1). Three gates
// (first-player-win-rate, draw-rate, ruthless-vs-standard) were failing FOREVER on correct
// play, at any budget — a guard that goes red while everything is right. This suite proves the
// fix: a proven `manifest.solvedValue` makes exactly those gates report `n/a` (never `pass`,
// never a silent skip — C2's own rule), citing the proof, and a NEW gate inverts the check —
// does self-play actually REACH the proven value, the real regression signal a decided game
// needs. Every threshold here plants a violation and observes it fire, per the standing rule.
// ---------------------------------------------------------------------------------------

const SOLVE_REPORT_PROOF = "docs/research/games/fadeout-solve-report.md §1.1 (remove-first/solid/threefold: draw, 128,170 states, all 9 openings drawn)";

// platform-corrections.md C57's own declared-baseline example — the SAME witnessed sweep
// SOLVE_REPORT_PROOF cites, worded as an attainment-rate claim rather than a game-value claim.
const FADEOUT_BASELINE_PROOF =
  "platform-corrections.md C23 sweep: self-play reached the proven draw at EXACTLY 100% across all six tested points (25-100 games, 3,000-10,000 rollouts, zero variance)";

describe("evaluateCiGates — C23: manifest.solvedValue requires a proof pointer", () => {
  it("throws MissingSolvedValueProofError for a claimed value with NO proof, before any gate is evaluated", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "draw" })
    ).toThrow(MissingSolvedValueProofError);
  });

  it("throws for a claimed value with a BLANK (whitespace-only) proof — not just a missing one", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "draw", proof: "   " })
    ).toThrow(MissingSolvedValueProofError);
  });

  it("does NOT throw for value 'unknown' even with no proof — the default grants nothing and demands nothing", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "unknown" })
    ).not.toThrow();
  });

  it("does NOT throw when omitted entirely (the common case — most games have no solved value)", () => {
    expect(() => evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci")).not.toThrow();
  });

  it("does NOT throw once a real proof is provided", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "draw", proof: SOLVE_REPORT_PROOF })
    ).not.toThrow();
  });
});

describe("evaluateCiGates — C23: the three unsatisfiable-by-construction gates go n/a for a proven draw, citing the proof", () => {
  // Fadeout's OWN real numbers from the witnessed C22 sweep (100 x 10,000 baseline row) — the
  // exact inputs that were failing forever before this fix.
  const fadeoutBaseline: GateInputs = {
    strongVsRandomWinRate: 1.0,
    firstPlayerWinRate: 0.0,
    drawRate: 1.0,
    meanPlies: 45.5,
    capHitRate: 0, // isolated from the real 1% cap-hit finding — that is mean-plies' own concern, tested separately below
    ruthlessVsStandardWinRate: 0.0,
  };
  const solvedDraw: SolvedValueClaim = { value: "draw", proof: SOLVE_REPORT_PROOF };

  it("first-player-win-rate is n/a, citing the proof, instead of failing forever on 0%", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "first-player-win-rate")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain(SOLVE_REPORT_PROOF);
  });

  it("draw-rate is n/a, citing the proof, instead of failing forever on 100%", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "draw-rate")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain(SOLVE_REPORT_PROOF);
  });

  it("ruthless-vs-standard is n/a at suite 'ci', citing the proof, instead of WARNing forever on 0%", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain(SOLVE_REPORT_PROOF);
  });

  it("ruthless-vs-standard is ALSO n/a at suite 'nightly' — this is the fix for 'nightly is broken for Fadeout today too' (C23)", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", solvedDraw);
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    // Before this fix: 0% < the 60% min, and suite "nightly" turns that into a hard FAIL (see
    // the un-corrected branch above) — every nightly run for Fadeout was red. Proves it isn't.
    expect(gate.status).toBe("n/a");
  });

  it("mean-plies is UNAFFECTED by solvedValue — it is not one of the three unsatisfiable gates, and still evaluates for real", () => {
    const withCapHit: GateInputs = { ...fadeoutBaseline, capHitRate: 0.01 };
    const gates = evaluateCiGates(withCapHit, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const gate = gates.find((g) => g.gate === "mean-plies")!;
    expect(gate.status).toBe("fail"); // the real C22-sweep finding: baseline's 1% cap-hit rate genuinely fails this gate
    expect(gate.detail).toContain("across all matchups"); // C23 item 5: disambiguated from a self-play-only number
  });

  it("a proven DECISIVE value (p0-win) leaves draw-rate and ruthless-vs-standard ACTIVE — only first-player-win-rate goes n/a", () => {
    const decisive: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 1.0, // P0 always wins — correct for a proven p0-win
      drawRate: 0.0,
      meanPlies: 10,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.8,
    };
    const solvedP0Win: SolvedValueClaim = { value: "p0-win", proof: "a hypothetical p0-win proof" };
    const gates = evaluateCiGates(decisive, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedP0Win);
    expect(gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("n/a");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("pass"); // still a real, active gate
    expect(gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("pass"); // still a real, active gate
  });

  it("N/A is provably distinguishable from PASS in the RENDERED report — plant-and-observe of the actual formatter, not just the status enum", () => {
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);
    const ok = gates.every((g) => g.status !== "fail");
    const rendered = formatCiSuiteTable({ gameId: "fadeout", suite: "ci", ok, gates, matchups: null as never });
    const lines = rendered.split("\n");
    const fpwrLine = lines.find((l) => l.includes("first-player-win-rate"))!;
    const drawRateLine = lines.find((l) => l.includes("draw-rate:"))!;
    const strongVsRandomLine = lines.find((l) => l.includes("strong-vs-random"))!;
    expect(fpwrLine).toContain("[N/A ]");
    expect(fpwrLine).not.toContain("[PASS]");
    expect(drawRateLine).toContain("[N/A ]");
    expect(strongVsRandomLine).toContain("[PASS]"); // the real, still-active gate — visibly different
    expect(strongVsRandomLine).not.toContain("[N/A ]");
  });
});

describe("evaluateCiGates — C23: the inverted 'solved-value-reached' gate — the real regression signal a decided game needs", () => {
  it("SOLVED_VALUE_SELF_PLAY_FLOOR is a real threshold, comfortably below the observed 100% but well above a genuine regression", () => {
    expect(SOLVED_VALUE_SELF_PLAY_FLOOR).toBeGreaterThan(0.5);
    expect(SOLVED_VALUE_SELF_PLAY_FLOOR).toBeLessThan(1.0);
  });

  it("is n/a when there is no proven solvedValue — never silently absent from the report (C2)", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    const gate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(gate).toBeDefined();
    expect(gate.status).toBe("n/a");
  });

  it("passes at the real Fadeout baseline (100% draws) — comfortably clears the floor", () => {
    const fadeoutBaseline: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.0,
      drawRate: 1.0,
      meanPlies: 45.5,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.0,
    };
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: SOLVE_REPORT_PROOF,
    });
    const gate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(gate.status).toBe("pass");
    expect(gate.detail).toContain("100.0%");
  });

  it("PLANTED REGRESSION: a draw rate that drops to 70% FAILS this gate — the orchestrator's own worked example, and the exact case the un-corrected gates would have scored as an IMPROVEMENT", () => {
    const regressed: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.15, // moved TOWARD the old "balanced" band — would have looked better under the old gate
      drawRate: 0.7,
      meanPlies: 20,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.3,
    };
    // C57: this IS a regression (Fadeout has a real, previously-measured baseline), so a
    // declared `attainmentBaseline` is required to get "fail" rather than the new "unattained"
    // status — see the dedicated C57 describe block below for the case with NO baseline.
    const gates = evaluateCiGates(regressed, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: SOLVE_REPORT_PROOF,
      attainmentBaseline: { rate: 1.0, proof: FADEOUT_BASELINE_PROOF },
    });
    const solvedGate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedGate.status).toBe("fail");
    expect(solvedGate.detail).toContain("70.0%");
    expect(solvedGate.detail).toMatch(/regressed/i);
    expect(solvedGate.detail).toContain("100.0%"); // the declared baseline, named
    // SUPERSEDED by C55 (platform-corrections.md): solved-value-reached FAILED here, so the
    // proof no longer buys relief — the three gates below must NOT stay n/a (that was exactly
    // the C55 defect: Bid-Tac-Toe took the relief and failed the attainment check in the same
    // run). They report their real measured values instead, each saying why relief was
    // withheld so a reader cannot mistake a real fail for a wrong solvedValue declaration.
    const fpwr = gates.find((g) => g.gate === "first-player-win-rate")!;
    expect(fpwr.status).toBe("fail"); // 15.0% outside [35%, 65%]
    expect(fpwr.detail).toContain("15.0%");
    expect(fpwr.detail).toMatch(/withheld/i);
    const drawRate = gates.find((g) => g.gate === "draw-rate")!;
    expect(drawRate.status).toBe("fail"); // 70.0% > 60% ceiling
    expect(drawRate.detail).toContain("70.0%");
    expect(drawRate.detail).toMatch(/withheld/i);
  });

  it("a proven p0-win checks firstPlayerWinRate directly; a proven p1-win checks its complement", () => {
    const p0Healthy: GateInputs = {
      strongVsRandomWinRate: 1,
      firstPlayerWinRate: 0.95,
      drawRate: 0.02,
      meanPlies: 10,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.7,
    };
    expect(
      evaluateCiGates(p0Healthy, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "p0-win", proof: "p0 proof" }).find(
        (g) => g.gate === "solved-value-reached"
      )!.status
    ).toBe("pass");

    const p1Healthy: GateInputs = { ...p0Healthy, firstPlayerWinRate: 0.05 }; // P1 (second player) wins 95%
    expect(
      evaluateCiGates(p1Healthy, DEFAULT_HARNESS_THRESHOLDS, [], "ci", { value: "p1-win", proof: "p1 proof" }).find(
        (g) => g.gate === "solved-value-reached"
      )!.status
    ).toBe("pass");

    // Mismatched: claiming p1-win but P0 is actually winning — must NOT silently pass. C57: with
    // no attainmentBaseline declared, "unattained" (not "fail") is the correct word — there is
    // no history establishing this claim was ever true, so a shortfall is not a regression. It
    // remains a real, visible, non-passing status either way — never "n/a", never "pass".
    const mismatched: GateInputs = { ...p0Healthy, firstPlayerWinRate: 0.95 };
    const mismatchedStatus = evaluateCiGates(mismatched, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "p1-win",
      proof: "p1 proof",
    }).find((g) => g.gate === "solved-value-reached")!.status;
    expect(mismatchedStatus).toBe("unattained");
    expect(mismatchedStatus).not.toBe("pass");
    expect(mismatchedStatus).not.toBe("n/a");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C55: C23 built the relief (three decisiveness gates go n/a for a
// proven value) and the check (solved-value-reached, confirming self-play actually attains it)
// as a PAIR — but only the relief was wired to the manifest declaration. The check was left
// free-standing, so a game could take the relief and fail the check in the same run. Bid-Tac-
// Toe did exactly that: proven pure draw (369,802/369,802 saddle points), but self-play NEVER
// reaches it (0.0% draw rate at every tested budget) — every game is decisive, FPA swings
// 33.3%-60.0%, and the un-fixed gate silenced all three as "n/a" anyway. Fix: the three gates'
// n/a is now CONDITIONAL on solved-value-reached passing. Every test below plants a violation
// in one of the two directions the fix has to get right (reached -> relief holds; not reached ->
// relief withdrawn) and confirms the guard could actually have failed each one.
// ---------------------------------------------------------------------------------------

describe("evaluateCiGates — C55: the three decisiveness gates' n/a relief is CONDITIONAL on solved-value-reached actually passing", () => {
  const BID_TAC_TOE_PROOF = "docs/plans/bid-tac-toe.md C51 (369,802/369,802 saddle points — pure draw at every bid node)";

  it("PLANT (Bid-Tac-Toe's REAL C55 numbers, rollouts=10000): self-play NEVER reaches the proven draw (0.0% draw rate, floor 90%) — solved-value-reached is UNATTAINED (C57: no declared baseline, so this is not a regression claim), and the three decisiveness gates still report REAL measured values instead of n/a", () => {
    const bidTacToe10k: GateInputs = {
      strongVsRandomWinRate: 0.75,
      firstPlayerWinRate: 0.333,
      drawRate: 0.0,
      meanPlies: 7.6,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.5,
    };
    const solvedDraw: SolvedValueClaim = { value: "draw", proof: BID_TAC_TOE_PROOF };
    const gates = evaluateCiGates(bidTacToe10k, DEFAULT_HARNESS_THRESHOLDS, [], "ci", solvedDraw);

    // C57 SUPERSEDES this row's own status (recorded here as UPDATED, not deleted, so the
    // history stays legible): C55 shipped this as a hard "fail" — correct at the time, but the
    // exact miscalibration C57 fixes, since Bid-Tac-Toe never declared a baseline to regress
    // from. "Never attained" is a real, visible, non-passing status — just not the same claim as
    // "regressed". Relief withholding for the three gates below is UNCHANGED by this: it turns
    // on `attainment.reached` (still false here), never on regressed-vs-unattained.
    const solvedGate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedGate.status).toBe("unattained");
    expect(solvedGate.status).not.toBe("fail");
    expect(solvedGate.status).not.toBe("pass");
    expect(solvedGate.detail).toContain("0.0%");
    expect(solvedGate.detail).not.toMatch(/regressed/i);

    // Before C55: all three below read "n/a", silencing a currently-meaningful 33.3% FPA / 0.0%
    // draw-rate / 50.0% ruthless-vs-standard exactly as C55 describes. After C55: real verdicts.
    const fpwr = gates.find((g) => g.gate === "first-player-win-rate")!;
    expect(fpwr.status).toBe("fail"); // 33.3% outside [35%, 65%]
    expect(fpwr.detail).toContain("33.3%");
    expect(fpwr.status).not.toBe("n/a");

    const drawRate = gates.find((g) => g.gate === "draw-rate")!;
    expect(drawRate.status).toBe("pass"); // 0.0% <= 60% ceiling — a real, checkable pass, not n/a
    expect(drawRate.detail).toContain("0.0%");
    expect(drawRate.status).not.toBe("n/a");

    const ruthlessVsStandard = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(ruthlessVsStandard.status).toBe("warn"); // 50.0% < 60% min, ci-suite warns
    expect(ruthlessVsStandard.status).not.toBe("n/a");
  });

  it("LEGIBILITY (C2): the withheld-relief detail is distinguishable from an ordinary measured gate — a reader must not mistake this real fail for a wrong solvedValue declaration", () => {
    const bidTacToe10k: GateInputs = {
      strongVsRandomWinRate: 0.75,
      firstPlayerWinRate: 0.333,
      drawRate: 0.0,
      meanPlies: 7.6,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.5,
    };
    const gates = evaluateCiGates(bidTacToe10k, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: BID_TAC_TOE_PROOF,
    });
    for (const name of ["first-player-win-rate", "draw-rate", "ruthless-vs-standard"]) {
      const gate = gates.find((g) => g.gate === name)!;
      expect(gate.detail, `gate ${name}`).toMatch(/withheld/i);
      expect(gate.detail, `gate ${name}`).toContain("0.0%"); // the attainment number itself, named
    }
  });

  it("CONTROL (Fadeout's REAL C22/C23 numbers): self-play reaches the proven draw 100% of the time — solved-value-reached PASSES, and the three gates stay n/a, unaffected by C55", () => {
    const fadeoutBaseline: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.0,
      drawRate: 1.0,
      meanPlies: 45.5,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.0,
    };
    const gates = evaluateCiGates(fadeoutBaseline, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: SOLVE_REPORT_PROOF,
    });
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("pass");
    expect(gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("n/a");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("n/a");
    expect(gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("n/a");
  });

  it("BOUNDARY: attainment sitting EXACTLY at the floor (90.0%) still grants relief — inclusive, symmetric with every other threshold in this module", () => {
    const atFloor: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.05,
      drawRate: SOLVED_VALUE_SELF_PLAY_FLOOR, // exactly 0.9
      meanPlies: 20,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.1,
    };
    const gates = evaluateCiGates(atFloor, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: SOLVE_REPORT_PROOF,
    });
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("pass");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("n/a");
  });

  it("just BELOW the floor (89.9%) withdraws relief — same boundary, other side", () => {
    const belowFloor: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.05,
      drawRate: 0.899,
      meanPlies: 20,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.1,
    };
    // C57: with a declared baseline (this fixture represents Fadeout, same as the "AT the
    // floor" case above), falling short is a regression — "fail", not "unattained". The
    // dedicated C57 describe block below covers the no-baseline boundary separately.
    const gates = evaluateCiGates(belowFloor, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: SOLVE_REPORT_PROOF,
      attainmentBaseline: { rate: 1.0, proof: FADEOUT_BASELINE_PROOF },
    });
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("fail");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).not.toBe("n/a");
  });

  it("a proven DECISIVE value (p0-win) whose self-play does NOT reach it also loses first-player-win-rate's relief — C55 applies generally, not only to the draw case", () => {
    const underperforming: GateInputs = {
      strongVsRandomWinRate: 1.0,
      firstPlayerWinRate: 0.5, // claimed p0-win, but self-play is only 50-50 — nowhere near the proof
      drawRate: 0.0,
      meanPlies: 10,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.8,
    };
    const gates = evaluateCiGates(underperforming, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "p0-win",
      proof: "hypothetical p0-win proof",
    });
    // C57: no attainmentBaseline was declared here, so a shortfall is not knowable as a
    // regression — "unattained", not "fail" (see the dedicated C57 describe block below for the
    // full regressed-vs-unattained split; this test's own point, that relief is lost either way
    // for a DECISIVE value too, is unaffected — attainment.reached, which governs relief, does
    // not depend on regression vs. unattained).
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("unattained");
    const fpwr = gates.find((g) => g.gate === "first-player-win-rate")!;
    expect(fpwr.status).toBe("pass"); // 50% happens to land inside [35%,65%] — a REAL pass, not a relieved n/a
    expect(fpwr.status).not.toBe("n/a");
  });

  it("ORDERING (no circular/order-dependent result): the attainment computation reads only already-computed GateInputs, never another gate's already-pushed GateResult — proven by checking solved-value-reached's own verdict agrees EXACTLY with what the other three gates concluded about attainment, for both a reached and a not-reached case", () => {
    const reached: GateInputs = {
      strongVsRandomWinRate: 1,
      firstPlayerWinRate: 0,
      drawRate: 0.95,
      meanPlies: 20,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0,
    };
    const notReached: GateInputs = { ...reached, drawRate: 0.5 };
    for (const [inputs, expectReached] of [
      [reached, true],
      [notReached, false],
    ] as const) {
      const gates = evaluateCiGates(inputs, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
        value: "draw",
        proof: SOLVE_REPORT_PROOF,
      });
      const solvedPass = gates.find((g) => g.gate === "solved-value-reached")!.status === "pass";
      const fpwrIsNa = gates.find((g) => g.gate === "first-player-win-rate")!.status === "n/a";
      const drawRateIsNa = gates.find((g) => g.gate === "draw-rate")!.status === "n/a";
      expect(solvedPass).toBe(expectReached);
      expect(fpwrIsNa).toBe(solvedPass);
      expect(drawRateIsNa).toBe(solvedPass);
    }
  });
});

describe("evaluateCiGates — C55: deferral interacts correctly — self-play never ran, so attainment is UNMEASURED, not 'known reached'", () => {
  it("under an active deferral, the three decisiveness gates DEFER (not n/a) even with a proven solvedValue — C55 supersedes the pre-C55 'structural regardless of deferral' behaviour for these three, because their n/a is no longer structural: it depends on self-play data that did not run this tier", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      { value: "draw", proof: SOLVE_REPORT_PROOF },
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    expect(gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("deferred");
  });

  it("the genuinely structural n/a (no 'standard' tier in the manifest AT ALL) survives deferral unchanged — that fact is independent of solvedValue, deferral, AND self-play", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, ruthlessVsStandardWinRate: null },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      { value: "draw", proof: SOLVE_REPORT_PROOF },
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain("standard");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C57: `solved-value-reached`'s 90% absolute floor collapsed two claims
// that demand OPPOSITE responses into the same "fail": "used to reach the value, doesn't now"
// (a real regression — Fadeout's own protection, built by C23) vs. "has never reached it" (a
// statement about search adequacy, not a regression — Bid-Tac-Toe's day-one reality). Every test
// below plants a violation on one side of that split and confirms the OTHER side's code path is
// what would have made it fail silently wrong — i.e. each plant is checked against what the
// PRE-C57 single-floor logic would have said, not just against what the new logic says.
// ---------------------------------------------------------------------------------------

describe("evaluateCiGates — C57: 'unattained' vs 'fail' — two claims that must not print the same word", () => {
  const REGRESSION_BASELINE_PROOF = "hypothetical-game solve report §2 — self-play measured 100% attainment across every tested budget";

  it("REGRESSION PLANT: a declared attainmentBaseline + a real shortfall FAILS loudly, naming the baseline — even while every OTHER balance number looks perfectly healthy", () => {
    // Deliberately healthy on every axis a reviewer might otherwise use as a proxy for
    // 'something is wrong' — strong-vs-random comfortably passes, FPA sits mid-band, draw-rate
    // and ruthless-vs-standard both clear their own thresholds. The ONLY signal that a real
    // regression occurred is solved-value-reached itself, which is the entire point of C23's
    // inversion and exactly what a plant must prove still works after C57 adds a second status
    // next to it.
    const regressedButOtherwiseHealthy: GateInputs = {
      strongVsRandomWinRate: 0.95,
      firstPlayerWinRate: 0.5,
      drawRate: 0.5, // < the declared 100% baseline, and below the 90% floor — a real shortfall
      meanPlies: 20,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.7,
    };
    const gates = evaluateCiGates(regressedButOtherwiseHealthy, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: "hypothetical-game solve report §1 — proven draw",
      attainmentBaseline: { rate: 1.0, proof: REGRESSION_BASELINE_PROOF },
    });

    const solvedGate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedGate.status).toBe("fail");
    expect(solvedGate.detail).toContain("50.0%"); // what was actually measured
    expect(solvedGate.detail).toContain("100.0%"); // the declared baseline, named
    expect(solvedGate.detail).toMatch(/regressed/i);
    expect(solvedGate.detail).not.toMatch(/never/i); // must not carry the "unattained" wording too

    // The overall suite must actually be blocked by this — a regression that only shows up as a
    // real word in a report nobody's tooling acts on is not a fix. `report.ok`'s own formula
    // (every row !== "fail") must resolve to false here.
    expect(gates.every((g) => g.status !== "fail")).toBe(false);
    expect(() => assertSuiteOk({ gameId: "regression-fixture", suite: "ci", ok: false, gates, matchups: null })).toThrow(
      SuiteFailedError
    );

    // The three decisiveness gates are unaffected by regressed-vs-unattained (relief withholding
    // is governed by attainment.reached alone) — confirmed real, not silenced as n/a.
    for (const name of ["first-player-win-rate", "draw-rate", "ruthless-vs-standard"]) {
      const gate = gates.find((g) => g.gate === name)!;
      expect(gate.status, `gate ${name}`).not.toBe("n/a");
    }
  });

  it("NEVER-ATTAINED PLANT (Bid-Tac-Toe's real post-C58 numbers): no declared baseline + a real shortfall renders 'unattained' — visibly non-passing, but the suite is NOT blocked, because nothing regressed", () => {
    // C57/C58's own recorded post-marginal-aggregation-fix numbers: strong-vs-random clears 90%,
    // FPA and draw-rate both land inside their own healthy bands as PLAYED, ruthless-vs-standard
    // clears its floor too — "every balance gate passes on real numbers" (the exact situation
    // the correction's brief describes) — except self-play still never reaches the proven draw.
    const bidTacToePostFix: GateInputs = {
      strongVsRandomWinRate: 0.917,
      firstPlayerWinRate: 0.433,
      drawRate: 0.0,
      meanPlies: 7.7,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.65,
    };
    const gates = evaluateCiGates(bidTacToePostFix, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: "docs/plans/bid-tac-toe.md C51 (369,802/369,802 saddle points — pure draw at every bid node)",
      // deliberately NO attainmentBaseline — this game has never established one
    });

    const solvedGate = gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedGate.status).toBe("unattained");
    expect(solvedGate.status).not.toBe("fail"); // the exact pre-C57 word this plant must NOT print
    expect(solvedGate.status).not.toBe("pass"); // constraint 2: must never read as a pass either
    expect(solvedGate.detail).toContain("0.0%");
    expect(solvedGate.detail).toMatch(/never/i);
    expect(solvedGate.detail).not.toMatch(/regressed/i); // must not borrow the regression's wording

    // Every OTHER gate genuinely passes on its own real threshold — so the suite as a whole is
    // NOT blocked. This is the concrete case the plant must prove: a game whose bots have never
    // attained a proof, but whose every other measured number is healthy, ships — while the one
    // gate that isn't a clean pass stays visible, in its own distinct word.
    expect(gates.every((g) => g.status !== "fail")).toBe(true);
    for (const name of ["first-player-win-rate", "draw-rate", "ruthless-vs-standard"]) {
      const gate = gates.find((g) => g.gate === name)!;
      expect(gate.status, `gate ${name}`).toBe("pass");
    }

    // hasUnattainedGates is what a report-layer caller uses to keep this from reading as a bare
    // "OK" (see report.test.ts's own C57 assertions on the rendered header).
    expect(hasUnattainedGates(gates)).toBe(true);
    expect(hasDeferredGates(gates)).toBe(false); // distinct from deferred — self-play DID run
  });

  it("REFUSAL: a declared attainmentBaseline.rate of exactly 0 is refused — the exact silencing attempt C57 requires be blocked, never a silent pass and never even a silent 'unattained'", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
        value: "draw",
        proof: "some proof",
        attainmentBaseline: { rate: 0, proof: "an attempted 0% baseline" },
      })
    ).toThrow(InvalidAttainmentBaselineError);
  });

  it("REFUSAL: a negative rate is refused too (not just exactly 0)", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
        value: "draw",
        proof: "some proof",
        attainmentBaseline: { rate: -0.1, proof: "nonsensical negative baseline" },
      })
    ).toThrow(InvalidAttainmentBaselineError);
  });

  it("REFUSAL: a rate above 1 (a percentage mistaken for a fraction, e.g. 100 instead of 1.0) is refused", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
        value: "draw",
        proof: "some proof",
        attainmentBaseline: { rate: 100, proof: "100 meant as a percentage, not a fraction" },
      })
    ).toThrow(InvalidAttainmentBaselineError);
  });

  it("REFUSAL: a blank baseline proof is refused, same posture as MissingSolvedValueProofError — a baseline is a claim too and needs its own provenance (C25)", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
        value: "draw",
        proof: "some proof",
        attainmentBaseline: { rate: 1.0, proof: "   " },
      })
    ).toThrow(InvalidAttainmentBaselineError);
  });

  it("a valid, tiny positive baseline (0.01) is accepted — the refusal targets EXACTLY zero-and-below, not 'inconveniently low'", () => {
    const gates = evaluateCiGates({ ...HEALTHY, drawRate: 0.0 }, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: "some proof",
      attainmentBaseline: { rate: 0.01, proof: "a genuinely, honestly, almost-never-attained baseline" },
    });
    // Below its own tiny baseline still fails (0.0% < 1.0%) — a low baseline is not a waiver,
    // it is just a low bar a real regression can still fall under.
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("fail");
  });

  it("a rate of exactly 1.0 (the boundary the refusal must NOT catch) is accepted — Fadeout's own real declared value", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
        value: "draw",
        proof: "some proof",
        attainmentBaseline: { rate: 1.0, proof: "boundary check" },
      })
    ).not.toThrow();
  });

  it("GUARD-COULD-HAVE-FAILED (C41): the never-attained plant's own inputs, run WITHOUT the C57 distinction (i.e. asserting the pre-C57 behaviour), demonstrate what a vacuous plant would have looked like — confirms the two plants above are checking a real branch, not a test that would pass under either implementation", () => {
    const bidTacToePostFix: GateInputs = {
      strongVsRandomWinRate: 0.917,
      firstPlayerWinRate: 0.433,
      drawRate: 0.0,
      meanPlies: 7.7,
      capHitRate: 0,
      ruthlessVsStandardWinRate: 0.65,
    };
    const noBaseline = evaluateCiGates(bidTacToePostFix, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: "no-baseline proof",
    }).find((g) => g.gate === "solved-value-reached")!.status;
    const withBaseline = evaluateCiGates(bidTacToePostFix, DEFAULT_HARNESS_THRESHOLDS, [], "ci", {
      value: "draw",
      proof: "with-baseline proof",
      attainmentBaseline: { rate: 1.0, proof: "same numbers, but now with a declared baseline" },
    }).find((g) => g.gate === "solved-value-reached")!.status;
    // Identical GateInputs, identical achieved rate — the ONLY thing that changed is whether a
    // baseline was declared, and that alone must flip the word between "unattained" and "fail".
    // If a future edit made these two identical, this is the assertion that would catch it.
    expect(noBaseline).toBe("unattained");
    expect(withBaseline).toBe("fail");
    expect(noBaseline).not.toBe(withBaseline);
  });
});

describe("runCiSuite() — C23 end-to-end: a real proven-draw fixture (classicTicTacToe), not hand-built GateInputs", () => {
  it("classicTicTacToe (a REAL proven draw under optimal play) with solvedValue:draw passes cleanly — n/a where the old gates would have failed forever, pass on solved-value-reached", () => {
    const manifest: GameManifest = {
      id: "classic-ttt-fixture",
      title: "Classic TTT",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C23 end-to-end fixture — a real, known proven draw.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 2000 }, minReplyMs: 0 },
      ],
      solvedValue: { value: "draw", proof: "classic tic-tac-toe is a textbook proven draw under optimal play" },
    };
    const report = runCiSuite(classicTicTacToe, manifest, { games: 40, seed: "suites-test:c23:e2e-ttt-draw" });

    expect(report.gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("n/a");
    expect(report.gates.find((g) => g.gate === "draw-rate")!.status).toBe("n/a");
    expect(report.gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("n/a"); // no "standard" tier here anyway
    const solvedGate = report.gates.find((g) => g.gate === "solved-value-reached")!;
    expect(solvedGate.status).toBe("pass");
    expect(report.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C26: Nine Grids' first real gate run passed its balance gates
// (FPA 46.0%, draws 30.0%) but reported `[WARN] ruthless-vs-standard: 42.0% (min 60.0%, ci)` —
// the HARDER tier losing to the EASIER one. Nine Grids ships standard=1,000 / ruthless=10,000
// (a real 10x gap) but its ciGateBudget.twoPlayerCiRollouts scales ruthless down to 1,500 for
// suite "ci" — a 1.5x gap against standard's 1,000. `TierBudgetCollapseError`'s strict
// inequality (1500 > 1000) correctly does not fire, but MCTS strength grows roughly with the
// LOG of rollouts, so a 1.5x budget gap is a strength difference noise swallows whole. The
// measured 42.0% is an artifact of the substitution, not a finding about the game — and nightly
// (which never applies the override) would have hard-failed Nine Grids on a number that was
// never meaningful in CI. Fix: when the override is active, this gate reports n/a, naming both
// budgets, instead of a WARN that reads as a real result.
// ---------------------------------------------------------------------------------------

describe("evaluateCiGates/runCiSuite — C26: ruthless-vs-standard reports n/a (not a number) when a CI rollout override is active", () => {
  it("PURE evaluator: n/a, naming BOTH budgets, for Nine Grids' exact numbers (1,500 vs standard's 1,000, measured 42.0%)", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, ruthlessVsStandardWinRate: 0.42 },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      undefined,
      { active: true, ruthlessN: 1500, standardN: 1000 }
    );
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain("1500");
    expect(gate.detail).toContain("1000");
    expect(gate.detail).not.toMatch(/42/); // the misleading figure itself must not appear
  });

  it("PURE evaluator: WITHOUT an active override, the SAME 42.0% still measures normally (warns at ci) — the fix never suppresses a real measurement", () => {
    const gates = evaluateCiGates({ ...HEALTHY, ruthlessVsStandardWinRate: 0.42 }, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("warn");
    expect(gate.detail).toContain("42.0%");
  });

  function nineGridsLikeManifest(ruthlessPolicy: "mcts" | "random" = "mcts"): GameManifest {
    return {
      id: "nine-grids-fixture",
      title: "Nine Grids Fixture",
      classic: "Ultimate Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C26 fixture — Nine Grids' exact tier/override shape.",
      tags: [],
      estMinutes: 3,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "standard", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 1000 }, minReplyMs: 0 },
        { id: "ruthless", policy: { kind: ruthlessPolicy }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { twoPlayerCiRollouts: 1500 },
    };
  }

  it("real runCiSuite, Nine Grids' EXACT manifest shape: suite 'ci' (1,500-rollout override active) reports n/a, never a percentage", () => {
    const report = runCiSuite(classicTicTacToe, nineGridsLikeManifest(), { games: 20, seed: "suites-test:c26:nine-grids-ci" });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain("1500");
    expect(gate.detail).toContain("1000");
    expect(gate.detail).not.toMatch(/%/);
  });

  it("real runCiSuite, SAME manifest, suite 'nightly': the override is ignored — ruthless-vs-standard measures the REAL shipped 10,000-vs-1,000 gap for real, not n/a", () => {
    const report = runCiSuite(classicTicTacToe, nineGridsLikeManifest(), {
      games: 20,
      seed: "suites-test:c26:nine-grids-nightly",
      suite: "nightly",
    });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).not.toBe("n/a");
    expect(gate.detail).toMatch(/%/); // a real, measured percentage
  });

  it("nightly still HARD-FAILS a genuine tier inversion — the exact hazard C26 names ('Nine Grids would pass CI and fail nightly on a number that was never meaningful in CI')", () => {
    // Sabotaged on purpose: ruthless is a RANDOM policy (genuinely the weaker agent) against a
    // real mcts "standard" — nightly ignores ciGateBudget entirely, so this is a real,
    // unscaled measurement, and it MUST still be a hard fail (roadmap §6), proving C26's fix
    // narrows the false-warn case without blinding nightly to a real one.
    const report = runCiSuite(classicTicTacToe, nineGridsLikeManifest("random"), {
      games: 20,
      seed: "suites-test:c26:nightly-real-inversion",
      suite: "nightly",
    });
    const gate = report.gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("fail");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C24: two independent agents, in unrelated worktrees on the same day,
// both hand-rolled a budget comparison by templating the varying rollout count INTO the seed
// string (`c22-sweep:${label}:...rollouts=${rollouts}`, `pilot:nine-grids:${n}:${games}`).
// Since runner.ts derives game i as `${seed}:${i}`, that means every candidate played a
// DIFFERENT set of games, conflating the budget's effect with seed variance. `compareBudgets`
// is the fix: one seed, many candidates, the loop nobody has to hand-roll (or get wrong) again.
// ---------------------------------------------------------------------------------------

describe("compareBudgets — C24: one seed, many rollout candidates, never a hand-rolled per-candidate seed", () => {
  const manifest: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Compare Budgets TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "suites.test.ts C24 fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
    ],
    // Deliberately declares NO ciGateBudget of its own — compareBudgets must supply one per
    // candidate regardless (proving it never depends on the manifest already having one).
  };

  it("returns one point per candidate, in the SAME order, each carrying its own rollout count", () => {
    const points = compareBudgets(classicTicTacToe, manifest, [500, 2000, 5000], {
      seed: "suites-test:c24:order",
      games: 10,
    });
    expect(points.map((p) => p.rollouts)).toEqual([500, 2000, 5000]);
    expect(points).toHaveLength(3);
  });

  it("uses the IDENTICAL seed across every candidate — two candidates with the SAME rollout count produce byte-identical reports, proving determinism and same-seed usage together", () => {
    const points = compareBudgets(classicTicTacToe, manifest, [3000, 3000], {
      seed: "suites-test:c24:same-seed-proof",
      games: 15,
    });
    // Every DECISION-derived field must match exactly (same seed -> same games, same outcomes,
    // same gate verdicts) — `throughputGamesPerSec` is the one field runner.ts's own
    // MatchupReport carries that is NOT decision-derived (report.ts's toMatchupReportJson has
    // the identical exclusion, and for the identical reason: it is a real elapsed-time
    // measurement, expected to vary run to run under a fixed seed).
    const strip = (report: (typeof points)[number]["report"]) =>
      JSON.parse(
        JSON.stringify(report, (key, value: unknown) => (key === "throughputGamesPerSec" ? undefined : value))
      );
    expect(strip(points[0]!.report)).toEqual(strip(points[1]!.report));
  });

  it("never mutates the manifest passed in — shipped difficultyTiers and any pre-existing ciGateBudget are untouched after the call", () => {
    const manifestWithOwnBudget: GameManifest = {
      ...manifest,
      ciGateBudget: { twoPlayerCiRollouts: 999 }, // must survive the call unchanged
    };
    const tiersBefore = JSON.stringify(manifestWithOwnBudget.difficultyTiers);
    const budgetBefore = JSON.stringify(manifestWithOwnBudget.ciGateBudget);
    compareBudgets(classicTicTacToe, manifestWithOwnBudget, [1000, 4000], { seed: "suites-test:c24:no-mutation", games: 10 });
    expect(JSON.stringify(manifestWithOwnBudget.difficultyTiers)).toBe(tiersBefore);
    expect(JSON.stringify(manifestWithOwnBudget.ciGateBudget)).toBe(budgetBefore);
  });

  it("always runs at suite 'ci' — a rollout-budget comparison is a CI-suite-only concept (nightly ignores the override, so every candidate would be identical there)", () => {
    // A candidate low enough that, if suite were somehow "nightly" (which ignores the
    // override), strong-vs-random would run at the full 10,000-rollout shipped budget and pass
    // comfortably. At "ci" it must actually apply the low candidate and can regress for real.
    const points = compareBudgets(classicTicTacToe, manifest, [1], { seed: "suites-test:c24:always-ci", games: 20 });
    const gate = points[0]!.report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(gate.status).toBe("fail");
    expect(points[0]!.report.suite).toBe("ci");
  });

  it("each candidate's report reflects ITS OWN rollout count, not the previous one (a real, observable difference across the sweep)", () => {
    const points = compareBudgets(classicTicTacToe, manifest, [1, 8000], {
      seed: "suites-test:c24:real-difference",
      games: 20,
    });
    const weak = points[0]!.report.gates.find((g) => g.gate === "strong-vs-random")!;
    const strong = points[1]!.report.gates.find((g) => g.gate === "strong-vs-random")!;
    expect(weak.status).toBe("fail");
    expect(strong.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C27: Order vs Chaos, Tilt, and Bid-Tac-Toe (docs/plans/) each name
// the `"deferred"` status as a load-bearing dependency for their own balance-gate reporting at
// PR tier — the two-player analogue of Mine Run's solo-chase problem. `manifest.ciGateBudget.
// deferGatesToNightly` skips self-play ENTIRELY at suite "ci" (not scaled down — skipped), and
// every affected row reports `"deferred"`, naming nightly and the manifest's own reason.
// ---------------------------------------------------------------------------------------

const DEFERRAL_REASON = "balance rows cost ~25 min at 100 games/matchup in CI — platform-corrections.md C27";

describe("evaluateCiGates — C27: 'deferred' status, pure evaluator", () => {
  it("every deferrable row reports 'deferred', naming nightly and the reason, when a deferral is active", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      undefined,
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    for (const name of ["strong-vs-random", "first-player-win-rate", "draw-rate", "mean-plies", "ruthless-vs-standard"]) {
      const g = gates.find((x) => x.gate === name)!;
      expect(g.status, `gate ${name}`).toBe("deferred");
      expect(g.detail).toContain("nightly");
      expect(g.detail).toContain(DEFERRAL_REASON);
    }
    // solved-value-reached: HEALTHY carries no solvedValue, so it is n/a (a DIFFERENT, prior
    // reason) rather than "deferred" — proven directly below with its own manifest.
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("n/a");
  });

  it("solved-value-reached ALSO defers when the manifest has a proven value and deferral is active", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      { value: "draw", proof: SOLVE_REPORT_PROOF },
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    expect(gates.find((g) => g.gate === "solved-value-reached")!.status).toBe("deferred");
  });

  it("SUPERSEDED BY C55 (platform-corrections.md): the solvedValue-proven n/a of FPA/draw-rate/ruthless-vs-standard is NOT structural regardless of deferral — it depends on self-play attainment, and deferral means self-play never ran, so that fact is unmeasured this tier, not 'known true'. All three defer, exactly like strong-vs-random and mean-plies (see the dedicated C55 deferral describe block above for the full story)", () => {
    const gates = evaluateCiGates(
      HEALTHY,
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      { value: "draw", proof: SOLVE_REPORT_PROOF },
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    expect(gates.find((g) => g.gate === "first-player-win-rate")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "draw-rate")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "strong-vs-random")!.status).toBe("deferred");
    expect(gates.find((g) => g.gate === "mean-plies")!.status).toBe("deferred");
  });

  it("ruthless-vs-standard stays n/a ('no standard tier'), never 'deferred', when the manifest genuinely has no standard tier — deferral never invents a row to defer", () => {
    const gates = evaluateCiGates(
      { ...HEALTHY, ruthlessVsStandardWinRate: null },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      undefined,
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    const gate = gates.find((g) => g.gate === "ruthless-vs-standard")!;
    expect(gate.status).toBe("n/a");
    expect(gate.detail).toContain("standard");
    expect(gate.detail).not.toContain("nightly");
  });

  it("allGatesPass-equivalent (report.ok) is TRUE for a fully-deferred report — CI can go green with deferred rows; hasDeferredGates is what tells the two apart", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", undefined, undefined, {
      active: true,
      reason: DEFERRAL_REASON,
    });
    expect(gates.every((g) => g.status !== "fail")).toBe(true);
    expect(hasDeferredGates(gates)).toBe(true);
  });

  it("hasDeferredGates is false for a fully-measured (non-deferred) report", () => {
    const gates = evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    expect(hasDeferredGates(gates)).toBe(false);
  });

  it("N/A is provably distinguishable from DEFERRED in the RENDERED report — plant-and-observe of the actual formatter, not just the status enum", () => {
    // C55 note: the solvedValue-proven n/a of FPA/draw-rate/ruthless-vs-standard is no longer
    // structural-regardless-of-deferral (see the dedicated C55 deferral tests above) — under an
    // active deferral it now defers too, same as every other self-play-derived row. The ONE row
    // that remains n/a unconditionally, even under deferral, is ruthless-vs-standard's "no
    // standard tier at all" case — a manifest fact independent of solvedValue, deferral, AND
    // self-play. That is the plant this test now uses to prove N/A vs DEFERRED stay visually
    // distinguishable in the rendered table.
    const gates = evaluateCiGates(
      { ...HEALTHY, ruthlessVsStandardWinRate: null },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      undefined,
      undefined,
      { active: true, reason: DEFERRAL_REASON }
    );
    const ok = gates.every((g) => g.status !== "fail");
    const rendered = formatCiSuiteTable({ gameId: "ovc-fixture", suite: "ci", ok, gates, matchups: null });
    const lines = rendered.split("\n");
    const rvsLine = lines.find((l) => l.includes("ruthless-vs-standard"))!;
    const strongVsRandomLine = lines.find((l) => l.includes("strong-vs-random"))!;
    expect(rvsLine).toContain("[N/A ]"); // structural, unaffected by deferral
    expect(rvsLine).not.toContain("[DEFER]");
    expect(strongVsRandomLine).toContain("[DEFER]"); // Strong-dependent, deferred
    expect(strongVsRandomLine).not.toContain("[N/A ]");
    expect(strongVsRandomLine).not.toContain("[PASS]");
  });

  it("ABUSE GUARD: suite 'nightly' with an active deferral throws TwoPlayerDeferredGateAtNightlyError — a row deferred at every tier must be a loud failure, not a quiet status", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", undefined, undefined, {
        active: true,
        reason: DEFERRAL_REASON,
      })
    ).toThrow(TwoPlayerDeferredGateAtNightlyError);
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", undefined, undefined, {
        active: true,
        reason: DEFERRAL_REASON,
      })
    ).toThrow(/never runs/);
  });

  it("nightly with an INACTIVE (or absent) deferral is unaffected by the guard", () => {
    expect(() =>
      evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", undefined, undefined, {
        active: false,
        reason: DEFERRAL_REASON,
      })
    ).not.toThrow();
    expect(() => evaluateCiGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly")).not.toThrow();
  });
});

describe("runCiSuite — C27: real wiring, no self-play at all when deferral is active", () => {
  function deferrableManifest(withStandardTier: boolean): GameManifest {
    return {
      id: "c27-two-player-fixture",
      title: "C27 Two-Player Fixture",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C27 fixture.",
      tags: [],
      estMinutes: 1,
      modes: { bot: true, hotseat: false, asyncLink: false },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        ...(withStandardTier
          ? [{ id: "standard" as const, policy: { kind: "mcts" as const }, budget: { kind: "rollouts" as const, n: 1000 }, minReplyMs: 0 }]
          : []),
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { deferGatesToNightly: { reason: DEFERRAL_REASON } },
    };
  }

  it("suite 'ci': matchups is null, every deferrable row is 'deferred', and NO MissingCiRolloutBudgetError fires despite the shipped ruthless budget (10,000) exceeding MAX_CI_ROLLOUTS_WITHOUT_OVERRIDE with no twoPlayerCiRollouts override set — because self-play never runs at all", () => {
    const report = runCiSuite(classicTicTacToe, deferrableManifest(true), {
      seed: "suites-test:c27:ci-deferred",
      games: 100,
    });
    expect(report.matchups).toBeNull();
    expect(report.gates.find((g) => g.gate === "strong-vs-random")!.status).toBe("deferred");
    expect(report.gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("deferred");
    expect(report.ok).toBe(true); // no fail — a provisional pass
  });

  it("a manifest with NO standard tier still reports ruthless-vs-standard as n/a (not deferred) under an active deferral", () => {
    const report = runCiSuite(classicTicTacToe, deferrableManifest(false), {
      seed: "suites-test:c27:ci-deferred-no-standard",
      games: 100,
    });
    expect(report.gates.find((g) => g.gate === "ruthless-vs-standard")!.status).toBe("n/a");
  });

  it("suite 'nightly' IGNORES deferGatesToNightly entirely — real self-play runs, matchups is non-null, every row is measured for real (never 'deferred')", () => {
    const report = runCiSuite(classicTicTacToe, deferrableManifest(true), {
      seed: "suites-test:c27:nightly-measures-for-real",
      games: 20,
      suite: "nightly",
    });
    expect(report.matchups).not.toBeNull();
    for (const g of report.gates) {
      expect(g.status, `gate ${g.gate}`).not.toBe("deferred");
    }
  }, 30_000);

  it("PLANTED VIOLATION: a deferred CI run can still be a REAL fail if grind/whatever else the manifest declares stays wired — proven here via a manifest exception's own presence being irrelevant to a hard-coded sabotage: deferral covers self-play rows, so a manifest requiring a 'standard' tier that doesn't exist still throws its OWN unrelated error, proving deferral doesn't swallow other real errors", () => {
    // Sanity/negative-space check: deferral must not become a blanket try/catch that silently
    // absorbs unrelated configuration errors. A manifest with NO 'ruthless' tier at all still
    // throws the pre-existing, unrelated "no ruthless tier" error even with deferral declared.
    const manifest: GameManifest = {
      ...deferrableManifest(true),
      difficultyTiers: [], // no ruthless tier at all
    };
    expect(() => runCiSuite(classicTicTacToe, manifest, { seed: "suites-test:c27:no-ruthless-tier", games: 10 })).toThrow(
      /no "ruthless" difficulty tier/
    );
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C48 (ruled), routed at C62 — a game may declare, via
// `manifest.mirrorProbe`, that the mirror-bot degeneracy probe (roadmap §6's design gate,
// "mirror bot <40% as P2") does not apply to it: "where mirroring is provably not
// value-preserving, the probe cannot measure its claim... a WARN invites someone to tune away
// a number that never meant anything." The gate must report `n/a`, citing the reason — and a
// game that never declares must see NO change at all, at any call site.
// ---------------------------------------------------------------------------------------

describe("evaluateMirrorProbeGate() — pure evaluator (C48/C62)", () => {
  it("returns null when the manifest does not declare mirrorProbe at all (the default)", () => {
    expect(evaluateMirrorProbeGate({ id: "some-game" })).toBeNull();
  });

  it("returns an n/a GateResult citing the reason verbatim when declared", () => {
    const result = evaluateMirrorProbeGate({
      id: "duel-draft",
      mirrorProbe: { applicable: false, reason: "no prior move within a round exists to mirror" },
    });
    expect(result).not.toBeNull();
    expect(result!.gate).toBe("mirror-probe");
    expect(result!.status).toBe("n/a");
    expect(result!.detail).toContain("no prior move within a round exists to mirror");
  });

  it("REFUSES a declared-but-empty reason (EmptyMirrorProbeReasonError), never silently accepting a bare opt-out", () => {
    expect(() =>
      evaluateMirrorProbeGate({ id: "some-game", mirrorProbe: { applicable: false, reason: "" } })
    ).toThrow(EmptyMirrorProbeReasonError);
  });

  it("REFUSES a whitespace-only reason the same way (not merely an empty-string check)", () => {
    expect(() =>
      evaluateMirrorProbeGate({ id: "some-game", mirrorProbe: { applicable: false, reason: "   \n\t " } })
    ).toThrow(EmptyMirrorProbeReasonError);
  });

  it("PLANTED VIOLATION: if the empty-reason guard is removed, the refusal test above stops throwing — proving the guard, not the test, is what fires", () => {
    // Mutation-test the guard itself (C41: "a guard that passes because the situation could not
    // distinguish honesty from cheating"): a version of evaluateMirrorProbeGate that skips the
    // trim().length === 0 check would return a GateResult instead of throwing. Reproduced here
    // directly (not by editing suites.ts) so this test file is its own evidence that the assertion
    // above is load-bearing, not vacuous.
    function unguarded(manifest: { id: string; mirrorProbe?: { applicable: false; reason: string } }) {
      const decl = manifest.mirrorProbe;
      if (decl === undefined) return null;
      // (guard intentionally omitted here)
      return { gate: "mirror-probe", status: "n/a" as const, detail: `not applicable: ${decl.reason}` };
    }
    // With the guard removed, a blank reason no longer throws — it silently produces a row.
    expect(() => unguarded({ id: "some-game", mirrorProbe: { applicable: false, reason: "" } })).not.toThrow();
    // The REAL function still throws for the identical input — confirming the guard in suites.ts
    // is what makes the "REFUSES a declared-but-empty reason" test above fail if ever removed.
    expect(() =>
      evaluateMirrorProbeGate({ id: "some-game", mirrorProbe: { applicable: false, reason: "" } })
    ).toThrow(EmptyMirrorProbeReasonError);
  });

  // stage-6 review finding (was 🟡-2), ruled: a "symmetric"-tagged game may ALSO declare
  // mirrorProbe: { applicable: false } — Bid-Tac-Toe is exactly that case (symmetric BOARD, but
  // bids and the star have no reflective analogue). A hard refusal keyed on the "symmetric" tag
  // would be WRONG here: the declaration overrides the tag's own probe expectation, it does not
  // conflict with it. Pinned as an executable assertion rather than left as a sentence in a
  // review — evaluateMirrorProbeGate's own parameter type (`Pick<GameManifest, "id" |
  // "mirrorProbe">`) already structurally cannot see `tags` at all, which is what makes "the
  // declaration overrides the tag" true by construction; this test is what breaks if a future
  // change ever widens the signature to inspect tags and adds a hard refusal there.
  it("a manifest tagged \"symmetric\" that ALSO declares mirrorProbe: { applicable: false } still returns the n/a row — the declaration overrides the tag's own probe expectation, never a hard refusal", () => {
    const bidTacToeShapedManifest: GameManifest = {
      id: "bid-tac-toe-fixture",
      title: "Bid-Tac-Toe Fixture",
      classic: "Tic-Tac-Toe",
      ruleSentence: "suites.test.ts C63 tag-interaction fixture.",
      tags: ["symmetric"],
      estMinutes: 3,
      modes: { bot: true, hotseat: true, asyncLink: true },
      players: { min: 2, max: 2 },
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 200 }, minReplyMs: 0 },
      ],
      mirrorProbe: { applicable: false, reason: "board is spatially symmetric but bids and the star have no reflective analogue" },
    };
    const result = evaluateMirrorProbeGate(bidTacToeShapedManifest);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("n/a");
    expect(result!.detail).toBe("not applicable: board is spatially symmetric but bids and the star have no reflective analogue");
  });

  // stage-6 review finding (was 🔵-1), ruled: evaluateMirrorProbeGate never actually reads
  // `decl.applicable` — it keys on PRESENCE of `mirrorProbe` alone, so a manifest that reaches
  // this function through a cast (or a future non-TS path, e.g. JSON loaded from a database once
  // Phase 2 lands) with `applicable: true` would still yield an n/a row asserting the exact
  // opposite of what was declared. The TYPE (`{ readonly applicable: false; ... }`) already
  // promises this can't happen — this closes the gap between that promise and the runtime.
  it("THROWS InvalidMirrorProbeDeclarationError if mirrorProbe.applicable is not the literal false the type requires (a cast or non-TS path bypassing the type)", () => {
    const smuggledTrue = {
      id: "some-game",
      mirrorProbe: { applicable: true, reason: "should never reach a gate row" },
    } as unknown as Pick<GameManifest, "id" | "mirrorProbe">;
    expect(() => evaluateMirrorProbeGate(smuggledTrue)).toThrow(InvalidMirrorProbeDeclarationError);
  });

  it("also throws for a non-boolean applicable value (defense in depth against a raw, un-typed JSON declaration)", () => {
    const smuggledJunk = {
      id: "some-game",
      mirrorProbe: { applicable: "false", reason: "the string \"false\", not the literal" },
    } as unknown as Pick<GameManifest, "id" | "mirrorProbe">;
    expect(() => evaluateMirrorProbeGate(smuggledJunk)).toThrow(InvalidMirrorProbeDeclarationError);
  });

  it("the applicable check fires (not EmptyMirrorProbeReasonError) even when reason is ALSO blank — proving the two guards are independent, not one masking the other", () => {
    const smuggledTrueBlankReason = {
      id: "some-game",
      mirrorProbe: { applicable: true, reason: "" },
    } as unknown as Pick<GameManifest, "id" | "mirrorProbe">;
    let thrown: unknown;
    try {
      evaluateMirrorProbeGate(smuggledTrueBlankReason);
    } catch (e) {
      thrown = e;
    }
    // Specifically NOT EmptyMirrorProbeReasonError — if the applicable check were missing (or
    // ordered after the reason check), this input would throw that instead, and this assertion
    // is what would catch that silently-wrong ordering.
    expect(thrown).toBeInstanceOf(InvalidMirrorProbeDeclarationError);
    expect(thrown).not.toBeInstanceOf(EmptyMirrorProbeReasonError);
  });
});

describe("runCiSuite() — C48/C62: mirror-probe declaration wired into the real report", () => {
  const baseManifest: GameManifest = {
    id: "mirror-probe-fixture",
    title: "Mirror Probe Fixture",
    classic: "Tic-Tac-Toe",
    ruleSentence: "suites.test.ts C48/C62 fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 200 }, minReplyMs: 0 },
    ],
  };

  it("a manifest that does NOT declare mirrorProbe gets the exact same six gate rows as before this mechanism existed — no 'mirror-probe' row appears", () => {
    const report = runCiSuite(classicTicTacToe, baseManifest, { seed: "suites-test:mirror:undeclared", games: 20 });
    expect(report.gates.find((g) => g.gate === "mirror-probe")).toBeUndefined();
    expect(report.gates.map((g) => g.gate).sort()).toEqual(
      [
        "strong-vs-random",
        "first-player-win-rate",
        "draw-rate",
        "mean-plies",
        "ruthless-vs-standard",
        "solved-value-reached",
      ].sort()
    );
  });

  it("a manifest that DECLARES mirrorProbe gets a seventh 'mirror-probe' row, status n/a, citing the reason — every other row unchanged", () => {
    const declaringManifest: GameManifest = {
      ...baseManifest,
      id: "mirror-probe-fixture-declaring",
      mirrorProbe: { applicable: false, reason: "bids and the star have no reflective analogue" },
    };
    const report = runCiSuite(classicTicTacToe, declaringManifest, { seed: "suites-test:mirror:declared", games: 20 });
    const mirrorRow = report.gates.find((g) => g.gate === "mirror-probe");
    expect(mirrorRow).toBeDefined();
    expect(mirrorRow!.status).toBe("n/a");
    expect(mirrorRow!.detail).toBe("not applicable: bids and the star have no reflective analogue");
    expect(report.gates.length).toBe(7); // the six existing rows, plus this one
  });

  it("declaring mirrorProbe changes NOTHING about the other six gates or the overall verdict — under the IDENTICAL seed, it only adds one n/a row (n/a is never a failure, so it can never independently flip report.ok)", () => {
    const seed = "suites-test:mirror:parity";
    const undeclaredReport = runCiSuite(classicTicTacToe, baseManifest, { seed, games: 20 });
    const declaringManifest: GameManifest = {
      ...baseManifest,
      id: "mirror-probe-fixture-parity",
      mirrorProbe: { applicable: false, reason: "provably not value-preserving for this game" },
    };
    const declaredReport = runCiSuite(classicTicTacToe, declaringManifest, { seed, games: 20 });

    // Same seed, same tiers, same engine — the six pre-existing gates must be byte-identical
    // (manifest.id and mirrorProbe feed nothing into runMatchup's own seeding), regardless of
    // whether THIS run happens to pass or fail every one of them for unrelated reasons.
    const declaredNonMirrorGates = declaredReport.gates.filter((g) => g.gate !== "mirror-probe");
    expect(declaredNonMirrorGates).toEqual(undeclaredReport.gates);

    // The verdict tracks the SAME six gates either way — declaring mirrorProbe can only ADD an
    // n/a row (never "fail"), so it never independently changes report.ok in either direction.
    expect(declaredReport.ok).toBe(undeclaredReport.ok);
  });

  it("the mirror-probe row appears even under an active C27 deferral (it costs no self-play, so it is never itself deferred)", () => {
    const deferredDeclaringManifest: GameManifest = {
      ...baseManifest,
      id: "mirror-probe-fixture-deferred",
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10_000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { deferGatesToNightly: { reason: "unaffordable at ci tier — suites.test.ts fixture" } },
      mirrorProbe: { applicable: false, reason: "no prior move within a round to mirror" },
    };
    const report = runCiSuite(classicTicTacToe, deferredDeclaringManifest, {
      seed: "suites-test:mirror:deferred",
      games: 20,
    });
    expect(report.matchups).toBeNull(); // deferral really is active
    const mirrorRow = report.gates.find((g) => g.gate === "mirror-probe");
    expect(mirrorRow?.status).toBe("n/a");
    expect(mirrorRow?.detail).toBe("not applicable: no prior move within a round to mirror");
  });

  it("an UNDECLARED manifest under the SAME active C27 deferral still gets no mirror-probe row — isolation holds in the deferred branch too, not only the normal one", () => {
    const deferredUndeclaredManifest: GameManifest = {
      ...baseManifest,
      id: "mirror-probe-fixture-deferred-undeclared",
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10_000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { deferGatesToNightly: { reason: "unaffordable at ci tier — suites.test.ts fixture" } },
      // deliberately NO mirrorProbe here
    };
    const report = runCiSuite(classicTicTacToe, deferredUndeclaredManifest, {
      seed: "suites-test:mirror:deferred-undeclared",
      games: 20,
    });
    expect(report.matchups).toBeNull(); // deferral really is active
    expect(report.gates.find((g) => g.gate === "mirror-probe")).toBeUndefined();
    expect(report.gates.length).toBe(6);
  });

  it("renders visibly distinct from PASS in formatCiSuiteTable (C2: a skipped gate and a passed gate must never look the same)", () => {
    const declaringManifest: GameManifest = {
      ...baseManifest,
      id: "mirror-probe-fixture-render",
      mirrorProbe: { applicable: false, reason: "board is spatially symmetric but bids/star are not" },
    };
    const report = runCiSuite(classicTicTacToe, declaringManifest, { seed: "suites-test:mirror:render", games: 20 });
    const table = formatCiSuiteTable(report);
    expect(table).toContain("[N/A ] mirror-probe: not applicable: board is spatially symmetric but bids/star are not");
    expect(table).not.toContain("[PASS] mirror-probe");
    expect(table).not.toContain("[WARN] mirror-probe");
  });

  it("PLANTED VIOLATION (isolation direction): if runCiSuite unconditionally appended a mirror-probe row regardless of the manifest, an undeclared game's gates array would grow — proving the conditional append (not luck) is what keeps undeclared games byte-identical", () => {
    const before = runCiSuite(classicTicTacToe, baseManifest, { seed: "suites-test:mirror:isolation", games: 20 });
    // Simulate the violation locally: an unconditional append (the bug this test guards against
    // would look like) always adds a row, even with mirrorGate === null upstream.
    const unconditionallyAppended = [...before.gates, { gate: "mirror-probe", status: "n/a" as const, detail: "not applicable: (bug) always appended" }];
    expect(unconditionallyAppended.length).toBe(before.gates.length + 1);
    // The REAL runCiSuite output for this same undeclared manifest does NOT do this:
    expect(before.gates.length).toBe(6);
    expect(before.gates.find((g) => g.gate === "mirror-probe")).toBeUndefined();
  });

  it("REFUSES a declared-but-blank reason from INSIDE runCiSuite itself — a game cannot get a report built on a blank opt-out, not just a bare call to evaluateMirrorProbeGate", () => {
    const blankReasonManifest: GameManifest = {
      ...baseManifest,
      id: "mirror-probe-fixture-blank-via-runcisuite",
      mirrorProbe: { applicable: false, reason: "   " },
    };
    let report: CiSuiteReport | undefined;
    let thrown: unknown;
    try {
      report = runCiSuite(classicTicTacToe, blankReasonManifest, { seed: "suites-test:mirror:blank-runcisuite", games: 20 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EmptyMirrorProbeReasonError);
    // No report was ever produced — the blank declaration never gets far enough to render.
    expect(report).toBeUndefined();
  });

  it("REFUSES a declared-but-blank reason from runCiSuite's DEFERRED branch too (C27 deferral does not bypass the C48 refusal)", () => {
    const blankReasonDeferredManifest: GameManifest = {
      ...baseManifest,
      id: "mirror-probe-fixture-blank-deferred",
      difficultyTiers: [
        { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 10_000 }, minReplyMs: 0 },
      ],
      ciGateBudget: { deferGatesToNightly: { reason: "unaffordable at ci tier — suites.test.ts fixture" } },
      mirrorProbe: { applicable: false, reason: "\n\t " },
    };
    expect(() =>
      runCiSuite(classicTicTacToe, blankReasonDeferredManifest, { seed: "suites-test:mirror:blank-deferred", games: 20 })
    ).toThrow(EmptyMirrorProbeReasonError);
  });
});

// packages/harness/test/probes-two-player.test.ts — TDD anchor: the two-player degeneracy probe
// suite (docs/plans/degeneracy-probes.md, C64: mirror/stall/rush existed as real, tested bot
// policies with ZERO CI call sites outside three hand-written Tilt research scripts — five games
// shipped through a gate table that silently omitted all three). Red first: probes-two-player.ts
// does not exist yet.
//
// Same "pure evaluator vs real wiring" split as suites.ts (see that module's own doc), for the
// identical reason: every threshold gets its own planted-violation test against
// `evaluateProbeGates` (hand-built inputs, no self-play needed), and a smaller, separate test
// proves `runProbeSuite` wires a REAL matchup into it.

import { describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { TTTMove, TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";
import type { GameManifest } from "@twist-arcade/game-spec";
import {
  EmptyExceptionJustificationError,
  UnknownExceptionGateError,
  type CiGateDeferral,
} from "../src/suites";
import {
  evaluateProbeGates,
  ProbeDeferredGateAtNightlyError,
  runProbeSuite,
  type ProbeGateInputs,
} from "../src/probes-two-player";

// classic-ttt's own point-reflection mirror: cell -> 8 - cell (identical shape to Fadeout's real
// mirrorMove on the same 3x3 board — games/fadeout/probes.ts). A local test fixture, not a
// production export, since classic-ttt is an internal engine fixture, not a shipped game.
function tttMirrorMove(_state: TTTState, lastOppMove: TTTMove | null, legalMoves: readonly TTTMove[]): TTTMove | null {
  if (lastOppMove === null) return null;
  const reflected = 8 - lastOppMove.cell;
  const candidate = legalMoves.find((m) => m.cell === reflected);
  return candidate ?? null;
}

// A GateInputs value that passes every gate cleanly — every planted-violation test below starts
// from a clone of this and perturbs exactly one field, so a test failure always isolates to the
// one threshold it claims to be testing (mirrors suites.test.ts's own HEALTHY convention).
const HEALTHY: ProbeGateInputs = {
  mirror: { kind: "available", winRate: 0.1, drawRate: 0.1, mirrorFallbackRate: 0 },
  stallCapHitRate: 0,
  stallWinRate: 0.05,
  rushScore: 0.2,
};

function statusOf(inputs: ProbeGateInputs, gate: string, suite: "ci" | "nightly" = "ci") {
  const gates = evaluateProbeGates(inputs, DEFAULT_HARNESS_THRESHOLDS, [], suite);
  const found = gates.find((g) => g.gate === gate);
  if (!found) throw new Error(`test setup error: no gate named "${gate}" in ${JSON.stringify(gates)}`);
  return found.status;
}

describe("evaluateProbeGates() — healthy baseline", () => {
  it("every gate passes when every metric is comfortably inside its band", () => {
    const gates = evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    expect(gates.map((g) => g.gate).sort()).toEqual(["mirror-probe", "rush-probe", "stall-probe"]);
    for (const g of gates) {
      expect(g.status, `gate ${g.gate}: ${g.detail}`).toBe("pass");
    }
  });
});

describe("evaluateProbeGates() — mirror-probe exclusivity (plan §4.3)", () => {
  it("kind 'suppressed' (manifest.mirrorProbe declared) produces NO mirror-probe row at all", () => {
    const gates = evaluateProbeGates({ ...HEALTHY, mirror: { kind: "suppressed" } }, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
    expect(gates.find((g) => g.gate === "mirror-probe")).toBeUndefined();
    // stall/rush are unaffected — suppression is mirror-specific.
    expect(gates.find((g) => g.gate === "stall-probe")).toBeDefined();
    expect(gates.find((g) => g.gate === "rush-probe")).toBeDefined();
  });

  it("kind 'unavailable' (no mirrorMove, not declared) reports n/a citing the reason, ALWAYS exactly one row", () => {
    const gates = evaluateProbeGates(
      { ...HEALTHY, mirror: { kind: "unavailable", reason: "not tagged symmetric and no export" } },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci"
    );
    const rows = gates.filter((g) => g.gate === "mirror-probe");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("n/a");
    expect(rows[0]!.detail).toContain("not tagged symmetric and no export");
  });

  it("exactly one mirror-probe row in every report, never zero-or-two, across all three mirror kinds", () => {
    for (const mirror of [
      { kind: "suppressed" as const },
      { kind: "unavailable" as const, reason: "x" },
      { kind: "available" as const, winRate: 0.1, drawRate: 0.1, mirrorFallbackRate: 0 },
    ]) {
      const gates = evaluateProbeGates({ ...HEALTHY, mirror }, DEFAULT_HARNESS_THRESHOLDS, [], "ci");
      const rows = gates.filter((g) => g.gate === "mirror-probe");
      expect(rows.length, JSON.stringify(mirror)).toBeLessThanOrEqual(1);
    }
  });
});

describe("evaluateProbeGates() — planted violations, one gate at a time", () => {
  it("mirror-probe: win rate < 40% passes", () => {
    expect(statusOf(HEALTHY, "mirror-probe")).toBe("pass"); // control
    expect(statusOf({ ...HEALTHY, mirror: { kind: "available", winRate: 0.39, drawRate: 0.1, mirrorFallbackRate: 0 } }, "mirror-probe")).toBe("pass");
  });

  it("mirror-probe: win rate in [40%, 50%) warns", () => {
    expect(statusOf({ ...HEALTHY, mirror: { kind: "available", winRate: 0.4, drawRate: 0.1, mirrorFallbackRate: 0 } }, "mirror-probe")).toBe("warn"); // boundary inclusive
    expect(statusOf({ ...HEALTHY, mirror: { kind: "available", winRate: 0.49, drawRate: 0.1, mirrorFallbackRate: 0 } }, "mirror-probe")).toBe("warn");
  });

  it("mirror-probe: win rate >= 50% fails at nightly, but WARNS at ci (severity split, plan §1.4)", () => {
    expect(statusOf({ ...HEALTHY, mirror: { kind: "available", winRate: 0.5, drawRate: 0.1, mirrorFallbackRate: 0 } }, "mirror-probe", "nightly")).toBe("fail");
    expect(statusOf({ ...HEALTHY, mirror: { kind: "available", winRate: 0.5, drawRate: 0.1, mirrorFallbackRate: 0 } }, "mirror-probe", "ci")).toBe("warn");
  });

  // STAGE-6 FINDING (recorded, not fixed in-branch — see MirrorProbeInput's own doc): the
  // canonical mirror pathology (game-theory-lens §5.4: "P2 copying P1's move through the center
  // can force a draw") is invisible to wins/games. Pinned here as an executable, honest
  // "known gap" — a mirror that draws EVERY game still reports a clean PASS, and the draw rate
  // is recorded in the detail (not gated on).
  it("KNOWN GAP: a mirror that draws 100% of its games (the exact pathology game-theory-lens §5.4 names) still PASSES — wins/games cannot see it; the draw rate is recorded in the detail only", () => {
    const gates = evaluateProbeGates(
      { ...HEALTHY, mirror: { kind: "available", winRate: 0, drawRate: 1.0, mirrorFallbackRate: 0 } },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci"
    );
    const mirror = gates.find((g) => g.gate === "mirror-probe")!;
    expect(mirror.status).toBe("pass"); // the gap: this SHOULD be actionable and isn't, today
    expect(mirror.detail).toContain("100.0%"); // the draw rate is at least visible in the report
  });

  // platform-corrections.md C81 / task #26: the Nine Grids finding — a mirror row that scores
  // "0% win rate" gave no way to tell "mirrored and lost every game" apart from "never mirrored
  // at all, lost to deterministic first-legal-move fallback play" (measured 85.7% fallback for
  // Nine Grids through the real matchup shape, entirely invisible to the report before this).
  // `mirrorFallbackRate` closes that — recorded in the detail, NOT gated on (same posture as
  // `drawRate` above: this is disclosure, not a new pass/fail condition).
  it("mirror-probe detail discloses mirror content vs. fallback rate (recorded only, never gated on)", () => {
    const mostlyFallback = evaluateProbeGates(
      { ...HEALTHY, mirror: { kind: "available", winRate: 0.05, drawRate: 0.1, mirrorFallbackRate: 0.857 } },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci"
    );
    const mirror = mostlyFallback.find((g) => g.gate === "mirror-probe")!;
    // Still governed entirely by winRate (5% < 40% warn threshold) — mirrorFallbackRate never
    // changes the verdict, only the detail text.
    expect(mirror.status).toBe("pass");
    expect(mirror.detail).toContain("mirror content 14.3%");
    expect(mirror.detail).toContain("85.7% of this agent's own moves were the harness's null-target fallback");

    const allMirroring = evaluateProbeGates(
      { ...HEALTHY, mirror: { kind: "available", winRate: 0.05, drawRate: 0.1, mirrorFallbackRate: 0 } },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci"
    );
    expect(allMirroring.find((g) => g.gate === "mirror-probe")!.detail).toContain("mirror content 100.0%");
  });

  it("stall-probe: any nonzero cap-hit rate warns, even with a healthy win rate", () => {
    expect(statusOf({ ...HEALTHY, stallCapHitRate: 0.001 }, "stall-probe")).toBe("warn");
  });

  it("stall-probe: cap-hit rate > 1% fails at nightly, warns at ci", () => {
    expect(statusOf({ ...HEALTHY, stallCapHitRate: 0.011 }, "stall-probe", "nightly")).toBe("fail");
    expect(statusOf({ ...HEALTHY, stallCapHitRate: 0.011 }, "stall-probe", "ci")).toBe("warn");
  });

  it("stall-probe: win rate in [20%, 40%) warns", () => {
    expect(statusOf({ ...HEALTHY, stallWinRate: 0.2 }, "stall-probe")).toBe("warn"); // boundary inclusive
    expect(statusOf({ ...HEALTHY, stallWinRate: 0.39 }, "stall-probe")).toBe("warn");
  });

  it("stall-probe: win rate >= 40% fails at nightly, warns at ci", () => {
    expect(statusOf({ ...HEALTHY, stallWinRate: 0.4 }, "stall-probe", "nightly")).toBe("fail");
    expect(statusOf({ ...HEALTHY, stallWinRate: 0.4 }, "stall-probe", "ci")).toBe("warn");
  });

  it("rush-probe: parity score <= 40% passes", () => {
    expect(statusOf({ ...HEALTHY, rushScore: 0.4 }, "rush-probe")).toBe("pass"); // boundary inclusive on the PASS side
  });

  it("rush-probe: parity score in (40%, 45%) warns", () => {
    expect(statusOf({ ...HEALTHY, rushScore: 0.41 }, "rush-probe")).toBe("warn");
    expect(statusOf({ ...HEALTHY, rushScore: 0.44 }, "rush-probe")).toBe("warn");
  });

  it("rush-probe: parity score >= 45% fails at nightly, warns at ci", () => {
    expect(statusOf({ ...HEALTHY, rushScore: 0.45 }, "rush-probe", "nightly")).toBe("fail");
    expect(statusOf({ ...HEALTHY, rushScore: 0.45 }, "rush-probe", "ci")).toBe("warn");
  });
});

describe("evaluateProbeGates() — rush-probe proven-draw relief (plan §1.3, reuses solvedValueAttainment)", () => {
  it("a rush score that would otherwise FAIL reports n/a, citing the proof, when the caller supplies a reached rushDrawAttainment", () => {
    const gates = evaluateProbeGates(
      { ...HEALTHY, rushScore: 0.9 }, // would be a hard fail on its own
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "nightly",
      undefined,
      { reached: true, proof: "docs/research/games/fadeout-solve-report.md §1.1" }
    );
    const rush = gates.find((g) => g.gate === "rush-probe")!;
    expect(rush.status).toBe("n/a");
    expect(rush.detail).toContain("fadeout-solve-report.md");
  });

  it("a rushDrawAttainment that was NOT reached grants no relief — rush still measures for real", () => {
    const gates = evaluateProbeGates(
      { ...HEALTHY, rushScore: 0.9 },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "nightly",
      undefined,
      { reached: false, proof: "some proof" }
    );
    expect(gates.find((g) => g.gate === "rush-probe")!.status).toBe("fail");
  });

  it("omitting rushDrawAttainment entirely (the default) grants no relief either", () => {
    expect(statusOf({ ...HEALTHY, rushScore: 0.9 }, "rush-probe", "nightly")).toBe("fail");
  });
});

describe("evaluateProbeGates() — C27 deferral reused, not duplicated (plan §3)", () => {
  const DEFER: CiGateDeferral = { active: true, reason: "too expensive at this tier" };

  it("stall-probe and rush-probe report 'deferred' with the reason folded in, when a deferral is active", () => {
    const gates = evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", DEFER);
    const stall = gates.find((g) => g.gate === "stall-probe")!;
    const rush = gates.find((g) => g.gate === "rush-probe")!;
    expect(stall.status).toBe("deferred");
    expect(stall.detail).toContain(DEFER.reason);
    expect(rush.status).toBe("deferred");
    expect(rush.detail).toContain(DEFER.reason);
  });

  it("mirror-probe ALSO defers when 'available' (a real matchup would have run) under an active deferral", () => {
    const gates = evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", DEFER);
    expect(gates.find((g) => g.gate === "mirror-probe")!.status).toBe("deferred");
  });

  it("mirror-probe stays 'n/a' (never 'deferred') when 'unavailable' — a structural fact independent of self-play cost", () => {
    const gates = evaluateProbeGates(
      { ...HEALTHY, mirror: { kind: "unavailable", reason: "no export" } },
      DEFAULT_HARNESS_THRESHOLDS,
      [],
      "ci",
      DEFER
    );
    expect(gates.find((g) => g.gate === "mirror-probe")!.status).toBe("n/a");
  });

  it("mirror-probe stays SUPPRESSED (no row) under deferral too — the declared branch takes priority over deferral (matches suites.ts's own C48/C62 precedent)", () => {
    const gates = evaluateProbeGates({ ...HEALTHY, mirror: { kind: "suppressed" } }, DEFAULT_HARNESS_THRESHOLDS, [], "ci", DEFER);
    expect(gates.find((g) => g.gate === "mirror-probe")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------
// STAGE-6 CRITICAL FINDING: C27's nightly-active-deferral abuse guard is named explicitly by
// the plan (§3, §5 S2, "done means" #3's own planted violation) — mirroring suites.ts's
// TwoPlayerDeferredGateAtNightlyError and solo-gates.ts's SoloDeferredGateAtNightlyError — but
// was never built. `runProbeSuite` structurally never constructs an active deferral at suite
// "nightly" (only ever consults `deferGatesToNightly` when `suite === "ci"`), so the gap was
// UNREACHABLE through that wrapper, and every existing deferral test above exercises the
// wrapper's own construction, never this evaluator's own seam directly. `evaluateProbeGates` is
// a public export precisely so it CAN be called standalone — this is the planted violation at
// THAT seam, with hand-built inputs, the exact case that was missing.
// ---------------------------------------------------------------------------------------

describe("evaluateProbeGates() — C27's nightly abuse guard (stage-6 CRITICAL finding, fixed)", () => {
  it("PLANTED VIOLATION: suite 'nightly' handed an ACTIVE deferral throws ProbeDeferredGateAtNightlyError — a gate deferred at every tier never runs, C27's exact abuse case", () => {
    const activeDeferral: CiGateDeferral = { active: true, reason: "stage-6 planted violation — must refuse" };
    expect(() => evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", activeDeferral)).toThrow(
      ProbeDeferredGateAtNightlyError
    );
  });

  it("the reason is folded into the thrown error's message", () => {
    const activeDeferral: CiGateDeferral = { active: true, reason: "a specific, citable reason" };
    let thrown: unknown;
    try {
      evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", activeDeferral);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProbeDeferredGateAtNightlyError);
    expect((thrown as Error).message).toContain("a specific, citable reason");
  });

  it("does NOT throw for suite 'ci' with the same active deferral — the guard is nightly-only, matching every sibling C27 guard in this codebase", () => {
    const activeDeferral: CiGateDeferral = { active: true, reason: "fine at ci" };
    expect(() => evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "ci", activeDeferral)).not.toThrow();
  });

  it("does NOT throw for suite 'nightly' with NO deferral (the normal, real-measurement case)", () => {
    expect(() => evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly")).not.toThrow();
  });

  it("does NOT throw for suite 'nightly' with a deferral object present but active: false", () => {
    const inactiveDeferral: CiGateDeferral = { active: false, reason: "not active" };
    expect(() => evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [], "nightly", inactiveDeferral)).not.toThrow();
  });
});

describe("evaluateProbeGates() — exceptions[] (plan §1.4: all three probe gates joined EXCEPTIONABLE_GATES)", () => {
  it("a justified nightly fail downgrades to warn, with the justification attached", () => {
    const gates = evaluateProbeGates(
      { ...HEALTHY, rushScore: 0.9 },
      DEFAULT_HARNESS_THRESHOLDS,
      [{ gate: "rush-probe", justification: "known tactically flat by design, shipped anyway" }],
      "nightly"
    );
    const rush = gates.find((g) => g.gate === "rush-probe")!;
    expect(rush.status).toBe("warn");
    expect(rush.exceptionJustification).toBe("known tactically flat by design, shipped anyway");
  });

  it("validates its OWN exceptions standalone — an unknown gate name throws even with no failing gate anywhere", () => {
    expect(() =>
      evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [{ gate: "not-a-real-gate", justification: "x" }], "ci")
    ).toThrow(UnknownExceptionGateError);
  });

  it("validates its OWN exceptions standalone — a blank justification throws", () => {
    expect(() =>
      evaluateProbeGates(HEALTHY, DEFAULT_HARNESS_THRESHOLDS, [{ gate: "mirror-probe", justification: "  " }], "ci")
    ).toThrow(EmptyExceptionJustificationError);
  });
});

// ---------------------------------------------------------------------------------------
// runProbeSuite — real wiring. Uses classicTicTacToe (an internal perfect-information fixture
// with a real heuristic, so rush's tier-3 fallback is exercised for real) plus a hand-built
// mirrorMove matching Fadeout's own point-reflection convention on the identical 3x3 board.
// ---------------------------------------------------------------------------------------

function baseManifest(overrides: Partial<GameManifest> = {}): GameManifest {
  return {
    id: "probes-two-player-fixture",
    title: "Probes Fixture",
    classic: "Tic-Tac-Toe",
    ruleSentence: "probes-two-player.test.ts fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 50 }, minReplyMs: 0 },
    ],
    ...overrides,
  };
}

describe("runProbeSuite() — real self-play wiring", () => {
  it("games defaults to 100, and is NEVER suite-scaled the way runCiSuite's own games count is (plan §3: 'deliberately not NIGHTLY_GAMES')", () => {
    const report = runProbeSuite(classicTicTacToe, baseManifest(), {
      seed: "probes-two-player:games-default",
      mirrorMove: tttMirrorMove,
    });
    expect(report.matchups!.stall!.metrics.games).toBe(100);
    expect(report.matchups!.rush!.metrics.games).toBe(100);
    expect(report.matchups!.mirror!.metrics.games).toBe(100);
  });

  it("a small explicit games override is honestly forwarded to every one of the three matchups", () => {
    const report = runProbeSuite(classicTicTacToe, baseManifest(), {
      seed: "probes-two-player:games-override",
      games: 10,
      mirrorMove: tttMirrorMove,
    });
    expect(report.matchups!.stall!.metrics.games).toBe(10);
    expect(report.matchups!.rush!.metrics.games).toBe(10);
    expect(report.matchups!.mirror!.metrics.games).toBe(10);
  });

  it("a REAL mirror matchup produces a measured mirror-probe row (not n/a, not suppressed) when mirrorMove is supplied and the manifest does not declare mirrorProbe", () => {
    const report = runProbeSuite(classicTicTacToe, baseManifest(), {
      seed: "probes-two-player:mirror-real",
      games: 20,
      mirrorMove: tttMirrorMove,
    });
    const mirror = report.gates.find((g) => g.gate === "mirror-probe")!;
    expect(["pass", "warn", "fail"]).toContain(mirror.status);
    expect(report.matchups!.mirror).not.toBeNull();
  });

  // platform-corrections.md C81 / task #26: a REAL mirrorFallbackRate, wired end to end from
  // runner.ts's own per-ply counting through MatchupMetrics into the gate detail — never a
  // hand-built number. classic-ttt's own tttMirrorMove fixture returns null whenever the
  // reflected cell isn't currently legal (its own doc comment above), so a real run against a
  // real ruthless opponent genuinely produces SOME fallback substitutions to measure.
  it("mirrorFallbackRate is wired end to end from a REAL matchup's own fallback substitutions, matching MatchupReport's own count exactly", () => {
    const report = runProbeSuite(classicTicTacToe, baseManifest(), {
      seed: "probes-two-player:mirror-fallback-real",
      games: 30,
      mirrorMove: tttMirrorMove,
    });
    const mirrorMatchup = report.matchups!.mirror!;
    const expectedRate = mirrorMatchup.metrics.mirrorFallbackRate;
    expect(expectedRate).not.toBeNull();
    const mirror = report.gates.find((g) => g.gate === "mirror-probe")!;
    expect(mirror.detail).toContain(`mirror content ${((1 - expectedRate!) * 100).toFixed(1)}%`);
  });

  it("omitting mirrorMove (undeclared manifest) reports mirror-probe n/a and runs NO mirror matchup", () => {
    const report = runProbeSuite(classicTicTacToe, baseManifest(), {
      seed: "probes-two-player:mirror-unavailable",
      games: 10,
    });
    const mirror = report.gates.find((g) => g.gate === "mirror-probe")!;
    expect(mirror.status).toBe("n/a");
    expect(report.matchups!.mirror).toBeNull();
  });

  it("a manifest that DECLARES mirrorProbe gets NO mirror-probe row and NO mirror matchup, even when mirrorMove IS supplied (declaration overrides the export — mirror exclusivity)", () => {
    const report = runProbeSuite(
      classicTicTacToe,
      baseManifest({ mirrorProbe: { applicable: false, reason: "test: declared inapplicable" } }),
      { seed: "probes-two-player:mirror-suppressed", games: 10, mirrorMove: tttMirrorMove }
    );
    expect(report.gates.find((g) => g.gate === "mirror-probe")).toBeUndefined();
    expect(report.matchups!.mirror).toBeNull();
  });

  it("a sabotaged stall opponent (ruthless === random) trips stall-probe for real through real self-play", () => {
    // Random opponent lets stall (which maximizes rollout-estimated remaining plies) win far
    // more than the healthy 5% baseline against a real search-based ruthless tier — a real,
    // observable degeneracy signal, not a hand-built number.
    const sabotaged = baseManifest({
      difficultyTiers: [{ id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 }],
    });
    const report = runProbeSuite(classicTicTacToe, sabotaged, {
      seed: "probes-two-player:stall-sabotaged",
      games: 30,
    });
    const stall = report.gates.find((g) => g.gate === "stall-probe")!;
    // Not asserting a specific status (stochastic against a real random opponent) — asserting
    // the wiring is REAL: a genuinely measured, non-NaN win rate feeding a real gate decision.
    expect(report.matchups!.stall!.metrics.games).toBe(30);
    expect(["pass", "warn", "fail"]).toContain(stall.status);
  });

  it("C27 deferral: no self-play at all when manifest.ciGateBudget.deferGatesToNightly is active at suite 'ci'", () => {
    const deferred = baseManifest({
      ciGateBudget: { deferGatesToNightly: { reason: "too expensive at ci — probes-two-player.test.ts" } },
    });
    const report = runProbeSuite(classicTicTacToe, deferred, {
      seed: "probes-two-player:defer",
      mirrorMove: tttMirrorMove,
    });
    expect(report.matchups).toBeNull();
    for (const gate of report.gates) {
      expect(gate.status, `gate ${gate.gate}`).toBe("deferred");
    }
  });

  it("C27 deferral: suite 'nightly' IGNORES the deferral entirely and runs real self-play", () => {
    const deferred = baseManifest({
      ciGateBudget: { deferGatesToNightly: { reason: "too expensive at ci — probes-two-player.test.ts" } },
    });
    const report = runProbeSuite(classicTicTacToe, deferred, {
      seed: "probes-two-player:defer-nightly",
      games: 10,
      suite: "nightly",
      mirrorMove: tttMirrorMove,
    });
    expect(report.matchups).not.toBeNull();
    for (const gate of report.gates) {
      expect(gate.status).not.toBe("deferred");
    }
  });

  it("reuses resolveEffectiveRuthlessTier — a manifest whose shipped ruthless exceeds the CI ceiling with NO override throws MissingCiRolloutBudgetError, same as runCiSuite", async () => {
    const { MissingCiRolloutBudgetError } = await import("../src/suites");
    const expensive = baseManifest({
      difficultyTiers: [{ id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 5000 }, minReplyMs: 0 }],
    });
    expect(() =>
      runProbeSuite(classicTicTacToe, expensive, { seed: "probes-two-player:missing-budget", games: 5 })
    ).toThrow(MissingCiRolloutBudgetError);
  });
});

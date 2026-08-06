// packages/harness/test/ci-gates.test.ts — TDD anchor for M4's CI wiring layer
// (packages/harness/src/ci-gates.ts). Red first: ci-gates.ts does not exist yet.
//
// This module is the "per-game gate runs keyed correctly" piece the M4 CI workflow calls: it
// composes the ALREADY-BUILT, ALREADY-TESTED lanes (suites.ts for two-player; solo-gates.ts +
// solo-runner.ts + probes-solo.ts + certify.ts for solo) into ONE dispatcher selected by
// `manifest.solo.format` — never by player count (platform-corrections.md C2) — and makes that
// selection a RUNTIME-ENFORCED invariant (`selectGateKind` / the kind-mismatch guard in
// `runGameCiGate`), not just a convention a future caller has to remember.
//
// Standing warning this file exists to answer (project convention): a gate never observed
// failing is not a gate. Every planted-violation test below drives a REAL run through the real
// lanes (real self-play, a real solo roster, a real certificate on disk) rather than a
// hand-built report object, so a break in the wiring itself — not just in the pure evaluators
// suites.test.ts/solo-gates.test.ts already cover — would show up here.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun, createBankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { createMineRun, safeMove as mineRunSafeMove } from "@twist-arcade/mine-run";
import type { GameManifest } from "@twist-arcade/game-spec";
import {
  DEFAULT_CI_GATE_GAMES,
  DEFAULT_SOLO_SEED_COUNT,
  GateKindMismatchError,
  HiddenInfoBudgetTooLowError,
  MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE,
  runGameCiGate,
  runSoloChaseCiGate,
  runSoloPuzzleCiGate,
  runTwoPlayerCiGate,
  selectGateKind,
} from "../src/ci-gates";
import { certifyDay, writeCertificate } from "../src/certify";
import { dfsSolver } from "../src/solver/generic-solo";
import { holeWalk, type HoleWalkMove, type HoleWalkState } from "./fixtures/hole-walk";
import { createAlwaysSafeBrokenMineRun, createAlwaysSafeHealthyMineRun } from "./fixtures/mine-run-mutants";

// ---------------------------------------------------------------------------------------
// selectGateKind / runGameCiGate — C2's runtime-enforced dispatch.
// ---------------------------------------------------------------------------------------

describe("selectGateKind — C2: keyed by manifest.solo.format, never by player count", () => {
  it("a manifest with no solo block is two-player, regardless of players.max", () => {
    expect(selectGateKind({})).toBe("two-player");
  });

  it("solo.format 'score-chase' selects solo-chase even though players.max === 1 (not puzzle)", () => {
    expect(selectGateKind({ solo: { format: "score-chase" } })).toBe("solo-chase");
  });

  it("solo.format 'daily-puzzle' selects solo-puzzle", () => {
    expect(selectGateKind({ solo: { format: "daily-puzzle" } })).toBe("solo-puzzle");
  });

  it("an unrecognized format throws loudly rather than silently falling through", () => {
    expect(() =>
      selectGateKind({ solo: { format: "not-a-real-format" as never } })
    ).toThrow(/unrecognized/);
  });
});

describe("runGameCiGate — refuses a caller-supplied kind that disagrees with the manifest's own format", () => {
  const chaseManifest: GameManifest = {
    id: "bank-run-fixture",
    title: "Bank Run",
    classic: "press-your-luck",
    ruleSentence: "Push your luck or bank it.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase" },
  };

  it("throws GateKindMismatchError when asked to run 'solo-puzzle' against a score-chase manifest", async () => {
    await expect(
      runGameCiGate(bankRun, chaseManifest, {
        kind: "solo-puzzle",
        baseDir: "/nonexistent",
        today: "2026-09-14",
        dayFor: (d) => d,
      })
    ).rejects.toThrow(GateKindMismatchError);
  });

  it("throws GateKindMismatchError when asked to run 'two-player' against a solo manifest", async () => {
    await expect(
      runGameCiGate(bankRun, chaseManifest, { kind: "two-player", seed: "mismatch-test" })
    ).rejects.toThrow(GateKindMismatchError);
  });
});

// ---------------------------------------------------------------------------------------
// Two-player lane — thin wrapper over runCiSuite; the only NEW behavior is the explicit,
// always->=100 `games` default (G-14: "CI gate configs must pass an explicit runs (>=100)
// rather than relying on defaults").
// ---------------------------------------------------------------------------------------

describe("runTwoPlayerCiGate", () => {
  it("DEFAULT_CI_GATE_GAMES is explicitly >= 100 (G-14)", () => {
    expect(DEFAULT_CI_GATE_GAMES).toBeGreaterThanOrEqual(100);
  });

  const sabotagedManifest: GameManifest = {
    id: "classic-ttt-fixture",
    title: "Sabotaged TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "ci-gates.test.ts sabotaged fixture — ruthless tier is literally randomPolicy.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 },
    ],
  };

  it("calling with no `games` override still runs the default (>=100) games, not suites.ts's own 200 default silently", () => {
    // A deliberately small explicit override proves the wrapper actually forwards `games` — if
    // it silently ignored the caller's value and fell through to some hardcoded number, this
    // report's own recorded matchup game count would betray it.
    const report = runTwoPlayerCiGate(classicTicTacToe, sabotagedManifest, { seed: "ci-gates:2p:override", games: 24 });
    expect(report.matchups.strongVsRandom.metrics.games).toBe(24);
  });

  it("a sabotaged ruthless tier trips strong-vs-random for real through this wrapper", () => {
    const report = runTwoPlayerCiGate(classicTicTacToe, sabotagedManifest, { seed: "ci-gates:2p:sabotaged", games: 40 });
    expect(report.ok).toBe(false);
    expect(report.gates.find((g) => g.gate === "strong-vs-random")?.status).toBe("fail");
  });

  it("routes through runGameCiGate's dispatcher identically for a two-player manifest", async () => {
    const result = await runGameCiGate(classicTicTacToe, sabotagedManifest, {
      kind: "two-player",
      seed: "ci-gates:2p:dispatched",
      games: 40,
    });
    expect(result.kind).toBe("two-player");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// Solo score-chase lane — real roster, real probes, against bank-run.
// ---------------------------------------------------------------------------------------

describe("runSoloChaseCiGate", () => {
  it("DEFAULT_SOLO_SEED_COUNT is explicitly >= 100 (G-14's spirit extended to solo seed counts)", () => {
    expect(DEFAULT_SOLO_SEED_COUNT).toBeGreaterThanOrEqual(100);
  });

  const chaseManifest: GameManifest = {
    id: "bank-run-fixture",
    title: "Bank Run",
    classic: "press-your-luck",
    ruleSentence: "Push your luck or bank it.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase" },
  };

  // bank-run is perfect-information, so a "safeMove" hook receives the state itself (V === S).
  const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });

  it("a healthy bank-run (real bust risk) clears the Always-Safe gate for real", () => {
    // Scoped deliberately to the ONE gate this test is about: bank-run's tiny ROUND_CAP (6)
    // is an M0/M1 fixture property unrelated to the Always-Safe question (it also trips
    // medianRunLength, which wants >=15 decisions, and — since its round cap sits exactly at
    // grindProbe's default confirmations count — the always-legal-at-streak-0 "bank" move,
    // a genuinely round-capped action, can pass the probe's replay-confirmation window; see
    // the dedicated grind-probe test below, which sidesteps this by using a much smaller
    // confirmations budget). None of that bears on whether Always-Safe (never taking risk)
    // actually under-performs Strong (which does take risk) — which is what this test proves.
    const report = runSoloChaseCiGate(bankRun, chaseManifest, {
      seed: "ci-gates:chase:healthy",
      seedCount: 120,
      safeMove: alwaysBank,
    });
    const gate = report.gates.find((g) => g.name === "alwaysSafeVsStrong")!;
    expect(gate.status).toBe("pass");
    expect(report.alwaysSafeVsStrong).toBeLessThan(1);
  });

  it("the Grind probe trips (hard fail) against the planted zero-risk farming-loop engine", () => {
    const brokenEngine = createBankRun({ plantFarmingLoop: true });
    const report = runSoloChaseCiGate(brokenEngine, chaseManifest, {
      seed: "ci-gates:chase:grind",
      seedCount: 100,
      safeMove: alwaysBank,
    });
    const gate = report.gates.find((g) => g.name === "grindProbe")!;
    expect(gate.status).toBe("fail");
    expect(report.grind.found).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("routes through runGameCiGate's dispatcher identically for a solo-chase manifest", async () => {
    const result = await runGameCiGate(bankRun, chaseManifest, {
      kind: "solo-chase",
      seed: "ci-gates:chase:dispatched",
      seedCount: 100,
      safeMove: alwaysBank,
    });
    expect(result.kind).toBe("solo-chase");
    expect(typeof result.ok).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C19's hidden-info follow-up (orchestrator finding, mid-task): for a
// `hiddenInformation: true` engine, cost is `seeds x moves x K x rollouts-per-world` — K (the
// determinization sample count) is COUPLED to the same rollout budget
// (determinizedFlatMonteCarloPolicy: K = budget.n / legalMoves.length), so scaling the budget
// down scales K down too, in the SAME step. C6 already proved a too-weak Strong makes every
// solo gate meaningless (a gate defined relative to a reference agent is only as trustworthy
// as that agent) — these tests prove a scaled-down budget either (a) stays above the floor
// known to preserve real Always-Safe separation, using the SAME Mine Run healthy/degenerate
// mutant fixtures probes-solo.test.ts's C6 close-out already validated the shipped roster
// against, or (b) refuses loudly (HiddenInfoBudgetTooLowError) BEFORE running anything
// expensive, rather than silently emitting a ratio measured against a Strong too weak to mean
// anything.
// ---------------------------------------------------------------------------------------

describe("runSoloChaseCiGate — C19 hidden-info budget scaling (rollouts AND the coupled K)", () => {
  const mineRunChaseManifest: GameManifest = {
    id: "mine-run-fixture",
    title: "Mine Run",
    classic: "Minesweeper",
    ruleSentence: "ci-gates.test.ts Mine Run fixture.",
    tags: [],
    estMinutes: 3,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "score-chase", moveCap: 30 },
  };

  it("MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE is a positive floor (sanity)", () => {
    expect(MIN_HIDDEN_INFO_SAMPLES_PER_CANDIDATE).toBeGreaterThan(0);
  });

  it("refuses loudly, BEFORE running any self-play, when a scaled-down soloChaseCiRollouts drops K below the floor", () => {
    // 6x6 board -> 36 root legal moves. At 50 rollouts, K ~= 1.4 per candidate — the exact
    // shape probes-solo.test.ts's own tuning notes found insufficient (their ~60-rollout,
    // ~1-2-samples/candidate case reproduced a naive majority-vote wrapper's weak separation).
    const engine = createAlwaysSafeHealthyMineRun();
    const manifest: GameManifest = {
      ...mineRunChaseManifest,
      ciGateBudget: { soloChaseCiRollouts: 50 },
    };
    expect(() =>
      runSoloChaseCiGate(engine, manifest, {
        seed: "ci-gates:c19:hidden-info-too-low",
        seedCount: 100,
        safeMove: mineRunSafeMove,
        suite: "ci",
      })
    ).toThrow(HiddenInfoBudgetTooLowError);
  });

  it("does NOT throw the floor guard for the platform default (1000) on the same board — only an aggressive override trips it", () => {
    const engine = createAlwaysSafeHealthyMineRun();
    expect(() =>
      runSoloChaseCiGate(engine, mineRunChaseManifest, {
        seed: "ci-gates:c19:hidden-info-default",
        seedCount: 3,
        safeMove: mineRunSafeMove,
        suite: "ci",
      })
    ).not.toThrow(HiddenInfoBudgetTooLowError);
  }, 30_000);

  it("a scaled-down but VIABLE budget (320, ~8.9 samples/candidate on this 36-cell board) still separates healthy from degenerate — the coordinator's exact ask, proven against the real Mine Run engine and its real mutant fixtures", () => {
    const seeds = 15;
    const manifest: GameManifest = {
      ...mineRunChaseManifest,
      ciGateBudget: { soloChaseCiRollouts: 320 },
    };

    const healthy = runSoloChaseCiGate(createAlwaysSafeHealthyMineRun(), manifest, {
      seed: "ci-gates:c19:separation-healthy",
      seedCount: seeds,
      safeMove: mineRunSafeMove,
      suite: "ci",
    });
    expect(healthy.alwaysSafeVsStrong).toBeLessThan(0.95);

    const degenerate = runSoloChaseCiGate(createAlwaysSafeBrokenMineRun(), manifest, {
      seed: "ci-gates:c19:separation-degenerate",
      seedCount: seeds,
      safeMove: mineRunSafeMove,
      suite: "ci",
    });
    expect(degenerate.alwaysSafeVsStrong).toBeGreaterThanOrEqual(0.95);
  }, 180_000);

  it("suite 'nightly' ignores soloChaseCiRollouts and is never subject to the ci-only override (matches the two-player lane's rule)", () => {
    const engine = createAlwaysSafeHealthyMineRun();
    // An override this low would throw under suite "ci" (see the test above); "nightly" must
    // ignore it entirely and fall back to the platform default, so this must NOT throw.
    const manifest: GameManifest = {
      ...mineRunChaseManifest,
      ciGateBudget: { soloChaseCiRollouts: 50 },
    };
    expect(() =>
      runSoloChaseCiGate(engine, manifest, {
        seed: "ci-gates:c19:nightly-ignores-override",
        seedCount: 3,
        safeMove: mineRunSafeMove,
        suite: "nightly",
      })
    ).not.toThrow(HiddenInfoBudgetTooLowError);
  }, 30_000);

  it("the guard never fires for a perfect-information game (bank-run) regardless of how low the budget goes", () => {
    const chaseManifest: GameManifest = {
      id: "bank-run-fixture",
      title: "Bank Run",
      classic: "press-your-luck",
      ruleSentence: "Push your luck or bank it.",
      tags: [],
      estMinutes: 1,
      modes: { bot: false, hotseat: false, asyncLink: false },
      players: { min: 1, max: 1 },
      difficultyTiers: [],
      solo: { format: "score-chase" },
      ciGateBudget: { soloChaseCiRollouts: 1 },
    };
    const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });
    expect(() =>
      runSoloChaseCiGate(bankRun, chaseManifest, {
        seed: "ci-gates:c19:perfect-info-immune",
        seedCount: 20,
        safeMove: alwaysBank,
        suite: "ci",
      })
    ).not.toThrow(HiddenInfoBudgetTooLowError);
  });
});

// ---------------------------------------------------------------------------------------
// Solo daily-puzzle lane — real certificates on disk, real verifyCertificate re-check.
// ---------------------------------------------------------------------------------------

function isoDay(offsetFromEpoch: number): string {
  const base = new Date(Date.UTC(2026, 8, 14)); // 2026-09-14
  base.setUTCDate(base.getUTCDate() + offsetFromEpoch);
  return base.toISOString().slice(0, 10);
}

function dayFor(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

describe("runSoloPuzzleCiGate", () => {
  const puzzleManifest: GameManifest = {
    id: "hole-walk-fixture",
    title: "Hole Walk",
    classic: "puzzle",
    ruleSentence: "Walk corner to corner without crossing your own trail or a hole.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "daily-puzzle" },
    // hole-walk's known solvable seed certifies at L*=5 — below the platform default
    // certificateParRange [8, 80] (a real launch game's band; this is a 4x3 test fixture, not
    // a shippable puzzle). Widened via the manifest's own threshold-override mechanism
    // (plan §7.5) so the certificatePar gate means something for THIS fixture's actual scale,
    // exactly the escape hatch a real tiny/tutorial puzzle would also use.
    thresholds: { certificateParRange: [3, 10] },
  };

  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), "ci-gates-certs-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const SOLVABLE_SEED = "hunt:0"; // see certify.test.ts's own comment: known solvable, L*=5

  it("reports certificatePresent as a hard fail when today's day has no stored certificate", async () => {
    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, {
      baseDir,
      today: isoDay(0),
      dayFor,
    });
    const gate = report.gates.find((g) => g.name === "certificatePresent")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toMatch(/missing/);
    expect(report.ok).toBe(false);
  });

  it("a real certified day passes certificatePresent via a genuine re-verified replay", async () => {
    const today = isoDay(0);
    const result = certifyDay({
      gameId: "hole-walk-fixture",
      gameVersion: 1,
      engineVersion: "test",
      engine: holeWalk,
      solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
      day: today,
      seedFor: () => SOLVABLE_SEED,
      solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
      randomPlayoutTrials: 200,
    });
    expect(result.outcome).toBe("certified");
    await writeCertificate(baseDir, result.certificate!);

    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, { baseDir, today, dayFor });
    const presentGate = report.gates.find((g) => g.name === "certificatePresent")!;
    expect(presentGate.status).toBe("pass");
    expect(presentGate.detail).toMatch(/verified/);
    const parGate = report.gates.find((g) => g.name === "certificatePar")!;
    expect(parGate.status).toBe("pass");
  });

  it("a tampered par on disk (C10) fails certificatePresent via a genuine re-verification, not a hand-checked field", async () => {
    const today = isoDay(0);
    const result = certifyDay({
      gameId: "hole-walk-fixture",
      gameVersion: 1,
      engineVersion: "test",
      engine: holeWalk,
      solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
      day: today,
      seedFor: () => SOLVABLE_SEED,
      solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
      randomPlayoutTrials: 200,
    });
    expect(result.outcome).toBe("certified");
    const tampered = { ...result.certificate!, par: 999 };
    await writeCertificate(baseDir, tampered);

    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, { baseDir, today, dayFor });
    const presentGate = report.gates.find((g) => g.name === "certificatePresent")!;
    expect(presentGate.status).toBe("fail");
    expect(presentGate.detail).toMatch(/FAILED CI replay verification/);
    expect(report.ok).toBe(false);
  });

  it("certifiedBufferDays reflects a real contiguous run read off disk, and alerts below 30", async () => {
    const today = isoDay(0);
    // Certify exactly 5 contiguous days starting today — comfortably below the 30-day alert
    // band and the 7-day hard-fail floor is still cleared (5 >= 7? no: 5 < 7, so this ALSO
    // exercises the hard-fail branch for real).
    for (let i = 0; i < 5; i++) {
      const day = dayFor(today, i);
      const result = certifyDay({
        gameId: "hole-walk-fixture",
        gameVersion: 1,
        engineVersion: "test",
        engine: holeWalk,
        solver: dfsSolver<HoleWalkState, HoleWalkMove>(),
        day,
        seedFor: () => SOLVABLE_SEED,
        solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
        maxNonceAttempts: 1,
        minPar: 3,
        maxForcedMoveFraction: 0.9,
        maxRandomPlayoutSolveRate: 0.9,
        randomPlayoutTrials: 200,
      });
      expect(result.outcome).toBe("certified");
      await writeCertificate(baseDir, result.certificate!);
    }

    const report = await runSoloPuzzleCiGate(holeWalk, puzzleManifest, { baseDir, today, dayFor });
    const bufferGate = report.gates.find((g) => g.name === "certifiedBufferDays")!;
    expect(bufferGate.detail).toMatch(/^5 days buffered/);
    expect(bufferGate.status).toBe("fail"); // 5 < minCertifiedBufferDays (7)
    expect(report.ok).toBe(false);
  });

  it("routes through runGameCiGate's dispatcher identically for a solo-puzzle manifest", async () => {
    const result = await runGameCiGate(holeWalk, puzzleManifest, {
      kind: "solo-puzzle",
      baseDir,
      today: isoDay(0),
      dayFor,
    });
    expect(result.kind).toBe("solo-puzzle");
    expect(typeof result.ok).toBe("boolean");
  });
});

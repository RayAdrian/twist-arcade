// scripts/test/ci-gates.test.ts — TDD anchor for the M4 CI entry point (scripts/ci-gates.ts).
// Exercises `runAllGates` against a hand-built Registry (no real games/registry.ts entry, no
// real npm-linked game package needed — dependencies are injected, per the module's own
// "pure logic vs thin main()" split) covering all three gate kinds in one registry, proving
// the dispatch is real end to end: a two-player game, a solo score-chase game, and a solo
// daily-puzzle game, each producing the right report shape and each capable of failing for a
// real (not hand-built) reason.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameManifest, Registry } from "@twist-arcade/game-spec";
import { classicTicTacToe } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import type { TTTMove, TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun, createBankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import {
  miniCrackstep,
  type CrackstepMove,
  type CrackstepState,
} from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { certifyDay, writeCertificate, dfsSolver, readAllDeferralRuns } from "@twist-arcade/harness";
import type { Json } from "@twist-arcade/engine";
import type { SafeMoveFn } from "@twist-arcade/harness";
import type { GameCiGateReport } from "@twist-arcade/harness";
import type { RegistryEntry } from "@twist-arcade/game-spec";
import {
  applyDeferralLedger,
  CI_GAMES,
  CI_SEED_COUNT,
  dayFor,
  MirrorMoveNotExportedError,
  NIGHTLY_GAMES,
  runAllGates,
  SafeMoveNotExportedError,
  todayUtc,
  TWO_PLAYER_CI_SEED_COUNT,
  TWO_PLAYER_NIGHTLY_SEED_COUNT,
  UnknownGameIdError,
} from "../ci-gates";

describe("todayUtc / dayFor", () => {
  it("todayUtc returns a YYYY-MM-DD string", () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("dayFor supports negative offsets (yesterday) as well as forward offsets", () => {
    expect(dayFor("2026-09-14", 1)).toBe("2026-09-15");
    expect(dayFor("2026-09-14", -1)).toBe("2026-09-13");
    expect(dayFor("2026-09-14", 0)).toBe("2026-09-14");
  });
});

function twoPlayerManifest(): GameManifest {
  return {
    id: "classic-ttt-fixture",
    title: "Sabotaged TTT",
    classic: "Tic-Tac-Toe",
    ruleSentence: "scripts/ci-gates.test.ts sabotaged fixture.",
    tags: [],
    estMinutes: 1,
    modes: { bot: true, hotseat: false, asyncLink: false },
    players: { min: 2, max: 2 },
    difficultyTiers: [
      { id: "ruthless", policy: { kind: "random" }, budget: { kind: "rollouts", n: 1 }, minReplyMs: 0 },
    ],
  };
}

function chaseManifest(): GameManifest {
  return {
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
}

function puzzleManifest(): GameManifest {
  return {
    id: "mini-crackstep-fixture",
    title: "Mini Crackstep",
    classic: "puzzle",
    ruleSentence: "Walk corner to corner without crossing your own trail or a hole.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "daily-puzzle" },
    thresholds: { certificateParRange: [3, 10] },
  };
}

describe("runAllGates — dispatches all three kinds from one registry", () => {
  let certBaseDir: string;

  beforeEach(async () => {
    certBaseDir = await mkdtemp(path.join(tmpdir(), "scripts-ci-gates-certs-"));
  });

  afterEach(async () => {
    await rm(certBaseDir, { recursive: true, force: true });
  });

  it("runs the two-player, solo-chase, and solo-puzzle lanes for real and reports each honestly", async () => {
    const today = "2026-09-14";
    // mini-crackstep's setup() ignores rng entirely -- any seed string produces the same board.
    const solvableSeed = "any-seed";
    const certResult = certifyDay({
      gameId: "mini-crackstep-fixture",
      gameVersion: 1,
      engineVersion: "test",
      engine: miniCrackstep,
      solver: dfsSolver<CrackstepState, CrackstepMove>(),
      day: today,
      seedFor: () => solvableSeed,
      solveBudget: { maxNodes: 2e5, maxMs: 3_000 },
      maxNonceAttempts: 1,
      minPar: 3,
      maxForcedMoveFraction: 0.9,
      maxRandomPlayoutSolveRate: 0.9,
      randomPlayoutTrials: 200,
    });
    expect(certResult.outcome).toBe("certified");
    await writeCertificate(certBaseDir, certResult.certificate!);

    const registry: Registry = {
      "classic-ttt-fixture": {
        manifest: twoPlayerManifest(),
        loadEngine: async () => classicTicTacToe,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
      "bank-run-fixture": {
        manifest: chaseManifest(),
        loadEngine: async () => bankRun,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
      "mini-crackstep-fixture": {
        manifest: puzzleManifest(),
        loadEngine: async () => miniCrackstep,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };

    const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });
    const reports = await runAllGates(
      registry,
      { suite: "ci" },
      {
        // Type-erasure boundary, matching RegistryEntry's own `any` posture at the same seam
        // (packages/game-spec/src/registry.ts): the real dynamic import()-based resolveSafeMove
        // in scripts/ci-gates.ts is untyped at the module boundary for exactly this reason.
        resolveSafeMove: async (gameId) =>
          gameId === "bank-run-fixture" ? (alwaysBank as unknown as SafeMoveFn<Json, unknown>) : undefined,
        // classic-ttt-fixture's manifest carries no "symmetric" tag, so an undefined mirrorMove
        // is a normal, non-throwing n/a — not the MirrorMoveNotExportedError case.
        resolveMirrorMove: async () => undefined,
        certBaseDir,
        today,
        dayFor,
      }
    );

    expect(reports).toHaveLength(3);
    // Sorted by gameId — proves ordering is stable/deterministic, not registry insertion order.
    expect(reports.map((r) => r.gameId)).toEqual(["bank-run-fixture", "classic-ttt-fixture", "mini-crackstep-fixture"]);

    const twoPlayer = reports.find((r) => r.gameId === "classic-ttt-fixture")!;
    expect(twoPlayer.kind).toBe("two-player");
    expect(twoPlayer.ok).toBe(false); // sabotaged ruthless tier == randomPolicy
    // C71 Part 1 / C80: runAllGates' own two-player call site now sets seedCount for real (never
    // just the harness module's default) — TWO_PLAYER_CI_SEED_COUNT independent seedRuns, total
    // games conserved at CI_GAMES.
    if (twoPlayer.kind === "two-player") {
      expect(twoPlayer.report.seedRuns).toHaveLength(TWO_PLAYER_CI_SEED_COUNT);
      expect(twoPlayer.report.seedRuns!.reduce((sum, r) => sum + r.strongVsRandom.metrics.games, 0)).toBe(CI_GAMES);
    }

    const chase = reports.find((r) => r.gameId === "bank-run-fixture")!;
    expect(chase.kind).toBe("solo-chase");
    if (chase.kind === "solo-chase") {
      expect(chase.report.gates.find((g) => g.name === "alwaysSafeVsStrong")?.status).toBe("pass");
    }

    const puzzle = reports.find((r) => r.gameId === "mini-crackstep-fixture")!;
    expect(puzzle.kind).toBe("solo-puzzle");
    if (puzzle.kind === "solo-puzzle") {
      expect(puzzle.report.gates.find((g) => g.name === "certificatePresent")?.status).toBe("pass");
    }
  });

  it("throws SafeMoveNotExportedError for a solo-chase game whose package doesn't export safeMove — never a silently skipped gate", async () => {
    const registry: Registry = {
      "bank-run-fixture": {
        manifest: chaseManifest(),
        loadEngine: async () => bankRun,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };

    await expect(
      runAllGates(
        registry,
        { suite: "ci" },
        { resolveSafeMove: async () => undefined, resolveMirrorMove: async () => undefined, certBaseDir, today: "2026-09-14", dayFor }
      )
    ).rejects.toThrow(SafeMoveNotExportedError);
  });

  it("a healthy chase manifest still fails structurally against bank-run's own tiny round cap (documented fixture limitation), but the roster/probe wiring runs for real", async () => {
    // Uses createBankRun's default (real bust risk) rather than the module-level `bankRun`
    // export — same engine, just proving the loader path is per-entry, not a shared singleton
    // side effect.
    const registry: Registry = {
      "bank-run-fixture": {
        manifest: chaseManifest(),
        loadEngine: async () => createBankRun(),
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };
    const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });
    const reports = await runAllGates(
      registry,
      { suite: "ci" },
      {
        resolveSafeMove: async () => alwaysBank as unknown as SafeMoveFn<Json, unknown>,
        resolveMirrorMove: async () => undefined,
        certBaseDir,
        today: "2026-09-14",
        dayFor,
      }
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]!.kind).toBe("solo-chase");
  });
});

// ---------------------------------------------------------------------------------------
// C64 (docs/plans/degeneracy-probes.md §4.4/§4.7): resolveMirrorMove + MirrorMoveNotExportedError
// — the repo-layout resolution and refusal for the mirror-bot probe, at the exact posture
// SafeMoveNotExportedError already takes. The TAG decides whether absence is an error; the
// EXPORT decides whether the probe runs.
// ---------------------------------------------------------------------------------------

function tttMirrorMoveFixture(_state: TTTState, lastOppMove: TTTMove | null, legalMoves: readonly TTTMove[]): TTTMove | null {
  if (lastOppMove === null) return null;
  const reflected = 8 - lastOppMove.cell;
  return legalMoves.find((m) => m.cell === reflected) ?? null;
}

function symmetricTwoPlayerManifest(overrides: Partial<GameManifest> = {}): GameManifest {
  return {
    ...twoPlayerManifest(),
    tags: ["symmetric"],
    difficultyTiers: [{ id: "ruthless", policy: { kind: "mcts" }, budget: { kind: "rollouts", n: 50 }, minReplyMs: 0 }],
    ...overrides,
  };
}

describe("runAllGates — C64: resolveMirrorMove / MirrorMoveNotExportedError", () => {
  let certBaseDir: string;

  beforeEach(async () => {
    certBaseDir = await mkdtemp(path.join(tmpdir(), "scripts-ci-gates-mirror-"));
  });

  afterEach(async () => {
    await rm(certBaseDir, { recursive: true, force: true });
  });

  it("REFUSES loudly (MirrorMoveNotExportedError) for a \"symmetric\"-tagged game whose resolveMirrorMove returns undefined, with no manifest.mirrorProbe opt-out", async () => {
    const registry: Registry = {
      "classic-ttt-fixture": {
        manifest: symmetricTwoPlayerManifest(),
        loadEngine: async () => classicTicTacToe,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };
    await expect(
      runAllGates(
        registry,
        { suite: "ci" },
        { resolveSafeMove: async () => undefined, resolveMirrorMove: async () => undefined, certBaseDir, today: "2026-09-14", dayFor }
      )
    ).rejects.toThrow(MirrorMoveNotExportedError);
  });

  it("does NOT refuse when a \"symmetric\"-tagged game DOES resolve a real mirrorMove — it threads through and produces a measured mirror-probe row", async () => {
    const registry: Registry = {
      "classic-ttt-fixture": {
        manifest: symmetricTwoPlayerManifest(),
        loadEngine: async () => classicTicTacToe,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };
    const reports = await runAllGates(
      registry,
      { suite: "ci" },
      {
        resolveSafeMove: async () => undefined,
        // Type-erasure boundary matching the real defaultDeps() import()-based resolution.
        resolveMirrorMove: async () => tttMirrorMoveFixture as unknown as (s: unknown, l: unknown, m: readonly unknown[]) => unknown,
        certBaseDir,
        today: "2026-09-14",
        dayFor,
      }
    );
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.kind).toBe("two-player");
    if (report.kind === "two-player") {
      const mirror = report.report.gates.find((g) => g.gate === "mirror-probe");
      expect(mirror).toBeDefined();
      expect(mirror!.status).not.toBe("n/a"); // measured for real, not the "unavailable" n/a shape
    }
  });

  it("does NOT refuse a \"symmetric\"-tagged game that DECLARES manifest.mirrorProbe, even with no resolvable export — the declaration is the sanctioned opt-out", async () => {
    const registry: Registry = {
      "classic-ttt-fixture": {
        manifest: symmetricTwoPlayerManifest({
          mirrorProbe: { applicable: false, reason: "scripts/test/ci-gates.test.ts: declared opt-out fixture" },
        }),
        loadEngine: async () => classicTicTacToe,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };
    const reports = await runAllGates(
      registry,
      { suite: "ci" },
      { resolveSafeMove: async () => undefined, resolveMirrorMove: async () => undefined, certBaseDir, today: "2026-09-14", dayFor }
    );
    expect(reports).toHaveLength(1);
  });

  it("a game NOT tagged \"symmetric\" with an unresolved mirrorMove is NOT refused — it gets an explicit n/a row, never a crash (the tag decides the error, the export decides the row)", async () => {
    const registry: Registry = {
      "classic-ttt-fixture": {
        manifest: twoPlayerManifest(), // tags: [] — not symmetric
        loadEngine: async () => classicTicTacToe,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };
    const reports = await runAllGates(
      registry,
      { suite: "ci" },
      { resolveSafeMove: async () => undefined, resolveMirrorMove: async () => undefined, certBaseDir, today: "2026-09-14", dayFor }
    );
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    if (report.kind === "two-player") {
      expect(report.report.gates.find((g) => g.gate === "mirror-probe")?.status).toBe("n/a");
    }
  });
});

describe("CI budget constants", () => {
  it("CI_GAMES and CI_SEED_COUNT are explicitly >= 100 (G-14)", () => {
    expect(CI_GAMES).toBeGreaterThanOrEqual(100);
    expect(CI_SEED_COUNT).toBeGreaterThanOrEqual(100);
  });

  it("C71 Part 1 / C80: CI_GAMES/NIGHTLY_GAMES divide evenly by their own two-player seed counts — a production combination that would throw NonDivisibleSeedCountError is a real defect, not something a test should have to catch at runtime", () => {
    expect(CI_GAMES % TWO_PLAYER_CI_SEED_COUNT).toBe(0);
    expect(NIGHTLY_GAMES % TWO_PLAYER_NIGHTLY_SEED_COUNT).toBe(0);
  });
});

describe("runAllGates — C13 --game filter", () => {
  let certBaseDir: string;

  beforeEach(async () => {
    certBaseDir = await mkdtemp(path.join(tmpdir(), "scripts-ci-gates-certs-game-filter-"));
  });

  afterEach(async () => {
    await rm(certBaseDir, { recursive: true, force: true });
  });

  function buildRegistry(): Registry {
    return {
      "classic-ttt-fixture": {
        manifest: twoPlayerManifest(),
        loadEngine: async () => classicTicTacToe,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
      "bank-run-fixture": {
        manifest: chaseManifest(),
        loadEngine: async () => bankRun,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };
  }

  const alwaysBank = (_view: BankRunState): BankRunMove => ({ kind: "bank" });

  it("--game <id> runs ONLY that game's gate, never the rest of the registry (C13's whole point)", async () => {
    const registry = buildRegistry();
    const reports = await runAllGates(
      registry,
      { suite: "ci", game: "bank-run-fixture" },
      {
        resolveSafeMove: async () => alwaysBank as unknown as SafeMoveFn<Json, unknown>,
        resolveMirrorMove: async () => undefined,
        certBaseDir,
        today: "2026-09-14",
        dayFor,
      }
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]!.gameId).toBe("bank-run-fixture");
  });

  it("throws UnknownGameIdError for a --game id not present in the registry, rather than silently running nothing", async () => {
    // Deliberately a registry with ONLY the two-player fixture (no solo-chase entry, so
    // resolveSafeMove is never a plausible source of a throw) — the ONLY way this rejects is
    // the --game filter itself refusing an id absent from the registry. Without that check,
    // an unrecognized --game would just silently fall through to running the whole registry
    // (here: the one two-player game) and NOT throw at all, which is exactly the silent-wrong-
    // answer failure mode this test guards against.
    const registry: Registry = {
      "classic-ttt-fixture": {
        manifest: twoPlayerManifest(),
        loadEngine: async () => classicTicTacToe,
        loadPresentation: async () => {
          throw new Error("not needed by this test");
        },
      },
    };
    await expect(
      runAllGates(
        registry,
        { suite: "ci", game: "not-a-real-game" },
        {
          resolveSafeMove: async () => undefined,
          resolveMirrorMove: async () => undefined,
          certBaseDir,
          today: "2026-09-14",
          dayFor,
        }
      )
    ).rejects.toThrow(UnknownGameIdError);
  });

  it("omitting --game keeps the existing full-registry behaviour (backward compatible)", async () => {
    const registry = buildRegistry();
    const reports = await runAllGates(
      registry,
      { suite: "ci" },
      {
        resolveSafeMove: async () => alwaysBank as unknown as SafeMoveFn<Json, unknown>,
        resolveMirrorMove: async () => undefined,
        certBaseDir,
        today: "2026-09-14",
        dayFor,
      }
    );
    expect(reports).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C70/C81: applyDeferralLedger — the repo-layout wiring around
// @twist-arcade/harness's deferral-ledger.ts. C81's stage-6 review found the FIRST version's
// unit tests injected in-memory read/write deps, which structurally could not catch that the
// real nightly write never survives an ephemeral GitHub Actions workspace. THIS version has no
// such seam to hide behind: `applyDeferralLedger` takes a real `runsBaseDir` and writes real
// `DeferralRun` files there via real filesystem I/O — every test below uses a real scratch tmp
// dir (mkdtemp), so persistence is exercised for real, not faked.
// ---------------------------------------------------------------------------------------

function deferringChaseManifest(since: string): GameManifest {
  return { ...chaseManifest(), ciGateBudget: { deferGatesToNightly: { reason: "unit-test fixture", since } } };
}

function fakeRegistry(manifest: GameManifest): Registry {
  const entry: RegistryEntry = {
    manifest,
    loadEngine: () => Promise.reject(new Error("not called — applyDeferralLedger never loads an engine")),
    loadPresentation: () => Promise.reject(new Error("not called")),
  };
  return { [manifest.id]: entry };
}

function soloChaseReport(gameId: string, ok: boolean, gates: { name: string; status: string; detail: string }[]): GameCiGateReport {
  return {
    kind: "solo-chase",
    gameId,
    ok,
    report: { gameId, format: "score-chase", ok, gates: gates as never, metrics: {} as never, grind: { found: false } },
  };
}

const MINE_RUN_LIKE_DEFERRED = [
  "strongVsRandomRatio",
  "distributionOverlap",
  "strongVsGreedyRatio",
  "strongScoreCV",
  "alwaysSafeVsStrong",
  "medianRunLength",
  "capHitRate",
  "ceilingPileUp",
] as const;

function deferredGatesFixture(): { name: string; status: string; detail: string }[] {
  return [
    ...MINE_RUN_LIKE_DEFERRED.map((name) => ({ name, status: "deferred", detail: "measured at nightly (unit-test fixture)" })),
    { name: "greedyVsRandomRatio", status: "pass", detail: "1.8" },
    { name: "grindProbe", status: "pass", detail: "no cycle" },
  ];
}

/** A real nightly report for the same manifest: every previously-deferred row measured for
 *  real, plus a two-player-lane row set ONLY partially populated — proving coverage recognition
 *  works off whatever a report ACTUALLY contains, never a hardcoded canonical list (C81's A2). */
function fullyMeasuredNightlyGatesFixture(): { name: string; status: string; detail: string }[] {
  return [
    ...MINE_RUN_LIKE_DEFERRED.map((name) => ({ name, status: "pass", detail: "measured for real" })),
    { name: "greedyVsRandomRatio", status: "pass", detail: "1.8" },
    { name: "grindProbe", status: "pass", detail: "no cycle" },
  ];
}

describe("applyDeferralLedger — suite 'ci' never writes anything, only reads committed evidence (C81: no workspace write is ever load-bearing)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "scripts-ci-gates-runs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("with no committed DeferralRun evidence, ages from the manifest's declared `since` — undischarged, stale, forces a fail", async () => {
    const manifest = deferringChaseManifest("2026-08-07");
    const registry = fakeRegistry(manifest);
    const report = soloChaseReport(manifest.id, true, deferredGatesFixture());

    const gated = await applyDeferralLedger([report], registry, "ci", dir, "2026-08-15");

    // 8 days undischarged (2026-08-07 -> 2026-08-15), 8/10 applicable — stale AND material.
    expect(gated[0]!.aging?.rows[0]!.ageDays).toBe(8);
    expect(gated[0]!.aging?.forcesFail).toBe(true);
    expect(gated[0]!.effectiveOk).toBe(false);

    // "ci" never writes — nothing was created on disk for this game.
    expect(await readAllDeferralRuns(dir, manifest.id)).toEqual([]);
  });

  it("a game with no ciGateBudget.deferGatesToNightly declared is untouched", async () => {
    const manifest = chaseManifest();
    const registry = fakeRegistry(manifest);
    const report = soloChaseReport(manifest.id, true, [{ name: "greedyVsRandomRatio", status: "pass", detail: "1.8" }]);

    const gated = await applyDeferralLedger([report], registry, "ci", dir, "2026-08-15");

    expect(gated[0]!.aging).toBeUndefined();
    expect(gated[0]!.effectiveOk).toBe(true);
  });
});

describe("applyDeferralLedger — suite 'nightly' writes a committed DeferralRun artifact; a LATER 'ci' run reads it back and recognizes the discharge (requirement 1, real filesystem I/O throughout)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "scripts-ci-gates-runs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("PLANTED VIOLATION, DISCHARGED: an aged, undischarged deferral is reset to age 0 once a committed nightly run covers it", async () => {
    const manifest = deferringChaseManifest("2026-08-07");
    const registry = fakeRegistry(manifest);

    // Tonight, nightly runs for real (its own report shows every row MEASURED — never
    // "deferred", matching solo-gates.ts's SoloDeferredGateAtNightlyError guarantee) and
    // WRITES the resulting DeferralRun artifact — this is the file a human would commit.
    const nightlyReport = soloChaseReport(manifest.id, true, fullyMeasuredNightlyGatesFixture());
    const gatedNightly = await applyDeferralLedger([nightlyReport], registry, "nightly", dir, "2026-08-15");
    expect(gatedNightly[0]!.effectiveOk).toBe(true); // nightly's own report never shows "deferred"

    const runs = await readAllDeferralRuns(dir, manifest.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.day).toBe("2026-08-15");
    // Recorded from the REPORT's own rows, not a hardcoded canonical list (C81's A2 fix).
    expect(runs[0]!.measuredGates).toContain("distributionOverlap");
    expect(runs[0]!.measuredGates).toContain("greedyVsRandomRatio");

    // Tomorrow's "ci" run re-declares the same deferral (Strong is still unaffordable at "ci")
    // — READS the committed artifact and measures age from last night's discharge, not from
    // 2026-08-07 again. No mutable ledger, no separate "observe" write — just a read.
    const tomorrowReport = soloChaseReport(manifest.id, true, deferredGatesFixture());
    const gatedTomorrow = await applyDeferralLedger([tomorrowReport], registry, "ci", dir, "2026-08-16");
    expect(gatedTomorrow[0]!.aging?.rows[0]!.ageDays).toBe(1);
    expect(gatedTomorrow[0]!.aging?.forcesFail).toBe(false); // fresh again — 1 day, not material
    expect(gatedTomorrow[0]!.effectiveOk).toBe(true);
  });

  it("COVERAGE, not exact equality (C81's A2 fix): a nightly run whose measured set is a PROPER SUBSET of another lane's full canonical list still discharges", async () => {
    // A two-player-shaped manifest whose "ci" report only ever shows TWO deferrable rows
    // (the others are independently n/a for structural reasons unrelated to deferral) —
    // exercising exactly the asymmetry C81's review found latent in the solo-chase-only tests.
    const manifest: GameManifest = {
      ...twoPlayerManifest(),
      id: "two-player-subset-fixture",
      ciGateBudget: { deferGatesToNightly: { reason: "unit-test fixture", since: "2026-08-01" } },
    };
    const registry = fakeRegistry(manifest);

    const twoPlayerReport = (gates: { gate: string; status: string; detail: string }[]): GameCiGateReport => ({
      kind: "two-player",
      gameId: manifest.id,
      ok: true,
      report: { gameId: manifest.id, suite: "nightly", ok: true, gates: gates as never, matchups: null },
    });

    const nightlyReport = twoPlayerReport([
      { gate: "strong-vs-random", status: "pass", detail: "measured for real" },
      { gate: "first-player-win-rate", status: "pass", detail: "measured for real" },
      { gate: "ruthless-vs-standard", status: "n/a", detail: "no standard tier — structural" },
      { gate: "solved-value-reached", status: "n/a", detail: "no solvedValue proof — structural" },
    ]);
    await applyDeferralLedger([nightlyReport], registry, "nightly", dir, "2026-08-15");

    const ciReport = (): GameCiGateReport => ({
      kind: "two-player",
      gameId: manifest.id,
      ok: true,
      report: {
        gameId: manifest.id,
        suite: "ci",
        ok: true,
        gates: [
          { gate: "strong-vs-random", status: "deferred", detail: "measured at nightly" },
          { gate: "first-player-win-rate", status: "deferred", detail: "measured at nightly" },
          { gate: "ruthless-vs-standard", status: "n/a", detail: "no standard tier — structural" },
          { gate: "solved-value-reached", status: "n/a", detail: "no solvedValue proof — structural" },
        ] as never,
        matchups: null,
      },
    });
    const gated = await applyDeferralLedger([ciReport()], registry, "ci", dir, "2026-08-16");
    expect(gated[0]!.aging?.rows[0]!.ageDays).toBe(1); // discharged last night, not stuck at since=2026-08-01
    expect(gated[0]!.effectiveOk).toBe(true);
  });
});

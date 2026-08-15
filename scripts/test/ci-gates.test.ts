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
import { bankRun, createBankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import {
  miniCrackstep,
  type CrackstepMove,
  type CrackstepState,
} from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { certifyDay, writeCertificate, dfsSolver } from "@twist-arcade/harness";
import type { Json } from "@twist-arcade/engine";
import type { SafeMoveFn } from "@twist-arcade/harness";
import type { DeferralLedger, GameCiGateReport } from "@twist-arcade/harness";
import type { RegistryEntry } from "@twist-arcade/game-spec";
import {
  applyDeferralLedger,
  CI_GAMES,
  CI_SEED_COUNT,
  dayFor,
  runAllGates,
  SafeMoveNotExportedError,
  todayUtc,
  UnknownGameIdError,
  type DeferralLedgerIoDeps,
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
        { resolveSafeMove: async () => undefined, certBaseDir, today: "2026-09-14", dayFor }
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
        certBaseDir,
        today: "2026-09-14",
        dayFor,
      }
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]!.kind).toBe("solo-chase");
  });
});

describe("CI budget constants", () => {
  it("CI_GAMES and CI_SEED_COUNT are explicitly >= 100 (G-14)", () => {
    expect(CI_GAMES).toBeGreaterThanOrEqual(100);
    expect(CI_SEED_COUNT).toBeGreaterThanOrEqual(100);
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
        certBaseDir,
        today: "2026-09-14",
        dayFor,
      }
    );
    expect(reports).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------
// platform-corrections.md C70: applyDeferralLedger — the repo-layout wiring around
// @twist-arcade/harness's deferral-ledger.ts. All ledger persistence is injected (an in-memory
// Map standing in for the real `data/deferral-ledger.json`), so these never touch real disk
// except the one explicit round-trip test at the end, which uses a scratch tmp dir.
// ---------------------------------------------------------------------------------------

function inMemoryLedgerDeps(today: string, seed: DeferralLedger = {}): DeferralLedgerIoDeps & { writes: number } {
  const store = { current: JSON.parse(JSON.stringify(seed)) as DeferralLedger };
  const deps = {
    ledgerPath: "unused://in-memory",
    today,
    writes: 0,
    async readLedger() {
      return store.current;
    },
    async writeLedger(_path: string, ledger: DeferralLedger) {
      store.current = ledger;
      deps.writes += 1;
    },
  };
  return deps;
}

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

describe("applyDeferralLedger — suite 'ci' observes an active deferral (requirement 1: records what would discharge it)", () => {
  it("writes a ledger entry anchored at the manifest's declared `since`, not at `today`", async () => {
    const manifest = deferringChaseManifest("2026-08-07");
    const registry = fakeRegistry(manifest);
    const report = soloChaseReport(manifest.id, true, deferredGatesFixture());
    const deps = inMemoryLedgerDeps("2026-08-15");

    const gated = await applyDeferralLedger([report], registry, "ci", deps);

    expect(deps.writes).toBe(1);
    const stored = (await deps.readLedger(deps.ledgerPath)) as Record<string, { firstObservedAt: string }>;
    expect(stored[manifest.id]!.firstObservedAt).toBe("2026-08-07");
    // 8 days undischarged (2026-08-07 -> 2026-08-15), 8/10 applicable — stale AND material.
    expect(gated[0]!.aging?.forcesFail).toBe(true);
    expect(gated[0]!.effectiveOk).toBe(false);
  });

  it("a game with no ciGateBudget.deferGatesToNightly declared is untouched — no ledger write at all", async () => {
    const manifest = chaseManifest();
    const registry = fakeRegistry(manifest);
    const report = soloChaseReport(manifest.id, true, [{ name: "greedyVsRandomRatio", status: "pass", detail: "1.8" }]);
    const deps = inMemoryLedgerDeps("2026-08-15");

    const gated = await applyDeferralLedger([report], registry, "ci", deps);

    expect(deps.writes).toBe(0);
    expect(gated[0]!.aging).toBeUndefined();
    expect(gated[0]!.effectiveOk).toBe(true);
  });
});

describe("applyDeferralLedger — suite 'nightly' recognizes itself as the discharging run (requirement 1, the other half)", () => {
  it("PLANTED VIOLATION, DISCHARGED: an aged, undischarged deferral is reset to age 0 by a nightly run for the SAME manifest", async () => {
    const manifest = deferringChaseManifest("2026-08-07");
    const registry = fakeRegistry(manifest);

    // Simulate 8 days of "ci" runs having already observed this deferral.
    const ciDeps = inMemoryLedgerDeps("2026-08-15");
    const agedReport = soloChaseReport(manifest.id, true, deferredGatesFixture());
    await applyDeferralLedger([agedReport], registry, "ci", ciDeps);
    const seeded = await ciDeps.readLedger(ciDeps.ledgerPath);

    // Tonight, nightly runs for real (its own report shows every row MEASURED — never
    // "deferred", matching solo-gates.ts's SoloDeferredGateAtNightlyError guarantee) and
    // discharges it.
    const nightlyDeps = inMemoryLedgerDeps("2026-08-15", seeded);
    const nightlyReport = soloChaseReport(manifest.id, true, [
      { name: "strongVsRandomRatio", status: "pass", detail: "measured for real" },
      { name: "alwaysSafeVsStrong", status: "pass", detail: "measured for real" },
    ]);
    const gatedNightly = await applyDeferralLedger([nightlyReport], registry, "nightly", nightlyDeps);
    expect(gatedNightly[0]!.effectiveOk).toBe(true); // nightly's own report never shows "deferred"

    const discharged = await nightlyDeps.readLedger(nightlyDeps.ledgerPath);
    expect(discharged[manifest.id]!.lastDischargedAt).toBe("2026-08-15");
    // Discharged against the CANONICAL STRONG_DEPENDENT_CHASE_GATES list, not whatever subset
    // happened to be in this particular nightly report's own rows.
    expect(discharged[manifest.id]!.gates).toContain("distributionOverlap");

    // Tomorrow's "ci" run re-declares the same deferral (Strong is still unaffordable at "ci")
    // — its age must measure from last night's discharge, not from 2026-08-07 again.
    const tomorrowDeps = inMemoryLedgerDeps("2026-08-16", discharged);
    const tomorrowReport = soloChaseReport(manifest.id, true, deferredGatesFixture());
    const gatedTomorrow = await applyDeferralLedger([tomorrowReport], registry, "ci", tomorrowDeps);
    expect(gatedTomorrow[0]!.aging?.rows[0]!.ageDays).toBe(1);
    expect(gatedTomorrow[0]!.aging?.forcesFail).toBe(false); // fresh again — 1 day, not material
    expect(gatedTomorrow[0]!.effectiveOk).toBe(true);
  });
});

describe("applyDeferralLedger — round-trips through the real filesystem (not just in-memory deps)", () => {
  it("writes and reads back data/deferral-ledger.json's real shape via a scratch tmp dir", async () => {
    const { readDeferralLedger, writeDeferralLedger, defaultLedgerPath } = await import("@twist-arcade/harness");
    const dir = await mkdtemp(path.join(tmpdir(), "scripts-ci-gates-ledger-"));
    const ledgerPath = defaultLedgerPath(dir);

    const manifest = deferringChaseManifest("2026-08-07");
    const registry = fakeRegistry(manifest);
    const report = soloChaseReport(manifest.id, true, deferredGatesFixture());

    const gated = await applyDeferralLedger([report], registry, "ci", {
      ledgerPath,
      today: "2026-08-15",
      readLedger: readDeferralLedger,
      writeLedger: writeDeferralLedger,
    });
    expect(gated[0]!.effectiveOk).toBe(false);

    const onDisk = await readDeferralLedger(ledgerPath);
    expect(onDisk[manifest.id]!.firstObservedAt).toBe("2026-08-07");

    await rm(dir, { recursive: true, force: true });
  });
});

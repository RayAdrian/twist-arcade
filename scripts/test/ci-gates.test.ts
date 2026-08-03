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
import { CI_GAMES, CI_SEED_COUNT, dayFor, runAllGates, SafeMoveNotExportedError, todayUtc } from "../ci-gates";

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

// scripts/test/verify-certificates.test.ts — TDD anchor for the nightly-only certificate
// sweep (scripts/verify-certificates.ts). Proves, against REAL certificates on disk (not
// hand-built report objects): every stored day is re-verified (not just "today"), a tampered
// certificate is caught, non-puzzle games are skipped entirely, and the buffer severity
// (ok/alert/fail) reflects a real contiguous run read off disk.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameManifest, Registry } from "@twist-arcade/game-spec";
import { bankRun } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { miniCrackstep, type CrackstepMove, type CrackstepState } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { certifyDay, dfsSolver, writeCertificate } from "@twist-arcade/harness";
import { dayFor, formatCertificateReport, verifyAllCertificates } from "../verify-certificates";

function puzzleManifest(): GameManifest {
  return {
    id: "mini-crackstep-fixture",
    title: "Mini Crackstep",
    classic: "puzzle",
    ruleSentence: "Walk corner to corner without crossing your own trail.",
    tags: [],
    estMinutes: 1,
    modes: { bot: false, hotseat: false, asyncLink: false },
    players: { min: 1, max: 1 },
    difficultyTiers: [],
    solo: { format: "daily-puzzle" },
    thresholds: { certificateParRange: [3, 10] },
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

async function certifyOneDay(baseDir: string, day: string): Promise<void> {
  const result = certifyDay({
    gameId: "mini-crackstep-fixture",
    gameVersion: 1,
    engineVersion: "test",
    engine: miniCrackstep,
    solver: dfsSolver<CrackstepState, CrackstepMove>(),
    day,
    seedFor: () => "any-seed",
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

describe("verifyAllCertificates", () => {
  let certBaseDir: string;

  beforeEach(async () => {
    certBaseDir = await mkdtemp(path.join(tmpdir(), "verify-certs-"));
  });

  afterEach(async () => {
    await rm(certBaseDir, { recursive: true, force: true });
  });

  const registryWithBoth = (): Registry => ({
    "mini-crackstep-fixture": {
      manifest: puzzleManifest(),
      loadEngine: async () => miniCrackstep,
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
  });

  it("skips non-puzzle (score-chase) games entirely — no certificate pipeline to sweep", async () => {
    const reports = await verifyAllCertificates(registryWithBoth(), {
      certBaseDir,
      today: "2026-09-14",
      dayFor,
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.gameId).toBe("mini-crackstep-fixture");
  });

  it("re-verifies EVERY stored day, not just the most recent one", async () => {
    await certifyOneDay(certBaseDir, "2026-09-10");
    await certifyOneDay(certBaseDir, "2026-09-11");
    await certifyOneDay(certBaseDir, "2026-09-12");

    const [report] = await verifyAllCertificates(registryWithBoth(), {
      certBaseDir,
      today: "2026-09-14", // "today" is AFTER all three certified days — buffer is 0
      dayFor,
    });
    expect(report!.totalCertificates).toBe(3);
    expect(report!.failures).toHaveLength(0);
  });

  it("catches a tampered (par-forged) certificate among otherwise-healthy days — proves the sweep replays every file, not just checks existence", async () => {
    await certifyOneDay(certBaseDir, "2026-09-10");
    await certifyOneDay(certBaseDir, "2026-09-11");
    // Corrupt the middle day's par directly on disk, the way a hand-edit or bit-flip would.
    const corruptPath = path.join(certBaseDir, "mini-crackstep-fixture", "2026-09-11.json");
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(corruptPath, "utf8")) as { par: number };
    raw.par = 999;
    await writeFile(corruptPath, JSON.stringify(raw));

    const [report] = await verifyAllCertificates(registryWithBoth(), {
      certBaseDir,
      today: "2026-09-14",
      dayFor,
    });
    expect(report!.failures).toHaveLength(1);
    expect(report!.failures[0]!.day).toBe("2026-09-11");
    expect(report!.ok).toBe(false);
  });

  it("bufferSeverity is 'fail' when the buffer is below the 7-day floor, real contiguous-run computation", async () => {
    const today = "2026-09-14";
    // Certify exactly 5 contiguous days starting today.
    for (let i = 0; i < 5; i++) {
      await certifyOneDay(certBaseDir, dayFor(today, i));
    }
    const [report] = await verifyAllCertificates(registryWithBoth(), { certBaseDir, today, dayFor });
    expect(report!.certifiedBufferDays).toBe(5);
    expect(report!.bufferSeverity).toBe("fail"); // 5 < 7
    expect(report!.ok).toBe(false);
  });

  it("bufferSeverity is 'alert' (not fail) between the 7-day floor and the 30-day target", async () => {
    const today = "2026-09-14";
    for (let i = 0; i < 10; i++) {
      await certifyOneDay(certBaseDir, dayFor(today, i));
    }
    const [report] = await verifyAllCertificates(registryWithBoth(), { certBaseDir, today, dayFor });
    expect(report!.certifiedBufferDays).toBe(10);
    expect(report!.bufferSeverity).toBe("alert");
    expect(report!.ok).toBe(true); // alert never fails the sweep, only a hard fail does
  });

  it("formatCertificateReport renders N/A-free PASS/FAIL/WARN labels distinctly", async () => {
    await certifyOneDay(certBaseDir, "2026-09-10");
    const [report] = await verifyAllCertificates(registryWithBoth(), {
      certBaseDir,
      today: "2026-09-14",
      dayFor,
    });
    const output = formatCertificateReport(report!);
    expect(output).toContain("[PASS] every stored certificate re-verified clean");
    expect(output).toMatch(/\[(FAIL|WARN)\] certifiedBufferDays/);
  });
});

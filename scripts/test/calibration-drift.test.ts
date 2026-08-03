// scripts/test/calibration-drift.test.ts — TDD anchor for the nightly-only calibration drift
// check (scripts/calibration-drift.ts). Uses mini-crackstep + dfsSolver (both real, both
// deterministic — the fixture's board never varies with seed) so calibrate() always produces
// an exact, reproducible mean/stddev, making drift assertions precise rather than statistical.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Registry } from "@twist-arcade/game-spec";
import { miniCrackstep, type CrackstepMove, type CrackstepState } from "@twist-arcade/engine/testkit/fixtures/mini-crackstep";
import { dfsSolver } from "@twist-arcade/harness";
import {
  calibrationSeeds,
  formatCalibrationDriftReport,
  readSnapshot,
  runCalibrationDrift,
  writeSnapshot,
} from "../calibration-drift";

function registryWithSolver(): Registry {
  return {
    "mini-crackstep-fixture": {
      manifest: {
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
      },
      loadEngine: async () => miniCrackstep,
      loadPresentation: async () => {
        throw new Error("not needed by this test");
      },
      loadSolver: async () => dfsSolver<CrackstepState, CrackstepMove>(),
    },
  };
}

describe("calibrationSeeds", () => {
  it("produces n distinct, gameId-prefixed seeds", () => {
    const seeds = calibrationSeeds("mini-crackstep-fixture", 5);
    expect(seeds).toHaveLength(5);
    expect(new Set(seeds).size).toBe(5);
    expect(seeds[0]).toBe("calibration:mini-crackstep-fixture:0");
  });
});

describe("runCalibrationDrift", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), "calibration-drift-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("skips a game with no loadSolver — nothing for calibrate() to compute over", async () => {
    const registry: Registry = {
      "no-solver-fixture": {
        manifest: {
          id: "no-solver-fixture",
          title: "x",
          classic: "x",
          ruleSentence: "x",
          tags: [],
          estMinutes: 1,
          modes: { bot: false, hotseat: false, asyncLink: false },
          players: { min: 1, max: 1 },
          difficultyTiers: [],
        },
        loadEngine: async () => miniCrackstep,
        loadPresentation: async () => {
          throw new Error("not needed");
        },
      },
    };
    const reports = await runCalibrationDrift(registry, { baseDir, seedCount: 5 });
    expect(reports).toHaveLength(0);
  });

  it("the first-ever run has no prior snapshot: reports driftSigma undefined, ok=true, and WRITES a snapshot for next time", async () => {
    const reports = await runCalibrationDrift(registryWithSolver(), { baseDir, seedCount: 10 });
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.driftSigma).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(report.newMean).toBe(4); // mini-crackstep's known solution length

    const snapshot = await readSnapshot(baseDir, "mini-crackstep-fixture");
    expect(snapshot).toBeDefined();
    expect(snapshot!.length.mean).toBe(4);
  });

  it("a second run against the SAME deterministic engine matches the snapshot exactly (driftSigma 0)", async () => {
    await runCalibrationDrift(registryWithSolver(), { baseDir, seedCount: 10 });
    const reports = await runCalibrationDrift(registryWithSolver(), { baseDir, seedCount: 10 });
    const report = reports[0]!;
    expect(report.driftSigma).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("a planted stale snapshot (simulating a prior generator/solver version) is caught as real drift", async () => {
    // Plant a snapshot claiming a PRIOR calibration centered far from mini-crackstep's actual
    // L*=4 — the shape of drift a real generator/solver regression would produce.
    await writeSnapshot(baseDir, "mini-crackstep-fixture", { length: { mean: 40, stddev: 2, n: 1000 } });

    const reports = await runCalibrationDrift(registryWithSolver(), { baseDir, seedCount: 10 });
    const report = reports[0]!;
    expect(report.driftSigma).toBeDefined();
    expect(Math.abs(report.driftSigma!)).toBeGreaterThan(1.5);
    expect(report.ok).toBe(false);
  });

  it("formatCalibrationDriftReport renders the N/A drift label distinctly on a first-ever run", async () => {
    const reports = await runCalibrationDrift(registryWithSolver(), { baseDir, seedCount: 10 });
    const output = formatCalibrationDriftReport(reports[0]!);
    expect(output).toContain("[N/A ] driftSigma");
  });
});

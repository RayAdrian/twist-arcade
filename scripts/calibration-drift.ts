#!/usr/bin/env node
// scripts/calibration-drift.ts — `pnpm harness:calibration-drift` — nightly-only per-game
// difficulty calibration + drift check (plan §7.7: "harness calibrate produces the 10k-seed
// feature distribution the band/z-scores are computed against (once per game + nightly drift
// check)").
//
// Storage convention (new, this milestone): a committed snapshot at
// data/calibration/<gameId>.json holding the last run's `length` FeatureStats (mean/stddev/n).
// Nightly, this script recomputes calibration fresh and compares the new mean against the
// STORED snapshot via calibrate.ts's own `zScore` helper — a generator/solver regression that
// silently shifts the whole difficulty distribution shows up as drift here, rather than only
// being caught one certified day at a time by runSoloPuzzleCiGate's much narrower
// day-over-day check (ci-gates.ts).
//
// Only games with a `loadSolver()` (RegistryEntry, game-spec §5.4) are calibrated — a game with
// no solver has no L*/features for calibrate() to compute over. First-ever run for a game has
// no prior snapshot to compare against: this establishes the baseline (reported as N/A drift,
// never a fabricated pass or fail), matching certify.ts's own "no prior day" posture.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Registry } from "@twist-arcade/game-spec";
import { calibrate, zScore, type FeatureStats } from "@twist-arcade/harness";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CALIBRATION_BASE_DIR = path.join(REPO_ROOT, "data/calibration");
const DEFAULT_SEED_COUNT = 10_000; // plan §7.7's own number
// roadmap §6's day-over-day certificate-drift hard-fail figure, reused here as the closest
// documented "how much drift is too much" number — this script's own drift question (has the
// GENERATOR/solver's whole distribution shifted) is the same shape of question at a coarser
// grain, so borrowing the same sigma budget is deliberate, not an approximation of convenience.
const MAX_DRIFT_SIGMA = 1.5;

export function calibrationSeeds(gameId: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `calibration:${gameId}:${i}`);
}

export interface CalibrationSnapshot {
  readonly length: FeatureStats;
}

export async function readSnapshot(baseDir: string, gameId: string): Promise<CalibrationSnapshot | undefined> {
  try {
    const raw = await readFile(path.join(baseDir, `${gameId}.json`), "utf8");
    return JSON.parse(raw) as CalibrationSnapshot;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Same atomic tmp-then-rename convention as certify.ts's `writeCertificate` — a concurrent
 *  reader or a crash mid-write can never observe a half-written snapshot. */
export async function writeSnapshot(baseDir: string, gameId: string, snapshot: CalibrationSnapshot): Promise<void> {
  const file = path.join(baseDir, `${gameId}.json`);
  await mkdir(baseDir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export interface GameCalibrationDriftReport {
  readonly gameId: string;
  readonly sampleCount: number;
  readonly usableCount: number;
  readonly newMean: number;
  /** Absent on the game's first-ever calibration run — nothing to compare against yet. */
  readonly driftSigma?: number;
  readonly ok: boolean;
}

export interface CalibrationDriftOptions {
  readonly baseDir: string;
  readonly seedCount?: number;
  readonly maxDriftSigma?: number;
}

/**
 * Runs `calibrate()` fresh for every registered game that exports a solver, compares the new
 * `length` mean against a committed prior snapshot (if any), and OVERWRITES the snapshot with
 * this run's result regardless of outcome — so tomorrow's drift check always compares against
 * the most recent calibration, not a stale baseline from whenever drift last fired.
 */
export async function runCalibrationDrift(
  registry: Registry,
  opts: CalibrationDriftOptions
): Promise<GameCalibrationDriftReport[]> {
  const seedCount = opts.seedCount ?? DEFAULT_SEED_COUNT;
  const maxDriftSigma = opts.maxDriftSigma ?? MAX_DRIFT_SIGMA;

  const reports: GameCalibrationDriftReport[] = [];
  const gameIds = Object.keys(registry).sort();

  for (const gameId of gameIds) {
    const entry = registry[gameId]!;
    if (!entry.loadSolver) continue;

    const engine = await entry.loadEngine();
    const solver = await entry.loadSolver();
    const seeds = calibrationSeeds(gameId, seedCount);
    const result = calibrate({ engine, solver, seeds });

    const priorSnapshot = await readSnapshot(opts.baseDir, gameId);
    const driftSigma = priorSnapshot ? zScore(result.length.mean, priorSnapshot.length) : undefined;
    const ok = driftSigma === undefined || Math.abs(driftSigma) <= maxDriftSigma;

    await writeSnapshot(opts.baseDir, gameId, { length: result.length });

    reports.push({
      gameId,
      sampleCount: result.sampleCount,
      usableCount: result.usableCount,
      newMean: result.length.mean,
      ...(driftSigma !== undefined ? { driftSigma } : {}),
      ok,
    });
  }

  return reports;
}

export function formatCalibrationDriftReport(report: GameCalibrationDriftReport): string {
  const driftLine =
    report.driftSigma === undefined
      ? "  [N/A ] driftSigma: no prior calibration snapshot — this run establishes the baseline"
      : `  [${report.ok ? "PASS" : "FAIL"}] driftSigma: ${report.driftSigma.toFixed(3)}σ (fail if |Δ| > ${MAX_DRIFT_SIGMA}σ)`;
  return [
    `calibration for "${report.gameId}" — ${report.ok ? "OK" : "FAILED"} ` +
      `(${report.usableCount}/${report.sampleCount} usable, mean L*=${report.newMean.toFixed(2)})`,
    driftLine,
  ].join("\n");
}

async function loadRegistry(): Promise<Registry> {
  const registryUrl = pathToFileURL(path.join(REPO_ROOT, "games/registry.ts")).href;
  const mod = (await import(registryUrl)) as { registry: Registry };
  return mod.registry;
}

async function main(): Promise<void> {
  const registry = await loadRegistry();
  const withSolver = Object.values(registry).filter((e) => e.loadSolver);
  if (withSolver.length === 0) {
    console.log("calibration-drift: no registered game exports a solver yet — nothing to calibrate.");
    return;
  }

  const reports = await runCalibrationDrift(registry, { baseDir: CALIBRATION_BASE_DIR });
  for (const report of reports) {
    console.log(formatCalibrationDriftReport(report));
    console.log("");
  }

  const failing = reports.filter((r) => !r.ok);
  if (failing.length > 0) {
    console.error(`calibration-drift: ${failing.length}/${reports.length} game(s) drifted beyond ${MAX_DRIFT_SIGMA}σ.`);
    process.exitCode = 1;
    return;
  }
  console.log(`calibration-drift: all ${reports.length} calibrated game(s) within band.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error.message);
    process.exitCode = 1;
  });
}

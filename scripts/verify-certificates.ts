#!/usr/bin/env node
// scripts/verify-certificates.ts — `pnpm harness:verify-certificates` — the nightly-only
// certificate sweep (plan §7.7): "nightly CI re-verifies EVERY stored certificate through
// verifyCertificate (purity makes this cheap), alerts below 30 days of buffer, hard-fails
// below 7."
//
// This is deliberately separate from `scripts/ci-gates.ts`'s solo-puzzle lane
// (`runSoloPuzzleCiGate`, wired into BOTH the PR and nightly `--suite` runs): that lane checks
// only the ONE day under review (today) plus the buffer computed from what's on disk. This
// script re-verifies the FULL committed set — every `data/certificates/<gameId>/<day>.json`
// file, all the way back — because a certificate that verified fine when it was generated can
// still be corrupted, hand-edited, or silently invalidated by an engine version bump; nothing
// else in this pipeline re-checks a day once it has scrolled out of "today".
//
// Same "pure logic vs thin main()" split as ci-gates.ts and cli.ts: `verifyAllCertificates` is
// a plain async function over an injected Registry + certificate base dir, so tests never need
// a committed data/certificates/ tree.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyCertificate } from "@twist-arcade/engine/testkit/checks";
import type { GameEngine } from "@twist-arcade/engine";
import type { DailyCertificate, GameManifest, Registry } from "@twist-arcade/game-spec";
import { DEFAULT_SOLO_THRESHOLDS } from "@twist-arcade/game-spec";
import { bufferDaysRemaining, readAllCertificates } from "@twist-arcade/harness";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CERT_BASE_DIR = path.join(REPO_ROOT, "data/certificates");
const BUFFER_ALERT_DAYS = 30;
const BUFFER_HORIZON_DAYS = 90;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dayFor(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10)!;
}

export interface CertificateFailure {
  readonly day: string;
  readonly reason: string;
}

export interface GameCertificateReport {
  readonly gameId: string;
  readonly totalCertificates: number;
  readonly failures: readonly CertificateFailure[];
  readonly certifiedBufferDays: number;
  readonly bufferSeverity: "ok" | "alert" | "fail";
  /** True iff every certificate re-verified clean AND the buffer clears the hard-fail floor —
   *  the nightly job's own pass/fail signal for this game. */
  readonly ok: boolean;
}

function certOk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: GameEngine<any, any, any>,
  cert: DailyCertificate
): CertificateFailure | undefined {
  try {
    verifyCertificate(engine, {
      gameId: cert.gameId,
      gameVersion: cert.gameVersion,
      engineVersion: cert.engineVersion,
      seed: cert.seed,
      moveLog: cert.moveLog,
      par: cert.par,
      parKind: cert.parKind,
      ...(cert.guessFree !== undefined ? { guessFree: cert.guessFree } : {}),
    });
    return undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { day: cert.day, reason: message };
  }
}

export interface VerifyAllCertificatesOptions {
  readonly certBaseDir: string;
  readonly today: string;
  readonly dayFor: (isoDay: string, offset: number) => string;
  readonly minCertifiedBufferDays?: number; // default SoloThresholds.minCertifiedBufferDays (7)
  readonly bufferAlertDays?: number; // default 30
}

/**
 * Re-verifies EVERY committed certificate for every registered `daily-puzzle` game (non-puzzle
 * games are skipped entirely — they have no certificate pipeline) and reports the buffer's
 * severity. Never throws for a bad certificate — a failure is recorded in the report so a
 * caller sees every game's full picture in one run, matching `certifyDay`'s own "record every
 * rejection, never abort the loop early" posture.
 */
export async function verifyAllCertificates(
  registry: Registry,
  opts: VerifyAllCertificatesOptions
): Promise<GameCertificateReport[]> {
  const minBuffer = opts.minCertifiedBufferDays ?? DEFAULT_SOLO_THRESHOLDS.minCertifiedBufferDays;
  const alertBuffer = opts.bufferAlertDays ?? BUFFER_ALERT_DAYS;

  const reports: GameCertificateReport[] = [];
  const gameIds = Object.keys(registry).sort();

  for (const gameId of gameIds) {
    const entry = registry[gameId]!;
    const manifest: GameManifest = entry.manifest;
    if (manifest.solo?.format !== "daily-puzzle") continue; // no certificate pipeline to sweep

    const engine = await entry.loadEngine();
    const certs = await readAllCertificates(opts.certBaseDir, gameId);

    const failures: CertificateFailure[] = [];
    for (const cert of certs) {
      const failure = certOk(engine, cert);
      if (failure) failures.push(failure);
    }

    const certifiedDays = new Set(certs.map((c) => c.day));
    const certifiedBufferDays = bufferDaysRemaining(certifiedDays, opts.today, opts.dayFor, BUFFER_HORIZON_DAYS);
    const bufferSeverity: GameCertificateReport["bufferSeverity"] =
      certifiedBufferDays < minBuffer ? "fail" : certifiedBufferDays < alertBuffer ? "alert" : "ok";

    reports.push({
      gameId,
      totalCertificates: certs.length,
      failures,
      certifiedBufferDays,
      bufferSeverity,
      ok: failures.length === 0 && bufferSeverity !== "fail",
    });
  }

  return reports;
}

export function formatCertificateReport(report: GameCertificateReport): string {
  const lines = [
    `certificate sweep for "${report.gameId}" — ${report.ok ? "OK" : "FAILED"} ` +
      `(${report.totalCertificates} certificate(s) on disk)`,
  ];
  if (report.failures.length === 0) {
    lines.push("  [PASS] every stored certificate re-verified clean");
  } else {
    for (const f of report.failures) {
      lines.push(`  [FAIL] ${f.day}: ${f.reason}`);
    }
  }
  const bufferLabel = report.bufferSeverity === "fail" ? "FAIL" : report.bufferSeverity === "alert" ? "WARN" : "PASS";
  lines.push(`  [${bufferLabel}] certifiedBufferDays: ${report.certifiedBufferDays} (alert < 30, fail if < 7)`);
  return lines.join("\n");
}

async function loadRegistry(): Promise<Registry> {
  const registryUrl = pathToFileURL(path.join(REPO_ROOT, "games/registry.ts")).href;
  const mod = (await import(registryUrl)) as { registry: Registry };
  return mod.registry;
}

async function main(): Promise<void> {
  const registry = await loadRegistry();
  const puzzleGameIds = Object.values(registry).filter((e) => e.manifest.solo?.format === "daily-puzzle");
  if (puzzleGameIds.length === 0) {
    console.log("verify-certificates: no registered daily-puzzle games yet — nothing to sweep.");
    return;
  }

  const reports = await verifyAllCertificates(registry, { certBaseDir: CERT_BASE_DIR, today: todayUtc(), dayFor });
  for (const report of reports) {
    console.log(formatCertificateReport(report));
    console.log("");
  }

  const failing = reports.filter((r) => !r.ok);
  if (failing.length > 0) {
    console.error(`verify-certificates: ${failing.length}/${reports.length} game(s) failed the certificate sweep.`);
    process.exitCode = 1;
    return;
  }
  console.log(`verify-certificates: all ${reports.length} puzzle game(s) clean.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error.message);
    process.exitCode = 1;
  });
}

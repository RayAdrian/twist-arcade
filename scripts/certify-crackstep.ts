#!/usr/bin/env node
// scripts/certify-crackstep.ts — `pnpm certify:crackstep -- --days 90 [--start 2026-09-01]
// [--force]` (also reachable as `pnpm --filter @twist-arcade/crackstep run certify`). Fills the
// committed 90-day certificate buffer (data/certificates/crackstep/<day>.json, plan §3.3/§3.4)
// by calling games/crackstep/solver/certify-day.ts's `certifyOneDay` once per day and writing
// every CERTIFIED result to disk via the platform's own atomic `writeCertificate`
// (@twist-arcade/harness).
//
// Lives HERE, not under games/crackstep/, for the same reason every other day-arithmetic CLI in
// this repo (scripts/ci-gates.ts, scripts/verify-certificates.ts, scripts/calibration-drift.ts)
// does: `todayUtc()`/`dayFor()` read the real wall clock via `Date`, and eslint's purity
// boundary (eslint.config.mjs's `purityRules`) BANS `Date` anywhere under `games/**` — a
// blanket rule protecting engine/game determinism that (correctly) does not carve out an
// exception for "this particular file is build-time tooling, not gameplay code." An earlier
// draft of this script lived at games/crackstep/solver/run-certify.mts and failed lint for
// exactly this reason; games/crackstep/solver/certify-day.ts (the actual engine/solver/seed
// composition, which draws no wall-clock time at all) is unaffected and stays where it is.
//
// The one rule every line below protects: a day that `certifyOneDay` could not certify (budget
// exhaustion, triviality, an unreachable band — see certify-day.test.ts's planted violations)
// is left OFF DISK, never written under a placeholder or a best-effort value. A gap in the
// buffer is a visible, honest gap (bufferDaysRemaining stops counting at the first missing day)
// — never a silently-shipped bad daily. This script's own exit code reflects that: any day that
// failed to certify makes the run non-zero, even though every OTHER day it certified is still
// written and usable.
//
// Idempotent by default: a day already on disk is left untouched and skipped (re-running this
// script to extend the buffer forward never re-spends solver budget on days already certified).
// `--force` recertifies every day in range regardless — useful after an engineVersion bump, but
// never the default (nightly re-verification, not this script, is what re-checks stored days).
//
// Same "pure logic vs thin main()" split as this directory's other scripts: everything above
// the CLI-arg-parsing section is exported and unit-tested (scripts/test/certify-crackstep.test.ts);
// `main()` itself is untested process wiring (argv, the real clock, filesystem writes, exit
// codes).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAllCertificates, writeCertificate } from "@twist-arcade/harness";
import { certifyOneDay } from "../games/crackstep/solver/certify-day";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CERT_BASE_DIR = path.join(REPO_ROOT, "data/certificates");
const DEFAULT_DAYS = 90;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dayFor(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10)!;
}

export interface CliOptions {
  days: number;
  start: string;
  force: boolean;
}

export function parseCliOptions(argv: readonly string[], defaultStart: string): CliOptions {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[name] = true; // boolean flag (e.g. --force)
    } else {
      flags[name] = next;
      i += 1;
    }
  }
  const days = flags.days !== undefined ? Number(flags.days) : DEFAULT_DAYS;
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`certify-crackstep: --days must be a positive integer, got ${JSON.stringify(flags.days)}`);
  }
  const start = typeof flags.start === "string" ? flags.start : defaultStart;
  const force = flags.force === true;
  return { days, start, force };
}

export interface DayOutcome {
  day: string;
  status: "certified" | "skipped-existing" | "rejected";
  detail: string;
}

/**
 * Runs the certify loop over `[start, start+days)`, writing every certified day to
 * `certBaseDir` and returning a full per-day report — including days that FAILED to certify,
 * so a caller sees the whole picture (matching `certifyDay`'s own "record every rejection,
 * never abort the loop early" posture, one level up at the per-day granularity).
 *
 * The one rule every branch below protects: a day `certifyFn` could not certify (budget
 * exhaustion, triviality, an unreachable band) is left OFF DISK, never written under a
 * placeholder or best-effort value — a gap in the buffer is honest; a bad shipped daily is not
 * (crackstep.md §3.4). `certifyFn` defaults to the real `certifyOneDay` (real generator, real
 * solver) but is injectable — same DI posture as scripts/ci-gates.ts's `RunAllGatesDeps` — so a
 * test can substitute a fake that deterministically rejects a chosen day, proving this
 * function's "never write a rejected day to disk" behavior without depending on a real board
 * happening to be unsolvable or budget-starved.
 */
export async function runCertifyRange(opts: {
  certBaseDir: string;
  start: string;
  days: number;
  force: boolean;
  dayFor: (day: string, offset: number) => string;
  certifyFn?: typeof certifyOneDay;
}): Promise<DayOutcome[]> {
  const certifyFn = opts.certifyFn ?? certifyOneDay;
  const alreadyCertified = new Set((await readAllCertificates(opts.certBaseDir, "crackstep")).map((c) => c.day));

  const outcomes: DayOutcome[] = [];
  for (let i = 0; i < opts.days; i++) {
    const day = opts.dayFor(opts.start, i);

    if (!opts.force && alreadyCertified.has(day)) {
      outcomes.push({ day, status: "skipped-existing", detail: "already certified on disk" });
      continue;
    }

    const result = await certifyFn(day);
    if (result.outcome === "certified") {
      await writeCertificate(opts.certBaseDir, result.certificate!);
      outcomes.push({
        day,
        status: "certified",
        detail: `par=${result.certificate!.par} nonce=${result.certificate!.nonce} rejectedFirst=${result.rejections.length}`,
      });
    } else {
      // NEVER written to disk — a gap here is honest, not a silent bad ship (see module doc).
      const reasons = result.rejections.map((r) => r.reason).join("; ") || "(no attempts recorded)";
      outcomes.push({ day, status: "rejected", detail: `all ${result.rejections.length} attempts rejected: ${reasons}` });
    }
  }
  return outcomes;
}

export function formatOutcome(o: DayOutcome): string {
  const label = o.status === "certified" ? "OK" : o.status === "skipped-existing" ? "SKIP" : "FAIL";
  return `[${label}] ${o.day} — ${o.detail}`;
}

async function main(): Promise<void> {
  const opts = parseCliOptions(process.argv.slice(2), todayUtc());
  console.log(
    `certify-crackstep: ${opts.days} day(s) from ${opts.start}${opts.force ? " (--force: recertifying existing days too)" : ""}`
  );

  const outcomes = await runCertifyRange({ certBaseDir: CERT_BASE_DIR, ...opts, dayFor });
  for (const o of outcomes) console.log(formatOutcome(o));

  const certified = outcomes.filter((o) => o.status === "certified").length;
  const skipped = outcomes.filter((o) => o.status === "skipped-existing").length;
  const failed = outcomes.filter((o) => o.status === "rejected");

  console.log(`certify-crackstep: ${certified} certified, ${skipped} already on disk, ${failed.length} failed to certify.`);
  if (failed.length > 0) {
    console.error(
      `certify-crackstep: ${failed.length} day(s) could NOT be certified and were left OFF disk — ` +
        "this is a gap in the buffer, not a shipped bad daily. Investigate before relying on the buffer count."
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(error.message);
    process.exitCode = 1;
  });
}

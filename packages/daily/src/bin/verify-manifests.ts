#!/usr/bin/env tsx
// packages/daily/src/bin/verify-manifests.ts — CI entry point for plan §2.3 point 3 (formula
// re-derivation: "CI recomputes dailySeed(...) for every vs-bot manifest and asserts equality
// with the stored seed; asserts n === dailyNumber(day); asserts budget.kind === 'rollouts' and
// humanSeat === 0") and §1.2's buffer policy (alert below 30 upcoming days, fail below 7).
// `assertValidManifest` (manifest.ts) already IS this check — this script just walks every
// committed file in data/daily/ and runs it, so "does today's whole buffer still validate" is
// one command rather than a per-file manual exercise.
//
// Usage: tsx src/bin/verify-manifests.ts [--today <yyyy-mm-dd>]
// Exit code 1 if any manifest fails validation, OR the upcoming-day buffer is below the 7-day
// hard-fail floor. A buffer between 7 and 29 (inclusive) prints an alert but does not fail —
// matching plan §1.2's "alerts below 30, hard-fails below 7."

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyBuffer } from "../buffer";
import { todayUTC } from "../day";
import { assertValidManifest, type DailyManifest } from "../manifest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DAILY_DIR = path.join(REPO_ROOT, "data", "daily");
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function parseArgs(argv: readonly string[]): { today: string } {
  let today = todayUTC();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--today" && argv[i + 1]) {
      today = argv[i + 1]!;
      i++;
    }
  }
  return { today };
}

async function main(): Promise<void> {
  const { today } = parseArgs(process.argv.slice(2));

  let entries: string[];
  try {
    entries = readdirSync(DAILY_DIR);
  } catch {
    entries = [];
  }
  const dayFiles = entries.filter((f) => DAY_FILE_RE.test(f)).sort();

  let failedCount = 0;
  for (const file of dayFiles) {
    const filenameDay = file.match(DAY_FILE_RE)?.[1];
    if (!filenameDay) continue;
    let manifest: DailyManifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(DAILY_DIR, file), "utf8")) as DailyManifest;
    } catch (err) {
      console.error(`FAIL ${file}: not valid JSON (${(err as Error).message})`);
      failedCount++;
      continue;
    }
    try {
      await assertValidManifest(manifest, { filenameDay });
    } catch (err) {
      console.error(`FAIL ${file}: ${(err as Error).message}`);
      failedCount++;
    }
  }

  const upcoming = dayFiles.filter((f) => (f.match(DAY_FILE_RE)?.[1] ?? "") >= today).length;
  const level = classifyBuffer(upcoming);
  console.log(`verify-manifests: ${dayFiles.length} manifest(s) on disk, ${upcoming} upcoming (>= ${today}), buffer=${level}`);

  if (failedCount > 0) {
    console.error(`verify-manifests: ${failedCount} manifest(s) failed validation`);
    process.exitCode = 1;
    return;
  }
  if (level === "fail") {
    console.error("verify-manifests: upcoming-day buffer is below the 7-day hard-fail floor (plan §1.2)");
    process.exitCode = 1;
    return;
  }
  if (level === "alert") {
    console.warn("verify-manifests: upcoming-day buffer is below the 30-day alert threshold (plan §1.2) — not a build break yet");
  }
}

main();

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
import { classifyBuffer, findFirstMissingDay } from "../buffer";
import { todayUTC } from "../day";
import { assertManifestBotMatchesEra } from "../era-guard";
import { assertValidEraFile } from "../era";
import type { EraFile } from "../era";
import { assertValidManifest, type DailyManifest } from "../manifest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DAILY_DIR = path.join(REPO_ROOT, "data", "daily");
const ERA_PATH = path.join(DAILY_DIR, "era.json");
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function readEra(): EraFile {
  try {
    return JSON.parse(readFileSync(ERA_PATH, "utf8")) as EraFile;
  } catch {
    return {};
  }
}

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
  const era = readEra();

  let failedCount = 0;

  // Should-fix 7: era.json itself was never validated by this script — only manifests that
  // EMBED a bot record got their copy cross-checked against it (assertManifestBotMatchesEra
  // below). A malformed era.json entry with no manifest currently referencing it (e.g. a future
  // game's record staged ahead of its first scheduled day) would sail through silently.
  try {
    assertValidEraFile(era);
  } catch (err) {
    console.error(`FAIL data/daily/era.json: ${(err as Error).message}`);
    failedCount++;
  }
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
      // Plan §2.2: the manifest's embedded bot copy must be byte-identical to era.json's entry
      // for that game — checked separately from assertValidManifest (which only validates the
      // manifest's OWN internal consistency, not cross-file agreement with the reviewed record).
      if (manifest.kind === "vs-bot" && manifest.bot) {
        assertManifestBotMatchesEra(manifest.gameId, manifest.bot, era);
      }
    } catch (err) {
      console.error(`FAIL ${file}: ${(err as Error).message}`);
      failedCount++;
    }
  }

  const days = dayFiles.map((f) => f.match(DAY_FILE_RE)?.[1]).filter((d): d is string => Boolean(d));
  const upcoming = days.filter((d) => d >= today).length;
  const level = classifyBuffer(upcoming);
  console.log(`verify-manifests: ${dayFiles.length} manifest(s) on disk, ${upcoming} upcoming (>= ${today}), buffer=${level}`);

  // Should-fix 7: a COUNT of upcoming manifests cannot see a hole in the MIDDLE of the range —
  // "90 files over 200 days with a hole next Tuesday" reads buffer=ok. Walk the actual calendar
  // days instead and name the first gap explicitly; this is a hard failure regardless of the
  // count-based buffer level, since a missing day is precisely the 6am incident plan §1.2
  // promises can't happen.
  const missingDay = findFirstMissingDay(days, today);
  if (missingDay) {
    console.error(`verify-manifests: day ${missingDay} has no committed manifest — a HOLE inside the otherwise-committed buffer, not just a low count`);
    failedCount++;
  }

  if (failedCount > 0) {
    console.error(`verify-manifests: ${failedCount} manifest(s)/file(s) failed validation`);
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

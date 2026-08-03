#!/usr/bin/env tsx
// packages/daily/src/bin/schedule-cli.ts — `pnpm daily:schedule` (plan §1.2 / §11.1 DY0, scoped
// explicitly to run "against fixture certificates" at this stage). Thin wrapper around
// rotation.ts's pure proposeRotation(): reads the games committed history from data/daily/*.json,
// consults data/certificates/<gameId>/<day>.json for solo-kind availability, and proposes which
// day plays which game for the next N days.
//
// Deliberately DOES NOT compose full DailyManifest JSON (seed, the pinned bot record, a
// certificate's public par subset) — that needs each game's real engine (engineVersion), a
// reviewed era.json entry (DY2, pending real bot tuning), and real certificates (DY4, pending
// M3d). This script's output — (day, gameId, kind) triples — is exactly the input a future
// manifest-composer step needs, so wiring that in later is additive, not a rewrite. Until then,
// this is a human-reviewed PROPOSAL: it never writes into data/daily/<yyyy-mm-dd>.json (the
// files the immutability guard protects), only to data/daily/schedule-proposal.json, and a human
// still turns each accepted day into a real manifest by hand or a follow-up tool (plan §1.2:
// "hand-curated with a round-robin safety net").
//
// Usage: tsx src/bin/schedule-cli.ts [--days 90] [--start <yyyy-mm-dd>]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DAILY_EPOCH, addUTCDays, isValidDailyDay } from "../day";
import { proposeRotation, RotationError, type ScheduledDay } from "../rotation";
import { LAUNCH_GAMES } from "../rotation-games";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DAILY_DIR = path.join(REPO_ROOT, "data", "daily");
const CERTIFICATES_DIR = path.join(REPO_ROOT, "data", "certificates");
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function parseArgs(argv: readonly string[]): { days: number; start?: string } {
  let days = 90;
  let start: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days" && argv[i + 1]) {
      days = Number(argv[i + 1]);
      i++;
    } else if (argv[i] === "--start" && argv[i + 1]) {
      start = argv[i + 1];
      i++;
    }
  }
  return start === undefined ? { days } : { days, start };
}

interface StoredManifestShape {
  day: string;
  gameId: string;
  kind: ScheduledDay["kind"];
}

function readHistory(): ScheduledDay[] {
  if (!existsSync(DAILY_DIR)) return [];
  const files = readdirSync(DAILY_DIR)
    .filter((f) => DAY_FILE_RE.test(f))
    .sort();
  const history: ScheduledDay[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(DAILY_DIR, file), "utf8")) as StoredManifestShape;
      history.push({ day: parsed.day, gameId: parsed.gameId, kind: parsed.kind });
    } catch {
      // A malformed file here is verify-manifests.ts's problem to report loudly; the scheduler
      // just skips it rather than crashing a 90-day proposal over one bad file.
    }
  }
  return history;
}

function hasCertificate(gameId: string, day: string): boolean {
  return existsSync(path.join(CERTIFICATES_DIR, gameId, `${day}.json`));
}

function main(): void {
  const { days, start } = parseArgs(process.argv.slice(2));

  // Should-fix 8: an unvalidated --start previously flowed straight into addUTCDays()/
  // proposeRotation() — a typo'd date (or one that doesn't name a real calendar day, e.g.
  // "2026-13-40") silently produced "NaN-NaN-NaN" downstream (Date.parse's leniency, per
  // day.ts's own parseUTCDay comment) rather than failing loudly at the one place a human
  // actually typed the value.
  if (start !== undefined && !isValidDailyDay(start)) {
    console.error(`schedule-cli: --start "${start}" is not a valid "yyyy-mm-dd" day at or after DAILY_EPOCH (${DAILY_EPOCH})`);
    process.exitCode = 1;
    return;
  }

  const history = readHistory();
  const lastCommittedDay = history.length > 0 ? history[history.length - 1]!.day : undefined;
  const startDay = start ?? (lastCommittedDay ? addUTCDays(lastCommittedDay, 1) : DAILY_EPOCH);

  let schedule: ScheduledDay[];
  try {
    schedule = proposeRotation(startDay, days, history, { games: LAUNCH_GAMES, hasCertificate });
  } catch (err) {
    if (err instanceof RotationError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log(`daily:schedule — proposing ${schedule.length} day(s) starting ${startDay} (${LAUNCH_GAMES.length} game(s) in the roster):`);
  for (const entry of schedule) {
    console.log(`  ${entry.day}  ${entry.kind.padEnd(11)}  ${entry.gameId}`);
  }

  const proposalPath = path.join(DAILY_DIR, "schedule-proposal.json");
  writeFileSync(proposalPath, `${JSON.stringify(schedule, null, 2)}\n`);
  console.log(`\nWritten to ${path.relative(REPO_ROOT, proposalPath)} — review, then hand-compose each day's real manifest (plan §1.2).`);
}

main();

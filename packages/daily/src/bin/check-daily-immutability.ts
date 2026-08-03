#!/usr/bin/env tsx
// packages/daily/src/bin/check-daily-immutability.ts — the CI entry point for the manifest
// immutability guard (plan §2.3, point 2; packages/daily/src/immutability.ts has the pure rule
// and its unit tests, including a planted violation). This script is the thin, mostly-untested-
// by-design wrapper: it shells out to `git diff` to find which `data/daily/*.json` files changed
// versus a base ref, extracts each changed file's `day`, and calls the pure guard.
//
// Usage: tsx src/bin/check-daily-immutability.ts [--base <ref>] [--today <yyyy-mm-dd>]
//   --base   defaults to "origin/main" — the ref CI diffs the current branch against.
//   --today  defaults to the real UTC date (day.ts's todayUTC()). The override exists for two
//            legitimate reasons, not to dodge the guard: (1) local testing/demonstration without
//            waiting for the calendar, since DAILY_EPOCH itself is in the future relative to any
//            date before 2026-09-01 and no day can be "shipped" before then; (2) a CI runner
//            whose wall clock cannot be trusted should be passed an explicit, deploy-pipeline-
//            supplied date rather than trusting its own `Date.now()`.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { todayUTC } from "../day";
import { assertNoShippedManifestChanged } from "../immutability";

// git resolves a bare pathspec like "data/daily" RELATIVE TO CWD, not the repo root — running
// this script from packages/daily (as `pnpm --filter @twist-arcade/daily run guard:...` does)
// would otherwise silently match nothing (packages/daily/data/daily doesn't exist) and report a
// false "0 manifests changed" every time. Pinning `cwd` to the repo root makes the pathspec mean
// what it says regardless of where this script is invoked from.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function parseArgs(argv: readonly string[]): { base: string; today: string } {
  let base = "origin/main";
  let today = todayUTC();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) {
      base = argv[i + 1]!;
      i++;
    } else if (argv[i] === "--today" && argv[i + 1]) {
      today = argv[i + 1]!;
      i++;
    }
  }
  return { base, today };
}

function changedManifestDays(base: string): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", "data/daily"], { encoding: "utf8", cwd: REPO_ROOT });
  } catch (err) {
    throw new Error(`check-daily-immutability: \`git diff\` against "${base}" failed — is the base ref fetched? (${(err as Error).message})`);
  }
  const days: string[] = [];
  for (const line of out.split("\n")) {
    const file = line.trim();
    if (!file) continue;
    const match = /data\/daily\/(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
    if (match?.[1]) days.push(match[1]);
  }
  return days;
}

function main(): void {
  const { base, today } = parseArgs(process.argv.slice(2));
  const days = changedManifestDays(base);
  try {
    assertNoShippedManifestChanged(days, today);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }
  console.log(`check-daily-immutability: ok — ${days.length} manifest(s) changed vs ${base}, none shipped (today=${today})`);
}

main();

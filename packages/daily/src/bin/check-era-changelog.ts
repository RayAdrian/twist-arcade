#!/usr/bin/env tsx
// packages/daily/src/bin/check-era-changelog.ts — the CI entry point for the era-snapshot review
// guard (plan §2.3, point 1; packages/daily/src/era-guard.ts has the pure rule and its unit
// tests, including a planted violation). Reads `data/daily/era.json` at a base ref (via
// `git show`) and compares it to the working tree's copy; checks whether
// `data/daily/CHANGELOG.md` also changed in the same diff.
//
// Usage: tsx src/bin/check-era-changelog.ts [--base <ref>]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertEraChangeIsReviewed } from "../era-guard";
import type { EraFile } from "../era";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ERA_PATH = "data/daily/era.json";
const CHANGELOG_PATH = "data/daily/CHANGELOG.md";

function parseArgs(argv: readonly string[]): { base: string } {
  let base = "origin/main";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) {
      base = argv[i + 1]!;
      i++;
    }
  }
  return { base };
}

function readEraAtRef(ref: string): EraFile {
  try {
    const content = execFileSync("git", ["show", `${ref}:${ERA_PATH}`], { encoding: "utf8" });
    return JSON.parse(content) as EraFile;
  } catch {
    return {}; // the file didn't exist at that ref yet — every entry in the new file is "new."
  }
}

function readEraNow(): EraFile {
  try {
    return JSON.parse(readFileSync(path.join(REPO_ROOT, ERA_PATH), "utf8")) as EraFile;
  } catch {
    return {};
  }
}

function changelogChanged(base: string): boolean {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", CHANGELOG_PATH], { encoding: "utf8" });
  return out.trim().length > 0;
}

function main(): void {
  const { base } = parseArgs(process.argv.slice(2));
  const oldEra = readEraAtRef(base);
  const newEra = readEraNow();
  try {
    assertEraChangeIsReviewed(oldEra, newEra, changelogChanged(base));
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }
  console.log(`check-era-changelog: ok — era.json vs ${base} is either unchanged or a properly reviewed bump.`);
}

main();

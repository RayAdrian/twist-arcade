#!/usr/bin/env node
// scripts/check-tsconfig-coverage.mjs
//
// C69 (docs/plans/platform-corrections.md): games/bid-tac-toe's tsconfig `include` glob
// never covered `solver/**/*.ts` or any `*.mts` file, so its backward-induction solver and
// independent oracle — the code producing the exact solve the harness cites by name as gate
// proof — had NEVER been examined by `pnpm typecheck`, which was passing the whole time.
// C72: the audit C69 owed found a second instance, shipped on `main` — games/tilt's
// tsconfig was missing `ui/**/*.ts`, so games/tilt/ui/board-view.test.ts ran 16 tests every
// run with its types never checked. Vitest discovers tests by its own glob, not tsconfig,
// so the split was exact: the tests ran, the type checking did not.
//
// Both defects were found by a human reading `include` globs and predicting what they
// cover. That prediction is the failure mode. The method C72 established, and this script
// automates, is to never predict — ask the compiler what it actually processed:
//
//   tsc -p <pkg>/tsconfig.json --noEmit --listFiles
//
// ...then diff that list against every real *.ts/*.tsx/*.mts/*.cts file that exists on disk
// under the package. Anything on disk and not in the compiler's own list is an uncovered
// file, reported by name, per package.
//
// Scope: every workspace package — every directory matched by the `packages:` globs in
// pnpm-workspace.yaml (today: `packages/*` and `games/*`) that has both a package.json and
// a tsconfig.json. The glob list is READ from pnpm-workspace.yaml, not copied into this
// script, so a package this script has never heard of (a new game from `pnpm new-game`, a
// new packages/* directory) is covered automatically — nobody has to remember to add it
// here, which is the whole reason C69/C72's manual audit was owed as automation in the
// first place.
//
// Deliberately OUT of scope: scripts/, supabase/, templates/game*, and the root Next.js app
// (tsconfig.app.json). None of those are pnpm workspace packages (pnpm-workspace.yaml only
// lists packages/* and games/*), and C69/C72 both scoped their audit to that same package
// set. templates/game* in particular are scaffolding copied by `pnpm new-game`, not
// packages tsc builds today — a gap there would matter to the *next* game, not this repo's
// current typecheck surface, and is a different check.
//
// Run via `pnpm check:tsconfig-coverage`. Wired into .github/workflows/ci.yml for when CI
// resumes (C68: CI has not run in 11 days as of this writing) — do not assume CI runs this;
// it must be useful from the shell today.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

let failed = false;
function fail(message) {
  failed = true;
  console.error(`✗ ${message}`);
}

// ---------------------------------------------------------------------------------------
// Legitimate, explicit exclusions.
//
// C72 Finding 2 recorded packages/{bots,engine,game-spec,harness,daily}/vitest.config.ts as
// a known, benign gap: none of those packages' tsconfig `include` globs (`src/**/*.ts`,
// `test/**/*.ts`) reach a config file sitting at the package root, and that is a normal,
// intentional convention — vitest config is not shipped runtime code.
//
// Running this guard against today's tree found a SIXTH instance C72 did not record:
// packages/shell/vitest.config.ts, present since 98aeb91 (2026-08-03) — nine days before
// C72's audit commit (59e2c08, 2026-08-12). It is the identical convention, so it is
// allowlisted alongside the other five, but the gap in C72's own count is reported here
// rather than silently folded into that document (see the SHA report for this change).
//
// Every entry is a single EXACT repo-relative path, never a pattern. A pattern (e.g. any
// `*.config.ts`, or any bare `vitest.config.ts` basename regardless of location) could
// silently swallow a real source file that happens to share a name later — C72 warned
// against exactly that shape of guard. Adding a package to this list is a deliberate,
// reviewable, one-line diff, not an automatic inference.
// ---------------------------------------------------------------------------------------
const ALLOWLIST = new Set([
  "packages/bots/vitest.config.ts",
  "packages/daily/vitest.config.ts",
  "packages/engine/vitest.config.ts",
  "packages/game-spec/vitest.config.ts",
  "packages/harness/vitest.config.ts",
  "packages/shell/vitest.config.ts", // not recorded in C72 — see comment above
]);

// ---------------------------------------------------------------------------------------
// 1. Discover packages from pnpm-workspace.yaml's `packages:` glob list — not hardcoded.
// ---------------------------------------------------------------------------------------
function discoverWorkspaceGlobs() {
  const yamlPath = join(repoRoot, "pnpm-workspace.yaml");
  const yaml = readFileSync(yamlPath, "utf8");
  const lines = yaml.split("\n");
  const globs = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/);
      if (item) {
        globs.push(item[1]);
        continue;
      }
      break; // first non-list-item line ends the `packages:` block
    }
  }
  if (globs.length === 0) {
    throw new Error(
      `${yamlPath}: found no entries under \`packages:\` — this script's parser is broken, not this repo's workspace (it has always had at least one glob)`
    );
  }
  return globs;
}

function discoverPackageDirs() {
  const globs = discoverWorkspaceGlobs();
  const candidateRelDirs = [];
  for (const glob of globs) {
    if (glob.endsWith("/*")) {
      const base = glob.slice(0, -2);
      const baseDir = join(repoRoot, base);
      let entries;
      try {
        entries = readdirSync(baseDir, { withFileTypes: true });
      } catch {
        continue; // base glob directory doesn't exist (e.g. not yet created) — nothing to find
      }
      for (const entry of entries) {
        if (entry.isDirectory()) candidateRelDirs.push(`${base}/${entry.name}`);
      }
    } else {
      // A literal (non-glob) workspace entry, e.g. "shared-lib" with no trailing "/*".
      candidateRelDirs.push(glob);
    }
  }
  // A "package" for this guard is a workspace-glob-matched directory that is ALSO a real
  // tsc-governed unit: it must own both a package.json and a tsconfig.json. A directory
  // matching the glob but missing either isn't something `tsc -p` can be pointed at.
  return candidateRelDirs
    .filter((rel) => {
      const dir = join(repoRoot, rel);
      try {
        return statSync(join(dir, "package.json")).isFile() && statSync(join(dir, "tsconfig.json")).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

// ---------------------------------------------------------------------------------------
// 2. On-disk reality: every real source file under a package, ignoring build output.
// ---------------------------------------------------------------------------------------
const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts)$/;

function findOnDiskSourceFiles(pkgDir) {
  const results = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // "dist" is build OUTPUT (gitignored, produced by `tsc -b`) — never a coverage input.
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (SOURCE_EXT_RE.test(entry.name)) results.push(full);
    }
  }
  walk(pkgDir);
  return results;
}

// ---------------------------------------------------------------------------------------
// 3. What the compiler actually read, per C72's method: ask, don't predict.
// ---------------------------------------------------------------------------------------
const ABS_FILE_LINE_RE = /^\/.*\.(ts|tsx|mts|cts)$/;

function compilerCoveredFiles(pkgRelDir) {
  const tsconfigRel = `${pkgRelDir}/tsconfig.json`;
  let stdout;
  try {
    stdout = execFileSync(tscBin, ["-p", tsconfigRel, "--noEmit", "--listFiles"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // tsc exits non-zero on type errors, and separately on TS6305 ("output file has not
    // been built from source") when a referenced project hasn't been `tsc -b`'d yet in this
    // checkout. Neither is a coverage question — --listFiles still prints the full file
    // list on stdout regardless of diagnostics (verified: identical list with and without a
    // prior `pnpm typecheck`), so a red or unbuilt tree still gets a trustworthy answer
    // here. Diagnostic lines are filtered out below by shape, not by exit code.
    stdout = String(err.stdout ?? "");
    if (!stdout) {
      throw new Error(
        `tsc -p ${tsconfigRel} --listFiles produced no stdout at all (stderr: ${String(err.stderr ?? "").slice(0, 500)}) — the invocation itself failed, not a coverage gap`
      );
    }
  }
  const files = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => ABS_FILE_LINE_RE.test(l));
  if (files.length === 0) {
    throw new Error(
      `tsc -p ${tsconfigRel} --listFiles matched zero files against this script's own parser — that parser is almost certainly broken, not this package`
    );
  }
  return new Set(files);
}

// ---------------------------------------------------------------------------------------
// 4. Run it.
// ---------------------------------------------------------------------------------------
const packageDirs = discoverPackageDirs();
console.log(`Discovered ${packageDirs.length} workspace package(s) from pnpm-workspace.yaml:`);
for (const d of packageDirs) console.log(`  - ${d}`);
console.log();
console.log(`Allowlisted (explicit, exact-path exclusions — C72 Finding 2, plus one this run's own audit added):`);
for (const a of [...ALLOWLIST].sort()) console.log(`  - ${a}`);
console.log();

let totalGaps = 0;
for (const pkgRelDir of packageDirs) {
  const pkgDir = join(repoRoot, pkgRelDir);
  const onDisk = findOnDiskSourceFiles(pkgDir);
  const covered = compilerCoveredFiles(pkgRelDir);

  const gaps = [];
  let allowlistedHere = 0;
  for (const abs of onDisk) {
    if (covered.has(abs)) continue;
    const rel = relative(repoRoot, abs).split(sep).join("/");
    if (ALLOWLIST.has(rel)) {
      allowlistedHere += 1;
      continue;
    }
    gaps.push(rel);
  }

  if (gaps.length > 0) {
    totalGaps += gaps.length;
    fail(`${pkgRelDir}: ${gaps.length} file(s) on disk that ${pkgRelDir}/tsconfig.json never reads:`);
    for (const g of gaps.sort()) console.error(`    ${g}`);
  } else {
    const suffix = allowlistedHere > 0 ? ` (${allowlistedHere} allowlisted)` : "";
    console.log(`✓ ${pkgRelDir} — tsconfig coverage matches disk: ${onDisk.length} file(s)${suffix}`);
  }
}

console.log();
if (failed) {
  console.error(
    `tsconfig coverage check FAILED — ${totalGaps} uncovered file(s) across the package(s) above.\n` +
      "A configuration that scopes a guard is part of the guard (C69/C72) and is never verified by reading it. " +
      "Fix the tsconfig's include/exclude glob so it actually reaches the file, or — only if the exclusion is " +
      "deliberate and legitimate (e.g. an unshipped config file) — add its exact path to ALLOWLIST in this " +
      "script with a comment explaining why."
  );
  process.exit(1);
} else {
  console.log("tsconfig coverage check passed — every workspace package's tsconfig reads every real source file it ships.");
}

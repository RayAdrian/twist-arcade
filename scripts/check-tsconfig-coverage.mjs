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
// scripts/, supabase/, templates/game*, and the root Next.js app (tsconfig.app.json) are
// NOT covered by this scope. This used to be argued here in prose ("none of those are pnpm
// workspace packages") — C79 ruling 1 refuted that argument directly: scripts/ is real,
// shipped, typechecked-in-part code, and this guard's own scope excluding it is exactly
// where the mirrorMove type lie (C79) was hiding, one layer below C69/C72's original
// finding. C79 ruling 1 also names the root Next.js app as belonging in scope. Neither is
// added here — the addendum (c522bcf) tried it directly and found the fix is bigger than a
// glob (project-reference/rootDir restructuring, since scripts/research/ imports
// games/tilt/), so it is routed to task #24, not folded into this branch. Per C79's own
// rule — "an exemption that is printed is reviewable; one that lives in a header comment is
// not" — the actual, current OUT_OF_SCOPE list below is a runtime-printed artifact, not
// prose: run this script and read its own output for what it did not check and why, rather
// than trusting this comment to stay accurate.
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
// Explicitly out of scope — printed at runtime, not just asserted in a header comment.
//
// C79 ruling 1: "an exemption that is printed is reviewable; one that lives in a header
// comment is not." A prior version of this script argued scripts/ and the root Next.js app
// out of scope in prose ("none of those are pnpm workspace packages") — that argument is
// refuted (C79): scripts/ is real, shipped, typechecked-in-part code with its own
// tsc -b-governed tsconfig.json, and this guard's own blind spot there is exactly where
// scripts/research/tilt-t4-gates.ts's mirrorMove type lie was hiding. These four entries are
// a KNOWN, OPEN gap, not a settled boundary — see docs/plans/platform-corrections.md C79
// ruling 1 and task #24 (C79 addendum, c522bcf, sized the fix: adding research/**/*.ts to
// scripts/tsconfig.json surfaces 5 real errors plus rootDir/project-reference work, because
// research/ imports games/tilt/ from outside scripts' rootDir — bigger than this branch).
// ---------------------------------------------------------------------------------------
const OUT_OF_SCOPE = [
  {
    path: "scripts/",
    reason:
      "real, shipped, typechecked-in-part code (own tsconfig.json, in the root tsc -b graph) — " +
      "KNOWN GAP per C79 ruling 1, not a settled exemption; task #24 tracks extending scope here",
  },
  {
    path: "supabase/",
    reason:
      "same shape as scripts/ — own tsconfig.json, in the root tsc -b graph, not a pnpm workspace " +
      "package — not yet audited under C79's ruling; treated as the same open question, not a settled exemption",
  },
  {
    path: "app/ (tsconfig.app.json)",
    reason: "the root Next.js app project — C79 ruling 1 names this explicitly as belonging in scope; not yet done",
  },
  {
    path: "templates/game/, templates/game-solo/",
    reason:
      "scaffolding copied by `pnpm new-game`, not built by the root tsc -b graph today — a gap here " +
      "would affect the NEXT game created from the template, not this repo's current typecheck surface",
  },
];

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
      if (/^\s*$/.test(line)) continue; // blank line inside the list — keep scanning
      if (/^\s*#/.test(line)) continue; // full-line comment inside the list — keep scanning
      const item = line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/);
      if (item) {
        globs.push(item[1]);
        continue;
      }
      break; // first real (non-blank, non-comment, non-list-item) line ends the `packages:` block
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
  // A "package" this guard can point `tsc -p` at must own both a package.json and a
  // tsconfig.json. A workspace-glob-matched directory with package.json but NO
  // tsconfig.json is a different, worse thing than a coverage gap: it is a package
  // typechecked by NOTHING, and silently dropping it here would make it look, from this
  // guard's own passing exit code, like it had been checked and was fine. So it is not
  // silently filtered out — it is reported by discoverPackageDirs() as `uncheckable` and
  // surfaced as a failure below, same as any other uncovered file.
  const checked = [];
  const uncheckable = [];
  for (const rel of new Set(candidateRelDirs)) {
    const dir = join(repoRoot, rel);
    const hasPackageJson = statSyncOrNull(join(dir, "package.json"))?.isFile() ?? false;
    if (!hasPackageJson) continue; // not a real package directory at all (e.g. a stray file)
    const hasTsconfig = statSyncOrNull(join(dir, "tsconfig.json"))?.isFile() ?? false;
    if (hasTsconfig) checked.push(rel);
    else uncheckable.push(rel);
  }
  return { checked: checked.sort(), uncheckable: uncheckable.sort() };
}

function statSyncOrNull(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
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
const { checked: packageDirs, uncheckable: uncheckablePackageDirs } = discoverPackageDirs();
console.log(`Discovered ${packageDirs.length} workspace package(s) from pnpm-workspace.yaml:`);
for (const d of packageDirs) console.log(`  - ${d}`);
console.log();
console.log(`Allowlisted (explicit, exact-path exclusions — C72 Finding 2, plus one this run's own audit added):`);
for (const a of [...ALLOWLIST].sort()) console.log(`  - ${a}`);
console.log();
console.log(`Explicitly OUT OF SCOPE (C79 ruling 1 — printed here, not just argued in a header comment):`);
for (const o of OUT_OF_SCOPE) console.log(`  - ${o.path} — ${o.reason}`);
console.log();

let totalUncoveredFiles = 0;
let totalUncheckablePackages = 0;

if (uncheckablePackageDirs.length > 0) {
  for (const rel of uncheckablePackageDirs) {
    totalUncheckablePackages += 1;
    fail(`${rel}: has a package.json but NO tsconfig.json — this package is typechecked by NOTHING, not merely under-covered`);
  }
  console.error(); // separate the uncheckable-package block from the per-package results below
}

// Measures one package's gap set: every on-disk source file not in the compiler's own list
// and not allowlisted. Two independent, unsynchronized filesystem reads (this function's fs
// walk, and the separate `tsc` subprocess's own directory reads) taken a moment apart are
// not atomic with respect to anything ELSE mutating the tree at the same time — irrelevant
// for a normal solo run, but this script's own test suite runs inside `pnpm test`, where
// OTHER test files legitimately write and remove real files inside these same package
// directories for the length of their own run (e.g. packages/engine/test/check-engine-
// purity.test.ts plants and removes files under packages/engine/src/). A file caught mid-
// write by one read and not the other reads as a false gap. measurePackage() is deliberately
// a pure, side-effect-free snapshot so it can be safely taken more than once.
function measurePackage(pkgRelDir) {
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
  return { onDiskCount: onDisk.length, allowlistedHere, gaps: new Set(gaps) };
}

// Synchronous sleep with no subprocess — Atomics.wait blocks the (single-threaded) main
// thread on a SharedArrayBuffer that nothing will ever notify, which is exactly "sleep" with
// no extra dependency or platform-specific binary.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (const pkgRelDir of packageDirs) {
  const first = measurePackage(pkgRelDir);

  // A REAL tsconfig coverage gap is a property of committed configuration — it cannot
  // un-happen between two reads a few hundred milliseconds apart. So an apparent gap is only
  // reported once a second, independent measurement reproduces the SAME file(s); anything
  // that appears in only one of the two reads is exactly the shape a concurrent write/delete
  // elsewhere in the tree produces, not a real defect, and is silently not a finding — the
  // second measurement is the confirmation, not a retry hiding a real result. A short pause
  // first gives whatever transient writer caused the mismatch a chance to finish its own
  // write/delete cycle, rather than racing it a second time immediately.
  let confirmedGaps = first.gaps;
  let result = first;
  if (first.gaps.size > 0) {
    sleepMs(250);
    const second = measurePackage(pkgRelDir);
    confirmedGaps = new Set([...first.gaps].filter((g) => second.gaps.has(g)));
    result = second; // report the second read's onDisk/allowlisted counts alongside it
    if (confirmedGaps.size === 0) {
      console.log(
        `~ ${pkgRelDir} — first read found ${first.gaps.size} apparent gap(s), none reproduced on a second ` +
          "read (transient — almost certainly another concurrent process writing into this package's " +
          "directory, e.g. this repo's own test suite; not treated as a finding)"
      );
    }
  }

  if (confirmedGaps.size > 0) {
    totalUncoveredFiles += confirmedGaps.size;
    fail(`${pkgRelDir}: ${confirmedGaps.size} file(s) on disk that ${pkgRelDir}/tsconfig.json never reads:`);
    for (const g of [...confirmedGaps].sort()) console.error(`    ${g}`);
  } else if (first.gaps.size === 0) {
    const suffix = result.allowlistedHere > 0 ? ` (${result.allowlistedHere} allowlisted)` : "";
    console.log(`✓ ${pkgRelDir} — tsconfig coverage matches disk: ${result.onDiskCount} file(s)${suffix}`);
  }
}

console.log();
if (failed) {
  console.error(
    `tsconfig coverage check FAILED — ${totalUncoveredFiles} uncovered file(s) and ${totalUncheckablePackages} ` +
      "wholly-unchecked package(s) (no tsconfig.json at all) across the package(s) above.\n" +
      "A configuration that scopes a guard is part of the guard (C69/C72) and is never verified by reading it. " +
      "Fix the tsconfig's include/exclude glob so it actually reaches the file (or add a tsconfig.json at all), " +
      "or — only if the exclusion is deliberate and legitimate (e.g. an unshipped config file) — add its exact " +
      "path to ALLOWLIST in this script with a comment explaining why."
  );
  process.exit(1);
} else {
  console.log("tsconfig coverage check passed — every workspace package's tsconfig reads every real source file it ships.");
}

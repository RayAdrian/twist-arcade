#!/usr/bin/env node
// scripts/check-declared-deps.mjs
//
// C83 (docs/plans/platform-corrections.md): four branches merged, each typechecked, linted,
// tested, byte-identity-verified and stage-6 reviewed. Running the real gate table on `main`
// then failed instantly:
//
//   Cannot find package '@twist-arcade/fadeout' imported from scripts/ci-gates.ts
//
// scripts/ci-gates.ts resolves each game's mirrorMove/safeMove via a TEMPLATED DYNAMIC import:
//
//   await import(`@twist-arcade/${gameId}`)
//
// The root package.json declared crackstep, mine-run, nine-grids and tilt -- never fadeout.
// It had only ever resolved because a stale node_modules symlink happened to be present, and
// a worktree teardown pruned it. Every branch passed because each worktree resolved
// independently; the defect existed only in the integration.
//
// This guard compares every scope unit's real imports -- static AND templated-dynamic -- against
// its own declared dependencies (dependencies + devDependencies + peerDependencies +
// optionalDependencies; this is a resolution check, not packages/engine's stricter
// runtime-vs-dev purity rule). Same posture as check-engine-purity.mjs and
// check-tsconfig-coverage.mjs: discover scope from configuration, never hardcode; fail loudly,
// naming the file and the specifier; print the scope boundary at runtime (C79 ruling 1), not
// only in this header comment.
//
// Imports are extracted via the real TypeScript parser (`ts.createSourceFile`, AST walk) --
// NOT regex over raw source text. A first regex-based draft of this guard produced ~40 false
// positives on this repo's own heavily-commented style: JSDoc prose routinely contains the
// literal shape `from "quoted phrase"` ("...as visually distinct from "N/A " and..."), and
// scripts/new-game.ts and its test both contain STRING LITERALS whose CONTENTS are
// `import("@twist-arcade/${vars.gameId}")` -- template-generated code-as-text for the
// registry-insertion codegen, not a real import. A regex over raw text cannot tell a comment
// or a data string from a real import statement; the TypeScript AST can, by construction --
// the same "ask the tool, don't predict from source" rule C72 (check-tsconfig-coverage.mjs)
// established, applied to import extraction instead of tsconfig include globs.
//
// -----------------------------------------------------------------------------------------
// THE EXPANSION-SET DECISION for templated-dynamic imports (the hard part; C83's "owed").
//
// `import(`@twist-arcade/${gameId}`)` names no package a static analyzer can see. Three
// options were on the table:
//
//   (a) Resolve the expansion set from games/registry.ts's keys.
//   (b) Require an explicit machine-readable declaration at the import site.
//   (c) Treat any `@twist-arcade/`-prefixed template as requiring EVERY workspace game
//       package to be declared.
//
// (c) was tried first and rejected on real evidence, not a priori: games/duel-draft and
// games/order-vs-chaos are real, on-disk, package.json-bearing game packages that are
// DELIBERATELY UNREGISTERED (duel-draft was killed at D2 -- forced draw under competent play,
// platform-corrections.md C66; order-vs-chaos is mid-build, not yet in games/registry.ts).
// `gameId` in scripts/ci-gates.ts and packages/harness/src/cli.ts is drawn from
// `Object.keys(registry)` (or validated against it via `--game`/UnregisteredGameError) --
// it can NEVER be "duel-draft" or "order-vs-chaos" at that call site. (c) would have flagged
// both as "undeclared dependencies" for an import that cannot reach them, which is a false
// claim of a bug and exactly the kind of blunt-scope mistake that erodes trust in a guard's
// output (C79's own concern, just inverted: over-inclusion instead of a silent gap).
//
// (b) was rejected as a second, parallel manifest: it would require a comment or const at
// every templated-import call site declaring its own expansion set, which itself goes stale
// exactly the way the root package.json did here -- a second place to forget to update, not
// a fix.
//
// (a) is what's implemented, but NOT by regex-parsing games/registry.ts's object literal --
// that is "reading source and predicting what it means," the precise failure mode C72 (see
// check-tsconfig-coverage.mjs) diagnosed and built its whole method to avoid. Instead this
// guard ASKS the real module: it imports games/registry.ts via `tsx` (a subprocess, the same
// tool `pnpm harness`/`pnpm new-game` already use to run this repo's TypeScript directly) and
// reads `Object.keys(registry)` at runtime -- the same "ask, don't predict" rule C72
// established, applied one layer up. registry.ts's own runtime imports are all either
// `import type` (erased) or relative paths, never `@twist-arcade/*` package specifiers, so
// this resolution succeeds even when the exact dependency this guard is checking for is
// missing -- it is not circular.
//
// A template whose static prefix matches a DIFFERENT `@scope/` with no registered resolver is
// never silently treated as fine -- see EXPANSION_RESOLVERS below and the OUT_OF_SCOPE-style
// runtime message it prints when it hits one. A template with anything after the
// interpolation, or more than one interpolation, is refused the same way: a shape this guard
// was not built to reason about is a loud failure, never a silent pass.
//
// -----------------------------------------------------------------------------------------
// SCOPE.
//
// IN SCOPE: every workspace package discovered from pnpm-workspace.yaml's `packages:` globs
// (today: packages/*, games/*), checked against ITS OWN package.json -- PLUS scripts/,
// checked against the ROOT package.json.
//
// scripts/ is deliberately IN scope here, which is the opposite of
// check-tsconfig-coverage.mjs's own OUT_OF_SCOPE list. That guard leaves scripts/ out as a
// known, open gap (C79 ruling 1, task #24). This guard cannot make the same call: the C83
// defect it exists to catch lives IN scripts/ci-gates.ts. A version of this guard that
// excluded scripts/ would be structurally incapable of ever failing on its own acceptance
// test. scripts/ is not a pnpm workspace package (no package.json of its own), so its imports
// are checked against the repo ROOT's package.json -- the same manifest `node` actually
// consults resolving `scripts/ci-gates.ts`'s imports at the real repo root.
//
// OUT OF SCOPE, printed below at runtime (not just here): app/ (the root Next.js app),
// supabase/, templates/game*, templates/game-solo*. Same reasoning check-tsconfig-coverage.mjs
// already gives for each: app/ is a known, not-yet-done gap (C79 ruling 1); supabase/ has its
// own tsconfig.json and isn't a workspace package; templates/* is `pnpm new-game` scaffolding,
// never built by the root graph directly. None of these three currently contain a
// `@twist-arcade/`-templated dynamic import (checked by hand while building this guard), so
// this is a known, bounded gap, not a silent one.
//
// Fully-dynamic imports whose specifier is neither a string literal nor a template literal
// (e.g. `import(someUrlVariable)`) are out of scope too -- they cannot be resolved to a
// package name statically at all. Every instance of this shape in the repo today
// (scripts/ci-gates.ts, scripts/calibration-drift.ts, scripts/verify-certificates.ts,
// scripts/chunk-budget.ts, packages/harness/src/cli.ts) resolves a `pathToFileURL`-built
// `file://` URL to games/registry.ts, never a bare package specifier -- so this is not a gap
// against this repo's actual code today, but it is printed as a boundary, not assumed silently.
//
// -----------------------------------------------------------------------------------------
// C84: THE FIRST REAL RUN FOUND A LAYERING VIOLATION, NOT A MISSING DECLARATION -- NOW FIXED.
//
// packages/harness/src/cli.ts:151 USED TO have the identical templated-dynamic shape
// (`import(\`@twist-arcade/${gameId}\`)`), and packages/harness/package.json declared none of
// crackstep/fadeout/nine-grids/tilt. The obvious fix -- declare them -- was tried and
// rejected: crackstep and fadeout both already depend on @twist-arcade/harness, so declaring
// the reverse edge would have been a real cycle (harness -> crackstep -> harness). The missing
// declaration was load-bearing: it was the only thing keeping the cycle from being real. The
// actual defect was a platform package (packages/harness) reaching into leaf game packages by
// name at all -- scripts/ci-gates.ts already solved this correctly via INJECTED
// resolveSafeMove/resolveMirrorMove (RunAllGatesDeps); the CLI never got the same treatment,
// and resolved only because pnpm hoists workspace packages to the root node_modules and the
// CLI happened to run from the repo root -- the identical accident as C83's fadeout symlink,
// one layer in.
//
// FIXED by inverting the CLI's game resolution to injection, matching scripts/ci-gates.ts:
// packages/harness/src/cli.ts's `dispatch()` now takes an injected `CliDeps` and performs NO
// dynamic import of a game package or games/registry.ts itself; the real wiring moved to
// scripts/harness-cli.ts (the real `pnpm harness` process entry point), which is checked
// against the ROOT package.json -- already declaring every registered game. The four findings
// this guard used to allowlist no longer occur at all; ALLOWLIST (below) is empty.
//
// Run via `pnpm check:deps`. Wired into .github/workflows/ci.yml for when CI resumes (C68:
// CI has not run in 12 days as of this writing, nightly never) -- do not assume CI runs this;
// it must be useful from the shell today.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxBin = join(repoRoot, "node_modules/.bin/tsx");

const startedAt = process.hrtime.bigint();

let failed = false;
function fail(message) {
  failed = true;
  console.error(`✗ ${message}`);
}

// ---------------------------------------------------------------------------------------
// Specifier classification helpers.
// ---------------------------------------------------------------------------------------
const BUILTIN_MODULE_NAMES = new Set(builtinModules);

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isNodeBuiltin(specifier) {
  if (specifier.startsWith("node:")) return true;
  return BUILTIN_MODULE_NAMES.has(specifier);
}

function packageNameOf(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

// ---------------------------------------------------------------------------------------
// Explicitly out of scope -- printed at runtime, not just argued in this header comment.
// C79 ruling 1: "an exemption that is printed is reviewable; one that lives in a header
// comment is not."
// ---------------------------------------------------------------------------------------
const OUT_OF_SCOPE = [
  {
    path: "app/ (the root Next.js app)",
    reason:
      "same known, not-yet-done gap check-tsconfig-coverage.mjs names under C79 ruling 1 -- not a settled exemption",
  },
  {
    path: "supabase/",
    reason: "own tsconfig.json, not a pnpm workspace package -- same treatment as check-tsconfig-coverage.mjs gives it",
  },
  {
    path: "templates/game/, templates/game-solo/",
    reason: "`pnpm new-game` scaffolding, not built by the root graph directly -- affects the NEXT game created, not this tree",
  },
];

const FULLY_DYNAMIC_NOTE =
  "import() calls whose specifier is neither a string literal nor a template literal " +
  "(e.g. import(someUrlVariable)) cannot be resolved to a package name statically and are " +
  "out of scope. Every such call in this repo today resolves a pathToFileURL() file:// URL " +
  "to games/registry.ts, never a bare package specifier -- verified by hand, not assumed.";

// ---------------------------------------------------------------------------------------
// 1. Discover workspace packages from pnpm-workspace.yaml's `packages:` glob list (same
// method as check-tsconfig-coverage.mjs) -- never hardcoded, so a new game or package is
// covered with no edit to this file.
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
      if (/^\s*$/.test(line)) continue;
      if (/^\s*#/.test(line)) continue;
      const item = line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/);
      if (item) {
        globs.push(item[1]);
        continue;
      }
      break;
    }
  }
  if (globs.length === 0) {
    throw new Error(`${yamlPath}: found no entries under \`packages:\` -- this script's parser is broken, not this repo's workspace`);
  }
  return globs;
}

function statSyncOrNull(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function discoverWorkspacePackageDirs() {
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
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) candidateRelDirs.push(`${base}/${entry.name}`);
      }
    } else {
      candidateRelDirs.push(glob);
    }
  }
  const checked = [];
  for (const rel of new Set(candidateRelDirs)) {
    const dir = join(repoRoot, rel);
    const hasPackageJson = statSyncOrNull(join(dir, "package.json"))?.isFile() ?? false;
    if (!hasPackageJson) continue;
    checked.push(rel);
  }
  return checked.sort();
}

// ---------------------------------------------------------------------------------------
// 2. Scope units: every workspace package (checked against its own package.json) plus
// scripts/ (checked against the ROOT package.json -- see header comment for why scripts/
// must be in scope for THIS guard specifically).
// ---------------------------------------------------------------------------------------
function readPackageJson(pkgJsonAbsPath) {
  const pkg = JSON.parse(readFileSync(pkgJsonAbsPath, "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  // A package importing ITS OWN published name (e.g. a package-root index.ts re-exporting
  // through "@twist-arcade/<self>" to exercise its own public surface) is always resolvable --
  // a package is never a dependency of itself, and requiring it to self-declare would be a
  // guard demanding a manifest entry that carries no real information.
  return { declared, ownName: pkg.name };
}

function buildScopeUnits() {
  const workspacePackages = discoverWorkspacePackageDirs();
  const units = workspacePackages.map((rel) => ({
    label: rel,
    sourceDir: rel,
    pkgJsonRel: `${rel}/package.json`,
  }));
  units.push({
    label: "scripts/ (root project, not a pnpm workspace package -- checked against root package.json)",
    sourceDir: "scripts",
    pkgJsonRel: "package.json",
  });
  return units;
}

// ---------------------------------------------------------------------------------------
// 3. On-disk source files per scope unit.
// ---------------------------------------------------------------------------------------
const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts|mjs|cjs)$/;

function findSourceFiles(dir) {
  const results = [];
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (SOURCE_EXT_RE.test(entry.name)) results.push(full);
    }
  }
  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------------------
// 4. Import extraction via the real TypeScript AST -- see header comment for why this is
// NOT regex over raw text (comments and codegen data strings both contain import-shaped
// text in this repo, and both must be ignored).
// ---------------------------------------------------------------------------------------
function scriptKindFor(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS; // .ts, .mts, .cts
}

/** One import/export/dynamic-import site found in a file, in a shape measureUnit() can judge
 *  against declared dependencies without caring which AST node kind produced it. */
function extractImportSites(fileAbsPath, contents) {
  const sourceFile = ts.createSourceFile(fileAbsPath, contents, ts.ScriptTarget.Latest, true, scriptKindFor(fileAbsPath));
  const sites = [];

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      // Covers `import x from "y"`, `import "y"`, `export {x} from "y"`, `export * from "y"`.
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteralLike(spec)) {
        sites.push({ line: lineOf(node), kind: "static", specifier: spec.text });
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      // `import x = require("y")` -- not used anywhere in this ESM repo today, handled anyway
      // rather than silently ignored, per this guard's own "never silently pass" rule.
      const ref = node.moduleReference;
      if (ref && ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteralLike(ref.expression)) {
        sites.push({ line: lineOf(node), kind: "static", specifier: ref.expression.text });
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        // Covers both `import("y")` and the no-substitution template case `import(\`y\`)`.
        sites.push({ line: lineOf(node), kind: "static", specifier: arg.text });
      } else if (arg && ts.isTemplateExpression(arg)) {
        // `import(\`@scope/${id}\`)` -- a real templated-dynamic import with at least one
        // interpolation. Reconstruct the raw backtick contents from the AST (never regex
        // over the file) so prefix/suffix/interpolation-count analysis is exact.
        const raw = arg.getText(sourceFile).slice(1, -1);
        sites.push({ line: lineOf(node), kind: "template", raw });
      }
      // Any other argument shape (identifier, call expression, member access, etc.) is a
      // fully-dynamic import() this guard cannot resolve statically -- see FULLY_DYNAMIC_NOTE.
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return sites;
}

// ---------------------------------------------------------------------------------------
// 5. Expansion-set resolvers for templated-dynamic imports, keyed by literal scope prefix
// (e.g. "@twist-arcade/"). See header comment for why this is registry.ts's real, live
// Object.keys(registry) -- asked via a real `tsx` import, never regex-parsed from source.
// ---------------------------------------------------------------------------------------
let cachedTwistArcadeGameIds = null;
function resolveTwistArcadeGameIds() {
  if (cachedTwistArcadeGameIds) return cachedTwistArcadeGameIds;
  const registryAbsPath = join(repoRoot, "games/registry.ts");
  const registryUrl = pathToFileURL(registryAbsPath).href;
  const code =
    `import(${JSON.stringify(registryUrl)}).then((m) => {` +
    `process.stdout.write(JSON.stringify(Object.keys(m.registry)));` +
    `}).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });`;
  let stdout;
  try {
    stdout = execFileSync(tsxBin, ["--eval", code], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      `could not resolve the @twist-arcade/ expansion set by importing games/registry.ts via tsx: ${String(
        err.stderr ?? err.message ?? err
      )}`
    );
  }
  cachedTwistArcadeGameIds = JSON.parse(stdout.trim()).map((id) => `@twist-arcade/${id}`);
  return cachedTwistArcadeGameIds;
}

const EXPANSION_RESOLVERS = {
  "@twist-arcade/": resolveTwistArcadeGameIds,
};

// ---------------------------------------------------------------------------------------
// Explicit, reviewable allowlist for KNOWN templated-resolution findings that are LAYERING
// VIOLATIONS, not missing declarations (C84) -- the mechanism, not a specific exemption.
//
// This guard's first real run found four undeclared resolutions, all at
// packages/harness/src/cli.ts:151 (`import(\`@twist-arcade/${gameId}\`)`, resolveSafeMove) --
// a platform package (packages/harness) reaching into leaf game packages by name, which could
// not be fixed by declaring the dependency: crackstep and fadeout both already depend on
// @twist-arcade/harness, so the reverse edge would be a real cycle
// (harness -> crackstep -> harness). C84's ruling was to allowlist those four findings
// (below, until fixed) rather than exempt-and-forget, and to register the real fix as its own
// work: invert the CLI's game resolution to injection, matching scripts/ci-gates.ts's own
// injected `RunAllGatesDeps`.
//
// C84 IS NOW FIXED: packages/harness/src/cli.ts no longer contains ANY dynamic import of a
// game package or games/registry.ts -- `dispatch()` takes an injected `CliDeps` (see that
// file's own module doc), and the real wiring (the actual
// `import(\`@twist-arcade/${gameId}\`)`) moved to scripts/harness-cli.ts, the real process
// entry point. scripts/ is checked against the ROOT package.json, which already declares every
// registered game as a devDependency -- so that templated import now resolves against a REAL
// declared dependency with no allowlist needed. ALLOWLIST is therefore empty; it stays
// declared (rather than deleted outright) as the reviewable escape hatch C84 established for
// the next genuine layering violation this guard finds, per ruling 3: an exemption here is an
// EXACT (file, line, resolved package name) tuple, never a blanket skip of templated-import
// detection -- see the "does not blanket-skip" test in scripts/test/check-declared-deps.test.ts.
// ---------------------------------------------------------------------------------------
const ALLOWLIST = [];

function allowlistKey(file, line, pkgName) {
  return `${file}:${line}:${pkgName}`;
}

const ALLOWLIST_MAP = new Map(ALLOWLIST.map((e) => [allowlistKey(e.file, e.line, e.pkgName), e]));
const allowlistUsed = new Set();

// ---------------------------------------------------------------------------------------
// 6. Measure one scope unit's gap set.
// ---------------------------------------------------------------------------------------
function measureUnit(unit) {
  const pkgJsonAbsPath = join(repoRoot, unit.pkgJsonRel);
  if (!statSyncOrNull(pkgJsonAbsPath)?.isFile()) {
    return { ok: false, missingPkgJson: true, gaps: [], allowlisted: [] };
  }
  const { declared, ownName } = readPackageJson(pkgJsonAbsPath);
  const sourceDir = join(repoRoot, unit.sourceDir);
  const files = findSourceFiles(sourceDir);

  const gaps = [];
  const allowlisted = [];

  function isSatisfied(pkgName) {
    return declared.has(pkgName) || pkgName === ownName;
  }

  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    const relFile = relative(repoRoot, file).split(sep).join("/");
    const seen = new Set(); // dedupe identical findings within one file

    let sites;
    try {
      sites = extractImportSites(file, contents);
    } catch (err) {
      gaps.push({
        file: relFile,
        line: 1,
        detail: `could not parse this file to extract its imports: ${err.message}`,
      });
      continue;
    }

    for (const site of sites) {
      if (site.kind === "static") {
        const specifier = site.specifier;
        if (!specifier || isRelativeSpecifier(specifier) || isNodeBuiltin(specifier)) continue;
        const pkgName = packageNameOf(specifier);
        if (isSatisfied(pkgName)) continue;
        const key = `static:${specifier}`;
        if (seen.has(key)) continue;
        seen.add(key);
        gaps.push({
          file: relFile,
          line: site.line,
          detail: `imports "${specifier}" -- not declared in ${unit.pkgJsonRel}#dependencies (or devDependencies/peerDependencies/optionalDependencies)`,
        });
        continue;
      }

      // site.kind === "template"
      const raw = site.raw; // e.g. "@twist-arcade/${gameId}"
      const interpolations = raw.match(/\$\{[^}]*\}/g) ?? [];

      if (interpolations.length !== 1) {
        gaps.push({
          file: relFile,
          line: site.line,
          detail: `templated dynamic import \`${raw}\` has ${interpolations.length} interpolations -- this guard only reasons about exactly one; add explicit handling rather than assuming it's fine`,
        });
        continue;
      }

      const interpIndex = raw.indexOf(interpolations[0]);
      const prefix = raw.slice(0, interpIndex);
      const suffix = raw.slice(interpIndex + interpolations[0].length);

      if (suffix.length > 0) {
        gaps.push({
          file: relFile,
          line: site.line,
          detail: `templated dynamic import \`${raw}\` has trailing content ("${suffix}") after its interpolation -- this guard only reasons about a bare "@scope/\${id}" shape; add explicit handling rather than assuming it's fine`,
        });
        continue;
      }

      const scopeMatch = prefix.match(/^(@[^/]+\/)$/);
      if (!scopeMatch) {
        gaps.push({
          file: relFile,
          line: site.line,
          detail: `templated dynamic import \`${raw}\` does not match a bare "@scope/\${id}" shape (prefix: "${prefix}") -- this guard only reasons about that shape; add explicit handling rather than assuming it's fine`,
        });
        continue;
      }

      const scopePrefix = scopeMatch[1]; // e.g. "@twist-arcade/"
      const resolver = EXPANSION_RESOLVERS[scopePrefix];
      if (!resolver) {
        gaps.push({
          file: relFile,
          line: site.line,
          detail: `templated dynamic import \`${raw}\` -- no expansion-set resolver is registered for scope "${scopePrefix}" in EXPANSION_RESOLVERS (scripts/check-declared-deps.mjs). Refusing to guess: either this import can never actually resolve to a package outside this guard's knowledge (fine, but say so by adding a resolver) or it's a real gap. Add one before trusting this guard's silence about it.`,
        });
        continue;
      }

      let expansionSet;
      try {
        expansionSet = resolver();
      } catch (err) {
        gaps.push({
          file: relFile,
          line: site.line,
          detail: `templated dynamic import \`${raw}\` -- expansion-set resolver for "${scopePrefix}" threw: ${err.message}`,
        });
        continue;
      }

      for (const pkgName of expansionSet) {
        if (isSatisfied(pkgName)) continue;
        const key = `template:${pkgName}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const allowKey = allowlistKey(relFile, site.line, pkgName);
        const allowEntry = ALLOWLIST_MAP.get(allowKey);
        if (allowEntry) {
          allowlistUsed.add(allowKey);
          allowlisted.push({
            file: relFile,
            line: site.line,
            pkgName,
            reason: allowEntry.reason,
          });
          continue;
        }

        gaps.push({
          file: relFile,
          line: site.line,
          detail: `templated dynamic import \`${raw}\` can resolve to "${pkgName}" (from games/registry.ts's registered game ids) -- not declared in ${unit.pkgJsonRel}#dependencies (or devDependencies/peerDependencies/optionalDependencies)`,
        });
      }
    }
  }

  return { ok: true, missingPkgJson: false, gaps, allowlisted };
}

// ---------------------------------------------------------------------------------------
// 7. Run it.
// ---------------------------------------------------------------------------------------
const units = buildScopeUnits();

console.log(`Discovered ${units.length} scope unit(s):`);
for (const u of units) console.log(`  - ${u.label}`);
console.log();
console.log(`Explicitly OUT OF SCOPE (C79 ruling 1 -- printed here, not just argued in a header comment):`);
for (const o of OUT_OF_SCOPE) console.log(`  - ${o.path} -- ${o.reason}`);
console.log(`  - ${FULLY_DYNAMIC_NOTE}`);
console.log();
console.log(
  `Templated-dynamic expansion: only "@twist-arcade/" has a registered resolver (games/registry.ts's ` +
    `real, live Object.keys(registry), asked via tsx, never regex-parsed from source -- C83, C72's ` +
    `"ask, don't predict" rule applied one layer up). Any other scoped template (e.g. "@foo/\${id}") ` +
    `fails loudly rather than being silently assumed fine -- see EXPANSION_RESOLVERS.`
);
console.log();
console.log(
  `Explicit ALLOWLIST (C84 -- printed here, not just argued in a header comment; an exemption that ` +
    `prints is reviewable, one in a header comment is not, per C79): ${ALLOWLIST.length} exact ` +
    `(file, line, resolved package) finding(s) are known LAYERING VIOLATIONS, not missing ` +
    `declarations, and are exempted from failing -- but each new/different resolution at the same ` +
    `line, or any resolution anywhere else, is still checked normally (this is not a blanket skip):`
);
for (const e of ALLOWLIST) {
  console.log(`  - ${e.file}:${e.line} -> ${e.pkgName}`);
  console.log(`    ${e.reason}`);
}
console.log();

let totalGaps = 0;
for (const unit of units) {
  const result = measureUnit(unit);
  if (result.missingPkgJson) {
    fail(`${unit.pkgJsonRel}: no package.json found for scope unit "${unit.label}" -- cannot determine declared dependencies`);
    continue;
  }
  if (result.gaps.length === 0) {
    const allowSuffix = result.allowlisted.length > 0 ? ` (${result.allowlisted.length} allowlisted -- see above)` : "";
    console.log(`✓ ${unit.label} -- every import resolved against a declared dependency${allowSuffix}`);
    continue;
  }
  totalGaps += result.gaps.length;
  fail(`${unit.label}: ${result.gaps.length} undeclared-dependency finding(s):`);
  for (const g of result.gaps) {
    console.error(`    ${g.file}:${g.line} -- ${g.detail}`);
  }
}

const staleAllowlistEntries = ALLOWLIST.filter((e) => !allowlistUsed.has(allowlistKey(e.file, e.line, e.pkgName)));
if (staleAllowlistEntries.length > 0) {
  console.log();
  console.log(
    `NOTE: ${staleAllowlistEntries.length} ALLOWLIST entry(ies) matched nothing in this run -- the ` +
      "finding they were written for no longer exists in this shape (fixed, moved, or renamed). Not " +
      "a failure, but stale allowlist entries should be deleted, not left to accumulate:"
  );
  for (const e of staleAllowlistEntries) console.log(`  - ${e.file}:${e.line} -> ${e.pkgName}`);
}

const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
console.log();
console.log(`check-declared-deps: ${units.length} scope unit(s) checked in ${elapsedMs.toFixed(1)}ms.`);

if (failed) {
  console.error(
    `\ndeclared-deps check FAILED -- ${totalGaps} finding(s) above. An import that resolves today via ` +
      "hoisting, a stale symlink, or a parent node_modules is not the same as a declared dependency " +
      "(C83) -- fix the manifest, or if a templated import's expansion set is wrong, fix the resolver " +
      "in scripts/check-declared-deps.mjs, never this guard's output. If this is a genuine layering " +
      "violation (declaring the dependency would create a cycle), do not declare it -- add a specific, " +
      "reviewable ALLOWLIST entry instead (C84's posture), never a blanket skip."
  );
  process.exit(1);
} else {
  console.log("declared-deps check passed -- every scope unit's imports resolve against its own declared dependencies (or an explicit, reviewable allowlist entry).");
}

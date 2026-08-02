#!/usr/bin/env node
// scripts/check-engine-purity.mjs
//
// Encodes the ONE dependency rule the plan actually requires (DoD §13): packages/engine
// must have zero runtime dependencies and never import react. This is deliberately NOT a
// repo-wide ban — @twist-arcade/shell (a future UI package) is explicitly permitted to
// depend on React for real, and packages/game-spec is allowed a type-only react import.
// Only packages/engine is constrained. Run via `pnpm check:engine-purity`; wired into CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const enginePkgPath = join(repoRoot, "packages/engine/package.json");
const engineSrcDirs = ["packages/engine/src", "packages/engine/testkit"];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`✗ ${message}`);
}

// 1. packages/engine/package.json must declare zero runtime dependencies.
const pkg = JSON.parse(readFileSync(enginePkgPath, "utf8"));
const deps = pkg.dependencies ?? {};
const depNames = Object.keys(deps);
if (depNames.length > 0) {
  fail(`packages/engine/package.json has runtime dependencies (must be zero): ${depNames.join(", ")}`);
} else {
  console.log("✓ packages/engine has zero runtime dependencies");
}

// 2. No file under packages/engine/{src,testkit} may import "react" (or "react-dom"/"next").
// Note: packages/engine/test/** is intentionally NOT scanned — the self-test mutants live
// there and are never shipped; the shipped surface is src/ and testkit/.
const forbiddenImportPattern = /from\s+["'](react|react-dom|next)(\/|["'])/;

function walk(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) onFile(full);
  }
}

for (const relDir of engineSrcDirs) {
  const dir = join(repoRoot, relDir);
  walk(dir, (file) => {
    const contents = readFileSync(file, "utf8");
    if (forbiddenImportPattern.test(contents)) {
      fail(`${file.replace(repoRoot, "")} imports react/react-dom/next — packages/engine must stay framework-free`);
    }
  });
}
if (!failed) {
  console.log("✓ packages/engine/{src,testkit} import no framework code (react/react-dom/next)");
}

// 3. No file under packages/engine/src (the SHIPPED runtime surface — not testkit/, which
// legitimately depends on vitest for its adapter, contract.ts, a separate documented
// exception) may import a bare (non-relative, non-node-builtin) specifier that isn't
// declared in package.json#dependencies. Without this, `import fc from "fast-check"` in
// src/ would pass checks 1-2 above AND pass `pnpm typecheck`/`pnpm test` (fast-check is a
// real, installed devDependency here) — then break every real consumer at runtime, since
// devDependencies are not installed for consumers of the published package.
const bareSpecifierPattern = /\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isNodeBuiltin(specifier) {
  return specifier.startsWith("node:");
}

function packageNameOf(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

const engineSrcOnlyDir = join(repoRoot, "packages/engine/src");
let bareImportViolationFound = false;
walk(engineSrcOnlyDir, (file) => {
  const contents = readFileSync(file, "utf8");
  bareSpecifierPattern.lastIndex = 0;
  let match;
  while ((match = bareSpecifierPattern.exec(contents)) !== null) {
    const specifier = match[1] ?? match[2];
    if (!specifier || isRelativeSpecifier(specifier) || isNodeBuiltin(specifier)) continue;
    const pkgName = packageNameOf(specifier);
    if (!depNames.includes(pkgName)) {
      bareImportViolationFound = true;
      fail(
        `${file.replace(repoRoot, "")} imports "${specifier}" — not declared in ` +
          "packages/engine/package.json#dependencies (a bare import from src/ must be a real " +
          "runtime dependency; a devDependency imported directly from src/ would pass " +
          "typecheck/tests here but break every real consumer at runtime)"
      );
    }
  }
});
if (!bareImportViolationFound) {
  console.log("✓ packages/engine/src imports no undeclared bare (non-relative) package");
}

if (failed) {
  console.error(
    "\nNote: this check is scoped to packages/engine ONLY. Other packages (e.g. a future " +
      "@twist-arcade/shell) are explicitly permitted to depend on React for real."
  );
  process.exit(1);
} else {
  console.log("\nengine purity check passed.");
}

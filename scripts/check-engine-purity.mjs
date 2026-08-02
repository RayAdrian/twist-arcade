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

if (failed) {
  console.error(
    "\nNote: this check is scoped to packages/engine ONLY. Other packages (e.g. a future " +
      "@twist-arcade/shell) are explicitly permitted to depend on React for real."
  );
  process.exit(1);
} else {
  console.log("\nengine purity check passed.");
}

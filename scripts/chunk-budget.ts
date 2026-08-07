#!/usr/bin/env node
// scripts/chunk-budget.ts — `pnpm chunk-budget` — closes platform-corrections.md C38:
// ".size-limit.json measures exactly two [shell] chunks... A game's own dynamically-imported
// chunk — the thing the budget exists to bound, and the reason the registry uses import() at
// all — is measured by nothing. Every game could exceed it silently."
//
// REWRITTEN (platform-corrections.md C50) after the original approach broke the same day a
// fourth game (Tilt) was registered. See "WHY THE REWRITE" below for the full story — short
// version: the original probe assumed the registry's compiled `{gameId: {...}}` map stayed
// inlined as a single object literal inside ONE specific file
// (`.next/static/chunks/app/play/[gameId]/page-*.js`). Registering a fourth game changed
// webpack's automatic chunk-splitting heuristic (`SplitChunksPlugin`'s `minChunks` threshold):
// once the module backing that object literal is referenced by four separately-generated
// static pages instead of three, webpack decided it was worth extracting into its own shared
// chunk. The object literal didn't change shape — it just moved to a different file — but the
// probe only ever looked in one place, found zero matches, and (correctly) refused to guess.
//
// WHY THE REWRITE, NOT A PATCH: the old probe's failure mode wasn't "wrong file name," it was
// "assumes it knows which file webpack will put the registry map in, at all." Widening the
// search to "grep every chunk file for the object literal" would have fixed *this* break but
// remains hostage to the same class of assumption at five, six, or eight games — webpack's
// splitting heuristics are threshold-driven, not fixed, so where things land keeps changing.
// The rewrite below stops asking webpack "where did you put this" and instead asks Next
// "which files does this specific import() call site pull in," which Next already tracks and
// answers directly regardless of chunk topology.
//
// THE MECHANISM: `next build` writes `.next/react-loadable-manifest.json`, keyed
// `"<file containing the import() call> -> <import specifier text>"`, each value `{ id,
// files[] }` — this is Next's own accounting of every dynamic `import()` call site in the app
// (the mechanism it uses to preload the right chunks for SSR; it is NOT limited to
// `next/dynamic()`-wrapped imports, confirmed empirically: this repo's registry uses plain
// `import()` with no `next/dynamic` wrapper, and every call site still gets an entry). Example
// from a real 4-game build:
//
//   "games/registry.ts -> @twist-arcade/tilt": {
//     "id": 2309,
//     "files": ["static/chunks/678-....js", ..., "static/chunks/487-....js", "static/chunks/309-....js"]
//   }
//
// This is keyed by (source file, import specifier) — a fact about the AUTHORED source, fixed
// at the moment `games/registry.ts` is written, and completely insensitive to which file(s)
// webpack later decides to put the resulting code in. It survives chunk-splitting-topology
// changes by construction, because it isn't describing chunk topology at all.
//
// TWO EXTRACTION STEPS, TWO PURE FUNCTIONS (unit-tested independently in
// scripts/test/chunk-budget.test.ts, no build required for either):
//
//   1. `extractGameImportSpecifiers` — parses the ALREADY-AUTHORED, NEVER-MINIFIED source of
//      games/registry.ts with the TypeScript compiler API and reads, per registered game id,
//      the string-literal specifiers passed to every `import(...)` call inside that game's
//      `loadEngine` / `loadPresentation` / `loadSolver`. Registry-derived per C33: the
//      `registry` object literal is located BOTH by name (`const registry = ...`) AND by exact
//      property-key-set match against `Object.keys(registry)` (the runtime-imported registry,
//      same as before) — belt and suspenders, and a key-set mismatch fails loud rather than
//      silently reading a partial or wrong object.
//
//   2. `attributeOwnFiles` — looks up each game's specifiers in `react-loadable-manifest.json`
//      (`"games/registry.ts -> <specifier>"`), unions the `files[]` per game, then excludes any
//      file referenced by EVERY registered game (shell-equivalent shared infra — e.g. a Radix
//      dialog every game's presentation happens to use — same exclusion rule and rationale as
//      the original script, just computed over manifest file lists instead of parsed chunk
//      ids). A specifier with no matching manifest entry fails loud, naming the game and the
//      specifier — the build doesn't know about an import the source declares, which means the
//      build is stale relative to games/registry.ts or Next changed this manifest's format.
//
// FRAGILITY, STATED PLAINLY: this depends on (a) `games/registry.ts` keeping its current
// `export const registry: Registry = { <id>: { loadEngine, loadPresentation, loadSolver? } }`
// shape — a deliberate choice by whoever edits that file, not a build artifact, so it changes
// far less often than webpack's internal chunk-splitting decisions did; and (b) Next continuing
// to emit `react-loadable-manifest.json` keyed `"<file> -> <specifier>"`. Both are load-bearing
// assumptions, both are checked, and both fail loud — never a silent 0-byte report — exactly
// the property that made C50 a repairable finding instead of a lie. A future Next major that
// removes or reshapes this manifest will break this script exactly as loudly as the old one
// broke at four games; it is a different assumption, not a sturdier guarantee that no
// assumption exists.
//
// WHY NOT `.next/build-manifest.json` / `.next/app-build-manifest.json`: checked both against
// the real 4-game build before choosing react-loadable-manifest.json. They record, PER ROUTE,
// the chunks needed to render that route's initial HTML/RSC payload — accurate for "what does
// visiting /play/tilt cost on first paint" but NOT keyed by individual `import()` call site, so
// they cannot attribute a specific chunk to "the code loadEngine('tilt') pulls in" versus
// "code some other part of the route needs." They also reproduce the C43 finding verbatim: the
// `/play/[gameId]/page` entry in app-build-manifest.json is IDENTICAL for every generated game
// param (same file list for crackstep, tilt, nine-grids, fadeout), because
// `generateStaticParams()` can't statically narrow per-param reachable chunks — so a
// route-manifest-only approach would still report every game as costing the sum of all games',
// naming no offender, same as the Playwright network-capture option C43 already rejected.
// `react-loadable-manifest.json` is the one Next artifact keyed at the right granularity (the
// import() call site itself, not the route).
//
// PER-GAME ATTRIBUTION / UNIVERSAL-CHUNK EXCLUSION: unchanged rationale from the original
// script. A file referenced by EVERY registered game (shared UI-kit code) is shell-equivalent
// and excluded from every game's total, same as the existing shell budget already covers it. A
// file referenced by fewer than all games is charged in full to every game that references it —
// deliberately conservative: a player whose FIRST visit is to that specific game downloads it
// regardless of whether some other game happens to share it.
//
// KNOWN LIMITATION, CARRIED OVER FROM THE ORIGINAL SCRIPT: with exactly ONE registered game,
// "referenced by every game" and "this game's own code" are the same set, so the universal-file
// exclusion would zero out that game's entire total. Not a practical concern at 4+ games
// (current registry size), but worth stating rather than leaving implicit a second time.

import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { Registry } from "@twist-arcade/game-spec";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REGISTRY_SOURCE_PATH = path.join(REPO_ROOT, "games/registry.ts");
// The key prefix react-loadable-manifest.json uses for every import() call site declared in
// games/registry.ts — a fact about OUR source layout (stable; we control it), not a webpack
// build artifact. See attributeOwnFiles() for how a mismatch here is handled without silently
// matching nothing: it's matched by suffix, not strict equality, specifically so an unexpected
// prefix format is diagnosable instead of indistinguishable from "no imports found."
const REGISTRY_SOURCE_REL = "games/registry.ts";
const LOADABLE_MANIFEST_PATH = path.join(REPO_ROOT, ".next/react-loadable-manifest.json");

// "kB" here means 1000 bytes (decimal), matching `.size-limit.json` / the `bytes` npm package's
// default parse of "kB" — NOT 1024. `DEFAULT_HARNESS_THRESHOLDS.maxBundleKb` (packages/
// game-spec/src/thresholds.ts) was declared for exactly this purpose ("fail > 75 kB gz/route")
// but had no reader anywhere in the codebase until this script — this is that field's first
// real consumer.
const BUDGET_BYTES = DEFAULT_HARNESS_THRESHOLDS.maxBundleKb * 1000;

export class ChunkBudgetProbeError extends Error {}

async function loadRegistry(): Promise<Registry> {
  const registryUrl = pathToFileURL(REGISTRY_SOURCE_PATH).href;
  const mod = (await import(registryUrl)) as { registry: Registry };
  return mod.registry;
}

const LOAD_KEYS = new Set(["loadEngine", "loadPresentation", "loadSolver"]);
const REQUIRED_LOAD_KEYS = new Set(["loadEngine", "loadPresentation"]);

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/** Locate `games/registry.ts`'s exported registry object literal by BOTH signals: the
 *  identifier it's assigned to (`const registry = ...`) and, independently, an exact match of
 *  its top-level property-key set against `expectedIds` (the runtime-imported registry's own
 *  `Object.keys()` — same cross-check C33 required of the original script). Either signal
 *  drifting from the other — a `registry` binding whose keys don't match, or no `registry`
 *  binding shaped this way at all — fails loud rather than guessing which one is right. */
function findRegistryObjectLiteral(sourceFile: ts.SourceFile, expectedIds: Set<string>): ts.ObjectLiteralExpression {
  const candidates: ts.ObjectLiteralExpression[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "registry" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      candidates.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (candidates.length !== 1) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: expected exactly 1 "const registry = {...}" declaration in ${REGISTRY_SOURCE_REL}, found ${candidates.length}. ` +
        `This script's extraction assumes that exact authored shape — if games/registry.ts was restructured, this script needs a deliberate update, not a silent partial read.`
    );
  }
  const registryObject = candidates[0]!;

  const keys = new Set<string>();
  for (const prop of registryObject.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      throw new ChunkBudgetProbeError(
        `chunk-budget: a property of the "registry" object literal in ${REGISTRY_SOURCE_REL} is not a plain "key: value" assignment (e.g. a spread or shorthand) — this script's extraction assumes every entry is a named property. Update this script deliberately if that assumption no longer holds.`
      );
    }
    const n = propertyName(prop.name);
    if (n === undefined) {
      throw new ChunkBudgetProbeError(
        `chunk-budget: a property key of the "registry" object literal in ${REGISTRY_SOURCE_REL} is neither a plain identifier nor a string literal (e.g. computed) — cannot read the game id.`
      );
    }
    keys.add(n);
  }
  const missing = [...expectedIds].filter((id) => !keys.has(id));
  const extra = [...keys].filter((id) => !expectedIds.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: ${REGISTRY_SOURCE_REL}'s "registry" object literal's keys (${[...keys].sort().join(", ")}) don't exactly match the runtime-imported registry's Object.keys() (${[...expectedIds].sort().join(", ")}). ` +
        `Missing: ${missing.join(", ") || "(none)"}. Unexpected: ${extra.join(", ") || "(none)"}. Source and the loaded module have drifted apart.`
    );
  }

  return registryObject;
}

/** Collect every string-literal specifier passed to a dynamic `import(...)` call reachable
 *  inside `node` — i.e. `ts.isCallExpression(node) && node.expression.kind ===
 *  ts.SyntaxKind.ImportKeyword`, TypeScript's AST shape for `import(...)` as an expression
 *  (distinct from a static `ImportDeclaration`). This is what `loadEngine`/`loadPresentation`/
 *  `loadSolver`'s arrow function bodies compile from — see games/registry.ts itself. */
function collectImportSpecifiers(node: ts.Node, out: Set<string>) {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length >= 1 &&
    ts.isStringLiteralLike(node.arguments[0]!)
  ) {
    out.add(node.arguments[0]!.text);
  }
  ts.forEachChild(node, (c) => collectImportSpecifiers(c, out));
}

/** Pure parse step, no filesystem access beyond the source text handed in — unit-testable
 *  against a small synthetic TS source shaped like games/registry.ts, no `pnpm build` needed
 *  (scripts/test/chunk-budget.test.ts). Returns, per registered game id, the sorted list of
 *  dynamic-import specifiers its loadEngine/loadPresentation/loadSolver reference. Throws
 *  ChunkBudgetProbeError on every structural-assumption break rather than a partial result
 *  (C33's lesson: never report a missing/malformed entry as if it simply cost nothing). */
export function extractGameImportSpecifiers(registrySourceText: string, gameIds: string[]): Map<string, string[]> {
  const sourceFile = ts.createSourceFile(REGISTRY_SOURCE_REL, registrySourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const expectedIds = new Set(gameIds);
  const registryObject = findRegistryObjectLiteral(sourceFile, expectedIds);

  const result = new Map<string, string[]>();
  for (const prop of registryObject.properties) {
    if (!ts.isPropertyAssignment(prop)) continue; // already validated above; narrows for TS
    const gameId = propertyName(prop.name)!;
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      throw new ChunkBudgetProbeError(
        `chunk-budget: registry entry for "${gameId}" in ${REGISTRY_SOURCE_REL} is not an object literal — cannot find its load functions.`
      );
    }

    const foundLoadKeys = new Set<string>();
    const specifiers = new Set<string>();
    for (const entryProp of prop.initializer.properties) {
      if (!ts.isPropertyAssignment(entryProp) && !ts.isMethodDeclaration(entryProp)) continue;
      const name = ts.isPropertyAssignment(entryProp) || ts.isMethodDeclaration(entryProp) ? propertyName(entryProp.name) : undefined;
      if (name === undefined || !LOAD_KEYS.has(name)) continue;
      foundLoadKeys.add(name);
      const body = ts.isPropertyAssignment(entryProp) ? entryProp.initializer : entryProp.body;
      if (body) collectImportSpecifiers(body, specifiers);
    }

    const missingRequired = [...REQUIRED_LOAD_KEYS].filter((k) => !foundLoadKeys.has(k));
    if (missingRequired.length > 0) {
      throw new ChunkBudgetProbeError(
        `chunk-budget: registry entry for "${gameId}" in ${REGISTRY_SOURCE_REL} is missing required propert${missingRequired.length === 1 ? "y" : "ies"}: ${missingRequired.join(", ")} (RegistryEntry requires loadEngine and loadPresentation — see packages/game-spec/src/registry.ts).`
      );
    }

    result.set(gameId, [...specifiers].sort());
  }
  return result;
}

export interface LoadableManifestEntry {
  id: number;
  files: string[];
}
export type LoadableManifest = Record<string, LoadableManifestEntry>;

/** Pure attribution step, no filesystem access — unit-testable against a small synthetic
 *  manifest object (scripts/test/chunk-budget.test.ts), no `pnpm build` needed. For each game,
 *  looks up its specifiers (from extractGameImportSpecifiers) in the real
 *  react-loadable-manifest.json, keyed `"<file> -> <specifier>"`. Matches by SUFFIX on the file
 *  part (`key.endsWith(registrySourceRel)`, backslash-normalized) rather than strict equality —
 *  deliberately, so if Next ever emits an absolute path or a different root-relative prefix,
 *  this still matches instead of reporting every specifier as missing; if truly nothing
 *  matches, the missing-specifier error below lists exactly what was searched for, which is
 *  diagnosable in a way "every specifier reports missing" alone would not be. */
export function attributeOwnFiles(
  specifiersByGame: Map<string, string[]>,
  manifest: LoadableManifest,
  registrySourceRel: string = REGISTRY_SOURCE_REL
): Map<string, string[]> {
  const normalizedRel = registrySourceRel.replace(/\\/g, "/");
  const bySpecifier = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(manifest)) {
    const sep = key.indexOf(" -> ");
    if (sep === -1) continue;
    const filePart = key.slice(0, sep).replace(/\\/g, "/");
    const specifierPart = key.slice(sep + 4);
    if (filePart.endsWith(normalizedRel)) {
      bySpecifier.set(specifierPart, entry.files);
    }
  }

  const filesByGame = new Map<string, Set<string>>();
  for (const [gameId, specifiers] of specifiersByGame) {
    const files = new Set<string>();
    for (const specifier of specifiers) {
      const entryFiles = bySpecifier.get(specifier);
      if (entryFiles === undefined) {
        throw new ChunkBudgetProbeError(
          `chunk-budget: ${registrySourceRel} dynamically imports "${specifier}" for game "${gameId}", but the built react-loadable-manifest.json has no matching "${registrySourceRel} -> ${specifier}" entry (searched by suffix match on ${filesByGameSearchKeys(bySpecifier)}). ` +
            `Either the build is stale (rerun "pnpm build") or Next.js changed this manifest's key format — see this script's header.`
        );
      }
      for (const f of entryFiles) files.add(f);
    }
    filesByGame.set(gameId, files);
  }

  // A file referenced by EVERY registered game is shell-equivalent shared infrastructure,
  // excluded from every game's own total — same exclusion rule as the original script, now
  // computed over manifest file lists instead of parsed webpack chunk ids. See header's "KNOWN
  // LIMITATION" note for the single-game edge case.
  const gameFileSets = [...filesByGame.values()];
  const universal = new Set<string>();
  if (gameFileSets.length > 0) {
    for (const f of gameFileSets[0]!) {
      if (gameFileSets.every((set) => set.has(f))) universal.add(f);
    }
  }

  const result = new Map<string, string[]>();
  for (const [gameId, files] of filesByGame) {
    result.set(gameId, [...files].filter((f) => !universal.has(f)).sort());
  }
  return result;
}

function filesByGameSearchKeys(bySpecifier: Map<string, string[]>): string {
  const specifiers = [...bySpecifier.keys()];
  return specifiers.length === 0 ? "(no registry.ts entries found in the manifest at all)" : `${specifiers.length} known specifier(s) in the manifest`;
}

function gzipSize(filePath: string): number {
  return gzipSync(readFileSync(filePath)).length;
}

export interface GameBudgetResult {
  gameId: string;
  ownFiles: string[];
  gzipBytes: number;
  overBudget: boolean;
}

/** Orchestrates the two pure steps above with the filesystem: resolves each own-file to its
 *  path under `.next/` and gzips it. This half is exercised by the real
 *  `pnpm build && pnpm chunk-budget` integration path, not the unit tests — it needs real
 *  Next.js output on disk to mean anything. */
export function computeBudgets(registrySourceText: string, manifest: LoadableManifest, gameIds: string[]): GameBudgetResult[] {
  const specifiersByGame = extractGameImportSpecifiers(registrySourceText, gameIds);
  const ownFilesByGame = attributeOwnFiles(specifiersByGame, manifest);

  return [...ownFilesByGame.entries()]
    .map(([gameId, files]) => {
      const gzipBytes = files.reduce((sum, f) => sum + gzipSize(path.join(REPO_ROOT, ".next", f)), 0);
      return {
        gameId,
        ownFiles: files,
        gzipBytes,
        overBudget: gzipBytes > BUDGET_BYTES,
      };
    })
    .sort((a, b) => a.gameId.localeCompare(b.gameId));
}

function loadLoadableManifest(): LoadableManifest {
  let raw: string;
  try {
    raw = readFileSync(LOADABLE_MANIFEST_PATH, "utf8");
  } catch (err) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: cannot read ${path.relative(REPO_ROOT, LOADABLE_MANIFEST_PATH)} — run "pnpm build" before "pnpm chunk-budget" (same ordering size-limit requires). Underlying error: ${String(err)}`
    );
  }
  try {
    return JSON.parse(raw) as LoadableManifest;
  } catch (err) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: ${path.relative(REPO_ROOT, LOADABLE_MANIFEST_PATH)} is not valid JSON — Next.js may have changed this manifest's format (see this script's header). Underlying error: ${String(err)}`
    );
  }
}

async function main() {
  const registry = await loadRegistry();
  const gameIds = Object.keys(registry).sort();
  if (gameIds.length === 0) {
    console.log("chunk-budget: games/registry.ts has no registered games yet — nothing to gate.");
    return;
  }

  const manifest = loadLoadableManifest();
  const registrySourceText = readFileSync(REGISTRY_SOURCE_PATH, "utf8");
  const results = computeBudgets(registrySourceText, manifest, gameIds);

  console.log(`chunk-budget: per-game dynamic-import chunk budget (platform-corrections.md C38/C50), budget = ${DEFAULT_HARNESS_THRESHOLDS.maxBundleKb} kB gzip/game`);
  console.log(`  measured from: ${path.relative(REPO_ROOT, LOADABLE_MANIFEST_PATH)} (react-loadable-manifest, per-import-site attribution — see script header)`);
  console.log("");

  let anyOver = false;
  for (const r of results) {
    const kb = (r.gzipBytes / 1000).toFixed(2);
    const status = r.overBudget ? "OVER BUDGET" : "ok";
    if (r.overBudget) anyOver = true;
    console.log(`  ${r.gameId}: ${kb} kB gzip [${status}]  (files: ${r.ownFiles.join(", ") || "(none — game route holds no game-specific code)"})`);
  }
  console.log("");

  if (anyOver) {
    const offenders = results.filter((r) => r.overBudget);
    for (const o of offenders) {
      console.error(`chunk-budget: FAIL — "${o.gameId}" is ${(o.gzipBytes / 1000).toFixed(2)} kB gzip, over the ${DEFAULT_HARNESS_THRESHOLDS.maxBundleKb} kB budget by ${((o.gzipBytes - BUDGET_BYTES) / 1000).toFixed(2)} kB.`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("chunk-budget: PASS — every registered game's own chunk(s) fit the budget.");
}

// Only run when invoked directly (`pnpm chunk-budget` / `tsx scripts/chunk-budget.ts`), not
// when imported by a test for computeBudgets/extraction-unit coverage.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

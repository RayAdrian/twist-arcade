#!/usr/bin/env node
// scripts/chunk-budget.ts — `pnpm chunk-budget` — closes platform-corrections.md C38:
// ".size-limit.json measures exactly two [shell] chunks... A game's own dynamically-imported
// chunk — the thing the budget exists to bound, and the reason the registry uses import() at
// all — is measured by nothing. Every game could exceed it silently."
//
// WHY THIS SHAPE (three options were weighed, see the C38 fix-up report for the full
// reasoning):
//
//   1. A Playwright network-transfer capture of `/play/<id>` (C38's own suggested "cheapest
//      honest answer") turns out NOT to isolate per-game bytes in THIS app: `next build`'s
//      static export for `/play/[gameId]` emits the IDENTICAL <script async> tag list into
//      EVERY generated game's HTML (verified by diffing `.next/server/app/play/{crackstep,
//      nine-grids,fadeout}.html` — byte-identical script src lists). Next can't statically
//      narrow "reachable chunks" per `generateStaticParams()` value, so it unions every game's
//      async chunks into every game's page. A network capture would show every game "costing"
//      the sum of ALL games' code, and a planted regression in one game would move every
//      game's number identically — useless for pinning a violation to the game that caused it.
//      (This union-prefetch behavior is itself a separate, real finding — see the report; not
//      fixed here, since fixing it is a Next.js/webpack code-splitting change, not a CI guard.)
//   2. `@size-limit/webpack`-style resolution needs a second, non-production webpack pass with
//      its own entry graph — new build machinery, and it wouldn't match what `next build`
//      (the artifact CI already produces and size-limit already reads) actually emitted.
//   3. **What this script does**: parse the ALREADY-BUILT, ALREADY-MEASURED shell chunk
//      (`.next/static/chunks/app/play/*/page-*.js` — the exact file `.size-limit.json`'s
//      "game route" entry targets) and read the real per-game dynamic-import graph out of it
//      directly. The registry's `loadEngine`/`loadPresentation`/`loadSolver` closures compile
//      to literal `n.e(<chunkId>)` webpack-chunk-ensure calls inside one object keyed by game
//      id — that object IS the source of truth for "which chunk(s) does playing game X pull
//      in," decided by the bundler, not guessed at by this script. No new build step, no
//      browser, no webpack config change: it re-reads output CI already has on disk after
//      `pnpm build`.
//
// PER-GAME ATTRIBUTION: a chunk id referenced by EVERY registered game (shared UI-kit code —
// e.g. a Radix dialog used by every game's presentation) is shell-equivalent and excluded from
// every game's total, same as the existing shell budget already covers it. A chunk id
// referenced by fewer than all games is charged in full to every game that references it —
// deliberately conservative: a player whose FIRST visit is to that specific game downloads it
// regardless of whether some other game happens to share it, so "shared by some, not all" must
// still count as "this game's own download cost," not get a shared-cost discount.
//
// REGISTRY-DERIVED, NEVER HARDCODED (C33's lesson applied here): the set of game ids to check
// comes from `games/registry.ts` itself. If the compiled chunk's own id set doesn't match that
// exactly, this script fails loud rather than silently reporting partial or zero data for the
// missing id — the same shape C33 required of the registry-drift guard, applied to this guard.
//
// FRAGILITY, STATED PLAINLY: this depends on webpack's current on-demand-chunk codegen shape
// (`<callee>.e(<NumericLiteral>)`, `<id>.<hash>.js` / `<id>-<hash>.js` filenames). A Next.js
// major bump or a switch to Turbopack for production builds changes this and will make the
// object-literal probe below find zero or multiple candidates — which is exactly the loud
// failure mode built in (see `findRegistryObjectLiterals`), not a silent pass.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { Registry } from "@twist-arcade/game-spec";
import { DEFAULT_HARNESS_THRESHOLDS } from "@twist-arcade/game-spec";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHUNKS_DIR = path.join(REPO_ROOT, ".next/static/chunks");
// Same glob `.size-limit.json`'s "game route (/play/[gameId])" entry targets. Kept as a
// literal here (not read out of .size-limit.json) because the two checks are intentionally
// independent guards over related-but-different artifacts; if this path pattern ever needs to
// change, `.size-limit.json` needs the matching change made deliberately, not silently forked.
const SHELL_CHUNK_GLOB_DIR = path.join(REPO_ROOT, ".next/static/chunks/app/play");

// "kB" here means 1000 bytes (decimal), matching `.size-limit.json` / the `bytes` npm package's
// default parse of "kB" — NOT 1024. `DEFAULT_HARNESS_THRESHOLDS.maxBundleKb` (packages/
// game-spec/src/thresholds.ts) was declared for exactly this purpose ("fail > 75 kB gz/route")
// but had no reader anywhere in the codebase until this script — this is that field's first
// real consumer.
const BUDGET_BYTES = DEFAULT_HARNESS_THRESHOLDS.maxBundleKb * 1000;

export class ChunkBudgetProbeError extends Error {}

async function loadRegistry(): Promise<Registry> {
  const registryUrl = pathToFileURL(path.join(REPO_ROOT, "games/registry.ts")).href;
  const mod = (await import(registryUrl)) as { registry: Registry };
  return mod.registry;
}

/** Locate the built `/play/[gameId]` route chunk — the one file `.size-limit.json` already
 *  measures. Requires exactly one match: zero means the build is missing or Next changed its
 *  route-chunk naming; more than one means an assumption here (single dynamic route under
 *  app/play) no longer holds. Either way, loud failure beats silently picking one. */
function findShellChunkFile(): string {
  let paramDirs: string[];
  try {
    paramDirs = readdirSync(SHELL_CHUNK_GLOB_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: cannot read ${path.relative(REPO_ROOT, SHELL_CHUNK_GLOB_DIR)} — run "pnpm build" before "pnpm chunk-budget" (same ordering size-limit requires). Underlying error: ${String(err)}`
    );
  }
  const matches: string[] = [];
  for (const dir of paramDirs) {
    const full = path.join(SHELL_CHUNK_GLOB_DIR, dir);
    for (const f of readdirSync(full)) {
      if (/^page-[0-9a-f]+\.js$/.test(f)) matches.push(path.join(full, f));
    }
  }
  if (matches.length !== 1) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: expected exactly 1 built "/play/[gameId]" route chunk, found ${matches.length}: ${matches.map((m) => path.relative(REPO_ROOT, m)).join(", ") || "(none)"}. ` +
        `This script's chunk-id extraction assumes a single dynamic game route — if that structure changed, this script needs a deliberate update, not a silent partial read.`
    );
  }
  return matches[0]!;
}

interface GameLoadChunks {
  gameId: string;
  /** webpack chunk ids referenced by this game's loadEngine/loadPresentation/loadSolver. */
  chunkIds: Set<number>;
}

/** Find every top-level ObjectLiteralExpression in `sourceFile` whose property-name set is
 *  exactly `expectedIds` — structurally locating the registry's compiled `{gameId: {...}}` map
 *  by SHAPE, not by a minified variable name (which webpack/SWC are free to rename on any
 *  build). Requiring exact-set equality against 3+ specific ids makes an accidental collision
 *  with an unrelated object literal in the same minified file astronomically unlikely. */
function findRegistryObjectLiterals(sourceFile: ts.SourceFile, expectedIds: Set<string>): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];

  function propertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name)) return name.text;
    return undefined;
  }

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set<string>();
      let allNamed = true;
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          allNamed = false;
          break;
        }
        const n = propertyName(prop.name);
        if (n === undefined) {
          allNamed = false;
          break;
        }
        names.add(n);
      }
      if (allNamed && names.size === expectedIds.size && [...expectedIds].every((id) => names.has(id))) {
        found.push(node);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** Within one game's compiled registry-entry object, collect webpack chunk ids referenced by
 *  `loadEngine` / `loadPresentation` / `loadSolver` — i.e. every `<expr>.e(<NumericLiteral>)`
 *  call reachable inside those three properties' initializers. `n.e(id)` is webpack's own
 *  generated "ensure this chunk is loaded" call; the numeric argument IS the chunk id, and
 *  built chunk filenames are `<id>.<hash>.js` / `<id>-<hash>.js` — see `resolveChunkFile`. */
function extractChunkIds(entryObject: ts.ObjectLiteralExpression): Set<number> {
  const ids = new Set<number>();
  const loadKeys = new Set(["loadEngine", "loadPresentation", "loadSolver"]);

  function propertyName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name)) return name.text;
    return undefined;
  }

  function collectFrom(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "e" &&
      node.arguments.length === 1 &&
      ts.isNumericLiteral(node.arguments[0]!)
    ) {
      ids.add(Number(node.arguments[0]!.text));
    }
    ts.forEachChild(node, collectFrom);
  }

  for (const prop of entryObject.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (name !== undefined && loadKeys.has(name)) collectFrom(prop.initializer);
  }

  return ids;
}

/** Resolve a webpack chunk id to its built file. Anchored so id `1` cannot match `13-*.js` —
 *  the character immediately after the id must be `.` or `-` (the two hash-separator styles
 *  Next emits, e.g. `152.4cb6f...js` vs `855-70d7c...js`). */
function resolveChunkFile(id: number): string {
  const re = new RegExp(`^${id}[.-][0-9a-f]+\\.js$`);
  const matches = readdirSync(CHUNKS_DIR).filter((f) => re.test(f));
  if (matches.length !== 1) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: webpack chunk id ${id} (referenced via n.e(${id}) in the compiled registry) resolved to ${matches.length} files in ${path.relative(REPO_ROOT, CHUNKS_DIR)}, expected exactly 1: ${matches.join(", ") || "(none)"}.`
    );
  }
  return path.join(CHUNKS_DIR, matches[0]!);
}

function gzipSize(filePath: string): number {
  return gzipSync(readFileSync(filePath)).length;
}

/** Pure parse-and-attribute step: no filesystem access beyond the source text handed in, so
 *  this is the unit-testable core (scripts/test/chunk-budget.test.ts) — it can be exercised
 *  against a small synthetic source string shaped like webpack's real output without needing a
 *  real `pnpm build` on disk. Returns, per registered game id, the webpack chunk ids that are
 *  "its own" (referenced by that game but not by every registered game — see header comment).
 *  Throws `ChunkBudgetProbeError` on every ambiguous/drifted shape rather than returning a
 *  partial or best-guess result (C33's lesson: a guard that loops over a list must fail loud on
 *  a missing entry, never report as if that entry simply cost 0 bytes). */
export function attributeOwnChunkIds(sourceText: string, gameIds: string[]): Map<string, number[]> {
  const sourceFile = ts.createSourceFile("page.js", sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const expectedIds = new Set(gameIds);

  const candidates = findRegistryObjectLiterals(sourceFile, expectedIds);
  if (candidates.length !== 1) {
    throw new ChunkBudgetProbeError(
      `chunk-budget: expected exactly 1 object literal in the compiled route chunk whose keys exactly match games/registry.ts's ids (${[...expectedIds].sort().join(", ")}), found ${candidates.length}. ` +
        `Either the build's registry object no longer has this shape (webpack/Next version change — see this script's header), or games/registry.ts and the built output have drifted apart.`
    );
  }
  const registryObject = candidates[0]!;

  const perGame: GameLoadChunks[] = [];
  for (const prop of registryObject.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (name === undefined || !expectedIds.has(name)) continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      throw new ChunkBudgetProbeError(`chunk-budget: registry entry for "${name}" in the compiled chunk is not an object literal — cannot extract its load functions.`);
    }
    perGame.push({ gameId: name, chunkIds: extractChunkIds(prop.initializer) });
  }
  const foundIds = new Set(perGame.map((g) => g.gameId));
  const missing = gameIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ChunkBudgetProbeError(`chunk-budget: games/registry.ts registers ${missing.join(", ")} but the compiled route chunk has no matching entry for ${missing.length === 1 ? "it" : "them"}.`);
  }

  // A chunk id referenced by EVERY registered game is shell-equivalent infrastructure
  // (verified in this build to be e.g. a shared Radix dialog used by every presentation) —
  // excluded from every game's own total, same as it's already excluded from the shell budget
  // by never appearing there either. Anything referenced by fewer than all games is charged in
  // full to every game that references it (see header comment for why: no shared-cost
  // discount for a cold first-time visitor).
  const universal = new Set<number>();
  if (perGame.length > 0) {
    for (const id of perGame[0]!.chunkIds) {
      if (perGame.every((g) => g.chunkIds.has(id))) universal.add(id);
    }
  }

  const result = new Map<string, number[]>();
  for (const g of perGame) {
    result.set(
      g.gameId,
      [...g.chunkIds].filter((id) => !universal.has(id)).sort((a, b) => a - b)
    );
  }
  return result;
}

export interface GameBudgetResult {
  gameId: string;
  ownChunkIds: number[];
  ownFiles: string[];
  gzipBytes: number;
  overBudget: boolean;
}

/** Orchestrates the pure step above with the filesystem: resolves each own-chunk-id to its
 *  built file under `.next/static/chunks/` and gzips it. This half is exercised by the real
 *  `pnpm build && pnpm chunk-budget` integration path, not the unit test — it needs real
 *  webpack output on disk to mean anything. */
export function computeBudgets(sourceText: string, gameIds: string[]): GameBudgetResult[] {
  const ownIdsByGame = attributeOwnChunkIds(sourceText, gameIds);

  return [...ownIdsByGame.entries()]
    .map(([gameId, ownIds]) => {
      const ownFiles = ownIds.map(resolveChunkFile);
      const gzipBytes = ownFiles.reduce((sum, f) => sum + gzipSize(f), 0);
      return {
        gameId,
        ownChunkIds: ownIds,
        ownFiles: ownFiles.map((f) => path.relative(REPO_ROOT, f)),
        gzipBytes,
        overBudget: gzipBytes > BUDGET_BYTES,
      };
    })
    .sort((a, b) => a.gameId.localeCompare(b.gameId));
}

async function main() {
  const registry = await loadRegistry();
  const gameIds = Object.keys(registry).sort();
  if (gameIds.length === 0) {
    console.log("chunk-budget: games/registry.ts has no registered games yet — nothing to gate.");
    return;
  }

  const shellChunkFile = findShellChunkFile();
  const sourceText = readFileSync(shellChunkFile, "utf8");
  const results = computeBudgets(sourceText, gameIds);

  console.log(`chunk-budget: per-game dynamic-import chunk budget (platform-corrections.md C38), budget = ${DEFAULT_HARNESS_THRESHOLDS.maxBundleKb} kB gzip/game`);
  console.log(`  measured from: ${path.relative(REPO_ROOT, shellChunkFile)}`);
  console.log("");

  let anyOver = false;
  for (const r of results) {
    const kb = (r.gzipBytes / 1000).toFixed(2);
    const status = r.overBudget ? "OVER BUDGET" : "ok";
    if (r.overBudget) anyOver = true;
    console.log(`  ${r.gameId}: ${kb} kB gzip [${status}]  (chunks: ${r.ownFiles.join(", ") || "(none — game route holds no game-specific code)"})`);
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
